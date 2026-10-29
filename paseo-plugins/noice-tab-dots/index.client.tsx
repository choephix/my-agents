import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { watchAgents } from "./client/agents";
import { createOpenTabScreen, OPEN_TAB_SCREEN } from "./client/open-tab";
import { contributePhone } from "./client/phone";
import { createSettingsScreen } from "./client/settings";
import { startTabDots } from "./client/web";
import { DEFAULTS, preferences, type Preferences } from "./shared/preferences";

// Sanctioned web global for re-reading settings saved in another window.
declare const window: {
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
};

export default function contribute(client: PluginClientContext) {
  // Phones have no DOM rows to draw into; they get one "Unread" sidebar row instead. Web and
  // desktop never register it, so they carry only the row dots.
  if (Platform.OS !== "web") {
    const stopPhone = contributePhone(client);
    const phoneSettings = client.addSettingsScreen({
      id: "dots",
      title: "Tab dots",
      icon: "Ellipsis",
      Component: createSettingsScreen(() => {}),
    });
    return () => {
      phoneSettings();
      stopPhone();
    };
  }
  const settings = settingsRpc(preferences.id);
  // A dot click opens its tab through this screen: Paseo's own navigation, no page-wide reset.
  const opener = client.addScreen({ id: OPEN_TAB_SCREEN, title: "Opening tab", Component: createOpenTabScreen() });
  // Hidden until settings load, so a disabled plugin never flashes dots.
  const dots = startTabDots({ ...DEFAULTS, enabled: false }, ({ serverId, agentId }) =>
    client.openScreen({ screenId: OPEN_TAB_SCREEN, params: { serverId, agentId, nonce: String(Date.now()) } }));
  let edits = 0;
  // What the dots show now; null until settings first load.
  let current: Preferences | null = null;
  const show = (values: Preferences) => {
    current = values;
    dots.setPreferences(values);
  };
  const load = async (): Promise<{ revision: string; values: Preferences } | undefined> => {
    const result = await client.rpc(settings.read, {});
    if (result.status !== "ready") return undefined;
    const parsed = preferences.schema.safeParse(result.values);
    return parsed.success ? { revision: result.revision, values: parsed.data } : undefined;
  };
  const apply = (values: Preferences) => {
    edits += 1;
    show(values);
  };
  const refresh = () => {
    const editsAtStart = edits;
    load().then((loaded) => {
      // A save made while this read was in flight is newer than what the read returned.
      if (loaded && edits === editsAtStart) show(loaded.values);
    }, (error: unknown) => console.error("[noice-tab-dots] settings read failed", error));
  };
  refresh();
  window.addEventListener("focus", refresh);
  const stopAgents = watchAgents(client.paseo.agents, dots.setAgents);

  /** Saves `enabled` on top of the host's latest values; one retry when another window saved first. */
  const saveEnabled = async (enabled: boolean): Promise<Preferences | undefined> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const loaded = await load();
      if (!loaded) return undefined;
      const values = { ...loaded.values, enabled };
      const saved = await client.rpc(settings.write, { revision: loaded.revision, values });
      if (saved.status === "saved") return values;
      if (saved.status !== "conflict") return undefined;
    }
    return undefined;
  };

  const screen = client.addSettingsScreen({
    id: "dots",
    title: "Tab dots",
    icon: "Ellipsis",
    Component: createSettingsScreen(apply),
  });
  const toggle = client.addCommandCenterItem({
    id: "toggle",
    title: "Toggle tab dots",
    icon: "Ellipsis",
    keywords: ["unread", "status", "dots", "sidebar", "tabs"],
    context: "global",
    async onSelect() {
      const before = current ?? (await load())?.values;
      if (!before) throw new Error("Tab dots: couldn't read the settings");
      // Show the result at once; the host save follows.
      apply({ ...before, enabled: !before.enabled });
      const saved = await saveEnabled(!before.enabled).catch(() => undefined);
      if (saved) {
        apply(saved);
        return;
      }
      apply(before);
      throw new Error(`Tab dots: couldn't save "${before.enabled ? "off" : "on"}"; nothing changed`);
    },
  });
  const configure = client.addCommandCenterItem({
    id: "configure",
    title: "Tab dots settings",
    icon: "Ellipsis",
    keywords: ["unread", "status", "dots", "sidebar", "size", "time"],
    context: "global",
    onSelect({ openSettings }) { openSettings("dots"); },
  });
  return () => {
    configure();
    toggle();
    screen();
    stopAgents();
    window.removeEventListener("focus", refresh);
    dots.dispose();
    opener();
  };
}
