// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULTS, type Preferences } from "../shared/preferences";
import { createSpinner, type Indicator, LiveLabel, startIndicator, warmth } from "./web";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

// jsdom has no layout, animations or ResizeObserver. The fakes: every element under an animated root
// that is not switched off (data-spn-waapi) runs one CSS animation lasting 1 s (3 s under reduced
// motion, as the catalog CSS does), delayed by its child index × 100 ms; `layout` delivers the
// ResizeObserver callback the browser would send.
interface FakeAnimation {
  animationName?: string; target: Element; keyframes: object[]; options: Record<string, unknown>;
  playState: "running" | "paused" | "idle"; pause(): void; play(): void; cancel(): void;
}
const created: FakeAnimation[] = [];
let reduceMotion = false;
const motionListeners: (() => void)[] = [];
const observed = new Set<Element>();
let resize: ((entries: { target: Element; contentRect: { width: number; height: number } }[]) => void) | null = null;
const fakeAnimation = (target: Element, keyframes: object[], options: Record<string, unknown>, animationName?: string): FakeAnimation => ({
  animationName, target, keyframes, options, playState: "running",
  pause() { if (this.playState !== "idle") this.playState = "paused"; },
  play() { if (this.playState !== "idle") this.playState = "running"; },
  cancel() { this.playState = "idle"; },
});
vi.stubGlobal("ResizeObserver", class {
  constructor(callback: typeof resize) { resize = callback; }
  observe(target: Element) { observed.add(target); }
  unobserve(target: Element) { observed.delete(target); }
});
vi.stubGlobal("matchMedia", () => ({ get matches() { return reduceMotion; }, addEventListener: (_: string, listener: () => void) => motionListeners.push(listener) }));
Object.assign(Element.prototype, {
  getAnimations(this: Element) {
    if (this.closest("[data-spn-waapi]")) return [];
    return [this, ...this.querySelectorAll("*")].map((element) => {
      const index = element.parentElement ? [...element.parentElement.children].indexOf(element) : 0;
      const timing = { duration: reduceMotion ? 3000 : 1000, delay: index * 100, iterations: Infinity, easing: "linear" };
      const animation = fakeAnimation(element, [{ offset: 0, opacity: 0.4, computedOffset: 0 }, { offset: 1, opacity: 1, computedOffset: 1 }], timing, "spn-test");
      return Object.assign(animation, { effect: { target: element, pseudoElement: index === 0 ? "::after" : null, getKeyframes: () => animation.keyframes, getTiming: () => timing } });
    });
  },
  animate(this: Element, keyframes: object[], options: Record<string, unknown>) {
    const animation = fakeAnimation(this, keyframes, options);
    created.push(animation);
    return animation;
  },
});
/** The ResizeObserver delivery for `target` at a size (0×0 = not rendered or removed). */
const layout = (target: Element, width: number, height = width) => {
  if (observed.has(target)) resize!([{ target, contentRect: { width, height } }]);
};
const states = (target: Element) => created.filter((animation) => target.contains(animation.target)).map((animation) => animation.playState);

/** Paseo 0.12's running-turn footer: slot > content row > [loader wrapper > dots, elapsed]. */
function addFooter(elapsed: string): { footer: HTMLElement; elapsed: HTMLElement } {
  const scroll = document.createElement("div");
  scroll.setAttribute("data-testid", "agent-chat-scroll");
  scroll.innerHTML = '<div data-testid="turn-working-indicator"><div>'
    + '<div><div><div style="background-color: rgb(250, 250, 250)"></div></div></div>'
    + `<div data-testid="turn-working-elapsed" style="color: rgb(140, 140, 140)">${elapsed}</div>`
    + "</div></div>";
  document.body.appendChild(scroll);
  return {
    footer: scroll.querySelector<HTMLElement>('[data-testid="turn-working-indicator"]')!,
    elapsed: scroll.querySelector<HTMLElement>('[data-testid="turn-working-elapsed"]')!,
  };
}

/** Runs pending animation frames and MutationObserver callbacks. */
const frames = async (count = 3) => { for (let i = 0; i < count; i += 1) await vi.advanceTimersByTimeAsync(20); };

/** Paseo's LiveElapsed re-renders the text node in place every second. */
const tickTo = (elapsed: HTMLElement, text: string) => { (elapsed.firstChild as Text).data = text; };

let indicator: Indicator | null = null;
const start = (prefs: Partial<Preferences>) => {
  indicator = startIndicator();
  indicator.setPreferences({ ...DEFAULTS, ...prefs });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  document.body.innerHTML = "";
  created.length = 0;
  reduceMotion = false;
});

afterEach(() => {
  indicator?.dispose();
  indicator = null;
  vi.useRealTimers();
});

describe("warming", () => {
  test("holds still within a 10 s step and moves at the next one", () => {
    expect(warmth(129.9, false)).toEqual(warmth(120, false));
    expect(warmth(130, false).opacity).toBeGreaterThan(warmth(129.9, false).opacity);
    expect(warmth(359, true)).toEqual(warmth(350, true));
    expect(warmth(360, true).color).not.toBe(warmth(359, true).color);
  });

  test("keeps its landmarks: hidden for a minute, faint at 1 min, full at 5 min, amber at 10 min", () => {
    expect(warmth(59, false).opacity).toBe(0);
    expect(warmth(60, false).opacity).toBe(0.15);
    expect(warmth(299, false).opacity).toBeLessThan(1);
    expect(warmth(300, false).opacity).toBe(1);
    expect(warmth(600, false).color).toBe("color-mix(in srgb, #e8a64a 100%, var(--spn-muted))");
  });

  test("a footer whose elapsed text ticks within one step gets no style writes", async () => {
    const { footer, elapsed } = addFooter("2m 1s");
    start({ spinner: "typing-dots", live: "off", time: "warming" });
    await frames();
    expect(footer.style.getPropertyValue("--spn-warm-opacity")).toBe(String(warmth(120, false).opacity));

    const writes: string[] = [];
    const watcher = new MutationObserver((records) => { for (const r of records) writes.push(r.attributeName ?? ""); });
    watcher.observe(footer, { attributes: true });
    for (const text of ["2m 2s", "2m 5s", "2m 9s"]) {
      tickTo(elapsed, text);
      await frames();
    }
    await Promise.resolve();
    expect(writes).toEqual([]);

    tickTo(elapsed, "2m 10s");
    await frames();
    expect([...new Set(writes)]).toEqual(["style"]);
    watcher.disconnect();
    expect(footer.style.getPropertyValue("--spn-warm-opacity")).toBe(String(warmth(130, false).opacity));
  });
});

/** What a sheen host shows: its own text (not the copy's) and the text of its bright copy. */
const sheenOf = (host: Element) => ({
  text: [...host.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(""),
  copy: host.querySelector(".spn-gl .c")?.textContent,
});

describe("sheen", () => {
  test("the shimmer time replaces Paseo's elapsed text and its bright copy keeps up with every tick", async () => {
    const { footer, elapsed } = addFooter("1m 5s");
    start({ spinner: "off", live: "off", time: "shimmer" });
    await frames();
    const time = footer.querySelector(".spn-stime")!;
    expect(time.previousElementSibling).toBe(elapsed);
    expect(getComputedStyle(elapsed).display).toBe("none");
    expect(sheenOf(time)).toEqual({ text: "1m 5s", copy: "1m 5s" });

    tickTo(elapsed, "1m 6s");
    await frames();
    expect(sheenOf(time)).toEqual({ text: "1m 6s", copy: "1m 6s" });

    indicator!.setPreferences({ ...DEFAULTS, time: "plain" });
    await frames();
    expect(footer.querySelector(".spn-stime")).toBeNull();
    expect(getComputedStyle(elapsed).display).not.toBe("none");
  });

  /** The label's element, attached to the page (the plugin types it without the DOM library). */
  const domOf = (label: LiveLabel) => document.body.appendChild(label.el as unknown as HTMLElement);

  test.each(["shimmer", "rolling"] as const)("a %s label's bright copy changes with the label", async (style) => {
    const label = new LiveLabel(style);
    const el = domOf(label);
    label.set("Reading a.ts");
    const text = el.querySelector(".t")!;
    expect(sheenOf(text)).toEqual({ text: "Reading a.ts", copy: "Reading a.ts" });

    label.set("Running git status");
    await vi.advanceTimersByTimeAsync(300);
    expect(sheenOf(text)).toEqual({ text: "Running git status", copy: "Running git status" });
    label.dispose();
  });

  test("the icon label's bright copy repeats both the icon and the text", async () => {
    const label = new LiveLabel("icon");
    const el = domOf(label);
    const icons = () => [...el.querySelectorAll<HTMLElement>(".ico")].map((icon) => icon.style.getPropertyValue("--icon"));
    const texts = () => [...el.querySelectorAll(".t")].map((text) => text.textContent);
    label.set("Reading a.ts", 'url("read.svg")');
    expect(icons()).toEqual(['url("read.svg")', 'url("read.svg")']);
    expect(texts()).toEqual(["Reading a.ts", "Reading a.ts"]);

    label.set("Thinking", null);
    await vi.advanceTimersByTimeAsync(300);
    expect(icons()).toEqual(["", ""]);
    expect(texts()).toEqual(["Thinking", "Thinking"]);
    label.dispose();
  });
});

describe("every animation runs on the compositor", () => {
  /** The CSS the plugin puts on the page: catalog (spinners, labels, time) and footer rules. */
  const pluginCss = () => [...document.querySelectorAll('style[data-plugin^="noice-chat-turn-status"]')].map((style) => style.textContent).join("\n");

  test("keyframes and transitions change only transform and opacity (and starburst's clip-path, which Chromium composites)", () => {
    start({});
    const css = pluginCss();
    const animated = new Set<string>();
    for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      let depth = 0, i = match.index + match[0].length - 1;
      const from = i;
      for (; i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) break;
      }
      for (const [, property] of css.slice(from, i).matchAll(/[{;]\s*([a-z-]+)\s*:/g)) {
        animated.add(property === "clip-path" ? `${match[1]}: clip-path` : property!);
      }
    }
    for (const [, value] of css.matchAll(/(?:^|[{;\s])transition\s*:\s*([^;}]+)/g)) {
      for (const part of value!.split(/,(?![^(]*\))/)) animated.add(part.trim().split(/\s+/)[0]!);
    }
    animated.delete("animation-timing-function");
    animated.delete("none");
    expect([...animated].sort()).toEqual(["opacity", "spn-burst: clip-path", "transform"]);
  });
});

describe("animations run as Web Animations", () => {
  test("a spinner's CSS animations are copied when it is laid out, keyframes, timing and pseudo-element included", () => {
    const spinner = createSpinner("typing-dots") as unknown as HTMLElement;
    document.body.appendChild(spinner);
    expect(created).toEqual([]);
    layout(spinner, 14);
    const dots = [spinner, ...spinner.querySelectorAll("*")];
    expect(created.map((animation) => [dots.indexOf(animation.target), animation.options])).toEqual(dots.map((_, i) => [i, {
      duration: 1000, delay: (i === 0 ? 0 : i - 1) * 100, iterations: Infinity, easing: "linear", ...(i <= 1 ? { pseudoElement: "::after" } : {}),
    }]));
    expect(created[0]!.keyframes).toEqual([{ offset: 0, opacity: 0.4 }, { offset: 1, opacity: 1 }]);
    // The CSS copies are switched off, so the page never runs both.
    expect(spinner.getAnimations()).toEqual([]);
  });

  test("a footer spinner pauses while its tab is hidden, plays again when shown, and stops when the turn ends", async () => {
    const { footer } = addFooter("12s");
    start({ spinner: "typing-dots", live: "off", time: "plain" });
    await frames();
    const spinner = footer.querySelector(".spn")!;
    layout(spinner, 14);
    expect(new Set(states(spinner))).toEqual(new Set(["running"]));

    layout(spinner, 0); // Paseo hides the inactive panel with display: none
    expect(new Set(states(spinner))).toEqual(new Set(["paused"]));
    layout(spinner, 14);
    expect(new Set(states(spinner))).toEqual(new Set(["running"]));

    footer.remove(); // the turn ends: Paseo unmounts the footer with our spinner in it
    layout(spinner, 0);
    expect(new Set(states(spinner))).toEqual(new Set(["idle"]));
  });

  test("a spinner that never got a box never starts", () => {
    const hidden = document.body.appendChild(document.createElement("div"));
    const spinner = createSpinner("orbit") as unknown as HTMLElement;
    hidden.appendChild(spinner);
    layout(spinner, 0);
    expect(created).toEqual([]);
  });

  test("switching reduced motion re-times the running animations and keeps hidden ones paused", () => {
    const shown = createSpinner("typing-dots") as unknown as HTMLElement;
    const hidden = createSpinner("typing-dots") as unknown as HTMLElement;
    document.body.append(shown, hidden);
    layout(shown, 14);
    layout(hidden, 14);
    layout(hidden, 0);
    const before = [...created];

    reduceMotion = true;
    motionListeners.forEach((listener) => listener());
    expect(before.every((animation) => animation.playState === "idle")).toBe(true);
    const after = created.slice(before.length);
    expect(after.filter((a) => shown.contains(a.target)).map((a) => [a.options.duration, a.playState])).toEqual(before.filter((a) => shown.contains(a.target)).map(() => [3000, "running"]));
    expect(new Set(after.filter((a) => hidden.contains(a.target)).map((a) => a.playState))).toEqual(new Set(["paused"]));
  });

  test("the shimmer time's sheen stops when the time style changes", async () => {
    const { footer } = addFooter("1m 5s");
    start({ spinner: "off", live: "off", time: "shimmer" });
    await frames();
    const sheen = footer.querySelector(".spn-gl")!;
    layout(sheen, 30, 16);
    expect(new Set(states(sheen))).toEqual(new Set(["running"]));
    indicator!.setPreferences({ ...DEFAULTS, spinner: "off", time: "plain" });
    await frames();
    layout(sheen, 0);
    expect(new Set(states(sheen))).toEqual(new Set(["idle"]));
  });
});
