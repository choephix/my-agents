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

/** Space after each thread: between one thread and the next, and under the last one above the composer. */
const THREAD_GAP = 80;
/** The answer preview's height (~5 lines). */
const PREVIEW = 92;

/** Eight stepped strips of the background under a cut preview: a fade that needs no gradient library. */
function Fade({ background }: { background: string }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 32 }}>
      {Array.from({ length: 8 }, (_, index) => (
        <View key={index} style={{ position: "absolute", left: 0, right: 0, bottom: index * 4, height: 5, backgroundColor: background, opacity: 1 - index / 8 }} />
      ))}
    </View>
  );
}

/**
 * The answer cut to a few lines and a footer; one press target. In the hub Paseo draws your message
 * above it; folded days (`question`) draw it here.
 */
export function ThreadBlock({ thread, theme, actions, question }: { thread: Thread; theme: PluginTheme; actions: ThreadActions; question?: boolean }) {
  const { colors } = theme;
  const live = thread.status === "running" || thread.status === "queued";
  const [hover, setHover] = useState(false);
  /** The answer runs past the preview: its last lines fade out instead of being cut mid-line. */
  const [cut, setCut] = useState(false);
  const muted = { color: colors.foregroundMuted, fontSize: 13 };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={live ? `Open thread ${thread.title}` : `Read ${thread.unread ? "new " : ""}thread ${thread.title}`}
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
          <View style={{ maxHeight: PREVIEW, overflow: "hidden", paddingHorizontal: 8, alignItems: "flex-start" }} pointerEvents="none">
            <View onLayout={event => setCut(event.nativeEvent.layout.height > PREVIEW)}>
              <Markdown>{thread.answer}</Markdown>
            </View>
            {/* The stream is surface0 (Paseo's agent-stream container); a hovered block is surface1. */}
            {cut ? <Fade background={hover ? colors.surface1 : colors.surface0} /> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 }}>
          {/* Unread: a green dot where the ↳ sits, so it shows at a glance down the hub. */}
          {thread.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, marginHorizontal: 2, backgroundColor: colors.statusSuccess }} /> : <Text style={muted}>↳</Text>}
          {thread.status === "failed" ? <Text style={{ ...muted, color: colors.statusDanger }}>failed</Text> : null}
          {thread.status === "stopped" ? <Text style={muted}>stopped</Text> : null}
          {thread.followUps ? <Text style={muted}>{thread.followUps} follow-up{thread.followUps === 1 ? "" : "s"}</Text> : null}
          {thread.unread ? <Text style={{ ...muted, color: colors.statusSuccess, fontWeight: "600" }}>new</Text> : null}
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
  /** A hub turn has no Paseo turn footer to close it: the block's own gap separates threads and clears the composer under the last. */
  function ThreadRow({ item, theme }: PluginTimelineItemProps<Thread>) {
    return <View style={{ paddingBottom: THREAD_GAP }}><ThreadBlock thread={item.data} theme={theme} actions={actions} /></View>;
  }

  /** "Yesterday · 480 threads · 2 new"; opens in place, loading that day only then. */
  function DayRow({ item, theme }: PluginTimelineItemProps<Day>) {
    const { colors } = theme;
    const [threads, setThreads] = useState<Thread[] | "loading" | "failed" | null>(null);
    const expanded = Array.isArray(threads);
    const toggle = () => {
      if (expanded) return setThreads(null);
      setThreads("loading");
      actions.day(item.data.botId, item.data.day).then(setThreads, () => setThreads("failed"));
    };
    // Reading one of its threads redraws the divider: an open day reloads so its blocks follow.
    useEffect(() => {
      if (expanded) actions.day(item.data.botId, item.data.day).then(setThreads, () => {});
    }, [item.data.unread, item.data.count]);
    return (
      <View style={{ gap: 4 }}>
        <Pressable accessibilityRole="button" onPress={toggle} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
            {item.data.label} · {item.data.count} thread{item.data.count === 1 ? "" : "s"}
            {item.data.unread ? <Text style={{ color: colors.statusSuccess, fontWeight: "600" }}> · {item.data.unread} new</Text> : null} {expanded ? "▴" : "▾"}
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        </Pressable>
        {threads === "loading" ? <ActivityIndicator color={colors.foregroundMuted} /> : null}
        {threads === "failed" ? <Text style={{ color: colors.statusDanger, fontSize: 12, textAlign: "center" }}>Couldn't load this day. Press the divider to try again.</Text> : null}
        {expanded ? (
          <View style={{ gap: THREAD_GAP, paddingTop: 12, paddingBottom: THREAD_GAP }}>
            {threads.map(thread => <ThreadBlock key={thread.id} thread={thread} theme={theme} actions={actions} question />)}
          </View>
        ) : null}
      </View>
    );
  }

  return { ThreadRow, DayRow };
}
