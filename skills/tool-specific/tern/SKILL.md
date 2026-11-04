---
name: tern
description: Control Tern, Stefan's terminal (tabs, panes, sessions): open a tab or split running a command, type into a pane, read its screen, wait for its program, follow events, drive its browser. Works from any shell of user cx, inside a Tern pane or not.
---

# tern

Tern's tabs and their programs live in a session daemon on this server; Stefan's window on his PC is a live view of it. Every `tern` subcommand below acts on that daemon, so what you do appears on his screen at once. Outside a Tern pane the command needs `XDG_RUNTIME_DIR` (Paseo and login shells have it); "no Tern is running" means it is missing, not that Tern is down.

Use only the scripting subcommands: `ls inspect new split run move pip dock rename focus close kill wait keep-open send capture process events browser open`. Bare `tern`, `tern DIR` and any option the command does not know open a new window or tab on Stefan's screen. `tern help dev` (`ctl`, `serve`, `shot`) is Tern's own test harness and never reaches his window.

`tern COMMAND --help` is the reference for arguments. Add `--json` for machine-readable output.

## Flow

A pane is a BLOCK: its id, `@focused`, its title or its program name (`SESSION/BLOCK` to look in one session). Take ids from `--json` output rather than titles, which Stefan renames.

```sh
tern ls --json                                   # sessions, tabs, blocks
id=$(tern new tab --json --cwd DIR --keep-open -- CMD… | jq .block)
tern wait "$id" --until exit --timeout 60        # or --until prompt | idle=MS; 124 = timed out
tern capture "$id" --scrollback                  # what the pane shows
tern close "$id"                                 # leave his tabs as you found them
```

`--keep-open` keeps a tab whose program succeeds; without it the tab closes on exit 0 and there is nothing to capture. `tern run BLOCK CMD…` types into an existing shell pane; `tern send BLOCK keys|text|paste …` for anything finer.

Tabs you open for a check are yours to close before yielding.
