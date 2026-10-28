import { openExternalUrl } from "@getpaseo/plugin/client";
import { copyText, Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Desk, DeskCard, DeskPerson } from "../shared/desk";
import { Inline, prInfo, prsIn, prStyle, prUrl } from "./inline";
import { MONO, type Palette, TYPE } from "./palette";

export interface CardScene {
  desk: Desk;
  c: Palette;
  now: number;
  asksByName: Map<string, DeskCard>;
  openAgent?: (agentId: string) => void;
}

const DAY = 86_400_000;
const PR_GLYPH = { merged: "●", ready: "○", open: "○", conflict: "!", closed: "×", draft: "◌", unknown: "◌" } as const;

export function age(iso: string | null, now: number): string {
  if (!iso) return "";
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))} m`;
  if (ms < 2 * DAY) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / DAY)} d`;
}

/** The first paragraph of the body, when it is plain prose and short; the rest goes behind "more". */
function splitBody(body: string): { lead: string; rest: string } {
  const blocks = body.split(/\n\s*\n/).filter((b) => b.trim());
  const first = blocks[0]?.trim() ?? "";
  if (!first || first.length > 420 || /^([-*+]\s|\d+\.\s|#|```|>|\|)/.test(first)) return { lead: "", rest: blocks.join("\n\n") };
  return { lead: first.replace(/\s*\n\s*/g, " "), rest: blocks.slice(1).join("\n\n") };
}

function linkTarget(link: string, shared: Desk["shared"]): { label: string; url: string | null; agentId: string | null } {
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

function statusColor(c: Palette, status: string): string {
  if (status === "running") return c.ok;
  if (status === "error") return c.blocking;
  if (status === "gone") return c.alpha(c.muted, 0.5);
  return c.pr("open");
}

const reviveCommand = (p: DeskPerson): string | null =>
  p.omp && p.omp !== "unknown" && p.provider && p.cwd ? `paseo agent import ${p.omp} --provider ${p.provider} --cwd ${p.cwd}` : null;

/** A session chip: opens its Paseo tab, or copies the command that revives it when the tab is gone. */
function PersonChip({ person, role, scene, wide }: { person: DeskPerson; role?: string; scene: CardScene; wide?: boolean }) {
  const { c, openAgent } = scene;
  const toast = useToast();
  const gone = person.status === "gone";
  const revive = reviveCommand(person);
  const label = gone ? `${person.agentId?.slice(0, 8) ?? "unknown tab"} · gone` : (person.name ?? "Agent");
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
      accessibilityLabel={gone ? `${role ?? "asker"} gone${revive ? ", copy revive command" : ""}` : `Open ${label}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexShrink: 1,
        maxWidth: wide ? undefined : 200,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: pressed ? c.s2 : "transparent",
      })}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor(c, person.status) }} />
      <Text numberOfLines={1} style={{ ...TYPE.small, color: gone ? c.muted : c.fg, flexShrink: 1 }}>
        {role ? <Text style={{ color: c.muted }}>{role} </Text> : null}
        {label}
        {gone && revive ? <Text style={{ color: c.accent }}> ⧉ revive</Text> : null}
      </Text>
      {person.why && wide ? (
        <Text numberOfLines={1} style={{ ...TYPE.small, color: c.muted, flexShrink: 1 }}>
          {person.why}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Tag({ text, color, c }: { text: string; color: string; c: Palette }) {
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: c.alpha(color, 0.12) }}>
      <Text style={{ ...TYPE.label, color: c.alpha(color, 0.9), fontWeight: "600", letterSpacing: 0.4 }}>{text.toUpperCase()}</Text>
    </View>
  );
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Card({ card, scene }: { card: DeskCard; scene: CardScene }) {
  const { desk, c, now } = scene;
  const [more, setMore] = useState(false);
  const [info, setInfo] = useState(false);
  const doing = card.kind === "doing";
  const face = doing ? (card.now ?? card.title) : card.title;
  const { lead, rest } = doing ? { lead: "", rest: [card.now ? card.title : "", card.body].filter(Boolean).join("\n\n") } : splitBody(card.body);
  const hue = desk.workspaces.find((w) => w.key === card.workspace)?.hue ?? 1;
  const priColor = card.priority === "blocking" ? c.blocking : card.priority === "revisit" ? c.revisit : null;
  const dot = doing ? (card.quiet ? c.alpha(c.muted, 0.5) : c.ok) : (priColor ?? c.alpha(c.muted, 0.6));
  // References the visible text doesn't already carry.
  const shown = `${face}\n${card.answer ?? ""}\n${lead}\n${card.blocks ?? ""}`;
  const inText = prsIn(shown);
  const chips = card.prs.filter((n) => !inText.has(n));
  const words = `${shown}\n${rest}`;
  const asks = card.asks.filter((url) => !words.includes(url));
  const links = card.links.filter((url) => !url.includes(`github.com/${desk.repo}/pull/`) && !words.includes(url)).map((url) => linkTarget(url, desk.shared));
  const when = doing ? age(card.updated, now) : age(card.opened, now);
  const old = !doing && !card.closed && card.opened != null && now - Date.parse(card.opened) > DAY;
  const people: { person: DeskPerson; role: string }[] = [
    ...(card.asker ? [{ person: card.asker, role: doing ? "owner" : "asker" }] : []),
    ...card.sessions.map((person) => ({ person, role: "session" })),
    ...card.watchers.map((person) => ({ person, role: "watcher" })),
  ];

  return (
    <View
      style={{
        backgroundColor: c.s1,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: c.border,
        borderLeftWidth: 3,
        borderLeftColor: c.alpha(c.hue(hue), card.closed ? 0.25 : 0.55),
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 6,
        opacity: card.closed ? 0.7 : 1,
      }}
    >
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: dot }} />
        <View style={{ flex: 1 }}>
          <Inline text={face} desk={desk} c={c} style={{ ...TYPE.title, color: c.fg, fontWeight: "600" }} />
        </View>
        <Pressable
          onPress={() => setInfo((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Who, when, where"
          hitSlop={8}
          style={({ pressed }) => ({ paddingHorizontal: 6, borderRadius: 4, backgroundColor: pressed || info ? c.s2 : "transparent" })}
        >
          <Text style={{ ...TYPE.title, color: c.muted }}>⋯</Text>
        </Pressable>
      </View>

      {card.answer ? (
        <View style={{ borderLeftWidth: 2, borderLeftColor: c.alpha(c.ok, 0.6), paddingLeft: 8, gap: 2 }}>
          <Text style={{ ...TYPE.label, color: c.ok, fontWeight: "600" }}>✓ ANSWER</Text>
          <Inline text={card.answer} desk={desk} c={c} style={{ ...TYPE.body, color: c.fg }} />
        </View>
      ) : null}

      {lead ? <Inline text={lead} desk={desk} c={c} style={{ ...TYPE.body, color: c.alpha(c.fg, 0.85) }} /> : null}

      {rest ? (
        more ? (
          <View>
            <Markdown>{rest}</Markdown>
            <Pressable onPress={() => setMore(false)} accessibilityRole="button" hitSlop={6}>
              <Text style={{ ...TYPE.small, color: c.muted }}>less ▴</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setMore(true)} accessibilityRole="button" hitSlop={6}>
            <Text style={{ ...TYPE.small, color: c.muted }}>more ▾</Text>
          </Pressable>
        )
      ) : null}

      {chips.length || asks.length || links.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 2 }}>
          {chips.map((n) => {
            const { state, tip } = prInfo(desk, n);
            return (
              <Text key={`pr${n}`} onPress={() => void openExternalUrl(prUrl(desk, n))} accessibilityRole="link" accessibilityLabel={tip} style={{ ...TYPE.small, fontFamily: MONO, ...prStyle(c, state) }}>
                {PR_GLYPH[state]}#{n}
              </Text>
            );
          })}
          {asks.map((url) => {
            const name = url.replace(/^.*\//, "").replace(/\.md$/, "");
            const ask = scene.asksByName.get(name);
            const label = name.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
            const open = ask?.live;
            const color = open ? (ask?.priority === "blocking" ? c.blocking : ask?.priority === "revisit" ? c.revisit : c.fg) : c.muted;
            return (
              <Text key={url} onPress={() => void openExternalUrl(url)} accessibilityRole="link" style={{ ...TYPE.small, color }}>
                {open ? "? " : "✓ "}
                {label}
              </Text>
            );
          })}
          {links.map((link, i) => (
            <Text
              key={`l${i}`}
              onPress={link.agentId && scene.openAgent ? () => scene.openAgent!(link.agentId!) : link.url ? () => void openExternalUrl(link.url!) : undefined}
              accessibilityRole={link.url ? "link" : "text"}
              style={{ ...TYPE.small, color: link.url ? c.muted : c.alpha(c.muted, 0.6), textDecorationLine: link.url ? "underline" : "none" }}
            >
              {link.label}
            </Text>
          ))}
        </View>
      ) : null}

      {card.blocks ? (
        <Inline text={`⛔ blocks ${card.blocks}`} desk={desk} c={c} style={{ ...TYPE.small, color: c.alpha(c.blocking, 0.85), fontWeight: "600" }} />
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        {card.priority ? <Tag text={card.priority} color={priColor ?? c.muted} c={c} /> : null}
        {card.status === "answered" ? <Tag text="answered" color={c.ok} c={c} /> : null}
        {card.quiet ? <Tag text="quiet" color={c.muted} c={c} /> : null}
        {card.kind === "endeavors" && !card.closed ? <Tag text={card.status} color={c.muted} c={c} /> : null}
        {card.broken ? <Tag text="front matter unreadable" color={c.blocking} c={c} /> : null}
        {when ? <Text style={{ ...TYPE.label, fontFamily: MONO, color: old ? c.alpha(c.pr("open"), 0.85) : c.muted }}>{when}</Text> : null}
        <View style={{ flex: 1 }} />
        {card.asker ? <PersonChip person={card.asker} scene={scene} /> : null}
      </View>

      {info ? (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6, gap: 4 }}>
          {people.map(({ person, role }, i) => (
            <PersonChip key={i} person={person} role={role} scene={scene} wide />
          ))}
          <Text style={{ ...TYPE.small, color: c.muted }}>
            {card.opened ? `${doing ? "started" : "opened"} ${stamp(card.opened)}` : ""}
            {card.updated ? `${card.opened ? " · " : ""}updated ${stamp(card.updated)}` : ""}
          </Text>
          <Text selectable style={{ ...TYPE.label, fontFamily: MONO, color: c.muted }}>
            {card.file.replace(/^\/home\/[^/]+/, "~")}
          </Text>
          <Text onPress={() => void openExternalUrl(card.url)} accessibilityRole="link" style={{ ...TYPE.small, color: c.accent }}>
            Open the file
          </Text>
        </View>
      ) : null}
    </View>
  );
}
