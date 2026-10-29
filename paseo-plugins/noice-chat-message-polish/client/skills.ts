import type { PluginClientContext } from "@getpaseo/plugin/client";
import { skillBody, skillMessages, type FileMentionRecord, type SkillMessages, type SkillRecord } from "../shared/skills";
import { parseSkillInvocation, sameText } from "./skill-parse";

// Which of the bubbles on screen really loaded a skill (or got files attached) comes from OMP's
// session files, fetched per chat or workspace in view. Until that answer arrives a bubble whose
// text invokes a skill by OMP's rules is drawn as loaded: a mistyped name is rare, so that almost
// never has to flip. A bubble OMP has no record of is judged only after a grace period, since a
// just-sent message reaches the session file a moment after its bubble appears.

export type SkillView =
  | { status: "loaded"; name: string; args: string; record: SkillRecord }
  | { status: "pending"; name: string; args: string }
  | { status: "unknown"; name: string };

export interface SkillStore {
  view(raw: string): SkillView | null;
  files(raw: string, skill: SkillView | null): FileMentionRecord | null;
  body(agentId: string, id: string, file?: number): Promise<string | null>;
  /** Called after new answers arrive, so drawn bubbles can be re-judged. */
  onChange(listener: () => void): void;
  dispose(): void;
}

const GRACE_MS = 2500;
const REFETCH_GAP_MS = 1000;

interface ScopeState { result: SkillMessages | null; fetchedAt: number; inflight: boolean; timer: ReturnType<typeof setTimeout> | null }

/** The chat or workspace this page shows, from Paseo's route (`/h/<server>/agent/<id>`, `/h/<server>/workspace/<id>`). */
function scopeOf(path: string): { key: string; input: { agentId?: string; workspaceId?: string } } | null {
  const match = /^\/h\/[^/]+\/(agent|workspace)\/([^/?#]+)/.exec(path);
  if (!match) return null;
  const id = decodeURIComponent(match[2]!);
  return match[1] === "agent" ? { key: `a:${id}`, input: { agentId: id } } : { key: `w:${id}`, input: { workspaceId: id } };
}

const rebuilt = (record: SkillRecord) => (record.args ? `/skill:${record.name} ${record.args}` : `/skill:${record.name}`);

export function createSkillStore(client: Pick<PluginClientContext, "rpc">): SkillStore {
  const scopes = new Map<string, ScopeState>();
  const firstSeen = new Map<string, number>();
  const bodies = new Map<string, Promise<string | null>>();
  const listeners = new Set<() => void>();
  let disposed = false;

  const fetchScope = (key: string, input: { agentId?: string; workspaceId?: string }, state: ScopeState) => {
    if (state.inflight || disposed) return;
    state.inflight = true;
    const startedAt = Date.now();
    client.rpc(skillMessages, input).then((result) => {
      state.result = result;
      state.fetchedAt = startedAt;
    }, () => {
      // Server unreachable: keep drawing from the text alone.
    }).finally(() => {
      state.inflight = false;
      if (!disposed) for (const listener of listeners) listener();
    });
  };

  /** One refetch per scope at a time, no sooner than REFETCH_GAP_MS after the last one started. */
  const refetchAt = (key: string, input: { agentId?: string; workspaceId?: string }, state: ScopeState, at: number) => {
    if (state.timer || disposed) return;
    const wait = Math.max(at - Date.now(), state.fetchedAt + REFETCH_GAP_MS - Date.now(), 0);
    state.timer = setTimeout(() => { state.timer = null; fetchScope(key, input, state); }, wait);
  };

  const current = () => {
    const scope = typeof location === "undefined" ? null : scopeOf(location.pathname);
    if (!scope) return null;
    let state = scopes.get(scope.key);
    if (!state) {
      state = { result: null, fetchedAt: 0, inflight: false, timer: null };
      scopes.set(scope.key, state);
      fetchScope(scope.key, scope.input, state);
    }
    return { ...scope, state };
  };

  return {
    view(raw) {
      const invocation = parseSkillInvocation(raw);
      if (!invocation) return null;
      const scope = current();
      const pending: SkillView = { status: "pending", name: invocation.name, args: invocation.args };
      if (!scope?.state.result) return pending;
      const record = scope.state.result.skills.find((skill) => sameText(skill.prompt, raw) || sameText(rebuilt(skill), raw));
      if (record) return { status: "loaded", name: record.name, args: record.args, record };
      // No OMP chat here (another provider): `/skill:` means nothing to it.
      if (!scope.state.result.searched) return null;
      const seen = firstSeen.get(raw) ?? Date.now();
      firstSeen.set(raw, seen);
      if (scope.state.fetchedAt < seen + GRACE_MS) {
        refetchAt(scope.key, scope.input, scope.state, seen + GRACE_MS);
        return pending;
      }
      return { status: "unknown", name: invocation.name };
    },
    files(raw, skill) {
      const result = current()?.state.result;
      if (!result) return null;
      const prompt = skill?.status === "loaded" ? skill.record.prompt : null;
      return result.files.find((mention) => sameText(mention.after, raw) || (prompt !== null && mention.after === prompt)) ?? null;
    },
    body(agentId, id, file) {
      const key = `${agentId}\u0000${id}\u0000${file ?? ""}`;
      let body = bodies.get(key);
      if (!body) {
        body = client.rpc(skillBody, { agentId, id, ...(file === undefined ? {} : { file }) }).then((result) => result.text, () => null);
        bodies.set(key, body);
        // A failed read may succeed later.
        void body.then((text) => { if (text === null) bodies.delete(key); });
      }
      return body;
    },
    onChange(listener) { listeners.add(listener); },
    dispose() {
      disposed = true;
      listeners.clear();
      for (const state of scopes.values()) clearTimeout(state.timer ?? undefined);
    },
  };
}
