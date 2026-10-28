# Paseo mock base

A static copy of Paseo's normal screen plus a small engine for flipping
design variants. Every Paseo plugin mockup, and every screenshot of a plugin,
starts here. Live at `<webshare-origin>/pages/paseo-base/` (origin in
`~/.config/my-agents/local.md`; `demo/` shows every feature; search it for
`DEMO:`).

## Pace: link first

Stefan reviews on his own screen, and fast. After every edit, send him the
link, with the hash for the exact view (`…/#chat/B?vp=phone`). The page
updates on reload, so the link is the result. Screenshots, PNG exports,
visual checks and follow-up fixes run in a subagent while you keep talking
with him.

## Deceptive simplicity

Clear and dense, not busy. Content first; secondary chrome muted, small, or
behind hover and pop-outs; nothing visible unless relevant, orienting
information never stripped. Nothing repeated, nothing lost: a focused
representation by importance and context, each fact in one home at the
level it earns (glance, hover, click; phones tap where desktop hovers).
A screen that is even a little bit confusing didn't get simpler.

## Build a mock

1. **Copy the starter:**
   `cp -r ~/workspace/my-agents/paseo-mock-base/starter ~/www/webshare/pages/<plugin>-mocks`.
   Done when `<webshare-origin>/pages/<plugin>-mocks/` shows the Paseo screen.
   A plugin settings screen starts from `starter-settings/` instead: Paseo's
   settings page with a plugin screen built from every primitive plugins get.
2. **Add the design as a delta.** Keep one copy of the screen. Add the new UI
   and tag every element that differs between options with `data-variant`.
   Name the options on the section with `data-variants`. Done when flipping
   ← → changes only the parts under decision.
3. **Add the situations the design must survive:** app states (`data-states`,
   `data-when`), phone-only markup (`data-viewport`). Delete starter states
   the design never touches. Done when every state the design reacts to has a
   value in the bottom bar.
4. **Send the link.**

## The bars

- **Top (amber): design.** The options being decided. The first bar holds the
  sections and looks the same on every section. The current section's variants
  sit in a second bar below it; on a section without variants its slot stays
  empty, so nothing moves. Knobs that fine-tune the chosen design (a fade
  strength, a callout style, a mark's width) are design too: a mock adds them
  with `MockKit.addDesignControl(node)` and they sit in a third top bar. Their
  values go in the hash (`MockKit.set({ knobs: { ...MockKit.state.knobs, key:
  value } })`, read back from `MockKit.state.knobs`), so a link shows exactly
  what its sender saw. Never put them in the bottom bar or in localStorage.
- **Bottom (violet): situation.** Where the chosen option is seen: theme,
  viewport, app state. It belongs to the workbench, like the canvas. Its
  `Aa` button holds Paseo's appearance settings (fonts, sizes, content
  width), remembered across every mock in this browser.

A situation never changes the design, and a variant never changes the
situation. The bars build themselves from the tags below. A bar with nothing
to offer stays hidden.

Nothing in the dev UI may shift when a choice changes; Stefan treats layout
shifts as bugs. A control that exists only after another choice goes in a
bar of its own below, never beside the choice. The important choices
(sections and variants) are rows of buttons; every other option list
(situations, kit controls, anything else) is a cycle button (fixed width, ‹ ›).

## Data: Acme or live

Stefan wants both equally. Real data shows which shapes actually occur
(lengths, counts, statuses) and lets a reviewer catch false claims; Acme data
is fictional and safe to publish. Every mock carries both, and `Acme data ↔
Live data` in the bottom bar (key `d`) flips between them. It's a situation,
not a design choice. PNG export always renders Acme.

- **Acme is the base.** `kit/acme.json` is the fictional world (projects,
  workspaces, statuses, tabs, host). Keep its names; extend it rather than
  rewrite it. No real project, session, host or plugin name of Stefan's
  ever goes into Acme, the kit, or anything pushed to GitHub.
- **Live starts from Acme and swaps pieces in** by fixed rules, never by
  hand: `node tools/mock-data.mjs <mock folder>` writes `data.acme.json` and
  `data.live.json` there (gitignored in this repo). It reads `~/.paseo` files
  only, so no agent is touched. Acme stays wherever real data is thin or too
  revealing, chat text included.
- **Plugin content follows the same pattern.** Content Paseo can't supply
  (efforts, presets, …) is written once in the mock's `data.mjs`: an `acme`
  object plus a `live()` rule for where the real version comes from. The
  script produces both sets; nothing is written twice.
- **Only data-bearing parts render from data:** sidebar rows, tabs, header,
  host, plugin content. Everything else stays plain HTML. Bind with the data
  tags below.
- The mock opens on whichever set its agent was asked for:
  `data-default-data="live"` on `<html>`; Acme otherwise.

## Base and notes

Two toggles in the top-right corner, each flipped in place:

- **Base** (`b`, off by default): plain Paseo, without the mock's changes, for
  comparing by eye. It hides variant-only elements, `data-mod`, and anything
  inside a slot, and drops the `data-v` attributes, so variant CSS stops
  applying. No "current Paseo" variant needed.
- **Notes** (`n`): numbered markers on what the design changes, and a column
  beside the screen, never over it: what, how, why.

A rework that drops or moves information gets a **Nothing lost** section: a
table of every fact the previous version showed and where it lives now
(glance, hover, click).


## Copying to the clipboard

`navigator.clipboard` only exists in a secure context (https or
`localhost`). Stefan opens mocks over plain http by hostname and port, so
there it is undefined and a "Copy" button that calls it silently does
nothing. Use `MockKit.copyText(text)`: it tries the clipboard API, falls back
to `document.execCommand("copy")`, and resolves `false` when both fail. On
`false`, show the text selected in a read-only box so it can be copied by
hand. Better still, prefer state in the link (knobs, picks) over anything
that needs copying.

## Screenshots

Every plugin screenshot is a PNG export of a mock (Stefan, 2026-10-25): images
posted in chat, embedded in docs, or used in a plugin's store listing.
`node tools/export.mjs <mock-url> [out-dir] --vp=desktop,phone` renders Acme
only. Live data is for Stefan's own screen; it never goes into an image.
Nobody screenshots Stefan's real Paseo. An agent checking that a plugin really
works does it on a test daemon with made-up projects; those captures are its
own evidence and stay local.


## Tags

| Tag | On | Effect |
|---|---|---|
| `data-section="id" data-title="Label"` | a top-level screen | One top-bar button per section. Without sections, the body is one screen. |
| `<template data-each="workspaces" data-limit="6">` | inside a screen | One copy of its content per item, placed after it. Inside, paths resolve on the item; `$.x` reaches the data root. Derived lists: `statusGroups`, `projectGroups`, `drawer.*`, `activeWorkspace` (see `kit/data.js`). |
| `data-text="title"`, `data-attrs="style=projStyle; data-status=badge"`, `data-class="is-selected=selected"`, `data-if="active"` | any element | Text, attributes (removed when empty), class toggles, and hide-when-empty from the current data set. `MockKit.data()` returns it for scripts. |
| `data-variants="A: Label — note \| B: Label"` | the section | Variants, in order, as a row of buttons in the second top bar. `— note` is a caption under the bars; use it for facts that sway the choice ("phones can't show this"). `data-variants-as="cycle"` on the section shows them as a cycle button instead. |
| `data-variant="B C"` | any element | Exists only in those variants. |
| `data-mod` / `data-base` | any element | Exists only with the design / only in Base (what the design replaces). Variant-only elements and slot contents count as `data-mod` already. |
| `data-note="2"` | any element | Numbered marker on it while Notes is on. |
| `<aside data-notes>` with `<p data-note-for="2">` | inside a section | That section's notes column, beside the frame. A note dims while its marker is off screen; `data-variant` works on notes too. |
| `data-viewport="phone"` | any element | Exists only in `desktop`, `laptop`, `phone`, or `wide` (desktop + laptop). |
| `data-states="session: normal \| empty \| crashed; …"` | `<html>` or a section | App-state axes; first value is the default. The button reads "normal session"; custom wording: `open=Files open`. |
| `data-when="session: empty crashed"` | any element | Exists only in those states; `;` joins axes. An axis button hides while none of its elements can appear. |
| `data-cycle="Off \| 30 min \| 1 h"` | a button | Kit cycle button: left third steps back, the rest forward; fixed width. `data-cycle-chevrons` adds ‹ ›. Fires `cycle` `{ value, index }`. |
| `data-scroll="bottom"` | a scroll area | Starts scrolled to the end, like a chat. |
| `data-toggle="panel"`, `data-set="drawer: closed"` | a mock control | Click steps that app-state axis, or sets axes (`;` joins). The mock's buttons and the bottom bar share one state, so they never disagree. |
| `data-pick="tabs"` | each item of a group | Click moves the highlight (`is-active`/`is-selected`) within the group. Content stays the same. |
| `data-editable` | a text area | Typable; Enter does nothing. |
| `data-slot="sidebar-header"` | already in the starter | Where real Paseo shows plugin UI: `sidebar-header` (rows under Schedules), `sidebar-footer` (rows above the footer icons, with separator), `composer-pills`, `explorer-tabs`. Put the plugin's markup inside; an empty slot takes no space. Add new slots to the starter, never ad hoc. |
| `<i data-icon="name" data-size="14">` | anywhere | Lucide icon, Paseo's set. Non-Lucide: `kit/icons-extra.js` (`provider-omp`). |
| `data-themes`, `data-viewports` | `<html>` | Override the lists (default `dark pureBlack light`, `desktop laptop phone`). |

The frame mirrors the situation as attributes, so variant styling is plain
CSS: `[data-v="B"] .composer`, `[data-vp="phone"]`, `[data-theme="light"]`,
`[data-state-session="empty"]`.

Each section keeps its own pick: switching sections returns to that
section's last variant, and the hash carries the others (`picks=bubble.F`).
The frame also holds every section's pick as `data-v-<section>`. When one
screen is split into several decisions, style each part by its own section
(`[data-v-bubble="F"] .msg-user`), and every section then shows all the
choices together.

Keys: ← → variant, ↑ ↓ section, `t` theme, `v` viewport, `d` data, `b` base,
`n` notes. The hash holds the
whole view. Behaviour, only if a design needs it: `MockKit.set({...})`,
`MockKit.onChange(fn)`, `MockKit.addDesignControl(node)` with
`MockKit.state.knobs`, `mockready` event.

## Styling

- Colours, sizes, spacing and radii come from `kit/tokens.css` variables
  (`--c-surface1`, `--c-foreground-muted`, `--fs-content`, `--r-lg`), generated
  from Paseo's theme, so every theme stays right.
- Paseo pieces are classes in `kit/paseo.css`; the starter shows how they nest.
- Mock-only CSS goes in the mock's own `<style>`.

## Changing the kit itself

Fixing Paseo's look, adding a missing piece, or refreshing after a Paseo
update: read `MAINTAINING.md` first.
