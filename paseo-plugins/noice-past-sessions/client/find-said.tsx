import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { FlatList, Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { findSaid, reopenPastSession, type SaidHit } from "../shared/rpc";
import { absoluteTime, relativeTime, tildify } from "./format";
import { Interactive } from "./interactive";
import { tooltip } from "./web";

export const FIND_SAID_SCREEN = "find-said";

// Paseo's default type ramp (Interface size 14): 14/20 for titles, 12/17 for everything else.
const BASE = { fontSize: 14, lineHeight: 20 } as const;
const SMALL = { fontSize: 12, lineHeight: 17 } as const;
const DEBOUNCE_MS = 200;
/** Shorter needles match nearly everything. */
const MIN_NEEDLE = 2;
/** Matching messages a row shows before "Show N more"; the server sends this many. */
const SHOWN_MESSAGES = 9;

/** The last needle, so reopening the command shows it again; until the app reloads. */
let lastNeedle = "";

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;
}

/** Where the chat is: its live tab, an archived agent, or an OMP session Paseo never opened. */
function placeOf(hit: SaidHit, home: string): string {
  const where = hit.agent?.workspaceName ?? tildify(hit.cwd, home);
  if (!hit.agent) return `not in Paseo · ${where}`;
  return hit.agent.archived ? `archived · ${where}` : where;
}

export function FindSaidScreen({ theme, layout, navigation }: PluginScreenProps) {
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const muted = theme.colors.foregroundMuted;
  const [needle, setNeedle] = useState(lastNeedle);
  const [focused, setFocused] = useState(false);
  lastNeedle = needle;
  const query = useDebounced(needle.trim(), DEBOUNCE_MS);
  const searched = query.length >= MIN_NEEDLE ? query : "";
  const find = useRpc(findSaid);
  const reopen = useRpc(reopenPastSession);
  const queryClient = useQueryClient();
  const toast = useToast();

  // Rows showing all their matches; reset by a new needle.
  const [expanded, setExpanded] = useState<{ needle: string; files: string[] }>({ needle: "", files: [] });
  const expand = expanded.needle === searched ? expanded.files : [];
  const toggle = (file: string) =>
    setExpanded({ needle: searched, files: expand.includes(file) ? expand.filter((f) => f !== file) : [...expand, file] });

  // An empty needle only loads the index, so the first real search finds it warm.
  const result = useQuery({
    queryKey: ["find-said", searched, expand],
    queryFn: () => find({ needle: searched, expand }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchInterval: (current) => (current.state.data?.state === "indexing" ? 1000 : false),
  });
  const data = result.data;
  const ready = data?.state === "ready" ? data : null;
  const hits = searched && ready ? ready.hits : [];
  const home = ready?.home ?? "";

  const open = useMutation({
    mutationFn: async (hit: SaidHit) => {
      if (hit.agent && !hit.agent.archived) return hit.agent.id;
      if (hit.agent) return (await reopen({ source: "paseo", agentId: hit.agent.id })).agentId;
      toast.show(`Importing “${hit.title}”…`, { durationMs: 2500 });
      // No workspace: the daemon puts the session where its folder belongs.
      return (
        await reopen({
          source: "import",
          provider: hit.provider,
          cwd: hit.cwd,
          handle: hit.file,
          key: `omp:${hit.sessionId}`,
          workspaceId: "",
        })
      ).agentId;
    },
    onSuccess: (agentId, hit) => {
      if (hit.agent?.archived || !hit.agent) {
        void queryClient.invalidateQueries({ queryKey: ["find-said"] });
        void queryClient.invalidateQueries({ queryKey: ["past-sessions"] });
      }
      if (navigation) navigation.openAgent({ agentId });
      else toast.show("It's in the sidebar now.", { variant: "success" });
    },
    onError: (error, hit) =>
      toast.error(`Couldn't open “${hit.title}”: ${error instanceof Error ? error.message : String(error)}`),
  });

  let status: string;
  if (result.isError) status = `Search failed: ${result.error instanceof Error ? result.error.message : String(result.error)}`;
  else if (data?.state === "indexing")
    status = data.total
      ? `Reading your chats: ${data.done.toLocaleString("en-US")} of ${plural(data.total, "file")}…`
      : "Loading the index…";
  else if (!ready) status = "Loading the index…";
  else if (!searched)
    status = `Every word, any order, within one of your ${plural(ready.indexedMessages, "message")} in ${plural(ready.indexedChats, "chat")}.`;
  else if (!ready.chats) status = "No message of yours has all these words.";
  else
    status =
      ready.chats > hits.length
        ? `${plural(ready.chats, "chat")}; the newest ${hits.length} shown.`
        : `${plural(ready.chats, "chat")}.`;
  const busy = data?.state === "indexing" || (!data && result.isFetching);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={[styles.search, focused ? styles.searchFocused : null]}>
          <Icon name="TextSearch" size={15} color={muted} />
          <TextInput
            testID="noice-find-said-input"
            value={needle}
            onChangeText={setNeedle}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => {
              const first = hits[0];
              if (first && !open.isPending) open.mutate(first);
            }}
            placeholder="Something you said"
            placeholderTextColor={muted}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="go"
            style={styles.searchInput}
          />
          {needle ? (
            <Interactive
              accessibilityRole="button"
              accessibilityLabel="Clear"
              onPress={() => setNeedle("")}
              style={({ hovered, focused: keyboard }) => [
                styles.clear,
                hovered ? styles.clearHovered : null,
                keyboard ? styles.focusRing : null,
              ]}
            >
              <Icon name="X" size={13} color={muted} />
            </Interactive>
          ) : null}
        </View>
        <View style={styles.statusRow}>
          {busy ? <ActivityIndicator size="small" color={muted} /> : null}
          <Text style={[styles.status, result.isError ? styles.statusError : null]}>{status}</Text>
        </View>
      </View>
      <FlatList
        // A new search starts at the top instead of the old one's scroll position.
        key={searched}
        data={hits}
        keyExtractor={(hit: SaidHit) => hit.file}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }: { item: SaidHit; index: number }) => (
          <HitRow
            hit={item}
            divider={index > 0}
            place={placeOf(item, home)}
            styles={styles}
            disabled={open.isPending}
            expanded={expand.includes(item.file)}
            onPress={() => open.mutate(item)}
            onToggle={() => toggle(item.file)}
          />
        )}
      />
    </View>
  );
}

function Marked({ snippet, marks, styles }: { snippet: string; marks: [number, number][]; styles: Styles }) {
  const parts: { text: string; mark: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of marks) {
    if (start > cursor) parts.push({ text: snippet.slice(cursor, start), mark: false });
    parts.push({ text: snippet.slice(start, end), mark: true });
    cursor = end;
  }
  if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor), mark: false });
  return parts.map((part, index) => (
    <Text key={index} style={part.mark ? styles.mark : null}>
      {part.text}
    </Text>
  ));
}

function HitRow({
  hit,
  divider,
  place,
  styles,
  disabled,
  expanded,
  onPress,
  onToggle,
}: {
  hit: SaidHit;
  divider: boolean;
  place: string;
  styles: Styles;
  disabled: boolean;
  expanded: boolean;
  onPress(): void;
  onToggle(): void;
}) {
  const now = Date.now();
  const messages = expanded ? hit.messages : hit.messages.slice(0, SHOWN_MESSAGES);
  const hidden = hit.matches - messages.length;
  const more =
    (hit.matches > 1 ? ` · ${hit.matches} messages match` : "") +
    (hit.copies ? ` · also in ${plural(hit.copies, "copy", "copies")}` : "");
  return (
    <View style={divider ? styles.rowDivider : null}>
      <Interactive
        accessibilityRole="button"
        accessibilityLabel={`Open ${hit.title}`}
        disabled={disabled}
        onPress={onPress}
        style={({ hovered, pressed, focused }) => [
          styles.row,
          hovered ? styles.rowHovered : null,
          pressed ? styles.rowPressed : null,
          focused ? styles.focusRingInset : null,
        ]}
      >
        <View style={styles.line}>
          <Text style={styles.title} numberOfLines={1}>
            {hit.title}
          </Text>
          <View ref={tooltip(absoluteTime(hit.at))}>
            <Text style={styles.meta}>{relativeTime(hit.at, now)}</Text>
          </View>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {place}
          {more}
        </Text>
        {messages.map((message, index) => (
          <Text key={index} style={styles.snippet} numberOfLines={messages.length > 1 ? 2 : 3}>
            {messages.length > 1 ? <Text style={styles.snippetTime}>{relativeTime(message.at, now)} · </Text> : null}
            <Marked snippet={message.snippet} marks={message.marks} styles={styles} />
          </Text>
        ))}
      </Interactive>
      {hidden > 0 || expanded ? (
        <Interactive
          accessibilityRole="button"
          onPress={onToggle}
          style={({ hovered, focused }) => [
            styles.toggle,
            hovered ? styles.rowHovered : null,
            focused ? styles.focusRingInset : null,
          ]}
        >
          <Text style={styles.toggleText}>
            {expanded && hidden > 0
              ? `Show fewer · the newest ${messages.length} of ${hit.matches} shown`
              : expanded
                ? "Show fewer"
                : `Show ${hidden} more`}
          </Text>
        </Interactive>
      ) : null}
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  const gutter = compact ? 14 : 20;
  const focusRing = { outlineColor: colors.accent, outlineStyle: "solid", outlineWidth: 2 } as const;
  const muted = { ...SMALL, color: colors.foregroundMuted };
  return StyleSheet.create({
    root: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
    header: { paddingHorizontal: gutter, paddingTop: 12, paddingBottom: 6, gap: 8 },
    focusRing,
    focusRingInset: { ...focusRing, outlineOffset: -2 },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: compact ? 38 : 34,
      paddingHorizontal: 10,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    searchFocused: { borderColor: colors.accent },
    // The container shows focus; the browser's own ring inside it would double the border.
    searchInput: { flex: 1, ...BASE, color: colors.foreground, paddingVertical: 0, outlineWidth: 0 },
    clear: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    clearHovered: { backgroundColor: colors.surface2 },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: SMALL.lineHeight },
    status: { ...muted, flexShrink: 1 },
    statusError: { color: colors.statusWarning },
    row: { paddingHorizontal: gutter, paddingVertical: 9, gap: 1 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowHovered: { backgroundColor: colors.surface1 },
    rowPressed: { backgroundColor: colors.surface2 },
    line: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
    title: { ...BASE, flex: 1, minWidth: 0, color: colors.foreground },
    meta: muted,
    snippet: { ...SMALL, color: colors.foreground, opacity: 0.85, marginTop: 3 },
    mark: { backgroundColor: colors.surface2, fontWeight: "600" },
    snippetTime: { color: colors.foregroundMuted },
    toggle: { paddingHorizontal: gutter, paddingTop: 2, paddingBottom: 8, alignSelf: "flex-start", borderRadius: 4 },
    toggleText: { ...SMALL, color: colors.accent },
  });
}
