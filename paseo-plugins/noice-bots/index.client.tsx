import type { PluginButtonRegistration, PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { useEffect } from "react";
import { Text } from "react-native";
import { Day, DAY_KIND, listDay, markAllRead, openedThread, Thread, THREAD_KIND } from "./shared/contracts";
import { BotForm } from "./client/form";
import { createHubRows } from "./client/hub-rows";
import { watchHubs } from "./client/hubs";
import { BotsSettings } from "./client/settings";
import { ReadPanel, showThread } from "./client/read";
import { SearchThreads } from "./client/search";
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
  const openThread = (thread: Thread) => {
    if (thread.status === "running") {
      // An opened chat stays up after its turn: archiving would close the tab under you.
      void client.rpc(openedThread, { id: thread.id }).finally(() => openChat(thread.id));
      return;
    }
    showThread(thread.workspaceId, thread.id);
    client.openPanel("read", { workspaceId: thread.workspaceId });
  };
  const rows = createHubRows({ open: openThread, day: (botId, day) => client.rpc(listDay, { botId, day }) });
  /** After Delete bot (pressed in that bot's workspace): the next bot's hub, else the most recently active workspace. */
  const openNextHub = async (deleted: string) => {
    const next = hubs.current().find(hub => hub.botId !== deleted);
    if (next) return openChat(next.agentId);
    const { entries } = await client.paseo.workspaces.list({ sort: [{ key: "activity_at", direction: "desc" }], page: { limit: 1 } });
    if (entries[0]) client.openScreen({ screenId: "open", params: { workspaceId: entries[0].id, nonce: String(Date.now()) } });
  };

  // Each bot's workspace header: System prompt (its form), and a menu with Search and Mark all read.
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
          button: { title: "System prompt", icon: "ScrollText", label: "System prompt", behavior: { kind: "popover", Content: ({ theme, close }) => <BotForm botId={hub.botId} theme={theme} close={close} onDeleted={openNextHub} /> } },
        }),
        client.addHeaderButton({
          id: "bot-menu", workspaceId,
          button: {
            title: "Bot", icon: "Ellipsis", behavior: {
              kind: "menu", items: [
                { kind: "item", id: "search", title: "Search threads", icon: "Search", behavior: { kind: "popover", Content: ({ theme, close }) => <SearchThreads botId={hub.botId} theme={theme} open={thread => { close(); openThread(thread); }} /> } },
                { kind: "item", id: "mark-read", title: "Mark all read", icon: "CheckCheck", behavior: { kind: "action", onPress: async () => { await client.rpc(markAllRead, { botId: hub.botId }); } } },
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
    client.addSidebarHeaderItem({ id: "bots", title: "Bots", Component: createStrip(hubs, openChat) }),
    client.addWorkspacePanel({ id: "read", title: "🌙 Thread", icon: "Moon", Component: ReadPanel }),
    client.addTimelineRenderer({ kind: THREAD_KIND, version: 1, schema: Thread, Component: rows.ThreadRow }),
    client.addTimelineRenderer({ kind: DAY_KIND, version: 1, schema: Day, Component: rows.DayRow }),
    client.addSettingsScreen({ id: "settings", title: "Bots", icon: "Bot", Component: BotsSettings }),
  ];
  return () => {
    offHubs();
    hubs.stop();
    for (const registered of buttons.values()) for (const button of registered) button.remove();
    for (const remove of removers) remove();
  };
}
