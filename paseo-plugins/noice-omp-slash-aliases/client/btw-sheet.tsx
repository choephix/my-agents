import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { type ComponentType, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import type { BtwEntry } from "../shared/btw";
import { type BtwStore, type ChatState, formatDuration, formatElapsed, isBusy, type PendingAsk } from "./btw-store";
import { plainText } from "./markdown";
import { BODY, MarkdownView, UI_FONT } from "./markdown-view";

export const BTW_ICON = "MessageCircleQuestion";

/** Strip text (status, time, header line). */
const SMALL = { fontSize: 12, lineHeight: 16, fontFamily: UI_FONT };

/**
 * Web only: a long open card keeps its question strip at the top of the sheet and its
 * status/actions strip at the bottom while you scroll through the answer. Native
 * clients have no sticky positioning, so there the strips scroll with the card.
 * -1: the scroll area can sit on a fractional pixel, which let a sliver of text show past the strip.
 */
const STICK_TOP = Platform.OS === "web" ? ({ position: "sticky", top: -1, zIndex: 1 } as unknown as ViewStyle) : null;
const STICK_BOTTOM =
  Platform.OS === "web" ? ({ position: "sticky", bottom: -1, zIndex: 1 } as unknown as ViewStyle) : null;

/** One card: a record from OMP, or this client's ask that has no record yet. Newest first. */
type Row = { key: string; question: string; createdAt?: number } & (
  | { kind: "answer"; entry: BtwEntry }
  | { kind: "pending"; ask: PendingAsk }
);

function rows(chat: ChatState): Row[] {
  return [
    ...chat.pending.map((ask): Row => ({ key: ask.key, question: ask.question, kind: "pending", ask })),
    ...chat.entries.map(
      (entry): Row => ({ key: entry.id, question: entry.question, createdAt: entry.createdAt, kind: "answer", entry }),
    ),
  ];
}

function isRunning(row: Row): boolean {
  return row.kind === "pending" ? !row.ask.error : row.entry.status === "running";
}

/** The current time, ticking every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? now : Date.now();
}

export function IconButton({
  icon,
  label,
  onPress,
  onFocusChange,
  theme,
}: {
  icon: string;
  label: string;
  onPress(): void;
  onFocusChange?(focused: boolean): void;
  theme: PluginTheme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      hitSlop={4}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.iconButton,
        (pressed || hovered) && { backgroundColor: theme.colors.surface2 },
      ]}
    >
      {({ hovered }: { pressed: boolean; hovered?: boolean }) => (
        <Icon name={icon} size={13} color={hovered ? theme.colors.foreground : theme.colors.foregroundMuted} />
      )}
    </Pressable>
  );
}

function FoldedCard({ row, onOpen, theme }: { row: Row; onOpen(): void; theme: PluginTheme }) {
  const entry = row.kind === "answer" ? row.entry : undefined;
  const failure = row.kind === "pending" ? row.ask.error : entry?.error;
  const muted = theme.colors.foregroundMuted;
  const preview = failure ?? (entry?.answer ? plainText(entry.answer) : entry?.status === "cancelled" ? "Stopped" : "…");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show answer: ${row.question}`}
      onPress={onOpen}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.card,
        styles.folded,
        { borderColor: theme.colors.border, backgroundColor: hovered ? theme.colors.surface2 : theme.colors.surface0 },
      ]}
    >
      <View style={styles.chevron}>
        <Icon name="ChevronRight" size={12} color={muted} />
      </View>
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[BODY, { color: theme.colors.foreground }]}>
          {row.question}
        </Text>
        <Text numberOfLines={1} style={[SMALL, { color: failure ? theme.colors.statusDanger : muted }]}>
          {preview}
        </Text>
      </View>
      {row.createdAt ? (
        <Text style={[SMALL, styles.time, { color: muted }]}>
          {new Date(row.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
      ) : null}
    </Pressable>
  );
}

function OpenCard({
  row,
  onFold,
  touch,
  agentId,
  store,
  theme,
}: {
  row: Row;
  /** Absent when the card is the only one. */
  onFold?: () => void;
  /** Touch layouts always show Copy/Dismiss; pointer layouts on card hover or button focus. */
  touch: boolean;
  agentId: string;
  store: BtwStore;
  theme: PluginTheme;
}) {
  const toast = useToast();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [fullQuestion, setFullQuestion] = useState(false);
  const [clamped, setClamped] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const entry = row.kind === "answer" ? row.entry : undefined;
  const running = isRunning(row);
  const now = useNow(running);
  const answer = entry?.answer ?? "";
  const failure =
    row.kind === "pending"
      ? row.ask.error
      : (entry?.error ?? (entry?.status === "interrupted" ? "Interrupted: the OMP process stopped." : undefined));
  const muted = theme.colors.foregroundMuted;
  // One surface for the whole card; the strips are opaque so the sticky ones hide what scrolls under them.
  const surface = { backgroundColor: theme.colors.surface0, borderColor: theme.colors.border };

  async function copy() {
    try {
      await copyText(answer);
      setCopied(true);
    } catch {
      toast.error("Could not copy. Select the text and copy it instead.");
    }
  }
  function dismiss() {
    store.dismiss(agentId, row.key).catch(error => toast.error(`Could not dismiss: ${String(error)}`));
  }

  let status: ReactNode;
  if (running) {
    const phase = row.kind === "pending" ? "Sending…" : answer ? "Writing…" : "Thinking…";
    status = (
      <>
        <ActivityIndicator size={11} color={muted} />
        <Text style={[SMALL, { color: muted }]}>
          {phase} {formatElapsed(now - (row.kind === "pending" ? row.ask.sentAt : row.entry.createdAt))}
        </Text>
      </>
    );
  } else if (failure) {
    status = (
      <>
        <Icon name="CircleAlert" size={12} color={theme.colors.statusDanger} />
        <Text numberOfLines={2} style={[SMALL, styles.flex, { color: theme.colors.statusDanger }]}>
          {failure}
        </Text>
      </>
    );
  } else if (entry?.status === "complete") {
    status = (
      <>
        <Icon name="Check" size={12} color={muted} />
        <Text style={[SMALL, { color: muted }]}>Answered in {formatDuration(entry.updatedAt - entry.createdAt)}</Text>
      </>
    );
  } else {
    status = <Text style={[SMALL, { color: muted }]}>Stopped</Text>;
  }

  const showActions = touch || hovered || focused;
  return (
    <View
      style={[styles.card, surface]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <View style={[styles.header, STICK_TOP, surface]}>
        {onFold ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Fold" onPress={onFold} hitSlop={6} style={styles.chevron}>
            <Icon name="ChevronDown" size={12} color={muted} />
          </Pressable>
        ) : null}
        {/* Always the 2-line version, so the stuck strip stays small; the whole question opens below it.
            onTextLayout reports clamping on native only, so web goes by length. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fullQuestion ? "Shorten question" : "Show whole question"}
          disabled={!clamped && !fullQuestion && row.question.length < 90}
          onPress={() => setFullQuestion(full => !full)}
          style={styles.flex}
        >
          <Text
            numberOfLines={2}
            onTextLayout={event => setClamped(event.nativeEvent.lines.length > 2)}
            style={[BODY, { color: muted }]}
          >
            {row.question}
          </Text>
        </Pressable>
        {row.createdAt ? (
          <Text style={[SMALL, styles.time, { color: muted }]}>
            {new Date(row.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        ) : null}
      </View>
      {fullQuestion ? (
        <Text selectable style={[BODY, styles.fullQuestion, { color: muted, borderColor: theme.colors.border }]}>
          {row.question}
        </Text>
      ) : null}
      {answer ? (
        <View style={styles.body}>
          <MarkdownView source={answer} theme={theme} />
        </View>
      ) : null}
      <View style={[styles.footer, STICK_BOTTOM, surface, !answer && !fullQuestion && styles.footerAlone]}>
        <View style={styles.status}>{status}</View>
        {running ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop"
            onPress={dismiss}
            hitSlop={4}
            style={({ hovered: over }: { pressed: boolean; hovered?: boolean }) => [
              styles.stop,
              { borderColor: theme.colors.border, backgroundColor: over ? theme.colors.surface2 : theme.colors.surface1 },
            ]}
          >
            <Icon name="Square" size={10} color={theme.colors.foreground} />
            <Text style={[SMALL, { color: theme.colors.foreground }]}>Stop</Text>
          </Pressable>
        ) : (
          <View
            style={[styles.actions, { opacity: showActions ? 1 : 0 }]}
            pointerEvents={showActions ? "auto" : "box-none"}
          >
            {entry?.status === "complete" && answer ? (
              <IconButton
                icon={copied ? "Check" : "Copy"}
                label={copied ? "Copied" : "Copy answer"}
                onPress={() => void copy()}
                onFocusChange={setFocused}
                theme={theme}
              />
            ) : null}
            <IconButton icon="X" label="Dismiss" onPress={dismiss} onFocusChange={setFocused} theme={theme} />
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * The answer sheet. It is drawn with React Native's own `Modal`, not the plugin
 * `Modal`: the plugin one always renders Paseo's ~64 px title row (16 px padding
 * around a 32 px close button), and this sheet needs only one small line.
 */
function BtwSheet({ agentId, store, theme, touch }: { agentId: string; store: BtwStore; theme: PluginTheme; touch: boolean }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Cards the user opened or folded; the rest follow the default (newest and running ones open).
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const chat = snapshot.chats.get(agentId);
  const open = snapshot.openAgentId === agentId && !!chat;
  const list = chat ? rows(chat) : [];
  const toggle = (key: string, next: boolean) => setToggled(prev => new Map(prev).set(key, next));
  const muted = theme.colors.foregroundMuted;
  return (
    <Modal
      transparent
      visible={open}
      animationType={touch ? "slide" : "fade"}
      onRequestClose={() => store.close()}
      statusBarTranslucent
    >
      <View style={[styles.overlay, touch ? styles.overlayTouch : styles.overlayDesktop]}>
        <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={() => store.close()} />
        <View
          style={[
            styles.frame,
            touch ? styles.frameTouch : styles.frameDesktop,
            { backgroundColor: theme.colors.surface1, borderColor: theme.colors.border },
          ]}
        >
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={[SMALL, styles.flex, { color: muted }]}>
              <Text style={{ color: theme.colors.foreground }}>/btw</Text>
              {list.length > 1 ? ` · ${list.length}` : ""}
              {touch ? " · not added to the chat" : " · from this chat's memory, not added to it"}
            </Text>
            <IconButton icon="X" label="Close" onPress={() => store.close()} theme={theme} />
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {list.map((row, index) => {
              const expanded = toggled.get(row.key) ?? (index === 0 || isRunning(row));
              return expanded ? (
                <OpenCard
                  key={row.key}
                  row={row}
                  onFold={list.length > 1 ? () => toggle(row.key, false) : undefined}
                  touch={touch}
                  agentId={agentId}
                  store={store}
                  theme={theme}
                />
              ) : (
                <FoldedCard key={row.key} row={row} onOpen={() => toggle(row.key, true)} theme={theme} />
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The composer pill's icon. It also hosts the chat's answer sheet: the pill is
 * the plugin UI that lives in a chat's composer on every client, and /btw opens
 * the sheet without a press. With the chat in several panes, the first hosts it.
 */
export function createPillIcon(store: BtwStore): ComponentType<PluginButtonIconProps> {
  return function BtwPillIcon(props: PluginButtonIconProps) {
    const agentId = props.context === "agent" ? props.agentId : "";
    const token = useRef(Symbol(agentId)).current;
    useEffect(() => (agentId ? store.claimHost(agentId, token) : undefined), [agentId, token]);
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const chat = snapshot.chats.get(agentId);
    const touch = props.layout.compact || props.layout.platform !== "web";
    return (
      <>
        {chat && isBusy(chat) ? (
          <ActivityIndicator size={props.size} color={props.color} />
        ) : (
          <Icon name={BTW_ICON} size={props.size} color={props.color} />
        )}
        {agentId && store.isHost(agentId, token) ? (
          <BtwSheet agentId={agentId} store={store} theme={props.theme} touch={touch} />
        ) : null}
      </>
    );
  };
}

const RADIUS = 8;

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject },
  overlayDesktop: { justifyContent: "center", alignItems: "center", padding: 24 },
  overlayTouch: { justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  frame: { overflow: "hidden", borderWidth: 1 },
  frameDesktop: { width: "100%", maxWidth: 600, maxHeight: "88%", borderRadius: 12 },
  frameTouch: { maxHeight: "88%", borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomWidth: 0, paddingBottom: 16 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 6, paddingVertical: 4 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 8, paddingBottom: 8, gap: 6 },
  flex: { flex: 1, minWidth: 0 },
  // No overflow clipping: it would stop the strips from sticking. The strips round their own corners.
  card: { borderWidth: 1, borderRadius: RADIUS },
  folded: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 8, paddingVertical: 4 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: RADIUS - 1,
    borderTopRightRadius: RADIUS - 1,
  },
  fullQuestion: { paddingHorizontal: 10, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  chevron: { height: BODY.lineHeight, justifyContent: "center" },
  time: { lineHeight: BODY.lineHeight },
  body: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 24,
    paddingLeft: 8,
    paddingRight: 3,
    paddingVertical: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: RADIUS - 1,
    borderBottomRightRadius: RADIUS - 1,
  },
  footerAlone: { borderTopWidth: 0 },
  status: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  actions: { flexDirection: "row", alignItems: "center" },
  iconButton: { padding: 4, borderRadius: 6 },
  stop: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1 },
});
