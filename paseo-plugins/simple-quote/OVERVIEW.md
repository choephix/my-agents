Select text anywhere in a chat (assistant replies, your own messages, tool output) and a small **Quote** button appears just above it. Press it and the selection goes into that chat's message box as a Markdown block quote, with the cursor on a fresh line below, ready for your reply.

![Quote button over a selection, dark theme](screenshots/button-dark.webp)
![The quote in the message box](screenshots/quoted-dark.webp)

## What it does

- **The button.** Shows once you release the mouse (or as you extend a selection with the keyboard), centred above the first selected line, or below the last one when there is no room above. It follows the text when the chat scrolls, hides while the selection is scrolled out of the chat, and goes away when the selection is cleared or moves outside the chat. Selections in the message box itself get no button.
- **The quote.** Every line starts with `> `; empty lines become `>`. Blank lines around the selection and trailing spaces are dropped.
- **Where it goes.** At the end of the draft, never at the old cursor. An empty (or whitespace-only) message box gets the quote and one blank line. A draft with text keeps its text, then one blank line, the quote, and one blank line. The message box gets focus with the cursor after that last blank line, and the selection is cleared.
- **Untouched.** Copying with Ctrl+C or Cmd+C, clicking links in messages, and other chat plugins work as before. The plugin adds one button to the page and changes nothing Paseo draws.
- **Next to the annotations plugin.** That plugin opens its own selection toolbar (Add to chat, Ask in new chat, Copy) in the same spot. While it is open, the Quote button sits right beside it (left of it when the chat has no room on the right), and pressing Quote doesn't close it first.

![A quote added after an existing draft](screenshots/quoted-draft-dark.webp)
![Quote button, light theme](screenshots/button-light.webp)

## Limits

- **Web and desktop app only.** Phones and the native apps get nothing: their text selection gives plugins no hook.
- **Writing into the message box is a DOM trick, not an API.** Paseo 0.13.0 has no plugin call that writes into the composer, so the plugin sets the chat's `textarea[data-composer-input]` value and fires `input`, as `agent-commands` does. A composer refactor in Paseo can break it; the button then stops appearing.
- The quoted text is what the browser copies for the selection: rendered text, not the message's Markdown source (bold, links and code fences arrive as plain text).

## Development

`npm install`, `npm test` (vitest: quote building for empty, whitespace-only and newline-ending drafts, blank lines and trailing newlines in the selection), `npm run typecheck`. `paseo plugin reload simple-quote` applies edits.
