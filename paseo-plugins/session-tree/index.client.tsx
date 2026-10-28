import { useEffect } from "react";
import { Platform, Text } from "react-native";
import type { PluginButtonRegistration, PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import {
  SUMMARY_KIND, SummaryItemSchema,
  treeCancel, treeChats, treeDismiss, treeGoto, treeOpenTab, treeState, treeSummarize, treeSummary,
} from "./shared/tree";
import { TreeStore } from "./client/store";
import { createPillIcon } from "./client/sheet";
import { createSummaryRow } from "./client/summary-row";
import { startWeb } from "./client/web";
import { createSettingsScreen } from "./client/settings-screen";
import { displaySettings } from "./shared/settings";

/** DOM code and slash commands have no navigation; this screen opens a chat through the host's. */
function OpenAgent({ navigation, params }: PluginScreenProps) {
  useEffect(() => {
    if (params.agentId) navigation?.openAgent({ agentId: params.agentId });
  }, [navigation, params.agentId]);
  return <Text>{navigation ? "Opening the branch…" : "This Paseo client cannot open chats from plugins; find the branch in the parent's sub-agents strip."}</Text>;
}

const NATIVE = Platform.OS !== "web";
/** Paseo's replay text for OMP bookkeeping entries (history.js visibleFallback). */
const BOOKKEEPING = /^\[(credential_pin|model_usage)\] Unsupported history record$/;

export default function contribute(client: PluginClientContext) {
  const store = new TreeStore({
    chats: () => client.rpc(treeChats, {}),
    state: agentId => client.rpc(treeState, { agentId }),
    goto: async (agentId, kind, target, summarize) =>
      (await client.rpc(treeGoto, { agentId, kind, summarize, ...(target ? { target } : {}) })).opId,
    summarize: async (agentId, focus) => (await client.rpc(treeSummarize, { agentId, focus })).opId,
    cancel: async agentId => void (await client.rpc(treeCancel, { agentId })),
    dismiss: async agentId => void (await client.rpc(treeDismiss, { agentId })),
    openTab: async (agentId, entryId, before) => (await client.rpc(treeOpenTab, { agentId, entryId, before })).agentId,
  });
  const PillIcon = createPillIcon(store);
  const openAgent = (agentId: string) => client.openScreen({ screenId: "open", params: { agentId } });

  // One muted "Tree · N" pill per chat with more than one branch. The native apps and Paseo's compact
  // (phone) web layout have no message icons, so there every OMP chat gets the pill, and it carries
  // the "set aside" offer. Settings → Show composer pill off keeps only the pills that host a sheet or toast.
  const pills = new Map<string, { registration: PluginButtonRegistration; label: string }>();
  /** Workspaces of chats that asked for the sheet with /tree before the next chat list arrived. */
  const workspaceOf = new Map<string, string>();
  function syncPills() {
    const snapshot = store.getSnapshot();
    // Needed only until the chat list knows the chat, and only while its sheet is asked for.
    for (const agentId of workspaceOf.keys()) if (snapshot.chats.has(agentId) || !snapshot.forced.has(agentId)) workspaceOf.delete(agentId);
    const wanted = new Map<string, { workspaceId: string; label: string }>();
    for (const agentId of new Set([...snapshot.chats.keys(), ...snapshot.forced])) {
      const chat = snapshot.chats.get(agentId);
      const workspaceId = chat?.workspaceId ?? workspaceOf.get(agentId);
      if (!workspaceId) continue;
      const starting = snapshot.starting.get(agentId);
      const phase = chat?.phase ?? (starting ? (starting === "summarize" ? "summarizing" : "switching") : null);
      const branches = chat?.branches ?? 1;
      const touch = NATIVE || snapshot.compact;
      // Pill off: it still appears while it hosts this chat's branch sheet (/tree) or, on phones, a
      // toast, because Paseo does not mount a hidden pill's icon and has no other per-chat host.
      const shown = snapshot.display?.showComposerPill === false
        ? snapshot.forced.has(agentId) || (NATIVE && snapshot.notices.some(notice => notice.agentId === agentId))
        : branches > 1 || phase || snapshot.forced.has(agentId) || touch;
      if (!shown) continue;
      const label = phase === "summarizing"
        ? "Summarizing…"
        : phase
          ? "Switching branch…"
          : touch && chat?.offer
            ? `↩ ${chat.offer} set aside`
            : branches > 1 ? `Tree · ${branches}` : "Tree";
      wanted.set(agentId, { workspaceId, label });
    }
    for (const [agentId, pill] of pills) {
      if (wanted.has(agentId)) continue;
      pill.registration.remove();
      pills.delete(agentId);
    }
    for (const [agentId, { workspaceId, label }] of wanted) {
      const pill = pills.get(agentId);
      if (pill) {
        if (pill.label !== label) pill.registration.update({ label });
        pill.label = label;
        continue;
      }
      const registration = client.addComposerPill({
        id: "tree",
        workspaceId,
        agentId,
        button: { title: "Branches (/tree)", icon: PillIcon, label, behavior: { kind: "action", onPress: () => store.openSheet(agentId) } },
      });
      pills.set(agentId, { registration, label });
    }
  }
  const unsubscribe = store.subscribe(syncPills);

  const SummaryRow = createSummaryRow((agentId, callId) => client.rpc(treeSummary, { agentId, callId }));
  const cleanups = [
    client.addScreen({ id: "open", title: "Branch", Component: OpenAgent }),
    client.addSlashCommand({
      name: "tree",
      description: "OMP: branches of this chat — switch, go back, summarize",
      argumentHint: "",
      context: "agent",
      async onSubmit({ agent, workspace, paseo, args }) {
        const state = await client.rpc(treeState, { agentId: agent.id });
        // Plugin commands win name collisions: other providers get their own /tree back unchanged.
        if (!state.supported) return void (await paseo.agents.ref(agent.id).send(`/tree${args ? ` ${args}` : ""}`));
        workspaceOf.set(agent.id, workspace.id);
        store.openSheet(agent.id);
      },
    }),
    client.addTimelineTransformer({
      id: "branch-summary-row",
      query: { itemType: "tool_call" },
      transform: ({ item }) => {
        const text = item.detail.type === "plain_text" ? (item.detail.text ?? "") : "";
        if (text.startsWith("[branch_summary]")) {
          return { items: [{ type: "plugin", id: item.callId, kind: SUMMARY_KIND, version: 1, data: { callId: item.callId } }] };
        }
        // Bookkeeping OMP entries that Paseo shows as "Custom message" rows once a chat is reloaded,
        // which every branch move does; the live chat never showed them.
        return BOOKKEEPING.test(text) ? { items: [] } : undefined;
      },
    }),
    client.addTimelineRenderer({ kind: SUMMARY_KIND, version: 1, schema: SummaryItemSchema, Component: SummaryRow }),
    client.addSettingsScreen({ id: displaySettings.id, title: "Session tree", icon: "GitBranch", Component: createSettingsScreen(() => store.refreshChats()) }),
    NATIVE ? () => {} : startWeb({ store, openAgent }),
  ];

  return () => {
    cleanups.forEach(cleanup => void cleanup());
    unsubscribe();
    store.dispose();
    pills.forEach(pill => pill.registration.remove());
  };
}
