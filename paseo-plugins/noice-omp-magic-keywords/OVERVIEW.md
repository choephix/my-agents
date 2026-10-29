Shows OMP's magic keywords in moving rainbow colors, the way OMP's terminal shows them: `ultrathink`,
`orchestrate`, `workflowz` and `jevify`. The colors appear while you type and stay on the word in the
sent message (and in the chat outline's hover preview). Each word has OMP's own color range
(ultrathink the full rainbow, orchestrate green to purple, workflowz orange to green, jevify magenta to
yellow), running across the word on OMP's 1.8-second cycle, with a smoother sweep and more even colors
than OMP uses. Screenshots: `screenshots/composer-dark.webp`, `screenshots/sent-dark-a.webp`,
`screenshots/settings-dark.webp`.

A word is colored only where the chat's agent would act on it. By default a chat's words follow its
agent's provider id:

- OMP (`omp` and the `omp-…` profile providers): all four, by OMP's rule: exact lowercase, standing
  alone as prose. `Ultrathink`, `orchestrated`, `orchestrate.ts`, `foo::orchestrate`, `orchestrate()`
  and words inside code spans, fenced code blocks or HTML/XML tags stay plain.
- Claude Code (`claude`): `ultrathink` only, by Claude Code's own rule (`/\bultrathink\b/i` on the
  raw prompt, as in 2.1.301): any case, also inside code spans and tags, not `ultrathinking`.
- Any other provider: none.
- An agent the plugin cannot identify: all four, by OMP's rule.

"Every chat" in the settings gives every chat all four. The matching rules and the hue ranges come
from OMP 18.12.2; `client/keywords.ts` lists where each part comes from. A keyword switched off in
OMP itself (`omp config set magicKeywords.<id> false`) is still colored here; edit the table in
`client/keywords.ts` if that ever matters.

Settings (Settings → Plugins → noice-omp-magic-keywords, or ⌘K / Ctrl+K "OMP magic keywords settings"):
moving, still or off, separately for sent messages and for the text box; which chats (only where the
words act, or every chat); a preview of the four words. The dropdowns are saved on the host, so every
window of this daemon follows them.

Paseo keeps rendering everything itself. In sent messages the plugin only paints colors over the text
Paseo already shows, so copy, selection, Find, rewind and the timestamp row work as before. Over the
text box it lays a see-through copy of your text, aligned to the pixel, with only the keywords
colored; the box keeps its own text, cursor and spell check. The copy hides when its line count
differs from the text box's; a line that breaks at a different place with the same line count cannot
be detected. Only what is on screen animates; with the system's reduced-motion setting on, the colors
stay still. Every letter has the same perceptual lightness, OKLCH L 0.80 in dark themes and 0.50 in
light ones, at chroma 0.17 (less where the screen's sRGB colors cannot reach it) along OMP's hue sweep,
tuned so that no part of a word loses contrast against Paseo's message bubble.

Limits:

- Web and desktop apps only; the iOS and Android apps show the words plain.
- It finds messages, the text box and the outline preview by markers in Paseo's page
  (`data-testid="user-message"`, `data-message-text`, `data-composer-input`,
  `chat-outline-preview`) and reads the agent id from React's component props. None of these is a
  public plugin API: if a Paseo update renames a marker, that part shows the words plain; if the agent
  lookup breaks, every chat counts as unidentified and the browser console shows one
  `[noice-omp-magic-keywords]` warning.
- A provider is recognised by its id only (`omp`, `omp-…`, `claude`); one that runs OMP or Claude
  Code under another name counts as "other" and shows the words plain.
- New keywords in a later OMP release stay plain until the plugin's keyword table is updated.
- Not tested: the Electron desktop app, typing with an IME, attachment chips next to the text box, the
  fullscreen composer, page zoom, and web fonts that finish loading after the page is shown.

Cost, measured in the web app on this machine (Paseo 0.12.0, headless Chromium, 2026-10-20). A
keystroke in the text box costs 0.2 ms in the input handler (p50; 0.3 ms p90) whether or not a keyword
is present: the handler only marks the box, and the overlay is rebuilt in the frame that first shows
the new text (before: 0.9 ms at 200 characters, 6.7 ms at 20 KB, inside the event). The matcher takes
5 µs for a typical prompt and 4 ms for a 330 KB one; pasted code full of unclosed `<generics>` is
linear too (18 KB: 0.3 ms, was 13 ms; 300 KB: 6.5 ms, was 2.8 s). All letters step to their next
color on the same frame, every 30 ms, so a moving message repaints 33 times a second instead of 60
(measured: paint −38%, raster −39% per message), and between steps no
frame is requested at all unless a keyword draft is being tracked in the text box. A keyword scrolled
out of view inside a long message no longer repaints. Window focus re-reads the settings (one cached
RPC, 1–3 ms) and rescans only if a setting changed. The plugin's server part only registers the
settings; it never spawns a process.

The color rules exist only while a keyword is on screen, and only for the words shown. Each
`::highlight()` rule slows the styling of every element Paseo restyles: with all 240 rules a
streaming reply cost about ten times more style work (668 vs 68 ms/s in the lab). With no keyword in
view the plugin adds no rules (4 µs per restyled element, as without the plugin); with one word in
view it adds 60 (9–10 µs). Rules for a word go 300 ms after its last message or text box leaves the
view. Nothing runs on a timer: removed messages, tab switches, text Paseo writes into the box
itself, and theme switches are each picked up from the page's own events. The text box's `value`
setter is wrapped on that element to see Paseo's own writes; React's value tracking still runs
underneath. The plugin uses no IntersectionObserver: while one observes anything, Chromium redraws
the page on the main thread for every frame of Paseo's spinning status rings. Messages are placed by
reading their boxes after scrolls and page changes instead. With agents running and no keyword on
screen, the page does 0.6 main-thread frames a second with or without the plugin (2.5 before).
