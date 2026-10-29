import type { Counts, Doc } from "../shared/rpc";
import type { Page } from "./state";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Touched age: `now` under 5 minutes, then `8m`, `20h`, `3d`, `5w`, `4mo`. */
export function age(ms: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - ms);
  if (elapsed < 5 * MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 14 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  if (elapsed < 60 * DAY) return `${Math.floor(elapsed / (7 * DAY))}w`;
  return `${Math.floor(elapsed / (30 * DAY))}mo`;
}

/** Whole days since `ms`. */
export function daysSince(ms: number, now = Date.now()): number {
  return Math.floor(Math.max(0, now - ms) / DAY);
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `13:47` today, `19 Oct 03:09` this year, else `19 Oct 2025`. Built by hand: Intl differs on Hermes. */
export function stamp(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const today = new Date(now);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === today.toDateString()) return time;
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === today.getFullYear() ? `${day} ${time}` : `${day} ${date.getFullYear()}`;
}

/** `19 Oct` (year added when not this year). */
export function shortDate(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/**
 * The Commits heading for `shown` rows out of `sent`; `more` when the server stopped at its cap:
 * `Commits · 12`, `Commits · 30 of 64`, `Commits · 30 of 100+`.
 */
export function commitsHeading(shown: number, sent: number, more: boolean): string {
  const total = `${sent}${more ? "+" : ""}`;
  return shown < sent || more ? `Commits · ${shown} of ${total}` : `Commits · ${shown}`;
}

/** `2026-10-19` → `19 Oct`. */
export function isoDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return shortDate(new Date(year, month - 1, day).getTime());
}

/**
 * Every non-zero open bucket, so done + these = total: `8 ready · 2 claimed · 1 blocked · 1 parked`.
 */
export function openWords(counts: Counts): { word: string; strong: boolean; faint: boolean }[] {
  return (
    [
      ["ready", counts.ready],
      ["claimed", counts.claimed],
      ["blocked", counts.blocked],
      ["parked", counts.parked],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([word, count]) => ({ word: `${count} ${word}`, strong: word === "ready", faint: word === "parked" }));
}

/** An absolute home path → its `~/…` form. */
export function tildify(target: string, home: string): string {
  if (!home) return target;
  return target === home ? "~" : target.startsWith(`${home}/`) ? `~${target.slice(home.length)}` : target;
}

/** Resolves a Markdown link inside an effort: `../research/x.md` from `issues/01.md` → `research/x.md`. */
export function resolveRel(fromRel: string, href: string): string | null {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return null;
  let clean: string;
  try {
    clean = decodeURI(href.split("#")[0]);
  } catch {
    // A malformed `%` escape: not a link the panel can follow.
    return null;
  }
  if (!clean) return null;
  const parts = fromRel.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else parts.push("..");
    } else parts.push(part);
  }
  return parts.join("/");
}

/**
 * Where a Markdown link inside the effort opens: a folder the effort lists opens its file list,
 * anything else the doc page. Null for links that leave the effort or the page.
 */
export function linkPage(docs: readonly Pick<Doc, "kind" | "rel">[], fromRel: string, href: string): Page | null {
  const rel = resolveRel(fromRel, href);
  if (!rel) return null;
  const folder = docs.find((doc) => (doc.kind === "folder" || doc.kind === "artifacts") && doc.rel === rel);
  return folder ? { kind: "folder", rel: folder.rel } : { kind: "doc", rel };
}

/** The ticket text below its title, without the head lines (`Status:`, `Type:`, `Blocked by:`) the meta line already says. */
export function ticketBody(text: string): string {
  const withoutTitle = text.replace(/^#\s.*\n?/m, "");
  const sectionAt = withoutTitle.search(/^##\s/m);
  const head = sectionAt === -1 ? withoutTitle : withoutTitle.slice(0, sectionAt);
  const rest = sectionAt === -1 ? "" : withoutTitle.slice(sectionAt);
  return (head.replace(/^\s*\**(Status|Type|Blocked by)\**\s*:.*\n?/gim, "") + rest).trim();
}
