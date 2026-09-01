---
name: generate-with-fal
description: Generate images, 3D models, audio, etc using fal.ai or register new endpoints for future generations.
compatibility: Created for Zo Computer
metadata:
  author: cx.zo.computer
  category: Media Generation
  created: 2026-03-05
  display-name: Fal Generate
  emoji: 🎨
allowed-tools: Bash Read create_or_rewrite_file edit_file
---
# generate-with-fal

Generate outputs using fal.ai models — images, 3D models, audio, and more.

## Quick Start

```
"Generate an image of a sunset using flux klein"
"Make 5 variations of a cyberpunk city with flux-2 klein"
"Create a 3D model of a chair using [model name]"
```

## How It Works

1. **Check the index**: Read `assets/endpoints-index.yaml` to find the requested model
2. **Read the tool docs**: Open the corresponding `.md` file in `scripts/<category>/` for usage details
3. **Handle input files**: If the endpoint requires files (e.g., image-to-image), upload first
4. **Execute with args**: Run the `.ts` script with proper arguments
5. **Track failures**: If any generations fail, ask user whether to retry

## Input Files (Image-to-Image, etc.)

When an endpoint requires input files (e.g., `image_url` for image-to-image):

1. **If user provides a URL**: Use directly in the API call
2. **If user provides a local file**: Upload to fal.ai first using `uploadFile()` from `scripts/common/lib.ts`

```typescript
import { uploadFile } from "../common/lib.ts";

// Upload local file
const falUrl = await uploadFile("/path/to/local/image.png");

// Use in API call
const input = {
  image_url: falUrl,
  prompt: "...",
};
```

The upload endpoint: `POST https://api.fal.ai/v1/serverless/files/file/local/{target_path}`
- Field name: `file_upload`
- Returns URL like `https://fal.media/files/uploads/abc123-image.png`

## Parallel Generation

When asked for multiple outputs (e.g., "make 10 images"):
- Run up to **20 requests in parallel**
- Track failed generations
- Ask user if they want to retry only the failures

**Never use `num_images` or similar batch fields** — always set to 1 and run multiple requests instead.

## Output Locations

- **Files**: "/home/workspace/Generations/<YYMMDD>/<uid>-<endpoint-slug>-<prompt-words>.<ext>"
  - `YYMMDD` = date folder (e.g., `260305`)
  - `uid` = base26 timestamp offset from 2025-01-01 (short unique ID like `epvpvhpi`)
  - `endpoint-slug` = last 3 parts of endpoint ID (e.g., `flux-2-klein-9b`)
  - `prompt-words` = first 5 words from prompt (optional, slugified)
- **Journal**: "/home/workspace/Generations/_journal/<YYMMDD>/<same-filename>.md"
  - Contains: endpoint, inputs, full result JSON, tool used, duration, errors, notes

In chat, display the direct fal.ai URLs rather than local file paths.

## Response Format

When using this skill and returning results to the user:

1. **Always embed images** using markdown with a relative path:
   ```markdown
   ![Alt text](./Generations/260305/filename.png)
   ```

2. **Include the file link alongside** (not instead of) the embedded image:
   ```markdown
   ![Description](./Generations/260305/file.png)
   
   `file 'Generations/260305/file.png'`
   ```

3. **Always include duration** info (from the `durationMs` field):
   ```markdown
   - **Time:** 2.1s
   ```

4. **For non-image outputs** (audio, 3D models), just use the file link:
   ```markdown
   `file 'Generations/260305/audio.mp3'`
   
   - **Time:** 5.2s
   ```

Example final response:
```markdown
Done:

![Cyberpunk Pegasus](./Generations/260305/epwlaiql-klein-9b-edit-cyberpunk.png)

`file 'Generations/260305/epwlaiql-klein-9b-edit-cyberpunk.png'`

- **Time:** 3.1s
- **Seed:** 654410538
```

## Adding New Endpoints

See `references/how-to-add-new-endpoint.md` for detailed instructions.

Quick version:
1. Fetch schema: `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={id}`
2. Fetch docs: `https://fal.ai/models/{id}/llms.txt`
3. Create `scripts/<category>/<endpoint-slug>.ts` and `<endpoint-slug>.md`
4. Update `assets/endpoints-index.yaml`

## Files

```
Skills/generate-with-fal/
├── SKILL.md                    # This file
├── scripts/
│   ├── common/
│   │   └── lib.ts                  # Shared utilities (API calls, file saving, etc.)
│   ├── text-to-image/
│   │   ├── flux-2-klein-9b.ts  # Tool implementation
│   │   └── flux-2-klein-9b.md  # Tool documentation
├── references/
│   └── how-to-add-new-endpoint.md
└── assets/
    └── endpoints-index.yaml    # Model registry
```

## API Key

Stored as `FAL_KEY` in Zo secrets (Settings > Advanced).
