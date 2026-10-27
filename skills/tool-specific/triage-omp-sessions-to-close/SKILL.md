---
name: triage-omp-sessions-to-close
description: Rate every live omp session (Paseo + Herdr, default + nilo profile) on whether it's safe to close, and publish a fresh close/keep HTML page.
disable-model-invocation: true
argument-hint: "optional: a pasted 'Close (n): …' decision, or a scope like 'only Nilo'"
---

Stefan juggles a hundred omp sessions and wants to close the finished ones without forgetting anything. Closing never deletes a transcript; what closing loses is the **watcher**: nobody follows up on the session's open questions, promised steps or unpushed work. Your job is to say, per session, how sure you are that the watcher is no longer needed.

Works cold: everything below comes from the machine, not from the current conversation.

If the invocation carries a pasted decision (`Close (n): …` / `Keep (n): …`, copied from the page), skip to **Act on the decision**.

## 1. Inventory

```sh
python3 <skill-dir>/collect.py /tmp/omp-triage/sessions.json --exclude-session <your own omp session id>
```

Covers Paseo agents in every workspace and every running Herdr session (`herdr session list`), both profiles. Done when it prints the session count per app, the RAM the sessions hold, and the machine's available RAM. Each entry has the workspace, tab, last write, `ram_mb` (RSS of the session's omp process plus its children; `null` when no process runs it), first user message, last two user messages, the tails of the last two replies, and live states of the Nilo PRs those replies mention.

## 2. Judge every session

Sort each session into **active** (left off the list, named in a collapsed section) or **candidate** (on the list, with a confidence). Read the entry's messages; the rubric is in **Judging** below. Every session gets a verdict; with more than ~20, fan the judging out (Eval `completion` with the rubric per session, or subagents) and read the results yourself.

## 3. Check the facts live

Every claim that a page row makes about the world gets checked against the world, not the transcript: PR merged/closed (`gh pr view`, the collected PR states), commits unpushed (`git log @{u}..`, `git branch -r --contains`), repo without a remote, worktree still on disk, server still listening (`ss -ltnp`). A PR "closed" may be superseded; find the replacement before calling the work lost. Done when every "lose" line that names repo, PR or process state has been verified, and wrong ones corrected.

## 4. Render and verify

Write the page data (shape below) to `/tmp/omp-triage/page.json`, then:

```sh
python3 <skill-dir>/render.py /tmp/omp-triage/page.json
```

It publishes a dated page plus the stable `<webshare origin>/pages/omp-close-triage.html` (origin from `~/.config/my-agents/local.md`; `render.py` prints both links). Open it in a browser: console clean, row count equals candidates, one toggle and one section **close all** change the counts and the **RAM freed** tile. Then give Stefan the link, the green/yellow/red counts, the RAM the default selection frees, and the red rows by name in one telegraphic line each. Delete `/tmp/omp-triage/`.

## Act on the decision

Stefan pastes the page's **Copy decision** text. First take the **before** reading: `MemAvailable` from `/proc/meminfo`, and the RSS of every process tree you are about to end (rerun `collect.py`; its `ram_mb` per id is current). Then, for every line under `Close`:

- **Paseo** (`src` = `Paseo`): `paseo archive <id>`. An "already archived" error counts as closed.
- **Herdr** (`id` = `herdr:<session>:<pane>`): `herdr --session <session> agent prompt <pane> /exit`, wait until `herdr --session <session> agent list` no longer shows the pane's agent, then `herdr --session <session> tab close <tab_id>` when no other agent in that tab is `working` or `blocked`.

Then leave a memo on every session you closed, so Past sessions shows why it might be worth reopening: `node ~/workspace/my-agents/paseo-plugins/past-sessions/bin/memo.mjs set <key> "<memo>" [--attention "<text>"]`. Key: `paseo:<agentId>` for Paseo rows; `omp:<sessionId>` for Herdr rows (the id in the session file name), which stays on the session if it's later imported. The memo is one or two telegraphic sentences: what the session did and where it stopped (the page's `about`, tightened). Pass `--attention` **only** when something genuinely needs Stefan: an unanswered question, uncommitted or unpushed work, a decision or plan that lives only in the conversation; normally the page's `lose` line, when that loss is real. When nothing needs him, omit `--attention` entirely: never "nothing open", "none", "n/a" or similar filler.

Done when a fresh `paseo ls -g` and `herdr agent list` per session show none of the closed ids, and no process still runs any closed session (`pgrep -f <session id>` and `lsof <session file>` both empty). Then take the **after** reading and report: closed, failed, skipped; the summed `ram_mb` of what you ended (the reclaimed RSS); and the change in `MemAvailable`, labelled as noisy because other processes move it too.

## Judging

**Active** — keep off the list: status `running`; Stefan wrote to it in the last 24 h; or it owns work in flight that lives nowhere else (shepherding an open PR to merge, supervising a coder, a promised follow-up whose trigger hasn't fired yet). `why` names that work in one line.

**Candidate confidence** — `conf` is the % confidence that closing loses nothing:

| zone | conf | means |
|---|---|---|
| green | 85–100 | done, and the result lives somewhere durable: commit, ticket, map, report delivered to a parent that is still open |
| yellow | 60–84 | done, with one small loose end the row's `lose` line names |
| red | 0–59 | unfinished work, an open question to Stefan, a plan that exists only in the chat, local-only commits, half-done setup |

Red rows default to **keep** on the page; Stefan flips them.

**Row text** — telegraphic, short sentences, plain words:
- `about`: ≤ 12 words, what the session did.
- `lose`: ≤ 14 words. Starts with `Nothing.` exactly when nothing is lost (the page colours those green); otherwise names the concrete thing.

## Page data

```json
{
  "candidates": [
    {"id": "5cfea47", "src": "Paseo", "profile": "nilo", "ws": "WA Tools → BE", "tab": "Movement", "nilo": true,
     "conf": 98, "about": "Found why main's nightly perf check broke.", "lose": "Nothing. Replaced by #13836, merged.",
     "ram_mb": 142, "last": "2026-10-27T14:32:26Z"}
  ],
  "active": [
    {"src": "Paseo", "profile": "nilo", "ws": "WA Subagents", "tab": "Orchestrator", "why": "Syncs the #13536 stack as each PR merges."}
  ]
}
```

`id`, `src`, `profile`, `ws`, `tab`, `ram_mb`, `last` come straight from `sessions.json` (`id`, `app`, `profile`, `workspace`, `tab`, `ram_mb`, `last_message_at`); give active entries their `profile` too. The page filters rows by app (Paseo/Herdr, from `src`) and by `profile` (`default`/`nilo`). `nilo` is true for nilo-profile sessions and Nilo repo work. Order doesn't matter: the page sorts by zone, keeps each workspace's rows together, and puts higher confidence first. `render.py` rejects missing fields, a `profile` other than `default`/`nilo`, duplicate ids, a non-integer `conf`, and a `ram_mb` that isn't an integer or `null`.
