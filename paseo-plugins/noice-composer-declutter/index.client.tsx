import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createSettingsScreen } from "./client/settings";
import { startDecluttering } from "./client/web";
import { preferences } from "./shared/preferences";

export default function contribute(client: PluginClientContext) {
  const declutter = startDecluttering(async () => {
    const result = await client.rpc(settingsRpc(preferences.id).read, {});
    if (result.status !== "ready") return undefined;
    const parsed = preferences.schema.safeParse(result.values);
    return parsed.success ? parsed.data : undefined;
  });
  const screen = client.addSettingsScreen({
    id: "controls",
    title: "Composer controls",
    icon: "SlidersHorizontal",
    Component: createSettingsScreen(declutter.apply),
  });
  const command = client.addCommandCenterItem({
    id: "configure",
    title: "Configure composer controls",
    icon: "SlidersHorizontal",
    keywords: ["hide", "prompt", "thinking", "access", "mode", "fast", "dictation", "microphone", "voice"],
    context: "global",
    onSelect({ openSettings }) { openSettings("controls"); },
  });
  return () => {
    command();
    screen();
    declutter.dispose();
  };
}
