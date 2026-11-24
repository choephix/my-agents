import { describe, expect, it } from "vitest";
import type { EffortSummary, Overview, WorkspaceInfo } from "../shared/rpc";
import { rowBadgeFor } from "./row-badge";

function makeEffort(overrides: Partial<EffortSummary> = {}): EffortSummary {
  return {
    key: "/w/.scratch/acme-task",
    root: "/w/.scratch",
    slug: "acme-task",
    short: "task",
    title: "Acme task",
    mapStatus: "delivery",
    destination: null,
    counts: { total: 9, done: 4, ready: 3, claimed: 1, blocked: 1, parked: 0 },
    next: { num: "05", title: "Next step" },
    touchedMs: 1_000,
    hasMap: true,
    stateWord: "delivery",
    ...overrides,
  };
}

function makeOverview(workspaces: WorkspaceInfo[], efforts: EffortSummary[] = [makeEffort()]): Overview {
  return {
    home: "/home/user",
    roots: [{ root: "/w/.scratch", label: "acme", efforts }],
    workspaces,
    warnings: [],
    showHeaderButton: true,
    commitsShown: 30,
    etag: "e1",
  };
}

function makeWorkspace(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    id: "wks_1",
    name: "Example",
    projectName: "acme",
    dir: "/w",
    root: "/w/.scratch",
    skipped: null,
    binding: null,
    suggestion: null,
    ...overrides,
  };
}

describe("rowBadgeFor", () => {
  it("returns null before overview loads or for unbound / no-effort workspaces", () => {
    expect(rowBadgeFor(null, "wks_1")).toBeNull();
    const overview = makeOverview([
      makeWorkspace({ id: "wks_unbound", suggestion: { root: "/w/.scratch", slug: "acme-task", reason: "why", source: "name" } }),
      makeWorkspace({ id: "wks_none", binding: { kind: "none", at: "2026-11-24T00:00:00.000Z" } }),
    ]);
    expect(rowBadgeFor(overview, "wks_unbound")).toBeNull();
    expect(rowBadgeFor(overview, "wks_none")).toBeNull();
    expect(rowBadgeFor(overview, "wks_missing")).toBeNull();
  });

  it("shows short name and done/total count for an in-progress bound effort", () => {
    const overview = makeOverview([
      makeWorkspace({ id: "wks_1", binding: { kind: "effort", root: "/w/.scratch", slug: "acme-task", at: "2026-11-24T00:00:00.000Z" } }),
    ]);
    expect(rowBadgeFor(overview, "wks_1")).toEqual({
      label: "task · 4/9",
      tone: "muted",
      accessibilityLabel: "acme-task · 4/9 done",
    });
  });

  it("uses success tone once all tickets are done", () => {
    const overview = makeOverview(
      [makeWorkspace({ id: "wks_1", binding: { kind: "effort", root: "/w/.scratch", slug: "acme-task", at: "2026-11-24T00:00:00.000Z" } })],
      [makeEffort({ counts: { total: 5, done: 5, ready: 0, claimed: 0, blocked: 0, parked: 0 } })],
    );
    expect(rowBadgeFor(overview, "wks_1")).toEqual({
      label: "task · 5/5",
      tone: "success",
      accessibilityLabel: "acme-task · 5/5 done",
    });
  });

  it("omits counts for map-only efforts or when the effort summary is missing", () => {
    const overview = makeOverview(
      [
        makeWorkspace({ id: "wks_map", binding: { kind: "effort", root: "/w/.scratch", slug: "acme-map", at: "2026-11-24T00:00:00.000Z" } }),
        makeWorkspace({ id: "wks_gone", binding: { kind: "effort", root: "/w/.scratch", slug: "acme-gone", at: "2026-11-24T00:00:00.000Z" } }),
      ],
      [makeEffort({ slug: "acme-map", short: "map", counts: { total: 0, done: 0, ready: 0, claimed: 0, blocked: 0, parked: 0 } })],
    );
    expect(rowBadgeFor(overview, "wks_map")).toEqual({
      label: "map",
      tone: "muted",
      accessibilityLabel: "Effort acme-map",
    });
    expect(rowBadgeFor(overview, "wks_gone")).toEqual({
      label: "acme-gone",
      tone: "muted",
      accessibilityLabel: "Effort acme-gone",
    });
  });
});
