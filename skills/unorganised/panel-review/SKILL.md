---
name: panel-review
description: PR/branch review by a blind multi-model panel — cluster, refute, report.
disable-model-invocation: true
---

Run a **panel review**: N model reviewers working **blind** — independent fresh sessions, never seeing each other's work — whose claims are clustered for corroboration and conflict, then adversarially refuted. Orchestrate in `eval`: `agent()` + `parallel()`, `schema=` on every output you branch on.

## Dials

Defaults below. Plain text in the user's invocation overrides any dial — and may restructure the run itself (drop a phase, add a round). Restate the resolved dials in one line, then run; no confirmation round-trip.

- **panel**: fable, opus, grok, sol — invoking this skill authorizes these named model agents; gemini, kimi, glm join on request
- **cross-review**: off — when on, panelists critique each other's docs after round 1 and return agree/dispute per claim
- **verify**: all claims (alternatives: conflicts-only, non-corroborated-only, off)
- **votes**: 1 refuter per claim; 3 for any conflict, majority wins
- **docs**: `.agents-local/docs/reviews/pr<N>-<model>.md`, or the repo's stated review-doc convention

## Claim contract

Every panelist writes its human-readable doc AND returns claims in this shape:

`{ id, file, lines, severity: blocker|major|minor|nit, statement, evidence, confidence: high|med|low }`

`statement` is ONE falsifiable sentence; `evidence` cites actual code. Reject vibes ("could be cleaner") — demand claims that can be wrong. This is what makes clustering and refutation mechanical instead of judgment calls.

## Steps

1. **Scope inline.** Resolve the PR/branch, skim the diff (`pr://<N>/diff`), write one shared brief to `local://panel-brief.md`: branch, base, diff summary, review focus, claim contract, doc path. Done when the brief is byte-identical input for every panelist.
2. **Fan out the panel** in one `parallel()`. Each panelist: same brief, reviews the full diff plus enough surrounding code to ground every claim, writes its doc, returns schema claims. Panelists MUST NOT read other panelists' docs. Done when every panelist has returned or its failure is logged — a dead panelist shrinks the panel, never blocks it.
3. **Cross-review** (only if on): each panelist reads the others' docs, returns agree/dispute per claim id.
4. **Cluster.** Bucket every claim: **corroborated** (≥2 panelists, same underlying defect), **unique**, **conflicting** (statements can't both hold), **dependent** (one presupposes another). Done when every claim sits in exactly one bucket and none were dropped.
5. **Refute** per the verify dial: fresh agents per claim, prompted "refute this claim against the actual code; default refuted when unsure." Conflicts: the refuter sees both statements and picks a winner or rejects both. Done when every in-scope claim has a verdict.
6. **Synthesize** one report at the docs path (`-panel-report.md` suffix): surviving claims by severity, each tagged with bucket + panel provenance; conflicts and their resolution; a "refuted" section for what the panel got wrong; links to the panelist docs. Corroboration is evidence, not proof — the refuter verdicts are the product.
