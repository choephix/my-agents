---
name: ttt-editor
description: Operate or investigate Stefan's TTT terminal editor, including targeting live TTT instances in Herdr and opening files programmatically.
---

# TTT Editor

Stefan's installed `ttt` is a custom build from `/home/cx/forkspace/ttt`, not necessarily upstream `main`. Check the live binary and this checkout before relying on upstream docs.

## Ground truth

```bash
ttt --version
ttt --help
git -C /home/cx/forkspace/ttt status --short --branch
git -C /home/cx/forkspace/ttt log -1 --format='%h %cs %s'
```

Documentation: <https://tttedit.dev/>. Source inspection of `/home/cx/forkspace/ttt` is authoritative for custom behavior.

## Current capabilities

- `ttt file1 file2` opens pinned tabs in a **new** process.
- `--exec` scripts only the process being started; it is not a remote-control interface.
- TTT currently exposes no server, Unix socket, IPC, or `--remote` option for controlling an existing process.
- A running TTT inside Herdr can be targeted through its `HERDR_SESSION` and `HERDR_PANE_ID`, then driven with `herdr pane send-keys` / `send-text`.
- `Ctrl+K P` invokes **Go to File** and searches `Workspace.Paths()`. Selecting a result calls `EditorGroup.OpenFile`, so the resulting tab is pinned.
- Quick-open only covers files in the instance's workspace. The committed `plugins/remote-open` plugin and `ttt-open` CLI now use `ttt.open_file(path, line)` to open arbitrary existing paths in one selected live instance.
- Remote Open is installed globally at `~/.config/ttt/plugins/remote-open/`; its versioned sources live in `/home/cx/forkspace/ttt/plugins/remote-open/` on branch `mine`. The global plugin directory is real, with source-file symlinks, because TTT's filesystem sandbox does not support symlinking the whole plugin directory.
- Existing TTT processes must be restarted after first installation and the plugin permissions approved. New processes then expose Herdr-backed targets automatically.
- TTT currently has one editor group and no general split-editor command. Its side-by-side display is the specialized extended diff view, not two independently opened files.

## Locate live instances

Read `/proc/<pid>/environ` for `HERDR_SESSION`, `HERDR_PANE_ID`, and `PWD`; do not guess which instance Stefan means. Confirm the target by inspecting:

```bash
HERDR_SESSION=<session> herdr pane process-info --pane <pane-id>
HERDR_SESSION=<session> herdr pane read <pane-id> --source visible --lines 12 --format text
```

A stable human convention is to rename the chosen pane `main ttt`, while retaining its pane ID for commands.

## Remote Open workflow

```bash
ttt-open list
ttt-open set-main <exact-target-from-list>
ttt-open main /absolute/or/relative/file1 /path/to/file2
```

`set-main` persists the selected live instance. Herdr pane IDs survive relaunches in the same pane, so the alias is normally stable. The CLI waits for the target plugin to acknowledge the command and verifies that every input path exists before queueing it.

If `ttt-open` reports no acknowledgement, inspect whether that TTT process predates installation, has not approved Remote Open, or is showing the plugin approval dialog. Restart and approve rather than falling back to blind keyboard injection.

For a non-Herdr process, launch it with `TTT_REMOTE_NAME=<name>` and target `name:<name>`.

## Side-by-side fallback

Until TTT gains editor groups, use two Herdr panes side by side, each running TTT on the desired file. Do not describe this as two tabs side by side in one TTT instance.
