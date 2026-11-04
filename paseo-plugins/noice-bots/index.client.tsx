import type { PluginButtonRegistration, PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { useEffect } from "react";
import { Text } from "react-native";
import { getThread, markAllRead, openedThread, settleAllRead, settleThread, Thread, THREAD_KIND, wakeThread } from "./shared/contracts";
import { BotForm } from "./client/form";
import { createHubRows } from "./client/hub-rows";
import { watchHubs } from "./client/hubs";
import { hideQuestions } from "./client/questions";
import { BotsSettings } from "./client/settings";
import { SearchThreads, UnreadThreads } from "./client/search";
import { createStrip } from "./client/strip";

const opened = new Set<string>();

/** Sidebar items and timeline rows have openScreen, not navigation: this screen lends it, then opens the chat (or workspace). */
function OpenAgent({ params, navigation, theme }: PluginScreenProps) {
  useEffect(() => {
    const key = `${params.agentId ?? params.workspaceId}:${params.nonce}`;
    if (!(params.agentId || params.workspaceId) || !navigation || opened.has(key)) return;
    // Not in the commit that mounts this screen: the app's navigation ref can still be null then.
    const timer = setTimeout(() => {
      opened.add(key);
      if (params.agentId) navigation.openAgent({ agentId: params.agentId });
      else navigation.openWorkspace({ workspaceId: params.workspaceId });
    }, 0);
    return () => clearTimeout(timer);
  }, [params.agentId, params.workspaceId, params.nonce, navigation]);
  return <Text style={{ color: theme.colors.foregroundMuted, padding: 24 }}>{navigation ? "Opening…" : "This Paseo client needs an update to open chats from Bots."}</Text>;
}

export default function contribute(client: PluginClientContext) {
  const openChat = (agentId: string) => client.openScreen({ screenId: "open", params: { agentId, nonce: String(Date.now()) } });
  const hubs = watchHubs(client);
  /** Running or up: its chat (`toChat` first, e.g. closing a popover). Asleep or read-only: `read()`, the 🌙 modal. */
  const openThread = (thread: Thread, read: () => void, toChat?: () => void) => {
    if (thread.status === "running") {
      toChat?.();
      // An opened chat stays up after its turn: archiving would close the tab under you.
      void client.rpc(openedThread, { id: thread.id }).finally(() => openChat(thread.id));
      return;
    }
    // Paseo shows every unarchived agent as a tab: a thread still up (its chat was opened) is that
    // tab. Only a sleeping thread (archived) or a read-only one (deleted) gets the 🌙 modal.
    void client.paseo.agents.ref(thread.id).refresh().then(found => !!found?.agent && !found.agent.archivedAt, () => false).then(live => {
      if (!live) return read();
      toChat?.();
      // The 🌙 modal marks a thread read when it shows it; so does going to its chat.
      if (thread.unread) client.rpc(getThread, { id: thread.id, markRead: true }).catch(error => console.error(`noice-bots: marking ${thread.id} read failed`, error));
      openChat(thread.id);
    });
  };
  /** The 🌙 modal's Wake: Paseo restores the archived thread with its history, then its chat opens as a tab. */
  const wake = async (id: string) => {
    await client.rpc(wakeThread, { id });
    openChat(id);
  };
  const listActions = (close: () => void) => ({ open: (thread: Thread, read: () => void) => openThread(thread, read, close), wake, close });
  // The server redraws the block, or its one line, in the hub.
  const settle = (thread: Thread, settled: boolean) => {
    client.rpc(settleThread, { id: thread.id, settled }).catch(error => console.error(`noice-bots: settling ${thread.id} failed`, error));
  };
  const questions = hideQuestions(client);
  const rows = createHubRows({ open: openThread, wake, settle, drawn: questions.sync });
  /** After Delete bot (pressed in that bot's workspace): the next bot's hub, else the most recently active workspace. */
  const openNextHub = async (deleted: string) => {
    const next = hubs.current().find(hub => hub.botId !== deleted);
    if (next) return hubs.restore(next).finally(() => openChat(next.agentId));
    const { entries } = await client.paseo.workspaces.list({ sort: [{ key: "activity_at", direction: "desc" }], page: { limit: 1 } });
    if (entries[0]) client.openScreen({ screenId: "open", params: { workspaceId: entries[0].id, nonce: String(Date.now()) } });
  };

  // Each bot's workspace header: Bot (its form), and a menu with Unread, Search and Mark all read.
  const buttons = new Map<string, PluginButtonRegistration[]>();
  const syncButtons = () => {
    const current = new Map(hubs.current().map(hub => [hub.workspaceId, hub]));
    for (const [workspaceId, registered] of buttons) {
      if (current.has(workspaceId)) continue;
      for (const button of registered) button.remove();
      buttons.delete(workspaceId);
    }
    for (const [workspaceId, hub] of current) {
      if (buttons.has(workspaceId)) continue;
      buttons.set(workspaceId, [
        client.addHeaderButton({
          id: "system-prompt", workspaceId,
          button: { title: "Bot", icon: "Bot", label: "Bot", behavior: { kind: "popover", Content: ({ theme, close }) => <BotForm botId={hub.botId} theme={theme} close={close} onDeleted={openNextHub} /> } },
        }),
        client.addHeaderButton({
          id: "bot-menu", workspaceId,
          button: {
            title: "Bot", icon: "Ellipsis", behavior: {
              kind: "menu", items: [
                { kind: "item", id: "unread", title: "Unread threads", icon: "Inbox", behavior: { kind: "popover", Content: ({ theme, close }) => <UnreadThreads botId={hub.botId} theme={theme} actions={listActions(close)} /> } },
                { kind: "item", id: "search", title: "Search threads", icon: "Search", behavior: { kind: "popover", Content: ({ theme, close }) => <SearchThreads botId={hub.botId} theme={theme} actions={listActions(close)} /> } },
                { kind: "item", id: "mark-read", title: "Mark all read", icon: "CheckCheck", behavior: { kind: "action", onPress: async () => { await client.rpc(markAllRead, { botId: hub.botId }); } } },
                { kind: "item", id: "settle-read", title: "Settle all read", icon: "ListChecks", behavior: { kind: "action", onPress: async () => { await client.rpc(settleAllRead, { botId: hub.botId }); } } },
              ],
            },
          },
        }),
      ]);
    }
  };
  const offHubs = hubs.subscribe(syncButtons);

  const removers = [
    client.addScreen({ id: "open", title: "Bots", Component: OpenAgent }),
    client.addSidebarHeaderItem({ id: "bots", title: "Bots", Component: createStrip(hubs, wake) }),
    client.addTimelineRenderer({ kind: THREAD_KIND, version: 1, schema: Thread, Component: rows.ThreadRow }),
    client.addSettingsScreen({ id: "settings", title: "Bots", icon: "Bot", Component: BotsSettings }),
  ];
  return () => {
    offHubs();
    hubs.stop();
    questions.stop();
    for (const registered of buttons.values()) for (const button of registered) button.remove();
    for (const remove of removers) remove();
  };
}
