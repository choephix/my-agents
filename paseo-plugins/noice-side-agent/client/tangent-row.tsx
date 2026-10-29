import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { copyText, Icon, Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import type { ParsedReport } from "../shared/report";

/*
 * A tangent's report in its parent chat, drawn after the /tan row of noice-omp-slash-aliases:
 * a muted dashed line (`tangent`, title, status, first line of the answer) that opens to the
 * full answer. The message itself is unchanged; the parent model reads the plain report.
 */

export const ReportRowData = z.object({
  title: z.string(),
  status: z.enum(["done", "failed", "stopped", "archived"]),
  took: z.string(),
  body: z.string(),
  link: z.string(),
  agentId: z.string(),
  serverId: z.string(),
}) satisfies z.ZodType<ParsedReport>;
export type ReportRowData = z.infer<typeof ReportRowData>;

const UI_FONT = Platform.select({ web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" });
const SMALL = { fontSize: 12, lineHeight: 18, fontFamily: UI_FONT };
const LINE = { fontSize: 13, lineHeight: 20, fontFamily: UI_FONT };
const TITLE_PREFIX = "Tangent: ";
const ICONS = { done: "CornerDownRight", failed: "CircleAlert", stopped: "CircleStop", archived: "Archive" } as const;
const VERBS = { done: "done in", failed: "failed after", stopped: "stopped after", archived: "archived after" } as const;

/** `#rrggbb` / `#rgb` with an alpha; other colour forms unchanged. */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const full = hex.length === 3 ? [...hex].map(c => c + c).join("") : hex;
  return `#${full}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

/** The answer's (or error's) first line with a letter or digit (not a lone emoji), without the common Markdown marks. */
function peek({ status, body }: ReportRowData): string {
  if (status === "stopped" || status === "archived") return "";
  // The first matching line only: no copy of a long answer.
  const line = /^.*[\p{L}\p{N}].*$/mu.exec(body)?.[0].trim() ?? "";
  return line
    .replace(/^(?:#{1,6}\s+|>\s*|[•*+-]\s+|\d+[.)]\s+)/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "");
}

function ActionButton({ icon, label, onPress, theme }: { icon: string; label: string; onPress(): void; theme: PluginTheme }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.action, (pressed || hovered) && { backgroundColor: theme.colors.surface2 }]}
    >
      {({ hovered }: { pressed: boolean; hovered?: boolean }) => {
        const color = hovered ? theme.colors.foreground : theme.colors.foregroundMuted;
        return (
          <>
            <Icon name={icon} size={13} color={color} />
            <Text style={[SMALL, { color }]}>{label}</Text>
          </>
        );
      }}
    </Pressable>
  );
}

export function createTangentRow(openAgent: (serverId: string, agentId: string) => void) {
  return function TangentRow({ item, theme }: PluginTimelineItemProps<ReportRowData>) {
    const report = item.data;
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
      if (!copied) return;
      const timer = setTimeout(() => setCopied(false), 1500);
      return () => clearTimeout(timer);
    }, [copied]);

    const muted = theme.colors.foregroundMuted;
    const failed = report.status === "failed";
    const lineColor = failed ? theme.colors.statusDanger : muted;
    const title = report.title.startsWith(TITLE_PREFIX) ? report.title.slice(TITLE_PREFIX.length) : report.title;
    const peekText = useMemo(() => peek(report), [report.status, report.body]);
    const copy = () =>
      copyText(report.body).then(
        () => setCopied(true),
        () => toast.error("Could not copy. Select the text and copy it instead."),
      );

    return (
      <View style={[styles.root, { borderColor: withAlpha(muted, 0.45) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "Hide the tangent's answer" : "Show the tangent's answer"}
          onPress={() => setOpen(value => !value)}
          style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.line, hovered && { backgroundColor: theme.colors.surface2 }]}
        >
          <View style={styles.icon}>
            <Icon name={ICONS[report.status]} size={12} color={lineColor} />
          </View>
          <Text style={[LINE, styles.tag, { color: muted }]}>tangent</Text>
          <Text numberOfLines={1} style={[SMALL, styles.title, { color: muted, opacity: 0.75 }]}>{title}</Text>
          <Text style={[SMALL, { color: muted, opacity: 0.5 }]}>·</Text>
          <Text style={[SMALL, styles.status, { color: lineColor }]}>{`${VERBS[report.status]} ${report.took}`}</Text>
          {peekText && !open ? (
            <>
              <Text style={[SMALL, { color: muted, opacity: 0.5 }]}>·</Text>
              <Text numberOfLines={1} style={[SMALL, styles.flex, { color: lineColor, opacity: 0.8 }]}>{peekText}</Text>
            </>
          ) : (
            <View style={styles.flex} />
          )}
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={muted} />
        </Pressable>
        {open ? (
          <View style={[styles.rail, { borderColor: withAlpha(muted, 0.25) }]}>
            {report.status === "done" ? (
              <Markdown>{report.body}</Markdown>
            ) : failed ? (
              <Text selectable style={[LINE, { color: theme.colors.statusDanger }]}>{report.body}</Text>
            ) : (
              <Text style={[SMALL, { color: muted }]}>{`No answer: the tangent was ${report.status} before it finished.`}</Text>
            )}
            <View style={styles.foot}>
              <ActionButton icon="ArrowUpRight" label="Open the tangent" onPress={() => openAgent(report.serverId, report.agentId)} theme={theme} />
              {report.body ? (
                <ActionButton icon={copied ? "Check" : "Copy"} label={copied ? "Copied" : failed ? "Copy error" : "Copy result"} onPress={() => void copy()} theme={theme} />
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    );
  };
}

const styles = StyleSheet.create({
  root: { marginVertical: 2, borderWidth: 1, borderStyle: "dashed", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, marginHorizontal: -6, minHeight: 26, borderRadius: 6 },
  icon: { width: 14, alignItems: "center" },
  tag: { fontWeight: "600" },
  title: { flexShrink: 1, maxWidth: "45%" },
  status: { flexShrink: 0 },
  flex: { flex: 1, minWidth: 0 },
  rail: { marginLeft: 6, marginTop: 2, marginBottom: 6, paddingLeft: 14, paddingVertical: 2, borderLeftWidth: 2 },
  foot: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, marginLeft: -6 },
  action: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
});
