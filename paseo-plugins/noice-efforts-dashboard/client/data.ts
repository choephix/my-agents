import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppState, type LayoutChangeEvent } from "react-native";
import { detailRpc, detailWatch, readRpc, searchRpc, type EffortDetail } from "../shared/rpc";
import { client, fetchOverview, latestOverview, onOverview } from "./runtime";

/** A hover this long reads ahead what the click will open; passing over rows reads nothing. */
const PREFETCH_DELAY_MS = 120;

function subscribeAppState(listener: () => void) {
  const subscription = AppState.addEventListener("change", listener);
  return () => subscription.remove();
}

/**
 * Whether a surface is on screen: laid out with a size (hidden workspace decks measure 0) and the
 * app in the foreground. Spread `onLayout` on the surface's root.
 */
export function useVisible(): { visible: boolean; width: number; onLayout(event: LayoutChangeEvent): void } {
  const [width, setWidth] = useState(-1);
  const active = useSyncExternalStore(subscribeAppState, () => AppState.currentState !== "background");
  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);
  return { visible: active && width !== 0, width, onLayout };
}

/**
 * Live overview fed by the daemon's `overviewWatch` push subscription (zero periodic polling).
 * Falls back to a single `fetchOverview` only if mounted before the first push arrives.
 */
export function useOverview(_visible?: boolean) {
  const queryClient = useQueryClient();
  // Sync with the newest pushed overview on mount and on every subsequent push or bind.
  useEffect(() => {
    const current = latestOverview();
    if (current) queryClient.setQueryData(["efforts", "overview"], current);
    return onOverview((overview) => queryClient.setQueryData(["efforts", "overview"], overview));
  }, [queryClient]);
  return useQuery({
    queryKey: ["efforts", "overview"],
    queryFn: fetchOverview,
    initialData: () => latestOverview() ?? undefined,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
}

type EffortRef = { root: string; slug: string };

/**
 * The last detail read per effort, kept outside React. Paseo sizes a header popover once, on its
 * first frame; a popover whose detail arrives later is cut off at the bottom. `warmDetail` reads it
 * ahead when the header button appears (and re-warms when the effort's `touchedMs` advances), and
 * `useDetail` starts from it. `detail` is absent while the first read is in flight.
 */
const warmDetails = new Map<string, { detail?: EffortDetail; touchedMs?: number; at: number }>();
const warmKey = (effort: EffortRef) => `${effort.root}\0${effort.slug}`;

export function warmDetail(effort: EffortRef, touchedMs?: number): void {
  const key = warmKey(effort);
  const held = warmDetails.get(key);
  if (held && held.at > 0 && (touchedMs === undefined || held.touchedMs === touchedMs)) return;
  warmDetails.set(key, { detail: held?.detail, touchedMs, at: Date.now() });
  client()
    .rpc(detailRpc, { root: effort.root, slug: effort.slug, since: held?.detail?.etag })
    .then((result) => {
      if (!("unchanged" in result)) {
        warmDetails.set(key, { detail: result, touchedMs: result.summary.touchedMs, at: Date.now() });
      } else if (held) {
        warmDetails.set(key, { detail: held.detail, touchedMs: touchedMs ?? held.touchedMs, at: Date.now() });
      }
    })
    .catch(() => warmDetails.set(key, { detail: held?.detail, touchedMs: held?.touchedMs, at: 0 }));
}

/**
 * On-demand detail read (used for hover prefetch and initial mount when not yet warm). Live
 * updates while visible arrive via `detailWatch` push instead of polling.
 */
function detailOptions(queryClient: QueryClient, effort: EffortRef) {
  const queryKey = ["efforts", "detail", effort.root, effort.slug];
  return {
    queryKey,
    queryFn: async (): Promise<EffortDetail> => {
      const previous = queryClient.getQueryData<EffortDetail>(queryKey);
      const result = await client().rpc(detailRpc, { root: effort.root, slug: effort.slug, since: previous?.etag });
      if (!("unchanged" in result)) {
        warmDetails.set(warmKey(effort), { detail: result, touchedMs: result.summary.touchedMs, at: Date.now() });
        return result;
      }
      if (previous) return previous;
      const fresh = await client().rpc(detailRpc, { root: effort.root, slug: effort.slug });
      if ("unchanged" in fresh) throw new Error("Efforts server answered “unchanged” to a first read");
      warmDetails.set(warmKey(effort), { detail: fresh, touchedMs: fresh.summary.touchedMs, at: Date.now() });
      return fresh;
    },
    staleTime: 2_000,
    retry: false,
  };
}

/** One file of an effort, as the doc and ticket pages read it. */
function docOptions(effort: EffortRef, rel: string) {
  return {
    queryKey: ["efforts", "doc", effort.root, effort.slug, rel],
    queryFn: () => client().rpc(readRpc, { root: effort.root, slug: effort.slug, rel }),
    staleTime: 2_000,
    retry: false,
  };
}

export function useDetail(effort: EffortRef | null, visible: boolean) {
  const queryClient = useQueryClient();
  const root = effort?.root;
  const slug = effort?.slug;
  const options = effort
    ? detailOptions(queryClient, effort)
    : { queryKey: ["efforts", "detail", undefined, undefined], queryFn: () => Promise.reject(new Error("No effort")) };
  const warm = effort ? warmDetails.get(warmKey(effort)) : undefined;

  // Push live updates only while this effort surface is visible; unchanged etags skip re-renders,
  // and changed etags also refresh any open ticket/doc page for this effort.
  useEffect(() => {
    if (!root || !slug || !visible) return;
    const queryKey = ["efforts", "detail", root, slug];
    const key = warmKey({ root, slug });
    let active = true;
    const unsub = client().subscribe(
      detailWatch,
      { root, slug },
      (detail) => {
        if (!active) return;
        warmDetails.set(key, { detail, touchedMs: detail.summary.touchedMs, at: Date.now() });
        const previous = queryClient.getQueryData<EffortDetail>(queryKey);
        if (previous?.etag === detail.etag) return;
        queryClient.setQueryData(queryKey, detail);
        if (previous) void queryClient.invalidateQueries({ queryKey: ["efforts", "doc", root, slug] });
      },
      {
        onClosed: ({ error }) => {
          if (error && active) console.warn("[efforts] detail subscription closed", error);
        },
      },
    );
    return () => {
      active = false;
      unsub();
    };
  }, [queryClient, root, slug, visible]);

  return useQuery({
    ...options,
    initialData: warm?.detail,
    initialDataUpdatedAt: warm?.at,
    enabled: !!effort,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    retry: false,
  });
}

/**
 * Reads a ticket or doc file on demand; refreshed automatically whenever `detailWatch` pushes a
 * changed effort snapshot while the parent `EffortView` is visible (no periodic polling).
 */
export function useDoc(effort: EffortRef, rel: string, _visible?: boolean) {
  return useQuery({
    ...docOptions(effort, rel),
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
}

let hoverTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Hover handlers that read ahead what a click opens: the effort's detail, or one of its files.
 * Fresh data (under 2 s old) isn't read again.
 */
export function usePrefetch() {
  const queryClient = useQueryClient();
  const later = useCallback((run: () => void) => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(run, PREFETCH_DELAY_MS);
  }, []);
  const cancel = useCallback(() => clearTimeout(hoverTimer), []);
  const detail = useCallback(
    (effort: EffortRef) => later(() => void queryClient.prefetchQuery(detailOptions(queryClient, effort))),
    [later, queryClient],
  );
  const doc = useCallback((effort: EffortRef, rel: string) => later(() => void queryClient.prefetchQuery(docOptions(effort, rel))), [later, queryClient]);
  return { detail, doc, cancel };
}

/**
 * Server search, 150 ms after the last keystroke. `settling` is true while the typed query hasn't
 * been sent yet, so callers show "Searching…" instead of an empty result.
 */
export function useSearch(query: string, scope: { root?: string; current?: string }) {
  const search = useRpc(searchRpc);
  const [settled, setSettled] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query.trim()), 150);
    return () => clearTimeout(timer);
  }, [query]);
  const result = useQuery({
    queryKey: ["efforts", "search", settled, scope.root, scope.current],
    queryFn: () => search({ query: settled, ...scope }),
    enabled: settled.length > 0,
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });
  return { ...result, settling: settled !== query.trim() };
}
