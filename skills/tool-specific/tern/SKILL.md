---
name: tern
description: Control Tern, Stefan's terminal (tabs, panes, sessions): open a tab or split running a command, type into a pane, read its screen, wait for its program, follow events, drive its browser; link Stefan to a pane; or set which theme Tern shows per omp profile, session or host. Works from any shell of user cx, inside a Tern pane or not.
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
tern close "$id"
```

`--keep-open` keeps a tab whose program succeeds; without it the tab closes on exit 0 and there is nothing to capture. `tern run BLOCK CMD…` types into an existing shell pane; `tern send BLOCK keys|text|paste …` for anything finer.

Tabs you open for a check are yours to close before yielding.

## Links to a pane

`http://HOST/tern/focus/<pane>`, HOST being `hostname`'s output, switches Stefan's Tern window to that pane when he clicks it; `<pane>` is the numeric block id (`$TERN_PANE` inside it, or `tern ls --json`). Give one whenever you point him at a Tern session. The link dies with the pane. On this machine HOST does not answer; `http://127.0.0.1:7070/tern/focus/<pane>` is the same route.

## Theme rules

Stefan's Tern app runs the [theme-rules plugin](~/workspace/my-agents/tern-plugins/theme-rules), which sets Tern's theme from `~/.config/tern-theme/rules.json` on this server (served to the app through webshare at `<webshare origin>/tern-theme/rules.json`). To make "this profile / this session / anything on this host" use a theme, edit that file:

```json
{
  "dirs": { "nilo": "nilo" },
  "rules": [
    { "host": "ark", "theme": "dark-retro", "light": "light-retro" },
    { "profile": "nilo", "theme": "dark-forest" },
    { "session": "Nilo", "theme": "dark-nord" }
  ]
}
```

- The first rule whose every key matches wins; order the list by priority. Keys compare case-insensitively.
- `profile` is the omp profile of the focused pane's omp (`default` when none is picked); it never matches a pane without omp. Your own is `$OMP_PROFILE`, else the `profiles/<name>/` part of your session file's path, else `default`. `dirs` mirrors the `omp()` wrapper in `~/.bashrc`: a bare `omp` under a folder named `nilo` or `nilo-*` runs profile `nilo`.
- `session` is the Tern session name (`tern ls --json`); `host` is the machine the session runs on, bare (`ark`): Tern's `user@` and `:port` around it are ignored. "Theme rules: why this theme" in Tern's palette shows the exact host, session and profile.
- `theme` sets the dark appearance, `light` the light one; an appearance a rule leaves out keeps Stefan's own pick. Names come only from [themes.txt](~/workspace/my-agents/tern-plugins/theme-rules/themes.txt); an unknown one shows Stefan an error toast and the rule is skipped.
- With no rule matching, Tern goes back to the theme Stefan last picked himself.

The change shows on Stefan's next focus change or command, within about 5 seconds of the edit. Check the JSON parses (`jq . ~/.config/tern-theme/rules.json`).
