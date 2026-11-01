import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { createBot, defaultFolder, defaultName, deleteBot, getBot, settings, updateBot, type BotInput } from "../shared/contracts";
import { humanError } from "./errors";

const PICKS = ["🦊", "🐱", "🐼", "🐸", "🐻", "🦁", "🐨", "🐯", "🐵", "🐺"];

/** New bot (`botId` absent) and Edit: name, emoji, folder, system prompt, and Delete. The model lives in the hub's message box. */
export function BotForm({ botId, theme, close, onCreated, onDeleted }: { botId?: string; theme: PluginTheme; close(): void; onCreated?(hubAgentId: string): void; onDeleted?(botId: string): void }) {
  const { colors } = theme;
  const create = useRpc(createBot);
  const update = useRpc(updateBot);
  const remove = useRpc(deleteBot);
  const load = useRpc(getBot);
  const [draft, setDraft] = useState<BotInput | null>(botId ? null : { name: "", emoji: "🐻", cwd: "", prompt: "" });
  /** The bot as stored, for the delete question. */
  const [stored, setStored] = useState<{ name: string; emoji: string; cwd: string; threads: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [anyEmoji, setAnyEmoji] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "deleting" | string>("idle");
  const prefs = useSettings(settings);
  const botsFolder = prefs.status === "ready" ? prefs.values.botsFolder : "~/bots";
  useEffect(() => {
    if (botId) load({ id: botId }).then(bot => {
      if (!bot) return setState("This bot no longer exists.");
      setDraft({ name: bot.name, emoji: bot.emoji, cwd: bot.cwd, prompt: bot.prompt });
      setStored(bot);
    }, error => setState(humanError(error)));
  }, [botId]);
  if (!draft) return <View style={{ padding: 24 }}>{state === "idle" ? <ActivityIndicator color={colors.foregroundMuted} /> : <Text style={{ color: colors.statusDanger }}>{state}</Text>}</View>;
  const name = draft.name.trim() || defaultName(draft.emoji);
  const set = (change: Partial<BotInput>) => setDraft({ ...draft, ...change });
  const label = { color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const, marginBottom: 6 };
  const hint = { color: colors.foregroundMuted, fontSize: 12, marginTop: 6 };
  const input = { color: colors.foreground, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 };
  const save = async () => {
    setState("saving");
    try {
      if (botId) await update({ id: botId, ...draft });
      else onCreated?.((await create(draft)).hubAgentId);
      close();
    } catch (error) {
      setState(humanError(error));
    }
  };
  const destroy = async () => {
    if (!botId) return;
    setState("deleting");
    try {
      await remove({ id: botId });
      close();
      onDeleted?.(botId);
    } catch (error) {
      setConfirming(false);
      setState(humanError(error));
    }
  };
  const busy = state === "saving" || state === "deleting";
  const button = { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 };
  return (
    <View style={{ gap: 16, padding: 4, minWidth: 320, maxWidth: 520 }}>
      <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>{botId ? `Edit ${name}` : "New bot"}</Text>
      <View>
        <Text style={label}>Name and icon</Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 24 }}>{draft.emoji}</Text>
          <TextInput value={draft.name} onChangeText={name => set({ name })} placeholder={name} placeholderTextColor={colors.foregroundMuted} style={{ ...input, flex: 1 }} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
          {PICKS.map(emoji => (
            <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`Icon ${emoji}`} onPress={() => { setAnyEmoji(false); set({ emoji }); }}
              style={{ padding: 4, borderRadius: 8, backgroundColor: draft.emoji === emoji ? colors.surface2 : "transparent" }}>
              <Text style={{ fontSize: 20 }}>{emoji}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel="Any emoji" onPress={() => setAnyEmoji(true)} style={{ padding: 4, borderRadius: 8, justifyContent: "center" }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 18 }}>…</Text>
          </Pressable>
          {anyEmoji ? <TextInput autoFocus value="" onChangeText={emoji => { if (emoji.trim()) { set({ emoji: emoji.trim() }); setAnyEmoji(false); } }}
            placeholder="Type or paste an emoji" placeholderTextColor={colors.foregroundMuted} style={{ ...input, width: 180 }} /> : null}
        </View>
      </View>
      <View>
        <Text style={label}>Works in</Text>
        <TextInput value={draft.cwd} onChangeText={cwd => set({ cwd })} placeholder={defaultFolder(botsFolder, name)} placeholderTextColor={colors.foregroundMuted} style={input} autoCapitalize="none" autoCorrect={false} />
        <Text style={hint}>Created if it doesn't exist. The model and thinking level are picked in the bot's message box, like any chat.</Text>
      </View>
      <View>
        <Text style={label}>System prompt</Text>
        <TextInput multiline value={draft.prompt} onChangeText={prompt => set({ prompt })}
          placeholder="What this bot is for and how it should answer. Every thread starts with it." placeholderTextColor={colors.foregroundMuted}
          style={{ ...input, minHeight: 120, textAlignVertical: "top" }} />
        <Text style={hint}>Applies to new threads. Threads already started keep the prompt they began with.</Text>
      </View>
      {!busy && state !== "idle" ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{state}</Text> : null}
      {confirming && stored ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.foreground, fontSize: 14 }}>
            Delete {stored.emoji} {stored.name}? {stored.threads ? `Its ${stored.threads} thread${stored.threads === 1 ? "" : "s"} and their saved copies go too.` : "It has no threads."} Its folder {stored.cwd} and the files in it stay.
          </Text>
          <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirming(false)} style={{ ...button, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.foreground }}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={destroy} style={{ ...button, backgroundColor: colors.statusDanger, opacity: busy ? 0.5 : 1 }}>
              <Text style={{ color: colors.accentForeground, fontWeight: "600" }}>{state === "deleting" ? "Deleting…" : "Delete"}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {stored ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirming(true)} style={{ ...button, paddingHorizontal: 6 }}>
              <Text style={{ color: colors.statusDanger }}>Delete bot</Text>
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }} />
          <Pressable accessibilityRole="button" onPress={close} style={{ ...button, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.foreground }}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={{ ...button, backgroundColor: colors.accent, opacity: busy ? 0.5 : 1 }}>
            <Text style={{ color: colors.accentForeground, fontWeight: "600" }}>{state === "saving" ? "Saving…" : botId ? "Save" : "Create bot"}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
