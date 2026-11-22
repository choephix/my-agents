# md-embed

`![[/abs/file.md]]` in an assistant reply shows the file inline, Obsidian style: `#Heading` or `#L10-L40` picks a part, `|Label` renames it, `[[path]]` is a plain link. Display only: the model and the session keep the text as written. Needs `extensionRenderers.assistantText` on. In Tern, [the md-embed plugin](../../../tern-plugins/md-embed) draws embeds as dashed cards.

`![[shot.png]]` (also jpg, gif, webp, avif, svg) shows the picture in the same card, under its file link, as a Markdown image with the absolute path. Other files stay as written.

An embedded `.md` file whose front matter has `settled:` (a settled slip-box slip) arrives folded in Tern: a `<details>` block whose summary reads `settled`, then the embed. The md-embed plugin draws the card with a gray outline and a tiny `settled` tag above its top right corner, and shows only its file line until the card is clicked open; the tag folds it again. A plain terminal shows the embed open, as before.

## Vault folder

Set `vaultFolder` in `$PI_CODING_AGENT_DIR/md-embed.json` (normally `~/.omp/agent/md-embed.json`) to an absolute path, Obsidian's "vault". Edits apply on the next reply; a missing file or empty value turns it off.

```json
{ "vaultFolder": "/home/me/notes" }
```

A path that does not start with `/` or `~/` is then read as the end of a path inside that folder: it finds the one file there whose path, counted from the vault folder, is that path or ends with it, whole folder and file names only. With no extension `.md` is added. So `![[2026-11-18-note]]` finds `2026-11-18-note.md` in any subfolder, `[[shot.png]]` finds `shot.png`, and `![[efforts/slip-box/map]]` or `![[slip-box/map]]` finds `efforts/slip-box/map.md` even when other efforts have their own `map.md`; `![[map]]` never finds `roadmap.md`. A link keeps working when its file, or a folder above it, moves (say `efforts/` into `trash/`), as long as the part written stays the same and matches one file. `#Heading`, `#L10-L40` and `|Label` work as above. With several matches the embed shows a note linking each of them; with none it stays as written. Paths with a `.` or `..` part are not looked up. Dot-folders (`.git`, `.obsidian`) and `node_modules` are skipped. The file list is kept between replies and read again when any of its folders changes, so a new or moved note resolves at once; nothing runs while idle.

Embeds inside an embedded file expand too, two files deep; deeper ones become plain links, and a file is never embedded inside itself.

## Revisions

`revisions.ts`, the package's second entry, keeps a copy of what each embed showed when it was written, in `.revisions/` inside the vault folder, so a reader (the slip box desk) can show a memo as it was rather than as it is now. It copies a reply's embeds when the reply is finalized (named by the reply's `message.timestamp`), and new embed lines in vault files this session wrote at the end of each run (tagged with the embedding file). Nothing in a reply or a file changes. The store's layout and lookup rules are in its own `README.md`, written by the extension. `import-revisions.ts` rebuilds copies for embeds written before it existed, or by sessions that didn't load it, from omp's session files: `bun import-revisions.ts --dry-run` first; running it again is safe. Failures go to `.revisions/errors.log`; a run is never stopped.
