Wayfinder efforts (`.scratch/<effort>/map.md` + `issues/NN-*.md`) inside Paseo, read-only. Built on
Paseo 0.12.0 from local mock pages.

## Status (2026-10-20)
All four steps built and checked live in the web app, dark and light (desktop 1440 px, explorer
320/240 px, phone 390 px). Also proven live: the global search and the unbound search (Efforts /
Tickets / Docs groups; each kind opens in the right column, or binds and opens in the panel), Bind
and Unbind (popover and `⋯`), and "Grill in new chat" (new chat in the bound workspace's folder, on
that workspace's latest model, prompt `Grill ticket <abs path> with the grilling skill. Read the
effort's map first: <abs map.md>`, title `<slug> <NN> <title>`, label `effort=<slug>`).

## Where Stefan sees it
- Explorer panel → `+` → **Efforts** (⌘K "Efforts for this workspace").
- **Header button** per workspace, icon-only: a progress pie (solid green = done, faint green =
  claimed; a pie because a part-filled ring this small reads as a spinner) + Paseo's chevron. Its
  tooltip carries the name: `acme-task · 0/9 done`. A dashed empty circle
  (`No effort · suggested: …`) when unbound with a suggestion; nothing when there is none. Popover
  (Paseo's maximum, 420 × 440): name + status, the map's Destination (2 lines), the **route bar**
  (done · claimed · open · blocked/parked, then a dashed fog tail a quarter as wide: fog is counted,
  never sized), `11/26 done · 15 to do · + 10 fog`; then one list in route order under a fixed
  head: **Done** (folded at every open), In progress, To do (number order; tail = blockers, what it
  asks of you — talk / agent / hands-on / yours, from the `Type:` line — and age from 7 days, old
  rows muted), Fog (map's Not yet specified; a row opens the map there). Footer: Open panel · All
  efforts · Switch… (the panel's effort picker) · Unbind. Paseo sizes a popover on its first frame
  and never again, so each bound workspace's effort is read ahead when its button appears and the
  list's height is fixed from its folded rows (opening Done scrolls inside it). Unbound: the
  suggestion with Bind · New effort · No effort. On phones it opens the whole effort as a sheet.
- **Sidebar row "Efforts"** → global screen (⌘K "All efforts"): search over efforts, tickets, docs
  and workspace names (results grouped, replacing the table while typing; `/` focuses), project
  chips, a muted warnings line under them only when the server noticed a problem (an Extra folder
  with no `.scratch`, unreadable settings, no agent list), columns Done / Effort / Open tickets /
  Workspaces / Next / Touched. Per `.scratch`
  group: efforts with a bound or suggested workspace, then **Touched this week, no workspace**,
  then the older ones folded (newest first), then workspaces with no effort and no suggestion.
  Opened from a workspace (pill or ⋯ → All efforts): that project only ("show all" undoes it) and
  the effort marked "you came from …". Clicking a row reads the effort in a right column (the
  same component as the panel, keyed by effort path, so efforts without a workspace are
  readable); chips open that workspace with its Efforts panel. Phones: two-line rows (name /
  `Next 01 …`, done count + bar), the effort opens full screen.
- **Phone composer pill** `acme-task · 0/9 done` on every chat of a bound workspace, compact
  layouts only (< 720 px) and **off by default** (Settings → Show composer pill); tap → sheet with
  all rows; a row opens in place with its Question, status line, the chat button and Read.
- Settings → Plugins → noice-efforts-dashboard's menu → **Efforts** (route
  `/settings/hosts/<server>/plugins/noice-efforts-dashboard/folders`): **Show header button** (the
  header pill, on by default; off removes it from every workspace header, the Efforts tab and
  sidebar row stay), **Show composer pill** (off by default), **Extra folders** and **Excluded
  folders** (comma-separated, one Save), and **Commits shown** (10 / 30 / 50 / 100, default 30).
  A save re-reads the overview, so it applies at once. Not in the settings sidebar.

## Efforts tab
- **Bound workspace (E):** name + map `Status:` pill, Destination (one line; click opens map.md at
  Destination), counts in words with every non-zero bucket (`0/9 done · 8 ready · 1 blocked`), a
  `Deadline:` line only when the map has one.
- Tickets: claimed first, then ready with **next** on top (brighter row, `next · blocks 04`, and
  its Question as one muted line under it), `Blocked · N` (+ `after 01`), `Parked · N`, `▸ Done · N`
  fold. Type shown when not grilling; age only when ≥ 7 days. Parser anomalies (duplicate numbers,
  unknown Status word, Blocked-by naming another effort's ticket) as muted lines.
- Planning and git are kept apart: the overview shows no git state at all. Folds: Decisions
  (title · date, newest first), Not yet specified / Out of scope (map bullets, links open in the
  viewer), Leans on. Doc chips: map.md with its age, top-level docs, folders with counts,
  `.artifacts/<slug>/` when it exists.
- **Files & commits** (branch icon in the head row, amber count when something isn't
  committed): its own page with Not committed (per file/folder with time, changed map sections,
  `+16 −3` / `2 new`; copy-paths icon) and the effort's newest commits (Settings → Commits shown;
  the server sends at most 100). The heading counts the rows shown: `Commits · 12`,
  `Commits · 30 of 64`, `Commits · 30 of 100+`.
- Drill-in (D): `1 of 9` with prev/next, relations (`blocks`, `after`), path, raw Status line only
  when it says more than the word, the ticket body, **Grill / Prototype / Research / Work in new
  chat** (creates an agent in this workspace with that workspace's latest chat settings and opens
  it; label `effort=<slug>`) and Copy path. map.md opens as an outline (sections with item
  counts). Folder chips list files; relative links open in the same viewer.
- `⋯`: Switch effort…, Open map.md, Copy path, All efforts, Unbind, and the legend.
- **Unbound (U):** suggestion card with its reason in words and Bind · New effort · No effort; a
  search over efforts, tickets and docs of this project (server-side, grouped Efforts / Tickets /
  Docs; picking a ticket or doc binds and opens it; `/` focuses on web); "Recent in <project> · 6";
  "All efforts in <project>". New effort starts a chat that charts the map and binds at once.
- Below 260 px the bar, the status pill and `· blocks 04` give way.
- Every clickable thing shows hover (web) and press: a fill one step from what it rests on
  (`hover` / `press` / `hoverHot` in `marks.tsx`: 6 % / 12 % toward the text colour, about
  Paseo's own sidebar step; surface1 alone was ~5 levels and invisible). Links underline on hover.

## Data rules
- Roots: the `.scratch` of every Paseo workspace (realpath, deduped, so worktrees share their
  repository's efforts) plus the extra folders setting. `__share__` copies and folders under an
  Excluded folder are skipped unless listed in Extra folders; a workspace whose `.scratch` is skipped says so in its Efforts tab, with
  the reason and where to list it. `_to_organize_`, hidden folders and folders with no
  map/issues/Markdown are not efforts. No map: title = first `# ` of the biggest top-level `.md`.
- Ticket status = first word of `Status:` (bold, dates and prose allowed) → open / claimed /
  done / parked; unknown words count as open. Blocked = open and a `Blocked by:` ticket here is
  not done; `acme-widgets 08` style references resolve to the other effort; prose blocks nothing.
  next = lowest-numbered open, unblocked, unclaimed ticket. Ticket titles drop a repeated number
  (`# 04 — Slice-1 spec`, or `# 01 Pick a colour` when it is the file's own number).
- Leans on = sibling efforts linked as `../<slug>/` from map.md outside Out of scope; the reason is
  the linking bullet's bold lead or first clause.
- Not committed = `git status` of the repo owning the effort's real path (so the symlinked worktree
  `.scratch` shows the shared repository's changes).
- Binding: workspace id → effort in `~/.paseo/plugin-data/efforts-dashboard/bindings.json`
  (or "no effort"); Unbind deletes the workspace's entry. Never set silently. Suggestions, in
  order: the folder's `.omp/RULES.md`, `.scratch/<slug>/` mentions in the last 256 KB of the
  workspace's chats of the last 3 days (3+ and twice the runner-up), workspace name, newest files
  (only when no other workspace shares the `.scratch`).
- Files are cached by mtime; the client re-reads every 5 s only while the surface is on screen.
- Colours come only from Paseo's theme. One derived colour: the done-bar track and quote bars use
  surface2 on dark themes, and on light ones 35 % of the muted text over surface0 (light surface2
  is near-white and the empty bar vanished). Chips and the Status tag on a highlighted row
  (surface2) switch to surface0 so they stay visible.
- Excluded folders (`excludedFolders`, empty by default): absolute or `~/…` paths; their
  descendants are skipped, and Extra folders still override the exclusion.

## Speed (measured live 2026-10-20)
- Server: overview 34 → 13 ms, one detail poll 32 → 10.5 ms, a larger effort ~70 → 16 ms,
  search 18 → 5 ms. File stats are synchronous (the scan and `.artifacts/` walk), overlapping callers
  share one pending root scan, and `git diff` results are reused while a file's `git status` v2
  record (HEAD/index blob hashes) and mtime/size stay the same.
- Polls send the etag of what they hold (`since`); an unchanged overview or detail comes back as
  `{ unchanged: true }` (55 B) and the client keeps the same object, so nothing re-renders. Idle
  relay traffic with the tab open: ~115 KB → ~1.4 KB per 5 s; 0 React commits per idle poll.
- Detail folds don't carry Markdown the client never draws (fold bodies with bullets, Decisions
  bullets): a larger effort 96 → 48 KB, a smaller effort 34 → 25 KB.
- Feels instant: Bind / Unbind / No effort show at once, popovers close at once; a failed write
  puts the old binding back with an error toast, and a poll already in flight can't undo a bind.
  Hovering a global row reads its detail ahead (row → column 436 → ~150 ms), hovering a ticket
  row reads its text (click → body 330 → 90 ms), hovering Grill/Work reads the chat settings
  (kept 5 s; click → chat 760 ms). The global list holds its order while the pointer is over it and
  re-sorts when it leaves. Polls never show a spinner. Header labels call the host's `update`
  only when they change; the 30 s header refresh is skipped while a surface polls.

## Limits
- Plugins can't open a file in Paseo's file tab or write into the current composer: the viewer is
  built in; chats are new chats.
- Phones: Paseo's compact explorer has no plugin panels (step 4 adds the composer pill).
- Over the app.paseo.sh relay the very first load after a plugin reload takes several seconds.
- After Unbind the header button disappears for ~0.5 s before the dashed suggestion returns: the
  server computes suggestions only for unbound workspaces, so the instant update has none to show yet.
- A poll that fails keeps showing what was on screen, with no stale marker.

## Files
`index.server.ts`, `server/` (scan, git, suggest, bindings, service), `shared/` (RPC contracts,
parser, settings), `client/` (panel, effort view, unbound view, search results, marks, Markdown
renderer copied from noice-omp-slash-aliases). Tests: `npx vitest run` (parser variants, symlinked
roots, bindings store, uncommitted line counts, bind/poll races, ticket body, links). Screenshots:
`screenshots/`.
