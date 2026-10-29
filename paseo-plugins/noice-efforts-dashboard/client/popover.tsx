import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import type { Ticket } from "../shared/rpc";
import { useDetail, useOverview } from "./data";
import { EffortView } from "./effort-view";
import { daysSince } from "./format";
import { colorsOf, ROW, RouteBar, SMALL, Tag, type Palette } from "./marks";
import { findEffort } from "./model";
import { bindOrToast, openAllEfforts, openPanel } from "./runtime";
import { setViewState, viewKey, type Page } from "./state";
import { RowButton, TicketRow, styles as ui } from "./ui";
import { SuggestionCard, UnboundView } from "./unbound-view";

/** Paseo's popover: at most 420 × 440 incl. its 12 px side padding; 16 px top + bottom. */
const WIDTH = 396;
/** Rows and group labels are 24 px each, so the list's height is known before it draws. */
const ROW_H = 24;
/** Room left for the list under the head (≤ 2-line destination) and above the footer. */
const LIST_MAX = 256;
/** Expanding Done in a short list still shows at least this much of it. */
const LIST_MIN_OPEN = 120;
const OLD_DAYS = 7;

/** `after 17 · hands-on · 14d`: blockers, what it asks of you (else the type), and age once a week old. */
function rowTail(ticket: Ticket): string {
  const parts: string[] = [];
  if (ticket.state === "blocked") parts.push(`after ${[...ticket.after, ...ticket.afterElsewhere].join(", ")}`);
  const kind = ticket.kind ?? (ticket.type && ticket.type !== "grilling" ? ticket.type : null);
  if (kind) parts.push(kind);
  const days = daysSince(ticket.mtimeMs);
  if (days >= OLD_DAYS) parts.push(`${days}d`);
  return parts.join(" · ");
}

function GroupHead({ c, label, count }: { c: Palette; label: string; count: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: ROW_H, paddingHorizontal: 6, paddingBottom: 3 }}>
      <Text style={{ ...SMALL, color: c.muted }}>{label}</Text>
      <Text style={{ ...SMALL, color: c.muted, opacity: 0.6 }}>{count}</Text>
    </View>
  );
}

function FogRow({ c, title, onPress }: { c: Palette; title: string; onPress(): void }) {
  return (
    <RowButton c={c} onPress={onPress} label={`Open ${title} in map.md`} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: ROW_H, paddingHorizontal: 6 }}>
      <View style={{ width: 11, height: 11, borderRadius: 5.5, borderWidth: 1.5, borderStyle: "dotted", borderColor: c.muted }} />
      <Text numberOfLines={1} style={{ ...ROW, color: c.muted, flexShrink: 1 }}>
        {title}
      </Text>
    </RowButton>
  );
}

/** Small muted icon+label button for the popover's footer bar. */
function FooterButton(props: { c: Palette; icon: string; label: string; onPress(): void }) {
  const { c } = props;
  return (
    <RowButton c={c} onPress={props.onPress} style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 6, borderRadius: 4 }}>
      <Icon name={props.icon} size={12} color={c.muted} />
      <Text style={{ ...SMALL, color: c.muted }}>{props.label}</Text>
    </RowButton>
  );
}

/**
 * Header pill popover. Wide layouts: name, destination, the route bar with its counts, then one
 * list in route order (Done, folded; in progress; to do; fog) that scrolls under a fixed head,
 * and a footer bar (Open panel · All efforts · Switch… · Unbind). Phones get the whole effort as a
 * sheet (P3), which is also what the composer pill opens.
 */
export function EffortPopover({ workspaceId, theme, layout, close }: PluginButtonContentProps) {
  const c = colorsOf(theme);
  const toast = useToast();
  const overview = useOverview(true);
  const workspace = overview.data?.workspaces.find((candidate) => candidate.id === workspaceId);
  const binding = workspace?.binding?.kind === "effort" ? workspace.binding : null;
  const effort = binding ?? null;
  const detail = useDetail(layout.compact ? null : effort, true);
  const [doneOpen, setDoneOpen] = useState(false);
  const go = (page?: Page) => {
    if (effort && page) setViewState(viewKey(workspaceId, effort), { page });
    close();
    openPanel(workspaceId);
  };

  if (layout.compact) {
    return (
      <View style={{ height: 640, maxHeight: "100%" }}>
        {effort ? (
          <EffortView theme={theme} compact effort={effort} workspaceId={workspaceId} workspaceName={workspace?.name ?? null} mode="sheet" />
        ) : (
          <UnboundView theme={theme} compact workspaceId={workspaceId} mode="unbound" />
        )}
      </View>
    );
  }
  if (!overview.data || !workspace) return <Text style={{ ...SMALL, color: c.muted, padding: 12 }}>Loading…</Text>;

  if (!effort) {
    const suggestion = workspace.suggestion ? findEffort(overview.data, workspace.suggestion.root, workspace.suggestion.slug) : null;
    if (!suggestion || !workspace.suggestion) return <Text style={{ ...SMALL, color: c.muted, padding: 12 }}>No effort suggested.</Text>;
    return (
      <View style={{ width: 300 }}>
        <SuggestionCard
          c={c}
          flat
          effort={suggestion}
          reason={workspace.suggestion.reason}
          onBind={() => bindOrToast(toast, workspaceId, { kind: "effort", root: suggestion.root, slug: suggestion.slug })}
          onNew={() => go()}
          onNone={() => {
            bindOrToast(toast, workspaceId, { kind: "none" });
            close();
          }}
        />
      </View>
    );
  }

  // Paseo sizes the popover on its first frame, so nothing is drawn until the detail is here;
  // drawing without it would cut off what arrives later.
  if (detail.isPending) return null;
  const summary = findEffort(overview.data, effort.root, effort.slug);
  const data = detail.data;
  const tickets = data?.tickets ?? [];
  const done = tickets.filter((ticket) => ticket.state === "done");
  const claimed = tickets.filter((ticket) => ticket.state === "claimed");
  const todo = tickets.filter((ticket) => ticket.state !== "done" && ticket.state !== "claimed");
  const fogSection = data?.sections.find((section) => section.name === "Not yet specified");
  const fog = fogSection?.items ?? [];
  const counts = summary?.counts;
  // Paseo never re-measures the popover, so the list's height is fixed from the folded rows; opening
  // Done scrolls inside it.
  const groups = [done, claimed, todo, fog].filter((group) => group.length);
  const folded = (groups.length + claimed.length + todo.length + fog.length) * ROW_H + 4;
  const listHeight = Math.min(LIST_MAX, Math.max(folded, Math.min(folded + done.length * ROW_H, LIST_MIN_OPEN)));
  return (
    <View style={{ width: WIDTH }}>
      <View style={{ paddingHorizontal: 6 }}>
        <View style={[ui.line, { gap: 6 }]}>
          <Icon name="Map" size={14} color={c.muted} />
          <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: c.fg, flexShrink: 1 }}>
            {effort.slug}
          </Text>
          {summary?.mapStatus ? <Tag c={c} text={summary.mapStatus} /> : null}
        </View>
        <Text numberOfLines={2} style={{ ...SMALL, color: c.muted, marginTop: 2, marginLeft: 20 }}>
          {data?.destination ?? summary?.destination ?? data?.displayPath ?? `.scratch/${effort.slug}`}
        </Text>
        {counts && (counts.total || fog.length) ? (
          <>
            <View style={{ marginTop: 10 }}>
              <RouteBar counts={counts} fog={fog.length} c={c} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 }}>
              <Text style={{ ...SMALL, color: c.fg, fontWeight: "600" }}>
                {counts.done}/{counts.total} done
              </Text>
              {counts.claimed ? <Text style={{ ...SMALL, color: c.muted }}>{counts.claimed} in progress</Text> : null}
              {todo.length ? <Text style={{ ...SMALL, color: c.muted }}>{todo.length} to do</Text> : null}
              <View style={ui.grow} />
              {fog.length ? <Text style={{ ...SMALL, color: c.muted, opacity: 0.75 }}>+ {fog.length} fog</Text> : null}
            </View>
          </>
        ) : null}
      </View>
      {groups.length ? (
        <ScrollView style={{ height: listHeight, marginTop: 10, borderTopWidth: 1, borderTopColor: c.border }} contentContainerStyle={{ paddingTop: 4 }}>
          {done.length ? (
            <RowButton c={c} onPress={() => setDoneOpen(!doneOpen)} label={doneOpen ? "Fold Done" : "Show Done"} style={{ flexDirection: "row", alignItems: "center", gap: 6, height: ROW_H, paddingHorizontal: 6 }}>
              <Icon name={doneOpen ? "ChevronDown" : "ChevronRight"} size={12} color={c.muted} />
              <Text style={{ ...SMALL, color: c.muted }}>Done</Text>
              <Text style={{ ...SMALL, color: c.muted, opacity: 0.6 }}>{done.length}</Text>
            </RowButton>
          ) : null}
          {doneOpen
            ? done.map((ticket) => <TicketRow key={ticket.rel} c={c} compact state="done" num={ticket.num} title={ticket.title} onPress={() => go({ kind: "ticket", rel: ticket.rel })} />)
            : null}
          {claimed.length ? <GroupHead c={c} label="In progress" count={claimed.length} /> : null}
          {claimed.map((ticket) => (
            <TicketRow key={ticket.rel} c={c} compact state={ticket.state} num={ticket.num} title={ticket.title} tail={rowTail(ticket)} onPress={() => go({ kind: "ticket", rel: ticket.rel })} />
          ))}
          {todo.length ? <GroupHead c={c} label="To do" count={todo.length} /> : null}
          {todo.map((ticket) => (
            <TicketRow
              key={ticket.rel}
              c={c}
              compact
              faded={daysSince(ticket.mtimeMs) >= OLD_DAYS}
              state={ticket.state}
              num={ticket.num}
              title={ticket.title}
              tail={rowTail(ticket)}
              onPress={() => go({ kind: "ticket", rel: ticket.rel })}
            />
          ))}
          {fog.length ? <GroupHead c={c} label="Fog · not yet specified" count={fog.length} /> : null}
          {fog.map((item, index) => (
            <FogRow key={index} c={c} title={item.title} onPress={() => go({ kind: "doc", rel: "map.md", section: fogSection?.heading })} />
          ))}
        </ScrollView>
      ) : null}
      <View style={{ marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: c.border, flexDirection: "row", alignItems: "center", gap: 2 }}>
        <FooterButton c={c} icon="PanelRight" label="Open panel" onPress={() => go()} />
        <FooterButton c={c} icon="LayoutGrid" label="All efforts" onPress={() => { close(); openAllEfforts(workspaceId, summary?.key); }} />
        <FooterButton c={c} icon="Search" label="Switch…" onPress={() => go({ kind: "switch" })} />
        <View style={ui.grow} />
        <FooterButton
          c={c}
          icon="Unlink"
          label="Unbind"
          onPress={() => {
            bindOrToast(toast, workspaceId, { kind: "clear" });
            close();
          }}
        />
      </View>
    </View>
  );
}
