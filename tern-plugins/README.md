# Tern plugins

Plugins for [Tern](https://stencil.so/tern). Install them on every machine whose Tern app you use: a plugin's window half runs in that app, not on the server its tabs live on. Run these in a terminal on that machine (`git` must be installed).

## [Choices](choices)

Click an agent's `[label](<@prompt>)` link in an omp chat to put `> prompt` into omp's message box, ready to edit and send.

```sh
tern plugin install github.com/choephix/my-agents/tern-plugins/choices --force
```

`--force` replaces an installed copy, so the same command installs and updates.
