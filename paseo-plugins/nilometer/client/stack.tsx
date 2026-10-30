import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type DeskCard, type InboxCard, MEMO_KINDS } from "../shared/desk";
import { Card, type CardScene, stateOf } from "./card";
import { TYPE } from "./palette";

/** The open memos of one batch in one group, in the group's order: the first is the one that sorts highest. */
export interface Stack {
  kind: "stack";
  batch: string;
  cards: InboxCard[];
}
export type Entry = DeskCard | Stack;

/** Folds the open inbox memos that share a batch into a stack at the place of their first member; a lone member stays a card. */
export function stacked(cards: DeskCard[]): Entry[] {
  const stacks = new Map<string, Stack>();
  const entries: Entry[] = [];
  for (const card of cards) {
    const batch = card.kind === "inbox" && !card.settled ? card.batch?.trim() : null;
    if (!batch) {
      entries.push(card);
      continue;
    }
    const stack = stacks.get(batch);
    if (stack) stack.cards.push(card as InboxCard);
    else {
      const next: Stack = { kind: "stack", batch, cards: [card as InboxCard] };
      stacks.set(batch, next);
      entries.push(next);
    }
  }
  return entries.map((entry) => (entry.kind === "stack" && entry.cards.length === 1 ? entry.cards[0]! : entry));
}

export const entryKey = (entry: Entry) => (entry.kind === "stack" ? `stack/${entry.batch}` : `${entry.kind}/${entry.settled ? "s" : "l"}/${entry.name}`);

/** `<effort> · round N` when every member shares one effort and the id ends in `-rN`; otherwise the id itself. */
function titleOf(stack: Stack): string {
  const efforts = new Set(stack.cards.map((card) => card.effort?.trim() ?? ""));
  const effort = efforts.size === 1 ? [...efforts][0] : "";
  const round = /-r(\d+)$/.exec(stack.batch)?.[1];
  return effort && round ? `${effort} · round ${round}` : stack.batch;
}

/** `3 memos · 2 ask · 1 revisit · 1 blocking`: kinds by count, then blocking. */
function countsOf(stack: Stack): string {
  const kinds = new Map<string, number>();
  for (const card of stack.cards) if (card.memoKind) kinds.set(card.memoKind, (kinds.get(card.memoKind) ?? 0) + 1);
  const rank = (kind: string) => {
    const i = (MEMO_KINDS as readonly string[]).indexOf(kind);
    return i < 0 ? MEMO_KINDS.length : i;
  };
  const byCount = [...kinds.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]));
  const blocking = stack.cards.filter((card) => card.priority === "blocking").length;
  return [`${stack.cards.length} memos`, ...byCount.map(([kind, n]) => `${n} ${kind}`), ...(blocking ? [`${blocking} blocking`] : [])].join(" · ");
}

/** A batch as one card: its face opens in place to the member cards, which open the memo as usual. */
export function StackCard({ stack, scene }: { stack: Stack; scene: CardScene }) {
  const { c, compact } = scene;
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const title = titleOf(stack);
  const counts = countsOf(stack);
  const paper = { position: "absolute" as const, backgroundColor: c.s1, borderWidth: 1, borderColor: c.border };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ paddingBottom: open ? 0 : 6 }}>
        {open ? null : (
          <>
            <View style={{ ...paper, left: 8, right: 8, top: 6, bottom: 0 }} />
            <View style={{ ...paper, left: 4, right: 4, top: 3, bottom: 3 }} />
          </>
        )}
        <Pressable
          onPress={() => setOpen(!open)}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`Stack: ${title}, ${counts}`}
          accessibilityHint={open ? "Folds the memos back into the stack" : "Shows the memos in this stack"}
          style={{
            backgroundColor: c.s1,
            borderWidth: 1,
            borderColor: hovered && !compact ? c.alpha(c.fg, 0.16) : c.border,
            paddingHorizontal: 11,
            paddingVertical: 9,
            gap: 5,
          }}
        >
          <View style={{ position: "absolute", left: -1, top: 11, width: 3, height: 14, backgroundColor: c.state(stateOf(stack.cards[0]!)) }} />
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Text style={{ ...TYPE.title, color: c.fg, flex: 1 }}>{title}</Text>
            <View style={{ height: TYPE.title.lineHeight, justifyContent: "center" }}>
              <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} color={c.muted} />
            </View>
          </View>
          <Text style={{ ...TYPE.small, color: c.meta }}>{counts}</Text>
        </Pressable>
      </View>
      {open ? (
        <View style={{ gap: 8, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: c.border }}>
          {stack.cards.map((card) => (
            <Card key={card.name} card={card} scene={scene} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
