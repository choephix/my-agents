---
name: omp-transcript
description: "OMP catch-up: use when reading or consolidating OMP session history without loading tool-result bloat."
---

# OMP Transcript

1. Render the session’s active branch instead of reading its JSONL directly:
   ```bash
   omp-transcript '<session.jsonl>' > /tmp/omp-transcript.md
   ```
2. Read the rendered transcript.
3. If an omitted result matters, run its embedded `omp-transcript result ...` command. Hydrate only results needed to understand the work.

The CLI is read-only. Completion means the catch-up is grounded in the conversation, reasoning, and only the necessary hydrated results.
