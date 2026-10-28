import { type PluginTimelineItem, settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { useEffect } from "react";
import { Text } from "react-native";
import { type AgentLink, splitPreviewLines } from "./client/links";
import { createPreviewCard, MARKDOWN_KIND, MarkdownChunk, markdownSchema, PREVIEW_KIND, previewSchema } from "./client/preview";
import { createSettingsScreen } from "./client/settings";
import { interceptAgentLinks } from "./client/web";
import { previewsOf, settings } from "./shared/settings";

const PLUGIN_ID = "agent-links";

/** DOM listeners and timeline rows have no navigation; this screen opens the tab through the host's. */
function OpenLink({ navigation, params, theme }: PluginScreenProps) {
  const { serverId, agentId } = params;
  useEffect(() => {
    if (agentId) navigation?.openAgent({ agentId, serverId });
  }, [navigation, serverId, agentId]);
  return (
    <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>
      {navigation ? "Opening the tab…" : "This Paseo client cannot open tabs from plugins."}
    </Text>
  );
}

export default function contribute(client: PluginClientContext) {
  const open = ({ serverId, agentId }: AgentLink) => client.openScreen({ screenId: "open", params: { serverId, agentId } });

  // Previews: the transformer exists only while the setting is on, so with it off chats are untouched.
  let removeTransformer: (() => void) | null = null;
  const applyPreviews = (on: boolean) => {
    if (on && !removeTransformer) {
      removeTransformer = client.addTimelineTransformer({
        id: "agent-link-previews",
        query: { itemType: "assistant_message" },
        transform({ item, phase }) {
          // A streaming reply renders as Paseo draws it; the preview appears once it completes.
          if (phase !== "complete" || !item.text.includes("app.paseo.sh/h/")) return undefined;
          const segments = splitPreviewLines(item.text);
          if (!segments) return undefined;
          return {
            items: segments.map((segment, index): PluginTimelineItem =>
              segment.kind === "preview"
                ? { type: "plugin", id: `preview-${index}`, kind: PREVIEW_KIND, version: 1, data: { ...segment.link, line: segment.line } }
                : { type: "plugin", id: `markdown-${index}`, kind: MARKDOWN_KIND, version: 1, data: { text: segment.text } },
            ),
          };
        },
      });
    } else if (!on && removeTransformer) {
      removeTransformer();
      removeTransformer = null;
    }
  };

  let disposed = false;
  const readSettings = settingsRpc(settings.id).read;
  const refresh = () => {
    void client.rpc(readSettings, {}).then(result => {
      if (!disposed && result.status === "ready") applyPreviews(previewsOf(result.values));
    }).catch(() => {});
  };
  refresh();
  const events = client.paseo.observeEvents(["status.plugin_settings_changed"]);
  events.subscribe({
    snapshot: refresh,
    update(message) {
      if (message.type === "status" && message.payload.status === "plugin_settings_changed"
        && message.payload.pluginId === PLUGIN_ID && message.payload.settingsId === settings.id) refresh();
    },
  });

  const cleanups = [
    client.addScreen({ id: "open", title: "Opening tab", Component: OpenLink }),
    client.addSettingsScreen({ id: "settings", title: "Agent links", icon: "Link", Component: createSettingsScreen(applyPreviews) }),
    client.addTimelineRenderer({ kind: MARKDOWN_KIND, version: 1, schema: markdownSchema, Component: MarkdownChunk }),
    client.addTimelineRenderer({ kind: PREVIEW_KIND, version: 1, schema: previewSchema, Component: createPreviewCard(open) }),
    interceptAgentLinks(open),
  ];
  return () => {
    disposed = true;
    applyPreviews(false);
    cleanups.forEach(cleanup => cleanup());
    void events.release().catch(() => {});
  };
}
