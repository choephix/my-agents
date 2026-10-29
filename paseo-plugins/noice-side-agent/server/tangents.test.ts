import { describe, expect, it } from "vitest";
import { TANGENT_PARENT_LABEL, TANGENT_STARTED_LABEL, TangentWatcher, type AgentFacts, type TangentPort } from "./tangents";

function agent(id: string, provider: string, status: string, extra: Partial<AgentFacts> = {}): AgentFacts {
  return { id, provider, status, archived: false, title: null, labels: {}, lastError: null, ...extra };
}

function setup(agents: AgentFacts[]) {
  const byId = new Map(agents.map(a => [a.id, a]));
  const sent: Array<[string, string]> = [];
  const reported: string[] = [];
  const port: TangentPort = {
    agent: async id => byId.get(id) ?? null,
    pending: async () => [...byId.values()].filter(a => a.labels[TANGENT_PARENT_LABEL]),
    finalReply: async id => `reply of ${id}`,
    send: async (id, text) => void sent.push([id, text]),
    markReported: async id => void reported.push(id),
    link: async id => `link/${id}`,
  };
  const watcher = new TangentWatcher(port, () => 10_000);
  return { watcher, sent, reported, byId };
}

const tangent = (parentId: string, title = "Tangent: t") => ({ parentId, title, startedAt: 4_000 });

describe("TangentWatcher", () => {
  it("reports once into an OMP parent via /follow-up, even when the turn end and archive both arrive", async () => {
    const { watcher, sent, reported } = setup([agent("p", "omp", "running")]);
    await watcher.watch("c", tangent("p"));
    await watcher.turnEnded("c", { kind: "completed" });
    await watcher.archived("c");
    await watcher.turnEnded("c", { kind: "completed" });
    expect(sent).toEqual([["p", `/follow-up Tangent "Tangent: t" finished (6s):\n\nreply of c\n\nOpen the tangent: link/c`]]);
    expect(reported).toEqual(["c"]);
  });

  it("reports a child whose turn ended before it was watched", async () => {
    const { watcher, sent } = setup([agent("p", "omp", "idle")]);
    await watcher.turnEnded("c", { kind: "failed", message: "boom" });
    await watcher.watch("c", tangent("p"));
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toContain("failed after 6s: boom");
  });

  it("holds reports for a busy non-OMP parent and sends them as one message when its turn ends", async () => {
    const { watcher, sent, reported } = setup([agent("p", "claude", "running")]);
    await watcher.watch("c1", tangent("p", "one"));
    await watcher.watch("c2", tangent("p", "two"));
    await watcher.turnEnded("c1", { kind: "completed" });
    await watcher.turnEnded("c2", { kind: "canceled" });
    expect(sent).toEqual([]);
    expect(reported).toEqual([]);
    await watcher.turnEnded("p", { kind: "completed" });
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toMatch(/^Tangent "one" finished[\s\S]*\n\n---\n\nTangent "two" was stopped/);
    expect(reported).toEqual(["c1", "c2"]);
  });

  it("drops held reports, marking them reported, when the busy parent is archived", async () => {
    const { watcher, sent, reported } = setup([agent("p", "codex", "running")]);
    await watcher.watch("c", tangent("p"));
    await watcher.turnEnded("c", { kind: "completed" });
    await watcher.archived("p");
    await watcher.turnEnded("p", { kind: "completed" });
    expect(sent).toEqual([]);
    expect(reported).toEqual(["c"]);
  });

  it("on resume, watches running tangents and reports the ones that ended while unwatched", async () => {
    const labels = (parent: string) => ({ [TANGENT_PARENT_LABEL]: parent, [TANGENT_STARTED_LABEL]: "1000" });
    const { watcher, sent } = setup([
      agent("p", "omp", "idle"),
      agent("running", "omp", "running", { title: "R", labels: labels("p") }),
      agent("done", "omp", "idle", { title: "D", labels: labels("p") }),
      agent("broken", "omp", "error", { title: "B", labels: labels("p"), lastError: "crashed" }),
    ]);
    await watcher.resume();
    expect(sent.map(([, text]) => text.split("\n")[0])).toEqual([
      `/follow-up Tangent "D" finished (9s):`,
      `/follow-up Tangent "B" failed after 9s: crashed`,
    ]);
    await watcher.turnEnded("running", { kind: "completed" });
    expect(sent[2][1]).toContain(`Tangent "R" finished (9s):\n\nreply of running`);
  });
});
