import { settingsRpc } from "@getpaseo/plugin";
import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { createCommandsPopover, reopenOnFilterEscape } from "./client/popover";
import { createSettingsScreen } from "./client/settings";
import { hideIconSlot, trackPill } from "./client/web";
import { SLASH_NAME } from "./shared/commands";
import { sendCommand, slashCatalog } from "./shared/rpc";
import { DEFAULTS, settings, type Settings } from "./shared/settings";

interface AgentSummary {
  id: string;
  workspaceId?: string | null;
  cwd: string;
  archivedAt?: string | null;
  internal?: boolean;
}

/** No visible icon (Stefan: label only). On web the empty node hides Paseo's icon slot and tells where this chat's message box is. */
function PillAnchor(props: PluginButtonIconProps) {
  const agentId = props.context === "agent" ? props.agentId : "";
  const ref = useRef<View>(null);
  useEffect(() => {
    hideIconSlot(ref.current);
    return trackPill(agentId, ref.current);
  }, [agentId]);
  return <View ref={ref} />;
}

export default function contribute(client: PluginClientContext) {
  const Content = createCommandsPopover(client, () => syncSoon());

  // One `cmds` pill per chat (Paseo has no every-chat pill), following the agent list.
  // No pills until the settings are read (`showPill` undefined), so a switched-off pill never flashes.
  const pills = new Map<string, PluginButtonRegistration>();
  const chats = new Map<string, { cwd: string; workspaceId: string }>();
  let showPill: boolean | undefined;
  const removePill = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };
  const addPill = (agentId: string, workspaceId: string) => {
    if (!showPill || pills.has(agentId)) return;
    pills.set(agentId, client.addComposerPill({
      id: "cmds",
      workspaceId,
      agentId,
      button: { title: "Commands", icon: PillAnchor, label: "cmds", behavior: { kind: "popover", Content } },
    }));
  };
  const removeAgent = (agentId: string) => {
    removePill(agentId);
    chats.delete(agentId);
  };
  const observe = (agent: AgentSummary) => {
    if (!agent.workspaceId || agent.archivedAt || agent.internal) return removeAgent(agent.id);
    chats.set(agent.id, { cwd: agent.cwd, workspaceId: agent.workspaceId });
    addPill(agent.id, agent.workspaceId);
  };
  const syncPills = () => {
    if (!showPill) for (const agentId of [...pills.keys()]) removePill(agentId);
    else for (const [agentId, chat] of chats) addPill(agentId, chat.workspaceId);
  };

  // "Commands in the / menu": the union of names over every chat's folder. On submit the daemon
  // expands this chat's file; a name this chat doesn't have goes to the agent unchanged.
  const slash = new Map<string, { key: string; remove(): void }>();
  let slashMenu = false;
  let syncing = Promise.resolve();
  const syncSlash = () => {
    syncing = syncing.then(async () => {
      const wanted = slashMenu ? (await client.rpc(slashCatalog, { cwds: [...new Set([...chats.values()].map((chat) => chat.cwd))] })).commands : [];
      const keep = new Set<string>();
      for (const command of wanted) {
        if (!SLASH_NAME.test(command.name)) continue;
        const description = command.description || "Command file";
        const key = `${description}\n${command.argumentHint}`;
        keep.add(command.name);
        const existing = slash.get(command.name);
        if (existing?.key === key) continue;
        existing?.remove();
        slash.set(command.name, {
          key,
          remove: client.addSlashCommand({
            name: command.name,
            description,
            argumentHint: command.argumentHint,
            context: "agent",
            async onSubmit({ args, agent, paseo }) {
              const result = await client.rpc(sendCommand, { agentId: agent.id, name: command.name, args });
              if (!result.sent) await paseo.agents.ref(agent.id).send(`/${command.name}${args ? ` ${args}` : ""}`);
            },
          }),
        });
      }
      for (const [name, entry] of slash) {
        if (keep.has(name)) continue;
        entry.remove();
        slash.delete(name);
      }
    }).catch((error: unknown) => console.warn("[noice-commands-list] / menu sync failed", error));
  };
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  const syncSoon = () => {
    if (!slashMenu) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncSlash, 500);
  };
  const applySettings = (values: Settings) => {
    showPill = values.pill;
    syncPills();
    slashMenu = values.slashMenu;
    syncSlash();
  };
  // Unreadable settings fall back to the defaults, so the pill still shows.
  void client.rpc(settingsRpc(settings.id).read, {}).then((result) => {
    const parsed = result.status === "ready" ? settings.schema.safeParse(result.values) : null;
    applySettings(parsed?.success ? parsed.data : DEFAULTS);
  }, (error: unknown) => {
    console.warn("[noice-commands-list] settings read failed", error);
    applySettings(DEFAULTS);
  });

  const lifetime = new AbortController();
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ entries, subscription }) => {
      if (lifetime.signal.aborted) return;
      const replace = (list: readonly { agent: AgentSummary }[]) => {
        const ids = new Set(list.map(({ agent }) => agent.id));
        for (const agentId of [...chats.keys()]) if (!ids.has(agentId)) removeAgent(agentId);
        for (const { agent } of list) observe(agent);
        syncSoon();
      };
      replace(entries);
      subscription.subscribe({
        snapshot: (snapshot) => replace(snapshot.entries),
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          const before = chats.size;
          if (update.kind === "remove") removeAgent(update.agentId);
          else observe(update.agent);
          if (chats.size !== before) syncSoon();
        },
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.warn("[noice-commands-list] agent subscription failed", error);
    });

  const cleanups = [
    client.addSettingsScreen({ id: "commands", title: "Agent commands", icon: "SquareSlash", Component: createSettingsScreen(applySettings) }),
    reopenOnFilterEscape(),
  ];
  return () => {
    lifetime.abort();
    clearTimeout(syncTimer);
    cleanups.forEach((cleanup) => void cleanup());
    pills.forEach((pill) => pill.remove());
    slash.forEach((entry) => entry.remove());
  };
}
