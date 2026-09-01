# Text-only / legal-document PR reviews with adversarial OMP

Use this pattern when Stefan asks for an adversarial PR review but explicitly wants agents to ignore code and review only document text (legal docs, policy pages, copy, terms, etc.).

## Prompt framing

Tell each agent explicitly:

- Scope is the document text only, not code or implementation.
- If legal/policy documents are involved: this is not legal advice; assume legal substance came from experts.
- Look only for high-confidence mechanical/editorial defects introduced while transferring instructions into files:
  - typos, duplicated/missing words, broken punctuation, bad capitalization;
  - malformed Markdown/Markdoc structure visible to users;
  - bad internal links/anchors, inconsistent headings/labels/URLs/emails;
  - obvious copy/paste artifacts such as stray diff markers;
  - garbled sentence-level text.
- Avoid style preferences and legal/business/content opinions.

## Context construction

Prefer feeding agents only the relevant document files or document-only diff, not the whole PR diff. If the full document text is too large for shell argv, write the prompt to a temp file and either:

1. shrink to added/changed document text plus relevant context; or
2. resume/launch with a smaller prompt built from `git diff --unified=<n> origin/main...HEAD -- <document files>`.

Do not let agents inspect or modify the repo for a review-only task unless there is a specific reason. Use `--no-tools --no-skills` for OMP when the prompt already contains the review material.

## Verification pass

After first-round answers, independently verify each claimed issue in the worktree:

- grep/read exact lines for claimed typos/anchors/headings;
- compare base vs head for whether a visible issue is PR-introduced or merely pre-existing context;
- classify findings as primary PR-introduced blockers vs optional pre-existing cleanup notes.

Send only neutral verified facts back to both existing OMP sessions, then ask for final carried-forward findings/retractions.

## Reporting

Separate:

- primary high-confidence PR-introduced text defects;
- optional notes that are real but not introduced by the PR;
- explicit out-of-scope reminder (not legal advice, code ignored).

If Stefan asked for an artifact, write the final result as a report artifact with OMP session IDs/log paths and the verification commands/facts used.
