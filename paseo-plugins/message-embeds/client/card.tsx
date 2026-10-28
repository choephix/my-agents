import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { z } from "zod";
import { embedKind, readEmbedAsset, readEmbedFile } from "../shared/preferences";
import { cardColors } from "./card-colors";

export const embedCardSchema = z.object({
  original: z.string(),
  path: z.string(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  phase: z.enum(["streaming", "complete"]),
});

type CardData = z.output<typeof embedCardSchema>;

interface BodyProps {
  data: CardData;
  agentId: string;
  theme: PluginTheme;
  background: string;
  /** Expanded height: the window minus room for the chat header and composer. */
  bodyHeight: number;
}

const MONO = Platform.select({
  ios: "ui-monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  default: "monospace",
});
const CODE_SIZE = 12;
const FOLDED_TEXT_HEIGHT = 12 * 17;
const FOLDED_IMAGE_HEIGHT = 240;

function fileHref(filePath: string, lineStart?: number, lineEnd?: number): string {
  const range = lineStart ? `#L${lineStart}${lineEnd && lineEnd !== lineStart ? `-L${lineEnd}` : ""}` : "";
  return `file://${encodeURI(filePath)}${range}`;
}

function lineLabel(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-L${end}`;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Runs an RPC whenever `key` changes and keeps the latest answer; a thrown call reads as unreadable. */
function useRead<T>(load: (() => Promise<T>) | null, key: string): T | { status: "error"; message: string } | null {
  const [result, setResult] = useState<T | { status: "error"; message: string } | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let live = true;
    setResult(null);
    const run = loadRef.current;
    if (run) {
      run().then((next) => {
        if (live) setResult(next);
      }).catch(() => {
        if (live) setResult({ status: "error", message: "File could not be read." });
      });
    }
    return () => { live = false; };
  }, [key, load === null]);
  return result;
}

function Note({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  return <Text style={{ paddingHorizontal: 9, paddingBottom: 9, color: theme.colors.foregroundMuted, fontSize: 12 }}>{children}</Text>;
}

/** The original `![[…]]` text, a detail line (range, size) and the open-on-the-side button. */
function CardHeader({ theme, original, href, detail }: { theme: PluginTheme; original: string; href: string | null; detail: string | null }) {
  const [hovered, setHovered] = useState(false);
  // Paseo exposes no file-open API to plugins, so the button clicks a hidden Paseo Markdown file link.
  const linkHost = useRef<View>(null);
  const forwarding = useRef(false);
  return (
    <View style={{ paddingHorizontal: 9, paddingTop: 7, paddingBottom: 5, gap: 3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foregroundMuted, fontFamily: MONO, fontSize: CODE_SIZE, lineHeight: 16 }} selectable>
          {original}
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
      {detail ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontFamily: MONO, fontSize: 11, lineHeight: 15 }}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

/** Eight stepped strips of the card background: a fade that needs no gradient library. */
function Fade({ background }: { background: string }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 32 }}>
      {Array.from({ length: 8 }, (_, index) => (
        <View
          key={index}
          style={{ position: "absolute", left: 0, right: 0, bottom: index * 4, height: 5, backgroundColor: background, opacity: 1 - index / 8 }}
        />
      ))}
    </View>
  );
}

function TextEmbed({ data, agentId, theme, background, bodyHeight }: BodyProps) {
  const read = useRpc(readEmbedFile);
  const [expanded, setExpanded] = useState(false);
  const result = useRead(
    () => read({ agentId, path: data.path, lineStart: data.lineStart, lineEnd: data.lineEnd }),
    `${agentId}\n${data.path}\n${data.lineStart}\n${data.lineEnd}`,
  );
  useEffect(() => setExpanded(false), [result]);
  const ok = result?.status === "ok" ? result : null;
  const detail = ok ? lineLabel(ok.lineStart, ok.lineEnd) : data.lineStart ? lineLabel(data.lineStart, data.lineEnd ?? data.lineStart) : null;
  return (
    <>
      <CardHeader theme={theme} original={data.original} href={ok ? fileHref(ok.path, ok.lineStart, ok.lineEnd) : null} detail={detail} />
      {result?.status === "error" ? (
        <Note theme={theme}>{result.message}</Note>
      ) : ok ? (
        <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Collapse file preview" : "Expand file preview"} onPress={() => setExpanded((value) => !value)}>
          <View style={{ position: "relative" }}>
            <ScrollView scrollEnabled={expanded} style={{ maxHeight: expanded ? bodyHeight : FOLDED_TEXT_HEIGHT }} contentContainerStyle={{ paddingHorizontal: 9, paddingBottom: 8 }}>
              <Text selectable style={{ color: theme.colors.foreground, fontFamily: MONO, fontSize: CODE_SIZE, lineHeight: 17 }}>
                {ok.text}
              </Text>
            </ScrollView>
            {!expanded && ok.text.includes("\n") ? <Fade background={background} /> : null}
          </View>
        </Pressable>
      ) : (
        <Note theme={theme}>Loading file…</Note>
      )}
    </>
  );
}

function ImageEmbed({ data, agentId, theme, bodyHeight }: BodyProps) {
  const read = useRpc(readEmbedAsset);
  const result = useRead(() => read({ agentId, path: data.path }), `${agentId}\n${data.path}`);
  const ok = result?.status === "ok" ? result : null;
  const [natural, setNatural] = useState<{ width: number; height: number } | "failed" | null>(null);
  const [available, setAvailable] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setNatural(null);
    setExpanded(false);
    if (ok) Image.getSize(ok.body, (width, height) => setNatural({ width, height }), () => setNatural("failed"));
  }, [ok?.body]);

  const size = natural && natural !== "failed" ? natural : null;
  // Never upscaled; fits the card width, and the folded or expanded height.
  const fitWidth = size && available ? Math.min(1, available / size.width) : 0;
  const clipped = size ? size.height * fitWidth > FOLDED_IMAGE_HEIGHT : false;
  const scale = size ? Math.min(fitWidth, (expanded ? bodyHeight : FOLDED_IMAGE_HEIGHT) / size.height) : 0;
  const detail = ok ? [size ? `${size.width}×${size.height}` : null, sizeLabel(ok.bytes)].filter(Boolean).join(" · ") : null;
  const svgOffWeb = Platform.OS !== "web" && /\.svg$/i.test(data.path);

  return (
    <>
      <CardHeader theme={theme} original={data.original} href={ok ? fileHref(ok.path) : null} detail={detail} />
      {result?.status === "error" ? (
        <Note theme={theme}>{result.message}</Note>
      ) : natural === "failed" ? (
        <Note theme={theme}>{svgOffWeb ? "SVG previews need the desktop or web app." : "The image could not be shown."}</Note>
      ) : (
        <View onLayout={(event) => setAvailable(event.nativeEvent.layout.width - 18)} style={{ paddingHorizontal: 9, paddingBottom: 9 }}>
          {ok && size && scale ? (
            <Pressable
              disabled={!clipped}
              accessibilityRole={clipped ? "button" : "image"}
              accessibilityLabel={clipped ? (expanded ? "Shrink image" : "Enlarge image") : data.path}
              onPress={() => setExpanded((value) => !value)}
            >
              <Image source={{ uri: ok.body }} resizeMode="contain" style={{ width: size.width * scale, height: size.height * scale, borderRadius: 4 }} />
            </Pressable>
          ) : (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Loading image…</Text>
          )}
        </View>
      )}
    </>
  );
}

/**
 * HTML runs in an iframe sandboxed to scripts only: no same-origin, so the page cannot reach
 * Paseo, its storage or its session. It loads only while open; closing unloads it, so pages
 * with animations cost nothing while folded.
 */
function HtmlEmbed({ data, agentId, theme, bodyHeight }: BodyProps) {
  const read = useRpc(readEmbedAsset);
  const [open, setOpen] = useState(false);
  const result = useRead(open ? () => read({ agentId, path: data.path }) : null, `${agentId}\n${data.path}`);
  useEffect(() => setOpen(false), [agentId, data.path]);
  const ok = result?.status === "ok" ? result : null;
  const web = Platform.OS === "web";

  return (
    <>
      <CardHeader theme={theme} original={data.original} href={ok ? fileHref(ok.path) : null} detail={ok ? `HTML · ${sizeLabel(ok.bytes)}` : "HTML page"} />
      {!web ? (
        <Note theme={theme}>HTML previews need the desktop or web app.</Note>
      ) : (
        <>
          <Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)} style={{ paddingHorizontal: 9, paddingBottom: 9 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontFamily: MONO, fontSize: CODE_SIZE }}>{open ? "▾ Hide page" : "▸ Show page"}</Text>
          </Pressable>
          {!open ? null : result?.status === "error" ? (
            <Note theme={theme}>{result.message}</Note>
          ) : ok ? (
            createElement("iframe", {
              srcDoc: ok.body,
              sandbox: "allow-scripts",
              referrerPolicy: "no-referrer",
              title: data.original,
              // Pages that set no background get white, so default black text stays readable.
              style: { display: "block", width: "100%", height: bodyHeight, border: 0, background: "#fff" },
            })
          ) : (
            <Note theme={theme}>Loading page…</Note>
          )}
        </>
      )}
    </>
  );
}

export function EmbedCard({ item, agentId, theme, layout }: PluginTimelineItemProps<CardData>) {
  const { height: windowHeight } = useWindowDimensions();
  const bodyHeight = Math.max(FOLDED_TEXT_HEIGHT, windowHeight - (layout.compact ? 260 : 220));
  // Same background as the agent card (theme tokens, a little toward surface2).
  const background = cardColors(theme).background;
  const cardStyle = useMemo(() => ({
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    backgroundColor: background,
    marginVertical: 5,
    overflow: "hidden" as const,
  }), [theme.colors.border, background]);
  const props: BodyProps = { data: item.data, agentId, theme, background, bodyHeight };
  const kind = embedKind(item.data.path);
  return (
    <View style={cardStyle}>
      {kind === "image" ? <ImageEmbed {...props} /> : kind === "html" ? <HtmlEmbed {...props} /> : <TextEmbed {...props} />}
    </View>
  );
}
