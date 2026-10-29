import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { ToastApi } from "@getpaseo/plugin/client/react-native";
import { bindRpc, overviewRpc, type Overview } from "../shared/rpc";

/** The client context of this installation, set by `contribute`; popovers get no props for it. */
let current: PluginClientContext | null = null;

export function setClient(client: PluginClientContext | null): void {
  current = client;
}

export function client(): PluginClientContext {
  if (!current) throw new Error("Efforts plugin is not running");
  return current;
}

export const PANEL_ID = "efforts";
export const SCREEN_ID = "all";

/** Newest overview, shared by every surface and the header/composer registrations. */
let latest: Overview | null = null;
let latestAt = 0;
const listeners = new Set<(overview: Overview) => void>();
/** Bumped by every bind; a poll that started before the newest bind doesn't publish. */
let generation = 0;
let bindsInFlight = 0;

export function latestOverview(): Overview | null {
  return latest;
}

/** When the newest overview arrived (ms), 0 before the first. */
export function latestOverviewAt(): number {
  return latestAt;
}

export function onOverview(listener: (overview: Overview) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(overview: Overview): void {
  latest = overview;
  listeners.forEach((listener) => listener(overview));
}

/**
 * The overview, sent only when it changed since the one held (`since`). An unchanged answer, or one
 * that a bind overtook while it travelled, returns what is held and notifies nobody.
 */
export async function fetchOverview(): Promise<Overview> {
  const asked = generation;
  const result = await client().rpc(overviewRpc, { since: latest?.etag });
  if (latest && (generation !== asked || bindsInFlight > 0)) return latest;
  latestAt = Date.now();
  if (!("unchanged" in result)) {
    publish(result);
    return result;
  }
  if (latest) return latest;
  // Only possible if the held overview vanished mid-flight; ask for the whole thing.
  const fresh = await client().rpc(overviewRpc, {});
  if ("unchanged" in fresh) throw new Error("Efforts server answered “unchanged” to a first read");
  publish(fresh);
  return fresh;
}

type Target = { kind: "effort"; root: string; slug: string } | { kind: "none" } | { kind: "clear" };

/**
 * Writes the binding, then refreshes everything that shows it. The change shows at once (RPCs
 * through the relay can take a second); when the write fails, the old binding comes back and the
 * error is thrown.
 */
export async function bind(workspaceId: string, target: Target): Promise<void> {
  generation++;
  bindsInFlight++;
  const before = latest;
  let optimistic: Overview | null = null;
  if (latest) {
    const at = new Date().toISOString();
    const binding = target.kind === "effort" ? { kind: "effort" as const, root: target.root, slug: target.slug, at } : target.kind === "none" ? { kind: "none" as const, at } : null;
    optimistic = {
      ...latest,
      workspaces: latest.workspaces.map((workspace) => (workspace.id === workspaceId ? { ...workspace, binding } : workspace)),
    };
    publish(optimistic);
  }
  try {
    await client().rpc(bindRpc, { workspaceId, target });
  } catch (error) {
    // Put back what the server still has, unless a newer bind already replaced it.
    if (before && latest === optimistic) publish(before);
    throw error;
  } finally {
    bindsInFlight--;
  }
  await fetchOverview();
}

/**
 * `bind` for buttons: returns at once, since the change already shows; a failure says so in a
 * toast after putting the old binding back.
 */
export function bindOrToast(toast: ToastApi, workspaceId: string, target: Target): void {
  bind(workspaceId, target).catch((error: unknown) => {
    const what = target.kind === "effort" ? `bind ${target.slug}` : target.kind === "none" ? "set No effort" : "unbind";
    toast.error(`Couldn't ${what}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export function openPanel(workspaceId: string): void {
  try {
    client().openPanel(PANEL_ID, { workspaceId, location: "explorer" });
  } catch (error) {
    // The workspace isn't in this client's state yet (or the layout has no explorer).
    console.warn("[efforts] openPanel failed", error);
  }
}

export function openAllEfforts(fromWorkspaceId?: string, effortKey?: string): void {
  const params: Record<string, string> = {};
  if (fromWorkspaceId) params.from = fromWorkspaceId;
  if (effortKey) params.effort = effortKey;
  client().openScreen({ screenId: SCREEN_ID, params });
}

const settingsCache = new Map<string, { at: number; result: Promise<ChatSettings> }>();
/**
 * Read ahead on hover, so the click doesn't wait for the agent list (360 KB over the relay). Kept
 * only for the hover-to-click moment, so a model changed just before still counts.
 */
const SETTINGS_FRESH_MS = 5_000;

interface ChatSettings {
  provider: string;
  modeId?: string;
  thinkingOptionId?: string;
}

/**
 * Settings of the workspace's most recent chat (provider/model, mode, thinking), else of any chat.
 * A read under 5 s old (the hover's) is reused; a failed one isn't.
 */
export function chatSettings(workspaceId: string): Promise<ChatSettings> {
  const cached = settingsCache.get(workspaceId);
  if (cached && Date.now() - cached.at < SETTINGS_FRESH_MS) return cached.result;
  const result = readChatSettings(workspaceId);
  settingsCache.set(workspaceId, { at: Date.now(), result });
  result.catch(() => settingsCache.get(workspaceId)?.result === result && settingsCache.delete(workspaceId));
  return result;
}

async function readChatSettings(workspaceId: string): Promise<ChatSettings> {
  const { entries } = await client().paseo.agents.list({
    filter: { includeArchived: true },
    sort: [{ key: "updated_at", direction: "desc" }],
    page: { limit: 200 },
  });
  const chats = entries.map((entry) => entry.agent).filter((agent) => !agent.internal);
  const agent = chats.find((candidate) => candidate.workspaceId === workspaceId) ?? chats[0];
  if (!agent) throw new Error("No chat to copy provider settings from");
  return {
    provider: agent.model && !agent.provider.includes("/") ? `${agent.provider}/${agent.model}` : agent.provider,
    ...(agent.currentModeId ? { modeId: agent.currentModeId } : {}),
    ...(agent.thinkingOptionId ? { thinkingOptionId: agent.thinkingOptionId } : {}),
  };
}

/** Button label for a ticket's chat: named after its type. */
export function chatVerb(type: string | null): string {
  switch (type) {
    case "grilling":
      return "Grill in new chat";
    case "prototype":
      return "Prototype in new chat";
    case "research":
      return "Research in new chat";
    default:
      return "Work in new chat";
  }
}

/**
 * Starts a chat in this workspace on one ticket, with the workspace's latest chat settings, and
 * opens it. The agent edits the files; the plugin doesn't.
 */
export async function startTicketChat(input: {
  workspaceId: string;
  effortDir: string;
  slug: string;
  ticket: { num: string; title: string; rel: string; type: string | null };
}): Promise<string> {
  const { workspaceId, effortDir, slug, ticket } = input;
  const file = `${effortDir}/${ticket.rel}`;
  const map = `${effortDir}/map.md`;
  const prompt =
    ticket.type === "grilling"
      ? `Grill ticket ${file} with the grilling skill. Read the effort's map first: ${map}`
      : `Work on ticket ${file} (${ticket.type ?? "task"}). Read the effort's map first: ${map}`;
  const config = await chatSettings(workspaceId);
  const agent = await client().paseo.workspaces.ref(workspaceId).agents.create({
    config,
    prompt,
    title: `${slug} ${ticket.num} ${ticket.title}`,
    labels: { effort: slug },
  });
  return agent.id;
}

/** Starts a chat that charts a new effort, and binds the workspace to it right away. */
export async function startNewEffort(input: { workspaceId: string; root: string; slug: string; goal: string }): Promise<string> {
  const { workspaceId, root, slug, goal } = input;
  const config = await chatSettings(workspaceId);
  const agent = await client().paseo.workspaces.ref(workspaceId).agents.create({
    config,
    prompt: `Start a new effort in ${root}/${slug}/: chart its map.md with the wayfinder skill.${goal ? ` Goal: ${goal}` : ""}`,
    title: `New effort ${slug}`,
    labels: { effort: slug },
  });
  await bind(workspaceId, { kind: "effort", root, slug });
  return agent.id;
}
