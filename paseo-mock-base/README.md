# Paseo mock base

A static copy of Paseo's normal screen plus a small engine for flipping
design variants. Every Paseo plugin mockup, and every screenshot of a plugin,
starts here. Live at `<webshare-origin>/pages/paseo-base/` (origin in
`~/.config/my-agents/local.md`; `demo/` shows the tags, `demo/tab-dots/` a
fine-tuning workshop with knobs, presets and a reference frame; search both
for `DEMO:`). Words like shell, frame, region and reference mean one thing
each: `GLOSSARY.md`.

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
   value in the situation controls.
4. **Fine-tuning a look?** Declare knobs and presets (below), one of them the
   shipped look, and show it in a reference frame. A small subject gets its
   region at 1:1 (`data-regions`, `data-scales="1 2 3"`).
5. **Send the link.**

## The shell

Everything outside the frames: the design controls, the situation controls
and the dotted backdrop. Two layouts for the same controls; `s` or the
`Sidebar` button switches, `data-shell="sidebar"` on `<html>` picks the
default, and the hash keeps the choice (`?shell=bars`).

- **Shell bars:** design bars at the top, the situation bar at the bottom.
  Knob groups open as panels from their buttons. Right for a few choices.
- **Shell sidebar:** one panel on the right, design above situation, every
  knob visible. Right for a workshop with many knobs; switch to it whenever
  the controls get bulky.

The two groups, in either layout:

- **Design (amber).** What is being decided: sections, variants, what sits
  beside the candidate, presets, knobs, Copy values. In the bars, sections
  fill the first bar and look the same on every section; the current
  section's variants sit in a second bar (its slot stays empty on a section
  without variants, so nothing moves); the rest sits in a third.
- **Situation (violet).** Where the design is seen: theme, viewport, region,
  scale, data, app state. Its `Aa` button holds Paseo's appearance settings
  (fonts, sizes, content width), remembered across every mock in this browser.

A situation never changes the design, and a design control never changes the
situation. The controls build themselves from the tags and `MockDesign`
below; a group with nothing to offer stays hidden. Design state (variant,
knobs, references) lives in the hash, so a link shows exactly what its
sender saw; never in localStorage.

Nothing in the shell may shift when a choice changes; Stefan treats layout
shifts as bugs. Switching between bars and sidebar moves the frames as a
whole but never changes anything inside them. A control that exists only
after another choice goes in a bar of its own below, never beside the
choice. The important choices (sections and variants) are rows of buttons;
every other option list (situations, kit controls) is a cycle button
(fixed width, ‹ ›).

## Frames: region, scale, references

Every frame shows the same situation; each has its own design.

- **Region.** `data-region="sidebar"` (label: `data-region-label`) on any
  part of the screen lets a frame show just that part, cut out of the full
  layout at its real size. The starter tags `sidebar`, `main`, `composer`,
  `panel` and `drawer`; `Whole screen` is always offered first. Limit the
  choice, in order, with `data-regions="sidebar screen"` on `<html>`. Key `r`.
- **Scale.** `fit` shrinks the frames into the window; `1`, `2`, `3` are
  true size and crisp whole-number magnification, and the stage scrolls
  instead of shrinking. `data-scales="1 2 3"` on `<html>` (default
  `fit 1 2 3`). Judge anything 1–2 px wide at `1` and `2`, never at `fit`.
  Key `z`.
- **References.** A reference frame shows Base, a preset or a variant to
  the left of the candidate, which stays next to the controls. The design
  control "Beside: …" (key `c`) picks it; `data-reference` on `<html>` offers
  it (`data-reference="today"` also opens with that preset beside). Presets
  offer it on their own. Each frame is labelled with its design.

Scripts that draw into the mock must draw into every frame, from that
frame's own design: `MockKit.onFrame((f) => …)` runs for each frame now and
after every change, with `f.el` (the `.mock-frame`), `f.role`
(`reference`/`candidate`), `f.label`, `f.base`, `f.variant`, `f.picks` and
`f.knobs`. The situation is shared: `MockKit.state`. A script that only
reads `document.querySelector(".mock-frame")` reaches the candidate.

## Knobs and presets

Knobs fine-tune the chosen design (a size, a fade, a colour, a mode).
Declare them in a plain `<script>` before the kit boots:

```js
window.MockDesign = {
  knobs: [
    { heading: "Read dots" },                              // a group
    { key: "size", label: "Size", type: "range", min: 1, max: 6, step: 0.25,
      unit: "px", value: 5, css: "--dot-size", hint: "Diameter" },
    { key: "max", label: "Max dots", type: "number", min: 1, max: 20, value: 5 },
    { key: "tint", label: "Colour", options: { shade: "Shaded", custom: "Custom" } },
    { key: "color", type: "color", value: "#8a8a96", enabled: (k) => k.tint === "custom" },
    { key: "pulse", label: "Pulse", type: "toggle", value: true },
  ],
  presets: [
    { id: "today", label: "Today", note: "The shipped look", knobs: { size: 5, max: 5 } },
    { id: "tiny", label: "Tiny", knobs: { size: 1.5 }, variant: "B" },
  ],
};
```

- **Types:** `range` (slider + number), `number`, `choice` (segmented;
  `options` as an object or `[value, label]` pairs), `color`, `toggle`. The
  type is inferred when omitted. `{ heading }` starts a group.
- **Values** go in the hash (`knobs=size:2,tint:custom`, only those off their
  default) and onto every frame: `data-knob-<key>` for selectors, and the
  custom property named by `css` (with its CSS unit), so one stylesheet draws
  each frame's own design. `enabled(knobs)` greys a knob out when it doesn't
  apply.
- **Presets** are named bundles of knob values (and optionally a variant or
  picks). A preset sets only the knobs it lists. Clicking one loads it; the
  matching preset lights up, otherwise the candidate is "Own values". Make
  one preset reproduce what ships today, so the reference frame can show it.
- **Copy values** puts the design (variant, matching preset, every knob) as
  JSON, plus the knobs' CSS custom properties, on the clipboard, and always
  shows the same text, selectable, since plain http blocks the clipboard.

Still raw: `MockKit.addDesignControl(node)` adds a hand-built control to the
design group, with values in `MockKit.state.knobs` via `MockKit.set({ knobs:
{ ...MockKit.state.knobs, key: value } })`. Prefer declared knobs.

## Skipping part of the template

A mock that doesn't load `kit/dev.js`, hides the shell, or rebuilds a
feature by hand must say what it loses, in its header comment and in your
message to Stefan ("no Base toggle, no hash state, no theme switch"). The
dotted backdrop survives anyway: link `kit/backdrop.css` and put
`class="kit-backdrop"` on `<body>`. Prefer adding the missing capability to
the kit (`MAINTAINING.md`) over skipping it.

## Older mocks

A mock built before declared knobs (hand-rolled sliders, own copy button,
own side panel) moves to `MockDesign.knobs` / presets / shell sidebar the
next time it is worked on, in the same change. Not before.

## Data: Acme or live

Stefan wants both equally. Real data shows which shapes actually occur
(lengths, counts, statuses) and lets a reviewer catch false claims; Acme data
is fictional and safe to publish. Every mock carries both, and `Acme data ↔
Live data` in the situation controls (key `d`) flips between them. It's a situation,
not a design choice. PNG export always renders Acme.

- **Acme is the base.** `kit/acme.json` is the fictional world (projects,
  workspaces, statuses, tabs, host). Keep its names; extend it rather than
  rewrite it. No real project, session, host or plugin name of Stefan's
  ever goes into Acme, the kit, or anything pushed to GitHub.
- **Live starts from Acme and swaps pieces in** by fixed rules, never by
  hand: `node tools/mock-data.mjs <mock folder>` writes `data.acme.json` and
  `data.live.json` there (gitignored in this repo); `data-mock-data` on
  `<html>` tells the kit to load them. Without it the mock uses
  `kit/acme.json` and has no live set. It reads `~/.paseo` files
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
  applying. No "current Paseo" variant needed. To see Base and the design
  side by side, put Base in a reference frame instead ("Beside: Base", `c`).
- **Notes** (`n`): numbered markers on what the design changes, and a column
  beside the screen, never over it: what, how, why. Leave them out until the
  design gets busy, convoluted or easy to miss.

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
only; a region in the URL's hash (`#chat?region=sidebar`) exports just that
region. Live data is for Stefan's own screen; it never goes into an image.
Nobody screenshots Stefan's real Paseo. An agent checking that a plugin really
works does it on a test daemon with made-up projects; those captures are its
own evidence and stay local.


## Tags

| Tag | On | Effect |
|---|---|---|
| `data-section="id" data-title="Label"` | a top-level screen | One section button in the design controls. Without sections, the body is one screen. |
| `<template data-each="workspaces" data-limit="6">` | inside a screen | One copy of its content per item, placed after it. Inside, paths resolve on the item; `$.x` reaches the data root. Derived lists: `statusGroups`, `projectGroups`, `drawer.*`, `activeWorkspace` (see `kit/data.js`). |
| `data-text="title"`, `data-attrs="style=projStyle; data-status=badge"`, `data-class="is-selected=selected"`, `data-if="active"` | any element | Text, attributes (removed when empty), class toggles, and hide-when-empty from the current data set. `MockKit.data()` returns it for scripts. |
| `data-variants="A: Label — note \| B: Label"` | the section | Variants, in order, as a row of buttons in the design controls (the second top bar). `— note` is a caption under them; use it for facts that sway the choice ("phones can't show this"). `data-variants-as="cycle"` on the section shows them as a cycle button instead. |
| `data-variant="B C"` | any element | Exists only in those variants. |
| `data-mod` / `data-base` | any element | Exists only with the design / only in Base (what the design replaces). Variant-only elements and slot contents count as `data-mod` already. |
| `data-note="2"` | any element | Numbered marker on it while Notes is on. |
| `<aside data-notes>` with `<p data-note-for="2">` | inside a section | That section's notes column, beside the frame. A note dims while its marker is off screen; `data-variant` works on notes too. |
| `data-viewport="phone"` | any element | Exists only in `desktop`, `laptop`, `phone`, or `wide` (desktop + laptop). |
| `data-states="session: normal \| empty \| crashed; …"` | `<html>` or a section | App-state axes; first value is the default. The button reads "normal session"; custom wording: `open=Files open`. |
| `data-when="session: empty crashed"` | any element | Exists only in those states; `;` joins axes. An axis button hides while none of its elements can appear. |
| `data-cycle="Off \| 30 min \| 1 h"` | a button | Kit cycle button: left third steps back, the rest forward; fixed width. `data-cycle-chevrons` adds ‹ ›. Fires `cycle` `{ value, index }`. |
| `data-scroll="bottom"` | a scroll area | Starts scrolled to the end, like a chat. |
| `data-toggle="panel"`, `data-set="drawer: closed"` | a mock control | Click steps that app-state axis, or sets axes (`;` joins). The mock's buttons and the situation controls share one state, so they never disagree. |
| `data-pick="tabs"` | each item of a group | Click moves the highlight (`is-active`/`is-selected`) within the group. Content stays the same. |
| `data-editable` | a text area | Typable; Enter does nothing. |
| `data-slot="sidebar-header"` | already in the starter | Where real Paseo shows plugin UI: `sidebar-header` (rows under Schedules), `sidebar-footer` (rows above the footer icons, with separator), `composer-pills`, `explorer-tabs`. Put the plugin's markup inside; an empty slot takes no space. Add new slots to the starter, never ad hoc. |
| `<i data-icon="name" data-size="14">` | anywhere | Lucide icon, Paseo's set. Non-Lucide: `kit/icons-extra.js` (`provider-omp`). |
| `data-themes`, `data-viewports` | `<html>` | Override the lists (default `dark pureBlack light`, `desktop laptop phone`). |
| `data-region="sidebar" data-region-label="Sidebar"` | any part of the screen | A region a frame can show alone, at its real size. The label defaults to the capitalised name. |
| `data-regions="sidebar screen"`, `data-scales="1 2 3"` | `<html>` | Override the region and scale lists, first is the default (defaults: every tagged region after `screen`; `fit 1 2 3`). |
| `data-shell="sidebar"` | `<html>` | Open with the shell sidebar instead of the shell bars. |
| `data-reference` / `data-reference="today"` | `<html>` | Offer reference frames (presets offer them anyway); with a value, open with that preset, variant or `base` beside the candidate. |
| `data-mock-data` | `<html>` | Load the mock's own `data.acme.json` and `data.live.json` (written by `tools/mock-data.mjs`). Without it: `kit/acme.json`, no live set, no fetch. |

The frame mirrors the situation and its own design as attributes, so
variant styling is plain CSS: `[data-v="B"] .composer`, `[data-vp="phone"]`,
`[data-theme="light"]`, `[data-state-session="empty"]`, `[data-knob-tint="custom"]`,
`[data-frame="reference"]`.

Each section keeps its own pick: switching sections returns to that
section's last variant, and the hash carries the others (`picks=bubble.F`).
The frame also holds every section's pick as `data-v-<section>`. When one
screen is split into several decisions, style each part by its own section
(`[data-v-bubble="F"] .msg-user`), and every section then shows all the
choices together.

Keys: ← → variant, ↑ ↓ section, `t` theme, `v` viewport, `r` region, `z`
scale, `d` data, `b` base, `n` notes, `c` what sits beside the candidate,
`s` shell bars ↔ sidebar; Shift steps back. The hash holds the whole view.
Behaviour, only if a design needs it: `MockKit.set({...})`,
`MockKit.onChange(fn)`, `MockKit.onFrame(fn)`, `MockKit.frames`,
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
