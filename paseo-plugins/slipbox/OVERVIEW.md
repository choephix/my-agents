# Slip-box

Search and attach Markdown notes from a local slip-box folder directly from Paseo's composer attachment menu. Works on desktop, web, iOS, and Android.

## How it works

Open the attachment menu in any chat or draft composer and choose **Attach Slip**. With an empty query, open memos appear first sorted by most recently modified, followed by other open notes and settled slips. Typing filters across title, file name, folder, kind, emoji, `about:` project, settled state, and note body.

Selecting a slip attaches a complete text snapshot to the prompt, including its relative path, absolute path on the host, wiki link (`[[name]]`), kind, status, and Markdown contents (snapshots over 32 KiB are truncated with the file path so the agent can read the rest).

The plugin reads the slip-box folder on demand and caches parsed notes by file modification time and size, with no background watchers or polling while idle.

## Setup

Requires Paseo `>=0.17.0`.

Configure the folder in **Settings -> Plugins -> Slip-box**, or leave it empty to auto-detect in this order on the daemon host:

1. The **Slip-box folder** plugin setting.
2. The `SLIPBOX_DIR` environment variable.
3. The first box path in `~/.config/slipbox-desk/settings.json`.
4. `vaultFolder` in `~/.omp/agent/md-embed.json`.

If the folder contains a `memos/` subdirectory, the plugin scans `memos/` plus optionally `captures/`, `scraps/`, and `efforts/` (skipping `mocks/`, `attachments/`, `node_modules/`, and dot-folders such as `.revisions/` and `.git/`). Otherwise it scans Markdown files across the folder directly.

## Settings

- **Slip-box folder:** Absolute path (or `~/...`) on the daemon host. Empty enables automatic detection.
- **Include captures:** Include notes under `captures/` in search results (on by default).
- **Include scraps and efforts:** Include notes under `scraps/` and `efforts/` in search results (on by default).
- **Include settled slips:** Include slips whose front matter sets `settled:` (on by default; open memos still rank higher).

## Data and limits

- Reads Markdown files (up to 2 MiB each) from the configured slip-box folder on the daemon host when searching or opening plugin settings.
- Sends selected slip contents to the agent as a text attachment when you submit a prompt.
- Does not modify files or watch the filesystem while idle.
