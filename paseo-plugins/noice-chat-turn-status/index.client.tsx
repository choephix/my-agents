import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createSettingsScreen } from "./client/settings";
import { isWeb, startIndicator } from "./client/web";
import { preferences, type Preferences } from "./shared/preferences";

// Sanctioned web global for re-reading settings saved in another window.
declare const window: {
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
};

export default function contribute(client: PluginClientContext) {
  // The working indicator is restyled in the page's DOM, which the native phone app does not have.
  if (!isWeb) return () => {};

  const settings = settingsRpc(preferences.id);
  // Paseo's own footer stays untouched until the saved settings arrive.
  const indicator = startIndicator();
  let edits = 0;
  const apply = (values: Preferences) => {
    edits += 1;
    indicator.setPreferences(values);
  };
  const refresh = () => {
    const editsAtStart = edits;
    client.rpc(settings.read, {}).then((result) => {
      if (result.status !== "ready" || edits !== editsAtStart) return; // a save landed while this read was in flight
      const parsed = preferences.schema.safeParse(result.values);
      if (parsed.success) indicator.setPreferences(parsed.data);
    }, (error: unknown) => console.error("[noice-chat-turn-status] settings read failed", error));
  };
  refresh();
  window.addEventListener("focus", refresh);

  const screen = client.addSettingsScreen({
    id: "indicator",
    title: "Working indicator",
    icon: "Loader",
    Component: createSettingsScreen(apply),
  });
  const configure = client.addCommandCenterItem({
    id: "configure",
    title: "Working indicator settings",
    icon: "Loader",
    keywords: ["spinner", "loader", "working", "elapsed", "time", "activity", "indicator"],
    context: "global",
    onSelect({ openSettings }) { openSettings("indicator"); },
  });
  return () => {
    configure();
    screen();
    window.removeEventListener("focus", refresh);
    indicator.dispose();
  };
}
