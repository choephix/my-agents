import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inboxClear, inboxList, inboxMarkRead, inboxWatch } from "./shared/inbox";
import { clip, finalReply } from "./server/reply";
import { InboxStore } from "./server/store";

/**
 * A bot hub (noice-bots) runs no model: its turn ends the moment a message becomes a thread, and the
 * thread notifies on its own. The label marks the hub, also while it is being deleted.
 */
const isBotHub = (labels: Readonly<Record<string, string>>) => "noice-bots.role" in labels;

/**
 * The agent as Paseo has it now. The hook's copy carries the title the agent was created with, which
 * is empty for nearly every agent: Paseo names it later, from its first message or a rename.
 */
async function liveAgent(paseo: PaseoApi, agentId: string): Promise<PaseoAgent | null> {
  try {
    return (await paseo.agents.ref(agentId).refresh())?.agent ?? null;
  } catch (error) {
    console.error(`[noice-inbox] couldn't read agent ${agentId}`, error);
    return null;
  }
}

/** Drops entries of agents that are gone (archived or deleted while the plugin wasn't running), and of bot hubs. */
async function dropGoneAgents(store: InboxStore, paseo: PaseoApi): Promise<void> {
  const known = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      filter: { includeBackground: true },
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const { agent } of page.entries) if (!isBotHub(agent.labels)) known.add(agent.id);
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  await store.retainAgents((agentId) => known.has(agentId));
}

export default function contribute(server: PluginServerContext) {
  const home = resolve((process.env.PASEO_HOME ?? join(homedir(), ".paseo")).replace(/^~(?=\/|$)/, homedir()));
  const store = new InboxStore(join(home, "plugin-data", "inbox", "entries.json"));
  let pruned: Promise<void> | null = null;

  // Sub-agents are skipped: Paseo doesn't notify for them either; they report to their parent.
  const offTurn = server.addHook("agent.turn.after", async ({ agent, outcome }, { paseo }) => {
    if (agent.parentAgentId || outcome.kind === "canceled") return;
    const live = await liveAgent(paseo, agent.id);
    // An archived agent can't be opened: Paseo would show its workspace instead (a bot thread asleep).
    if (live && (isBotHub(live.labels) || live.archivedAt)) return;
    const preview =
      outcome.kind === "failed"
        ? outcome.error.message
        : await finalReply(paseo, agent.id).catch((error: unknown) => {
            console.error(`[noice-inbox] couldn't read the reply of ${agent.id}`, error);
            return "";
          });
    await store.put({
      agentId: agent.id,
      kind: outcome.kind === "failed" ? "error" : "finished",
      title: live?.title ?? agent.title ?? "",
      preview: clip(preview),
      at: Date.now(),
      read: false,
    });
  });
  const offPermReq = server.addHook("agent.permission.before", async ({ agent, request }, { paseo }) => {
    if (agent.parentAgentId) return;
    const live = await liveAgent(paseo, agent.id);
    if (live && isBotHub(live.labels)) return;
    const what = [request.title || request.name, request.description].filter(Boolean).join(": ");
    await store.put({ agentId: agent.id, kind: "permission", title: live?.title ?? agent.title ?? "", preview: clip(what), at: Date.now(), read: false });
  });
  const offPermRes = server.addHook("agent.permission.after", async ({ agent }) => {
    await store.markRead([{ agentId: agent.id, kind: "permission" }]);
  });
  const offArchive = server.addHook("agent.archive.after", async ({ agent }) => {
    await store.retainAgents((agentId) => agentId !== agent.id);
  });

  const ensurePruned = (paseo: PaseoApi) => {
    pruned ??= dropGoneAgents(store, paseo).catch((error: unknown) => {
      console.error("[noice-inbox] couldn't list agents to drop gone ones", error);
      pruned = null;
    });
    return pruned;
  };

  server.handle(inboxWatch, (_input, { paseo, push, signal }) => {
    let chain = Promise.resolve();
    const send = () => {
      if (signal.aborted) return;
      chain = chain
        .then(async () => {
          await ensurePruned(paseo);
          if (signal.aborted) return;
          await push({ entries: await store.list() });
        })
        .catch((error: unknown) => {
          if (!signal.aborted) console.error("[noice-inbox] couldn't push the list", error);
        });
    };
    const unsubscribe = store.onChange(send);
    signal.addEventListener("abort", unsubscribe, { once: true });
    send();
  });

  server.handle(inboxList, async (_input, { paseo }) => {
    await ensurePruned(paseo);
    return { entries: await store.list() };
  });
  server.handle(inboxMarkRead, async ({ items }) => {
    await store.markRead(items);
    return { entries: await store.list() };
  });
  server.handle(inboxClear, async ({ items }) => {
    await store.clear(items);
    return { entries: await store.list() };
  });
  return () => {
    offTurn();
    offPermReq();
    offPermRes();
    offArchive();
  };
}
