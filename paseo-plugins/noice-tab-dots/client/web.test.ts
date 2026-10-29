// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULTS, type Preferences } from "../shared/preferences";
import type { AgentInfo } from "./model";
import { startTabDots, type TabDots } from "./web";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const PREFS: Preferences = { ...DEFAULTS, enabled: true, show: "unread" };

/** A sidebar row with Paseo's structure: button > content > main > column > title row. */
function addRow(key: string, parent: Element = document.body): HTMLElement {
  const row = document.createElement("button");
  row.setAttribute("data-testid", `sidebar-workspace-row-${key}`);
  row.innerHTML = `<div><div><div></div><div><div><div style="color: rgb(249, 248, 251)">${key}</div>`
    + `<div><div><div data-testid="sidebar-workspace-timestamp">2h</div></div></div></div></div></div></div>`;
  parent.appendChild(row);
  return row;
}

function unread(id: string, workspaceId: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id, workspaceId, parentId: null, title: `Tab ${id}`, status: "idle", requiresAttention: true,
    attentionReason: "finished", pendingPermissions: 0, at: null, ...extra,
  };
}
const agentsOf = (...list: AgentInfo[]) => new Map(list.map((agent) => [agent.id, agent]));
const running = (id: string, workspaceId: string): AgentInfo =>
  unread(id, workspaceId, { status: "running", requiresAttention: false, attentionReason: null });

/** `Element.animate`, `ResizeObserver` and the reduced-motion query, all missing from jsdom. */
class FakeAnimation {
  cancelled = false;
  playState: "running" | "paused" = "running";
  #startTime: number | null = null;
  constructor(readonly dot: Element, readonly options: { duration: number; iterations: number }) {}
  get startTime() { return this.#startTime; }
  // As in Web Animations: a start time makes a paused animation play again.
  set startTime(value: number | null) {
    this.#startTime = value;
    if (value !== null) this.playState = "running";
  }
  pause() {
    this.playState = "paused";
    this.#startTime = null;
  }
  cancel() { this.cancelled = true; }
}
let animations: FakeAnimation[] = [];
let reduceMotion = false;
let motionListeners = new Set<() => void>();
const setReducedMotion = (value: boolean) => {
  reduceMotion = value;
  for (const listener of motionListeners) listener();
};
type Resizes = (entries: { target: Element; contentRect: { width: number; height: number } }[]) => void;
let resizeObservers: { callback: Resizes; sizes: Map<Element, number> }[] = [];
/**
 * What the browser reports after layout: an observed dot is 5 px wide, or 0 when it isn't
 * rendered (detached, or under a `hidden` ancestor, i.e. `display: none`). Like the real
 * observer, it reports a size only when it changed, starting from 0.
 */
const layout = () => {
  for (const { callback, sizes } of resizeObservers) {
    const entries: Parameters<Resizes>[0] = [];
    for (const [target, last] of sizes) {
      const width = target.isConnected && !target.closest("[hidden]") ? 5 : 0;
      if (width === last) continue;
      sizes.set(target, width);
      entries.push({ target, contentRect: { width, height: width } });
    }
    if (entries.length > 0) callback(entries);
  }
};
/** Agent ids of the dots in `row` with a playing pulse, and each pulse's start time. */
const pulses = (row: Element) => Object.fromEntries(animations
  .filter((animation) => !animation.cancelled && animation.playState === "running" && animation.options.iterations === Infinity && row.contains(animation.dot))
  .map((animation) => [animation.dot.closest("[data-agent]")!.getAttribute("data-agent"), animation.startTime]));

const dotsIn = (row: Element) => [...row.querySelectorAll("[data-tab-dots] > i")].map((dot) => dot.getAttribute("data-agent"));
const tip = () => document.querySelector<HTMLElement>("[data-tab-dots-tip]")!;
const tipShown = () => tip().style.display === "flex";
const hover = (target: Element, from: Element | null = null) =>
  target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }));
const leave = (target: Element, to: Element | null) =>
  target.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: to }));
/** Runs pending animation frames and MutationObserver callbacks, each frame followed by layout. */
const frames = async (count = 3) => {
  for (let i = 0; i < count; i += 1) {
    await vi.advanceTimersByTimeAsync(20);
    layout();
  }
};

let started: TabDots[] = [];
let openTab = vi.fn();
const start = (agents: Map<string, AgentInfo>, prefs = PREFS) => {
  const dots = startTabDots(prefs, openTab);
  dots.setAgents(agents);
  started.push(dots);
  return dots;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
  document.body.innerHTML = "";
  localStorage.clear();
  openTab = vi.fn();
  animations = [];
  reduceMotion = false;
  motionListeners = new Set();
  resizeObservers = [];
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return reduceMotion; },
    addEventListener: (_type: string, listener: () => void) => motionListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => motionListeners.delete(listener),
  }));
  vi.stubGlobal("ResizeObserver", class {
    #entry: { callback: Resizes; sizes: Map<Element, number> };
    constructor(callback: Resizes) {
      this.#entry = { callback, sizes: new Map() };
      resizeObservers.push(this.#entry);
    }
    observe(target: Element) { this.#entry.sizes.set(target, 0); }
    unobserve(target: Element) { this.#entry.sizes.delete(target); }
    disconnect() { this.#entry.sizes.clear(); }
  });
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, _keyframes: unknown, options: FakeAnimation["options"]) {
      const animation = new FakeAnimation(this, options);
      animations.push(animation);
      return animation;
    },
  });
});
afterEach(() => {
  for (const dots of started) dots.dispose();
  started = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "animate");
});

describe("two hosts in one window", () => {
  // One installation runs per connected host. Each used to clear the other host's rows, which
  // the other re-added: both rows rebuilt every frame, and a dot click navigated twice.
  test("each host draws only its own rows, the page settles, and a click navigates once", async () => {
    const rowA = addRow("srv_A:wks_a");
    const rowB = addRow("srv_B:wks_b");
    start(agentsOf(unread("a1", "wks_a")));
    start(agentsOf(unread("b1", "wks_b")));
    await frames();
    expect(dotsIn(rowA)).toEqual(["a1"]);
    expect(dotsIn(rowB)).toEqual(["b1"]);

    let mutations = 0;
    const counter = new MutationObserver((records) => { mutations += records.length; });
    counter.observe(document.body, { childList: true, subtree: true });
    await frames(10);
    counter.disconnect();
    expect(mutations).toBe(0);

    const pushState = vi.spyOn(history, "pushState");
    rowA.querySelector("[data-tab-dots] > i")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await frames(2);
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith({ serverId: "srv_A", agentId: "a1" });
    expect(pushState).not.toHaveBeenCalled();
  });
});

describe("tooltip", () => {
  // The tooltip used to stay on screen when the hovered dot went away (row unmounted, or the
  // pointer moved on after the dot vanished), for minutes.
  test("hides when the pointer moves to something that isn't a dot", async () => {
    const row = addRow("srv_A:wks_a");
    start(agentsOf(unread("a1", "wks_a")));
    await frames();
    hover(row.querySelector("[data-tab-dots] > i")!);
    expect(tipShown()).toBe(true);
    hover(document.body);
    expect(tipShown()).toBe(false);
  });

  test("hides when the hovered dot's row unmounts", async () => {
    const row = addRow("srv_A:wks_a");
    start(agentsOf(unread("a1", "wks_a")));
    await frames();
    hover(row.querySelector("[data-tab-dots] > i")!);
    row.remove();
    await frames();
    expect(tipShown()).toBe(false);
  });
});

describe("dots under the pointer", () => {
  test("don't change while hovered, and catch up when the pointer leaves", async () => {
    const row = addRow("srv_A:wks_a");
    const dots = start(agentsOf(unread("a1", "wks_a"), unread("a2", "wks_a")));
    await frames();
    const dot = row.querySelector("[data-tab-dots] > i")!;
    hover(dot);
    dots.setAgents(agentsOf(unread("a2", "wks_a")));
    await frames();
    expect(dotsIn(row)).toEqual(["a1", "a2"]);
    leave(dot, document.body);
    await frames();
    expect(dotsIn(row)).toEqual(["a2"]);
  });
});

describe("clicking an unread dot", () => {
  test("hides it at once, before the daemon confirms the read", async () => {
    const row = addRow("srv_A:wks_a");
    const dots = start(agentsOf(unread("a1", "wks_a"), unread("a2", "wks_a")));
    await frames();
    row.querySelector('[data-agent="a1"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Drawn in the click itself, before the navigation that follows the next paint.
    expect(dotsIn(row)).toEqual(["a2"]);
    // The daemon confirms: still hidden, and nothing comes back later.
    dots.setAgents(agentsOf(unread("a1", "wks_a", { requiresAttention: false, attentionReason: null }), unread("a2", "wks_a")));
    await vi.advanceTimersByTimeAsync(6000);
    expect(dotsIn(row)).toEqual(["a2"]);
  });

  test("comes back if the daemon never marks it read", async () => {
    const row = addRow("srv_A:wks_a");
    start(agentsOf(unread("a1", "wks_a")));
    await frames();
    row.querySelector('[data-agent="a1"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await frames(1);
    expect(dotsIn(row)).toEqual([]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(dotsIn(row)).toEqual(["a1"]);
  });

  test("a permission dot stays: opening the tab doesn't answer the request", async () => {
    const row = addRow("srv_A:wks_a");
    start(agentsOf(unread("a1", "wks_a", { attentionReason: "permission", pendingPermissions: 1 })));
    await frames();
    row.querySelector('[data-agent="a1"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await frames(1);
    expect(dotsIn(row)).toEqual(["a1"]);
  });
});

describe("tapping a dot on a touch screen", () => {
  // jsdom has no PointerEvent: a MouseEvent with the pointer type set by hand.
  const pointer = (type: string, pointerType: "touch" | "mouse") =>
    Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true }), { pointerType });
  /**
   * A finger tap as Chrome delivers it: pointer and touch events on the dot, then a click only
   * if `touchend` wasn't cancelled. Chrome hit-tests that click again after the row turns
   * :hover, so with "edge" alignment it can land beside the dot (`clickTarget`).
   */
  const tap = (dot: Element, clickTarget: Element = dot) => {
    const touchend = new TouchEvent("touchend", { bubbles: true, cancelable: true });
    for (const event of [pointer("pointerdown", "touch"), new TouchEvent("touchstart", { bubbles: true, cancelable: true }), pointer("pointerup", "touch"), touchend]) {
      dot.dispatchEvent(event);
    }
    if (!touchend.defaultPrevented) clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return touchend;
  };
  const PRESSES = ["pointerdown", "touchstart", "pointerup", "touchend", "pointercancel", "mousedown", "mouseup", "click"];
  /** Every press event that reaches Paseo's row. */
  const rowSees = (row: Element) => {
    const seen: string[] = [];
    for (const type of PRESSES) row.addEventListener(type, () => seen.push(type));
    return seen;
  };

  // The plugin used to cancel `touchend` on a dot, which cancels the tap's click: a tap did nothing.
  test("a tap opens its tab once, and the row never sees it", async () => {
    const row = addRow("srv_A:wks_a");
    start(agentsOf(unread("a1", "wks_a")));
    await frames();
    const seen = rowSees(row);
    const touchend = tap(row.querySelector('[data-agent="a1"]')!);
    expect(touchend.defaultPrevented).toBe(false);
    expect(dotsIn(row)).toEqual([]);
    await frames(2);
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith({ serverId: "srv_A", agentId: "a1" });
    expect(seen).toEqual([]);
  });

  test("a tap whose click lands beside the dot opens the dot the finger touched", async () => {
    const row = addRow("srv_A:wks_a");
    start(agentsOf(unread("a1", "wks_a"), unread("a2", "wks_a"), unread("a3", "wks_a")));
    await frames();
    const seen = rowSees(row);
    tap(row.querySelector('[data-agent="a1"]')!, row.querySelector('[data-agent="a2"]')!);
    await frames(2);
    expect(openTab.mock.calls).toEqual([[{ serverId: "srv_A", agentId: "a1" }]]);
    tap(row.querySelector('[data-agent="a3"]')!, row.querySelector("[data-tab-dots]")!.previousElementSibling!);
    await frames(2);
    expect(openTab.mock.calls).toEqual([[{ serverId: "srv_A", agentId: "a1" }], [{ serverId: "srv_A", agentId: "a3" }]]);
    expect(seen).toEqual([]);
  });

  test("a drag that starts on a dot opens nothing, and the row's next click is its own", async () => {
    const row = addRow("srv_A:wks_a");
    start(agentsOf(unread("a1", "wks_a")));
    await frames();
    const seen = rowSees(row);
    const dot = row.querySelector('[data-agent="a1"]')!;
    // A scroll: the browser cancels the pointer and sends no click.
    dot.dispatchEvent(pointer("pointerdown", "touch"));
    dot.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true }));
    dot.dispatchEvent(pointer("pointercancel", "touch"));
    dot.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true }));
    // Then a click on the row with no pointer down first, as from the keyboard.
    dot.parentElement!.previousElementSibling!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await frames(2);
    expect(openTab).not.toHaveBeenCalled();
    expect(dotsIn(row)).toEqual(["a1"]);
    expect(seen).toEqual(["pointercancel", "click"]);
  });
});

describe("rows Paseo mounts later", () => {
  // Rows remount on project expand, grouping switch and plugin load; they must get their dots.
  test("a row added after start gets its dots, also inside a newly added list", async () => {
    start(agentsOf(unread("a1", "wks_a"), unread("b1", "wks_b")));
    await frames();
    const row = addRow("srv_A:wks_a");
    await frames();
    expect(dotsIn(row)).toEqual(["a1"]);
    const list = document.createElement("div");
    const nested = addRow("srv_A:wks_b", list);
    document.body.appendChild(list);
    await frames();
    expect(dotsIn(nested)).toEqual(["b1"]);
  });
});

describe("running pulse", () => {
  const SHOW_RUNNING: Preferences = { ...PREFS, show: "unread-running" };

  test("every row keeps one beat: each next dot trails by 200 ms, rows drawn later join in step", async () => {
    const rowA = addRow("srv_A:wks_a");
    const rowB = addRow("srv_A:wks_b");
    const dots = start(agentsOf(running("a1", "wks_a"), running("a2", "wks_a"), running("b1", "wks_b")), SHOW_RUNNING);
    await frames();
    const [firstA, secondA] = dotsIn(rowA);
    const a = pulses(rowA);
    const b = pulses(rowB);
    expect(Object.keys(a).sort()).toEqual(["a1", "a2"]);
    expect(a[secondA!]! - a[firstA!]!).toBe(200);
    expect(b.b1).toBe(a[firstA!]);
    // Already mid-pulse on the page clock, not waiting to start.
    expect(a[secondA!]).toBeLessThanOrEqual(0);
    expect(animations.every(({ options }) => options.iterations === Infinity && options.duration === 1800)).toBe(true);

    await vi.advanceTimersByTimeAsync(2500);
    const rowC = addRow("srv_A:wks_c");
    dots.setAgents(agentsOf(running("a1", "wks_a"), running("a2", "wks_a"), running("b1", "wks_b"), running("c1", "wks_c")));
    await frames();
    expect(pulses(rowC)).toEqual({ c1: a[firstA!] });
  });

  test("a pulse ends with its dot: the row unmounts, the tab finishes, or the plugin stops", async () => {
    const rowA = addRow("srv_A:wks_a");
    const rowB = addRow("srv_A:wks_b");
    const dots = start(agentsOf(running("a1", "wks_a"), running("b1", "wks_b"), running("b2", "wks_b")), SHOW_RUNNING);
    await frames();
    expect(animations.filter((animation) => !animation.cancelled)).toHaveLength(3);

    // Paseo unmounts the row; a live animation would keep the detached dot alive and ticking.
    rowA.remove();
    await frames();
    expect(animations.find(({ dot }) => dot.closest("[data-agent]")?.getAttribute("data-agent") === "a1")!.cancelled).toBe(true);

    dots.setAgents(agentsOf(running("b1", "wks_b"), unread("b2", "wks_b")));
    await frames();
    expect(Object.keys(pulses(rowB))).toEqual(["b1"]);
    expect(dotsIn(rowB).sort()).toEqual(["b1", "b2"]);

    dots.dispose();
    started = [];
    expect(animations.filter((animation) => !animation.cancelled)).toEqual([]);
  });

  // A Web Animation on a `display: none` dot (Paseo's collapsed sidebar) is ticked on the main
  // thread every frame: measured 60 main frames/s for five dots.
  test("dots in a hidden sidebar hold their pulse, and join the wave when it shows", async () => {
    const sidebar = document.createElement("div");
    sidebar.hidden = true;
    document.body.appendChild(sidebar);
    const hiddenRow = addRow("srv_A:wks_a", sidebar);
    const shownRow = addRow("srv_A:wks_b");
    start(agentsOf(running("a1", "wks_a"), running("a2", "wks_a"), running("b1", "wks_b"), running("b2", "wks_b")), SHOW_RUNNING);
    await frames();
    expect(dotsIn(hiddenRow)).toHaveLength(2);
    expect(pulses(hiddenRow)).toEqual({});
    const wave = Object.values(pulses(shownRow));
    expect(wave).toHaveLength(2);

    sidebar.hidden = false;
    await frames();
    expect(Object.values(pulses(hiddenRow))).toEqual(wave);

    await vi.advanceTimersByTimeAsync(2500);
    sidebar.hidden = true;
    await frames();
    expect(pulses(hiddenRow)).toEqual({});
    expect(animations.every(({ cancelled }) => !cancelled)).toBe(true);
    sidebar.hidden = false;
    await frames();
    expect(Object.values(pulses(hiddenRow))).toEqual(wave);
  });

  test("reduced motion keeps the dots still, and switching it applies at once", async () => {
    reduceMotion = true;
    const row = addRow("srv_A:wks_a");
    start(agentsOf(running("a1", "wks_a")), SHOW_RUNNING);
    await frames();
    expect(dotsIn(row)).toEqual(["a1"]);
    expect(pulses(row)).toEqual({});

    setReducedMotion(false);
    await frames();
    expect(Object.keys(pulses(row))).toEqual(["a1"]);

    setReducedMotion(true);
    await frames();
    expect(dotsIn(row)).toEqual(["a1"]);
    expect(pulses(row)).toEqual({});
  });

  test("with Animate running dots off the dots stay solid, and switching it applies at once", async () => {
    const row = addRow("srv_A:wks_a");
    const dots = start(agentsOf(running("a1", "wks_a")), { ...SHOW_RUNNING, animate: false });
    await frames();
    expect(dotsIn(row)).toEqual(["a1"]);
    expect(pulses(row)).toEqual({});

    dots.setPreferences(SHOW_RUNNING);
    await frames();
    expect(Object.keys(pulses(row))).toEqual(["a1"]);

    dots.setPreferences({ ...SHOW_RUNNING, animate: false });
    await frames();
    expect(dotsIn(row)).toEqual(["a1"]);
    expect(pulses(row)).toEqual({});
  });
});
