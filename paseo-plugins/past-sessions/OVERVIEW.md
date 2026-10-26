Lists the past sessions of a Paseo workspace, its folder or its project and reopens them in
Paseo (built on 0.11.4; checked live on 0.12.0).

Three sources, newest activity first, starred sessions before the rest:
- **Paseo**: archived Paseo agents.
- **OMP terminal**: OMP sessions that no Paseo agent owns, e.g. old terminal or herdr sessions.
  A session any Paseo agent (live or archived, any folder) already owns is never listed twice;
  the footer counts those ("23 terminal sessions are already in Paseo and not repeated").
- **Claude Code & Codex**, on demand (Folder and Project scopes): see below.

Rows have two densities. One
icon button next to refresh toggles them; its icon and tooltip show the density a click switches
to. The choice is saved on the host as plugin settings, so it survives reloads:
- **Comfortable** (default): provider mark; title, then a folder chip for rows outside the
  workspace folder (last path segment, full path as tooltip), then at the right
  `terminal · 2 d ago` (the word only on terminal sessions; no word = Paseo agent); below, up to
  two lines of preview.
- **Compact**: one line, the preview as a muted tail and a short time (`2d`). Hovering a row
  opens its two-line preview underneath. On phones the tail is dropped and nothing expands.

Hover or keyboard focus swaps the time for **Restore** / **Import** (the `terminal` word stays);
the whole row is the button. The time's tooltip has the absolute date. Sizes are Paseo's
defaults, 14 px titles and 12 px for the rest (plugins can't read the Interface size setting).

Preview: the last assistant reply from the session's transcript; else nothing (the row is just its
title line). (Until 2026-10-23 it preferred the `paseo-recap` plugin's summary; that plugin is
uninstalled and its leftover file was stale, so that was removed.) Transcripts: the OMP session file (terminal rows, and OMP agents'
native handle) or Claude Code's `~/.claude/projects/<cwd>/<id>.jsonl`. Codex keeps rollouts in
date folders that would need a search, so Codex rows have no preview to keep listing fast.
Only the last 64 KB of a transcript is read; harness wrappers (`<paseo-system>`,
`<system-notice>` … any hyphenated tag), OMP `/prose` `[ran …; recover: …]` records, code blocks
and markdown markup are removed. Rows are dated by the transcript's newest message, not the file
mtime: OMP appends `session_exit` records to old sessions when their terminal is killed (a herdr
restart touched ~60 files on 2026-10-19), which would otherwise make them all "just now".

Provider marks: Paseo's plugin SDK does not expose its provider icons, so the built-in marks
(Claude, Codex, OMP, Pi, OpenCode, Copilot) are copied as SVG strings into
`client/provider-marks.ts` (from getpaseo/paseo at 4a5716360); plugin providers use the daemon's
provider-snapshot `iconSvg` (e.g. Antigravity); anything else gets Paseo's Bot, like the app.
The Bot carries `provider` and `serverId` props, so Stefan's `provider-icons` plugin repaints it
(`omp-nilo` → Nilo logo). Marks render as SVG images, which only the web app (and Desktop) can
draw; native phone apps show Bot.

Titles are never shortened by the plugin beyond width ellipsis; Nerd Font glyphs (Unicode private
use) are removed because app fonts render them as boxes. Paseo itself cuts the provisional title
of an agent created from a prompt to the first 60 characters of its first line
(`create-agent-title.js`), and stores it that way.

## Stars

A star keeps a session you mean to come back to at the top. It changes only the order: starred
rows come first, then the rest, each group newest first, in the main list and in the collapsed
terminal section alike. Where a session shows is unchanged.
- **Star and close this chat** (Command Center, inside a chat): stars the chat, then archives it,
  which stops the agent and closes its tab (what closing an agent tab does anyway in 0.12,
  `resolveCloseAgentTabPolicy` → `archive-on-close`). On phones the Command Center is the
  sidebar's **Search** row.
- In the list: a filled star is the rightmost thing on starred rows, after the time, so it stays
  put when hover swaps the time for Restore/Import. On web/desktop hovering a row
  shows an outline star; click it to star or unstar. On phones, long-press a row and pick
  **Star** in its menu (a toast confirms).
- Stored in `~/.paseo/plugin-data/past-sessions/stars.json`, keyed like the list
  (`paseo:<agentId>`, `omp:<sessionId>`, `ext:<provider>:<sessionId>`). Importing a starred
  terminal or Claude Code/Codex session moves its star to the new agent; restoring keeps it.
- An open Past sessions view picks up a chat closed with **Star and close** on its next quiet
  refresh (see "Freshness") or the refresh button.

## Hide

Hide takes a session out of the list (test chats, throwaways); nothing is deleted, in Paseo or
on disk. Called "Hide" because Paseo already uses Archive (closing an agent) and Delete.
- Web/desktop: hovering a row shows an eye-off button left of the star; click it. Phones:
  long-press a row, then **Hide from Past sessions** in its menu.
- **Show N hidden** at the end of the list (only when this scope has hidden rows) lists them
  dimmed, each with its eye-off mark; click the mark (phones: the menu) to unhide. Restoring or
  importing a hidden session also unhides it.
- Stored in `~/.paseo/plugin-data/past-sessions/hidden.json`, keyed like stars. The search
  placeholder counts only listed sessions.
- Phones: the click a browser sends when the long-pressing finger lifts is swallowed
  (`swallowNextClick`), or it would land on the menu sheet's backdrop and dismiss it.

## Where

- Sidebar row **Past sessions** opens a screen. The header shows project and workspace;
  **Switch** picks another workspace (sheet on phones). It starts on the most recently active
  workspace and remembers the last pick and scope until the app reloads. The URL carries
  `workspaceId` and `scope`, so links and reloads keep them.
- In a workspace, Command Center (⌘K / Ctrl+K) → **Past sessions for this workspace** opens the
  list as a tab for exactly that workspace (Explorer location allowed too).
- Every workspace header has an icon-only clock button (**Past sessions**, `client/header-buttons.ts`)
  that opens the list in the **explorer sidebar** for that workspace, next to the chat. Header buttons
  are per workspace, so the plugin follows the daemon's workspace directory (`workspaces.list`
  subscription, paged) and adds/removes buttons as workspaces come and go. A panel lives in one
  place: if the list is already open as a tab, the button moves it to the sidebar. A second click
  doesn't close it (the plugin API can't close panels); close it as any explorer tab. Phones show
  no header buttons and their explorer has only Changes/Files, so there the way in stays the
  sidebar row and the Command Center. Settings → **Show header button** (on by default) hides the
  button in every workspace header at once (see "Settings").

## Toolbar

Scope buttons, search (its placeholder counts the listed sessions, "Search 141 sessions"), the
density toggle, refresh. On phones, and wherever the list is narrower than 480 px (the explorer
sidebar), the search box gets its own line; in the sidebar rows keep their desktop hover behaviour. What a scope covers ("Archived
agents of Example workspace · ~/workspace/acme-app") is the scope button's tooltip, not a line of text.
Hovering (or pressing) a scope button loads that scope in the background, so the click usually
finds it ready (37 ms measured).

## Freshness

A fetched list counts as current for 30 s: switching away and back within that shows it at once
and asks nothing. After that, coming back (window focus, remount) refreshes it in the background
with no spinner; new or changed sessions just appear. The spinner shows only for the refresh
button. While the pointer is on a row, a background refresh doesn't re-sort the list under it; the
new list shows once the pointer leaves the rows. Starring and opening apply at once regardless.

## Scopes

- **Workspace** (default): archived agents whose Paseo workspace is this one, even when other
  workspaces share the folder. Below them, collapsed, **Terminal sessions in this
  folder (N)**: the folder's OMP sessions never opened in Paseo. Click to expand; a search opens it.
- **Folder**: everything whose cwd is the workspace folder: archived agents of any workspace
  there (including workspaces archived since) and OMP sessions, mixed by time.
- **Project**: also subfolders of the project root, every Paseo workspace of the project, every
  `git worktree` of a git project (herdr and Paseo worktrees included), and archived agents
  Paseo placed in the project, matched by project id, so agents of a worktree deleted since
  still show. (Until 2026-10-20 this compared the id with the project's `host:`/`remote:` key and
  never matched; on that day it changed no listing, since every archived agent was also found by
  folder or workspace.)

The search box filters by every word against title and folder, in the list and the section.

Click a row to reopen it. The row leaves the list at once (one frame) and comes back only if
reopening fails (with an error toast). Imports show a short "Importing “title”…" note. The chat
opens when the daemon confirms (a restored Claude agent: ~0.4 s after the click); opening an
archived agent's chat earlier adds its tab without focusing it.
- Paseo → daemon `refreshAgent` (what `paseo agent reload <id>` sends): unarchives and loads the
  agent, then the app opens it.
- OMP, Claude Code, Codex → daemon `importAgent` (what `paseo import --provider … --cwd … <file or
  id>` sends, Paseo's own import), then the app opens the new agent with its history.

The plugin SDK's `PaseoApi` has no import/unarchive calls, so the daemon-side handler borrows the
daemon client of the `paseo` CLI installed next to the daemon's Node (~4 ms per call). If that
client can't be loaded, it runs the `paseo` binary instead (~300 ms of startup per click).

## Claude Code & Codex sessions

In Folder and Project scopes, **+ Claude Code & Codex** at the top right of the list adds Claude
Code and Codex sessions that Paseo never opened, marked `claude code` / `codex`. The daemon lists
them (`fetchRecentProviderSessions`, the same call as Paseo's own import picker): one unscoped
listing per provider, filtered to the scope here, kept until its refresh button or a daemon restart.
Sessions a Paseo agent owns are skipped. Click imports through the session id. Not remembered:
each visit starts with the button off.

Timing (live, 2026-10-19): first listing 2.0 s (the daemon starts a Codex
app-server per call); forced refresh 1.2 s; other scopes and workspaces after that 0.4–0.6 s, from
the cache. The rest of the list doesn't wait for it.

Limit: the daemon returns at most 200 sessions per provider, machine-wide, newest first. On
2026-10-19 the machine had 201 Claude Code and 119 Codex transcripts, so the oldest Claude Code
sessions already fall off.

## Which OMP sessions

Session folders come from the daemon's provider config: `omp` → `~/.omp/agent/sessions`; a
provider extending `omp` with `OMP_PROFILE=<name>` (e.g. `omp-nilo`) → `~/.omp/profiles/<name>/agent/sessions`,
imported with that provider. Folder names follow OMP 18's rule (`server/slug.ts`): under home
`-<path>` (`~/workspace/acme-app` → `-workspace-acme-app`), under `/tmp` `-tmp-<path>`, elsewhere
`--<path>--`, plus the legacy `--<abs>--` and `<home|tmp|abs>-<basename>-<sha256>` names OMP still
migrates. The name only picks candidate folders; each session's header cwd decides. Nested
subagent transcripts are skipped.

## Speed

Per file it stats (synchronously: it's the plugin's own process, and 2,400 local stats take
2–5 ms that way against 30–40 ms async), and on first sight or change reads the first 64 KB
(header, title record, first prompt; parsing stops once it has all three) and, for previews and
dates, the last 16 KB (64 KB when those 16 KB lack a reply or message time). All candidate
session folders are listed at once; cold reads run 64 at a time. Results are cached in the
plugin's daemon-side process by mtime and size. Scope checks are string-prefix compares of
resolved paths (`path.relative` cost 67 ms per large Project request).

Measured 2026-10-20 (old vs new code on the same data, output byte-identical): a large project
with 96 worktrees and
829 listed sessions) scan warm 82–89 → 16–18 ms, cold 500–620 → 265–270 ms; tail summaries warm
9.8 → 1.5 ms. In the web app a search keystroke on that list took 66–87 ms of handler time before
(every row re-rendered; rows now get only plain values, so unchanged rows skip rendering) and
3–18 ms after. Restore: 308 ms through the CLI, 178 ms on the first direct call (most of it
loading the client once).


## Limits

- Verified in the web app (desktop size and phone-sized web, light and dark). The UI uses only
  React Native and host components, so it should run in Desktop and the iOS/Android apps; native
  apps were not opened.
- Workspace scope can't show agents whose workspace was archived (41 of 74 archived agents
  daemon-wide on 2026-10-19); Folder and Project scopes find them by cwd.
- Importing from the section lets the daemon pick the workspace for that folder, which may be a
  sibling workspace in the same folder rather than the one being viewed.
- Reopening needs the `paseo` CLI package on the daemon host (on Windows, inside the desktop app's
  `resources/app.asar`; otherwise next to the daemon's Node, else on `PATH`, which only allows the
  slower binary fallback).
- Titles come from the first 64 KB: a session whose first prompt starts later shows "Empty session".
  Short automated sessions (e.g. "Reply with just: ok" probes) are listed like any other.
- Switch lists active Paseo workspaces only. Live agents are not listed (they are in the sidebar).
- Session folders set via `PI_CODING_AGENT_SESSION_DIR`, `sessionDir` settings or `XDG_DATA_HOME`
  are not read. Claude Code and Codex sessions: see the 200 limit above.
- A preview needs an assistant reply in the transcript's last 64 KB; a session that ends in a
  long tool run shows an older reply or no preview. Tooltips (full path, absolute time) and hover
  exist only on web/desktop.

## Settings

Settings → Plugins → **Past sessions** (`client/settings-screen.tsx`), saved on the host in the
same `view` settings as the density:
- **Show header button** (default on): the History button in each workspace's header. Off hides
  it in every workspace (`visible: false`) as soon as the switch saves; other devices pick it up on
  start or when the app comes back to the foreground. The sidebar row and the Command Center
  entry stay either way.

## Disable

Settings → Plugins → past-sessions, or `paseo plugin disable past-sessions`
(`paseo plugin remove past-sessions` unregisters it; the directory stays). Then refresh the app.
