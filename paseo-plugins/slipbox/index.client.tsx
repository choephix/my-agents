import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SlipboxSettingsScreen } from "./client/settings";
import { slipAttachmentSource } from "./shared/attachments";

export default function contribute(client: PluginClientContext) {
  const removeSource = client.addAttachmentSource(slipAttachmentSource);
  const removeSettings = client.addSettingsScreen({
    id: "settings",
    title: "Slip-box",
    icon: "StickyNote",
    Component: SlipboxSettingsScreen,
  });
  return () => {
    removeSource();
    removeSettings();
  };
}
