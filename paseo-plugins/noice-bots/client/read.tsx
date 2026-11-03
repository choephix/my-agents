import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Markdown, Modal, ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal as RNModal, Pressable, Text, View } from "react-native";
import { getThread, type RpcThread } from "../shared/contracts";
import { humanError } from "./errors";

function SavedCopy({ messages, theme }: { messages: RpcThread["messages"]; theme: PluginTheme }) {
  const { colors } = theme;
  return <>
    {messages.map((message, index) => message.role === "user"
      ? <View key={index} style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: colors.surface2, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 }}>
          <Text selectable style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>{message.text}</Text>
        </View>
      : <View key={index} style={{ paddingHorizontal: 8 }}><Markdown>{message.text}</Markdown></View>)}
  </>;
}

/** The dialog on wide layouts: Paseo's chat column is 820 px wide; the saved copy reads a little narrower. */
const DIALOG_WIDTH = 780;

/**
 * 🌙 A sleeping thread's saved copy: reading it loads nothing and marks it read. Wake restores the
 * thread and opens its chat as a normal tab; the modal closes. Phones get Paseo's plugin `Modal`
 * (a sheet). Wide layouts get a dialog of the plugin's own, about a chat's width: Paseo's modal
 * card stops at 520 px and the plugin `Modal` can't widen it.
 */
export function SavedThread({ threadId, theme, compact, wake, onClose }: { threadId: string; theme: PluginTheme; compact: boolean; wake(id: string): Promise<void>; onClose(): void }) {
  const { colors } = theme;
  const load = useRpc(getThread);
  const [data, setData] = useState<RpcThread | null | "loading">("loading");
  const [waking, setWaking] = useState<"idle" | "waking" | string>("idle");
  useEffect(() => {
    let live = true;
    load({ id: threadId, markRead: true }).then(next => { if (live) setData(next); }, () => { if (live) setData(null); });
    return () => { live = false; };
  }, [threadId]);
  const onWake = async () => {
    setWaking("waking");
    try {
      await wake(threadId);
      onClose();
    } catch (error) {
      setWaking(humanError(error));
    }
  };
  const title = data && data !== "loading" ? data.thread.title : "Thread";
  const moon = <Icon name="Moon" size={18} color={colors.foreground} />;
  const body = data === "loading" ? <View style={{ padding: 32 }}><ActivityIndicator color={colors.foregroundMuted} /></View>
    : !data ? <Text style={{ color: colors.foregroundMuted, padding: 24 }}>This thread's saved copy is gone.</Text>
    : <>
            <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8 }}>
                {data.bot.emoji} {data.bot.name} · {data.thread.readOnly ? "read-only" : "asleep"} · saved copy: your messages and the answers
              </Text>
              <SavedCopy messages={data.messages} theme={theme} />
            </ScrollView>
            <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
              {data.thread.readOnly ? (
                <Text style={{ color: colors.foregroundMuted, fontSize: 12, textAlign: "center" }}>Read-only: this thread's agent was removed after a few days; the saved copy stays.</Text>
              ) : waking === "waking" ? (
                <View style={{ flexDirection: "row", gap: 10, justifyContent: "center", alignItems: "center", padding: 12 }}>
                  <ActivityIndicator color={colors.foregroundMuted} />
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>Restoring thread…</Text>
                  <Text style={{ color: colors.foregroundMuted }}>a few seconds</Text>
                </View>
              ) : <>
                <Pressable accessibilityRole="button" onPress={onWake}
                  style={{ flexDirection: "row", gap: 8, justifyContent: "center", alignItems: "center", paddingVertical: 11, borderRadius: 10, backgroundColor: colors.accent }}>
                  <Icon name="Sunrise" size={16} color={colors.accentForeground} />
                  <Text style={{ color: colors.accentForeground, fontWeight: "600", fontSize: 14 }}>Wake this thread</Text>
                </Pressable>
                <Text style={{ color: waking === "idle" ? colors.foregroundMuted : colors.statusDanger, fontSize: 12, textAlign: "center" }}>
                  {waking === "idle" ? "Opens it as a regular chat tab, with the message box and tool calls. A few seconds." : waking}
                </Text>
              </>}
            </View>
    </>;
  if (compact) {
    return (
      <Modal title={title} icon={moon} open onOpenChange={open => { if (!open) onClose(); }}>
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>{body}</Modal.Content>
      </Modal>
    );
  }
  // Paseo's modal card, wider: surface1 with a surface2 edge, a header row with a line under it.
  return (
    <RNModal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.5)" }} />
        <View style={{ width: "100%", maxWidth: DIALOG_WIDTH, height: "85%", overflow: "hidden", backgroundColor: colors.surface1, borderRadius: 12, borderWidth: 1, borderColor: colors.surface2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surface2 }}>
            {moon}
            <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 16, fontWeight: "600" }}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" }}>
              <Icon name="X" size={18} color={colors.foregroundMuted} />
            </Pressable>
          </View>
          {body}
        </View>
      </View>
    </RNModal>
  );
}
