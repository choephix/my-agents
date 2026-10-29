import { Platform } from "react-native";

// Paseo's plugin types leave out the DOM library; declare only what this module uses.
declare const document: {
  addEventListener(type: "keydown" | "pointerdown", listener: (event: { key?: string }) => void, capture: boolean): void;
  removeEventListener(type: "keydown" | "pointerdown", listener: (event: { key?: string }) => void, capture: boolean): void;
};
interface TitledElement {
  setAttribute(name: "title", value: string): void;
}

let keyboard = false;
const onKey = (event: { key?: string }) => {
  if (event.key === "Tab" || event.key?.startsWith("Arrow")) keyboard = true;
};
const onPointer = () => {
  keyboard = false;
};

/**
 * Tracks whether the last interaction was the keyboard, so focus rings follow `:focus-visible`
 * semantics: shown when tabbing, not after a click. Native apps have no focus rings to gate.
 */
export function startFocusModality(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPointer, true);
  return () => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onPointer, true);
  };
}

export function focusFromKeyboard(): boolean {
  return keyboard;
}

/**
 * A ref callback that gives the element a native browser tooltip. react-native-web drops a
 * `title` prop, and native apps have no hover, so this is web-only and a no-op elsewhere.
 */
export function tooltip(text: string): (node: unknown) => void {
  return (node) => {
    if (Platform.OS !== "web" || !node || typeof node !== "object" || !("setAttribute" in node)) return;
    const element: TitledElement = node as TitledElement; // react-native-web refs are DOM elements
    element.setAttribute("title", text);
  };
}

interface HoverableElement {
  addEventListener(type: "mouseenter" | "mouseleave", listener: () => void): void;
  style: { textDecorationLine: string };
}

/**
 * A ref callback that underlines the element while the pointer is over it. react-native-web's Text
 * fires no hover events, so links get it here; web-only, a no-op elsewhere.
 */
export function underlineOnHover(node: unknown): void {
  if (Platform.OS !== "web" || !node || typeof node !== "object" || !("addEventListener" in node) || !("style" in node)) return;
  const element = node as HoverableElement; // react-native-web refs are DOM elements
  element.addEventListener("mouseenter", () => (element.style.textDecorationLine = "underline"));
  element.addEventListener("mouseleave", () => (element.style.textDecorationLine = ""));
}

declare const window: {
  addEventListener(type: "keydown", listener: (event: SlashEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: SlashEvent) => void): void;
};
interface SlashEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
  preventDefault(): void;
}

/** Calls `focus` when `/` is typed outside a text field (web only). Returns a cleanup. */
export function onSlash(focus: () => void): () => void {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => {};
  const listener = (event: SlashEvent) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
    event.preventDefault();
    focus();
  };
  window.addEventListener("keydown", listener);
  return () => window.removeEventListener("keydown", listener);
}
