---
name: pr-review-two-omp
description: Use when Stefan asks for a careful PR/branch review, usually for NILO or nilo-website, using two independent OMP reviewers and an artifact-backed synthesis.
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [pr-review, nilo, nilo-website, omp, artifacts, code-review]
    related_skills: [nilo-worktree-setup, github-operations, adversarial-omp, omp-oh-my-pi-sessions]
---

# Two-OMP PR Review

Review the PR, not your impression of it.

Run two independent OMP reviewers — one Opus route, one smart GPT route — on the same prompt, target, and branch. They are scouts, not judges. The deliverable is *your* synthesis: grounded in their full written reviews and your own spot-checks, weighted toward what they independently agree on. Each reviewer writes its own artifact for the raw record; give Stefan only what matters.

## Workflow

### 1. Load skills as needed

- `github-operations` — PR metadata, `gh`, review posting, branch/base discovery.
- `nilo-worktree-setup` — NILO app worktrees.
- `adversarial-omp` / `omp-oh-my-pi-sessions` — OMP session handling.

### 2. Identify target and PR branch

From a PR URL/number, pull head branch, base branch, title/body, and changed files via GitHub metadata. From a bare branch, infer the target from upstream/default — for NILO and nilo-website that's `origin/main` unless metadata says otherwise. Ask only when the target genuinely changes the review.

```bash
git fetch origin
```

### 3. Create the review worktree

Use `nilo-worktree-setup` for NILO; a fresh `git worktree` otherwise. Don't review in a dirty checkout — verify before starting:

```bash
git branch --show-current
git status --short
git merge-base HEAD origin/<target>
```

### 4. Build the shared review prompt

One prompt, both reviewers. Fill the skeleton with repo, PR title/body, target and head branch, diff summary, changed files, and any scope Stefan sets (e.g. "code only, ignore legal prose").

```text
You are reviewing a PR.

Repository: <repo>
Target branch: <target>
PR branch: <branch>
PR title: <title>
PR description:
<description>

Deeply understand the goal of this PR against its target branch, then review the full diff carefully.

Look for:
- correctness bugs
- regressions
- missing edge cases
- data/model/schema mistakes
- security or privacy risks
- race conditions and async/state bugs
- migration/deployment risks
- tests that are missing or misleading
- code that contradicts the stated PR goal

Do not modify files. Do not produce a generic checklist. Only report findings that matter.

For each finding:
- severity: blocker | high | medium | low
- file/line or exact code area
- what is wrong
- why it matters
- suggested fix
- confidence

Also include: what the PR is trying to do, its strongest parts, open questions, final verdict.

Return a complete review in markdown.
```

### 5. Run the two reviewers

```bash
omp --mode json --auto-approve --model openai-codex/gpt-5.5:xhigh "<prompt>" 2>&1 | tee /tmp/pr-review-gpt.jsonl
omp --mode json --auto-approve --model anthropic/claude-opus-4-8:xhigh "<prompt>" 2>&1 | tee /tmp/pr-review-opus.jsonl
```

Resolve names if aliases drift (`omp models find gpt`, `omp models find opus`). If OMP can't find Bun:

```bash
export PATH="/home/cx/.local/share/mise/shims:/home/cx/.local/share/mise/installs/bun/1.3.14/bin:/home/cx/.bun/bin:$PATH"
```

Don't restrict their tool access — they need to read beyond the diff.

Redirect JSONL to files (above) and extract only the final assistant review and session IDs — never stream raw thinking/tool payloads back into Hermes.

### 6. Cross-check, then verify yourself

Forward each review into the other's session:

```text
Another capable agent did the same PR review. Where do you align, where do you diverge? Ignore trivial differences; focus on material findings. Hold your position if it's right, concede precisely if they made a good point, and don't flip for politeness.

<other review>
```

Then verify material findings yourself against the worktree, and feed verified corrections back into both sessions equally. For analytics/tracking/event PRs, trace the call graph from each changed entry point through shared helpers — watch for duplicate emits, misattribution from hard-coded defaults, and "request started" vs "completed successfully" confusion. These survive first-pass review because each call site looks fine in isolation.

### 7. Write the artifacts

Each reviewer writes its own artifact — instruct both sessions to do so, handing each only the guide path so it reads the guide at write time:

```text
When you are ready to write the vault artifact, read and follow `/mnt/obsidian-vault/Workspace/Hermes/HOW_TO_WRITE_VAULT_ARTIFACTS.md`.
```

Write a final synthesis artifact yourself only if Stefan asks — same guide, read at write time.

### 8. Report to Stefan

Synthesis, not the union of two lists. Hold both lines at once:

- **Keep** a real finding even if only one reviewer caught it — a single-source blocker still ships as a blocker.
- **Cut or flag** a confident-sounding finding you couldn't verify in the worktree.

Group by agreement, then by severity within each group:

1. **Agreed** — both found it independently. Lead here; convergence is the strongest signal it's real.
2. **Single-source** — name the reviewer (GPT or Opus) and give your verification status.

Keep it short: artifact paths, your call on what matters, any process blockers. Don't paste the artifact unless Stefan asks.

## Severity

- **blocker** — broken, unsafe, data-losing, or security-sensitive; cannot ship.
- **high** — real bug or regression likely to hit users.
- **medium** — plausible bug, missing edge case, or serious maintainability risk.
- **low** — cleanup or test clarity that affects future correctness.

Three sharp findings beat twenty vague ones.

## Done

- [ ] Target branch identified; clean worktree created
- [ ] Both reviewers ran on the same prompt
- [ ] Each reviewer wrote its own artifact (given only the guide path)
- [ ] Report leads with agreed findings, attributes single-source ones, reflects your own verification
