import { injectStyle } from "./style";

/* ── Compact sidebar rows ─────────────────────────────────────────────────────────────────
   2026-10-19 — Stefan: "smaller gap between sidebar items, so I see more items and feel
   less boxed in, even if it's not the textbook design."
   Rows 36 → 28px, the height of the History/Search nav rows above them; group headers
   40 → 32px. Paseo's 2px gap between rows stays, so a hovered row never merges into the
   selected one. Font sizes, indentation, colors, icons and menus stay Paseo's own.
   min-height, not height: rows with PR/check details still grow to fit.
   Desktop layout only: below 720px (Paseo's md breakpoint) rows keep their 44px touch size. */
export const css = `
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
`;

export function start(): () => void {
  return injectStyle("compact-sidebar", css);
}
