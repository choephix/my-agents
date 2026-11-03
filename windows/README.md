# Windows scripts and tools

Windows-specific scripts, utilities, and small pieces of desktop tooling.

## Portwatch

[`portwatch/`](portwatch/) automatically forwards listening development ports
from a remote SSH host to local `localhost` ports. Its local `config.json` and
`state.json` are intentionally untracked because they contain machine-specific
configuration; the script creates the config template on first run.
