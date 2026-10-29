import { openExternalUrl, type PluginHostProps } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View, type PressableStateCallbackType, type TextStyle } from "react-native";
import type { Link, LinkKind } from "../shared/links";
import { rowMark } from "./store";
import { queryParts, shortenPath, variantRows } from "./variants";

/** The list parts the composer popover and the links page share: type tabs, sub-agents switch, rows. */

export const KIND_LABEL: Record<LinkKind, string> = { web: "Web", image: "Images", file: "Files" };
const COPIED_MS = 1_500;

/** `now`, `5m`, `3h`, `2d`. */
export function ago(at: number, now: number): string {
  const minutes = (now - at) / 60_000;
  if (minutes < 1) return "now";
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1_440)}d`;
}

/** RN Web passes `hovered`; native only `pressed`. */
export type PressState = PressableStateCallbackType & { hovered?: boolean };

type Theme = PluginHostProps["theme"];

/** `#rgb`, `#rrggbb` or `rgb()` at `alpha`; other colour forms come back as they are. */
function fade(color: string, alpha: number): string {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color)?.[1];
  const rgb = hex
    ? (hex.length === 3 ? [...hex].map((digit) => digit + digit) : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]).map((pair) => parseInt(pair, 16))
    : /^rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)$/i.exec(color)?.slice(1).map(Number);
  return rgb ? `rgba(${rgb.join(", ")}, ${alpha})` : color;
}

/** Paseo's real sizes: 13 px paths, 12 px muted marks and tabs, 11 px counts; 28 px rows on desktop, 40 px on phones. */
function buildStyles(theme: Theme, compact: boolean) {
  const muted = theme.colors.foregroundMuted;
  return {
    muted,
    header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, marginBottom: 4 },
    tabs: { flex: 1, flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 4 },
    tab: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      height: compact ? 28 : 22,
      paddingHorizontal: 8,
      borderRadius: 11,
    },
    tabOn: { backgroundColor: theme.colors.surface2 },
    tabText: { fontSize: 12, color: muted },
    tabTextOn: { fontSize: 12, color: theme.colors.foreground },
    tabCount: { fontSize: 11, color: muted, fontVariant: ["tabular-nums" as const] },
    // Not a tab: a small text switch that adds rows, faint while off.
    subagents: { fontSize: 11, color: muted, opacity: 0.6, fontVariant: ["tabular-nums" as const] },
    subagentsHover: { fontSize: 11, color: muted, fontVariant: ["tabular-nums" as const] },
    subagentsOn: { fontSize: 11, color: theme.colors.foreground, fontVariant: ["tabular-nums" as const] },
    line: { fontSize: 12, color: muted },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      height: compact ? 40 : 28,
      paddingHorizontal: 8,
      marginHorizontal: -8,
      borderRadius: 6,
    },
    rowActive: { backgroundColor: theme.colors.surface2 },
    // The path takes the row's width; `pathBox` is what gets measured for shortening.
    pathBox: { flex: 1, minWidth: 0 },
    path: { fontSize: 13, color: theme.colors.foreground },
    pathMissing: { fontSize: 13, color: muted, textDecorationLine: "line-through" as const },
    mark: { flexShrink: 0, maxWidth: "40%" as const, fontSize: 12, color: muted },
    // `×N` at the right edge: how many distinct full URLs (query strings, fragments) the row unfolds.
    variants: { flexShrink: 0, fontSize: 11, color: muted, opacity: 0.7, fontVariant: ["tabular-nums" as const] },
    variantsOn: { flexShrink: 0, fontSize: 11, color: theme.colors.foreground, fontVariant: ["tabular-nums" as const] },
    // Unfolded variants: sub-rows on a faint rail under the glyph, their text under the path. The
    // theme's `border` vanishes on the popover's surface, so the rail is the muted colour, faded.
    rail: { marginLeft: 6 },
    railLine: { position: "absolute" as const, zIndex: 1, left: 0, top: 2, bottom: 2, width: 1, backgroundColor: muted, opacity: 0.25 },
    sub: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      minHeight: compact ? 36 : 24,
      paddingVertical: compact ? 4 : 3,
      paddingLeft: 16,
      paddingRight: 8,
      marginRight: -8,
      borderRadius: 6,
    },
    // A literal query, wrapped in full: `?`, `&`, `=` and keys in the muted colour faded, values in
    // the foreground, distinct even where the muted colour is nearly white. Breaks anywhere (web).
    subText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, color: fade(muted, 0.6), wordBreak: "break-all" } as TextStyle,
    subValue: { color: theme.colors.foreground },
    noParams: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, color: muted },
    time: { flexShrink: 0, textAlign: "right" as const, fontSize: 12, color: muted, fontVariant: ["tabular-nums" as const] },
    copied: { flexShrink: 0, textAlign: "right" as const, fontSize: 12, color: theme.colors.foreground },
  };
}

const built = new WeakMap<Theme, Map<boolean, ReturnType<typeof buildStyles>>>();

/** The shared list styles for a theme and layout, built once per theme object. */
export function listStyles(theme: Theme, compact: boolean) {
  let forTheme = built.get(theme);
  if (!forTheme) built.set(theme, (forTheme = new Map()));
  let styles = forTheme.get(compact);
  if (!styles) forTheme.set(compact, (styles = buildStyles(theme, compact)));
  return styles;
}

/** One tab per type present, with its count; the shown type is lit. Only rendered with 2+ types. */
export function TypeTabs(props: {
  theme: Theme;
  compact: boolean;
  kinds: readonly { kind: LinkKind; count: number }[];
  shown: LinkKind | null;
  onChoose(kind: LinkKind): void;
}) {
  const { kinds, shown, onChoose } = props;
  const styles = listStyles(props.theme, props.compact);
  return kinds.map(({ kind, count }) => {
    const on = kind === shown;
    return (
      <Pressable
        key={kind}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`Show ${KIND_LABEL[kind].toLowerCase()}`}
        onPress={() => onChoose(kind)}
        style={({ hovered }: PressState) => [styles.tab, (on || hovered) && styles.tabOn]}
      >
        <Text style={on ? styles.tabTextOn : styles.tabText}>{KIND_LABEL[kind]}</Text>
        <Text style={styles.tabCount}>{count}</Text>
      </Pressable>
    );
  });
}

/** `+N subagents`: a small right-aligned text switch, faint while off, full colour while on. */
export function SubagentsSwitch(props: { theme: Theme; compact: boolean; extra: number; on: boolean; onToggle(): void }) {
  const { extra, on, onToggle } = props;
  const styles = listStyles(props.theme, props.compact);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={on ? "Hide links from subagents" : `Show ${extra} more ${extra === 1 ? "link" : "links"} from subagents`}
      onPress={onToggle}
      hitSlop={6}
    >
      {({ hovered }: PressState) => <Text style={on ? styles.subagentsOn : hovered ? styles.subagentsHover : styles.subagents}>{`+${extra} subagents`}</Text>}
    </Pressable>
  );
}

/**
 * What a click does: web and images open in the browser (then `after`, e.g. closing the popover);
 * files copy their path and the row says "copied" for a moment. `open` opens one exact URL (a variant).
 */
export function useLinkPress(after?: () => void): { press(link: Link): void; open(url: string): void; copied: string | null } {
  const toast = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const open = useCallback(
    (url: string) => {
      openExternalUrl(url).catch(() => toast.error(`Couldn't open ${url}`));
      after?.();
    },
    [after, toast],
  );
  const press = useCallback(
    (link: Link) => {
      if (link.kind === "file") {
        copyText(link.copy ?? link.title).then(
          () => setCopied(link.key),
          () => toast.error("Couldn't copy the path"),
        );
        return;
      }
      if (link.url) open(link.url);
    },
    [open, toast],
  );
  return { press, open, copied };
}

/** Rows whose variants are unfolded, by the caller's `foldKey`; kept until the app reloads. */
const unfolded = new Set<string>();

/** Web: a hover tooltip, none for `""` (React Native Web has no `title` prop). */
function tooltip(text: string) {
  if (Platform.OS !== "web") return undefined;
  return (node: unknown) => (node as { setAttribute?(name: string, value: string): void } | null)?.setAttribute?.("title", text);
}

type Canvas2D = { font: string; measureText(text: string): { width: number } };
type WebGlobals = {
  document?: { createElement(tag: "canvas"): { getContext(kind: "2d"): Canvas2D | null } };
  getComputedStyle?(node: unknown): { fontWeight: string; fontSize: string; fontFamily: string };
};
/** The web's canvas measures text exactly, in the font read off the first rendered path. */
let canvas: Canvas2D | null | undefined;
let pathFont = "";
const PATH_SIZE = 13;

function readPathFont(node: unknown) {
  if (pathFont || Platform.OS !== "web" || !node) return;
  const style = (globalThis as WebGlobals).getComputedStyle?.(node);
  if (style) pathFont = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/** A path's width in pixels: measured on the web, estimated (0.6 em per character) elsewhere. */
function pathWidth(text: string): number {
  if (canvas === undefined) canvas = Platform.OS === "web" ? ((globalThis as WebGlobals).document?.createElement("canvas").getContext("2d") ?? null) : null;
  if (!canvas || !pathFont) return text.length * PATH_SIZE * 0.6;
  canvas.font = pathFont;
  return canvas.measureText(text).width;
}

/** The row's path in the width it gets, shortened by `shortenPath`; the full path as the web tooltip. */
function RowPath(props: { theme: Theme; compact: boolean; link: Link }) {
  const { link } = props;
  const styles = listStyles(props.theme, props.compact);
  const [width, setWidth] = useState(0);
  const shown = width > 0 ? shortenPath(link.path, (text) => pathWidth(text) <= width) : link.path;
  return (
    <View ref={tooltip(shown === link.path ? "" : link.path)} style={styles.pathBox} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Text ref={readPathFont} numberOfLines={1} style={link.missing ? styles.pathMissing : styles.path}>
        {shown}
      </Text>
    </View>
  );
}

/**
 * glyph · path (shortened to fit; struck through when missing) · muted `missing` / `↳ sub-agent` ·
 * `tab` slot · time (desktop, on hover) · `×N`. A row with variants folds and unfolds them on a
 * click (and → / ← on the focused row, web): `no params` for the bare URL, then each variant's
 * literal query, newest first; a sub-row opens its URL with `onOpen`. Any other row opens or copies.
 */
export function LinkRow(props: {
  theme: Theme;
  compact: boolean;
  link: Link;
  now: number;
  copied: boolean;
  onPress(link: Link): void;
  onOpen(url: string): void;
  /** Identifies the row for its fold state: the chat or workspace (and tab) plus the link key. */
  foldKey: string;
  tab?: ReactNode;
}) {
  const { link, now, copied, onPress, onOpen, foldKey, tab, compact } = props;
  const styles = listStyles(props.theme, compact);
  const [open, setOpen] = useState(() => unfolded.has(foldKey));
  const fold = (next: boolean) => {
    if (next) unfolded.add(foldKey);
    else unfolded.delete(foldKey);
    setOpen(next);
  };
  const count = link.variants?.length ?? 0;
  const mark = rowMark(link);
  const keys = count
    ? {
        onKeyDown: (event: { key: string }) => {
          if (event.key === "ArrowRight" && !open) fold(true);
          else if (event.key === "ArrowLeft" && open) fold(false);
        },
      }
    : {};
  const label = count ? `${open ? "Hide" : "Show"} ${count} variants of ${link.path}` : link.kind === "file" ? `Copy ${link.copy}` : `Open ${link.url}`;
  return (
    <View {...(keys as object)}>
      <Pressable
        accessibilityRole={count || link.kind === "file" ? "button" : "link"}
        accessibilityState={count ? { expanded: open } : undefined}
        accessibilityLabel={label}
        onPress={() => (count ? fold(!open) : onPress(link))}
        style={({ hovered, pressed }: PressState) => [styles.row, (hovered || pressed) && styles.rowActive]}
      >
        {({ hovered }: PressState) => (
          <>
            <Icon name={link.glyph} size={14} color={styles.muted} />
            <RowPath theme={props.theme} compact={compact} link={link} />
            {mark ? (
              <Text numberOfLines={1} style={styles.mark}>
                {mark}
              </Text>
            ) : null}
            {tab}
            {/* Phones have no hover, so they show no time. */}
            {copied ? <Text style={styles.copied}>copied</Text> : hovered && !compact ? <Text style={styles.time}>{ago(link.lastAt, now)}</Text> : null}
            {count ? <Text style={open ? styles.variantsOn : styles.variants}>{`×${count}`}</Text> : null}
          </>
        )}
      </Pressable>
      {open && count ? (
        <View style={styles.rail}>
          <View style={styles.railLine} />
          {variantRows(link).map((sub) => (
            <Pressable
              key={sub.url}
              ref={tooltip(sub.url)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${sub.url}`}
              onPress={() => onOpen(sub.url)}
              style={({ hovered, pressed }: PressState) => [styles.sub, (hovered || pressed) && styles.rowActive]}
            >
              {({ hovered }: PressState) =>
                sub.query ? (
                  <>
                    <Text style={styles.subText}>
                      {queryParts(sub.query).map((part, at) =>
                        part.value ? (
                          <Text key={at} style={styles.subValue}>
                            {part.text}
                          </Text>
                        ) : (
                          part.text
                        ),
                      )}
                    </Text>
                    {hovered && !compact && sub.lastAt !== undefined ? <Text style={styles.time}>{ago(sub.lastAt, now)}</Text> : null}
                  </>
                ) : (
                  <Text style={styles.noParams}>no params</Text>
                )
              }
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
