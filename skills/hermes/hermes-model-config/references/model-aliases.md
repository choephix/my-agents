# Hermes Model Aliases — mechanics & verification

Condensed operational reference for the alias system. Source of truth in code:
`hermes_cli/model_switch.py` (`_load_direct_aliases`, `DirectAlias`,
`_ensure_direct_aliases`, and the alias-resolution path around line 515).

## The two formats

### String form — under `model:`
```yaml
model:
  default: z-ai/glm-5.2
  provider: openrouter
  base_url: https://openrouter.ai/api/v1
  aliases:
    glm: openrouter/z-ai/glm-5.2
```
- This is what `hermes config set model.aliases.glm "openrouter/z-ai/glm-5.2"`
  writes.
- Value is `provider/model` (slash splits provider from model). No slash ⇒
  provider defaults to current `model.provider`.
- **Cannot carry a custom base_url.**

### Dict form — top-level `model_aliases:`
```yaml
model_aliases:
  glm:
    model: z-ai/glm-5.2
    provider: openrouter
    base_url: https://openrouter.ai/api/v1
```
- Full control including `base_url` (required for custom endpoints / routes not
  in the models.dev catalog).
- This is the canonical home for Stefan's aliases.

## Precedence / collision rule

From `_load_direct_aliases()`:
1. Dict-form (`model_aliases:`) entries are loaded first.
2. String-form (`model.aliases:`) entries are loaded second, **but skipped if
   the same lowercased key already exists** in the dict-form set
   (`if key in merged: continue`).

⇒ **Dict-form always wins on a name collision.** A leftover string-form stub
for the same name is inert (cosmetic only).

Keys are normalized with `name.strip().lower()`.

## Reverse lookup

Resolution also matches by full model id, not just alias name:
```python
for alias_name, da in DIRECT_ALIASES.items():
    if da.model.lower() == key:
        return (da.provider, da.model, alias_name)
```
So typing the full id (`z-ai/glm-5.2`) routes through the direct alias too.

## Verification recipe (run this before declaring done)

Confirm an alias resolves to the expected provider/model without launching a
full session:

```bash
cd /home/cx/.hermes/hermes-agent && python3 -c "
from hermes_cli.model_switch import _load_direct_aliases
da = _load_direct_aliases().get('glm')
print('glm ->', da)
assert da and da.model == 'z-ai/glm-5.2' and da.provider == 'openrouter', 'alias did not resolve'
print('OK')
"
```

`_load_direct_aliases()` reads live config each call (no process restart needed),
so this verifies the on-disk config immediately after `hermes config set`.

## Neutralizing a stray string-form stub

`hermes config set` can't delete keys. To make a leftover string-form entry
inert without `hermes config edit`:
```bash
hermes config set model.aliases.glm ""
```
Leaves `glm: ''` under `model.aliases:` — the loader skips empty/non-string
values, and dict-form wins anyway. Full removal requires `hermes config edit`.

## Bulk / structural edits

`hermes config set` only writes scalar leaves. To add a whole alias sub-block in
one shot, or to reorder/restructure, use `hermes config edit` (opens config.yaml
in `$EDITOR`) — but note config.yaml is agent-edit-protected for the agent
itself; `hermes config edit` is the user-facing path. As the agent, emit the
individual `hermes config set model_aliases.<name>.{model,provider,base_url}`
calls instead.
