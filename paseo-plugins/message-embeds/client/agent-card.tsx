import type { PaseoApi } from "@getpaseo/client";
import { getPaseoClient, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, Markdown } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { z } from "zod";
import type { AgentLink } from "./agent-link";
import { pressedLink } from "./web";

export const AGENT_CARD_KIND = "message-embeds-agent";

/** `url` is the plain link shown when the chat can't be previewed. */
export const agentCardSchema = z.object({ serverId: z.string(), agentId: z.string(), url: z.string() });

type Message = { role: "user" | "assistant"; text: string };
type State = "working" | "permission" | "error" | "idle";
interface Preview {
  title: string;
  state: State;
  at: string | null;
  messages: Message[];
}

/** Messages shown; the window scrolls, so more would only cost fetch and render time. */
const MESSAGES = 3;
/** Long replies keep their end, which is where the question usually is. */
const MAX_CHARS = 3000;
const BODY_HEIGHT = 240;

/** Last previews by `serverId/agentId`, so a card that scrolls back into view doesn't flash. */
const cache = new Map<string, Preview>();

const isMessage = (type: string): type is "user_message" | "assistant_message" =>
  type === "user_message" || type === "assistant_message";

function tail(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const start = text.length - MAX_CHARS;
  const paragraph = text.indexOf("\n\n", start);
  return `…\n\n${text.slice(paragraph >= 0 && paragraph < start + 1000 ? paragraph + 2 : start)}`;
}

/**
 * A one-time snapshot: the newest user and assistant messages of a chat. Tool calls fill most of
 * a busy timeline, so a short tail page is widened twice at most. Null when the chat is archived.
 * Throws when the host is offline or the agent is unknown.
 */
async function loadPreview(paseo: PaseoApi, agentId: string): Promise<Preview | null> {
  const timeline = paseo.agents.ref(agentId).timeline;
  let page = await timeline.refetch({ direction: "tail", limit: 20 });
  const agent = page.agent;
  if (!agent || agent.archivedAt) return null;
  let entries = page.entries;
  for (let more = 0; more < 2 && entries.filter(e => isMessage(e.item.type)).length < 2; more++) {
    if (!page.hasOlder || !page.startCursor) break;
    page = await timeline.refetch({ direction: "before", cursor: page.startCursor, limit: 40 });
    entries = [...page.entries, ...entries];
  }
  const messages: Message[] = [];
  let at: string | null = null;
  for (const entry of entries) {
    const item = entry.item;
    if (item.type !== "user_message" && item.type !== "assistant_message") continue;
    messages.push({ role: item.type === "user_message" ? "user" : "assistant", text: tail(item.text) });
    at = entry.timestamp;
  }
  const state: State = agent.pendingPermissions.length ? "permission"
    : agent.status === "running" ? "working"
    : agent.status === "error" ? "error"
    : "idle";
  return { title: agent.title ?? "Chat", state, at, messages: messages.slice(-MESSAGES) };
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!(minutes >= 1)) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** The card for one embedded chat. `open` switches to its tab. */
export function createAgentCard(open: (link: AgentLink) => void) {
  return function AgentCard({ item, theme }: PluginTimelineItemProps<z.output<typeof agentCardSchema>>) {
    const { serverId, agentId, url } = item.data;
    const key = `${serverId}/${agentId}`;
    const [preview, setPreview] = useState<Preview | null | undefined>(() => cache.get(key));
    const scroll = useRef<ScrollView>(null);
    const [hovered, setHovered] = useState(false);

    useEffect(() => {
      let live = true;
      let paseo: PaseoApi;
      try {
        paseo = getPaseoClient(serverId);
      } catch {
        setPreview(null);
        return;
      }
      loadPreview(paseo, agentId).then(
        next => {
          if (next) cache.set(key, next);
          else cache.delete(key);
          if (live) setPreview(next);
        },
        () => { if (live) setPreview(null); },
      );
      return () => { live = false; };
    }, [serverId, agentId, key]);

    // Unknown, archived or unreachable chat: a plain link.
    if (preview === null) return <Markdown>{url}</Markdown>;

    const c = theme.colors;
    const status = preview && {
      working: { label: "Working", color: c.accent },
      permission: { label: "Needs permission", color: c.statusWarning },
      error: { label: "Error", color: c.statusDanger },
      idle: { label: ago(preview.at), color: c.foregroundMuted },
    }[preview.state];

    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open the chat ${preview?.title ?? ""}`}
        onPress={event => { if (!pressedLink(event.nativeEvent)) open({ serverId, agentId }); }}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={{
          borderWidth: 1,
          borderColor: hovered ? c.foregroundMuted : c.border,
          borderRadius: 8,
          backgroundColor: c.surface1,
          marginVertical: 6,
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <Icon name="MessageSquare" size={14} color={c.foregroundMuted} />
          <Text numberOfLines={1} style={{ flexShrink: 1, color: c.foreground, fontSize: 13, fontWeight: "600" }}>
            {preview?.title ?? "Loading chat…"}
          </Text>
          {status ? <Text numberOfLines={1} style={{ color: status.color, fontSize: 12 }}>{status.label}</Text> : null}
          <View style={{ flex: 1 }} />
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Open</Text>
          <Icon name="ArrowUpRight" size={13} color={c.foregroundMuted} />
        </View>
        {preview ? (
          <ScrollView
            ref={scroll}
            style={{ maxHeight: BODY_HEIGHT }}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 10 }}
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          >
            {preview.messages.length ? preview.messages.map((message, index) =>
              message.role === "user" ? (
                <View key={index} style={{ borderLeftWidth: 2, borderLeftColor: c.border, paddingLeft: 8 }}>
                  <Text style={{ color: c.foregroundMuted, fontSize: 11, marginBottom: 2 }}>You</Text>
                  <Text numberOfLines={6} style={{ color: c.foregroundMuted, fontSize: 13 }}>{message.text}</Text>
                </View>
              ) : (
                <Markdown key={index}>{message.text}</Markdown>
              ),
            ) : <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>No messages yet.</Text>}
          </ScrollView>
        ) : null}
      </Pressable>
    );
  };
}
