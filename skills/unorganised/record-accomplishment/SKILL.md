---
name: record-accomplishment
description: Save what got done as dated memory files.
disable-model-invocation: true
---

# Record accomplishment

Write a memory file the user can re-read months from now — zero recollection
of the session — and still find the thing, resume it, or write it up
elsewhere. Done when the entry is written and every linked path exists.

## Scope

One entry per invocation: the session's work is one accomplishment, however
many pieces it took — fold them into the entry. The user's ask narrows it
("just the deploy fix" → that thing alone) or, rarely, splits it ("save these
as three" → three entries).

## Files

- Write the entry as one well-formed markdown document, then pipe it to 
  `~/.agents/skills/record-accomplishment/record.sh`
- The script handles everything else — directory, timestamped filename, slug
  from the title — and prints the final path. Verify it echoed one.
- Append-only: improving something already recorded gets a new entry linking
  back; old entries stay put.

## Style

Dense and plain: fragments over sentences, facts over transitions. Every line
a fact, a decision, or a pointer — anything else, cut. First person, the
user's voice.

## Entry

- **Title** — what got done, plainly.
- One-paragraph summary.
- **Details** — what exists now, how it works. Exact names: files, commands,
  tools, settings. Point at code — paths and URLs — prose describes it;
  entries carry no code blocks.
- **Decisions** — choices made, why, what was rejected.
- **Links** — files (absolute paths), repos/commits, URLs, related entries.
- **Sessions** — current session ID, plus any related session IDs mentioned
  (transcript paths are unnecessary).
- **Why it matters** — grounded only; nothing grounded → omit.
- **Loose ends** — unfinished edges, improvements the user voiced, where to
  pick up.

## Grounded

A memory, not an ad. A benefit comes from three places only: the user said it
helps, the user described the problem it solves, or the user described how
they work. Reading between the lines is fine — a benefit derived from a
complaint is grounded; a conjured use case is not.
