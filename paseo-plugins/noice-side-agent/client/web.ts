import { Platform } from "react-native";

const panesSelector = '[data-testid^="workspace-pane-"]';
function panes(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(panesSelector)].filter(pane => {
    const rect = pane.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

export function capturePane(agentId: string): HTMLElement | null {
  if (Platform.OS !== "web") return null;
  const focused = document.activeElement?.closest<HTMLElement>(panesSelector);
  if (focused) return focused;
  const visible = panes();
  return visible.find(pane => pane.querySelector(`[data-testid="workspace-tab-agent_${agentId}"][aria-selected="true"]`)) ?? (visible.length === 1 ? visible[0] : null);
}

function waitFor<T>(read: () => T | null): Promise<T> {
  const current = read();
  if (current) return Promise.resolve(current);
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const observer = new MutationObserver(() => {
    const value = read();
    if (value) { observer.disconnect(); clearTimeout(timer); resolve(value); }
  });
  const timer = setTimeout(() => { observer.disconnect(); reject(new Error("Paseo pane action timed out")); }, 1500);
  observer.observe(document.body, { childList: true, subtree: true });
  return promise;
}

function focusPane(pane: HTMLElement) {
  const target = pane.querySelector<HTMLElement>('[data-testid^="workspace-tab-"][aria-selected="true"]') ?? pane.querySelector<HTMLElement>('textarea, [role="textbox"], [role="button"]');
  if (!target) throw new Error("No pane focus target");
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", button: 0 }));
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse", button: 0 }));
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  target.click();
  target.focus();
}

export async function prepareRightPane(source: HTMLElement | null): Promise<void> {
  if (Platform.OS !== "web" || !source?.isConnected) return;
  const current = panes();
  const bounds = source.getBoundingClientRect();
  const right = current.filter(pane => {
    const rect = pane.getBoundingClientRect();
    return pane !== source && rect.left >= bounds.right - 8 && rect.bottom > bounds.top && rect.top < bounds.bottom;
  }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
  if (right) { focusPane(right); return; }
  // Do not add a third pane if the layout has changed or the source is rightmost.
  if (current.length !== 1) return;
  const menu = source.querySelector<HTMLElement>('[data-testid="workspace-split-pane-menu"]');
  if (!menu) return;
  // Paseo 0.12 has no plugin API to split a pane, so this presses the pane's own split menu.
  menu.click();
  let split: HTMLElement;
  try {
    split = await waitFor(() => document.querySelector<HTMLElement>('[data-testid="workspace-split-pane-right"]'));
  } catch (error) {
    // Never synthesize Escape: Paseo hands it to the top overlay (which may not be this menu, e.g.
    // fullscreen composer) or, with none open, to agent.interrupt. This backdrop exists only while
    // the split menu is open, and pressing it closes that menu alone.
    document.querySelector<HTMLElement>('[data-testid="workspace-split-pane-menu-content-backdrop"]')?.click();
    throw error;
  }
  // The item closes the menu before it splits, so a timeout below leaves nothing to clean up.
  split.click();
  await waitFor(() => panes().find(pane => pane !== source) ?? null);
}
