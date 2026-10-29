// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Preferences } from "../shared/preferences";
import { CACHE_KEY, FEATURES, startTweaks, type Tweaks } from "./web";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const ALL_ON: Preferences = { compactSidebar: true, fileWrap: true, linkColours: true };
const styles = () => [...document.head.querySelectorAll("style")].map((style) => style.getAttribute("data-plugin"));
const pageCss = () => [...document.head.querySelectorAll("style")].map((style) => style.textContent).join("\n");

let tweaks: Tweaks | undefined;
beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
});
afterEach(() => {
  tweaks?.dispose();
  tweaks = undefined;
  vi.restoreAllMocks();
});

describe("switches", () => {
  test("nothing is injected before the switches are known", () => {
    tweaks = startTweaks();
    expect(styles()).toEqual([]);
  });

  test("a tweak that is off adds no CSS at all", () => {
    tweaks = startTweaks();
    tweaks.apply({ ...ALL_ON, fileWrap: false });
    expect(styles()).toEqual(["noice-tweaks-compact-sidebar", "noice-tweaks-link-colours"]);
    expect(pageCss()).not.toContain("file-source-editor");
  });

  test("switching one off removes only its CSS, and switching it on brings it back once", () => {
    tweaks = startTweaks();
    tweaks.apply(ALL_ON);
    tweaks.apply({ ...ALL_ON, compactSidebar: false });
    expect(pageCss()).not.toContain("sidebar-workspace-row-");
    expect(styles()).toEqual(["noice-tweaks-file-wrap", "noice-tweaks-link-colours"]);
    tweaks.apply(ALL_ON);
    tweaks.apply(ALL_ON);
    expect(styles().filter((name) => name === "noice-tweaks-compact-sidebar")).toHaveLength(1);
  });

  test("disposing the plugin removes every tweak", () => {
    tweaks = startTweaks();
    tweaks.apply(ALL_ON);
    tweaks.dispose();
    expect(styles()).toEqual([]);
  });
});

describe("fencing", () => {
  test("a tweak that throws on start leaves the others running", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tweaks = startTweaks({ ...FEATURES, fileWrap: () => { throw new Error("boom"); } });
    tweaks.apply(ALL_ON);
    expect(styles()).toEqual(["noice-tweaks-compact-sidebar", "noice-tweaks-link-colours"]);
  });

  test("a tweak that throws on stop does not keep the others from stopping", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tweaks = startTweaks({ ...FEATURES, compactSidebar: () => () => { throw new Error("boom"); } });
    tweaks.apply(ALL_ON);
    tweaks.apply({ compactSidebar: false, fileWrap: false, linkColours: false });
    expect(styles()).toEqual([]);
  });
});

describe("page load", () => {
  test("the switches last applied in this browser style the page before the daemon answers", () => {
    const first = startTweaks();
    first.apply({ ...ALL_ON, linkColours: false });
    first.dispose();
    tweaks = startTweaks();
    expect(styles()).toEqual(["noice-tweaks-compact-sidebar", "noice-tweaks-file-wrap"]);
  });

  test("an unreadable cache starts nothing", () => {
    localStorage.setItem(CACHE_KEY, "{not json");
    tweaks = startTweaks();
    expect(styles()).toEqual([]);
  });
});
