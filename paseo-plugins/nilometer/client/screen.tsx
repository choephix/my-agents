import type { PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, SidebarRow } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { type Desk, type DeskCard, type Kind, type Priority, PRIORITIES } from "../shared/desk";
import { age, Card, type CardScene } from "./card";
import { type Palette, paletteOf, TYPE } from "./palette";
import { refresh, useDesk } from "./store";

export const SCREEN_ID = "desk";

const PRIORITY_RANK: Record<Priority, number> = { blocking: 0, revisit: 1, whenever: 2 };
const VIEWS: { kind: Kind; label: string }[] = [
  { kind: "inbox", label: "Inbox" },
  { kind: "doing", label: "Doing" },
];
const EMPTY: Record<Kind, string> = { inbox: "Nothing in your inbox.", doing: "Nothing in progress." };
const COLUMN_WIDTH = 300;
const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

const blockingCount = (desk: Desk): number => desk.inbox.filter((card) => !card.settled && card.priority === "blocking").length;

interface Column {
  key: string;
  title: string;
  /** Workspace hue (1-based), or null for the closing groups (settled, not live). */
  hue: number | null;
  cards: DeskCard[];
  blocking: number;
}

/** Live cards of one kind as one column per asker, with settled cards in a folded group. */
function columnsOf(desk: Desk, kind: Kind, priority: Priority | null): Column[] {
  const source = kind === "inbox" ? desk.inbox : desk.doing;
  const groups = new Map<string, DeskCard[]>();
  for (const card of source) {
    if (card.settled || (priority && kind === "inbox" && card.priority !== priority)) continue;
    const key = card.asker?.agentId ?? `${kind}:unassigned`;
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const rankOf = (card: DeskCard) => (card.priority === "blocking" ? 0 : card.priority === "revisit" ? 1 : 2);
  const live = [...groups.entries()]
    .map(([key, cards]) => {
      const sorted = [...cards].sort((a, b) => rankOf(a) - rankOf(b));
      const title = cards[0]?.asker?.name ?? (kind === "inbox" ? "Inbox" : "Doing");
      return { key, title, hue: 1, cards: sorted, blocking: cards.filter((card) => card.priority === "blocking").length };
    })
    .sort((a, b) => rankOf(a.cards[0]!) - rankOf(b.cards[0]!) || b.cards.length - a.cards.length || a.title.localeCompare(b.title));
  const settled = source.filter((card) => card.settled);
  return [...live, ...(settled.length ? [{ key: `${kind}:settled`, title: kind === "doing" ? "Done" : "Settled", hue: null, cards: settled, blocking: 0 }] : [])];
}

// Kept across visits to the screen (not across app restarts).
let lastView: Kind = "inbox";
let lastPriority: Priority | null = null;
const lastFolded = new Set<string>();
const lastOpened = new Set<string>();

/** Live columns start open; the closing groups start folded. */
const isFolded = (column: Column, folded: Set<string>, opened: Set<string>) => (column.hue === null ? !opened.has(column.key) : folded.has(column.key));

type HoverState = { pressed: boolean; hovered?: boolean };

/** Paseo's project badge: the workspace colour with its initial; plain for the closing groups. */
function Badge({ column, c }: { column: Column; c: Palette }) {
  if (column.hue === null) return <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: c.alpha(c.fg, 0.18) }} />;
  const initial = column.title.replace(/^[^A-Za-z0-9]+/, "")[0] ?? "?";
  return (
    <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: c.project(column.hue), alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 9, lineHeight: 11, color: "#ffffff" }}>{initial.toUpperCase()}</Text>
    </View>
  );
}

function ColumnHead({ column, c, onPress, touch }: { column: Column; c: Palette; onPress(): void; touch: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${column.title}, ${column.cards.length} cards${column.blocking ? `, ${column.blocking} blocking` : ""}. Fold`}
      style={({ hovered }: HoverState) => ({ flexDirection: "row", alignItems: "center", gap: 8, height: 26, paddingHorizontal: 4, marginBottom: 4, backgroundColor: hovered ? c.s1 : "transparent" })}
    >
      {({ hovered }: HoverState) => (
        <>
          <Badge column={column} c={c} />
          <Text numberOfLines={1} style={{ ...TYPE.heading, color: c.fg, flexShrink: 1 }}>
            {column.title}
          </Text>
          <Text style={{ ...TYPE.small, color: c.faint, fontVariant: ["tabular-nums"] }}>{column.cards.length}</Text>
          {column.blocking ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.danger }} />
              <Text style={{ ...TYPE.small, color: c.danger, fontVariant: ["tabular-nums"] }}>{column.blocking}</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          {touch || hovered ? <Icon name="ChevronsDownUp" size={14} color={c.muted} /> : null}
        </>
      )}
    </Pressable>
  );
}

function Pill({ column, c, onPress }: { column: Column; c: Palette; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${column.title}, ${column.cards.length} cards, folded. Open`}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingLeft: 6, paddingRight: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.s1 }}
    >
      {({ hovered }: HoverState) => (
        <>
          <Badge column={column} c={c} />
          <Text numberOfLines={1} style={{ ...TYPE.small, color: hovered ? c.fg : c.muted }}>
            {column.title}
          </Text>
          <Text style={{ ...TYPE.small, color: c.faint, fontVariant: ["tabular-nums"] }}>{column.cards.length}</Text>
        </>
      )}
    </Pressable>
  );
}

function Tab({ label, count, active, onPress, c }: { label: string; count: number; active: boolean; onPress(): void; c: Palette }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={({ hovered }: HoverState) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 28,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: active ? c.s2 : hovered ? c.s1 : "transparent",
      })}
    >
      <Text style={{ ...TYPE.heading, color: active ? c.fg : c.muted }}>{label}</Text>
      <Text style={{ ...TYPE.small, color: active ? c.muted : c.faint, fontVariant: ["tabular-nums"] }}>{count}</Text>
    </Pressable>
  );
}

export function DeskScreen({ theme, layout, navigation }: PluginScreenProps) {
  const c = useMemo(() => paletteOf(theme), [theme]);
  const { desk, error, loading, at } = useDesk();
  const [view, setView] = useState<Kind>(lastView);
  const [priority, setPriority] = useState<Priority | null>(lastPriority);
  const [folded, setFolded] = useState(() => new Set(lastFolded));
  const [opened, setOpened] = useState(() => new Set(lastOpened));
  const compact = layout.compact;
  const touch = compact || layout.platform !== "web";
  const gutter = compact ? 12 : 16;

  if (!desk) {
    return (
      <View style={{ flex: 1, backgroundColor: c.s0, padding: gutter, gap: 10 }}>
        <Text style={{ ...TYPE.body, color: error ? c.danger : c.muted }}>{error ? `Couldn't read the desk from Mainframe: ${error}` : "Reading the desk…"}</Text>
        {error ? (
          <Text onPress={() => void refresh()} accessibilityRole="button" style={{ ...TYPE.body, color: c.ok }}>
            Try again
          </Text>
        ) : null}
      </View>
    );
  }

  const toggle = (column: Column) => {
    const closing = column.hue === null;
    const next = new Set(closing ? opened : folded);
    if (next.has(column.key)) next.delete(column.key);
    else next.add(column.key);
    const keep = closing ? lastOpened : lastFolded;
    keep.clear();
    next.forEach((key) => keep.add(key));
    (closing ? setOpened : setFolded)(next);
  };
  const pickView = (kind: Kind) => {
    lastView = kind;
    lastPriority = null;
    setView(kind);
    setPriority(null);
  };
  const cyclePriority = () => {
    const order: (Priority | null)[] = [null, ...PRIORITIES];
    const next = order[(order.indexOf(priority) + 1) % order.length]!;
    lastPriority = next;
    setPriority(next);
  };

  const now = Date.now();
  const scene: CardScene = {
    desk,
    c,
    now,
    compact: touch,
    inboxByName: new Map(desk.inbox.map((card) => [card.name, card])),
    openAgent: navigation ? (agentId) => navigation.openAgent({ agentId }) : undefined,
  };
  const columns = columnsOf(desk, view, priority);
  const live = columns.filter((column) => column.hue !== null);
  const count = (kind: Kind) => (kind === "inbox" ? desk.inbox : desk.doing).filter((card) => !card.settled).length;
  const read = loading ? "Reading…" : error ? "Read failed, retry" : now - at < 60_000 ? "Read just now" : `Read ${age(new Date(at).toISOString(), now)} ago`;

  const tabs = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 36, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.s0 }}>
      {VIEWS.map((v) => (
        <Tab key={v.kind} label={v.label} count={count(v.kind)} active={view === v.kind} onPress={() => pickView(v.kind)} c={c} />
      ))}
      <View style={{ flex: 1 }} />
      {view === "inbox" ? (
        <Pressable
          onPress={cyclePriority}
          accessibilityRole="button"
          accessibilityLabel={`Showing ${priority ?? "all priorities"}. Show the next priority`}
          style={({ hovered }: HoverState) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 24,
            paddingHorizontal: 8,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: hovered ? c.s1 : "transparent",
          })}
        >
          <Icon name="ListFilter" size={12} color={c.muted} />
          <Text style={{ ...TYPE.small, color: c.muted }}>{priority ? cap(priority) : "All priorities"}</Text>
        </Pressable>
      ) : null}
      {compact ? null : <Text style={{ ...TYPE.small, color: error ? c.danger : c.faint, marginLeft: 6 }}>{read}</Text>}
      <Pressable
        onPress={() => void refresh()}
        accessibilityRole="button"
        accessibilityLabel={`${read}. Read the desk again`}
        style={({ hovered }: HoverState) => ({ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: hovered ? c.s1 : "transparent" })}
      >
        <Icon name="RefreshCw" size={14} color={error ? c.danger : c.muted} />
      </Pressable>
    </View>
  );

  const cardsOf = (column: Column): ReactNode =>
    column.cards.map((card) => <Card key={`${card.kind}/${card.settled ? "s" : "l"}/${card.name}`} card={card} scene={scene} />);
  const empty = !live.length ? (
    <Text style={{ ...TYPE.heading, color: c.muted, paddingHorizontal: gutter, paddingVertical: 24 }}>{priority && view === "inbox" ? `No ${priority} inbox items.` : EMPTY[view]}</Text>
  ) : null;
  const shut = columns.filter((column) => isFolded(column, folded, opened));
  const open = columns.filter((column) => !isFolded(column, folded, opened));
  const strip = shut.length ? (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: gutter, paddingTop: 10 }}>
      {shut.map((column) => (
        <Pill key={column.key} column={column} c={c} onPress={() => toggle(column)} />
      ))}
    </View>
  ) : null;

  if (compact) {
    return (
      <View style={{ flex: 1, backgroundColor: c.s0 }}>
        {tabs}
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={c.muted} />}
        >
          {strip}
          {empty}
          <View style={{ paddingHorizontal: gutter, paddingTop: 8, gap: 18 }}>
            {open.map((column) => (
              <View key={column.key}>
                <ColumnHead column={column} c={c} onPress={() => toggle(column)} touch />
                <View style={{ gap: 8 }}>{cardsOf(column)}</View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.s0 }}>
      {tabs}
      <View style={{ minHeight: 38 }}>{strip}</View>
      {empty}
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: 10, gap: 12, flexGrow: 1, alignItems: "stretch" }}>
        {open.map((column) => (
          <View key={column.key} style={{ width: COLUMN_WIDTH }}>
            <ColumnHead column={column} c={c} onPress={() => toggle(column)} touch={touch} />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 16, paddingLeft: 1 }}>
              {cardsOf(column)}
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function DeskSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const { desk } = useDesk();
  const blocking = desk ? blockingCount(desk) : 0;
  const c = paletteOf(theme);
  return (
    <SidebarRow
      icon="Inbox"
      label="Nilometer"
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
      trailing={blocking ? <Text style={{ ...TYPE.small, color: c.danger, fontVariant: ["tabular-nums"], paddingHorizontal: 8 }}>{blocking}</Text> : undefined}
    />
  );
}
