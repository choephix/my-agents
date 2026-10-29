import { Platform } from "react-native";

// Paseo's plugin types leave out the DOM library; declare only what this module uses.
interface DomEvent {
  key?: string;
  stopPropagation(): void;
  preventDefault(): void;
}
type DomListener = (event: DomEvent) => void;
declare const document: {
  addEventListener(type: "keydown" | "pointerdown" | "click", listener: DomListener, capture: boolean): void;
  removeEventListener(type: "keydown" | "pointerdown" | "click", listener: DomListener, capture: boolean): void;
};
interface TitledElement {
  setAttribute(name: "title", value: string): void;
}

let keyboard = false;
const onKey = (event: DomEvent) => {
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
 * Swallows the click a browser sends when a long-pressing finger lifts (waiting at most 1 s): it
 * would land on whatever the long press put under the finger, such as the backdrop of the sheet
 * it opened, and dismiss it. Native apps send no such click.
 */
export function swallowNextClick(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const stop = () => {
    document.removeEventListener("click", swallow, true);
    clearTimeout(timer);
  };
  const swallow = (event: DomEvent) => {
    event.stopPropagation();
    event.preventDefault();
    stop();
  };
  document.addEventListener("click", swallow, true);
  const timer = setTimeout(stop, 1000);
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
