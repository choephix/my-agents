import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { listUnread, searchThreads, type Thread } from "../shared/contracts";
import { humanError } from "./errors";

/** Search a bot's saved copies (your messages and the answers), newest first. */
export function SearchThreads({ botId, theme, open }: { botId: string; theme: PluginTheme; open(thread: Thread): void }) {
  const { colors } = theme;
  const search = useRpc(searchThreads);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Thread[] | "loading" | { error: string } | null>(null);
  useEffect(() => {
    if (query.trim().length < 2) return setResults(null);
    let live = true;
    setResults("loading");
    const timer = setTimeout(() => search({ botId, query }).then(found => { if (live) setResults(found); }, error => { if (live) setResults({ error: humanError(error) }); }), 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query, botId]);
  return (
    <View style={{ gap: 8, minWidth: 280, maxWidth: 520 }}>
      <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search questions and answers" placeholderTextColor={colors.foregroundMuted}
        style={{ color: colors.foreground, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 }} />
      {results ? <ThreadList results={results} empty="No thread matches." theme={theme} open={open} /> : null}
    </View>
  );
}

/** The answers you haven't opened yet, newest first: the threads behind the sidebar's green dot. */
export function UnreadThreads({ botId, theme, open }: { botId: string; theme: PluginTheme; open(thread: Thread): void }) {
  const unread = useRpc(listUnread);
  const [results, setResults] = useState<Thread[] | "loading" | { error: string }>("loading");
  useEffect(() => {
    let live = true;
    unread({ botId }).then(found => { if (live) setResults(found); }, error => { if (live) setResults({ error: humanError(error) }); });
    return () => { live = false; };
  }, [botId]);
  return <View style={{ gap: 8, minWidth: 280, maxWidth: 520 }}><ThreadList results={results} empty="Nothing unread." theme={theme} open={open} /></View>;
}

function ThreadList({ results, empty, theme, open }: { results: Thread[] | "loading" | { error: string }; empty: string; theme: PluginTheme; open(thread: Thread): void }) {
  const { colors } = theme;
  if (results === "loading") return <ActivityIndicator color={colors.foregroundMuted} />;
  if (!Array.isArray(results)) return <Text style={{ color: colors.statusDanger, fontSize: 13 }}>{results.error}</Text>;
  if (results.length === 0) return <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{empty}</Text>;
  return <>
    {results.map(thread => (
      <Pressable key={thread.id} accessibilityRole="button" onPress={() => open(thread)} style={{ paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14 }}>{thread.title}</Text>
        <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {new Date(thread.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {thread.answer.replace(/\s+/g, " ")}
        </Text>
      </Pressable>
    ))}
  </>;
}
