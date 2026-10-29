# Themes (`noice-themes`)

Adds 15 app themes to **Settings → Appearance → Theme**. Dark: T3 Chat Dark, Tokyo Night,
Dracula, Rosé Pine, Nord, Gruvbox Dark, One Dark, GitHub Dark, Solarized Dark, Kanagawa Wave,
Everforest Dark. Light: T3 Chat Light, One Light, GitHub Light, Solarized Light.
Client-only: no server code, no DOM edits. Installing changes nothing until you pick a theme.

Merged 2026-10-29 from the former `t3-chat-theme` and `popular-themes` plugins; every theme of
both is kept until Stefan names the ones to drop. Paseo stores the picked theme per browser/app
as `<plugin id>/theme/<theme id>` (`pluginThemeId` in the app's `@paseo:app-settings`), so a
theme picked under an old plugin id has to be picked again once.

![All 13 popular themes](screenshots/contact-sheet.webp)

| T3 Chat Dark | T3 Chat Light |
|---|---|
| ![T3 Chat Dark](screenshots/t3-chat-dark.webp) | ![T3 Chat Light](screenshots/t3-chat-light.webp) |

Full size: [Tokyo Night](screenshots/tokyo-night.webp), [GitHub Light](screenshots/github-light.webp).

Only well-known variants are kept. Removed 2026-10-19 as rarely used: Tokyo Night Light,
Dracula Alucard, Rosé Pine Dawn, Gruvbox Light, Kanagawa Lotus, Everforest Light (palettes in
git history, commit `5b12ded`).

## Removing a theme

Every theme is one self-contained `// Name { … }` block in `index.client.ts`. Delete the block,
then `paseo plugin reload noice-themes` and refresh the app. If the removed theme was selected,
Paseo falls back to its default, so pick another theme first.

## T3 Chat palette

From `T3_CHAT_THEME` in T3 Code's
[themePalettes.ts](https://github.com/pingdotgg/t3code/blob/1451e7cb23034d29774338608368a15d8845df36/packages/shared/src/themePalettes.ts#L246-L395)
(light `colors`, dark `variants.dark`), converted from OKLCH to hex because Paseo accepts only hex.

| Paseo token | Light | Dark |
|---|---|---|
| background | canvas | canvas |
| foreground | text | text |
| raised | surfaceRaised | surfaceRaised |
| control | sidebar | secondary |
| border | border | border |
| accent | messageActionHover | accentForeground |
| mutedForeground | textMuted | textMuted |
| ring | muted | placeholder |

Why these choices (where each token lands in Paseo is in the next section):

- Paseo writes accent-button text in the background color. T3's deep-pink dark accent would put
  dark text on dark pink, so dark uses T3's pale pink action text as the accent instead. Light uses
  the darker hover pink, which keeps white-ish text readable.
- `ring` is Paseo's faintest text (timestamps, placeholder, section labels). Dark uses T3's own
  placeholder color, which sits below the muted text as it should.
- In light themes `ring` is also the selected sidebar row's fill, so it can't be both a readable
  label and a background for dark text. Light uses T3's `muted` pink: the selected row reads at
  6.8:1, at the cost of faint timestamps and labels (1.8:1).

T3's sidebar artwork can't be set through the API.

## How Paseo uses the eight colors

Paseo's theme API takes eight colors and expands them into the whole app. Knowing where each one
lands is what makes a port feel right (from the installed bundle; same in 0.11.4 and 0.12.0):

| Token | Where it shows up |
|---|---|
| `background` | chat area, dark-theme sidebar, terminal, accent-button text |
| `raised` | sidebar hover (dark), blockquotes, cards |
| `control` | code blocks, table headers, inputs, menus, selected row (dark), **whole sidebar (light)** |
| `border` | dividers and outlines, control hover, sidebar hover (light) |
| `accent` | links, inline code in headings, filled buttons, success state |
| `mutedForeground` | secondary text, the most used text color in the app |
| `ring` | timestamps, composer placeholder, section labels, focus rings, usage meter, **selected sidebar row (light)** |

So each theme maps: `background` = editor background; `control` = the theme's own highlight or
sidebar swatch; `border` = next step on its neutral ladder; `accent` = its signature color;
`mutedForeground` = its secondary text; `ring` = its comment/gutter tone.

**Light-theme compromise.** In light themes `ring` is both the faintest text and the selected
sidebar row's fill, which carries primary text. One color can't be both a readable label and a
background for dark text. `ring` is set to the darkest tone that keeps primary text on the selected
row at about 5:1 (about 2:1 against the background). Timestamps, placeholder and section labels are
therefore faint in light themes.

## Sources and derived colors

Colors are the originals' own hex values unless the code comment on that line says `derived`
(a straight sRGB mix of two of the theme's own swatches, used where the original has no color for
that role).

| Theme | Source |
|---|---|
| Tokyo Night | [enkia VS Code themes](https://github.com/enkia/tokyo-night-vscode-theme/tree/master/themes); ring = [folke](https://github.com/folke/tokyonight.nvim) `dark5` |
| Dracula | [Dracula spec](https://draculatheme.com/spec): classic and UI background ladder |
| Rosé Pine | [rose-pine palette.lua](https://github.com/rose-pine/neovim/blob/main/lua/rose-pine/palette.lua) |
| Nord | [nord.css](https://github.com/nordtheme/nord/blob/develop/src/nord.css) |
| Gruvbox Dark | [morhetz/gruvbox](https://github.com/morhetz/gruvbox/blob/master/colors/gruvbox.vim), medium contrast; aqua accent |
| One Dark / Light | Atom [one-dark-ui](https://github.com/atom/one-dark-ui) / [one-light-ui](https://github.com/atom/one-light-ui) and syntax; dark ring = One Dark Pro comment |
| GitHub | [Primer](https://primer.style/foundations/primitives/color) dark/light default |
| Solarized | [altercation/solarized](https://github.com/altercation/solarized); dark raised = VS Code Solarized sidebar `#00212b` |
| Kanagawa Wave | [kanagawa.nvim colors.lua](https://github.com/rebelot/kanagawa.nvim/blob/master/lua/kanagawa/colors.lua) |
| Everforest Dark | [everforest.vim](https://github.com/sainnhe/everforest/blob/master/autoload/everforest.vim), medium |

Things the API can't set keep Paseo's defaults: error red, warning/status colors, diff colors,
terminal ANSI colors and code syntax (pick a syntax theme separately in Appearance). The menu
swatch is always the theme's background.

## Contrast

WCAG ratios. Text columns are the worst case over `background`, `raised` and `control`.

| Theme | Text | Muted | Accent | Ring on bg | Text on selected row |
|---|---:|---:|---:|---:|---:|
| T3 Chat Dark | 12.4 | 9.0 | 12.4 | 5.4 | — |
| T3 Chat Light | 10.5 | 5.5 | 5.4 | 1.8 | 6.8 |
| Tokyo Night | 8.3 | 6.4 | 6.8 | 4.1 | — |
| Dracula | 11.1 | 5.8 | 5.9 | 3.0 | — |
| Rosé Pine | 11.5 | 4.7 | 8.4 | 3.4 | — |
| Nord | 7.5 | 6.4 | 6.2 | 3.1 | — |
| Gruvbox Dark | 8.5 | 5.3 | 7.0 | 4.0 | — |
| One Dark | 7.5 | 4.9 | 5.9 | 3.7 | — |
| One Light | 9.4 | 4.4 | 3.9 | 2.2 | 5.0 |
| GitHub Dark | 12.9 | 4.9 | 7.5 | 4.1 | — |
| GitHub Light | 14.8 | 5.7 | 5.2 | 2.0 | 7.9 |
| Solarized Dark | 4.9 | 4.1 | 4.1 | 2.8 | — |
| Solarized Light | 10.6 | 4.4 | 3.4 | 2.2 | 5.4 |
| Kanagawa Wave | 9.7 | 7.7 | 5.9 | 3.3 | — |
| Everforest Dark | 5.6 | 4.3 | 6.2 | 3.2 | — |

Solarized is low-contrast by design; its numbers reflect the original, not a mapping error.
Accents of 3–4:1 (One Light blue, Solarized blue) are kept for identity.

## Live check (2026-10-19, Paseo 0.12.0, before the merge)

All 13 popular themes and both T3 Chat variants were applied in an isolated headless browser on
`app.paseo.sh` against the local 0.12.0 daemon and screenshotted on a real chat; the Appearance
menu listed all 15 plus the built-ins, with no browser errors. Theme choice is stored per
browser, so Stefan's own apps were never touched.
