---
name: generate-with-fal
description: "Use only when the user explicitly requests fal or fal.ai, or explicitly names a bundled Fal model, for image generation, image editing, background removal, upscaling, or 3D generation."
---

# Fal media operations

Use the registry-backed runner. Resolve `<skill-dir>` from this file so the skill remains relocatable.

## Environment

- Every call loads configuration with `bun --env-file="${FAL_ENV_FILE:-$HOME/.config/fal/env}"`; never print the environment file.
- `FAL_KEY` is required for `run` and `upload`.
- `FAL_OUTPUT_DIR` is optional and defaults to `~/Generations`.
- `FAL_JOURNAL_DIR` is optional and defaults to `$FAL_OUTPUT_DIR/.journal`.

## Commands

```sh
bun --env-file="${FAL_ENV_FILE:-$HOME/.config/fal/env}" <skill-dir>/scripts/fal.ts list [category] [--json]
bun --env-file="${FAL_ENV_FILE:-$HOME/.config/fal/env}" <skill-dir>/scripts/fal.ts describe <ref> [--schema] [--json]
bun --env-file="${FAL_ENV_FILE:-$HOME/.config/fal/env}" <skill-dir>/scripts/fal.ts run <ref> --json '<object|@file|@->' [--count N] [--dry-run] [--timeout SECS] [--poll SECS]
```

## Named model

The model the user named is the only allowed run target. Resolve their name, id, or alias through the registry and run that entry.

If the entry is missing, cannot accept the requested operation or inputs, or the run fails: stop and report. Wait for a new instruction.

Substituting another model to complete the task is a failure — including a different price tier, a text-to-image stand-in for image-to-image, a "close enough" variant, and a retry on a different endpoint.

## Workflow

1. Route the request:
   - Named model, endpoint ID, or alias → that entry only (see Named model).
   - No model named: background removal, a transparent background, or a subject cutout selects `fal-ai/birefnet/v2`; upscaling selects `fal-ai/seedvr/upscale/image`; otherwise apply registry preferences, then the best-fitting description. Do not ask the user to choose among equivalent models.
2. Describe the selected endpoint and consult its required fields, parameters, notes, and schema when needed.
3. Build the input JSON with RAW fal API field names.
4. Run the endpoint, using `--count N` when several outputs were requested.
5. Parse the single JSON result line. Success requires `success: true` and every returned `localPath` to exist.

## Inputs

- Pass HTTP(S) URLs and data URLs through unchanged.
- Use absolute paths for local files; the runner substitutes them automatically.
- Preserve user order in multi-image fields.

## Multiple outputs

Use `--count N` for up to 20 independent requests. Endpoint batch fields are pinned to `1` and any other value is rejected. Report each failure individually and ask before retrying it.

## Results

- Images: embed the returned fal `url` in Markdown and include its absolute `localPath`.
- Non-image outputs: provide remote links and absolute local paths.
- Include `durationMs` converted to seconds and the seed when present.
- A failed request is not a result: report its exact error and journal path.

## Adding endpoints

For registry entry steps, read `references/how-to-add-new-endpoint.md`.
