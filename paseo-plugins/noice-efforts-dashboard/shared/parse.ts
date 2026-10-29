/**
 * Parsing of wayfinder files as they are really written (no frontmatter, free-text key lines,
 * often bold, often followed by dates or prose). Never throws.
 */

export type Bucket = "open" | "claimed" | "done" | "parked";

export interface HeadFields {
  title: string | null;
  /** Lowercased key → value with markdown emphasis around it removed. */
  fields: Map<string, string>;
}

const KEY_LINE = /^\s*(?:[-*]\s+)?\**([A-Za-z][A-Za-z -]{1,24}?)\**\s*:\s*\**\s*(.*?)\s*$/;

/** Title (`# `) and the `Key: value` lines before the first `## ` heading (at most 30 lines). */
export function headFields(text: string): HeadFields {
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) lines = lines.slice(end + 1);
  }
  let title: string | null = null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(0, 30)) {
    if (/^##\s/.test(line)) break;
    if (/^#\s/.test(line)) {
      title ??= plain(line.replace(/^#\s+/, "")).trim();
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    if (fields.has(key)) continue;
    const value = match[2].replace(/^\*+\s*/, "").replace(/\s*\*+$/, "").trim();
    if (value) fields.set(key, value);
  }
  return { title, fields };
}

const BUCKETS: Record<string, Bucket> = {
  open: "open",
  "needs-triage": "open",
  "needs-info": "open",
  "ready-for-agent": "open",
  "ready-for-human": "open",
  ready: "open",
  backlog: "open",
  draft: "open",
  planned: "open",
  todo: "open",
  new: "open",
  claimed: "claimed",
  "in progress": "claimed",
  "in-progress": "claimed",
  active: "claimed",
  resolved: "done",
  done: "done",
  closed: "done",
  complete: "done",
  completed: "done",
  implemented: "done",
  shipped: "done",
  merged: "done",
  answered: "done",
  decided: "done",
  parked: "parked",
  wontfix: "parked",
  queued: "parked",
  deferred: "parked",
  superseded: "done",
  dropped: "parked",
};

/** First word of a `Status:` value, normalised (`**resolved** 2026-08-29` → `resolved`). */
export function statusWord(raw: string | null | undefined): string {
  if (!raw) return "open";
  const text = plain(raw).trim().toLowerCase();
  if (/^in[\s-]progress\b/.test(text)) return "in progress";
  const word = /^[a-z][a-z-]*/.exec(text)?.[0] ?? "";
  return word.replace(/-+$/, "") || "open";
}

/** Unknown words count as open: the raw line stays visible in the ticket view. */
export function bucketOf(word: string): Bucket {
  return BUCKETS[word] ?? "open";
}

export function knownStatus(word: string): boolean {
  return word in BUCKETS;
}

/** What a ticket asks of the person driving the effort; drawn as the popover row's tail. */
export type TicketKind = "talk" | "agent" | "hands-on" | "yours";

/**
 * From the raw `Type:` value (`wayfinder:task (HITL)`, `grievance (Stefan, …)`): a conversation
 * (grilling, prototype, decision), the agent alone (research, AFK tasks, build slices), your hands
 * (HITL tasks), or something you raised yourself (grievance). Null when the type says none of these.
 */
export function ticketKind(rawType: string | null | undefined): TicketKind | null {
  if (!rawType) return null;
  const text = rawType.toLowerCase();
  if (/\bgrievance\b/.test(text)) return "yours";
  if (/\btask\b/.test(text) && /\bhitl\b/.test(text)) return "hands-on";
  if (/\b(grilling|prototype|decision)\b/.test(text)) return "talk";
  if (/\b(research|task|slice)\b/.test(text)) return "agent";
  return null;
}

export interface BlockedBy {
  /** Own ticket numbers, as written (`01`). */
  own: string[];
  /** `<effort> NN` references to another effort's ticket. */
  elsewhere: { effort: string; num: string }[];
  /** Text that names no ticket (`release already shipped`, `PR #123 merging`). */
  note: string | null;
}

/**
 * `Blocked by:` examples: `none`, `—`, `01`, `04, 06`, `[02](02-x.md)`,
 * `12 — Example feature behavior.`, `None — can start immediately`, `03 (08 resolved …)`,
 * `01 Who owns …; 06 Service costs …`, `02, acme-widgets 08`, and prose.
 */
export function parseBlockedBy(raw: string | null | undefined): BlockedBy {
  const empty: BlockedBy = { own: [], elsewhere: [], note: null };
  if (!raw) return empty;
  const text = raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`_]/g, "")
    .trim();
  if (!text || /^(none|nothing|n\/a|no\b|-+$|—|–)/i.test(text)) return empty;
  // Parenthesised asides name resolved or related tickets, not blockers.
  const flat = text.replace(/\([^)]*\)/g, " ");
  const own: string[] = [];
  const elsewhere: { effort: string; num: string }[] = [];
  for (const segment of flat.split(/[,;]|\band\b/)) {
    const part = segment.trim();
    const mine = /^#?(\d{1,3})\b/.exec(part);
    if (mine) {
      own.push(mine[1].padStart(2, "0"));
      continue;
    }
    const other = /^([a-z][a-z0-9-]*[a-z0-9])\s+#?(\d{1,3})\b/i.exec(part);
    if (other && /-/.test(other[1])) elsewhere.push({ effort: other[1].toLowerCase(), num: other[2].padStart(2, "0") });
  }
  if (!own.length && !elsewhere.length) return { own, elsewhere, note: text };
  return { own: [...new Set(own)], elsewhere, note: null };
}

export interface MdSection {
  heading: string;
  body: string;
  /** 0-based line of the heading in the file. */
  line: number;
}

export function sections(text: string): MdSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: MdSection[] = [];
  let current: { heading: string; line: number; body: string[] } | null = null;
  let fence = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const match = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      if (current) out.push({ heading: current.heading, line: current.line, body: current.body.join("\n") });
      current = { heading: plain(match[1]).trim(), line: index, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  });
  if (current) {
    const last = current as { heading: string; line: number; body: string[] };
    out.push({ heading: last.heading, line: last.line, body: last.body.join("\n") });
  }
  return out;
}

export interface Bullet {
  /** The item's own text, wrapped lines joined, nested items left out. */
  text: string;
  /** The item with its nested lines, as Markdown. */
  markdown: string;
  /** 0-based lines inside the body, nested lines included. */
  first: number;
  last: number;
}

/** Top-level list items of a section. */
export function topBullets(body: string): Bullet[] {
  const lines = body.split("\n");
  const out: Bullet[] = [];
  // The open item ends where the next top-level item or an unindented paragraph starts.
  let open = false;
  const close = (end: number) => {
    const item = out[out.length - 1];
    if (!item || !open) return;
    let last = end;
    while (last > item.first && !lines[last].trim()) last--;
    item.last = last;
    item.markdown = lines.slice(item.first, last + 1).join("\n");
    open = false;
  };
  let nested = false;
  lines.forEach((line, index) => {
    const item = /^(?:[-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (item) {
      close(index - 1);
      out.push({ text: item[1], markdown: "", first: index, last: index });
      open = true;
      nested = false;
    } else if (!open) {
      return;
    } else if (/^\s+(?:[-*+]|\d{1,3}[.)])\s/.test(line)) {
      nested = true;
    } else if (!nested && /^\s{2,}\S/.test(line)) {
      out[out.length - 1].text += ` ${line.trim()}`;
    } else if (line.trim() && !/^\s/.test(line)) {
      close(index - 1);
    }
  });
  close(lines.length - 1);
  return out;
}

/** Markdown inline markup removed: links keep their text, emphasis and code marks go. */
export function plain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** A bullet's lead: its bold opening, else its first clause. */
export function lead(bullet: string, max = 90): string {
  const bold = /^\s*\*\*(.+?)\*\*/.exec(bullet);
  let text = bold ? plain(bold[1]) : plain(bullet).split(/(?<=[a-z0-9)])[.:;]\s|\s[—–]\s/i)[0];
  text = text.replace(/[\s.:;,—–-]+$/, "").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** First clause of map.md's Status value: `delivery. Charted …` → `delivery`. */
export function mapStatusShort(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = plain(raw).split(/[.,;(]|\s[—–-]\s/)[0].trim();
  if (!text) return null;
  return text.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
}

/** The first paragraph of a body as one line of plain text. */
export function firstParagraph(body: string): string | null {
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) {
      if (lines.length) break;
      continue;
    }
    if (/^#/.test(line) || (!lines.length && KEY_LINE.test(line) && /^\s*\**[A-Z][A-Za-z -]{1,24}\**\s*:/.test(line))) continue;
    if (/^\s*(```|~~~|\|)/.test(line)) {
      if (lines.length) break;
      continue;
    }
    lines.push(line.replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, "").trim());
  }
  const text = plain(lines.join(" "));
  return text || null;
}

/** The question a ticket asks: first paragraph under `## Question`, else the first after the head. */
export function ticketQuestion(text: string): string | null {
  const all = sections(text);
  const question = all.find((section) => /^question/i.test(section.heading));
  if (question) return firstParagraph(question.body);
  const firstHeading = text.search(/^##\s/m);
  const head = firstHeading >= 0 ? text.slice(0, firstHeading) : text;
  return firstParagraph(head.replace(/^#\s.*$/m, ""));
}

/** Slugs of sibling efforts linked as `../<slug>/…` together with the text that links them. */
export function siblingLinks(markdown: string): { slug: string; context: string }[] {
  const out: { slug: string; context: string }[] = [];
  const blocks = markdown.split(/\n(?=\s*(?:[-*+]|\d{1,3}[.)])\s)|\n\s*\n/);
  for (const block of blocks) {
    for (const match of block.matchAll(/\]\(\.\.\/([A-Za-z0-9._-]+)\/[^)]*\)/g)) {
      out.push({ slug: match[1], context: block.replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, "") });
    }
  }
  return out;
}

/** Ticket number from a file name: `01-takeover-shape.md` → `01`. */
export function ticketNum(file: string): string | null {
  const match = /^(\d{1,3})[-_. ]/.exec(file);
  return match ? match[1].padStart(2, "0") : null;
}

/**
 * Short names for slugs in one `.scratch`: a two-segment prefix that at least four slugs share is
 * dropped (`acme-app-playtest-logs` → `playtest-logs`).
 */
export function shortNames(slugs: readonly string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const slug of slugs) {
    const prefix = /^([a-z0-9]+-[a-z0-9]+-)./.exec(slug)?.[1];
    if (prefix) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const slug of slugs) {
    const prefix = /^([a-z0-9]+-[a-z0-9]+-)./.exec(slug)?.[1];
    out.set(slug, prefix && (counts.get(prefix) ?? 0) >= 4 ? slug.slice(prefix.length) : slug);
  }
  return out;
}

const STOP = new Set(["the", "a", "an", "and", "of", "for", "to", "in", "on", "with", "new", "effort"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token && !STOP.has(token));
}

/**
 * Whether a workspace name points at an effort slug: every word of the name matches a word of
 * the slug (equal, or one a prefix of the other with 4+ letters), or is the initials of
 * consecutive slug words (`AA` → `acme-app`). Returns the number of slug words covered, 0 = no.
 */
export function nameMatch(name: string, slug: string): number {
  const words = tokens(name);
  const parts = slug.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || !parts.length) return 0;
  let covered = 0;
  for (const word of words) {
    const direct = parts.findIndex(
      (part) => part === word || (word.length >= 4 && part.length >= 4 && (part.startsWith(word) || word.startsWith(part))),
    );
    if (direct >= 0) {
      covered++;
      continue;
    }
    let initials = -1;
    for (let start = 0; start + word.length <= parts.length && word.length >= 2; start++) {
      if (parts.slice(start, start + word.length).every((part, index) => part[0] === word[index])) {
        initials = start;
        break;
      }
    }
    if (initials < 0) return 0;
    covered += word.length;
  }
  return covered;
}
