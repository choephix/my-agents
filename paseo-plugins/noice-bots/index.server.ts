import { defineAgentTool, type PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { createBot, deleteBot, getBot, getThread, listDay, markAllRead, openedThread, searchThreads, settings, THREAD_LABEL, updateBot, wakeThread } from "./shared/contracts";
import { Bots } from "./server/bots";
import { closeDaemon } from "./server/daemon";
import { hubProvider } from "./server/hub";
import { sessionsDir } from "./server/store";

export default function contribute(server: PluginServerContext) {
  const saved = server.registerSettings(settings);
  const bots = new Bots(async () => {
    const state = await saved.read();
    return state.status === "ready" ? state.values : { maxRunning: 4, readOnlyDays: 7, botsFolder: "~/bots" };
  });
  const loaded = bots.load().catch(error => console.error("noice-bots: loading failed", error));
  const offSettings = saved.subscribe(() => bots.settingsChanged());
  server.registerProvider(hubProvider(bots));

  server.handle(createBot, async input => { await loaded; return { hubAgentId: (await bots.createBot(input)).hubAgentId }; });
  server.handle(updateBot, async ({ id, ...input }) => { await bots.updateBot(id, input); return {}; });
  server.handle(getBot, async ({ id }) => {
    const bot = bots.store.bot(id);
    return bot ? { ...bot, threads: await bots.threadCount(id) } : null;
  });
  server.handle(deleteBot, async ({ id }) => { await loaded; await bots.deleteBot(id); return {}; });
  server.handle(getThread, async ({ id, markRead }) => {
    const found = await bots.read(id);
    const bot = found && bots.store.bot(found.thread.botId);
    if (!found || !bot) return null;
    if (markRead) await bots.markRead(found.thread);
    return { ...found, bot: { name: bot.name, emoji: bot.emoji } };
  });
  server.handle(wakeThread, async ({ id }) => { await bots.wake(id); return {}; });
  server.handle(openedThread, async ({ id }) => { await bots.opened(id); return {}; });
  server.handle(listDay, ({ botId, day }) => bots.store.day(botId, day));
  server.handle(searchThreads, ({ botId, query }) => bots.search(botId, query));
  server.handle(markAllRead, async ({ botId }) => { await bots.markAllRead(botId); return {}; });

  const offStart = server.on("agent.turn_started", ({ agent }) => bots.turnStarted(agent.id, agent.workspaceId));
  const offEnd = server.on("agent.turn_ended", ({ agent, outcome }) =>
    bots.turnEnded(agent.id, agent.workspaceId, outcome.kind === "completed" ? "done" : outcome.kind === "failed" ? "failed" : "stopped"));
  const offArchived = server.on("agent.archived", ({ agent }) => bots.archived(agent.id));

  // The one session-open hook, for bot threads only: the progress tool, and session files kept in
  // the plugin's folder (OMP's PI_CODING_AGENT_SESSION_DIR) so session lists and searches skip them.
  const threadProgress = defineAgentTool({
    name: "thread_progress",
    description: "Show a few words on what you are doing in the bot hub, under this thread, until the next note.",
    input: z.object({ note: z.string().min(1).describe("A few words, one line") }),
    execute: ({ note }, { agent }) => (bots.progress(agent.id, note) ? { text: "Shown." } : { isError: true, text: "This thread is not running." }),
  });
  const offTools = server.before("agent.session_open", ({ request }) => {
    if (!request.labels[THREAD_LABEL]) return;
    return { ...request, env: { ...request.env, PI_CODING_AGENT_SESSION_DIR: sessionsDir() }, tools: [...request.tools, threadProgress] };
  });

  return async () => {
    offStart();
    offEnd();
    offArchived();
    offTools();
    offSettings();
    bots.dispose();
    await closeDaemon();
  };
}
