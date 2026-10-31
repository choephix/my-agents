import { useSettings, type PluginClientContext, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { compilePreset, preferences } from "../shared/presets";
import { useProjects, useWorkspaceRefs } from "./data";
import { type SidebarFilter, readRowHeight, readSelection, sidebarCss, writeRowHeight, writeSelection } from "./web";

export function createSwitcher(client: PluginClientContext, filter: SidebarFilter) {
  return function PresetSwitcher({ theme, host }: PluginSidebarItemProps) {
    const settings = useSettings(preferences);
    const projects = useProjects(client, host.id);
    const workspaces = useWorkspaceRefs(client, host.id);
    const [selected, setSelected] = useState(readSelection);
    const [rowHeight] = useState(readRowHeight);
    const presets = settings.status === "ready" ? settings.values.presets : undefined;
    const groups = useMemo(() => presets?.map((preset) => ({ ...preset, matches: compilePreset(preset) })), [presets]);
    const other = useMemo(() => projects.data?.filter((project) => !groups?.some((group) => group.matches(project))), [projects.data, groups]);
    const choices = useMemo(() => [
      { id: "all", name: "All" },
      ...(groups ?? []).map(({ id, name }) => ({ id, name })),
      ...(other?.length ? [{ id: "other", name: "Other" }] : []),
    ], [groups, other]);
    const ready = !!groups && !!projects.data;
    // While loading, the saved choice stands: the cached sheet is already showing it.
    const active = ready && !choices.some(({ id }) => id === selected) ? "all" : selected;
    function select(id: string) { writeSelection(id); setSelected(id); }
    // The workspace list is awaited too, so the first sheet is complete: it replaces the cached one shown since page load.
    const sheetReady = ready && workspaces !== undefined;
    useEffect(() => {
      // All hides nothing, so it needs no data and applies at once, even while loading.
      if (active === "all") { filter.apply("", host.id); return; }
      if (!sheetReady) return;
      const group = groups.find(({ id }) => id === active);
      const hidden = active === "other"
        ? projects.data.filter((project) => !other!.includes(project))
        : projects.data.filter((project) => !group!.matches(project));
      filter.apply(sidebarCss(host.id, projects.data, hidden, workspaces), host.id);
    }, [sheetReady, groups, projects.data, workspaces, other, active, host.id]);
    const failed = projects.isError || settings.status === "error" || settings.status === "invalid";
    // Without definitions or projects nothing is hidden, not even the cached sheet.
    useEffect(() => { if (failed && !ready) filter.apply(""); }, [failed, ready]);
    // Cleared only when the switcher goes away, not between two applies.
    useEffect(() => () => filter.apply(""), []);
    useEffect(() => {
      if (!ready) return;
      const remove = choices.map(({ id, name }) => client.addCommandCenterItem({
        id: `filter-${id}`, title: `Filter preset: ${name}`, icon: "ListFilter", context: "global",
        onSelect() { select(id); },
      }));
      return () => remove.forEach((cleanup) => cleanup());
    }, [ready, choices]);
    // All needs no data, so it is drawn at once; until the rest arrive, two faint static pills hold their place
    // and the row keeps its last height, so nothing below moves when it fills in.
    const shown = failed && !ready ? "all" : active;
    const label = { fontSize: 9.5, lineHeight: 12, letterSpacing: 0.8, textTransform: "uppercase" } as const;
    // Small-caps labels; the active one sits on a 2px accent bar (no hairline: Paseo already draws dividers here).
    // onLayout from the first render: react-native-web only observes a view that has it when mounted.
    return <View onLayout={(event) => { if (ready) writeRowHeight(event.nativeEvent.layout.height); }} style={{
      flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", columnGap: 14,
      minHeight: ready ? undefined : rowHeight, marginHorizontal: 16, marginTop: 2, marginBottom: 2,
    }}>
      {(ready ? choices : choices.slice(0, 1)).map(({ id, name }) => {
        const on = shown === id;
        return <Pressable key={id} testID={`filter-preset-${id}`} accessibilityRole="button"
          accessibilityLabel={`Filter preset: ${name}`} accessibilityState={{ selected: on }} onPress={() => select(id)}
          hitSlop={{ top: 6, bottom: 2, left: 4, right: 4 }}
          style={{ paddingTop: 3, paddingBottom: 2, borderBottomWidth: 2, borderBottomColor: on ? theme.colors.accent : "transparent" }}>
          {(state) => <Text style={{
            ...label, fontWeight: on ? "600" : "500",
            // react-native-web adds `hovered` to the pressable state; native never sets it.
            color: on || ("hovered" in state && state.hovered === true) ? theme.colors.foreground : theme.colors.foregroundMuted,
          }}>{name}</Text>}
        </Pressable>;
      })}
      {ready ? null : failed
        ? <Text style={{ ...label, paddingTop: 3, color: theme.colors.foregroundMuted }}>Presets unavailable</Text>
        : [28, 36].map((width) => <View key={width}
          style={{ width, height: 6, marginTop: 6, borderRadius: 3, backgroundColor: theme.colors.surface2 }} />)}
    </View>;
  };
}
