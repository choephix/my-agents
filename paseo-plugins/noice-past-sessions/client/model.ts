import type { PastSession } from "../shared/rpc";

export type ListItem =
  | { kind: "row"; key: string; entry: PastSession }
  | { kind: "empty"; key: "empty" }
  | { kind: "same-folder-header"; key: "same-folder-header"; count: number; open: boolean };

/** Case-insensitive match on every word of `query` against title and folder. */
export function matchesQuery(entry: PastSession, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${entry.title}\n${entry.cwd}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Starred entries first, each group keeping its newest-first order. */
function starredFirst(entries: PastSession[], starred: ReadonlySet<string>): PastSession[] {
  return [...entries.filter((entry) => starred.has(entry.key)), ...entries.filter((entry) => !starred.has(entry.key))];
}

/**
 * Flattens the main list and the optional "same folder" section into one virtualized list.
 * The main list always yields at least one item (an `empty` placeholder), so the section header
 * never floats alone. A search opens the section, since hiding matches would read as "no results".
 * Starred rows lead the main list and the section. Hidden rows are left out unless `showHidden`.
 */
export function buildListItems(
  data: { entries: PastSession[]; sameFolder: PastSession[] },
  view: {
    query: string;
    sameFolderOpen: boolean;
    starred: ReadonlySet<string>;
    hidden: ReadonlySet<string>;
    showHidden: boolean;
  },
): ListItem[] {
  const keep = (entry: PastSession) =>
    (view.showHidden || !view.hidden.has(entry.key)) && matchesQuery(entry, view.query);
  const main = starredFirst(data.entries.filter(keep), view.starred);
  const extra = starredFirst(data.sameFolder.filter(keep), view.starred);
  const items: ListItem[] =
    main.length > 0
      ? main.map((entry) => ({ kind: "row", key: entry.key, entry }))
      : [{ kind: "empty", key: "empty" }];
  if (extra.length === 0) return items;
  const open = view.sameFolderOpen || view.query.trim() !== "";
  items.push({ kind: "same-folder-header", key: "same-folder-header", count: extra.length, open });
  if (open) items.push(...extra.map((entry): ListItem => ({ kind: "row", key: entry.key, entry })));
  return items;
}

/** The muted word before a row's time: none for Paseo agents, else where the session ran. */
export function sourceWord(entry: PastSession): string | null {
  if (entry.source === "paseo") return null;
  if (entry.source === "omp") return "terminal";
  return entry.provider === "claude" ? "claude code" : entry.provider;
}

/** Two newest-first lists as one, newest first; ties keep `a` first. */
export function mergeByNewest(a: PastSession[], b: PastSession[]): PastSession[] {
  const merged: PastSession[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left && (!right || left.at >= right.at)) {
      merged.push(left);
      i += 1;
    } else if (right) {
      merged.push(right);
      j += 1;
    }
  }
  return merged;
}
