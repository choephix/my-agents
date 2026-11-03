Bots: chat-looking hubs where every message starts its own thread, a fresh OMP agent with the
bot's system prompt (built on Paseo 0.14.0, plugin only). UI per the mock, variant A:
`~/www/webshare/pages/bots-mocks/index.html`. Effort map with the decisions: the index
workspace's `.scratch/paseo-bots/map.md`.

## Pieces

- **Bot**: name, emoji, **Works in** folder, **Runs on** provider, system prompt (`bots.json`). Each bot owns a
  background workspace (`background: true`), so its agents stay out of the sidebar and History.
  No field is required: an empty name becomes the emoji's animal (🐸 → Frog, else
  "Bot"), an empty folder `<Folder for new bots>/<name>` (setting, default `~/bots`), and a missing folder is created (relative
  paths start at home). Errors show the server's sentence, without Paseo's `requestType=…` tail.
- **Runs on**: `omp` (default) or an enabled provider whose `config.json` entry has `extends: "omp"`
  (e.g. `omp-nilo`, OMP with another profile). The API doesn't report `extends`, so the server
  reads the daemon's `config.json`. The picker shows only when there is more than one.
- **Delete bot** (Edit form, bottom left; one confirm step): marks the hub `noice-bots.role=deleted`
  (Paseo tells only the deleting connection about a delete; a label change reaches every client, so
  the tile goes at once), stops running threads, then archives and deletes every thread agent and
  the hub (archiving first, so open tabs close at once), removes the thread session files, rows and
  saved copies, archives the workspace, and removes its Paseo project if no other workspace is in
  it. The Works-in folder stays. The app then opens the next bot's hub, else the most recently
  active workspace.
- **Closing the hub's tab** archives the hub (Paseo does that to any closed agent tab). The bot
  stays in the strip: the list includes archived hubs, and pressing the tile first unarchives the
  hub (`bots.restore-hub`, Paseo's `refreshAgent`), then opens it. A thread change also brings a
  closed hub back (below).
- **Hub**: an agent of the plugin's provider `bots` in that workspace. It runs no model: a message
  becomes a thread, the hub's own turn ends at once, and the thread shows as a plugin row.
  The hub's model, thinking and mode pickers list the bot's provider's
  (`listProviderModels(<provider>)`); the pick is committed per hub and copied onto each new
  thread. Default: Claude Opus 5.5 (`anthropic/claude-opus-5-5`) at high thinking; the provider's
  default if the catalog lacks it.
- **Attachments**: the hub takes images (`prompt.image`) and uploaded files. Images are written to
  `media/<thread>/<n>.<ext>` before the thread is queued; the thread gets the images and, under
  its question, the paths of everything attached. The hub row says `📎 N attached`; a message
  with only attachments is titled `📎 Attachment`.
- **Thread**: an agent of the bot's provider with the bot's prompt plus a hint to call
  `thread_progress` (and set its `title` on the first call), labelled `noice-bots.thread=<botId>`.
  Its id is the thread id. An agent a thread starts (Paseo's `create_agent`) stays up when the
  thread sleeps (lab, 2026-11-01).
- **Title**: the question's first line (cut at 48 characters) until the thread sends
  `thread_progress` with `title` (2-5 words; `note` and `title` are both optional, one is needed).
  Then Bots renames the agent in Paseo (`updateAgent` name, kept in Paseo's record, so the chat tab
  shows it after sleep and wake) and stores it on the thread row (`named: true`): the hub block's
  bold first line, the read tab's heading, search, and read-only threads. A later title replaces it.
  The read tab's own label stays `🌙 Thread`: a plugin panel's title is fixed at registration.
  Paseo stores one `title` per agent with no mark of whether it was chosen or derived, so a thread
  that never names itself and asked a one-line question under 49 characters has exactly Paseo's
  first-prompt placeholder as its title.

## Hub rows

Paseo draws your message (its own `user_message` row); the plugin row under it is the thread
block: the answer cut to ~7 lines (a longer one fades out over its last 96 px, so the fade starts on the line before: on web a CSS
`maskImage` fades the text itself; native has no mask, so a `linear-gradient` into `surface0`,
`surface1` while hovered, is painted over it), a footer (`1 follow-up · 14:05`; unread: a green dot in place
of `↳` and a green `new`), one press target, then 80 px of space before the next thread (a hub turn
has no Paseo turn footer, so the last block would otherwise touch the composer).
Running: spinner, timer, latest `thread_progress` note, **Open ›**. Queued: `queued`, not pressable.
A thread that named itself shows its title in bold at the top of the block.

**Settle** (finished blocks, footer, before **Read ›**; one press, no confirm): you're done with the
thread. It becomes read, its row stores `settled: <ts>`, your question above it is hidden, and the
block is re-emitted as one line (`✓ title · 14:05`) at 30% opacity (full while hovered or pressed),
with no space after it, so settled threads stack as a list of faint lines. **Unsettle** brings the
question and the full block back; pressing the line opens the read tab. Settled threads are out of
Unread, the sidebar's green dot and Mark all read (they are read); Search still finds them. A
follow-up (`turnStarted`) or **Wake** clears `settled`. Nothing is deleted, and read-only after N
days is unchanged.

Hiding the question (`client/questions.ts`): a re-emit can't change Paseo's `user_message` row
(`collapseByIdentity` merges only tool calls and plugin rows), so a client timeline transformer on
`user_message` drops the rows whose `messageId`/`clientMessageId` is a settled thread's
`questionId`, and leaves every other row to Paseo (images, time, copy button unchanged). A thread
stores its `questionId` when asked (the message's `clientMessageId`, which Paseo keeps as the row's
`messageId`); a thread asked before that gets it on its first settle, from the hub's `user_message`
right before its block. The client learns the hidden set from `bots.settled-questions` at start and
from each drawn block. Paseo transforms a row once and caches the result per transformer
(`projectPluginTimelineItems`), so a change registers the transformer again: that makes Paseo
re-transform the rows of every open chat once per settle or unsettle (batched for Settle all read).
Another device's settle shows once that device draws the block.

Each bot has **one hub agent for its whole life**. Paseo keeps its own durable copy of a hub's
timeline and ignores what a reopened plugin session replays (`historyPrimed` in
`agent-manager.ts`). So:
- a thread's block has the id `thread-<id>`; a change re-emits it, and Paseo merges rows with the
  same plugin id in place (`collapseByIdentity` in `timeline-projection.ts`, `appendPluginTimelineItem`
  in the app), so a follow-up, a read or a sweep updates the block where it is;
- a change while no hub session is ready (plugin reload, idle cleanup, the first second after an
  open) goes on the bot's `redraw` list in `bots.json`, and a closed hub is reopened
  (`refreshAgent`). 1 s after a hub session opens (`#drawHub`) it draws only that list; an open
  never redraws the whole history;
- a live question is Paseo's own row; the hub's echo (same `clientMessageId`) only gives it an id.
  A provider may also emit `user_message` rows on its own: one without `clientMessageId` is
  recorded as is. The one-off move to one hub per bot (2026-11-02) drew every existing thread
  into the new hub this way, under its question. A `user_message` has no identity in Paseo's
  projection, so emitting one twice shows it twice.

**Growth:** the hub grows without limit, and every block change appends a row to Paseo's copy
(merged when read). A size cap later would mean a new hub agent with the old one's picks, drawn
with the newest N threads under their questions (emitted as above), the old hub deleted.

## Sleep and wake (gate 2)

- A thread's turn ends → the plugin saves its copy and **archives** it: the OMP process exits
  (measured: `omp --mode rpc-ui` gone ~1 s after the turn; archive at the same second).
- Exception: a thread whose chat the user opened (**Open ›** on a running block, or **Wake**) is
  `awake` (saved on its row, so it survives reloads) and doesn't sleep at turn end: archiving
  closes an open chat tab. Closing that tab archives it (Paseo), and the `agent.archived` hook
  clears `awake`.
- **Wake**: `refreshAgent` restores the archived agent with its history; the chat opens as a
  normal tab and takes follow-ups (~3 s on the lab).

## 🌙 Read tab

One workspace panel per bot workspace, `🌙 Thread`. A finished block calls `showThread`
(in-memory handoff, keyed by workspace) then `openPanel("read")`; the panel moves the id into its
tab state, so a reload keeps the thread. It shows the **saved copy** (your messages and each
turn's final reply, text only, from `copies/<thread>.json`), reloaded every time the tab is opened
again (`revision`). Reading never loads the agent. **Wake this thread** at the bottom; read-only
threads show a note instead. The plugin can't close its own tab when Wake opens the chat, so it
stays (allowed fallback).

## Scale

Built for a handful of questions a day per bot; the hub keeps all of them (see Growth above).

- **Cap** on threads running at once per bot (setting, default 4); the rest queue and start in
  order.
- **Search** (hub header menu): every word in the questions and answers, newest first, 50 max;
  saved copies are read only for threads with follow-ups or cut answers.
- **Unread threads** (hub header menu): the unread threads over the read-only period, newest first;
  the same set the sidebar's green dot counts. Pressing one opens its read tab, which marks it read.
- **Mark all read** and **Settle all read** (hub header menu); the second settles every finished
  thread that is read.
- **Read-only after N days** (setting, default 7), checked on load and hourly: the agent is
  deleted, its session file too (only inside the plugin's sessions folder), the saved copy stays.
- **Hidden threads**: History lists no background-workspace agents. `noice-past-sessions` lists
  Paseo agents without `includeBackground` and OMP files under `~/.omp`; thread session files go
  to `~/.paseo/plugin-data/noice-bots/sessions` (`PI_CODING_AGENT_SESSION_DIR`).
- **Start-up**: on load Bots finishes turns that ended while it was down, starts queued threads and
  sweeps read-only threads (then hourly). A starting daemon loads its
  plugins before it writes its address to `paseo.pid`, so this step retries its connection with
  backoff (250 ms doubling to 5 s) for up to two minutes, then logs one line and gives up until
  the next plugin reload.

## Sidebar

- Wide: a strip of emoji tiles under Schedules (sidebar header item). The tile of the bot whose
  workspace is on screen is highlighted; others are dimmed until hover. Web reads the workspace id
  from the URL and follows it through the Navigation API (`currententrychange`, no polling), so
  opening any other workspace or screen unselects the tile. Native has no URL, so there the bot
  opened last from the strip stays highlighted. Blue dot `#60A5FA`: a thread running; green:
  unread answers. **+** (New bot) sits at the right end of the row (of the last row, if the tiles
  wrap; on phones, the end of the scrolled content once the tiles overflow).
  A grey robot before the strip, setting **Show robot icon before bots** (on).
  The row is 28 px like the rows above: the robot sits on their icon column, the tiles start where
  their labels do. Tiles are 24 px with 1 px between, and the 17 px emoji's text box is the tile
  (line height 24), so no state moves or resizes anything: hover and the selected bot only raise
  the emoji from 55% to full opacity, and the selected tile gets a background. Web: the opacity
  eases 120 ms in, 240 ms out; none under `prefers-reduced-motion`. Until the robot setting and
  the first bot list have come, the strip is an empty 28 px row, so the tiles arrive in one step.
  The selected tile uses the theme's `border` colour, since `surface2` is the light sidebar itself;
  the badge ring uses the sidebar colour (the darker of `surface0`/`surface2`). Keyboard focus draws
  an accent outline (web: only on `:focus-visible`, so clicks don't).
- Phone: the same strip, sized for fingers: a 36 px row (the phone rows' height), 32 px tiles, a
  22 px emoji, the robot on the rows' 18 px icon column, the tiles starting where their labels do.
  It doesn't wrap: past the drawer's width it scrolls sideways (no scroll bar). Scrolling is on
  only while the tiles overflow, so a left swipe over a strip that fits still closes the drawer;
  on Android a strip that scrolls takes the swipe once it moves. A tile or **New bot** opens
  through the item's own `openScreen`, which closes the drawer first. Checked 2026-11-03 in the
  web app at phone width: a tap closes the drawer and opens the bot; at 180 px the strip scrolls
  (166 of 211 px shown), at 390 px scrolling is off. The Android app itself is untested.
- The counts come from a label on each hub agent (`noice-bots.counts = running,unread`, debounced)
  read through one agent-list subscription, so the client polls nothing.
- Each bot workspace header: **System prompt** (the bot form; changes apply to new threads) and a
  menu with **Unread threads**, **Search threads**, **Mark all read** and **Settle all read**.

## The one session-open hook

`agent.session_open`, for bot threads only (`noice-bots.thread` label), adds the
`thread_progress` tool and sets `PI_CODING_AGENT_SESSION_DIR`. Needed because agent tools are only
added there. Cost: every agent on the daemon reopens when this plugin reloads.

## Storage (`~/.paseo/plugin-data/noice-bots/`)

`bots.json`; `threads/<bot>/<YYYY-MM-DD>.json` (rows split by the day they were asked: internal,
the read-only sweep walks days; a day loads on demand and stays cached);
`copies/<thread>.json` (saved copy and where its row lives); `media/<thread>/` (attached images);
`sessions/` (thread OMP sessions).

## Measured cost of a fresh thread (lab, Claude Haiku 5.5, 2026-11-01)

First request of every thread: ~32.6k tokens. The first thread wrote all of it to the cache
(32,613 written, $0.0065); every later thread, including another bot's and one started 1 min later,
read 29,459 from the cache and wrote ~3.2k (bot prompt, folder context, question): ~$0.001. The
29.5k cached part is OMP's own system prompt and tools, shared by all bots. OMP writes with a
1-hour cache lifetime (`cttl.ephemeral1h` in its usage records), and each read renews it: a thread
61 min after the previous probe still read 29,459 (another thread had run 33 min before it). After
an hour with no thread, the next one pays like the first.

## Not possible as a plugin

- The workspace header subtitle ("6 threads · 1 new answer") and the composer placeholder ("Ask
  Writer…") are Paseo's.
- A running thread is a tab in the bot's workspace (Paseo shows every unarchived agent as one); it
  goes when the thread sleeps.
- Codex ignores Paseo's per-agent system prompt, so threads run on OMP providers only. Tool calls
  aren't in the saved copy.

## Screenshots

`screenshots/`: `hub`, `read-tab`, `waking`, `thread-awake`, `strip`, `strip-running`,
`strip/` (before/after, light/dark, 1×/2×: rest, hover, selected, running, focus;
`states-before/` and `states-after/`: the fixed-geometry change, page load through focus),
`queued`, `read-only`, `search`, `new-bot`, `edit-bot`, `settings`, `history`,
`phone-hub`, `phone-drawer`, `phone-bots-menu` (the old phone row's sheet), `phone-strip` and
`phone-strip-scrolled` (the phone strip, at rest and scrolled to its end), `phone-read`, `writer-hub`, `one-hub-lab` (two
questions, a follow-up on the first, a plugin reload), `one-hub-scribe` (after the move to one hub),
`settled` and `phone-settled` (settled threads stacked above an unsettled one; phone: after an
unsettle), `settled-hover` (a hovered settled line).
