import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { connectLocalDaemon, paseoHome } from "./daemon";
import { formatTangentReport, linkIds, parseTangentReports, TANGENT_ROW_KIND, type TangentOutcome, type TangentRow } from "../shared/report";
import { chooseDelivery, deliveryText, explicitReply, finalReply, type ExplicitReport } from "./tangent-report";

/** Child labels; they are the durable record, so a plugin reload can resume watching. */
export const TANGENT_LABEL = "side-agent.tangent";
export const TANGENT_PARENT_LABEL = "side-agent.tangent-parent";
export const TANGENT_STARTED_LABEL = "side-agent.tangent-started";
/**
 * The parent timeline epoch holding the tangent's row ("none": no row). Appended rows live in the
 * daemon's memory: a daemon restart (or a parent reload) starts a new epoch without them.
 */
export const TANGENT_ROW_LABEL = "side-agent.tangent-row";
/** Your words, for the row's bubble after a plugin reload. */
export const TANGENT_TASK_LABEL = "side-agent.tangent-task";

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
  /** Writes the tangent's row (in place while the parent's timeline holds it); its epoch, or undefined before the plugin's Paseo API is known. */
  writeRow(parentId: string, childId: string, row: TangentRow): Promise<string | undefined>;
  timelineEpoch(parentId: string): Promise<string | undefined>;
  markRow(childId: string, epoch: string): Promise<void>;
  /** Calls `onStep` with each tool call the child starts; returns the unsubscribe. */
  follow(childId: string, onStep: (step: string) => void): () => void;
}

/** `note`: its latest `tangent_progress`; it replaces the tool-call peek. `task`: unset for tangents from before the task label. */
interface Watched { parentId: string; title: string; task?: string; startedAt: number; note?: string }

/** Remembers turn ends of unwatched agents (a fast child can end before `watch` runs) and recent settles. */
const RECENT_LIMIT = 32;
/** Row data is capped at 64 KiB, and the label travels with every agent snapshot. */
const TASK_LIMIT = 20_000;

/** The task as the row and the task label keep it. */
export function rowTask(task: string): string {
  return task.length > TASK_LIMIT ? `${task.slice(0, TASK_LIMIT)}…` : task;
}

/** `write`: a new tangent's running row; `follow`: keep updating the row its parent still shows (at that epoch); `none`: no running row. */
type RowStart = "write" | { follow: string } | "none";

export class TangentWatcher {
  readonly #watched = new Map<string, Watched>();
  readonly #earlyEnds = new Map<string, TangentOutcome>();
  /** Guards a resume racing a fresh tangent; insertion-ordered, so the oldest goes first. */
  readonly #settled = new Set<string>();
  /** Running rows being kept current: `update` redraws, `stop` ends the timeline subscription. */
  readonly #rows = new Map<string, { update(): void; stop(): void }>();
  /** The parent timeline epoch holding each watched tangent's row; a pending write resolves to it. */
  readonly #rowEpochs = new Map<string, Promise<string | undefined>>();
  /** `report_to_parent` calls, the last one per tangent; memory only, so a plugin reload falls back to the final reply. */
  readonly #reports = new Map<string, ExplicitReport>();
  /** Reports held for busy non-OMP parents, keyed by parent ID. */
  readonly #waiting = new Map<string, { childIds: string[]; reports: string[] }>();

  constructor(private readonly port: TangentPort, private readonly now: () => number = Date.now) {}

  async watch(childId: string, tangent: Watched, row: RowStart = "write"): Promise<void> {
    if (this.#settled.has(childId) || this.#watched.has(childId)) return;
    this.#watched.set(childId, tangent);
    const early = this.#earlyEnds.get(childId);
    if (early) {
      this.#earlyEnds.delete(childId);
      return this.#settle(childId, early);
    }
    if (row !== "none") await this.#startRow(childId, tangent, row);
  }

  async #startRow(childId: string, tangent: Watched, row: "write" | { follow: string }): Promise<void> {
    const ids = linkIds(await this.port.link(childId));
    // Settled meanwhile: a running row now would never be ended.
    if (!ids || !this.#watched.has(childId)) return;
    let step = "";
    const show = () => this.port.writeRow(tangent.parentId, childId, {
      status: "running", title: tangent.title, ...(tangent.task ? { task: tangent.task } : {}), startedAt: tangent.startedAt, step: tangent.note || step, ...ids,
    });
    if (row === "write") {
      const written = show();
      this.#rowEpochs.set(childId, written.catch(() => undefined));
      const epoch = await written;
      if (!epoch || !this.#watched.has(childId)) return;
      await this.port.markRow(childId, epoch);
    } else {
      this.#rowEpochs.set(childId, Promise.resolve(row.follow));
    }
    if (!this.#watched.has(childId)) return;
    const update = () => {
      if (this.#watched.has(childId)) show().catch(error => console.error(`noice-side-agent: tangent ${childId} row update failed.`, error));
    };
    const stop = this.port.follow(childId, next => {
      step = next;
      if (!tangent.note) update();
    });
    this.#rows.set(childId, { update, stop });
  }

  /** A `report_to_parent` call: kept until the turn ends. False once the tangent has reported. */
  async report(childId: string, report: ExplicitReport): Promise<boolean> {
    if ((await this.port.agent(childId))?.labels[TANGENT_LABEL] !== "pending") return false;
    this.#reports.set(childId, report);
    return true;
  }

  /** A `tangent_progress` note: the running row shows it from now on. False once the tangent has settled. */
  progress(childId: string, note: string): boolean {
    const tangent = this.#watched.get(childId);
    if (!tangent) return false;
    tangent.note = note.replace(/\s+/g, " ").trim();
    this.#rows.get(childId)?.update();
    return true;
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
    if (this.#earlyEnds.size > RECENT_LIMIT) this.#earlyEnds.delete(this.#earlyEnds.keys().next().value!);
  }

  async archived(agentId: string): Promise<void> {
    const held = this.#waiting.get(agentId);
    if (held) {
      this.#waiting.delete(agentId);
      console.warn(`noice-side-agent: parent ${agentId} was archived; dropping ${held.childIds.length} tangent report(s).`);
      await Promise.all(held.childIds.map(id => this.port.markReported(id)));
    }
    if (this.#watched.has(agentId)) await this.#settle(agentId, { kind: "archived" });
  }

  /** Picks up tangents launched before this plugin process started. */
  async resume(): Promise<void> {
    for (const child of await this.port.pending()) {
      const parentId = child.labels[TANGENT_PARENT_LABEL];
      if (!parentId) { await this.port.markReported(child.id); continue; }
      const task = child.labels[TANGENT_TASK_LABEL];
      const tangent = { parentId, title: child.title ?? "Untitled tangent", ...(task ? { task } : {}), startedAt: Number(child.labels[TANGENT_STARTED_LABEL]) || this.now() };
      if (!child.archived && (child.status === "running" || child.status === "initializing")) {
        // The running row survives a plugin reload, not a daemon restart (new epoch).
        const epoch = child.labels[TANGENT_ROW_LABEL];
        const shown = !!epoch && epoch === await this.port.timelineEpoch(parentId).catch(() => undefined);
        await this.watch(child.id, tangent, shown ? { follow: epoch } : "none");
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
    if (this.#settled.size > RECENT_LIMIT) this.#settled.delete(this.#settled.values().next().value!);
    this.#watched.delete(childId);
    this.#rows.get(childId)?.stop();
    this.#rows.delete(childId);
    const rowEpoch = await this.#rowEpochs.get(childId);
    this.#rowEpochs.delete(childId);
    const explicit = this.#reports.get(childId);
    this.#reports.delete(childId);
    const parts = outcome.kind === "completed" && explicit ? explicitReply(explicit) : undefined;
    const reply = parts ? `${parts.summary}\n\n${parts.body}` : outcome.kind === "completed" ? await this.port.finalReply(childId) : "";
    const report = formatTangentReport({
      title: tangent.title, durationMs: this.now() - tangent.startedAt, outcome, reply, link: await this.port.link(childId),
    });
    const parent = await this.port.agent(tangent.parentId);
    if (!parent || parent.archived) {
      console.warn(`noice-side-agent: parent ${tangent.parentId} is gone; dropping the report of tangent ${childId}.`);
      return this.port.markReported(childId);
    }
    // The row where /tangent was sent shows how it ended, while the parent's timeline still holds
    // it (a timeline without it would get it at the end). The answer draws from the report message.
    const row = parseTangentReports(report)?.[0];
    if (row && rowEpoch && rowEpoch === await this.port.timelineEpoch(parent.id).catch(() => undefined)) {
      const { status, title, took, agentId, serverId } = row;
      await this.port.writeRow(parent.id, childId, { status, title, ...(tangent.task ? { task: tangent.task } : {}), took, agentId, serverId })
        .catch(error => console.error(`noice-side-agent: tangent ${childId} row update failed.`, error));
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

/** A tool call as the running row's peek: `bash · sleep 120`. */
function describeStep({ name, detail }: Extract<AgentTimelineItem, { type: "tool_call" }>): string {
  const fields = detail as Record<string, unknown>;
  const what = ["description", "command", "query", "filePath", "url"].map(key => fields[key]).find((value): value is string => typeof value === "string" && value.trim() !== "");
  return what ? `${name} · ${what.trim().split("\n")[0].slice(0, 200)}` : name;
}

/**
 * The local daemon, one short connection per call (as the launch path does). Timeline rows go
 * through the plugin's own Paseo API (`paseo()`, known after the first handler or hook call):
 * the daemon accepts appends only from plugin sessions.
 */
export const daemonPort = (paseo: () => PaseoApi | undefined): TangentPort => ({
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
  send: async (id, text) => { await withDaemon(daemon => daemon.sendAgentMessage(id, text)); },
  markReported: id => withDaemon(daemon => daemon.updateAgent(id, { labels: { [TANGENT_LABEL]: "reported" } })),
  link: async id => {
    const home = paseoHome();
    const { serverId } = JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")) as { serverId?: string };
    const route = `/h/${encodeURIComponent(serverId ?? "")}/agent/${encodeURIComponent(id)}`;
    const config = JSON.parse(await readFile(join(home, "config.json"), "utf8").catch(() => "{}")) as { app?: { baseUrl?: unknown } };
    const base = typeof config.app?.baseUrl === "string" ? config.app.baseUrl.replace(/\/+$/, "") : "";
    return base ? base + route : `paseo:/${route}`;
  },
  writeRow: async (parentId, childId, row) => {
    const api = paseo();
    if (!api) return undefined;
    // The same id updates the row where it already is; a timeline without it gets it at the end.
    const item = { type: "plugin" as const, id: `tangent-${childId}`, kind: TANGENT_ROW_KIND, version: 1, data: row };
    return (await api.agents.ref(parentId).timeline.append(item)).epoch;
  },
  timelineEpoch: async parentId => {
    const api = paseo();
    return api ? (await api.agents.ref(parentId).timeline.refetch({ direction: "tail", limit: 1 })).epoch : undefined;
  },
  markRow: (id, epoch) => withDaemon(daemon => daemon.updateAgent(id, { labels: { [TANGENT_ROW_LABEL]: epoch } })),
  follow: (childId, onStep) => {
    const api = paseo();
    if (!api) return () => {};
    let last = "";
    const subscription = api.agents.ref(childId).timeline.subscribe(update => {
      if (!("event" in update) || update.event.type !== "timeline") return;
      const item = update.event.item;
      // A `tangent_progress` call draws its note, not itself.
      if (item.type !== "tool_call" || item.status !== "running" || item.callId === last || item.name.endsWith("tangent_progress")) return;
      last = item.callId;
      onStep(describeStep(item));
    });
    subscription.ready.catch(error => console.error(`noice-side-agent: following tangent ${childId} failed.`, error));
    return () => subscription();
  },
});
