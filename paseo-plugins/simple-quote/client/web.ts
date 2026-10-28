import { Platform } from "react-native";
import { appendQuote } from "./quote";

// Web and desktop only. A text selection inside a chat ([data-testid="agent-chat-scroll"], Paseo
// 0.13) gets a small Quote button above it, drawn in document.body so no React-owned node changes.
// Pressing it writes into that chat's message box the way agent-commands does: the native textarea
// value setter plus an `input` event, which Paseo's draft state follows. Nothing runs while no
// text is selected: no observers or timers, and the scroll listener exists only while the button
// is up.

// The plugin typechecks without the DOM library; declare only what this module uses.
interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}
interface DomNode {
  readonly nodeType: number;
  readonly parentElement: DomElement | null;
}
interface DomElement extends DomNode {
  readonly isConnected: boolean;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly style: { left: string; top: string };
  hidden: boolean;
  innerHTML: string;
  textContent: string | null;
  className: string;
  readonly shadowRoot: { querySelector(selector: string): DomElement | null } | null;
  closest(selector: string): DomElement | null;
  querySelector(selector: string): DomElement | null;
  hasAttribute(name: string): boolean;
  contains(node: unknown): boolean;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  getBoundingClientRect(): Rect;
  getClientRects(): ArrayLike<Rect>;
  setAttribute(name: string, value: string): void;
  append(...nodes: DomNode[]): void;
  remove(): void;
  addEventListener(type: string, listener: (event: DomEvent) => void): void;
}
interface DomTextArea extends DomElement {
  readonly value: string;
  focus(): void;
  setSelectionRange(start: number, end: number): void;
  dispatchEvent(event: unknown): boolean;
}
interface DomRange {
  readonly commonAncestorContainer: DomNode;
  getClientRects(): ArrayLike<Rect>;
}
interface DomSelection {
  readonly isCollapsed: boolean;
  readonly rangeCount: number;
  readonly anchorNode: DomNode | null;
  readonly focusNode: DomNode | null;
  getRangeAt(index: number): DomRange;
  removeAllRanges(): void;
  toString(): string;
}
interface DomEvent {
  readonly target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}
type Listener = (event: DomEvent) => void;
type ListenerOptions = boolean | { capture?: boolean; passive?: boolean };
declare const document: {
  readonly head: DomElement;
  querySelector(selector: string): DomElement | null;
  readonly body: DomElement;
  createElement(tag: string): DomElement;
  getSelection(): DomSelection | null;
  addEventListener(type: string, listener: Listener, options?: ListenerOptions): void;
  removeEventListener(type: string, listener: Listener, options?: ListenerOptions): void;
};
declare const window: {
  HTMLTextAreaElement: { prototype: object };
  Event: new (type: string, init: { bubbles: boolean }) => unknown;
  addEventListener(type: string, listener: Listener, options?: ListenerOptions): void;
  removeEventListener(type: string, listener: Listener, options?: ListenerOptions): void;
};
declare function requestAnimationFrame(callback: () => void): number;
declare function cancelAnimationFrame(handle: number): void;
declare class MutationObserver {
  constructor(callback: () => void);
  observe(target: DomElement, options: { attributes: boolean; attributeFilter: string[] }): void;
  disconnect(): void;
}

const CHAT = '[data-testid="agent-chat-scroll"]';
const COMPOSER = "textarea[data-composer-input]";
const EDITABLE = "input, textarea, [contenteditable='true'], [contenteditable='']";
const PREFIX = "simple-quote";
const ELEMENT_NODE = 1;
/** Space between the button and the selected text. */
const GAP = 8;
/** Space between the button and the chat's edges. */
const INSET = 6;
/** The annotations plugin's layer: its selection toolbar opens exactly where this button would. */
const ANNOTATIONS = "[data-paseo-annotations-popover]";

function annotationsPanel(): DomElement | null {
  return document.querySelector(ANNOTATIONS)?.shadowRoot?.querySelector(".panel") ?? null;
}

/** Lucide `text-quote` (Paseo's icon set), constant markup. */
const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 5H3"/><path d="M21 12H8"/><path d="M21 19H8"/><path d="M3 12v7"/></svg>';

const CSS = `
.qs-btn { position: fixed; z-index: 1000; display: inline-flex; align-items: center; gap: 5px; height: 26px; margin: 0;
  padding: 0 9px 0 7px; box-sizing: border-box; border: 1px solid var(--colors-surface2); border-radius: 7px;
  background: var(--colors-surface1); color: var(--colors-foreground);
  font: 500 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); cursor: pointer; white-space: nowrap;
  user-select: none; -webkit-user-select: none; animation: qs-in 120ms ease-out; }
.qs-btn[hidden] { display: none; }
.qs-btn:hover { background: color-mix(in srgb, var(--colors-foreground) 7%, var(--colors-surface1)); }
.qs-btn:focus-visible { outline: 2px solid var(--colors-accent-bright); outline-offset: 1px; }
.qs-btn svg { width: 14px; height: 14px; flex: none; fill: none; stroke: var(--colors-foreground-muted); stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round; }
@keyframes qs-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .qs-btn { animation: none; } }
`;

interface Target {
  composer: DomTextArea;
  chat: DomElement;
  range: DomRange;
  text: string;
}

const elementOf = (node: DomNode | null): DomElement | null =>
  !node ? null : node.nodeType === ELEMENT_NODE ? (node as DomElement) : node.parentElement;

const chatOf = (node: DomNode | null) => elementOf(node)?.closest(CHAT) ?? null;

/**
 * The chat's own message box: on the nearest ancestor of the chat that holds one, the box on
 * screen (a pane keeps hidden tabs mounted), preferring the one under the chat in a split.
 */
function composerOf(chat: DomElement): DomTextArea | null {
  for (let element = chat.parentElement; element; element = element.parentElement) {
    const inputs = Array.from(element.querySelectorAll(COMPOSER));
    if (!inputs.length) continue;
    const shown = inputs.filter((input) => input.getClientRects().length > 0);
    const box = chat.getBoundingClientRect();
    const middle = (box.left + box.right) / 2;
    const under = shown.find((input) => {
      const rect = input.getBoundingClientRect();
      return rect.left <= middle && middle <= rect.right;
    });
    return (under ?? shown[0] ?? null) as DomTextArea | null;
  }
  return null;
}

/** The selection, when it is non-blank text inside one chat that has a message box. */
function readSelection(): Target | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const chat = chatOf(selection.anchorNode);
  if (!chat || chatOf(selection.focusNode) !== chat) return null;
  const range = selection.getRangeAt(0);
  if (elementOf(range.commonAncestorContainer)?.closest(EDITABLE)) return null;
  const text = selection.toString();
  if (!text.trim()) return null;
  const composer = composerOf(chat);
  return composer ? { composer, chat, range, text } : null;
}

/** Shows the Quote button over text selected in a chat. Returns cleanup; a no-op off the web. */
export function startSimpleQuote(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};

  const style = document.createElement("style");
  style.setAttribute("data-plugin", PREFIX);
  style.textContent = CSS;
  document.head.append(style);

  const button = document.createElement("button");
  button.className = "qs-btn";
  button.setAttribute("type", "button");
  button.setAttribute("data-plugin", PREFIX);
  button.setAttribute("aria-label", "Quote the selection in the message box");
  button.innerHTML = `${ICON}<span>Quote</span>`;
  button.hidden = true;
  document.body.append(button);

  let target: Target | null = null;
  let dragging = false;
  let frame = 0;
  let following = false;
  // The annotations toolbar opens, moves and closes on its own timers; follow it while it can collide.
  const annotations = new MutationObserver(schedule);

  const follow = (on: boolean) => {
    if (on === following) return;
    following = on;
    const method = on ? "addEventListener" : "removeEventListener";
    document[method]("scroll", schedule, { capture: true, passive: true });
    window[method]("resize", schedule);
    const panel = on ? annotationsPanel() : null;
    if (panel) annotations.observe(panel, { attributes: true, attributeFilter: ["data-open", "data-view", "style"] });
    else annotations.disconnect();
  };

  const hide = () => {
    target = null;
    button.hidden = true;
    follow(false);
  };

  /**
   * Above the selection's first line, centred on it; below its last line when there's no room above.
   * When the annotations toolbar is open there, the button sits beside it instead of under it.
   */
  const place = (current: Target) => {
    const rects = Array.from(current.range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    const view = current.chat.getBoundingClientRect();
    const top = Math.min(...rects.map((rect) => rect.top));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    // Scrolled out of the chat: keep tracking, show again when it comes back.
    if (!rects.length || bottom <= view.top || top >= view.bottom) {
      button.hidden = true;
      return;
    }
    const firstLine = rects.filter((rect) => rect.top - top < 2);
    const middle = (Math.min(...firstLine.map((rect) => rect.left)) + Math.max(...firstLine.map((rect) => rect.right))) / 2;
    button.hidden = false;
    const width = button.offsetWidth;
    const height = button.offsetHeight;
    let y = top - GAP - height;
    if (y < view.top + INSET) y = bottom + GAP <= view.bottom - height - INSET ? bottom + GAP : view.top + INSET;
    let x = Math.min(Math.max(middle - width / 2, view.left + INSET), view.right - width - INSET);
    const panel = annotationsPanel();
    const toolbar = panel?.hasAttribute("data-open") ? panel.getBoundingClientRect() : null;
    if (toolbar && x < toolbar.right && x + width > toolbar.left && y < toolbar.bottom && y + height > toolbar.top) {
      y = toolbar.top + (toolbar.height - height) / 2;
      x = toolbar.right + GAP + width <= view.right - INSET ? toolbar.right + GAP : toolbar.left - GAP - width;
    }
    button.style.left = `${Math.round(x)}px`;
    button.style.top = `${Math.round(y)}px`;
  };

  const update = () => {
    frame = 0;
    target = dragging ? null : readSelection();
    if (!target) return hide();
    follow(true);
    place(target);
  };

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  const quote = () => {
    const current = readSelection();
    hide();
    if (!current?.composer.isConnected) return;
    const next = appendQuote(current.composer.value, current.text);
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (!next || !setValue) return;
    setValue.call(current.composer, next.text);
    current.composer.dispatchEvent(new window.Event("input", { bubbles: true }));
    document.getSelection()?.removeAllRanges();
    current.composer.focus();
    current.composer.setSelectionRange(next.caret, next.caret);
  };

  // Pressing the button must not move focus or drop the selection it is about to quote.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    quote();
  });

  // Runs before every document listener: a press on the button stops here, so other selection
  // toolbars (annotations) don't close and move it mid-click. Any other press starts a drag, and
  // the button waits for the release instead of chasing the pointer.
  const onPointerDown: Listener = (event) => {
    if (button.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    dragging = true;
    hide();
  };
  const onPointerUp: Listener = () => {
    if (!dragging) return;
    dragging = false;
    schedule();
  };

  document.addEventListener("selectionchange", schedule);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    follow(false);
    document.removeEventListener("selectionchange", schedule);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
    button.remove();
    style.remove();
  };
}
