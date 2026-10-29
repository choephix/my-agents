import { openExternalUrl } from "@getpaseo/plugin/client";
import { copyText, Icon, Markdown, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import type { Desk, DeskCard, DeskPerson, PrState } from "../shared/desk";
import { Inline, prInfo, prsIn, prStyle, prUrl } from "./inline";
import { type CardState, MONO, type Palette, TYPE } from "./palette";
import { refresh, writeMemo } from "./store";

export interface CardScene {
  desk: Desk;
  c: Palette;
  now: number;
  inboxByName: Map<string, DeskCard>;
  openAgent?: (agentId: string) => void;
  /** Touch layout: no hover highlight. */
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
  if (card.settled) return "done";
  if (card.kind === "doing") return "doing";
  if (card.priority === "blocking") return "blocking";
  if (card.priority === "revisit") return "revisit";
  return "whenever";
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
/** What tapping an ask's asker puts on the clipboard: the composer can't be prefilled from a plugin. */
function replyOf(card: DeskCard): string | undefined {
  if (card.kind !== "inbox") return undefined;
  return `Re: ${card.url}\n\n`;
}

function Person({ person, role, scene, wide, reply }: { person: DeskPerson; role?: string; scene: CardScene; wide?: boolean; reply?: string }) {
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
      ? async () => {
          const copied = reply ? await copyText(reply).then(() => true, () => false) : undefined;
          openAgent(person.agentId!);
          // Raised after opening the agent so it shows over the agent view while you paste.
          if (copied === true) toast.show("Copied a pointer to the ask. Paste it into the prompt to answer", { variant: "success", durationMs: 6000 });
          if (copied === false) toast.show(`Couldn't copy the pointer. The ask is ${reply!.slice(4).trim()}`, { variant: "error", durationMs: 8000 });
        }
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

/** What the card shows beyond its face: references, people and links. */
function refsOf(card: DeskCard, desk: Desk, shown: string, rest: string) {
  const words = `${shown}\n${rest}`;
  return {
    links: card.links.filter((url) => !url.includes(`github.com/${desk.repo}/pull/`) && !words.includes(url)).map((url) => linkTarget(url, desk.shared)),
    memos: card.kind === "doing" ? card.memos.filter((url) => !words.includes(url)) : [],
  };
}

function shownOf(card: DeskCard) {
  const doing = card.kind === "doing";
  const face = card.title;
  const answers = card.answers.map((answer) => answer.reply).join("\n\n");
  const body = splitBody(card.body);
  const lead = body.lead.trim() === face.trim() ? "" : body.lead;
  const rest = body.rest;
  const nowLine = doing && "now" in card ? (card as DeskCard & { now?: string | null }).now ?? null : null;
  const shown = `${face}\n${answers}\n${lead}\n${card.blocks ?? ""}`;
  return { doing, face, nowLine, lead, rest: [answers, rest].filter(Boolean).join("\n\n"), shown };
}

function Blocks({ card, desk, c, size }: { card: DeskCard; desk: Desk; c: Palette; size: { fontSize: number; lineHeight: number } }) {
  if (!card.blocks) return null;
  return (
    <View style={{ backgroundColor: c.alpha(c.danger, 0.08), paddingHorizontal: 5, paddingVertical: 2 }}>
      <Inline text={`Blocks ${card.blocks}`} desk={desk} c={c} style={{ ...size, color: c.danger }} />
    </View>
  );
}

function Answer({ card, desk, c, size }: { card: DeskCard; desk: Desk; c: Palette; size: { fontSize: number; lineHeight: number } }) {
  if (!card.answers.length) return null;
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name="CornerDownRight" size={12} color={c.ok} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        {card.answers.map((answer) => (
          <Text key={answer.label} style={{ ...size, color: c.fg }}>
            <Text style={{ color: c.muted }}>{answer.label}: </Text>
            <Inline text={answer.reply} desk={desk} c={c} style={{ ...size, color: c.fg }} />
          </Text>
        ))}
      </View>
    </View>
  );
}

const MODAL = { title: { fontSize: 15, lineHeight: 21, fontWeight: "600" as const }, body: { fontSize: 13, lineHeight: 19 }, label: { fontSize: 11, lineHeight: 15 } };

function Section({ label, c, children }: { label: string; c: Palette; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...MODAL.label, color: c.faint }}>{label}</Text>
      {children}
    </View>
  );
}

/** The whole card in Paseo's modal: a centred dialog on wide layouts, a sheet on compact ones. */
function CardModal({ card, scene, open, onOpenChange }: { card: DeskCard; scene: CardScene; open: boolean; onOpenChange(open: boolean): void }) {
  const { desk, c } = scene;
  const state = stateOf(card);
  const { doing, face, nowLine, lead, rest, shown } = shownOf(card);
  const { links, memos } = refsOf(card, desk, shown, rest);
  const workspace = card.asker?.name;
  // Following a link to a Paseo tab leaves the screen, so the modal closes first.
  const inner: CardScene = { ...scene, openAgent: scene.openAgent ? (id) => (onOpenChange(false), scene.openAgent!(id)) : undefined };
  const people: { person: DeskPerson; role: string }[] = [
    ...(card.asker ? [{ person: card.asker, role: doing ? "Owner" : "Asker" }] : []),
    ...card.sessions.map((person) => ({ person, role: "Session" })),
    ...card.watchers.map((person) => ({ person, role: "Watcher" })),
  ];
  const writable = card.kind === "inbox" && !card.settled;
  const [reply, setReply] = useState(card.answers[0]?.reply ?? "");
  const [answerId, setAnswerId] = useState(card.answers[0]?.label);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const act = async (input: Parameters<typeof writeMemo>[0]) => {
    setBusy(true);
    setActionMessage("");
    try {
      const result = await writeMemo(input);
      if (!result.ok) throw new Error(result.error || "Write failed");
      await refresh();
      if (result.sendError) setActionMessage(`Recorded, but sending failed: ${result.sendError}`);
      else setActionMessage(result.watcherErrors?.length ? `Sent; watcher notice failed: ${result.watcherErrors.join("; ")}` : "Saved");
      if (input.action === "answer" || input.action === "settle") setAnswerOpen(false);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={[STATE_WORDS[state], workspace].filter(Boolean).join(" · ")}
      icon={<View style={{ width: 3, height: 14, backgroundColor: c.state(state) }} />}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Modal.Content contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Inline text={face} desk={desk} c={c} style={{ ...MODAL.title, color: card.settled ? c.muted : c.fg }} />
        <Answer card={card} desk={desk} c={c} size={MODAL.body} />
        {nowLine ? <Inline text={nowLine} desk={desk} c={c} style={{ ...MODAL.body, color: c.body }} /> : null}
        {lead ? <Inline text={lead} desk={desk} c={c} style={{ ...MODAL.body, color: c.body }} /> : null}
        {rest ? <Markdown>{rest}</Markdown> : null}
        <Blocks card={card} desk={desk} c={c} size={MODAL.body} />
        {card.kind === "inbox" && card.status === "unreadable" ? <Text style={{ ...MODAL.body, color: c.danger }}>The front matter can't be read.</Text> : null}
        {writable ? (
          <Section label="Actions" c={c}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Pressable disabled={busy} onPress={() => void act({ action: "star", name: card.name })} accessibilityRole="button" style={{ borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ ...MODAL.body, color: c.fg }}>{card.starred ? "★ Unstar" : "☆ Star"}</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => void act({ action: "settle", name: card.name, outcome: "taken up" })} accessibilityRole="button" style={{ borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ ...MODAL.body, color: c.fg }}>Settle</Text>
              </Pressable>
              {card.asker?.agentId && scene.openAgent ? <Pressable disabled={busy} onPress={() => inner.openAgent?.(card.asker!.agentId!)} accessibilityRole="button" style={{ borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ ...MODAL.body, color: c.fg }}>Open tab</Text></Pressable> : null}
            </View>
            {card.answers.length ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {card.answers.map((answer) => <Pressable key={answer.label} onPress={() => { setAnswerId(answer.label); setReply(answer.reply); setAnswerOpen(true); }} accessibilityRole="button" style={{ borderWidth: 1, borderColor: c.ok, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ ...MODAL.body, color: c.ok }}>{answer.label}</Text></Pressable>)}
                </View>
                {answerOpen ? <View style={{ gap: 8 }}><TextInput value={reply} onChangeText={setReply} multiline placeholder="Reply to the asking agent" placeholderTextColor={c.faint} style={{ minHeight: 90, borderWidth: 1, borderColor: c.border, color: c.fg, padding: 8, textAlignVertical: "top" }} /><Pressable disabled={busy || !reply.trim()} onPress={() => void act({ action: "answer", name: card.name, reply, answerId })} accessibilityRole="button" style={{ alignSelf: "flex-start", backgroundColor: c.ok, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ ...MODAL.body, color: c.s0 }}>{busy ? "Sending…" : "Send"}</Text></Pressable></View> : null}
              </View>
            ) : null}
            {actionMessage ? <Text style={{ ...MODAL.label, color: c.muted }}>{actionMessage}</Text> : null}
          </Section>
        ) : null}

        {card.prs.length ? (
          <Section label="Pull requests" c={c}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {card.prs.map((n) => (
                <PrChip key={n} n={n} scene={inner} />
              ))}
            </View>
          </Section>
        ) : null}
        {people.length ? (
          <Section label="People" c={c}>
            {people.map(({ person, role }, i) => (
              <Person key={i} person={person} role={role} scene={inner} wide reply={role === "Asker" ? replyOf(card) : undefined} />
            ))}
          </Section>
        ) : null}
        {memos.length || links.length ? (
          <Section label="Links" c={c}>
            {memos.map((url) => {
              const name = url.replace(/^.*\//, "").replace(/\.md$/, "");
              const memo = scene.inboxByName.get(name);
              const label = name.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
              return (
                <Text key={url} onPress={() => void openExternalUrl(url)} accessibilityRole="link" style={{ ...TYPE.small, color: memo?.settled ? c.meta : c.metaStrong }}>
                  {memo?.settled ? "Settled memo: " : "Memo: "}
                  {label}
                </Text>
              );
            })}
            {links.map((t, i) => (
              <Text key={i} onPress={follow(t, inner)} accessibilityRole="link" style={{ ...TYPE.small, color: c.meta, textDecorationLine: t.url || t.agentId ? "underline" : "none" }}>
                {t.label}
              </Text>
            ))}
          </Section>
        ) : null}
        <Section label="Source" c={c}>
          <Text selectable style={{ ...TYPE.small, fontFamily: MONO, color: c.meta }}>
            {card.url}
          </Text>
          <Text onPress={() => void openExternalUrl(card.url)} accessibilityRole="link" style={{ ...TYPE.small, color: c.ok }}>
            Open the card
          </Text>
        </Section>
      </Modal.Content>
    </Modal>
  );
}

export function Card({ card, scene }: { card: DeskCard; scene: CardScene }) {
  const { desk, c, now, compact } = scene;
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const state = stateOf(card);
  const { doing, face, nowLine, lead, rest, shown } = shownOf(card);
  // References the visible text doesn't already carry.
  const inText = prsIn(shown);
  const chips = card.prs.filter((n) => !inText.has(n));
  const { links } = refsOf(card, desk, shown, rest);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={`${STATE_WORDS[state]}: ${plain(face)}`}
        accessibilityHint="Opens the whole card"
        style={{
          backgroundColor: c.s1,
          borderWidth: 1,
          borderColor: hovered && !compact ? c.alpha(c.fg, 0.16) : c.border,
          paddingHorizontal: 11,
          paddingVertical: 9,
          gap: 5,
        }}
      >
        <View style={{ position: "absolute", left: -1, top: 11, width: 3, height: 14, backgroundColor: c.state(state) }} />
        <Inline text={face} desk={desk} c={c} style={{ ...TYPE.title, color: card.settled ? c.muted : c.fg }} />
        {card.starred || card.hashtags.length ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {card.starred ? <Icon name="Star" size={12} color={c.warn} /> : null}
            {card.hashtags.map((tag) => (
              <Text key={tag} style={{ ...TYPE.small, color: c.meta }}>
                #{tag.replace(/^#/, "")}
              </Text>
            ))}
          </View>
        ) : null}
        <Answer card={card} desk={desk} c={c} size={TYPE.body} />
        {nowLine ? <Inline text={nowLine} desk={desk} c={c} style={{ ...TYPE.body, color: c.body }} lines={3} /> : null}
        {lead ? <Inline text={lead} desk={desk} c={c} style={{ ...TYPE.body, color: c.body }} lines={3} /> : null}
        <Blocks card={card} desk={desk} c={c} size={TYPE.small} />
        {card.kind === "inbox" && card.status === "unreadable" ? <Text style={{ ...TYPE.small, color: c.danger }}>The front matter can't be read.</Text> : null}

        <View style={{ gap: 5, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6, marginTop: 1 }}>
          {chips.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 3 }}>
              {chips.map((n) => (
                <PrChip key={n} n={n} scene={scene} />
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 16 }}>
            {card.asker ? <Person person={card.asker} scene={scene} reply={replyOf(card)} /> : null}
            {links[0] ? <RefLink target={links[0]} scene={scene} /> : null}
            <View style={{ flex: 1 }} />
          </View>
        </View>
      </Pressable>
      {open ? <CardModal card={card} scene={scene} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
