import { describe, expect, it } from "vitest";
import { cleanTitle, mergePastSessions, titleFromPrompt, type AgentRecord, type ScopeFilter } from "./merge";
import type { OmpSession } from "./omp-sessions";

const folder = "/home/user/workspace/acme-app";
const workspaceScope: ScopeFilter = { mode: "workspace", targets: [folder], workspaceIds: ["wks_plugins"], projectId: null };
const folderScope: ScopeFilter = { ...workspaceScope, mode: "folder" };
const projectScope: ScopeFilter = {
  mode: "project",
  targets: [folder],
  workspaceIds: ["wks_plugins", "wks_secondary"],
  projectId: "prj_index",
};

function agent(overrides: Partial<AgentRecord> & { id: string }): AgentRecord {
  return {
    title: null,
    cwd: folder,
    provider: "omp",
    workspaceId: "wks_plugins",
    projectId: "prj_index",
    archivedAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    lastUserMessageAt: null,
    sessionRefs: [],
    transcript: null,
    ...overrides,
  };
}

function omp(overrides: Partial<OmpSession> & { sessionId: string }): OmpSession {
  return {
    cwd: folder,
    createdAt: null,
    title: null,
    firstPrompt: null,
    file: `/home/user/.omp/agent/sessions/-workspace-acme-app/x_${overrides.sessionId}.jsonl`,
    provider: "omp",
    mtime: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const keys = (entries: { key: string }[]) => entries.map((entry) => entry.key).sort();

describe("mergePastSessions scopes", () => {
  // Two synthetic workspaces share the same project folder.
  const agents = [
    agent({ id: "plugins-archived" }),
    agent({ id: "plugins-live", archivedAt: null }),
    agent({ id: "example-archived", workspaceId: "wks_secondary" }),
    // A workspace's agent may run in a subfolder; its workspace still claims it.
    agent({ id: "plugins-subfolder", cwd: `${folder}/.scratch` }),
    // An agent of a workspace that was archived since: only cwd ties it to the folder.
    agent({ id: "orphan", workspaceId: "wks_gone", projectId: null }),
  ];
  const ompSessions = [omp({ sessionId: "terminal", firstPrompt: "Old terminal session" })];

  it("workspace: only this workspace's archived agents; the folder's OMP sessions go to sameFolder", () => {
    const result = mergePastSessions({ agents, ompSessions, scope: workspaceScope });
    expect(keys(result.entries)).toEqual(["paseo:plugins-archived", "paseo:plugins-subfolder"]);
    expect(keys(result.sameFolder)).toEqual(["omp:terminal"]);
  });

  it("folder: every archived agent in the folder, sibling workspaces and orphans included, mixed with OMP", () => {
    const result = mergePastSessions({ agents, ompSessions, scope: folderScope });
    expect(keys(result.entries)).toEqual([
      "omp:terminal",
      "paseo:example-archived",
      "paseo:orphan",
      "paseo:plugins-archived",
      "paseo:plugins-subfolder",
    ]);
    expect(result.sameFolder).toEqual([]);
  });

  it("project: subfolders, every project workspace, and agents Paseo placed in the project", () => {
    const elsewhere = agent({ id: "worktree", cwd: "/home/user/.paseo/worktrees/abc", workspaceId: "wks_gone" });
    const unrelated = agent({ id: "unrelated", cwd: "/tmp/x", workspaceId: "wks_other", projectId: "prj_other" });
    const result = mergePastSessions({ agents: [...agents, elsewhere, unrelated], ompSessions: [], scope: projectScope });
    expect(keys(result.entries)).toEqual([
      "paseo:example-archived",
      "paseo:orphan",
      "paseo:plugins-archived",
      "paseo:plugins-subfolder",
      "paseo:worktree",
    ]);
  });
});

describe("mergePastSessions dedup and order", () => {
  it("hides OMP sessions any Paseo agent already owns, by session id or by file path", () => {
    const result = mergePastSessions({
      agents: [
        agent({ id: "live", archivedAt: null, sessionRefs: ["s-live"] }),
        agent({ id: "archived", sessionRefs: ["s-archived"] }),
        agent({ id: "imported", cwd: "/elsewhere", workspaceId: "wks_other", sessionRefs: ["/f/by-path.jsonl"] }),
      ],
      ompSessions: [
        omp({ sessionId: "s-live" }),
        omp({ sessionId: "s-archived" }),
        omp({ sessionId: "s-path", file: "/f/by-path.jsonl" }),
        omp({ sessionId: "s-only" }),
      ],
      scope: folderScope,
    });
    expect(keys(result.entries)).toEqual(["omp:s-only", "paseo:archived"]);
    expect(result.hiddenKnownToPaseo).toBe(3);
  });

  it("lists a session found in two session folders once, with its newest copy", () => {
    const result = mergePastSessions({
      agents: [],
      ompSessions: [
        omp({ sessionId: "dup", file: "/old/x_dup.jsonl", mtime: "2026-09-01T00:00:00.000Z" }),
        omp({ sessionId: "dup", file: "/new/x_dup.jsonl", mtime: "2026-10-01T00:00:00.000Z" }),
      ],
      scope: workspaceScope,
    });
    expect(result.sameFolder).toHaveLength(1);
    expect(result.sameFolder[0]?.file).toBe("/new/x_dup.jsonl");
  });

  it("sorts newest activity first across both sources", () => {
    const result = mergePastSessions({
      agents: [
        agent({ id: "a-old", lastUserMessageAt: "2026-09-01T00:00:00.000Z" }),
        agent({ id: "a-new", lastUserMessageAt: "2026-10-03T00:00:00.000Z" }),
      ],
      ompSessions: [omp({ sessionId: "o-mid", mtime: "2026-10-02T00:00:00.000Z" })],
      scope: folderScope,
    });
    expect(result.entries.map((entry) => entry.key)).toEqual(["paseo:a-new", "omp:o-mid", "paseo:a-old"]);
  });

  it("dates and titles an untitled archived agent from its OMP file", () => {
    const result = mergePastSessions({
      agents: [agent({ id: "a", updatedAt: "2026-10-09T00:00:00.000Z", sessionRefs: ["s1"] })],
      ompSessions: [omp({ sessionId: "s1", firstPrompt: "Fix the build\nmore", mtime: "2026-10-05T00:00:00.000Z" })],
      scope: workspaceScope,
    });
    expect(result.entries).toEqual([
      expect.objectContaining({ key: "paseo:a", title: "Fix the build", at: "2026-10-05T00:00:00.000Z" }),
    ]);
  });
});

describe("cleanTitle", () => {
  it("drops Nerd Font glyphs OMP puts before terminal titles", () => {
    expect(cleanTitle("\uF0EB  DOCS: Review sample")).toBe("DOCS: Review sample");
    expect(cleanTitle("\u{F0A1E} WIDGET: Example")).toBe("WIDGET: Example");
    expect(cleanTitle("\uF0EB")).toBeNull();
    expect(cleanTitle("Fix café ✓")).toBe("Fix café ✓");
  });
});

describe("titleFromPrompt", () => {
  it("skips blank lines and wrapper tags", () => {
    expect(titleFromPrompt("\n<chat-history-summary>\nChat history from a previous Paseo agent.")).toBe(
      "Chat history from a previous Paseo agent.",
    );
  });

  it("keeps the whole line; only the UI ellipsizes by width", () => {
    const line = `${"long first prompt line ".repeat(30)}end`;
    expect(titleFromPrompt(`${line}\nsecond line`)).toBe(line);
  });
});
