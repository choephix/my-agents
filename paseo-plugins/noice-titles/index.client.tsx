import { ActivityIndicator, Dimensions, Platform, View } from "react-native";
import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { useToast, type ToastApi, type ToastOptions, type ToastVariant } from "@getpaseo/plugin/client/react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { retitle, retitleWorkspace } from "./shared/rpc";
import { TitlesSettings } from "./client/settings";

const TAB = '[data-testid^="workspace-tab-agent_"][aria-selected="true"]';
const PANE = '[data-testid^="workspace-pane-"]';
const LENDER = "noice-titles-retitling-pill";
const PILL = "noice-titles-retitle-pill";
// Paseo's compact layout (phones, narrow windows) is below its md breakpoint.
const COMPACT_WIDTH = 600;
const web = Platform.OS === "web" && typeof document !== "undefined";

// While Claude thinks, a spinner replaces the icon of the agent's tab (every
// pane that shows it), in Paseo's own colors. The rules key on the tab's stable
// test id, so re-renders and theme switches keep them.
const tabSpinner = (agentId: string) => {
  const icon = `[data-testid="workspace-tab-agent_${agentId}"] > div > div:first-child`;
  return `${icon} > * { visibility: hidden; }
${icon}::after { content: ""; position: absolute; inset: 1px; box-sizing: border-box; border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--colors-foreground) 22%, transparent); border-top-color: var(--colors-foreground); border-right-color: var(--colors-foreground);
  animation: titles-retitling-spin 0.8s linear infinite; }`;
};
const tabVisible = (agentId: string) =>
  [...document.querySelectorAll(`[data-testid="workspace-tab-agent_${agentId}"]`)].some(tab => tab.getClientRects().length > 0);

export default function contribute(client: PluginClientContext) {
  const running = new Set<string>();
  // Web only: the tab spinners, hiding the toast-lending pill (below) and the Retitle pill's empty icon slot.
  const style = web ? document.head.appendChild(document.createElement("style")) : null;
  const paint = () => {
    if (style) style.textContent = [
      "@keyframes titles-retitling-spin { to { transform: rotate(360deg); } }",
      `button:has([data-testid="${LENDER}"]) { display: none; }`,
      `div:has(> [data-testid="${PILL}"]) { display: none; }`,
      ...[...running].map(tabSpinner),
    ].join("\n");
  };
  paint();
  const retitlingToast = (toast: ToastApi, color: string, text: string) =>
    // `icon` isn't in the plugin's ToastOptions type, but the host passes options through; without it the toast is text-only.
    toast.show(text, { durationMs: 30_000, icon: <ActivityIndicator size="small" color={color} testID="noice-titles-retitling-toast" /> } as ToastOptions);
  // Chats whose Retitle pill is on screen, with the toast its icon lends.
  const shown = new Map<string, { toast: ToastApi; color: string }>();

  // Feedback never enters the conversation. The indicator starts in the same
  // tick as the trigger: the tab spinner where the agent's tab is on screen,
  // otherwise (phone layouts, native apps) a "Retitling…" toast. The outcome
  // toast replaces either in the same tick the check ends. Toasts are a
  // hook-only API, so a composer pill's icon component lends one: the chat's
  // Retitle pill when it's on screen, else a pill added for the run (hidden on
  // web; on native it shows a spinner of its own).
  const run = async (agentId: string, workspaceId: () => Promise<string | undefined>) => {
    if (running.has(agentId)) return;
    running.add(agentId);
    paint();
    const announce = !web || !tabVisible(agentId);
    const onScreen = shown.get(agentId);
    const lent: { toast?: ToastApi } = { toast: onScreen?.toast };
    if (onScreen && announce) retitlingToast(onScreen.toast, onScreen.color, "Retitling…");
    const Lender = ({ size, color }: PluginButtonIconProps) => {
      const toast = useToast();
      lent.toast = toast;
      useEffect(() => {
        if (announce && running.has(agentId)) retitlingToast(toast, color, "Retitling…");
      }, [toast]);
      return <ActivityIndicator size={size} color={color} testID={LENDER} />;
    };
    let pill: { remove(): void } | undefined;
    let finished = false;
    if (!onScreen) void workspaceId().then(id => {
      if (!id || finished) return;
      pill = client.addComposerPill({
        id: `retitling-${agentId}`, workspaceId: id, agentId,
        button: { title: "Retitling…", icon: Lender, disabled: true, behavior: { kind: "action", onPress() {} } },
      });
    }, error => console.warn("noice-titles: couldn't resolve the tab's workspace", error));
    let feedback: { text: string; variant: ToastVariant };
    try {
      const result = await client.rpc(retitle, { agentId });
      feedback = result.outcome === "renamed"
        ? { text: `Renamed to ${result.title}${result.previous && result.previous.length <= 30 ? ` (was ${result.previous})` : ""}`, variant: "success" }
        : { text: `Couldn't retitle: ${result.message}`, variant: "error" };
    } catch (error) {
      feedback = { text: `Couldn't retitle: ${error instanceof Error ? error.message : String(error)}`, variant: "error" };
    } finally {
      finished = true;
      pill?.remove();
      running.delete(agentId);
      paint();
    }
    if (lent.toast) lent.toast.show(feedback.text, { variant: feedback.variant, durationMs: feedback.variant === "error" ? 6000 : 2500 });
    else if (feedback.variant === "error") throw new Error(feedback.text); // Command hosts toast thrown errors.
  };

  // Workspaces: the new title shows in the sidebar and header. Feedback starts at
  // once: a "Retitling workspace…" toast, replaced by the outcome, lent by a pill
  // on the composer of the tab the trigger came from (hidden on web, like the tab
  // path's). Triggers therefore need an agent tab in focus. No row-menu entry:
  // Paseo 0.12 has no plugin slot in the workspace ⋯ menu.
  const retitling = new Set<string>();
  const runWorkspace = async (workspaceId: string, agentId: string) => {
    if (retitling.has(workspaceId)) return;
    retitling.add(workspaceId);
    const lent: { toast?: ToastApi } = {};
    const Lender = ({ size, color }: PluginButtonIconProps) => {
      const toast = useToast();
      lent.toast = toast;
      useEffect(() => {
        if (retitling.has(workspaceId)) retitlingToast(toast, color, "Retitling workspace…");
      }, [toast]);
      return <ActivityIndicator size={size} color={color} testID={LENDER} />;
    };
    const pill = client.addComposerPill({
      id: `retitling-workspace-${agentId}`, workspaceId, agentId,
      button: { title: "Retitling workspace…", icon: Lender, disabled: true, behavior: { kind: "action", onPress() {} } },
    });
    let feedback: { text: string; variant: ToastVariant };
    try {
      const result = await client.rpc(retitleWorkspace, { workspaceId });
      feedback = result.outcome === "renamed"
        ? { text: `Workspace renamed to ${result.title}${result.previous && result.previous.length <= 30 ? ` (was ${result.previous})` : ""}`, variant: "success" }
        : { text: `Couldn't retitle the workspace: ${result.message}`, variant: "error" };
    } catch (error) {
      feedback = { text: `Couldn't retitle the workspace: ${error instanceof Error ? error.message : String(error)}`, variant: "error" };
    } finally {
      retitling.delete(workspaceId);
      pill.remove();
    }
    if (lent.toast) lent.toast.show(feedback.text, { variant: feedback.variant, durationMs: feedback.variant === "error" ? 6000 : 2500 });
    else if (feedback.variant === "error") throw new Error(feedback.text);
  };

  // Phone layouts: a "Retitle" pill on every chat's composer (label only on web; native can't hide the icon slot, so it gets an icon). Paseo
  // 0.14 gives plugins no slot in the tab's own menu (tab switcher ⋮), and its
  // header buttons are per workspace, blind to which tab is open. Wide layouts
  // get no pills and no agent subscription.
  const RetitlePillIcon = ({ color, ...props }: PluginButtonIconProps) => {
    const toast = useToast();
    const agentId = props.context === "agent" ? props.agentId : "";
    useEffect(() => {
      shown.set(agentId, { toast, color });
      return () => { if (shown.get(agentId)?.toast === toast) shown.delete(agentId); };
    }, [agentId, toast, color]);
    return <View testID={PILL}>{web ? null : <Icon name="Type" size={props.size} color={color} />}</View>;
  };
  const chats = new Map<string, string>(); // agent → workspace, open chats only
  const pills = new Map<string, { workspaceId: string; registration: PluginButtonRegistration }>();
  let compact = Dimensions.get("window").width < COMPACT_WIDTH;
  const syncPill = (agentId: string) => {
    const workspaceId = compact ? chats.get(agentId) : undefined;
    const pill = pills.get(agentId);
    if (pill?.workspaceId === workspaceId) return;
    pill?.registration.remove();
    pills.delete(agentId);
    if (workspaceId) pills.set(agentId, { workspaceId, registration: client.addComposerPill({
      id: "retitle", workspaceId, agentId,
      button: { title: "Retitle this tab", label: "Retitle", icon: RetitlePillIcon, behavior: { kind: "action", onPress: () => run(agentId, async () => workspaceId) } },
    }) });
  };
  type Chat = { id: string; workspaceId?: string | null; archivedAt?: string | null; internal?: boolean };
  const observe = (agent: Chat) => {
    if (agent.workspaceId && !agent.archivedAt && !agent.internal) chats.set(agent.id, agent.workspaceId);
    else chats.delete(agent.id);
    syncPill(agent.id);
  };
  const lifetime = new AbortController();
  let following = false;
  const follow = () => {
    if (following) return;
    following = true;
    void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ entries, subscription }) => {
      if (lifetime.signal.aborted) return;
      const replace = (list: readonly { agent: Chat }[]) => {
        const ids = new Set(list.map(({ agent }) => agent.id));
        for (const agentId of [...chats.keys()]) if (!ids.has(agentId)) observe({ id: agentId });
        list.forEach(({ agent }) => observe(agent));
      };
      replace(entries);
      subscription.subscribe({
        snapshot: snapshot => replace(snapshot.entries),
        update: message => {
          if (message.type !== "agent_update") return;
          if (message.payload.kind === "remove") observe({ id: message.payload.agentId });
          else observe(message.payload.agent);
        },
      });
    }).catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.warn("noice-titles: agent subscription failed", error);
    });
  };
  if (compact) follow();
  const resize = Dimensions.addEventListener("change", ({ window }) => {
    if (compact === window.width < COMPACT_WIDTH) return;
    compact = !compact;
    if (compact) follow();
    for (const agentId of chats.keys()) syncPill(agentId);
  });

  const cleanups = [
    // Command Center requires a built-in glyph; tab and workspace icons are left alone except for the spinner.
    client.addCommandCenterItem({ id: "retitle", title: "Retitle this tab", icon: "Type", keywords: ["title", "rename", "tab"], context: "agent", onSelect: ({ agent, workspace }) => run(agent.id, async () => workspace.id) }),
    client.addSlashCommand({ name: "retitle", description: "Give this tab a new title", argumentHint: "", context: "agent", onSubmit: ({ agent, workspace }) => run(agent.id, async () => workspace.id) }),
    client.addCommandCenterItem({ id: "retitle-workspace", title: "Retitle workspace", icon: "Type", keywords: ["title", "rename", "workspace"], context: "agent", onSelect: ({ agent, workspace }) => runWorkspace(workspace.id, agent.id) }),
    client.addSlashCommand({ name: "retitle-workspace", description: "Give this workspace a new title", argumentHint: "", context: "agent", onSubmit: ({ agent, workspace }) => runWorkspace(workspace.id, agent.id) }),
    client.addSettingsScreen({ id: "automatic", title: "Titles", icon: "Type", Component: TitlesSettings }),
    () => style?.remove(),
    () => { lifetime.abort(); resize.remove(); pills.forEach(pill => pill.registration.remove()); },
  ];

  if (Platform.OS === "web") {
    // Ctrl+Shift+Alt+T targets the selected agent tab of the pane last clicked or focused.
    // Paseo matches shortcut modifiers exactly, so this doesn't collide with its
    // non-Mac "Cycle theme" (Ctrl+Alt+T) or "New terminal" (Ctrl+Shift+T).
    let lastPane: Element | null = null;
    const track = (event: Event) => { lastPane = (event.target as Element | null)?.closest?.(PANE) ?? lastPane; };
    const keydown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || !event.shiftKey || event.metaKey || event.repeat || event.isComposing || event.getModifierState("AltGraph")) return;
      if (event.code !== "KeyT" && event.key.toLowerCase() !== "t") return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      const panes = [...document.querySelectorAll(PANE)].filter(pane => pane.getClientRects().length > 0);
      const pane = panes.find(candidate => candidate === lastPane) ?? (panes.length === 1 ? panes[0] : undefined);
      const agentId = pane?.querySelector(TAB)?.getAttribute("data-testid")?.slice("workspace-tab-agent_".length);
      if (!agentId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // The spinner starts now; the workspace (needed only for the toast-lending pill) resolves meanwhile.
      run(agentId, async () => (await client.paseo.agents.ref(agentId).refresh())?.agent.workspaceId)
        .catch(error => console.warn("noice-titles: Ctrl+Shift+Alt+T failed", error));
    };
    document.addEventListener("pointerdown", track, true);
    document.addEventListener("focusin", track, true);
    window.addEventListener("keydown", keydown, true);
    cleanups.push(() => {
      document.removeEventListener("pointerdown", track, true);
      document.removeEventListener("focusin", track, true);
      window.removeEventListener("keydown", keydown, true);
    });
  }
  return () => cleanups.forEach(cleanup => cleanup());
}
