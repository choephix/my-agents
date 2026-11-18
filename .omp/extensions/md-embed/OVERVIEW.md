# md-embed

`![[/abs/file.md]]` in an assistant reply shows the file inline, Obsidian style: `#Heading` or `#L10-L40` picks a part, `|Label` renames it, `[[path]]` is a plain link. Display only: the model and the session keep the text as written. Needs `extensionRenderers.assistantText` on. In Tern, [the md-embed plugin](../../../tern-plugins/md-embed) draws embeds as dashed cards.

## Vault folder

Set `vaultFolder` in `$PI_CODING_AGENT_DIR/md-embed.json` (normally `~/.omp/agent/md-embed.json`) to an absolute path, Obsidian's "vault". Edits apply on the next reply; a missing file or empty value turns it off.

```json
{ "vaultFolder": "/home/me/notes" }
```

A bare name, with no `/` and no `~/`, is then looked up in that folder and its subfolders by file name: `![[2026-11-18-note]]` finds `2026-11-18-note.md`, `[[shot.png]]` finds `shot.png`, and `#Heading`, `#L10-L40` and `|Label` work as above. With several matches the embed shows a note linking each of them; with none it stays as written. Dot-folders (`.git`, `.obsidian`) and `node_modules` are skipped. The file list is kept between replies and read again when any of its folders changes, so a new or moved note resolves at once; nothing runs while idle.

Embeds inside an embedded file expand too, two files deep; deeper ones become plain links, and a file is never embedded inside itself.
