import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { z } from "zod";
import { readEmbedFile } from "../shared/preferences";

export const embedCardSchema = z.object({
  original: z.string(),
  path: z.string(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  phase: z.enum(["streaming", "complete"]),
});

type CardData = z.output<typeof embedCardSchema>;

const MONO = Platform.select({
  ios: "ui-monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  default: "monospace",
});
const CODE_SIZE = 12;

function fileHref(filePath: string, lineStart?: number, lineEnd?: number): string {
  const range = lineStart ? `#L${lineStart}${lineEnd && lineEnd !== lineStart ? `-L${lineEnd}` : ""}` : "";
  return `file://${encodeURI(filePath)}${range}`;
}

function lineLabel(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-L${end}`;
}

export function EmbedCard({ item, agentId, theme, layout }: PluginTimelineItemProps<CardData>) {
  const data = item.data;
  const read = useRpc(readEmbedFile);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Paseo exposes no file-open API to plugins, so the button clicks a hidden Paseo Markdown file link.
  const linkHost = useRef<View>(null);
  const forwarding = useRef(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof read>> | null>(null);
  useEffect(() => {
    let live = true;
    setResult(null);
    setExpanded(false);
    void read({ agentId, path: data.path, lineStart: data.lineStart, lineEnd: data.lineEnd }).then((next) => {
      if (live) setResult(next);
    }).catch(() => {
      if (live) setResult({ status: "error", code: "unreadable", message: "File could not be read." });
    });
    return () => { live = false; };
  }, [agentId, data.path, data.lineStart, data.lineEnd, read]);

  const range = result?.status === "ok" ? lineLabel(result.lineStart, result.lineEnd) : data.lineStart ? lineLabel(data.lineStart, data.lineEnd ?? data.lineStart) : null;
  const href = result?.status === "ok" ? fileHref(result.path, result.lineStart, result.lineEnd) : null;
  // Expanded body fills the window minus room for the chat header and composer.
  const { height: windowHeight } = useWindowDimensions();
  const bodyHeight = Math.max(12 * 17, windowHeight - (layout.compact ? 260 : 220));
  const cardStyle = useMemo(() => ({
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    backgroundColor: theme.colors.surface1,
    marginVertical: 5,
    overflow: "hidden" as const,
  }), [theme.colors.border, theme.colors.surface1]);

  return (
    <View style={cardStyle}>
      <View style={{ paddingHorizontal: 9, paddingTop: 7, paddingBottom: 5, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foregroundMuted, fontFamily: MONO, fontSize: CODE_SIZE, lineHeight: 16 }} selectable>
            {data.original}
          </Text>
          {href ? (
            <Pressable
              {...({ title: "Open on the side" } as { title: string })}
              accessibilityRole="link"
              accessibilityLabel="Open on the side"
              accessibilityHint="Open the file in Paseo's file panel"
              aria-label="Open on the side"
              onHoverIn={() => setHovered(true)}
              onHoverOut={() => setHovered(false)}
              onPress={() => {
                // The hidden link sits inside this Pressable; its synthetic click must not re-trigger the press.
                if (Platform.OS !== "web" || forwarding.current) return;
                const host = linkHost.current as unknown as { querySelector(selector: string): { click(): void } | null } | null;
                forwarding.current = true;
                try {
                  host?.querySelector("a")?.click();
                } finally {
                  forwarding.current = false;
                }
              }}
              style={{
                width: 24,
                height: 24,
                borderRadius: 5,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: hovered ? theme.colors.surface2 : "transparent",
              }}
            >
              <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: hovered ? theme.colors.foreground : theme.colors.foregroundMuted, fontFamily: MONO, fontSize: 14, lineHeight: 18 }}>↗</Text>
                <View ref={linkHost} pointerEvents={Platform.OS === "web" ? "none" : "auto"} style={{ position: "absolute", left: 0, top: 0, width: 24, height: 24, opacity: 0, overflow: "hidden" }}>
                  <Markdown>{`[↗](${href})`}</Markdown>
                </View>
              </View>
            </Pressable>
          ) : null}
        </View>
        {range ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontFamily: MONO, fontSize: 11, lineHeight: 15 }}>
            {range}
          </Text>
        ) : null}
      </View>
      {result?.status === "error" ? (
        <Text style={{ paddingHorizontal: 9, paddingBottom: 9, color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {result.message}
        </Text>
      ) : result?.status === "ok" ? (
        <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Collapse file preview" : "Expand file preview"} onPress={() => setExpanded((value) => !value)}>
          <View style={{ position: "relative" }}>
            <ScrollView scrollEnabled={expanded} style={{ maxHeight: expanded ? bodyHeight : 12 * 17 }} contentContainerStyle={{ paddingHorizontal: 9, paddingBottom: 8 }}>
              <Text selectable style={{ color: theme.colors.foreground, fontFamily: MONO, fontSize: CODE_SIZE, lineHeight: 17 }}>
                {result.text}
              </Text>
            </ScrollView>
            {!expanded && result.text.includes("\n") ? (
              <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 32 }}>
                {Array.from({ length: 8 }, (_, index) => (
                  <View
                    key={index}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: index * 4,
                      height: 5,
                      backgroundColor: theme.colors.surface1,
                      opacity: 1 - index / 8,
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </Pressable>
      ) : (
        <Text style={{ paddingHorizontal: 9, paddingBottom: 9, color: theme.colors.foregroundMuted, fontSize: 12 }}>Loading file…</Text>
      )}
    </View>
  );
}
