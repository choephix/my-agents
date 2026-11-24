import type { PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import path from "node:path";
import { BindingStore } from "./server/bindings";
import { EffortsService } from "./server/efforts";
import { EffortsWatcher } from "./server/watcher";
import { projectEffortsRpc } from "./shared/new-workspace";
import { bindRpc, detailRpc, detailWatch, overviewRpc, overviewWatch, readRpc, searchRpc } from "./shared/rpc";
import { folderSettings } from "./shared/settings";

/** Fields of a Paseo workspace that affect `WorkspaceInfo`; status/diffStat updates are ignored. */
function workspaceSignature(workspace: PaseoWorkspace): string {
  return JSON.stringify([
    workspace.title ?? "",
    workspace.name,
    workspace.projectDisplayName,
    workspace.workspaceDirectory ?? workspace.projectRootPath,
    workspace.archivingAt ?? "",
    workspace.internal ?? false,
  ]);
}

export default function contribute(server: PluginServerContext) {
  const dataDir = path.join(process.env.PASEO_HOME ?? path.join(homedir(), ".paseo"), "plugin-data", "efforts-dashboard");
  const settings = server.registerSettings(folderSettings);
  const watcher = new EffortsWatcher();
  const service = new EffortsService(new BindingStore(path.join(dataDir, "bindings.json")), settings, (roots) => watcher.setRoots(roots));

  // Shared daemon workspace subscription active only while at least one overview subscriber is open.
  // Catches workspace renames (which have no lifecycle hook) while ignoring status/diffStat churn.
  let overviewSubs = 0;
  let workspaceSubCleanup: (() => void) | null = null;
  const workspaceSigs = new Map<string, string>();

  function startWorkspaceWatch(paseo: PaseoApi): void {
    if (workspaceSubCleanup) return;
    let disposed = false;
    let releaseOwned: (() => void) | null = null;
    workspaceSubCleanup = () => {
      disposed = true;
      releaseOwned?.();
      releaseOwned = null;
      workspaceSigs.clear();
      workspaceSubCleanup = null;
    };
    void paseo.workspaces
      .list({ subscribe: {} })
      .then(({ entries, subscription }) => {
        if (disposed) {
          void subscription.release().catch(() => undefined);
          return;
        }
        workspaceSigs.clear();
        for (const workspace of entries) workspaceSigs.set(workspace.id, workspaceSignature(workspace));
        const off = subscription.subscribe({
          snapshot: (page) => {
            let changed = page.entries.length !== workspaceSigs.size;
            const next = new Map<string, string>();
            for (const workspace of page.entries) {
              const sig = workspaceSignature(workspace);
              next.set(workspace.id, sig);
              if (workspaceSigs.get(workspace.id) !== sig) changed = true;
            }
            workspaceSigs.clear();
            for (const [id, sig] of next) workspaceSigs.set(id, sig);
            if (changed) watcher.scheduleOverview();
          },
          update: (message) => {
            if (message.type !== "workspace_update") return;
            const { payload } = message;
            if (payload.kind === "remove") {
              if (workspaceSigs.delete(payload.id)) watcher.scheduleOverview();
              return;
            }
            const sig = workspaceSignature(payload.workspace);
            if (workspaceSigs.get(payload.workspace.id) === sig) return;
            workspaceSigs.set(payload.workspace.id, sig);
            watcher.scheduleOverview();
          },
        });
        releaseOwned = () => {
          off();
          void subscription.release().catch(() => undefined);
        };
      })
      .catch(() => {
        // Lifecycle hooks still cover workspace create/archive if live subscription is unavailable.
      });
  }

  server.handle(overviewRpc, (input, context) => service.overview(input, context));
  server.handle(detailRpc, (input) => service.detail(input));
  server.handle(readRpc, (input) => service.read(input));
  server.handle(searchRpc, (input, context) => service.search(input, context));
  server.handle(bindRpc, async (input) => {
    const result = await service.bind(input);
    watcher.notifyOverview();
    return result;
  });
  server.handle(projectEffortsRpc, (input, context) => service.projectEfforts(input, context));

  server.handle(overviewWatch, (_input, { paseo, push, signal }) => {
    overviewSubs++;
    startWorkspaceWatch(paseo);
    let lastEtag: string | undefined;
    let chain = Promise.resolve();
    const send = () => {
      if (signal.aborted) return;
      chain = chain
        .then(async () => {
          if (signal.aborted) return;
          const result = await service.overview({ since: lastEtag }, { paseo });
          if (signal.aborted || "unchanged" in result) return;
          await push(result);
          lastEtag = result.etag;
        })
        .catch((error: unknown) => {
          if (!signal.aborted) console.error("[noice-efforts-dashboard] overview push failed", error);
        });
    };
    const unsubscribe = watcher.onOverview(send);
    signal.addEventListener(
      "abort",
      () => {
        unsubscribe();
        overviewSubs = Math.max(0, overviewSubs - 1);
        if (overviewSubs === 0) workspaceSubCleanup?.();
      },
      { once: true },
    );
    send();
  });

  server.handle(detailWatch, ({ root, slug }, { push, signal }) => {
    let lastEtag: string | undefined;
    let chain = Promise.resolve();
    const send = () => {
      if (signal.aborted) return;
      chain = chain
        .then(async () => {
          if (signal.aborted) return;
          let result;
          try {
            result = await service.detail({ root, slug, since: lastEtag });
          } catch {
            // Effort folder may not exist yet (e.g., New effort chat is still charting map.md).
            return;
          }
          if (signal.aborted || "unchanged" in result) return;
          await push(result);
          lastEtag = result.etag;
        })
        .catch((error: unknown) => {
          if (!signal.aborted) console.error("[noice-efforts-dashboard] detail push failed", error);
        });
    };
    const unsubscribe = watcher.onDetail(root, slug, send);
    signal.addEventListener("abort", unsubscribe, { once: true });
    send();
  });

  const cleanups = [
    settings.subscribe(() => {
      watcher.notifyOverview();
    }),
    server.addHook("workspace.create.after", async ({ workspace }) => {
      const applied = await service.applyInitialBinding(workspace.id, workspace.metadata);
      if (applied) watcher.notifyOverview();
      else watcher.scheduleOverview();
    }),
    server.addHook("workspace.archive.after", async () => {
      watcher.scheduleOverview();
    }),
    server.addHook("agent.turn.after", async ({ agent }) => {
      if (agent.parentAgentId || !agent.workspaceId) return;
      service.invalidateAgents();
      if (!(await service.hasBinding(agent.workspaceId))) watcher.scheduleOverview();
    }),
    () => workspaceSubCleanup?.(),
    () => watcher.close(),
  ];

  return () => {
    for (const cleanup of cleanups) void cleanup();
  };
}
