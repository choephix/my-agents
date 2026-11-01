import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { Day, Thread } from "../shared/contracts";

export interface ThreadActions {
  /** Finished: its 🌙 read tab. Running or queued: its chat. */
  open(thread: Thread): void;
  day(botId: string, day: string): Promise<Thread[]>;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const elapsed = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Ticks once a second while mounted; only running blocks mount it. */
function Elapsed({ since, color }: { since: number; color: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <Text style={{ color, fontSize: 13 }}>running {elapsed(now - since)}</Text>;
}

/**
 * The answer cut to a few lines and a footer; one press target. In the hub Paseo draws your message
 * above it; folded days (`question`) draw it here.
 */
export function ThreadBlock({ thread, theme, actions, question }: { thread: Thread; theme: PluginTheme; actions: ThreadActions; question?: boolean }) {
  const { colors } = theme;
  const live = thread.status === "running" || thread.status === "queued";
  const [hover, setHover] = useState(false);
  const muted = { color: colors.foregroundMuted, fontSize: 13 };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={live ? `Open thread ${thread.title}` : `Read thread ${thread.title}`}
      onPress={() => actions.open(thread)}
      disabled={thread.status === "queued"}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={{ gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, backgroundColor: hover && thread.status !== "queued" ? colors.surface1 : "transparent" }}
    >
      {question ? (
        <View style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: colors.surface2, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 }}>
          <Text numberOfLines={6} style={{ color: colors.foreground, fontSize: 15, lineHeight: 21 }}>{thread.question}</Text>
        </View>
      ) : null}
      {/* A title the thread chose; until then your message above says what it's about. */}
      {thread.named ? <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", paddingHorizontal: 8 }}>{thread.title}</Text> : null}
      {live ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 }}>
          {thread.status === "queued" ? <Text style={muted}>queued</Text> : <>
            <ActivityIndicator size="small" color={colors.foregroundMuted} />
            {thread.startedAt ? <Elapsed since={thread.startedAt} color={colors.foregroundMuted} /> : null}
            {thread.note ? <Text numberOfLines={1} style={{ ...muted, flexShrink: 1, opacity: 0.8 }}>· {thread.note}</Text> : null}
          </>}
          <View style={{ flex: 1 }} />
          {thread.status === "running" ? <Text style={muted}>Open ›</Text> : null}
        </View>
      ) : <>
        {thread.answer ? (
          <View style={{ maxHeight: 92, overflow: "hidden", paddingHorizontal: 8, alignItems: "flex-start" }} pointerEvents="none">
            <Markdown>{thread.answer}</Markdown>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 }}>
          <Text style={muted}>↳</Text>
          {thread.status === "failed" ? <Text style={{ ...muted, color: colors.statusDanger }}>failed</Text> : null}
          {thread.status === "stopped" ? <Text style={muted}>stopped</Text> : null}
          {thread.followUps ? <Text style={muted}>{thread.followUps} follow-up{thread.followUps === 1 ? "" : "s"}</Text> : null}
          {thread.unread ? <Text style={{ ...muted, color: colors.statusSuccess }}>new</Text> : null}
          <Text style={muted}>{thread.followUps || thread.unread || thread.status !== "done" ? "· " : ""}{clock(thread.endedAt ?? thread.createdAt)}</Text>
          {thread.readOnly ? <Text style={muted}>· read-only</Text> : null}
          <View style={{ flex: 1 }} />
          <Text style={muted}>Read ›</Text>
        </View>
      </>}
    </Pressable>
  );
}

export function createHubRows(actions: ThreadActions) {
  function ThreadRow({ item, theme }: PluginTimelineItemProps<Thread>) {
    return <ThreadBlock thread={item.data} theme={theme} actions={actions} />;
  }

  /** "Yesterday · 480 threads"; opens in place, loading that day only then. */
  function DayRow({ item, theme }: PluginTimelineItemProps<Day>) {
    const { colors } = theme;
    const [threads, setThreads] = useState<Thread[] | "loading" | "failed" | null>(null);
    const toggle = () => {
      if (Array.isArray(threads)) return setThreads(null);
      setThreads("loading");
      actions.day(item.data.botId, item.data.day).then(setThreads, () => setThreads("failed"));
    };
    return (
      <View style={{ gap: 4 }}>
        <Pressable accessibilityRole="button" onPress={toggle} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
            {item.data.label} · {item.data.count} thread{item.data.count === 1 ? "" : "s"} {Array.isArray(threads) ? "▴" : "▾"}
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        </Pressable>
        {threads === "loading" ? <ActivityIndicator color={colors.foregroundMuted} /> : null}
        {threads === "failed" ? <Text style={{ color: colors.statusDanger, fontSize: 12, textAlign: "center" }}>Couldn't load this day. Press the divider to try again.</Text> : null}
        {Array.isArray(threads) ? threads.map(thread => <ThreadBlock key={thread.id} thread={thread} theme={theme} actions={actions} question />) : null}
      </View>
    );
  }

  return { ThreadRow, DayRow };
}
