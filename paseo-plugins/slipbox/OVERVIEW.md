# Slip-box

Attach, read, settle, and capture Markdown notes from a local slip-box folder directly inside Paseo. Works on desktop, web, iOS, and Android.

## Capabilities

- **Composer attachment source (Attach Slip):** Open the attachment menu in any chat or draft composer to search slips by title, file name, folder, kind, emoji, `about:` project, settled state, or body text. Open memos rank first sorted by most recently modified. Selecting a slip attaches a text snapshot including its relative path, absolute host path, wiki link (`[[name]]`), kind, status, and Markdown contents (snapshots over 32 KiB truncate cleanly with the file path).
- **Slip file panel (`.md`, `.markdown`):** Choose **Slip** in Paseo's file panel picker, **Open with...**, or **Settings -> Files**. Files inside the slip-box (or with slip front matter) display a compact metadata header (emoji, kind, open or settled status, due date, `about`, clickable `from` wiki links, and external `source` links), live reload on disk edits, one-tap **Settle**, **Save & settle**, and **Reopen** buttons, a **[[link]]** copy button, clickable `[[wiki]]` links, inline `![[image]]` embeds, collapsible `![[slip]]` embed cards (settled embeds start collapsed), a collapsible **Referenced by** backlinks footer, and a **Preview / Source** toggle for quick edits. Files under `captures/` stay read-only by convention. Plain Markdown files outside the slip-box render cleanly without slip metadata chrome.
- **Quick capture (`/slip` and Command Center -> New slip):** Run `/slip [kind:] <title or note>` in any chat to save a new dated slip (for example `/slip ask: Should retries back off exponentially?`) and append a confirmation card to the timeline with a link to open the file, copy `[[name]]`, or insert it into the composer. Run `/slip` with no arguments, or choose **New slip** from the Command Center, to open the full form with kind picker, emoji, `about` folder, and Markdown body.

## How it works

The plugin reads the slip-box folder on demand and caches parsed notes by file modification time and size, with no background watchers or polling while idle. File panel edits and settle actions write through Paseo's conflict-safe file handle and warn before overwriting external changes.

## Setup

Requires Paseo `>=0.17.0`.

Configure the folder in **Settings -> Plugins -> Slip-box**, or leave it empty to auto-detect in this order on the daemon host:

1. The **Slip-box folder** plugin setting.
2. The `SLIPBOX_DIR` environment variable.
3. The first box path in `~/.config/slipbox-desk/settings.json`.

If the folder contains a `memos/` subdirectory, the plugin scans `memos/` plus optionally `captures/`, `scraps/`, and `efforts/` (skipping `mocks/`, `attachments/`, `node_modules/`, and dot-folders such as `.revisions/` and `.git/`), and `/slip` writes new memos into `memos/` and `capture:` notes into `captures/`. Otherwise it scans and writes Markdown files directly inside the configured folder.

## Settings

- **Slip-box folder:** Absolute path (or `~/...`) on the daemon host. Empty enables automatic detection.
- **Include captures:** Include notes under `captures/` in attachment search results (on by default).
- **Include scraps and efforts:** Include notes under `scraps/` and `efforts/` in attachment search results (on by default).
- **Include settled slips:** Include slips whose front matter sets `settled:` in attachment search results (on by default; open memos still rank first).

## Data and limits

- Reads Markdown files (up to 2 MiB each) from the configured slip-box folder on the daemon host when searching, opening a Markdown file in the Slip panel, or checking plugin settings.
- Writes to files only when you explicitly settle, reopen, save edits in the Slip panel, or create a slip via `/slip` or **New slip**.
- Never overwrites an existing filename when creating a slip; collisions get numeric suffixes (`-2`, `-3`, ...).
- Does not watch the filesystem or run background timers while idle (the Slip file panel watches only the open file while its tab is mounted).
