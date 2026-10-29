Colors diff code blocks in agent messages, terminal-diff style but quieter: added and removed lines
get a 2 px neon green/red bar at the left edge and a faint 6% tint, their text (syntax colors
included) is pulled halfway toward green or red, and every stretch of words that changed inside a
changed line is marked in reverse video: solid green/red with white text (in dark themes the solid
color is deepened so white stays readable). Each `@@` hunk header gets a tinted band and each file
header a grey band. Context lines keep the syntax colors of your Syntax theme (Settings →
Appearance). Style picked by Stefan as variant 11 of a local mock page.

Diff blocks are also deeper than other code blocks: a 50% black layer (white in light themes) sits
over the theme's own block background, so the theme's hue stays (a purple block becomes deep
purple). Other code blocks keep the theme's color. Screenshots: `screenshots/style-11-paseo-dark.webp`,
`-t3-dark.webp`, `-paseo-light.webp` (fixtures `fixtures/chat-fixture.md` and `fixtures/prose.diff`).

Diffs inside a quote (`>`) and diffs in your own messages (drawn by `noice-chat-message-polish`)
are quieter: changed words get a soft 25% band in the line color and keep their text color, and
the block keeps the background it is given, without the deeper layer. Rows, gutter bars and syntax
colors are the same. Screenshots: `screenshots/quote-before-*.webp` and `quote-after-*.webp`
(dark and light, your message and the agent's reply).

Light or dark colors follow Paseo's own theme (its light/dark scheme and text color, read from the
CSS variables Paseo sets on the page), the same for every block, never a guess from one block's
colors.

Blocks fenced as `diff` or `patch` are always colored. Unlabeled blocks are colored only when they
look like a diff: git headers (`diff --git`, `---`/`+++`, `@@ -1,3`) or every line starting with
`+`, `-` or a space, with at least one of each. Blocks labeled with another language are left alone.
The code language comes from the file names in the diff headers; mock diffs without headers get a
best guess. Lines that read as prose (a prompt, docs, a message) get no syntax colors, so words like
`from` and `in` aren't painted as keywords; neither do Markdown and text files. Markdown is read
through: list and quote markers, headings, links, bold and inline code don't stop a line from being
prose, and a headerless diff whose every line is Markdown or text gets no syntax colors at all.
Comments keep their comment color; `key: value` lines stay code (YAML).

Changed words: each removed line is paired with the most similar of the added lines after it (they
must share at least half their text), and a word-by-word diff of the pair marks every changed
stretch, on both sides, even when the edits are scattered across a long sentence. Lines rewritten
from scratch are not paired and keep the plain row color; so are pairs whose marks would cover more
than 80% of both lines (3% of marked lines in Stefan's transcripts), since a fully reversed line
says no more than the row color.

Paseo keeps rendering every message itself. The plugin only paints colors over the text it already
shows, so the copy button, selection, Find and copy as Markdown work as before (copying gives the raw
diff), and blocks color while the reply streams. A diff that is still streaming is re-colored at most
10 times a second, so its newest lines can stay plain for up to 0.1 s; at most 0.1 s after it stops
growing it has all its colors. A finished diff (one you open, scroll to or switch back to) is colored
in the frame it appears. Measured 2026-10-20 in headless Chromium on a shared VM (a desktop is
likely 2–4× faster):

- Streaming a 361-line diff, before the 10-a-second limit: 0.34–0.46 s of plugin work in total (was
  0.68–0.70 s), the last frames 4–5 ms (were 8–10 ms). Each frame re-colored once; no second repaint
  after it.
- Streaming a ~50-line diff (2026-10-29, the real web app on a GPU, alternate builds): re-coloring
  it costs 1.3–2.3 ms/s over the 10 s after the reply starts (was 2.6–10.3 ms/s, three of five runs
  5.6–6.7, at once per frame). Screenshot of one such diff right after it ended, fully colored:
  `screenshots/streamed-end-paseo-dark.webp`.
- Coming back to diff blocks after none were on screen (switching chats, scrolling history): 13 ms
  (was 0.86 s, a page-wide restyle twice per visit).
- All 664 distinct diff blocks in Stefan's transcripts parse in 44 ms together; the slowest one in
  under 1 ms.
- 43 page-wide highlight styles (were 49: the 8 that could never match are gone, 2 for quiet word
  marks were added); every one costs style time on each element of the chat.
- Theme and syntax-theme switches recolor diff blocks at once, picked up from Paseo's own theme
  change (the class on the page root, its theme stylesheet), window focus and the system light/dark
  switch. The plugin used to check every 1.5 s, forcing a style update each time; idle, it now
  reads no style at all, and only compares the stored settings every 10 s as a backstop.
- Diff blocks more than 1500 px above or below the screen hold no colors. Chromium repaints every
  colored line in the area around the screen on every frame (60 times a second while an agent's
  loader runs), even lines nobody can see. A block gets its colors back in the same frame a scroll
  or layout change brings it within that distance, well before it reaches the screen.
  Measured in a lab chat with both diff blocks 2300–3500 px up: 323 → 4 repaints a second.

Past 100,000 characters only rows, signs and changed words are colored, as Paseo itself stops syntax
coloring there.

Limits:

- Paseo 0.11.4 or later, in the web app and the desktop app. The iOS and Android apps show diffs as
  before.
- It relies on markers Paseo puts on chat code blocks for its own copy feature, and on its
  `user-message` test id and `<blockquote>` to find quiet blocks. They are not a public plugin API;
  tested on Paseo 0.13.0 (2026-10-29). If a later update drops them, the coloring stops (or quiet
  blocks get the full style); the chat itself keeps working.
- Green/red are fixed neon colors (one pair for light, one for dark themes, picked by the theme's
  light/dark scheme), not the theme's own status colors.
- The syntax coloring is a lightweight tokenizer, close to but simpler than Paseo's own highlighter.
- No line numbers: they would have to be added as text and would end up in copies.
