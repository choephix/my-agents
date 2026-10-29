import { injectStyle } from "./style";

/* ── Wrap long lines in the file pane ─────────────────────────────────────────────────────
   2026-10-19 — Stefan: "Can we turn on line wrapping for files viewed in Paseo panes?"
   Paseo's file pane is CodeMirror 6 and wraps only rendered-markdown files. These are the
   exact styles of CodeMirror's own .cm-lineWrapping class. CodeMirror reads the computed
   white-space of its content element to decide whether it wraps (view.lineWrapping, height
   estimates, cursor movement), so it treats this the same as its built-in wrapping.
   File pane only (data-testid="file-source-editor"); chat code blocks and diffs untouched.
   All widths. */
export const css = `
[data-testid="file-source-editor"] .cm-content {
  white-space: break-spaces !important;
  word-break: break-word !important;
  overflow-wrap: anywhere !important;
  flex-shrink: 1 !important;
}
`;

export function start(): () => void {
  return injectStyle("file-wrap", css);
}
