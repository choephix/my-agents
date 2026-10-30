import { Platform } from "react-native";

// Messages from other agents (Stefan's pick E from a local mock page). Web and desktop only.
//
// Paseo 0.13 draws a message another agent sent (`paseo agent send`) as a user bubble with a
// muted "Sent by <agent>" button above it, so it reads like Stefan's own message. Here the
// bubble takes the theme accent's tint and the "Sent by" button moves inside the bubble as an
// accent header. CSS only: the button stays Paseo's own, so clicking it still opens the sender.
//
// Marker (0.13.0 components/message.tsx): the sender button is the first child of the
// user-message column, and the bubble follows it. A message without a sender has no button.

export interface AgentMessageStyler { setEnabled(on: boolean): void; dispose(): void }

export function startAgentMessageStyling(): AgentMessageStyler {
  if (Platform.OS !== "web" || typeof document === "undefined") return { setEnabled() {}, dispose() {} };
  const style = document.createElement("style");
  style.setAttribute("data-plugin", "noice-chat-message-polish-agents");
  style.textContent = CSS;
  return {
    setEnabled(on) {
      if (on && !style.isConnected) document.head.appendChild(style);
      else if (!on) style.remove();
    },
    dispose() { style.remove(); },
  };
}

const COLUMN = '[data-testid="user-message"] > div:has(> button:first-child + div)';
const SENDER = '[data-testid="user-message"] > div > button:first-child:has(+ div)';
const BUBBLE = '[data-testid="user-message"] > div > button:first-child + div';
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
