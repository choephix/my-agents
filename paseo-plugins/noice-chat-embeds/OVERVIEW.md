Shows inline file previews when an assistant writes an Obsidian-style embed such as `![[src/app.ts#L40-80]]`. The embed text is replaced by a compact card that keeps the original spelling, shows the requested line range, and loads a bounded preview from the agent's working directory. Tap the preview to expand it and scroll; the file link opens the normal Paseo file panel on the side.

Only complete embeds in assistant messages are converted. Fenced code blocks, inline code, and half-typed embeds stay as the assistant wrote them. Relative paths use the chat's working directory. Absolute paths and `~/` paths are accepted only when they resolve inside that directory. Missing, unreadable, binary, and oversized requests show a muted error instead of breaking the message.

The plugin is enabled by default, and one switch covers every embed kind below. Use **⌘K → Toggle file embeds** (or Ctrl+K on Windows and Linux) for a quick switch. The same setting is available at **Settings → Plugins → noice-chat-embeds → File embeds**. Turning it off leaves native Paseo message rendering untouched. Opening Paseo tab links in place (last section) has its own switch next to it.

## Images

`![[shot.webp]]` (also png, jpg, gif, avif, svg) shows the picture, fitted to the card width and at
most 240 px tall; a taller picture enlarges to the window height on tap. The header row shows the
original text in small faint monospace and, fainter still at the right, the pixel and file size;
both brighten while the mouse is over the card. Files over 4 MB show an error instead. SVG needs
the desktop or web app; the phone app shows a one-line note.

## HTML pages

`![[report.html]]` shows a "▸ Show page" toggle at the right of its header row. The page loads only when shown and unloads when
hidden, so an animated page costs nothing while folded. It runs in an iframe sandboxed to scripts
only: it cannot reach Paseo, its storage or your session, and cannot open popups or navigate the
app. Pages are loaded as a single file, so relative links to its own CSS, scripts or images don't
resolve; inline them. The phone app shows a one-line note instead.

## GitHub links

`#123` (two digits or more) becomes a link to issue or PR 123 of the chat folder's GitHub
repository (its `origin` remote; GitHub forwards `/issues/123` to the PR when it is one). Inline
code, code blocks, existing links and `abc#12` stay as written; folders without a GitHub remote
keep plain text. Links appear once the reply finishes streaming.

## SVG code blocks

Off by default: turn on **Render SVG code blocks** in the plugin's settings (the main switch still
turns everything off). A complete ```` ```svg ```` block in a finished reply is drawn as a picture in
the same card style, with the size in the header and a **Code** toggle that shows the source as a
normal code block (with its copy button) and back. While the reply streams, or if the block never
closes, it stays code. CSS variables such as `var(--fg)`, `var(--muted)`, `var(--accent)`,
`var(--error)`, `var(--warning)`, `var(--success)`, `var(--border)` and `var(--bg)` take the
current Paseo theme's colours, so diagrams follow dark and light themes; an unknown variable uses
its fallback, else the text colour. The picture is drawn as an image, so scripts and external
files never load. An incomplete SVG, one without a size or viewBox, one over 256 KB, or one the
browser can't draw stays a code block with a muted note. The phone app keeps the code block.

## Chat embeds

`![[https://app.paseo.sh/h/<serverId>/agent/<agentId>]]` on a line of its own becomes a read-only
card of that chat: its title, its state (working, needs permission, error, or how long ago its last
message was) and the end of its last three messages in a fixed 240 px window, older text fading out
at the top, so a question it asked is readable without opening it. The window does not scroll, so
the mouse wheel always scrolls the chat around it, and the card has the same height while loading as
when loaded, so the chat doesn't shift. Clicking the card opens the chat; links inside the card work
as links. The same embed inside a sentence is written back as the plain link, and a plain link is
never turned into a card.

- The card is a snapshot. It does not follow the chat while you look at it. A card that scrolls back
  into view within 30 seconds shows the same snapshot; later it takes a new one. Cards showing the
  same chat share one fetch.
- An archived, unknown or unreachable chat shows the plain link instead.
- A card can appear while the reply is still streaming; the rest of the reply keeps streaming below.
- Drawing a card reads the newest 20 timeline entries of that chat from the host, and up to 80 more
  when tool calls crowd out the messages. Paseo loads a chat that is not in memory to answer, the
  same as when its tab is opened.
- Through app.paseo.sh a card filled in about 0.15 s after its frame appeared when switching tabs,
  and about 0.8 s after the chat text on a fresh page load.

Clicking the card switches tabs through a short "Opening chat" plugin screen. On iOS and Android the
cards use only cross-platform parts but have not been tried.

## Paseo tab links

Agents often link to another Paseo chat tab as `https://app.paseo.sh/h/<serverId>/agent/<agentId>`.
Paseo opens such a link in the browser. With **Open Paseo tab links in place** on, a plain click
switches to that tab in the Paseo window you are already in, through the same short "Opening chat"
screen as the cards, and no browser opens. The switch is on by default and independent of the file
embeds switch. Turned off, the plugin removes its click listener at once, with no refresh, and links
behave as native Paseo.

Only that exact link form is handled, with or without a trailing slash. Every other link, including
other `app.paseo.sh` paths and links with a query or `#` part, behaves as before. Ctrl, Cmd, Shift
and Alt clicks and middle clicks are not touched either. It works in the desktop and web apps: the
plugin watches clicks on the page, which the iOS and Android apps do not have, so links there behave
as before. The link's server ID is passed to Paseo's navigation, so a link to a chat on another
connected host should open there (not tested with a second host).

This was the separate plugin `noice-chat-go-to-agent-links` (earlier `agent-links`) until
2026-10-29. It had no saved settings.

Checked 2026-10-29 in the web app (app.paseo.sh) against the local daemon: with the switch on, a
plain click on an agent link switched to that tab in the same browser tab; switched off live, the
same click opened a new browser page and the chat stayed put; switched back on, the click worked in
place again, all without a refresh. The agent card in the same message rendered throughout. Clicking
one in the desktop app was reported to work with the earlier plugin.

## Screenshots

These verifier screenshots are saved under `screenshots/`:

- `screenshots/desktop-collapsed.webp`
- `screenshots/desktop-expanded.webp`
- `screenshots/desktop-error.webp`
- `screenshots/desktop-off.webp`
- `screenshots/phone-collapsed.webp`
- `screenshots/phone-expanded.webp`
- `screenshots/diff-plus-embed.webp`
- `screenshots/image-folded.webp`
- `screenshots/image-enlarged.webp`
- `screenshots/svg.webp`
- `screenshots/html-hidden.webp`
- `screenshots/html-shown.webp`
- `screenshots/pr-links.webp`
- `screenshots/phone-media.webp`
- `screenshots/svg-picture.webp`
- `screenshots/svg-code.webp`
- `screenshots/svg-light.webp`
- `screenshots/svg-off.webp`
- `screenshots/svg-phone.webp`
- `screenshots/link-click-before.webp`
- `screenshots/link-click-in-place.webp`
- `screenshots/link-settings.webp`
- `screenshots/link-click-off.webp`
- `screenshots/agent-card-with-links.webp`
