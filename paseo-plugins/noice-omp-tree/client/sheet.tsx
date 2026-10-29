import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { type ComponentType, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { copyToClipboard } from "./clipboard";
import type { Branch, TreeState, Turn } from "../shared/tree";
import type { TreeStore } from "./store";

const UI_FONT = Platform.select({ web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" });
const SMALL = { fontSize: 12, lineHeight: 16, fontFamily: UI_FONT };
const BODY = { fontSize: 13, lineHeight: 18, fontFamily: UI_FONT };

function clock(ms: number | null): string {
  return ms === null ? "" : new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type Hover = { pressed: boolean; hovered?: boolean };

function TextButton({ label, onPress, theme, primary }: { label: string; onPress(): void; theme: PluginTheme; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed, hovered }: Hover) => [
        styles.textButton,
        primary
          ? { backgroundColor: theme.colors.foreground }
          : (pressed || hovered) && { backgroundColor: theme.colors.surface2 },
      ]}
    >
      <Text style={[BODY, { color: primary ? theme.colors.surface0 : theme.colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The "set aside" offer, for touch layouts and native apps (web desktop shows it as a strip above
 * the composer instead): Summarize them (optional focus) · Undo · ×, then progress.
 */
function OfferBlock({ agentId, state, store, theme, touch }: { agentId: string; state: TreeState; store: TreeStore; theme: PluginTheme; touch: boolean }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [focus, setFocus] = useState("");
  const muted = theme.colors.foregroundMuted;
  const starting = snapshot.starting.get(agentId);
  const summarizing = state.op?.phase === "summarizing" || (!state.op && starting === "summarize");
  const box = [styles.offer, { backgroundColor: theme.colors.surface0, borderColor: theme.colors.border }];
  if (summarizing) {
    return (
      <View style={box}>
        <View style={styles.row}>
          <ActivityIndicator size={12} color={muted} />
          <Text style={[BODY, styles.flex, { color: muted }]}>Summarizing what you left…</Text>
          <TextButton label="Cancel" onPress={() => void store.cancel(agentId)} theme={theme} />
        </View>
      </View>
    );
  }
  if (state.op || starting) {
    return (
      <View style={box}>
        <View style={styles.row}>
          <ActivityIndicator size={12} color={muted} />
          <Text style={[BODY, { color: muted }]}>Switching branch…</Text>
        </View>
      </View>
    );
  }
  if (snapshot.summarized.has(agentId)) {
    return (
      <View style={box}>
        <View style={styles.row}>
          <Icon name="Check" size={13} color={muted} />
          <Text style={[BODY, { color: muted }]}>Summary added at the branch point · the agent sees it</Text>
        </View>
      </View>
    );
  }
  if (!state.offer) return null;
  const what = `${state.offer.setAside} message${state.offer.setAside === 1 ? "" : "s"}`;
  if (state.offer.summarized) {
    return (
      <View style={box}>
        <View style={styles.row}>
          <Icon name="Check" size={13} color={muted} />
          <Text style={[BODY, styles.flex, { color: muted }]} numberOfLines={1}>{what} summarized{touch ? "" : " at the branch point"}</Text>
          <TextButton label="Undo" onPress={() => void store.goto(agentId, "undo")} theme={theme} />
          <Pressable accessibilityLabel="Dismiss" onPress={() => void store.dismiss(agentId)} hitSlop={6} style={styles.iconButton}>
            <Icon name="X" size={13} color={muted} />
          </Pressable>
        </View>
      </View>
    );
  }
  if (snapshot.focusOpen.has(agentId)) {
    return (
      <View style={[box, styles.column]}>
        <View style={styles.row}>
          <Icon name="Text" size={13} color={muted} />
          <Text style={[BODY, styles.flex, { color: muted }]}>Summarize the {what} you left</Text>
          <Pressable accessibilityLabel="Close" onPress={() => store.setFocusOpen(agentId, false)} hitSlop={6} style={styles.iconButton}>
            <Icon name="X" size={13} color={muted} />
          </Pressable>
        </View>
        <View style={[styles.row, touch && styles.wrap]}>
          <TextInput
            value={focus}
            onChangeText={setFocus}
            placeholder="Focus the summary on… (optional)"
            placeholderTextColor={muted}
            autoFocus
            onSubmitEditing={() => void store.summarize(agentId, focus)}
            style={[BODY, styles.input, { color: theme.colors.foreground, borderColor: theme.colors.surface2, backgroundColor: theme.colors.surface1 }]}
          />
          <TextButton label="Summarize" primary onPress={() => void store.summarize(agentId, focus)} theme={theme} />
        </View>
      </View>
    );
  }
  return (
    <View style={box}>
      <View style={styles.row}>
        <Icon name="Undo2" size={13} color={muted} />
        <Text style={[BODY, styles.flex, { color: muted }]} numberOfLines={1}>{touch ? state.offer.setAside : what} set aside</Text>
        <TextButton label="Summarize them" onPress={() => store.setFocusOpen(agentId, true)} theme={theme} />
        <TextButton label="Undo" onPress={() => void store.goto(agentId, "undo")} theme={theme} />
        <Pressable accessibilityLabel="Dismiss" onPress={() => void store.dismiss(agentId)} hitSlop={6} style={styles.iconButton}>
          <Icon name="X" size={13} color={muted} />
        </Pressable>
      </View>
    </View>
  );
}

function BranchRow({ branch, onPress, theme }: { branch: Branch; onPress?: () => void; theme: PluginTheme }) {
  const muted = theme.colors.foregroundMuted;
  const details = branch.pending
    ? "no messages yet"
    : `${clock(branch.time)} · ${branch.messages} message${branch.messages === 1 ? "" : "s"}`;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={({ hovered }: Hover) => [styles.branch, hovered && onPress && { backgroundColor: theme.colors.surface2 }]}
    >
      <View
        style={[
          styles.dot,
          { borderColor: branch.current ? theme.colors.foreground : muted, backgroundColor: branch.current ? theme.colors.foreground : "transparent" },
          branch.pending && { borderStyle: "dashed" },
        ]}
      />
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[BODY, { color: branch.pending ? muted : theme.colors.foreground }]}>{branch.title}</Text>
        <Text style={[SMALL, { color: muted }]}>
          {details}
          {branch.summarized ? " · summarized" : ""}
          {branch.current ? <Text style={{ color: theme.colors.foreground }}> · you are here</Text> : null}
        </Text>
      </View>
    </Pressable>
  );
}

/** Branch list: one row per branch; touch layouts also get the offer and "Go back to" (they have no message icons). */
function BranchSheet({ agentId, store, theme, touch }: { agentId: string; store: TreeStore; theme: PluginTheme; touch: boolean }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const toast = useToast();
  const open = snapshot.sheetAgentId === agentId;
  const state = snapshot.states.get(agentId);
  const muted = theme.colors.foregroundMuted;
  const branches = state?.branches ?? [];
  const mine: Turn[] = (state?.turns ?? []).filter(turn => turn.userId && turn.userText).reverse();

  function reask(turn: Turn) {
    if (state?.busy) return toast.error("The agent is busy. Try again when it has finished.");
    void copyToClipboard(turn.userText!)
      .then(() => toast.show("Copied — paste to re-ask"))
      .catch(() => toast.error("Could not copy the message; it is still in the branch list."));
    void store.goto(agentId, "reask", turn.userId!);
  }

  function switchTo(branch: Branch) {
    if (state?.busy) return toast.error("The agent is busy. Try again when it has finished.");
    if (branch.target) void store.goto(agentId, "switch", branch.target);
  }

  return (
    <Modal transparent visible={open} animationType={touch ? "slide" : "fade"} onRequestClose={() => store.closeSheet()} statusBarTranslucent>
      <View style={[styles.overlay, touch ? styles.overlayTouch : styles.overlayDesktop]}>
        <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={() => store.closeSheet()} />
        <View style={[styles.frame, touch ? styles.frameTouch : styles.frameDesktop, { backgroundColor: theme.colors.surface1, borderColor: theme.colors.border }]}>
          <View style={styles.titleRow}>
            <Text style={[SMALL, styles.flex, { color: muted }]}>
              {branches.length > 1 ? `${branches.length} branches in this chat` : "Only one branch so far"}
            </Text>
            <Pressable accessibilityLabel="Close" onPress={() => store.closeSheet()} hitSlop={6} style={styles.iconButton}>
              <Icon name="X" size={13} color={muted} />
            </Pressable>
          </View>
          {!state ? (
            <ActivityIndicator style={styles.loading} color={muted} />
          ) : !state.supported ? (
            <Text style={[BODY, styles.note, { color: muted }]}>Branches work only in OMP chats.</Text>
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              {touch ? <OfferBlock agentId={agentId} state={state} store={store} theme={theme} touch={touch} /> : null}
              {branches.map(branch => (
                <BranchRow
                  key={branch.target ?? "pending"}
                  branch={branch}
                  theme={theme}
                  onPress={branch.current || state.op ? undefined : () => switchTo(branch)}
                />
              ))}
              {touch && mine.length ? (
                <>
                  <Text style={[SMALL, styles.heading, { color: muted }]}>GO BACK TO</Text>
                  <Text style={[SMALL, styles.note, { color: muted }]}>
                    Restarts from before that message and copies it, so you can paste, edit and resend.
                  </Text>
                  {mine.map(turn => (
                    <Pressable
                      key={turn.userId}
                      accessibilityRole="button"
                      disabled={!!state.op}
                      onPress={() => reask(turn)}
                      style={({ hovered }: Hover) => [styles.branch, hovered && { backgroundColor: theme.colors.surface2 }]}
                    >
                      <View style={[styles.dot, { borderColor: muted, borderStyle: "dashed" }]} />
                      <View style={styles.flex}>
                        <Text numberOfLines={1} style={[BODY, { color: theme.colors.foreground }]}>{turn.userText!.replace(/\s+/g, " ").trim()}</Text>
                        <Text style={[SMALL, { color: muted }]}>{clock(turn.userTime)}</Text>
                      </View>
                    </Pressable>
                  ))}
                </>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Native and touch: notices become Paseo toasts (web desktop shows its own, next to the chat). */
function Notices({ agentId, store }: { agentId: string; store: TreeStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const toast = useToast();
  useEffect(() => {
    for (const notice of snapshot.notices) {
      if (notice.agentId !== agentId) continue;
      store.takeNotice(notice.key);
      const text = notice.sub ? `${notice.text} · ${notice.sub}` : notice.text;
      if (notice.error) toast.error(text);
      else toast.show(text);
    }
  }, [snapshot.notices, agentId, store, toast]);
  return null;
}

/**
 * The Tree pill's icon. It also hosts the chat's branch sheet: the pill is the plugin UI that lives
 * in a chat's composer on every client, and /tree opens the sheet without a press.
 */
export function createPillIcon(store: TreeStore): ComponentType<PluginButtonIconProps> {
  return function TreePillIcon(props: PluginButtonIconProps) {
    const agentId = props.context === "agent" ? props.agentId : "";
    const token = useRef(Symbol(agentId)).current;
    useEffect(() => (agentId ? store.claimHost(agentId, token) : undefined), [agentId, token]);
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const touch = props.layout.compact || props.layout.platform !== "web";
    const busy = !!snapshot.chats.get(agentId)?.phase || snapshot.starting.has(agentId);
    const host = !!agentId && store.isHost(agentId, token);
    return (
      <>
        {busy ? <ActivityIndicator size={props.size} color={props.color} /> : <Icon name="GitBranch" size={props.size} color={props.color} />}
        {host ? <BranchSheet agentId={agentId} store={store} theme={props.theme} touch={touch} /> : null}
        {host && props.layout.platform !== "web" ? <Notices agentId={agentId} store={store} /> : null}
      </>
    );
  };
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject },
  overlayDesktop: { justifyContent: "flex-end", alignItems: "center", padding: 24, paddingBottom: 150 },
  overlayTouch: { justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  frame: { overflow: "hidden", borderWidth: 1 },
  frameDesktop: { width: "100%", maxWidth: 460, maxHeight: "70%", borderRadius: 10 },
  frameTouch: { maxHeight: "82%", borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomWidth: 0, paddingBottom: 18 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 6, paddingVertical: 4 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 4, paddingBottom: 6 },
  loading: { margin: 16 },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  wrap: { flexWrap: "wrap" },
  column: { gap: 8 },
  offer: { borderWidth: 1, borderRadius: 10, paddingVertical: 4, paddingLeft: 12, paddingRight: 4, marginHorizontal: 4, marginBottom: 6, minHeight: 36, justifyContent: "center" },
  input: { flex: 1, minWidth: 140, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
  textButton: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  iconButton: { padding: 5, borderRadius: 6 },
  branch: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, marginTop: 6 },
  heading: { marginTop: 10, marginHorizontal: 10, letterSpacing: 0.7 },
  note: { marginHorizontal: 10, marginBottom: 4 },
});
