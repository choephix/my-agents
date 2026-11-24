import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INSTRUCTIONS_METADATA_KEY } from "../shared/next-chat";
import { appendSystemPrompt, extractInstructions, NextChatStore } from "./next-chat";

describe("extractInstructions", () => {
  it("returns null when metadata is missing, non-string, or blank", () => {
    expect(extractInstructions(undefined)).toBeNull();
    expect(extractInstructions({})).toBeNull();
    expect(extractInstructions({ [INSTRUCTIONS_METADATA_KEY]: null })).toBeNull();
    expect(extractInstructions({ [INSTRUCTIONS_METADATA_KEY]: 42 })).toBeNull();
    expect(extractInstructions({ [INSTRUCTIONS_METADATA_KEY]: "   \n\t " })).toBeNull();
  });

  it("returns the instruction text unchanged when non-blank", () => {
    expect(extractInstructions({ [INSTRUCTIONS_METADATA_KEY]: "Be terse.\nNo filler." })).toBe("Be terse.\nNo filler.");
  });
});

describe("appendSystemPrompt", () => {
  it("uses instructions directly when existing prompt is absent or blank", () => {
    expect(appendSystemPrompt(undefined, "Act as reviewer.")).toBe("Act as reviewer.");
    expect(appendSystemPrompt("   ", "Act as reviewer.")).toBe("Act as reviewer.");
  });

  it("appends instructions after a blank line when an existing prompt is present", () => {
    expect(appendSystemPrompt("Base prompt.", "Act as reviewer.")).toBe("Base prompt.\n\nAct as reviewer.");
  });
});

describe("NextChatStore", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function tempFile() {
    const dir = await mkdtemp(join(tmpdir(), "next-chat-test-"));
    dirs.push(dir);
    return join(dir, "next-chat.json");
  }

  it("starts empty and persists the most recently used instructions", async () => {
    const file = await tempFile();
    let now = 1_000;
    const store = new NextChatStore(file, () => now);
    expect(await store.lastUsed()).toBeNull();

    await store.recordUsed("agent-1", "First brief");
    now = 2_000;
    await store.recordUsed("agent-2", "Second brief");

    const reloaded = new NextChatStore(file);
    expect(await reloaded.lastUsed()).toEqual({ agentId: "agent-2", text: "Second brief", at: 2_000 });
  });

  it("reads the newest entry from legacy v1 files", async () => {
    const file = await tempFile();
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        armed: {},
        lastUsed: {
          ws1: { agentId: "a1", text: "Older", at: 100 },
          ws2: { agentId: "a2", text: "Newer", at: 300 },
          ws3: { agentId: "a3", text: "Middle", at: 200 },
        },
      }),
    );
    const store = new NextChatStore(file);
    expect(await store.lastUsed()).toEqual({ agentId: "a2", text: "Newer", at: 300 });
  });
});
