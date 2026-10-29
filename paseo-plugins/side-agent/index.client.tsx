import { useEffect } from "react";
import { Platform, Text } from "react-native";
import type { PluginAgentCommandContext, PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { capturePane, prepareRightPane } from "./client/web";
import { createSide, createTangent, TANGENT_REPORT_START } from "./shared/preferences";
import { ContextSettings } from "./client/settings";

// Slash callbacks have openScreen, not navigation. A registered screen supplies
// the public host navigation on native as well as web, without private imports.
function OpenSideAgent({ navigation, params }: PluginScreenProps) {
  useEffect(() => {
    if (params.agentId) navigation?.openAgent({ agentId: params.agentId });
  }, [navigation, params.agentId]);
  return <Text>{navigation ? "Opening side agent…" : "This Paseo client needs an update to open the side agent. It is available in the parent's sub-agents strip."}</Text>;
}

export default function contribute(client: PluginClientContext) {
  const screen = client.addScreen({ id: "open", title: "Side agent", Component: OpenSideAgent });
  const settings = client.addSettingsScreen({ id: "context", title: "Side agent", icon: "SlidersHorizontal", Component: ContextSettings });
  const command = {
    name: "/side",
    description: "Side agent with parent context · --fork / --full",
    argumentHint: "[--fork|--full] [task]",
    context: "agent" as const,
    async onSubmit({ args, agent, rpc, openScreen }: PluginAgentCommandContext & { args: string }) {
      const input = args.trim();
      const flag = input.match(/^--(fork|full)(?:\s+|$)/);
      const mode = flag ? (flag[1] === "fork" ? "fork" : "full") : undefined;
      const task = flag ? input.slice(flag[0].length).trim() : input;
      const sourcePane = Platform.OS === "web" ? capturePane(agent.id) : null;
      const child = await rpc(createSide, { parentId: agent.id, task, mode });
      if (Platform.OS === "web") {
        // Placement is best effort; public navigation still opens the child.
        try { await prepareRightPane(sourcePane); }
        catch (error) { console.warn("side-agent: could not place the side agent in a right pane.", error); }
      }
      openScreen({ screenId: "open", params: { agentId: child.agentId } });
    },
  };
  let slash: () => void;
  try {
    slash = client.addSlashCommand(command);
  } catch (error) {
    // Paseo 0.11/0.12 validates names as /^[a-z][a-z0-9-]*$/.
    if (!(error instanceof Error) || !error.message.includes("Invalid client slash command name")) {
      screen();
      settings();
      throw error;
    }
    console.info("side-agent: //side is unavailable: Paseo rejects name /side; registering /side instead.");
    slash = client.addSlashCommand({ ...command, name: "side" });
  }
  // Stays in the background: no pane, no navigation. The child shows in the sub-agents strip.
  const tangent = client.addSlashCommand({
    name: "tangent",
    description: "Background subagent with this chat's memory; its final reply comes back here",
    argumentHint: "<task>",
    context: "agent",
    async onSubmit({ args, agent, rpc }) {
      const task = args.trim();
      if (!task) throw new Error("/tangent needs a task: /tangent <task>");
      await rpc(createTangent, { parentId: agent.id, task });
    },
  });
  // Paseo echoes the `/follow-up <report>` send the moment it is queued, mid-reply. OMP records
  // the report again when it actually delivers it after the reply; show only that one.
  const followUpEcho = `/follow-up ${TANGENT_REPORT_START}`;
  const hideEcho = client.addTimelineTransformer({
    id: "tangent-follow-up-echo",
    query: { itemType: "user_message" },
    transform: ({ item }) => (item.text.startsWith(followUpEcho) ? { items: [] } : undefined),
  });
  return () => { hideEcho(); tangent(); slash(); settings(); screen(); };
}
