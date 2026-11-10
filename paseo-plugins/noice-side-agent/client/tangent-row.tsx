import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { copyText, Icon, Markdown, StreamedText, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import type { EndedRow, ParsedReport, RunningRow } from "../shared/report";

/*
 * A tangent in its parent chat, in two parts:
 * - where /tangent was sent: your words in a transparent dashed bubble on your side (only the
 *   tangent sees them), and under it its status; one click opens the tangent;
 * - where the report message arrives: the answer, drawn like an agent reply, since the parent
 *   model reads it. The report text itself is unchanged for the parent model.
 */

const STATUS = z.enum(["done", "failed", "stopped", "archived"]);

export const ReportRowData = z.object({
  title: z.string(),
  status: STATUS,
  took: z.string(),
  body: z.string(),
  link: z.string(),
  agentId: z.string(),
  serverId: z.string(),
}) satisfies z.ZodType<ParsedReport>;
export type ReportRowData = z.infer<typeof ReportRowData>;

const RunningRowData = z.object({
  status: z.literal("running"),
  title: z.string(),
  task: z.string().optional(),
  startedAt: z.number(),
  step: z.string(),
  agentId: z.string(),
  serverId: z.string(),
}) satisfies z.ZodType<RunningRow>;
/** Rows from before this shape (the whole report in the row) still parse: extra fields are dropped. */
const EndedRowData = z.object({
  status: STATUS,
  title: z.string(),
  task: z.string().optional(),
  took: z.string(),
  agentId: z.string(),
  serverId: z.string(),
}) satisfies z.ZodType<EndedRow>;
/** The row the server keeps where /tangent was sent. */
export const TangentRowData = z.union([RunningRowData, EndedRowData]);
export type TangentRowData = z.infer<typeof TangentRowData>;

const UI_FONT = Platform.select({ web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" });
const SMALL = { fontSize: 12, lineHeight: 18, fontFamily: UI_FONT };
const LINE = { fontSize: 13, lineHeight: 20, fontFamily: UI_FONT };
const TITLE_PREFIX = "Tangent: ";
const ICONS = { done: "CornerDownRight", failed: "CircleAlert", stopped: "CircleStop", archived: "Archive" } as const;
const VERBS = { done: "done in", failed: "failed after", stopped: "stopped after", archived: "archived after" } as const;
/** Where the status line points: the answer is drawn further down, where the report arrives. */
const BELOW = { done: "answered below", failed: "error below", stopped: "", archived: "" } as const;

const shortTitle = (title: string) => (title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length) : title);

/** `0:42`, `12:05`, `1:02:05`. */
function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** `#rrggbb` / `#rgb` with an alpha; other colour forms unchanged. */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const full = hex.length === 3 ? [...hex].map(c => c + c).join("") : hex;
  return `#${full}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

function IconButton({ icon, label, onPress, theme }: { icon: string; label: string; onPress(): void; theme: PluginTheme }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.iconButton, (pressed || hovered) && { backgroundColor: theme.colors.surface2 }]}
    >
      {({ hovered }: { pressed: boolean; hovered?: boolean }) => <Icon name={icon} size={14} color={hovered ? theme.colors.foreground : theme.colors.foregroundMuted} />}
    </Pressable>
  );
}

type OpenAgent = (serverId: string, agentId: string) => void;

/** Ticks once a second; mounted only while the tangent runs. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const Dot = ({ color }: { color: string }) => <Text style={[SMALL, { color, opacity: 0.5 }]}>·</Text>;

function RunningStatus({ row, muted }: { row: RunningRow; muted: string }) {
  const now = useNow();
  return (
    <>
      <Icon name="LoaderCircle" size={12} color={muted} />
      <Text style={[LINE, styles.tag, { color: muted }]}>tangent</Text>
      <Dot color={muted} />
      <Text style={[SMALL, styles.fixed, { color: muted, fontVariant: ["tabular-nums"] }]}>{`running ${elapsed(now - row.startedAt)}`}</Text>
      {row.step ? (
        <>
          <Dot color={muted} />
          <Text numberOfLines={1} style={[SMALL, styles.shrink, { color: muted, opacity: 0.8 }]}>{row.step}</Text>
        </>
      ) : null}
    </>
  );
}

function EndedStatus({ row, theme }: { row: EndedRow; theme: PluginTheme }) {
  const muted = theme.colors.foregroundMuted;
  const color = row.status === "failed" ? theme.colors.statusDanger : muted;
  return (
    <>
      <Icon name={ICONS[row.status]} size={12} color={color} />
      <Text style={[LINE, styles.tag, { color: muted }]}>tangent</Text>
      <Dot color={muted} />
      <Text style={[SMALL, styles.fixed, { color }]}>{`${VERBS[row.status]} ${row.took}`}</Text>
      {BELOW[row.status] ? (
        <>
          <Dot color={muted} />
          <Text numberOfLines={1} style={[SMALL, styles.shrink, { color: muted, opacity: 0.8 }]}>{BELOW[row.status]}</Text>
        </>
      ) : null}
    </>
  );
}

/** Where /tangent was sent: your words, then the tangent's status. */
function SentRow({ row, theme, openAgent }: { row: TangentRowData; theme: PluginTheme; openAgent: OpenAgent }) {
  const muted = theme.colors.foregroundMuted;
  return (
    <View style={styles.sent}>
      <View style={[styles.bubble, { borderColor: withAlpha(muted, 0.5) }]}>
        <StreamedText selectable text={row.task || shortTitle(row.title)} phase="complete" />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open the tangent"
        onPress={() => openAgent(row.serverId, row.agentId)}
        style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.line, hovered && { backgroundColor: theme.colors.surface2 }]}
      >
        {row.status === "running" ? <RunningStatus row={row} muted={muted} /> : <EndedStatus row={row} theme={theme} />}
        <Icon name="ArrowUpRight" size={12} color={muted} />
      </Pressable>
    </View>
  );
}

/** Where the report message arrives: the answer, as the parent model reads it. */
function Answer({ report, theme, openAgent }: { report: ReportRowData; theme: PluginTheme; openAgent: OpenAgent }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const muted = theme.colors.foregroundMuted;
  const danger = theme.colors.statusDanger;
  const failed = report.status === "failed";
  const copy = () =>
    copyText(report.body).then(
      () => setCopied(true),
      () => toast.error("Could not copy. Select the text and copy it instead."),
    );

  return (
    <View style={styles.answer}>
      <View style={styles.head}>
        <Icon name={ICONS[report.status]} size={12} color={failed ? danger : muted} />
        <Text style={[LINE, styles.tag, { color: muted }]}>tangent</Text>
        <Dot color={muted} />
        <Text numberOfLines={1} style={[SMALL, styles.shrink, { color: muted, opacity: 0.75 }]}>{shortTitle(report.title)}</Text>
        {report.status !== "done" ? (
          <>
            <Dot color={muted} />
            <Text style={[SMALL, styles.fixed, { color: failed ? danger : muted }]}>
              {failed ? `failed after ${report.took}` : `${VERBS[report.status]} ${report.took}, before it answered`}
            </Text>
          </>
        ) : null}
      </View>
      {report.status === "done" ? (
        <View style={styles.body}><Markdown>{report.body}</Markdown></View>
      ) : failed ? (
        <View style={styles.body}><StreamedText selectable text={report.body} phase="complete" style={{ color: danger }} /></View>
      ) : null}
      <View style={styles.foot}>
        {report.body ? (
          <IconButton icon={copied ? "Check" : "Copy"} label={copied ? "Copied" : failed ? "Copy the error" : "Copy the answer"} onPress={() => void copy()} theme={theme} />
        ) : null}
        <IconButton icon="ArrowUpRight" label="Open the tangent" onPress={() => openAgent(report.serverId, report.agentId)} theme={theme} />
        <Text style={[LINE, { color: muted }]}>{report.status === "done" ? `Tangent worked for ${report.took}` : "Open the tangent"}</Text>
      </View>
    </View>
  );
}

export function createTangentRows(openAgent: OpenAgent) {
  function TangentRow({ item, theme }: PluginTimelineItemProps<TangentRowData>) {
    return <SentRow row={item.data} theme={theme} openAgent={openAgent} />;
  }
  function ReportMessageRow({ item, theme }: PluginTimelineItemProps<ReportRowData>) {
    return <Answer report={item.data} theme={theme} openAgent={openAgent} />;
  }
  return { TangentRow, ReportMessageRow };
}

const styles = StyleSheet.create({
  sent: { alignSelf: "flex-end", alignItems: "flex-end", maxWidth: "100%", marginTop: 4, marginBottom: 12 },
  bubble: { maxWidth: "100%", borderWidth: 1, borderStyle: "dashed", borderRadius: 16, borderTopRightRadius: 2, padding: 16 },
  line: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%", minHeight: 26, marginTop: 4, paddingHorizontal: 6, borderRadius: 6 },
  tag: { fontWeight: "600" },
  fixed: { flexShrink: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  answer: { marginBottom: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 },
  body: { marginTop: 4 },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 8 },
  iconButton: { width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 6 },
});
