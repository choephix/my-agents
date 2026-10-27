import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { FlatList, Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Platform, StyleSheet, Text, View } from "react-native";
import {
  listExternalSessions,
  listPastSessions,
  listMarks,
  reopenPastSession,
  setMark,
  type Mark,
  type MarkKeys,
  type PastSession,
  type ExternalSessionsListing,
  type PastSessionsListing,
  type Scope,
} from "../shared/rpc";
import { viewSettings, type Density } from "../shared/view";
import { absoluteTime, folderChip, relativeTime, tildify } from "./format";
import { Interactive } from "./interactive";
import { buildListItems, mergeByNewest, sourceWord, type ListItem } from "./model";
import { ProviderGlyph, useSnapshotIcons } from "./provider-glyph";
import { swallowNextClick, tooltip } from "./web";

interface Props {
  workspaceId: string;
  scope: Scope;
  onScopeChange(scope: Scope): void;
  theme: PluginTheme;
  /** Host id, for provider glyphs. */
  serverId: string;
  /** Phone-sized layout: no hover, search on its own line. */
  compact: boolean;
  navigation: PluginSurfaceProps["navigation"];
}

const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: "workspace", label: "Workspace", hint: "Archived agents of this workspace" },
  { value: "folder", label: "Folder", hint: "Everything that ran in this folder" },
  { value: "project", label: "Project", hint: "Everything in the project, its subfolders and worktrees" },
];

/** The density toggle shows what a click switches to. */
const NEXT_DENSITY: Record<Density, { value: Density; icon: string; label: string }> = {
  comfortable: { value: "compact", icon: "Rows4", label: "Switch to compact: one line per session" },
  compact: { value: "comfortable", icon: "Rows2", label: "Switch to comfortable: two lines of the last reply" },
};

/** Below this the toolbar can't fit the scope switch, the search box and both icon buttons. */
const NARROW_WIDTH = 480;

// Paseo's default type ramp (Interface size 14): 14/20 for titles, 12/17 for everything else.
const BASE = { fontSize: 14, lineHeight: 20 } as const;
const SMALL = { fontSize: 12, lineHeight: 17 } as const;
const GLYPH = 14;

/** `a` moved `t` of the way toward `b`; hex colours only, otherwise `a` unchanged. */
function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const [ca, cb] = [parse(a), parse(b)];
  if (!ca || !cb) return a;
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  const gutter = compact ? 14 : 20;
  const focusRing = { outlineColor: colors.accent, outlineStyle: "solid", outlineWidth: 2 } as const;
  const muted = { ...SMALL, color: colors.foregroundMuted };
  const segmentGroup = { flexDirection: "row", padding: 2, borderRadius: 12, backgroundColor: colors.surface2 } as const;
  return StyleSheet.create({
    root: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
    // The bottom padding keeps scrolled rows from touching the toolbar.
    header: { paddingHorizontal: gutter, paddingTop: 12, paddingBottom: 6 },
    toolbar: { flexDirection: "row", alignItems: "center", gap: 8 },
    focusRing,
    focusRingInset: { ...focusRing, outlineOffset: -2 },
    segments: { ...segmentGroup, flexShrink: 0 },
    segment: { height: 24, paddingHorizontal: 8, borderRadius: 10, justifyContent: "center" },
    segmentActive: { backgroundColor: colors.surface0 },
    segmentText: { ...SMALL, color: colors.foregroundMuted },
    segmentTextHot: { color: colors.foreground },
    spacer: { flex: 1 },
    iconButton: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
    iconButtonHovered: { backgroundColor: colors.surface1 },
    iconButtonPressed: { backgroundColor: colors.surface2 },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: compact ? 34 : 28,
      paddingHorizontal: 10,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    searchInline: { flex: 1, minWidth: 140 },
    searchRow: { marginTop: 8 },
    searchFocused: { borderColor: colors.accent },
    // The container shows focus; the browser's own ring inside it would double the border.
    searchInput: { flex: 1, ...BASE, color: colors.foreground, paddingVertical: 0, outlineWidth: 0 },
    clear: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    warning: { ...SMALL, color: colors.statusWarning, marginTop: 4 },
    externalRow: { flexDirection: "row", justifyContent: "flex-end" },
    externalControl: { flexDirection: "row", alignItems: "center", gap: 2, paddingRight: gutter - 6, paddingTop: 4 },
    externalButton: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 6, borderRadius: 6 },
    externalText: { ...muted, flexShrink: 1 },
    externalTextHot: { color: colors.foreground },
    externalError: { ...SMALL, color: colors.statusWarning, flexShrink: 1 },
    row: { paddingHorizontal: gutter, paddingVertical: 8 },
    rowCompact: { paddingVertical: 6 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowHovered: { backgroundColor: colors.surface1 },
    // A hidden row, listed only while "Show hidden" is on.
    rowHidden: { opacity: 0.5 },
    rowPressed: { backgroundColor: colors.surface2 },
    split: { flexDirection: "row", gap: 10 },
    glyph: { width: GLYPH, height: BASE.lineHeight, alignItems: "center", justifyContent: "center" },
    body: { flex: 1, minWidth: 0 },
    line: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
    lineCompact: { gap: 10 },
    title: { ...BASE, flexShrink: 1, color: colors.foreground },
    titleCompact: { maxWidth: "56%" },
    titleFill: { flex: 1 },
    tail: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
    tailHidden: { opacity: 0 },
    dash: { ...muted, opacity: 0.6 },
    chip: {
      flexShrink: 1,
      // Phones leave the title little room; the chip yields first.
      maxWidth: compact ? "28%" : "40%",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 6,
      borderRadius: 5,
      backgroundColor: colors.surface2,
    },
    chipHot: { backgroundColor: colors.surface0 },
    chipText: { ...muted, flexShrink: 1 },
    right: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
    // Rightmost in the row; the negative right margin lines the 12 px glyph up with the text edge.
    star: { width: 20, height: 20, marginLeft: -2, marginRight: -4, borderRadius: 5, alignItems: "center", justifyContent: "center" },
    starIdle: { opacity: 0 },
    // Left of the star; zero-width until the row is hot, so the time doesn't move over for it.
    hide: { width: 20, height: 20, borderRadius: 5, alignItems: "center", justifyContent: "center" },
    hideIdle: { width: 0, marginLeft: -6, opacity: 0, overflow: "hidden" },
    meta: muted,
    tag: { ...muted, opacity: 0.72 },
    dot: { ...muted, opacity: 0.5 },
    action: { ...SMALL, color: colors.foreground, fontWeight: "500" },
    preview: { ...muted, marginTop: 1 },
    previewInline: { ...muted, flex: 1, minWidth: 0 },
    // What needs Stefan on that session (open questions, loose ends): the warning colour moved
    // toward the text colour, so it's lighter and less saturated than a warning.
    attention: { color: mixHex(colors.statusWarning, colors.foreground, 0.45) },
    // The last-reply fallback, fainter than a memo.
    reply: { opacity: 0.55 },
    expansion: { paddingLeft: GLYPH + 10, paddingBottom: 2 },
    folderHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 10,
      paddingHorizontal: gutter,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    folderHeaderHovered: { backgroundColor: colors.surface2 },
    folderHeaderBody: { flex: 1, minWidth: 0 },
    folderHeaderTitle: { ...BASE, color: colors.foreground, fontWeight: "500" },
    folderHeaderHint: muted,
    count: { paddingHorizontal: 7, borderRadius: 9, backgroundColor: colors.surface2 },
    countText: { ...SMALL, color: colors.foreground },
    state: { alignItems: "center", gap: 8, paddingHorizontal: 32, paddingVertical: 40 },
    stateTitle: { ...BASE, color: colors.foreground, fontWeight: "600", textAlign: "center" },
    stateDetail: { ...muted, textAlign: "center", maxWidth: 420 },
    stateButton: {
      marginTop: 6,
      paddingHorizontal: 12,
      height: 28,
      justifyContent: "center",
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    stateButtonText: { ...SMALL, color: colors.foreground },
    footer: { ...muted, paddingHorizontal: gutter, paddingTop: 10, paddingBottom: 24 },
    footerHidden: { flexDirection: "row", paddingHorizontal: gutter - 6, paddingTop: 8 },
    menuOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    menuText: { ...BASE, color: colors.foreground },
  });
}

function StateMessage(props: {
  styles: Styles;
  theme: PluginTheme;
  icon: string;
  title: string;
  detail?: string;
  action?: { label: string; onPress(): void };
  busy?: boolean;
}) {
  const { styles, theme } = props;
  return (
    <View style={styles.state}>
      {props.busy ? (
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      ) : (
        <Icon name={props.icon} size={22} color={theme.colors.foregroundMuted} />
      )}
      <Text style={styles.stateTitle}>{props.title}</Text>
      {props.detail ? <Text style={styles.stateDetail}>{props.detail}</Text> : null}
      {props.action ? (
        <Interactive
          accessibilityRole="button"
          onPress={props.action.onPress}
          style={({ hovered, pressed, focused }) => [
            styles.stateButton,
            hovered ? styles.iconButtonHovered : null,
            pressed ? styles.iconButtonPressed : null,
            focused ? styles.focusRing : null,
          ]}
        >
          <Text style={styles.stateButtonText}>{props.action.label}</Text>
        </Interactive>
      ) : null}
    </View>
  );
}

/** A memo's attention, on its own line under the memo (soft amber). */
function Attention({ text, styles }: { text: string; styles: Styles }) {
  return (
    <Text style={[styles.preview, styles.attention]} numberOfLines={2}>
      {text}
    </Text>
  );
}

function Preview({ entry, styles, lines }: { entry: PastSession; styles: Styles; lines: number }) {
  const { preview } = entry;
  if (!preview) return null;
  return (
    <>
      <Text style={[styles.preview, preview.kind === "reply" ? styles.reply : null]} numberOfLines={lines}>
        {preview.text}
      </Text>
      {preview.attention ? <Attention text={preview.attention} styles={styles} /> : null}
    </>
  );
}

// Lucide's Star, which Paseo's Icon draws only as an outline; the starred mark is filled.
const STAR_PATH =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

function StarMark({ filled, size, color }: { filled: boolean; size: number; color: string }) {
  // Native apps can't draw SVG images; they get the outline in full colour.
  if (!filled || Platform.OS !== "web") return <Icon name="Star" size={size} color={color} />;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="2" stroke-linejoin="round"><path d="${STAR_PATH}"/></svg>`;
  return (
    <Image
      source={{ uri: `data:image/svg+xml;utf8,${svg}` }}
      style={{ width: size, height: size }}
      accessibilityIgnoresInvertColors
    />
  );
}

interface RowProps {
  entry: PastSession;
  // Primitives only, so `memo` skips rows whose output didn't change: a `now` timestamp or a fresh
  // chip object re-rendered all ~120 mounted rows on every keystroke (~50 ms a render).
  /** "2 d ago" / "2d", built by the list with its `now`. */
  time: string;
  timeTitle: string;
  chipLabel: string | null;
  chipPath: string | null;
  divider: boolean;
  density: Density;
  compact: boolean;
  starred: boolean;
  hidden: boolean;
  serverId: string;
  snapshotSvg: string | undefined;
  styles: Styles;
  theme: PluginTheme;
  onOpen(entry: PastSession): void;
  onMark(input: { key: string; mark: Mark; on: boolean }): void;
  /** Phones: a long press opens the row's menu (star, hide). */
  onMenu(entry: PastSession): void;
  /** Pointer over this row (`part` "row") or one of its buttons, so the list can hold re-sorts meanwhile. */
  onHover(id: string, over: boolean): void;
}

/**
 * Comfortable: glyph | title, folder chip, "terminal · 2 d ago ⊘ ★" / two preview lines.
 * Compact: one line with the preview as a muted tail; hover opens the two-line preview below.
 * Hover or keyboard focus swaps the time for the action; the "terminal" word stays. The star
 * shows on starred rows and, on hover, as an outline to click; the hide button (left of it)
 * shows on hover and on hidden rows. Phones star and hide from a long-press menu.
 */
const SessionRow = memo(function SessionRow(props: RowProps) {
  const { entry, chipLabel, chipPath, density, compact, starred, hidden, styles, theme, onHover } = props;
  const fromPaseo = entry.source === "paseo";
  const dense = density === "compact";
  const actionLabel = fromPaseo ? "Restore" : "Import";
  const starLabel = starred ? "Unstar" : "Star: list it first";
  const hideLabel = hidden ? "Unhide: list it again" : "Hide from Past sessions";
  // react-native-web ends the row's hover when the pointer enters a nested button; the button's
  // own hover keeps the row hot, so the buttons stay shown and Restore stays put.
  const [overStar, setOverStar] = useState(false);
  const [overHide, setOverHide] = useState(false);
  // A row removed while hovered (opened, hidden, filtered out) never gets its hover-out.
  useEffect(
    () => () => {
      onHover(`${entry.key}:row`, false);
      onHover(`${entry.key}:star`, false);
      onHover(`${entry.key}:hide`, false);
    },
    [entry.key, onHover],
  );
  return (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel={`${actionLabel} ${entry.title}`}
      testID={`past-session-${entry.key}`}
      onHoverIn={() => onHover(`${entry.key}:row`, true)}
      onHoverOut={() => onHover(`${entry.key}:row`, false)}
      onPress={() => props.onOpen(entry)}
      onLongPress={
        compact
          ? () => {
              swallowNextClick();
              props.onMenu(entry);
            }
          : undefined
      }
      style={({ hovered, pressed, focused }) => [
        styles.row,
        dense ? styles.rowCompact : null,
        props.divider && !dense ? styles.rowDivider : null,
        hovered || overStar || overHide ? styles.rowHovered : null,
        pressed ? styles.rowPressed : null,
        focused ? styles.focusRingInset : null,
        hidden && !(hovered || overStar || overHide) ? styles.rowHidden : null,
      ]}
    >
      {({ hovered, focused }) => {
        const hot = hovered || focused || overStar || overHide;
        // Phones: plain marks (a tap anywhere restores; a long press opens the menu). Web: buttons.
        const star = compact ? (
          starred ? (
            <View style={styles.star}>
              <StarMark filled size={12} color={theme.colors.foreground} />
            </View>
          ) : null
        ) : (
          // Always mounted, so the pointer finds it; invisible until the row is hot.
          <Interactive
            accessibilityRole="button"
            accessibilityLabel={starLabel}
            accessibilityState={{ checked: starred }}
            testID={`past-session-star-${entry.key}`}
            onPress={() => props.onMark({ key: entry.key, mark: "starred", on: !starred })}
            onHoverIn={() => {
              setOverStar(true);
              onHover(`${entry.key}:star`, true);
            }}
            onHoverOut={() => {
              setOverStar(false);
              onHover(`${entry.key}:star`, false);
            }}
            style={({ hovered: over, focused: ring }) => [
              styles.star,
              starred || hot || ring ? null : styles.starIdle,
              over ? styles.iconButtonHovered : null,
              ring ? styles.focusRing : null,
            ]}
          >
            {({ hovered: over }) => (
              <View ref={tooltip(starLabel)}>
                <StarMark
                  filled={starred}
                  size={12}
                  color={starred || over ? theme.colors.foreground : theme.colors.foregroundMuted}
                />
              </View>
            )}
          </Interactive>
        );
        const hide = compact ? (
          hidden ? (
            <View style={styles.hide}>
              <Icon name="EyeOff" size={13} color={theme.colors.foregroundMuted} />
            </View>
          ) : null
        ) : (
          // Always mounted, so the pointer finds it; zero-width until the row is hot.
          <Interactive
            accessibilityRole="button"
            accessibilityLabel={hideLabel}
            accessibilityState={{ checked: hidden }}
            testID={`past-session-hide-${entry.key}`}
            onPress={() => props.onMark({ key: entry.key, mark: "hidden", on: !hidden })}
            onHoverIn={() => {
              setOverHide(true);
              onHover(`${entry.key}:hide`, true);
            }}
            onHoverOut={() => {
              setOverHide(false);
              onHover(`${entry.key}:hide`, false);
            }}
            style={({ hovered: over, focused: ring }) => [
              styles.hide,
              hidden || hot || ring ? null : styles.hideIdle,
              over ? styles.iconButtonHovered : null,
              ring ? styles.focusRing : null,
            ]}
          >
            {({ hovered: over }) => (
              <View ref={tooltip(hideLabel)}>
                <Icon
                  name={hidden && over ? "Eye" : "EyeOff"}
                  size={13}
                  color={over ? theme.colors.foreground : theme.colors.foregroundMuted}
                />
              </View>
            )}
          </Interactive>
        );
        const glyph = (
          <View style={styles.glyph}>
            <ProviderGlyph
              provider={entry.provider}
              serverId={props.serverId}
              snapshotSvg={props.snapshotSvg}
              size={GLYPH}
              color={theme.colors.foregroundMuted}
            />
          </View>
        );
        const title = (
          <Text
            style={[styles.title, dense ? (compact ? styles.titleFill : styles.titleCompact) : null]}
            numberOfLines={1}
          >
            {entry.title}
          </Text>
        );
        const folder = chipLabel ? (
          <View ref={tooltip(chipPath ?? chipLabel)} style={[styles.chip, hot ? styles.chipHot : null]}>
            <Icon name="Folder" size={11} color={theme.colors.foregroundMuted} />
            <Text style={styles.chipText} numberOfLines={1}>
              {chipLabel}
            </Text>
          </View>
        ) : null;
        const right = (
          <View style={styles.right}>
            {fromPaseo ? null : (
              <>
                <Text style={styles.tag}>{sourceWord(entry)}</Text>
                <Text style={styles.dot}>·</Text>
              </>
            )}
            {hot ? (
              <>
                <Icon name={fromPaseo ? "ArchiveRestore" : "Import"} size={14} color={theme.colors.accent} />
                <Text style={styles.action}>{actionLabel}</Text>
              </>
            ) : (
              <Text ref={tooltip(props.timeTitle)} style={styles.meta}>
                {props.time}
              </Text>
            )}
            {hide}
            {star}
          </View>
        );

        if (!dense) {
          return (
            <View style={styles.split}>
              {glyph}
              <View style={styles.body}>
                <View style={styles.line}>
                  {title}
                  {folder}
                  <View style={styles.spacer} />
                  {right}
                </View>
                <Preview entry={entry} styles={styles} lines={2} />
              </View>
            </View>
          );
        }
        const opened = hot && !compact && entry.preview !== null;
        return (
          <>
            <View style={[styles.line, styles.lineCompact]}>
              {glyph}
              {title}
              {folder}
              {!compact && entry.preview ? (
                <View style={[styles.tail, opened ? styles.tailHidden : null]}>
                  <Text style={styles.dash}>—</Text>
                  <Text style={[styles.previewInline, entry.preview.kind === "reply" ? styles.reply : null]} numberOfLines={1}>
                    {entry.preview.text}
                  </Text>
                </View>
              ) : (
                <View style={styles.spacer} />
              )}
              {right}
            </View>
            {opened ? (
              <View style={styles.expansion}>
                <Preview entry={entry} styles={styles} lines={2} />
              </View>
            ) : entry.preview?.attention ? (
              <View style={styles.expansion}>
                <Attention text={entry.preview.attention} styles={styles} />
              </View>
            ) : null}
          </>
        );
      }}
    </Interactive>
  );
});

type ExternalState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; count: number; fetchedAt: string; warnings: string[] };

/**
 * The quiet switch for Claude Code and Codex sessions: "+ Claude Code & Codex" until clicked, a
 * spinner while the daemon lists them, then "Claude Code & Codex · 12" (click to hide) with a
 * refresh button.
 */
function ExternalControl(props: {
  shown: boolean;
  state: ExternalState;
  now: number;
  styles: Styles;
  theme: PluginTheme;
  onToggle(): void;
  onRefresh(): void;
}) {
  const { shown, state, styles, theme } = props;
  const muted = theme.colors.foregroundMuted;
  const ready = shown && state.kind === "ready";
  const label =
    state.kind === "loading" && shown
      ? "Listing Claude Code & Codex…"
      : ready
        ? `Claude Code & Codex · ${state.count}`
        : "Claude Code & Codex";
  const hint = ready
    ? `Listed ${relativeTime(state.fetchedAt, props.now)}${state.warnings.length ? ` · ${state.warnings.join("; ")}` : ""}. Click to hide.`
    : "Also show Claude Code and Codex sessions never opened in Paseo";
  return (
    <View style={styles.externalControl}>
      {shown && state.kind === "error" ? (
        <Text style={styles.externalError} numberOfLines={1}>
          Couldn't list: {state.message}
        </Text>
      ) : null}
      <Interactive
        accessibilityRole="switch"
        accessibilityState={{ checked: shown }}
        accessibilityLabel={hint}
        testID="past-sessions-external"
        disabled={shown && state.kind === "loading"}
        onPress={props.onToggle}
        style={({ hovered, focused }) => [
          styles.externalButton,
          hovered ? styles.iconButtonHovered : null,
          focused ? styles.focusRing : null,
        ]}
      >
        {({ hovered }) => (
          <View ref={tooltip(hint)} style={styles.line}>
            {shown && state.kind === "loading" ? (
              <ActivityIndicator size="small" color={muted} />
            ) : (
              <Icon name={shown ? "Check" : "Plus"} size={13} color={hovered ? theme.colors.foreground : muted} />
            )}
            <Text style={[styles.externalText, hovered || ready ? styles.externalTextHot : null]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        )}
      </Interactive>
      {ready || (shown && state.kind === "error") ? (
        <Interactive
          accessibilityRole="button"
          accessibilityLabel="List Claude Code and Codex sessions again"
          testID="past-sessions-external-refresh"
          onPress={props.onRefresh}
          style={({ hovered, focused }) => [
            styles.clear,
            hovered ? styles.iconButtonHovered : null,
            focused ? styles.focusRing : null,
          ]}
        >
          {({ hovered }) => <Icon name="RefreshCw" size={12} color={hovered ? theme.colors.foreground : muted} />}
        </Interactive>
      ) : null}
    </View>
  );
}

/** What a scope covers, as the scope button's tooltip. */
function scopeHint(data: PastSessionsListing, scope: Scope): string {
  const folder = tildify(data.folder, data.home);
  if (scope === "workspace") return `Archived agents of ${data.workspaceName} · ${folder}`;
  if (scope === "folder") return `Everything that ran in ${folder}`;
  return `Everything in ${data.projectName}, its subfolders and worktrees · ${tildify(data.projectRoot, data.home)}`;
}

function emptyMessage(scope: Scope, query: string): { title: string; detail: string } {
  if (query.trim()) return { title: `Nothing matches “${query.trim()}”`, detail: "Search looks at titles and folders." };
  if (scope === "workspace") {
    return {
      title: "No archived agents in this workspace",
      detail: "Archive an agent and it appears here, ready to restore.",
    };
  }
  return { title: "No past sessions here", detail: "Archived agents and terminal sessions for this place appear here." };
}

/** The saved density, switched optimistically; saving failures keep the local choice. */
function useDensity(): [Density, (density: Density) => void] {
  const settings = useSettings(viewSettings);
  const [chosen, setChosen] = useState<Density | null>(null);
  const saved = settings.status === "ready" ? settings.values.density : "comfortable";
  return [
    chosen ?? saved,
    (density) => {
      setChosen(density);
      // The whole object: a missing field would fall back to its default.
      if (settings.status === "ready") void settings.save({ ...settings.values, density }, settings.revision);
    },
  ];
}

type MarkSets = Record<Mark, ReadonlySet<string>>;
const NO_MARKS: MarkSets = { starred: new Set(), hidden: new Set() };
const MARKS_KEY = ["past-sessions-marks"];
const toMarkSets = (keys: MarkKeys): MarkSets => ({ starred: new Set(keys.starred), hidden: new Set(keys.hidden) });
/** Phones get a toast, since the row moves or leaves under the finger. */
const MARK_TOAST: Record<Mark, { on: string; off: string }> = {
  starred: { on: "Starred: listed first", off: "Unstarred" },
  hidden: { on: "Hidden. “Show hidden” at the end of the list brings it back.", off: "Listed again" },
};
const NO_KEYS: ReadonlySet<string> = new Set();
/** How long a fetched list counts as current: no refetch when coming back within it. */
const LIST_FRESH_MS = 30_000;

export function PastSessionsList({ workspaceId, scope, onScopeChange, theme, serverId, compact, navigation }: Props) {
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);
  const list = useRpc(listPastSessions);
  const reopen = useRpc(reopenPastSession);
  const getMarks = useRpc(listMarks);
  const saveMark = useRpc(setMark);
  const queryClient = useQueryClient();
  const toast = useToast();
  const snapshotIcons = useSnapshotIcons();
  const marks = useQuery({
    queryKey: MARKS_KEY,
    queryFn: async () => toMarkSets(await getMarks({})),
    staleTime: LIST_FRESH_MS,
  }).data ?? NO_MARKS;
  // Optimistic: the row moves or leaves at once; a failed save puts it back.
  const markMutation = useMutation({
    mutationFn: (input: { key: string; mark: Mark; on: boolean }) => saveMark(input),
    onMutate: ({ key, mark, on }) => {
      const before = queryClient.getQueryData<MarkSets>(MARKS_KEY) ?? NO_MARKS;
      const changed = new Set(before[mark]);
      if (on) changed.add(key);
      else changed.delete(key);
      queryClient.setQueryData<MarkSets>(MARKS_KEY, { ...before, [mark]: changed });
      if (compact) toast.show(MARK_TOAST[mark][on ? "on" : "off"]);
      return before;
    },
    onSuccess: (keys) => queryClient.setQueryData(MARKS_KEY, toMarkSets(keys)),
    onError: (error, _input, before) => {
      queryClient.setQueryData(MARKS_KEY, before);
      toast.error(`Couldn't save: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  // Phones: the row a long press opened the menu for.
  const [menuFor, setMenuFor] = useState<PastSession | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [density, setDensity] = useDensity();
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  // The explorer sidebar is narrower than the inline search needs; it then gets its own line,
  // as on phones, while rows keep their desktop (hover) behaviour.
  const [narrow, setNarrow] = useState(false);
  const ownSearchLine = compact || narrow;
  const [sameFolderOpen, setSameFolderOpen] = useState(false);
  const muted = theme.colors.foregroundMuted;
  const listExternal = useRpc(listExternalSessions);
  // On demand: the daemon lists Claude Code (file scan) and Codex (an app-server per call) only
  // after a click; the choice is not remembered.
  const [showExternal, setShowExternal] = useState(false);
  const refreshExternal = useRef(false);

  const result = useQuery({
    queryKey: ["past-sessions", workspaceId, scope],
    queryFn: () => list({ workspaceId, scope }),
    // Coming back within 30 s shows the cached list and asks nothing; after that it refreshes
    // in the background without a spinner (the spinner is for the refresh button only).
    staleTime: LIST_FRESH_MS,
  });
  const [refreshing, setRefreshing] = useState(false);
  const externalScope = scope === "workspace" ? null : scope;
  const external = useQuery({
    queryKey: ["external-sessions", workspaceId, externalScope],
    enabled: showExternal && externalScope !== null,
    staleTime: Infinity,
    queryFn: () => {
      const refresh = refreshExternal.current;
      refreshExternal.current = false;
      return listExternal({ workspaceId, scope: externalScope ?? "folder", refresh });
    },
  });
  // Hovering a scope button loads that scope, so the click usually finds it ready.
  const prefetchScope = (next: Scope) =>
    void queryClient.prefetchQuery({
      queryKey: ["past-sessions", workspaceId, next],
      queryFn: () => list({ workspaceId, scope: next }),
      staleTime: LIST_FRESH_MS,
    });

  // Optimistic reopen: the row leaves at once and returns only if reopening fails. The chat opens
  // when the daemon confirms: opening an archived agent earlier adds its tab but doesn't focus it.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(NO_KEYS);
  const settle = (key: string) =>
    setLeaving((keys) => {
      const next = new Set(keys);
      next.delete(key);
      return next;
    });
  const mutation = useMutation({
    mutationFn: (entry: PastSession) =>
      entry.source === "paseo"
        ? reopen({ source: "paseo", agentId: entry.agentId ?? "" })
        : reopen({
            source: "import",
            provider: entry.provider,
            cwd: entry.cwd,
            handle: (entry.source === "omp" ? entry.file : entry.sessionId) ?? "",
            key: entry.key,
          }),
    onMutate: (entry) => {
      setLeaving((keys) => new Set(keys).add(entry.key));
      // Imports take seconds; a quiet note says the click landed.
      if (entry.source !== "paseo") toast.show(`Importing “${entry.title}”…`, { durationMs: 2500 });
    },
    onSuccess: ({ agentId }, entry) => {
      // Drop the row from every cached listing now; the lists then refresh quietly.
      const without = (entries: PastSession[]) => entries.filter((candidate) => candidate.key !== entry.key);
      queryClient.setQueriesData<PastSessionsListing>({ queryKey: ["past-sessions"] }, (old) =>
        old ? { ...old, entries: without(old.entries), sameFolder: without(old.sameFolder) } : old,
      );
      queryClient.setQueriesData<ExternalSessionsListing>({ queryKey: ["external-sessions"] }, (old) =>
        old ? { ...old, entries: without(old.entries) } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ["past-sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["external-sessions"] });
      void queryClient.invalidateQueries({ queryKey: MARKS_KEY });
      if (navigation) navigation.openAgent({ agentId });
      else toast.show(`${entry.source === "paseo" ? "Restored" : "Imported"}. It's in the sidebar now.`, { variant: "success" });
    },
    onError: (error, entry) => {
      settle(entry.key);
      toast.error(`Couldn't reopen “${entry.title}”: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  // A background refresh doesn't re-sort the list under the pointer: while a row is hovered the
  // shown list stays, and the new one appears once the pointer leaves the rows. Starring and
  // opening still apply at once (they're the user's own action).
  const hovered = useRef(new Set<string>());
  const shown = useRef<{ key: string; data: PastSessionsListing | undefined }>({ key: "", data: undefined });
  const pending = useRef(false);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const onRowHover = useCallback((id: string, over: boolean) => {
    if (over) hovered.current.add(id);
    else hovered.current.delete(id);
    if (hovered.current.size === 0 && pending.current) {
      pending.current = false;
      rerender();
    }
  }, []);

  const listed = result.data?.scope === scope ? result.data : undefined;
  const externalEntries = showExternal && externalScope ? external.data?.entries : undefined;
  const latest = useMemo(
    () => (listed && externalEntries ? { ...listed, entries: mergeByNewest(listed.entries, externalEntries) } : listed),
    [listed, externalEntries],
  );
  const viewKey = `${workspaceId}:${scope}:${showExternal}`;
  if (shown.current.key !== viewKey || !shown.current.data || hovered.current.size === 0) {
    shown.current = { key: viewKey, data: latest };
  } else if (shown.current.data !== latest) {
    pending.current = true;
  }
  const held = shown.current.data;
  const data = useMemo(() => {
    if (!held || leaving.size === 0) return held;
    const staying = (entry: PastSession) => !leaving.has(entry.key);
    return { ...held, entries: held.entries.filter(staying), sameFolder: held.sameFolder.filter(staying) };
  }, [held, leaving]);
  // A reopened row stays hidden until the shown list no longer has it (which may wait for the
  // pointer to leave the rows), so it can't flash back in between.
  useEffect(() => {
    if (!held || leaving.size === 0) return;
    const present = new Set([...held.entries, ...held.sameFolder].map((entry) => entry.key));
    if ([...leaving].some((key) => !present.has(key))) {
      setLeaving((keys) => new Set([...keys].filter((key) => present.has(key))));
    }
  }, [held, leaving]);
  const items = useMemo(
    () =>
      data ? buildListItems(data, { query, sameFolderOpen, starred: marks.starred, hidden: marks.hidden, showHidden }) : [],
    [data, query, sameFolderOpen, marks, showHidden],
  );
  const hiddenCount = useMemo(
    () => (data ? [...data.entries, ...data.sameFolder].filter((entry) => marks.hidden.has(entry.key)).length : 0),
    [data, marks],
  );
  // With nothing hidden here the switch is gone; the next hide must hide, not just dim.
  useEffect(() => {
    if (hiddenCount === 0) setShowHidden(false);
  }, [hiddenCount]);
  const now = Date.now();

  const externalControl = externalScope ? (
    <ExternalControl
      shown={showExternal}
      state={
        external.isFetching
          ? { kind: "loading" }
          : external.isError
            ? { kind: "error", message: external.error instanceof Error ? external.error.message : String(external.error) }
            : external.data
              ? { kind: "ready", count: external.data.entries.length, fetchedAt: external.data.fetchedAt, warnings: external.data.warnings }
              : { kind: "idle" }
      }
      now={now}
      styles={styles}
      theme={theme}
      onToggle={() => setShowExternal((shown) => !shown)}
      onRefresh={() => {
        refreshExternal.current = true;
        setShowExternal(true);
        void external.refetch();
      }}
    />
  ) : null;

  const segments = (
    <View style={styles.segments} accessibilityRole="tablist">
      {SCOPES.map((option) => {
        const active = option.value === scope;
        return (
          <Interactive
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityHint={data ? scopeHint(data, option.value) : option.hint}
            testID={`past-sessions-scope-${option.value}`}
            onPress={() => onScopeChange(option.value)}
            onHoverIn={() => prefetchScope(option.value)}
            onPressIn={() => prefetchScope(option.value)}
            style={({ focused }) => [
              styles.segment,
              active ? styles.segmentActive : null,
              focused ? styles.focusRing : null,
            ]}
          >
            {({ hovered }) => (
              <Text
                ref={tooltip(data ? scopeHint(data, option.value) : option.hint)}
                style={[styles.segmentText, active || hovered ? styles.segmentTextHot : null]}
              >
                {option.label}
              </Text>
            )}
          </Interactive>
        );
      })}
    </View>
  );

  const nextDensity = NEXT_DENSITY[density];
  const densityToggle = (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel={nextDensity.label}
      testID="past-sessions-density"
      onPress={() => setDensity(nextDensity.value)}
      style={({ hovered, pressed, focused }) => [
        styles.iconButton,
        hovered ? styles.iconButtonHovered : null,
        pressed ? styles.iconButtonPressed : null,
        focused ? styles.focusRing : null,
      ]}
    >
      {({ hovered }) => (
        <View ref={tooltip(nextDensity.label)}>
          <Icon name={nextDensity.icon} size={15} color={hovered ? theme.colors.foreground : muted} />
        </View>
      )}
    </Interactive>
  );

  const search = (
    <View style={[styles.search, ownSearchLine ? null : styles.searchInline, searchFocused ? styles.searchFocused : null]}>
      <Icon name="Search" size={14} color={muted} />
      <TextInput
        testID="past-sessions-search"
        value={query}
        onChangeText={setQuery}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        placeholder={
          data
            ? `Search ${data.entries.length + data.sameFolder.length - (showHidden ? 0 : hiddenCount)} sessions`
            : "Search sessions"
        }
        placeholderTextColor={muted}
        autoCorrect={false}
        autoCapitalize="none"
        style={styles.searchInput}
      />
      {query ? (
        <Interactive
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => setQuery("")}
          style={({ hovered, focused }) => [
            styles.clear,
            hovered ? styles.iconButtonPressed : null,
            focused ? styles.focusRing : null,
          ]}
        >
          <Icon name="X" size={13} color={muted} />
        </Interactive>
      ) : null}
    </View>
  );

  const refresh = (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel="Refresh"
      disabled={refreshing}
      onPress={() => {
        setRefreshing(true);
        void result.refetch().finally(() => setRefreshing(false));
      }}
      style={({ hovered, pressed, focused }) => [
        styles.iconButton,
        hovered ? styles.iconButtonHovered : null,
        pressed ? styles.iconButtonPressed : null,
        focused ? styles.focusRing : null,
      ]}
    >
      {({ hovered }) =>
        refreshing ? (
          <ActivityIndicator size="small" color={muted} />
        ) : (
          <Icon name="RefreshCw" size={15} color={hovered ? theme.colors.foreground : muted} />
        )
      }
    </Interactive>
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.toolbar}>
        {segments}
        {ownSearchLine ? <View style={styles.spacer} /> : search}
        {densityToggle}
        {refresh}
      </View>
      {ownSearchLine ? <View style={styles.searchRow}>{search}</View> : null}
      {data?.warnings.map((warning) => (
        <Text key={warning} style={styles.warning} numberOfLines={2}>
          {warning}
        </Text>
      ))}
    </View>
  );

  let body: ReactNode;
  if (!data && result.isError) {
    body = (
      <StateMessage
        styles={styles}
        theme={theme}
        icon="TriangleAlert"
        title="Couldn't load past sessions"
        detail={result.error instanceof Error ? result.error.message : String(result.error)}
        action={{ label: "Try again", onPress: () => void result.refetch() }}
      />
    );
  } else if (!data) {
    body = <StateMessage styles={styles} theme={theme} icon="History" title="Reading sessions…" busy />;
  } else {
    const renderItem = ({ item, index }: { item: ListItem; index: number }) => {
      if (item.kind === "empty") {
        const message = emptyMessage(scope, query);
        return <StateMessage styles={styles} theme={theme} icon="Inbox" title={message.title} detail={message.detail} />;
      }
      if (item.kind === "same-folder-header") {
        return (
          <Interactive
            accessibilityRole="button"
            accessibilityState={{ expanded: item.open }}
            testID="past-sessions-same-folder"
            onPress={() => setSameFolderOpen((open) => !open)}
            style={({ hovered, focused }) => [
              styles.folderHeader,
              hovered ? styles.folderHeaderHovered : null,
              focused ? styles.focusRingInset : null,
            ]}
          >
            {({ hovered }) => (
              <>
                <Icon
                  name={item.open ? "ChevronDown" : "ChevronRight"}
                  size={14}
                  color={hovered ? theme.colors.foreground : muted}
                />
                <View style={styles.folderHeaderBody}>
                  <Text style={styles.folderHeaderTitle}>Terminal sessions in this folder</Text>
                  <Text style={styles.folderHeaderHint} numberOfLines={2}>
                    Never opened in Paseo. Click one to import it.
                  </Text>
                </View>
                <View style={styles.count}>
                  <Text style={styles.countText}>{item.count}</Text>
                </View>
              </>
            )}
          </Interactive>
        );
      }
      const chip = folderChip(item.entry.cwd, data.folder, data.home);
      return (
        <SessionRow
          entry={item.entry}
          chipLabel={chip?.label ?? null}
          chipPath={chip?.path ?? null}
          time={relativeTime(item.entry.at, now, density === "compact")}
          timeTitle={`Last active ${absoluteTime(item.entry.at)}`}
          divider={items[index - 1]?.kind === "row"}
          density={density}
          compact={compact}
          starred={marks.starred.has(item.entry.key)}
          hidden={marks.hidden.has(item.entry.key)}
          serverId={serverId}
          snapshotSvg={snapshotIcons.get(item.entry.provider)}
          styles={styles}
          theme={theme}
          onOpen={mutation.mutate}
          onMark={markMutation.mutate}
          onMenu={setMenuFor}
          onHover={onRowHover}
        />
      );
    };
    const repeated = data.stats.hiddenKnownToPaseo;
    body = (
      <FlatList
        style={{ flex: 1, minHeight: 0 }}
        data={items}
        extraData={[density, marks]}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        initialNumToRender={30}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={externalControl ? <View style={styles.externalRow}>{externalControl}</View> : null}
        ListFooterComponent={
          <>
            {hiddenCount > 0 ? (
              <View style={styles.footerHidden}>
                <Interactive
                  accessibilityRole="switch"
                  accessibilityState={{ checked: showHidden }}
                  testID="past-sessions-show-hidden"
                  onPress={() => setShowHidden((shown) => !shown)}
                  style={({ hovered, focused }) => [
                    styles.externalButton,
                    hovered ? styles.iconButtonHovered : null,
                    focused ? styles.focusRing : null,
                  ]}
                >
                  {({ hovered }) => (
                    <>
                      <Icon name={showHidden ? "EyeOff" : "Eye"} size={13} color={hovered ? theme.colors.foreground : muted} />
                      <Text style={[styles.externalText, hovered ? styles.externalTextHot : null]}>
                        {showHidden ? `Hide ${hiddenCount} hidden` : `Show ${hiddenCount} hidden`}
                      </Text>
                    </>
                  )}
                </Interactive>
              </View>
            ) : null}
            {repeated > 0 ? (
              <Text style={styles.footer} testID="past-sessions-footer">
                {repeated} terminal {repeated === 1 ? "session is" : "sessions are"} already in Paseo and not repeated.
              </Text>
            ) : (
              <View style={{ height: 24 }} />
            )}
          </>
        }
      />
    );
  }

  return (
    <View
      style={styles.root}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width < NARROW_WIDTH;
        if (next !== narrow) setNarrow(next);
      }}
    >
      {header}
      {body}
      <Modal
        title={menuFor?.title ?? ""}
        open={menuFor !== null}
        onOpenChange={(open) => {
          if (!open) setMenuFor(null);
        }}
      >
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>
          {menuFor
            ? (["starred", "hidden"] as const).map((mark) => {
                const on = marks[mark].has(menuFor.key);
                const option = {
                  starred: on ? { icon: "Star", label: "Unstar" } : { icon: "Star", label: "Star: list it first" },
                  hidden: on ? { icon: "Eye", label: "Unhide: list it again" } : { icon: "EyeOff", label: "Hide from Past sessions" },
                }[mark];
                return (
                  <Interactive
                    key={mark}
                    accessibilityRole="button"
                    testID={`past-sessions-menu-${mark}`}
                    onPress={() => {
                      markMutation.mutate({ key: menuFor.key, mark, on: !on });
                      setMenuFor(null);
                    }}
                    style={({ pressed }) => [styles.menuOption, pressed ? styles.rowPressed : null]}
                  >
                    <Icon name={option.icon} size={18} color={theme.colors.foreground} />
                    <Text style={styles.menuText}>{option.label}</Text>
                  </Interactive>
                );
              })
            : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}
