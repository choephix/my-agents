import { Platform } from "react-native";
import { type AgentLink, parseAgentLink } from "./links";

/** Only the DOM this module touches; the plugin's tsconfig has no DOM lib. */
interface LinkElement {
  getAttribute(name: string): string | null;
}
interface ClickTarget {
  closest?(selector: string): LinkElement | null;
}
interface Click {
  readonly target: ClickTarget | null;
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}
declare const document: {
  addEventListener(type: "click", listener: (event: Click) => void, capture: boolean): void;
  removeEventListener(type: "click", listener: (event: Click) => void, capture: boolean): void;
};

/**
 * Web and desktop: a plain left click on an `app.paseo.sh` agent link opens that chat tab here
 * instead of in the browser. Paseo renders chat links as `target="_blank"` anchors with a React
 * click handler; this capture listener on `document` runs before both and cancels the click.
 * Modified and middle clicks are not touched. Returns the remover; a no-op on iOS and Android,
 * where links behave as before.
 */
export function interceptAgentLinks(open: (link: AgentLink) => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const onClick = (event: Click) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const href = event.target?.closest?.("a[href]")?.getAttribute("href");
    const link = href ? parseAgentLink(href) : null;
    if (!link) return;
    event.preventDefault();
    // Immediate: with the plugin on two hosts, only the first copy opens the tab.
    event.stopImmediatePropagation();
    open(link);
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

/** Web: whether a press landed on a link (inside a preview, the link wins over the card). */
export function pressedLink(event: unknown): boolean {
  if (Platform.OS !== "web" || !event || typeof event !== "object" || !("target" in event)) return false;
  const target = event.target as ClickTarget | null; // a DOM node on web
  return typeof target?.closest === "function" && !!target.closest("a[href]");
}
