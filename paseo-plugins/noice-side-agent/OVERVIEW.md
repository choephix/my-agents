# Side agent

Create a visible child of the current Paseo agent:

```text
/side [task]          use the configured default (initially fork)
/side --fork [task]   force curated Paseo chat history
/side --full [task]   force complete OMP memory through the last completed turn
```

An existing agent is required; the task is optional. Without a task, the title is
`Side: <parent title>` (shortened). With a task, the title uses its first words.
The child gets the parent's
provider/model, mode, thinking option (including the provider's active default), feature values, and working directory.
It appears in the parent's sub-agents strip. Shared cwd means shared files, not
an isolated worktree. **`/side` sends no finish message into the parent:** check the
side agent's tab. For a child that reports back, use `/tangent` (below).

The old session-file-pointer prompt mode has been removed entirely.

## Choosing context

### Fork — default, cheaper, all providers

This is Paseo's own **Fork in a new tab** context: the server calls the installed
SDK's `buildAgentForkContext(parentId)` and attaches its text attachment with
`contextKind: "chat_history"` to `agents.create({ attachments })`. With a task,
the initial prompt is a short parent/side-task note plus your task. Without one,
the attachment rides on this note: “You are a side agent forked from Paseo chat
<id>. The attached chat history belongs to the parent. Wait for the user's
instructions; reply only: Ready.” The child acknowledges, then waits for you.

The attachment contains curated user/assistant messages and tool-call summaries,
not raw tool outputs, private reasoning, or native provider session state. It is
capped at **100,000 characters**, retaining the newest history when truncated.
It can include an in-progress parent's current visible messages. Facts that
exist only in a tool's output are not available in this mode.

### Full — OMP only, real session memory

The server refreshes the parent and obtains its native session file from
`persistence.nativeHandle`. It opens that file read-only, reads a bounded byte
snapshot, discards any unterminated final JSONL line, and validates the records.
The copy stops at the latest assistant message with terminal `stopReason`
`stop`/`length` and no tool-call blocks. **The entire current unfinished turn is
excluded**, including its user message, tool requests, and partial response.
If there is no completed turn, the command refuses and recommends `--fork`.

A new timestamp/UUID filename and session-header ID are created alongside the
parent's `.jsonl`. Entry/tool-call IDs remain unchanged. The new header records
the parent session and preserves its prompt-cache key, matching OMP's native fork
convention. The sibling artifact directory is copied recursively, so relative
`artifact://` and `agent://` references have an independent artifact root. Symlinked
artifacts are refused. Absolute paths embedded in historical text are not
rewritten; existing OMP compaction is not undone.

After the completed-turn cut, the copy gets one OMP `custom_message` entry with
`customType: "side-fork"`, `display: true`, and `attribution: "agent"`.
Its fresh entry ID links through `parentId` to the copied completed assistant
entry. Its content is:

> You are a side agent forked from Paseo chat <id> (<parent title>). The conversation above belongs to the parent; earlier tasks are not yours. Work only on what the user asks next.

OMP replays this entry into model context on resume without starting a turn.
Paseo shows it as a **collapsed, expandable synthetic tool row** before the next
user message. The UI humanizes `side-fork` to **Side fork**; expanding it reveals
the note text. This is context metadata, not an executed tool or model turn.
The imported turn's “Worked for” footer may include the note timestamp even
though the child remains idle with `LastUsage: null`. Resume behavior was proven
against the authoritative `~/.local/bin/omp` binary (18.11.0).

Paseo imports the copied file as a new OMP agent with the
`paseo.parent-agent-id` label and applies the parent's current runtime settings.
With a task, it sends **only the task text**, without a duplicated fork note.
**Without a task it sends nothing at all**: the imported child opens idle with
no new user/assistant message or model turn, but with the visible side-context
entry ready for the first prompt. The parent is never resumed or written by
this operation. Full mode inherits native conversation/tool-output memory,
not just a transcript attachment; long histories can be slower and more costly.
Earlier parent instructions are also inherited and can affect the child's reply.

A raw mid-tool copy was tested and rejected: it could replay the parent's pending
command. The completed-turn boundary above was then proven to exclude that
command while the parent continued running normally.

## Default mode setting

Open **Settings → Host → Plugins → Side agent → Default mode**. Choices are
**Fork — curated chat history** and **Full — complete OMP memory**. This is a
persisted host setting, initially `fork`, shared by clients connected to that
host. Explicit `--fork` or `--full` wins over the setting. The live test changed
it to full, verified persistence and overrides, then restored it to fork.

## Desktop, web, and phone

On wide web/desktop layouts, the submitting chat's pane is captured. An existing
pane to its right is reused. Otherwise, a single-pane layout invokes Paseo's own
**Split pane right** menu action. Repeated submissions add tabs to that right
pane, not a third pane. With multiple existing panes and no right-hand target,
normal opening is used rather than creating another pane. Placement failures
also fall back to normal opening without losing the child.

Phone/native uses public host `navigation.openAgent`, without DOM or split
operations. Slash callbacks expose `openScreen`, not navigation directly, so a
transient registered screen obtains that public navigation API and immediately
opens the child. Old clients without the API show an explanation; the child is
still accessible through the parent's sub-agents strip.

All DOM/pointer code is gated by `Platform.OS === "web"`. It depends on Paseo's
`workspace-pane-*`, `workspace-tab-*`, and split-menu test IDs. UI changes,
custom layouts, or layout changes during startup can break best-effort placement.
Electron and native iOS/Android devices were not directly exercised; headless
Chromium proves the web implementation, not those device integrations.

## Why `/side`, not `//side`?

The plugin first attempts `name: "/side"`, which would match `//side`. Current
Paseo rejects it because contribution names must match `/^[a-z][a-z0-9-]*$/`.
Only that specific registration error enables the fallback `name: "side"`.
Thus `/side` is the working command; `//side` is not intercepted or rewritten.
The autocomplete description is “Side agent with parent context · --fork / --full”,
so both flags are visible in the list row as well as the argument hint.
The separate `noice-omp-slash-aliases` plugin is untouched; `/tan`, `/omfg`, and `/queue`
remain independent. There are no global composer hooks.

## `/tangent`: background subagent that reports back

```text
/tangent <task>
```

Creates a child the same way `/side` does, but always picks the mode itself:
**Full for OMP parents, Fork for every other provider** (the default-mode
setting is ignored). Same provider/model, mode, thinking, features, cwd and
parent link, so it sits in the parent's sub-agents strip. The title is
`Tangent: <task>` (shortened). Its context note (the `side-fork` entry in Full
mode, the first prompt in Fork mode) says it is the parent's **tangent
subagent**: the history belongs to the parent, its only job is the task, and
its final reply is handed back to the parent.

Nothing moves: no pane, no navigation. Without a task the command refuses with
an error toast.

When the child's turn ends, the server sends one message into the parent:

```text
Tangent "<title>" finished (<duration>):

<the child's final reply, in full>

Open the tangent: <app base URL>/h/<server id>/agent/<child id>
```

The final reply is the assistant text after the turn's last tool call. A failed
turn is reported with its error, a stopped one as "was stopped", and a child
archived mid-turn as "was archived"; those reports carry no partial text.
The link uses `app.baseUrl` from the daemon's `config.json`, or a `paseo://`
deep link when that is unset.

Delivery never interrupts the parent:

- **OMP parents** get the report as `/follow-up <report>`. OMP queues it behind
  a running reply; an idle parent starts a turn with it at once. Paseo echoes
  the raw `/follow-up …` send into the timeline as soon as it is queued, and OMP
  shows the report again when it delivers it; a client timeline transformer
  hides the echo, so the report appears once, after the reply it waited for.
- **Other providers** get it directly when idle. A running parent's reports are
  held until its turn ends, then sent as one message (several reports are joined
  with `---`), because a second send would interrupt the turn the first started.
- A parent that is archived or gone gets nothing; the server logs the drop.

In the parent chat each tangent is **one row** in the style of the `/tan` row
(`noice-omp-slash-aliases`): a muted dashed box with `tangent` and the title
(without its `Tangent: ` prefix).

- **While it runs**, the row sits where `/tangent` was sent: `running 0:42`
  (counted in the app, once a second) and a muted peek of the child's newest tool
  call, its name and what it works on (`bash · sleep 120`, `read · src/app.ts`).
  One click opens the tangent's tab.
- **When it ends**, the same row, in the same place, shows the status
  (`done in 1m 50s`, `failed after 12s` in red, `stopped after 17s`, `archived
  after 3s`) and, for finished and failed ones, the first line of the answer or
  error. Click it to open the full answer as Markdown (Paseo's own renderer),
  with **Open the tangent** (opens the child's tab through the plugin's `open`
  screen, on the host named in the link) and **Copy result**. An answer over
  20,000 characters is cut in the row with a note; the report message and the
  tangent keep all of it.

The server writes this row into the parent's timeline as a plugin item
(`tangent-<child id>`, kind `tangent-row`), first when the child is launched,
again on each tool call it starts (from a subscription to the child's
timeline), and once more with the finished report just before sending it.
The report message itself then draws nothing; the parent model still receives
the plain report text. Each write records the parent timeline's epoch on the
child (`side-agent.tangent-row` label); a report message draws nothing only when
that epoch is still the parent's current one, which the app asks the server
(`tangent-row-shown` RPC) once per report row it mounts.

Plugin rows live in the daemon's memory, not in the provider's history, so:

- **Daemon restart while a tangent runs:** its running row is gone and is not
  put back. When the tangent ends, the finished row is written at the end of
  the parent chat (where the report arrives), and the report draws nothing.
- **Daemon restart after a tangent ended**, and reports from before this row
  existed: the row is gone, the label's epoch is stale, so the report message
  is drawn as the finished row in the report's place, from its text (exact
  match: only a message that entirely parses as reports in the format above,
  with links to `/h/<server>/agent/<id>`; several joined reports become one row
  each; anything else keeps its normal bubble).
- **Plugin reload while a tangent runs:** the row stays and keeps counting, but
  its tool-call peek stops at the last step; when the tangent ends, the row
  becomes the report as usual. A tangent that ends during the reload itself is
  reported before the plugin has its Paseo API (it gets one from its first RPC
  or lifecycle event): its row keeps saying running, and the report is drawn
  as its own row.

The parent runs a new turn on the report, like any message. Each tangent is
reported once. Its state lives in child labels (`side-agent.tangent`:
`pending` → `reported`, plus parent ID and start time), so a plugin reload or
daemon restart resumes watching: running tangents are watched again; ones that
ended while nothing watched are reported from their timeline, with the outcome
inferred (error status → failed, archived → archived, otherwise finished).
After a daemon restart, a tangent that was cut off mid-turn can therefore be
reported as finished with whatever text it had produced. Reports held for a busy
non-OMP parent are kept in memory only; after a reload they are re-sent from the
labels. A tangent waiting on a permission prompt is not reported until its turn
ends.

OMP parents on custom OMP-based providers (any provider ID other than `omp`) are
treated like other providers: Fork context and held delivery.

`/tangent` is separate from OMP's own `/tan` (routed by the `noice-omp-slash-aliases`
plugin, where it is now off by default). OMP's live command list has no `tangent`
command for this one to shadow.

## Files and operation

- Fork mode creates only the normal Paseo/OMP child session.
- Full mode additionally creates `<timestamp>_<new-uuid>.jsonl` in the parent's
  session directory and, if present, a same-stem artifact directory. These are
  the real child's persistent session and are **kept for real usage**, including
  after normal archival. There is no automatic session deletion hook.
- Failed full launches archive the imported child and remove their copy when
  cleanup succeeds. The live tests archived their agents before explicitly
  deleting all test-created full-memory copies and sidecar directories.
- The server part registers settings, the `/side`, `/tangent` and
  `tangent-row-shown` RPC handlers, and two lifecycle listeners
  (`agent.turn_ended`, `agent.archived`) that watch tangents. It uses
  short-lived installed SDK connections for native
  fork/import/config/label/timeline RPCs, authenticated to the published
  **loopback TCP** daemon under `PASEO_HOME` (or `~/.paseo`). Socket-only or
  unpublished endpoints are not supported and fail clearly. Local credentials
  are never sent to remote hosts. Tangent rows (append, the parent's timeline
  epoch, one live subscription per running tangent, closed when it ends) go
  through the plugin's own Paseo API, because the daemon accepts appends only
  from plugin sessions.
- `node_modules` is an ignored symlink to the already-installed neighboring
  `noice-chat-quote/node_modules` (Paseo SDK 0.13.0, needed for the host
  `Markdown` component); no npm install was run. `npm run typecheck`
  and `npm test` run from this folder.

```sh
flock /tmp/paseo-plugin.lock paseo plugin reload noice-side-agent
paseo plugin ls noice-side-agent
paseo plugin disable noice-side-agent
```

Disabling removes the commands and stops tangent watching, not existing agents
or saved sessions; pending tangents are picked up again when it is re-enabled.

