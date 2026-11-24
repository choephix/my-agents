import { describe, expect, it } from "vitest";
import { NEW_WORKSPACE_EFFORT_KEY, type ProjectEffort } from "../shared/new-workspace";
import type { Overview, WorkspaceInfo } from "../shared/rpc";
import {
  CLEAR_EFFORT_ID,
  NONE_EFFORT_ID,
  buildEffortOptions,
  effortOptionDescription,
  projectLikelyHasEfforts,
  selectedEffortValue,
} from "./new-workspace";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");

function makeEffort(overrides: Partial<ProjectEffort> = {}): ProjectEffort {
  return {
    key: "/w/.scratch/acme-task",
    root: "/w/.scratch",
    slug: "acme-task",
    short: "task",
    title: "Acme task",
    mapStatus: "delivery",
    destination: "Ship the feature",
    counts: { total: 9, done: 4, ready: 3, claimed: 1, blocked: 1, parked: 0 },
    next: { num: "05", title: "Next step" },
    touchedMs: NOW - 2 * 3600_000,
    hasMap: true,
    stateWord: "delivery",
    rootLabel: "acme",
    ...overrides,
  };
}

function makeOverview(workspaces: WorkspaceInfo[], roots: Overview["roots"]): Overview {
  return {
    home: "/home/user",
    roots,
    workspaces,
    warnings: [],
    showHeaderButton: true,
    commitsShown: 30,
    etag: "e1",
  };
}

describe("selectedEffortValue", () => {
  it("returns null for absent or malformed metadata", () => {
    expect(selectedEffortValue(undefined)).toBeNull();
    expect(selectedEffortValue({})).toBeNull();
    expect(selectedEffortValue({ [NEW_WORKSPACE_EFFORT_KEY]: "bad" })).toBeNull();
    expect(selectedEffortValue({ [NEW_WORKSPACE_EFFORT_KEY]: { kind: "effort", root: "", slug: "x" } })).toBeNull();
  });

  it("reads an effort choice and falls back from label to slug", () => {
    expect(
      selectedEffortValue({
        [NEW_WORKSPACE_EFFORT_KEY]: { kind: "effort", root: "/w/.scratch", slug: "acme-task", label: "task" },
      }),
    ).toEqual({ id: "/w/.scratch/acme-task", label: "task" });

    expect(
      selectedEffortValue({
        [NEW_WORKSPACE_EFFORT_KEY]: { kind: "effort", root: "/w/.scratch", slug: "acme-task" },
      }),
    ).toEqual({ id: "/w/.scratch/acme-task", label: "acme-task" });
  });

  it("reads an explicit No effort choice", () => {
    expect(selectedEffortValue({ [NEW_WORKSPACE_EFFORT_KEY]: { kind: "none" } })).toEqual({
      id: NONE_EFFORT_ID,
      label: "No effort",
    });
  });
});

describe("effortOptionDescription", () => {
  it("formats ticket progress, status, age, and omits redundant titles", () => {
    expect(effortOptionDescription(makeEffort(), { now: NOW })).toBe("4/9 done · delivery · 2h");
  });

  it("includes distinct title, map-only state, and multi-root label when relevant", () => {
    const effort = makeEffort({
      slug: "onboarding-flow",
      short: "onboarding-flow",
      title: "Onboarding Flow",
      mapStatus: null,
      counts: { total: 0, done: 0, ready: 0, claimed: 0, blocked: 0, parked: 0 },
      touchedMs: NOW - 3 * 24 * 3600_000,
      rootLabel: "beta-docs",
    });
    expect(effortOptionDescription(effort, { multiRoot: true, now: NOW })).toBe("map only · 3d · beta-docs · Onboarding Flow");
  });
});

describe("buildEffortOptions", () => {
  it("omits Clear when nothing is selected and includes No effort at the bottom", () => {
    const options = buildEffortOptions({
      efforts: [makeEffort()],
      rootCount: 1,
      query: "",
      selected: null,
      now: NOW,
    });
    expect(options.map((o) => o.id)).toEqual(["/w/.scratch/acme-task", NONE_EFFORT_ID]);
    expect(options[0]).toMatchObject({ kind: "effort", label: "task", description: "4/9 done · delivery · 2h" });
  });

  it("prepends Clear when an effort is selected and query is empty", () => {
    const options = buildEffortOptions({
      efforts: [makeEffort()],
      rootCount: 1,
      query: "",
      selected: { id: "/w/.scratch/acme-task", label: "task" },
      now: NOW,
    });
    expect(options.map((o) => o.id)).toEqual([CLEAR_EFFORT_ID, "/w/.scratch/acme-task", NONE_EFFORT_ID]);
  });

  it("hides Clear while typing and filters No effort by query", () => {
    const filteredOut = buildEffortOptions({
      efforts: [makeEffort()],
      rootCount: 1,
      query: "task",
      selected: { id: "/w/.scratch/acme-task", label: "task" },
      now: NOW,
    });
    expect(filteredOut.map((o) => o.id)).toEqual(["/w/.scratch/acme-task"]);

    const matchedNone = buildEffortOptions({
      efforts: [],
      rootCount: 1,
      query: "no eff",
      selected: null,
      now: NOW,
    });
    expect(matchedNone.map((o) => o.id)).toEqual([NONE_EFFORT_ID]);
  });

  it("does not duplicate No effort when No effort is already selected", () => {
    const options = buildEffortOptions({
      efforts: [makeEffort()],
      rootCount: 1,
      query: "",
      selected: { id: NONE_EFFORT_ID, label: "No effort" },
      now: NOW,
    });
    expect(options.map((o) => o.id)).toEqual([CLEAR_EFFORT_ID, "/w/.scratch/acme-task"]);
  });
});

describe("projectLikelyHasEfforts", () => {
  it("detects projects from overview roots or workspace project names", () => {
    const overview = makeOverview(
      [
        {
          id: "wks_1",
          name: "main",
          projectName: "beta",
          dir: "/w/beta",
          root: "/w/beta-docs/.scratch",
          skipped: null,
          binding: null,
          suggestion: null,
        },
      ],
      [{ root: "/w/acme/.scratch", label: "acme", efforts: [makeEffort({ root: "/w/acme/.scratch" })] }],
    );
    expect(projectLikelyHasEfforts(overview, "acme")).toBe(true);
    expect(projectLikelyHasEfforts(overview, "beta")).toBe(true);
    expect(projectLikelyHasEfforts(overview, "other")).toBe(false);
    expect(projectLikelyHasEfforts(null, "acme")).toBe(false);
  });
});
