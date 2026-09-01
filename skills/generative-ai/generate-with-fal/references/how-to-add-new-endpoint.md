# Add a Fal endpoint

Adding an endpoint means adding one entry to `assets/endpoints.yaml`.

## Steps

1. Get the canonical endpoint ID from fal.ai.
2. Fetch these public references, replacing `<id>` with that endpoint ID:

```text
https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>
https://fal.ai/models/<id>/llms.txt
```

Use OpenAPI for exact API field names, types, defaults, and required fields; use `llms.txt` for descriptions, examples, and caveats.

3. Add the entry in this v2 shape, preserving the existing preferences text:

```yaml
version: 2
updated: "2026-09-01"
preferences: |
  <carry over the existing preferences text verbatim>
endpoints:
  - id: fal-ai/birefnet/v2
    aliases: ["birefnet", "birefnet v2", "background removal", "remove background"]
    category: image-to-image
    description: One-sentence description.
    notes: "Pricing + quirks worth knowing before spending money."
    input:
      required: [image_url]
      batch: null            # or the API field name that batches, e.g. num_images
      params:
        image_url: "string — source image (URL or local path)"
        model: "enum: General Use (Light) | General Use (Heavy) | Portrait | ... (default: General Use (Light))"
```

Use RAW fal API field names for `params`. Set `batch` to the API field controlling output count, or `null` when absent.

4. Verify the entry without making a paid request:

```sh
bun --env-file="${FAL_ENV_FILE:-$HOME/.config/fal/env}" <skill-dir>/scripts/fal.ts describe <id>
bun --env-file="${FAL_ENV_FILE:-$HOME/.config/fal/env}" <skill-dir>/scripts/fal.ts describe <id> --schema
bun --env-file="${FAL_ENV_FILE:-$HOME/.config/fal/env}" <skill-dir>/scripts/fal.ts run <id> --json '<valid-input-object>' --dry-run
```

Confirm both descriptions reflect the source references and the dry run resolves the endpoint, validates required fields, and preserves the intended input.
