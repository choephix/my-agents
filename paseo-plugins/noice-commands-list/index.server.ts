import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { expandCommand } from "./shared/commands";
import { listCommands, sendCommand, slashCatalog } from "./shared/rpc";
import { DEFAULTS, settings } from "./shared/settings";
import { discoverCommands } from "./server/discover";
import { queuesFollowUps } from "./server/providers";

export default function contribute(server: PluginServerContext) {
  const preferences = server.registerSettings(settings);
  // Unreadable settings fall back to the defaults, so the list still works.
  const enabled = async () => {
    const state = await preferences.read();
    return state.status === "ready" ? state.values : DEFAULTS;
  };

  async function agentOf(agentId: string, { paseo }: PluginHandlerContext) {
    const found = await paseo.agents.ref(agentId).refresh();
    if (!found || found.agent.archivedAt) throw new Error("This chat is no longer available.");
    return found.agent;
  }

  server.handle(listCommands, async ({ agentId }, context) => {
    const agent = await agentOf(agentId, context);
    const values = await enabled();
    const [commands, queues] = await Promise.all([discoverCommands(agent.cwd, values), queuesFollowUps(agent.provider)]);
    return { commands, queues, groups: values.groups };
  });

  server.handle(slashCatalog, async ({ cwds }) => {
    const values = await enabled();
    const byName = new Map<string, { name: string; description: string; argumentHint: string }>();
    for (const cwd of new Set(cwds)) {
      for (const command of await discoverCommands(cwd, values)) {
        if (!byName.has(command.name)) byName.set(command.name, { name: command.name, description: command.description, argumentHint: command.argumentHint });
      }
    }
    return { commands: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  });

  // Always the expanded text, never `/name`: a slash command sent while busy cancels the reply.
  server.handle(sendCommand, async ({ agentId, name, args }, context) => {
    const agent = await agentOf(agentId, context);
    const command = (await discoverCommands(agent.cwd, await enabled())).find((candidate) => candidate.name === name);
    if (!command) return { sent: false, how: "none" as const };
    const text = expandCommand(command.body, args);
    if (!text) throw new Error(`${name} is empty.`);
    const ref = context.paseo.agents.ref(agentId);
    if (agent.status !== "running") {
      await ref.send(text);
      return { sent: true, how: "send" as const };
    }
    if (await queuesFollowUps(agent.provider)) {
      await ref.send(`/follow-up ${text}`);
      return { sent: true, how: "follow-up" as const };
    }
    await ref.send(text, { activeTurnBehavior: "steer" });
    return { sent: true, how: "steer" as const };
  });

  return () => {};
}
