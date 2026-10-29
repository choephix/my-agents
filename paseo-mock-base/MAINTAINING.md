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
  must work in both; design controls stay amber and above the violet
  situation controls. Design state goes in the hash, never in localStorage.
  Switching layouts, sections or references must not move anything inside a
  frame. Words: `GLOSSARY.md`.
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
