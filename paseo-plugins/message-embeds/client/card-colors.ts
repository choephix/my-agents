import type { PluginTheme } from "@getpaseo/plugin";

type Rgba = [number, number, number, number];

function parse(color: string): Rgba | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim())?.[1];
  if (hex && (hex.length === 3 || hex.length === 4)) {
    const [r, g, b, a = "f"] = hex.split("").map(c => c + c);
    return [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16), parseInt(a + a, 16) / 255];
  }
  if (hex && (hex.length === 6 || hex.length === 8)) {
    const part = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return [part(0), part(2), part(4), hex.length === 8 ? part(6) / 255 : 1];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(color.trim())?.[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (fn && fn.length >= 3 && fn.every(n => !Number.isNaN(n))) return [fn[0], fn[1], fn[2], fn[3] ?? 1];
  return null;
}

/** `amount` of the way from `from` to `to`; `from` itself when either colour isn't hex or rgb(). */
function mix(from: string, to: string, amount: number): string {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return from;
  const [r, g, bl, al] = a.map((value, i) => value + (b[i] - value) * amount);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bl)}, ${al.toFixed(3)})`;
}

/**
 * Card colours from theme tokens, so light and dark themes both work: the background sits a
 * little toward `surface2`, and hovering moves the outline a little toward the muted text colour.
 */
export function cardColors(theme: PluginTheme) {
  const c = theme.colors;
  return {
    background: mix(c.surface1, c.surface2, 0.4),
    border: c.border,
    borderHover: mix(c.border, c.foregroundMuted, 0.3),
  };
}
