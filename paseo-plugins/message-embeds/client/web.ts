import { Platform } from "react-native";

/** The DOM this module touches; the plugin's tsconfig has no DOM lib. */
interface PressTarget {
  closest?(selector: string): unknown;
}
interface StyleElement {
  textContent: string | null;
  remove(): void;
}
declare const document: {
  createElement(tag: "style"): StyleElement;
  head: { appendChild(node: StyleElement): void };
};

/** Web: whether a press landed on a link, so a link inside an agent card wins over the card. */
export function pressedLink(event: unknown): boolean {
  if (Platform.OS !== "web" || !event || typeof event !== "object" || !("target" in event)) return false;
  const target = event.target as PressTarget | null; // a DOM node on web
  return typeof target?.closest === "function" && !!target.closest("a[href]");
}

/**
 * Props for the View around an agent card's Markdown; on web they become
 * `data-message-embeds-agent-text`. The host Markdown takes no style, and it sets font size and
 * line height inline, so the card's smaller, tighter text comes from AGENT_TEXT_CSS.
 */
export const AGENT_TEXT = { dataSet: { messageEmbedsAgentText: "1" } };

// zoom keeps the reader's content size and the Markdown's own proportions (headings, code)
// while making the whole block smaller; line height and paragraph gaps then shrink a bit more.
const AGENT_TEXT_CSS = `
[data-message-embeds-agent-text] { zoom: 0.87; }
[data-message-embeds-agent-text] :is(p, li, span, a, code, strong, em, blockquote, h1, h2, h3, h4, h5, h6) { line-height: 1.32 !important; }
[data-message-embeds-agent-text] p { margin-bottom: 0.5em !important; }
`;

/** Adds the agent card text styles to the page. Returns the remover; a no-op off the web. */
export function installAgentTextStyles(): () => void {
  if (Platform.OS !== "web") return () => {};
  const style = document.createElement("style");
  style.textContent = AGENT_TEXT_CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
