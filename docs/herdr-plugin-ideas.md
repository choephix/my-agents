# Proposed herdr plugin ideas

Parked backlog from a 2026-08-12 brainstorm. Nothing here is started. Each entry
is self-contained enough to resume cold.

Already shipped out of the same session, for context:
`omp-fork-pane`, `pr-worktree`, `tab-namer`, `worktree-setup` (all in
`.herdr/plugins/`).

---

## Verified capability surface

Facts established by probing `herdr api schema`, the binary, and a throwaway
plugin. These are the primitives the ideas below rely on; none need
re-discovery.

- **`[[link_handlers]]`** — `{id, title, pattern, action}`. Regex over terminal
  output; clicking a match invokes a plugin action with `clicked_url` in the
  context. Nothing we own uses this yet.
- **`contexts = ["selection"]`** — action fires on selected terminal text;
  context carries `selected_text`.
- **`[[events]]`** — exactly three fields (`on`, `command`, optional
  `platforms`). Hook whitelist includes `pane.agent_status_changed`,
  `pane.agent_detected`, `worktree.created`, `worktree.opened`, `tab.created`,
  `layout.updated`. Non-blocking: a 6 s hook did not delay a 34 ms
  `worktree create`.
- **`[[startup]]`** — long-lived daemon per session (how `tab-smart-rename`
  runs its worker).
- **Pane placements** — `overlay | popup | split | tab | zoomed`, with
  `width`/`height`. `mouse_capture = true` by default, so **any overlay list is
  tappable on mobile** — this is what makes the thumb sheet viable.
- **`herdr agent list`** — returns `agent_status` (idle/working/blocked/done),
  `agent_session`, `cwd`, `tab_id`, `workspace_id`, `state_change_seq` per pane.
  A status board is a formatting problem, not a data problem.
- **`herdr agent prompt <target> <text> [--wait] [--until S] [--timeout MS]`** —
  atomically submits text + Enter honoring the pane's live bracketed-paste mode
  (so multi-line prompts arrive as one turn, unlike `send-keys`). Caveat: it
  does not track turns — `--wait` on a busy agent may return on the *previous*
  turn. Gate on `state_change_seq` from `agent get`. Pair with
  `herdr agent read <target> --source recent-unwrapped --lines N` for a full
  scripted round trip. Target by **live agent name** (`herdr agent rename`), not
  pane ID: `herdr pane move` mints a new ID, names survive.
- **`herdr pane report-metadata <pane> --source X --state-label STATUS=TEXT
  --ttl-ms N`** — per-status display labels on a pane, verified live, self-clean
  on TTL expiry. Combined with `show_agent_labels_on_pane_borders = true` and
  `agent_panel_sort = "priority"` (both already set), the existing sidebar
  becomes a status board with zero UI code.
- **Plugin config dir** — `~/.config/herdr/plugins/config/<plugin-id>/`, exposed
  as `$HERDR_PLUGIN_CONFIG_DIR`, created automatically. Layout *inside* it is
  each plugin's own invention (`tab-smart-rename/provider.env`,
  `reviewr/config.toml`, `worktree-setup/hooks/<repo>.sh`).
- **Not available:** OMP's idle recap is unreachable. It runs via
  `runEphemeralTurn` (never enters the message list) and `showStatus` (never
  leaves the TUI). Not in the JSONL, no event, no file. Knobs are
  `recap.enabled` and `recap.idleSeconds` (set to 600 in
  `~/.omp/agent/config.yml:162`).
- **Not available:** `pane_menu` / `context_menu` has no key action in
  `herdr --default-config`. The menu is mouse-only to *open* but keyboard-driven
  once open (`handle_context_menu_key_via_api` exists). Worth a one-line
  upstream issue: "add a `pane_menu` keybinding; the menu already handles keys."

Evidence base for prioritisation: 1086 OMP sessions across 198 project dirs
(830 MB, 254 in the last 7 days); `omp` is 457/1411 lines of bash history (32%);
94 hand-typed `omp --resume=<160-char path>`; live herdr state of 35 workspaces
/ 73 tabs / **85 panes** / 46 worktrees (28 nilo).

---

## 1. `shot` — screenshot into the agent prompt

**Pinned by Stefan explicitly.** "It would make me use screenshots way more
often, which I'd like very much."

Grab the newest file from the screenshot dir, inject `@<path>` into the focused
agent's prompt. Today this is done by hand:
`@"/mnt/6t/tmp/Screenshot 2026-08-07 153509.png"`. The UI-nit loop
(screenshot → paste path → describe) was 12 hits across 30 sampled sessions.

**Split:** OMP extension owns the injection, herdr action is the trigger. Only
OMP knows what "the focused agent's prompt" means and can inject without going
through terminal input. A herdr-only version has to `agent prompt` the literal
text `@/path/...` — works, but the long way around. The herdr action supplies
`$HERDR_ACTIVE_PANE_ID`; the extension does the rest.

**Mobile variant:** `~/.moshi/uploads/` already exists — "latest upload →
`@path` into the focused agent" closes the loop for photographing your own
screen.

Size: small. Highest fun-per-line of anything here.

---

## 2. `agent-board` — status + a sentence per agent

The problem: 85 panes, and attention is the bottleneck. Verbatim from sessions:
*"What's happening right now? Put me in the loop."* / *"status report"*.

The sidebar already lists agents by status. What's missing is **what each one
is**. The persisted session `title` is the *opening* title and never updates —
e.g. a session titled "Reading the Task12 brief and required docs" whose actual
in-progress todo is "Design focused production asset loading module". That gap
is the whole feature.

**v1 is not a board.** It's an OMP extension that pushes a sentence onto its own
herdr pane via `pane report-metadata --state-label`. Zero UI code; the existing
sidebar becomes the thing. `.omp/extensions/` already has seven extensions;
`session-id/session-id.ts` shows the shape. Events available: `turn_end`,
`agent_end`, `session_shutdown`, `on_agent_final_answer`. `ExtensionContext`
gives `isIdle()`, `sessionManager.getSessionFile()`, `cwd`. `$HERDR_PANE_ID` is
already in the pane env.

**Where the sentence comes from** — `ExtensionContext` exposes no LLM helper, so:

| Source | Cost | Freshness | Quality |
|---|---|---|---|
| **A.** First sentence of the final answer (`on_agent_final_answer`) | free | every turn | good — the agent just summarized itself |
| **B.** In-progress todo + last tool | free | every turn | mechanical, no "why" |
| **C.** Smol LLM recap — `omp -p --model <smol> --no-tools --no-session` | 1 cheap call | on idle only | matches OMP's real recap |
| **D.** Local tiny model (`omp tiny-models`, LFM2-350M) | free/offline | anytime | tuned for titles, likely too weak; none downloaded |

**Recommendation: A for v1, C as a manual "deepen this one" escalation.** A is
the sleeper — OMP's own recap needs an LLM turn precisely because it fires when
nothing is happening, whereas `on_agent_final_answer` fires when the summary
already exists. A also works for **working** agents, which OMP's recap
categorically cannot (requires idle ≥ `idleSeconds` and an empty editor).
`smol: cursor/composer-2.5-fast` is already configured.

For reference, OMP's own recap prompt (`prompts/system/recap-user.md`):
> The user stepped away and is coming back. Recap in under 40 words, 1-2 plain
> sentences, no markdown. Lead with the overall goal and current task, then the
> one next action. Skip root-cause narrative, fix internals, secondary to-dos,
> and em-dash tangents.

**Open questions:**
1. Sidebar labels vs overlay board. Labels are ~40 lines and reuse existing UI,
   but a collapsed sidebar gives 20–30 chars — a fragment, not a sentence. Do
   labels first; they'll reveal whether 30 chars is enough, and if not you'll
   know exactly what the board must show.
2. What a `working` agent shows: frozen last recap (misleading — says "done"
   mid-turn) vs live `working: <last tool> <target>` from `tool_execution_start`
   (honest, noisy, free). Prefer the latter; freeze the sentence only on
   `idle`/`blocked`.
3. TTL — long enough to survive absence, short enough that a killed agent
   doesn't leave a lie. Start at 6h.
4. Keep it to **live panes only**. Detached sessions are a different producer
   (see #3) — don't let the board grow into the browser.

**Second half:** on `blocked`, or on `idle` after >N minutes of `working`, fire
a Moshi notification. Answers *"Send me a notification with the outcome of the
integration test"* (`wait_ci`, 14 hits) — for every pane, not just the one you
remembered to ask about.

---

## 3. `session-picker` — resume without pasting paths

Overlay pane, fuzzy list of `~/.omp/agent/sessions/**`, scoped to the focused
pane's cwd by default with a global toggle, showing session title and mtime.
Enter → resume in a split; `f` → fork; `t` → `omp-transcript` in a pager.

Kills 94 hand-pasted 160-char `--resume` paths, plus 7 raw `omp-transcript
<giant path>` invocations. Needs its own recap generation from JSONL (no live
extension to push from) — that's the producer split from #2.

Size: real TUI. `placement = "overlay"`, one bun or Rust binary.

---

## 4. `thumb-sheet` — mobile-reachable action menu

**The answer to "I can't right-click on mobile."** One keybind → overlay pane,
numbered rows, big touch targets. Tap a row *or* press its digit.

```
1  Swap with focused pane      5  OMP: fork to split
2  Clear pane name             6  OMP: fork to sidecar tab
3  Promote pane to tab         7  Sessions…
4  Close pane                  8  Agents needing me…
```

Rows 1–4 are the orphaned/awkward menu items, executed via
`herdr pane swap-exact` / `pane rename ""` / `pane close`. Rows 5–8 shell out to
plugin actions.

Two properties make this the clean answer rather than a hack:
- Plugin actions with `contexts = ["pane"]` **already appear in the right-click
  menu**, so the sheet and the desktop menu stay one list — not two surfaces.
- Extensible in a way the built-in menu isn't (it will never grow a "sessions"
  row).

**Most of the pane menu is already keybound** — `prefix+c` new tab,
`prefix+shift+p` rename, `prefix+v` / `prefix+minus` split,
`prefix+x` close. The genuine orphans are only **swap with focused pane** and
**clear pane name**. Sidebar: `open_worktree` and `remove_worktree` have key
actions that ship *unset* — two free lines in `config.toml`.

Ergonomics: `prefix+shift+f` is three soft-keyboard motions. Add direct
`ctrl+<letter>` chords alongside the prefix ones for hot actions — direct
`ctrl+letter` is the most reliable class per herdr's own docs, and Moshi's key
toolbar surfaces ctrl.

Size: ~80 lines, same overlay-TUI shape as #2 and #3 — build one, the others
are re-skins.

---

## 5. Moshi `omp` hook — highest value, no code

**Do this before any plugin here.** `moshi-hook status` shows hooks for
`claude`, `codex`, `gemini` (current) and `opencode`, `antigravity`, `cursor`
(stale) — but **no `omp` row**, despite OMP being 32% of shell history and
`moshi-hook install --target omp` being accepted. The binary carries real OMP
support: `install.ompConfigRoot`, `gateway.ompTranscriptBlob`,
`gateway.ompBlobPathForTranscript`, `tui.ompQuestionAnswerKeys`,
`MOSHI_HERDR_PATH`, `"invalid OMP profile %q"`.

That means OMP questions are answerable from the lock screen, transcripts push
to the phone, and moshi-hook is herdr-aware.

```bash
moshi-hook install --target omp
moshi-hook service install && moshi-hook service start   # daemon is dead; no systemd unit exists
```

Then delete `skills/unorganised/moshi-notification/SKILL.md` — a hand-rolled
`curl` that only fires when you remember to ask.

Also dormant: `moshi-hook diff` serves a local git diff viewer
(`/api/source/tree`, `/api/source/blob`, `/api/git/stage|unstage|discard`,
`web/diff`) — a real mobile code-review surface. And `moshi-hook servers` probes
local TCP listeners for SSH preflight, i.e. the nilo dev server can be reachable
from the phone.

**Free `config.toml` wins for mobile** (nothing there is mobile-tuned today):

```toml
[keys]
focus_agent = "prefix+alt+1..9"
last_pane   = "prefix+tab"

[ui]
mobile_width_threshold  = 64
sidebar_start_collapsed = true
sidebar_collapsed_mode  = "hidden"
hide_tab_bar_when_single_tab = true
pane_gaps = false
```

Plus the one that matters most: **`open_notification_target = "prefix+o"`** —
jumps to whatever fired the last notification. Moshi push → open herdr →
`prefix+o` → standing on the agent that needs you. That's the whole mobile loop
in one key, and it only pays off once the omp hook is installed.

---

## 6. `council` — one prompt, N models, tiled

One action → prompt file in an overlay editor → N panes, one per model, each
`omp --model <m> @<file>`, tiled, plus a moderator pane.

Currently typed by hand, three near-identical 220-char lines per review:

```
omp --model anthropic/claude-fable-5  @/tmp/spinoff-pr73-social-role-review.md "You are the FABLE reviewer…"
omp --model openai-codex/gpt-5.6-sol  @/tmp/spinoff-pr73-social-role-review.md "You are the SOL reviewer…"
omp --model anthropic/claude-opus-5   @/tmp/spinoff-pr73-social-role-review.md "You are the OPUS reviewer…"
```

Each prefixed by the same 90-char `export PATH="…mise/shims:…bun/bin:$PATH";`
incantation the plugin would bake in once. Model roster in
`$HERDR_PLUGIN_CONFIG_DIR`.

Four existing *skills* are rituals of this shape — `council`,
`adversarial-omp`, `panel-review`, `pr-review-two-omp` — i.e. an LLM
re-deriving deterministic steps every time. Moderation loop is
`agent prompt --wait` + `agent read --source recent-unwrapped`.

---

## Also considered

- **`pr-triage` link handler** — `[[link_handlers]]` on
  `https://github\.com/[^/]+/[^/]+/pull/\d+`: click a PR URL in any pane →
  worktree + tab + OMP with the `pr-review-two-omp` prompt. Largely superseded
  by the shipped `pr-worktree` plugin; the *link handler* trigger is the
  remaining novel part.
- **`ask-selection`** — `contexts = ["selection"]`, hotkey on selected text →
  sent to the focused OMP pane as a quoted question via `agent prompt`. Natural
  for stack traces and log lines. ~20 lines, unused context type.
- **Dictation router** — Moshi has on-device Whisper and Stefan already works
  by voice. The mobile failure mode isn't speaking, it's landing focus on the
  right pane out of 85. An overlay that picks the target agent from a list, then
  `agent prompt`s it, removes the focusing step. Highest-value mobile-specific
  idea.
- **Invert approval posture by device** — history is wall-to-wall
  `omp --auto-approve`, correct at a desk. On the phone it makes you a
  spectator. With Moshi omp hooks installed, dropping the flag for
  phone-initiated work turns dead time into lock-screen supervision. A
  `[[keys.command]]` "launch supervised OMP here" makes it one tap.
- **Thumb mode toggle** — one action: zoom pane + collapse sidebar + hide tab
  bar, press again to restore. `mobile_width_threshold` only triggers on width,
  so landscape phone / tablet lands in the desktop layout you don't want.
- **Dev-server-to-phone** — action on a pane running a dev server:
  `moshi-hook servers`, push the reachable URL as a notification.
- **`worktree.removed` teardown** — symmetric `.herdr/teardown` hook in
  `worktree-setup` (drop a `node_modules` symlink, kill a bound dev server).
  ~4 extra lines. Only worth it if the setup script leaks anything.

## Explicitly rejected

- **Generic `git`/`gh` wrapper.** `git` is 104 uses but spread thin across
  normal subcommands — no repeated incantation worth encoding. `lazygit` (10)
  already covers it.

## Cost note

Only `omp-fork-pane` and `worktree-setup` are plain shell. Ideas #2, #3, #4 and
#6 want a real TUI process, so they follow the `tab-smart-rename` shape —
`[[build]]` step, bun or a static binary, `[[startup]]` daemon. **That's the
real cost, not the herdr wiring.**

## Unfinished thought

Stefan's message was cut off mid-sentence: `"- on right click menu - sh"`.
Never resumed.
