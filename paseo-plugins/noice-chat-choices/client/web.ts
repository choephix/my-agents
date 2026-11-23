import type { PluginClientContext, PluginComposer } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { choicePrompt, deriveStates, fillChoiceText } from "./choices";

// Web and desktop only. Paseo renders `[label](<@prompt>)` in an agent reply as an ordinary link with
// the href `@prompt`. This module styles those links as choices, catches their clicks before Paseo
// opens them, writes the prompt into that chat's message box through Paseo's `client.composers` API,
// and marks each choice's state with an attribute. States are derived from the page every time,
// nothing is stored: the box text says what is picked, later user messages say what was settled.
// Work runs only on events: a click, typing in a message box, and new or replaced chat rows (one
// observer, scoped to chats and coalesced to at most one pass per 120 ms). Nothing runs while idle.

// The plugin typechecks without the DOM library; declare only what this module uses.
interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}
interface DomNode {
  readonly nodeType: number;
  readonly parentElement: DomElement | null;
}
interface DomElement extends DomNode {
  readonly isConnected: boolean;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly style: { left: string; top: string; color: string; setProperty(name: string, value: string): void; getPropertyValue(name: string): string };
  hidden: boolean;
  textContent: string | null;
  className: string;
  matches(selector: string): boolean;
  closest(selector: string): DomElement | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): Rect;
  removeAttribute(name: string): void;
  getClientRects(): ArrayLike<Rect>;
  compareDocumentPosition(other: DomElement): number;
  append(...nodes: DomNode[]): void;
  remove(): void;
  dispatchEvent(event: unknown): boolean;
}
interface DomEvent {
  readonly target: unknown;
  readonly relatedTarget?: unknown;
  readonly button?: number;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}
interface DomMutationRecord {
  readonly target: DomNode;
  readonly addedNodes: ArrayLike<DomNode>;
}
interface Fiber {
  readonly type: unknown;
  readonly memoizedProps?: { readonly agentId?: unknown; readonly agent?: { readonly id?: unknown } | null } | null;
  readonly return?: Fiber | null;
}
type Listener = (event: DomEvent) => void;
type ListenerOptions = boolean | { capture?: boolean; passive?: boolean };
declare const document: {
  readonly documentElement: DomElement;
  readonly head: DomElement;
  readonly body: DomElement;
  createElement(tag: string): DomElement;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  addEventListener(type: string, listener: Listener, options?: ListenerOptions): void;
  removeEventListener(type: string, listener: Listener, options?: ListenerOptions): void;
};
declare const window: {
  readonly innerWidth: number;
};
declare function getComputedStyle(element: DomElement): { readonly backgroundColor: string };
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(handle: number): void;
declare function requestAnimationFrame(callback: () => void): number;
declare function cancelAnimationFrame(handle: number): void;
declare class MutationObserver {
  constructor(callback: (records: readonly DomMutationRecord[]) => void);
  observe(
    target: DomElement,
    options: { childList?: boolean; subtree?: boolean; attributes?: boolean; attributeFilter?: string[] },
  ): void;
  disconnect(): void;
}

const CHAT = '[data-testid="agent-chat-scroll"]';
const USER = '[data-testid="user-message"]';
const COMPOSER = "textarea[data-composer-input]";
// Replies other plugins redraw (noice-chat-embeds) sit outside Paseo's `assistant-message`, so a
// choice is any `@` link in a chat that isn't in one of your own messages.
const CHOICE = `${CHAT} a[href^="@"]:not(${USER} a)`;
const STATE = "data-noice-choice";
const ELEMENT_NODE = 1;
const DOCUMENT_POSITION_FOLLOWING = 4;
/** Hover time before the prompt shows, as Paseo's own link tooltips. */
const TOOLTIP_DELAY = 400;

// Paseo sets the link colour (its accent) and a hover underline inline, so the look needs
// !important. The accent stays readable in `--noice-choice-accent`, set per chat from that inline
// colour; `--noice-choice-ink` is the chat's background, the text colour on a picked choice.
// The marker is a background image that is always there at zero width, so picking sweeps it in.
const CSS = `
${CHOICE} {
  --noice-choice-c: var(--noice-choice-accent, currentColor);
  font-weight: 600;
  text-decoration: none !important;
  cursor: pointer;
  border-radius: 4px;
  padding: 1px 3px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  background-color: color-mix(in srgb, var(--noice-choice-c) 16%, transparent);
  background-image: linear-gradient(var(--noice-choice-c), var(--noice-choice-c));
  background-repeat: no-repeat;
  background-position: left center;
  background-size: 0% 100%;
  transition: color .18s, background-color .18s, background-size .18s cubic-bezier(.4, 0, .2, 1);
}
${CHOICE}:hover { background-color: color-mix(in srgb, var(--noice-choice-c) 30%, transparent); }
${CHOICE}:focus-visible { outline: 2px solid var(--noice-choice-c); outline-offset: 1px; }
${CHOICE}[${STATE}="picked"] {
  color: var(--noice-choice-ink, #fff) !important;
  background-size: 100% 100%;
}
${CHOICE}[${STATE}="picked"]:hover {
  background-image: linear-gradient(color-mix(in srgb, var(--noice-choice-c) 85%, var(--noice-choice-ink, #fff)), color-mix(in srgb, var(--noice-choice-c) 85%, var(--noice-choice-ink, #fff)));
}
${CHOICE}:is([${STATE}="passed-over"], [${STATE}="stale"], [${STATE}="accepted"]) { color: inherit !important; }
${CHOICE}[${STATE}="passed-over"] { background-color: color-mix(in srgb, currentColor 9%, transparent); }
${CHOICE}[${STATE}="stale"] { background-color: transparent; }
${CHOICE}:is([${STATE}="passed-over"], [${STATE}="stale"]):hover { background-color: color-mix(in srgb, currentColor 13%, transparent); }
${CHOICE}[${STATE}="accepted"] {
  background-color: transparent;
  background-image: linear-gradient(color-mix(in srgb, var(--noice-choice-c) 32%, transparent), color-mix(in srgb, var(--noice-choice-c) 32%, transparent));
  background-size: 100% 100%;
  transition: none;
}
.noice-choice-tip {
  position: fixed;
  z-index: 2147483000;
  max-width: min(420px, calc(100vw - 16px));
  padding: 5px 8px;
  border-radius: 6px;
  background: #18181b;
  color: #fafafa;
  font: 500 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .28);
  pointer-events: none;
  white-space: pre-wrap;
  animation: noice-choice-tip-in .12s ease-out;
}
@keyframes noice-choice-tip-in { from { opacity: 0; transform: translateY(2px); } }
@media (prefers-reduced-motion: reduce) {
  ${CHOICE} { transition: none; }
  .noice-choice-tip { animation: none; }
}
`;

const elementOf = (target: unknown): DomElement | null => {
  const node = target as DomNode | null;
  return !node ? null : node.nodeType === ELEMENT_NODE ? (node as DomElement) : node.parentElement;
};

/** The choice link an event landed in, or null. */
const choiceAt = (target: unknown) => elementOf(target)?.closest(CHOICE) ?? null;

const promptOf = (link: DomElement) => choicePrompt(link.getAttribute("href") ?? "@", link.textContent ?? "");

/** A question is one list, else one paragraph (or heading, quote, cell), else the link's own block. */
const questionOf = (link: DomElement) =>
  link.closest("ul, ol") ?? link.closest("p, h1, h2, h3, h4, h5, h6, blockquote, td, th") ?? link.parentElement;

const FIBER_DEPTH = 50;
const agentIds = new WeakMap<DomElement, string>();

/** The agent id owning a chat or composer element, read once from its React fiber ancestors. */
function agentIdOf(element: DomElement): string | null {
  const cached = agentIds.get(element);
  if (cached) return cached;
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: Fiber | null | undefined = key ? (element as unknown as Record<string, Fiber | undefined>)[key] : undefined;
  for (let depth = 0; fiber && depth < FIBER_DEPTH; depth++, fiber = fiber.return) {
    if (typeof fiber.type === "string") continue;
    const props = fiber.memoizedProps;
    const id = typeof props?.agentId === "string" ? props.agentId : typeof props?.agent?.id === "string" ? props.agent.id : null;
    if (id) {
      agentIds.set(element, id);
      return id;
    }
  }
  return null;
}

/** The first opaque background behind the chat: the text colour of a picked choice. */
function inkOf(chat: DomElement): string | null {
  for (let element: DomElement | null = chat; element; element = element.parentElement) {
    const color = getComputedStyle(element).backgroundColor;
    if (color && color !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return null;
}

interface PageQuestion {
  readonly node: DomElement;
  readonly links: DomElement[];
  readonly prompts: string[];
}

/** The chat's questions in page order, each with its links and their prompts. */
function questionsIn(chat: DomElement): PageQuestion[] {
  const questions: PageQuestion[] = [];
  const byNode = new Map<DomElement, PageQuestion>();
  for (const link of Array.from(chat.querySelectorAll(CHOICE))) {
    const node = questionOf(link);
    if (!node) continue;
    let question = byNode.get(node);
    if (!question) {
      question = { node, links: [], prompts: [] };
      byNode.set(node, question);
      questions.push(question);
    }
    question.links.push(link);
    question.prompts.push(promptOf(link));
  }
  return questions;
}

function setVar(chat: DomElement, name: string, value: string | null) {
  if (value && chat.style.getPropertyValue(name) !== value) chat.style.setProperty(name, value);
}

/** Styles choice links in agent replies and makes a click fill the message box. Returns cleanup; a no-op off the web. */
export function startChoices(client: PluginClientContext): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};

  const composerFor = (chat: DomElement, allowFocusedFallback: boolean): PluginComposer | null => {
    const id = agentIdOf(chat);
    if (id) return client.composers({ agentId: id })[0] ?? null;
    return allowFocusedFallback ? (client.composers({ focused: true })[0] ?? null) : null;
  };

  /** Sets every choice's state attribute in one chat from its message box and later user messages; returns the chat's questions. */
  const refresh = (chat: DomElement, boxText?: string, syncInk = false): PageQuestion[] => {
    const questions = questionsIn(chat);
    if (!questions.length) return questions;
    const users = Array.from(chat.querySelectorAll(USER)).map((node) => ({
      node,
      text: node.querySelector("[data-message-text]")?.textContent ?? "",
    }));
    const text =
      boxText !== undefined
        ? boxText
        : (composerFor(chat, document.querySelectorAll(CHAT).length === 1)?.prompt ?? "");
    const states = deriveStates(
      questions.map((question) => ({
        prompts: question.prompts,
        laterMessages: users
          .filter((user) => question.node.compareDocumentPosition(user.node) & DOCUMENT_POSITION_FOLLOWING)
          .map((user) => user.text),
      })),
      text,
    );
    questions.forEach((question, q) =>
      question.links.forEach((link, c) => {
        if (link.getAttribute(STATE) !== states[q][c]) link.setAttribute(STATE, states[q][c]);
      }),
    );
    setVar(chat, "--noice-choice-accent", questions[0].links[0].style.color || null);
    if (syncInk || !chat.style.getPropertyValue("--noice-choice-ink")) {
      setVar(chat, "--noice-choice-ink", inkOf(chat));
    }
    return questions;
  };

  const refreshAll = (syncInk = false) => {
    for (const chat of Array.from(document.querySelectorAll(CHAT))) refresh(chat, undefined, syncInk);
  };

  const style = document.createElement("style");
  style.setAttribute("data-plugin", "noice-chat-choices");
  style.textContent = CSS;
  document.head.append(style);

  const tip = document.createElement("div");
  tip.className = "noice-choice-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  let tipTimer = 0;
  let tipFor: DomElement | null = null;
  const hideTip = () => {
    if (!tipFor && tip.hidden) return;
    clearTimeout(tipTimer);
    tipTimer = 0;
    tipFor = null;
    tip.hidden = true;
  };
  /** Shows the full prompt above the link's first line, when it says more than the label. */
  const showTip = (link: DomElement) => {
    const prompt = promptOf(link);
    if (!link.isConnected || prompt === (link.textContent ?? "").trim()) return;
    tip.textContent = prompt;
    tip.hidden = false;
    const first = link.getClientRects()[0] ?? link.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const x = Math.min(Math.max(first.left, 8), window.innerWidth - width - 8);
    const y = first.top - height - 6 >= 8 ? first.top - height - 6 : first.bottom + 6;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
  };

  const onClick: Listener = (event) => {
    const link = choiceAt(event.target);
    if (!link) return;
    // Paseo would open the href as a link or a file; a choice is neither.
    event.preventDefault();
    event.stopImmediatePropagation();
    hideTip();
    const chat = link.closest(CHAT);
    const composer = chat ? composerFor(chat, true) : null;
    if (!chat || !composer) return;
    const question = refresh(chat, composer.prompt).find((candidate) => candidate.links.includes(link));
    const prompt = promptOf(link);
    const prompts = question?.prompts ?? [prompt];
    const pickedIndex = question?.links.findIndex((other) => other.getAttribute(STATE) === "picked") ?? -1;
    const next = fillChoiceText(composer.prompt, prompt, prompts, pickedIndex === -1 ? undefined : prompts[pickedIndex]);
    composer.setPrompt(next);
    void composer.focus({ selection: { start: next.length, end: next.length } }).catch(() => {});
    refresh(chat, next);
  };

  // Middle and other non-primary clicks would open the href in a new browser tab.
  const onAuxClick: Listener = (event) => {
    if (choiceAt(event.target)) event.preventDefault();
  };

  // Typing changes which choices are picked; recompute only that box's chat, once per frame.
  let typingFrame = 0;
  const onInput: Listener = (event) => {
    const box = elementOf(event.target)?.closest(COMPOSER);
    if (!box || typingFrame || !document.querySelector(CHOICE)) return;
    typingFrame = requestAnimationFrame(() => {
      typingFrame = 0;
      const id = agentIdOf(box);
      const chats = Array.from(document.querySelectorAll(CHAT));
      const matched = id ? chats.find((candidate) => agentIdOf(candidate) === id) : undefined;
      if (matched) refresh(matched);
      else for (const chat of chats) refresh(chat);
    });
  };

  const onOver: Listener = (event) => {
    const link = choiceAt(event.target);
    if (link === tipFor) return;
    hideTip();
    if (!link) return;
    tipFor = link;
    tipTimer = setTimeout(() => showTip(link), TOOLTIP_DELAY);
  };
  const onOut: Listener = (event) => {
    if (tipFor && choiceAt(event.relatedTarget) !== tipFor) hideTip();
  };

  // New, streamed or remounted rows (a reply arriving, a sent message, a tab switch, Paseo setting a
  // restored draft) change states without an input event. Ignore mutations outside chats unless a
  // chat or composer itself mounted; coalesce to at most one pass per 120 ms.
  const CHAT_OR_COMPOSER = `${CHAT}, ${COMPOSER}`;
  let passTimer = 0;
  let dirtyAll = false;
  const dirtyChats = new Set<DomElement>();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const chat = elementOf(record.target)?.closest(CHAT);
      if (chat) {
        dirtyChats.add(chat);
        continue;
      }
      if (dirtyAll) continue;
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== ELEMENT_NODE) continue;
        const element = node as DomElement;
        if (element.matches(CHAT_OR_COMPOSER) || element.querySelector(CHAT_OR_COMPOSER)) {
          dirtyAll = true;
          break;
        }
      }
    }
    if (!dirtyAll && !dirtyChats.size) return;
    if (passTimer) return;
    passTimer = setTimeout(() => {
      passTimer = 0;
      const all = dirtyAll;
      dirtyAll = false;
      if (all) {
        dirtyChats.clear();
        refreshAll();
      } else {
        const chats = [...dirtyChats];
        dirtyChats.clear();
        for (const chat of chats) if (chat.isConnected) refresh(chat);
      }
    }, 120);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Theme switches swap a class/style on <html>; re-read the chat background only then.
  const themeObserver = new MutationObserver(() => refreshAll(true));
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onAuxClick, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("mouseover", onOver, { capture: true, passive: true });
  document.addEventListener("mouseout", onOut, { capture: true, passive: true });
  document.addEventListener("scroll", hideTip, { capture: true, passive: true });
  refreshAll(true);

  return () => {
    observer.disconnect();
    themeObserver.disconnect();
    clearTimeout(passTimer);
    if (typingFrame) cancelAnimationFrame(typingFrame);
    hideTip();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("auxclick", onAuxClick, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("mouseout", onOut, true);
    document.removeEventListener("scroll", hideTip, true);
    for (const link of Array.from(document.querySelectorAll(`[${STATE}]`))) link.removeAttribute(STATE);
    tip.remove();
    style.remove();
  };
}
