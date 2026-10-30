import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { startAgentMessageStyling } from "./client/agent-messages";
import { rememberOutput, startCommandStyling } from "./client/commands";
import { createSettingsScreen } from "./client/settings";
import { createSkillStore } from "./client/skills";
import { startPolishing } from "./client/web";
import { DEFAULTS, preferences, type Preferences } from "./shared/preferences";

const PLUGIN_ID = "noice-chat-message-polish";

export default function contribute(client: PluginClientContext) {
  let disposed = false;
  const refresh = () => {
    client.rpc(settingsRpc(preferences.id).read, {}).then((result) => {
      if (disposed) return;
      const parsed = result.status === "ready" ? preferences.schema.safeParse(result.values) : null;
      // Unreadable settings: polish with the defaults rather than not at all.
      apply(parsed?.success ? parsed.data : DEFAULTS);
    }, () => { /* Host unreachable: keep what is drawn. */ });
  };
  // Window focus re-reads the settings in case a save announcement was missed.
  const skills = createSkillStore(client);
  const polisher = startPolishing(refresh, skills);
  const commands = startCommandStyling();
  const agents = startAgentMessageStyling();
  const apply = (values: Preferences) => {
    polisher.apply(values);
    commands.setEnabled(values.commands);
    agents.setEnabled(values.agentMessages);
  };
  const screen = client.addSettingsScreen({ id: "polish", title: "My messages", icon: "MessageSquareText", Component: createSettingsScreen(apply) });
  if (Platform.OS !== "web") return screen;

  // Read-only: OMP's own command output arrives without a message id; its original text
  // (line breaks intact) feeds the code block. The item itself is never changed.
  const transformer = client.addTimelineTransformer({
    id: "command-output",
    query: { itemType: "assistant_message" },
    transform({ item }) {
      if (!item.messageId) rememberOutput(item.text);
      return undefined;
    },
  });

  // The daemon announces every settings save; `snapshot` also fires on (re)connect.
  refresh();
  const events = client.paseo.observeEvents(["status.plugin_settings_changed"]);
  events.subscribe({
    snapshot: refresh,
    update(message) {
      if (message.type === "status" && message.payload.status === "plugin_settings_changed"
        && message.payload.pluginId === PLUGIN_ID && message.payload.settingsId === preferences.id) refresh();
    },
  });
  return () => {
    disposed = true;
    void events.release().catch(() => {});
    screen();
    void transformer();
    polisher.dispose();
    skills.dispose();
    commands.dispose();
    agents.dispose();
  };
}
