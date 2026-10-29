import type { EditKind, LineKind, TokenKind } from "./model";

// Syntax palettes copied from Paseo 0.11.4 (packages/highlight/src/themes.ts + colors.ts, Settings →
// Appearance → Syntax theme) so context lines match Paseo's own code blocks. Added/removed lines use
// Stefan's pick from the style workshop (variant 11, 2026-10-20): neon green/red with a 2 px gutter
// bar, a 6% row tint, syntax colors pulled halfway toward the line color, and reverse-video word marks.

export type Scheme = "light" | "dark";

interface RolePalette {
  keyword: string;
  comment: string;
  string: string;
  number: string;
  function: string;
  type: string;
  tag: string;
  attribute: string;
  operator: string;
}

const role = (keyword: string, comment: string, string: string, number: string, fn: string, type: string, tag: string, attribute: string, operator: string): RolePalette => ({
  keyword,
  comment,
  string,
  number,
  function: fn,
  type,
  tag,
  attribute,
  operator,
});

const SYNTAX: Record<string, { light: RolePalette; dark: RolePalette }> = {
  // GitHub keeps its own map upstream; its roles are listed in the same order as the rest.
  github: {
    light: role("#cf222e", "#6e7781", "#0a3069", "#0550ae", "#8250df", "#953800", "#116329", "#0550ae", "#0550ae"),
    dark: role("#ff7b72", "#8b949e", "#a5d6ff", "#79c0ff", "#d2a8ff", "#ffa657", "#7ee787", "#79c0ff", "#79c0ff"),
  },
  catppuccin: {
    light: role("#8839ef", "#8c8fa1", "#40a02b", "#fe640b", "#1e66f5", "#df8e1d", "#8839ef", "#df8e1d", "#04a5e5"),
    dark: role("#cba6f7", "#9399b2", "#a6e3a1", "#fab387", "#89b4fa", "#f9e2af", "#cba6f7", "#f9e2af", "#89dceb"),
  },
  dracula: {
    light: role("#ff79c6", "#6272a4", "#f1fa8c", "#bd93f9", "#50fa7b", "#8be9fd", "#ff79c6", "#50fa7b", "#ff79c6"),
    dark: role("#ff79c6", "#6272a4", "#f1fa8c", "#bd93f9", "#50fa7b", "#8be9fd", "#ff79c6", "#50fa7b", "#ff79c6"),
  },
  "tokyo-night": {
    light: role("#9854f1", "#848cb5", "#587539", "#b15c00", "#2e7de9", "#007197", "#f52a65", "#8c6c3e", "#006a83"),
    dark: role("#bb9af7", "#565f89", "#9ece6a", "#ff9e64", "#7aa2f7", "#2ac3de", "#f7768e", "#e0af68", "#89ddff"),
  },
  one: {
    light: role("#a626a4", "#a0a1a7", "#50a14f", "#986801", "#4078f2", "#c18401", "#e45649", "#986801", "#0184bc"),
    dark: role("#c678dd", "#5c6370", "#98c379", "#d19a66", "#61afef", "#e5c07b", "#e06c75", "#d19a66", "#56b6c2"),
  },
  nord: {
    light: role("#5e81ac", "#6b7280", "#4f6f3a", "#8f5e91", "#2e6f8e", "#3b7f87", "#5e81ac", "#8f5e91", "#5e81ac"),
    dark: role("#81a1c1", "#616e88", "#a3be8c", "#b48ead", "#88c0d0", "#8fbcbb", "#81a1c1", "#8fbcbb", "#81a1c1"),
  },
  gruvbox: {
    light: role("#9d0006", "#928374", "#79740e", "#8f3f71", "#427b58", "#b57614", "#076678", "#b57614", "#af3a03"),
    dark: role("#fb4934", "#928374", "#b8bb26", "#d3869b", "#8ec07c", "#fabd2f", "#83a598", "#fabd2f", "#fe8019"),
  },
  solarized: {
    light: role("#859900", "#93a1a1", "#2aa198", "#d33682", "#268bd2", "#b58900", "#268bd2", "#b58900", "#859900"),
    dark: role("#859900", "#586e75", "#2aa198", "#d33682", "#268bd2", "#b58900", "#268bd2", "#b58900", "#859900"),
  },
};

export type Side = "add" | "del";

/** Neon green/red of added and removed lines; signs, gutter bars, row tints and word marks derive from it. */
const LINE: Record<Scheme, Record<Side, string>> = {
  light: { add: "#00a843", del: "#e0002b" },
  dark: { add: "#00e676", del: "#ff1744" },
};

/** Share of the line color mixed into text on added and removed lines. */
const LINE_TINT = 0.5;

/** `color` pulled toward `toward` by `share`, mixed as the eye sees it. */
export const tint = (color: string, toward: string, share = LINE_TINT) =>
  `color-mix(in oklab, ${color} ${Math.round((1 - share) * 100)}%, ${toward})`;

export interface DiffPalette {
  /** Text colors on context, header and hunk lines. */
  tokens: Record<TokenKind, string>;
  /** Text colors on added and removed lines: each syntax color tinted toward the line color. */
  changedTokens: Record<Side, Record<TokenKind, string>>;
  /** Line colors; plain text on changed lines is the foreground tinted toward them (see `tint`). */
  lines: Record<Side, string>;
  /** Changed words: solid line color with white text (reverse video). */
  edits: Record<EditKind, string>;
  editText: string;
  /** Full-width row bands; kinds without one keep the block's own surface. */
  rows: Partial<Record<LineKind, string>>;
  /** Gutter bar at the left edge of added and removed rows. */
  bars: Partial<Record<LineKind, string>>;
  /** Laid over the theme's block background: half black in dark themes, half white in light. */
  shade: string;
}

const withAlpha = (hex: string, alpha: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${alpha})`;

/** Paseo's default syntax theme is "one"; unknown ids fall back to it, as Paseo does. */
export function diffPalette(syntaxTheme: string, scheme: Scheme): DiffPalette {
  const syntax = (SYNTAX[syntaxTheme] ?? SYNTAX.one!)[scheme];
  const line = LINE[scheme];
  const tokens: Record<TokenKind, string> = {
    keyword: syntax.keyword,
    comment: syntax.comment,
    string: syntax.string,
    number: syntax.number,
    literal: syntax.number,
    function: syntax.function,
    type: syntax.type,
    tag: syntax.tag,
    attribute: syntax.attribute,
    property: syntax.attribute,
    operator: syntax.operator,
    addSign: line.add,
    delSign: line.del,
    header: syntax.comment,
    hunk: syntax.function,
  };
  const tinted = (side: Side) =>
    Object.fromEntries(Object.entries(tokens).map(([kind, color]) => [kind, tint(color, line[side])])) as Record<TokenKind, string>;
  // Never dark text on a dark block: in dark themes the solid mark is the line color pulled 40%
  // toward black, so white text stays readable; light themes keep the full color.
  const mark = (color: string) => (scheme === "dark" ? `color-mix(in oklab, ${color} 60%, black)` : color);
  return {
    tokens,
    changedTokens: { add: tinted("add"), del: tinted("del") },
    lines: line,
    edits: { addEdit: mark(line.add), delEdit: mark(line.del) },
    editText: "#ffffff",
    rows: {
      add: withAlpha(line.add, 0.06),
      del: withAlpha(line.del, 0.06),
      // A faint band in the hunk color separates hunks, as GitHub's blue hunk rows do; file
      // headers get a neutral band so each file of a multi-file diff starts visibly.
      hunk: withAlpha(syntax.function, 0.1),
      header: withAlpha(syntax.comment, 0.12),
    },
    bars: { add: line.add, del: line.del },
    shade: scheme === "dark" ? "rgba(0, 0, 0, 0.5)" : "rgba(255, 255, 255, 0.5)",
  };
}
