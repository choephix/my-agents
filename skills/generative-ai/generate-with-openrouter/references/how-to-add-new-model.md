# Add an OpenRouter image model

Adding a model means adding one entry to `assets/models.yaml`.

## Steps

1. Fetch `https://openrouter.ai/api/v1/models`, find the canonical model ID, and confirm `architecture.output_modalities` contains `image`. Exclude `openrouter/auto` routers.
2. Add the entry in this shape, preserving the existing preferences text:

```yaml
version: 1
updated: "2026-09-01"
preferences: |
  Add your preferences here.
models:
  - id: google/gemini-3.1-flash-image
    name: "Nano Banana 2 (Gemini 3.1 Flash Image)"
    aliases: ["nano banana 2", "nb2"]
    capabilities: [text-to-image, image-editing]   # image-editing iff input_modalities includes image
    description: One sentence.
    notes: "Approx $/image derived from image_output token pricing; quirks; content-policy behavior if known."
    input:
      required: [prompt]
      params:
        prompt: "string — what to generate or how to edit the supplied images"
        images: "array of URLs or local paths — reference/edit inputs (optional)"
        # plus any model-specific extras worth knowing, as freeform one-line strings
```

Use globally unique normalized aliases. Include `image-editing` only when `architecture.input_modalities` contains `image`.

3. Verify without making a paid request:

```sh
bun --env-file="${OPENROUTER_ENV_FILE:-$HOME/.config/openrouter/env}" <skill-dir>/scripts/openrouter.ts describe <id>
bun --env-file="${OPENROUTER_ENV_FILE:-$HOME/.config/openrouter/env}" <skill-dir>/scripts/openrouter.ts describe <id> --live
bun --env-file="${OPENROUTER_ENV_FILE:-$HOME/.config/openrouter/env}" <skill-dir>/scripts/openrouter.ts run <id> --json '{"prompt":"A red circle"}' --dry-run
```

Confirm `describe` reflects the registry, `--live` still reports image output modality, and the dry run resolves the model and preserves the intended request body.
