import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { useOverview, useVisible } from "./data";
import { EffortView } from "./effort-view";
import { colorsOf, ROW, SMALL } from "./marks";
import { bindOrToast } from "./runtime";
import { Button } from "./ui";
import { UnboundView } from "./unbound-view";

/** The Efforts tab: this workspace's effort, or the suggestion and picker when it has none. */
export function EffortsPanel({ workspaceId, theme, layout, navigation }: PluginWorkspacePanelProps) {
  const c = colorsOf(theme);
  const toast = useToast();
  const { visible, onLayout } = useVisible();
  const overview = useOverview(visible);
  const workspace = overview.data?.workspaces.find((candidate) => candidate.id === workspaceId);
  const binding = workspace?.binding;
  let body;
  if (!overview.data) {
    body = (
      <Text style={{ ...SMALL, color: c.muted, padding: 12 }}>
        {overview.isError ? `Efforts unavailable: ${String(overview.error)}` : "Loading efforts…"}
      </Text>
    );
  } else if (binding?.kind === "effort") {
    body = (
      <EffortView
        theme={theme}
        compact={layout.compact}
        effort={{ root: binding.root, slug: binding.slug }}
        workspaceId={workspaceId}
        workspaceName={workspace?.name ?? null}
        mode="panel"
        openAgent={(agentId) => navigation?.openAgent({ agentId })}
      />
    );
  } else if (binding?.kind === "none") {
    body = (
      <View style={{ padding: 12, gap: 8 }}>
        <Text style={{ ...ROW, color: c.fg, fontWeight: "600" }}>No effort</Text>
        <Text style={{ ...SMALL, color: c.muted }}>You said {workspace?.name ?? "this workspace"} serves no effort, so nothing is suggested.</Text>
        <View style={{ flexDirection: "row" }}>
          <Button c={c} label="Choose an effort" onPress={() => bindOrToast(toast, workspaceId, { kind: "clear" })} />
        </View>
      </View>
    );
  } else {
    body = <UnboundView theme={theme} compact={layout.compact} workspaceId={workspaceId} mode="unbound" />;
  }
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: c.s0 }} onLayout={onLayout}>
      {body}
    </View>
  );
}
