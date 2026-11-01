import type {
  PluginClientContext,
  PluginHostProps,
  PluginPopoverProps,
  PluginScreenProps,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { PresetButtons } from "./buttons";
import { type Choice, usePresetChoices } from "./data";

type Colors = PluginHostProps["theme"]["colors"];
type Status = "needs_input" | "failed" | "attention" | "running" | "done";
interface Workspace { id: string; projectId: string; name: string; projectDisplayName: string; status: Status; activityAt: string | null }

const LABEL: Record<Status, string> = {
  needs_input: "Needs input", failed: "Failed", attention: "Ready to review", running: "Working", done: "Done",
};

// Copied from noice-tab-dots (client/model.ts isLightText, client/phone.tsx ago).
function isLightText(color: string): boolean {
  const value = color.trim();
  let channels: number[] = [];
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1];
  if (hex && (hex.length === 3 || hex.length === 4)) channels = [...hex.slice(0, 3)].map((digit) => parseInt(digit + digit, 16));
  else if (hex && (hex.length === 6 || hex.length === 8)) channels = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  else if (/^rgba?\(/i.test(value)) channels = (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
}
function ago(iso: string | null): string {
  const minutes = iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : NaN;
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

/** Paseo's sidebar status dot colours. */
function dotColor(colors: Colors, status: Status): string {
  if (status === "needs_input") return colors.statusWarning;
  if (status === "failed") return colors.statusDanger;
  if (status === "attention") return colors.statusSuccess;
  // No running token in the plugin theme: Paseo's statusDotRunning, picked by text brightness.
  if (status === "running") return isLightText(colors.foreground) ? "#5caaf6" : "#268ae0";
  return colors.border;
}

// The preset last chosen in the sheet or the screen, for this app session (phones keep no browser storage).
let lastChoice = "all";
// Screen opens that already ran their one-shot `openWorkspace`; Back to them shows the list instead.
const consumedOpens = new Set<string>();

/**
 * Phones can't hide sidebar projects, so the presets become a jump list: a "Presets" sidebar row opens a sheet with
 * the preset buttons and the chosen preset's workspaces; tapping one opens it. Only screens may open a workspace, so a
 * tap in the sheet opens the "presets" screen with that workspace, which opens it once on mount.
 */
export function contributePhone(client: PluginClientContext): () => void {
  /** Active workspaces, newest activity first; listed again each time the sheet or the screen opens. */
  function useWorkspaces(): Workspace[] | undefined {
    const [workspaces, setWorkspaces] = useState<Workspace[]>();
    useEffect(() => {
      let live = true;
      client.paseo.workspaces.list({ page: { limit: 200 } }).then(({ entries }) => {
        if (!live) return;
        const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);
        setWorkspaces(entries.filter((entry) => !entry.background && !entry.archivingAt)
          .sort((a, b) => time(b.activityAt) - time(a.activityAt)));
      }, (error: unknown) => {
        console.error("[noice-filter-presets] workspace listing failed", error);
        if (live) setWorkspaces([]);
      });
      return () => { live = false; };
    }, []);
    return workspaces;
  }

  function Row({ workspace, colors, onPress }: { workspace: Workspace; colors: Colors; onPress(): void }) {
    const title = workspace.name;
    const place = workspace.projectDisplayName !== title ? `${workspace.projectDisplayName} · ` : "";
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${LABEL[workspace.status]}, open workspace`}
        onPress={onPress} style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 16,
          backgroundColor: pressed ? colors.surface2 : "transparent",
        })}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor(colors, workspace.status) }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, lineHeight: 19 }}>{title}</Text>
          <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>
            {place}{LABEL[workspace.status]}
          </Text>
        </View>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{workspace.status === "running" ? "" : ago(workspace.activityAt)}</Text>
      </Pressable>
    );
  }

  /** The preset buttons, then the chosen preset's workspaces. */
  function PresetList({ theme, host, onOpen }: PluginHostProps & { onOpen(workspaceId: string): void }) {
    const colors = theme.colors;
    const { data, failed } = usePresetChoices(client, host.id);
    const workspaces = useWorkspaces();
    const [chosen, setChosen] = useState(lastChoice);
    const active = data && !data.choices.some(({ id }) => id === chosen) ? "all" : chosen;
    const choose = (id: string) => { lastChoice = id; setChosen(id); };
    const listed = useMemo(() => {
      if (!data || !workspaces) return undefined;
      const shown = new Set(data.shown(active).map((project) => project.projectId));
      return workspaces.filter((workspace) => shown.has(workspace.projectId));
    }, [data, workspaces, active]);
    // "2m", "3h": redraw every 30 s while open.
    const [, setTick] = useState(0);
    useEffect(() => {
      const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
      return () => clearInterval(timer);
    }, []);
    const choices: Choice[] = data?.choices ?? [{ id: "all", name: "All" }];
    const note = (text: string) => <Text style={{ color: colors.foregroundMuted, fontSize: 13, padding: 16 }}>{text}</Text>;
    return <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
        <PresetButtons theme={theme} choices={choices} active={active} onSelect={choose} />
      </View>
      {failed && !listed ? note("Presets unavailable.")
        : !listed ? note("Loading…")
        : listed.length === 0 ? note("No workspaces.")
        : listed.map((workspace) => <Row key={workspace.id} workspace={workspace} colors={colors} onPress={() => onOpen(workspace.id)} />)}
    </>;
  }

  function Sheet(props: PluginPopoverProps) {
    const open = (params: Record<string, string>) => { props.close(); props.openScreen({ screenId: "presets", params }); };
    return (
      <ScrollView style={{ maxHeight: 480 }}>
        <PresetList {...props} onOpen={(workspaceId) => open({ workspaceId, nonce: String(Date.now()) })} />
        <Pressable accessibilityRole="button" onPress={() => open({})} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
          <Text style={{ color: props.theme.colors.foregroundMuted, fontSize: 13 }}>Open as a screen</Text>
        </Pressable>
      </ScrollView>
    );
  }

  function PresetsScreen({ params, navigation, ...props }: PluginScreenProps) {
    const pending = params.workspaceId && params.nonce ? `${params.workspaceId}:${params.nonce}` : null;
    useEffect(() => {
      if (!pending || !navigation || consumedOpens.has(pending)) return;
      // Not during the commit that mounts this screen: the app's navigation ref can still be null then.
      const timer = setTimeout(() => {
        if (consumedOpens.has(pending)) return;
        consumedOpens.add(pending);
        navigation.openWorkspace({ workspaceId: params.workspaceId as string });
      }, 0);
      return () => clearTimeout(timer);
    }, [pending, navigation]);
    return (
      <ScrollView style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }} contentContainerStyle={{ paddingVertical: 6 }}>
        <PresetList {...props} onOpen={(workspaceId) => navigation?.openWorkspace({ workspaceId })} />
      </ScrollView>
    );
  }

  function SidebarItem({ openPopover, currentScreen }: PluginSidebarItemProps) {
    return <SidebarRow icon="ListFilter" label="Presets" active={currentScreen?.screenId === "presets"} onPress={() => openPopover(Sheet)} />;
  }

  const screen = client.addScreen({ id: "presets", title: "Presets", Component: PresetsScreen });
  const item = client.addSidebarHeaderItem({ id: "presets", title: "Filter presets", Component: SidebarItem });
  return () => {
    item();
    screen();
  };
}
