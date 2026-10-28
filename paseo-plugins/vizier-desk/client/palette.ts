import type { PluginTheme } from "@getpaseo/plugin";
import { Platform } from "react-native";
import type { PrState } from "../shared/desk";

// Paseo's own look. Text, surfaces and the red/amber/green states come from the theme; the theme has no running blue,
// merged purple, PR dot colours or project palette, so those are Paseo's values (styles/theme.ts), dark and light.

const DARK = {
  running: "#5caaf6",
  pr: { merged: "#9e7ee1", ready: "#35c264", open: "#db932e", conflict: "#f7796d" },
};
const LIGHT = {
  running: "#268ae0",
  pr: { merged: "#7b4ec8", ready: "#299f51", open: "#b37824", conflict: "#f12e2f" },
};
/** Paseo's project palette, the badge colours in its sidebar. */
const PROJECT = ["#7a6aa8", "#3d7ea6", "#388068", "#a4673a", "#b05c80", "#6a70b8", "#368080", "#b06260", "#8f7838", "#5179b0"];

/** What a card's title tick says. */
export type CardState = "blocking" | "revisit" | "whenever" | "doing" | "quiet" | "done" | "stray";

export interface Palette {
  fg: string;
  muted: string;
  /** Paseo's extra-muted: 40% of the foreground. */
  faint: string;
  /** The line under a card's text. */
  meta: string;
  /** The asker's name, a step above the meta line. */
  metaStrong: string;
  /** Lead paragraph and the doing line. */
  body: string;
  s0: string;
  s1: string;
  s2: string;
  border: string;
  accent: string;
  ok: string;
  warn: string;
  danger: string;
  running: string;
  pr(state: PrState): string;
  state(state: CardState): string;
  /** Project badge colour for a workspace hue (1-based). */
  project(hue: number): string;
  /** `color` at `alpha` (0–1). */
  alpha(color: string, alpha: number): string;
}

function rgb(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((ch) => ch + ch).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function alpha(color: string, a: number): string {
  const c = rgb(color);
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})` : color;
}

export function paletteOf(theme: PluginTheme): Palette {
  const { colors } = theme;
  const bg = rgb(colors.surface0);
  const light = bg ? (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 > 0.5 : false;
  const set = light ? LIGHT : DARK;
  const fg = colors.foreground;
  const faint = alpha(fg, 0.4);
  const states: Record<CardState, string> = {
    blocking: colors.statusDanger,
    revisit: colors.statusWarning,
    whenever: alpha(fg, 0.3),
    doing: set.running,
    quiet: alpha(set.running, 0.4),
    done: alpha(colors.statusSuccess, 0.5),
    stray: alpha(fg, 0.15),
  };
  return {
    fg,
    muted: colors.foregroundMuted,
    faint,
    meta: alpha(fg, 0.75),
    metaStrong: alpha(fg, 0.95),
    body: alpha(fg, 0.55),
    s0: colors.surface0,
    s1: colors.surface1,
    s2: colors.surface2,
    border: colors.border,
    accent: colors.accent,
    ok: colors.statusSuccess,
    warn: colors.statusWarning,
    danger: colors.statusDanger,
    running: set.running,
    pr: (state) => (state === "closed" ? colors.foregroundMuted : state === "draft" || state === "unknown" ? faint : set.pr[state]),
    state: (s) => states[s],
    project: (hue) => PROJECT[(hue - 1 + PROJECT.length) % PROJECT.length]!,
    alpha,
  };
}

/** One step below Paseo's chat sizes, as on the mock. */
export const TYPE = {
  heading: { fontSize: 13, lineHeight: 18 },
  title: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 12, lineHeight: 17 },
  small: { fontSize: 11, lineHeight: 15 },
} as const;

export const MONO = Platform.select({ ios: "Menlo", web: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", default: "monospace" });
