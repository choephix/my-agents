import { Platform } from "react-native";

// Slash commands (Stefan's pick from a local mock page). Web and desktop only.
//
// - A one-line message that starts with `/name` loses its bubble: just the command, muted,
//   in the code font, still right-aligned. Paseo's time/rewind/copy row under it is untouched.
// - OMP's own answer to a command (no model ran) becomes a muted code block without the
//   "Worked for" footer. Paseo gives those answers a made-up row id (`assistant_<time>_…`),
//   while a model reply carries the model's own message id (`msg_…`) from its first word
//   (seen live on 0.12.0). So: an `assistant_` row right after a `/` bubble is OMP's answer.
// - Paseo draws that answer as Markdown, which can lose its line breaks. The original text
//   arrives through a read-only timeline transformer (`rememberOutput`), which never changes
//   the item; the block shows it when the rendered text matches, else the rendered text.
// Copy and rewind read the message props, never this DOM, so both keep the original text.

const USER_TEXT = '[data-testid="user-message"] [data-message-text="true"]:not([data-ump-view])';
const ROW = "[data-history-row-id]";
const ANSWER_ROW = '[data-history-row-id^="assistant_"]';
const ANSWER = '[data-testid="assistant-message"]';
const COMMAND = /^\/([a-z][\w-]*)(?::[\w-]+)?(?:\s|$)/i;
/** Commands other plugins already draw their own way (noice-omp-slash-aliases; skill chips use `/skill:`). */
const SKIP: Record<string, true> = { tan: true, btw: true, omfg: true, queue: true, skill: true };
const OUTPUT_LIMIT = 200;

/** Original output text, keyed by its letters and digits only: Paseo's Markdown drops line breaks
 *  and list markers (`* bash` draws as a bullet), so only those survive in the rendered text. */
const outputs = new Map<string, string>();
const keyOf = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "");

/** Records a reply that carries no message id (OMP's own command output); called by the transformer. */
export function rememberOutput(text: string) {
  const key = keyOf(text);
  if (!key || outputs.has(key)) return;
  if (outputs.size >= OUTPUT_LIMIT) outputs.delete(outputs.keys().next().value!);
  outputs.set(key, text);
}

export interface CommandStyler { setEnabled(on: boolean): void; dispose(): void }

export function startCommandStyling(): CommandStyler {
  if (Platform.OS !== "web" || typeof document === "undefined") return { setEnabled() {}, dispose() {} };

  const style = document.createElement("style");
  style.setAttribute("data-plugin", "noice-chat-message-polish-commands");
  style.textContent = CSS;
  document.head.appendChild(style);

  let enabled = false;
  const bubbles = new Set<HTMLElement>();
  const answers = new Map<HTMLElement, { view: HTMLElement; source: HTMLElement; footer: HTMLElement | null; key: string; ariaHidden: string | null }>();
  const pending = new Set<HTMLElement>();
  let frame = 0;

  const isCommand = (text: string) => {
    const match = COMMAND.exec(text);
    return !!match && !SKIP[match[1]!.toLowerCase()];
  };

  const unmarkBubble = (bubble: HTMLElement) => {
    bubble.removeAttribute("data-ump-cmd");
    bubble.removeAttribute("data-pmono");
    bubble.parentElement?.removeAttribute("data-ump-cmd-line");
    bubbles.delete(bubble);
  };

  const styleBubble = (text: HTMLElement) => {
    const bubble = text.parentElement;
    if (!bubble) return;
    const raw = (text.textContent ?? "").trim();
    // Pictures or attached files keep the bubble: they need its frame.
    const onlyText = [...bubble.children].every((child) => child === text || child.hasAttribute("data-ump-view"));
    if (enabled && onlyText && !raw.includes("\n") && isCommand(raw)) {
      bubble.setAttribute("data-ump-cmd", "");
      bubble.setAttribute("data-pmono", "");
      // The time/rewind/copy row moves onto the command's line instead of a hidden row below it.
      bubble.parentElement?.setAttribute("data-ump-cmd-line", "");
      bubbles.add(bubble);
    } else if (bubbles.has(bubble)) unmarkBubble(bubble);
    // The answer row may have mounted first.
    const next = text.closest(ROW)?.nextElementSibling;
    if (next instanceof HTMLElement && next.matches(ANSWER_ROW)) schedule(next);
  };

  const restoreAnswer = (row: HTMLElement) => {
    const entry = answers.get(row);
    if (!entry) return;
    entry.view.remove();
    entry.footer?.removeAttribute("data-ump-cmd-hide");
    if (entry.ariaHidden === null) entry.source.removeAttribute("aria-hidden");
    else entry.source.setAttribute("aria-hidden", entry.ariaHidden);
    entry.source.removeAttribute("data-ump-cmd-src");
    row.removeAttribute("data-ump-cmd-out");
    answers.delete(row);
  };

  /** The turn footer ("Worked for", copy, fork): the ancestor of the fork trigger beside the answer. */
  const footerOf = (row: HTMLElement, source: HTMLElement): HTMLElement | null => {
    let node = row.querySelector<HTMLElement>('[data-testid="assistant-fork-menu-trigger"]');
    while (node && node.parentElement && node.parentElement !== row && !node.parentElement.contains(source)) node = node.parentElement;
    return node && !node.contains(source) ? node : null;
  };

  const styleAnswer = (row: HTMLElement) => {
    const source = row.querySelector<HTMLElement>(ANSWER);
    const previous = row.previousElementSibling?.querySelector(USER_TEXT);
    const asked = (previous?.textContent ?? "").trim();
    if (!enabled || !source || !row.isConnected || !asked.startsWith("/")) return restoreAnswer(row);
    const key = keyOf(source.textContent ?? "");
    const entry = answers.get(row);
    if (entry && entry.source === source && entry.view.isConnected && entry.key === key) {
      // The turn footer mounts after the answer.
      if (!entry.footer) {
        entry.footer = footerOf(row, source);
        entry.footer?.setAttribute("data-ump-cmd-hide", "");
      }
      return;
    }
    if (entry) restoreAnswer(row);
    // Unknown original (e.g. drawn before this page loaded the plugin): Paseo's rendered text.
    const text = outputs.get(key) ?? source.innerText.trim();
    // The answer's text colour, so the block follows every theme.
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    const colour = walker.nextNode()?.parentElement ? getComputedStyle(walker.currentNode.parentElement!).color : "";
    const view = document.createElement("div");
    view.className = "ump-cmd-out";
    view.setAttribute("data-pmono", "");
    view.setAttribute("data-message-text", "true");
    if (colour) view.style.color = colour;
    view.textContent = text;
    source.after(view);
    const footer = footerOf(row, source);
    footer?.setAttribute("data-ump-cmd-hide", "");
    answers.set(row, { view, source, footer, key, ariaHidden: source.getAttribute("aria-hidden") });
    source.setAttribute("data-ump-cmd-src", "");
    source.setAttribute("aria-hidden", "true");
    row.setAttribute("data-ump-cmd-out", "");
  };

  const flush = () => {
    frame = 0;
    for (const node of pending) {
      if (node.matches(ANSWER_ROW)) styleAnswer(node);
      else styleBubble(node);
    }
    pending.clear();
  };
  function schedule(node: HTMLElement) {
    pending.add(node);
    if (!frame) frame = requestAnimationFrame(flush);
  }
  const sweep = () => {
    for (const text of document.querySelectorAll<HTMLElement>(USER_TEXT)) schedule(text);
    for (const row of document.querySelectorAll<HTMLElement>(ANSWER_ROW)) schedule(row);
  };

  const observer = new MutationObserver((records) => {
    let removed = false;
    for (const record of records) {
      if (record.removedNodes.length) removed = true;
      const target = record.target as HTMLElement;
      // A re-render inside a styled answer row (its text or our block replaced): check it again.
      const row = target.closest?.(ANSWER_ROW);
      if (row instanceof HTMLElement && !target.classList.contains("ump-cmd-out")) schedule(row);
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as HTMLElement;
        if (element.classList.contains("ump-cmd-out")) continue;
        if (element.matches(USER_TEXT) || element.matches(ANSWER_ROW)) schedule(element);
        for (const inner of element.querySelectorAll<HTMLElement>(`${USER_TEXT}, ${ANSWER_ROW}`)) schedule(inner);
      }
    }
    if (removed) {
      for (const bubble of [...bubbles]) if (!bubble.isConnected) bubbles.delete(bubble);
      for (const row of [...answers.keys()]) if (!row.isConnected) answers.delete(row);
    }
  });

  return {
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (on) {
        observer.observe(document.body, { childList: true, subtree: true });
        sweep();
        return;
      }
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame), frame = 0;
      pending.clear();
      for (const bubble of [...bubbles]) unmarkBubble(bubble);
      for (const row of [...answers.keys()]) restoreAnswer(row);
    },
    dispose() {
      this.setEnabled(false);
      style.remove();
    },
  };
}

const MIX = (percent: number) => `color-mix(in srgb, currentColor ${percent}%, transparent)`;
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const CSS = `
[data-ump-cmd] { background: transparent !important; padding: 2px 4px !important; }
[data-ump-cmd] > [data-message-text] { font-family: ${MONO} !important; font-size: 13.5px !important; opacity: 0.62; }
[data-ump-cmd-line] { flex-direction: row-reverse !important; align-items: center !important; gap: 10px; }
[data-ump-cmd-line] > [data-testid="user-message-trailing-row"] { margin-top: 0 !important; }
[data-ump-cmd-src], [data-ump-cmd-hide] { display: none !important; }
.ump-cmd-out { margin: 4px 0 20px; padding: 10px 12px; border: 1px solid ${MIX(10)}; border-radius: 8px; background: ${MIX(3)};
  font-family: ${MONO}; font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; opacity: 0.75; user-select: text;
  max-height: 320px; overflow: auto; }
`;
