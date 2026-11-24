# md-embed

`![[/abs/file.md]]` in an assistant reply shows the file inline, Obsidian style: `#Heading` or `#L10-L40` picks a part, `|Label` renames it, `[[path]]` is a plain link. Display only: the model and the session keep the text as written. Needs `extensionRenderers.assistantText` on. In Tern, [the md-embed plugin](../../../tern-plugins/md-embed) draws embeds as dashed cards.

`![[shot.png]]` (also jpg, gif, webp, avif, svg) shows the picture in the same card, under its file link, as a Markdown image with the absolute path. Other files stay as written.

An embedded `.md` file whose front matter has `settled:` (a settled slip-box slip) arrives folded in Tern: a `<details>` block whose summary reads `settled`, then the embed. The md-embed plugin draws the card with a gray outline and a tiny `settled` tag above its top right corner, and shows only its file line until the card is clicked open; the tag folds it again. A plain terminal shows the embed open, as before.

## Slip boxes

The boxes are the slip box desk's: each `boxes[].path` in `~/.config/slipbox-desk/settings.json` (`~` allowed), in that order. Edits apply on the next reply; a listed folder that doesn't exist is skipped, and a missing or broken file means no boxes. A box may be a dot-folder such as `<project>/.slipbox`: list the box folder itself, never the project.

```json
{ "boxes": [{ "path": "~/notes" }, { "path": "~/workspace/project/.slipbox" }] }
```

A path that does not start with `/` or `~/` is then read as the end of a path inside a box: it finds the file whose path, counted from its box, is that path or ends with it, whole folder and file names only. With no extension `.md` is added. So `![[2026-11-18-note]]` finds `2026-11-18-note.md` in any subfolder, `[[shot.png]]` finds `shot.png`, and `![[efforts/slip-box/map]]` or `![[slip-box/map]]` finds `efforts/slip-box/map.md` even when other efforts have their own `map.md`; `![[map]]` never finds `roadmap.md`. A link keeps working when its file, or a folder above it, moves (say `efforts/` into `trash/`), as long as the part written stays the same and matches one file. `#Heading`, `#L10-L40` and `|Label` work as above.

Boxes are searched in order, and the first that has a match decides: the box holding the file that does the embedding (for embeds inside an embedded file), then the box holding the session's working folder, then every box. With several matches there the embed shows a note linking each of them; with none anywhere it stays as written. The box of a path is the listed box folder holding it, the nearest one when boxes nest. Paths with a `.` or `..` part are not looked up. Dot-folders inside a box (`.git`, `.obsidian`, `.revisions`) and `node_modules` are skipped. Each box's file list is kept between replies and read again when any of its folders changes, so a new or moved note resolves at once; nothing runs while idle.

Embeds inside an embedded file expand too, two files deep; deeper ones become plain links, and a file is never embedded inside itself.

## Revisions

`revisions.ts`, the package's second entry, keeps a copy of what each embed showed when it was written, in `.revisions/` inside the box that holds the embedded file (a file in no box: the session's box, else the first box), so a reader (the slip box desk) can show a memo as it was rather than as it is now. It copies a reply's embeds when the reply is finalized (named by the reply's `message.timestamp`), and new embed lines in box files this session wrote at the end of each run (tagged with the embedding file), for every box the run wrote into. Nothing in a reply or a file changes. The store's layout and lookup rules are in its own `README.md`, written by the extension. `import-revisions.ts` rebuilds one box's copies for embeds written before it existed, or by sessions that didn't load it, from omp's session files: `bun import-revisions.ts --dry-run` first (`--box <folder>` picks the box when several are listed; `--copy <folder>` tries it on a copy of that box); running it again is safe. Failures go to `.revisions/errors.log`; a run is never stopped.
