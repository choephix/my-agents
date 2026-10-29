import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { linksForAgent } from "../shared/links";
import type { AgentListener, AgentSummary } from "./agents";
import { createLinksPopover } from "./popover";
import { keepChatSubagents, LinksStore, type ChatLinks } from "./store";
import { hideParentSlot } from "./web";

/** `28 links`, `1 link`, worded like Paseo's own pills; `links` before the first count. */
export function linksLabel(count: number | null): string {
  if (count === null) return "links";
  return count === 1 ? "1 link" : `${count} links`;
}

/**
 * One `N links` composer pill per chat, worded like Paseo's own pills (`5 subagents`), no icon,
 * hidden while the chat has no links. A chat's links are fetched when its pill first shows (the
 * pill's icon slot mounting is the signal; until then it reads `links`), again when its agent
 * finishes a turn while the pill shows or is hidden for having none, and on opening the popover.
 * Nothing polls while agents are idle. Fed by `followAgents`. `setVisible(false)` (Settings → Show
 * composer pill) hides every pill and fetches nothing until it is turned back on.
 */
export function startPills(client: PluginClientContext): { agents: AgentListener; setVisible(visible: boolean): void; stop(): void } {
  const store = new LinksStore<ChatLinks>((agentId, subagents) => client.rpc(linksForAgent, { agentId, subagents }), keepChatSubagents);
  const pills = new Map<string, { registration: PluginButtonRegistration; label: string; visible: boolean }>();
  const statuses = new Map<string, string>();
  /** Mounted pill icons per chat: these chats are on screen. */
  const onScreen = new Map<string, number>();
  /** Chats whose agent finished a turn while their pill was hidden: refetch on next show. */
  const stale = new Set<string>();
  /** Settings → Show composer pill. */
  let enabled = true;

  const countOf = (agentId: string) => store.get(agentId).data?.links.length ?? null;
  const labelOf = (agentId: string) => linksLabel(countOf(agentId));
  /** Shown while the count is unknown (its mount fetches it), hidden once it is 0 or while pills are off. */
  const visibleOf = (agentId: string) => enabled && countOf(agentId) !== 0;

  /**
   * Paseo requires an icon and always draws a 16 px slot for it. This component draws nothing and,
   * on web, hides that slot so the pill reads like Paseo's text-only pills. Native keeps an empty slot.
   * It stays mounted because its mount tells us the chat is on screen.
   */
  function PillIcon(props: PluginButtonIconProps) {
    const agentId = props.context === "agent" ? props.agentId : "";
    const ref = useRef<View>(null);
    useEffect(() => hideParentSlot(ref.current), []);
    useEffect(() => {
      if (!agentId) return;
      onScreen.set(agentId, (onScreen.get(agentId) ?? 0) + 1);
      if (!store.get(agentId).data || stale.delete(agentId)) void store.refresh(agentId);
      return () => {
        const left = (onScreen.get(agentId) ?? 1) - 1;
        if (left) onScreen.set(agentId, left);
        else onScreen.delete(agentId);
      };
    }, [agentId]);
    return <View ref={ref} />;
  }
  const Content = createLinksPopover(store);

  /** Brings a chat's pill in line with its count and the setting. */
  const sync = (agentId: string) => {
    const pill = pills.get(agentId);
    if (!pill) return;
    const label = labelOf(agentId);
    const visible = visibleOf(agentId);
    if (pill.label === label && pill.visible === visible) return;
    pill.registration.update({ label, visible });
    pill.label = label;
    pill.visible = visible;
  };
  const offStore = store.subscribe(sync);

  const remove = (agentId: string) => {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
    statuses.delete(agentId);
    stale.delete(agentId);
    store.forget(agentId);
  };

  const observe = (agent: AgentSummary) => {
    if (!agent.workspaceId || agent.archivedAt || agent.internal) return remove(agent.id);
    const before = statuses.get(agent.id);
    statuses.set(agent.id, agent.status);
    if (before === "running" && agent.status !== "running") {
      // A pill hidden for having no links can't tell whether its chat is on screen, so it refetches now.
      if (enabled && (onScreen.has(agent.id) || countOf(agent.id) === 0)) void store.refresh(agent.id);
      else if (store.get(agent.id).data) stale.add(agent.id);
    }
    if (pills.has(agent.id)) return;
    const label = labelOf(agent.id);
    const visible = visibleOf(agent.id);
    const registration = client.addComposerPill({
      id: "links",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: { title: "Mentioned links", icon: PillIcon, label, visible, behavior: { kind: "popover", Content } },
    });
    pills.set(agent.id, { registration, label, visible });
  };

  return {
    agents: {
      replace(list) {
        const ids = new Set(list.map((agent) => agent.id));
        for (const agentId of [...pills.keys()]) if (!ids.has(agentId)) remove(agentId);
        for (const agent of list) observe(agent);
      },
      update: observe,
      remove,
    },
    setVisible(next) {
      if (next === enabled) return;
      enabled = next;
      for (const agentId of pills.keys()) {
        sync(agentId);
        // Shown pills refetch a stale chat as they mount; a chat with no links has no pill to mount.
        if (enabled && countOf(agentId) === 0 && stale.delete(agentId)) void store.refresh(agentId);
      }
    },
    stop() {
      offStore();
      for (const pill of pills.values()) pill.registration.remove();
      pills.clear();
    },
  };
}
