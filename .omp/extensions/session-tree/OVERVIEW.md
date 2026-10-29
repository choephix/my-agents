Companion of the Paseo plugin `noice-omp-tree` (`paseo-plugins/noice-omp-tree/`): moves a Paseo-hosted OMP chat around its own session tree (OMP's `/tree`). Loaded for Paseo's OMP agents (all profiles) by the `extensions:` entry in `~/.paseo/omp-overlay.yml` (Paseo's `omp`/`omp-nilo` providers set `PI_CONFIG_FILES` to it). If it is ever loaded twice, the second copy does nothing.

## How

- Active only in `omp --mode rpc|rpc-ui` processes with `PASEO_AGENT_ID` (Paseo's hosts); does nothing in the TUI.
- Writes `~/.paseo/omp-session-tree/<agentId>/.process-<pid>` and watches that folder for `<id>.request.json` files from the plugin. The process whose live session file matches claims a request by renaming it, then writes `<id>.result.json` (running → done | cancelled | error). `<id>.cancel` stops a running summary.
- `goto {target}`: `AgentSession.navigateTree(target)` (a user message moves to its parent). `summarize {from, fork, focus}`: only while the chat still sits at `fork`; goes back to `from`, then `navigateTree(fork, {summarize: true, customInstructions: focus})` → real `branch_summary` at the fork.
- Every move ends with a `custom` entry `paseo-session-tree` under the new leaf (hidden from the model and from Paseo), so the move survives restarts and the plugin can see where the chat came from.
- Uses the live AgentSession from `AgentRegistry` (matched by session file), not `ctx.navigateTree`: the extension wrappers drop `customInstructions` (omp 18.12.2). Refuses while the session is busy.

## Limits

- Running agents load extensions only at start; the plugin reloads a chat that lacks the extension on its first move (or run `paseo agent reload <id>`).
- Coupled to AgentSession members `navigateTree`, `abortBranchSummary`, `isBusyForSnapshot` and SessionManager `getSessionFile/getLeafId/getEntry/appendCustomEntry/flush`. If an OMP update changes them, moves fail with an error toast.

Disable: remove its line from `~/.paseo/omp-overlay.yml`, then reload OMP agents.
