import { useCallback, useSyncExternalStore } from "react";

/** What an effort view shows on top of its overview. */
export type Page =
  | { kind: "ticket"; rel: string }
  | { kind: "doc"; rel: string; section?: string }
  | { kind: "folder"; rel: string }
  | { kind: "switch" }
  | { kind: "git" };

export interface ViewState {
  page: Page | null;
  /** Fold name → open. Missing = the fold's default. */
  folds: Record<string, boolean>;
  /** Phone sheet: the ticket row opened in place. */
  expanded: string | null;
}

const EMPTY: ViewState = { page: null, folds: {}, expanded: null };

/**
 * View state lives outside the components, keyed by workspace + effort path (or effort path alone
 * on the global screen): native apps keep one workspace mounted, so component state would reset
 * on every switch.
 */
const states = new Map<string, ViewState>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useViewState(key: string): [ViewState, (patch: Partial<ViewState>) => void] {
  const state = useSyncExternalStore(subscribe, () => states.get(key) ?? EMPTY);
  const update = useCallback(
    (patch: Partial<ViewState>) => {
      states.set(key, { ...(states.get(key) ?? EMPTY), ...patch });
      listeners.forEach((listener) => listener());
    },
    [key],
  );
  return [state, update];
}

/** Sets a view's state from outside it (after binding from a search result). */
export function setViewState(key: string, patch: Partial<ViewState>): void {
  states.set(key, { ...(states.get(key) ?? EMPTY), ...patch });
  listeners.forEach((listener) => listener());
}

/** View-state key of an effort shown for a workspace (or on the global screen). */
export function viewKey(workspaceId: string | null, effort: { root: string; slug: string }): string {
  return `${workspaceId ?? "global"}:${effort.root}/${effort.slug}`;
}
