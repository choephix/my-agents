import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { connectLocalDaemon, paseoHome } from "./daemon";
import { chooseDelivery, deliveryText, finalReply, formatTangentReport, type TangentOutcome } from "./tangent-report";

/** Child labels; they are the durable record, so a plugin reload can resume watching. */
export const TANGENT_LABEL = "side-agent.tangent";
export const TANGENT_PARENT_LABEL = "side-agent.tangent-parent";
export const TANGENT_STARTED_LABEL = "side-agent.tangent-started";

export interface AgentFacts {
  id: string;
  provider: string;
  status: string;
  archived: boolean;
  title: string | null;
  labels: Record<string, string>;
  lastError: string | null;
}

export interface TangentPort {
  agent(id: string): Promise<AgentFacts | null>;
  /** Children still labelled pending, archived ones included. */
  pending(): Promise<AgentFacts[]>;
  finalReply(id: string): Promise<string>;
  send(id: string, text: string): Promise<void>;
  markReported(id: string): Promise<void>;
  link(id: string): Promise<string>;
}

interface Watched { parentId: string; title: string; startedAt: number }

/** Remembers turn ends of unwatched agents: a fast child can end before `watch` runs. */
const EARLY_END_LIMIT = 32;

export class TangentWatcher {
  readonly #watched = new Map<string, Watched>();
  readonly #earlyEnds = new Map<string, TangentOutcome>();
  readonly #settled = new Set<string>();
  /** Reports held for busy non-OMP parents, keyed by parent ID. */
  readonly #waiting = new Map<string, { childIds: string[]; reports: string[] }>();

  constructor(private readonly port: TangentPort, private readonly now: () => number = Date.now) {}

  async watch(childId: string, tangent: Watched): Promise<void> {
    if (this.#settled.has(childId) || this.#watched.has(childId)) return;
    this.#watched.set(childId, tangent);
    const early = this.#earlyEnds.get(childId);
    if (!early) return;
    this.#earlyEnds.delete(childId);
    await this.#settle(childId, early);
  }

  async turnEnded(agentId: string, outcome: TangentOutcome): Promise<void> {
    // The parent's turn just ended: send held reports now, trusting the event over a
    // status snapshot that may still read "running".
    const held = this.#waiting.get(agentId);
    if (held) {
      this.#waiting.delete(agentId);
      await this.#send(agentId, held.childIds, deliveryText("send-now", held.reports));
    }
    if (this.#watched.has(agentId)) return this.#settle(agentId, outcome);
    if (this.#settled.has(agentId)) return;
    this.#earlyEnds.delete(agentId);
    this.#earlyEnds.set(agentId, outcome);
    if (this.#earlyEnds.size > EARLY_END_LIMIT) this.#earlyEnds.delete(this.#earlyEnds.keys().next().value!);
  }

  async archived(agentId: string): Promise<void> {
    const held = this.#waiting.get(agentId);
    if (held) {
      this.#waiting.delete(agentId);
      console.warn(`side-agent: parent ${agentId} was archived; dropping ${held.childIds.length} tangent report(s).`);
      await Promise.all(held.childIds.map(id => this.port.markReported(id)));
    }
    if (this.#watched.has(agentId)) await this.#settle(agentId, { kind: "archived" });
  }

  /** Picks up tangents launched before this plugin process started. */
  async resume(): Promise<void> {
    for (const child of await this.port.pending()) {
      const parentId = child.labels[TANGENT_PARENT_LABEL];
      if (!parentId) { await this.port.markReported(child.id); continue; }
      const tangent = { parentId, title: child.title ?? "Untitled tangent", startedAt: Number(child.labels[TANGENT_STARTED_LABEL]) || this.now() };
      if (!child.archived && (child.status === "running" || child.status === "initializing")) {
        await this.watch(child.id, tangent);
        continue;
      }
      // It ended while nobody watched; the exact outcome is gone, so infer it.
      this.#watched.set(child.id, tangent);
      await this.#settle(child.id, child.archived ? { kind: "archived" }
        : child.status === "error" ? { kind: "failed", message: child.lastError ?? "unknown error" }
        : { kind: "completed" });
    }
  }

  async #settle(childId: string, outcome: TangentOutcome): Promise<void> {
    const tangent = this.#watched.get(childId);
    if (!tangent || this.#settled.has(childId)) return;
    this.#settled.add(childId);
    this.#watched.delete(childId);
    const reply = outcome.kind === "completed" ? await this.port.finalReply(childId) : "";
    const report = formatTangentReport({
      title: tangent.title, durationMs: this.now() - tangent.startedAt, outcome, reply, link: await this.port.link(childId),
    });
    const parent = await this.port.agent(tangent.parentId);
    if (!parent || parent.archived) {
      console.warn(`side-agent: parent ${tangent.parentId} is gone; dropping the report of tangent ${childId}.`);
      return this.port.markReported(childId);
    }
    const delivery = chooseDelivery(parent.provider, parent.status);
    if (delivery !== "wait-for-idle") return this.#send(parent.id, [childId], deliveryText(delivery, [report]));
    const held = this.#waiting.get(parent.id) ?? { childIds: [], reports: [] };
    held.childIds.push(childId);
    held.reports.push(report);
    this.#waiting.set(parent.id, held);
  }

  async #send(parentId: string, childIds: string[], text: string): Promise<void> {
    await this.port.send(parentId, text);
    await Promise.all(childIds.map(id => this.port.markReported(id)));
  }
}

function facts(agent: AgentSnapshotPayload): AgentFacts {
  return {
    id: agent.id, provider: agent.provider, status: agent.status, archived: Boolean(agent.archivedAt),
    title: agent.title, labels: agent.labels, lastError: agent.lastError ?? null,
  };
}

async function withDaemon<T>(work: (daemon: DaemonClient) => Promise<T>): Promise<T> {
  const daemon = await connectLocalDaemon();
  try { return await work(daemon); } finally { await daemon.close(); }
}

/** The local daemon, one short connection per call (as the launch path does). */
export const daemonPort: TangentPort = {
  agent: id => withDaemon(async daemon => {
    const result = await daemon.fetchAgent(id);
    return result ? facts(result.agent) : null;
  }),
  pending: () => withDaemon(async daemon => {
    const page = await daemon.fetchAgents({ filter: { labels: { [TANGENT_LABEL]: "pending" }, includeArchived: true } });
    return page.entries.map(entry => facts(entry.agent));
  }),
  finalReply: id => withDaemon(async daemon => {
    const page = await daemon.fetchAgentTimeline(id, { direction: "tail", limit: 200, projection: "projected" });
    return finalReply(page.entries.map(entry => entry.item));
  }),
  send: (id, text) => withDaemon(daemon => daemon.sendAgentMessage(id, text)),
  markReported: id => withDaemon(daemon => daemon.updateAgent(id, { labels: { [TANGENT_LABEL]: "reported" } })),
  link: async id => {
    const home = paseoHome();
    const { serverId } = JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")) as { serverId?: string };
    const route = `/h/${encodeURIComponent(serverId ?? "")}/agent/${encodeURIComponent(id)}`;
    const config = JSON.parse(await readFile(join(home, "config.json"), "utf8").catch(() => "{}")) as { app?: { baseUrl?: unknown } };
    const base = typeof config.app?.baseUrl === "string" ? config.app.baseUrl.replace(/\/+$/, "") : "";
    return base ? base + route : `paseo:/${route}`;
  },
};
