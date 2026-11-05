import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginPopoverProps, PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, SidebarRow, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import type { Entry, Kind } from "../shared/inbox";
import type { Inbox } from "./inbox";

export const OPEN_SCREEN = "open";

const KIND_LABEL: Record<Kind, string | null> = { finished: null, error: "Error", permission: "Needs permission" };

/**
 * Paseo pads its popover by ~13 px; a row's hover background reaches this far into that padding.
 * Text sits `INDENT` in from the padding, leaving the unread dot room to hang left of the title.
 */
const GUTTER = 10;
const INDENT = 4;
/** The right slot holding a row's time, or its × while hovered. */
const SLOT_WIDTH = 24;
/** Extra room for the × beside the time on phones. */
const REMOVE_WIDTH = 20;

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

  function Row({ entry, title, now, theme, compact, onOpen, onClear }: {
    entry: Entry;
    title: string;
    now: number;
    theme: PluginTheme;
    compact: boolean;
    onOpen(): void;
    onClear(): void;
  }) {
    // RN-web Pressables contain their hover, so a parent can't see it: the row and its × each report theirs.
    const [rowHovered, setRowHovered] = useState(false);
    const [removeHovered, setRemoveHovered] = useState(false);
    const hovered = rowHovered || removeHovered;
    const { colors } = theme;
    const label = KIND_LABEL[entry.kind];
    const accent = kindColor(entry.kind, colors);
    // Phones have no hover, so there the time and the × sit side by side.
    const slotWidth = compact ? SLOT_WIDTH + REMOVE_WIDTH : SLOT_WIDTH;
    const time = <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>{ago(entry.at, now)}</Text>;
    const remove = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${title}`}
        hitSlop={8}
        onHoverIn={() => setRemoveHovered(true)}
        onHoverOut={() => setRemoveHovered(false)}
        onPress={onClear}
      >
        <Icon name="X" size={13} color={colors.foregroundMuted} />
      </Pressable>
    );
    return (
      <View style={{ marginHorizontal: -GUTTER }}>
        <Pressable
          onHoverIn={() => setRowHovered(true)}
          onHoverOut={() => setRowHovered(false)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${title}`}
          onPress={onOpen}
          style={{
            paddingVertical: 7,
            paddingLeft: GUTTER + INDENT,
            paddingRight: GUTTER + slotWidth,
            borderRadius: 6,
            gap: 2,
            backgroundColor: hovered ? colors.surface2 : "transparent",
          }}
        >
          {/* Hangs in the gutter, so read and unread titles line up. */}
          {entry.read ? null : <View style={{ position: "absolute", left: 4, top: 13, width: 5, height: 5, borderRadius: 2.5, backgroundColor: accent }} />}
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: entry.read ? "400" : "600", color: entry.read ? colors.foregroundMuted : colors.foreground }}>
              {title}
            </Text>
            {label ? <Text style={{ fontSize: 11, color: entry.read ? colors.foregroundMuted : accent }}>{label}</Text> : null}
          </View>
          {entry.preview ? (
            <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 17, color: colors.foregroundMuted, opacity: entry.read ? 0.75 : 1 }}>
              {entry.preview}
            </Text>
          ) : null}
        </Pressable>
        {/* On desktop the time and the × share one slot: the × replaces the time while the row is hovered. */}
        <View style={{ position: "absolute", top: 7, right: GUTTER, width: slotWidth, height: 18, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
          {compact ? <>{time}{remove}</> : hovered ? remove : time}
        </View>
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
      <View style={{ width: layout.compact ? undefined : 340 }}>
        {entries.length === 0 ? (
          <Text style={{ paddingVertical: 8, paddingLeft: INDENT, fontSize: 12, lineHeight: 17, color: colors.foregroundMuted }}>
            No notifications. Finished turns, errors and permission requests show up here.
          </Text>
        ) : (
          <>
            {entries.map((entry) => (
              <Row
                key={`${entry.agentId}:${entry.kind}`}
                entry={entry}
                title={titles.get(entry.agentId) || entry.title || "Untitled agent"}
                now={now}
                theme={theme}
                compact={layout.compact}
                onOpen={() => {
                  if (!entry.read) inbox.markRead([entry]).catch(fail);
                  close();
                  openScreen({ screenId: OPEN_SCREEN, params: { agentId: entry.agentId, nonce: `${Date.now()}` } });
                }}
                onClear={() => inbox.clear([entry]).catch(fail)}
              />
            ))}
            <View style={{ borderTopWidth: 1, borderColor: colors.border, marginTop: 4, paddingTop: 8, paddingLeft: INDENT, flexDirection: "row" }}>
              <Pressable accessibilityRole="button" hitSlop={6} onPress={() => inbox.clear().catch(fail)}>
                <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>Clear all</Text>
              </Pressable>
            </View>
          </>
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
