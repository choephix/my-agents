/** Largest ```svg block drawn as a picture, in characters; bigger blocks stay code. */
export const MAX_SVG_CHARS = 256 * 1024;

/** Theme colours an SVG's CSS variables are mapped to. */
export interface SvgPalette {
  foreground: string;
  muted: string;
  accent: string;
  accentForeground: string;
  danger: string;
  warning: string;
  success: string;
  border: string;
  /** The card surface the picture sits on. */
  background: string;
}

const VARIABLES: Record<string, keyof SvgPalette> = {
  fg: "foreground",
  foreground: "foreground",
  text: "foreground",
  muted: "muted",
  "fg-muted": "muted",
  "muted-fg": "muted",
  "muted-foreground": "muted",
  "foreground-muted": "muted",
  "text-muted": "muted",
  dim: "muted",
  subtle: "muted",
  accent: "accent",
  primary: "accent",
  link: "accent",
  "accent-fg": "accentForeground",
  "accent-foreground": "accentForeground",
  "on-accent": "accentForeground",
  error: "danger",
  danger: "danger",
  destructive: "danger",
  warning: "warning",
  warn: "warning",
  success: "success",
  ok: "success",
  border: "border",
  line: "border",
  bg: "background",
  background: "background",
  surface: "background",
  card: "background",
};

/** `--fg`, `--color-fg` and `--fg-color` all name the same colour. */
function lookup(name: string, palette: SvgPalette): string | null {
  const bare = name.trim().replace(/^--/, "").toLowerCase().replace(/^color-/, "").replace(/-colou?r$/, "");
  const key = VARIABLES[bare];
  return key ? palette[key] : null;
}

/**
 * Replaces every `var(--name[, fallback])` with a theme colour. Unknown names take their fallback
 * (itself resolved, so nested `var()` works), else the foreground colour.
 */
export function resolveCssVars(text: string, palette: SvgPalette): string {
  let out = "";
  let cursor = 0;
  for (;;) {
    const start = text.indexOf("var(", cursor);
    if (start < 0) return out + text.slice(cursor);
    out += text.slice(cursor, start);
    if (start > 0 && /[\w-]/.test(text[start - 1])) {
      out += "var(";
      cursor = start + 4;
      continue;
    }
    let depth = 0;
    let comma = -1;
    let end = start + 3;
    for (; end < text.length; end++) {
      const char = text[end];
      if (char === "(") depth++;
      else if (char === ")" && --depth === 0) break;
      else if (char === "," && depth === 1 && comma < 0) comma = end;
    }
    // Unbalanced: leave the rest as written.
    if (end >= text.length) return out + text.slice(start);
    const name = text.slice(start + 4, comma < 0 ? end : comma);
    const fallback = comma < 0 ? "" : text.slice(comma + 1, end).trim();
    out += lookup(name, palette) ?? (fallback ? resolveCssVars(fallback, palette) : palette.foreground);
    cursor = end + 1;
  }
}

export type SvgCheck = { status: "ok"; width: number; height: number } | { status: "error"; message: string };

/**
 * Some providers send replies HTML-escaped (`&lt;svg …&gt;`); such a block holds no raw `<` and
 * is decoded first. Anything else is returned as written.
 */
export function unescapeSvg(source: string): string {
  if (source.includes("<") || !/^\s*&lt;svg\b/i.test(source)) return source;
  return source.replace(/&(lt|gt|quot|apos|#39|amp);/g, (_, name: string) =>
    ({ lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", amp: "&" })[name] ?? _);
}

const PROLOGUE = /^(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i;
const ROOT = /^<svg\b[^>]*>/i;
const ROOT_ANYWHERE = /<svg\b[^>]*>/i;

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? (match[1] ?? match[2]) : null;
}

function length(value: string | null): number | null {
  const match = value ? /^\s*(\d*\.?\d+)\s*(?:px)?\s*$/.exec(value) : null;
  const number = match ? Number(match[1]) : NaN;
  return number > 0 ? number : null;
}

/**
 * Whether a block can be drawn, and its size: `width`/`height` in px, else the viewBox.
 * Malformed XML inside a well-formed root only shows when the image fails to load.
 */
export function checkSvg(source: string): SvgCheck {
  if (source.length > MAX_SVG_CHARS) return { status: "error", message: `SVG over ${MAX_SVG_CHARS / 1024} KB, shown as code.` };
  const body = source.replace(PROLOGUE, "");
  const root = ROOT.exec(body)?.[0];
  if (!root || !/<\/svg\s*>\s*(?:<!--[\s\S]*?-->\s*)*$/i.test(body)) return { status: "error", message: "Not a complete SVG, shown as code." };
  const width = length(attribute(root, "width"));
  const height = length(attribute(root, "height"));
  if (width && height) return { status: "ok", width, height };
  const box = attribute(root, "viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) return { status: "ok", width: box[2], height: box[3] };
  return { status: "error", message: "SVG has no size or viewBox, shown as code." };
}

/**
 * The block as an `<img>` source with theme colours filled in. Loaded as an image, scripts and
 * external resources never run. Inline SVG works without `xmlns`; an SVG image doesn't, so it's added.
 */
export function svgDataUri(source: string, palette: SvgPalette): string {
  let svg = resolveCssVars(source, palette);
  svg = svg.replace(ROOT_ANYWHERE, (tag) => {
    let next = tag;
    if (!/\sxmlns\s*=/.test(next)) next = next.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (/\sxlink:/.test(svg) && !/\sxmlns:xlink\s*=/.test(next)) next = next.replace(/^<svg\b/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    return next;
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

