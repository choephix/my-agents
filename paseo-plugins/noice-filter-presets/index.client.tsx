import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { contributePhone } from "./client/phone";
import { createSwitcher } from "./client/switcher";
import { createPresetSettings } from "./client/settings";
import { createSidebarFilter } from "./client/web";

export default function contribute(client: PluginClientContext) {
  // Phones can't hide sidebar projects; they get a "Presets" jump list instead. Web and desktop never register it.
  if (Platform.OS !== "web") return contributePhone(client);
  const filter = createSidebarFilter();
  client.addSettingsScreen({ id: "presets", title: "Filter presets", icon: "ListFilter", Component: createPresetSettings(client) });
  client.addSidebarHeaderItem({ id: "presets", title: "Filter presets", Component: createSwitcher(client, filter) });
  return () => filter.remove();
}
