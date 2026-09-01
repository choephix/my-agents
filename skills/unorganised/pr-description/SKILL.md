---
name: pr-description
description: Use when writing or revising a pull request description.
---

A write-up about a change is judged from the reader's seat: what the reader most needs decides what appears and in what order.
The shape this produces is an inverted pyramid — importance strictly decreasing, so the reader can stop after any paragraph and still hold a correct, usefully prioritized picture.

The whole thing is freeform prose. Markdown appears rarely, only where it genuinely helps parsing, never as decoration.

**Title**
A title is a *subject line*, never a shrunken headline: imperative or noun phrase, no trailing period, ≤72 characters. Match the repo's existing shape (`gh pr list --state merged`).
The verb carries the claim: a trigger that moved is not a *delay*; work that still runs on demand was not *skipped*.
Example:
- Weak: "Update FeaturebaseMessenger.tsx"
- Weak: "Featurebase now does nothing at all until you open the help menu"
- Strong: "Warm Featurebase only when the help menu opens"

**Headline**
The body's first line alone is enough to understand what was changed and why the PR matters — a teammate reading nothing else can tell whether it concerns them. Name the behavior, not the code touched. Here a full sentence is right.
Example:
- Weak: "Refactor pointer-lock handling in ContextInputHardwareSource."
- Strong: "Character controls work again — since #10618 they self-destructed within a frame of attaching, for every desktop user."

**Story**
Next is a very concise account of what someone can actually do in the app that would have gone differently before. App-level words only — no class names, no subsystem jargon. 

**Mechanism**
Here progressive disclosure begins: exactly what was wrong or missing, then exactly how it was answered — a causal chain in firing order, including what it trades away.
Telegraphic: fragments over sentences. Sacrifice grammar for clarity and concision.

**Evidence**
What ran and what it showed: before/after observations, guards added, caveats stated plainly. Numbers over adjectives.

**Revising a live description**
The description is shared ground: bots keep fenced blocks in it and rewrite them on every push. An edit is a read-modify-write — fetch the live body, change only your own prose, carry every block you don't recognize byte-identical. The race runs both ways: edit after pushes settle, then re-fetch to confirm.

**Notes**
Respect the reader's intelligence. Don't restate things obvious from elsewhere in your text, or from github ui, etc. 
Don't obsess over mentioning other PRs or issues. If you link to the same PR twice, that's too much - find a plainer way to explain.
