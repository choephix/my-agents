import { ActivityIndicator, Platform } from "react-native";
import type { PluginButtonIconProps, PluginClientContext } from "@getpaseo/plugin/client";
import { useToast, type ToastApi, type ToastOptions, type ToastVariant } from "@getpaseo/plugin/client/react-native";
import { useEffect } from "react";
import { retitle, retitleWorkspace } from "./shared/rpc";
import { TitlesSettings } from "./client/settings";

const TAB = '[data-testid^="workspace-tab-agent_"][aria-selected="true"]';
const PANE = '[data-testid^="workspace-pane-"]';
const LENDER = "noice-titles-retitling-pill";
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
  // Web only: the tab spinners, and hiding the toast-lending pill (below).
  const style = web ? document.head.appendChild(document.createElement("style")) : null;
  const paint = () => {
    if (style) style.textContent = [
      "@keyframes titles-retitling-spin { to { transform: rotate(360deg); } }",
      `button:has([data-testid="${LENDER}"]) { display: none; }`,
      ...[...running].map(tabSpinner),
    ].join("\n");
  };
  paint();

  // Feedback never enters the conversation. The indicator starts in the same
  // tick as the trigger: the tab spinner where the agent's tab is on screen,
  // otherwise (phone layouts, native apps) a "Retitling…" toast. The outcome
  // toast replaces either in the same tick the check ends. Toasts are a
  // hook-only API, so a composer pill's icon component lends one; on web that
  // pill is hidden, on native it shows a spinner of its own.
  const run = async (agentId: string, workspaceId: () => Promise<string | undefined>) => {
    if (running.has(agentId)) return;
    running.add(agentId);
    paint();
    const announce = !web || !tabVisible(agentId);
    const lent: { toast?: ToastApi } = {};
    const Lender = ({ size, color }: PluginButtonIconProps) => {
      const toast = useToast();
      lent.toast = toast;
      useEffect(() => {
        if (!announce || !running.has(agentId)) return;
        // `icon` isn't in the plugin's ToastOptions type, but the host passes options through; without it the toast is text-only.
        toast.show("Retitling…", { durationMs: 30_000, icon: <ActivityIndicator size="small" color={color} testID="noice-titles-retitling-toast" /> } as ToastOptions);
      }, [toast]);
      return <ActivityIndicator size={size} color={color} testID={LENDER} />;
    };
    let pill: { remove(): void } | undefined;
    let finished = false;
    void workspaceId().then(id => {
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
        if (!retitling.has(workspaceId)) return;
        toast.show("Retitling workspace…", { durationMs: 30_000, icon: <ActivityIndicator size="small" color={color} testID="noice-titles-retitling-toast" /> } as ToastOptions);
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

  const cleanups = [
    // Command Center requires a built-in glyph; tab and workspace icons are left alone except for the spinner.
    client.addCommandCenterItem({ id: "retitle", title: "Retitle this tab", icon: "Type", keywords: ["title", "rename", "tab"], context: "agent", onSelect: ({ agent, workspace }) => run(agent.id, async () => workspace.id) }),
    client.addSlashCommand({ name: "retitle", description: "Give this tab a new title", argumentHint: "", context: "agent", onSubmit: ({ agent, workspace }) => run(agent.id, async () => workspace.id) }),
    client.addCommandCenterItem({ id: "retitle-workspace", title: "Retitle workspace", icon: "Type", keywords: ["title", "rename", "workspace"], context: "agent", onSelect: ({ agent, workspace }) => runWorkspace(workspace.id, agent.id) }),
    client.addSlashCommand({ name: "retitle-workspace", description: "Give this workspace a new title", argumentHint: "", context: "agent", onSubmit: ({ agent, workspace }) => runWorkspace(workspace.id, agent.id) }),
    client.addSettingsScreen({ id: "automatic", title: "Titles", icon: "Type", Component: TitlesSettings }),
    () => style?.remove(),
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
