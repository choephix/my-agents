import type { PluginTheme } from "@getpaseo/plugin";

type Rgb = [number, number, number];

function parseColor(color: string): Rgb | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color.trim());
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/**
 * How far Paseo's `foregroundExtraMuted` sits from `foregroundMuted` toward `surface1`: dark
 * #A1A5A4 → #717574 over #1E2120, light #71717a → #a1a1aa over #fafafa.
 */
const EXTRA_MUTED_MIX = 0.366;

/** Paseo's fainter grey (hints, sidebar meta), which the plugin theme leaves out. */
export function extraMuted(theme: PluginTheme): string {
  const muted = parseColor(theme.colors.foregroundMuted);
  const surface = parseColor(theme.colors.surface1);
  if (!muted || !surface) return theme.colors.foregroundMuted;
  const mixed = muted.map((channel, index) => Math.round(channel + (surface[index] - channel) * EXTRA_MUTED_MIX));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
