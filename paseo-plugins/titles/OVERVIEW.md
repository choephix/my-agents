# Titles

Short agent-tab titles: one word (two only when one word means nothing), Title
Case. Workspace titles in the style of the project's other workspaces (see
[Workspace titles](#workspace-titles)). No tab or workspace icons.

## Three situations, three instructions

Claude Haiku (or the OMP model set in Settings, see [Model](#model)) gets the
same title rules in every situation plus one short task per situation. All of
it is in `server/prompts.ts`: edit `RULES` for what a good title is, or one of
`first` / `every` / `manual` for one situation. In all three it also sees the
workspace's other tabs (below).

| Situation | When | Task |
| --- | --- | --- |
| `first` | After a reply, while the tab still has Paseo's placeholder name | Name the subject, or keep the placeholder if there is none yet ("hi") |
| `every` | After a reply, on a title Titles chose | Keep it while it names the subject, even if a sibling's title is the same or similar; rename when the subject moved |
| `manual` | Stefan presses Retitle | Always a new title, different from the current one and up to five earlier rejected ones |

## Sibling tabs

Before each Haiku call Titles lists the other agents of the same workspace
(not archived, no sub-agents, not the tab being titled) and passes them as
`siblings`. Haiku is told: "Like a hand-named sibling would, your title must
make clear what sets this conversation apart from the tabs in "siblings": its
own subject or angle, not a synonym or near-twin of theirs." So a second
catalog tab about duplicate rows could become *Deduplication*, not *Catalog*.

Each sibling goes in as one of:

| Sibling's title | Passed as |
| --- | --- |
| Equals its `titles.named` label (a title Titles chose) | the bare title, `"Catalog"` |
| Paseo's placeholder: equals its `titles.unnamed` label or the first line of one of its opening prompts (user messages among its first 20 timeline items) | `{"title":"Hello, a question follows","note":"placeholder: first prompt line, not a title"}` |
| Anything else, including a Titles title later renamed by hand | `{"title":"Product Import","note":"named by hand"}` |

Only the last kind of title needs the sibling's timeline. The first-prompt lines
are cached in memory by agent id, since a first prompt never changes, so each
sibling's timeline is read at most once per plugin run (again only after a
failed read). In `every` mode a sibling clash alone never renames a tab: the
task tells Haiku to keep a title that still names the subject, so two tabs
don't keep renaming each other. If the lookup fails, Titles logs
`titles: siblings of <id> unavailable: …` and titles without siblings.

## Automatic titles (Settings → Plugins → titles → Titles)

The setting **Automatic titles**:

- **Off**: titles change only when you retitle a tab.
- **After the first reply** (default): a new tab is named once its conversation
  has a subject. If the first reply has none ("hi, quick question"), the next
  reply tries again.
- **After every reply**: as above, and a tab Titles named is checked after each
  reply and renamed when the subject moved on. One model call per reply
  (about 2–5 s, on a subscription login).

The same screen holds **Automatic workspace titles** (see
[Workspace titles](#workspace-titles)), **Model provider** / **Model** and
**Timeout** (see [Model](#model)).

**Names you set by hand are never changed automatically.** Titles only manages
two kinds of names: Paseo's placeholder (the first prompt line: first nonblank
line, whitespace collapsed, cut to 60 characters) of a tab created while Titles
runs, and a title Titles set itself. It remembers the latter in agent labels
(`titles.named`, and `titles.unnamed` for a placeholder still waiting for a
subject), so this survives plugin reloads and daemon restarts. Renaming a tab
by hand, at creation or later, takes it out of automatic titling; Retitle hands
it back. Every rename is a compare-and-set, so a rename while Claude thinks
wins.

Not adopted: tabs that existed before Titles was loaded with this version
(until you Retitle them once). On daemon 0.11.4, agents started from the CLI
(`paseo run`) had no first prompt in their timeline and stayed untouched; on
0.12.0 one such agent was titled normally (2026-10-20, one observation).

## Retitle on demand

Three triggers:

- **Ctrl+Shift+Alt+T** (web and desktop): applies to the selected agent tab of the pane you last clicked or focused (or the only pane). Terminal tabs, open dialogs, AltGr and IME input are left alone.
- **Ctrl+K / ⌘K → Retitle this tab.** On phones the Command Center is ☰ → **Search**.
- **`/retitle`** in the composer. It's a plugin command, so nothing is sent to the agent.

Retitling always picks a new title: pressing it means you dislike the current
one, whatever it is. The prompt asks for a title that names what the **latest
user message** is about and differs from the current title and the tab's last
five rejected titles (remembered until the plugin reloads), so pressing again
gives yet another one.

### Feedback

Nothing goes into the conversation. While the model thinks (2–5 s), the check
shows in the same tick as the trigger:

- **Web and desktop:** a small spinner replaces the agent tab's icon (in every
  pane that shows the tab), drawn in the theme's foreground color.
- **Where the tab isn't on screen** (phone layouts, the native apps): a
  **Retitling…** toast with a spinner at the top.

The indicator ends in the same frame as one Paseo toast that reports the
outcome (it replaces the Retitling… toast):

| Outcome | Toast |
| --- | --- |
| Renamed | ✓ `Renamed to Pagination (was Sorting)` (the "was" part only for short old names) |
| Nothing to name | ⚠ `Couldn't retitle: The model found no subject to name` |
| Renamed by hand meanwhile | ⚠ `Couldn't retitle: The tab was renamed meanwhile; that name stays` |
| CLI missing / slow / broken | ⚠ `Couldn't retitle: Claude CLI not found on the daemon's PATH` (or `OMP …`; `took longer than 20 s` with the Timeout setting's value, or `failed:` and its first error line) |

Pressing a trigger again while a check is running does nothing; the spinner
shows that a check is already under way. A retitle pressed while an automatic
check of the same tab runs waits for it (2–3 s) and then names the tab. Two
clients retitling the same tab at once get `Already retitling this tab`.

Toasts are a hook-only plugin API, so a composer pill's icon component lends
one. On web that pill is hidden by CSS (`button:has([data-testid="titles-retitling-pill"])`);
on native apps it can't be hidden, so a faint **Retitling…** pill also sits
above the composer there. The Retitling… toast's spinner uses the host's
`icon` toast option, which the plugin's `ToastOptions` type doesn't declare;
if a Paseo version drops it, the toast is text-only.

### Why Ctrl+Shift+Alt+T

On non-Mac systems Paseo binds **Ctrl+Alt+T to Cycle theme**, and its
keyboard listener runs before any plugin's, so a plugin can't take that combo
over (an earlier version tried; the theme switched as well). Paseo matches
shortcut modifiers exactly, so adding Shift avoids both Cycle theme and
Ctrl+Shift+T (new terminal). Chrome doesn't use Ctrl+Shift+Alt+T either.
Keyboard layouts where Ctrl+Alt acts as AltGr are skipped (AltGraph check).

## Workspace titles

A new workspace is named once its first tab has a prompt; **Ctrl+K / ⌘K →
Retitle workspace** or **`/retitle-workspace`** in any of its composers names
any workspace on demand (Paseo 0.12 has no plugin slot in the sidebar row's ⋯
menu). The setting **Automatic workspace titles** (on by default, next to
*Automatic titles*) switches the automatic part off; retitling on demand works
regardless. Code: `server/workspaces.ts`, policy in
`shared/workspace-titles.mjs`, prompts in `WORKSPACE_PROMPTS`
(`server/prompts.ts`).

**What Haiku sees.** The first tab's conversation, the project's name, and two
lists: `project`, the project's other titled workspaces, marked like sibling
tabs (Titles' own bare; a first-prompt placeholder or a hand-chosen name with a
note), and `elsewhere`, the 40 most recently active titled workspaces of other
projects, each with its project's name. Archived workspaces and projects and
background workspaces aren't listed. There are no format rules: naming habits
(a prefix for reviews, how projects are told apart) come only from the lists.
A fitting habit's format is copied exactly (fixed words, order, casing,
punctuation) with only the identifying part filled in; with no habit, one to
three Title Case words. A retitle on demand also gets the
workspace's tab titles and must differ from the current title and up to five
rejected ones. As for tabs, the answer is used exactly as written. A failed
lookup is logged (`titles: siblings of workspace <id> unavailable: …`) and
the workspace is titled without siblings.

**When.** Titles tracks workspaces created while it runs (`workspace.created`,
background and internal ones excluded). The first turn start of one of their
tabs (not sub-agents or Paseo's internal agents) whose prompt is readable
triggers one Haiku call; if the prompt isn't in the timeline yet, the turn's
end tries once more. If the prompt has no subject yet ("hi"), the next turn
tries again. A workspace created empty waits for its first tab. Once Titles
has named it, automatic titling never touches it again.

**Ownership.** Workspace labels are visible coloured chips, so the title
Titles chose is kept in `<PASEO_HOME>/plugin-data/titles/workspaces.json`
(`{"version":1,"workspaces":{"<workspace id>":"<title>"}}`, mode 0600, written
atomically; not under `plugins/`, which Paseo deletes with npm/Git installs).
A workspace whose title differs from its entry was renamed by hand and shows as
hand-named to Haiku. Entries outlive archiving. If the file is unreadable, it
counts as empty: Titles' earlier titles then look hand-named, never the
reverse.

**Paseo's own title.** Paseo gives a new workspace its first prompt line as a
placeholder, generates a title in the background, and applies it only while
the title is still empty or that placeholder. If Titles lands first, Paseo
drops its title; if Paseo lands first, Titles replaces it. Paseo marks neither
its own titles nor hand renames, so Titles watches the workspace's title
changes (a `workspaces.list` subscription, started with the first
`workspace.created`) and treats a title as Paseo's only if it is the **first**
change away from an empty or placeholder title, **within 3 minutes** of
creation, and still current. Anything else (a second change, a later one, a
change from a title given at creation) is hand-named and left alone; the log
reads `left hand-named "…"` or `skipped: renamed meanwhile to "…"`.

Residual risks: a hand rename made within 3 minutes, while the placeholder
still shows and Paseo's title hasn't landed, looks like Paseo's and is
replaced. If Paseo's title landed before Titles first read the workspace (in
practice it takes seconds to generate), it looks hand-named and stays. Paseo
has no conditional rename, so Titles re-reads the title right before writing;
a hand rename in the milliseconds between is overwritten. Workspaces created
while Titles wasn't running, or still waiting for a prompt across a plugin
reload or daemon restart, are not adopted: retitle them on demand.

Feedback on demand: a **Retitling workspace…** toast shows at once (about
0.2 s), then one toast with the outcome (`Workspace renamed to Search Ranking
(was Search Results)` or `Couldn't retitle the workspace: …`); the new title
shows in the sidebar and header. The toast is lent by a pill on the composer of
the tab the trigger came from (hidden on web, like the tab path's), so both
triggers are offered only while an agent tab is focused: not from a terminal
or file tab.

Which tab is "first": the earliest tab, archived ones included, whose history
can be read without starting it (see *Speed*). If the real first tab is a
stored (not loaded) agent, the next readable one stands in. A workspace whose
only tab is a sub-agent of a tab elsewhere has no first tab of its own; Retitle
workspace then names it from its current title and siblings, and answers
`Nothing to title yet` if it has no title either.

## Model

Settings → Titles → **Model provider** picks which CLI asks the model:
**Claude Code** (default) or **OMP**. Under OMP a **Model** field takes an OMP
model as `omp models` lists it (`provider/id`) or a role (`@tiny`); it is saved
with **Save**, so a half-typed name never names a tab. Default
`anthropic/claude-haiku-5-5`, the model the prompts were tuned on. Both
providers get the same prompt and request, and the answer is parsed the same
way. Each decision reads the setting, so a switch applies to the next title.
A dropdown filled from `omp models --json` was tried and dropped: Paseo
0.12's settings menu doesn't scroll, so of its 82 entries (Cursor and
OpenRouter left out) only the first ~30 were reachable on a 900 px window.

Both CLIs run with the `ANTHROPIC_*`/`CLAUDE_CODE_USE_*` variables stripped,
so no inherited API key or 3P routing is used. If the daemon's service PATH
omits `~/.local/bin`, Titles adds it so native installations still work. On
Windows, an npm global install's `claude.cmd` shim is skipped for the
`claude.exe` it wraps, since Node can't run `.cmd` files without a shell; each
PATH folder is checked for a native `claude.exe` first, so whichever install
comes first on PATH runs. Other installers (pnpm, Volta, bun) are not looked
up. No retries;
**Timeout** (20 s default; 20 / 40 / 60 / 120 s, any whole 5–120 s in the
settings file) kills the CLI of either provider, read for each request so a
change applies to the next one. Errors name the provider: `Claude CLI failed:
…`, `OMP failed: …` with the CLI's first error line.

**Claude Code**: `claude -p --model haiku` through Stefan's subscription
login, with `--safe-mode`, no tools, no MCP, no saved session. It takes about
1.5–3.5 s end to end (median ~2.5 s), most of it Haiku's thinking; see
*Speed*. The CLI asks for adaptive thinking at medium effort, with the
thinking text omitted (seen in a captured request, 2026-10-22).

**OMP**: `omp -p --no-session --no-title --no-tools --no-lsp --no-skills
--no-rules --no-prewalk --no-extensions`, through OMP's own logins. Its flags
don't isolate the call: even with `--system-prompt`, OMP adds a
`<project-context>` block (workstation, `~/.omp/agent/AGENTS.md`, its
completion rules), a date and working-directory reminder, magic-keyword
notices ("ultrathink" in the conversation) and the contents of any `@path`
the conversation mentions. So Titles writes a small OMP extension,
`<PASEO_HOME>/plugin-data/titles/omp-isolation.mjs` (source in
`server/model.ts`), and loads only it (`--no-extensions -e …`). It replaces
the whole system prompt with the plugin's (passed in
`PASEO_TITLES_SYSTEM_PROMPT`), keeps only the user message, and drops the
reminder from the provider request. If OMP can't load the extension, it goes
on without it, so Titles drops that answer and reports `OMP failed: Failed to
load extension …`. A captured request (Anthropic) then holds only the system
block Anthropic requires (`You are Claude Code, …`), the plugin's prompt and
the request JSON, no tools. Isolation probes checked that the model received no
user, machine, date or working-directory context beyond the titling request.

Thinking: `--thinking medium` plus `omitThinking: true` (in
`plugin-data/titles/omp-overlay.yml`, passed with `--config`), the request
the Claude CLI makes. A role keeps its own level (`@tiny` is low). With
thinking summaries on, calls took 5.4–6 s; omitted, 2.4–3.5 s. OMP runs from
the data directory: from the temp directory (25,000 entries here) its
repository scan took 1.8 s of its 2.2 s startup; now ~0.45 s.


The rules (`server/prompts.ts`) ask for one distinctive noun that sets this
tab apart from the `siblings`, two words at most. They
rule out words that fit any tab (Help, Fix, Bug, Task, Features, Setup) and the
workspace name, and keep identifiers' own casing (iOS, eBPF). The prompt alone
controls style: the title is used exactly as Haiku wrote it (only trimmed),
with no length, casing or punctuation checks in code. Answers are strict JSON;
one that isn't JSON or carries neither a title nor `keep` is an error.


The model sees a provider-neutral excerpt of the Paseo timeline: the last 12
user and assistant messages. Each agentic turn's assistant messages are merged
into one entry, and each entry is capped at 1,200 characters, keeping its start
and end, so a long or tool-heavy turn can't push the user's request out.

Renaming uses the daemon SDK's local `updateAgent` RPC over the loopback
endpoint, which is the same call as `paseo agent update --name`. The public
plugin API has no rename operation.


## Install, reload, disable

```sh
paseo plugin install ~/workspace/my-agents/paseo-plugins/titles
paseo plugin reload titles      # after edits; then refresh the app
paseo plugin logs titles        # one line per automatic decision and per retitle
paseo plugin disable titles
```

## Speed (audit 2026-10-20)

- Over 98% of the wait is the CLI. The plugin sets
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` for the Claude CLI (no telemetry, update or
  flag traffic): the CLI now exits 15 ms after answering instead of ~700 ms,
  about −0.7 s per call (wall median 3.2 s → 2.5 s, same model and answers).
  Live: first-reply titles median ~2.5 s (was 3.9 s), hotkey retitle 2.5–3.2 s,
  Retitle workspace 2.8–4.8 s. Key → tab spinner 5–7 ms; phone tap →
  Retitling… toast ~0.1 s.
- Plugin's own work: 10–20 ms warm per decision. Parallelising its reads and
  listing once per Retitle workspace saved 0–8 ms and were reverted as churn.
- Timelines of other tabs are read only when the tab is loaded in the daemon
  or archived: daemon 0.12 serves a timeline by loading the agent, and a stored
  agent would be resumed with its provider process (~1.3 s, ~250 MB, never
  unloaded). A stored sibling that still shows a pre-Titles placeholder is then
  described as named by hand.
- A new tab's placeholder is recorded in `titles.unnamed` before Claude is
  called, so a failed call (weekly limit, timeout) retries on the next reply
  and sibling lookups know it without a timeline read.
- Not taken (trade-offs): `--effort low` (−1.1 s, but titles drift to two-word
  abbreviations), a warm CLI process, direct API calls.
- OMP: ~0.45 s startup from the plugin's data directory (2.2 s from `/tmp`),
  then the model; with thinking text omitted, calls take 1.6–4.5 s (median
  2.5 s), like the Claude CLI. See [Model](#model).

## Code layout and tests

- `shared/agent-titles.mjs`: pure agent-title policy (placeholder rule, which titles Titles manages, how a sibling tab is described to Haiku, which timelines can be read without starting an agent, answer parsing, conversation excerpt).
- `shared/workspace-titles.mjs`: pure workspace-title policy (whose a workspace's title is, including Paseo's generated one; how project siblings are marked; splitting and capping the sibling lists; a workspace's first agent).
- `shared/settings.ts`: the *Automatic titles* setting (`off` / `first` / `every`), *Automatic workspace titles* (`workspaces`, on/off), *Model provider* (`provider`: `claude` / `omp`), the OMP *Model* (`ompModel`) and *Timeout* (`timeout`, seconds, default 20).
- `server/prompts.ts`: the shared rules and the three situation tasks; `WORKSPACE_PROMPTS` with the workspace rules and their `first` / `manual` tasks.
- `server/model.ts`: the Claude CLI and OMP calls, the OMP isolation extension and overlay it writes to the data directory.
- `server/rename.ts`: compare-and-set rename plus ownership labels over the local daemon RPC.
- `server/agents.ts`: the agent listing, archived included.
- `server/timeline.ts`: recent and opening timeline reads, first-prompt lines.
- `server/workspaces.ts`: workspace titling (creation tracking, title-change subscription, sibling lookups, the `retitle-workspace` RPC, ownership file).
- `index.server.ts`: automatic titling after each reply, the `retitle` RPC, the sibling lookup with its first-prompt cache; registers workspace titling.
- `index.client.tsx`, `client/settings.tsx`: the tab and workspace triggers, the tab spinner, the toasts, the settings screen.

`npm test` runs 15 tests on the pure policy. `tests/agent-titles.test.mjs` (8):
the placeholder rule, which titles automatic titling may touch (hand names
never), how siblings are described (Titles' own, placeholder, hand-named,
including a Titles title renamed by hand), keep-versus-rename parsing with
titles passed through as written, malformed answers, excerpt filtering,
merging of agentic turns, and bounds on long replies.

`tests/workspace-titles.test.mjs` (7) covers the workspace policy: title
history, which titles automatic titling may touch (empty, placeholder, its
own, Paseo's generated one; hand names never, including Paseo-like changes
that are late, repeated or from a title given at creation), how project
siblings are marked, splitting and capping the sibling lists, and picking the
first agent (archived included, a stored one skipped).
