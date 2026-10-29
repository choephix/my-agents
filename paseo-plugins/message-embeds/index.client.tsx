import { type PluginTimelineItem, settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { Text } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import { z } from "zod";
import { AGENT_CARD_KIND, agentCardSchema, createAgentCard } from "./client/agent-card";
import { EmbedCard, embedCardSchema } from "./client/card";
import { MarkdownChunk, markdownSchema } from "./client/markdown";
import { linkIssueRefs, parseMessage } from "./client/parse";
import { installAgentTextStyles } from "./client/web";
import { DEFAULTS, preferences } from "./shared/preferences";

/** Timeline rows have no navigation; an agent card opens its chat through this screen. */
function OpenAgent({ navigation, params, theme }: PluginScreenProps) {
  const { serverId, agentId } = params;
  useEffect(() => {
    if (agentId) navigation?.openAgent({ agentId, serverId });
  }, [navigation, serverId, agentId]);
  return (
    <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>
      {navigation ? "Opening the chat…" : "This Paseo client cannot open chats from plugins."}
    </Text>
  );
}

const PLUGIN_ID = "message-embeds";
let enabled = DEFAULTS.enabled;

function setEnabled(value: boolean): void {
  enabled = value;
}

function Settings() {
  const settings = useSettings(preferences);
  useEffect(() => {
    if (settings.status === "ready") setEnabled(settings.values.enabled);
  }, [settings]);
  if (settings.status !== "ready") {
    return <SettingsSection title="File embeds"><SettingsCard><SettingsSwitch label="Enable file embeds" value={enabled} disabled onValueChange={() => {}} /></SettingsCard></SettingsSection>;
  }
  return (
    <SettingsSection title="File embeds" info="Turn Obsidian-style ![[path]] file, image and HTML previews, ![[agent link]] chat previews, and #123 GitHub links on or off in assistant messages.">
      <SettingsCard>
        <SettingsSwitch
          label="Enable file embeds"
          hint="When off, assistant messages render exactly as native Paseo."
          value={settings.values.enabled}
          disabled={settings.saving}
          onValueChange={(value) => {
            setEnabled(value);
            void settings.save({ enabled: value }, settings.revision);
          }}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

export default function contribute(client: PluginClientContext) {
  const readSettings = settingsRpc(preferences.id).read;
  const writeSettings = settingsRpc(preferences.id).write;
  let revision: string | undefined;
  let disposed = false;
  const refresh = () => {
    void client.rpc(readSettings, {}).then((result) => {
      if (disposed || result.status !== "ready") return;
      revision = result.revision;
      setEnabled(z.object({ enabled: z.boolean() }).parse(result.values).enabled);
    }).catch(() => {});
  };
  refresh();

  const settings = client.addSettingsScreen({ id: "settings", title: "File embeds", icon: "FileCode2", Component: Settings });
  const command = client.addCommandCenterItem({
    id: "toggle-file-embeds",
    title: "Toggle file embeds",
    keywords: ["chat embeds", "agent cards"],
    icon: "FileCode2",
    context: "global",
    async onSelect({ rpc }) {
      const current = await rpc(readSettings, {});
      if (current.status !== "ready") return;
      const next = !z.object({ enabled: z.boolean() }).parse(current.values).enabled;
      const saved = await rpc(writeSettings, { revision: current.revision, values: { enabled: next } });
      if (saved.status === "saved") {
        revision = saved.revision;
        setEnabled(next);
      }
    },
  });
  const events = client.paseo.observeEvents(["status.plugin_settings_changed"]);
  events.subscribe({
    snapshot: refresh,
    update(message) {
      if (message.type === "status" && message.payload.status === "plugin_settings_changed" && message.payload.pluginId === PLUGIN_ID && message.payload.settingsId === preferences.id) refresh();
    },
  });

  const openAgent = client.addScreen({ id: "open-agent", title: "Opening chat", Component: OpenAgent });
  const agentTextStyles = installAgentTextStyles();
  const markdown = client.addTimelineRenderer({ kind: "message-embeds-markdown", version: 1, schema: markdownSchema, Component: MarkdownChunk });
  const card = client.addTimelineRenderer({ kind: "message-embeds-card", version: 1, schema: embedCardSchema, Component: EmbedCard });
  const agentCard = client.addTimelineRenderer({
    kind: AGENT_CARD_KIND,
    version: 1,
    schema: agentCardSchema,
    Component: createAgentCard(({ serverId, agentId }) => client.openScreen({ screenId: "open-agent", params: { serverId, agentId } })),
  });
  const transformer = client.addTimelineTransformer({
    id: "message-embeds",
    query: { itemType: "assistant_message" },
    transform({ item, phase }) {
      if (!enabled) return undefined;
      // Cheap checks first; most messages have neither an embed nor a `#123`.
      const hasEmbed = item.text.includes("![[");
      const hasRef = /#\d\d/.test(item.text) && linkIssueRefs(item.text, () => "") !== item.text;
      if (!hasEmbed && !hasRef) return undefined;
      const segments = parseMessage(item.text);
      // Unchanged text (half-typed or code-only embeds, no `#123`) keeps Paseo's own rendering.
      if (!hasRef && segments.length === 1 && segments[0].kind === "markdown" && segments[0].text === item.text) return undefined;
      // No `id` on the rows: Paseo then uses `<source message id>/<index>`, unique across the chat.
      // Its chat list keys each row's measured height by id; the parser's per-message ids
      // (`markdown-0`, `embed-0`) repeated in every converted message, rows fought over one height
      // and scrolling looped until React gave up (error #185).
      return {
        items: segments.map((segment): PluginTimelineItem => {
          if (segment.kind === "agent") {
            return { type: "plugin" as const, kind: AGENT_CARD_KIND, version: 1, data: { ...segment.link, url: segment.url } };
          }
          if (segment.kind === "embed") {
            const data = {
              original: segment.embed.original,
              path: segment.embed.path,
              phase,
              ...(segment.embed.lineStart === undefined ? {} : { lineStart: segment.embed.lineStart }),
              ...(segment.embed.lineEnd === undefined ? {} : { lineEnd: segment.embed.lineEnd }),
            };
            return { type: "plugin" as const, kind: "message-embeds-card", version: 1, data };
          }
          return {
            type: "plugin" as const,
            kind: "message-embeds-markdown",
            version: 1,
            data: { text: segment.text, phase },
          };
        }),
      };
    },
  });

  return () => {
    disposed = true;
    settings();
    command();
    markdown();
    card();
    agentCard();
    openAgent();
    agentTextStyles();
    transformer();
    void events.release().catch(() => {});
    revision = undefined;
  };
}
