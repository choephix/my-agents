import { type AgentLink, parseAgentLink } from "./agent-link";
import { clickedHref, onDocumentClick } from "./web";

/**
 * "Open Paseo tab links in place": a plain left click on an `app.paseo.sh` agent link opens that
 * tab here instead of in the browser. Paseo renders chat links as `target="_blank"` anchors with a
 * React click handler; the capture listener on the page runs before both and cancels the click.
 * Modified and middle clicks are not touched. Web and desktop only; a no-op on iOS and Android.
 * Returns stop(), which removes the listener.
 */
export function startLinkClicks(open: (link: AgentLink) => void): () => void {
  return onDocumentClick((event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const href = clickedHref(event);
    const link = href ? parseAgentLink(href) : null;
    if (!link) return;
    event.preventDefault();
    // Immediate: with the plugin on two hosts, only the first copy opens the tab.
    event.stopImmediatePropagation();
    open(link);
  });
}
