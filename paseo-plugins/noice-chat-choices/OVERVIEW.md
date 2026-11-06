Lets an agent offer clickable answers in its replies. A link written `[label](<@prompt>)` becomes a **choice**: a tinted label in the reply that, when clicked, puts its prompt into that chat's message box, ready to edit and send. It never sends by itself. Agents use it to ask questions without the blocking ask tool, and to end a piece of work with the likely next steps.

## Turning it on for agents

The plugin only draws and handles the links; agents write them when their system prompt tells them to. Put the text below in **Settings → Host → Orchestration → System prompt** (`daemon.appendSystemPrompt` in the daemon's `config.json`). Paseo adds it to every agent it launches, so existing chats get it the next time they are opened or reloaded.

```text
Choices: a link written [label](<@prompt>) in your reply is a choice. Clicking it puts the prompt into the user's message box to edit and send; it never sends. Write each prompt in the user's voice, complete on its own and saying what it answers, inside the angle brackets with plain spaces, never URL-encoded. One question per paragraph or list; its choices are the answers to that question. Put choices inline in a sentence only when every label is a word: Use [tabs](<@Use tabs for indentation>) or [spaces](<@Use spaces for indentation>)? Otherwise write the question, then its choices as a bullet list, one per bullet. After finishing a piece of work, end the reply with the likely next steps as choices; elsewhere, offer choices only when the user would plausibly pick one. When you need an answer before going on, prefer asking in your reply with choices.
```

The angle brackets matter: Paseo's Markdown only reads a link target with spaces when it is wrapped in `<…>`. Without them the link shows as plain text. `[label](<@>)` uses the label as the prompt.

## What a click does

- **First pick** from a question puts its prompt on its own line at the end of the message box, after anything you already typed, and moves the cursor there.
- **Another choice from the same question** replaces that line in place, as long as you haven't edited it.
- **The same choice again** takes its line out.
- A question is one paragraph or one bullet list. Picks from different questions stack as separate lines.
- Choices in older replies stay clickable. Ctrl, Cmd and middle clicks never open a browser tab.
- Hovering a choice whose prompt says more than its label shows the full prompt.

## How choices look

Colours follow the theme: the accent is Paseo's own link colour, so they adapt to light, dark and plugin themes.

- **Open:** bold accent text on a light accent tint.
- **Picked** (its prompt is a whole line in the message box): a solid accent marker sweeps in behind it, text in the background colour. Editing the line, or deleting it, unpicks it.
- **Passed over** (another choice of the question is picked): normal text colour on a faint neutral tint.
- **Settled** (you sent a message after the reply): the choice your message carried, as a whole line, keeps a faint accent marker; the rest drop their tint and stay bold. Nothing is stored: states are read from the message box and the chat each time.

The padding is the same in every state, so text never shifts. With reduced motion on, nothing animates.

## Limits

- **Web and desktop app only.** The iOS and Android apps show choices as ordinary links, and tapping one does nothing useful: plugins can't reach link taps or the message box there.
- **Writing into the message box is a DOM trick, not an API.** Paseo has no plugin call that fills the composer, so the plugin sets the chat's `textarea[data-composer-input]` value and fires `input`, as `noice-chat-quote` does. A composer refactor in Paseo can break it.
- **Settling only sees what's on screen.** A long chat may not keep every message in the page; a reply whose later messages aren't loaded shows as open until they are.
- Works alongside `noice-chat-embeds`, whose redrawn replies are covered too.

## Cost

Nothing runs while the page is idle: no timers or polling. Work happens on a choice click, on typing in a message box (once per frame), and when chat rows are added or replaced, coalesced to at most one pass per 120 ms. Measured on the web app (NVIDIA GPU, Chromium): 0 ms of plugin script over 10 s idle, about 5 ms over 15 s of a streaming reply.

## Development

`npm install`, `npm run typecheck`. `paseo plugin reload noice-chat-choices` applies edits.
