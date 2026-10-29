import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { FlatList, Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScopeSchema, type Scope } from "../shared/rpc";
import { Interactive } from "./interactive";
import { PastSessionsList } from "./past-sessions-list";

/** What the sidebar row reopens: the screen's last workspace and scope, until the app reloads. */
export const lastScreenParams: { workspaceId?: string; scope?: Scope } = {};

export function PastSessionsScreen({ theme, layout, host, params, navigation }: PluginScreenProps) {
  const paseo = usePaseo();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenId, setChosenId] = useState<string | undefined>(params.workspaceId);
  const [scope, setScope] = useState<Scope>(ScopeSchema.catch("workspace").parse(params.scope));
  const workspaces = useQuery({
    queryKey: ["workspaces-by-activity"],
    queryFn: async () =>
      (
        await paseo.workspaces.list({
          sort: [{ key: "activity_at", direction: "desc" }],
          page: { limit: 200 },
        })
      ).entries,
  });
  const entries = workspaces.data ?? [];
  // Without an explicit choice, show the most recently active workspace.
  const workspace = entries.find((candidate) => candidate.id === chosenId) ?? entries[0];
  if (workspace) {
    lastScreenParams.workspaceId = workspace.id;
    lastScreenParams.scope = scope;
  }
  const { colors } = theme;
  const gutter = layout.compact ? 14 : 20;
  const focusRing = { outlineColor: colors.accent, outlineStyle: "solid", outlineWidth: 2 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <Icon name="LayoutGrid" size={16} color={colors.foregroundMuted} />
        <View style={styles.body}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }} numberOfLines={1}>
            {workspace ? workspace.projectDisplayName : " "}
          </Text>
          <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "600" }} numberOfLines={1}>
            {workspace ? workspace.name : workspaces.isError ? "Workspaces unavailable" : "Loading workspaces…"}
          </Text>
        </View>
        <Interactive
          accessibilityRole="button"
          accessibilityLabel="Switch workspace"
          testID="noice-past-sessions-folder-picker"
          onPress={() => setPickerOpen(true)}
          style={({ hovered, pressed, focused }) => [
            styles.switch,
            { borderColor: hovered ? colors.foregroundMuted : colors.border },
            hovered ? { backgroundColor: colors.surface1 } : null,
            pressed ? { backgroundColor: colors.surface2 } : null,
            focused ? focusRing : null,
          ]}
        >
          <Text style={{ color: colors.foreground, fontSize: 12 }}>Switch</Text>
          <Icon name="ChevronsUpDown" size={13} color={colors.foregroundMuted} />
        </Interactive>
      </View>
      {workspace ? (
        <PastSessionsList
          key={workspace.id}
          workspaceId={workspace.id}
          scope={scope}
          onScopeChange={setScope}
          theme={theme}
          serverId={host.id}
          compact={layout.compact}
          navigation={navigation}
        />
      ) : workspaces.isError ? (
        <Text style={{ color: colors.statusDanger, padding: gutter }}>{String(workspaces.error)}</Text>
      ) : null}
      <Modal
        title="Switch workspace"
        icon={<Icon name="LayoutGrid" size={18} color={colors.foreground} />}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
      >
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>
          <FlatList
            style={{ flex: 1, minHeight: 0 }}
            data={entries}
            keyExtractor={(candidate) => candidate.id}
            renderItem={({ item }) => {
              const selected = item.id === workspace?.id;
              return (
                <Interactive
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setChosenId(item.id);
                    setPickerOpen(false);
                  }}
                  style={({ hovered, pressed, focused }) => [
                    styles.option,
                    { borderTopColor: colors.border },
                    selected || hovered ? { backgroundColor: colors.surface1 } : null,
                    pressed ? { backgroundColor: colors.surface2 } : null,
                    focused ? { ...focusRing, outlineOffset: -2 } : null,
                  ]}
                >
                  <View style={styles.body}>
                    <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "500" }} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={{ color: colors.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
                      {item.projectDisplayName} · {item.workspaceDirectory ?? item.projectRootPath}
                    </Text>
                  </View>
                  {selected ? <Icon name="Check" size={16} color={colors.accent} /> : null}
                </Interactive>
              );
            }}
          />
        </Modal.Content>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12 },
  body: { flex: 1, minWidth: 0 },
  switch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
