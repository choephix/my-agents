import { useSettings, type PluginClientContext, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { compilePreset, preferences } from "../shared/presets";
import { useProjects, useWorkspaceRefs } from "./data";
import { type SidebarFilter, readSelection, sidebarCss, writeSelection } from "./web";

export function createSwitcher(client: PluginClientContext, filter: SidebarFilter) {
  return function PresetSwitcher({ theme, host }: PluginSidebarItemProps) {
    const settings = useSettings(preferences);
    const projects = useProjects(client, host.id);
    const workspaces = useWorkspaceRefs(client, host.id);
    const [selected, setSelected] = useState(readSelection);
    const presets = settings.status === "ready" ? settings.values.presets : undefined;
    const groups = useMemo(() => presets?.map((preset) => ({ ...preset, matches: compilePreset(preset) })), [presets]);
    const other = useMemo(() => projects.data?.filter((project) => !groups?.some((group) => group.matches(project))), [projects.data, groups]);
    const choices = useMemo(() => [
      { id: "all", name: "All" },
      ...(groups ?? []).map(({ id, name }) => ({ id, name })),
      ...(other?.length ? [{ id: "other", name: "Other" }] : []),
    ], [groups, other]);
    const ready = !!groups && !!projects.data;
    const active = ready && choices.some(({ id }) => id === selected) ? selected : "all";
    function select(id: string) { writeSelection(id); setSelected(id); }
    // The workspace list is awaited too, so the first sheet is complete: it replaces the cached one shown since page load.
    const sheetReady = ready && workspaces !== undefined;
    useEffect(() => {
      if (!sheetReady) return;
      const group = groups.find(({ id }) => id === active);
      const hidden = active === "all" ? [] : active === "other"
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
    if (!ready) return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, padding: 6 }}>
      {failed ? "Filter presets unavailable" : "Loading filter presets…"}
    </Text>;
    // Small-caps labels; the active one sits on a 2px accent bar (no hairline: Paseo already draws dividers here).
    return <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, marginHorizontal: 16, marginTop: 2, marginBottom: 2 }}>
      {choices.map(({ id, name }) => {
        const on = active === id;
        return <Pressable key={id} testID={`filter-preset-${id}`} accessibilityRole="button"
          accessibilityLabel={`Filter preset: ${name}`} accessibilityState={{ selected: on }} onPress={() => select(id)}
          hitSlop={{ top: 6, bottom: 2, left: 4, right: 4 }}
          style={{ paddingTop: 3, paddingBottom: 2, borderBottomWidth: 2, borderBottomColor: on ? theme.colors.accent : "transparent" }}>
          {(state) => <Text style={{
            fontSize: 9.5, lineHeight: 12, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: on ? "600" : "500",
            // react-native-web adds `hovered` to the pressable state; native never sets it.
            color: on || ("hovered" in state && state.hovered === true) ? theme.colors.foreground : theme.colors.foregroundMuted,
          }}>{name}</Text>}
        </Pressable>;
      })}
    </View>;
  };
}
