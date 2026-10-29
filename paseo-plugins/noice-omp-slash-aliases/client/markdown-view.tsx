import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Platform, StyleSheet, Text, type TextStyle, View } from "react-native";
import { type Block, parseMarkdown, type Span } from "./markdown";

/**
 * Dense: Paseo's small text size (13 px, as its chat timestamps) for prose, Paseo's
 * 12 px code size, a heading scale just above the prose, 500-weight bold.
 */
const MONO = Platform.select({
  ios: "ui-monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  default: "monospace",
});
/**
 * Paseo's default UI font stack. Paseo sets it on each of its own texts; this sheet is
 * portalled outside Paseo's tree, so without it web falls back to React Native Web's stack.
 */
export const UI_FONT = Platform.select({
  web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
});
export const BODY = { fontSize: 13, lineHeight: 19, fontFamily: UI_FONT };
const CODE_SIZE = 12;
/** h1–h6. */
const HEADING_SIZE = [16, 15, 14, 13, 13, 13];

function Spans({ spans, theme }: { spans: Span[]; theme: PluginTheme }) {
  return spans.map((span, index) => {
    const style: TextStyle = {
      ...(span.bold ? { fontWeight: "500" } : {}),
      ...(span.italic ? { fontStyle: "italic" } : {}),
      ...(span.strike ? { textDecorationLine: "line-through", color: theme.colors.foregroundMuted } : {}),
      ...(span.code
        ? { fontFamily: MONO, fontSize: CODE_SIZE, backgroundColor: theme.colors.surface2, borderRadius: 6, paddingHorizontal: 4 }
        : {}),
      ...(span.url ? { color: theme.colors.accent, textDecorationLine: "underline" } : {}),
    };
    const url = span.url;
    return (
      <Text key={index} style={style} onPress={url ? () => void openExternalUrl(url) : undefined}>
        {span.text}
      </Text>
    );
  });
}

function BlockView({ block, theme }: { block: Block; theme: PluginTheme }) {
  const text = { color: theme.colors.foreground, ...BODY };
  switch (block.type) {
    case "heading": {
      const fontSize = HEADING_SIZE[block.level - 1];
      return (
        <Text selectable style={[text, { fontSize, lineHeight: Math.round(fontSize * 1.3), fontWeight: "600" }]}>
          <Spans spans={block.spans} theme={theme} />
        </Text>
      );
    }
    case "paragraph":
      return (
        <Text selectable style={text}>
          <Spans spans={block.spans} theme={theme} />
        </Text>
      );
    case "item":
      return (
        <View style={[styles.item, { paddingLeft: block.depth * 16 }]}>
          <Text style={[text, styles.marker, { color: theme.colors.foregroundMuted }]}>{block.marker}</Text>
          <Text selectable style={[text, styles.flex]}>
            <Spans spans={block.spans} theme={theme} />
          </Text>
        </View>
      );
    case "quote":
      return (
        <View style={[styles.quote, { borderLeftColor: theme.colors.surface2 }]}>
          <Text selectable style={[text, { color: theme.colors.foregroundMuted }]}>
            <Spans spans={block.spans} theme={theme} />
          </Text>
        </View>
      );
    case "code":
      return (
        <ScrollView
          horizontal
          style={[styles.code, { backgroundColor: theme.colors.surface2, borderColor: theme.colors.border }]}
        >
          <Text selectable style={{ color: theme.colors.foreground, fontFamily: MONO, fontSize: CODE_SIZE, lineHeight: 17 }}>
            {block.text}
          </Text>
        </ScrollView>
      );
    case "table":
      return (
        <ScrollView horizontal>
          <View style={[styles.table, { borderColor: theme.colors.border }]}>
            {[block.header, ...block.rows].map((row, rowIndex) => (
              <View
                key={rowIndex}
                style={[
                  styles.row,
                  rowIndex === 0
                    ? { backgroundColor: theme.colors.surface2 }
                    : { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
                ]}
              >
                {row.map((cell, cellIndex) => (
                  <Text key={cellIndex} selectable style={[text, styles.cell, rowIndex === 0 && { fontWeight: "600" }]}>
                    <Spans spans={cell} theme={theme} />
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    case "rule":
      return <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />;
  }
}

/** Space above a block: list items sit tight, headings get air, the rest Paseo's compact paragraph gap. */
function gapBefore(block: Block, previous: Block | undefined): number {
  if (!previous) return 0;
  if (block.type === "heading") return 10;
  if (block.type === "item" && previous.type === "item") return 2;
  return 6;
}

/** Renders model-answer Markdown with React Native text (all Paseo clients). */
export function MarkdownView({ source, theme }: { source: string; theme: PluginTheme }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <View>
      {blocks.map((block, index) => (
        <View key={index} style={{ marginTop: gapBefore(block, blocks[index - 1]) }}>
          <BlockView block={block} theme={theme} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: "row", gap: 4 },
  marker: { minWidth: 14 },
  flex: { flex: 1 },
  quote: { borderLeftWidth: 4, paddingLeft: 12 },
  code: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6, flexGrow: 0 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, overflow: "hidden" },
  row: { flexDirection: "row" },
  cell: { minWidth: 90, maxWidth: 260, paddingHorizontal: 8, paddingVertical: 4 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
