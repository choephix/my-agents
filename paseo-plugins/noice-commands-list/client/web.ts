import { Platform } from "react-native";

// Paseo's plugin types leave out the DOM library; declare only what this module uses.
interface DomElement {
  parentElement: DomElement | null;
  style: { display: string };
  isConnected: boolean;
  querySelector(selector: string): DomElement | null;
  getClientRects(): { length: number };
  closest(selector: string): DomElement | null;
  click(): void;
  focus(): void;
  scrollIntoView(options: { block: "nearest" }): void;
  dispatchEvent(event: unknown): boolean;
}
interface DomTextArea extends DomElement {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  setSelectionRange(start: number, end: number): void;
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
  HTMLTextAreaElement: { prototype: object };
  Event: new (type: string, init: { bubbles: boolean }) => unknown;
};

export const isWeb = Platform.OS === "web";

/** Each chat's mounted `cmds` pill icons: the composer to write into sits next to one. */
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

/** The chat's composer textarea: the nearest one above a visible `cmds` pill of that chat. */
function findComposer(agentId: string): DomTextArea | null {
  for (const node of pillNodes.get(agentId) ?? []) {
    if (!node.isConnected) continue;
    for (let element = node.parentElement; element; element = element.parentElement) {
      const input = element.querySelector("textarea[data-composer-input]") as DomTextArea | null;
      if (!input) continue;
      if (input.getClientRects().length) return input;
      break;
    }
  }
  return null;
}

/**
 * Web only: writes `text` into the chat's real message box at the cursor (replacing a selection),
 * keeping the draft around it. The native value setter plus an `input` event is what React's
 * change tracking sees, so Paseo's draft state follows. Returns where the cursor belongs (after
 * the text) for `focusComposer`, which runs once the popover has handed focus back; null when the
 * message box isn't on screen.
 */
export function insertIntoComposer(agentId: string, text: string): number | null {
  const input = findComposer(agentId);
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  if (!input || !setValue) return null;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  setValue.call(input, input.value.slice(0, start) + text + input.value.slice(end));
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  return start + text.length;
}

/** Focuses the chat's message box with the cursor at `caret`. */
export function focusComposer(agentId: string, caret: number): void {
  const input = findComposer(agentId);
  if (!input) return;
  input.focus();
  input.setSelectionRange(caret, caret);
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
