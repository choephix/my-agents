---
name: generate-with-openrouter
description: "Use only when the user explicitly requests OpenRouter, or explicitly names a bundled OpenRouter model, for image generation or image editing."
---

# OpenRouter image operations

Use the registry-backed runner. Resolve `<skill-dir>` from this file so the skill remains relocatable. `list` and `describe` are the source of truth for available models.

## Environment

- Every call uses `bun --env-file="${OPENROUTER_ENV_FILE:-$HOME/.config/openrouter/env}"`; never print the environment file or resolved keys.
- For `run`, use non-empty `OPENROUTER_IMAGE_KEY`, otherwise the inherited `OPENROUTER_API_KEY`.
- `OPENROUTER_OUTPUT_DIR` is optional and defaults to `~/Generations`.
- `OPENROUTER_JOURNAL_DIR` is optional and defaults to `$OPENROUTER_OUTPUT_DIR/.journal`.

## Commands

```sh
bun --env-file="${OPENROUTER_ENV_FILE:-$HOME/.config/openrouter/env}" <skill-dir>/scripts/openrouter.ts list [--json]
bun --env-file="${OPENROUTER_ENV_FILE:-$HOME/.config/openrouter/env}" <skill-dir>/scripts/openrouter.ts describe <ref> [--live] [--json]
bun --env-file="${OPENROUTER_ENV_FILE:-$HOME/.config/openrouter/env}" <skill-dir>/scripts/openrouter.ts run <ref> --json '<object|@file|@->' [--count N] [--dry-run] [--timeout SECS]
```

## Named model

The model the user named is the only allowed run target. Resolve their name, id, or alias through the registry and run that entry.

If the entry is missing, cannot accept the requested operation or inputs, or the run fails: stop and report. Wait for a new instruction.

Substituting another model to complete the task is a failure — including a different price tier, a text-to-image stand-in for image-to-image, a "close enough" variant, and a retry on a different model.

## Workflow

1. Select the model: a named model ID or alias is the run target (see Named model). When none was named, apply registry preferences, then the best fit. Do not ask the user to choose among equivalent models.
2. Describe the model and consult its required fields, parameters, notes, and live details when needed.
3. Build `{prompt, images?, extras}`; `extras` are any other supported top-level model parameters.
4. Run the model, adding `--count N` when several independent outputs were requested.
5. Parse the single JSON result line. Success requires `success: true` and every returned `localPath` to exist.

## Inputs

- Pass HTTP(S) URLs and data URLs through unchanged.
- Use absolute paths for local files; the runner base64-encodes them automatically.
- Preserve the user's image order.

## Multiple outputs

Use `--count N` for up to 20 independent requests, one request per output. Report failures individually and ask before retrying them.

## Results

- Outputs are local files: OpenRouter responses contain base64 images, not remote output URLs. Reference images by `localPath`.
- Include `durationMs` converted to seconds and `costUsd` when present.
- A failed request is not a result: report its exact error and journal path.

## Scope

This skill does not offer 3D generation, upscaling, or background removal; use the `generate-with-fal` skill for those operations.

## Adding models

For registry entry steps, read `references/how-to-add-new-model.md`.
