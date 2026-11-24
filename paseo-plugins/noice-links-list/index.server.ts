import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { createLinksService, type LinksService } from "./server/service";
import { TranscriptWatcher } from "./server/watcher";
import { linksForAgent, linksForWorkspace, watchAgentLinks, watchWorkspaceLinks } from "./shared/links";
import { headerSettings, webshareSettings } from "./shared/settings";

/** Fields of a Paseo agent that affect a workspace's tabs or transcript location; ignores status/activity churn. */
function agentSignature(agent: PaseoAgent): string {
  return JSON.stringify([
    agent.workspaceId ?? "",
    agent.title ?? "",
    !!agent.archivedAt,
    !!agent.internal,
    agent.persistence?.nativeHandle ?? "",
    agent.persistence?.sessionId ?? "",
  ]);
}

function addSubscriber<K, V>(map: Map<K, Set<V>>, key: K, value: V): () => void {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(value);
  return () => {
    set.delete(value);
    if (set.size === 0) map.delete(key);
  };
}

export default function contribute(server: PluginServerContext) {
  server.registerSettings(headerSettings);
  const settings = server.registerSettings(webshareSettings);
  /** The service for the current webshare settings; a change starts a new one, whose cache is empty (cached links hold mapped URLs). */
  let current: { key: string; service: LinksService } | undefined;
  const getService = async () => {
    const webshare = await settings.read();
    if (webshare.status !== "ready") throw new Error(webshare.error);
    const { origin, folder } = webshare.values;
    const key = JSON.stringify([origin, folder]);
    if (current?.key !== key) current = { key, service: createLinksService(homedir(), origin, folder) };
    return current.service;
  };

  /** Active popover subscriptions per agent id. */
  const agentSubs = new Map<string, Set<() => void>>();
  /** Active workspace links page subscriptions per workspace id. */
  const workspaceSubs = new Map<string, Set<(refreshTree: boolean) => void>>();

  const notifyAgent = (agentId: string) => {
    for (const notify of agentSubs.get(agentId) ?? []) notify();
  };
  const notifyWorkspace = (workspaceId: string, refreshTree: boolean) => {
    for (const notify of workspaceSubs.get(workspaceId) ?? []) notify(refreshTree);
  };

  // Shared daemon agent subscription active only while at least one workspace links page is open.
  // Catches renames, unarchives, and newly-created transcript handles without polling.
  let workspaceSubCount = 0;
  let agentWatchCleanup: (() => void) | null = null;
  const agentSigs = new Map<string, { workspaceId: string; sig: string }>();

  function startAgentWatch(paseo: PaseoApi): void {
    if (agentWatchCleanup) return;
    let disposed = false;
    let releaseOwned: (() => void) | null = null;
    agentWatchCleanup = () => {
      disposed = true;
      releaseOwned?.();
      releaseOwned = null;
      agentSigs.clear();
      agentWatchCleanup = null;
    };
    void paseo.agents
      .list({ subscribe: {} })
      .then(({ entries, subscription }) => {
        if (disposed) {
          void subscription.release().catch(() => undefined);
          return;
        }
        agentSigs.clear();
        for (const { agent } of entries) {
          if (agent.workspaceId) agentSigs.set(agent.id, { workspaceId: agent.workspaceId, sig: agentSignature(agent) });
        }
        const off = subscription.subscribe({
          snapshot: (page) => {
            const touched = new Set<string>();
            const next = new Map<string, { workspaceId: string; sig: string }>();
            for (const { agent } of page.entries) {
              if (!agent.workspaceId) continue;
              const sig = agentSignature(agent);
              next.set(agent.id, { workspaceId: agent.workspaceId, sig });
              const prev = agentSigs.get(agent.id);
              if (!prev || prev.sig !== sig) {
                touched.add(agent.workspaceId);
                if (prev) touched.add(prev.workspaceId);
              }
            }
            for (const [id, prev] of agentSigs) {
              if (!next.has(id)) touched.add(prev.workspaceId);
            }
            agentSigs.clear();
            for (const [id, entry] of next) agentSigs.set(id, entry);
            for (const workspaceId of touched) notifyWorkspace(workspaceId, true);
          },
          update: (message) => {
            if (message.type !== "agent_update") return;
            const { payload } = message;
            if (payload.kind === "remove") {
              const prev = agentSigs.get(payload.agentId);
              agentSigs.delete(payload.agentId);
              if (prev) notifyWorkspace(prev.workspaceId, true);
              return;
            }
            const { agent } = payload;
            const prev = agentSigs.get(agent.id);
            if (!agent.workspaceId) {
              agentSigs.delete(agent.id);
              if (prev) notifyWorkspace(prev.workspaceId, true);
              return;
            }
            const sig = agentSignature(agent);
            if (prev?.sig === sig) return;
            agentSigs.set(agent.id, { workspaceId: agent.workspaceId, sig });
            notifyWorkspace(agent.workspaceId, true);
            if (prev && prev.workspaceId !== agent.workspaceId) notifyWorkspace(prev.workspaceId, true);
          },
        });
        releaseOwned = () => {
          off();
          void subscription.release().catch(() => undefined);
        };
      })
      .catch(() => {
        // Lifecycle hooks still cover agent create/turn/archive if live subscription is unavailable.
      });
  }

  server.handle(linksForAgent, async (input, { paseo }) => (await getService()).forAgent(input, paseo));
  server.handle(linksForWorkspace, async (input, { paseo }) => (await getService()).forWorkspace(input, paseo));

  server.handle(watchAgentLinks, (input, { paseo, push, signal }) => {
    let lastJson: string | undefined;
    let chain = Promise.resolve();
    let timelineUnsub: (() => void) | null = null;
    const stopTimeline = () => {
      timelineUnsub?.();
      timelineUnsub = null;
    };
    const ensureTimeline = () => {
      if (timelineUnsub || signal.aborted) return;
      const sub = paseo.agents.ref(input.agentId).timeline.subscribe((update) => {
        if (!("event" in update) || update.event.type !== "timeline") return;
        const type = update.event.item.type;
        if (type === "user_message" || type === "assistant_message") watcher.trigger();
      });
      sub.ready.catch(() => undefined);
      timelineUnsub = () => sub();
    };

    const send = () => {
      if (signal.aborted) return;
      chain = chain
        .then(async () => {
          if (signal.aborted) return;
          const { result, targets } = await (await getService()).forAgentDetailed(input, paseo);
          if (signal.aborted) return;
          watcher.setTargets(targets);
          if (result.source === "timeline") ensureTimeline();
          else stopTimeline();
          const json = JSON.stringify(result);
          if (json === lastJson) return;
          await push(result);
          lastJson = json;
        })
        .catch((error: unknown) => {
          if (!signal.aborted) console.error(`[noice-links-list] agent push failed for ${input.agentId}`, error);
        });
    };

    const watcher = new TranscriptWatcher(send);
    const removeSub = addSubscriber(agentSubs, input.agentId, () => watcher.trigger());
    signal.addEventListener(
      "abort",
      () => {
        removeSub();
        watcher.close();
        stopTimeline();
      },
      { once: true },
    );
    send();
  });

  server.handle(watchWorkspaceLinks, (input, { paseo, push, signal }) => {
    workspaceSubCount++;
    startAgentWatch(paseo);
    let lastJson: string | undefined;
    let pendingRefreshTree = true;
    let chain = Promise.resolve();

    const send = () => {
      if (signal.aborted) return;
      chain = chain
        .then(async () => {
          if (signal.aborted) return;
          const refreshTree = pendingRefreshTree;
          pendingRefreshTree = false;
          const { result, targets } = await (await getService()).forWorkspaceDetailed(
            { workspaceId: input.workspaceId, subagents: input.subagents, poll: !refreshTree },
            paseo,
          );
          if (signal.aborted) return;
          watcher.setTargets(targets);
          const json = JSON.stringify(result);
          if (json === lastJson) return;
          await push(result);
          lastJson = json;
        })
        .catch((error: unknown) => {
          if (!signal.aborted) console.error(`[noice-links-list] workspace push failed for ${input.workspaceId}`, error);
        });
    };

    const watcher = new TranscriptWatcher(send);
    const removeSub = addSubscriber(workspaceSubs, input.workspaceId, (refreshTree) => {
      if (refreshTree) pendingRefreshTree = true;
      watcher.trigger();
    });
    signal.addEventListener(
      "abort",
      () => {
        removeSub();
        watcher.close();
        workspaceSubCount = Math.max(0, workspaceSubCount - 1);
        if (workspaceSubCount === 0) agentWatchCleanup?.();
      },
      { once: true },
    );
    send();
  });

  const cleanups = [
    settings.subscribe(() => {
      for (const agentId of agentSubs.keys()) notifyAgent(agentId);
      for (const workspaceId of workspaceSubs.keys()) notifyWorkspace(workspaceId, false);
    }),
    server.addHook("agent.create.after", async ({ agent }) => {
      if (agent.parentAgentId) notifyAgent(agent.parentAgentId);
      if (agent.workspaceId) notifyWorkspace(agent.workspaceId, true);
    }),
    server.addHook("agent.turn.after", async ({ agent }) => {
      notifyAgent(agent.id);
      if (agent.parentAgentId) notifyAgent(agent.parentAgentId);
      if (agent.workspaceId) notifyWorkspace(agent.workspaceId, false);
    }),
    server.addHook("agent.archive.after", async ({ agent }) => {
      notifyAgent(agent.id);
      if (agent.parentAgentId) notifyAgent(agent.parentAgentId);
      if (agent.workspaceId) notifyWorkspace(agent.workspaceId, true);
    }),
    () => agentWatchCleanup?.(),
  ];

  return () => {
    for (const cleanup of cleanups) void cleanup();
  };
}
