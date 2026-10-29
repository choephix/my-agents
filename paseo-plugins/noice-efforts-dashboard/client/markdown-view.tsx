import { openExternalUrl } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { StyleSheet, Text, type TextStyle, View } from "react-native";
import { type Block, parseMarkdown, type Span } from "./markdown";
import { MONO, type Palette } from "./marks";
import { underlineOnHover } from "./web";

/** Copied from noice-omp-slash-aliases (plain React Native: the SDK has no Markdown component). */
const HEADING_SIZE = [16, 15, 14, 13, 13, 13];

interface Props {
  source: string;
  c: Palette;
  /** Relative links (effort docs). External URLs open in the browser. */
  onLink?(href: string): void;
  /** 13/19 prose (viewer) or 12/17 (fold bodies). */
  small?: boolean;
}

function Spans({ spans, c, onLink }: { spans: Span[]; c: Palette; onLink?(href: string): void }) {
  return spans.map((span, index) => {
    const style: TextStyle = {
      ...(span.bold ? { fontWeight: "600" } : {}),
      ...(span.italic ? { fontStyle: "italic" } : {}),
      ...(span.strike ? { textDecorationLine: "line-through", color: c.muted } : {}),
      ...(span.code ? { fontFamily: MONO, fontSize: 12, backgroundColor: c.s2, borderRadius: 4, paddingHorizontal: 3 } : {}),
      ...(span.url ? { color: c.green } : {}),
    };
    const url = span.url;
    const press = url
      ? () => {
          if (/^https?:/i.test(url)) void openExternalUrl(url);
          else onLink?.(url);
        }
      : undefined;
    return press ? (
      <Text key={index} ref={underlineOnHover} style={style} onPress={press}>
        {span.text}
      </Text>
    ) : (
      <Text key={index} style={style}>
        {span.text}
      </Text>
    );
  });
}

function BlockView({ block, c, onLink, text }: { block: Block; c: Palette; onLink?(href: string): void; text: TextStyle }) {
  switch (block.type) {
    case "heading": {
      const fontSize = HEADING_SIZE[block.level - 1];
      return (
        <Text selectable style={[text, { fontSize, lineHeight: Math.round(fontSize * 1.35), fontWeight: "600" }]}>
          <Spans spans={block.spans} c={c} onLink={onLink} />
        </Text>
      );
    }
    case "paragraph":
      return (
        <Text selectable style={text}>
          <Spans spans={block.spans} c={c} onLink={onLink} />
        </Text>
      );
    case "item":
      return (
        <View style={[styles.item, { paddingLeft: block.depth * 14 }]}>
          <Text style={[text, styles.marker, { color: c.muted }]}>{block.marker}</Text>
          <Text selectable style={[text, styles.flex]}>
            <Spans spans={block.spans} c={c} onLink={onLink} />
          </Text>
        </View>
      );
    case "quote":
      return (
        <View style={[styles.quote, { borderLeftColor: c.track }]}>
          <Text selectable style={[text, { color: c.muted }]}>
            <Spans spans={block.spans} c={c} onLink={onLink} />
          </Text>
        </View>
      );
    case "code":
      return (
        <ScrollView horizontal style={[styles.code, { backgroundColor: c.s1, borderColor: c.border }]}>
          <Text selectable style={{ color: c.fg, fontFamily: MONO, fontSize: 11.5, lineHeight: 16 }}>
            {block.text}
          </Text>
        </ScrollView>
      );
    case "table":
      return (
        <ScrollView horizontal>
          <View style={[styles.table, { borderColor: c.border }]}>
            {[block.header, ...block.rows].map((row, rowIndex) => (
              <View
                key={rowIndex}
                style={[
                  styles.row,
                  rowIndex === 0 ? { backgroundColor: c.s2 } : { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border },
                ]}
              >
                {row.map((cell, cellIndex) => (
                  <Text key={cellIndex} selectable style={[text, styles.cell, rowIndex === 0 && { fontWeight: "600" }]}>
                    <Spans spans={cell} c={c} onLink={onLink} />
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    case "rule":
      return <View style={[styles.rule, { backgroundColor: c.border }]} />;
  }
}

function gapBefore(block: Block, previous: Block | undefined): number {
  if (!previous) return 0;
  if (block.type === "heading") return 10;
  if (block.type === "item" && previous.type === "item") return 3;
  return 6;
}

export function MarkdownView({ source, c, onLink, small }: Props) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const text: TextStyle = { color: c.fg, ...(small ? { fontSize: 12, lineHeight: 17 } : { fontSize: 13, lineHeight: 19 }) };
  return (
    <View>
      {blocks.map((block, index) => (
        <View key={index} style={{ marginTop: gapBefore(block, blocks[index - 1]) }}>
          <BlockView block={block} c={c} onLink={onLink} text={text} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: "row", gap: 4 },
  marker: { minWidth: 12 },
  /** minWidth 0 so a long unbroken word (paths, identifiers) wraps instead of widening the column. */
  flex: { flex: 1, minWidth: 0 },
  quote: { borderLeftWidth: 3, paddingLeft: 10 },
  code: { borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 6, flexGrow: 0 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, overflow: "hidden" },
  row: { flexDirection: "row" },
  cell: { minWidth: 90, maxWidth: 260, paddingHorizontal: 8, paddingVertical: 4 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
