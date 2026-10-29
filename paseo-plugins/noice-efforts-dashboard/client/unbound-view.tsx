import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { EffortSummary, Overview, Root, WorkspaceInfo } from "../shared/rpc";
import { useOverview, useSearch, useVisible } from "./data";
import { age } from "./format";
import { Bar, colorsOf, LABEL, ROW, SMALL, Tag, WsChip, type Palette } from "./marks";
import { chipPrefix, findEffort, workspacesOf } from "./model";
import { bindOrToast, startNewEffort } from "./runtime";
import { SearchResults } from "./search-results";
import { setViewState, viewKey, type Page } from "./state";
import { BackRow, Button, CountsLine, FoldHeader, GroupLabel, RowButton, SearchField, styles as ui } from "./ui";

/** U lists this many recently touched efforts of the project before the "All efforts" fold. */
const RECENT = 6;

/** Effort row: bar, name, status tag, age; then done/total (or "map only") and its workspaces. */
export function EffortRow(props: { c: Palette; overview: Overview; root: Root; effort: EffortSummary; onPress(): void; selected?: boolean }) {
  const { c, overview, root, effort } = props;
  const { bound, suggested } = workspacesOf(overview, effort);
  return (
    <RowButton c={c} onPress={props.onPress} hot={props.selected} label={`Bind to ${effort.slug}`} style={styles.erow}>
      <View style={[ui.line, { gap: 8 }]}>
        {effort.counts.total ? <Bar done={effort.counts.done} total={effort.counts.total} c={c} /> : <View style={{ width: 34 }} />}
        <Text numberOfLines={1} style={{ ...ROW, color: c.fg, flexShrink: 1 }}>
          {effort.slug}
        </Text>
        {effort.mapStatus ? <Tag c={c} text={effort.mapStatus} /> : null}
        <View style={ui.grow} />
        <Text style={{ ...SMALL, color: c.muted }}>{age(effort.touchedMs)}</Text>
      </View>
      <View style={[ui.line, { gap: 6, paddingLeft: 42, minHeight: 18, overflow: "hidden" }]}>
        <Text style={{ ...SMALL, color: c.muted, flexShrink: 0 }}>
          {effort.counts.total ? `${effort.counts.done}/${effort.counts.total}` : effort.hasMap ? "map only" : "no map"}
        </Text>
        {bound.length || suggested.length ? (
          [...bound, ...suggested].slice(0, 3).map((workspace) => (
            <WsChip key={workspace.id} c={c} name={workspace.name} prefix={chipPrefix(workspace, root)} suggested={!bound.includes(workspace)} />
          ))
        ) : (
          <Text style={{ ...SMALL, color: c.muted, opacity: 0.7 }}>no workspace</Text>
        )}
      </View>
      {!effort.counts.total && effort.destination ? (
        <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, paddingLeft: 42 }}>
          {effort.destination}
        </Text>
      ) : null}
    </RowButton>
  );
}

export function UnboundView(props: {
  theme: PluginTheme;
  compact: boolean;
  workspaceId: string;
  /** `unbound`: the U panel; `switch`: picking another effort for a bound workspace. */
  mode: "unbound" | "switch";
  current?: { root: string; slug: string };
  onDone?(): void;
}) {
  const c = colorsOf(props.theme);
  const toast = useToast();
  const { visible, onLayout } = useVisible();
  const overview = useOverview(visible);
  const [query, setQuery] = useState("");
  const [allOpen, setAllOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const data = overview.data;
  const workspace = data?.workspaces.find((candidate) => candidate.id === props.workspaceId);
  const root = data?.roots.find((candidate) => candidate.root === (props.current?.root ?? workspace?.root));
  // A bare number finds the current effort's ticket first (the server compares `<root>/<slug>`).
  const search = useSearch(query, { root: root?.root, current: props.current ? `${props.current.root}/${props.current.slug}` : undefined });

  /** Shows the effort at once; a failed bind puts the old one back and says so. */
  const choose = (effort: { root: string; slug: string }, page?: Page) => {
    bindOrToast(toast, props.workspaceId, { kind: "effort", root: effort.root, slug: effort.slug });
    if (page) setViewState(viewKey(props.workspaceId, effort), { page });
    setQuery("");
    props.onDone?.();
  };

  let body;
  if (!data || !workspace) {
    body = <Text style={{ ...SMALL, color: c.muted, padding: 12 }}>{overview.isError ? String(overview.error) : "Loading efforts…"}</Text>;
  } else if (!root && workspace.skipped) {
    body = (
      <View style={{ padding: 12, gap: 8 }}>
        <Text style={{ ...SMALL, color: c.muted }}>
          This folder's .scratch is skipped: {workspace.skipped}. Add it under Settings → Plugins → noice-efforts-dashboard → Efforts → Extra folders.
        </Text>
      </View>
    );
  } else if (!root) {
    body = (
      <View style={{ padding: 12, gap: 8 }}>
        <Text style={{ ...SMALL, color: c.muted }}>No efforts here: {workspace.dir} has no .scratch folder with efforts.</Text>
        <Text style={{ ...SMALL, color: c.muted }}>Add folders under Settings → Plugins → noice-efforts-dashboard → Efforts, or open All efforts from the sidebar.</Text>
      </View>
    );
  } else {
    const suggestion = props.mode === "unbound" && workspace.suggestion ? findEffort(data, workspace.suggestion.root, workspace.suggestion.slug) : null;
    const others = root.efforts.filter((effort) => effort !== suggestion && effort.slug !== props.current?.slug);
    const recent = others.slice(0, RECENT);
    body = (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        {suggestion && workspace.suggestion ? (
          <SuggestionCard
            c={c}
            effort={suggestion}
            reason={workspace.suggestion.reason}
            onBind={() => choose(suggestion)}
            onNew={() => setCreating(true)}
            onNone={() => bindOrToast(toast, props.workspaceId, { kind: "none" })}
          />
        ) : props.mode === "unbound" ? (
          <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Text style={{ ...SMALL, color: c.muted, flexBasis: "100%", marginBottom: 4 }}>No effort for {workspace.name} yet. Pick one below.</Text>
            <Button c={c} label="New effort" onPress={() => setCreating(true)} />
            <Button c={c} kind="ghost" label="No effort" title="This workspace has no effort; stop suggesting" onPress={() => bindOrToast(toast, props.workspaceId, { kind: "none" })} />
          </View>
        ) : null}
        <View style={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: 4 }}>
          <SearchField
            c={c}
            value={query}
            onChange={setQuery}
            placeholder={`Find an effort, ticket or doc in ${root.label}`}
            slash={visible}
            compact={props.compact}
          />
        </View>
        {query.trim() ? (
          <SearchResults
            c={c}
            result={search.data}
            pending={search.isFetching || search.settling}
            onEffort={(effort) => choose(effort)}
            onTicket={(ticket) => choose(ticket, { kind: "ticket", rel: ticket.rel })}
            onDoc={(doc) => choose(doc, { kind: "doc", rel: doc.rel })}
          />
        ) : (
          <>
            <GroupLabel c={c} text={`Recent in ${root.label} · ${recent.length}`} />
            {recent.map((effort) => (
              <EffortRow key={effort.key} c={c} overview={data} root={root} effort={effort} onPress={() => choose(effort)} />
            ))}
            {others.length > recent.length ? (
              <View style={{ marginTop: 8 }}>
                <FoldHeader c={c} name={`All efforts in ${root.label}`} count={root.efforts.length} open={allOpen} onToggle={() => setAllOpen(!allOpen)} />
                {allOpen
                  ? others.slice(recent.length).map((effort) => (
                      <EffortRow key={effort.key} c={c} overview={data} root={root} effort={effort} onPress={() => choose(effort)} />
                    ))
                  : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    );
  }
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: c.s0 }} onLayout={onLayout}>
      {props.mode === "switch" ? <BackRow c={c} label={`Keep ${props.current?.slug ?? "effort"}`} onBack={() => props.onDone?.()} /> : null}
      {body}
      {root && workspace ? (
        <NewEffortModal c={c} open={creating} onOpenChange={setCreating} workspace={workspace} root={root} onStarted={() => props.onDone?.()} />
      ) : null}
    </View>
  );
}

export function SuggestionCard(props: {
  c: Palette;
  effort: EffortSummary;
  reason: string;
  onBind(): void;
  onNew(): void;
  onNone(): void;
  flat?: boolean;
}) {
  const { c, effort } = props;
  return (
    <View style={[props.flat ? { paddingHorizontal: 6 } : [styles.card, { backgroundColor: c.s1, borderColor: c.border }]]}>
      <Text style={{ ...LABEL, color: c.muted }}>Suggested effort</Text>
      <View style={[ui.line, { gap: 6 }]}>
        {props.flat ? <Icon name="Map" size={13} color={c.muted} /> : null}
        <Text numberOfLines={1} style={{ fontSize: 14, lineHeight: 20, fontWeight: "600", color: c.fg, flexShrink: 1 }}>
          {effort.slug}
        </Text>
        {effort.mapStatus ? <Tag c={c} text={effort.mapStatus} /> : null}
      </View>
      <View style={{ marginTop: 3 }}>
        <CountsLine c={c} counts={effort.counts} />
        {!effort.counts.total ? <Text style={{ ...SMALL, color: c.muted }}>{effort.stateWord}</Text> : null}
      </View>
      <Text numberOfLines={2} style={{ ...SMALL, color: c.muted }}>
        {props.reason}
      </Text>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <Button c={c} kind="primary" label="Bind" onPress={props.onBind} />
        <Button c={c} label="New effort" onPress={props.onNew} />
        <Button c={c} kind="ghost" label="No effort" title="This workspace has no effort; stop suggesting" onPress={props.onNone} />
      </View>
    </View>
  );
}

/** Names a new effort, starts a chat that charts it, and binds the workspace to it. */
export function NewEffortModal(props: {
  c: Palette;
  open: boolean;
  onOpenChange(open: boolean): void;
  workspace: WorkspaceInfo;
  root: Root;
  onStarted?(agentId: string): void;
}) {
  const { c } = props;
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const clean = slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const taken = props.root.efforts.some((effort) => effort.slug === clean);
  const start = async () => {
    if (!clean || taken) return;
    setBusy(true);
    try {
      const agentId = await startNewEffort({ workspaceId: props.workspace.id, root: props.root.root, slug: clean, goal: goal.trim() });
      props.onOpenChange(false);
      setSlug("");
      setGoal("");
      props.onStarted?.(agentId);
    } catch (error) {
      toast.error(`Couldn't start the chat: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const input = [styles.input, { color: c.fg, borderColor: c.border, backgroundColor: c.s1 }];
  return (
    <Modal title="New effort" icon={<Icon name="Map" size={18} color={c.fg} />} open={props.open} onOpenChange={props.onOpenChange}>
      <Modal.Content>
        <Text style={{ ...SMALL, color: c.muted }}>
          Starts a chat in {props.workspace.name} that charts {props.root.label}/.scratch/{clean || "<name>"}/map.md with the wayfinder skill, and binds
          this workspace to it. The plugin itself writes no effort files.
        </Text>
        <TextInput value={slug} onChangeText={setSlug} placeholder="Folder name, e.g. acme-onboarding" placeholderTextColor={c.muted} autoCapitalize="none" style={input} />
        {taken ? <Text style={{ ...SMALL, color: c.amber }}>{clean} already exists; bind it from the list instead.</Text> : null}
        <TextInput value={goal} onChangeText={setGoal} placeholder="Goal in a sentence (optional)" placeholderTextColor={c.muted} multiline style={[input, { minHeight: 60 }]} />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 6 }}>
          <Button c={c} kind="ghost" label="Cancel" onPress={() => props.onOpenChange(false)} />
          <Button c={c} kind="primary" label="Start chat" busy={busy} onPress={() => void start()} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth * 2 },
  erow: { paddingHorizontal: 12, paddingVertical: 5, gap: 1 },
  input: { borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 },
});
