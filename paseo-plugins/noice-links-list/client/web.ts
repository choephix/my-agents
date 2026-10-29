import { Platform } from "react-native";

// Paseo's plugin types leave out the DOM library; declare only what this module uses.
/** Minimal shape of a DOM element, enough to hide it. */
interface DomNode {
  parentElement: { style: { display: string } } | null;
}

/** Web only: hides the element that contains `node` (the 16 px icon slot Paseo draws for every plugin pill). */
export function hideParentSlot(node: unknown): void {
  if (Platform.OS !== "web" || !node) return;
  const slot = (node as DomNode).parentElement;
  if (slot) slot.style.display = "none";
}

// Paseo's plugin types leave out the DOM library; declare only what this module uses.
declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | undefined;
/** Web's `localStorage`; native apps have none. */
const storage = typeof localStorage === "undefined" ? undefined : localStorage;
/** Native apps (and denied storage) keep values here until the app reloads. */
const memory = new Map<string, string>();

/** A value kept on this device (web: localStorage). */
export function loadDeviceValue(key: string): string | null {
  try {
    return storage?.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function saveDeviceValue(key: string, value: string): void {
  memory.set(key, value);
  try {
    storage?.setItem(key, value);
  } catch {
    // Private browsing can deny storage; the value lasts until the app reloads.
  }
}
