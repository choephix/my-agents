---
name: agy-nano-banana
description: Use when the user wants to generate an image with Nano Banana.
disable-model-invocation: true
---

# Nano Banana via Antigravity CLI

`agy` is the Antigravity CLI. It has a built-in `generate_image` tool
authenticated by the Google account OAuth in `~/.gemini/` — quota comes from
the plan tier. Never set a `GEMINI_API_KEY`/`NANOBANANA_*` variable; the
subscription is the whole point.

## Command

    agy -p "<prompt>" --dangerously-skip-permissions

- `-p` is a string flag: the prompt must be its immediate argument.
  Anything else there becomes the prompt.
- The permissions flag is required: headless mode auto-denies otherwise and
  produces nothing. (Narrower alternative: `permissions.allow` rules in
  `~/.gemini/antigravity-cli/settings.json`.)
- The prompt must name an **absolute** output path. Relative paths land in
  `~/.gemini/antigravity-cli/scratch/` regardless of your cwd — and the reply
  will falsely claim "saved to your current directory".
- End with "Save it as <abs path>. Do it, don't explain."
- No flags for model/aspect; steer in prose ("16:9").

Done when `file <abs path>` reports image data.

Follow-ups (variations on the same image) ride the conversation:
`agy -c -p "<change>, save as <abs path>"`.
