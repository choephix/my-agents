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
