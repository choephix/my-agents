Per-chat instructions for OMP: appends `~/.omp/agent/session-instructions/<sessionId>.md` to the system prompt of every turn of that session, under the heading `## Instructions for this chat`. Unlike text in a message, it survives compaction. The Paseo plugin `noice-omp-slash-aliases` edits these files (the `Instructions` pill and `/instructions`). Installed by the symlinks `~/.omp/agent/extensions/session-instructions` and `~/.omp/profiles/nilo/agent/extensions/session-instructions` → this folder.

## How

- `before_agent_start` returns `{ systemPrompt: [...event.systemPrompt, text] }` (omp 18.14.0). OMP emits it before every run: a typed prompt, and steer, follow-up and custom messages that start a run (`/follow-up`, background-job deliveries). OMP keeps the returned prompt for the whole run, tool loops included. Compaction leaves the system prompt alone.
- The file is read on every turn; no watcher. No file, or an empty one, changes nothing. An edit applies from the next turn, and since it changes the system prompt, the provider's prompt cache misses once.
- Session copies: `/prose` and forks write a new session whose header names its source in `parentSession` (a file path or a bare id). Once per process, a session without a file of its own copies the nearest ancestor's file (walking up to 20 levels; a bare id is looked up in the child's folder). After that the two chats' instructions are independent. The copy uses `wx`, so it never overwrites a file written meanwhile.
- Subagent and `/tan` sessions also name a parent, but their files sit in the parent's artifact folder (`<parent>/<Name>.jsonl`). They inherit nothing.

## Limits

- Running agents load extensions only at start. Restart or reload an OMP agent (`paseo agent reload <id>`) to pick it up.
- A cleared chat keeps an empty file (the plugin writes it), so a copied chat does not take its source's text back.

Disable: remove the two symlinks, then restart OMP agents.
