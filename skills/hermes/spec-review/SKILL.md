---
name: spec-review
description: Use when asked to review, evaluate, validate, or audit a written specification, requirements doc, rules document, RFC, or API/protocol spec — single file or a docs/ collection. Grounds the review in authoritative external sources for the domain, not just internal consistency.
category: software-development
---

# Spec Review

## When to use
- User asks to review / evaluate / validate / audit a spec, requirements doc, rules doc, RFC, API or protocol spec, or design doc.
- Applies to a single file or a collection (e.g. a `docs/` directory in a repo).

## Core principle
A spec can be perfectly internally consistent and still be **wrong about the domain.** Internal-consistency review alone is insufficient — and actively dangerous: it lets you manufacture confident-but-wrong "corrections." Always ground the review in **authoritative external sources** for the domain, and verify domain claims against them rather than reasoning from first principles.

## Method
1. **Read the whole spec.** No sampling. If it's a repo directory, fetch every file. For private GitHub repos use the authenticated `gh` CLI (see Techniques + references/belot-client-spec-review.md).
2. **Internal-consistency pass.** Cross-references, terminology, schema completeness, contradictions between docs. Note findings — but do not treat them as the final word on correctness.
3. **Identify the domain and its authority.** What real-world thing does this spec describe? Does it have official/standardized rules or a canonical reference? (Game → official rules; API → upstream docs/RFC; protocol → the RFC; web behavior → MDN/WHATWG.) **State your sources explicitly.** If no single canonical authority exists (folk games, informal standards), say so and name the dominant published standards you use instead.
4. **External-authority pass — the important one.** For each substantive domain claim, check it against the authoritative source. Classify each as *correct / diverges / undocumented*. **Do not reason correctness from first principles** — verify against the source. (See Pitfalls.)
5. **Prioritize.** Suggested tiers: 🔴 domain-incorrect · 🟠 under-documented / internal gap · 🟡 cross-doc inconsistency · 🟢 nit.
6. **Deliver.** Present findings; if durable, write an artifact (follow the artifacts guide). Include a provenance note: what you read, which sources you checked, and **explicitly flag any first-pass claims you later corrected.**

## Pitfalls
- **Manufacturing wrong "corrections" from arithmetic / first principles.** Cautionary tale from this skill's origin session: reviewing a Bulgarian Belot game spec, I derived that "No Trumps = 260" must be wrong (I got 250 by assuming Last10 isn't doubled under NT) and reported it as a 🔴 critical error. The user pushed back: "belot has official rules, right?" Checking belot.bg showed 260 is **correct** — under NT both card points (120→240) **and** Last10 (10→20) double; Capot does not. The spec was right; my "correction" was wrong. **Lesson: before flagging any domain claim as incorrect, verify it against an authoritative source. A plausible derivation is not a correction.**
- **Treating internal consistency as correctness.** A self-consistent spec can still misstate the rules.
- **Confusing regional / convention variants.** Many domains (Belot, poker, URL handling, date formats) have legitimate variants. Identify which variant the spec targets *before* declaring something wrong — a divergence from one convention may be a deliberate choice for another.
- **Reviewing file-by-file instead of as a whole.** Cross-document inconsistencies (e.g. conflicting mobile-priority orders, mixed terminology) only surface when you hold all docs in mind at once.
- **Silently swapping a corrected claim.** When a later pass overturns an earlier finding of your own, say so explicitly in the deliverable. Don't quietly replace it.

## Techniques
- **Private GitHub repo files:** unauthenticated `curl`/browser returns 404 on private repos. Use the authenticated `gh` CLI — list with `gh api "repos/<owner>/<repo>/contents/<path>?ref=<branch>" --jq '.[].path'`, fetch each with `--jq '.content' | base64 -d`. Full loop in references/belot-client-spec-review.md.
- **Finding authority:** web_search for `<domain> official rules` / `authoritative` / `standard`; prefer established references (pagat.com for card games, RFC editor, MDN, upstream docs). Cross-check 2+ sources when the domain has known variants.
- **Extracting & reusing rules:** use web_extract on authoritative pages; keep the extracted, condensed content as a knowledge bank in `references/` so future reviews of the same domain reuse it instead of re-fetching.

## Output shape
1. Verdict (one paragraph).
2. Strengths worth keeping.
3. Findings, prioritized by severity, each citing the doc and (where relevant) the authoritative source.
4. Suggested next steps.
5. Provenance: what was read, which sources were checked, and any self-corrections.

## References
- `references/belot-client-spec-review.md` — worked example: the belot client spec review, the NT-260 self-correction, the fetch loop for private repos, the 13 findings, and a condensed Bulgarian-Belot rules cheat-sheet (from belot.bg + pagat) as a reusable knowledge bank.
