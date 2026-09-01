# Session ID Capture for Adversarial OMP

Problem: `omp --model <alias> "<prompt>"` must later be resumed by exact session id/path. Guessing newest JSONL is race-prone, especially when launching `gpt` and `opus` close together.

Preferred order:

1. Capture session id/path from OMP stdout if printed.
2. Use machine-readable OMP session metadata if available.
3. Deterministic fallback: plant a unique token.

Fallback recipe:

- Create `run_id`, e.g. `adversarial-omp-YYYYMMDD-HHMMSS-<short-random>`.
- Create side IDs: `<run_id>-gpt`, `<run_id>-opus`.
- Include side ID in each initial prompt metadata block.
- After launch, scan OMP JSONL headers and messages, selecting the file with:
  - first-line `session.cwd` equal to intended cwd;
  - exact `side_id` in user message content;
  - model line compatible with expected side if available.
- Parse first-line `session.id`.
- Store `side`, `model_alias`, `session_id`, `jsonl_path`, `cwd`.

Bad fallback: `latest file for cwd`. Use only for diagnostics, never as the normal resume handle.
