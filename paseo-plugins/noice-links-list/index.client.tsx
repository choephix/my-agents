import type { PluginClientContext } from "@getpaseo/plugin/client";
import { followAgents } from "./client/agents";
import { PANEL_ID, startWorkspaceLinks } from "./client/header";
import { startPills } from "./client/pills";

export default function contribute(client: PluginClientContext) {
  const pills = startPills(client);
  const workspaces = startWorkspaceLinks(client, pills);
  const cleanups = [
    client.addWorkspacePanel({ id: PANEL_ID, title: "Links", icon: "Link", context: "workspace", locations: ["workspace"], Component: workspaces.Page }),
    client.addSettingsScreen({ id: "header", title: "Mentioned links", icon: "Link", Component: workspaces.SettingsScreen }),
    followAgents(client, [pills.agents, workspaces.agents]),
    pills.stop,
    workspaces.stop,
  ];
  return () => {
    for (const cleanup of cleanups) void cleanup();
  };
}
