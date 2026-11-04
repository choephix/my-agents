# Maintaining the Paseo mock base

Mocks link `kit/` live, so every change here reaches every mock on reload.

- **Additive only.** Add classes, variables and tags; keep existing names
  working. Old mocks depend on them.
- **Fixes land in the base.** A look error or missing piece found while
  building a mock goes into `kit/paseo.css` (plus the starter, if it's
  markup), not into the mock.
- **A capability a mock had to hand-roll goes into the kit.** When a mock
  skips the shell or rebuilds part of it, find the generic capability it
  was missing and add that, usable by a mock about any other part of Paseo.
- **The shell (`kit/dev.js`, `kit/dev.css`) has two layouts for one set of
  controls**, shell bars and shell sidebar. A new control is built once and
  must work in both. Words: `GLOSSARY.md`.
- **Three groups, never mixed.** Design (amber) is what is decided and acts
  on the selected frame only: sections, variants, presets, knobs, Copy
  values. Situation (violet) is where it is seen, shared by every frame:
  theme, viewport, region, scale, data, app state. View (neutral: the view
  bar in the top-right corner, and the frame titles) is how you are looking:
  Notes, shell layout, which frames exist, which is selected, side by side
  or tabbed; plus the Base toggle (the selected frame as plain Paseo). A new
  control goes in exactly one group; design stays above situation.
- **Every frame is equal.** Each holds its own design; nothing special-cases
  "the first" or "the last" frame except that frame 1 is the page's own
  markup. A removed frame leaves the DOM. Every frame's design, the
  selection and the layout go in the hash, never in localStorage.
- **Nothing inside a frame moves** when switching shell layouts, sections,
  or the selected frame, nor when flipping tabs (tabbed frames share one
  box).
- **Nothing runs continuously in the shell.** No timers, observers or
  animation loops; the shell reacts to input, `resize` and `hashchange`.
- **The backdrop lives in `kit/backdrop.css`**, so a page that skips the
  shell can still have it. Keep it free of anything else.
- **Source of truth for measurements:** real Paseo.
  The mock base notes folder (path in `~/.config/my-agents/local.md`) holds
  `layout-spec.md` and `ref/` with measured values and screenshots. For a new piece, measure it on
  a test daemon (never Stefan's live one on :6767).
- **After a Paseo update:** `node tools/gen-tokens.mjs && node tools/gen-icons.mjs`
  (both read `sourceCheckout` in `~/.config/my-agents/paseo.json`), then have a subagent export
  `demo/` with `tools/export.mjs` and compare it against the real app.
- `npm install` once here, for `tools/export.mjs` (Playwright).

The pace rule from `README.md` applies here too: link first, checks in the
background.
