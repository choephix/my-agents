import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginPopoverProps, PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, SidebarRow, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { Entry, Kind } from "../shared/inbox";
import type { Inbox } from "./inbox";

export const OPEN_SCREEN = "open";

const KIND_LABEL: Record<Kind, string | null> = { finished: null, error: "Error", permission: "Needs permission" };

function kindColor(kind: Kind, colors: PluginTheme["colors"]): string {
  if (kind === "error") return colors.statusDanger;
  if (kind === "permission") return colors.statusWarning;
  return colors.accent;
}

function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Plugins can open an agent only from a screen's `navigation`, so a press in the popover passes
 * through this blank screen, which opens the agent once per nonce and is replaced by it.
 */
export function createOpenScreen() {
  const opened = new Set<string>();
  return function OpenAgent({ params, navigation, theme }: PluginScreenProps) {
    const { agentId, nonce } = params;
    useEffect(() => {
      if (!agentId || !nonce || !navigation || opened.has(nonce)) return;
      // Not in the commit that mounts this screen: the app's navigation ref is null then.
      const timer = setTimeout(() => {
        if (opened.has(nonce)) return;
        opened.add(nonce);
        navigation.openAgent({ agentId });
      }, 0);
      return () => clearTimeout(timer);
    }, [agentId, nonce, navigation]);
    return <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }} />;
  };
}

export function createInboxUi(inbox: Inbox) {
  const useInbox = () => useSyncExternalStore(inbox.subscribe, inbox.getSnapshot);

  function Row({ entry, title, now, theme, onOpen, onClear }: {
    entry: Entry;
    title: string;
    now: number;
    theme: PluginTheme;
    onOpen(): void;
    onClear(): void;
  }) {
    const { colors } = theme;
    const label = KIND_LABEL[entry.kind];
    return (
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${title}`}
          onPress={onOpen}
          style={({ hovered }: { pressed: boolean; hovered?: boolean }) => ({
            flex: 1,
            flexDirection: "row",
            gap: 8,
            paddingVertical: 8,
            paddingLeft: 12,
            paddingRight: 4,
            borderRadius: 6,
            backgroundColor: hovered ? colors.surface2 : "transparent",
          })}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 6, backgroundColor: entry.read ? "transparent" : kindColor(entry.kind, colors) }} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontWeight: entry.read ? "400" : "600", color: entry.read ? colors.foregroundMuted : colors.foreground }}>
                {title}
              </Text>
              {label ? <Text style={{ fontSize: 11, color: kindColor(entry.kind, colors) }}>{label}</Text> : null}
              <Text style={{ marginLeft: "auto", fontSize: 11, color: colors.foregroundMuted }}>{ago(entry.at, now)}</Text>
            </View>
            {entry.preview ? (
              <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 17, color: colors.foregroundMuted }}>
                {entry.preview}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Remove" hitSlop={6} onPress={onClear} style={{ padding: 8, paddingTop: 10 }}>
          <Icon name="X" size={13} color={colors.foregroundMuted} />
        </Pressable>
      </View>
    );
  }

  function Popover({ theme, layout, close, openScreen }: PluginPopoverProps) {
    const { entries, titles } = useInbox();
    const toast = useToast();
    const { colors } = theme;
    // Fresh previews and times each time it opens; nothing ticks while it is open.
    useEffect(() => {
      inbox.refetch().catch((error: unknown) => console.error("[noice-inbox] loading the list failed", error));
    }, []);
    const now = useMemo(() => Date.now(), [entries]);
    const fail = (error: unknown) => toast.error(`Couldn't update the list: ${error instanceof Error ? error.message : String(error)}`);
    return (
      <View style={{ width: layout.compact ? undefined : 380, paddingVertical: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 12, paddingVertical: 6 }}>
          {/* The bottom sheet already carries the item's title. */}
          {layout.compact ? null : <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: colors.foreground }}>Notifications</Text>}
          {entries.length > 0 ? (
            <Pressable accessibilityRole="button" hitSlop={6} onPress={() => inbox.clear().catch(fail)}>
              <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>Clear all</Text>
            </Pressable>
          ) : null}
        </View>
        {entries.length === 0 ? (
          <Text style={{ paddingHorizontal: 12, paddingVertical: 16, fontSize: 12, color: colors.foregroundMuted }}>
            Nothing yet. Finished turns, errors and permission requests land here.
          </Text>
        ) : (
          <ScrollView style={{ maxHeight: layout.compact ? undefined : 520 }} contentContainerStyle={{ paddingHorizontal: 4 }}>
            {entries.map((entry) => (
              <Row
                key={`${entry.agentId}:${entry.kind}`}
                entry={entry}
                title={titles.get(entry.agentId) || entry.title || "Untitled agent"}
                now={now}
                theme={theme}
                onOpen={() => {
                  if (!entry.read) inbox.markRead([entry]).catch(fail);
                  close();
                  openScreen({ screenId: OPEN_SCREEN, params: { agentId: entry.agentId, nonce: `${Date.now()}` } });
                }}
                onClear={() => inbox.clear([entry]).catch(fail)}
              />
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  function SidebarItem({ theme, openPopover }: PluginSidebarItemProps) {
    const { unread } = useInbox();
    return (
      <SidebarRow
        icon="Bell"
        label="Notifications"
        onPress={() => openPopover(Popover)}
        trailing={unread > 0 ? (
          <View style={{ minWidth: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: theme.colors.accent, alignItems: "center" }}>
            <Text style={{ fontSize: 11, lineHeight: 18, fontWeight: "600", color: theme.colors.accentForeground }}>{unread}</Text>
          </View>
        ) : undefined}
      />
    );
  }

  return { SidebarItem };
}
