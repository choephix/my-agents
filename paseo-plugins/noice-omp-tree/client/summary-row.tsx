import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { z } from "zod";
import type { SummaryItemSchema } from "../shared/tree";

const UI_FONT = Platform.select({ web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" });

/** OMP's summary as plain text: without its fixed preface and markdown emphasis/heading marks. */
function readable(summary: string): string {
  return summary
    .replace(/^User explored another conversation branch, then returned here\.\s*Exploration summary:\s*/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

type Rpc = (agentId: string, callId: string) => Promise<{ summary: string | null; focus: string | null }>;

/**
 * Paseo replays OMP's `branch_summary` entry as "[branch_summary] Unsupported history record".
 * This row replaces it: a muted folded "Summary of the branch you left" (with the focus it was
 * written for); unfolding shows the summary text, read from the session file.
 */
export function createSummaryRow(fetchSummary: Rpc) {
  return function SummaryRow({ agentId, item, theme }: PluginTimelineItemProps<z.infer<typeof SummaryItemSchema>>) {
    const [open, setOpen] = useState(false);
    const [data, setData] = useState<{ summary: string | null; focus: string | null } | "loading" | "error">("loading");
    const muted = theme.colors.foregroundMuted;
    // Fetched up front: the folded row shows the focus the summary was written for.
    useEffect(() => {
      let live = true;
      fetchSummary(agentId, item.data.callId).then(
        result => live && setData(result),
        () => live && setData("error"),
      );
      return () => {
        live = false;
      };
    }, [agentId, item.data.callId]);

    const toggle = () => setOpen(!open);

    const focus = data && typeof data === "object" ? data.focus : null;
    return (
      <View style={styles.wrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "Fold summary" : "Show summary of the branch you left"}
          onPress={toggle}
          style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, hovered && { backgroundColor: theme.colors.surface2 }]}
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={muted} />
          <Text style={[styles.text, { color: muted }]}>
            Summary of the branch you left
            {focus ? <Text style={{ opacity: 0.7 }}> · focus: {focus}</Text> : null}
          </Text>
        </Pressable>
        {open ? (
          <View style={[styles.body, { borderColor: theme.colors.surface2 }]}>
            <Text selectable style={[styles.bodyText, { color: muted }]}>
              {data === "loading"
                ? "Loading…"
                : data === "error"
                  ? "Could not load the summary."
                  : data.summary
                    ? readable(data.summary)
                    : "This summary is not on the current path."}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", maxWidth: "100%", marginLeft: -6, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  text: { fontSize: 12.5, lineHeight: 17, fontFamily: UI_FONT, flexShrink: 1 },
  body: { marginTop: 2, marginLeft: 4, paddingLeft: 12, paddingVertical: 2, borderLeftWidth: 1.5 },
  bodyText: { fontSize: 13, lineHeight: 19, fontFamily: UI_FONT },
});
