import { Platform } from "react-native";

// Paseo's plugin types leave out the DOM library; declare only what this module uses.
interface DomElement {
  parentElement: DomElement | null;
  style: { display: string };
  isConnected: boolean;
  closest(selector: string): DomElement | null;
  click(): void;
  scrollIntoView(options: { block: "nearest" }): void;
}
export interface DomKeyEvent {
  key: string;
  isComposing: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}
declare const window: {
  addEventListener(type: "keydown" | "keyup", listener: (event: DomKeyEvent) => void, capture: boolean): void;
  removeEventListener(type: "keydown" | "keyup", listener: (event: DomKeyEvent) => void, capture: boolean): void;
};

export const isWeb = Platform.OS === "web";

/** Each chat's mounted `cmds` pill icons, so Escape on a filtered list can reopen it. */
const pillNodes = new Map<string, Set<DomElement>>();

/** Web only: remembers a pill icon's DOM node for its chat until the icon unmounts. */
export function trackPill(agentId: string, node: unknown): () => void {
  if (!isWeb || !agentId || !node) return () => {};
  const nodes = pillNodes.get(agentId) ?? new Set();
  nodes.add(node as DomElement);
  pillNodes.set(agentId, nodes);
  return () => {
    nodes.delete(node as DomElement);
    if (!nodes.size) pillNodes.delete(agentId);
  };
}

/** Web only: Paseo always draws a 16 px icon slot in a pill; hide it so the pill is label-only. */
export function hideIconSlot(node: unknown): void {
  const slot = isWeb ? (node as DomElement | null)?.parentElement : null;
  if (slot) slot.style.display = "none";
}

/** Opens the chat's `cmds` popover again by pressing its pill. */
export function pressPill(agentId: string): void {
  for (const node of pillNodes.get(agentId) ?? []) {
    if (!node.isConnected) continue;
    node.closest('[role="button"]')?.click();
    return;
  }
}

export function scrollIntoView(node: unknown): void {
  if (isWeb && node) (node as DomElement).scrollIntoView({ block: "nearest" });
}

/** Typing into a field of its own (e.g. a settings input) must not drive the list. */
export function isEditable(target: unknown): boolean {
  return Boolean((target as DomElement | null)?.closest?.("input, textarea, [contenteditable='true']"));
}

export function onWindowKey(type: "keydown" | "keyup", listener: (event: DomKeyEvent) => void): () => void {
  if (!isWeb) return () => {};
  window.addEventListener(type, listener, true);
  return () => window.removeEventListener(type, listener, true);
}
