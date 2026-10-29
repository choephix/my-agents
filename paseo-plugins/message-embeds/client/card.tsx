import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { z } from "zod";
import { embedKind, readEmbedAsset, readEmbedFile } from "../shared/preferences";
import { cardColors } from "./card-colors";
import { checkSvg, svgDataUri, unescapeSvg } from "./svg";

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
  cardHovered: boolean;
  /** Keys this card's expanded/open state, which outlives remounts. */
  stateKey: string;
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

/*
 * Paseo's chat list unmounts rows scrolled out of view and mounts them again on the way back. A
 * card that came back shorter (loading, folded) than it left made the list's scroll position jump
 * and never settle. So answers, image sizes and open/folded state outlive the card, keyed per chat
 * and embed, and a card that mounts again has its final height in its first frame.
 */
const MAX_CACHED = 40;
const results = new Map<string, unknown>();
const imageSizes = new Map<string, { width: number; height: number } | "failed">();
const toggles = new Map<string, boolean>();

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  // Oldest first in insertion order; images are up to ~5 MB as data URIs.
  if (map.size > MAX_CACHED) map.delete(map.keys().next().value as string);
}

/** A boolean (expanded, open) that survives the card remounting. */
function useToggle(key: string): [boolean, () => void] {
  const [value, setValue] = useState(() => toggles.get(key) ?? false);
  const toggle = () => setValue((previous) => {
    remember(toggles, key, !previous);
    return !previous;
  });
  return [value, toggle];
}

/**
 * Runs an RPC whenever `key` changes; starts from the last answer for `key`, so a remount doesn't
 * pass through "loading". `load` null means not wanted now. A thrown call reads as unreadable.
 */
function useRead<T>(load: (() => Promise<T>) | null, key: string): T | { status: "error"; message: string } | null {
  type Result = T | { status: "error"; message: string };
  const [result, setResult] = useState<Result | null>(() => (load ? (results.get(key) as Result | undefined) ?? null : null));
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let live = true;
    const run = loadRef.current;
    setResult(run ? (results.get(key) as Result | undefined) ?? null : null);
    if (run) {
      run().then((next) => {
        remember(results, key, next);
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

interface CardHeaderProps {
  theme: PluginTheme;
  original: string;
  href: string | null;
  /** Range or size, faint at the right; both header texts brighten while the card is hovered. */
  detail: string | null;
  cardHovered: boolean;
  action?: ReactNode;
}

/** One row: the original `![[…]]` text, the detail, an optional action, the open-on-the-side button. */
function CardHeader({ theme, original, href, detail, cardHovered, action }: CardHeaderProps) {
  const [hovered, setHovered] = useState(false);
  // Paseo exposes no file-open API to plugins, so the button clicks a hidden Paseo Markdown file link.
  const linkHost = useRef<View>(null);
  const forwarding = useRef(false);
  const faint = { color: theme.colors.foregroundMuted, fontFamily: MONO, fontSize: 9, lineHeight: 12 };
  return (
    <View style={{ paddingLeft: 9, paddingRight: 4, paddingTop: 3, paddingBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20 }}>
        <Text numberOfLines={1} style={{ ...faint, flex: 1, opacity: cardHovered ? 0.85 : 0.5 }} selectable>
          {original}
        </Text>
        {detail ? <Text numberOfLines={1} style={{ ...faint, opacity: cardHovered ? 0.7 : 0.3 }}>{detail}</Text> : null}
        {action}
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
              width: 20,
              height: 20,
              borderRadius: 5,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: hovered ? theme.colors.surface2 : "transparent",
            }}
          >
            <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: hovered ? theme.colors.foreground : theme.colors.foregroundMuted, fontFamily: MONO, fontSize: 12, lineHeight: 14 }}>↗</Text>
              <View ref={linkHost} pointerEvents={Platform.OS === "web" ? "none" : "auto"} style={{ position: "absolute", left: 0, top: 0, width: 20, height: 20, opacity: 0, overflow: "hidden" }}>
                <Markdown>{`[↗](${href})`}</Markdown>
              </View>
            </View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** A small text toggle in the header row (Show page, Code). */
function HeaderToggle({ theme, label, onToggle }: { theme: PluginTheme; label: string; onToggle(): void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onToggle}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{ paddingHorizontal: 5, height: 20, borderRadius: 4, justifyContent: "center", backgroundColor: hovered ? theme.colors.surface2 : "transparent" }}
    >
      <Text style={{ color: hovered ? theme.colors.foreground : theme.colors.foregroundMuted, fontFamily: MONO, fontSize: 10, lineHeight: 12 }}>
        {label}
      </Text>
    </Pressable>
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

function TextEmbed({ data, agentId, theme, background, bodyHeight, cardHovered, stateKey }: BodyProps) {
  const read = useRpc(readEmbedFile);
  const [expanded, toggleExpanded] = useToggle(stateKey);
  const result = useRead(
    () => read({ agentId, path: data.path, lineStart: data.lineStart, lineEnd: data.lineEnd }),
    `text\n${agentId}\n${data.path}\n${data.lineStart}\n${data.lineEnd}`,
  );
  const ok = result?.status === "ok" ? result : null;
  const detail = ok ? lineLabel(ok.lineStart, ok.lineEnd) : data.lineStart ? lineLabel(data.lineStart, data.lineEnd ?? data.lineStart) : null;
  return (
    <>
      <CardHeader theme={theme} original={data.original} href={ok ? fileHref(ok.path, ok.lineStart, ok.lineEnd) : null} detail={detail} cardHovered={cardHovered} />
      {result?.status === "error" ? (
        <Note theme={theme}>{result.message}</Note>
      ) : ok ? (
        <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Collapse file preview" : "Expand file preview"} onPress={toggleExpanded}>
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

function ImageEmbed({ data, agentId, theme, bodyHeight, cardHovered, stateKey }: BodyProps) {
  const read = useRpc(readEmbedAsset);
  const assetKey = `asset\n${agentId}\n${data.path}`;
  const result = useRead(() => read({ agentId, path: data.path }), assetKey);
  const ok = result?.status === "ok" ? result : null;
  const [natural, setNatural] = useState(() => imageSizes.get(assetKey) ?? null);
  const [expanded, toggleExpanded] = useToggle(stateKey);
  useEffect(() => {
    if (!ok) return;
    let live = true;
    Image.getSize(ok.body, (width, height) => {
      remember(imageSizes, assetKey, { width, height });
      if (live) setNatural({ width, height });
    }, () => {
      remember(imageSizes, assetKey, "failed");
      if (live) setNatural("failed");
    });
    return () => { live = false; };
  }, [ok?.body, assetKey]);

  const size = natural && natural !== "failed" ? natural : null;
  // Width from the height cap and the aspect ratio, never upscaled, never wider than the card
  // (maxWidth); no measuring, so the first frame already has the final height.
  const clipped = size ? size.height > FOLDED_IMAGE_HEIGHT : false;
  const width = size ? Math.min(size.width, ((expanded ? bodyHeight : FOLDED_IMAGE_HEIGHT) * size.width) / size.height) : 0;
  const detail = ok ? [size ? `${size.width}×${size.height}` : null, sizeLabel(ok.bytes)].filter(Boolean).join(" · ") : null;
  const svgOffWeb = Platform.OS !== "web" && /\.svg$/i.test(data.path);

  return (
    <>
      <CardHeader theme={theme} original={data.original} href={ok ? fileHref(ok.path) : null} detail={detail} cardHovered={cardHovered} />
      {result?.status === "error" ? (
        <Note theme={theme}>{result.message}</Note>
      ) : natural === "failed" ? (
        <Note theme={theme}>{svgOffWeb ? "SVG previews need the desktop or web app." : "The image could not be shown."}</Note>
      ) : (
        <View style={{ paddingHorizontal: 9, paddingBottom: 9 }}>
          {ok && size ? (
            <Pressable
              disabled={!clipped}
              accessibilityRole={clipped ? "button" : "image"}
              accessibilityLabel={clipped ? (expanded ? "Shrink image" : "Enlarge image") : data.path}
              onPress={toggleExpanded}
            >
              <Image source={{ uri: ok.body }} resizeMode="contain" style={{ width, maxWidth: "100%", aspectRatio: size.width / size.height, borderRadius: 4 }} />
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
function HtmlEmbed({ data, agentId, theme, bodyHeight, cardHovered, stateKey }: BodyProps) {
  const read = useRpc(readEmbedAsset);
  const [open, toggleOpen] = useToggle(stateKey);
  const result = useRead(open ? () => read({ agentId, path: data.path }) : null, `asset\n${agentId}\n${data.path}`);
  const ok = result?.status === "ok" ? result : null;
  const web = Platform.OS === "web";

  return (
    <>
      <CardHeader
        theme={theme}
        original={data.original}
        href={ok ? fileHref(ok.path) : null}
        detail={null}
        cardHovered={cardHovered}
        action={web ? <HeaderToggle theme={theme} label={open ? "▾ Hide page" : "▸ Show page"} onToggle={toggleOpen} /> : null}
      />
      {!web ? (
        <Note theme={theme}>HTML previews need the desktop or web app.</Note>
      ) : (
        <>
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
  const [cardHovered, setCardHovered] = useState(false);
  // Plugin rows carry no id here; the same embed text twice in one chat shares its open state.
  const props: BodyProps = { data: item.data, agentId, theme, background, bodyHeight, cardHovered, stateKey: `${agentId}\n${item.data.original}` };
  const kind = embedKind(item.data.path);
  return (
    // Hover brightens the header texts. Pointer events, not a Pressable: an outer Pressable never got hover on web.
    <View onPointerEnter={() => setCardHovered(true)} onPointerLeave={() => setCardHovered(false)} style={cardStyle}>
      {kind === "image" ? <ImageEmbed {...props} /> : kind === "html" ? <HtmlEmbed {...props} /> : <TextEmbed {...props} />}
    </View>
  );
}

export const svgBlockSchema = z.object({ source: z.string() });

/** ```svg blocks that failed to load as an image; kept so a remounted card starts as code. */
const brokenSvgs = new Map<string, true>();

/**
 * A complete ```svg block drawn as a picture, with a Code toggle back to the source. Drawn as an
 * image: no scripts, no external loads. Size comes from the SVG itself, so the first frame has
 * the final height. Invalid, oversized or unloadable SVG shows the plain code block and a note.
 */
export function SvgBlockCard({ item, agentId, theme, layout }: PluginTimelineItemProps<z.output<typeof svgBlockSchema>>) {
  const { source } = item.data;
  const { height: windowHeight } = useWindowDimensions();
  const maxHeight = Math.max(FOLDED_TEXT_HEIGHT, windowHeight - (layout.compact ? 260 : 220));
  const background = cardColors(theme).background;
  const [cardHovered, setCardHovered] = useState(false);
  const [showCode, toggleCode] = useToggle(`${agentId}\nsvg\n${source}`);
  const [broken, setBroken] = useState(() => brokenSvgs.has(source));
  const svg = useMemo(() => unescapeSvg(source), [source]);
  const check = useMemo(() => checkSvg(svg), [svg]);
  const c = theme.colors;
  const uri = useMemo(() => check.status !== "ok" ? null : svgDataUri(svg, {
    foreground: c.foreground,
    muted: c.foregroundMuted,
    accent: c.accent,
    accentForeground: c.accentForeground,
    danger: c.statusDanger,
    warning: c.statusWarning,
    success: c.statusSuccess,
    border: c.border,
    background,
  }), [svg, check.status, c, background]);
  const code = `\`\`\`svg\n${source}\n\`\`\``;
  const note = check.status === "error" ? check.message : broken ? "SVG could not be drawn, shown as code." : null;

  if (check.status !== "ok" || !uri || note) {
    return (
      <View>
        <Markdown>{code}</Markdown>
        <Text style={{ color: c.foregroundMuted, fontSize: 12, marginTop: -2, marginBottom: 6 }}>{note}</Text>
      </View>
    );
  }
  // Natural size, never wider than the card (maxWidth) nor taller than the window.
  const width = Math.min(check.width, (maxHeight * check.width) / check.height);
  return (
    <View
      onPointerEnter={() => setCardHovered(true)}
      onPointerLeave={() => setCardHovered(false)}
      style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, backgroundColor: background, marginVertical: 5, overflow: "hidden" }}
    >
      <CardHeader
        theme={theme}
        original="svg"
        href={null}
        detail={showCode ? null : `${check.width}×${check.height}`}
        cardHovered={cardHovered}
        action={<HeaderToggle theme={theme} label={showCode ? "Picture" : "Code"} onToggle={toggleCode} />}
      />
      {showCode ? (
        <View style={{ paddingHorizontal: 9 }}>
          <Markdown>{code}</Markdown>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 9, paddingBottom: 9 }}>
          <Image
            source={{ uri }}
            resizeMode="contain"
            accessibilityLabel="SVG picture"
            onError={() => {
              remember(brokenSvgs, source, true);
              setBroken(true);
            }}
            style={{ width, maxWidth: "100%", aspectRatio: check.width / check.height }}
          />
        </View>
      )}
    </View>
  );
}
