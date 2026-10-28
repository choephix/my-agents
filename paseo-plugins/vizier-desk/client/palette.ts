import type { PluginTheme } from "@getpaseo/plugin";
import { Platform } from "react-native";
import type { PrState } from "../shared/desk";

// The desk's own colours, the same as Mainframe's /desk (public/style.css, `--pr-*`, `--pri-*`, `--ws-*`), dark and
// light. PR states are the most saturated thing on the screen; priority, age and workspace hues are dialled back.

const DARK = {
  pr: { merged: "#a371f7", ready: "#3fb950", open: "#d29922", conflict: "#f85149", closed: "#f85149", draft: "#8b949e" },
  blocking: "#e5484d",
  revisit: "#6ea6f5",
  hues: ["#7aa2f7", "#9ece6a", "#e0af68", "#bb9af7", "#7dcfff", "#f7768e", "#73daca", "#c0caf5", "#ff9e64", "#b4f9f8", "#c3e88d", "#e68ac2"],
};
const LIGHT = {
  pr: { merged: "#8250df", ready: "#1a7f37", open: "#9a6700", conflict: "#cf222e", closed: "#cf222e", draft: "#6e7781" },
  blocking: "#d1242f",
  revisit: "#1f6feb",
  hues: ["#2f5fd0", "#3f8f2a", "#a4731c", "#7b4fd1", "#1a7fa8", "#c2405a", "#1f8f80", "#5b6a9a", "#c25e14", "#1f8a8a", "#5e8a1f", "#b03a8a"],
};

export interface Palette {
  fg: string;
  muted: string;
  s0: string;
  s1: string;
  s2: string;
  border: string;
  accent: string;
  ok: string;
  warn: string;
  pr(state: PrState): string;
  blocking: string;
  revisit: string;
  hue(n: number): string;
  /** `color` at `alpha` (0–1), for tints and dialled-back marks. */
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
  return {
    fg: colors.foreground,
    muted: colors.foregroundMuted,
    s0: colors.surface0,
    s1: colors.surface1,
    s2: colors.surface2,
    border: colors.border,
    accent: colors.accent,
    ok: colors.statusSuccess,
    warn: colors.statusWarning,
    pr: (state) => (state === "unknown" ? colors.foregroundMuted : set.pr[state]),
    blocking: set.blocking,
    revisit: set.revisit,
    hue: (n) => set.hues[(n - 1 + set.hues.length) % set.hues.length]!,
    alpha,
  };
}

/** Paseo's type ramp (Interface size 14). */
export const TYPE = {
  title: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 13, lineHeight: 19 },
  small: { fontSize: 12, lineHeight: 17 },
  label: { fontSize: 11, lineHeight: 15 },
} as const;

export const MONO = Platform.select({ ios: "Menlo", web: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", default: "monospace" });
