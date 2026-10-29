import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { createSwitcher } from "./client/switcher";
import { createPresetSettings } from "./client/settings";
import { createSidebarFilter } from "./client/web";

export default function contribute(client: PluginClientContext) {
  if (Platform.OS !== "web") return () => {};
  const filter = createSidebarFilter();
  client.addSettingsScreen({ id: "presets", title: "Filter presets", icon: "ListFilter", Component: createPresetSettings(client) });
  client.addSidebarHeaderItem({ id: "presets", title: "Filter presets", Component: createSwitcher(client, filter) });
  return () => filter.remove();
}
