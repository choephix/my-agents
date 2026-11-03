import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import type { Thread } from "../shared/contracts";
import { readThread, ReadingHost, useReading } from "./reading";

// The sizes of a thread row: the "Overlap" mock (bots-hub-mocks, variant A).
/** Space between one thread and the next, Paseo's own gap between rows included. */
const THREAD_GAP = 28;
/** Paseo's gap between two rows of the stream (`getGapBetweenStreamItems`); none under the last row. */
const STREAM_GAP = 16;
/** How far your question reaches down over the answer card's top edge: the question's own padding. */
const OVERLAP = 16;
/** The answer card's corners; your question also stays this far inside the card's left and right edges. */
const CARD_RADIUS = 16;
/** The card's left and right padding. */
const CARD_PAD = 16;
/** The card's bottom padding, and its top padding under the question's overlap. */
const CARD_PAD_Y = 12;
/** Between the card's lines: title, status, answer, footer. */
const CARD_GAP = 10;
/** Your question: Paseo's user bubble (padding, corners with the top-right one small, its text size and web line height). */
const BUBBLE_PAD = 16;
const BUBBLE_RADIUS = 16;
const BUBBLE_TAIL_RADIUS = 2;
const BUBBLE_FONT = 15;
const BUBBLE_LINE = 21;
/** The question's colour: the card's (`surface2`) with this much of the text colour, near Paseo's own bubble (`surface3`, which plugins don't get). */
const BUBBLE_MIX = 0.12;
/** A settled line at rest: very faint; full strength while hovered or pressed. */
const SETTLED_OPACITY = 0.3;
/** The answer preview's height (~7 lines). The top ~2 stay solid; the rest is the fade. */
const PREVIEW = 150;
/** How far up from a cut preview's bottom edge the answer fades out: about four lines, starting on the line before. */
const FADE = 96;

export interface ThreadActions {
  /** Running or up (its chat tab exists): its chat. Asleep: `read()`, its saved copy in the 🌙 modal. */
  open(thread: Thread, read: () => void): void;
  /** The 🌙 modal's Wake: restores the thread and opens its chat. */
  wake(id: string): Promise<void>;
  /** Done with a finished thread (one faint line in the hub), or its full block back. */
  settle(thread: Thread, settled: boolean): void;
  /** A block was drawn: Paseo's row of its question goes, as the block draws the question itself. */
  drawn(thread: Thread): void;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const elapsed = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const HEX = /^#[0-9a-f]{6}$/i;
/** `base` with `amount` of `other`; `base` itself unless both are #rrggbb. */
function mix(base: string, other: string, amount: number): string {
  if (!HEX.test(base) || !HEX.test(other)) return base;
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  return `#${[1, 3, 5].map(at => Math.round(channel(base, at) * (1 - amount) + channel(other, at) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/** Ticks once a second while mounted; only running blocks mount it. */
function Elapsed({ since, color }: { since: number; color: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <Text style={{ color, fontSize: 13 }}>running {elapsed(now - since)}</Text>;
}

/** Web: the cut preview's text itself fades out, whatever the background behind it. */
const webMask = { maskImage: `linear-gradient(to bottom, #000 calc(100% - ${FADE}px), transparent)` } as object;
/** Web: the card is a `<button>`, whose text the browser centres; the answer reads from the left. */
const webLeft = { textAlign: "left" } as object;
/** Web: Paseo's user message line height and wrapping. */
const webQuestion = { lineHeight: BUBBLE_LINE, overflowWrap: "anywhere" } as object;
/**
 * Web: your question's markers. `data-noice-user-text` on the bubble means "text you wrote", without
 * Paseo's `user-message`, which other plugins read as a chat turn; noice-chat-message-polish,
 * noice-omp-magic-keywords and noice-chat-diff style what it holds. `data-message-text` is Paseo's
 * own mark for message text (Chat Find searches it).
 */
const userTextMark = { dataSet: { noiceUserText: "true" } } as object;
const messageTextMark = { dataSet: { messageText: "true" } } as object;

/** Native has no mask: a gradient into the card's colour is painted over the cut preview. */
function Fade({ background }: { background: string }) {
  // The background at zero alpha, so the gradient doesn't pass through grey on its way from "transparent".
  const clear = HEX.test(background) ? `${background}00` : "transparent";
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: FADE, experimental_backgroundImage: `linear-gradient(to bottom, ${clear}, ${background})` }}
    />
  );
}

/** A small text button inside a block: its press doesn't open the block. */
function InlineButton({ label, title, theme, onPress }: { label: string; title: string; theme: PluginTheme; onPress(): void }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} hitSlop={10} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}>
      <Text style={{ color: hover ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/** A settled thread: one faint line, no gap after it, so settled threads stack as a list. Pressing it opens the thread; Unsettle brings the block back. */
function SettledRow({ thread, theme, actions, onOpen }: { thread: Thread; theme: PluginTheme; actions: ThreadActions; onOpen(): void }) {
  const { colors } = theme;
  const [hover, setHover] = useState(false);
  const muted = { color: colors.foregroundMuted, fontSize: 13 };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Read settled thread ${thread.title}`}
      onPress={onOpen}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3, paddingHorizontal: 16, borderRadius: 8,
        opacity: hover || pressed ? 1 : SETTLED_OPACITY, backgroundColor: hover ? colors.surface1 : "transparent",
      })}
    >
      <Text style={muted}>✓</Text>
      <Text numberOfLines={1} style={{ ...muted, flexShrink: 1 }}>{thread.title}</Text>
      <Text style={{ ...muted, flexShrink: 0 }}>· {clock(thread.endedAt ?? thread.createdAt)}</Text>
      <View style={{ flex: 1 }} />
      <InlineButton label="Unsettle" title={`Unsettle thread ${thread.title}`} theme={theme} onPress={() => actions.settle(thread, false)} />
    </Pressable>
  );
}

/** Your question, on the answer card's top edge: drawn above the card (the earlier sibling, raised), which moves up under it. */
function Question({ text, theme }: { text: string; theme: PluginTheme }) {
  const { colors } = theme;
  return (
    <View
      {...userTextMark}
      style={{
        alignSelf: "flex-end", marginHorizontal: CARD_RADIUS, zIndex: 1, padding: BUBBLE_PAD, minWidth: 0,
        borderRadius: BUBBLE_RADIUS, borderTopRightRadius: BUBBLE_TAIL_RADIUS, backgroundColor: mix(colors.surface2, colors.foreground, BUBBLE_MIX),
      }}
    >
      <Text {...messageTextMark} selectable style={[{ color: colors.foreground, fontSize: BUBBLE_FONT }, Platform.OS === "web" ? webQuestion : null]}>{text}</Text>
    </View>
  );
}

/** The answer card: the answer cut to a few lines and a footer; one press target. `asked`: your question sits on its top edge. */
function ThreadCard({ thread, theme, actions, onOpen, asked }: { thread: Thread; theme: PluginTheme; actions: ThreadActions; onOpen(): void; asked: boolean }) {
  const { colors } = theme;
  const live = thread.status === "running" || thread.status === "queued";
  const [hover, setHover] = useState(false);
  /** The answer runs past the preview: its last lines fade out instead of being cut mid-line. */
  const [cut, setCut] = useState(false);
  const muted = { color: colors.foregroundMuted, fontSize: 13 };
  const attached = thread.files?.length ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={live ? `Open thread ${thread.title}` : `Read ${thread.unread ? "new " : ""}thread ${thread.title}`}
      onPress={onOpen}
      disabled={thread.status === "queued"}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={{
        marginTop: asked ? -OVERLAP : 0, gap: CARD_GAP, borderRadius: CARD_RADIUS, backgroundColor: colors.surface2,
        paddingTop: (asked ? OVERLAP : 0) + CARD_PAD_Y, paddingBottom: CARD_PAD_Y, paddingHorizontal: CARD_PAD,
      }}
    >
      {/* A title the thread chose; until then your question says what it's about. */}
      {thread.named ? <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{thread.title}</Text> : null}
      {live ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
          <View style={[{ maxHeight: PREVIEW, overflow: "hidden", alignItems: "flex-start" }, Platform.OS === "web" ? webLeft : null, cut && Platform.OS === "web" ? webMask : null]} pointerEvents="none">
            <View onLayout={event => setCut(event.nativeEvent.layout.height > PREVIEW)}>
              <Markdown>{thread.answer}</Markdown>
            </View>
            {cut && Platform.OS !== "web" ? <Fade background={colors.surface2} /> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {/* Unread: a green dot where the ↳ sits, so it shows at a glance down the hub. */}
          {thread.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, marginHorizontal: 2, backgroundColor: colors.statusSuccess }} /> : <Text style={muted}>↳</Text>}
          {thread.status === "failed" ? <Text style={{ ...muted, color: colors.statusDanger }}>failed</Text> : null}
          {thread.status === "stopped" ? <Text style={muted}>stopped</Text> : null}
          {thread.followUps ? <Text style={muted}>{thread.followUps} follow-up{thread.followUps === 1 ? "" : "s"}</Text> : null}
          {thread.unread ? <Text style={{ ...muted, color: colors.statusSuccess, fontWeight: "600" }}>new</Text> : null}
          <Text style={muted}>{thread.followUps || thread.unread || thread.status !== "done" ? "· " : ""}{clock(thread.endedAt ?? thread.createdAt)}</Text>
          {attached ? <Text style={muted}>· 📎 {attached} attached</Text> : null}
          {thread.readOnly ? <Text style={muted}>· read-only</Text> : null}
          <View style={{ flex: 1 }} />
          <InlineButton label="Settle" title={`Settle thread ${thread.title}`} theme={theme} onPress={() => actions.settle(thread, true)} />
          <Text style={{ ...muted, marginLeft: 8 }}>Read ›</Text>
        </View>
      </>}
      {/* Hovered: an outline inside the card, so nothing moves. */}
      {hover && thread.status !== "queued" ? (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: CARD_RADIUS, borderWidth: 1, borderColor: colors.border }} />
      ) : null}
    </Pressable>
  );
}

export function createHubRows(actions: ThreadActions) {
  /** Your question on its answer card. A hub turn has no Paseo turn footer to close it: the row's own space, with Paseo's 16 px under the stream, clears the composer under the last. */
  function ThreadRow({ item, theme, layout }: PluginTimelineItemProps<Thread>) {
    const thread = item.data;
    useEffect(() => actions.drawn(thread), [thread.questionId]);
    const open = useReading() === thread.id;
    const onOpen = () => actions.open(thread, () => readThread(thread.id));
    // Hosts the modal only while it's this thread's, in case no sidebar strip is there to.
    const saved = open ? <ReadingHost theme={theme} compact={layout.compact} wake={actions.wake} /> : null;
    if (thread.settled) return <>{saved}<SettledRow thread={thread} theme={theme} actions={actions} onOpen={onOpen} /></>;
    // A message with only attachments has no text to show; the footer counts them.
    const asked = thread.question !== "";
    return (
      <View style={{ paddingBottom: THREAD_GAP - STREAM_GAP }}>
        {saved}
        {asked ? <Question text={thread.question} theme={theme} /> : null}
        <ThreadCard thread={thread} theme={theme} actions={actions} onOpen={onOpen} asked={asked} />
      </View>
    );
  }
  return { ThreadRow };
}
