import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  type PluginClientContext,
  type PluginHostProps,
  type PluginPopoverProps,
  type PluginScreenProps,
  type PluginSidebarItemProps,
  useSettings,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { z } from "zod";
import { DEFAULTS, preferences, type Preferences } from "../shared/preferences";
import { watchAgents } from "./agents";
import { type AgentInfo, type DotState, isLightText, type ListEntry, unreadList, unreadListKey } from "./model";

/** One shared value the row, the sheet and the screen re-render from. */
interface Store<Value> {
  set(next: Value): void;
  subscribe(listener: () => void): () => void;
  get(): Value;
}
function createStore<Value>(initial: Value): Store<Value> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    set(next) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get: () => value,
  };
}

/** `workspaces.list` entry fields used for the "project · workspace" line. */
const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().nullish(),
  projectDisplayName: z.string().nullish(),
});

const LABEL: Record<DotState, string> = {
  permission: "Needs permission",
  error: "Error",
  running: "Running",
  finished: "Finished",
  read: "Read",
};
const MAX_DOTS = 8;

type Colors = PluginHostProps["theme"]["colors"];
function dotColor(colors: Colors, state: DotState): string {
  if (state === "permission") return colors.statusWarning;
  if (state === "error") return colors.statusDanger;
  if (state === "finished") return colors.statusSuccess;
  if (state === "read") return colors.foregroundMuted;
  // No running token in the plugin theme: Paseo's statusDotRunning, picked by text brightness.
  return isLightText(colors.foreground) ? "#5caaf6" : "#268ae0";
}

function ago(iso: string | null): string {
  const minutes = iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : NaN;
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

/** Settings as used on phones; hidden until they load, so a turned-off plugin never flashes its row. */
function usePreferences(): Preferences {
  const settings = useSettings(preferences);
  return settings.status === "ready" ? settings.values : { ...DEFAULTS, enabled: false };
}

type Agents = ReadonlyMap<string, AgentInfo>;
/** Workspace id → "project · workspace" (just one when they match). */
type Places = ReadonlyMap<string, string>;

/** The list to show; keeps the agent subscription (`retain`) alive only while the plugin is on. */
function useEntries(agents: Store<Agents>, values: Preferences, retain: () => () => void): ListEntry[] {
  useEffect(() => (values.enabled ? retain() : undefined), [values.enabled]);
  const current = useSyncExternalStore(agents.subscribe, agents.get);
  return useMemo(() => (values.enabled ? unreadList(current, values.show) : []), [current, values.enabled, values.show]);
}

function Dot({ colors, state, size }: { colors: Colors; state: DotState; size: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dotColor(colors, state) }} />;
}

function Row({ entry, place, colors, onPress }: { entry: ListEntry; place: string | undefined; colors: Colors; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}, ${LABEL[entry.state]}, open tab`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 16,
        backgroundColor: pressed ? colors.surface2 : "transparent",
      })}
    >
      <Dot colors={colors} state={entry.state} size={6} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, lineHeight: 19 }}>{entry.title}</Text>
        <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>
          {place ? `${place} · ` : ""}{LABEL[entry.state]}
        </Text>
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{ago(entry.at)}</Text>
    </Pressable>
  );
}

function List({ entries, places, colors, onOpen }: {
  entries: ListEntry[];
  places: Places;
  colors: Colors;
  onOpen(agentId: string): void;
}) {
  // "2m", "3h": redraw every 30 s while open, instead of riding on unrelated agent updates.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (entries.length === 0) {
    return <Text style={{ color: colors.foregroundMuted, fontSize: 13, padding: 16 }}>Nothing unread.</Text>;
  }
  return <>{entries.map((entry) => (
    <Row key={entry.agentId} entry={entry} place={places.get(entry.workspaceId)} colors={colors}
      onPress={() => onOpen(entry.agentId)} />
  ))}</>;
}

// Screen opens that already ran their one-shot `openAgent`; Back to them shows the list instead.
const consumedOpens = new Set<string>();

/**
 * Register the phone surfaces: a sidebar row "Unread" (hidden when nothing is unread) opening a
 * bottom sheet (A); a full "Unread" screen (B). Only screens may open an agent, so a tap in the
 * sheet opens the screen with that agent, which opens it once on mount.
 */
export function contributePhone(client: PluginClientContext): () => void {
  const agents = createStore<Agents>(new Map());
  const places = createStore<Places>(new Map());
  // Most updates (sub-agents, usage and timestamps of read tabs) change nothing on screen: skip them.
  let shownKey = "";
  // One subscription shared by the row, the sheet and the screen while any of them shows the list.
  let users = 0;
  let stopAgents = () => {};
  const retainAgents = () => {
    users += 1;
    if (users === 1) {
      stopAgents = watchAgents(client.paseo.agents, (next) => {
        const key = unreadListKey(next);
        if (key === shownKey) return;
        shownKey = key;
        agents.set(new Map(next));
      });
    }
    return () => {
      users -= 1;
      if (users === 0) stopAgents();
    };
  };
  // Plugin state hooks (`useWorkspace`) only run inside workspace panels, so names come from a
  // listing, refreshed whenever the sheet or the screen opens.
  const loadPlaces = () => {
    client.paseo.workspaces.list().then(({ entries }) => {
      const next = new Map<string, string>();
      for (const raw of entries) {
        const parsed = WorkspaceSchema.safeParse(raw);
        if (!parsed.success) continue;
        const { id, name, title, projectDisplayName } = parsed.data;
        const workspace = title || name;
        next.set(id, projectDisplayName && projectDisplayName !== workspace ? `${projectDisplayName} · ${workspace}` : workspace);
      }
      places.set(next);
    }, (error: unknown) => console.error("[noice-tab-dots] workspace listing failed", error));
  };
  const usePlaces = () => {
    useEffect(loadPlaces, []);
    return useSyncExternalStore(places.subscribe, places.get);
  };

  function Sheet({ theme, close, openScreen }: PluginPopoverProps) {
    const values = usePreferences();
    const entries = useEntries(agents, values, retainAgents);
    const names = usePlaces();
    const open = (params: Record<string, string>) => { close(); openScreen({ screenId: "unread", params }); };
    return (
      <ScrollView style={{ maxHeight: 480 }}>
        <List entries={entries} places={names} colors={theme.colors}
          onOpen={(agentId) => open({ agentId, nonce: String(Date.now()) })} />
        <Pressable accessibilityRole="button" onPress={() => open({})} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>Open as a screen</Text>
        </Pressable>
      </ScrollView>
    );
  }

  function UnreadScreen({ theme, params, navigation }: PluginScreenProps) {
    const values = usePreferences();
    const entries = useEntries(agents, values, retainAgents);
    const names = usePlaces();
    const pending = params.agentId && params.nonce ? `${params.agentId}:${params.nonce}` : null;
    useEffect(() => {
      if (!pending || !navigation || consumedOpens.has(pending)) return;
      consumedOpens.add(pending);
      navigation.openAgent({ agentId: params.agentId as string });
    }, [pending, navigation]);
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ paddingVertical: 6 }}>
        <List entries={entries} places={names} colors={theme.colors} onOpen={(agentId) => navigation?.openAgent({ agentId })} />
      </ScrollView>
    );
  }

  function SidebarItem({ theme, openPopover, currentScreen }: PluginSidebarItemProps) {
    const values = usePreferences();
    const entries = useEntries(agents, values, retainAgents);
    // Prefetch the "project · workspace" names the sheet will show on tap.
    useEffect(() => { if (entries.length > 0 && places.get().size === 0) loadPlaces(); }, [entries.length > 0]);
    if (entries.length === 0) return null;
    const size = values.size === "small" ? 4 : 5;
    const more = entries.length - MAX_DOTS;
    return (
      <SidebarRow
        icon="Inbox"
        label="Unread"
        active={currentScreen?.screenId === "unread"}
        onPress={() => openPopover(Sheet)}
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: size === 4 ? 2 : 3 }}>
            {entries.slice(0, MAX_DOTS).map((entry) => <Dot key={entry.agentId} colors={theme.colors} state={entry.state} size={size} />)}
            {more > 0 ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, marginLeft: 1 }}>+{more}</Text> : null}
          </View>
        }
      />
    );
  }

  const screen = client.addScreen({ id: "unread", title: "Unread", Component: UnreadScreen });
  const item = client.addSidebarHeaderItem({ id: "unread", title: "Unread", Component: SidebarItem });
  return () => {
    item();
    screen();
    stopAgents();
  };
}
