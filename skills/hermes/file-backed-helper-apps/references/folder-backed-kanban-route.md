# Folder-backed Kanban route pattern

Session pattern from Rhinox Console: build a compact status board from markdown files where directory location is workflow state.

## Shape

```text
<root>/kanban/
  backlog/*.md
  ongoing/*.md
  review/*.md
  done/*.md
```

Each card is a markdown file. Moving the file changes status; no DB or drag-and-drop state is needed.

```md
---
title: Folder-backed Kanban UI
---

Body text becomes the compact card excerpt.
```

## Reader behavior

- Use an explicit root constant; do not expose arbitrary browsing.
- Known status order: `backlog`, `ongoing`, `review`, `done`.
- Append discovered extra status directories after known statuses.
- Treat missing root/status directories as empty columns.
- Display frontmatter `title`, fallback to filename stem.
- Strip frontmatter and basic markdown markers for a short excerpt.
- Keep source path/relative path available as tiny secondary metadata.

## UI behavior

- Four compact columns, small uppercase column headers, tiny counts.
- Cards should be text-first with hairline separators; avoid heavy bordered dashboard cards.
- Use restrained typography even when the overall style is bold/minimal.
- No drag/drop until explicitly requested: the satisfying primitive is `mv backlog/foo.md ongoing/foo.md` and refresh.

## Verification notes

- Run typecheck and build.
- Smoke-test `/` and `/kanban` so the homepage link and route both render.
- If project instructions forbid starting the dev server, use an existing server for visual inspection or a temporary alternate-port production server that is killed after curl checks.
