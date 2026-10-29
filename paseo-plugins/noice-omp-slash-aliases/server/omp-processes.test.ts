import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { btwReady, listProcesses, type ProcessInfo } from "./omp-processes";

function host(pid: number, agentId: string, argv = ["omp", "--mode", "rpc-ui", "--model", "x"]): ProcessInfo {
  return { pid, argv, env: { PASEO_AGENT_ID: agentId } };
}

describe("btwReady", () => {
  it("is ready when no OMP host runs (Paseo starts one with the current extension)", () => {
    expect(btwReady([], "chat-a", new Set())).toBe(true);
  });

  it("refuses a live host that never announced /btw support", () => {
    expect(btwReady([host(10, "chat-a")], "chat-a", new Set())).toBe(false);
    expect(btwReady([host(10, "chat-a")], "chat-a", new Set([10]))).toBe(true);
  });

  it("ignores other chats' hosts, tool subprocesses and nested non-RPC omp runs", () => {
    const processes = [
      host(10, "chat-a"),
      host(11, "chat-b"),
      host(12, "chat-a", ["bash", "-c", "sleep 30"]),
      host(13, "chat-a", ["omp", "-p", "summarize"]),
      host(14, "chat-a", ["/home/user/.local/bin/omp", "--mode=rpc"]),
    ];
    expect(btwReady(processes, "chat-a", new Set([10, 14]))).toBe(true);
    expect(btwReady(processes, "chat-a", new Set([10]))).toBe(false);
  });
});

describe("listProcesses", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

  it("reads argv and environment from a /proc tree, skipping unreadable entries", async () => {
    const proc = mkdtempSync(join(tmpdir(), "proc-"));
    roots.push(proc);
    mkdirSync(join(proc, "42"));
    writeFileSync(join(proc, "42", "cmdline"), "omp\0--mode\0rpc-ui\0");
    writeFileSync(join(proc, "42", "environ"), "PASEO_AGENT_ID=chat-a\0EMPTY=\0WEIRD=a=b\0");
    mkdirSync(join(proc, "43")); // Exited: no files.
    mkdirSync(join(proc, "self"));

    expect(await listProcesses(proc)).toEqual([
      { pid: 42, argv: ["omp", "--mode", "rpc-ui"], env: { PASEO_AGENT_ID: "chat-a", EMPTY: "", WEIRD: "a=b" } },
    ]);
  });
});
