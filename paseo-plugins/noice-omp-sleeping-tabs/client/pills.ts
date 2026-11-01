import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { pillsRpc, wakeRpc } from "../shared/rpc";
import { formatSleptAt, pillText } from "./format";
import { SleepIcon, WakeFailedIcon } from "./icons";
import { startPhoneMenu, tabTitle } from "./phone-menu";

/** Agent updates come in bursts (a sweep sleeps several chats at once); one state read per burst. */
const REFRESH_DELAY_MS = 400;

interface Pill {
  /** Absent on phone layouts, where the ⋯ menu offers the wake instead. */
  registration?: PluginButtonRegistration;
  workspaceId: string;
  sleptAt: string | null;
  /** Label and tooltip; recomputed on each refresh, so "14:20" becomes "Mon 14:20" the next day. */
  text: { label: string; title: string };
  /** Set while a wake runs or after one failed; a state refresh then leaves the label alone. */
  wake: "running" | "failed" | null;
  /** Why the last wake failed. */
  reason?: string;
}

/**
 * One composer pill per asleep chat ("💤 14:20 · Wake"). Paseo shows a pill only in its
 * own chat's composer, so it is visible exactly while that chat is focused and asleep. The agent
 * directory subscription says when a chat closes or starts again; only then is the daemon asked
 * which chats are asleep. Phone layouts get no pill: ⋯ (workspace menu) → Wake → the workspace's
 * asleep chats ("Pricing · asleep since 14:20") wakes the one picked. Returns the cleanup.
 */
export function startPills(client: PluginClientContext): () => void {
  const lifetime = new AbortController();
  const pills = new Map<string, Pill>();
  // Last status the directory reported per chat; "closed" means asleep.
  const status = new Map<string, string>();
  /** Tab titles, for the phone menu. */
  const agents = new Map<string, { title: string; createdAt: string }>();
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing = false;
  let refreshAgain = false;

  const menu = startPhoneMenu(client, { id: "wake", title: "Wake", icon: SleepIcon }, () => {
    for (const agentId of pills.keys()) show(agentId);
  });
  const syncMenu = () => menu.set([...pills].flatMap(([agentId, pill]) => {
    const agent = agents.get(agentId);
    if (!agent) return [];
    const state = pill.wake === "running" ? "waking…"
      : pill.wake === "failed" ? "couldn't wake, retry"
      : pill.sleptAt ? `asleep since ${formatSleptAt(pill.sleptAt)}` : "asleep";
    return [{ agentId, workspaceId: pill.workspaceId, title: `${agent.title} · ${state}`, createdAt: agent.createdAt, behavior: { kind: "action", onPress: () => wake(agentId) } }];
  }));
  /** Brings a chat's pill (or, on phones, the ⋯ menu) in line with its state. */
  const show = (agentId: string) => {
    const pill = pills.get(agentId);
    if (pill && menu.compact) {
      pill.registration?.remove();
      pill.registration = undefined;
    } else if (pill) {
      const look = pill.wake === "running"
        ? { label: "Waking…", icon: SleepIcon, title: pill.text.title }
        // "Couldn't wake · Retry" overflows the 160 px pill; the red icon and tooltip say it.
        : pill.wake === "failed"
          ? { label: "Failed · Retry", icon: WakeFailedIcon, title: `Couldn't wake: ${pill.reason}. Press to retry.` }
          : { ...pill.text, icon: SleepIcon };
      if (pill.registration) pill.registration.update(look);
      else pill.registration = client.addComposerPill({ id: "asleep", workspaceId: pill.workspaceId, agentId, button: { ...look, behavior: { kind: "action", onPress: () => wake(agentId) } } });
    }
    syncMenu();
  };

  const removePill = (agentId: string) => {
    pills.get(agentId)?.registration?.remove();
    pills.delete(agentId);
    syncMenu();
  };

  const wake = async (agentId: string) => {
    const pill = pills.get(agentId);
    if (!pill) return;
    pill.wake = "running";
    show(agentId);
    try {
      await client.rpc(wakeRpc, { agentId });
      removePill(agentId);
    } catch (error) {
      // Plugin RPC errors read "Request failed: <message> requestType=… code=…"; keep the message.
      const reason = (error instanceof Error ? error.message : String(error))
        .replace(/^Request failed: /, "")
        .replace(/\s+requestType=\S+ code=\S+$/, "")
        .replace(/\.$/, "");
      if (pills.get(agentId) !== pill) throw new Error(`Couldn't wake: ${reason}`);
      pill.wake = "failed";
      pill.reason = reason;
      show(agentId);
      // Paseo shows a failed action's error in its own toast.
      throw new Error(`Couldn't wake: ${reason}`);
    }
  };

  const showPill = (agentId: string, workspaceId: string, sleptAt: string | null) => {
    const existing = pills.get(agentId);
    const text = pillText(sleptAt);
    if (existing && existing.workspaceId === workspaceId) {
      if (existing.wake || existing.text.label === text.label) return;
      existing.text = text;
      existing.sleptAt = sleptAt;
      return show(agentId);
    }
    if (existing) removePill(agentId);
    pills.set(agentId, { workspaceId, sleptAt, text, wake: null });
    show(agentId);
  };

  const refresh = async () => {
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      const result = await client.rpc(pillsRpc, {});
      if (lifetime.signal.aborted) return;
      const asleep = new Set<string>();
      for (const { agentId, workspaceId, sleptAt } of result.asleep) {
        // The directory saw this chat start after the daemon answered; its update wins.
        const seen = status.get(agentId);
        if (seen !== undefined && seen !== "closed") continue;
        asleep.add(agentId);
        showPill(agentId, workspaceId, sleptAt);
      }
      for (const [agentId, pill] of pills) {
        if (!asleep.has(agentId) && pill.wake !== "running") removePill(agentId);
      }
    } catch (error) {
      if (!lifetime.signal.aborted) console.error("[noice-omp-sleeping-tabs] reading asleep chats failed", error);
    } finally {
      refreshing = false;
      if (refreshAgain && !lifetime.signal.aborted) {
        refreshAgain = false;
        scheduleRefresh();
      }
    }
  };

  const scheduleRefresh = () => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer); // React Native's typing rejects undefined
    refreshTimer = setTimeout(() => {
      void refresh();
    }, REFRESH_DELAY_MS);
  };

  client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return;
      subscription.subscribe({
        snapshot: ({ entries }) => {
          status.clear();
          agents.clear();
          for (const { agent } of entries) {
            status.set(agent.id, agent.archivedAt ? "archived" : agent.status);
            agents.set(agent.id, { title: tabTitle(agent.title), createdAt: agent.createdAt });
          }
          syncMenu();
          scheduleRefresh();
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") {
            status.delete(update.agentId);
            agents.delete(update.agentId);
            removePill(update.agentId);
            return;
          }
          const { agent } = update;
          const next = agent.archivedAt ? "archived" : agent.status;
          const previous = status.get(agent.id);
          status.set(agent.id, next);
          agents.set(agent.id, { title: tabTitle(agent.title), createdAt: agent.createdAt });
          if (pills.has(agent.id)) syncMenu();
          if (next !== "closed") {
            // Woken (send, Wake, schedule…) or archived: the pill goes at once, no daemon call.
            if (pills.get(agent.id)?.wake !== "running") removePill(agent.id);
          } else if (previous !== "closed" || !pills.has(agent.id)) {
            scheduleRefresh();
          }
        },
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("[noice-omp-sleeping-tabs] agent subscription failed", error);
    });

  return () => {
    lifetime.abort();
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    menu.stop();
    for (const pill of pills.values()) pill.registration?.remove();
    pills.clear();
  };
}
