# Tweaks (`noice-tweaks`)

Stefan's own visual tweaks to Paseo in one plugin instead of spread across Paseo or several
plugins (formerly `style-overrides`, renamed and given switches 2026-10-29). Web and desktop apps
only.

## Switches

**Settings → Plugins → Tweaks → Tweaks** (or Command Center ⌘K / Ctrl+K → "Configure tweaks"),
one switch per tweak, all on by default. Saved on the host (`~/.paseo/plugin-settings/noice-tweaks/tweaks.json`).

| Setting id | Label |
| --- | --- |
| `compactSidebar` | Compact sidebar rows |
| `fileWrap` | Wrap long lines in the file pane |
| `linkColours` | Link colours by kind |

A tweak that is off is never started: no `<style>`, no hook, no timer. Turning a switch off removes
its `<style data-plugin="noice-tweaks-<name>">` at once; turning it on adds it back; other open
windows follow when the daemon announces the save. Each start and stop is fenced, so one tweak
failing never stops the others. The browser remembers the switches last applied
(`localStorage` `paseo-plugin:noice-tweaks:switches`), so a page load styles the sidebar before
the daemon's settings arrive instead of jumping; the daemon's values win once read.

## Current tweaks

**Compact sidebar rows** (2026-10-19). Workspace, "New workspace" and "Show more" rows go from
36px to 28px, the same height as the History/Search rows at the top of the sidebar. Project
headers (group by project) and status headers (group by status) go from 40px and 36px to 32px.
Paseo's 2px gap between rows stays, so a hovered row stays separate from the selected one. Text
size, indentation, icons, colors and menus are Paseo's own. Rows with PR/check details still grow
to fit (44px instead of 52px). Below 720px wide (Paseo's phone/narrow layout) nothing changes and
rows keep their 44px touch size.

| Before | After | Group by status | Collapsed project |
| --- | --- | --- | --- |
| ![](screenshots/sidebar-before.webp) | ![](screenshots/sidebar-after.webp) | ![](screenshots/sidebar-status-grouping.webp) | ![](screenshots/sidebar-collapsed.webp) |

`sidebar-hover-selected.webp`: a hovered row (kebab menu showing) under the selected one.
`sidebar-row-menu.webp`: the workspace menu opened from a compact row.

**Wrap long lines in the file pane** (2026-10-19). Files opened in a Paseo pane wrap long
lines instead of scrolling sideways, at every window width. Paseo itself only wraps rendered
markdown files. Chat code blocks and diffs are untouched (the rule targets only
`data-testid="file-source-editor"`). The CSS is exactly CodeMirror's own wrapping class, and
CodeMirror decides it is wrapping from that computed style, so line jumps (`file:120` links),
cursor, selection and Find behave as with Paseo's built-in markdown wrapping.

| Before | After | 600px window |
| --- | --- | --- |
| ![](screenshots/file-pane-wrap-before.webp) | ![](screenshots/file-pane-wrap-after.webp) | ![](screenshots/file-pane-wrap-narrow.webp) |

Live proof (2026-10-19, Paseo 0.12.0 daemon + app.paseo.sh): a 300-line test file with
lines up to 2,400 characters. No sideways scroll (content 759px in a 759px pane; 17,199px
without the tweak). CodeMirror's `view.lineWrapping` reports `true`. Jumping to lines 40, 120,
250 and to tall lines 143, 225, 287 from the top (the same `scrollIntoView` call Paseo uses
for `path:line` links) put each line in the middle of the pane with the cursor on it. Scrolling
to the bottom reaches the last line. Find highlighted the right word inside a wrapped line.
After `paseo plugin reload` with a file already open, CodeMirror notices the change on the
next scroll.

**Link colours by kind** (2026-10-28). Links in a chat get a colour by what they point to, each
derived from the theme's link colour (`--colors-accent-bright`) in OKLCH, so every theme and
accent keeps a matching set:

| Kind | Matched by `href` | Look |
| --- | --- | --- |
| Agent tab | `https://app.paseo.sh/h/…/agent/…` | hue −70°, weight 500 |
| Web | any other `http(s)://` | hue +70° |
| File | anything else (Paseo file links are paths) | accent colour, monospace |

Lightness stays the accent's. A grey accent (Zinc) gets chroma 0.06, so the kinds still
differ. Every link underlines on hover. Settings chosen by Stefan in the link-colours
playground (webshare `pages/link-colors-mocks/?agent.hue=-70&agent.weight=500&file.hue=0&url.hue=70`).

| Dark | Light |
| --- | --- |
| ![](screenshots/link-colours-dark.webp) | ![](screenshots/link-colours-light.webp) |

The screenshots are the playground mock. Live check (2026-10-28, app.paseo.sh, dark theme,
accent `#7CCBA0`): agent links computed `#D1B469` at weight 500, web links `#6DC4EA`, file
links `#7CCBA0` in monospace, the same colours the playground shows for that accent. The CSS
matches the playground on the other themes too, except where a colour falls outside sRGB
(light theme agent `#AA7700` vs `#A57900` in the playground): the browser clips it slightly
differently.

## Adding, changing or removing a tweak (for agents)

Each tweak is its own module in `client/` (`compact-sidebar.ts`, `file-wrap.ts`,
`link-colours.ts`): a header comment with the date and Stefan's own words, the `css`, and a
`start()` that injects it and returns the function that removes it. A tweak that needs more than
CSS (an observer, a timer, a listener) sets it up in `start()` and undoes all of it in the
returned function. A new tweak also needs its switch: a boolean in `shared/preferences.ts`
(default `true` unless Stefan says otherwise), an entry in `FEATURES` (`client/web.ts`) and in
`SWITCHES` (`client/settings.tsx`). Removing a tweak removes all three and its module.

1. **Find a stable selector.** Inspect the live web app in a browser. Use `data-testid`
   (prefix match `[data-testid^="…-"]` for per-item IDs) or `aria-*` attributes. Confirm in the
   Paseo source (`packages/app/src`, `grep testID=`) what the element is and
   which sibling elements share its geometry, so the tweak covers all of them (e.g. "Show more"
   rows share workspace row geometry). Never use generated class names (`css-…`, `r-…`) or broad
   tag/role selectors.
2. **Measure before.** Record heights/paddings/margins with `getComputedStyle` and take a
   screenshot.
3. **Edit.** New tweak: add a module and its switch (above). Revision: edit its CSS in place and
   keep the date of the original request plus a short note. Removal: delete the module and its switch. Rules:
   - Use `!important`: React Native Web's atomic classes have the same specificity.
   - Prefer `min-height` to `height`, so content that wraps or grows is not clipped.
   - Wrap layout changes in `@media (min-width: 720px) { … }` unless Stefan wants the change on
     the narrow/phone web layout too. Below 720px Paseo enlarges touch targets.
   - Change only what was asked; keep Paseo's colors, fonts and spacing elsewhere.
4. **Apply:** `flock /tmp/paseo-plugin.lock paseo plugin reload noice-tweaks`. Do not restart
   the daemon. An open app picks it up live; refresh only if it does not.
5. **Verify live**, then replace this plugin's screenshots for that tweak: hover and selected
   states, menus, collapsed/expanded and any other grouping/mode the element appears in, and a
   window narrower than 720px. Headless Chromium reports no hover-capable pointer, so Paseo
   ignores Puppeteer's mouse hover. To show a hover state, dispatch `pointerenter` (with
   `pointerType: "mouse"`) on the row and its ancestors.
6. **Document:** update "Current tweaks" above (what changed, in pixels; screenshots) and the
   switches table. `npm run typecheck` and `npm test` from this folder (`node_modules` is an
   ignored symlink to `../noice-chat-turn-status/node_modules`). Commit only this directory.

Disable everything: `flock /tmp/paseo-plugin.lock paseo plugin disable noice-tweaks` (every
style element is removed live). Enable again: `… plugin enable noice-tweaks`.

## Limits

- The selectors depend on Paseo's `data-testid`s (sidebar rows, `file-source-editor`,
  `agent-chat-scroll`). A Paseo upgrade that renames them makes a tweak silently stop applying.
  It does not break anything; just remeasure and update the selectors. Sidebar test IDs
  re-checked on 0.12.0 (2026-10-19).
- Link colours need CSS relative colour syntax (`oklch(from …)`). A browser without it ignores
  those rules and shows Paseo's own link colour.
- The phone app (native, not web) is unaffected by design.

## Live proof (2026-10-19, app.paseo.sh against the 0.11.4 daemon, dark theme)

Measured with the plugin on/off in the same tab:

| Element | Paseo | With plugin |
| --- | --- | --- |
| Workspace / New workspace row | 36px + 2px gap | 28px + 2px gap |
| Project header | 40px + 4px gap | 32px + 2px gap |
| Status group header | 36px + 8px gap | 32px + 2px gap |
| Row with PR/check line | 52px | 44px |
| Any row, window 700px wide | 44px | 44px (unchanged) |

Hover next to the selected row, the workspace menu, collapsing/expanding a project and switching
to group-by-status all work (screenshots above); the grouping was set back to Project afterwards.
`paseo plugin disable` removed the style element live (rows back to 36px); re-enabling restored
28px. No "Show more" row was present in this sidebar, so its rule is checked against the source
only.
