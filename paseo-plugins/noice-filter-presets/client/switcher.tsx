import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { labelStyle, PresetButtons } from "./buttons";
import { usePresetChoices, useWorkspaceRefs } from "./data";
import { type SidebarFilter, readRowHeight, readSelection, sidebarCss, writeRowHeight, writeSelection } from "./web";

const ALL = [{ id: "all", name: "All" }];

export function createSwitcher(client: PluginClientContext, filter: SidebarFilter) {
  return function PresetSwitcher({ theme, host }: PluginSidebarItemProps) {
    const { data, failed } = usePresetChoices(client, host.id);
    const workspaces = useWorkspaceRefs(client, host.id);
    const [selected, setSelected] = useState(readSelection);
    const [rowHeight] = useState(readRowHeight);
    const ready = data !== undefined;
    // While loading, the saved choice stands: the cached sheet is already showing it.
    const active = data && !data.choices.some(({ id }) => id === selected) ? "all" : selected;
    function select(id: string) { writeSelection(id); setSelected(id); }
    useEffect(() => {
      // All hides nothing, so it needs no data and applies at once, even while loading.
      if (active === "all") { filter.apply("", host.id); return; }
      // The workspace list is awaited too, so the first sheet is complete: it replaces the cached one shown since page load.
      if (!data || workspaces === undefined) return;
      const shown = new Set(data.shown(active));
      const hidden = data.projects.filter((project) => !shown.has(project));
      filter.apply(sidebarCss(host.id, data.projects, hidden, workspaces), host.id);
    }, [data, workspaces, active, host.id]);
    // Without definitions or projects nothing is hidden, not even the cached sheet.
    useEffect(() => { if (failed && !ready) filter.apply(""); }, [failed, ready]);
    // Cleared only when the switcher goes away, not between two applies.
    useEffect(() => () => filter.apply(""), []);
    useEffect(() => {
      if (!data) return;
      const remove = data.choices.map(({ id, name }) => client.addCommandCenterItem({
        id: `filter-${id}`, title: `Filter preset: ${name}`, icon: "ListFilter", context: "global",
        onSelect() { select(id); },
      }));
      return () => remove.forEach((cleanup) => cleanup());
    }, [data?.choices]);
    // All needs no data, so it is drawn at once; until the rest arrive, two faint static pills hold their place
    // and the row keeps its last height, so nothing below moves when it fills in.
    // onLayout from the first render: react-native-web only observes a view that has it when mounted.
    return <View onLayout={(event) => { if (ready) writeRowHeight(event.nativeEvent.layout.height); }} style={{
      flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", columnGap: 14,
      minHeight: ready ? undefined : rowHeight, marginHorizontal: 16, marginTop: 2, marginBottom: 2,
    }}>
      <PresetButtons theme={theme} choices={data?.choices ?? ALL} active={failed && !ready ? "all" : active} onSelect={select} />
      {ready ? null : failed
        ? <Text style={{ ...labelStyle, paddingTop: 3, color: theme.colors.foregroundMuted }}>Presets unavailable</Text>
        : [28, 36].map((width) => <View key={width}
          style={{ width, height: 6, marginTop: 6, borderRadius: 3, backgroundColor: theme.colors.surface2 }} />)}
    </View>;
  };
}
