# Rhinox Console MVP pattern

Session-specific reference for `file-backed-helper-apps`.

## Context

Rhinox Console is a small local Next.js helper app. The app pattern is: one evolving app, many small routes, each route reads real local files from explicit allowlisted roots. Current example route: `/workspace-todos` reads Markdown from an Obsidian-mounted Workspace folder and displays notes containing `#todo` or `#to-do`.

## Useful implementation details

- Keep file scanning reusable in a library module, not copied into route files.
- Return both machine-ish fallback fields and human display fields:
  - `name`: filename stem fallback.
  - `title`: frontmatter `title` if present, else fallback to `name` at the route-specific data layer.
- Parse frontmatter near the Markdown reader so future routes can reuse the metadata.
- Use `sourcePath` as a stable React key instead of display title/filename.
- If displayed files mostly lack titles, the implementation can still be correct; verify with a Markdown fixture or by checking files that contain `title:`.

## UI choices that worked

- One thin sticky header mounted in the root layout.
- Brand/home link on the left; back-home link on non-home pages.
- Replace old card-heavy styling with:
  - near-black background,
  - large tight headings,
  - sparse accent color,
  - hairline list separators,
  - secondary filename only when different from title.

## Dev server pattern

When the user wants LAN access, make the default script explicit:

```json
"dev": "next dev --hostname 0.0.0.0 --port 3432",
"dev:local": "next dev"
```

Then verify the listener and live routes:

```bash
npm run typecheck
npm run build
npm run dev
ss -ltnp | grep ':3432'
curl -fsS --max-time 20 http://127.0.0.1:3432/ -o /tmp/root.html
curl -fsS --max-time 30 http://127.0.0.1:3432/workspace-todos -o /tmp/workspace-todos.html
```

## Kanban notes

If tracking work on the dedicated board, the board flag comes before the subcommand:

```bash
hermes kanban --board rhinox-console create ...
hermes kanban --board rhinox-console claim <task-id> --profile default
hermes kanban --board rhinox-console complete <task-id> --result "..."
```

Using `hermes kanban create --board ...` is the wrong argument order.
