import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { copyText, Icon, Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { buildFileLinkUrl, escapeMarkdownLinkLabel } from "../shared/frontmatter";
import type { SlipCreatedTimelineData } from "../shared/panel";

export function createSlipCreatedRenderer(client: PluginClientContext) {
  return function SlipCreatedTimelineRow({
    agentId,
    item,
    theme,
  }: PluginTimelineItemProps<SlipCreatedTimelineData>) {
    const toast = useToast();
    const { absolutePath, relativePath, wikiName, title, kind, emoji } = item.data;

    const openLinkMarkdown = useMemo(() => {
      const label = emoji ? `${emoji} ${title}` : title;
      return `[${escapeMarkdownLinkLabel(label)}](<${buildFileLinkUrl(absolutePath)}>)`;
    }, [absolutePath, emoji, title]);

    const handleCopy = useCallback(() => {
      const link = `[[${wikiName}]]`;
      void copyText(link)
        .then(() => toast.show(`Copied ${link}`, { variant: "info" }))
        .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
    }, [wikiName, toast]);

    const handleInsert = useCallback(() => {
      const composer = client.composers({ agentId })[0];
      const text = `[[${wikiName}]] `;
      if (composer) {
        composer.insertText(text);
        composer.focus();
      } else {
        void copyText(text.trim())
          .then(() => toast.show(`Copied ${text.trim()}`, { variant: "info" }))
          .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
      }
    }, [agentId, wikiName, toast]);

    const styles = useMemo(
      () => ({
        card: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          justifyContent: "space-between" as const,
          flexWrap: "wrap" as const,
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 9,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
        left: {
          flex: 1,
          minWidth: 180,
          gap: 2,
        },
        titleRow: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          flexWrap: "wrap" as const,
          gap: 6,
        },
        badge: {
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: 5,
          backgroundColor: theme.colors.surface2,
        },
        badgeText: {
          color: theme.colors.foregroundMuted,
          fontSize: 11,
          fontWeight: "600" as const,
        },
        sub: {
          color: theme.colors.foregroundMuted,
          fontSize: 11,
        },
        actions: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 6,
        },
        btn: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
        },
        btnText: {
          color: theme.colors.foreground,
          fontSize: 11,
          fontWeight: "500" as const,
        },
      }),
      [theme],
    );

    return (
      <View style={styles.card}>
        <View style={styles.left}>
          <View style={styles.titleRow}>
            <Icon name="StickyNote" size={14} color={theme.colors.accent} />
            <View style={styles.badge}>
              <Text style={styles.badgeText}>saved {kind}</Text>
            </View>
            <Markdown>{openLinkMarkdown}</Markdown>
          </View>
          <Text style={styles.sub}>{relativePath}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={handleCopy} style={styles.btn}>
            <Icon name="Copy" size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.btnText}>Copy [[link]]</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={handleInsert} style={styles.btn}>
            <Icon name="CornerDownLeft" size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.btnText}>Insert</Text>
          </Pressable>
        </View>
      </View>
    );
  };
}
