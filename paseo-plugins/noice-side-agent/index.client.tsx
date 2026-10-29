import { useEffect } from "react";
import { Platform, Text } from "react-native";
import type { PluginAgentCommandContext, PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { capturePane, prepareRightPane } from "./client/web";
import { createSide, createTangent, tangentRowShown } from "./shared/preferences";
import { parseTangentReports, TANGENT_REPORT_START, TANGENT_ROW_KIND } from "./shared/report";
import { ContextSettings } from "./client/settings";
import { createTangentRows, ReportRowData, TangentRowData } from "./client/tangent-row";

// Slash callbacks and timeline rows have openScreen, not navigation. A registered screen
// supplies the public host navigation on native as well as web, without private imports.
function OpenSideAgent({ navigation, params }: PluginScreenProps) {
  useEffect(() => {
    if (params.agentId) navigation?.openAgent({ agentId: params.agentId, ...(params.serverId ? { serverId: params.serverId } : {}) });
  }, [navigation, params.agentId, params.serverId]);
  return <Text>{navigation ? "Opening the agent…" : "This Paseo client needs an update to open the agent. It is available in the parent's sub-agents strip."}</Text>;
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
        catch (error) { console.warn("noice-side-agent: could not place the side agent in a right pane.", error); }
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
    console.info("noice-side-agent: //side is unavailable: Paseo rejects name /side; registering /side instead.");
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
  // A delivered report (or several, joined for a non-OMP parent) becomes one row per tangent,
  // which draws nothing while the tangent's own row (written by the server) is still in the chat.
  const followUpEcho = `/follow-up ${TANGENT_REPORT_START}`;
  const reports = client.addTimelineTransformer({
    id: "tangent-reports",
    query: { itemType: "user_message" },
    transform: ({ item }) => {
      if (item.text.startsWith(followUpEcho)) return { items: [] };
      const parsed = parseTangentReports(item.text);
      if (!parsed) return undefined;
      // Item ids are not scoped to the source message; the child id is unique per report.
      return { items: parsed.map(data => ({ type: "plugin" as const, kind: "tangent-report", version: 1, id: `report-${data.agentId}`, data })) };
    },
  });
  const rows = createTangentRows(
    (serverId, agentId) => client.openScreen({ screenId: "open", params: { serverId, agentId } }),
    async (parentId, childId) => (await client.rpc(tangentRowShown, { parentId, childId })).shown,
  );
  const reportRow = client.addTimelineRenderer({ kind: "tangent-report", version: 1, schema: ReportRowData, Component: rows.ReportMessageRow });
  const tangentRow = client.addTimelineRenderer({ kind: TANGENT_ROW_KIND, version: 1, schema: TangentRowData, Component: rows.TangentRow });
  return () => { tangentRow(); reportRow(); reports(); tangent(); slash(); settings(); screen(); };
}
