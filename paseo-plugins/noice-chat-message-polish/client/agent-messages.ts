import { Platform } from "react-native";

// Messages from other agents (Stefan's pick E from a local mock page). Web and desktop only.
//
// Paseo 0.13 draws a message another agent sent (`paseo agent send`) as a user bubble with a
// muted "Sent by <agent>" button above it, so it reads like Stefan's own message. Here the
// bubble takes the theme accent's tint and the "Sent by" button moves inside the bubble as an
// accent header. The button stays Paseo's own, so clicking it still opens the sender.
//
// Marker (0.13.0 components/message.tsx): the sender button is the first child of the
// user-message column, and the bubble follows it. A message without a sender has no button.
// Columns are marked with `data-ump-agent` instead of CSS `:has()`, avoiding page-wide style
// checks on every chat switch.

export interface AgentMessageStyler { setEnabled(on: boolean): void; dispose(): void }

const USER_MSG = '[data-testid="user-message"]';
const ASSISTANT_MSG = '[data-testid="assistant-message"]';
const ATTR = "data-ump-agent";

function syncColumn(column: Element) {
  const first = column.firstElementChild;
  const isAgent = first?.tagName === "BUTTON" && first.nextElementSibling?.tagName === "DIV";
  if (isAgent) {
    if (!column.hasAttribute(ATTR)) column.setAttribute(ATTR, "");
  } else if (column.hasAttribute(ATTR)) {
    column.removeAttribute(ATTR);
  }
}

function syncMessage(message: Element) {
  for (const child of message.children) if (child.tagName === "DIV") syncColumn(child);
}

export function startAgentMessageStyling(): AgentMessageStyler {
  if (Platform.OS !== "web" || typeof document === "undefined") return { setEnabled() {}, dispose() {} };
  const style = document.createElement("style");
  style.setAttribute("data-plugin", "noice-chat-message-polish-agents");
  style.textContent = CSS;
  let enabled = false;

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? (record.target as Element) : record.target.parentElement;
      if (!target) continue;
      const userMsg = target.closest(USER_MSG);
      if (userMsg) {
        syncMessage(userMsg);
        continue;
      }
      if (target.closest(ASSISTANT_MSG)) continue;
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as Element;
        if (element.getAttribute("data-testid") === "user-message") syncMessage(element);
        else for (const msg of element.querySelectorAll(USER_MSG)) syncMessage(msg);
      }
    }
  });

  const clearMarks = () => {
    for (const column of document.querySelectorAll(`[${ATTR}]`)) column.removeAttribute(ATTR);
  };

  const setEnabled = (on: boolean) => {
    if (on === enabled) return;
    enabled = on;
    if (on) {
      if (!style.isConnected) document.head.appendChild(style);
      for (const msg of document.querySelectorAll(USER_MSG)) syncMessage(msg);
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      observer.disconnect();
      clearMarks();
      style.remove();
    }
  };

  return {
    setEnabled,
    dispose() { setEnabled(false); },
  };
}

const COLUMN = `[${ATTR}]`;
const SENDER = `[${ATTR}] > button:first-child`;
const BUBBLE = `[${ATTR}] > button:first-child + div`;
const ACCENT = "var(--colors-accent-bright, currentColor)";
const CSS = `
${COLUMN} { display: grid !important; grid-template-columns: minmax(0, auto); justify-content: end;
  --ump-agent-tint: color-mix(in srgb, ${ACCENT} 14%, var(--colors-surface1, transparent)); }
${SENDER} { grid-area: 1 / 1; justify-self: start; align-self: start; z-index: 1; margin: 10px 16px 0 !important;
  padding: 0 !important; min-height: 0 !important; max-width: calc(100% - 32px); }
${SENDER} * { color: ${ACCENT} !important; stroke: ${ACCENT} !important; font-weight: 600; }
${BUBBLE} { grid-area: 1 / 1; padding-top: 36px !important; background-color: var(--ump-agent-tint) !important; }
${BUBBLE} stop { stop-color: var(--ump-agent-tint) !important; }
${BUBBLE} ~ * { grid-row: 2; justify-self: end; }
`;
