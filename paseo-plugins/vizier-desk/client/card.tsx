import { openExternalUrl } from "@getpaseo/plugin/client";
import { copyText, Icon, Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Desk, DeskCard, DeskPerson, PrState } from "../shared/desk";
import { Inline, prInfo, prsIn, prStyle, prUrl } from "./inline";
import { type CardState, MONO, type Palette, TYPE } from "./palette";

export interface CardScene {
  desk: Desk;
  c: Palette;
  now: number;
  asksByName: Map<string, DeskCard>;
  openAgent?: (agentId: string) => void;
  /** Touch layout: no hover, so the ⋯ button never shows; tapping the card opens everything. */
  compact: boolean;
}

const DAY = 86_400_000;
const PR_ICON: Partial<Record<PrState, string>> = { merged: "GitMerge", closed: "GitPullRequestClosed", draft: "GitPullRequestDraft" };
const STATE_WORDS: Record<CardState, string> = {
  blocking: "Blocking",
  revisit: "Revisit",
  whenever: "Whenever",
  doing: "In flight",
  quiet: "In flight, quiet",
  done: "Settled",
  stray: "Not in a live state",
};

/** Markdown marks dropped, for accessibility labels. */
const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*|`/g, "");

export function age(iso: string | null, now: number): string {
  if (!iso) return "";
  const m = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

export function stateOf(card: DeskCard): CardState {
  if (card.closed) return "done";
  if (!card.live) return "stray";
  if (card.kind === "doing") return card.quiet ? "quiet" : "doing";
  return card.priority ?? "whenever";
}

/** The first paragraph of the body, when it is plain prose and short; the rest shows when the card opens. */
function splitBody(body: string): { lead: string; rest: string } {
  const blocks = body.split(/\n\s*\n/).filter((b) => b.trim());
  const first = blocks[0]?.trim() ?? "";
  if (!first || first.length > 420 || /^([-*+]\s|\d+\.\s|#|```|>|\|)/.test(first)) return { lead: "", rest: blocks.join("\n\n") };
  return { lead: first.replace(/\s*\n\s*/g, " "), rest: blocks.slice(1).join("\n\n") };
}

interface Target {
  label: string;
  url: string | null;
  agentId: string | null;
}

function linkTarget(link: string, shared: Desk["shared"]): Target {
  let m: RegExpMatchArray | null;
  if (link.startsWith("/")) {
    const served = shared.find(([dir]) => link.startsWith(dir));
    return { label: link.split("/").slice(-2).join("/"), url: served ? served[1] + link.slice(served[0].length) : null, agentId: null };
  }
  if ((m = link.match(/\/agent\/([0-9a-f-]{8,})/))) return { label: `tab ${m[1]!.slice(0, 8)}`, url: link, agentId: m[1]! };
  if ((m = link.match(/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)/))) return { label: `${m[1]}#${m[2]}`, url: link, agentId: null };
  if ((m = link.match(/linear\.app\/.*\/issue\/([A-Z]+-\d+)/))) return { label: m[1]!, url: link, agentId: null };
  if ((m = link.match(/^https?:\/\/[^/]+\/(.+?)\/?$/))) return { label: decodeURIComponent(m[1]!).split("/").slice(-2).join("/"), url: link, agentId: null };
  return { label: link.replace(/^https?:\/\//, ""), url: /^https?:/.test(link) ? link : null, agentId: null };
}

const follow = (t: Target, scene: CardScene) =>
  t.agentId && scene.openAgent ? () => scene.openAgent!(t.agentId!) : t.url ? () => void openExternalUrl(t.url!) : undefined;

const reviveCommand = (p: DeskPerson): string | null =>
  p.omp && p.omp !== "unknown" && p.provider && p.cwd ? `paseo agent import ${p.omp} --provider ${p.provider} --cwd ${p.cwd}` : null;

/** Paseo's status dot: blue running, red error, a ring when the tab is closed, nothing when idle. */
function StatusDot({ status, c }: { status: string; c: Palette }) {
  if (status === "gone") return <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: c.faint }} />;
  const color = status === "running" ? c.running : status === "error" ? c.danger : null;
  return color ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} /> : null;
}

/** A session: opens its Paseo tab, or copies the command that revives it when the tab is gone. */
function Person({ person, role, scene, wide }: { person: DeskPerson; role?: string; scene: CardScene; wide?: boolean }) {
  const { c, openAgent } = scene;
  const toast = useToast();
  const gone = person.status === "gone";
  const revive = reviveCommand(person);
  const label = gone ? (person.agentId?.slice(0, 8) ?? "unknown tab") : (person.name ?? "Agent");
  const onPress = gone
    ? revive
      ? () =>
          void copyText(revive).then(
            () => toast.show("Revive command copied", { variant: "success" }),
            () => toast.error("Couldn't copy"),
          )
      : undefined
    : person.agentId && openAgent
      ? () => openAgent(person.agentId!)
      : undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={gone ? `${role ?? "Asker"}'s tab is closed${revive ? ", copy the revive command" : ""}` : `Open ${label}`}
      hitSlop={4}
      style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1, minWidth: 0, maxWidth: wide ? undefined : 150 }}
    >
      {({ hovered }: { pressed: boolean; hovered?: boolean }) => (
        <>
          <Text numberOfLines={1} style={{ ...TYPE.small, color: hovered ? c.fg : gone ? c.meta : c.metaStrong, flexShrink: 1 }}>
            {role ? <Text style={{ color: c.meta }}>{role} </Text> : null}
            {label}
            {wide && gone && revive ? <Text style={{ color: c.meta }}> · tap to copy the revive command</Text> : null}
            {wide && person.why ? <Text style={{ color: c.meta }}> · {person.why}</Text> : null}
          </Text>
          <StatusDot status={person.status} c={c} />
        </>
      )}
    </Pressable>
  );
}

function PrChip({ n, scene }: { n: number; scene: CardScene }) {
  const { desk, c } = scene;
  const { state, tip } = prInfo(desk, n);
  const style = prStyle(c, state);
  return (
    <Pressable onPress={() => void openExternalUrl(prUrl(desk, n))} accessibilityRole="link" accessibilityLabel={tip} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <Icon name={PR_ICON[state] ?? "GitPullRequest"} size={11} color={style.color as string} />
      <Text style={{ ...TYPE.small, ...style, fontVariant: ["tabular-nums"] }}>{n}</Text>
    </Pressable>
  );
}

function RefLink({ target, scene }: { target: Target; scene: CardScene }) {
  const { c } = scene;
  const onPress = follow(target, scene);
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="link" hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0, maxWidth: 110 }}>
      {({ hovered }: { pressed: boolean; hovered?: boolean }) => (
        <>
          <Icon name={target.agentId ? "SquareTerminal" : "FileText"} size={11} color={hovered ? c.fg : c.meta} />
          <Text numberOfLines={1} style={{ ...TYPE.small, color: hovered ? c.fg : c.meta, flexShrink: 1 }}>
            {target.label.split("/").pop()}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Card({ card, scene }: { card: DeskCard; scene: CardScene }) {
  const { desk, c, now, compact } = scene;
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(false);
  const [hovered, setHovered] = useState(false);
  const doing = card.kind === "doing";
  const state = stateOf(card);
  const face = doing ? (card.now ?? card.title) : card.title;
  const nowLine = doing ? null : card.now;
  const { lead, rest } = doing ? { lead: "", rest: [card.now ? card.title : "", card.body].filter(Boolean).join("\n\n") } : splitBody(card.body);
  // References the visible text doesn't already carry.
  const shown = `${face}\n${card.answer ?? ""}\n${nowLine ?? ""}\n${lead}\n${card.blocks ?? ""}`;
  const inText = prsIn(shown);
  const chips = card.prs.filter((n) => !inText.has(n));
  const words = `${shown}\n${rest}`;
  const links = card.links.filter((url) => !url.includes(`github.com/${desk.repo}/pull/`) && !words.includes(url)).map((url) => linkTarget(url, desk.shared));
  const asks = card.asks.filter((url) => !words.includes(url));
  const when = doing ? age(card.updated, now) : age(card.opened, now);
  const old = !doing && !card.closed && card.opened != null && now - Date.parse(card.opened) > DAY;
  const details = open || info;
  const people: { person: DeskPerson; role: string }[] = [
    ...(card.asker ? [{ person: card.asker, role: doing ? "Owner" : "Asker" }] : []),
    ...card.sessions.map((person) => ({ person, role: "Session" })),
    ...card.watchers.map((person) => ({ person, role: "Watcher" })),
  ];

  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={`${STATE_WORDS[state]}: ${plain(face)}`}
      accessibilityState={{ expanded: open }}
      style={{
        backgroundColor: c.s1,
        borderWidth: 1,
        borderColor: hovered ? c.alpha(c.fg, 0.16) : c.border,
        paddingHorizontal: 11,
        paddingVertical: 9,
        gap: 5,
      }}
    >
      <View style={{ position: "absolute", left: -1, top: 11, width: 3, height: 14, backgroundColor: c.state(state) }} />
      {!compact && (hovered || info) ? (
        <Pressable
          onPress={() => setInfo((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="People, times and file"
          style={({ hovered: over }: { pressed: boolean; hovered?: boolean }) => ({
            position: "absolute",
            top: 6,
            right: 6,
            width: 22,
            height: 22,
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
            backgroundColor: over || info ? c.s2 : "transparent",
          })}
        >
          <Icon name="Ellipsis" size={14} color={c.muted} />
        </Pressable>
      ) : null}

      <Inline text={face} desk={desk} c={c} style={{ ...TYPE.title, color: card.closed ? c.muted : c.fg, paddingRight: compact ? 0 : 18 }} />

      {card.answer ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View style={{ paddingTop: 2 }}>
            <Icon name="CornerDownRight" size={12} color={c.ok} />
          </View>
          <Text style={{ ...TYPE.body, color: c.fg, flex: 1 }}>
            <Text style={{ color: c.muted }}>You: </Text>
            <Inline text={card.answer} desk={desk} c={c} style={{ ...TYPE.body, color: c.fg }} />
          </Text>
        </View>
      ) : null}
      {nowLine ? <Inline text={nowLine} desk={desk} c={c} style={{ ...TYPE.body, color: c.body }} lines={open ? undefined : 3} /> : null}
      {lead ? <Inline text={lead} desk={desk} c={c} style={{ ...TYPE.body, color: c.body }} lines={open ? undefined : 3} /> : null}
      {open && rest ? <Markdown>{rest}</Markdown> : null}

      {card.blocks ? (
        <View style={{ backgroundColor: c.alpha(c.danger, 0.08), paddingHorizontal: 5, paddingVertical: 2 }}>
          <Inline text={`Blocks ${card.blocks}`} desk={desk} c={c} style={{ ...TYPE.small, color: c.danger }} />
        </View>
      ) : null}
      {card.broken ? <Text style={{ ...TYPE.small, color: c.danger }}>The front matter can't be read.</Text> : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 16, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6, marginTop: 1 }}>
        {card.asker ? <Person person={card.asker} scene={scene} /> : null}
        {links[0] ? <RefLink target={links[0]} scene={scene} /> : null}
        <View style={{ flex: 1 }} />
        {chips.map((n) => (
          <PrChip key={n} n={n} scene={scene} />
        ))}
        {when ? <Text style={{ ...TYPE.small, color: old ? c.warn : c.meta, fontVariant: ["tabular-nums"] }}>{when}</Text> : null}
      </View>

      {details ? (
        <View style={{ gap: 4, paddingTop: 2 }}>
          {people.map(({ person, role }, i) => (
            <Person key={i} person={person} role={role} scene={scene} wide />
          ))}
          {asks.map((url) => {
            const name = url.replace(/^.*\//, "").replace(/\.md$/, "");
            const ask = scene.asksByName.get(name);
            const label = name.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
            return (
              <Text key={url} onPress={() => void openExternalUrl(url)} accessibilityRole="link" style={{ ...TYPE.small, color: ask?.live ? c.metaStrong : c.meta }}>
                {ask?.live ? "Open ask: " : "Settled ask: "}
                {label}
              </Text>
            );
          })}
          {links.map((t, i) => (
            <Text key={i} onPress={follow(t, scene)} accessibilityRole="link" style={{ ...TYPE.small, color: c.meta, textDecorationLine: t.url || t.agentId ? "underline" : "none" }}>
              {t.label}
            </Text>
          ))}
          <Text style={{ ...TYPE.small, color: c.meta }}>
            {card.opened ? `${doing ? "Started" : "Opened"} ${stamp(card.opened)}` : ""}
            {card.updated ? `${card.opened ? " · " : ""}updated ${stamp(card.updated)}` : ""}
          </Text>
          <Text selectable style={{ ...TYPE.small, fontFamily: MONO, color: c.meta }}>
            {card.file.replace(/^\/home\/[^/]+/, "~")}
          </Text>
          <Text onPress={() => void openExternalUrl(card.url)} accessibilityRole="link" style={{ ...TYPE.small, color: c.ok }}>
            Open the file
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
