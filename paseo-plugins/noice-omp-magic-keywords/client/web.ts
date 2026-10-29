import { Platform } from "react-native";
import type { Preferences, Style } from "../shared/preferences";
import { keywordColor, type Tone } from "./color";
import { findClaudeUltrathink, findMagicKeywords, type KeywordMatch, MAGIC_KEYWORDS, SHIMMER_PERIOD_MS, STOPS, stopFor } from "./keywords";

// Web and desktop only. The engine colours keywords with the CSS Custom Highlight API: every keyword
// character is its own Range, and each frame moves it to the highlight of its current gradient stop,
// so the colours run across the word as in OMP's editor. It never adds, removes or edits React-owned
// nodes, so copy, selection and Find see the plain text. Three kinds of text are coloured (markers
// seen in Paseo 0.12.0):
// - a sent message: one React Native Web Text marked data-message-text inside a user-message;
// - the chat outline's hover preview: one text node, mounted only while a tick is hovered;
// - the composer: a plain textarea with no text nodes for a Range to address. Each visible one holding a
//   keyword gets a see-through copy of its text laid exactly over it, and the copy's keywords are
//   highlighted, so coloured glyphs paint over the textarea's own.

export const isWeb = Platform.OS === "web" && typeof document !== "undefined";

export interface Engine {
  setPreferences(values: Preferences): void;
  /** Records which provider runs an agent, for the "only where the words act" scope. */
  agent(id: string, provider: string): void;
  dispose(): void;
}

/** Sent messages and the outline preview both follow the `sent` preference. */
const SENT = '[data-testid="user-message"] [data-message-text], [data-testid="chat-outline-preview"] [dir="auto"]';
const COMPOSER = "textarea[data-composer-input]";
const PREFIX = "noice-omp-magic-keywords";
/** How long rules outlive the last keyword in view, so a prompt at the viewport edge does not flip the sheet per frame. */
const RULES_OFF_MS = 300;
/** Sent messages within this fraction of the viewport height above or below it keep their words' rules, so a
 *  keyword scrolled in is coloured on its first frame. */
const NEAR_FRACTION = 0.5;
/** How far up React's tree to look for the chat's agent before giving up. */
const FIBER_DEPTH = 80;
/** Bit `i` set: keyword `i` of {@link MAGIC_KEYWORDS} may be coloured. */
const ALL_WORDS = (1 << MAGIC_KEYWORDS.length) - 1;
/** Bit above the words: match with Claude Code's looser `ultrathink` rule instead of OMP's. */
const CLAUDE_RULE = 1 << MAGIC_KEYWORDS.length;
const CLAUDE_WORDS = (1 << MAGIC_KEYWORDS.findIndex(({ word }) => word === "ultrathink")) | CLAUDE_RULE;
/** The textarea's text-layout properties the overlay copies, so its lines wrap at the same places. */
const COPIED = [
  "font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-variant", "font-kerning",
  "font-feature-settings", "font-variation-settings", "font-optical-sizing", "font-size-adjust", "font-synthesis",
  "text-rendering", "line-height", "letter-spacing", "word-spacing", "text-transform", "text-indent", "text-align",
  "tab-size", "white-space", "overflow-wrap", "word-break", "line-break", "hyphens", "direction", "unicode-bidi",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
];
// Hidden until a check shows its lines wrap like the textarea's. z-index: auto keeps it under
// Paseo's later popovers and modals, which mount after it at the end of the body.
const OVERLAY_CSS = "position:fixed;margin:0;border:0;box-sizing:border-box;overflow:hidden;pointer-events:none;"
  + "user-select:none;-webkit-user-select:none;color:transparent;background:transparent;visibility:hidden;";
// The overlay's hidden twin for that check: a textarea wraps the draft exactly as the composer does,
// and at height 0 its scrollHeight is the draft's height plus padding.
const MIRROR_CSS = "position:fixed;left:0;top:0;height:0;min-height:0;margin:0;border:0;box-sizing:border-box;"
  + "overflow:hidden;resize:none;visibility:hidden;pointer-events:none;";

type Kind = "sent" | "composer";

/** One keyword character: its Range and the gradient stop whose highlight currently holds it. */
interface Glyph {
  range: Range;
  keyword: number;
  index: number;
  length: number;
  stop: number;
}

/** One keyword occurrence: its glyphs in order. */
interface Run {
  glyphs: Glyph[];
}

interface Overlay {
  /** Fixed over the textarea, clipped to its box and scrolled with it. */
  element: HTMLElement;
  /** Block holding the copied text; its height is the copy's line count times the line height. */
  inner: HTMLElement;
  node: Text;
  /** Hidden textarea holding the draft at the composer's width, for the line check. */
  mirror: HTMLTextAreaElement;
  /** The textarea's text style as CSS, read when its text or tab changes, on scroll and on rescan rather than every frame. */
  textCss: string;
  /** The textarea's vertical padding in px. */
  padding: number;
  /** Last styles written to the overlay and the mirror, to skip unchanged writes. */
  css: string;
  mirrorCss: string;
  /** Whether the copy has as many lines as the textarea; unset until measured for the current text and style. */
  fits?: boolean;
  shown: boolean;
}

/** A coloured element: a message or preview text, or a composer textarea with its overlay. */
interface Source {
  kind: Kind;
  text: string;
  /** Words this source may colour (bit mask), as decided when its glyphs were built. */
  words: number;
  /** Words that occur in its runs (bit mask): their rules must exist while it is in view. */
  present: number;
  /** Text nodes the glyphs' Ranges address; one leaving the page leaves the Ranges stale. */
  nodes: Text[];
  /** Keyword occurrences, each with its glyphs in order. */
  runs: Run[];
  /** All glyphs of all runs, for unpainting and counting. */
  glyphs: Glyph[];
  /** A sent message's nearest scrolling ancestor, which clips it; unset for the viewport. */
  scroller?: HTMLElement;
  overlay?: Overlay;
}

/** The chat's agent as read from React props; either part may be missing. */
interface AgentRef {
  id?: string;
  provider?: string;
}

interface Fiber {
  memoizedProps: { agentId?: unknown; agent?: { id?: unknown; provider?: unknown } | null } | null;
  type: unknown;
  return: Fiber | null;
}

/** What {@link unhookValue} needs to put a composer's `value` property back. */
interface ValueHook {
  /** The element's own `value` property before the hook (React's value tracker), if it had one. */
  own: PropertyDescriptor | undefined;
  hook: PropertyDescriptor;
}

/** Starts the engine idle; it colours nothing until the first {@link Engine.setPreferences}. */
export function startKeywordShimmer(): Engine {
  const registry = typeof CSS === "undefined" ? undefined : CSS.highlights;
  const HighlightClass = typeof Highlight === "undefined" ? undefined : Highlight;
  if (!isWeb || !registry || !HighlightClass) return { setPreferences() {}, agent() {}, dispose() {} };

  // Below Paseo's own highlights (chat Find), which use the default priority 0.
  const highlights = MAGIC_KEYWORDS.map(({ word }) =>
    Array.from({ length: STOPS }, (_, stop) => {
      const highlight = new HighlightClass();
      highlight.priority = -1;
      registry.set(`${PREFIX}-${word}-${stop}`, highlight);
      return highlight;
    }),
  );
  const style = document.createElement("style");
  style.setAttribute("data-plugin", PREFIX);
  document.head.appendChild(style);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // Set first thing on dispose: observer callbacks and frames already queued must not start new work.
  let disposed = false;
  let preferences: Preferences | undefined;
  const directory = new Map<string, string>();
  let warned = false;
  const sources = new Map<HTMLElement, Source>();
  const visible = new Set<HTMLElement>();

  // Every `::highlight()` rule slows the style of each restyled element on the page (23 µs instead of
  // 6 µs per element with all 240), so rules exist only for the words of sources in view: sent messages
  // near the viewport and shown composer overlays. A word's rules are added at once and dropped
  // RULES_OFF_MS after its last such source leaves; each change restyles the page once.
  const near = new Set<HTMLElement>();
  // Dark until the first coloured element is read.
  let tone: Tone = "dark";
  let ruleWords = 0;
  let offTimer: number | undefined;
  const writeRules = (words: number) => {
    ruleWords = words;
    style.textContent = MAGIC_KEYWORDS.flatMap(({ word, hue: [from, to] }, keyword) =>
      words & (1 << keyword)
        ? Array.from({ length: STOPS }, (_, stop) =>
          `::highlight(${PREFIX}-${word}-${stop}) { color: ${keywordColor(from + (stop / STOPS) * (to - from), tone)}; }`)
        : [],
    ).join("\n");
  };
  const wantedWords = (): number => {
    let words = 0;
    for (const [element, source] of sources) {
      if (source.overlay ? source.overlay.shown : near.has(element)) words |= source.present;
    }
    return words;
  };
  const dropRules = () => {
    offTimer = undefined;
    if (disposed) return;
    const wanted = wantedWords();
    if (wanted !== ruleWords) writeRules(wanted);
  };
  /** Called whenever a source appears, goes, enters or leaves the view, or shows or hides its overlay. */
  const syncRules = () => {
    if (disposed) return;
    const wanted = wantedWords();
    if (wanted & ~ruleWords) writeRules(ruleWords | wanted);
    if (wanted === ruleWords) {
      clearTimeout(offTimer);
      offTimer = undefined;
    } else {
      offTimer ??= setTimeout(dropRules, RULES_OFF_MS);
    }
  };

  /** Reads the theme off a coloured element: light text means a dark theme. */
  const syncScheme = (sample: HTMLElement) => {
    const color = getComputedStyle(sample).color;
    if (!color) return;
    const next: Tone = luminance(color) < 0.5 ? "light" : "dark";
    if (next === tone) return;
    tone = next;
    if (ruleWords) writeRules(ruleWords);
  };

  const styleOf = (kind: Kind): Style => preferences?.[kind] ?? "off";

  /** One stop lasts SHIMMER_PERIOD_MS / STOPS (30 ms); every glyph steps on the same frame, so the page
   *  repaints once per stop instead of once per frame. Each glyph still changes once per stop. */
  const STOP_MS = SHIMMER_PERIOD_MS / STOPS;
  const currentShift = (): number => Math.floor((Date.now() % SHIMMER_PERIOD_MS) / STOP_MS);

  const paintRun = (run: Run, keyword: number, shift: number) => {
    const stops = highlights[keyword]!;
    for (const glyph of run.glyphs) {
      const stop = stopFor(glyph.index, glyph.length, shift);
      if (stop === glyph.stop) continue;
      if (glyph.stop >= 0) stops[glyph.stop]!.delete(glyph.range);
      stops[stop]!.add(glyph.range);
      glyph.stop = stop;
    }
  };

  const paint = (source: Source) => {
    const moving = styleOf(source.kind) === "shimmer" && !reducedMotion.matches;
    const shift = moving ? currentShift() : 0;
    // A long prompt may keep its keyword scrolled out while the message is still on screen; moving glyphs
    // nobody can see still cost a repaint. A run is painted when its first or last glyph is in the viewport
    // (a wrapped one may have only its tail showing). Composer overlays are small and clip themselves.
    const cull = moving && !source.overlay;
    const viewHeight = cull ? window.innerHeight : 0;
    for (const run of source.runs) {
      if (cull) {
        const first = run.glyphs[0]!.range.getBoundingClientRect();
        const last = run.glyphs.length > 1 ? run.glyphs[run.glyphs.length - 1]!.range.getBoundingClientRect() : first;
        if ((first.bottom < 0 || first.top > viewHeight) && (last.bottom < 0 || last.top > viewHeight)) continue;
      }
      paintRun(run, run.glyphs[0]!.keyword, shift);
    }
  };

  const unpaint = (source: Source) => {
    for (const glyph of source.glyphs) if (glyph.stop >= 0) highlights[glyph.keyword]![glyph.stop]!.delete(glyph.range);
    source.glyphs = [];
    source.runs = [];
  };

  /**
   * Which words act in the chat `element` belongs to: all four for OMP (`omp` and the `omp-…`
   * profiles), ultrathink by Claude's rule for Claude Code, none elsewhere. The agent is read afresh
   * on every call, since React fills props in late and may reuse an element for another chat. A
   * provider seen in a message's props is kept for the chat's composer, whose props carry only the
   * agent id. A chat the lookup cannot place gets all four: colouring too much beats hiding the
   * colours everywhere when Paseo's internals change.
   */
  const wordsFor = (element: HTMLElement): number => {
    if (preferences?.scope === "all") return ALL_WORDS;
    const agent = agentOf(element);
    if (agent.id !== undefined && agent.provider !== undefined) directory.set(agent.id, agent.provider);
    const provider = agent.provider ?? (agent.id === undefined ? undefined : directory.get(agent.id));
    if (provider === undefined) {
      if (!warned && agent.id === undefined) {
        warned = true;
        console.warn("[noice-omp-magic-keywords] found no agent for a chat element; colouring every keyword");
      }
      return ALL_WORDS;
    }
    if (provider === "omp" || provider.startsWith("omp-")) return ALL_WORDS;
    return provider === "claude" ? CLAUDE_WORDS : 0;
  };

  /** The keyword occurrences to colour in `text` under the `words` mask {@link wordsFor} gave. */
  const matchesFor = (text: string, words: number): KeywordMatch[] => {
    if (words & CLAUDE_RULE) return findClaudeUltrathink(text);
    if (words === 0) return [];
    return findMagicKeywords(text).filter(({ keyword }) => words & (1 << keyword));
  };

  const runsFor = (matches: KeywordMatch[], nodes: Text[], starts: number[]): Run[] => {
    const runs: Run[] = [];
    for (const { keyword, start, end } of matches) {
      const glyphs: Glyph[] = [];
      for (let at = start; at < end; at++) {
        const from = locate(nodes, starts, at);
        const to = locate(nodes, starts, at + 1);
        if (!from || !to) continue;
        const range = document.createRange();
        range.setStart(from[0], from[1]);
        range.setEnd(to[0], to[1]);
        glyphs.push({ range, keyword, index: at - start, length: end - start, stop: -1 });
      }
      if (glyphs.length > 0) runs.push({ glyphs });
    }
    return runs;
  };

  const flat = (runs: Run[]): Glyph[] => runs.flatMap((run) => run.glyphs);

  // Keystrokes only mark their composer: the overlay is rebuilt in the frame that first shows the new
  // text, not inside the input event, where its layout would be forced synchronously.
  const dirty = new Set<HTMLTextAreaElement>();
  // Every composer on the page, observed from the moment it appears, with its value hook.
  const composers = new Map<HTMLTextAreaElement, ValueHook | undefined>();

  // Only on-screen sources run the loop: shimmering ones to animate, composers with keywords to
  // track their textarea. It stops when none are left. Between two colour stops nothing changes, so
  // while no overlay needs per-frame tracking the next frame is requested only at the next stop.
  let frame: number | undefined;
  let stopTimer: number | undefined;
  const tick = () => {
    frame = undefined;
    if (disposed) return;
    for (const textarea of dirty) processComposer(textarea);
    dirty.clear();
    let again = false;
    let tracking = false;
    for (const element of visible) {
      const source = sources.get(element);
      if (!source) continue;
      if (source.overlay) {
        // Paseo writes the value directly on send, clear and draft restore, without an input event.
        if ((element as HTMLTextAreaElement).value === source.text) place(element as HTMLTextAreaElement, source);
        else processComposer(element as HTMLTextAreaElement);
      }
      paint(source);
      const moving = styleOf(source.kind) === "shimmer" && !reducedMotion.matches;
      if (source.glyphs.length > 0 && (source.overlay || moving)) again = true;
      if (source.glyphs.length > 0 && source.overlay) tracking = true;
    }
    if (!again || frame !== undefined) return;
    if (tracking) {
      frame = requestAnimationFrame(tick);
    } else if (stopTimer === undefined) {
      stopTimer = setTimeout(() => {
        stopTimer = undefined;
        schedule();
      }, STOP_MS - (Date.now() % STOP_MS));
    }
  };
  const schedule = () => {
    if (!disposed) frame ??= requestAnimationFrame(tick);
  };
  reducedMotion.addEventListener("change", schedule);

  // No IntersectionObserver anywhere: while one has an observation, Chromium turns every frame of a
  // composited animation (Paseo's status rings, all day while agents run) into a main-thread frame
  // (measured: 0.1 → 60 main frames/s). Sent sources are placed by reading their boxes in a frame after
  // scrolls, resizes and DOM changes; a ResizeObserver, which has no such effect, reports the boxes that
  // appear or vanish when Paseo switches tabs (inactive tabs are display: none).
  let viewFrame: number | undefined;
  const pending = new Set<HTMLElement>();
  const hasSent = (): boolean => {
    for (const source of sources.values()) if (source.kind === "sent") return true;
    return false;
  };
  /** Places every sent source: in view (its scroller's visible part) animates, near keeps its rules. */
  const checkView = () => {
    const height = window.innerHeight;
    const margin = height * NEAR_FRACTION;
    for (const [element, source] of sources) {
      if (source.kind !== "sent") continue;
      const rect = element.getBoundingClientRect();
      // display: none (a hidden tab) leaves an empty box at 0, 0.
      const rendered = rect.width > 0 || rect.height > 0;
      const clip = source.scroller?.getBoundingClientRect();
      const top = Math.max(0, clip?.top ?? 0);
      const bottom = Math.min(height, clip?.bottom ?? height);
      if (rendered && rect.bottom > top && rect.top < bottom) visible.add(element);
      else visible.delete(element);
      if (rendered && rect.bottom > -margin && rect.top < height + margin) near.add(element);
      else near.delete(element);
    }
    syncRules();
    schedule();
  };
  const updateView = () => {
    viewFrame = undefined;
    if (disposed) return;
    for (const element of pending) processSent(element);
    pending.clear();
    checkView();
  };
  const scheduleView = () => {
    if (!disposed) viewFrame ??= requestAnimationFrame(updateView);
  };

  // Composers from the moment they mount, sent sources while they are sources. A composer whose box
  // vanished is in a hidden tab: its overlay goes. One that has a box again is rebuilt.
  const sizes = new ResizeObserver((entries) => {
    if (disposed) return;
    for (const { target, contentRect } of entries) {
      const element = target as HTMLElement;
      if (!composers.has(element as HTMLTextAreaElement)) continue;
      if (contentRect.width > 0 || contentRect.height > 0) {
        visible.add(element);
        dirty.add(element as HTMLTextAreaElement);
      } else {
        visible.delete(element);
        clear(element);
      }
    }
    schedule();
    scheduleView();
  });

  const clear = (element: HTMLElement) => {
    const source = sources.get(element);
    if (!source) return;
    unpaint(source);
    source.overlay?.element.remove();
    sources.delete(element);
    // A composer stays observed for as long as it is on the page.
    if (source.kind === "sent") {
      visible.delete(element);
      near.delete(element);
      sizes.unobserve(element);
    }
    syncRules();
  };

  const onValueSet = (textarea: HTMLTextAreaElement) => {
    if (disposed || !preferences) return;
    dirty.add(textarea);
    schedule();
  };
  const track = (textarea: HTMLTextAreaElement) => {
    if (composers.has(textarea)) return;
    composers.set(textarea, hookValue(textarea, onValueSet));
    sizes.observe(textarea);
  };
  const forget = (textarea: HTMLTextAreaElement) => {
    clear(textarea);
    unhookValue(textarea, composers.get(textarea));
    composers.delete(textarea);
    dirty.delete(textarea);
    visible.delete(textarea);
    sizes.unobserve(textarea);
  };

  const processSent = (element: HTMLElement) => {
    if (styleOf("sent") === "off" || !element.isConnected) {
      clear(element);
      return;
    }
    const text = element.textContent ?? "";
    const existing = sources.get(element);
    const words = wordsFor(element);
    // React may swap a text node for one holding the same text; the Ranges would then address a detached node.
    if (existing && existing.text === text && existing.words === words && existing.nodes.every((node) => node.isConnected)) return;
    clear(element);
    const matches = matchesFor(text, words);
    if (matches.length === 0) return;

    const nodes: Text[] = [];
    const starts: number[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let offset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      nodes.push(textNode);
      starts.push(offset);
      offset += textNode.data.length;
    }
    const runs = runsFor(matches, nodes, starts);
    const source: Source = {
      kind: "sent", text, words, present: wordsIn(runs), nodes, runs, glyphs: flat(runs), scroller: scrollerOf(element),
    };
    sources.set(element, source);
    syncScheme(element);
    paint(source);
    sizes.observe(element);
    // Placed, and its words' rules written, by the checkView() that ends every batch calling this.
  };

  /** Lays the overlay over its textarea and shows it only while it has as many lines as the textarea. */
  const place = (textarea: HTMLTextAreaElement, source: Source) => {
    const overlay = source.overlay!;
    let shown = false;
    if (isShown(textarea)) {
      // Geometry is read every frame: rows above the composer (attachments) move it without an event.
      // clientWidth leaves out the scrollbar gutter Paseo always reserves.
      const rect = textarea.getBoundingClientRect();
      const width = textarea.clientWidth;
      const css = `${OVERLAY_CSS}${overlay.textCss}left:${rect.left + textarea.clientLeft}px;`
        + `top:${rect.top + textarea.clientTop}px;width:${width}px;height:${textarea.clientHeight}px;`;
      if (css !== overlay.css) {
        overlay.element.setAttribute("style", css);
        overlay.css = css;
        overlay.shown = false;
      }
      const mirrorCss = `${MIRROR_CSS}${overlay.textCss}width:${width}px;`;
      if (mirrorCss !== overlay.mirrorCss) {
        overlay.mirror.setAttribute("style", mirrorCss);
        overlay.mirrorCss = mirrorCss;
        overlay.fits = undefined;
      }
      // The mirror's height gives the textarea's line count; a different count means different line breaks,
      // so colours would land on the wrong words. Both heights are rounded to whole pixels, while a line
      // more or less differs by a whole line height. Breaks at other places within the same count go unseen.
      overlay.fits ??= Math.abs(overlay.inner.offsetHeight + overlay.padding - overlay.mirror.scrollHeight) < 2;
      if (overlay.element.scrollTop !== textarea.scrollTop) overlay.element.scrollTop = textarea.scrollTop;
      shown = overlay.fits;
    }
    if (shown === overlay.shown) return;
    overlay.element.style.visibility = shown ? "visible" : "hidden";
    overlay.shown = shown;
    syncRules();
  };

  /** Builds a composer's see-through overlay and registers the textarea as a source. */
  const attachOverlay = (textarea: HTMLTextAreaElement): Source => {
    const element = document.createElement("div");
    element.setAttribute("data-plugin", PREFIX);
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("style", OVERLAY_CSS);
    const inner = document.createElement("div");
    const node = document.createTextNode("");
    inner.appendChild(node);
    element.appendChild(inner);
    // Fixed and hidden, it stays out of the copy's layout.
    const mirror = document.createElement("textarea");
    mirror.setAttribute("tabindex", "-1");
    mirror.setAttribute("style", MIRROR_CSS);
    element.appendChild(mirror);
    document.body.appendChild(element);
    const source: Source = {
      kind: "composer", text: "", words: -1, present: 0, nodes: [node], runs: [], glyphs: [],
      overlay: { element, inner, node, mirror, textCss: "", padding: 0, css: "", mirrorCss: "", shown: false },
    };
    sources.set(textarea, source);
    return source;
  };

  const processComposer = (textarea: HTMLTextAreaElement) => {
    // Out of view means a hidden tab. One hidden by its own styles (opacity 0 while dictating) keeps its
    // source, and place() hides the overlay until the textarea shows again.
    if (styleOf("composer") === "off" || !textarea.isConnected || !visible.has(textarea)) {
      clear(textarea);
      return;
    }
    const text = textarea.value;
    const words = wordsFor(textarea);
    const existing = sources.get(textarea);
    const matches = existing?.text === text && existing.words === words ? undefined : matchesFor(text, words);
    // The overlay holds a copy of the whole draft, so a composer without keywords gets none.
    if (matches?.length === 0) {
      clear(textarea);
      return;
    }
    const source = existing ?? attachOverlay(textarea);
    const overlay = source.overlay!;
    if (matches) {
      unpaint(source);
      source.text = text;
      source.words = words;
      // A textarea shows an empty last line after a trailing newline; a div needs a character there.
      overlay.node.data = text.endsWith("\n") ? `${text} ` : text;
      overlay.mirror.value = text;
      overlay.fits = undefined;
      source.runs = runsFor(matches, source.nodes, [0]);
      source.glyphs = flat(source.runs);
      source.present = wordsIn(source.runs);
      syncScheme(textarea);
      paint(source);
      syncRules();
    }
    // Paseo restyles the composer per keystroke. Its text style is read here, when its text or tab
    // changes, on scroll, window focus and rescan, and not in the frame loop.
    const computed = getComputedStyle(textarea);
    overlay.textCss = COPIED.map((name) => `${name}:${computed.getPropertyValue(name)};`).join("");
    overlay.padding = parseFloat(computed.getPropertyValue("padding-top")) + parseFloat(computed.getPropertyValue("padding-bottom"));
    place(textarea, source);
    schedule();
  };

  const onComposerEvent = ({ type, target }: Event) => {
    if (disposed || !preferences) return;
    if (type === "scroll" && hasSent()) scheduleView();
    if (target instanceof HTMLElement && target.matches(COMPOSER)) {
      dirty.add(target as HTMLTextAreaElement);
      schedule();
    }
  };
  document.addEventListener("input", onComposerEvent, true);
  document.addEventListener("scroll", onComposerEvent, true);

  // Preferences, providers and OMP's flags change which sources show what. Sources skipped while
  // off are not tracked, so the whole page is scanned again, once per frame at most.
  let rescanFrame: number | undefined;
  const rescan = () => {
    rescanFrame = undefined;
    if (disposed || !preferences) return;
    for (const [element, source] of [...sources]) if (styleOf(source.kind) === "off") clear(element);
    for (const element of document.querySelectorAll<HTMLElement>(SENT)) processSent(element);
    for (const element of document.querySelectorAll<HTMLTextAreaElement>(COMPOSER)) {
      track(element);
      processComposer(element);
    }
    checkView();
    // A switch between moving and still colours keeps the glyphs and only repaints them.
    for (const source of sources.values()) paint(source);
    schedule();
  };
  const invalidate = () => {
    if (!disposed) rescanFrame ??= requestAnimationFrame(rescan);
  };

  // The chat list is virtualized: messages mount and unmount as it scrolls. Changes are collected
  // and handled once per frame, which also places the sent sources again, since a DOM change can move
  // them. Composers are tracked from the moment they mount, and sources and composers that left the
  // page are dropped as soon as a removal is seen.
  const mutations = new MutationObserver((records) => {
    if (disposed || !preferences) return;
    const sent = styleOf("sent") !== "off";
    const watched = sent ? `${SENT}, ${COMPOSER}` : COMPOSER;
    let removed = false;
    for (const record of records) {
      if (sent) {
        const target = record.target.nodeType === Node.ELEMENT_NODE ? (record.target as HTMLElement) : record.target.parentElement;
        const inside = target?.closest<HTMLElement>(SENT);
        if (inside) pending.add(inside);
      }
      if (record.type !== "childList") continue;
      if (record.removedNodes.length > 0) removed = true;
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as HTMLElement;
        for (const found of [element, ...element.querySelectorAll<HTMLElement>(watched)]) {
          if (found.matches(COMPOSER)) track(found as HTMLTextAreaElement);
          else if (sent && found.matches(SENT)) pending.add(found);
        }
      }
    }
    if (removed) {
      for (const element of [...sources.keys()]) if (!element.isConnected) clear(element);
      for (const textarea of [...composers.keys()]) if (!textarea.isConnected) forget(textarea);
    }
    if (pending.size > 0 || hasSent()) scheduleView();
  });
  mutations.observe(document.body, { childList: true, characterData: true, subtree: true });

  // Theme switches: Paseo's Unistyles swaps a theme class on <html> for a fixed theme and follows
  // prefers-color-scheme for "auto". The tone is read again in the next frame, from any source.
  let themeFrame: number | undefined;
  const retone = () => {
    if (disposed) return;
    themeFrame ??= requestAnimationFrame(() => {
      themeFrame = undefined;
      const sample = sources.keys().next().value;
      if (!disposed && sample) syncScheme(sample);
    });
  };
  const themes = new MutationObserver(retone);
  for (const root of [document.documentElement, document.body]) {
    themes.observe(root, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  }
  const colorScheme = matchMedia("(prefers-color-scheme: dark)");
  colorScheme.addEventListener("change", retone);

  // Back in the window or tab, or resized (Paseo's breakpoints change the text style): re-read the
  // composers in view and the theme, and place the sent sources again.
  const onReturn = () => {
    if (disposed || !preferences || document.visibilityState === "hidden") return;
    for (const textarea of composers.keys()) if (visible.has(textarea)) dirty.add(textarea);
    schedule();
    scheduleView();
    retone();
  };
  window.addEventListener("focus", onReturn);
  window.addEventListener("resize", onReturn);
  document.addEventListener("visibilitychange", onReturn);

  return {
    setPreferences(values) {
      // Re-read on every window focus; the same values need no rescan.
      if (preferences?.sent === values.sent && preferences.composer === values.composer && preferences.scope === values.scope) return;
      preferences = values;
      invalidate();
    },
    agent(id, provider) {
      if (directory.get(id) === provider) return;
      directory.set(id, provider);
      invalidate();
    },
    dispose() {
      disposed = true;
      clearTimeout(offTimer);
      mutations.disconnect();
      themes.disconnect();
      sizes.disconnect();
      document.removeEventListener("input", onComposerEvent, true);
      document.removeEventListener("scroll", onComposerEvent, true);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("resize", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      reducedMotion.removeEventListener("change", schedule);
      colorScheme.removeEventListener("change", retone);
      for (const handle of [frame, viewFrame, rescanFrame, themeFrame]) if (handle !== undefined) cancelAnimationFrame(handle);
      clearTimeout(stopTimer);
      for (const element of [...sources.keys()]) clear(element);
      for (const textarea of [...composers.keys()]) forget(textarea);
      for (const { word } of MAGIC_KEYWORDS) for (let stop = 0; stop < STOPS; stop++) registry.delete(`${PREFIX}-${word}-${stop}`);
      style.remove();
    },
  };
}

/** The nearest ancestor that scrolls, and so clips `element`; read once per sent source. */
function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return parent;
  }
  return undefined;
}

/** The words that occur in `runs`, as a bit mask over {@link MAGIC_KEYWORDS}. */
function wordsIn(runs: Run[]): number {
  let words = 0;
  for (const run of runs) words |= 1 << run.glyphs[0]!.keyword;
  return words;
}

/**
 * Paseo writes `textarea.value` directly on send, clear, draft restore, dictation and edit, which fires
 * no event. Wrapping the setter on this one element makes those writes visible without polling;
 * React's value tracker, an own property it defines at mount, stays in the chain.
 */
function hookValue(textarea: HTMLTextAreaElement, onSet: (textarea: HTMLTextAreaElement) => void): ValueHook | undefined {
  const own = Object.getOwnPropertyDescriptor(textarea, "value");
  const base = own ?? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  const get = base?.get;
  const set = base?.set;
  if (!get || !set || own?.configurable === false) return undefined;
  const hook: PropertyDescriptor = {
    configurable: true,
    enumerable: base.enumerable,
    get(this: HTMLTextAreaElement) {
      return get.call(this);
    },
    set(this: HTMLTextAreaElement, value: unknown) {
      set.call(this, value);
      onSet(textarea);
    },
  };
  Object.defineProperty(textarea, "value", hook);
  return { own, hook };
}

/** Undoes {@link hookValue}, unless something has replaced the hook since. */
function unhookValue(textarea: HTMLTextAreaElement, hook: ValueHook | undefined) {
  if (!hook || Object.getOwnPropertyDescriptor(textarea, "value")?.set !== hook.hook.set) return;
  if (hook.own) Object.defineProperty(textarea, "value", hook.own);
  else Reflect.deleteProperty(textarea, "value");
}

/**
 * The agent a chat element belongs to, from the props of the React components above it: the
 * message's `UserMessage` and the `Composer` carry `agentId`, and an `agent` object with `provider`
 * sits further up. Read only; Paseo exposes no DOM marker for the agent.
 */
function agentOf(element: HTMLElement): AgentRef {
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: Fiber | null | undefined = key ? (element as unknown as Record<string, Fiber | undefined>)[key] : undefined;
  const agent: AgentRef = {};
  for (let depth = 0; fiber && depth < FIBER_DEPTH; depth++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (!props || typeof fiber.type === "string") continue;
    if (agent.id === undefined && typeof props.agentId === "string") agent.id = props.agentId;
    const owner = props.agent;
    if (owner && typeof owner.provider === "string" && (agent.id === undefined || owner.id === agent.id)) {
      agent.id ??= typeof owner.id === "string" ? owner.id : undefined;
      agent.provider = owner.provider;
      break;
    }
  }
  return agent;
}

/** Text node and offset for a character offset into the element's text. */
function locate(nodes: Text[], starts: number[], offset: number): [Text, number] | undefined {
  if (nodes.length === 0) return undefined;
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  const node = nodes[lo]!;
  return [node, Math.min(offset - starts[lo]!, node.data.length)];
}

/**
 * Whether an element is on screen as far as its own styles go. Without checkVisibility only
 * `display: none` counts, though `visibility` and `opacity` also hide a composer the fixed overlay
 * would still paint over.
 */
function isShown(element: HTMLElement): boolean {
  return element.checkVisibility
    ? element.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    : element.getClientRects().length > 0;
}

/** Relative luminance (0 dark … 1 light) of a computed `rgb()`/`rgba()` color. */
function luminance(color: string): number {
  const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/g) ?? []).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
