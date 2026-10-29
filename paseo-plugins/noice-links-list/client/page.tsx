import { useWorkspace, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import type { LinkKind } from "../shared/links";
import { KIND_LABEL, LinkRow, listStyles, SubagentsSwitch, TypeTabs, useLinkPress, type PressState } from "./list-ui";
import { ProviderGlyph } from "./provider-glyph";
import { kindCounts, shownKind, subagentChoices, typeChoices, type LinksStore, type WorkspaceLinks } from "./store";
import { loadDeviceValue, saveDeviceValue } from "./web";
import { byTab, bySite, flatRows, GROUPINGS, searchFilter, subagentExtra, type Grouping, type PageGroup, type PageRow } from "./workspace";

/** While any agent of the workspace runs, a visible links page refetches this often. */
const RUNNING_REFRESH_MS = 3_000;
const GROUPING_KEY = "mentioned-links.grouping";
/** The page's content column; wider tabs center it. */
const COLUMN_WIDTH = 960;

function subscribeAppState(listener: () => void) {
  const subscription = AppState.addEventListener("change", listener);
  return () => subscription.remove();
}

/** Folded groups per workspace and grouping, for this app session; closed tabs start folded. */
const folds = new Map<string, boolean>();

type Theme = PluginWorkspacePanelProps["theme"];

function pageStyles(theme: Theme, compact: boolean) {
  const muted = theme.colors.foregroundMuted;
  return {
    root: { flex: 1, backgroundColor: theme.colors.surface0 },
    column: { width: "100%" as const, maxWidth: COLUMN_WIDTH, alignSelf: "center" as const, paddingHorizontal: 16 },
    top: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, height: 40 },
    title: { fontSize: 13, fontWeight: "600" as const, color: theme.colors.foreground },
    workspace: { flex: 1, minWidth: 0, fontSize: 13, color: muted },
    iconButton: { width: compact ? 32 : 24, height: compact ? 32 : 24, borderRadius: 6, alignItems: "center" as const, justifyContent: "center" as const },
    iconButtonOn: { backgroundColor: theme.colors.surface2 },
    search: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      height: compact ? 36 : 28,
      paddingHorizontal: 8,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
      marginBottom: 8,
    },
    searchFocused: { borderColor: muted },
    // The field's border shows focus; the browser's own outline would draw a second box inside it.
    searchInput: { flex: 1, minWidth: 0, height: "100%" as const, fontSize: 13, color: theme.colors.foreground, padding: 0, outlineWidth: 0 },
    body: { paddingBottom: 24 },
    group: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, height: compact ? 36 : 28, marginTop: 4 },
    groupTitle: { flexShrink: 1, fontSize: 13, color: theme.colors.foreground },
    groupTitleClosed: { flexShrink: 1, fontSize: 13, color: muted },
    groupCount: { fontSize: 11, color: muted, fontVariant: ["tabular-nums" as const] },
    groupRows: { paddingLeft: 18 },
    separator: { fontSize: 11, color: muted, marginTop: 16, marginBottom: 2 },
    tabCell: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, flexShrink: 0, maxWidth: compact ? 120 : 200 },
    tabClosed: { opacity: 0.5 },
    tabName: { flexShrink: 1, fontSize: 12, color: muted },
    tabNameHover: { flexShrink: 1, fontSize: 12, color: muted, textDecorationLine: "underline" as const },
    tabMore: { fontSize: 11, color: muted, opacity: 0.7, fontVariant: ["tabular-nums" as const] },
    empty: { paddingVertical: 24, gap: 4 },
    noMatch: { paddingVertical: 12 },
    emptyTitle: { fontSize: 13, color: theme.colors.foreground },
    // The settings menu: a dropdown under its button on wide layouts, a bottom sheet on phones.
    backdrop: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 10,
      backgroundColor: compact ? "rgba(0,0,0,0.4)" : "transparent",
    },
    menu: compact
      ? {
          position: "absolute" as const,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 11,
          paddingHorizontal: 8,
          paddingTop: 8,
          paddingBottom: 24,
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          backgroundColor: theme.colors.surface1,
        }
      : {
          position: "absolute" as const,
          top: 36,
          right: 16,
          zIndex: 11,
          width: 200,
          padding: 4,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
    menuHeading: { fontSize: 12, color: muted, paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4 },
    menuItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      height: compact ? 40 : 28,
      paddingHorizontal: 8,
      borderRadius: 6,
    },
    menuText: { fontSize: 13, color: theme.colors.foreground },
  };
}

/**
 * The workspace's links as a tab in its main area: a small title, search, the popover's type tabs and
 * `+N subagents` switch, and a settings menu (Grouping: Flat / By tab / By site). Fetched when it
 * becomes visible, every 3 s while any of the workspace's agents runs, nothing while hidden.
 */
export function createLinksPage(store: LinksStore<WorkspaceLinks>, show: (workspaceId: string, refresh: boolean) => () => void) {
  const subscribe = (listener: () => void) => store.subscribe(listener);

  return function LinksPage(props: PluginWorkspacePanelProps) {
    const { theme, layout, navigation, workspaceId } = props;
    const { compact } = layout;
    const entry = useSyncExternalStore(subscribe, () => store.get(workspaceId));
    const name = useWorkspace(workspaceId, (workspace) => workspace.name);
    const running = useWorkspace(workspaceId, (workspace) => workspace.status === "running") ?? false;
    // Hidden workspace decks measure 0 wide; the app in the background is hidden too.
    const [width, setWidth] = useState(-1);
    const active = useSyncExternalStore(subscribeAppState, () => AppState.currentState !== "background");
    const visible = active && width !== 0;
    const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);

    const [query, setQuery] = useState("");
    const [choice, setChoice] = useState<LinkKind | undefined>(() => typeChoices.get(workspaceId));
    const [subagentsShown, setSubagentsShown] = useState(() => subagentChoices.has(workspaceId));
    const [grouping, setGrouping] = useState<Grouping>(() => {
      const saved = loadDeviceValue(GROUPING_KEY);
      return GROUPINGS.find((option) => option.value === saved)?.value ?? "flat";
    });
    const [menuOpen, setMenuOpen] = useState(false);
    const [searchFocused, setSearchFocused] = useState(false);
    const [, setFoldsVersion] = useState(0);
    const { press, open, copied } = useLinkPress();

    // Registered before the first refresh, so the page's own fetch already includes sub-agents.
    useEffect(() => store.watchSubagents(workspaceId), [workspaceId]);
    useEffect(() => (visible ? show(workspaceId, true) : undefined), [visible, workspaceId]);
    useEffect(() => {
      if (!visible || !running) return;
      const timer = setInterval(() => void store.refresh(workspaceId), RUNNING_REFRESH_MS);
      return () => clearInterval(timer);
    }, [visible, running, workspaceId]);

    const choose = (kind: LinkKind) => {
      typeChoices.set(workspaceId, kind);
      setChoice(kind);
    };
    const toggleSubagents = () => {
      if (subagentsShown) subagentChoices.delete(workspaceId);
      else subagentChoices.add(workspaceId);
      setSubagentsShown(!subagentsShown);
    };
    const pickGrouping = (value: Grouping) => {
      saveDeviceValue(GROUPING_KEY, value);
      setGrouping(value);
      setMenuOpen(false);
    };
    const foldKey = (group: PageGroup) => `${workspaceId}|${group.key}`;
    const folded = (group: PageGroup) => folds.get(foldKey(group)) ?? !!group.tab?.closed;
    const toggleFold = (group: PageGroup) => {
      folds.set(foldKey(group), !folded(group));
      setFoldsVersion((version) => version + 1);
    };

    const styles = listStyles(theme, compact);
    const page = useMemo(() => pageStyles(theme, compact), [theme, compact]);
    const muted = theme.colors.foregroundMuted;
    const tabs = entry.data?.tabs ?? [];
    const all = flatRows(tabs, subagentsShown);
    const allLinks = all.map((row) => row.link);
    const kinds = kindCounts(allLinks);
    const shown = shownKind(allLinks, choice);
    const match = searchFilter(query);
    const searched = kindCounts(allLinks.filter(match));
    const tabCounts = kinds.map(({ kind }) => ({ kind, count: searched.find((entry) => entry.kind === kind)?.count ?? 0 }));
    const keep = (link: PageRow["link"]) => link.kind === shown && match(link);
    const extra = subagentExtra(tabs);
    const now = Date.now();

    const tabCell = (row: PageRow) => {
      const content = (hovered: boolean) => (
        <>
          <ProviderGlyph provider={row.tab.provider} size={12} color={muted} />
          <Text numberOfLines={1} style={hovered ? page.tabNameHover : page.tabName}>
            {row.tab.title}
          </Text>
          {row.others ? <Text style={page.tabMore}>{`+${row.others}`}</Text> : null}
        </>
      );
      const style = [page.tabCell, row.tab.closed && page.tabClosed];
      // Paseo shows no tab for a closed (archived) agent, so `openAgent` would do nothing there.
      if (!navigation || row.tab.closed) {
        return (
          <View accessibilityLabel={row.tab.closed ? `From the closed tab ${row.tab.title}` : undefined} style={style}>
            {content(false)}
          </View>
        );
      }
      return (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open the tab ${row.tab.title}`}
          onPress={() => navigation.openAgent({ agentId: row.tab.agentId })}
          hitSlop={4}
          style={style}
        >
          {({ hovered }: PressState) => content(!!hovered)}
        </Pressable>
      );
    };
    const linkRow = (row: PageRow, withTab: boolean) => (
      <LinkRow
        key={`${row.tab.agentId}|${row.link.key}`}
        theme={theme}
        compact={compact}
        link={row.link}
        now={now}
        copied={copied === row.link.key}
        onPress={press}
        onOpen={open}
        foldKey={`${workspaceId}|${row.tab.agentId}|${row.link.key}`}
        tab={withTab ? tabCell(row) : undefined}
      />
    );
    const groupHeader = (group: PageGroup) => {
      const isFolded = folded(group);
      const closed = !!group.tab?.closed;
      return (
        <Pressable
          key={`head|${group.key}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: !isFolded }}
          accessibilityLabel={`${isFolded ? "Show" : "Hide"} ${group.title}`}
          onPress={() => toggleFold(group)}
          style={page.group}
        >
          <Icon name={isFolded ? "ChevronRight" : "ChevronDown"} size={12} color={muted} />
          {group.tab ? (
            <View style={closed ? page.tabClosed : undefined}>
              <ProviderGlyph provider={group.tab.provider} size={12} color={muted} />
            </View>
          ) : null}
          <Text numberOfLines={1} style={closed ? page.groupTitleClosed : page.groupTitle}>
            {group.title}
          </Text>
          <Text style={page.groupCount}>{group.rows.length}</Text>
        </Pressable>
      );
    };
    const groupBlock = (group: PageGroup, withTab: boolean) => [
      groupHeader(group),
      folded(group) ? null : (
        <View key={`rows|${group.key}`} style={page.groupRows}>
          {group.rows.map((row) => linkRow(row, withTab))}
        </View>
      ),
    ];

    let body: ReactNode;
    if (!entry.data) {
      body = <Text style={styles.line}>{entry.error ? `Couldn't read this workspace: ${entry.error}` : "Loading…"}</Text>;
    } else if (!all.length && !extra) {
      body = (
        <View style={page.empty}>
          <Text style={page.emptyTitle}>No links in this workspace yet</Text>
          <Text style={styles.line}>Pages, images and files that you or the agents mention in this workspace's chats show up here.</Text>
        </View>
      );
    } else {
      let shownRows: number;
      if (grouping === "tab") {
        const groups = byTab(tabs, subagentsShown, keep);
        const firstClosed = groups.findIndex((group) => group.tab?.closed);
        shownRows = groups.length;
        body = groups.flatMap((group, index) => [
          index === firstClosed ? (
            <Text key="closed" style={page.separator}>
              Closed
            </Text>
          ) : null,
          ...groupBlock(group, false),
        ]);
      } else {
        const rows = all.filter((row) => keep(row.link));
        shownRows = rows.length;
        body = grouping === "site" ? bySite(rows).flatMap((group) => groupBlock(group, true)) : rows.map((row) => linkRow(row, true));
      }
      if (!shownRows) {
        const elsewhere = shown && searched.some((entry) => entry.kind !== shown) ? ` in ${KIND_LABEL[shown].toLowerCase()}` : "";
        body = <Text style={[styles.line, page.noMatch]}>{query.trim() ? `No links match “${query.trim()}”${elsewhere}` : "No links here yet"}</Text>;
      }
    }

    return (
      <View style={page.root} onLayout={onLayout}>
        <View style={page.column}>
          <View style={page.top}>
            <Text style={page.title}>Links</Text>
            <Text numberOfLines={1} style={page.workspace}>
              {name ?? ""}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View settings"
              accessibilityState={{ expanded: menuOpen }}
              onPress={() => setMenuOpen(!menuOpen)}
              style={({ hovered }: PressState) => [page.iconButton, (hovered || menuOpen) && page.iconButtonOn]}
            >
              <Icon name="SlidersHorizontal" size={14} color={muted} />
            </Pressable>
          </View>
          <View style={[page.search, searchFocused && page.searchFocused]}>
            <Icon name="Search" size={12} color={muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={all.length ? `Search ${all.length} ${all.length === 1 ? "link" : "links"}` : "Search links"}
              placeholderTextColor={muted}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              accessibilityLabel="Search links"
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={page.searchInput}
            />
            {query ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery("")} hitSlop={6}>
                <Icon name="X" size={12} color={muted} />
              </Pressable>
            ) : null}
          </View>
          {kinds.length > 1 || extra ? (
            <View style={styles.header}>
              <View style={styles.tabs}>
                {kinds.length > 1 ? <TypeTabs theme={theme} compact={compact} kinds={tabCounts} shown={shown} onChoose={choose} /> : null}
              </View>
              {extra ? <SubagentsSwitch theme={theme} compact={compact} extra={extra} on={subagentsShown} onToggle={toggleSubagents} /> : null}
            </View>
          ) : null}
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={page.body} keyboardShouldPersistTaps="handled">
          <View style={page.column}>
            {body}
          </View>
        </ScrollView>
        {menuOpen ? (
          <>
            <Pressable accessibilityLabel="Close view settings" onPress={() => setMenuOpen(false)} style={page.backdrop} />
            {/* The dropdown sits under the settings button at the column's right edge. */}
            <View accessibilityRole="menu" style={[page.menu, !compact && { right: Math.max(0, (width - COLUMN_WIDTH) / 2) + 16 }]}>
              <Text style={page.menuHeading}>Grouping</Text>
              {GROUPINGS.map((option) => {
                const on = option.value === grouping;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="menuitem"
                    accessibilityState={{ checked: on }}
                    onPress={() => pickGrouping(option.value)}
                    style={({ hovered }: PressState) => [page.menuItem, hovered && page.iconButtonOn]}
                  >
                    <Text style={page.menuText}>{option.label}</Text>
                    {on ? <Icon name="Check" size={14} color={muted} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </View>
    );
  };
}
