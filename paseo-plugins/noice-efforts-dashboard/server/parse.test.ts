import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bucketOf, headFields, parseBlockedBy, statusWord, ticketKind } from "../shared/parse";
import { resolveTickets, scanEffort, scratchFor, skipReason } from "./scan";

// Synthetic fixtures exercise the free-form ticket and map formats.

describe("Status lines", () => {
  it.each([
    ["Status: open", "open", "open"],
    ["**Status:** resolved 2026-08-29", "resolved", "done"],
    ["**Status:** closed (2026-10-09)", "closed", "done"],
    ["Status: resolved, 2026-10-04. [spec.md](../spec.md) reviewed", "resolved", "done"],
    ["**Status:** open, follow-up to [03](03-x.md)", "open", "open"],
    ["**Status:** in progress — agent (high) in worktree acme-worktree", "in progress", "claimed"],
    ["Status: ready-for-agent", "ready-for-agent", "open"],
    ["**Status**: parked", "parked", "parked"],
  ])("%s", (line, word, bucket) => {
    const raw = headFields(`# Title\n\n${line}\n`).fields.get("status");
    expect(statusWord(raw)).toBe(word);
    expect(bucketOf(statusWord(raw))).toBe(bucket);
  });

  it("ignores Status lines below the first ## heading", () => {
    expect(headFields("# T\n\nType: task\n\n## Answer\n\nStatus: resolved\n").fields.has("status")).toBe(false);
  });
});

describe("what a ticket asks of you", () => {
  // Synthetic `Type:` values with optional qualifiers.
  it.each([
    ["wayfinder:grilling (HITL, user drives)", "talk"],
    ["wayfinder:prototype", "talk"],
    ["wayfinder:task (HITL)", "hands-on"],
    ["wayfinder:task (AFK)", "agent"],
    ["wayfinder:task (execution, per the map's local override)", "agent"],
    ["wayfinder:research", "agent"],
    ["grievance / example question (user, 2026-01-02)", "yours"],
    ["spike", null],
  ])("%s → %s", (raw, kind) => {
    expect(ticketKind(raw)).toBe(kind);
  });
});

describe("Blocked by", () => {
  it.each([
    ["none", [], [], null],
    ["—", [], [], null],
    ["None — can start immediately. Blocks ticket 09.", [], [], null],
    ["none (05 example closed 2026-01-02). Stacks on 11.", [], [], null],
    ["04, 06", ["04", "06"], [], null],
    ["[02](02-export-items.md) (needs the exported items); uses the formatter", ["02"], [], null],
    ["[01](01-example.md), [03](03-another-example.md)", ["01", "03"], [], null],
    ["12 — Example feature behavior.", ["12"], [], null],
    ["03 (08 resolved 2026-09-04)", ["03"], [], null],
    ["10 — sample host; 11 — sampleSelector property.", ["10", "11"], [], null],
    ["01 Who owns the example client; 06 Service terms and operating costs; 07 Example name", ["01", "06", "07"], [], null],
    ["02, acme-widgets 08", ["02"], [{ effort: "acme-widgets", num: "08" }], null],
    ["release shipped (metrics need more samples; the fixture has none)", [], [], "release shipped (metrics need more samples; the fixture has none)"],
    ["PR #123 merging", [], [], "PR #123 merging"],
  ])("%s", (raw, own, elsewhere, note) => {
    expect(parseBlockedBy(raw)).toEqual({ own, elsewhere, note });
  });
});

describe("symlinked .scratch roots", () => {
  let dir = "";
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("resolves a worktree's .scratch symlink to the shared folder", async () => {
    // A repository and its worktrees share one `.scratch` folder.
    dir = await mkdtemp(path.join(tmpdir(), "efforts-"));
    const shared = path.join(dir, "acme-app", ".scratch");
    await mkdir(path.join(shared, "acme-task"), { recursive: true });
    await writeFile(path.join(shared, "acme-task", "map.md"), "# acme-task\n");
    await mkdir(path.join(dir, "worktree"));
    await symlink(shared, path.join(dir, "worktree", ".scratch"));
    const real = await scratchFor(path.join(dir, "acme-app"), dir);
    expect(await scratchFor(path.join(dir, "worktree"), dir)).toBe(real);
    expect(await scratchFor("~/worktree/.scratch", dir)).toBe(real);
  });
});

describe("tickets sharing a number", () => {
  let dir = "";
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("keeps each file's own state and counts both", async () => {
    // An open ticket and a closed ticket can share the same number.
    dir = await mkdtemp(path.join(tmpdir(), "efforts-"));
    const issues = path.join(dir, "subagents", "issues");
    await mkdir(issues, { recursive: true });
    await writeFile(path.join(issues, "05-build-slice-1.md"), "# 05 — Build slice 1\n\n**Status:** open\n");
    await writeFile(path.join(issues, "05-reconcile.md"), "# 05 — Reconcile\n\n**Status:** closed (2026-10-16)\n");
    const scan = (await scanEffort(dir, "subagents"))!;
    const resolved = resolveTickets(scan, [scan], new Map());
    expect(resolved.state.get("issues/05-build-slice-1.md")).toBe("ready");
    expect(resolved.state.get("issues/05-reconcile.md")).toBe("done");
    expect(resolved.counts).toMatchObject({ total: 2, done: 1, ready: 1 });
  });
});

describe("skipped .scratch roots", () => {
  it.each([
    ["/home/user/fixtures/acme-test/.scratch", "under an excluded fixture folder"],
    ["/home/user/workspace/acme/__share__/acme-app/.scratch", "inside __share__"],
  ])("%s says why", (root, reason) => {
    expect(skipReason(root, "/home/user", ["~/fixtures"])).toContain(reason);
  });

  it.each(["/home/user/workspace/acme-app/.scratch", "/home/user/fixtures-other/.scratch"])("%s is scanned", (root) => {
    expect(skipReason(root, "/home/user", ["~/fixtures"])).toBeNull();
  });

  it("scans fixture folders by default when no exclusions are configured", () => {
    expect(skipReason("/home/user/fixtures/acme-test/.scratch", "/home/user")).toBeNull();
  });
});
