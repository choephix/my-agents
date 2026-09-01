---
name: hermes-model-config
description: "Use when Stefan asks to add, rename, remove, or verify a Hermes model alias, change the main/auxiliary model, or set up a model route/provider. Covers the two alias config formats, the agent-edit-protection on config.yaml, and the no-unset CLI limitation."
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [hermes, model, aliases, configuration, providers]
    related_skills: [hermes-agent, messaging-gateway-operations]
---

# Hermes Model & Alias Configuration

Operational companion to the bundled `hermes-agent` skill for the specific class
of *configuring models and model aliases* on Stefan's setup. The bundled skill
is the broad reference and points to the docs as source of truth; this skill
captures the operational mechanics, gotchas, and verification recipes that the
bundled skill does not spell out and that bit a real session.

## When to use

- Stefan says "add an alias for <model>", "rename/remove this alias", "make X a
  shortcut for Y".
- Stefan wants to change the main model or an auxiliary slot, switch providers,
  or set up a new model route.
- You need to verify an alias resolves to the right provider/model.

## Core facts (read first)

### 1. `~/.hermes/config.yaml` is agent-edit-protected

`patch` and `write_file` against `~/.hermes/config.yaml` are **refused** with:
> "Refusing to write to Hermes config file ... Agent cannot modify
> security-sensitive configuration. Edit ~/.hermes/config.yaml directly or use
> 'hermes config' instead."

**Always drive config changes through the CLI:**
```bash
hermes config set <dotted.key> <value>
hermes config edit          # opens in $EDITOR (manual full-form edits)
hermes config               # show current config
```

### 2. Model aliases have TWO config formats — and a precedence rule

There are two valid ways to define an alias; both are read by
`hermes_cli/model_switch.py::_load_direct_aliases()`:

- **String form** (quick, what `hermes config set` writes for `model.aliases.<name>`):
  ```yaml
  model:
    aliases:
      glm: openrouter/z-ai/glm-5.2
  ```
  Cannot carry a custom `base_url`. Provider is parsed from the `provider/` prefix;
  if no slash, the current `model.provider` is used.

- **Dict form** (full, lives in top-level `model_aliases:` block):
  ```yaml
  model_aliases:
    glm:
      model: z-ai/glm-5.2
      provider: openrouter
      base_url: https://openrouter.ai/api/v1
  ```
  Can pin an exact `base_url` (needed for custom endpoints / non-catalog routes).

**Precedence:** when the same alias name exists in **both** blocks, the
dict-form (`model_aliases:`) entry wins; the string-form entry is skipped. So
the dict-form block is the canonical home for aliases.

### 3. There is NO `hermes config unset`

Subcommands are only: `show, edit, set, path, env-path, check, migrate`. To
remove a value you previously `set`:
- set it to an empty string: `hermes config set model.aliases.glm ""` (leaves a
  `glm: ''` stub — harmless, the loader skips empty string-form entries), or
- `hermes config edit` and delete the lines manually (only way to fully remove).

### 4. Changes take effect on a new session

Model/alias config is read at session start. After editing:
- CLI: relaunch or `/reset`
- Gateway: `/restart`
- Mid-session switch: `/model <alias>` (applies immediately to current chat;
  `--global` persists as default).

## Procedure: add an alias

1. Prefer the **dict form** so the alias can carry a `base_url` and lives in the
   canonical block alongside existing aliases. The existing `model_aliases:`
   block already holds Stefan's routes (codex/gpt/gpt55/kimi/kimi-code/opus/...).
   ```bash
   hermes config set model_aliases.<name>.model "<model-id>"
   hermes config set model_aliases.<name>.provider "<provider>"
   hermes config set model_aliases.<name>.base_url "<base_url-or-empty>"
   ```
2. If a leftover string-form `model.aliases.<name>` stub was created along the
   way, neutralize it: `hermes config set model.aliases.<name> ""`. (The
   dict-form entry takes precedence anyway, so this is cosmetic.)
3. **Verify the alias resolves** before declaring done (see verification recipe
   in `references/model-aliases.md`).
4. Tell Stefan it applies on next session / `/reset` / `/restart`.

## Procedure: remove an alias

1. `hermes config edit` → delete the `<name>:` sub-block under `model_aliases:`.
   (No CLI unset; setting to `""` only works for scalar leaves, not a whole
   sub-block.)
2. Also clear any `model.aliases.<name>` stub if present.
3. Verify it no longer resolves.

## Pitfalls

- **Don't `patch` config.yaml.** It's agent-edit-protected. Use `hermes config set`.
  This is the #1 detour — go straight to the CLI.
- **Don't define the same alias name in both blocks and expect the string form
  to matter.** Dict-form silently wins. If an alias isn't behaving, check both
  `model.aliases:` (under `model:`) and the top-level `model_aliases:` block.
- **`hermes config set` only writes scalars.** To set nested dict entries you
  set each leaf (`model_aliases.glm.model`, `.provider`, `.base_url`) — you
  cannot emit the whole dict block in one `set` call. For bulk/structural edits
  use `hermes config edit`.
- **Aliases are lowercased and stripped** on lookup (`key.strip().lower()`).
  Don't rely on case to distinguish two aliases.
- **Reverse lookup exists:** typing the full model id (e.g. `z-ai/glm-5.2`) also
  resolves through direct aliases, not just the short name.

## Stefan's current alias conventions

Stefan keeps a `model_aliases:` block with short names mapping to his preferred
routes (see USER PROFILE for the route preferences). When he says "add an alias
for this model", mirror the existing entries' style. Common ones: `codex`,
`gpt`, `gpt55`, `kimi`, `kimi-code`, `opus`, `claude-opus`, `glm`.

## References

- `references/model-aliases.md` — full two-format mechanics, the loader code
  reference, and a copy-paste verification recipe for alias resolution.
