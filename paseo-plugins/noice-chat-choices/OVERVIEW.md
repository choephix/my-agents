Lets an agent offer clickable answers in its replies. A link written `[label](<@prompt>)` becomes a **choice**: a tinted label in the reply that, when clicked, puts its prompt into that chat's message box, ready to edit and send. It never sends by itself. Agents use it to ask questions without the blocking ask tool, and to end a piece of work with the likely next steps.

## Turning it on for agents

The plugin only draws and handles the links; agents write them when their system prompt tells them to. Put the text below in **Settings → Host → Orchestration → System prompt** (`daemon.appendSystemPrompt` in the daemon's `config.json`). Paseo adds it to every agent it launches, so existing chats get it the next time they are opened or reloaded.

```text
Choices: a link written [label](<@prompt>) in your reply is a choice. Clicking it toggles its prompt as a line in the user's message box to edit and send (multiple choices can be picked); it never sends. The label is the answer in full: everything the user needs to decide, as they only read labels. The prompt is a key: a short sentence or fragment, in the user's voice, that tells you which choice of which question was picked, since you will read the full label back in your own previous message. Plain spaces inside the angle brackets. Put choices inline in a sentence only when every label is a word: Use [tabs](<@Use tabs>) or [spaces](<@Use spaces>)? Otherwise write the question, then its choices as a bullet list, one per bullet:
- [Run the migration in one transaction and roll back everything on any failure ★](<@One transaction, roll back on failure>)
- [Run it as separate statements so partial progress survives a failure](<@Separate statements>)
After finishing a piece of work, end the reply with the likely next steps as choices; elsewhere, offer choices only when the user would plausibly pick one. When you need an answer before going on, prefer asking in your reply with choices.
Mark recommended answers with ★ after.
Particularly useful for grilling.
```

The angle brackets matter: Paseo's Markdown only reads a link target with spaces when it is wrapped in `<…>`. Without them the link shows as plain text. `[label](<@>)` uses the label as the prompt.

## What a click does

- **Picking a choice** puts its prompt on its own line at the end of the message box, after anything you already typed, and moves the cursor there.
- **Picking more choices** stacks each one on its own line: choices are always independent toggles, with no grouping or auto-replacing.
- **Clicking a picked choice again** takes its line out, as long as you haven't edited it.
- Choices in older replies stay clickable. Ctrl, Cmd and middle clicks never open a browser tab.
- Hovering a choice whose prompt says more than its label shows the full prompt.

## How choices look

Colours follow the theme: the accent is Paseo's own link colour, so they adapt to light, dark and plugin themes.

- **Open:** bold accent text on a light accent tint.
- **Picked** (its prompt is a whole line in the message box): a solid accent marker sweeps in behind it, text in the background colour. Editing the line, or deleting it, unpicks it.
- **Settled** (you sent a message after the reply): every choice your later messages carried, as a whole line, keeps a faint accent marker; the rest drop their tint and stay bold. Nothing is stored: states are read from the message box and the chat each time.

The padding is the same in every state, so text never shifts. Inline `` `code` `` inside a choice label inherits the choice's colour on a subtle accent chip without Paseo's gray code border, and clears the chip once picked or settled. With reduced motion on, nothing animates.

## Limits

- **Web and desktop app only.** The iOS and Android apps show choices as ordinary links, and tapping one does nothing useful: plugins can't reach link taps there.
- **Requires Paseo 0.17+ (`client.composers`).** Reading and writing the message box uses Paseo's official composer API (matched to the chat's agent in split panes, falling back to `{ focused: true }`), with no DOM layout reads or textarea setter hacks.
- **Settling only sees what's on screen.** A long chat may not keep every message in the page; a reply whose later messages aren't loaded shows as open until they are.
- **Choices in embedded memos.** `noice-chat-embeds` draws a reply's `![[note.md]]` as a card with the file's Markdown; choices in that card, and in a memo embedded inside it, work as in the reply itself, with the same picked and settled states. A folded card hides the choices below its fold until you click the card to expand it; clicking a choice never folds or expands the card. Checked 2026-11-19 in the web app (Chromium and WebKit) with picks from two questions in one memo, one in a nested memo, and a sent message settling them.

## Cost

Nothing runs while the page is idle: no timers or polling. Work happens on a choice click, on typing in a message box (once per frame), and when rows inside a chat change or a chat/composer mounts (ignoring unrelated page mutations like sidebar updates, coalesced to at most one pass per 120 ms). The chat's background colour (`--noice-choice-ink`) is read once per chat and refreshed only on theme changes. Measured on the web app (NVIDIA GPU, Chromium): 0 ms of plugin script over 10 s idle, about 5 ms over 15 s of a streaming reply.

## Development

`npm install`, `npm run typecheck`. `paseo plugin reload noice-chat-choices` applies edits.
