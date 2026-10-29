import { Platform } from "react-native";
import type { Preferences } from "../shared/preferences";
import { type AgentInfo, type Dot, type DotState, dotState, isLightText, orderTabs, readLayoutOrder, rootsByWorkspace, rowDots } from "./model";

// Sanctioned web-only globals: the rest of the plugin has no DOM library.
interface Rect { left: number; top: number; right: number; bottom: number; width: number }
interface El {
  readonly nodeType: number;
  readonly isConnected: boolean;
  readonly firstElementChild: El | null;
  readonly lastElementChild: El | null;
  readonly nextSibling: El | null;
  readonly parentElement: El | null;
  readonly childElementCount: number;
  className: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): { forEach(callback: (element: El) => void): void };
  closest(selector: string): El | null;
  matches(selector: string): boolean;
  contains(other: El | null): boolean;
  insertBefore(node: El, reference: El | null): void;
  appendChild(node: El): void;
  remove(): void;
  getBoundingClientRect(): Rect;
  animate(keyframes: readonly (PulseKeyframe | HoldKeyframe)[], options: AnimateOptions): PulseAnimation;
  style: { left: string; top: string };
}
interface PulseKeyframe { offset: number; opacity: number; transform: string; easing?: string }
interface HoldKeyframe { offset: number; transform: string }
interface AnimateOptions { duration: number; iterations?: number; easing?: string; fill?: "forwards" }
interface PulseAnimation { startTime: number | null; readonly playState: string; pause(): void; cancel(): void }
interface MediaQueryLike {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}
interface PointerLike { target: El | null; relatedTarget: El | null }
declare const document: {
  head: El;
  body: El;
  createElement(tag: string): El;
  querySelectorAll(selector: string): { forEach(callback: (element: El) => void): void };
  addEventListener(type: "mouseover" | "mouseout", listener: (event: PointerLike) => void): void;
  removeEventListener(type: "mouseover" | "mouseout", listener: (event: PointerLike) => void): void;
};
declare const window: {
  innerWidth: number;
  addEventListener(type: "storage" | "focus", listener: () => void): void;
  removeEventListener(type: "storage" | "focus", listener: () => void): void;
  addEventListener(type: PressEvent, listener: (event: PressLike) => void, capture: true): void;
  removeEventListener(type: PressEvent, listener: (event: PressLike) => void, capture: true): void;
  getComputedStyle(element: El): { color: string };
  matchMedia(query: string): MediaQueryLike;
};
const PRESS_EVENTS = ["pointerdown", "mousedown", "touchstart", "pointerup", "mouseup", "touchend", "pointercancel", "click"] as const;
type PressEvent = (typeof PRESS_EVENTS)[number];
interface PressLike { type: string; target: El | null; pointerType?: string; stopPropagation(): void; preventDefault(): void }
declare const localStorage: { getItem(key: string): string | null };
declare function requestAnimationFrame(callback: () => void): number;
declare const performance: { now(): number };
declare function cancelAnimationFrame(handle: number): void;
declare function setInterval(callback: () => void, ms: number): number;
declare function clearInterval(handle: number): void;
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(handle: number): void;
interface MutationRecordLike { target: El; addedNodes: ArrayLike<El>; removedNodes: ArrayLike<El> }
declare class MutationObserver {
  constructor(callback: (records: MutationRecordLike[]) => void);
  observe(target: El, options: { childList: boolean; subtree: boolean }): void;
  disconnect(): void;
}
interface ResizeEntryLike { target: El; contentRect: { width: number; height: number } }
declare class ResizeObserver {
  constructor(callback: (entries: ResizeEntryLike[]) => void);
  observe(target: El): void;
  unobserve(target: El): void;
  disconnect(): void;
}

const ROW_PREFIX = "sidebar-workspace-row-";
const ROWS = `[data-testid^="${ROW_PREFIX}"]`;
const LAYOUT_KEY = "workspace-layout-state";
const DOTS = "data-tab-dots";
const REPLACE = "data-tab-dots-replace";
const ALIGN = "data-tab-dots-align";
const MAX_DOTS = 8;
/** Coloured dot and gap per size, in px. Each tab gets an equal slot of dot + gap. */
const SIZE_PX = { regular: { dot: 5, gap: 3 }, small: { dot: 4, gap: 2 } } as const;
const READ_PX = 3;
/** A hovered dot grows ×1.6; a hovered read dot grows to the same size as a hovered coloured one. */
const HOVER_SCALE = 1.6;
const HOVER_MS = 120;
const readHoverScale = (size: keyof typeof SIZE_PX) => +(HOVER_SCALE * SIZE_PX[size].dot / READ_PX).toFixed(3);

const PULSE_MS = 1800;
const WAVE_STEP_MS = 200;

/**
 * The running pulse. Spark + swell, wide: resting small and dim; a soft flash grows each dot to
 * full size and brightness. Row dots play it as a Web Animation, the tooltip's swatch as the CSS
 * `tab-dots-pulse` built from it. `ease-in-out` sits on each keyframe because CSS
 * `animation-timing-function` applies per keyframe interval.
 *
 * Row dots don't use the CSS animation: React listens for `animationiteration` on the page, and
 * with such a listener Blink wakes the main thread at every iteration of every CSS animation to
 * fire the event, even a composited one. Each wake-up is a full main frame (style, paint) of the
 * whole app. Web Animations have no iteration events, so a composited pulse runs on the
 * compositor alone.
 */
const PULSE_KEYFRAMES: readonly PulseKeyframe[] = [
  { offset: 0, opacity: 0.3, transform: "scale(.6)", easing: "ease-in-out" },
  { offset: 0.2, opacity: 1, transform: "scale(1)", easing: "ease-in-out" },
  { offset: 0.6, opacity: 0.3, transform: "scale(.6)", easing: "ease-in-out" },
  { offset: 1, opacity: 0.3, transform: "scale(.6)" },
];

/**
 * Start time that puts a running dot on a wave tied to the page clock: dot `index` trails dot
 * `index - 1` by one step, wherever it sits in the row. Rows drawn at different times and dots
 * redrawn later stay in the same wave. At most one period back, so a dot drawn right after page
 * load is already mid-pulse instead of waiting for its turn.
 */
function waveStart(index: number): number {
  return ((index * WAVE_STEP_MS) % PULSE_MS) - PULSE_MS;
}

const LABEL: Record<DotState, string> = {
  permission: "Waiting for permission",
  error: "Error",
  running: "Running",
  finished: "Finished · unread",
  read: "Read",
};

// Colours are Paseo's statusDot* tokens (app `styles/theme.ts`), dark and light.
const CSS = `
[${DOTS}] { display: inline-flex; align-items: center; flex: none; height: 20px; margin: 0 -${SIZE_PX.regular.gap / 2}px;
  --td-ok: #35c264; --td-err: #f7796d; --td-warn: #db932e; --td-run: #5caaf6; }
[${DOTS}][data-tone="light"] { --td-ok: #299f51; --td-err: #f12e2f; --td-warn: #b37824; --td-run: #268ae0; }
[${DOTS}][data-size="small"] { margin: 0 -${SIZE_PX.small.gap / 2}px; }
/* Each tab gets an equal slot (dot + gap, full row height): its hit area, which never scales. The
   dot inside takes no pointer events, so a hovered dot that grows never takes its neighbours' room.
   The outer <b> does the hover growth, the inner <b> carries the colour and the pulse, so both can
   run at once. */
[${DOTS}] > i { display: flex; align-items: center; justify-content: center; flex: none; height: 20px; cursor: pointer;
  width: ${SIZE_PX.regular.dot + SIZE_PX.regular.gap}px; }
[${DOTS}][data-size="small"] > i { width: ${SIZE_PX.small.dot + SIZE_PX.small.gap}px; }
[${DOTS}] > i > b { display: block; flex: none; width: ${SIZE_PX.regular.dot}px; height: ${SIZE_PX.regular.dot}px; pointer-events: none; transition: transform ${HOVER_MS}ms; }
[${DOTS}][data-size="small"] > i > b { width: ${SIZE_PX.small.dot}px; height: ${SIZE_PX.small.dot}px; }
[${DOTS}] > i > b > b { display: block; width: 100%; height: 100%; border-radius: 50%; transition: opacity ${HOVER_MS}ms; }
[${DOTS}] > i:hover > b { transform: scale(${HOVER_SCALE}); }
/* Read dots: small and faded; hovered, they grow to a hovered coloured dot's size and brighten a touch. */
[${DOTS}] > i[data-state="read"] > b { width: ${READ_PX}px; height: ${READ_PX}px; }
[${DOTS}] > i[data-state="read"]:hover > b { transform: scale(${readHoverScale("regular")}); }
[${DOTS}][data-size="small"] > i[data-state="read"]:hover > b { transform: scale(${readHoverScale("small")}); }
[${DOTS}] > i[data-state="read"] > b > b { background: currentColor; opacity: .3; }
[${DOTS}] > i[data-state="read"]:hover > b > b { opacity: .35; }
[${DOTS}] > i[data-state="finished"] > b > b, [data-tab-dots-tip] i[data-state="finished"] { background: var(--td-ok); }
[${DOTS}] > i[data-state="error"] > b > b, [data-tab-dots-tip] i[data-state="error"] { background: var(--td-err); }
[${DOTS}] > i[data-state="permission"] > b > b, [data-tab-dots-tip] i[data-state="permission"] { background: var(--td-warn); }
[${DOTS}] > i[data-state="running"] > b > b, [data-tab-dots-tip] i[data-state="running"] { background: var(--td-run); }
/* Row dots pulse through Web Animations (PULSE_KEYFRAMES); the tooltip's swatch lives only while hovered. */
[data-tab-dots-tip] i[data-state="running"] { animation: tab-dots-pulse ${PULSE_MS}ms ease-in-out infinite; }
[data-tab-dots-tip] i[data-state="read"] { background: currentColor; opacity: .35; }
[${DOTS}] > span { font-size: 8px; line-height: 20px; opacity: .5; font-variant-numeric: tabular-nums;
  margin: 0 ${SIZE_PX.regular.gap / 2}px 0 ${SIZE_PX.regular.gap / 2 + 1}px; }
[${DOTS}][data-size="small"] > span { margin: 0 ${SIZE_PX.small.gap / 2}px 0 ${SIZE_PX.small.gap / 2 + 1}px; }
@keyframes tab-dots-pulse { ${PULSE_KEYFRAMES.map(({ offset, opacity, transform }) => `${offset * 100}% { opacity: ${opacity}; transform: ${transform}; }`).join(" ")} }
@media (prefers-reduced-motion: reduce) { [data-tab-dots-tip] i { animation: none !important; } }
[data-tab-dots-tip][data-still] i { animation: none; }
/* Right edge: the time's slot keeps 18 px for the hover menu; the dots take it until the row is hovered. */
[${REPLACE}] [data-testid="sidebar-workspace-timestamp"] { display: none !important; }
[${REPLACE}][${ALIGN}="edge"]:not(:hover):not(:focus-within) [${DOTS}] + div:has([data-testid="sidebar-workspace-timestamp"]) { display: none !important; }
/* Left: the title stops growing, so the dots follow it; the time keeps the right edge. */
[${ALIGN}="left"] div:has(+ [${DOTS}]) { flex: 0 1 auto !important; min-width: 0 !important; }
[${ALIGN}="left"] [${DOTS}] { margin-right: auto; }
[data-tab-dots-tip] { position: fixed; z-index: 2147483000; pointer-events: none; display: none; align-items: center; gap: 6px;
  max-width: 280px; padding: 3px 8px; border-radius: 6px; font: 12px/18px system-ui, sans-serif; white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0,0,0,.25); --td-ok: #35c264; --td-err: #f7796d; --td-warn: #db932e; --td-run: #5caaf6; }
[data-tab-dots-tip][data-tone="light"] { --td-ok: #299f51; --td-err: #f12e2f; --td-warn: #b37824; --td-run: #268ae0; }
[data-tab-dots-tip] i { display: block; flex: none; width: 6px; height: 6px; border-radius: 50%; }
[data-tab-dots-tip] b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
[data-tab-dots-tip] em { font-style: normal; opacity: .6; }
`;

/** Title row inside a workspace row: button > rowContent > rowMain > content column > titleRow. No testid of its own. */
function findTitleRow(row: El): El | null {
  const titleRow = row.firstElementChild?.firstElementChild?.lastElementChild?.firstElementChild ?? null;
  const title = titleRow?.firstElementChild;
  return title && !title.hasAttribute(DOTS) ? titleRow : null;
}

/** The title's computed text colour, and the theme tone it implies: light text means a dark theme. */
function inkOf(title: El): { color: string; tone: "dark" | "light" } {
  const color = window.getComputedStyle(title).color;
  return { color, tone: isLightText(color) ? "dark" : "light" };
}

export interface TabDots {
  setAgents(agents: ReadonlyMap<string, AgentInfo>): void;
  setPreferences(preferences: Preferences): void;
  dispose(): void;
}

/** Opens one agent tab through the app's own navigation (see `index.client.tsx`). */
export type OpenTab = (target: { serverId: string; agentId: string }) => void;

/** How long a clicked dot stays hidden while Paseo marks its tab read; then the daemon's state wins. */
const OPTIMISTIC_READ_MS = 5000;

interface RowPlan {
  row: El;
  titleRow: El | null;
  dots: Dot[];
  more: number;
  color: string;
  tone: "dark" | "light";
  signature: string;
  existing: El | null;
}

/** Draws the dots into every sidebar workspace row and keeps them in sync. No-op off the web. */
export function startTabDots(initial: Preferences, openTab: OpenTab): TabDots {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return { setAgents() {}, setPreferences() {}, dispose() {} };
  }
  let preferences = initial;
  let agentsNow: ReadonlyMap<string, AgentInfo> = new Map();
  let roots = new Map<string, AgentInfo[]>();
  let rootsKey = "";
  let layoutRaw: string | null = null;
  let layout = new Map<string, string[]>();
  let frame = 0;
  let disposed = false;
  // Rows of this host start with `<serverId>:`. One installation runs per connected host, so
  // each instance claims its server from the first row holding one of its workspaces and leaves
  // other hosts' rows alone.
  let serverId: string | null = null;
  // Clicked dots of unread tabs, hidden at once (agent id → expiry), until the daemon confirms.
  const readSoon = new Map<string, number>();
  let readSoonTimer = 0;
  // The dots container under the pointer: not rebuilt until the pointer leaves it.
  let hovered: El | null = null;
  // The dot whose tooltip is showing.
  let shownDot: El | null = null;
  // Running row dots: their pulse and the inner <b> it plays on. A Web Animation outlives its
  // element's removal (and would keep it alive), so each is cancelled once its dot leaves the page.
  const pulses = new Map<El, { animation: PulseAnimation; index: number; layer: El }>();
  // The pulsing dot under the pointer, and the animation holding its pulse layer at full scale.
  let held: { dot: El; animation: PulseAnimation } | null = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  // A Web Animation on an element that isn't rendered (Paseo's collapsed sidebar is
  // `display: none`) leaves the compositor and is ticked on the main thread every frame, where a
  // CSS animation would simply stop. So a pulse plays only while its dot has a size: it starts
  // paused, and a ResizeObserver plays it on the wave when the dot is laid out (before that first
  // paint) and pauses it when the dot drops to 0×0. Not an IntersectionObserver: while one is
  // active, Chromium turns every frame of a composited transform animation (Paseo's status rings
  // too) into a main-thread frame.
  const sized = new ResizeObserver((entries) => {
    for (const { target, contentRect } of entries) {
      const pulse = pulses.get(target);
      if (!pulse) continue;
      if (contentRect.width === 0) pulse.animation.pause();
      // Setting a start time plays a paused animation.
      else if (pulse.animation.playState === "paused") pulse.animation.startTime = waveStart(pulse.index);
    }
  });
  const dropDetachedPulses = () => {
    if (held && !held.dot.isConnected) {
      held.animation.cancel();
      held = null;
    }
    for (const [dot, { animation }] of pulses) {
      if (dot.isConnected) continue;
      animation.cancel();
      sized.unobserve(dot);
      pulses.delete(dot);
    }
  };
  /**
   * A hovered running dot matches a hovered coloured dot's size while its colour keeps pulsing:
   * the outer <b> grows ×1.6 like any dot, and an overlay holds the pulse layer's scale at 1.
   * Keyframes missing one end take it from the pulse underneath, so holding eases from wherever
   * the beat is, and letting go eases back into the live beat. Releases the previous dot.
   */
  const holdPulse = (dot: El | null) => {
    if (held?.dot === dot) return;
    if (held) {
      held.animation.cancel();
      pulses.get(held.dot)?.layer.animate([{ offset: 0, transform: "scale(1)" }], { duration: HOVER_MS, easing: "ease-out" });
      held = null;
    }
    const pulse = dot && pulses.get(dot);
    if (!dot || !pulse) return;
    held = { dot, animation: pulse.layer.animate([{ offset: 1, transform: "scale(1)" }], { duration: HOVER_MS, easing: "ease-out", fill: "forwards" }) };
  };

  const style = document.createElement("style");
  style.setAttribute("data-plugin", "tab-dots");
  style.textContent = CSS;
  document.head.appendChild(style);
  const tip = document.createElement("div");
  tip.setAttribute("data-tab-dots-tip", "");
  document.body.appendChild(tip);
  const hideTip = () => {
    if (!shownDot) return;
    shownDot = null;
    holdPulse(null);
    tip.setAttribute("style", "display:none");
  };

  const keyOf = (row: El) => (row.getAttribute("data-testid") ?? "").slice(ROW_PREFIX.length);
  const isMine = (row: El | null) => Boolean(row && serverId && keyOf(row).startsWith(`${serverId}:`));

  const clearRow = (row: El) => {
    row.querySelector(`[${DOTS}]`)?.remove();
    row.removeAttribute(REPLACE);
    row.removeAttribute(ALIGN);
  };

  /** Reads only: the row's dots and title colour. Kept apart from writes so N rows cost one style recalc. */
  const planRow = (row: El): RowPlan => {
    const key = keyOf(row);
    const titleRow = findTitleRow(row);
    const tabs = orderTabs(roots.get(key.slice(key.lastIndexOf(":") + 1)) ?? [], layout.get(key));
    const { dots, more } = rowDots(tabs, preferences.show, MAX_DOTS, preferences.order);
    const existing = row.querySelector(`[${DOTS}]`);
    if (!titleRow || dots.length === 0) return { row, titleRow: null, dots, more, color: "", tone: "dark", signature: "", existing };
    const { color, tone } = inkOf(titleRow.firstElementChild as El);
    // Whether running dots pulse is part of the signature: switching the setting or reduced
    // motion redraws the dots with or without pulse.
    const signature = JSON.stringify([color, preferences.size, more, dots, preferences.animate && !reducedMotion.matches]);
    return { row, titleRow, dots, more, color, tone, signature, existing };
  };

  /** Writes only. */
  const applyRow = ({ row, titleRow, dots, more, color, tone, signature, existing }: RowPlan) => {
    if (!titleRow) {
      if (existing && existing === hovered) return;
      clearRow(row);
      return;
    }
    if (preferences.replaceTime) row.setAttribute(REPLACE, "");
    else row.removeAttribute(REPLACE);
    row.setAttribute(ALIGN, preferences.align);
    if (existing && existing.parentElement === titleRow && existing.getAttribute(DOTS) === signature) return;
    // Never move dots under the pointer; the pointer leaving schedules this row again.
    if (existing && existing === hovered) return;
    existing?.remove();
    const container = document.createElement("div");
    container.setAttribute(DOTS, signature);
    container.setAttribute("data-tone", tone);
    // Read dots and "+N" are drawn in the title's own colour, faded.
    container.setAttribute("style", `color: ${color}`);
    container.setAttribute("data-size", preferences.size);
    container.setAttribute("aria-hidden", "true");
    dots.forEach((dot, index) => {
      const element = document.createElement("i");
      element.setAttribute("data-state", dot.state);
      element.setAttribute("data-title", dot.title);
      element.setAttribute("data-agent", dot.agentId);
      const grow = document.createElement("b");
      const layer = document.createElement("b");
      grow.appendChild(layer);
      element.appendChild(grow);
      if (dot.state === "running" && preferences.animate && !reducedMotion.matches) {
        const animation = layer.animate(PULSE_KEYFRAMES, { duration: PULSE_MS, iterations: Infinity });
        animation.pause();
        pulses.set(element, { animation, index, layer });
        sized.observe(element);
      }
      container.appendChild(element);
    });
    if (more > 0) {
      const count = document.createElement("span");
      count.textContent = `+${more}`;
      container.appendChild(count);
    }
    titleRow.insertBefore(container, titleRow.firstElementChild?.nextSibling ?? null);
  };

  const render = () => {
    frame = 0;
    if (disposed) return;
    const rows: El[] = [];
    document.querySelectorAll(ROWS).forEach((row) => rows.push(row));
    if (!serverId) {
      const claimed = rows.map(keyOf).find((key) => roots.has(key.slice(key.lastIndexOf(":") + 1)));
      if (!claimed) return;
      serverId = claimed.slice(0, claimed.lastIndexOf(":"));
    }
    const mine = rows.filter(isMine);
    if (preferences.enabled) mine.map(planRow).forEach(applyRow);
    else mine.forEach(clearRow);
    if (shownDot && !shownDot.isConnected) hideTip();
    dropDetachedPulses();
  };
  const schedule = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(render);
  };

  /** Applies clicked-but-not-yet-confirmed reads, and redraws only when a dot input changed. */
  const refreshRoots = () => {
    const now = performance.now();
    let effective = agentsNow;
    if (readSoon.size > 0) {
      const patched = new Map(agentsNow);
      for (const [id, until] of readSoon) {
        const agent = agentsNow.get(id);
        if (!agent || !agent.requiresAttention || until <= now) {
          readSoon.delete(id);
          continue;
        }
        patched.set(id, { ...agent, requiresAttention: false, attentionReason: null });
      }
      effective = patched;
    }
    clearTimeout(readSoonTimer);
    if (readSoon.size > 0) {
      readSoonTimer = setTimeout(refreshRoots, Math.max(0, Math.min(...readSoon.values()) - now) + 10);
    }
    roots = rootsByWorkspace(effective);
    // Exactly the inputs of `rowDots`: upserts that only touch usage or timestamps change nothing.
    const key = JSON.stringify([...roots].map(([workspace, list]) =>
      [workspace, list.map((agent) => [agent.id, agent.title, dotState(agent), agent.requiresAttention])]));
    if (key === rootsKey) return;
    rootsKey = key;
    schedule();
  };

  // Same-window layout writes fire no `storage` event, and nothing else tells a plugin, so poll
  // the raw string as well. A tick reads and compares one string and touches no DOM or style
  // unless it changed: it costs no frame.
  const reloadLayout = () => {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw === layoutRaw) return;
    layoutRaw = raw;
    layout = readLayoutOrder(raw);
    schedule();
  };
  reloadLayout();
  const poll = setInterval(reloadLayout, 2000);
  window.addEventListener("storage", reloadLayout);
  reducedMotion.addEventListener("change", schedule);

  // Paseo remounts rows (plugin load, grouping switch, expanding a project); re-add dots then.
  // Only changes that add rows or touch a row's inside count; the plugin's own writes and the
  // rest of the page (streaming chats, terminals) don't.
  const ownNode = (node: El) => node === tip || (node.nodeType === 1 && node.hasAttribute(DOTS));
  const observer = new MutationObserver((records) => {
    if (shownDot && !shownDot.isConnected) hideTip();
    if (hovered && !hovered.isConnected) hovered = null;
    // Paseo unmounting a row takes its dots along.
    dropDetachedPulses();
    for (const { target, addedNodes, removedNodes } of records) {
      if (target === tip || target.closest(`[${DOTS}]`)) continue;
      const added = Array.from(addedNodes);
      const changed = added.concat(Array.from(removedNodes));
      if (changed.length > 0 && changed.every(ownNode)) continue;
      if (target.closest(ROWS) || added.some((node) => node.nodeType === 1 && (node.matches(ROWS) || node.querySelector(ROWS)))) {
        schedule();
        return;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  /** A dot of this host's rows under `target`, else null. */
  const myDot = (target: El | null) => {
    const dot = target?.closest(`[${DOTS}] > i`) ?? null;
    return dot && isMine(dot.closest(ROWS)) ? dot : null;
  };

  const onOver = (event: PointerLike) => {
    const dot = myDot(event.target);
    if (!dot) {
      hideTip();
      return;
    }
    shownDot = dot;
    hovered = dot.parentElement;
    holdPulse(dot);
    const state = (dot.getAttribute("data-state") ?? "read") as DotState;
    const container = dot.parentElement;
    tip.setAttribute("data-tone", container?.getAttribute("data-tone") ?? "dark");
    if (preferences.animate) tip.removeAttribute("data-still");
    else tip.setAttribute("data-still", "");
    tip.textContent = "";
    const swatch = document.createElement("i");
    swatch.setAttribute("data-state", state);
    const name = document.createElement("b");
    name.textContent = dot.getAttribute("data-title");
    const label = document.createElement("em");
    label.textContent = LABEL[state];
    tip.appendChild(swatch);
    tip.appendChild(name);
    tip.appendChild(label);
    // Text in the row title's colour (the dots container carries it); surface by theme tone.
    const light = container?.getAttribute("data-tone") === "light";
    tip.setAttribute(
      "style",
      `display:flex;color:${container ? window.getComputedStyle(container).color : "inherit"};`
        + `background:${light ? "#ffffff" : "#232027"};border:1px solid rgba(127,127,127,.25)`,
    );
    // Placed from the dot's centre: the slot is the full row height.
    const box = dot.getBoundingClientRect();
    const width = tip.getBoundingClientRect().width;
    const middle = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    tip.style.left = `${Math.max(4, Math.min(middle.x - 12.5, window.innerWidth - width - 4))}px`;
    tip.style.top = `${middle.y + 10.5}px`;
  };
  const onOut = (event: PointerLike) => {
    if (!hovered || !event.target || !hovered.contains(event.target) || hovered.contains(event.relatedTarget)) return;
    // Leaving the dots: hide the tip and apply anything held back while hovered.
    hovered = null;
    hideTip();
    schedule();
  };
  document.addEventListener("mouseover", onOver);
  document.addEventListener("mouseout", onOut);

  // The dot a touch landed on, until that tap's click. The browser hit-tests a tap's click
  // again after it applies :hover, and with "edge" alignment the row's hover menu has shifted
  // the dots by then: the click lands beside the dot (another dot, the title, the menu). So a
  // tap takes its dot from the touch, and its click only says it was a tap: a drag or a scroll
  // sends `pointercancel` and no click.
  let touched: { dot: El; row: El } | null = null;

  // A dot opens its tab. Window capture runs before the row's own press handling, so the
  // row never sees presses on a dot (it would otherwise open the workspace's last tab).
  const onPress = (event: PressLike) => {
    if (event.type === "pointerdown" || event.type === "pointercancel") touched = null;
    if (event.type === "pointercancel") return;
    let dot = myDot(event.target);
    let row = dot?.closest(ROWS) ?? null;
    if (event.type === "click" && touched) {
      if (touched.row.contains(event.target)) ({ dot, row } = touched);
      touched = null;
    }
    const agentId = dot?.getAttribute("data-agent");
    if (!dot || !agentId || !row) return;
    if (event.type === "pointerdown" && event.pointerType === "touch") touched = { dot, row };
    event.stopPropagation();
    // Touch events keep their default: a cancelled `touchend` cancels the tap's `click`, and a
    // tap on a touch screen would do nothing.
    if (!event.type.startsWith("touch")) event.preventDefault();
    if (event.type !== "click") return;
    hideTip();
    hovered = null;
    // Opening an unread finished or failed tab marks it read: show that at once.
    const state = dot.getAttribute("data-state");
    if (state === "finished" || state === "error") {
      readSoon.set(agentId, performance.now() + OPTIMISTIC_READ_MS);
      refreshRoots();
    }
    if (frame) {
      cancelAnimationFrame(frame);
      render();
    }
    const key = keyOf(row);
    const target = { serverId: key.slice(0, key.lastIndexOf(":")), agentId };
    // Navigate right after the next paint, so the dot is gone before the route change starts.
    requestAnimationFrame(() => setTimeout(() => {
      if (disposed) return;
      openTab(target);
    }, 0));
  };
  for (const type of PRESS_EVENTS) window.addEventListener(type, onPress, true);

  return {
    setAgents(agents) {
      agentsNow = agents;
      refreshRoots();
    },
    setPreferences(next) {
      preferences = next;
      schedule();
    },
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(readSoonTimer);
      clearInterval(poll);
      window.removeEventListener("storage", reloadLayout);
      reducedMotion.removeEventListener("change", schedule);
      for (const type of PRESS_EVENTS) window.removeEventListener(type, onPress, true);
      observer.disconnect();
      sized.disconnect();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.querySelectorAll(ROWS).forEach((row) => { if (isMine(row)) clearRow(row); });
      held?.animation.cancel();
      for (const { animation } of pulses.values()) animation.cancel();
      pulses.clear();
      tip.remove();
      style.remove();
    },
  };
}
