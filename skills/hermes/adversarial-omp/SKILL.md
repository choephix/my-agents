---
name: adversarial-omp
description: Use when asked for high-confidence reasoning by running adversarial ai sessions against the same task
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [omp, cross-model, review, planning, debugging, orchestration]
    related_skills: [omp-oh-my-pi-sessions]
---

# Adversarial Oh-My-Pi Session

## Overview

Use `omp` to run two strong agents in parallel. Make them answer independently, inspect each other's meaningful claims, defend or concede, then converge.

Analysis, review, plan, mock diffs.

Final deliverable: the agents' aligned result, or their bounded disagreement.

## Critical Constraint: Moderator, Not Participant

You orchestrate. You do not opine on substance.

Do not judge who is correct. Do not add your own plan. Do not inject hints, rankings, tie-breaks, or selective emphasis. The value comes from each model's distinct reasoning; your reasoning contaminates the result.

You only track convergence: whether material objections remain, whether positions moved, and whether both agents understand the same decision/problem.

## Models

Default pair:

- GPT route: `gpt`
- Claude route: `claude`

If Stefan asks for **Cursor Opus** (often to avoid Anthropic quota), do not use the Anthropic `claude` route. Use a Cursor-qualified model, e.g. `cursor/claude-opus-4-8-xhigh`, and verify the exact available id with `omp models` or the OMP model cache before launch. See `references/cursor-opus.md` for the discovery pattern and example command.

If either side errors, stop, investigate, inform Stefan. If a foreground `omp --resume` times out, do not assume the agent produced nothing: OMP often appends a usable assistant response to the JSONL before the wrapper times out. Before rerunning or reporting failure, stream-extract the latest assistant message from the exact session log and continue from that state.

## OMP Mechanics

Run from the intended project/worktree. Verify `pwd` and branch first.

When Stefan explicitly asks for adversarial analysis without investigation, keep the prompt bounded to his provided explanation. You may lightly improve wording/articulation, but do not add repo facts, assumptions, file names, or implementation guesses. Tell agents not to inspect the repository and not to invent project-specific APIs.

For text-only or legal-document PR reviews, see `references/text-only-pr-review.md`. Keep agents away from code/legal substance: provide only the relevant document text or document-only diff, use `--no-tools --no-skills` when possible, and verify claimed typos/anchors/headings against the worktree before finalizing.

For branch/PR reviews, resolve the actual review diff before launching agents. If the requested branch is already merged into the chosen base, `origin/main...HEAD` may be empty; review the branch commit range instead (commonly `HEAD^..HEAD` for a single-commit branch) and state that scope in the prompt. If Stefan says "no edits, pr review only," include that constraint explicitly and prefer the safest review shape: generate a complete diff/context prompt and launch agents with `--no-tools` unless they truly need live repository inspection. This prevents accidental edits and keeps the scope auditable.

Initial launch pattern, from the review worktree:

```bash
omp --mode json --auto-approve --model openai-codex/gpt-5.5:xhigh "<shared-review-prompt>" > /tmp/pr-review-gpt.jsonl 2>&1
omp --mode json --auto-approve --model anthropic/claude-opus-4-8:xhigh "<shared-review-prompt>" > /tmp/pr-review-opus.jsonl 2>&1
```

Prefer redirection to files over `tee` when using Hermes terminal tools: OMP JSON mode can emit huge thinking/tool payloads, and streaming that raw JSON into the parent context is noisy and expensive. After each run, extract the final assistant review and session ID with the JSON parser pattern from `adversarial-omp/references/omp-json-output-extraction.md` (or an equivalent small script) instead of reading the whole JSONL.

Prefer `--no-tools` if this is a no-edit review and the prompt includes enough context. If tool access is needed, still instruct no modifications and verify afterward.

Keep both session ids/paths for the whole deliberation.

Prefer a tiny stdout filter that prints:

```text
<session id>

---

<assistant text>
```

For `--mode json`, extract assistant answers from `assistantMessageEvent.type == "text_end"` (or final assistant message text parts). Do **not** scrape the largest/last arbitrary string from `agent_end.messages`: that often includes the original user prompt and can be mistaken for the agent answer. See `references/omp-json-output-extraction.md` for a compact parser pattern.

Continue exact sessions only:

```bash
omp --auto-approve --resume <session-jsonl-or-id> "<message>"
```

Do not use `--continue`. Do not edit logs. JSONL is fallback/debug/audit only: use it if stdout was lost, parser broke, or an old session must be recovered. Do not load full logs.

## Loop

1. Send Stefan's question to both agents with the same context.
   - For code plans/fixes/reviews, ask for detailed reasoning and mock diffs/pseudo-diffs so the other agent can inspect the implementation shape, not just conclusions.
2. Extract the meaningful portion of each response.
   - Keep the final report as-is!
   - Only drop status chatter, tool noise, preamble/postamble, raw thinking blocks.
3. Forward A's response to B and B's response to A using the forwarding register below.
4. Keep a short position ledger: per material point, note each agent's current stance and whether it was held, conceded, updated, or newly raised.
5. Repeat while useful.

A turn = one full A↔B round-trip. Usually 3-5 turns max. If more than 5 turns are needed, stop and alert Stefan with current positions and blocker.

## Forwarding Register

Goal: let agents update when genuinely persuaded, but not flip from politeness or pressure.

Example:

```text
I asked another capable agent the same thing. Here is the substance of their response.

Where do you align? Where do you diverge?
Ignore semantic or trivial differences. Focus on what matters.

If you still hold your position, defend it. If they made a good point, concede or update precisely. Do not flip for politeness or consensus.

For code tasks, comment on the reasoning and mock diff / implementation shape.

Other agent's answer:
<answer>
```

When a specific point is challenged:

```text
The other agent pushed back on <point> because <reason>.

If you still hold your position, defend it. If their reasoning is better, concede or update precisely.
```

Never frame the other agent as automatically right.

## Watch For

- accidental position swaps;
- shallow agreement;
- concession without engaging the point;
- agents talking past each other;
- stale assumptions;
- one agent misrepresenting the other;
- loop repeating without new information.

If needed, ask a neutral clarification:

```text
Potential mismatch: earlier you argued <X>, now you seem to accept <Y>. Is that an intentional update, scoped exception, or misunderstanding? State your final position and why.
```

You may provide new factual context only if tool-grounded and shared equally with both agents. Do not add interpretation. In PR reviews, actively verify plausible high-severity findings that depend on surrounding repository mechanics (for example secret binding, wrapper functions, generated deploy lists, token refresh, idempotency helpers, generated deploy lists, generated/runtime config, or shared config) before convergence, then share only the verified fact equally. This turns likely false positives into explicit retractions instead of letting them survive into the final review.

When the user narrows the review scope (for example “ignore legal prose, read only code”), keep the review comments scoped, but still use excluded files as **fixtures** if the code behavior depends on their structure. Example: ignore legal wording, but inspect headings in changed legal docs to verify a slug/anchor transform. Report only the code behavior, not prose quality.

### Verification-and-Retraction Round for PR Reviews

For adversarial PR reviews, add a final verification pass before writing the artifact/report:

1. Extract the agents' converged high/medium findings.
2. Independently check the concrete repository facts behind each finding using the local worktree (read touched files, search callsites, inspect base-vs-head where relevant).
3. Classify agent claims as:
   - **confirmed** — keep as finding;
   - **downgraded / conditional** — keep only as a question or verification item;
   - **retracted** — explicitly drop and mention under retractions if it influenced earlier reasoning.
4. Send a neutral "verified facts" message to both existing OMP sessions, including only observed facts and asking for final carried-forward findings plus retractions.
5. Base the artifact on the post-verification final answers, not the first-round reports.

This is still moderator work: verify facts, do not add your own speculative findings. If verification changes severity (for example a suspected missing token refresh is refuted by code, or an idempotency helper proves a duplicate-work concern false), force that correction through both agents before final delivery.

## User Feedback

Don't leave the user handing during this - inform them after each loop's iteration with a brief summary of what happened.

## Termination

- **Convergence:** no new material objections; positions stable; agents materially align on the plan/diagnosis/review.
- **Stable disagreement:** both understand the disagreement and still defend different positions. Valid result. Do not force consensus.
- **Turn alarm:** more than 5 turns or no progress. Stop and alert Stefan; do not invent a conclusion.

## Final Report

Reflect only what the models produced. Do not adjudicate, rank, or add analysis through selective emphasis.

Include:

- agreed plan/decision/review in detail;
- for code, agreed reasoning and mock diffs/implementation shape;
- surviving disagreements, stated neutrally with both sides' reasoning;
- position swaps or other convergence issues observed;
- source session ids/paths.

Delivery: give Stefan a brief summary, then ask whether to paste the full report inline or write an artifact/file plus short summary. Do not skip this just because the inline summary seems sufficient.

If writing an artifact/file, look for `HOW_TO_WRITE_ARTIFACTS.md` somewhere within the project.
