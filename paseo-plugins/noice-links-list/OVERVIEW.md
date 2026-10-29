# Mentioned links

A **links** pill in each chat's composer, next to btw and the other pills. It counts every link that you and the agent mentioned in this chat, worded like Paseo's own pills (`6/6 tasks`, `5 subagents`): `6 links`, `1 link`, text only; a chat with no links shows no pill (it reads `links` for the moment before its count arrives). Paseo requires an icon for plugin pills and keeps a 16 px slot for it; on web/desktop the plugin hides that slot, on the native apps it stays as a small blank gap. Open it for the list, newest mention first, one row per link: a type icon and the link's path (see **Rows** below). The list has no title line: its only header is the type tabs and the sub-agents switch below, and without them the rows start at the top. On phones the list opens as a bottom sheet. The list scrolls inside the popover.

**Rows.** A row is the type icon and the link's path across the full width: URLs without their scheme, query and fragment (`github.com/getpaseo/paseo/pull/123`, a trailing `/` kept, a webshare `index.html` dropped), files as `~/…` paths with the `:line` suffix the click copies, folders ending in `/`. No link texts, image alts or separate host/folder column. A path that doesn't fit is shortened by measuring the row's width (on the web the browser measures the text exactly; the native apps estimate 0.6 em per character): the full path; then the first segment (host or `~`), `/…/` and the last two segments; then `…/` and the last two; then `…/` and the last segment, cut at the end with `…`. A shortened path has its full path as the web tooltip. After the path, in muted text: `missing` for a path that is gone, `↳ <sub-agent>` for a sub-agent's link. At rest the right edge is empty, except `×24` on rows with variants; hovering a row on desktop shows how long ago it was last mentioned there (next to `×24`); phones show no times. Clicking a row opens it (web and images) or copies it (files); a row with variants unfolds instead (see **Unfolding variants**).

![Popover, dark](screenshots/desktop-dark.webp)

## Workspace links page

An icon-only **link** button in each workspace's header (Lucide link icon, tooltip "Links in this workspace") opens that workspace's links as a tab in its main area, next to its chats. Paseo shows plugin header buttons on wide layouts only: from 1100 px it shows three plugin buttons, below that one plus a `⋯` overflow, and its phone layout (below 720 px) has no plugin header buttons at all, so on phones the page can't be opened yet (see Limits). **Show header button** (see Settings) turns it off.

![Links page, Flat, dark](screenshots/workspace-flat-dark.webp)

The page (a workspace panel, `client/page.tsx`) is built from the popover's parts (`client/list-ui.tsx`): the same rows, type tabs and sub-agents switch.

- **Top:** `Links` and the workspace name in muted text, a muted settings button (sliders icon) at the right, a search field (`Search 434 links`), then the popover's **type tabs** (`Web 40 · Images 157 · Files 237`, same rules: only present types, only with 2+ types, opens on Web, one at a time, kept per workspace until the app reloads) and the right-aligned faint **`+107 subagents`** switch (only when sub-agents mention links that no tab of the workspace mentioned itself).
- **Search** matches every word against the shown path, the name, the folder or host, the URL or path, the sentence and the sub-agent. While searching, the tab counts are the matches per type; an empty result reads `No links match “…”` (plus `in images` when other types do match).
- **Settings menu:** one flat menu with settings under small muted headings; so far one heading, **Grouping**: **Flat** (default, checked), **By tab**, **By site**. The pick is kept per device (web: `localStorage`; the native apps keep it until the app reloads). On phones the menu is a bottom sheet.
- **Flat:** one row per link across the workspace: type icon · path (as in the popover) · the **tab** that mentioned it last, with that tab's provider mark (Paseo's built-in marks; Bot for others such as `omp-nilo`, and on the native apps) and a muted `+2` when two more tabs mention it too · on hover the time · `×N`. Clicking the tab name opens that tab (`navigation.openAgent`). Clicking the row does what the popover does: web and images open in the browser, files copy their path and the row says `copied`, rows with variants unfold. Missing files are struck through and marked `missing`.
- **By tab:** one group per tab with its count, open tabs first (newest link first), then a muted **Closed** separator and the closed tabs, which start folded. Rows have no tab column.
- **By site:** Flat's rows grouped by host (`github.com/<owner>/<repo>` for GitHub, the configured host for the webshare) or, for files, by folder; newest group first. Rows keep the tab column.
- Groups always fold (chevron, click the heading); the folding is kept per workspace until the app reloads.
- **Scope:** the workspace's tabs (Paseo's root agents, closed ones included). Sub-agents fold into their tab behind the `+N subagents` switch: the tab's OMP or Claude Code sub-agents and every Paseo agent below it in the same workspace. **Closed tabs** (archived agents) count like open ones; their name and provider mark are faint, and their name can't be clicked (Paseo opens no tab for an archived agent).
- **Empty states:** `No links in this workspace yet` with a one-line hint; `No links match “…”` for a search.

![Links page, By tab, settings menu open](screenshots/workspace-by-tab-menu-dark.webp)

## Categories

Links are sorted by what a click does.

- **Web**: any http(s) URL, including GitHub, local mock pages and localhost. Click opens it in the browser.
- **Images**: image URLs, and image files in the webshare folder (`~/www/webshare/` by default) when a webshare origin is configured (shown by their public address). Click opens the image.
- **Files**: every other local path, including images outside the webshare. Click copies the absolute path, with the `:line` or `:a-b` suffix of its newest mention, and the row briefly says "copied".

**Type tabs.** The list's header is one tab per type the chat has, with its count (`Web 5 · Images 24 · Files 7`); a type with no links gets no tab, and tabs appear only when the chat has at least two types. One type shows at a time: tapping a tab shows that type and turns the others off. It opens on **Web** when the chat has web links, otherwise on its first type. The choice is kept per chat until the app reloads.

![Type tabs, sub-agents switch on, sub-agent rows](screenshots/subagents-dark.webp)

**One row per page.** A URL's row ignores its query string and fragment, the host's case, a default port and a trailing `/`; on the webshare `/dir/index.html` is `/dir/`. A webshare path and its configured public URL are one row. Non-image files in the webshare (for example `~/www/webshare/pages/x.html`) are Web rows. The same path with different line suffixes is one row.

**Variants.** Each distinct full URL of a row (`?v=tree&title=1`, `?v=card&title=1`, `#install`, the bare URL) is kept as a variant with its link text, mention count and last time; the RPC sends them as `variants` (newest first) only when a row has two or more. On the links page, Flat and By site merge a page's variants across every tab (and shown sub-agent links): each distinct full URL once, counts summed, newest first; By tab shows each tab's own. For that, `links.for-workspace` sends the variants of every URL link, even a single one, and the page applies the two-or-more rule after merging. The server still names rows (`title`: one shared link text, else the page name), but the rows show only the path.

**Unfolding variants.** A row with variants shows a muted `×24` at its right edge: the number of distinct full URLs mentioned (the bare URL counts only if it was mentioned on its own). It is a count, not a button: clicking (tapping) anywhere on the row unfolds the variants under it as sub-rows on a faint rail, and clicking again folds them; such a row opens nothing itself. With the keyboard, Enter on the focused row toggles, → unfolds and ← folds. The fold is kept per row (per chat in the popover, per workspace and tab on the links page) until the app reloads. The sub-rows, on the same rules in the popover, the phone sheet and the links page (Flat, By tab, By site):

- **The bare URL first**, always, reading just `no params` in muted text: the variant without query or fragment when it was mentioned, else the newest variant's URL without them; a webshare `…/index.html` becomes `…/` there, as the row's key has it.
- **Then the other variants, newest first**, each as its literal query and fragment (`?v=tree3&pathpos=below&title=1&…&sep=space`, `#install`), wrapped in full so a difference at the end (`sep=…`) shows: no names, chips or summaries. The `?`, `&`, `=` and keys are the muted colour at 60% opacity, the values and the fragment the foreground colour, so the two stay apart even in T3 Chat Dark, where the muted colour is nearly white.
- The full URL is each sub-row's accessibility label and, on the web, its hover tooltip. Hovering a sub-row on desktop shows its last-mention time at the right edge; phones show none. Sub-rows are at least 24 px high on desktop and 36 px on phones.
- A click opens that exact URL in the browser and closes the popover.

![Popover with URL variants unfolded, its row hovered](screenshots/variants-dark.webp)

**Sub-agent links.** When the chat's sub-agents mentioned links that the chat itself never did, a small text switch sits right-aligned in the header: **+18 subagents**, faint while off, full colour while on. It isn't a tab: switching it on merges those links into the list by time, each marked `↳ <sub-agent>` in muted text after its path, and they count in the type tabs like any other link; the pill keeps counting only the chat's own links. A link the chat also mentioned stays a plain row, so a chat with no sub-agents, or whose sub-agents only repeated its links, gets no switch. With only one type, the header holds just the switch. The choice is kept per chat until the app reloads.

Sub-agents are: OMP task sub-agents (`<session>/<Name>.jsonl`, nested ones and advisors included; named by file), Claude Code sub-agents (`<session>/subagents/agent-*.jsonl`; named by their task description), and Paseo child agents (label `paseo.parent-agent-id`, archived ones included; named by their title, read from their own transcripts, never through Paseo's history). The same rules as for the chat apply to their messages. When one link was mentioned by several sub-agents, the row names the one that mentioned it last.

**Missing files.** A path whose file or folder no longer exists on the daemon machine is marked: its path is muted and struck through, followed by a muted `missing` (`missing · ↳ Scout` for a sub-agent's). Webshare links count as paths here (their file in the webshare folder is checked); other web URLs are never checked. Every fetch checks each path with one `stat`. A click still copies the path, or opens the webshare URL.

**Sentences.** The server still cuts the sentence around each link's newest mention (`snippet`, used by the links page's search): Markdown stripped, every link read as its name, about 120 characters around the link; a link with too few words around it (`Saved in X.`) also gets the sentence before; an image embed on its own line gets its caption (the line under it in the same paragraph), else the line above. The rows no longer show it (until 2026-10-23, hovering a row on desktop swapped the host/folder column for it).

![Missing file and a hovered row's sentence (before 2026-10-23: names, host column, sentences)](screenshots/missing-dark.webp)

## What counts as a link

Only what you and the agent wrote in the chat: tool calls and tool output are left out. Sub-agents' messages are shown only on request (above).

- Image embeds `![alt](…)`, Markdown links `[text](…)`, autolinks `<https://…>`, bare http(s) URLs, and code spans holding exactly a URL or an absolute or `~/` path (with `:12`, `:12-20`, `:12:3` or `#L12-L20`).
- Fenced code blocks are skipped. Harness wrappers in user messages (`<system-notice>`, `<paseo-system>` and the like) and OMP `[ran …; recover: …]` records are removed first.
- Dropped: harness addresses (`artifact://`, `agent://`, `local://` and so on), placeholders containing `< > { } $ * …`, `example.com` hosts, relative paths, and paths whose top folder doesn't exist on the daemon machine (so `/btw` and `/v1/chat/completions` don't count). A code span path with spaces counts only if it exists.
- Names (the RPC's `title`, no longer shown on rows): the link text or image alt when there is one (see Variants for rows with several URLs), else the file name or the URL's last path segment (`pull/12` for numbered ones).

## Where the data comes from

The plugin's daemon side reads each chat's transcript: OMP and its profiles (`omp-nilo`) through the session file Paseo stores, Claude Code from `~/.claude/projects/`, Codex from `~/.codex/sessions/` or `~/.codex/archived_sessions/`. The transcript is looked up again on every request (a rewind gives OMP a new file), and only the bytes appended since the last read are parsed. Chats of other providers, and Codex sessions archived only as `.jsonl.zst`, use Paseo's own chat history for that agent instead. That fetch is safe because the plugin only asks for chats whose pill is on screen, which Paseo has already loaded.

The count is fetched when a chat's pill first shows, again when that chat's agent finishes a turn, and when you open the list. While the list is open and the agent is working, it refreshes every 3 seconds. Nothing polls while agents are idle. A chat's first read takes about 15 ms for a 600 KB OMP transcript; later reads cost a file `stat` plus the new bytes, plus one `stat` per path link for `missing`. Sentences are cut while the transcript is read and kept with each link, so a later fetch doesn't redo them.

Sub-agent transcripts are read only while the list is open (the pill never asks), with the same incremental cache, at most 16 files at a time. Measured on a chat (34–36 links; 8 OMP sub-agent transcripts, 6.8 MB; 18 extra links from 7 of them): the list's request took 54 ms the first time after a plugin reload (59 ms with sentences and `missing` checks) and 2–4 ms after that, against 1.5–2.5 ms without sub-agents. The Paseo child lookup costs about 1 ms. Old OMP sessions can hold hundreds of MB of sub-agent transcripts; such a chat's first open would take seconds [estimate from the 320 ms per 100 MB parse rate].

The links page asks `links.for-workspace` (`server/service.ts`): one `agents.list` (archived included, paged), Paseo's root rule (`server/workspace.ts`), then each tab's transcript through the same incremental cache, 16 at a time, and with the switch available each tab's sub-agent transcripts. It reads transcripts only, never Paseo's chat history, because most of a workspace's chats aren't loaded and a history fetch would start them; a tab of another provider lists no links. The page fetches when it becomes visible (switching to its tab, the app returning to the foreground) and every 3 seconds while any agent of the workspace is running; a hidden tab (Paseo keeps it mounted at width 0) fetches nothing. When one of the workspace's agents is created, finishes a turn, is closed or is renamed while the page is on screen, it refetches; otherwise on the next show. The 3-second refreshes are marked `poll`: they reuse the tabs listed by the last other fetch and read only their transcripts, because listing every agent costs more than the rest (2026-10-29, 616 agents on the daemon, a workspace with 72, sub-agents on, 690 KB answer: 61 ms per refresh with 44 ms of plugin and 56 ms of daemon CPU before, 22 ms with 21 ms and 5 ms after). The header button is icon-only and fetches nothing. Measured on a workspace (29 tabs, 17 of them closed, 34.8 MB of tab transcripts, 434 links, 107 more from sub-agents; machine load average 17): 0.5 s for the first request after a plugin reload (507 ms without sub-agents, 522 ms with them), then 18–28 ms without and 22–50 ms with sub-agents; the answer is 175 KB (226 KB with sub-agents).

## Settings

Settings → Plugins → noice-links-list → **Mentioned links** (route `/settings/hosts/<server>/plugins/noice-links-list/header`):

- **Buttons** (switches, applied on save without a reload; other devices pick them up when the app returns to the foreground):
  - **Show header button** (on by default): the links button in every workspace's header. Off removes it from all of them.
  - **Show composer pill** (on by default): the `N links` pill in every chat's composer. Off hides it in every chat and fetches nothing for it; on brings it back.
- **Webshare** (text fields, one Save button): maps files in the webshare folder to URLs on the webshare origin, so they are Web or Images rows that open in the browser instead of Files rows that copy their path.
  - **Webshare origin** (empty by default): the public HTTP(S) origin, e.g. `http://localhost:8080`. Empty turns the mapping off.
  - **Webshare folder** (`~/www/webshare` by default): the folder that origin serves; `~` is the daemon user's home, a relative path is under it, empty means the default.

  The daemon reads both on every request; when they changed it starts a fresh links cache, so the next fetch (opening a list or the links page, a finished turn) uses them without a plugin reload. They are stored in `~/.paseo/plugin-settings/noice-links-list/webshare.json` as `{"version":1,"values":{"origin":"…","folder":"…"}}`.

## Limits

- Files can't open in Paseo's file viewer: plugins have no API for that yet, so a click copies the path.
- Images outside the webshare folder are Files (copy), since they have no URL.
- `localhost` URLs opened from a phone point at the phone.
- In the popover, sub-agents of Paseo child agents (grandchildren) are not included; OMP's own nested sub-agents are. The links page folds every Paseo agent below a tab into it.
- The links page needs the header button: Paseo's phone layout shows no plugin header buttons, and the page has no other entry (no sidebar row or ⌘K item, by design), so phones can only show a links tab already open in that workspace.
- A closed tab can't be opened from the page; reopening it is Paseo's History or the `noice-past-sessions` plugin.
- The page lists no links for chats of providers without a readable transcript (anything but OMP, Claude Code and Codex).

After editing the source, run `npm run typecheck` and `paseo plugin reload noice-links-list`.

