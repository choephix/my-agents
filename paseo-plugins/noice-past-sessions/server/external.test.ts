import { describe, expect, it } from "vitest";
import { externalInScope, externalProviders, type ExternalCandidate } from "./external";

const home = "/home/user";
function candidate(overrides: Partial<ExternalCandidate> & { sessionId: string }): ExternalCandidate {
  return {
    provider: "claude",
    cwd: "/home/user/workspace/acme-app",
    title: null,
    firstPrompt: null,
    lastActivityAt: "2026-10-19T10:00:00.000Z",
    ...overrides,
  };
}

describe("externalInScope", () => {
  // One unscoped daemon listing serves every scope; it is filtered here.
  const listing = [
    candidate({ sessionId: "root", title: "\uF0EB Root session" }),
    candidate({ sessionId: "worktree", cwd: "/home/user/.herdr/worktrees/acme-app/TICKET-123", provider: "codex", firstPrompt: "Fix the build\nmore" }),
    candidate({ sessionId: "sub", cwd: "/home/user/workspace/acme-app/packages/app" }),
    candidate({ sessionId: "sibling", cwd: "/home/user/workspace/acme-app-other" }),
    candidate({ sessionId: "owned" }),
  ];
  const knownRefs = new Set(["owned"]);

  it("folder scope keeps only sessions run in the folder itself", () => {
    const entries = externalInScope(listing, { targets: ["/home/user/workspace/acme-app"], includeSubfolders: false, knownRefs }, home);
    expect(entries.map((entry) => entry.key)).toEqual(["ext:claude:root"]);
  });

  it("project scope adds subfolders and worktrees, never siblings that only share a prefix", () => {
    const entries = externalInScope(
      listing,
      { targets: ["/home/user/workspace/acme-app", "/home/user/.herdr/worktrees/acme-app/TICKET-123"], includeSubfolders: true, knownRefs },
      home,
    );
    expect(entries.map((entry) => entry.key)).toEqual(["ext:claude:root", "ext:codex:worktree", "ext:claude:sub"]);
  });

  it("drops sessions a Paseo agent owns and repeated listings of one session", () => {
    const entries = externalInScope(
      [...listing, candidate({ sessionId: "root" })],
      { targets: ["/home/user/workspace/acme-app"], includeSubfolders: false, knownRefs },
      home,
    );
    expect(entries.map((entry) => entry.sessionId)).toEqual(["root"]);
  });

  it("titles from the session title or first prompt line, and points Claude rows at their transcript", () => {
    const [root, worktree] = externalInScope(
      listing,
      { targets: ["/home/user/workspace/acme-app", "/home/user/.herdr/worktrees/acme-app/TICKET-123"], includeSubfolders: true, knownRefs },
      home,
    );
    expect(root).toMatchObject({
      source: "external",
      title: "Root session",
      file: "/home/user/.claude/projects/-home-user-workspace-acme-app/root.jsonl",
    });
    expect(worktree).toMatchObject({ source: "external", provider: "codex", title: "Fix the build" });
    expect(worktree?.file).toBeUndefined();
  });
});

describe("externalProviders", () => {
  it("lists Claude Code and Codex unless the daemon config disables one", () => {
    expect(externalProviders({})).toEqual(["claude", "codex"]);
    expect(externalProviders({ claude: { enabled: true }, codex: { enabled: false } })).toEqual(["claude"]);
  });
});
