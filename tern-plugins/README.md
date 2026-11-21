# Tern plugins

Plugins for [Tern](https://stencil.so/tern). Install them on every machine whose Tern app you use: a plugin's window half runs in that app, not on the server its tabs live on. Run these in a terminal on that machine (`git` must be installed).

## [Choices](choices)

Click an agent's `[label](<@prompt>)` link in an omp chat to put `> prompt` into omp's message box, ready to edit and send.

```sh
tern plugin install github.com/choephix/my-agents/tern-plugins/choices --force
```

`--force` replaces an installed copy, so the same command installs and updates.

## [Markdown embeds](md-embed)

Draws the embeds of the [md-embed omp extension](../.omp/extensions/md-embed) (`![[/abs/file.md]]` in a reply) as quiet dashed cards instead of blue NOTE callouts, and folds a settled slip's embed behind a muted `Settled · <name>` line until it is clicked.

```sh
tern plugin install github.com/choephix/my-agents/tern-plugins/md-embed --force
```

## [Theme rules](theme-rules)

Switches Tern's theme by rules: the focused omp's profile, the current session, the session's host. The rules are a JSON file on the server your agents run on, served over HTTP (webshare: `~/www/webshare/tern-theme` → `~/.config/tern-theme`), so an agent there edits the file and the theme follows on the next focus change. After installing, run Palette › "Theme rules: set rules URL" once on that machine and paste the file's URL (`<webshare origin>/tern-theme/rules.json`). Palette › "Theme rules: why this theme" shows the host, session and profile Tern sees and which rule matched.

```sh
tern plugin install github.com/choephix/my-agents/tern-plugins/theme-rules --force
```
