import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import type { Thread } from "../shared/contracts";

export interface ThreadActions {
  /** Finished: its 🌙 read tab. Running or queued: its chat. */
  open(thread: Thread): void;
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
const PREVIEW = 112;
/** How far up from a cut preview's bottom edge the answer fades out: about two lines. */
const FADE = 56;
/** Web: the cut preview's text itself fades out, whatever the background behind it. */
const webMask = { maskImage: `linear-gradient(to bottom, #000 calc(100% - ${FADE}px), transparent)` } as object;

/** Native has no mask: a gradient into the background colour is painted over the cut preview. */
function Fade({ background }: { background: string }) {
  // The background at zero alpha, so the gradient doesn't pass through grey on its way from "transparent".
  const clear = /^#[0-9a-f]{6}$/i.test(background) ? `${background}00` : "transparent";
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: FADE, experimental_backgroundImage: `linear-gradient(to bottom, ${clear}, ${background})` }}
    />
  );
}

/** The answer cut to a few lines and a footer; one press target. Paseo draws your message above it. */
function ThreadBlock({ thread, theme, actions }: { thread: Thread; theme: PluginTheme; actions: ThreadActions }) {
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
          <View style={[{ maxHeight: PREVIEW, overflow: "hidden", paddingHorizontal: 8, alignItems: "flex-start" }, cut && Platform.OS === "web" ? webMask : null]} pointerEvents="none">
            <View onLayout={event => setCut(event.nativeEvent.layout.height > PREVIEW)}>
              <Markdown>{thread.answer}</Markdown>
            </View>
            {/* The stream is surface0 (Paseo's agent-stream container); a hovered block is surface1. */}
            {cut && Platform.OS !== "web" ? <Fade background={hover ? colors.surface1 : colors.surface0} /> : null}
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
  return { ThreadRow };
}
