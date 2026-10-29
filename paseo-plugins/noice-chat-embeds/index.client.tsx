import { type PluginTimelineItem, settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { Platform, Text } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import { AGENT_CARD_KIND, agentCardSchema, createAgentCard } from "./client/agent-card";
import { EmbedCard, embedCardSchema, SvgBlockCard, svgBlockSchema } from "./client/card";
import { MarkdownChunk, markdownSchema } from "./client/markdown";
import { linkIssueRefs, parseMessage, SVG_FENCE } from "./client/parse";
import { type FeatureSwitch, featureSwitch } from "./client/feature-switch";
import { startLinkClicks } from "./client/link-clicks";
import { installAgentTextStyles } from "./client/web";
import { DEFAULTS, type Preferences, preferences } from "./shared/preferences";

/** Timeline rows and page clicks have no navigation; agent cards and links open their chat through this screen. */
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

const PLUGIN_ID = "noice-chat-embeds";
let current: Preferences = DEFAULTS;
/** Off until the saved settings arrive, so a switched-off feature never registers anything. */
let linkClicks: FeatureSwitch | null = null;

function apply(values: Preferences): void {
  current = values;
  linkClicks?.set(values.openLinksInPlace);
}

function Settings() {
  const settings = useSettings(preferences);
  useEffect(() => {
    if (settings.status === "ready") apply(settings.values);
  }, [settings]);
  if (settings.status !== "ready") {
    return <SettingsSection title="File embeds"><SettingsCard><SettingsSwitch label="Enable file embeds" value={current.enabled} disabled onValueChange={() => {}} /></SettingsCard></SettingsSection>;
  }
  return (
    <SettingsSection title="File embeds" info="Turn Obsidian-style ![[path]] file, image and HTML previews, ![[agent link]] chat previews, and #123 GitHub links on or off in assistant messages, and choose where Paseo tab links open.">
      <SettingsCard>
        <SettingsSwitch
          label="Enable file embeds"
          hint="When off, assistant messages render exactly as native Paseo."
          value={settings.values.enabled}
          disabled={settings.saving}
          onValueChange={(value) => {
            const next = { ...settings.values, enabled: value };
            apply(next);
            void settings.save(next, settings.revision);
          }}
        />
        <SettingsSwitch
          label="Render SVG code blocks"
          hint="Draws complete ```svg code blocks as pictures, with a Code toggle for the source. Needs file embeds on."
          value={settings.values.svgBlocks}
          disabled={settings.saving}
          onValueChange={(value) => {
            const next = { ...settings.values, svgBlocks: value };
            apply(next);
            void settings.save(next, settings.revision);
          }}
        />
        <SettingsSwitch
          label="Open Paseo tab links in place"
          hint="A plain click on an app.paseo.sh link to a chat tab switches to that tab here instead of opening the browser. Desktop and web app; independent of file embeds."
          value={settings.values.openLinksInPlace}
          disabled={settings.saving}
          onValueChange={(value) => {
            const next = { ...settings.values, openLinksInPlace: value };
            apply(next);
            void settings.save(next, settings.revision);
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
  linkClicks = featureSwitch("Open Paseo tab links in place", () =>
    startLinkClicks(({ serverId, agentId }) => client.openScreen({ screenId: "open-agent", params: { serverId, agentId } })),
  );
  const refresh = () => {
    void client.rpc(readSettings, {}).then((result) => {
      if (disposed || result.status !== "ready") return;
      revision = result.revision;
      apply(preferences.schema.parse(result.values));
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
      const read = await rpc(readSettings, {});
      if (read.status !== "ready") return;
      const values = preferences.schema.parse(read.values);
      const next = { ...values, enabled: !values.enabled };
      const saved = await rpc(writeSettings, { revision: read.revision, values: next });
      if (saved.status === "saved") {
        revision = saved.revision;
        apply(next);
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
  const svgCard = client.addTimelineRenderer({ kind: "message-embeds-svg", version: 1, schema: svgBlockSchema, Component: SvgBlockCard });
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
      if (!current.enabled) return undefined;
      // Only finished replies, and not on phones: while streaming, a ```svg block stays code.
      const svg = current.svgBlocks && phase === "complete" && Platform.OS === "web";
      // Cheap checks first; most messages have no embed, `#123` or ```svg block.
      const hasEmbed = item.text.includes("![[");
      const hasRef = /#\d\d/.test(item.text) && linkIssueRefs(item.text, () => "") !== item.text;
      const hasSvg = svg && SVG_FENCE.test(item.text);
      if (!hasEmbed && !hasRef && !hasSvg) return undefined;
      const segments = parseMessage(item.text, { svg });
      // Unchanged text (half-typed or code-only embeds, unclosed ```svg, no `#123`) keeps Paseo's own rendering.
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
          if (segment.kind === "svg") {
            return { type: "plugin" as const, kind: "message-embeds-svg", version: 1, data: { source: segment.source } };
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
    linkClicks?.set(false);
    linkClicks = null;
    settings();
    command();
    markdown();
    card();
    svgCard();
    agentCard();
    openAgent();
    agentTextStyles();
    transformer();
    void events.release().catch(() => {});
    revision = undefined;
  };
}
