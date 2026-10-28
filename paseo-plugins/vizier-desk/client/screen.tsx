import type { PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { ScrollView, SidebarRow } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { type Desk, type DeskCard, type Kind, type Priority, PRIORITIES } from "../shared/desk";
import { age, Card, type CardScene } from "./card";
import { type Palette, paletteOf, TYPE } from "./palette";
import { refresh, useDesk } from "./store";

export const SCREEN_ID = "desk";

const PRIORITY_RANK: Record<Priority, number> = { blocking: 0, revisit: 1, whenever: 2 };
const VIEWS: { kind: Kind; label: string }[] = [
  { kind: "asks", label: "Asks" },
  { kind: "doing", label: "Doing" },
  { kind: "endeavors", label: "Endeavors" },
];
const EMPTY: Record<Kind, string> = { asks: "Nothing waits on you.", doing: "Nothing in flight.", endeavors: "No endeavors yet." };
const COLUMN_WIDTH = 360;

const blockingCount = (desk: Desk): number => desk.cards.filter((card) => card.kind === "asks" && card.live && card.priority === "blocking").length;

interface Column {
  key: string;
  title: string;
  /** Workspace hue (1–12), or null for the closing groups (settled, not live). */
  hue: number | null;
  cards: DeskCard[];
  blocking: number;
}

/** Live cards of one kind as one column per workspace, the most urgent column first; Mainframe's /desk order. */
function columnsOf(desk: Desk, kind: Kind, priority: Priority | null): { live: Column[]; tail: Column[] } {
  const groups = new Map<string, DeskCard[]>();
  for (const card of desk.cards) {
    if (card.kind !== kind || !card.live || (priority && kind === "asks" && card.priority !== priority)) continue;
    groups.set(card.workspace, [...(groups.get(card.workspace) ?? []), card]);
  }
  const rank = (cards: DeskCard[]) => Math.min(...cards.map((card) => (card.priority ? PRIORITY_RANK[card.priority] : 3)));
  const live = [...groups.entries()]
    .map(([key, cards]) => {
      const workspace = desk.workspaces.find((w) => w.key === key);
      return { key, title: workspace?.title ?? key, hue: workspace?.hue ?? 1, cards, blocking: cards.filter((card) => card.priority === "blocking").length };
    })
    .sort((a, b) => rank(a.cards) - rank(b.cards) || b.cards.length - a.cards.length || a.title.localeCompare(b.title));
  const stray = desk.cards.filter((card) => card.kind === kind && !card.live && !card.closed);
  const closed = desk.cards.filter((card) => card.kind === kind && card.closed);
  const tail: Column[] = [
    ...(stray.length ? [{ key: `${kind}:stray`, title: "Not in a live state", hue: null, cards: stray, blocking: 0 }] : []),
    ...(closed.length ? [{ key: `${kind}:closed`, title: kind === "doing" ? "Done" : "Settled", hue: null, cards: closed, blocking: 0 }] : []),
  ];
  return { live, tail };
}

// Kept across visits to the screen (not across app restarts).
let lastView: Kind = "asks";
let lastPriority: Priority | null = null;
const lastFolded = new Set<string>();
const lastOpened = new Set<string>();

/** Live columns start open; the closing groups start folded. */
const isFolded = (column: Column, folded: Set<string>, opened: Set<string>) => (column.hue === null ? !opened.has(column.key) : folded.has(column.key));

function Seg({ c, items }: { c: Palette; items: { key: string; label: string; active: boolean; onPress(): void; color?: string }[] }) {
  return (
    <View style={{ flexDirection: "row", borderRadius: 8, borderWidth: 1, borderColor: c.border, overflow: "hidden" }}>
      {items.map((item, i) => (
        <Pressable
          key={item.key}
          onPress={item.onPress}
          accessibilityRole="tab"
          accessibilityState={{ selected: item.active }}
          style={({ pressed }) => ({
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderLeftWidth: i ? 1 : 0,
            borderLeftColor: c.border,
            backgroundColor: item.active ? c.s2 : pressed ? c.s1 : "transparent",
          })}
        >
          <Text style={{ ...TYPE.small, color: item.active ? c.fg : (item.color ?? c.muted), fontWeight: item.active ? "600" : "400" }}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ColumnHead({ column, c, folded, onPress, pill }: { column: Column; c: Palette; folded: boolean; onPress(): void; pill?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${column.title}, ${column.cards.length} cards${column.blocking ? `, ${column.blocking} blocking` : ""}, ${folded ? "folded" : "open"}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: pill ? 10 : 2,
        paddingVertical: pill ? 4 : 4,
        borderRadius: pill ? 999 : 6,
        borderWidth: pill ? 1 : 0,
        borderColor: c.border,
        backgroundColor: pressed ? c.s1 : "transparent",
      })}
    >
      <Text numberOfLines={1} style={{ ...TYPE.small, fontWeight: "700", letterSpacing: 0.6, color: column.hue === null ? c.muted : c.hue(column.hue), flexShrink: 1 }}>
        {column.title.toUpperCase()}
      </Text>
      {column.blocking ? <Text style={{ ...TYPE.label, fontWeight: "700", color: c.alpha(c.blocking, 0.9) }}>•{column.blocking}</Text> : null}
      <Text style={{ ...TYPE.label, color: c.muted }}>{column.cards.length}</Text>
      {pill ? null : <View style={{ flex: 1 }} />}
      <Text style={{ ...TYPE.small, color: c.muted }}>{folded ? "⌄" : "⌃"}</Text>
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
  const gutter = compact ? 12 : 20;

  if (!desk) {
    return (
      <View style={{ flex: 1, backgroundColor: c.s0, padding: gutter, gap: 10 }}>
        <Text style={{ ...TYPE.body, color: error ? c.blocking : c.muted }}>{error ? `Couldn't read the desk from Mainframe: ${error}` : "Reading the desk…"}</Text>
        {error ? (
          <Text onPress={() => void refresh()} accessibilityRole="button" style={{ ...TYPE.body, color: c.accent }}>
            Try again
          </Text>
        ) : null}
      </View>
    );
  }

  const toggle = (column: Column) => {
    const target = column.hue === null ? opened : folded;
    const next = new Set(target);
    if (next.has(column.key)) next.delete(column.key);
    else next.add(column.key);
    const keep = column.hue === null ? lastOpened : lastFolded;
    keep.clear();
    next.forEach((key) => keep.add(key));
    (column.hue === null ? setOpened : setFolded)(next);
  };
  const pickView = (kind: Kind) => {
    lastView = kind;
    setView(kind);
  };
  const pickPriority = (p: Priority | null) => {
    lastPriority = p;
    setPriority(p);
  };

  const now = Date.now();
  const scene: CardScene = {
    desk,
    c,
    now,
    asksByName: new Map(desk.cards.filter((card) => card.kind === "asks").map((card) => [card.name, card])),
    openAgent: navigation ? (agentId) => navigation.openAgent({ agentId }) : undefined,
  };
  const { live, tail } = columnsOf(desk, view, priority);
  const count = (kind: Kind) => desk.cards.filter((card) => card.kind === kind && card.live).length;
  const asksOpen = desk.cards.filter((card) => card.kind === "asks" && card.live);
  const byPriority = (p: Priority) => asksOpen.filter((card) => card.priority === p).length;

  const bar = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, paddingHorizontal: gutter, paddingTop: compact ? 10 : 14, paddingBottom: 10 }}>
      <Seg c={c} items={VIEWS.map((v) => ({ key: v.kind, label: `${v.label} ${count(v.kind)}`, active: view === v.kind, onPress: () => pickView(v.kind) }))} />
      {view === "asks" ? (
        <Seg
          c={c}
          items={[
            { key: "all", label: "All", active: priority === null, onPress: () => pickPriority(null) },
            ...PRIORITIES.map((p) => ({
              key: p,
              label: `${p[0]!.toUpperCase()}${p.slice(1)} ${byPriority(p)}`,
              active: priority === p,
              color: p === "blocking" && byPriority(p) ? c.alpha(c.blocking, 0.9) : undefined,
              onPress: () => pickPriority(priority === p ? null : p),
            })),
          ]}
        />
      ) : null}
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={() => void refresh()}
        accessibilityRole="button"
        accessibilityLabel="Read the desk again"
        style={({ pressed }) => ({ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: pressed ? c.s1 : "transparent" })}
      >
        <Text style={{ ...TYPE.label, color: error ? c.blocking : c.muted }}>
          {loading ? "reading…" : error ? `read failed · retry` : now - at < 60_000 ? "read just now ↻" : `read ${age(new Date(at).toISOString(), now)} ago ↻`}
        </Text>
      </Pressable>
    </View>
  );

  const cardsOf = (column: Column): ReactNode =>
    column.cards.map((card) => <Card key={`${card.kind}/${card.closed ? "c" : "l"}/${card.name}`} card={card} scene={scene} />);
  const empty = !live.length ? <Text style={{ ...TYPE.body, color: c.muted, paddingHorizontal: gutter }}>{priority && view === "asks" ? `No ${priority} asks.` : EMPTY[view]}</Text> : null;

  if (compact) {
    return (
      <View style={{ flex: 1, backgroundColor: c.s0 }}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32, gap: 14 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={c.muted} />}
        >
          {bar}
          {empty}
          {[...live, ...tail].map((column) => {
            const shut = isFolded(column, folded, opened);
            return (
              <View key={column.key} style={{ paddingHorizontal: gutter, gap: 8 }}>
                <ColumnHead column={column} c={c} folded={shut} onPress={() => toggle(column)} />
                {shut ? null : cardsOf(column)}
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  const all = [...live, ...tail];
  const shut = all.filter((column) => isFolded(column, folded, opened));
  const open = all.filter((column) => !isFolded(column, folded, opened));
  return (
    <View style={{ flex: 1, backgroundColor: c.s0 }}>
      {bar}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: gutter, paddingBottom: 10, minHeight: 40 }}>
        {shut.map((column) => (
          <ColumnHead key={column.key} column={column} c={c} folded pill onPress={() => toggle(column)} />
        ))}
      </View>
      {empty}
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 16, flexGrow: 1, alignItems: "stretch" }}>
        {open.map((column) => (
          <View key={column.key} style={{ width: COLUMN_WIDTH, gap: 6 }}>
            <ColumnHead column={column} c={c} folded={false} onPress={() => toggle(column)} />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
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
      label="Vizier desk"
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
      trailing={blocking ? <Text style={{ ...TYPE.label, fontWeight: "700", color: c.blocking, paddingHorizontal: 8 }}>{blocking}</Text> : undefined}
    />
  );
}
