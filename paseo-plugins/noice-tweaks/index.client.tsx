import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createSettingsScreen } from "./client/settings";
import { startTweaks } from "./client/web";
import { preferences, type Preferences } from "./shared/preferences";

const PLUGIN_ID = "noice-tweaks";

export default function contribute(client: PluginClientContext) {
  const tweaks = startTweaks();
  const settings = settingsRpc(preferences.id);
  let edits = 0;
  const apply = (values: Preferences) => {
    edits += 1;
    tweaks.apply(values);
  };
  const refresh = () => {
    const editsAtStart = edits;
    client.rpc(settings.read, {}).then((result) => {
      if (result.status !== "ready" || edits !== editsAtStart) return; // a save landed while this read was in flight
      const parsed = preferences.schema.safeParse(result.values);
      if (parsed.success) tweaks.apply(parsed.data);
    }, (error: unknown) => console.error("[noice-tweaks] settings read failed", error));
  };
  // The daemon announces every settings save (other windows follow); `snapshot` fires on (re)connect.
  const events = client.paseo.observeEvents(["status.plugin_settings_changed"]);
  events.subscribe({
    snapshot: refresh,
    update(message) {
      if (message.type === "status" && message.payload.status === "plugin_settings_changed"
        && message.payload.pluginId === PLUGIN_ID && message.payload.settingsId === preferences.id) refresh();
    },
  });

  const screen = client.addSettingsScreen({
    id: "tweaks",
    title: "Tweaks",
    icon: "SlidersHorizontal",
    Component: createSettingsScreen(apply),
  });
  const command = client.addCommandCenterItem({
    id: "configure",
    title: "Configure tweaks",
    icon: "SlidersHorizontal",
    keywords: ["tweaks", "compact", "sidebar", "wrap", "file", "link", "colours", "colors"],
    context: "global",
    onSelect({ openSettings }) { openSettings("tweaks"); },
  });
  return () => {
    void events.release().catch(() => {});
    command();
    screen();
    tweaks.dispose();
  };
}
