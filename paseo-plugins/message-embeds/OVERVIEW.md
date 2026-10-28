Shows inline file previews when an assistant writes an Obsidian-style embed such as `![[src/app.ts#L40-80]]`. The embed text is replaced by a compact card that keeps the original spelling, shows the requested line range, and loads a bounded preview from the agent's working directory. Tap the preview to expand it and scroll; the file link opens the normal Paseo file panel on the side.

Only complete embeds in assistant messages are converted. Fenced code blocks, inline code, and half-typed embeds stay as the assistant wrote them. Relative paths use the chat's working directory. Absolute paths and `~/` paths are accepted only when they resolve inside that directory. Missing, unreadable, binary, and oversized requests show a muted error instead of breaking the message.

The plugin is enabled by default. Use **⌘K → Toggle file embeds** (or Ctrl+K on Windows and Linux) for a quick switch. The same setting is available at **Settings → Plugins → message-embeds → File embeds**. Turning it off leaves native Paseo message rendering untouched.

## Screenshots

These verifier screenshots are saved under `screenshots/`:

- `screenshots/desktop-collapsed.webp`
- `screenshots/desktop-expanded.webp`
- `screenshots/desktop-error.webp`
- `screenshots/desktop-off.webp`
- `screenshots/phone-collapsed.webp`
- `screenshots/phone-expanded.webp`
- `screenshots/diff-plus-embed.webp`
