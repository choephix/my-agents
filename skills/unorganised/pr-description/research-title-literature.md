# PR / commit title rules: what the literature actually says

Scope: the **Title** section of `SKILL.md` only. Under squash-merge the PR title becomes the
commit subject ([GitHub: default squash message is the PR title when the PR has ≥2 commits, the
commit title when it has exactly 1](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests)),
so the whole commit-subject literature applies directly.

## Sources consulted

| Tag | Source |
| --- | --- |
| Beams | [How to Write a Git Commit Message](https://cbea.ms/git-commit/) (2014, the de-facto canon) |
| Pope | [A Note About Git Commit Messages](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html) (2008, the original) |
| git(1) | [`git-commit` DISCUSSION](https://git-scm.com/docs/git-commit#_discussion) |
| git-SP | [git `Documentation/SubmittingPatches`](https://git-scm.com/docs/SubmittingPatches#describe-changes) |
| ProGit | [Pro Git, Commit Guidelines](https://git-scm.com/book/en/v2/Distributed-Git-Contributing-to-a-Project#_commit_guidelines) |
| Kernel | [Linux `submitting-patches.rst`](https://www.kernel.org/doc/html/latest/process/submitting-patches.html) ([Describe your changes](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#describe-your-changes), [Subject Line](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#subject-line)) |
| CC | [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) |
| Angular | [Angular commit message guidelines](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md) |
| Google | [eng-practices: Writing good CL descriptions](https://google.github.io/eng-practices/review/developer/cl-descriptions.html) |
| GitLab | [MR workflow → Commit messages guidelines](https://docs.gitlab.com/development/contributing/merge_request_workflow/) |
| K8s | [kubernetes.dev: Pull requests → Commit Message Guidelines](https://www.kubernetes.dev/docs/guide/pull-requests/) |
| Go | [Go Contribution Guide → Good commit messages](https://go.dev/doc/contribute#commit_messages) |
| GH-blog | [Write Better Commits, Build Better Projects](https://github.blog/developer-skills/github/write-better-commits-build-better-projects/) (GitHub, 2022) |
| GH-docs | [Helping others review your changes](https://docs.github.com/en/pull-requests/concepts/helping-others-review-your-changes) |
| Tian22 | Tian, Zhang, Stol, Jiang, Liu, [*What Makes a Good Commit Message?*](https://arxiv.org/abs/2202.02974), ICSE 2022 |
| Zhang22 | Zhang, Irsan, Thung, Han, Lo, Jiang, [*Automatic Pull Request Title Generation*](https://arxiv.org/abs/2206.10430), ICSME 2022 |
| Hutterer | [On commit messages](http://who-t.blogspot.com/2009/12/on-commit-messages.html) (2009) |

---

## 1. Consensus rules

**C1 — The first line is a standalone subject, structurally distinct from the body; blank line after.**
Mechanically enforced by git: "the text up to the first blank line … is treated as the commit title,
and that title is used throughout Git"
([git(1)](https://git-scm.com/docs/git-commit#_discussion)).
[Pope](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html) enumerates the consumers
(`log --pretty=oneline`, `rebase -i`, `shortlog`, `format-patch`, reflogs, gitk, GitHub UI);
[Beams rule 1](https://cbea.ms/git-commit/); [Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)
("the first line should stand alone, allowing readers to skim through code history much faster").

**C2 — It must be short. Every source that names a number names 50 as the target.**
50 chars: [git(1)](https://git-scm.com/docs/git-commit#_discussion) ("no more than 50 characters"),
[git-SP](https://git-scm.com/docs/SubmittingPatches#describe-changes) ("50 characters is the soft limit"),
[Pope](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html) ("shoot for about 50 … not a hard maximum"),
[ProGit](https://git-scm.com/book/en/v2/Distributed-Git-Contributing-to-a-Project#_commit_guidelines),
[Beams rule 2](https://cbea.ms/git-commit/) ("shoot for 50 characters, but consider 72 the hard limit"),
[K8s](https://www.kubernetes.dev/docs/guide/pull-requests/) ("keep the subject line to 50 characters or less;
do not exceed 72"). See §2 for where the ceiling is contested.

**C3 — Imperative mood.**
[Beams rule 5](https://cbea.ms/git-commit/) with the "If applied, this commit will ___" test;
[Pope](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html) ("'Fix bug' and not 'Fixed bug' or 'Fixes bug'");
[Kernel](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#describe-your-changes)
("as if you are giving orders to the codebase");
[git-SP](https://git-scm.com/docs/SubmittingPatches#imperative-mood) (same wording);
[Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)
("written as though it were an order … 'Delete the FizzBuzz RPC' not 'Deleting'");
[Angular](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md)
("'change' not 'changed' nor 'changes'"); [GitLab template](https://docs.gitlab.com/development/contributing/merge_request_workflow/);
[K8s](https://www.kubernetes.dev/docs/guide/pull-requests/); [ProGit](https://git-scm.com/book/en/v2/Distributed-Git-Contributing-to-a-Project#_commit_guidelines).
Beams' rationale is that git generates its own subjects this way (`Merge branch 'x'`, `Revert "…"`).

**C4 — No trailing period.**
[Beams rule 4](https://cbea.ms/git-commit/); [git-SP](https://git-scm.com/docs/SubmittingPatches#summary-section)
("omits the full stop at the end"); [Angular](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md)
("no dot (.) at the end"); [GitLab](https://docs.gitlab.com/development/contributing/merge_request_workflow/);
[K8s](https://www.kubernetes.dev/docs/guide/pull-requests/) (explicitly "a space saving measure").
Contested by Google — see §2.

**C5 — A scope/area prefix is the dominant structural convention.**
[git-SP](https://git-scm.com/docs/SubmittingPatches#describe-changes): "conventional in most cases to prefix
the first line with `area: ` where the area is a filename or identifier for the general area of the code
being modified" — `doc: clarify distinction between sign-off and pgp-signing`.
[Kernel](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#subject-line): canonical form is
`subsystem: summary phrase`, e.g. `ext2: improve scalability of bitmap searching`.
[Go](https://go.dev/doc/contribute#commit_messages): "prefixed by the primary affected package" —
`math: improve Sin, Cos and Tan precision for very large arguments`.
[K8s](https://www.kubernetes.dev/docs/guide/pull-requests/): "prefixing your commit message with the kind or area"
— `kube-proxy: add a test case for HostnameOverride`.
[Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html) permits tags but warns
"limit the usage of tags in the first line, as this can obscure the content"; its own good example is
`RPC: Remove size limit on RPC server message freelist.`
[CC](https://www.conventionalcommits.org/en/v1.0.0/) / [Angular](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md)
formalize the same slot as `<type>(<scope>): `.

**C6 — Derive local convention from the history of the code you touched.**
[git-SP](https://git-scm.com/docs/SubmittingPatches#describe-changes): "If in doubt which identifier to use,
run `git log --no-merges` on the files you are modifying to see the current conventions."
[Kernel](https://www.kernel.org/doc/html/latest/process/submitting-patches.html) points at MAINTAINERS/`git log -p -- $area`.
[Beams](https://cbea.ms/git-commit/) frames the whole thing as "teams should first agree on a commit message convention … picking one and sticking to it".

**C7 — Name the change, not the artifact; a title that could describe any commit is a defect.**
[Kernel](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#subject-line): "the `summary phrase`
should not be a filename. Do not use the same `summary phrase` for every patch in a whole patch series."
[Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html) lists as inadequate:
"Fix bug", "Fix build", "Add patch", "Moving code from A to B", "Phase 1", "Add convenience functions".
[Beams](https://cbea.ms/git-commit/) rejects "More fixes for broken stuff", "polishing", "Tweaks to package-info.java files".

**C8 — The subject is a permanent, globally-scoped identifier; write it for search and for skimming.**
[Kernel](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#subject-line): "the `summary phrase`
… becomes a globally-unique identifier for that patch … People will want to google for the `summary phrase`."
[Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html): "Future developers will
search for your CL based on its description."
[Zhang22](https://arxiv.org/abs/2206.10430) gives the reviewer-side version: "by default, PRs are arranged in a
list view that shows the titles of PRs", so a bad title "may result in PR being ignored or rejected."

**C9 — The subject carries *what*; the body carries *why*. (Kernel dissents — see §2.)**
[Beams rule 7](https://cbea.ms/git-commit/), [Hutterer](http://who-t.blogspot.com/2009/12/on-commit-messages.html)
("a diff will tell you what changed, but only the commit message can properly tell you why"),
[Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html) (first line = "short summary
of *specifically what* is being done"; body = why),
[GH-blog](https://github.blog/developer-skills/github/write-better-commits-build-better-projects/) (four-quadrant
Intent/Context/Implementation/Justification model).
Empirically validated: [Tian22](https://arxiv.org/abs/2202.02974) defines a good message as one containing both
Why and What, and finds "an average of circa 44% of messages could be improved" across five active OSS projects.

**C10 — There is a floor as well as a ceiling.**
[GitLab](https://docs.gitlab.com/development/contributing/merge_request_workflow/): "the commit subject should
contain at least 3 words" (Danger-enforced).
[Zhang22](https://arxiv.org/abs/2206.10430) excludes "too short or too long titles" — operationalized as
"titles with less than 5 words or more than 15 words", on the grounds (inherited from iTAPE, Chen et al., ASE 2020)
that "PR titles having 5-15 words are of reasonably appropriate length to precisely and succinctly describe key ideas".

---

## 2. Where sources genuinely disagree

**D1 — 50 vs 72 (and 70–75).**
50 soft / 72 hard: [Beams](https://cbea.ms/git-commit/), [K8s](https://www.kubernetes.dev/docs/guide/pull-requests/).
50 flat: [git(1)](https://git-scm.com/docs/git-commit#_discussion), [ProGit](https://git-scm.com/book/en/v2/Distributed-Git-Contributing-to-a-Project#_commit_guidelines).
50 soft, no stated ceiling: [git-SP](https://git-scm.com/docs/SubmittingPatches#describe-changes), [Pope](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html).
72 flat, no 50: [GitLab](https://docs.gitlab.com/development/contributing/merge_request_workflow/) ("must not be longer than 72 characters").
70–75: [Kernel](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#subject-line) ("the `summary`
must be no more than 70-75 characters").
No number at all: [Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)
("try to keep your first line short … the clarity and utility to the reader should be the top concern"),
[Angular](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md), [CC](https://www.conventionalcommits.org/en/v1.0.0/).
The 72 number is a *rendering* limit, not a style opinion: [Beams](https://cbea.ms/git-commit/) documents GitHub
truncating subjects past 72 with an ellipsis, and [Pope](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html)
derives 72 from 80 columns minus git's 4-space indent on each side.

**D2 — Capitalize vs lowercase. A real, unresolved split.**
Capitalize: [Beams rule 3](https://cbea.ms/git-commit/) ("begin all subject lines with a capital letter"),
[Pope](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html) ("Capitalized, short (50 chars or less) summary"),
[GitLab](https://docs.gitlab.com/development/contributing/merge_request_workflow/) ("must start with a capital letter"),
[K8s](https://www.kubernetes.dev/docs/guide/pull-requests/) ("the first word … should be capitalized unless it starts
with a lowercase symbol or other identifier").
Lowercase: [git-SP](https://git-scm.com/docs/SubmittingPatches#summary-section) — "its first word is not capitalized
… E.g. `doc: clarify...`, not `doc: Clarify...`", with the carve-out that `refs: HEAD is also treated as a ref`
is correct because `HEAD` is inherently caps;
[Go](https://go.dev/doc/contribute#commit_messages) ("it does not start with a capital letter");
[Angular](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md) ("don't capitalize the first letter").
[CC](https://www.conventionalcommits.org/en/v1.0.0/) punts: "any casing may be used, but it's best to be consistent."

**D3 — Trailing period. Near-unanimous "no", with one authoritative exception.**
Every Google example first line ends with a period —
`RPC: Remove size limit on RPC server message freelist.`,
`Construct a Task with a TimeKeeper to use its TimeStr and Now methods.`,
`Create a Python3 build rule for status.py.` — because Google's rule is
"complete sentence, written as though it was an order"
([Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)).

**D4 — Complete sentence vs phrase.**
[Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html): "complete sentence".
[Go](https://go.dev/doc/contribute#commit_messages): explicitly "is *not* a complete sentence", tested by
"This change modifies Go to ___".
[Kernel](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#subject-line) calls it a
"summary phrase". [Beams](https://cbea.ms/git-commit/) tests with "If applied, this commit will ___".
All four tests demand a *verb phrase*; none produces a bare noun phrase.

**D5 — Conventional Commits prefixes: yes / no / other.**
Yes, mandatory and machine-parsed: [CC](https://www.conventionalcommits.org/en/v1.0.0/)
("commits MUST be prefixed with a type … `feat`, `fix`"), [Angular](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md)
(closed vocabulary `build|ci|docs|feat|fix|perf|refactor|test`).
No — free-form area prefix instead: [git-SP](https://git-scm.com/docs/SubmittingPatches#describe-changes)
(`area:` = filename or code area), [Kernel](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#subject-line)
(`subsystem:`), [Go](https://go.dev/doc/contribute#commit_messages) (package name).
Optional, and warned against in the first line: [Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html).
Allowed in either bracket or colon form: [GitLab](https://docs.gitlab.com/development/contributing/merge_request_workflow/)
(`danger: Improve Danger behavior`, `[API] Improve the labels endpoint`).
CC notes the squash workflow explicitly: contributors need not comply because
"lead maintainers can clean up the commit messages as they're merged".

**D6 — Does *why* belong in the subject?**
[Kernel](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#subject-line) says yes, inside
70–75 chars: the summary "must describe both what the patch changes, as well as why the patch might be necessary.
It is challenging to be both succinct and descriptive, but that is what a well-written summary should do."
Everyone else assigns *why* to the body (C9).

---

## 3. Delta: current **Title** section vs the literature

Current rule: *subject line, never a shrunken headline; imperative or noun phrase; no trailing period;
≤72 chars; match repo shape via `gh pr list`; the verb must match the change's real shape.*

1. **No 50-char target — the single clearest divergence.** `≤72` adopts the *truncation ceiling* as the *goal*.
   Six sources name 50 as the target ([git(1)](https://git-scm.com/docs/git-commit#_discussion),
   [git-SP](https://git-scm.com/docs/SubmittingPatches#describe-changes), [Pope](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html),
   [ProGit](https://git-scm.com/book/en/v2/Distributed-Git-Contributing-to-a-Project#_commit_guidelines),
   [Beams](https://cbea.ms/git-commit/), [K8s](https://www.kubernetes.dev/docs/guide/pull-requests/)).
   Self-refuting in the skill's own text: the weak example
   *"Featurebase now does nothing at all until you open the help menu"* is **64 chars** and passes `≤72`;
   the strong example *"Warm Featurebase only when the help menu opens"* is **46**. The rule the skill is
   actually arguing for is 50, and Beams gives the reason a length budget works at all: it "forces the author
   to think for a moment about the most concise way to explain what's going on."

2. **"or noun phrase" is unsupported.** No primary source endorses noun-phrase titles; nine endorse imperative
   mood (C3). The latitude that does exist is narrower and different: git accepts an *indicative sentence*
   where it reads better (`refs: HEAD is also treated as a ref`,
   [git-SP](https://git-scm.com/docs/SubmittingPatches#summary-section)). A bare noun phrase fails every
   published test — Beams' "If applied, this commit will ___", Go's "This change modifies Go to ___",
   Google's "written as though it were an order".

3. **Silent on the `area:` prefix**, which is the most consistently attested structural convention in the
   corpus (C5, D5) — git, kernel, Go, Kubernetes, GitLab, Google, Conventional Commits, Angular.
   Neither the rule nor any of the three examples carries a scope.

4. **`gh pr list --state merged` is the wrong probe.** git-SP prescribes
   [`git log --no-merges` **on the files you are modifying**](https://git-scm.com/docs/SubmittingPatches#describe-changes),
   which is what determines the right *area* token — a repo-wide PR listing does not. It is also indirect:
   [GitHub's squash default uses the *commit* title, not the PR title, when the PR has a single commit](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests),
   so merged PR titles are not reliably what landed in the log.

5. **Capitalization is unaddressed** even though it is a live split (D2) and the skill's cue to "match the
   repo's existing shape" is too vague to resolve it. Concretely: is it `Warm Featurebase…` or `featurebase: warm…`?

6. **No floor.** Only an upper bound is stated. GitLab enforces ≥3 words
   ([source](https://docs.gitlab.com/development/contributing/merge_request_workflow/)); Zhang22 treats <5 words
   as inappropriate length ([source](https://arxiv.org/abs/2206.10430)); Google's inadequate-description list is
   almost entirely 2–4-word titles ([source](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)).
   The skill's own weak example, "Update FeaturebaseMessenger.tsx", is 2 words — caught by the prose, not the rule.

7. **"No trailing period" is stated as absolute** but Google's every good example ends in one (D3). Minor, and
   the skill's position matches the majority; worth knowing it is a majority, not a unanimity.

8. **"Never a shrunken headline" slightly overstates.** Kernel demands the summary convey *why* as well as *what*
   inside 70–75 chars ([source](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#subject-line)),
   which is headline-adjacent. The defensible version of the skill's rule is the *length* argument, not a ban on
   conveying motivation.

9. **Correct and under-credited: "the verb carries the claim."** No source states this rule, but it is the
   operational form of Kernel's "should not be a filename", Google's inadequate-description list, and Tian22's
   finding that the modal way developers express *what* is by naming the changed code object (58–77% of messages,
   "Summarize code object change") rather than the behavior
   ([Tian22 §4.2](https://arxiv.org/abs/2202.02974)). The skill is ahead of the literature here; keep it.

---

## 4. If you changed one thing

Change `≤72 characters` to `~50 characters; 72 is the truncation ceiling, not the target`. It is the one place
the skill states a number that no primary source states as a goal, it is the number that would have caught the
skill's own weak example (64 chars, passes today), and unlike capitalization or `area:` prefixes it needs no
per-repo negotiation — 50 is what git's manpage, git's own SubmittingPatches, Pro Git, Pope, Beams, and Kubernetes
all converge on, and 72 is only where GitHub starts eliding. A hard budget is also the cheapest mechanism the
literature offers for the thing the rest of the section is trying to enforce: at 50 characters you cannot fit a
shrunken headline, so the author is forced into a verb plus the one behavior that changed.
