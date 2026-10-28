Shows inline file previews when an assistant writes an Obsidian-style embed such as `![[src/app.ts#L40-80]]`. The embed text is replaced by a compact card that keeps the original spelling, shows the requested line range, and loads a bounded preview from the agent's working directory. Tap the preview to expand it and scroll; the file link opens the normal Paseo file panel on the side.

Only complete embeds in assistant messages are converted. Fenced code blocks, inline code, and half-typed embeds stay as the assistant wrote them. Relative paths use the chat's working directory. Absolute paths and `~/` paths are accepted only when they resolve inside that directory. Missing, unreadable, binary, and oversized requests show a muted error instead of breaking the message.

The plugin is enabled by default, and one switch covers every embed kind below. Use **⌘K → Toggle file embeds** (or Ctrl+K on Windows and Linux) for a quick switch. The same setting is available at **Settings → Plugins → message-embeds → File embeds**. Turning it off leaves native Paseo message rendering untouched.

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
