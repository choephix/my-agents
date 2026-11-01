import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useTabState, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, Markdown, ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { getThread, wakeThread, type RpcThread } from "../shared/contracts";

/**
 * Panels open without parameters, and an agent panel needs a live agent (a sleeping thread is
 * archived). So the 🌙 tab is a workspace panel: the thread to show is handed over here just
 * before it opens, and the tab keeps it in its own saved state.
 */
const handoff = new Map<string, string>();
const handoffListeners = new Set<() => void>();
export function showThread(workspaceId: string, threadId: string): void {
  handoff.set(workspaceId, threadId);
  for (const listener of handoffListeners) listener();
}
const useHandoff = (workspaceId: string) => useSyncExternalStore(listener => { handoffListeners.add(listener); return () => { handoffListeners.delete(listener); }; }, () => handoff.get(workspaceId));

export function SavedCopy({ messages, theme }: { messages: RpcThread["messages"]; theme: PluginTheme }) {
  const { colors } = theme;
  return <>
    {messages.map((message, index) => message.role === "user"
      ? <View key={index} style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: colors.surface2, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 }}>
          <Text selectable style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>{message.text}</Text>
        </View>
      : <View key={index} style={{ paddingHorizontal: 8 }}><Markdown>{message.text}</Markdown></View>)}
  </>;
}

/** 🌙 A sleeping thread's saved copy: reading it loads nothing. Wake opens the real chat. */
export function ReadPanel({ workspaceId, tab, theme, layout, navigation, revision }: PluginWorkspacePanelProps) {
  const { colors } = theme;
  const load = useRpc(getThread);
  const wake = useRpc(wakeThread);
  const [saved, setSaved] = useTabState(tab, z.object({ threadId: z.string() }), { threadId: "" });
  const handed = useHandoff(workspaceId);
  useEffect(() => {
    if (!handed) return;
    handoff.delete(workspaceId);
    if (handed !== saved.threadId) setSaved({ threadId: handed });
  }, [handed]);
  const threadId = handed ?? saved.threadId;
  const [data, setData] = useState<RpcThread | null | "loading">("loading");
  const [waking, setWaking] = useState<"idle" | "waking" | string>("idle");
  // `revision` grows each time the tab is opened again: a follow-up may have changed the copy.
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    setData("loading");
    setWaking("idle");
    load({ id: threadId, markRead: true }).then(next => { if (live) setData(next); }, () => { if (live) setData(null); });
    return () => { live = false; };
  }, [threadId, revision]);
  if (data === "loading") return <View style={{ flex: 1, backgroundColor: colors.surface0, justifyContent: "center" }}><ActivityIndicator color={colors.foregroundMuted} /></View>;
  if (!data) return <View style={{ flex: 1, backgroundColor: colors.surface0, padding: 24 }}><Text style={{ color: colors.foregroundMuted }}>This thread's saved copy is gone.</Text></View>;
  const pad = layout.compact ? 12 : 24;
  const onWake = async () => {
    setWaking("waking");
    try {
      await wake({ id: threadId });
      navigation?.openAgent({ agentId: threadId });
      setWaking("idle");
    } catch (error) {
      setWaking(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <ScrollView contentContainerStyle={{ padding: pad, gap: 14, maxWidth: 820, width: "100%", alignSelf: "center" }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8 }}>
          {data.bot.emoji} {data.bot.name} · {data.thread.readOnly ? "read-only" : "asleep"} · saved copy: your messages and the answers
        </Text>
        <SavedCopy messages={data.messages} theme={theme} />
      </ScrollView>
      <View style={{ paddingHorizontal: pad, paddingTop: 8, paddingBottom: pad, gap: 6, maxWidth: 820, width: "100%", alignSelf: "center" }}>
        {data.thread.readOnly ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, textAlign: "center" }}>Read-only: this thread's agent was removed after a few days; the saved copy stays.</Text>
        ) : waking === "waking" ? (
          <View style={{ flexDirection: "row", gap: 10, justifyContent: "center", alignItems: "center", padding: 12 }}>
            <ActivityIndicator color={colors.foregroundMuted} />
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>Restoring thread…</Text>
            <Text style={{ color: colors.foregroundMuted }}>Un-archiving its saved session, a few seconds.</Text>
          </View>
        ) : <>
          <Pressable accessibilityRole="button" onPress={onWake}
            style={{ flexDirection: "row", gap: 8, justifyContent: "center", alignItems: "center", paddingVertical: 11, borderRadius: 10, backgroundColor: colors.accent }}>
            <Icon name="Sunrise" size={16} color={colors.accentForeground} />
            <Text style={{ color: colors.accentForeground, fontWeight: "600", fontSize: 14 }}>Wake this thread</Text>
          </Pressable>
          <Text style={{ color: waking === "idle" ? colors.foregroundMuted : colors.statusDanger, fontSize: 12, textAlign: "center" }}>
            {waking === "idle" ? "Opens it as a regular chat, with the message box and tool calls. A few seconds." : waking}
          </Text>
        </>}
      </View>
    </View>
  );
}
