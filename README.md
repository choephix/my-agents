# .agents

My agentic stuff.

## OMP extensions

- [Turn a session into readable prose](.omp/extensions/prose). [Ported to plain Pi](pi/extensions/prose) too.
- [Keep one message verbatim and summarize everything before it](.omp/extensions/pivot)
- [Add prompt to context without starting a turn](.omp/extensions/stage-note)
- [Schedule a prompt](.omp/extensions/delay-message), kept out of context until it fires
- [Hide magic words from the model](.omp/extensions/strip-keywords), in case you want to trigger your own custom tooling
- [Warn, stop subagents, or pause when a provider quota runs low](.omp/extensions/usage-guard)
- [Keep a running ledger of a long planning conversation](.omp/extensions/scribe), written by a cheap side model
- [`@imports` and `` !`shell` `` expansion in SKILL.md](.omp/extensions/skill-directives)

## Old sessions

- [Search every OMP session](scripts/@omp-find), reasoning and tool traffic included
- [Recap every session in a folder and pick up from there](tools/omp-session-recap)
- [Cheap observer agents that journal a live session](tools/shadow-agent)
- [Reopen past sessions in Paseo](paseo-plugins/noice-past-sessions), including ones you started in a terminal
- [Every link, image and file a chat mentioned](paseo-plugins/noice-links-list)

## OMP inside Paseo

- [Make `/tan`, `/btw` and `/omfg` work in Paseo](.omp/extensions/headless-builtins), [and show them as compact rows instead of chat bubbles](paseo-plugins/noice-omp-slash-aliases)
- [Go back to any earlier message and branch from there](paseo-plugins/noice-omp-tree)
- [Spin off a side agent with `/side`](paseo-plugins/noice-side-agent), with or without the parent's memory
- [Your `.agents/commands/*.md` prompts one click away](paseo-plugins/noice-commands-list)
- [Let the agent mark itself as waiting on you](.omp/extensions/await-decision)
- [Put idle OMP chats to sleep to free memory](paseo-plugins/noice-omp-sleeping-tabs), on [my Paseo fork](tools/paseo-fork)

## Paseo UI

- [Dots on workspace rows for tabs that need you](paseo-plugins/noice-tab-dots)
- [Pick the working indicator](paseo-plugins/noice-chat-turn-status)
- [One-word tab titles](paseo-plugins/noice-titles)
- [Your own provider icons](paseo-plugins/noice-provider-icons)
- [Sidebar filters by project group](paseo-plugins/noice-filter-presets)
- [Tidier sent messages](paseo-plugins/noice-chat-message-polish)
- [Quieter diff colouring](paseo-plugins/noice-chat-diff)
- [More app themes](paseo-plugins/popular-themes), and [T3 Chat's](paseo-plugins/t3-chat-theme)
- [Hide the composer controls you never use](paseo-plugins/noice-composer-declutter)
- [A clickable copy of Paseo for mocking plugins before building them](paseo-mock-base)

## Several models on one problem

- [Fan a question to GPT, Claude and Gemini](skills/hermes/council)
- [Adversarial sessions on the same task](skills/hermes/adversarial-omp), for answers you need to trust
- [Blind multi-model PR review](skills/unorganised/panel-review)
- [Two independent PR reviewers and a synthesis](skills/hermes/pr-review-two-omp)

## Herdr

- [Fork the focused OMP session into a pane](.herdr/plugins/omp-fork-pane)
- [PR number → worktree workspace](.herdr/plugins/pr-worktree)
- [Name tabs from their conversation](.herdr/plugins/tab-namer)
- [Break a pane out into a tab and back](.herdr/plugins/pane-breakout)
- [Run a setup script in every new worktree](.herdr/plugins/worktree-setup)
- [Restart settled OMP agents in their panes](scripts/restart-omp-sessions)

## Skills

- [Rehearse an implementation without running anything](skills/dev/dry-dev)
- [Merge main without losing what either side meant](skills/dev/merge-main)
- [Write a PR description from the reviewer's seat](skills/dev/pr-description)
- [Write for agents](skills/misc/writing-for-agents), read before writing a skill
- [Write like Paul Graham](skills/misc/pith)
- [Write Simplified Technical English](skills/unorganised/ste100)
- [Generate images](skills/generative-ai) through fal or OpenRouter
- [Get spoilers a word at a time](skills/fun/spoiler-surfer), because I love testing my wild theories against what's coming but don't want the full answer dumped on me

## Tampermonkey

[Install links](tampermonkey/README.md)

- [Discord thread → markdown](tampermonkey/discord-thread-markdown.user.js)
- [Tweet and its replies → one PNG](tampermonkey/x-tweet-shot.user.js)
- [Gmail search attachments → files](tampermonkey/gmail-attachment-harvester.user.js)

## Local configuration

Machine-specific paths and origins belong outside this public checkout:

- `~/.config/my-agents/local.md`: the webshare and collection-app origins, notes
  roots, and project labels used by the corresponding skills.
- `~/.config/my-agents/bookmarks.json`: optional bookmark routing, for example
  `{"defaultRoot":"/home/user/notes/wiki","projects":{"acme":"/home/user/workspace/acme-notes/wiki"}}`.
  Project keys match whole directory segments or their hyphen-prefixed families
  (`acme`, `acme-app`, `acme-worktrees`). A project route takes precedence over
  `AGENTS_WIKI_DIR`; otherwise the environment overrides `defaultRoot`. With no
  configuration the root is `~/.local/share/my-agents/wiki`.
- `~/.config/my-agents/paths.sh`: optional shell configuration for
  `record-accomplishment/record.sh`; set `AGENTS_WIKI_DIR` to select its notes
  root. Its unconfigured default is also `~/.local/share/my-agents/wiki`.
- `~/.config/my-agents/paseo.json`: `{"sourceCheckout":"/home/user/forkspace/paseo-wt/fork"}`
  selects the source used by the mock icon and token generators.
  `PASEO_SOURCE_CHECKOUT` overrides it; a command-line source path overrides both.
- `~/.config/paseo-fork/config.sh`: optional shell settings shared by
  `paseo-fork`, `paseo-fork-sync` and `fork-typecheck-server`. Set
  `PASEO_FORK_BRANCH` and `PASEO_FORK_LABEL` for the branch and version/tag
  namespace (both default to `fork`). Paths can be set with `PASEO_FORK_REPO`,
  `PASEO_FORK_SYNC_HOME`, `PASEO_FORK_STATE`, `PASEO_FORK_BACKUP_DIR`,
  `PASEO_FORK_TEST_ROOT`, `PASEO_FORK_NOTES` and `PASEO_FORK_RUNBOOK`;
  `npm_config_cache` controls the npm cache. State defaults to `~/.local/state/`
  and npm cache to `~/.cache/paseo-fork/npm`. Notes and runbook are unset by
  default. These are trusted shell files, not files to copy from strangers.
