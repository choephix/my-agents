import { injectStyle } from "./style";

/* ── Link colours by kind ─────────────────────────────────────────────────────────────────
   2026-10-28 — Stefan: "use a different color for the many different kinds of links,
   starting with agent versus file versus URL", without losing the theme accent. Settings
   picked in the link-colours playground (webshare, pages/link-colors-mocks):
   ?agent.hue=-70&agent.weight=500&file.hue=0&url.hue=70 (file stays monospace, the
   playground's default; hover underline, also its default).
   Colours derive from Paseo's link colour, --colors-accent-bright, so every theme and any
   accent keeps working: OKLCH hue turned −70° for agent links, +70° for web links, same
   lightness; a grey accent gets chroma 0.06 so the kinds still differ. File links keep the
   accent. Kinds by href: app.paseo.sh/h/…/agent/… = agent, other http(s) = web, any other
   href (Paseo's file links are paths) = file. Chat only; Paseo sets link colour inline. */
export const css = `
[data-testid="agent-chat-scroll"] a[href^="http://"],
[data-testid="agent-chat-scroll"] a[href^="https://"] {
  color: oklch(from var(--colors-accent-bright) l max(c, 0.06) calc(h + 70)) !important;
}
[data-testid="agent-chat-scroll"] a[href^="https://app.paseo.sh/h/"][href*="/agent/"] {
  color: oklch(from var(--colors-accent-bright) l max(c, 0.06) calc(h - 70)) !important;
  font-weight: 500 !important;
}
[data-testid="agent-chat-scroll"] a[href]:not([href^="http://"]):not([href^="https://"]):not([href^="mailto:"]) {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
}
[data-testid="agent-chat-scroll"] a[href]:hover {
  text-decoration-line: underline !important;
}
`;

export function start(): () => void {
  return injectStyle("link-colours", css);
}
