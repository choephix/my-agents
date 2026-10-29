import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importRequest } from "./reopen";

describe("importRequest", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "past-sessions-reopen-"));
    await mkdir(path.join(root, "repo", "sub"), { recursive: true });
    await symlink(path.join(root, "repo"), path.join(root, "link"));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const input = (cwd: string) => ({
    source: "import" as const,
    provider: "omp",
    cwd,
    handle: "/sessions/a.jsonl",
    key: "omp:a",
    workspaceId: "ws_viewed",
  });

  it("imports a session from the panel's folder into the panel's workspace, even through a symlink", async () => {
    expect(await importRequest(input(path.join(root, "repo")), path.join(root, "link"))).toEqual({
      provider: "omp",
      sessionId: "/sessions/a.jsonl",
      cwd: path.join(root, "repo"),
      workspaceId: "ws_viewed",
    });
  });

  it("leaves the workspace to the daemon for a session from another folder, or when the workspace is gone", async () => {
    // The daemon rejects a workspace whose folder isn't the session's cwd.
    expect(await importRequest(input(path.join(root, "repo", "sub")), path.join(root, "repo"))).not.toHaveProperty("workspaceId");
    expect(await importRequest(input(path.join(root, "repo")), null)).not.toHaveProperty("workspaceId");
  });
});
