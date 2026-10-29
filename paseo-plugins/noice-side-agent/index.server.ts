import { setTimeout as sleep } from "node:timers/promises";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createSide, createTangent, preferences, tangentRowShown } from "./shared/preferences";
import { childTitle, launchChild } from "./server/launch";
import { daemonPort, TangentWatcher, TANGENT_LABEL, TANGENT_PARENT_LABEL, TANGENT_ROW_LABEL, TANGENT_STARTED_LABEL } from "./server/tangents";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  server.handle(createSide, async ({ parentId, task, mode: requestedMode }, { paseo }) => {
    const saved = await settings.read();
    if (!requestedMode && saved.status !== "ready") throw new Error("Side agent settings are invalid; restore defaults in plugin settings.");
    const mode = requestedMode ?? (saved.status === "ready" ? saved.values.defaultMode : "fork");
    const child = await launchChild(paseo, parentId, parent => ({
      mode,
      title: childTitle("Side", task || parent.title?.trim() || "Untitled chat"),
      forkPrompt: task
        ? `You are a side agent forked from Paseo chat ${parent.id}. The preceding conversation or attached chat history belongs to the parent; earlier tasks are not yours. Work only on the task below and report concisely.\n\nTask:\n${task}`
        : `You are a side agent forked from Paseo chat ${parent.id}. The attached chat history belongs to the parent. Wait for the user's instructions; reply only: Ready.`,
      fullNote: `You are a side agent forked from Paseo chat ${parent.id} (${parent.title?.trim() || "Untitled chat"}). The conversation above belongs to the parent; earlier tasks are not yours. Work only on what the user asks next.`,
      task,
      labels: { "side-agent.mode": mode },
    }));
    return { agentId: child.agentId, mode: child.mode };
  });

  // The plugin's own Paseo API, from the first handler or hook call: only it may append timeline rows.
  let api: PaseoApi | undefined;
  const use = (paseo: PaseoApi) => { api ??= paseo; };
  const port = daemonPort(() => api);
  const tangents = new TangentWatcher(port);
  const report = (what: string) => (error: unknown) => console.error(`noice-side-agent: ${what} failed.`, error);
  server.handle(createTangent, async ({ parentId, task }, { paseo }) => {
    use(paseo);
    const startedAt = Date.now();
    const child = await launchChild(paseo, parentId, parent => {
      // Full memory where it exists (OMP); Paseo's fork context everywhere else.
      const mode = parent.provider === "omp" ? "full" : "fork";
      const who = `You are the tangent subagent of Paseo chat ${parent.id} (${parent.title?.trim() || "Untitled chat"}).`;
      const handBack = "Your final reply is handed back to the parent chat as the result, so make it complete on its own.";
      return {
        mode,
        title: childTitle("Tangent", task),
        forkPrompt: `${who} The attached chat history belongs to the parent; earlier tasks are not yours. Your only job is the task below. ${handBack}\n\nTask:\n${task}`,
        fullNote: `${who} The conversation above belongs to the parent; earlier tasks are not yours. Your only job is the task in the next message. ${handBack}`,
        task,
        labels: { "side-agent.mode": mode, [TANGENT_LABEL]: "pending", [TANGENT_PARENT_LABEL]: parent.id, [TANGENT_STARTED_LABEL]: String(startedAt) },
      };
    });
    void tangents.watch(child.agentId, { parentId: child.parent.id, title: child.title, startedAt }).catch(report(`tangent report for ${child.agentId}`));
    return { agentId: child.agentId, mode: child.mode, title: child.title };
  });

  server.handle(tangentRowShown, async ({ parentId, childId }, { paseo }) => {
    use(paseo);
    const [child, epoch] = await Promise.all([port.agent(childId), port.timelineEpoch(parentId)]);
    return { shown: !!epoch && child?.labels[TANGENT_ROW_LABEL] === epoch };
  });

  const offTurn = server.on("agent.turn_ended", async ({ agent, outcome }, { paseo }) => {
    use(paseo);
    await tangents.turnEnded(agent.id, outcome.kind === "failed" ? { kind: "failed", message: outcome.error.message } : { kind: outcome.kind })
      .catch(report(`tangent report for ${agent.id}`));
  });
  const offArchive = server.on("agent.archived", async ({ agent }, { paseo }) => {
    use(paseo);
    await tangents.archived(agent.id).catch(report(`tangent archive handling for ${agent.id}`));
  });
  // After a daemon restart this process can start before the daemon accepts connections.
  let stopped = false;
  void (async () => {
    for (let attempt = 1; !stopped; attempt++) {
      try { return await tangents.resume(); }
      catch (error) {
        if (attempt === 5) return report("resuming tangents")(error);
        await sleep(3000);
      }
    }
  })();
  return () => { stopped = true; offTurn(); offArchive(); };
}
