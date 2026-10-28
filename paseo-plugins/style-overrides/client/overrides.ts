// Stefan's personal CSS tweaks. One dated block per tweak; the injector never needs editing.
// How to add, revise or remove a tweak: see OVERVIEW.md.
export const overrides = `
/* ── Compact sidebar rows ─────────────────────────────────────────────────────────────────
   2026-10-19 — Stefan: "smaller gap between sidebar items, so I see more items and feel
   less boxed in, even if it's not the textbook design."
   Rows 36 → 28px, the height of the History/Search nav rows above them; group headers
   40 → 32px. Paseo's 2px gap between rows stays, so a hovered row never merges into the
   selected one. Font sizes, indentation, colors, icons and menus stay Paseo's own.
   min-height, not height: rows with PR/check details still grow to fit.
   Desktop layout only: below 720px (Paseo's md breakpoint) rows keep their 44px touch size. */
@media (min-width: 720px) {
  [data-testid^="sidebar-workspace-row-"],
  [data-testid^="sidebar-project-new-workspace-row-"],
  [data-testid^="sidebar-project-show-more-"],
  [data-testid^="sidebar-status-group-show-more-"],
  [data-testid="sidebar-pinned-show-more"] {
    min-height: 28px !important;
    padding-top: 4px !important;
    padding-bottom: 4px !important;
  }
  /* Project headers (Group by project) and status headers (Group by status). */
  [data-testid^="sidebar-project-row-"],
  [data-testid^="sidebar-status-group-"]:not([data-testid^="sidebar-status-group-rows-"]):not([data-testid^="sidebar-status-group-show-more-"]) {
    min-height: 32px !important;
    padding-top: 4px !important;
    padding-bottom: 4px !important;
    margin-bottom: 2px !important;
  }
}

/* ── Wrap long lines in the file pane ─────────────────────────────────────────────────────
   2026-10-19 — Stefan: "Can we turn on line wrapping for files viewed in Paseo panes?"
   Paseo's file pane is CodeMirror 6 and wraps only rendered-markdown files. These are the
   exact styles of CodeMirror's own .cm-lineWrapping class. CodeMirror reads the computed
   white-space of its content element to decide whether it wraps (view.lineWrapping, height
   estimates, cursor movement), so it treats this the same as its built-in wrapping.
   File pane only (data-testid="file-source-editor"); chat code blocks and diffs untouched.
   All widths. */
[data-testid="file-source-editor"] .cm-content {
  white-space: break-spaces !important;
  word-break: break-word !important;
  overflow-wrap: anywhere !important;
  flex-shrink: 1 !important;
}

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
