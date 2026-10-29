import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, Icon, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { EffortDetail, Section, Ticket } from "../shared/rpc";
import { useDetail, useDoc, usePrefetch, useVisible } from "./data";
import { age, commitsHeading, daysSince, isoDay, linkPage, shortDate, stamp, ticketBody } from "./format";
import { Menu, type MenuItem } from "./legend";
import { MarkdownView } from "./markdown-view";
import { Bar, colorsOf, Dot, Glyph, LABEL, MONO, ROW, SMALL, Tag, type Palette } from "./marks";
import { bindOrToast, chatSettings, chatVerb, client, latestOverview, onOverview, openAllEfforts, startTicketChat } from "./runtime";
import { useViewState, viewKey, type Page, type ViewState } from "./state";
import { BackRow, Button, CountsLine, FoldHeader, GroupLabel, IconButton, RowButton, TicketRow, styles as ui } from "./ui";
import { UnboundView } from "./unbound-view";

export interface EffortRef {
  root: string;
  slug: string;
}

export interface EffortViewProps {
  theme: PluginTheme;
  compact: boolean;
  effort: EffortRef;
  /** The workspace whose panel this is; chats start there. Null on the global screen without one. */
  workspaceId: string | null;
  workspaceName: string | null;
  /** `panel`: explorer tab; `sheet`: phone sheet (rows open in place); `detail`: global screen column. */
  mode: "panel" | "sheet" | "detail";
  /** Detail mode: closes the column. */
  onClose?(): void;
  /** Opens a chat the plugin started. */
  openAgent?(agentId: string): void;
}

/** Below this width the bar, the status pill and "· blocks 04" give way. */
const NARROW = 260;
/** Ticket ages show only from a week on. */
const OLD_DAYS = 7;

/** Display order: claimed, ready (next first), blocked, parked, done. */
function grouped(tickets: Ticket[], nextNum: string | null) {
  const by = (state: Ticket["state"]) => tickets.filter((ticket) => ticket.state === state);
  const ready = by("ready");
  const next = ready.find((ticket) => ticket.num === nextNum);
  return {
    claimed: by("claimed"),
    ready: next ? [next, ...ready.filter((ticket) => ticket !== next)] : ready,
    blocked: by("blocked"),
    parked: by("parked"),
    done: by("done"),
  };
}

function flatOrder(tickets: Ticket[], nextNum: string | null): Ticket[] {
  const groups = grouped(tickets, nextNum);
  return [...groups.claimed, ...groups.ready, ...groups.blocked, ...groups.parked, ...groups.done];
}

function ticketTail(ticket: Ticket, next: boolean, narrow: boolean): string {
  if (next) return narrow || !ticket.blocks.length ? "next" : `next · blocks ${ticket.blocks.join(", ")}`;
  if (ticket.state === "blocked") return `after ${[...ticket.after, ...ticket.afterElsewhere].join(", ")}`;
  const parts: string[] = [];
  if (ticket.type && ticket.type !== "grilling") parts.push(ticket.type);
  const days = daysSince(ticket.mtimeMs);
  if (days >= OLD_DAYS && ticket.state !== "done") parts.push(`${days}d`);
  return parts.join(" · ");
}

function statusLine(ticket: Ticket): string {
  return [ticket.statusWord, ticket.type, `edited ${stamp(ticket.mtimeMs)}`].filter(Boolean).join(" · ");
}

export function EffortView(props: EffortViewProps) {
  const { theme, effort } = props;
  const c = colorsOf(theme);
  const toast = useToast();
  const { visible, width, onLayout } = useVisible();
  const key = viewKey(props.workspaceId, effort);
  const [state, update] = useViewState(key);
  const detail = useDetail(effort, visible);
  const narrow = width > 0 && width < NARROW;

  let body: ReactNode;
  if (detail.isPending) {
    body = <ActivityIndicator style={{ marginTop: 40 }} color={c.muted} />;
  } else if (!detail.data) {
    // A failed poll keeps the effort it already shows; this is only for one never read.
    body = (
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={{ ...ROW, color: c.fg, fontWeight: "600" }}>{effort.slug}</Text>
        <Text style={{ ...SMALL, color: c.muted }}>
          Nothing at {effort.root}/{effort.slug}/ yet. A chat may still be charting it.
        </Text>
        {props.workspaceId ? (
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Button c={c} label="Switch effort" onPress={() => update({ page: { kind: "switch" } })} />
            <Button c={c} kind="ghost" label="Unbind" onPress={() => bindOrToast(toast, props.workspaceId!, { kind: "clear" })} />
          </View>
        ) : null}
      </View>
    );
  } else if (state.page) {
    body = <PageView {...props} c={c} data={detail.data} page={state.page} state={state} update={update} visible={visible} />;
  } else {
    body = <Overview {...props} c={c} data={detail.data} state={state} update={update} narrow={narrow} />;
  }
  if (state.page?.kind === "switch" && props.workspaceId) {
    body = (
      <UnboundView
        theme={theme}
        compact={props.compact}
        workspaceId={props.workspaceId}
        mode="switch"
        current={effort}
        onDone={() => update({ page: null })}
      />
    );
  }
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: c.s0 }} onLayout={onLayout}>
      {body}
    </View>
  );
}

interface InnerProps extends EffortViewProps {
  c: Palette;
  data: EffortDetail;
  state: ViewState;
  update(patch: Partial<ViewState>): void;
}

function useChat(props: InnerProps) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const start = async (ticket: Ticket) => {
    if (!props.workspaceId) return;
    setBusy(ticket.num);
    try {
      const agentId = await startTicketChat({
        workspaceId: props.workspaceId,
        effortDir: props.data.summary.key,
        slug: props.effort.slug,
        ticket,
      });
      props.openAgent?.(agentId);
    } catch (error) {
      toast.error(`Couldn't start the chat: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };
  // Reads the workspace's chat settings ahead, so the click only has to create the chat.
  const warm = () => {
    if (props.workspaceId) chatSettings(props.workspaceId).catch(() => {});
  };
  return { busy, start, warm };
}

function Overview(props: InnerProps & { narrow: boolean }) {
  const { c, data, state, update, narrow, mode } = props;
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const { summary } = data;
  const groups = grouped(data.tickets, summary.next?.num ?? null);
  const fold = (name: string, fallback = false) => state.folds[name] ?? fallback;
  const toggle = (name: string, fallback = false) => update({ folds: { ...state.folds, [name]: !fold(name, fallback) } });
  const openTicket = (ticket: Ticket) =>
    mode === "sheet" ? update({ expanded: state.expanded === ticket.num ? null : ticket.num }) : update({ page: { kind: "ticket", rel: ticket.rel } });
  const copy = (text: string, what: string) =>
    copyText(text).then(
      () => toast.show(`Copied ${what}`),
      () => toast.error("Copying is not available here"),
    );
  const chat = useChat(props);
  const prefetch = usePrefetch();

  const ticketRows = (tickets: Ticket[]) =>
    tickets.map((ticket) => {
      const next = ticket.num === summary.next?.num && ticket.state === "ready";
      const open = mode === "sheet" && state.expanded === ticket.num;
      return (
        <View key={ticket.rel}>
          <TicketRow
            c={c}
            state={ticket.state}
            num={ticket.num}
            title={ticket.title}
            tail={ticketTail(ticket, next, narrow)}
            next={next}
            big={mode === "sheet"}
            onPress={() => openTicket(ticket)}
            onHoverIn={() => prefetch.doc(props.effort, ticket.rel)}
            onHoverOut={prefetch.cancel}
          />
          {next && !open && ticket.question ? (
            <Text numberOfLines={1} style={[styles.question, { color: c.muted, backgroundColor: c.s2 }, mode === "sheet" ? { paddingLeft: 59 } : null]}>
              {ticket.question}
            </Text>
          ) : null}
          {open ? (
            <View style={[styles.expanded, { backgroundColor: c.s2 }]}>
              {ticket.question ? <Text style={{ fontSize: 13, lineHeight: 18, color: c.fg }}>{ticket.question}</Text> : null}
              <Text style={{ fontSize: 13, lineHeight: 18, color: c.muted }}>
                {[ticket.statusWord, ticket.type, ticket.blocks.length ? `blocks ${ticket.blocks.join(", ")}` : "", `edited ${shortDate(ticket.mtimeMs)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                {props.workspaceId && ticket.state !== "done" ? (
                  <Button
                    c={c}
                    kind="primary"
                    big
                    icon="MessageCircle"
                    label={chatVerb(ticket.type)}
                    busy={chat.busy === ticket.num}
                    onHoverIn={chat.warm}
                    onPress={() => void chat.start(ticket)}
                  />
                ) : null}
                <Button c={c} big label="Read" onPress={() => update({ page: { kind: "ticket", rel: ticket.rel } })} />
              </View>
            </View>
          ) : null}
        </View>
      );
    });

  const menuItems: MenuItem[] = [
    ...(props.workspaceId ? [{ icon: "ArrowLeftRight", label: "Switch effort…", onPress: () => update({ page: { kind: "switch" } }) }] : []),
    ...(summary.hasMap ? [{ icon: "File", label: "Open map.md", onPress: () => update({ page: { kind: "doc", rel: "map.md" } }) }] : []),
    { icon: "Copy", label: "Copy path", hint: `.scratch/${summary.slug}`, onPress: () => void copy(summary.key, "the effort path") },
    { icon: "LayoutGrid", label: "All efforts", onPress: () => openAllEfforts(props.workspaceId ?? undefined, summary.key) },
    ...(props.workspaceId
      ? [{ icon: "Unlink", label: `Unbind from ${props.workspaceName ?? "this workspace"}`, muted: true, onPress: () => bindOrToast(toast, props.workspaceId!, { kind: "clear" }) }]
      : []),
  ];

  const leanTail = data.leansOn.map((related) => `${related.short} ${related.counts.done}/${related.counts.total}`).join(" · ");
  const mapDoc = data.docs.find((doc) => doc.kind === "map");
  const uncommitted = data.uncommitted?.rows.length ?? 0;

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        <View style={styles.head}>
          <View style={[ui.line, { gap: 6, height: 22 }]}>
            <Icon name="Map" size={14} color={c.muted} />
            <Text numberOfLines={1} style={{ fontSize: 14, lineHeight: 20, fontWeight: "600", color: c.fg, flexShrink: 1 }}>
              {summary.slug}
            </Text>
            {summary.mapStatus && !narrow ? <Tag c={c} text={summary.mapStatus} /> : null}
            <View style={ui.grow} />
            {mode === "detail" && props.onClose ? <IconButton c={c} icon="X" label="Close" onPress={props.onClose} /> : null}
            {data.uncommitted || data.commits.length ? (
              <RowButton
                c={c}
                label={uncommitted ? `Files & commits: ${uncommitted} not committed` : "Files & commits"}
                onPress={() => update({ page: { kind: "git" } })}
                style={styles.gitButton}
              >
                <Icon name="GitBranch" size={13} color={c.muted} />
                {uncommitted ? <Text style={{ ...SMALL, color: c.amber }}>{uncommitted}</Text> : null}
              </RowButton>
            ) : null}
            <IconButton c={c} icon="Ellipsis" label="Effort menu and legend" active={menu} onPress={() => setMenu(!menu)} />
          </View>
          {data.title && data.title !== summary.slug && !summary.hasMap ? (
            <Text numberOfLines={1} style={{ ...SMALL, color: c.muted }}>
              {data.title}
            </Text>
          ) : null}
          {data.destination ? (
            <RowButton c={c} label="Open map.md at Destination" onPress={() => update({ page: { kind: "doc", rel: "map.md", section: "Destination" } })} style={{ marginTop: 2, borderRadius: 4 }}>
              <Text numberOfLines={1} style={{ ...SMALL, color: c.muted }}>
                {data.destination}
              </Text>
            </RowButton>
          ) : null}
          {data.deadline ? (
            <View style={[ui.line, { marginTop: 2 }]}>
              <Icon name="Clock" size={12} color={c.muted} />
              <Text numberOfLines={1} style={{ ...SMALL, color: c.fg, flexShrink: 1 }}>
                {data.deadline}
              </Text>
            </View>
          ) : null}
          <View style={{ marginTop: 2 }}>
            <CountsLine c={c} counts={summary.counts} narrow={narrow} />
          </View>
        </View>

        {data.tickets.length ? (
          <View style={{ marginTop: 12 }}>
            {ticketRows(groups.claimed)}
            {ticketRows(groups.ready)}
            {groups.blocked.length ? <GroupLabel c={c} text={`Blocked · ${groups.blocked.length}`} /> : null}
            {ticketRows(groups.blocked)}
            {groups.parked.length ? <GroupLabel c={c} text={`Parked · ${groups.parked.length}`} /> : null}
            {ticketRows(groups.parked)}
            {groups.done.length ? (
              <View style={{ marginTop: 4 }}>
                <FoldHeader
                  c={c}
                  first
                  name="Done"
                  count={groups.done.length}
                  open={fold("Done")}
                  onToggle={() => toggle("Done")}
                  tail={groups.done.length ? `${groups.done[groups.done.length - 1].num} ${groups.done[groups.done.length - 1].title}` : undefined}
                />
                {fold("Done") ? ticketRows(groups.done) : null}
              </View>
            ) : null}
          </View>
        ) : null}
        {data.anomalies.length ? (
          <View style={{ paddingHorizontal: 12, paddingTop: 6, gap: 2 }}>
            {data.anomalies.map((line) => (
              <Text key={line} numberOfLines={2} style={{ ...LABEL, color: c.muted }}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={{ marginTop: 14 }}>
          {data.sections.map((section) => (
            <SectionFold key={section.name} {...props} section={section} open={fold(section.name)} onToggle={() => toggle(section.name)} />
          ))}
          {data.leansOn.length ? (
            <>
              <FoldHeader c={c} name="Leans on" count={data.leansOn.length} open={fold("Leans on")} onToggle={() => toggle("Leans on")} tail={leanTail} />
              {fold("Leans on") ? (
                <View style={[styles.foldBody, { paddingLeft: 12 }]}>
                  {data.leansOn.map((related) => (
                    <View key={related.slug} style={{ paddingTop: 2, paddingBottom: 4 }}>
                      <View style={[ui.line, { gap: 8 }]}>
                        <Bar done={related.counts.done} total={related.counts.total} c={c} />
                        <Text numberOfLines={1} style={{ ...ROW, color: c.fg, flex: 1, minWidth: 0 }}>
                          {related.slug}
                        </Text>
                        <Text style={{ ...SMALL, color: c.muted }}>
                          {related.counts.done}/{related.counts.total}
                        </Text>
                      </View>
                      <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, paddingLeft: 42 }}>
                        {[related.why, related.next ? `next ${related.next.num} ${related.next.title}` : ""].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>

        {data.docs.length ? (
          <View style={[styles.docs, { borderTopColor: c.border }]}>
            {data.docs.map((doc) => (
              <RowButton
                key={doc.rel}
                c={c}
                label={doc.kind === "map" || doc.kind === "file" ? `Open ${doc.name}` : `List ${doc.name}`}
                onPress={() => update({ page: doc.kind === "map" || doc.kind === "file" ? { kind: "doc", rel: doc.rel } : { kind: "folder", rel: doc.rel } })}
                style={[styles.chip, { backgroundColor: c.s1, borderColor: c.border }]}
              >
                <Icon name={doc.kind === "map" ? "Map" : doc.kind === "file" ? "File" : "Folder"} size={12} color={c.muted} />
                <Text style={{ ...SMALL, color: c.fg }}>
                  {doc.name}
                  {doc.kind === "map" && mapDoc ? <Text style={{ color: c.muted }}> · {age(doc.mtimeMs)}</Text> : null}
                  {doc.kind === "folder" || doc.kind === "artifacts" ? (
                    <Text style={{ color: c.muted }}>
                      {" "}
                      {doc.count}
                      {doc.more ? "+" : ""}
                    </Text>
                  ) : null}
                </Text>
              </RowButton>
            ))}
          </View>
        ) : null}
      </ScrollView>
      {menu ? <Menu c={c} items={menuItems} legend="panel" top={34} onClose={() => setMenu(false)} /> : null}
    </View>
  );
}

function SectionFold(props: InnerProps & { section: Section; open: boolean; onToggle(): void }) {
  const { c, data, section, update } = props;
  const isDecisions = section.name === "Decisions";
  // Decisions: newest first by their date; undated ones keep map order after the dated.
  const items = isDecisions
    ? section.items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => (b.item.date ?? "").localeCompare(a.item.date ?? "") || b.index - a.index)
        .map(({ item }) => item)
    : section.items;
  const onLink = (href: string) => {
    const page = linkPage(data.docs, "map.md", href);
    if (page) update({ page });
  };
  return (
    <>
      <FoldHeader c={c} name={section.name} count={section.count} open={props.open} onToggle={props.onToggle} tail={section.tail} />
      {props.open ? (
        <View style={[styles.foldBody, { gap: isDecisions ? 0 : 6 }]}>
          {items.length === 0 ? <MarkdownView source={section.markdown} c={c} small onLink={onLink} /> : null}
          {items.map((item, index) =>
            isDecisions ? (
              <RowButton
                key={index}
                c={c}
                label={`Open ${item.title} in map.md`}
                onPress={() => update({ page: { kind: "doc", rel: "map.md", section: section.heading } })}
                style={styles.frow}
              >
                <Text numberOfLines={1} style={{ ...SMALL, color: c.fg, flex: 1, minWidth: 0 }}>
                  {item.title}
                </Text>
                {item.date ? <Text style={{ ...SMALL, color: c.muted }}>{isoDay(item.date)}</Text> : null}
              </RowButton>
            ) : (
              <View key={index} style={{ minWidth: 0 }}>
                <MarkdownView source={item.markdown.replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, "")} c={c} small onLink={onLink} />
              </View>
            ),
          )}
        </View>
      ) : null}
    </>
  );
}

function PageView(props: InnerProps & { page: Page; visible: boolean }) {
  const { page } = props;
  if (page.kind === "ticket") return <TicketPage {...props} rel={page.rel} />;
  if (page.kind === "folder") return <FolderPage {...props} rel={page.rel} />;
  if (page.kind === "doc") return <DocPage {...props} rel={page.rel} section={page.section} />;
  if (page.kind === "git") return <GitPage {...props} />;
  return null;
}

/**
 * Git state of the effort's files, kept apart from the planning view: what changed here and isn't
 * committed yet, and the commits that touched the effort.
 */
function GitPage(props: InnerProps) {
  const { c, data, update } = props;
  const toast = useToast();
  const rows = data.uncommitted?.rows ?? [];
  const paths = data.uncommitted?.paths ?? [];
  // Settings → Commits shown, from the shared overview so a save applies at once.
  const commitsShown = useSyncExternalStore(onOverview, latestOverview)?.commitsShown ?? 30;
  const commits = data.commits.slice(0, commitsShown);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <BackRow
        c={c}
        label={data.summary.slug}
        onBack={() => update({ page: null })}
        right={
          paths.length ? (
            <IconButton
              c={c}
              icon="Copy"
              label={`Copy the ${paths.length} uncommitted paths`}
              onPress={() => void copyText(paths.join("\n")).then(() => toast.show(`Copied ${paths.length} paths`), () => toast.error("Copying is not available here"))}
            />
          ) : undefined
        }
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
        <GroupLabel c={c} text={rows.length ? `Not committed · ${rows.length}` : "Everything committed"} />
        {rows.map((row) => (
          <View key={row.label} style={[styles.frow, { paddingHorizontal: 12 }]}>
            <Dot c={c} />
            <Text style={{ ...SMALL, color: c.fg, flexShrink: 0 }}>{row.label}</Text>
            <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, flex: 1, minWidth: 0 }}>
              {[row.mtimeMs ? stamp(row.mtimeMs) : "", row.detail].filter(Boolean).join(" · ")}
            </Text>
            <Text style={{ ...SMALL, color: c.green, flexShrink: 0, paddingLeft: 6 }}>{row.stat}</Text>
          </View>
        ))}
        {data.commits.length ? (
          <View style={{ marginTop: 8 }}>
            <GroupLabel c={c} text={commitsHeading(commits.length, data.commits.length, data.moreCommits)} />
            {commits.map((commit) => (
              <View key={commit.hash} style={[styles.frow, { paddingHorizontal: 12 }]}>
                <Text style={{ ...SMALL, color: c.muted, fontFamily: MONO }}>{commit.hash}</Text>
                <Text numberOfLines={1} style={{ ...SMALL, color: c.fg, flex: 1, minWidth: 0 }}>
                  {commit.subject}
                </Text>
                <Text style={{ ...SMALL, color: c.muted }}>{shortDate(commit.atMs)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TicketPage(props: InnerProps & { rel: string; visible: boolean }) {
  const { c, data, update } = props;
  const toast = useToast();
  const order = flatOrder(data.tickets, data.summary.next?.num ?? null);
  const index = order.findIndex((ticket) => ticket.rel === props.rel);
  const ticket = order[index];
  const doc = useDoc(props.effort, props.rel, props.visible);
  const chat = useChat(props);
  if (!ticket) return <BackRow c={c} label={data.summary.slug} onBack={() => update({ page: null })} />;
  const title = (num: string) => data.tickets.find((candidate) => candidate.num === num)?.title ?? "";
  const go = (step: number) => {
    const target = order[(index + step + order.length) % order.length];
    update({ page: { kind: "ticket", rel: target.rel } });
  };
  const rawDiffers = ticket.statusRaw && ticket.statusRaw.trim().toLowerCase() !== ticket.statusWord;
  // The body without the title and the key lines the meta line already says.
  const body = ticketBody(doc.data?.text ?? "");
  const abs = `${data.summary.key}/${ticket.rel}`;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <BackRow
        c={c}
        label={data.summary.slug}
        onBack={() => update({ page: null })}
        right={
          <View style={[ui.line, { gap: 2 }]}>
            <Text style={{ ...SMALL, color: c.muted, marginRight: 4 }}>
              {index + 1} of {order.length}
            </Text>
            <IconButton c={c} icon="ChevronLeft" label="Previous ticket" onPress={() => go(-1)} />
            <IconButton c={c} icon="ChevronRight" label="Next ticket" onPress={() => go(1)} />
          </View>
        }
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }}>
        <View style={[ui.line, { gap: 7, alignItems: "center" }]}>
          <Glyph state={ticket.state} c={c} />
          <Text style={{ fontSize: 15, lineHeight: 21, color: c.muted }}>{ticket.num}</Text>
          <Text style={{ fontSize: 15, lineHeight: 21, color: c.fg, fontWeight: "600", flexShrink: 1 }}>{ticket.title}</Text>
        </View>
        <Text style={{ ...SMALL, color: c.muted, marginTop: 2 }}>{statusLine(ticket)}</Text>
        {ticket.blocks.map((num) => (
          <Text key={`b${num}`} numberOfLines={1} style={{ ...SMALL, color: c.muted }}>
            <Text style={{ color: c.fg, fontWeight: "500" }}>blocks</Text> {num} {title(num)}
          </Text>
        ))}
        {[...ticket.after.map((num) => `${num} ${title(num)}`), ...ticket.afterElsewhere].map((text) => (
          <Text key={`a${text}`} numberOfLines={1} style={{ ...SMALL, color: c.muted }}>
            <Text style={{ color: c.fg, fontWeight: "500" }}>after</Text> {text}
          </Text>
        ))}
        <Text style={{ fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.muted, opacity: 0.8, marginTop: 4, marginBottom: 6 }} selectable>
          {ticket.rel}
        </Text>
        {rawDiffers ? (
          <Text selectable style={[styles.raw, { backgroundColor: c.s1, color: c.muted }]}>
            Status: {ticket.statusRaw}
          </Text>
        ) : null}
        {doc.isPending ? <ActivityIndicator color={c.muted} /> : <MarkdownView source={body} c={c} onLink={(href) => {
          const page = linkPage(data.docs, ticket.rel, href);
          if (page) update({ page });
        }} />}
      </ScrollView>
      <View style={[styles.foot, { borderTopColor: c.border }]}>
        {props.workspaceId && ticket.state !== "done" ? (
          <Button
            c={c}
            kind="primary"
            icon="MessageCircle"
            label={chatVerb(ticket.type)}
            busy={chat.busy === ticket.num}
            title={`Starts a chat in this workspace on ${ticket.rel}`}
            onHoverIn={chat.warm}
            onPress={() => void chat.start(ticket)}
          />
        ) : null}
        <View style={ui.grow} />
        <IconButton
          c={c}
          icon="Copy"
          label="Copy path"
          onPress={() => void copyText(abs).then(() => toast.show("Copied the path"), () => toast.error("Copying is not available here"))}
        />
      </View>
    </View>
  );
}

function FolderPage(props: InnerProps & { rel: string }) {
  const { c, data, update } = props;
  const doc = data.docs.find((candidate) => candidate.rel === props.rel);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <BackRow c={c} label={data.summary.slug} onBack={() => update({ page: null })} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 6 }}>
        <Text style={{ ...SMALL, color: c.muted, paddingHorizontal: 12, paddingBottom: 4 }}>
          {doc ? `${doc.name}/ · ${doc.count}${doc.more ? "+" : ""} files${doc.files.length < doc.count ? `, newest ${doc.files.length} listed` : ""}` : props.rel}
        </Text>
        {doc?.files.map((file) => (
          <RowButton key={file.rel} c={c} label={`Open ${file.name}`} onPress={() => update({ page: { kind: "doc", rel: file.rel } })} style={[styles.frow, { paddingHorizontal: 12, height: 26 }]}>
            <Icon name="File" size={12} color={c.muted} />
            <Text numberOfLines={1} style={{ ...ROW, color: c.fg, flex: 1, minWidth: 0 }}>
              {file.name}
            </Text>
            <Text style={{ ...SMALL, color: c.muted }}>{age(file.mtimeMs)}</Text>
          </RowButton>
        ))}
      </ScrollView>
    </View>
  );
}

function DocPage(props: InnerProps & { rel: string; section?: string; visible: boolean }) {
  const { c, data, update } = props;
  const toast = useToast();
  const doc = useDoc(props.effort, props.rel, props.visible);
  const isMap = props.rel === "map.md";
  const [openSection, setOpenSection] = useState<string | null>(props.section ?? null);
  const name = props.rel.replace(/^\.artifacts\//, "").split("/").pop() ?? props.rel;
  const onLink = (href: string) => {
    const page = linkPage(data.docs, props.rel, href);
    if (page) update({ page });
  };
  const meta = doc.data ? `edited ${stamp(doc.data.mtimeMs)}` : "";
  let content: ReactNode;
  if (doc.isPending) content = <ActivityIndicator color={c.muted} />;
  else if (!doc.data) content = <Text style={{ ...SMALL, color: c.muted }}>Couldn't read {props.rel}.</Text>;
  else if (doc.data.binary) content = <Text style={{ ...SMALL, color: c.muted }}>Not a text file. Copy its path to open it elsewhere.</Text>;
  else if (isMap) content = <MapOutline c={c} text={doc.data.text} data={data} open={openSection} onOpen={setOpenSection} onLink={onLink} />;
  else content = <MarkdownView source={doc.data.text} c={c} onLink={onLink} />;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <BackRow
        c={c}
        label={data.summary.slug}
        onBack={() => update({ page: null })}
        right={
          <IconButton
            c={c}
            icon="Copy"
            label="Copy path"
            onPress={() =>
              doc.data && void copyText(doc.data.abs).then(() => toast.show("Copied the path"), () => toast.error("Copying is not available here"))
            }
          />
        }
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }}>
        <View style={[ui.line, { gap: 6 }]}>
          <Icon name={isMap ? "Map" : "File"} size={14} color={c.muted} />
          <Text numberOfLines={1} style={{ fontSize: 14, lineHeight: 20, color: c.fg, fontWeight: "600", flexShrink: 1 }}>
            {name}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, marginBottom: 8 }}>
          {[props.rel !== name ? props.rel : "", meta].filter(Boolean).join(" · ")}
        </Text>
        {content}
      </ScrollView>
    </View>
  );
}

/** map.md as an outline: the head, then each `## ` section with its item count; one open at a time. */
function MapOutline(props: { c: Palette; text: string; data: EffortDetail; open: string | null; onOpen(heading: string | null): void; onLink(href: string): void }) {
  const { c, text } = props;
  const lines = text.split("\n");
  const parts: { heading: string; body: string }[] = [];
  let head: string[] = [];
  let fence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const match = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) parts.push({ heading: match[1].replace(/[*_`]/g, "").trim(), body: "" });
    else if (parts.length) parts[parts.length - 1].body += `${line}\n`;
    else head.push(line);
  }
  head = head.filter((line) => !/^#\s/.test(line));
  return (
    <View>
      {head.join("\n").trim() ? <MarkdownView source={head.join("\n").trim()} c={c} small onLink={props.onLink} /> : null}
      <View style={{ marginTop: 8, marginHorizontal: -14 }}>
        {parts.map((part) => {
          const items = part.body.split("\n").filter((line) => /^(?:[-*+]|\d{1,3}[.)])\s/.test(line)).length;
          const open = props.open === part.heading;
          return (
            <View key={part.heading}>
              <FoldHeader
                c={c}
                name={part.heading}
                count={items || undefined}
                open={open}
                onToggle={() => props.onOpen(open ? null : part.heading)}
              />
              {open ? (
                <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
                  <MarkdownView source={part.body.trim()} c={c} onLink={props.onLink} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 12, paddingTop: 10 },
  question: { ...SMALL, paddingLeft: 57, paddingRight: 12, paddingBottom: 5, marginTop: -2 },
  expanded: { paddingLeft: 38, paddingRight: 14, paddingTop: 2, paddingBottom: 10 },
  foldBody: { paddingLeft: 29, paddingRight: 12, paddingBottom: 6 },
  frow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22 },
  docs: { flexDirection: "row", flexWrap: "wrap", gap: 4, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, height: 22, paddingHorizontal: 7, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth * 2 },
  gitButton: { flexDirection: "row", alignItems: "center", gap: 4, height: 22, paddingHorizontal: 5, borderRadius: 4 },
  raw: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16, padding: 8, borderRadius: 6, marginBottom: 10 },
  foot: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
