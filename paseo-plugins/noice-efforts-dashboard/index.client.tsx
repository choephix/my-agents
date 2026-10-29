import type { PluginClientContext } from "@getpaseo/plugin/client";
import { startButtons } from "./client/buttons";
import { EffortsSidebarItem, GlobalScreen } from "./client/global-screen";
import { EffortsPanel } from "./client/panel";
import { PANEL_ID, SCREEN_ID, setClient } from "./client/runtime";
import { SettingsScreen } from "./client/settings-screen";
import { startFocusModality } from "./client/web";

export default function contribute(client: PluginClientContext) {
  setClient(client);
  const cleanups = [
    startFocusModality(),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Efforts",
      icon: "Map",
      context: "workspace",
      locations: ["explorer", "workspace"],
      Component: EffortsPanel,
    }),
    client.addScreen({ id: SCREEN_ID, title: "Efforts", Component: GlobalScreen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Efforts", Component: EffortsSidebarItem }),
    client.addCommandCenterItem({
      id: "open-panel",
      title: "Efforts for this workspace",
      icon: "Map",
      keywords: ["effort", "tickets", "map", "wayfinder", "scratch"],
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(PANEL_ID, { location: "explorer" });
      },
    }),
    client.addCommandCenterItem({
      id: "all-efforts",
      title: "All efforts",
      icon: "LayoutGrid",
      keywords: ["effort", "tickets", "wayfinder", "scratch"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: SCREEN_ID, params: {} });
      },
    }),
    client.addSettingsScreen({ id: "folders", title: "Efforts", icon: "Map", Component: SettingsScreen }),
    startButtons(client),
  ];
  return () => {
    for (const cleanup of cleanups) void cleanup();
    setClient(null);
  };
}
