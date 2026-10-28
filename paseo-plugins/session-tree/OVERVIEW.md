# Session tree

OMP's `/tree` inside Paseo: go back to any earlier message and continue from there as a new
branch. The old branch stays in the same OMP session file and can be switched back to,
summarized, or opened in its own tab. The design was selected from local mock pages.
OMP chats only (provider `omp` or a provider that `extends` it in `~/.paseo/config.json`);
every other chat shows nothing.

Needs the companion OMP extension `~/workspace/my-agents/.omp/extensions/session-tree/`, loaded
for every Paseo OMP agent in every OMP profile (`omp`, `omp-nilo`) through the Paseo-only overlay
`~/.paseo/omp-overlay.yml` (`extensions:` list; the providers set `PI_CONFIG_FILES` to it). Not
in `~/.omp/agent/extensions/`: that folder is the default profile's only, so `omp-nilo` chats
(`~/.omp/profiles/nilo/agent/`) never loaded it. A chat whose OMP process started before the
extension existed is reloaded once automatically on its first branch move. A chat whose setup
cannot load it fails at once with a toast naming the overlay (no reload, no waiting).

## What you see

**Web and desktop**
- A quiet branch icon in each reply's footer next to Copy/Fork: **Continue from here** (not on
  the newest reply). In each of your messages' hover row after Rewind: **Re-ask from here** — goes
  back to just before that message and copies its text ("Copied — paste to re-ask"; a plugin
  cannot fill the composer).
- Right-click on a message: Continue from here / Re-ask from here, **Open in new tab**, **Show
  branches**. Shift+right-click, a text selection, links and inputs keep the browser's menu.
- A click goes back and, by default, summarizes what it leaves, as OMP's `/tree` → Summarize does:
  "Summarizing what you left…" (with Cancel; one model call), then "Switching branch…" (about
  1–3 s: the chat is reloaded from its session file). Then a slim strip above the composer:
  `✓ N messages summarized at the branch point · Undo · ×`. It stays until you send a message or
  press ×. Cancel leaves the chat where it was.
  - With **Summarize when going back** off, the move is instant and the strip reads
    `↩ N messages set aside · Summarize them · Undo · ×` (no timer). **Summarize them** opens an
    optional focus field → OMP writes the `branch_summary` at the branch point.
  - **Undo** returns to where you were (the summary stays behind on the branch you undid).
- A message that can't be matched to the session file says so in a toast and moves nothing.
- The summary shows in the chat as a muted folded row **Summary of the branch you left · focus: …**;
  unfolding shows the text. The agent sees it (proven: it answered from it).
- A muted composer pill **Tree · N** when the chat has more than one branch (the empty branch you
  are on after going back counts). It opens the branch list: one row per branch with its first
  diverging message, time, message count, "summarized", "you are here". A click switches, with the
  same strip afterwards. `/tree` opens the list in any OMP chat.
- Open in new tab copies the path root → that reply (or → just before that message) into a new
  OMP session file and imports it as a new agent "‹title› · branch", child of the original
  (`paseo.parent-agent-id`), same model/mode/thinking. The original is untouched.

**Phones** (native apps and Paseo's compact web layout): no message icons (no DOM / no pane to
match rows to a chat). Every OMP chat gets the **Tree** pill; after going back it reads
`↩ N set aside`. Its sheet has the offer (Summarize them with focus field, Undo, ×, progress with
Cancel), the branch list, and **Go back to** (your own messages, newest first; restarts before that
message and copies it).

Busy agents are refused ("The agent is busy. Try again when it has finished.").

## Settings

Settings → Plugins → session-tree → Session tree (`shared/settings.ts`, all on by default). The
client reads them with the chat list (every 5 s; at once on the client that saves), so changes
apply without a reload. `/tree` works whatever is off.
- **Show composer pill**: off hides the Tree pill. It still appears while the branch list that
  `/tree` opened is up, and in the phone apps for a moment to show a toast: Paseo mounts no hidden
  pill and the pill is the only per-chat plugin host for the sheet and phone toasts.
- **Show branch buttons on messages**: the Continue / Re-ask icons (web and desktop).
- **Branch menu on right-click**: off leaves the browser's menu (web and desktop).
- **Summarize when going back**: Continue from here, Re-ask and branch switches put a summary of
  what is left at the branch point during the move. Off: instant move, "Summarize them" offered after.

## How it works

- `server/session-file.ts` reads the chat's OMP JSONL (`persistence.nativeHandle`) as a tree:
  current path, turns (user entry id + text, last reply/tool entry id, start of the last reply
  text; a `/prose` `reset_boundary` starts a new turn), branches, the "set aside" offer,
  and Paseo's numbering of replayed rows. Leaf = last line (a `model_usage` line points elsewhere).
- Moves run inside the chat's OMP process via the extension (file requests under
  `~/.paseo/omp-session-tree/<agentId>/`, see `server/link.ts`), which calls the live
  `AgentSession.navigateTree(target, {summarize, customInstructions})` and appends a hidden
  `custom` marker `paseo-session-tree` ({op, kind, from, fork, …}) so the move survives restarts and
  the offer is derived from the file (it ends when a message follows the marker). × is stored in
  `dismissed.json` there.
- The chat list's facts per session file (branch count, offer) are saved to
  `$PASEO_HOME/omp-session-tree/list-facts.json`, keyed by file size and mtime, so a plugin restart
  parses only chats whose file changed. Bump `FACTS_VERSION` in `index.server.ts` when what
  `branches()` or `offerIn` report changes.
- Summarize on going back = the goto request carries `summarize`: one `navigateTree(target,
  {summarize: true})` → `branch_summary` at the branch point, marker op `summarize`.
- "Summarize them" later = in one request: back to the left branch, then `navigateTree(fork,
  {summarize, focus})` while the new branch is still empty. Cancel = `abortBranchSummary()`.
- The extension writes its REVISION (2) into its `.process-<pid>` marker and removes it on a clean
  exit; the server prunes markers of killed processes. Polls check only a chat's own markers; the
  server walks every process only before a move, and reloads a chat whose OMP runs an older
  REVISION (or no marker) first.
- After each move the server reloads the chat (`DaemonClient.refreshAgent`, the same as
  `paseo agent reload`), because Paseo does not see in-place moves. Daemon calls (reload, open
  in new tab) run in a short-lived `node server/daemon-ops.mts` process: bundling the client SDK
  into the plugin would keep its 8 MB of bundle source and schemas (~17 MB heap) in memory.
- Web DOM (`client/web.ts`): icons after `assistant-fork-menu-trigger` / `rewind-menu-trigger`,
  strip, menu, toasts, Paseo's `--colors-*` CSS variables. Paseo mounts only part of a long chat,
  with gaps, so the user rows and reply footers on screen are lined up in order with the path's user
  messages and reply texts (longest common subsequence; the newer copy wins after `/prose`).
  Nothing lines up → toast, no move.
- Timeline transformer: Paseo's replayed `[branch_summary]` row becomes the summary row;
  `[credential_pin]`/`[model_usage]` "Unsupported history record" rows (which appear only after a
  reload, i.e. after every move) are hidden.

## Limits

- Each move reloads the chat (1–3 s; a summary adds one model call, ~5–15 s on Haiku).
- Per-message icons are web/desktop only and rely on Paseo's private testIDs; a Paseo update can
  move them (then only the pill and `/tree` remain).
- Summarize works only while the new branch is still empty (OMP puts the summary at the fork).
  Hidden custom messages (`display: false`) don't count: OMP appends one (`eval-state-context`)
  on every reload, i.e. right after each move; counting it hid the strip at once.
- Branch summaries made in OMP's own TUI aren't tagged "summarized" (the tag comes from the marker).
- Turn durations in Paseo can look long after a summary ("Worked for 17m") because Paseo groups the
  summary entry into the turn.
- Re-ask copies; it cannot put the text into the composer (no plugin API).

## Files

`index.server.ts`, `server/` (tree model + test, extension link, daemon client, branch copy),
`index.client.tsx`, `client/` (store, web DOM layer, RN sheet + pill, summary row, clipboard,
settings screen), `shared/tree.ts` (RPC contracts), `shared/settings.ts` (settings). Typecheck
`npm run typecheck`, tests `npm test`.
Apply edits with `paseo plugin reload session-tree`.

Screenshots (`screenshots/`, live on a throwaway Haiku OMP agent, 2026-10-21): 00 icons,
01 switching, 02 strip, 03 focus field, 04 summarizing, 05 summary added, 06 summary row,
07 agent recalls the summary, 08 branch list, 09 switched, 10–11 re-ask, 12 right-click menu,
13 open in new tab, 14 busy refusal, 15–20 phone (390 px): sheet, pill offer, offer in sheet,
focus, summarizing, summary row.
