# Cursor Opus in Adversarial OMP

Use when Stefan says to use "Cursor's Opus" or otherwise avoid Anthropic quota.

## Discovery

Prefer `omp models` when OMP is available. If you need to inspect cached models, OMP stores provider model metadata in `~/.omp/agent/models.db`, table `model_cache`; provider id `cursor` contains Cursor-backed models.

Useful Cursor Opus ids observed:

- `cursor/claude-4.5-opus-high`
- `cursor/claude-4.6-opus-high`
- `cursor/claude-opus-4-8-xhigh`

Pick an explicit `cursor/...` id rather than fuzzy `opus`, because fuzzy names may resolve to Anthropic or another provider depending on config.

## Launch pattern

```bash
omp --mode json --auto-approve --model gpt "<prompt>"
omp --mode json --auto-approve --model cursor/claude-opus-4-8-xhigh "<same prompt>"
```

For review-only / no-edit tasks, consider `--no-tools` if the prompt already contains the relevant diff and context. This reduces side-effect risk, but only use it when the agents do not need to inspect the repository.

## Pitfalls

- Do not equate "Opus" with the Anthropic provider when Stefan specifically says Cursor Opus.
- Do not persist a claim that a local OMP wrapper is broken just because the shell setup is temporarily missing a runtime; prefer a one-off invocation/fix and continue.
