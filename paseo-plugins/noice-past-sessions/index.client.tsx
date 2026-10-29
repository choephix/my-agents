import type {
  PluginClientContext,
  PluginSidebarItemProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { startHeaderButtons } from "./client/header-buttons";
import { PastSessionsList } from "./client/past-sessions-list";
import { lastScreenParams, PastSessionsScreen } from "./client/screen";
import { createSettingsScreen } from "./client/settings-screen";
import { startFocusModality } from "./client/web";
import { starAndArchive, type Scope } from "./shared/rpc";
import { viewSettings } from "./shared/view";

const SCREEN_ID = "browse";
const PANEL_ID = "past-sessions";

function SidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="History"
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID, params: { ...lastScreenParams } })}
    />
  );
}

function WorkspacePanel({ workspaceId, theme, layout, host, navigation }: PluginWorkspacePanelProps) {
  const [scope, setScope] = useState<Scope>("workspace");
  return (
    <PastSessionsList
      workspaceId={workspaceId}
      scope={scope}
      onScopeChange={setScope}
      theme={theme}
      serverId={host.id}
      compact={layout.compact}
      navigation={navigation}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const headerButtons = startHeaderButtons(client, PANEL_ID);
  const cleanups = [
    startFocusModality(),
    client.addScreen({ id: SCREEN_ID, title: "Past sessions", Component: PastSessionsScreen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Past sessions", Component: SidebarItem }),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Past sessions",
      icon: "History",
      context: "workspace",
      locations: ["workspace", "explorer"],
      Component: WorkspacePanel,
    }),
    client.addCommandCenterItem({
      id: "open-panel",
      title: "Past sessions for this workspace",
      icon: "History",
      keywords: ["archived", "closed", "history", "reopen", "import", "omp"],
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(PANEL_ID);
      },
    }),
    client.addCommandCenterItem({
      id: "star-and-close",
      title: "Star and close this chat",
      icon: "Star",
      keywords: ["star", "save", "later", "bookmark", "archive", "close", "park"],
      context: "agent",
      // Archiving stops the agent and closes its tab, as closing the tab does; the star sorts it
      // first in Past sessions.
      async onSelect({ rpc, agent }) {
        await rpc(starAndArchive, { agentId: agent.id });
      },
    }),
    client.addSettingsScreen({
      id: viewSettings.id,
      title: "Past sessions",
      icon: "History",
      Component: createSettingsScreen(headerButtons.setVisible),
    }),
    headerButtons.stop,
  ];
  return () => {
    for (const cleanup of cleanups) void cleanup();
  };
}
