---
name: file-backed-helper-apps
description: Build and evolve small local helper web apps whose routes read real project/workspace files from explicit roots, without prematurely adding databases or write access.
version: 1.0.0
platforms: [linux, macos]
environments: [local-dev]
metadata:
  hermes:
    tags: [nextjs, local-tools, file-backed, ui, verification]
---

# File-backed helper apps

Use this when Stefan asks to build, extend, test, or polish a small local helper web app that surfaces workspace context from files: Markdown notes, artifacts, plans, worktree metadata, logs, or project folders.

## Principles

- **Files are the source of truth.** Read project/workspace files directly from explicit roots.
- **Use named roots.** Prefer constants like `WORKSPACE_ROOT = "/mnt/..."`; do not add arbitrary path browsing from the UI.
- **Read-only first.** Do not add write actions to Obsidian, projects, or Hermes artifacts unless Stefan explicitly asks.
- **Thin routes, reusable readers.** Put scanning/parsing logic in `lib/`; route files should mostly configure and render.
- **No database by default.** Add SQLite/cache/indexes only after route latency or durable interaction state requires it.
- **Local/private by default.** Binding to `0.0.0.0` is fine for LAN testing when requested, but do not expose publicly or add tunnels without explicit approval.

## Implementation checklist

1. Identify the route and the data root(s) it may read.
2. Add or reuse a file-backed reader under `lib/`.
3. Parse lightweight metadata at the reader layer, not in page components.
   - For Markdown, prefer frontmatter fields like `title` for display.
   - Always keep a stable fallback such as filename stem.
4. Keep page components simple: intro, list/detail display, links/navigation.
5. Add a shared layout/header early when there is more than one page.
6. Update `package.json` scripts if the desired dev access pattern changes.
7. Verify with real commands and a live route smoke test before reporting done.

## Minimal modern UI direction

When Stefan asks to make a helper app look better, avoid default dashboard/card soup:

- Use strong typography, whitespace, and sparse accent color before adding boxes.
- Prefer hairlines/separators over bordered cards.
- Use one subtle global header for app identity and back/home navigation.
- Keep functional content scannable; if filenames are ugly, display human titles from metadata and relegate filenames to small secondary text only when useful.
- Preserve the app’s utility: bold can still be quiet and fast.
- **Typography restraint matters.** Stefan likes bold/minimal, not billboard-scale. After any dramatic visual pass, inspect the rendered page and clamp hero/list/card text to normal reading sizes. If he says font sizes are “insane,” treat that as a class-level UI correction: reduce hero scale, row/card titles, and spacing before declaring the design acceptable.

### Compact board/list UIs

For file-backed status boards, represent state by folder location instead of inventing app state:

- Use a root like `<project-home>/kanban/<status>/*.md`.
- Status folder order can be explicit (`backlog`, `ongoing`, `review`, `done`) with discovered extras appended.
- Moving work is `mv old-status/card.md new-status/card.md`; the route should refresh from files.
- Card display: prefer an in-note leading H1 (`# Title`) when that is the human title, then frontmatter `title`, then filename fallback. If promoting an H1 to the card title, strip it from the body/excerpt so the title does not repeat.
- Do not surface ugly filenames or paths unless they help action. If Stefan objects to visible filenames/paths, move the full source path to a tooltip on the title and keep filenames hidden.
- Do not truncate text in the data layer by arbitrary character counts for UI previews. Return cleaned body text and let CSS line-clamp/ellipsis control visual truncation; four-line clamps are often more useful than two-line clamps for work notes.
- Render hashtag tags as small bottom chips when useful. Merge/dedupe frontmatter tags and body hashtags; avoid duplicating “signal” pills like `kind: promise` or `status: open` when they add no decision value.
- UI should be compact columns/lists with small headers/counts and readable cards, not drag-and-drop unless explicitly requested.

### File-backed write actions

Default to read-only, but when Stefan explicitly asks for a write action:

- Keep the action close to the item (for example, a bottom-right `CLOSED` button on a promise card).
- For destructive/status-changing buttons, use ghost styling by default; if requested, reveal subtle background via the parent hover group and stronger background only on direct button hover.
- Do not nest buttons/forms inside item links. Split the row into an item link area plus a separate form/action area.
- Server-side action should validate the target path stays under the configured root before writing.
- For Markdown status changes, preserve existing frontmatter when possible, replace an existing `status:` line, or add frontmatter/status when missing, then revalidate/refresh the route.

### File-backed note dashboards

When surfacing Markdown notes as a work dashboard, avoid repeating machine/source metadata that does not help Stefan act:

- Prefer human note titles over filenames. For Obsidian-style notes, parse a leading Markdown H1 (`# Title`) and use it as the card heading before falling back to frontmatter `title` and then filename.
- Strip the promoted H1 from the body/excerpt so the title does not repeat immediately below itself.
- Hide long file paths from the main row/card text. If the path is still useful, put it in a `title` tooltip on a compact filename/source label.
- Do not show constant metadata as badges (for example `kind: promise` on an all-promise route) or status pills that add no decision value (for example `status: open` when the whole group is open).
- Group by meaningful state instead of badging every item. Treat missing status according to the domain rule (for promises, missing status means `open`), and fade non-active/non-open groups rather than making them compete visually with active work.

## Dev server pattern

For a local helper that should be reachable from other devices on the LAN, make the default dev command explicit:

```json
{
  "scripts": {
    "dev": "next dev --hostname 0.0.0.0 --port 3432",
    "dev:local": "next dev"
  }
}
```

Adjust the port per project. Verify with `ss -ltnp` and `curl` against `127.0.0.1:<port>`; give Stefan the likely LAN URL only after checking live network addresses if needed.

## Verification checklist

Run the project’s real checks, usually:

```bash
npm run typecheck
npm run build
npm run dev
curl -fsS http://127.0.0.1:<port>/<route> | head -c 1000
```

If the repo has `AGENTS.md` / project instructions that forbid starting the dev server, obey them. Prefer an already-running server for browser inspection, or use a short-lived production smoke test on a different loopback port and stop it immediately. Do not leave surprise servers running.

If a dev server is already bound but hangs on HTTP, restart the tracked process only when project instructions allow it, then smoke test again. Capture the recovery as “restart stale/hung dev server,” not as a durable claim that the framework or browser tooling is broken.

## Kanban tracking

If Stefan says the project has a dedicated Hermes Kanban board, use it as the audit trail:

- create one narrow card per workstream,
- claim cards before editing,
- complete cards with the files changed and verification summary.

See `kanban-orchestrator` for board command details and the direct-implementation audit pattern.

## References

- `references/rhinox-console-mvp.md` — session pattern: Next.js file-backed console with frontmatter titles, LAN dev script, shared minimal header, and verification flow.
- `references/folder-backed-kanban-route.md` — session pattern: Markdown folder-as-status Kanban route with compact columns, frontmatter titles, and filesystem moves as workflow transitions.
- `references/notebox-promises-route.md` — session pattern: Markdown note dashboard with H1 title promotion, hidden paths/filenames, CSS-only preview clamping, tag chips, status grouping, and guarded frontmatter write actions.
- `references/notebox-promises-route.md` — session pattern: Obsidian promise-note dashboard with candidate filters, H1 title promotion/stripping, path-as-tooltip, status grouping, and faded non-open states.
