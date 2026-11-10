import { setTimeout as sleep } from "node:timers/promises";
import type { PaseoApi } from "@getpaseo/client";
import { defineAgentTool, type PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { createSide, createTangent, preferences } from "./shared/preferences";
import { childTitle, launchChild } from "./server/launch";
import { daemonPort, rowTask, TangentWatcher, TANGENT_LABEL, TANGENT_PARENT_LABEL, TANGENT_STARTED_LABEL, TANGENT_TASK_LABEL } from "./server/tangents";

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
    const shownTask = rowTask(task);
    const child = await launchChild(paseo, parentId, parent => {
      // Full memory where it exists (OMP); Paseo's fork context everywhere else.
      const mode = parent.provider === "omp" ? "full" : "fork";
      const who = `You are the tangent subagent of Paseo chat ${parent.id} (${parent.title?.trim() || "Untitled chat"}).`;
      const handBack = "When you are done, call report_to_parent once: a one-line summary, the full answer in Markdown (complete on its own), and the files you created or changed. That is what the parent chat receives. While you work, tangent_progress with a few words on what you are doing shows in the parent chat. Without the report_to_parent tool, your final reply is handed back instead.";
      return {
        mode,
        title: childTitle("Tangent", task),
        forkPrompt: `${who} The attached chat history belongs to the parent; earlier tasks are not yours. Your only job is the task below. ${handBack}\n\nTask:\n${task}`,
        fullNote: `${who} The conversation above belongs to the parent; earlier tasks are not yours. Your only job is the task in the next message. ${handBack}`,
        task,
        labels: { "side-agent.mode": mode, [TANGENT_LABEL]: "pending", [TANGENT_PARENT_LABEL]: parent.id, [TANGENT_STARTED_LABEL]: String(startedAt), [TANGENT_TASK_LABEL]: shownTask },
      };
    });
    void tangents.watch(child.agentId, { parentId: child.parent.id, title: child.title, task: shownTask, startedAt }).catch(report(`tangent report for ${child.agentId}`));
    return { agentId: child.agentId, mode: child.mode, title: child.title };
  });

  // Only tangents get these, from launch until they have reported.
  const reportToParent = defineAgentTool({
    name: "report_to_parent",
    description: "Hand your result to the parent chat. Call once, at the end; a later call replaces the earlier one. The parent receives it when your turn ends.",
    input: z.object({
      summary: z.string().min(1).describe("One line: the outcome"),
      result: z.string().min(1).describe("The full answer in Markdown, complete on its own"),
      files: z.array(z.string()).optional().describe("Absolute paths of files you created or changed"),
    }),
    async execute({ summary, result, files }, { agent, paseo }) {
      use(paseo);
      return await tangents.report(agent.id, { summary, result, files: files ?? [] })
        ? { text: "Saved. The parent receives it when this turn ends: stop now with a one-line reply." }
        : { isError: true, text: "This tangent has already reported; nothing was sent." };
    },
  });
  const tangentProgress = defineAgentTool({
    name: "tangent_progress",
    description: "Show a few words on what you are doing in the parent chat's tangent row, until the next note.",
    input: z.object({ note: z.string().min(1).describe("A few words, one line") }),
    async execute({ note }, { agent, paseo }) {
      use(paseo);
      return tangents.progress(agent.id, note) ? { text: "Shown." } : { isError: true, text: "This tangent has already reported." };
    },
  });
  server.before("agent.session_open", ({ request }) => {
    if (request.labels[TANGENT_LABEL] !== "pending") return;
    return { ...request, tools: [...request.tools, reportToParent, tangentProgress] };
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
