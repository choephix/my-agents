// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Preferences } from "../shared/preferences";
import { keywordColor } from "./color";
import { MAGIC_KEYWORDS, STOPS } from "./keywords";
import { type Engine, startKeywordShimmer } from "./web";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

// jsdom has no layout, Custom Highlight API, ResizeObserver, matchMedia or checkVisibility. These
// stand-ins keep what the engine reads: element boxes, highlight membership, box-size reports, media
// listeners.
class FakeHighlight extends Set<Range> {
  priority = 0;
}
const registry = new Map<string, FakeHighlight>();

/** Each element's box, as the page would lay it out; elements without one have no box (display: none). */
const boxes = new Map<Element, { top: number; height: number }>();
const boxOf = (element: Element): DOMRect => {
  const { top = 0, height = 0 } = boxes.get(element) ?? {};
  const width = height > 0 ? 300 : 0;
  return { top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON() {} } as DOMRect;
};
const IN_VIEW = { top: 100, height: 40 };
/** jsdom's window is 768 px tall; this is more than half a viewport below it. */
const FAR_BELOW = { top: 3000, height: 40 };

class FakeResizeObserver {
  static all = new Set<FakeResizeObserver>();
  readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.all.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
    // Browsers report a box on observe when it is not empty.
    if (boxOf(target).height > 0) queueMicrotask(() => this.report(target));
  }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); FakeResizeObserver.all.delete(this); }
  report(target: Element) {
    if (!this.targets.has(target)) return;
    this.callback([{ target, contentRect: boxOf(target) } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}
const observed = (target: Element) => [...FakeResizeObserver.all].some((observer) => observer.targets.has(target));

/** Moves an element by scrolling, as the chat list does. */
const scrollTo = async (element: Element, box: { top: number; height: number }) => {
  boxes.set(element, box);
  document.dispatchEvent(new Event("scroll"));
  await frames(20);
};
/** Paseo switching tabs: the element's box vanishes (display: none) or comes back. */
const setTabShown = async (element: Element, shown: boolean) => {
  if (shown) boxes.set(element, IN_VIEW);
  else boxes.delete(element);
  for (const observer of FakeResizeObserver.all) observer.report(element);
  await frames(20);
};

const mediaListeners = new Map<string, Set<() => void>>();
const fakeMatchMedia = (query: string) => ({
  matches: false,
  media: query,
  addEventListener: (_: string, listener: () => void) => {
    if (!mediaListeners.has(query)) mediaListeners.set(query, new Set());
    mediaListeners.get(query)!.add(listener);
  },
  removeEventListener: (_: string, listener: () => void) => mediaListeners.get(query)?.delete(listener),
});

/** The engine's delay before dropping rules nobody needs (RULES_OFF_MS in web.ts). */
const RULES_OFF_MS = 300;
const PREFS: Preferences = { sent: "still", composer: "still", scope: "all" };
const LIGHT_TEXT = "rgb(240, 240, 240)";
const DARK_TEXT = "rgb(20, 20, 20)";

function addMessage(text: string, box = IN_VIEW, parent: Element = document.body): { wrapper: HTMLElement; element: HTMLElement } {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-testid", "user-message");
  const element = document.createElement("div");
  element.setAttribute("data-message-text", "");
  element.style.color = LIGHT_TEXT;
  element.textContent = text;
  wrapper.appendChild(element);
  boxes.set(element, box);
  parent.appendChild(wrapper);
  return { wrapper, element };
}

function addComposer(value = ""): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.setAttribute("data-composer-input", "true");
  // The overlay's line check compares heights plus padding; jsdom lays nothing out, so padding must be 0.
  textarea.style.padding = "0px";
  textarea.style.color = LIGHT_TEXT;
  textarea.value = value;
  boxes.set(textarea, IN_VIEW);
  document.body.appendChild(textarea);
  return textarea;
}

const sheet = () => document.head.querySelector<HTMLStyleElement>('style[data-plugin="noice-omp-magic-keywords"]')!;
/** The words that currently have `::highlight()` rules, each with its rule count. */
const ruled = () => {
  const counts: Record<string, number> = {};
  for (const [, word] of sheet().textContent!.matchAll(/::highlight\(noice-omp-magic-keywords-(\w+)-\d+\)/g)) counts[word!] = (counts[word!] ?? 0) + 1;
  return counts;
};
const ranges = (word: string) => [...registry].filter(([name]) => name.startsWith(`noice-omp-magic-keywords-${word}-`)).reduce((sum, [, highlight]) => sum + highlight.size, 0);
/** Which colour stop holds each glyph: changes over time only while the colours move. */
const stops = () => [...registry].map(([name, highlight]) => `${name}:${highlight.size}`).filter((entry) => !entry.endsWith(":0")).join(" ");
const overlays = () => document.querySelectorAll('body > div[data-plugin="noice-omp-magic-keywords"]');
/** Runs pending animation frames, observer callbacks and timers due within `ms`. */
const frames = async (ms = 60) => { await vi.advanceTimersByTimeAsync(ms); };

let engine: Engine | undefined;
const start = async (prefs = PREFS) => {
  engine = startKeywordShimmer();
  engine.setPreferences(prefs);
  await frames();
  return engine;
};

let intersectionObservers = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  registry.clear();
  mediaListeners.clear();
  boxes.clear();
  intersectionObservers = 0;
  vi.stubGlobal("CSS", { highlights: registry });
  vi.stubGlobal("Highlight", FakeHighlight);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("IntersectionObserver", class {
    constructor() { intersectionObservers++; }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", fakeMatchMedia);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) { return boxOf(this); });
  // A glyph sits where its message is.
  Range.prototype.getBoundingClientRect = function (this: Range) { return boxOf(this.startContainer.parentElement!); };
  HTMLElement.prototype.checkVisibility = () => true;
  document.body.innerHTML = "";
  document.documentElement.className = "";
});
afterEach(() => {
  engine?.dispose();
  engine = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("highlight rules follow the keywords in view", () => {
  test("no rules until a keyword is on the page, then only the shown word's", async () => {
    await start();
    addMessage("plain prompt");
    await frames();
    expect(sheet().textContent).toBe("");

    addMessage("please ultrathink about it");
    await frames();
    expect(ruled()).toEqual({ ultrathink: STOPS });
    expect(ranges("ultrathink")).toBe("ultrathink".length);
  });

  test("a message's rules go about 300 ms after it scrolls away and come back as it scrolls near", async () => {
    await start();
    const { element } = addMessage("orchestrate this");
    await frames();
    await scrollTo(element, FAR_BELOW);
    await frames(RULES_OFF_MS - 60);
    expect(ruled()).toEqual({ orchestrate: STOPS });
    await frames(60);
    expect(sheet().textContent).toBe("");
    // The glyphs keep their ranges, so coming back needs only the rules.
    expect(ranges("orchestrate")).toBe("orchestrate".length);

    // Half a viewport below the bottom edge already counts, so the rules exist before the word shows.
    await scrollTo(element, { top: 768 + 300, height: 40 });
    expect(ruled()).toEqual({ orchestrate: STOPS });
  });

  test("a message bobbing in and out of range does not rewrite the rules", async () => {
    await start();
    const { element } = addMessage("orchestrate this");
    await frames();
    const writes = vi.fn();
    new MutationObserver(writes).observe(sheet(), { childList: true, characterData: true, subtree: true });
    for (let i = 0; i < 5; i++) {
      await scrollTo(element, FAR_BELOW);
      await frames(80);
      await scrollTo(element, IN_VIEW);
      await frames(80);
    }
    expect(writes).not.toHaveBeenCalled();
    expect(ruled()).toEqual({ orchestrate: STOPS });
  });

  test("a message mounted far out of view never writes rules", async () => {
    await start();
    const writes = vi.fn();
    new MutationObserver(writes).observe(sheet(), { childList: true, characterData: true, subtree: true });
    addMessage("jevify the list", FAR_BELOW);
    await frames(RULES_OFF_MS + 60);
    expect(writes).not.toHaveBeenCalled();
    expect(ranges("jevify")).toBe("jevify".length);
  });

  test("rules cover the union of the words in view", async () => {
    await start();
    addMessage("ultrathink first");
    const second = addMessage("then workflowz and jevify");
    await frames();
    expect(ruled()).toEqual({ ultrathink: STOPS, workflowz: STOPS, jevify: STOPS });
    await scrollTo(second.element, FAR_BELOW);
    await frames(RULES_OFF_MS);
    expect(ruled()).toEqual({ ultrathink: STOPS });
  });

  test("a message in a hidden tab loses its rules and gets them back when the tab shows", async () => {
    await start();
    const { element } = addMessage("workflowz it");
    await frames();
    await setTabShown(element, false);
    await frames(RULES_OFF_MS);
    expect(sheet().textContent).toBe("");
    await setTabShown(element, true);
    expect(ruled()).toEqual({ workflowz: STOPS });
  });

  test("a shown composer overlay keeps its words' rules; a tab switch removes overlay and rules", async () => {
    await start();
    const textarea = addComposer("orchestrate the fix");
    await frames();
    expect(overlays()).toHaveLength(1);
    expect((overlays()[0] as HTMLElement).style.visibility).toBe("visible");
    expect(ruled()).toEqual({ orchestrate: STOPS });

    await setTabShown(textarea, false);
    expect(overlays()).toHaveLength(0);
    expect(ranges("orchestrate")).toBe(0);
    await frames(RULES_OFF_MS);
    expect(sheet().textContent).toBe("");

    await setTabShown(textarea, true);
    expect(overlays()).toHaveLength(1);
    expect(ruled()).toEqual({ orchestrate: STOPS });
  });

  test("a composer hidden by its own styles keeps its draft and shows the colours again", async () => {
    await start();
    const textarea = addComposer("ultrathink harder");
    await frames();
    let shown = true;
    HTMLElement.prototype.checkVisibility = () => shown;
    // Dictation fades the text box to opacity 0 and may write the transcript while it is hidden.
    shown = false;
    textarea.value = "ultrathink harder and jevify";
    await frames(RULES_OFF_MS + 60);
    expect((overlays()[0] as HTMLElement).style.visibility).toBe("hidden");
    expect(sheet().textContent).toBe("");
    shown = true;
    await frames();
    expect((overlays()[0] as HTMLElement).style.visibility).toBe("visible");
    expect(ruled()).toEqual({ ultrathink: STOPS, jevify: STOPS });
  });
});

describe("moving colours run only where they can be seen", () => {
  test("a message scrolled out of its chat's visible part stops moving, and moves again when scrolled back", async () => {
    await start({ ...PREFS, sent: "shimmer" });
    const chat = document.createElement("div");
    chat.style.overflowY = "auto";
    boxes.set(chat, { top: 0, height: 300 });
    document.body.appendChild(chat);
    // Inside the window but below the chat's bottom edge, where the text box sits.
    const { element } = addMessage("ultrathink", { top: 400, height: 40 }, chat);
    await frames();
    const still = stops();
    await frames(200);
    expect(stops()).toBe(still);

    await scrollTo(element, { top: 100, height: 40 });
    const before = stops();
    await frames(200);
    expect(stops()).not.toBe(before);
  });
});

describe("changes Paseo makes without an event", () => {
  test("a value written straight to the textarea is coloured, and clearing it removes the overlay", async () => {
    await start();
    const textarea = addComposer();
    await frames();
    expect(overlays()).toHaveLength(0);

    textarea.value = "jevify the draft";
    expect(textarea.value).toBe("jevify the draft");
    await frames();
    expect(overlays()).toHaveLength(1);
    expect(overlays()[0]!.textContent).toContain("jevify the draft");
    expect(ruled()).toEqual({ jevify: STOPS });

    textarea.value = "";
    await frames();
    expect(overlays()).toHaveLength(0);
  });

  test("React's value tracker on the element still sees every write, and gets its property back on dispose", async () => {
    await start();
    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-composer-input", "true");
    textarea.style.padding = "0px";
    boxes.set(textarea, IN_VIEW);
    // React defines an own `value` property at mount that records each write, then calls the native setter.
    const native = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!;
    const tracked: string[] = [];
    const tracker: PropertyDescriptor = {
      configurable: true,
      get(this: HTMLTextAreaElement) { return native.get!.call(this); },
      set(this: HTMLTextAreaElement, value: string) { tracked.push(value); native.set!.call(this, value); },
    };
    Object.defineProperty(textarea, "value", tracker);
    document.body.appendChild(textarea);
    await frames();

    textarea.value = "workflowz now";
    await frames();
    expect(tracked).toEqual(["workflowz now"]);
    expect(overlays()[0]!.textContent).toContain("workflowz now");

    engine!.dispose();
    engine = undefined;
    expect(Object.getOwnPropertyDescriptor(textarea, "value")!.set).toBe(tracker.set);
  });

  test("a message leaving the page drops its ranges at once and its rules shortly after", async () => {
    await start();
    const { wrapper, element } = addMessage("ultrathink then");
    await frames();
    expect(ranges("ultrathink")).toBeGreaterThan(0);

    wrapper.remove();
    await Promise.resolve();
    expect(ranges("ultrathink")).toBe(0);
    expect(observed(element)).toBe(false);
    await frames(RULES_OFF_MS);
    expect(sheet().textContent).toBe("");
  });

  test("a composer leaving the page takes its overlay with it", async () => {
    await start();
    const textarea = addComposer("orchestrate");
    await frames();
    expect(overlays()).toHaveLength(1);
    textarea.remove();
    await Promise.resolve();
    expect(overlays()).toHaveLength(0);
    expect(observed(textarea)).toBe(false);
  });

  test("a theme switch on <html> re-colours the rules for the new background", async () => {
    await start();
    const { element } = addMessage("ultrathink");
    await frames();
    const firstStop = () => sheet().textContent!.match(/::highlight\(noice-omp-magic-keywords-ultrathink-0\) \{ color: ([^;]+);/)![1];
    const [from] = MAGIC_KEYWORDS[0]!.hue;
    expect(firstStop()).toBe(keywordColor(from, "dark"));

    element.style.color = DARK_TEXT;
    document.documentElement.className = "light";
    await frames();
    expect(firstStop()).toBe(keywordColor(from, "light"));
  });

  test("a system light/dark switch re-colours the rules (Paseo's auto theme)", async () => {
    await start();
    const { element } = addMessage("ultrathink");
    await frames();
    element.style.color = DARK_TEXT;
    for (const listener of mediaListeners.get("(prefers-color-scheme: dark)") ?? []) listener();
    await frames();
    const [from] = MAGIC_KEYWORDS[0]!.hue;
    expect(sheet().textContent).toContain(`color: ${keywordColor(from, "light")};`);
  });
});

describe("idle cost", () => {
  test("leaves no timer or frame request running while nothing moves", async () => {
    await start();
    addMessage("ultrathink, still colours");
    addComposer("no keyword here");
    await frames(RULES_OFF_MS + 100);
    expect(vi.getTimerCount()).toBe(0);
  });

  // While any IntersectionObserver has an observation, Chromium makes every frame of a composited
  // animation a main-thread frame (Paseo's status rings: 0.1 → 60 main frames/s, measured in Chromium 150).
  test("never creates an IntersectionObserver", async () => {
    await start({ ...PREFS, sent: "shimmer", composer: "shimmer" });
    const { element } = addMessage("ultrathink");
    const textarea = addComposer("orchestrate");
    await frames();
    await scrollTo(element, FAR_BELOW);
    await setTabShown(textarea, false);
    await setTabShown(textarea, true);
    expect(intersectionObservers).toBe(0);
  });
});
