Makes your own sent messages nicer in the Paseo web and desktop apps: pasted tag blocks fold into
one-line fold rows, Markdown renders, slash commands go quiet, and a `/skill:` message shows what
the agent actually got. The phone apps are unchanged.

**Fold rows.** A block such as `<attachments>…</attachments>`, `<summary>`, `<context>` or
`<paste>` becomes one 24 px monospace row (11 px text) that shows the tags as written, attributes included,
with the content squeezed onto one very muted line between them and cut with an ellipsis:
`<file path="docs/badges.md"> # Badges Count only live a… </file>  ⌄`. The tags sit left and keep
their full text first; the preview takes what room is left; the chevron sits at the right edge,
pointing down. Click it (or Enter/Space) to open it
in place: the row stays where it is as the header and shows only the opening tag, its text goes a
step quieter, the chevron turns up and goes full strength, the content continues below in the same
rounded shape at half the tint (raw text, at most 320 px tall, scrolls inside, long lines wrap),
and a footer row with the closing tag ends the shape; clicking the footer folds it too. Stefan
picked style B from a local mock page, then
asked for literal tags with a one-line preview instead of a tag name, hint and line count.

- What folds: the opening tag starts a line, a matching closing tag ends a later line (or the
  same line), and the content has 2+ lines. Same-name tags nested inside are part of one fold;
  the outermost block is the row. Never inside a code fence, never an inline mention (`use a <div>
  here`), never an unclosed tag.
- Settings → Plugins → noice-chat-message-polish → My messages: **Fold tag blocks**, **Render Markdown**,
  and two comma-separated lists: **Always fold** (folds even a one-line block; default
  `attachments, system-notice, system-reminder`) and **Never fold** (stays text however long;
  default `div, span, p, br, b, i, em, strong, u, s, a, img, code, pre, kbd, details, table, ul,
  ol, li`), plus "Reset to defaults". Changes apply at once in every open window.
- A long opening tag is cut to one line in the row; hovering shows it whole.

**Markdown.** Bold, italic, strikethrough, inline code, fenced code (language kept), links and bare
URLs (open in a new tab), bullet and numbered lists (nested), quotes (smaller than your text: 12 px
on a ×1.3 line, muted, left bar), headings (bold, body size),
rules. Single line breaks stay line breaks, like Paseo's plain text; a blank line becomes an 8 px
gap. Everything else stays literal text. A message with no Markdown and nothing to fold is left
exactly as Paseo draws it.

**What keeps working.** Paseo keeps its own text in the bubble, hidden; the plugin draws its copy
next to it. The copy button and rewind read the message itself, not the screen, so **Copy gives the
original text, tags included**, and rewind puts the original text back in the composer (both
checked live). Chat Find searches the drawn copy (checked: "1 of 1", highlighted once).
`noice-omp-magic-keywords` colours keywords in it; `noice-omp-tree`'s Re-ask reads Paseo's hidden original.
`diff` fences in your messages get `noice-chat-diff`'s colours, since the code blocks carry
Paseo's markers (checked live). Colours are mixes of the bubble's text colour, so every theme works
(checked in T3 Chat dark and Paseo Light). Turning the plugin off removes every trace at once
without a reload (checked).

**Slash commands** (Stefan's pick from a local mock page). A one-line message that starts with
`/name` loses its bubble: just the command, right-aligned, muted, in the code font. Paseo's time,
rewind and copy row moves onto the command's line, left of it (on hover on desktop, always at narrow
width), so the answer sits 4 px under the command instead of below an empty 32 px row (copy gives
`/session`, checked live). OMP's own answer to a
command (no model ran: `/session`, `/tools`, `/reload-plugins`, …) becomes a muted code block
without the "Worked for 0s" footer, showing the output exactly as OMP printed it, line breaks and
list markers included (Paseo's Markdown joins the lines or turns `* bash` into bullets). Longer
output scrolls inside 320 px. Setting: **Quiet slash commands** (on by default).

- How it tells OMP's answer from a model reply, with no list of command names: Paseo gives OMP's
  answers a made-up row id (`assistant_<time>_…`), a model reply carries the model's message id
  (`msg_…`) from its first word. An `assistant_` row right after a `/` bubble is OMP's answer.
  Checked live on OMP + Claude Haiku: `/notacommand …` answered by the model keeps its normal reply.
- The original output text comes from a read-only timeline transformer: OMP's answers arrive
  without a message id; the plugin keeps their text and never changes the item, so copy, rewind
  and the phone apps see Paseo's own item.
- Skipped, because they're drawn elsewhere: `/tan`, `/btw`, `/omfg`, `/queue` (other plugins) and
  `/skill:…` (the skill view below). Messages with pictures or attached files keep their bubble.

**Skills** (Stefan's pick from a local mock page: one tinted bubble, no side line, small-caps `USER`,
lightbulb, chevron on the right, theme accent).
The bubble shows the message as the agent received it. OMP sends a loaded skill as one message:
`[IMPORTANT: User invoked the "<name>" skill…]`, the whole SKILL.md, the skill-directory lines, then
`User: <your text>`. So:

- The bubble takes a very slight tint of the theme's accent (Paseo's `--colors-accent-bright`
  CSS variable, so plugin themes like T3 work too), only when a skill really loaded.
- A header row on top: lightbulb, skill name, chevron at the right. Clicking it opens, in place and
  as one piece, the skill text exactly as OMP sent it (read from OMP's session file): Paseo's code
  size, lines 1.5× that, at most 320 px tall and scrolling, with the skill-directory lines pinned
  under the scroll area. While anything is open the bubble is at least half the chat wide (320 px
  on a narrow window), so a short message doesn't squeeze it into a thin column.
- Below it, your text as the agent read it after `User:`, starting with a small-caps `USER`. OMP
  cuts the `/skill:` token out and joins the text around it with one space (`please use /skill:pith
  to reply` reaches the agent as `please use to reply`), so that's what shows. If the text starts
  with a list or code block, `USER` gets its own short row above it.
- Only the first `/skill:` loads. Any later one stays in the text, dashed-underlined, tagged
  `not loaded`. If the first name isn't a skill, nothing loads (not even a valid later one): the
  header says `no skill loaded`, the bubble keeps its normal colour, and the tokens are tagged
  `not a skill` / `not loaded`. A message that is only `/skill:name` is just the header: no text,
  no `USER` (OMP sends no `User:` line then).
- `@path` mentions OMP attached: a file chip in the text where you wrote it, plus a row after the
  text, `notes.md · attached after your message · 31 lines`, that opens the file as sent.
- Live and after a reload look the same. While chatting Paseo shows what you typed; after a reload
  it rebuilds the bubble as `/skill:<name> <cut text>`. Both parse to the same skill and text.
- How the plugin knows a skill loaded: the bubble alone can't tell a real skill from a typo. The
  server part reads the OMP session files of the chats in view (the chat, or every live chat of the
  workspace, from the page address) and returns OMP's `skill-prompt` and `fileMention` records;
  each file is read once and then only from where it stopped. Until that answer arrives a bubble
  that invokes a skill by OMP's rules is drawn as loaded; one OMP never recorded flips to `no skill
  loaded` after 2.5 s (a just-sent message reaches the session file a moment after its bubble).
  Chats of other providers: `/skill:` stays plain text.
- Setting: **Show skills as the agent got them** (on by default).
- Checked live 2026-10-24 in the web app with throwaway OMP + Claude Haiku chats: token at the end,
  mid-sentence, two skills, mistyped first skill, skill only, @file, skill + list + fold row; a
  newly typed message goes from drawn-from-text to OMP-confirmed in about 3 s with no visible
  change; copy gives the typed text; the opened bubble is 402 of 804 px (desktop) and 320 of 358 px
  (390 px window), no page overflow; disabling the plugin removes it all without a reload.
- Motion is CSS only: hover and open tints fade (120 ms), opened content fades in (140 ms,
  `@starting-style`), the bubble eases to its wider width and to its skill tint (160 ms; measured
  163 → 402 px in about 170 ms). Closing is instant. Off when the system asks for reduced motion.

Paseo 0.12 shows messages from other agents (Dispatcher etc.) as a "Message received" row, not as
your bubble, so `<paseo-system>` envelopes need nothing here (checked live).

Screenshots (`screenshots/`): `before-mixed.webp` → `after-mixed.webp` / `after-mixed-open.webp`,
`before-nested-long.webp` → `after-nested-long-open.webp` (120-line paste open, nested `<context>`,
quote, lists, diff fence), `after-stays-raw.png` (inline tags, a fence holding tags, one-line
blocks), `after-light.webp`, `web-390px.webp`, `settings.webp`, `before-commands.webp` →
`after-commands.webp` (`/session`, `/reload-plugins`, hovered), `skill-list.png` (skill + list +
fold row), `skill-open.webp` (skill text open), `skill-unknown.webp` (mistyped first skill),
`file-open.webp` (@file attached, open).

Limits:

- Web and desktop only; the iOS and Android apps show the raw text as before.
- Text inside a closed fold row is not on screen, so Chat Find reports "No matches" for it; open
  the row first.
- Selecting text with the mouse and pressing Ctrl+C copies the drawn text (Paseo does this for your
  messages anyway); the copy button gives the original.
- It finds messages by markers Paseo puts on the page (`data-testid="user-message"`,
  `data-message-text`), not a public plugin API; tested on Paseo 0.12.0 (2026-10-23). If an update
  renames them, your messages show plain again; nothing breaks.
- The Markdown reader is the plugin's own small one (no library), so rare syntax (tables, setext
  headings, reference links, HTML) stays as text.
- OMP's command answers are not in OMP's session file: after the agent is reloaded, the command and
  its answer are gone from the chat (checked 2026-10-24). Paseo's doing, not the plugin's.
- Paseo bug seen 2026-10-24 (plugin off too): after running the same OMP command twice, every page
  reload adds another copy of its answer (2 → 3 → 5). Copies that follow another answer instead of
  your `/` bubble keep Paseo's look.
- An answer drawn before the page loaded the plugin, or one whose letters Paseo's Markdown changed,
  falls back to Paseo's rendered text (lines kept, list markers lost). Not checked in the light
  theme; colours mix the answer's own text colour.
- Skills: the server part reads OMP's session files directly (format of OMP 18.12.6: top-level
  `custom_message` with `customType: "skill-prompt"`, `message` with role `fileMention`). An OMP
  update that changes it makes skill messages fall back to "drawn from the text": header and cut
  text still show, the skill text can't be opened, and a mistyped name is no longer caught.
- Skills: the page address must name the chat or its workspace (`/h/<server>/agent/<id>` or
  `/h/<server>/workspace/<id>`); on other pages skill messages are drawn from the text alone.
- Skills: the first skill message seen in a big workspace makes the server read every OMP session
  file in it once (about 30 ms per 4 MB file measured); later visits only read what was appended.
