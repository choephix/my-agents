import type { PluginServerContext } from "@getpaseo/plugin/server";
import { describeAgents, sleepAgentNow, sleepApi, wakeAgent } from "./server/sleep";
import { configureRpc, overviewRpc, pillsRpc, sleepRpc, wakeRpc } from "./shared/rpc";

const UNSUPPORTED = "This Paseo server can't sleep agents.";

export default function contribute(server: PluginServerContext) {
  server.handle(pillsRpc, async (_input, { paseo }) => {
    const api = sleepApi(paseo);
    if (!api) return { supported: false, asleep: [] };
    const state = await api.sleepState();
    const agents = await describeAgents(paseo, new Set(state.asleep.map((entry) => entry.agentId)), ["closed"]);
    return {
      supported: true,
      asleep: state.asleep.flatMap(({ agentId, sleep }) => {
        const workspaceId = agents.get(agentId)?.workspaceId;
        return workspaceId ? [{ agentId, workspaceId, sleptAt: sleep?.sleptAt ?? null }] : [];
      }),
    };
  });

  server.handle(overviewRpc, async (_input, { paseo }) => {
    const api = sleepApi(paseo);
    if (!api) return { supported: false, providers: [], asleep: 0, measured: 0, freedBytes: 0, keptAwake: [] };
    const state = await api.sleepState();
    const titles = await describeAgents(paseo, new Set(state.keptAwake.map((entry) => entry.agentId)));
    let measured = 0;
    let freedBytes = 0;
    for (const { sleep } of state.asleep) {
      if (sleep?.rssBytes == null) continue;
      measured += 1;
      freedBytes += sleep.rssBytes;
    }
    return {
      supported: true,
      providers: state.providers,
      asleep: state.asleep.length,
      measured,
      freedBytes,
      keptAwake: state.keptAwake.map(({ agentId, reason }) => ({
        agentId,
        reason,
        title: titles.get(agentId)?.title ?? "Untitled chat",
      })),
    };
  });

  server.handle(wakeRpc, ({ agentId }, { paseo }) => wakeAgent(paseo, agentId));

  server.handle(sleepRpc, async ({ agentId, provider }, { paseo }) => {
    const api = sleepApi(paseo);
    if (!api) return { refused: UNSUPPORTED };
    const { providers } = await api.sleepState();
    if (!providers.some((entry) => entry.provider === provider)) return { refused: "Only OMP chats can sleep." };
    return { refused: await sleepAgentNow(paseo, agentId) };
  });

  server.handle(configureRpc, async ({ enabled, idleMinutes }, { paseo }) => {
    const api = sleepApi(paseo);
    if (!api) throw new Error(UNSUPPORTED);
    const { providers } = await api.sleepState();
    if (providers.length === 0) throw new Error("No OMP provider is set up on this Paseo server.");
    // Each provider entry is merged key by key on the daemon; `sleep` is replaced as a whole.
    await paseo.config.patch({
      providers: Object.fromEntries(providers.map(({ provider }) => [provider, { sleep: { enabled, idleMinutes } }])),
    });
    return { providers: (await api.sleepState()).providers };
  });

  return () => {};
}
