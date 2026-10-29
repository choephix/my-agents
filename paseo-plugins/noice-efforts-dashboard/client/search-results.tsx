import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import type { EffortSummary, SearchResult } from "../shared/rpc";
import { age } from "./format";
import { Bar, Glyph, LABEL, ROW, SMALL, Tag, type Palette } from "./marks";
import { RowButton, styles as ui } from "./ui";

type TicketHit = SearchResult["tickets"][number];
type DocHit = SearchResult["docs"][number];

function Group({ c, title, count }: { c: Palette; title: string; count: number }) {
  return <Text style={{ ...LABEL, color: c.muted, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 }}>{`${title} · ${count}`}</Text>;
}

/**
 * Search results in three groups, replacing the list while a query is typed: efforts (with their
 * done count), tickets (live status glyph, effort, age) and docs (file, effort, age).
 */
export function SearchResults(props: {
  c: Palette;
  result: SearchResult | undefined;
  pending: boolean;
  /** Efforts matched another way (a workspace name), listed before the server's. */
  extraEfforts?: EffortSummary[];
  gutter?: number;
  onEffort(effort: EffortSummary): void;
  onTicket(ticket: TicketHit): void;
  onDoc(doc: DocHit): void;
}) {
  const { c, result } = props;
  const gutter = props.gutter ?? 12;
  const efforts = [...(props.extraEfforts ?? [])];
  for (const effort of result?.efforts ?? []) if (!efforts.some((known) => known.key === effort.key)) efforts.push(effort);
  const tickets = result?.tickets ?? [];
  const docs = result?.docs ?? [];
  if (!efforts.length && !tickets.length && !docs.length) {
    return <Text style={{ ...SMALL, color: c.muted, padding: gutter }}>{props.pending ? "Searching…" : "Nothing matches."}</Text>;
  }
  const row = { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28, paddingHorizontal: gutter } as const;
  return (
    <View>
      {efforts.length ? <Group c={c} title="Efforts" count={efforts.length} /> : null}
      {efforts.map((effort) => (
        <RowButton key={effort.key} c={c} onPress={() => props.onEffort(effort)} style={row}>
          {effort.counts.total ? <Bar done={effort.counts.done} total={effort.counts.total} c={c} /> : <View style={{ width: 34 }} />}
          <Text numberOfLines={1} style={{ ...ROW, color: c.fg, flexShrink: 1 }}>
            {effort.slug}
          </Text>
          {effort.mapStatus ? <Tag c={c} text={effort.mapStatus} /> : null}
          <View style={ui.grow} />
          <Text style={{ ...SMALL, color: c.muted }}>
            {effort.counts.total ? `${effort.counts.done}/${effort.counts.total} · ` : ""}
            {age(effort.touchedMs)}
          </Text>
        </RowButton>
      ))}
      {tickets.length ? <Group c={c} title="Tickets" count={tickets.length} /> : null}
      {tickets.map((ticket) => (
        <RowButton key={`${ticket.root}/${ticket.slug}/${ticket.rel}`} c={c} onPress={() => props.onTicket(ticket)} style={row}>
          <Glyph state={ticket.state} c={c} />
          <Text style={{ ...SMALL, color: c.muted, width: 18 }}>{ticket.num}</Text>
          <Text numberOfLines={1} style={{ ...ROW, color: ticket.state === "ready" || ticket.state === "claimed" ? c.fg : c.muted, flex: 1, minWidth: 0 }}>
            {ticket.title}
          </Text>
          <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, flexShrink: 1, maxWidth: "40%" }}>
            {ticket.short} · {age(ticket.mtimeMs)}
          </Text>
        </RowButton>
      ))}
      {docs.length ? <Group c={c} title="Docs" count={docs.length} /> : null}
      {docs.map((doc) => (
        <RowButton key={`${doc.root}/${doc.slug}/${doc.rel}`} c={c} onPress={() => props.onDoc(doc)} style={row}>
          <Icon name="File" size={12} color={c.muted} />
          <Text numberOfLines={1} style={{ ...ROW, color: c.fg, flex: 1, minWidth: 0 }}>
            {doc.rel}
          </Text>
          <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, flexShrink: 1, maxWidth: "40%" }}>
            {doc.short} · {age(doc.mtimeMs)}
          </Text>
        </RowButton>
      ))}
    </View>
  );
}
