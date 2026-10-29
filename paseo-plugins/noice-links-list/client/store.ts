import type { Link, LinkKind, WorkspaceTab } from "../shared/links";

export interface Fetched<T> {
  /** null until the first answer arrives. */
  data: T | null;
  error: string | null;
}

/** A chat's links; `subagentLinks` (links only its sub-agents mentioned) once a popover asked for them. */
export interface ChatLinks {
  links: Link[];
  subagentLinks?: Link[];
}

/** A workspace's tabs; each has `subagentLinks` once the links page asked for them. */
export interface WorkspaceLinks {
  tabs: WorkspaceTab[];
}

const NOTHING_YET: Fetched<never> = { data: null, error: null };

/**
 * Each chat's or workspace's links as last fetched, by id; one request per id at a time, a refresh
 * asked for meanwhile runs after it. Sub-agent links are fetched only while something watches them
 * (an open popover or links page); `keep` carries the last ones over a fetch without them.
 */
export class LinksStore<T> {
  private readonly entries = new Map<string, Fetched<T>>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly again = new Set<string>();
  private readonly listeners = new Set<(id: string) => void>();
  /** Open popovers or pages per id. */
  private readonly watchers = new Map<string, number>();

  constructor(
    private readonly load: (id: string, subagents: boolean) => Promise<T>,
    private readonly keep: (prev: T, next: T) => T,
  ) {}

  get(id: string): Fetched<T> {
    return this.entries.get(id) ?? NOTHING_YET;
  }

  subscribe(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** While the returned function hasn't been called, refreshes of this id include sub-agents. */
  watchSubagents(id: string): () => void {
    this.watchers.set(id, (this.watchers.get(id) ?? 0) + 1);
    return () => {
      const left = (this.watchers.get(id) ?? 1) - 1;
      if (left) this.watchers.set(id, left);
      else this.watchers.delete(id);
    };
  }

  refresh(id: string): Promise<void> {
    const running = this.inFlight.get(id);
    if (running) {
      this.again.add(id);
      return running;
    }
    const run = (async () => {
      try {
        const next = await this.load(id, this.watchers.has(id));
        const prev = this.get(id).data;
        this.set(id, { data: prev ? this.keep(prev, next) : next, error: null });
      } catch (error) {
        this.set(id, { ...this.get(id), error: error instanceof Error ? error.message : String(error) });
      } finally {
        this.inFlight.delete(id);
        if (this.again.delete(id)) void this.refresh(id);
      }
    })();
    this.inFlight.set(id, run);
    return run;
  }

  forget(id: string): void {
    this.entries.delete(id);
  }

  private set(id: string, entry: Fetched<T>): void {
    this.entries.set(id, entry);
    for (const listener of this.listeners) listener(id);
  }
}

/** A chat fetch without sub-agents keeps the sub-agent links fetched last. */
export function keepChatSubagents(prev: ChatLinks, next: ChatLinks): ChatLinks {
  return next.subagentLinks || !prev.subagentLinks ? next : { ...next, subagentLinks: prev.subagentLinks };
}

/** A workspace fetch without sub-agents keeps each tab's sub-agent links fetched last. */
export function keepWorkspaceSubagents(prev: WorkspaceLinks, next: WorkspaceLinks): WorkspaceLinks {
  if (next.tabs.some((tab) => tab.subagentLinks)) return next;
  const before = new Map(prev.tabs.map((tab) => [tab.agentId, tab.subagentLinks]));
  return { tabs: next.tabs.map((tab) => ({ ...tab, subagentLinks: before.get(tab.agentId) })) };
}

/** Chip order in the popover. */
export const KIND_ORDER: readonly LinkKind[] = ["web", "image", "file"];

/** Each type present in `links`, in chip order, with its count. */
export function kindCounts(links: readonly Link[]): { kind: LinkKind; count: number }[] {
  return KIND_ORDER.map((kind) => ({ kind, count: links.filter((link) => link.kind === kind).length })).filter(
    (entry) => entry.count > 0,
  );
}

/**
 * The one type a chat's popover shows, like a tab: the user's pick in that chat while that type is
 * still present, else Web when the chat has web links, else its first type. Null without links.
 */
export function shownKind(links: readonly Link[], choice: LinkKind | undefined): LinkKind | null {
  const kinds = kindCounts(links).map((entry) => entry.kind);
  if (choice && kinds.includes(choice)) return choice;
  return kinds.includes("web") ? "web" : (kinds[0] ?? null);
}

/** The picked type per chat (agent id) and per links page (workspace id), for this app session only. */
export const typeChoices = new Map<string, LinkKind>();

/** Chats (agent ids) and links pages (workspace ids) that show sub-agent links, for this app session only. */
export const subagentChoices = new Set<string>();

/** The popover's rows before the type filter: the chat's links, plus its sub-agents' when shown, newest first. */
export function withSubagents(links: readonly Link[], subagentLinks: readonly Link[] | null, shown: boolean): readonly Link[] {
  if (!shown || !subagentLinks?.length) return links;
  return [...links, ...subagentLinks].sort((a, b) => b.lastAt - a.lastAt);
}

/** The muted mark after a row's path: `missing` for a path that is gone, the sub-agent for a sub-agent's link, or both. */
export function rowMark(link: Link): string {
  const via = link.via ? `↳ ${link.via}` : "";
  if (link.missing) return via ? `missing · ${via}` : "missing";
  return via;
}
