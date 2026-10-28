Shows inline file previews when an assistant writes an Obsidian-style embed such as `![[src/app.ts#L40-80]]`. The embed text is replaced by a compact card that keeps the original spelling, shows the requested line range, and loads a bounded preview from the agent's working directory. Tap the preview to expand it and scroll; the file link opens the normal Paseo file panel on the side.

Only complete embeds in assistant messages are converted. Fenced code blocks, inline code, and half-typed embeds stay as the assistant wrote them. Relative paths use the chat's working directory. Absolute paths and `~/` paths are accepted only when they resolve inside that directory. Missing, unreadable, binary, and oversized requests show a muted error instead of breaking the message.

The plugin is enabled by default, and one switch covers file and chat embeds. Use **⌘K → Toggle file embeds** (or Ctrl+K on Windows and Linux) for a quick switch. The same setting is available at **Settings → Plugins → message-embeds → File embeds**. Turning it off leaves native Paseo message rendering untouched.

## Chat embeds

`![[https://app.paseo.sh/h/<serverId>/agent/<agentId>]]` on a line of its own becomes a read-only
card of that chat: its title, its state (working, needs permission, error, or how long ago its last
message was) and its last three messages in a 240 px window scrolled to the bottom, so a question it
asked is readable without opening it. Clicking the card opens the chat; links inside the card work as
links. The same embed inside a sentence is written back as the plain link, and a plain link is never
turned into a card.

- The card is a snapshot taken when it is drawn. It does not follow the chat while you look at it;
  coming back to the reply takes a new one.
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
