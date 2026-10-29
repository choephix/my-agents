import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Platform, StyleSheet, Text, View, type TextStyle } from "react-native";
import type { Counts, TicketState } from "../shared/rpc";

/** Paseo's default type ramp (Interface size 14): 14/20 titles, 13 rows, 12/17 the rest, 11 labels. */
export const BASE = { fontSize: 14, lineHeight: 20 } as const;
export const ROW = { fontSize: 13, lineHeight: 18 } as const;
export const SMALL = { fontSize: 12, lineHeight: 17 } as const;
export const LABEL = { fontSize: 11, lineHeight: 15 } as const;
export const MONO = Platform.select({
  ios: "ui-monospace",
  web: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  default: "monospace",
});

export interface Palette {
  fg: string;
  muted: string;
  s0: string;
  s1: string;
  s2: string;
  /** Done-bar track and quote bar: surface2 on dark themes; on light ones surface2 is near-white, so a grey mix. */
  track: string;
  border: string;
  green: string;
  amber: string;
  accent: string;
  accentFg: string;
  /**
   * Hover and press fills, each one step from what the thing rests on: `hover` / `press` on the
   * panel (surface0), `hoverS1` on surface1 (doc chips), `hoverHot` on surface2 (the next row,
   * workspace chips). Paseo's own rows step ~12 levels on hover; surface1 alone is only ~5.
   */
  hover: string;
  press: string;
  hoverS1: string;
  hoverHot: string;
}

/**
 * Colours drawn from Paseo's theme. Done/bars use the success green; amber (statusWarning, the
 * colour of a modified file in the Changes tab) means "changed here, not committed" and nothing else.
 */
export function colorsOf(theme: PluginTheme): Palette {
  const { colors } = theme;
  return {
    fg: colors.foreground,
    muted: colors.foregroundMuted,
    s0: colors.surface0,
    s1: colors.surface1,
    s2: colors.surface2,
    track: lightTrack(colors.surface0, colors.foregroundMuted) ?? colors.surface2,
    border: colors.border,
    green: colors.statusSuccess,
    amber: colors.statusWarning,
    accent: colors.accent,
    accentFg: colors.accentForeground,
    hover: toward(colors.surface0, colors.foreground, HOVER) ?? colors.surface2,
    press: toward(colors.surface0, colors.foreground, PRESS) ?? colors.surface2,
    hoverS1: toward(colors.surface1, colors.foreground, HOVER) ?? colors.surface2,
    hoverHot: toward(colors.surface2, colors.foreground, HOVER) ?? colors.surface2,
  };
}

const HOVER = 0.06;
const PRESS = 0.12;

/** `base` moved `share` of the way to `target`; null when either colour can't be parsed. */
function toward(base: string, target: string, share: number): string | null {
  const b = rgbOf(base);
  const t = rgbOf(target);
  if (!b || !t) return null;
  return `rgb(${b.map((v, i) => Math.round(v + (t[i]! - v) * share)).join(", ")})`;
}

function rgbOf(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((ch) => ch + ch).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** On a light surface, 35 % of the muted text colour over it; null on dark themes or unparsable colours. */
function lightTrack(surface: string, muted: string): string | null {
  const s = rgbOf(surface);
  const m = rgbOf(muted);
  if (!s || !m || s[0] * 0.299 + s[1] * 0.587 + s[2] * 0.114 < 128) return null;
  const mix = s.map((v, i) => Math.round(v * 0.65 + m[i]! * 0.35));
  return `rgb(${mix.join(", ")})`;
}

const G = 11;

/** Ticket status glyph, 11 px, one shape per state so they differ without colour. */
export function Glyph({ state, c }: { state: TicketState; c: Palette }) {
  const ring = { width: G, height: G, borderRadius: G / 2, borderWidth: 1.5 } as const;
  switch (state) {
    case "ready":
      return <View style={[ring, { borderColor: c.fg }]} />;
    case "blocked":
      return (
        <View style={[ring, styles.center, { borderColor: c.muted }]}>
          <View style={{ width: 1.5, height: G - 1, backgroundColor: c.muted, transform: [{ rotate: "45deg" }] }} />
        </View>
      );
    case "claimed":
      return (
        <View style={[ring, { borderColor: c.green, overflow: "hidden" }]}>
          <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (G - 3) / 2, backgroundColor: c.green }} />
        </View>
      );
    case "parked":
      return (
        <View style={[ring, styles.center, { borderColor: c.muted, flexDirection: "row", gap: 1.5 }]}>
          <View style={{ width: 1.3, height: 4, backgroundColor: c.muted }} />
          <View style={{ width: 1.3, height: 4, backgroundColor: c.muted }} />
        </View>
      );
    case "done":
      return (
        <View style={[styles.center, { width: G, height: G, borderRadius: G / 2, backgroundColor: c.green }]}>
          <Icon name="Check" size={8} color={c.s0} />
        </View>
      );
  }
}

/** Share of tickets done: a 4 px bar, one meaning only. */
export function Bar({ done, total, c, width = 34 }: { done: number; total: number; c: Palette; width?: number }) {
  return (
    <View style={{ width, height: 4, borderRadius: 2, backgroundColor: c.track, overflow: "hidden", flexShrink: 0 }}>
      <View style={{ width: total ? `${(done / total) * 100}%` : 0, height: "100%", backgroundColor: c.green }} />
    </View>
  );
}

/**
 * The whole route in one 8 px bar: done, claimed (faint green), open, then blocked and parked
 * (fainter), each as wide as its ticket count; then, when the map has fog, a dashed tail a quarter
 * the width of the tickets. The tail is counted, never sized: a fog patch may become any number of tickets.
 */
export function RouteBar({ counts, fog, c }: { counts: Counts; fog: number; c: Palette }) {
  const parts: [number, string, number][] = [
    [counts.done, c.green, 1],
    [counts.claimed, c.green, 0.45],
    [counts.ready, c.muted, 0.5],
    [counts.blocked + counts.parked, c.muted, 0.22],
  ];
  return (
    <View style={{ flexDirection: "row", gap: 2, height: 8 }}>
      {counts.total ? (
        <View style={{ flex: 4, flexDirection: "row", gap: 2 }}>
          {parts
            .filter(([count]) => count > 0)
            .map(([count, color, opacity], index) => (
              <View key={index} style={{ flex: count, backgroundColor: color, opacity, borderRadius: 2 }} />
            ))}
        </View>
      ) : null}
      {fog ? <View style={{ flex: 1, borderWidth: 1.5, borderStyle: "dashed", borderColor: c.muted, opacity: 0.55, borderRadius: 2, borderTopRightRadius: 6, borderBottomRightRadius: 6 }} /> : null}
    </View>
  );
}

/**
 * One filled wedge of a `size` disc from 12 o'clock clockwise to `share` (0–1), drawn with Views so
 * it renders on web and native alike: each half is a half-disc rotated inside a half-width clip.
 */
function Wedge({ size, share, color, opacity }: { size: number; share: number; color: string; opacity: number }) {
  if (share <= 0) return null;
  const half = size / 2;
  const disc = { position: "absolute", top: 0, width: size, height: size, borderRadius: half, overflow: "hidden" } as const;
  const clip = { position: "absolute", top: 0, width: half, height: size, overflow: "hidden" } as const;
  const fill = { position: "absolute", top: 0, bottom: 0, width: half, backgroundColor: color } as const;
  // Right clip: a disc whose left half is coloured, turned clockwise into view by up to 180°.
  const right = Math.min(share, 0.5) * 360;
  // Left clip, past half: a disc whose right half is coloured, turned on by the remainder.
  const left = Math.max(share - 0.5, 0) * 360;
  return (
    <View style={{ position: "absolute", left: 0, top: 0, width: size, height: size, opacity }}>
      <View style={[clip, { left: half }]}>
        <View style={[disc, { left: -half, transform: [{ rotate: `${right}deg` }] }]}>
          <View style={[fill, { left: 0 }]} />
        </View>
      </View>
      {left > 0 ? (
        <View style={[clip, { left: 0 }]}>
          <View style={[disc, { left: 0, transform: [{ rotate: `${left}deg` }] }]}>
            <View style={[fill, { left: half }]} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The effort's progress at icon size: a thin outline holding a pie, solid green for done and faint
 * green for claimed, the same greens as the panel's bar and the claimed ticket glyph. A pie, not an
 * arc: a part-filled ring this small reads as a loading spinner. `dashed` (no counts) marks a suggestion.
 */
export function Pie({ done, claimed, total, c, size = 16, dashed = false }: { done: number; claimed: number; total: number; c: Palette; size?: number; dashed?: boolean }) {
  const ring = size - 2;
  const disc = ring - 4;
  const doneShare = total ? done / total : 0;
  const claimedShare = total ? Math.min((done + claimed) / total, 1) : 0;
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      <View style={{ width: ring, height: ring, borderRadius: ring / 2, borderWidth: 1.25, borderColor: c.muted, borderStyle: dashed ? "dashed" : "solid" }} />
      <View style={{ position: "absolute", left: (size - disc) / 2, top: (size - disc) / 2, width: disc, height: disc }}>
        <Wedge size={disc} share={claimedShare} color={c.green} opacity={0.4} />
        <Wedge size={disc} share={doneShare} color={c.green} opacity={1} />
      </View>
    </View>
  );
}

/** Amber dot: changed here, not committed. */
export function Dot({ c }: { c: Palette }) {
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.amber, flexShrink: 0 }} />;
}

/** Workspace name chip; `suggested` = outlined with a `?`, not bound; `hot` = on a highlighted (surface2) row. */
export function WsChip({ name, prefix, suggested, hot, hovered, c }: { name: string; prefix?: string; suggested?: boolean; hot?: boolean; hovered?: boolean; c: Palette }) {
  return (
    <View
      style={[
        styles.chip,
        suggested
          ? { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.border, backgroundColor: hovered ? (hot ? c.hoverHot : c.hover) : "transparent" }
          : { backgroundColor: hot ? (hovered ? c.hover : c.s0) : hovered ? c.hoverHot : c.s2 },
      ]}
    >
      <Text numberOfLines={1} style={{ ...SMALL, color: suggested ? c.muted : c.fg, flexShrink: 1 }}>
        {prefix ? <Text style={{ color: c.muted }}>{prefix} › </Text> : null}
        {name}
        {suggested ? "?" : ""}
      </Text>
    </View>
  );
}

/** Small muted tag after a name: the map's Status word. */
export function Tag({ text, c, style }: { text: string; c: Palette; style?: TextStyle }) {
  return (
    <Text
      numberOfLines={1}
      style={[{ ...LABEL, color: c.fg, backgroundColor: c.s2, borderRadius: 5, paddingHorizontal: 5, fontWeight: "500", flexShrink: 0 }, style]}
    >
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 6,
    minWidth: 0,
    flexShrink: 1,
  },
});
