import { Platform } from "react-native";
import { isDiffBlock, parseDiff, type DiffModel, type EditKind, type TokenKind } from "./model";
import { diffPalette, tint, type DiffPalette, type Scheme, type Side } from "./palette";

// Web and desktop only. Paseo renders chat code blocks as React Native Web views marked with
// data-paseo-markdown-* attributes for its own copy-as-markdown feature (kept through the
// react-native-enriched-markdown rewrite, PR #6973; unchanged in v0.12.0's
// components/highlighted-code-block.tsx). This module never adds, removes or edits React-owned
// nodes: token colors and changed-word marks use the CSS Custom Highlight API (Range objects over
// the existing text) and diff rows are background layers on the block's inline style. The copy
// button, text selection, Find and copy-as-markdown keep working on the untouched text.

// The plugin typechecks without the DOM library; declare only what this module uses.
interface Rect {
  top: number;
  bottom: number;
  width: number;
  height: number;
}
interface DomNode {
  readonly nodeType: number;
  readonly parentElement: DomElement | null;
  readonly isConnected: boolean;
}
interface DomText extends DomNode {
  readonly data: string;
}
interface DomElement extends DomNode {
  readonly textContent: string | null;
  readonly style: { setProperty(name: string, value: string, priority: "important"): void; removeProperty(name: string): void };
  getAttribute(name: string): string | null;
  closest(selector: string): DomElement | null;
  matches(selector: string): boolean;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  getBoundingClientRect(): Rect;
}
interface DomRange {
  setStart(node: DomText, offset: number): void;
  setEnd(node: DomText, offset: number): void;
  getClientRects(): ArrayLike<Rect>;
}
/** A highlight range that never tracks DOM changes: cheap to make, and moving its nodes keeps it valid. */
interface StaticDomRange {
  readonly startContainer: DomText;
}
interface HighlightSet {
  priority: number;
  add(range: StaticDomRange): void;
  delete(range: StaticDomRange): void;
}
interface StyleElement extends DomElement {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}
declare const document: {
  readonly documentElement: DomElement;
  readonly body: DomElement;
  readonly head: DomElement & { appendChild(node: StyleElement): void };
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  createElement(tag: "style"): StyleElement;
  createRange(): DomRange;
  createTreeWalker(root: DomElement, whatToShow: number): { nextNode(): DomNode | null };
  addEventListener(type: "scroll", listener: () => void, options: { capture: true; passive: true }): void;
  removeEventListener(type: "scroll", listener: () => void, options: { capture: true }): void;
};
declare const window: {
  readonly innerHeight: number;
  addEventListener(type: "focus" | "resize", listener: () => void): void;
  removeEventListener(type: "focus" | "resize", listener: () => void): void;
};
declare function matchMedia(query: string): {
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
};
declare const CSS: { highlights?: { set(name: string, highlight: HighlightSet): void; delete(name: string): void } } | undefined;
declare const Highlight: { new (): HighlightSet } | undefined;
declare const StaticRange: { new (init: { startContainer: DomText; startOffset: number; endContainer: DomText; endOffset: number }): StaticDomRange };
declare const localStorage: { getItem(key: string): string | null };
declare function getComputedStyle(element: DomElement): { color: string; lineHeight: string };
declare function requestAnimationFrame(callback: () => void): number;
declare function cancelAnimationFrame(handle: number): void;
declare class MutationObserver {
  constructor(callback: (records: Array<{ type: string; target: DomNode; addedNodes: ArrayLike<DomNode>; removedNodes: ArrayLike<DomNode> }>) => void);
  observe(target: DomElement, options: { childList?: boolean; characterData?: boolean; subtree?: boolean; attributes?: boolean; attributeFilter?: string[] }): void;
  disconnect(): void;
}
declare class ResizeObserver {
  constructor(callback: (entries: Array<{ target: DomElement; borderBoxSize?: ArrayLike<{ inlineSize: number; blockSize: number }> }>) => void);
  observe(target: DomElement): void;
  unobserve(target: DomElement): void;
  disconnect(): void;
}

const PRE = '[data-paseo-markdown-tag="pre"]';
const CODE = '[data-paseo-markdown-tag="code"]';
const LANGUAGE = "data-paseo-markdown-language";
const PREFIX = "noice-chat-diff";
const SHOW_TEXT = 4;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SETTINGS_KEY = "@paseo:app-settings";
/** Backstop for a settings change no event reported; compares one stored string, reads no style. */
const SETTINGS_SWEEP_MS = 10_000;
const EDIT_KINDS: EditKind[] = ["delEdit", "addEdit"];
const SIDES: Side[] = ["add", "del"];
const ROW_STYLE = ["background-image", "background-size", "background-position", "background-repeat", "background-origin"];
const GUTTER_BAR_PX = 2;
/**
 * How far off screen (px) a block keeps its highlights. Chromium repaints every highlighted text
 * node in its paint area, which reaches thousands of pixels around the visible part of the chat,
 * on every frame, so far blocks only cost. Scrolling on the compositor can show already-painted
 * content before the page sees the scroll; this margin is far more than it gets ahead, so a block
 * has its colors back long before it shows.
 */
const NEAR_PX = 1500;

// Token kinds per line kind. Kinds that never occur there (signs on context lines, header/hunk
// on changed lines) get no highlight: every `::highlight` rule costs style time on each element.
const SYNTAX_KINDS: TokenKind[] = ["keyword", "comment", "string", "number", "literal", "function", "type", "tag", "attribute", "property", "operator"];
const CONTEXT_KINDS: TokenKind[] = [...SYNTAX_KINDS, "header", "hunk"];
const CHANGED_KINDS: Record<Side, TokenKind[]> = { add: [...SYNTAX_KINDS, "addSign"], del: [...SYNTAX_KINDS, "delSign"] };

// Highlight names and priorities, all below Paseo's own highlights (chat Find, priority 0). Bottom
// to top: plain text on added/removed lines (`text-add`), syntax tokens (`keyword` on context lines,
// `keyword-add` / `keyword-del` on changed lines, tinted toward the line color), word marks.
const HIGHLIGHTS: Array<[name: string, priority: number]> = [
  ...SIDES.map((side): [string, number] => [`text-${side}`, -3]),
  ...CONTEXT_KINDS.map((kind): [string, number] => [kind, -2]),
  ...SIDES.flatMap((side) => CHANGED_KINDS[side].map((kind): [string, number] => [`${kind}-${side}`, -2])),
  ...EDIT_KINDS.map((kind): [string, number] => [kind, -1]),
];

interface Block {
  code: DomElement;
  text: string;
  model: DiffModel;
  ranges: Array<[string, StaticDomRange]>;
  nodes: DomText[];
  starts: number[];
  /** Border-box size the rows were last painted for; resize reports of this size are no-ops. */
  size: string;
  /** Whether `ranges` are in the page's highlights: only while the block is on or near screen. */
  shown: boolean;
}

/** Starts coloring diff code blocks. Returns cleanup; a no-op off the web. */
export function startDiffHighlighting(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};

  const blocks = new Map<DomElement, Block>();
  const highlights = new Map<string, HighlightSet>();
  if (CSS?.highlights && Highlight) {
    for (const [name, priority] of HIGHLIGHTS) {
      const highlight = new Highlight();
      highlight.priority = priority;
      CSS.highlights.set(`${PREFIX}-${name}`, highlight);
      highlights.set(name, highlight);
    }
  }
  const style = document.createElement("style");
  style.setAttribute("data-plugin", PREFIX);
  document.head.appendChild(style);

  let paletteKey = "";
  let palette: DiffPalette = diffPalette("one", "light");
  /** Paseo's stored settings as last read: a different string may mean another (syntax) theme. */
  let settingsSeen: string | null = null;

  // Called only with a real code block: a placeholder palette while no diff block is on screen
  // would rewrite the stylesheet twice per visit, and each rewrite restyles the whole page.
  const syncPalette = (sample: DomElement): boolean => {
    let syntaxTheme = "one";
    settingsSeen = localStorage.getItem(SETTINGS_KEY);
    try {
      const settings: unknown = JSON.parse(settingsSeen ?? "{}");
      const value = settings && typeof settings === "object" ? Reflect.get(settings, "syntaxTheme") : undefined;
      if (typeof value === "string") syntaxTheme = value;
    } catch {
      // Unreadable settings: Paseo's default syntax theme.
    }
    // The block's text color is the theme's foreground, so light text means a dark theme.
    const foreground = getComputedStyle(sample).color;
    const scheme: Scheme = luminance(foreground) > 0.5 ? "dark" : "light";
    const key = `${syntaxTheme}|${scheme}|${foreground}`;
    if (key === paletteKey) return false;
    paletteKey = key;
    palette = diffPalette(syntaxTheme, scheme);
    const rule = (name: string, body: string) => `::highlight(${PREFIX}-${name}) { ${body} }`;
    style.textContent = [
      ...CONTEXT_KINDS.map((kind) => rule(kind, `color: ${palette.tokens[kind]};`)),
      ...SIDES.flatMap((side) => [
        rule(`text-${side}`, `color: ${tint(foreground, palette.lines[side])};`),
        ...CHANGED_KINDS[side].map((kind) => rule(`${kind}-${side}`, `color: ${palette.changedTokens[side][kind]};`)),
      ]),
      ...EDIT_KINDS.map((kind) => rule(kind, `background-color: ${palette.edits[kind]}; color: ${palette.editText};`)),
    ].join("\n");
    return true;
  };

  const show = (block: Block) => {
    if (block.shown) return;
    block.shown = true;
    for (const [name, range] of block.ranges) highlights.get(name)?.add(range);
  };
  const hide = (block: Block) => {
    if (!block.shown) return;
    block.shown = false;
    for (const [name, range] of block.ranges) highlights.get(name)?.delete(range);
  };
  // A block in a hidden panel (another tab) has no box: it keeps what it has, so switching back
  // shows its colors in the first frame. Hidden, it isn't painted anyway.
  const place = (pre: DomElement, block: Block) => {
    const box = pre.getBoundingClientRect();
    if (box.height === 0) return;
    if (box.bottom > -NEAR_PX && box.top < window.innerHeight + NEAR_PX) show(block);
    else hide(block);
  };
  // Runs inside the frame that moved the blocks (scroll and resize events come before paint), so
  // a block reaching the screen is colored in that same frame.
  const placeAll = () => {
    for (const [pre, block] of blocks) place(pre, block);
  };

  const clear = (pre: DomElement) => {
    const block = blocks.get(pre);
    if (!block) return;
    hide(block);
    for (const property of ROW_STYLE) pre.style.removeProperty(property);
    blocks.delete(pre);
    resizes.unobserve(pre);
  };

  // One live range, re-positioned for each row measurement.
  const measure = document.createRange();
  const measureRects = (block: Block, start: number, end: number): ArrayLike<Rect> => {
    const from = locate(block, start);
    const to = locate(block, end);
    if (!from || !to) return [];
    measure.setStart(from[0], from[1]);
    measure.setEnd(to[0], to[1]);
    return measure.getClientRects();
  };

  // Full-width row backgrounds, like Paseo's git diff view, measured from the rendered text so
  // wrapped lines and any font size line up.
  const paintRows = (pre: DomElement, block: Block) => {
    const box = pre.getBoundingClientRect();
    block.size = `${box.width}x${box.height}`;
    const lineHeight = parseFloat(getComputedStyle(block.code).lineHeight);
    const rows: Array<{ top: number; bottom: number; color: string; bar: string | undefined }> = [];
    for (const line of block.model.lines) {
      const color = palette.rows[line.kind];
      if (!color) continue;
      const bar = palette.bars[line.kind];
      const rects = Array.from(measureRects(block, line.start, line.end)).filter((r) => r.height > 0);
      if (rects.length === 0) continue;
      const leading = Number.isFinite(lineHeight) ? Math.max(0, (lineHeight - rects[0]!.height) / 2) : 0;
      const top = Math.min(...rects.map((r) => r.top)) - leading - box.top;
      const bottom = Math.max(...rects.map((r) => r.bottom)) + leading - box.top;
      const previous = rows[rows.length - 1];
      // Rows are contiguous: snap sub-pixel gaps so a run of changes paints as one band.
      if (previous && previous.color === color && top - previous.bottom < 2) previous.bottom = bottom;
      else rows.push({ top: previous && top - previous.bottom < 2 ? previous.bottom : top, bottom, color, bar });
    }
    // Top to bottom: gutter bars, row bands, then the shade. The shade sits over the theme's own
    // block background, so the block deepens toward black (light themes: white) but keeps the
    // theme's hue; it always covers the whole block, also while a streaming block grows.
    const px = (n: number) => `${Math.round(n * 100) / 100}px`;
    const layers = [
      ...rows.flatMap((r) => (r.bar ? [{ color: r.bar, size: `${GUTTER_BAR_PX}px ${px(r.bottom - r.top)}`, at: `0 ${px(r.top)}` }] : [])),
      ...rows.map((r) => ({ color: r.color, size: `100% ${px(r.bottom - r.top)}`, at: `0 ${px(r.top)}` })),
      { color: palette.shade, size: "100% 100%", at: "0 0" },
    ];
    // Important, so theme plugins that restyle code blocks (Chat Polish sets `background` with
    // !important) don't hide the rows; inline !important wins over any stylesheet.
    const set = (property: string, value: string) => pre.style.setProperty(property, value, "important");
    set("background-image", layers.map((l) => `linear-gradient(${l.color}, ${l.color})`).join(", "));
    set("background-size", layers.map((l) => l.size).join(", "));
    set("background-position", layers.map((l) => l.at).join(", "));
    set("background-repeat", "no-repeat");
    set("background-origin", "border-box");
  };

  const process = (pre: DomElement) => {
    const code = pre.querySelector(CODE);
    const text = code?.textContent ?? "";
    if (!code || !pre.isConnected || !isDiffBlock(pre.getAttribute(LANGUAGE), text)) return clear(pre);
    const existing = blocks.get(pre);
    // Same text over the same nodes: nothing to redo. Replaced text nodes (a re-render with the
    // same text) leave the old ranges pointing nowhere, so those blocks are redone.
    if (existing && existing.code === code && existing.text === text && existing.nodes.every((node) => node.isConnected)) return;
    // Re-processing keeps the block observed: a fresh observation would report its size once more
    // and repaint rows that are painted below anyway.
    const shown = existing ? existing.shown : true;
    if (existing) hide(existing);

    const nodes: DomText[] = [];
    const starts: number[] = [];
    const walker = document.createTreeWalker(code, SHOW_TEXT);
    let offset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as DomText;
      nodes.push(textNode);
      starts.push(offset);
      offset += textNode.data.length;
    }
    const block: Block = { code, text, model: parseDiff(text), ranges: [], nodes, starts, size: "", shown: false };
    const mark = (name: string, start: number, end: number) => {
      const from = highlights.has(name) && locate(block, start);
      const to = from && locate(block, end);
      if (!to) return;
      block.ranges.push([name, new StaticRange({ startContainer: from[0], startOffset: from[1], endContainer: to[0], endOffset: to[1] })]);
    };
    // Tokens on added/removed lines go to that side's tinted highlight; spans come in line order.
    const lines = block.model.lines;
    let at = 0;
    for (const span of block.model.spans) {
      while (lines[at]!.end < span.start) at++;
      const kind = lines[at]!.kind;
      mark(kind === "add" || kind === "del" ? `${span.kind}-${kind}` : span.kind, span.start, span.end);
    }
    for (const line of lines) if ((line.kind === "add" || line.kind === "del") && line.end > line.start + 1) mark(`text-${line.kind}`, line.start + 1, line.end);
    for (const edit of block.model.edits) mark(edit.kind, edit.start, edit.end);
    if (shown) show(block);
    blocks.set(pre, block);
    if (!existing) resizes.observe(pre);
    if (syncPalette(code)) repaintAll();
    else paintRows(pre, block);
    place(pre, block);
  };

  const repaintAll = () => {
    for (const [pre, block] of blocks) paintRows(pre, block);
  };

  let resizeFrame: number | undefined;
  const pendingResize = new Set<DomElement>();
  const resizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const block = blocks.get(entry.target);
      // Reported after layout, before paint: a block back from a hidden panel is placed this frame.
      if (block) place(entry.target, block);
      const size = entry.borderBoxSize?.[0];
      // Reports of the size the rows were painted for (every fresh observation sends one) change nothing.
      if (size && block?.size === `${size.inlineSize}x${size.blockSize}`) continue;
      pendingResize.add(entry.target);
    }
    if (pendingResize.size === 0) return;
    resizeFrame ??= requestAnimationFrame(() => {
      resizeFrame = undefined;
      for (const pre of pendingResize) {
        const block = blocks.get(pre);
        if (block) paintRows(pre, block);
      }
      pendingResize.clear();
    });
  });
  document.addEventListener("scroll", placeAll, { capture: true, passive: true });
  window.addEventListener("resize", placeAll);

  // Streaming rewrites a block's text node in place; virtualized chat mounts and unmounts blocks.
  // Changes are collected and handled once per frame, so a fast stream re-parses a growing block
  // at most at the display rate. Unmounted blocks are let go right away, without a frame. Nodes
  // added or removed elsewhere (a tool call expanding) can move blocks without a scroll, so those
  // blocks are placed again in the frame the change is drawn in.
  let mutationFrame: number | undefined;
  let moved = false;
  const pendingMutation = new Set<DomElement>();
  const mutations = new MutationObserver((records) => {
    let removed = false;
    for (const record of records) {
      const target = record.target.nodeType === ELEMENT_NODE ? (record.target as DomElement) : record.target.parentElement;
      const pre = target?.closest(PRE);
      if (pre) pendingMutation.add(pre);
      if (record.type !== "childList") continue;
      moved = true;
      if (record.removedNodes.length > 0) removed = true;
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== ELEMENT_NODE) continue;
        const element = node as DomElement;
        if (element.matches(PRE)) pendingMutation.add(element);
        for (const inner of Array.from(element.querySelectorAll(PRE))) pendingMutation.add(inner);
      }
    }
    if (removed) for (const pre of [...blocks.keys()]) if (!pre.isConnected) clear(pre);
    if (pendingMutation.size === 0 && !(moved && blocks.size > 0)) return;
    mutationFrame ??= requestAnimationFrame(() => {
      mutationFrame = undefined;
      for (const pre of pendingMutation) process(pre);
      pendingMutation.clear();
      if (moved) placeAll();
      moved = false;
    });
  });
  mutations.observe(document.body, { childList: true, characterData: true, subtree: true });

  // Theme and syntax-theme switches restyle without touching the blocks, so they are caught
  // here. Each re-read of the palette reads the block's computed color, a forced style update, so
  // it only runs on a sign of a switch, never on a timer.
  const resync = () => {
    for (const [pre, block] of blocks) {
      if (!pre.isConnected) continue;
      if (syncPalette(block.code)) repaintAll();
      return;
    }
  };
  // Paseo stores theme and syntax theme in its settings. Comparing the stored string reads no style.
  const resyncIfSettingsChanged = () => {
    if (blocks.size > 0 && localStorage.getItem(SETTINGS_KEY) !== settingsSeen) resync();
  };
  // Paseo's theme switch (Unistyles on web) swaps a class on <html>; a theme's colors are rewritten
  // into a stylesheet in <head>, which also changes whenever Paseo adds styles, hence the cheap check.
  const themeClass = new MutationObserver(resync);
  themeClass.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  const themeSheets = new MutationObserver(resyncIfSettingsChanged);
  themeSheets.observe(document.head, { childList: true, characterData: true, subtree: true });
  const systemScheme = matchMedia("(prefers-color-scheme: dark)");
  systemScheme.addEventListener("change", resync);
  window.addEventListener("focus", resync);
  const sweep = setInterval(resyncIfSettingsChanged, SETTINGS_SWEEP_MS);

  for (const pre of Array.from(document.querySelectorAll(PRE))) process(pre);

  return () => {
    clearInterval(sweep);
    window.removeEventListener("focus", resync);
    window.removeEventListener("resize", placeAll);
    document.removeEventListener("scroll", placeAll, { capture: true });
    systemScheme.removeEventListener("change", resync);
    themeSheets.disconnect();
    themeClass.disconnect();
    mutations.disconnect();
    resizes.disconnect();
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    if (mutationFrame !== undefined) cancelAnimationFrame(mutationFrame);
    for (const pre of [...blocks.keys()]) clear(pre);
    for (const name of highlights.keys()) CSS?.highlights?.delete(`${PREFIX}-${name}`);
    style.remove();
  };
}

/** Text node and offset for a character offset into the block's text. */
function locate(block: Block, offset: number): [DomText, number] | undefined {
  const { nodes, starts } = block;
  if (nodes.length === 0) return undefined;
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  const node = nodes[lo]!;
  if (node.nodeType !== TEXT_NODE) return undefined;
  return [node, Math.min(offset - starts[lo]!, node.data.length)];
}

/** Relative luminance (0 dark … 1 light) of a computed `rgb()`/`rgba()` color. */
function luminance(color: string): number {
  const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/g) ?? []).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
