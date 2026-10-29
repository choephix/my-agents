import { describe, expect, it } from "vitest";
import { sessionRootsFromProviders, transcriptFile } from "./list";

describe("sessionRootsFromProviders", () => {
  it("maps omp and profile-based omp providers to their session folders", () => {
    // Synthetic provider configuration, including a company profile.
    const roots = sessionRootsFromProviders(
      {
        claude: { enabled: true },
        "omp-nilo": { extends: "omp", env: { OMP_PROFILE: "nilo", PI_CONFIG_FILES: "/x.yml" } },
        omp: { env: { PI_CONFIG_FILES: "/x.yml" }, enabled: true },
        grok: { extends: "acp", command: ["grok"] },
      },
      "/home/user",
    );
    expect(roots).toEqual([
      { dir: "/home/user/.omp/agent/sessions", provider: "omp" },
      { dir: "/home/user/.omp/profiles/nilo/agent/sessions", provider: "omp-nilo" },
    ]);
  });

  it("keeps the built-in omp folder without config and skips disabled providers", () => {
    expect(sessionRootsFromProviders({}, "/h")).toEqual([{ dir: "/h/.omp/agent/sessions", provider: "omp" }]);
    expect(
      sessionRootsFromProviders({ omp: { enabled: false }, "omp-b": { extends: "omp" } }, "/h"),
    ).toEqual([{ dir: "/h/.omp/agent/sessions", provider: "omp-b" }]);
  });
});

describe("transcriptFile", () => {
  it("uses OMP's file handle and derives Claude Code's project file; Codex has none", () => {
    const omp = "/home/user/.omp/agent/sessions/-workspace-acme-app/2026-01-01_session-a.jsonl";
    expect(transcriptFile({ provider: "omp", sessionId: "session-a", nativeHandle: omp }, "/x", "/home/user")).toBe(omp);
    // Claude Code replaces every non-alphanumeric in the cwd, e.g. ~/.paseo/plugin-data → -home-user--paseo-plugin-data.
    expect(
      transcriptFile({ provider: "claude", sessionId: "session-b", nativeHandle: "session-b" }, "/home/user/.paseo/plugin_data", "/home/user"),
    ).toBe("/home/user/.claude/projects/-home-user--paseo-plugin-data/session-b.jsonl");
    expect(transcriptFile({ provider: "codex", sessionId: "session-c", nativeHandle: "session-c" }, "/x", "/home/user")).toBeNull();
    expect(transcriptFile(null, "/x", "/home/user")).toBeNull();
  });
});
