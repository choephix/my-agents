import { settingsRpc } from "@getpaseo/plugin";
import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { createPillIcon } from "./client/btw-sheet";
import { BtwStore, formatElapsed } from "./client/btw-store";
import { OmpProviders } from "./client/omp-providers";
import { createSettingsScreen } from "./client/settings";
import { createTanRow, TanRowData, type TanRpc } from "./client/tan-row";
import { btwAsk, btwChats, btwDismiss, btwList } from "./shared/btw";
import { DEFAULTS, preferences, type Preferences } from "./shared/preferences";
import { ompProviders } from "./shared/providers";
import { tanStatus } from "./shared/tan";

const PLUGIN_ID = "noice-omp-slash-aliases";

interface Alias {
  name: string;
  description: string;
  argumentHint: string;
  send(args: string): string;
}

/** Plain aliases: OMP gets the `/follow-up` form, which never cancels a running reply. */
const ALIASES: Alias[] = [
  { name: "omfg", description: "OMP: turn a correction into a persistent rule", argumentHint: "<correction>", send: args => `/follow-up /omfg ${args}` },
  { name: "queue", description: "OMP: queue a message after the current turn", argumentHint: "<message>", send: args => `/follow-up ${args}` },
];
/** Behind the "/tan command" setting, off by default. */
const TAN_ALIAS: Alias = { name: "tan", description: "OMP: run a background tangent (without interrupting)", argumentHint: "<work>", send: args => `/follow-up /tan ${args}` };

/** Paseo can echo the queued message with or without its transport prefix. */
const BTW_SEND = /^(?:\/follow-up )?\/btw /;
/** Paseo's echo of a /tan send; the rest is your text. */
const TAN_SEND = /^(?:\/follow-up )?\/tan(?:\s+|$)/;
const TAN_DISPATCH_RECORD = "background-tan-dispatch";

export default function contribute(client: PluginClientContext) {
  const store = new BtwStore({
    chats: async () => (await client.rpc(btwChats, {})).chats,
    list: async agentId => (await client.rpc(btwList, { agentId })).entries,
    ask: async (agentId, question) => void (await client.rpc(btwAsk, { agentId, question })),
    dismiss: async (agentId, id) => void (await client.rpc(btwDismiss, { agentId, id })),
  });
  const PillIcon = createPillIcon(store);
  const tanRpc: TanRpc = {
    status: async (agentId, tanId, at) => (await client.rpc(tanStatus, { agentId, tanId, at })).state,
  };
  // `omp` and custom providers built on it (e.g. `omp-nilo`), from Paseo's config.
  const providers = new OmpProviders(async () => (await client.rpc(ompProviders, {})).providers);

  // One composer pill per chat with /btw answers; its icon hosts the answer sheet.
  const pills = new Map<string, { registration: PluginButtonRegistration; label: string }>();
  function syncPills() {
    const { chats } = store.getSnapshot();
    for (const [agentId, pill] of pills) {
      if (chats.has(agentId)) continue;
      pill.registration.remove();
      pills.delete(agentId);
    }
    for (const [agentId, chat] of chats) {
      const count = chat.entries.length + chat.pending.length;
      // While an answer runs the icon spins and the label counts up (polls tick it at least every 0.6 s).
      const runningSince = Math.min(
        ...chat.pending.filter(ask => !ask.error).map(ask => ask.sentAt),
        ...chat.entries.filter(entry => entry.status === "running").map(entry => entry.createdAt),
      );
      const label = Number.isFinite(runningSince)
        ? `btw ${formatElapsed(Date.now() - runningSince)}`
        : count > 1
          ? `btw · ${count} answers`
          : "btw";
      const pill = pills.get(agentId);
      if (pill) {
        if (pill.label !== label) pill.registration.update({ label });
        pill.label = label;
        continue;
      }
      const registration = client.addComposerPill({
        id: "btw",
        workspaceId: chat.workspaceId,
        agentId,
        button: {
          title: "By the way (/btw)",
          icon: PillIcon,
          label,
          behavior: { kind: "action", onPress: () => store.open(agentId) },
        },
      });
      pills.set(agentId, { registration, label });
    }
  }
  const unsubscribe = store.subscribe(syncPills);
  void store.refresh();

  const addAlias = (alias: Alias) =>
    client.addSlashCommand({
      name: alias.name,
      description: alias.description,
      argumentHint: alias.argumentHint,
      context: "agent",
      async onSubmit({ args, agent, paseo }) {
        // Plugin commands win provider collisions: other providers get their own command back unchanged.
        if (!(await providers.isOmp(agent.provider))) return void (await paseo.agents.ref(agent.id).send(`/${alias.name}${args ? ` ${args}` : ""}`));
        if (!args) throw new Error(`Usage: /${alias.name} ${alias.argumentHint}`);
        await paseo.agents.ref(agent.id).send(alias.send(args));
      },
    });

  // `/tan` follows the host setting; nothing is registered until it is read, so a switched-off alias never flashes.
  let removeTan: (() => void) | undefined;
  const applySettings = (values: Preferences) => {
    if (values.tan && !removeTan) removeTan = addAlias(TAN_ALIAS);
    else if (!values.tan && removeTan) {
      removeTan();
      removeTan = undefined;
    }
  };
  let disposed = false;
  const readSettings = () =>
    client.rpc(settingsRpc(preferences.id).read, {}).then(
      result => {
        if (disposed) return;
        const parsed = result.status === "ready" ? preferences.schema.safeParse(result.values) : null;
        applySettings(parsed?.success ? parsed.data : DEFAULTS);
      },
      (error: unknown) => console.warn("[noice-omp-slash-aliases] settings read failed", error),
    );
  void readSettings();
  // Every settings save is announced; `snapshot` also fires on (re)connect. Other open clients follow.
  const settingsEvents = client.paseo.observeEvents(["status.plugin_settings_changed"]);
  settingsEvents.subscribe({
    snapshot: () => void readSettings(),
    update(message) {
      if (message.type === "status" && message.payload.status === "plugin_settings_changed"
        && message.payload.pluginId === PLUGIN_ID && message.payload.settingsId === preferences.id) void readSettings();
    },
  });

  const cleanups = [
    client.addSettingsScreen({ id: "commands", title: "OMP slash commands", icon: "SquareSlash", Component: createSettingsScreen(applySettings) }),
    ...ALIASES.map(addAlias),
    client.addSlashCommand({
      name: "btw",
      description: "OMP: quick by-the-way question about this chat (no interruption, not saved to the chat)",
      argumentHint: "<question>",
      context: "agent",
      async onSubmit({ args, agent, workspace, paseo }) {
        if (!(await providers.isOmp(agent.provider))) return void (await paseo.agents.ref(agent.id).send(`/btw${args ? ` ${args}` : ""}`));
        if (!args) throw new Error("Usage: /btw <question>");
        // The sheet opens at once and reports sending failures itself.
        void store.ask(agent.id, workspace.id, args);
      },
    }),
    client.addTimelineRenderer({ kind: "tan-row", version: 1, schema: TanRowData, Component: createTanRow(tanRpc, providers) }),
    // The /btw send is plumbing, not a conversation turn: keep it out of the timeline.
    // A /tan send becomes the tangent's row (live chats).
    client.addTimelineTransformer({
      id: "btw-and-tan-sends",
      query: { itemType: "user_message" },
      transform: ({ item }) => {
        if (BTW_SEND.test(item.text)) return { items: [] };
        const tan = TAN_SEND.exec(item.text);
        if (!tan) return undefined;
        const data: TanRowData = { source: "echo", work: item.text.slice(tan[0].length) };
        return { items: [{ type: "plugin", kind: "tan-row", version: 1, data }] };
      },
    }),
    // OMP's dispatch record: how reloaded chats show a tangent (and live ones at the next turn, when it was busy).
    client.addTimelineTransformer({
      id: "tan-dispatch-record",
      query: { itemType: "tool_call" },
      transform: ({ item }) => {
        if (item.name !== TAN_DISPATCH_RECORD) return undefined;
        const details = item.metadata?.details;
        if (typeof details !== "object" || details === null) return undefined;
        const work = "work" in details && typeof details.work === "string" ? details.work : undefined;
        const file = "sessionFile" in details && typeof details.sessionFile === "string" ? details.sessionFile : "";
        const tanId = /(Tan-[A-Za-z0-9]+)\.jsonl$/.exec(file)?.[1];
        const data: TanRowData = { source: "dispatch", ...(tanId ? { tanId } : {}), ...(work ? { work } : {}) };
        return { items: [{ type: "plugin", kind: "tan-row", version: 1, data }] };
      },
    }),
  ];

  return () => {
    disposed = true;
    void settingsEvents.release().catch(() => {});
    removeTan?.();
    cleanups.forEach(cleanup => cleanup());
    unsubscribe();
    store.dispose();
    pills.forEach(pill => pill.registration.remove());
  };
}
