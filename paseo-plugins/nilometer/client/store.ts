import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { type Desk, deskRead, inboxWrite } from "../shared/desk";
// One copy of the desk for the screen and the sidebar row. Read when a surface mounts and when the app comes back
// to the foreground (AppState maps to page visibility on web); no timer.

export interface DeskState {
  desk: Desk | null;
  error: string | null;
  loading: boolean;
  /** When the last read finished (ms), 0 before the first. */
  at: number;
}

let client: PluginClientContext | null = null;
let state: DeskState = { desk: null, error: null, loading: false, at: 0 };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** A surface mounting this soon after a read reuses it. */
const FRESH_MS = 3_000;

export type MemoWrite = { action: "settle" | "star"; name: string; outcome?: string };
export type MemoWriteResult = { ok: boolean; name: string; starred?: boolean; error?: string };
export function writeMemo(input: MemoWrite): Promise<MemoWriteResult> {
  if (!client) return Promise.resolve({ ok: false, name: input.name, error: "Plugin is not connected." });
  return client.rpc(inboxWrite, input);
}
export function setClient(next: PluginClientContext | null): void {
  client = next;
  if (!next) state = { desk: null, error: null, loading: false, at: 0 };
}

/** Inserts a reply pointer into an agent's composer and focuses it; returns how it landed. */
export function insertIntoComposer(agentId: string, text: string): "inserted" | "present" | "unavailable" {
  const composer = client?.composers({ agentId })[0];
  if (!composer) return "unavailable";
  const current = composer.prompt;
  const needle = text.trim();
  if (needle && current.includes(needle)) {
    void composer.focus({ selection: { start: current.length, end: current.length } }).catch(() => {});
    return "present";
  }
  const next = current.trim() ? `${current.replace(/\s+$/, "")}\n\n${text}` : text;
  composer.setPrompt(next);
  void composer.focus({ selection: { start: next.length, end: next.length } }).catch(() => {});
  return "inserted";
}

function publish(next: DeskState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function refresh(): Promise<void> {
  if (inflight) return inflight;
  const owner = client;
  if (!owner) return Promise.resolve();
  publish({ ...state, loading: true });
  inflight = owner
    .rpc(deskRead, {})
    .then(
      (desk) => publish({ desk, error: null, loading: false, at: Date.now() }),
      (error: unknown) => publish({ ...state, error: error instanceof Error ? error.message : String(error), loading: false, at: Date.now() }),
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDesk(): DeskState {
  const current = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (Date.now() - state.at > FRESH_MS) void refresh();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && Date.now() - state.at > FRESH_MS) void refresh();
    });
    return () => subscription.remove();
  }, []);
  return current;
}
