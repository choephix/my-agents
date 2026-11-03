# portwatch

Auto port forwarding from a remote dev box over SSH. Polls the remote host
for listening TCP ports owned by your user, filters them by project folder,
and keeps one local `ssh -N -L` forward alive per port. Dev servers on the
remote box become reachable at `http://localhost:<port>` on this machine
without binding anything to `0.0.0.0`.

## Usage

```powershell
.\portwatch.ps1              # pick a host from a menu (most recently used first)
.\portwatch.ps1 -Target beast
```

The menu lists concrete `Host` entries from `~/.ssh/config` (wildcard
patterns are skipped; `Include` directives are followed). Navigate it with
Up/Down + Enter, press 1-9 for a quick pick, or Esc to quit.

## Keys (watch screen)

- **Up/Down** (also Home/End) — select a port. The selected row is
  highlighted and a detail panel below the table shows the local URL, ssh
  child PID, forward uptime, respawn attempts, remote listen address,
  remote PID, process start time, working directory, and full command line.
- **Enter** — open `http://localhost:<selected port>` in the default browser.
- **A** — prompt for another remote port and keep forwarding it for this
  portwatch run. The port may be outside `allowedFolders` and may not be
  listening yet; portwatch keeps trying until you quit. The local and remote
  port numbers are the same.
- **R** — poll the remote host immediately instead of waiting for the timer.
- **Q** or **Esc** — quit and close every forward (Ctrl+C also works).

## Config (`config.json`)

```json
{
  "pollSeconds": 3,
  "hosts": {
    "beast": { "allowedFolders": ["~/work"] }
  }
}
```

- `hosts.<alias>.allowedFolders` — only ports whose owning process has its
  working directory under one of these remote paths get forwarded. `~` is
  expanded to the remote home. A host with no entry (or an empty list)
  forwards **all** of your user's listening ports.
- `pollSeconds` — poll interval; also overridable per run with `-PollSeconds`.

`state.json` (created automatically) just stores the most-recently-used host
order for the menu.

## Statuses

- `up` — forward running and the local port is bound.
- `starting` — ssh child spawned, local socket not confirmed yet.
- `conflict` — something else on this machine already listens on that port;
  portwatch skips it and rechecks each poll. Orphaned forwards from a
  previous portwatch run (e.g. the console window was closed with X, which
  skips cleanup) are recognized by their ssh command line and silently
  adopted instead.
- `failed` — the forward died 5 times in a row; it stays parked until the
  remote port disappears and comes back.

## Requirements / limitations

- Windows built-in OpenSSH client (`ssh.exe` on PATH — stock on Win 10/11).
- Passwordless (key/agent) auth to the target; everything runs with
  `BatchMode=yes`, so a password prompt shows up as a failed probe.
- Remote must be Linux with `ss` (iproute2) and bash. Port owner detection
  reads `/proc/<pid>/cwd`, which only works for processes owned by the SSH
  user — system services and other users' ports are invisible, which is by
  design.
- Docker-published ports are owned by `docker-proxy` (cwd `/`), so folder
  filtering won't match them; with no folder filter they forward fine.
- One `ssh.exe` process per forwarded port (Windows OpenSSH has no
  ControlMaster). Each is a few MB; a dozen is negligible.
