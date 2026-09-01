---
name: council
description: Use when Stefan invokes /council to fan one query out to GPT, Claude, and Gemini Pro via OMP and relay each completed answer separately.
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [council, omp, multi-agent, model-comparison]
    related_skills: [omp-oh-my-pi-sessions]
---

# Council

## Overview

Run the same user query through three independent Oh My Pi sessions and stream the completed model answers back as separate conversation messages. Prefer speed of first useful result over waiting for consensus.

The intended user-visible shape is exactly four assistant messages after the request:

1. GPT's full answer.
2. Claude's full answer.
3. Gemini Pro's full answer.
4. A very short read on the results.

Do not add a separate "launched" acknowledgement unless launching fails before any agent can run.

## Model roster

Default roster:

| Label | OMP model | Extra flag |
|---|---|---|
| GPT | `openai-codex/gpt-5.5` | `--thinking xhigh` |
| Claude | `anthropic/claude-opus-4-8` | `--thinking xhigh` |
| Gemini Pro | `google/gemini-3-pro-preview` first; if unavailable, fuzzy `gemini pro` | none unless the user asked otherwise |

If a model name fails, make one reasonable fallback attempt with the fuzzy label (`gpt`, `opus`, or `gemini pro`). If Gemini Pro is unavailable or auth-blocked, report that as the Gemini result rather than silently replacing it with Flash.

## Launch pattern

Use OMP print mode so every run terminates with a text answer:

```bash
PATH=/home/cx/.local/share/mise/shims:/home/cx/.local/share/mise/installs/bun/1.3.14/bin:/home/cx/.bun/bin:$PATH \
omp -p --hide-thinking --model <model> [--thinking <level>] -- "<query>"
```

Run the three commands concurrently with `terminal(background=true, notify_on_complete=true)`, usually from the current working directory unless the user names a project/repo. Do not use `--mode json` for the user-facing answer path; print mode gives the clean answer directly.

For prompts that may modify files or run tools, include an explicit non-mutating instruction unless Stefan asked for implementation:

```text
Answer the following query. Do not modify files or perform external side effects unless the query explicitly asks for them.

<query>
```

## Relay discipline

When a background OMP run completes:

1. Send that model's full stdout as its own assistant response, headed only by the model label, e.g. `## GPT`.
2. Do not summarize, merge, or wait for the other models.
3. If the run exits non-zero, send the error/output as that model's result with a short failure note.
4. Track completed labels in the session todo list or a tiny scratch note if needed.
5. After the third model has either answered or failed, send one final message titled `## My read` with no more than 3 bullets.

The final opinion should be extremely brief: who was most useful, any clear disagreement, and the practical next step. Avoid a long meta-review unless Stefan asks.

## Practical notes

- If two results finish in the same tool notification, still emit separate assistant messages if the platform/session mechanics allow it; otherwise use clearly separated `## <Model>` sections and follow with `## My read` when all are done.
- Preserve each model's full visible answer. Strip only ANSI control codes, progress spinners, and empty boilerplate.
- Do not include hidden/thinking content; keep `--hide-thinking` on.
- If the query is repo-specific, launch all three from the same resolved worktree and mention the cwd in failure output only if relevant.

## Common pitfalls

1. Waiting for all three before replying. The point is first-finished-first-delivered.
2. Sending an extra launch acknowledgement, creating five messages instead of four.
3. Replacing Gemini Pro with Gemini Flash without saying so. Pro unavailable is a valid result.
4. Summarizing instead of relaying the full OMP answer.
5. Running in the wrong directory for project-sensitive questions.

## Verification checklist

- [ ] Three OMP print-mode jobs launched concurrently.
- [ ] Each result delivered with its model label as soon as available.
- [ ] No separate launch acknowledgement sent unless launch failed.
- [ ] Final `My read` sent only after all three labels completed or failed.
