import { Platform } from "react-native";
import type { LiveStyle, Preferences, SpinnerId } from "../shared/preferences";
import { CATALOG_CSS, SPINNER_MARKUP } from "./catalog";

// Sanctioned web-only globals: the rest of the plugin has no DOM library.
export interface El {
  readonly firstElementChild: El | null;
  readonly parentElement: El | null;
  readonly nextSibling: El | null;
  readonly children: ArrayLike<El>;
  readonly offsetWidth: number;
  readonly outerHTML: string;
  className: string;
  innerHTML: string;
  textContent: string | null;
  style: { setProperty(name: string, value: string, priority?: string): void; removeProperty(name: string): void };
  classList: { add(name: string): void; remove(name: string): void; contains(name: string): boolean };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  matches(selector: string): boolean;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
  closest(selector: string): El | null;
  insertBefore(node: El, reference: El | null): void;
  appendChild(node: El | TextNode): void;
  remove(): void;
  readonly isConnected: boolean;
  getAnimations(options?: { subtree: boolean }): Anim[];
  animate(keyframes: object[], options: object): Anim;
}
/** A Web Animation; CSS animations are the ones with an `animationName`. */
export interface Anim {
  readonly animationName?: string;
  readonly effect: { readonly target: El; readonly pseudoElement: string | null; getKeyframes(): object[]; getTiming(): object } | null;
  pause(): void;
  play(): void;
  cancel(): void;
}
interface TextNode { data: string }
interface NodeLike { nodeType: number; parentElement: El | null }
interface Computed { color: string; backgroundColor: string; fontSize: string; fontFamily: string; fontWeight: string; lineHeight: string }
declare const document: {
  head: El;
  body: El;
  createElement(tag: string): El;
  createTextNode(data: string): TextNode;
  querySelectorAll(selector: string): ArrayLike<El>;
};
declare const window: {
  getComputedStyle(element: El): Computed;
  matchMedia(query: string): { readonly matches: boolean; addEventListener(type: "change", listener: () => void): void };
};
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(handle: number): void;
declare function requestAnimationFrame(callback: () => void): number;
declare function cancelAnimationFrame(handle: number): void;
declare function setInterval(callback: () => void, ms: number): number;
declare function clearInterval(handle: number): void;
declare class MutationObserver {
  constructor(callback: (records: ArrayLike<{ target: NodeLike }>) => void);
  observe(target: El, options: { childList: boolean; subtree: boolean; characterData: boolean }): void;
  disconnect(): void;
}
declare class ResizeObserver {
  constructor(callback: (entries: ArrayLike<{ target: El; contentRect: { width: number; height: number } }>) => void);
  observe(target: El): void;
  unobserve(target: El): void;
}

export const isWeb = Platform.OS === "web" && typeof document !== "undefined";

/** Marks every element this plugin adds, so its own text changes never wake the page observer. */
const OWN = "data-spn-own";

let styleUsers = 0;
let styleElement: El | null = null;
/** Injects the catalog CSS once per page; the settings screen and the footer runtime share it. */
export function retainCatalogStyle(): () => void {
  if (!isWeb) return () => {};
  if (styleUsers++ === 0) {
    styleElement = document.createElement("style");
    styleElement.setAttribute("data-plugin", "noice-chat-turn-status");
    styleElement.textContent = CATALOG_CSS;
    document.head.appendChild(styleElement);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--styleUsers === 0) {
      styleElement?.remove();
      styleElement = null;
    }
  };
}

// ── Running the animations ──────────────────────────────────────────────────────────────────
// Every animation is written as CSS (catalog.ts) but runs as a Web Animation. Paseo's React root
// listens for `animationiteration`, and while anything listens Chromium wakes the main thread for
// every CSS animation it runs, about 20 frames a second for each; a Web Animation fires no such
// event and stays on the compositor. So once an element is laid out its CSS animations are copied
// (same keyframes, easing, duration and delay) into Web Animations, and the CSS ones are switched
// off with `data-spn-waapi`. A Web Animation on an element that is not rendered is ticked on the
// main thread every frame (a CSS one would stop), so each one plays only while its element has a
// box: a ResizeObserver pauses them at 0×0 (a hidden panel) and cancels them once the element has
// left the page. Not an IntersectionObserver: while one observes anything, Chromium turns every
// frame of a composited animation into a main-thread frame.

const WAAPI = "data-spn-waapi";
/** Each element whose animations run as Web Animations: null until it is first laid out. */
const motions = new Map<El, { animations: Anim[] | null; shown: boolean }>();
let sizes: ResizeObserver | null = null;

/** Copies `root`'s CSS animations (its own and its descendants') into Web Animations, all started together. */
function adopt(root: El): Anim[] {
  const copies = root.getAnimations({ subtree: true }).flatMap((animation) => {
    if (!animation.animationName || !animation.effect) return [];
    const { target, pseudoElement } = animation.effect;
    // computedOffset is read-only output; offsets, per-keyframe easing and values are kept as given.
    const keyframes = animation.effect.getKeyframes().map(({ computedOffset: _, ...keyframe }: { computedOffset?: number }) => keyframe);
    return [{ target, keyframes, timing: { ...animation.effect.getTiming(), ...(pseudoElement ? { pseudoElement } : {}) } }];
  });
  root.setAttribute(WAAPI, "");
  return copies.map(({ target, keyframes, timing }) => target.animate(keyframes, timing));
}

/** Runs `root`'s CSS animations as Web Animations from its first layout until it leaves the page. */
function runOnCompositor(root: El): void {
  if (!sizes) {
    sizes = new ResizeObserver((entries) => {
      for (let i = 0; i < entries.length; i++) {
        const { target, contentRect } = entries[i]!;
        const motion = motions.get(target);
        if (!motion) continue;
        if (!target.isConnected) {
          motion.animations?.forEach((animation) => animation.cancel());
          motions.delete(target);
          sizes!.unobserve(target);
          continue;
        }
        motion.shown = contentRect.width > 0 || contentRect.height > 0;
        if (!motion.shown) motion.animations?.forEach((animation) => animation.pause());
        else if (!motion.animations) motion.animations = adopt(target);
        else motion.animations.forEach((animation) => animation.play());
      }
    });
    // Reduced motion slows the CSS (catalog.ts); a switch re-copies it with the new durations.
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
      for (const [root, motion] of motions) {
        if (!motion.animations) continue;
        motion.animations.forEach((animation) => animation.cancel());
        root.removeAttribute(WAAPI);
        motion.animations = adopt(root);
        if (!motion.shown) motion.animations.forEach((animation) => animation.pause());
      }
    });
  }
  motions.set(root, { animations: null, shown: false });
  sizes.observe(root);
}

/** A spinner element (font-size sets its size), or null for "off". */
export function createSpinner(id: SpinnerId): El | null {
  if (id === "off") return null;
  const { cls, html } = SPINNER_MARKUP[id];
  const element = document.createElement("span");
  element.className = `spn ${cls}`;
  element.innerHTML = html;
  element.setAttribute(OWN, "");
  element.setAttribute("aria-hidden", "true");
  runOnCompositor(element);
  return element;
}

/** A CSS mask url for an SVG icon; any opaque stroke works, the mask only uses alpha. */
export function iconUrl(svg: string): string {
  const withNamespace = svg.includes("xmlns=") ? svg : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return `url("data:image/svg+xml,${encodeURIComponent(withNamespace)}")`;
}

const LIVE_CLASS: Record<Exclude<LiveStyle, "off">, string> = {
  shimmer: "spn-live",
  rolling: "spn-live spn-roll-label",
  typed: "spn-live spn-typed",
  icon: "spn-live spn-icon",
};

/** Puts the sheen over `host` and returns its bright copy, which the caller fills with what `host` shows. */
function addSheen(host: El): El {
  const sheen = document.createElement("span");
  sheen.className = "spn-gl";
  sheen.setAttribute("aria-hidden", "true");
  sheen.innerHTML = '<span class="w"><span class="c"></span></span>';
  host.classList.add("spn-sheen");
  host.appendChild(sheen);
  runOnCompositor(sheen);
  return sheen.querySelector(".c")!;
}

/** Text with the sheen over it: the muted text, and its bright copy seen through the moving band. */
export class SheenText {
  readonly el: El;
  private readonly base: TextNode;
  private readonly copy: El;

  constructor(className = "") {
    this.el = document.createElement("span");
    this.el.className = className;
    this.el.setAttribute(OWN, "");
    this.base = document.createTextNode("");
    this.el.appendChild(this.base);
    this.copy = addSheen(this.el);
  }

  set(text: string): void {
    if (text === this.base.data) return;
    this.base.data = text;
    this.copy.textContent = text;
  }
}

/** The live-activity label in one of its styles. `set` animates from the old text to the new. */
export class LiveLabel {
  readonly el: El;
  private readonly text: El;
  /** Shimmer and rolling: the text element carries its own sheen. */
  private readonly line: SheenText | null;
  private readonly icon: El | null;
  /** Icon: one sheen over the whole label, whose copy repeats the icon and the text. */
  private readonly copy: { icon: El; text: El } | null = null;
  private shown = "";
  private target = "";
  private targetIcon: string | null = null;
  private timer = 0;

  constructor(readonly style: Exclude<LiveStyle, "off">) {
    this.el = document.createElement("span");
    this.el.className = LIVE_CLASS[style];
    this.el.setAttribute(OWN, "");
    this.icon = style === "icon" ? document.createElement("span") : null;
    if (this.icon) {
      this.icon.className = "ico";
      this.el.appendChild(this.icon);
    }
    this.line = style === "shimmer" || style === "rolling" ? new SheenText("t") : null;
    this.text = this.line?.el ?? document.createElement("span");
    if (!this.line) this.text.className = "t";
    if (style === "typed") runOnCompositor(this.text); // the caret's blink
    this.el.appendChild(this.text);
    if (this.icon) {
      const copy = addSheen(this.el);
      copy.innerHTML = '<span class="ico"></span><span class="t"></span>';
      this.copy = { icon: copy.children[0]!, text: copy.children[1]! };
    }
  }

  set(text: string, icon: string | null = null): void {
    if (text === this.target && icon === this.targetIcon) return;
    const first = this.target === "";
    this.target = text;
    this.targetIcon = icon;
    if (first) {
      this.show(text, icon);
      return;
    }
    if (this.timer) return; // a transition is running; it picks up the newest target when it lands
    if (this.style === "typed") this.typeStep();
    else if (this.style === "rolling") this.roll();
    else this.fade();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = 0;
    this.el.remove();
  }

  private show(text: string, icon: string | null): void {
    this.shown = text;
    if (this.line) this.line.set(text);
    else this.text.textContent = text;
    if (this.icon && this.copy) {
      this.copy.text.textContent = text;
      for (const element of [this.icon, this.copy.icon]) {
        if (icon) element.style.setProperty("--icon", icon);
        else element.style.removeProperty("--icon");
      }
    }
  }

  private fade(): void {
    this.el.classList.add("spn-fade");
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.show(this.target, this.targetIcon);
      this.el.classList.remove("spn-fade");
    }, 250);
  }

  private roll(): void {
    this.text.classList.add("out");
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.show(this.target, this.targetIcon);
      this.text.classList.remove("out");
      this.text.classList.add("pre");
      void this.text.offsetWidth; // commit the "pre" position so removing it animates
      this.text.classList.remove("pre");
    }, 220);
  }

  /** Erase back to the common prefix, then type the rest, one character per step. */
  private typeStep(): void {
    const erasing = !this.target.startsWith(this.shown);
    if (!erasing && this.shown === this.target) {
      this.timer = 0;
      return;
    }
    this.shown = erasing ? this.shown.slice(0, -1) : this.target.slice(0, this.shown.length + 1);
    this.text.textContent = this.shown;
    this.timer = setTimeout(() => this.typeStep(), erasing ? 14 : 45);
  }
}

const DIGITS = `<span>${Array.from({ length: 10 }, (_, d) => `<b>${d}</b>`).join("")}</span>`;

/** Elapsed time whose digits roll into place like an odometer (each digit strip slides by transform). */
export class RollingTime {
  readonly el: El;
  private shape = "";
  private columns: ArrayLike<El> = [];
  /** The digit each column shows, so an unchanged column is not written again. */
  private digits = "";

  constructor() {
    this.el = document.createElement("span");
    this.el.className = "spn-roll";
    this.el.setAttribute(OWN, "");
  }

  set(text: string): void {
    const shape = text.replace(/\d/g, "#");
    if (shape !== this.shape) {
      // New layout ("59s" → "1m"): rebuild without animating.
      this.shape = shape;
      this.el.innerHTML = [...text].map((ch) => (/\d/.test(ch) ? `<span class="col">${DIGITS}</span>` : ch)).join("");
      this.columns = this.el.querySelectorAll(".col > span");
      this.digits = "";
    }
    const digits = text.replace(/\D/g, "");
    for (let i = 0; i < digits.length; i++) {
      if (digits[i] !== this.digits[i]) this.columns[i]?.style.setProperty("transform", `translateY(calc(round(var(--spn-lh, 1.4em), 1px) * -${digits[i]}))`);
    }
    this.digits = digits;
  }
}

/** Seconds in Paseo's elapsed format ("12s", "3m", "3m 12s", "1h 5m"); null if unreadable. */
export function parseDuration(text: string): number | null {
  const parts = [...text.matchAll(/(\d+)\s*([hms])/g)];
  if (parts.length === 0) return null;
  return parts.reduce((sum, [, n, unit]) => sum + Number(n) * (unit === "h" ? 3600 : unit === "m" ? 60 : 1), 0);
}

/** Paseo's own elapsed format (app utils/time.ts formatDuration). */
export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return s % 60 === 0 ? `${minutes}m` : `${minutes}m ${s % 60}s`;
  return minutes % 60 === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Warming changes in steps of this many seconds. */
const WARM_STEP = 10;

/**
 * Warming time: invisible for the first minute (the user only cares about turns that run long),
 * a faint 15 % that firms up to full by 5 min, then amber by 10 min and red by 15 min.
 * It moves in 10 s steps with no transition: a step is at most 5 % opacity or a thirtieth of the
 * colour blend, too small to see, and nothing animates between steps (a transition re-aimed every
 * second kept the page drawing frames for the whole 1–15 min ramp).
 */
export function warmth(elapsed: number, light: boolean): { opacity: number; color: string } {
  const seconds = Math.floor(elapsed / WARM_STEP) * WARM_STEP;
  const warm = light ? "#b7741a" : "#e8a64a";
  const hot = light ? "#c8412f" : "#ec6f5e";
  const mix = (from: string, to: string, f: number) => `color-mix(in srgb, ${to} ${Math.round(Math.min(1, f) * 100)}%, ${from})`;
  const opacity = seconds < 60 ? 0 : seconds < 300 ? 0.15 + 0.85 * ((seconds - 60) / 240) ** 1.5 : 1;
  const color = seconds < 300 ? "var(--spn-muted)"
    : seconds < 900 ? mix("var(--spn-muted)", warm, (seconds - 300) / 300) : mix(warm, hot, (seconds - 900) / 300);
  return { opacity, color };
}

/** True when a CSS colour is light, i.e. the theme behind it is dark. */
function isLightInk(color: string): boolean {
  const [r = 0, g = 0, b = 0] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
}

// ── The turn footer ─────────────────────────────────────────────────────────────────────────
// Paseo 0.12 (app agent-stream/turn-footer.tsx): the running turn's footer is
// [data-testid="turn-working-indicator"] > content row > [loader wrapper, fork menu?, elapsed].
// The chat scroll container holds both the footer and this turn's rows.

const FOOTER = '[data-testid="turn-working-indicator"]';
const ELAPSED = '[data-testid="turn-working-elapsed"]';
const SCROLL = '[data-testid="agent-chat-scroll"]';
const ROW = "[data-history-row-id]";
const TOOL = '[data-testid="tool-call-badge"], [data-testid="tool-call-group"]';

const FOOTER_CSS = `
[data-spn-loader] > :not([data-spn-own]) { display: none !important; }
[data-spn-spinner="off"] [data-spn-loader] { display: none !important; }
[data-spn-loader] > .spn { font-size: 14px; color: var(--spn-fg); }
[data-spn-time="off"] ${ELAPSED}, [data-spn-time="shimmer"] ${ELAPSED}, [data-spn-time="rolling"] ${ELAPSED} { display: none !important; }
[data-spn-time="shimmer"] .spn-stime { color: var(--spn-muted); white-space: nowrap; }
[data-spn-time="warming"] ${ELAPSED} { color: var(--spn-warm-color, var(--spn-muted)) !important;
  opacity: var(--spn-warm-opacity, 0) !important; }
[data-spn-time="rolling"] .spn-roll { color: var(--spn-muted); }
`;

// Tool rows → a short phrase. Names are Paseo's provider-independent display names
// (@getpaseo/protocol tool-call-display), so claude, codex and omp agents read the same.
const VERBS: Record<string, string> = {
  Read: "Reading", Edit: "Editing", Write: "Writing", Shell: "Running", Terminal: "Running", Search: "Searching",
  Fetch: "Fetching", Thinking: "Thinking", Task: "Delegating", Plan: "Planning", "Worktree setup": "Setting up worktree",
  Eval: "Running code", // omp's code cell; its row reads "Eval eval"
};
const MAX_LABEL = 40;
const NOISE_PROGRAMS: Record<string, true> = { cd: true, export: true, source: true, ".": true, set: true, sleep: true, true: true, ":": true };
const SKIP_NAMES: Record<string, true> = { "Task notification": true }; // Claude background-task completions
const BOUNDARY_NAMES: Record<string, true> = { "Message received": true }; // turn started by another agent's message
const NO_SUMMARY_OK: Record<string, true> = { Thinking: true, Plan: true };
const HOLD_MS = 1200;

const clip = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);

/** "cd x && FOO=1 git status | head" → "git status": first real program plus up to two plain words. */
function shortCommand(command: string): string {
  const words = (segment: string) => segment.trim().split(/\s+/).filter((w) => !/^\w+=/.test(w));
  const segments = command.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
  const segment = segments.find((s) => !NOISE_PROGRAMS[words(s)[0] ?? ""]) ?? segments[0] ?? command;
  const [program = "", ...rest] = words(segment);
  const out = [program.split("/").pop() ?? ""];
  for (const word of rest.slice(0, 2)) {
    if (/^[-'"$<>(]|[/=.]/.test(word)) break;
    out.push(word);
  }
  return out.join(" ");
}

interface Badge { kind: string; name: string; summary: string; icon: string | null }

function readBadge(badge: El): Badge | null {
  const first = badge.querySelector('div[dir="auto"]');
  const labelRow = first?.parentElement;
  if (!labelRow) return null;
  const texts = Array.from(labelRow.children).filter((c) => c.matches('div[dir="auto"]'));
  const svg = badge.querySelector("svg");
  return {
    kind: badge.getAttribute("data-testid") ?? "",
    name: texts[0]?.textContent?.trim() ?? "",
    summary: texts[1]?.textContent?.trim() ?? "",
    icon: svg ? iconUrl(svg.outerHTML) : null,
  };
}

function phrase({ kind, name, summary }: Badge): string {
  if (kind === "tool-call-group") return clip(name); // overview mode: "Read 3 files, ran 2 commands"
  const verb = VERBS[name];
  if (name === "Shell" || name === "Terminal") return clip(`${verb} ${shortCommand(summary)}`);
  if (name === "Read" || name === "Edit" || name === "Write") {
    const path = summary.replace(/:[\d,\- ]+$/, "");
    return clip(`${verb} ${path.split("/").filter(Boolean).pop() ?? path}`);
  }
  if (name === "Search") return clip(`${verb} “${summary}”`);
  if (name === "Thinking") return "Thinking";
  // A summary that only repeats the tool's name ("Eval eval") says nothing more.
  const detail = summary.toLowerCase() === name.toLowerCase() ? "" : summary;
  if (verb) return clip(detail ? `${verb}: ${detail}` : verb);
  return clip(detail ? `${name}: ${detail}` : name); // sub-agents, MCP and custom tools
}

type Derived = { text: string; icon: string | null } | { hold: string; fallback: string; icon: string | null };

/** The newest row of the turn decides; walk back past rows that are not the agent's own work. */
function deriveActivity(scroll: El): Derived {
  const rows = scroll.querySelectorAll(ROW);
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.querySelector('[data-testid="user-message"]')) return { text: "Working", icon: null };
    const badges = row.querySelectorAll(TOOL);
    if (badges.length) {
      const badge = readBadge(badges[badges.length - 1]!);
      if (!badge || SKIP_NAMES[badge.name]) continue;
      if (BOUNDARY_NAMES[badge.name]) return { text: "Working", icon: null };
      // Input still streaming: Paseo shows the raw provider name ("Bash", "Agent") with no summary yet.
      if (!badge.summary && !NO_SUMMARY_OK[badge.name] && badge.kind !== "tool-call-group") {
        return { hold: row.getAttribute("data-history-row-id") ?? "", fallback: phrase(badge), icon: badge.icon };
      }
      return { text: phrase(badge), icon: badge.icon };
    }
    if (row.querySelector('[data-testid="assistant-message"]')) return { text: "Writing", icon: null };
  }
  return { text: "Working", icon: null };
}

function firstOpaqueBackground(start: El | null): string {
  for (let el = start; el; el = el.parentElement) {
    const bg = window.getComputedStyle(el).backgroundColor;
    if (bg && !/^(transparent|rgba\(\d+, \d+, \d+, 0\))$/.test(bg)) return bg;
  }
  return "transparent";
}

interface FooterState {
  spinnerId?: SpinnerId;
  spin?: El;
  live?: LiveLabel;
  /** Our copy of the elapsed time for the styles that replace Paseo's text. */
  time?: { style: "shimmer" | "rolling"; view: SheenText | RollingTime };
  hold?: { row: string; since: number };
  /** The warming opacity and colour last written, so a render that changes nothing writes nothing. */
  warm?: string;
  light: boolean;
}

/** Sets an attribute only when it differs: every write invalidates the footer's style. */
function setAttribute(element: El, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

export interface Indicator {
  setPreferences(preferences: Preferences): void;
  dispose(): void;
}

/** Restyles every running turn's footer. Does nothing until the first preferences arrive. */
export function startIndicator(): Indicator {
  if (!isWeb) return { setPreferences() {}, dispose() {} };
  const releaseCatalog = retainCatalogStyle();
  const style = document.createElement("style");
  style.setAttribute("data-plugin", "noice-chat-turn-status-footer");
  style.textContent = FOOTER_CSS;
  document.head.appendChild(style);

  let preferences: Preferences | null = null;
  let frame = 0;
  let disposed = false;
  const states = new WeakMap<El, FooterState>();

  /** Colours and font are read once, before any of our styles change the elapsed text. */
  const setup = (footer: El, loader: El, elapsed: El | null): FooterState => {
    const scroll = footer.closest(SCROLL);
    const time = elapsed ? window.getComputedStyle(elapsed) : null;
    let ink = "";
    const leaves = loader.querySelectorAll("div");
    for (let i = 0; i < leaves.length && !ink; i++) {
      const bg = window.getComputedStyle(leaves[i]!).backgroundColor;
      if (!/^(transparent|rgba\(\d+, \d+, \d+, 0\))$/.test(bg)) ink = bg.replace(/rgba\((\d+, \d+, \d+), [\d.]+\)/, "rgb($1)");
    }
    const fg = ink || (scroll ? window.getComputedStyle(scroll).color : "currentColor");
    footer.style.setProperty("--spn-fg", fg);
    footer.style.setProperty("--spn-muted", time?.color ?? fg);
    footer.style.setProperty("--spn-bg", firstOpaqueBackground(footer));
    if (time) {
      footer.style.setProperty("--spn-lh", time.lineHeight === "normal" ? "1.4em" : time.lineHeight);
      footer.style.setProperty("--spn-font", `${time.fontWeight} ${time.fontSize} ${time.fontFamily}`);
    }
    loader.setAttribute("data-spn-loader", "");
    const state: FooterState = { light: !isLightInk(fg) };
    states.set(footer, state);
    return state;
  };

  const renderFooter = (footer: El, prefs: Preferences) => {
    const content = footer.firstElementChild;
    const loader = content?.firstElementChild;
    if (!content || !loader) return;
    const elapsed = footer.querySelector(ELAPSED);
    const state = states.get(footer) ?? setup(footer, loader, elapsed);

    setAttribute(footer, "data-spn-spinner", prefs.spinner);
    if (state.spinnerId !== prefs.spinner) {
      state.spin?.remove();
      state.spin = createSpinner(prefs.spinner) ?? undefined;
      if (state.spin) loader.appendChild(state.spin);
      state.spinnerId = prefs.spinner;
    }

    if (prefs.live === "off" || state.live?.style !== prefs.live) {
      state.live?.dispose();
      state.live = undefined;
    }
    if (prefs.live !== "off") {
      if (!state.live) {
        state.live = new LiveLabel(prefs.live);
        state.live.el.setAttribute("style", "font: var(--spn-font)");
      }
      if (state.live.el.parentElement !== content) content.insertBefore(state.live.el, loader.nextSibling);
      const scroll = footer.closest(SCROLL);
      if (scroll) {
        const derived = deriveActivity(scroll);
        if ("hold" in derived) {
          // Keep the previous label while a new tool's input streams in; fall back after HOLD_MS.
          if (state.hold?.row !== derived.hold) {
            state.hold = { row: derived.hold, since: Date.now() };
            setTimeout(schedule, HOLD_MS + 50);
          }
          if (Date.now() - state.hold.since > HOLD_MS) state.live.set(derived.fallback, derived.icon);
          else if (!state.live.el.textContent) state.live.set("Working");
        } else {
          state.hold = undefined;
          state.live.set(derived.text, derived.icon);
        }
      }
    }

    setAttribute(footer, "data-spn-time", prefs.time);
    const text = elapsed?.textContent ?? "";
    const replaced = prefs.time === "shimmer" || prefs.time === "rolling" ? prefs.time : null;
    if (state.time && (state.time.style !== replaced || !elapsed?.parentElement)) {
      state.time.view.el.remove();
      state.time = undefined;
    }
    if (replaced && elapsed?.parentElement) {
      if (!state.time) {
        // Same font as Paseo's elapsed text (it is hidden while ours shows).
        const view = replaced === "shimmer" ? new SheenText("spn-stime") : new RollingTime();
        view.el.setAttribute("style", replaced === "shimmer" ? "font: var(--spn-font); font-variant-numeric: tabular-nums" : "font: var(--spn-font)");
        state.time = { style: replaced, view };
      }
      const { el } = state.time.view;
      if (el.parentElement !== elapsed.parentElement) elapsed.parentElement.insertBefore(el, elapsed.nextSibling);
      state.time.view.set(text);
    }
    if (prefs.time === "warming") {
      const { opacity, color } = warmth(parseDuration(text) ?? 0, state.light);
      if (state.warm !== `${opacity} ${color}`) {
        state.warm = `${opacity} ${color}`;
        footer.style.setProperty("--spn-warm-opacity", String(opacity));
        footer.style.setProperty("--spn-warm-color", color);
      }
    }
  };

  const render = () => {
    frame = 0;
    if (disposed || !preferences) return;
    const footers = document.querySelectorAll(FOOTER);
    for (let i = 0; i < footers.length; i++) renderFooter(footers[i]!, preferences);
  };
  function schedule() {
    if (!frame && !disposed) frame = requestAnimationFrame(render);
  }

  const observer = new MutationObserver((records) => {
    for (let i = 0; i < records.length; i++) {
      const node = records[i]!.target;
      const element = node.nodeType === 1 ? (node as unknown as El) : node.parentElement; // Element or Text node
      if (!element?.closest(`[${OWN}]`)) {
        schedule();
        return;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  /** Puts a footer back exactly as Paseo drew it. */
  const restore = (footer: El) => {
    const state = states.get(footer);
    state?.spin?.remove();
    state?.live?.dispose();
    state?.time?.view.el.remove();
    states.delete(footer);
    footer.querySelector("[data-spn-loader]")?.removeAttribute("data-spn-loader");
    for (const name of ["data-spn-spinner", "data-spn-time"]) footer.removeAttribute(name);
    for (const name of ["--spn-fg", "--spn-muted", "--spn-bg", "--spn-lh", "--spn-font", "--spn-warm-opacity", "--spn-warm-color"]) {
      footer.style.removeProperty(name);
    }
  };

  return {
    setPreferences(next) {
      preferences = next;
      schedule();
    },
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      const footers = document.querySelectorAll(FOOTER);
      for (let i = 0; i < footers.length; i++) restore(footers[i]!);
      style.remove();
      releaseCatalog();
    },
  };
}

// ── Settings demos ──────────────────────────────────────────────────────────────────────────
// The settings screen renders empty <span>s; these fill them with the real controllers fed by
// sample data, so every tile shows exactly what the footer will.

export interface DemoColors { fg: string; muted: string; bg: string; light: boolean }

// Lucide-style 16-px glyphs standing in for Paseo's own tool icons, which only exist in the chat.
const DEMO_ICONS = {
  read: '<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  shell: '<path d="M2.5 4.5 6 8l-3.5 3.5M8 12h5.5"/>',
  edit: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
} as const;
const DEMO_ACTIVITY: { text: string; icon: keyof typeof DEMO_ICONS | null }[] = [
  { text: "Reading overrides.ts", icon: "read" },
  { text: "Running git status", icon: "shell" },
  { text: "Editing OVERVIEW.md", icon: "edit" },
  { text: "Searching “testID”", icon: "search" },
  { text: "Thinking", icon: null },
  { text: "Writing", icon: null },
];
const demoIcon = (key: keyof typeof DEMO_ICONS | null) => key
  ? iconUrl(`<svg viewBox="0 0 16 16" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${DEMO_ICONS[key]}</svg>`)
  : null;

function paint(host: El, colors: DemoColors, fontSize: number): void {
  host.style.setProperty("--spn-fg", colors.fg);
  host.style.setProperty("--spn-muted", colors.muted);
  host.style.setProperty("--spn-bg", colors.bg);
  host.style.setProperty("--spn-lh", `${Math.round(fontSize * 1.35)}px`);
  host.style.setProperty("font-size", `${fontSize}px`);
  host.style.setProperty("line-height", `${Math.round(fontSize * 1.35)}px`);
  host.style.setProperty("color", colors.fg);
  host.style.setProperty("display", "inline-flex");
  host.style.setProperty("align-items", "center");
  host.style.setProperty("white-space", "nowrap");
}

/** A spinner at `size` px. */
export function mountSpinnerDemo(host: El, id: SpinnerId, colors: DemoColors, size: number): () => void {
  paint(host, colors, size);
  const spinner = createSpinner(id);
  if (spinner) host.appendChild(spinner);
  else host.innerHTML = '<span style="opacity:.35">—</span>';
  return () => { host.innerHTML = ""; };
}

/** A live label cycling through sample activities every 2.4 s. */
export function mountLiveDemo(host: El, style: LiveStyle, colors: DemoColors, size: number): () => void {
  paint(host, colors, size);
  if (style === "off") {
    host.innerHTML = '<span style="opacity:.35">—</span>';
    return () => { host.innerHTML = ""; };
  }
  const label = new LiveLabel(style);
  host.appendChild(label.el);
  let step = 0;
  label.set(DEMO_ACTIVITY[0]!.text, demoIcon(DEMO_ACTIVITY[0]!.icon));
  const timer = setInterval(() => {
    step = (step + 1) % DEMO_ACTIVITY.length;
    label.set(DEMO_ACTIVITY[step]!.text, demoIcon(DEMO_ACTIVITY[step]!.icon));
  }, 2400);
  return () => { clearInterval(timer); label.dispose(); };
}

/**
 * The elapsed time in a style. It starts at 1m 12s and ticks in real time; "warming" runs 30× faster
 * from zero and loops every 20 minutes (40 s), so its hidden first minute and colour change are visible.
 */
export function mountTimeDemo(host: El, style: Preferences["time"], colors: DemoColors, size: number): () => void {
  paint(host, colors, size);
  host.style.setProperty("color", colors.muted);
  if (style === "off") {
    host.innerHTML = '<span style="opacity:.35">—</span>';
    return () => { host.innerHTML = ""; };
  }
  const started = Date.now();
  const view = style === "rolling" ? new RollingTime() : style === "shimmer" ? new SheenText() : null;
  const text = view ? view.el : document.createElement("span");
  host.appendChild(text);
  let warm = "";
  const tick = () => {
    if (style === "warming") {
      const seconds = ((Date.now() - started) * 0.03) % 1200;
      const { opacity, color } = warmth(seconds, colors.light);
      text.textContent = formatDuration(seconds);
      if (warm !== `${opacity} ${color}`) {
        warm = `${opacity} ${color}`;
        text.style.setProperty("opacity", String(opacity));
        text.style.setProperty("color", color);
      }
      return;
    }
    const label = formatDuration(72 + (Date.now() - started) / 1000);
    if (view) view.set(label);
    else text.textContent = label;
  };
  tick();
  const timer = setInterval(tick, style === "warming" ? 250 : 1000);
  return () => { clearInterval(timer); host.innerHTML = ""; };
}

/** The three settings combined into one turn footer, the way Paseo will show it. */
export function mountFooterDemo(host: El, preferences: Preferences, colors: DemoColors): () => void {
  paint(host, colors, 12);
  host.style.setProperty("gap", "12px");
  host.style.setProperty("height", "24px");
  const parts = [preferences.spinner !== "off", preferences.live !== "off", preferences.time !== "off"];
  const slots = parts.map(() => document.createElement("span"));
  const cleanups: (() => void)[] = [];
  if (parts[0]) cleanups.push(mountSpinnerDemo(slots[0]!, preferences.spinner, colors, 14));
  if (parts[1]) cleanups.push(mountLiveDemo(slots[1]!, preferences.live, colors, 12));
  if (parts[2]) cleanups.push(mountTimeDemo(slots[2]!, preferences.time, colors, 12));
  slots.forEach((slot, i) => { if (parts[i]) host.appendChild(slot); });
  if (!parts.some(Boolean)) host.innerHTML = '<span style="opacity:.45;font-style:italic">Nothing shown while an agent works</span>';
  return () => { cleanups.forEach((cleanup) => cleanup()); host.innerHTML = ""; };
}
