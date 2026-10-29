import type { PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { EffortSummary, Overview, Root, WorkspaceInfo } from "../shared/rpc";
import { usePrefetch, useOverview, useSearch, useVisible } from "./data";
import { EffortView } from "./effort-view";
import { age, openWords } from "./format";
import { Interactive } from "./interactive";
import { Menu } from "./legend";
import { Bar, colorsOf, LABEL, SMALL, Tag, WsChip } from "./marks";
import { chipPrefix, nextText, WEEK_MS, workspacesOf } from "./model";
import { openPanel, SCREEN_ID } from "./runtime";
import { SearchResults } from "./search-results";
import { setViewState, viewKey, type Page } from "./state";
import { IconButton, RowButton, SearchField, styles as ui } from "./ui";

export function EffortsSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Map" label="Efforts" active={currentScreen?.screenId === SCREEN_ID} onPress={() => openScreen({ screenId: SCREEN_ID, params: {} })} />;
}

interface Group {
  root: Root;
  workspaces: WorkspaceInfo[];
  served: EffortSummary[];
  recent: EffortSummary[];
  others: EffortSummary[];
  idle: WorkspaceInfo[];
}

/** One group per `.scratch`: efforts with a workspace (bound or suggested), then this week's, then the rest. */
function groupsOf(overview: Overview): Group[] {
  const now = Date.now();
  return overview.roots.map((root) => {
    const workspaces = overview.workspaces.filter((workspace) => workspace.root === root.root);
    const served: EffortSummary[] = [];
    const recent: EffortSummary[] = [];
    const others: EffortSummary[] = [];
    for (const effort of root.efforts) {
      const { bound, suggested } = workspacesOf(overview, effort);
      if (bound.length || suggested.length) served.push(effort);
      else if (now - effort.touchedMs < WEEK_MS) recent.push(effort);
      else others.push(effort);
    }
    served.sort((a, b) => Number(!workspacesOf(overview, a).bound.length) - Number(!workspacesOf(overview, b).bound.length) || b.touchedMs - a.touchedMs);
    others.sort((a, b) => b.touchedMs - a.touchedMs);
    const idle = workspaces.filter((workspace) => !workspace.binding && !workspace.suggestion);
    return { root, workspaces, served, recent, others, idle };
  });
}

/** Position of every group and row as drawn, by `.scratch` path and effort key. */
function ranksOf(groups: Group[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const group of groups) {
    ranks.set(group.root.root, ranks.size);
    for (const effort of [...group.served, ...group.recent, ...group.others]) ranks.set(effort.key, ranks.size);
  }
  return ranks;
}

/**
 * The groups in the order they had when the pointer came in: rows that were there keep their
 * place; new ones go last. Which list a row is in (served, this week, older) stays live.
 */
function heldOrder(groups: Group[], ranks: Map<string, number>): Group[] {
  const rank = (key: string) => ranks.get(key) ?? Number.MAX_SAFE_INTEGER;
  const byRank = (efforts: EffortSummary[]) => [...efforts].sort((a, b) => rank(a.key) - rank(b.key));
  return [...groups]
    .sort((a, b) => rank(a.root.root) - rank(b.root.root))
    .map((group) => ({ ...group, served: byRank(group.served), recent: byRank(group.recent), others: byRank(group.others) }));
}

/** The workspace an effort opens with on this screen: its first bound one. */
function workspaceFor(overview: Overview, effort: { root: string; slug: string }): WorkspaceInfo | null {
  return workspacesOf(overview, effort).bound[0] ?? null;
}

export function GlobalScreen({ theme, layout, params, navigation }: PluginScreenProps) {
  const c = colorsOf(theme);
  const compact = layout.compact;
  const { visible, onLayout, width } = useVisible();
  const overview = useOverview(visible);
  const data = overview.data;
  const from = params.from ? data?.workspaces.find((workspace) => workspace.id === params.from) : undefined;
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [folds, setFolds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const [selected, setSelected] = useState<{ root: string; slug: string } | null>(null);
  /** Row order frozen while the pointer is over the list, so polls don't move rows under it. */
  const [held, setHeld] = useState<Map<string, number> | null>(null);
  const drawn = useRef<Group[]>([]);
  const prefetch = usePrefetch();
  // A bare number finds the effort you came from first.
  const search = useSearch(query, { current: params.effort });
  const gutter = compact ? 14 : 20;

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.s0 }} onLayout={onLayout}>
        <Text style={{ ...SMALL, color: c.muted, padding: gutter }}>{overview.isError ? String(overview.error) : "Loading efforts…"}</Text>
      </View>
    );
  }
  const shown = chosen ?? new Set(from?.root ? [from.root] : data.roots.map((root) => root.root));
  const toggleIn = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const open = (effort: { root: string; slug: string }, page?: Page) => {
    if (page) setViewState(viewKey(workspaceFor(data, effort)?.id ?? null, effort), { page });
    setSelected({ root: effort.root, slug: effort.slug });
  };
  const hereKey = params.effort;
  const live = groupsOf(data).filter((group) => shown.has(group.root.root));
  const groups = held ? heldOrder(live, held) : live;
  drawn.current = groups;
  const wide = !compact && width > 900;

  const detail = selected ? (
    <EffortView
      key={`${selected.root}/${selected.slug}`}
      theme={theme}
      compact={compact}
      effort={selected}
      workspaceId={workspaceFor(data, selected)?.id ?? null}
      workspaceName={workspaceFor(data, selected)?.name ?? null}
      mode="detail"
      onClose={() => setSelected(null)}
      openAgent={(agentId) => navigation?.openAgent({ agentId })}
    />
  ) : null;
  if (detail && !wide) {
    return (
      <View style={{ flex: 1, backgroundColor: c.s0 }} onLayout={onLayout}>
        {detail}
      </View>
    );
  }

  const workspaceMatches = query.trim()
    ? data.roots.flatMap((root) =>
        root.efforts.filter((effort) => {
          const { bound, suggested } = workspacesOf(data, effort);
          return [...bound, ...suggested].some((workspace) => workspace.name.toLowerCase().includes(query.trim().toLowerCase()));
        }),
      )
    : [];

  const row = (group: Group, effort: EffortSummary) => {
    const here = hereKey === effort.key;
    const hot = here || (selected?.root === effort.root && selected.slug === effort.slug);
    const { bound, suggested } = workspacesOf(data, effort);
    const next = nextText(effort);
    const chips = [...bound, ...suggested].slice(0, 2).map((workspace) => (
      <Interactive
        key={workspace.id}
        accessibilityRole="button"
        accessibilityLabel={`Open ${workspace.name} with its Efforts panel`}
        onPress={() => openPanel(workspace.id)}
        style={() => ({ flexShrink: 1, minWidth: 0 })}
      >
        {({ hovered }) => <WsChip c={c} name={workspace.name} prefix={chipPrefix(workspace, group.root)} suggested={!bound.includes(workspace)} hot={hot} hovered={hovered} />}
      </Interactive>
    ));
    if (compact) {
      return (
        <RowButton key={effort.key} c={c} hot={here} onPress={() => open(effort)} style={[styles.prow, here ? { borderLeftWidth: 3, borderLeftColor: c.fg } : null]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={[ui.line, { gap: 6 }]}>
              <Text numberOfLines={1} style={{ fontSize: 15, lineHeight: 21, color: c.fg, flexShrink: 1 }}>
                {effort.slug}
              </Text>
              {effort.mapStatus ? <Tag c={c} text={effort.mapStatus} /> : null}
            </View>
            <Text numberOfLines={1} style={{ ...SMALL, color: c.muted }}>
              {next.num ? `Next ${next.num} ${next.text}` : !effort.counts.total && effort.destination ? effort.destination : next.text}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <Text style={{ ...SMALL, color: c.muted }}>{effort.counts.total ? `${effort.counts.done}/${effort.counts.total}` : age(effort.touchedMs)}</Text>
            {effort.counts.total ? <Bar done={effort.counts.done} total={effort.counts.total} c={c} width={28} /> : null}
          </View>
        </RowButton>
      );
    }
    return (
      <RowButton
        key={effort.key}
        c={c}
        hot={hot}
        onPress={() => open(effort)}
        onHoverIn={() => prefetch.detail(effort)}
        onHoverOut={prefetch.cancel}
        label={`Read ${effort.slug}`}
        style={[styles.grow, { paddingHorizontal: gutter }, here ? { borderLeftWidth: 3, borderLeftColor: c.fg, paddingLeft: gutter - 3 } : null]}
      >
        <View style={[styles.cBar]}>
          {effort.counts.total ? (
            <>
              <Bar done={effort.counts.done} total={effort.counts.total} c={c} />
              <Text style={{ ...SMALL, color: c.muted, fontVariant: ["tabular-nums"] }}>
                {effort.counts.done}/{effort.counts.total}
              </Text>
            </>
          ) : (
            <Text style={{ ...SMALL, color: c.muted, opacity: 0.7 }}>—</Text>
          )}
        </View>
        <View style={[styles.cName]}>
          <Text numberOfLines={1} style={{ fontSize: 14, color: c.fg, flexShrink: here ? 0 : 1 }}>
            {effort.slug}
          </Text>
          {effort.mapStatus ? <Tag c={c} text={effort.mapStatus} style={hot ? { backgroundColor: c.s0 } : undefined} /> : null}
          {here && from ? <Text numberOfLines={1} style={{ fontSize: 11, color: c.fg, opacity: 0.8, flexShrink: 1 }}>you came from {from.name}</Text> : null}
        </View>
        {selected ? null : (
          <Text numberOfLines={1} style={[styles.cOpen, { ...SMALL, color: c.muted }]}>
            {!effort.counts.total && effort.destination
              ? effort.destination
              : openWords(effort.counts).map((word, index) => (
                  <Text key={word.word} style={word.strong ? { color: c.fg, fontWeight: "500" } : word.faint ? { opacity: 0.7 } : undefined}>
                    {index ? " · " : ""}
                    {word.word}
                  </Text>
                ))}
          </Text>
        )}
        <View style={styles.cWs}>{chips.length ? chips : <Text style={{ ...SMALL, color: c.muted, opacity: 0.7 }}>no workspace</Text>}</View>
        <Text numberOfLines={1} style={[styles.cNext, { ...SMALL, color: next.num ? c.fg : c.muted }]}>
          {next.num ? <Text style={{ color: c.muted }}>{next.num} </Text> : null}
          {next.text}
        </Text>
        <Text style={[styles.cAge, { ...SMALL, color: c.muted }]}>{age(effort.touchedMs)}</Text>
      </RowButton>
    );
  };

  const fold = (key: string, label: string, names: string, body: () => React.ReactNode) => (
    <View key={key}>
      <RowButton c={c} onPress={() => setFolds(toggleIn(folds, key))} style={[styles.gfold, { paddingHorizontal: gutter - 2 }]}>
        <Icon name={folds.has(key) ? "ChevronDown" : "ChevronRight"} size={11} color={c.muted} />
        <Text style={{ ...SMALL, color: c.muted, flexShrink: 0 }}>{label}</Text>
        {!folds.has(key) ? (
          <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, opacity: 0.75, flex: 1, minWidth: 0 }}>
            {names}
          </Text>
        ) : null}
      </RowButton>
      {folds.has(key) ? body() : null}
    </View>
  );

  const list = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={[styles.toolbar, { paddingHorizontal: gutter }]}>
        <View style={{ flex: 1 }}>
          <SearchField c={c} value={query} onChange={setQuery} placeholder="Search efforts, tickets, docs, workspaces" slash={visible} compact={compact} />
        </View>
        <IconButton c={c} icon="Ellipsis" label="Legend" active={menu} onPress={() => setMenu(!menu)} />
      </View>
      <View style={[styles.chips, { paddingHorizontal: gutter }]}>
        {data.roots.map((root) => {
          const on = shown.has(root.root);
          return (
            <Interactive
              key={root.root}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setChosen(toggleIn(shown, root.root))}
              style={({ hovered, pressed }) => [
                styles.pchip,
                on ? { backgroundColor: hovered || pressed ? c.hoverHot : c.s2 } : { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.border, backgroundColor: pressed ? c.press : hovered ? c.hover : "transparent" },
              ]}
            >
              <Text style={{ fontSize: 12, color: on ? c.fg : c.muted }}>
                {root.label} <Text style={{ opacity: 0.8 }}>{root.efforts.length}</Text>
              </Text>
            </Interactive>
          );
        })}
        {from && !chosen ? (
          <View style={[ui.line, { gap: 0, marginLeft: 6 }]}>
            <Text style={{ fontSize: 12, color: c.muted }}>showing {from.name}'s project · </Text>
            <Interactive accessibilityRole="button" onPress={() => setChosen(new Set(data.roots.map((root) => root.root)))} style={() => null}>
              {({ hovered }) => <Text style={{ fontSize: 12, color: hovered ? c.fg : c.muted, textDecorationLine: "underline" }}>show all</Text>}
            </Interactive>
          </View>
        ) : null}
      </View>
      {data.warnings.length ? (
        // Problems the server noticed (a mistyped Extra folder, unreadable settings); otherwise silent.
        <Text style={{ ...SMALL, color: c.muted, paddingHorizontal: gutter, paddingTop: 6 }}>{data.warnings.join(" · ")}</Text>
      ) : null}
      {query.trim() ? (
        <SearchResults
          c={c}
          gutter={gutter}
          result={search.data}
          pending={search.isFetching || search.settling}
          extraEfforts={workspaceMatches}
          onEffort={(effort) => open(effort)}
          onTicket={(ticket) => open(ticket, { kind: "ticket", rel: ticket.rel })}
          onDoc={(doc) => open(doc, { kind: "doc", rel: doc.rel })}
        />
      ) : (
        <>
          {!compact ? (
            <View style={[styles.thead, { paddingHorizontal: gutter }]}>
              <Text style={[styles.cBar, styles.th, { color: c.muted }]}>Done</Text>
              <Text style={[styles.cName, styles.th, { color: c.muted }]}>Effort</Text>
              {selected ? null : <Text style={[styles.cOpen, styles.th, { color: c.muted }]}>Open tickets</Text>}
              <Text style={[styles.cWs, styles.th, { color: c.muted }]}>Workspaces</Text>
              <Text style={[styles.cNext, styles.th, { color: c.muted }]}>Next ticket</Text>
              <Text style={[styles.cAge, styles.th, { color: c.muted }]}>Touched</Text>
            </View>
          ) : null}
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.root.root);
            const elsewhere = new Map<string, number>();
            group.workspaces.forEach((workspace) => workspace.projectName !== group.root.label && elsewhere.set(workspace.projectName, (elsewhere.get(workspace.projectName) ?? 0) + 1));
            const others = group.others;
            return (
              <View key={group.root.root}>
                <RowButton c={c} onPress={() => setCollapsed(toggleIn(collapsed, group.root.root))} style={[styles.ghead, { paddingHorizontal: gutter }]}>
                  <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} size={12} color={c.muted} />
                  <Text style={{ ...SMALL, color: c.fg, fontWeight: "600", flexShrink: 0 }}>{group.root.label}</Text>
                  <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, flexShrink: 1 }}>
                    {group.workspaces.length} workspace{group.workspaces.length === 1 ? "" : "s"}
                    {elsewhere.size ? ` (${[...elsewhere].map(([name, count]) => `${count} in ${name}`).join(", ")})` : ""} · {group.root.efforts.length} efforts
                  </Text>
                </RowButton>
                {isCollapsed ? null : (
                  <>
                    {group.served.map((effort) => row(group, effort))}
                    {group.recent.length ? (
                      <Text style={{ ...LABEL, color: c.muted, paddingHorizontal: gutter, paddingTop: 8, paddingBottom: 2 }}>
                        Touched this week, no workspace · {group.recent.length}
                      </Text>
                    ) : null}
                    {group.recent.map((effort) => row(group, effort))}
                    {others.length
                      ? fold(
                          `${group.root.root}:others`,
                          `${group.recent.length ? "Older" : "Other"} efforts, no workspace · ${others.length}`,
                          others.slice(0, 6).map((effort) => `${effort.slug}${effort.counts.total ? ` ${effort.counts.done}/${effort.counts.total}` : ""}`).join(" · "),
                          () => others.map((effort) => row(group, effort)),
                        )
                      : null}
                    {group.idle.length
                      ? fold(
                          `${group.root.root}:idle`,
                          `Workspaces with no effort and no suggestion · ${group.idle.length}`,
                          group.idle.map((workspace) => (chipPrefix(workspace, group.root) ? `${workspace.projectName} › ${workspace.name}` : workspace.name)).join(", "),
                          () => (
                            <View style={[styles.chips, { paddingHorizontal: gutter + 18, paddingTop: 2, paddingBottom: 6 }]}>
                              {group.idle.map((workspace) => (
                                <Interactive key={workspace.id} accessibilityRole="button" onPress={() => openPanel(workspace.id)} style={() => null}>
                                  {({ hovered }) => <WsChip c={c} name={workspace.name} prefix={chipPrefix(workspace, group.root)} hovered={hovered} />}
                                </Interactive>
                              ))}
                            </View>
                          ),
                        )
                      : null}
                  </>
                )}
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.s0 }} onLayout={onLayout}>
      <View style={{ flex: 1, minWidth: 0 }} onPointerEnter={() => setHeld(ranksOf(drawn.current))} onPointerLeave={() => setHeld(null)}>
        {list}
        {menu ? <Menu c={c} items={[]} legend="global" top={44} onClose={() => setMenu(false)} /> : null}
      </View>
      {detail ? <View style={{ width: 360, borderLeftWidth: StyleSheet.hairlineWidth * 2, borderLeftColor: c.border }}>{detail}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingTop: 10 },
  pchip: { height: 24, paddingHorizontal: 9, borderRadius: 12, justifyContent: "center" },
  thead: { flexDirection: "row", gap: 12, paddingTop: 12, paddingBottom: 2 },
  th: { fontSize: 11 },
  ghead: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 10, paddingBottom: 3 },
  grow: { flexDirection: "row", alignItems: "center", gap: 12, height: 30 },
  prow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  gfold: { flexDirection: "row", alignItems: "center", gap: 6, height: 26 },
  cBar: { width: 80, flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  cName: { flex: 2, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, overflow: "hidden" },
  cOpen: { flex: 2.4, minWidth: 0 },
  cWs: { flex: 2, minWidth: 0, flexDirection: "row", gap: 4, overflow: "hidden" },
  cNext: { flex: 1.8, minWidth: 0 },
  cAge: { width: 48, textAlign: "right", flexShrink: 0 },
});
