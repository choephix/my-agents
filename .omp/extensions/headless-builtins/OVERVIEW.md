Makes OMP's TUI-only built-ins `/tan`, `/omfg` and `/btw` work over RPC (Paseo, omp-web, any `omp --mode rpc|rpc-ui` client). Installed by the symlink `~/.omp/agent/extensions/headless-builtins` → this folder. Only RPC input is intercepted; the TUI keeps its own commands.

## How

- An `input` hook (prompt, steer and follow-up all run it) matches `/tan`, `/omfg` and `/btw`, finds the live AgentSession in OMP's `AgentRegistry`, and runs the command in the background. The hook returns at once, and failures become error notifications.
- `/tan` and `/omfg` run OMP's own TUI controllers, with status lines and dialogs mapped to RPC UI. `/omfg` reports its outcome as a notification. Inside Paseo (`PASEO_AGENT_ID` set), `/tan`'s "Dispatched background tan bg_N" status is not posted, because the plugin `noice-omp-slash-aliases` shows each tangent as a row of its own.
- `/btw` runs `RpcBtwController` (`@oh-my-pi/pi-coding-agent/modes/rpc/rpc-btw`), OMP's headless engine behind the RPC `btw` command. It uses the native prompt and full memory, leaves history unchanged, works while a turn streams, and saves answers in the session's /btw history.
  - With `PASEO_AGENT_ID` set (Paseo), `btw-outbox.ts` writes `$PASEO_HOME/omp-btw/<agentId>/<id>.json` atomically: once at start, about every 150 ms while streaming, and once at the end. A `<id>.dismissed` marker from the Paseo plugin `noice-omp-slash-aliases` cancels a running answer and stops further writes.
  - Each RPC process also writes `.process-<pid>`, so the plugin can tell agents that have `/btw` from agents started before it.
  - Without Paseo, the finished answer is posted as a notification.
- OMP serves these module specifiers from its own build (verified against omp 18.11.0). `~/.omp/node_modules/@oh-my-pi` is not used for them.

## Limits

- One `/btw` at a time per session (OMP's rule). No `/btw` follow-ups.
- `/tan` has no MCP tools.
- Running agents load extensions only at start. Restart or reload an OMP agent (`paseo agent reload <id>`) to pick up changes.
- If an OMP update moves a controller module, the extension fails to load (OMP reports it) and these commands reach the model as plain text again.

Disable: remove the symlink `~/.omp/agent/extensions/headless-builtins`, then restart OMP agents.

Tests: the outbox file contract is tested from the plugin (`paseo-plugins/noice-omp-slash-aliases/server/btw-outbox.test.ts`, which imports `btw-outbox.ts`).
