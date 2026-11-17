import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { moveTab } from "../shared/preferences";

/** Opened from the Command Center with the focused tab's agentId, cwd, title and provider. */
export function MoveTabScreen({ params, theme, host, navigation }: PluginScreenProps) {
  const { colors } = theme;
  const move = useRpc(moveTab);
  const [folder, setFolder] = useState(params.cwd ?? "");
  const [title, setTitle] = useState(params.title ?? "");
  const [state, setState] = useState<"idle" | "moving" | "moved" | string>("idle");
  // Set from the first press until the answer, so a second press can't send twice.
  const pending = useRef(false);
  const text = { color: colors.foreground, fontSize: 14 };
  const label = { color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const, marginBottom: 6 };
  const hint = { color: colors.foregroundMuted, fontSize: 12, marginTop: 6 };
  const input = { ...text, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 };
  const button = { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 };
  if (!params.agentId) return <Text style={{ ...text, padding: 24 }}>Open this from a chat tab: Command Center → Move tab to a new workspace.</Text>;
  const agentId = params.agentId;
  const same = !folder.trim() || folder.trim() === params.cwd;
  const busy = state === "moving" || state === "moved";
  const submit = async () => {
    if (pending.current) return;
    pending.current = true;
    setState("moving");
    try {
      const moved = await move({ agentId, folder: same ? "" : folder, title });
      setState("moved");
      navigation?.openAgent({ agentId: moved.agentId, serverId: host.id });
    } catch (error) {
      // The handler's own sentence, without Paseo's "Request failed:" prefix and `requestType=… code=…` tail.
      setState((error instanceof Error ? error.message : String(error)).replace(/^Request failed:\s*/, "").replace(/\s+requestType=\S+(\s+code=\S+)?\s*$/, ""));
    } finally { pending.current = false; }
  };
  return (
    <View style={{ gap: 16, padding: 24, maxWidth: 560 }}>
      <Text style={{ ...text, fontSize: 16, fontWeight: "600" }}>Move “{params.title || "Untitled chat"}” to a new workspace</Text>
      <View>
        <Text style={label}>Workspace name</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder={params.title || "The tab's title"} placeholderTextColor={colors.foregroundMuted} style={input} />
      </View>
      <View>
        <Text style={label}>Folder</Text>
        <TextInput value={folder} onChangeText={setFolder} onSubmitEditing={submit} placeholder={params.cwd} placeholderTextColor={colors.foregroundMuted}
          style={input} autoCapitalize="none" autoCorrect={false} />
        <Text style={hint}>
          {same
            ? "Same folder: this tab itself moves, with its history and settings."
            : params.provider === "omp"
              ? "Another folder: a new tab continues this chat there with its full OMP memory, and this tab is archived. Paths in earlier messages still name the old folder."
              : "Another folder: a new tab continues this chat there with Paseo's chat summary (not the full memory), and this tab is archived."}
        </Text>
      </View>
      {!busy && state !== "idle" ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{state}</Text> : null}
      {state === "moved" && !navigation ? <Text style={hint}>Moved. This Paseo client can't open it from here; find it in the sidebar.</Text> : null}
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
        {navigation ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => navigation.openAgent({ agentId, serverId: host.id })} style={{ ...button, borderWidth: 1, borderColor: colors.border }}>
            <Text style={text}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={{ ...button, flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.accent, opacity: busy ? 0.5 : 1 }}>
          {state === "moving" ? <ActivityIndicator size="small" color={colors.accentForeground} /> : null}
          <Text style={{ color: colors.accentForeground, fontWeight: "600" }}>{state === "moving" ? "Moving…" : state === "moved" ? "Moved" : "Move"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
