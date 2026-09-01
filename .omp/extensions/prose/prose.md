# /prose — how much of a session is actually conversation?

`prose.ts` forks the current branch into a new session containing only what was
said: your messages and the agent's replies, verbatim. Provider bookkeeping and
reasoning are dropped, skill injections shrink to a stub, and every tool call
collapses to one bracketed line naming the tool, its target, and a direct
artifact recovery pointer (e.g. `[ran read foo.ts; recover: artifact://1:10-50]`)
pointing into a single `.prose.log` session artifact containing the full discarded
inputs and results — unless you ask for `+tools`, which keeps the native `toolCall`
/ `toolResult` turns. No model call, no tokens, instant. The fork's header points
back at the source, so `/tree` and `/resume` still reach the original.

One axis governs tool calls, at three levels — `none`, `trace` (the default),
`full` — set for everything at once, or per tool name:
```
/prose                      one line per tool call, every tool without exception
/prose ^                    trim in place: keep your last question and everything
                            after it verbatim, distill everything before it
/prose ^N  /prose ^?        same, keeping the last N turns / picking from a list
                            (plain N distills the last N turns instead — inverse cut)
/prose -tools               no tool traces at all
/prose +tools               native toolCall + toolResult turns: full arguments,
                            full output, nothing capped
/prose +tools=read,edit     those native, every other tool still traced
/prose -tools=bash,todo     those erased, every other tool still traced
/prose -tools +tools=task   the slots compose — delegations native, rest erased
/prose +think               also keep reasoning, in [thinking]…[/thinking]
```

What follows is the measurement, run over a real corpus of **3506 sessions,
2.2 GB**, on 2026-08-07. No session content was read — only sizes and structure.

## Hand-picked spread

Branch payload = the JSON the provider actually sees, active branch only.

| band | file | msgs → prose | payload → prose | kept |
|---|---|---|---|---|
| huge | 40.8M | 3575 → 23 | 14.0M → 83K | **0.6%** |
| huge | 10.0M | 1093 → 56 | 5.7M → 106K | 1.8% |
| huge | 7.4M | 194 → 44 | 1.8M → 82K | 4.5% |
| large | 3.8M | 236 → 2 | 3.7M → 5K | **0.1%** |
| large | 1.4M | 6 → 2 | 31K → 4K | 11.9% |
| medium | 780K | 32 → 6 | 565K → 49K | 8.8% |
| medium | 465K | 97 → 2 | 395K → 4K | 1.1% |
| small | 117K | 14 → 2 | 78K → 2K | 2.3% |
| small | 40K | 6 → 6 | 39K → 38K | **99.2%** |
| tiny | 3K | 2 → 1 | 1K → 0K | 8.3% |
| the session that built this | 4.2M | 902 → 20 | 3.0M → 50K | **1.6%** |

## 180 random sessions

```
kept%   p10 0.2   median 1.2   p90 8.3   worst 100
aggregate  76 MB payload → 1.24 MB prose  =  62x smaller

  <1%            80  ########################################
  1-5%           66  #################################
  5-20%          25  ############
  20-60%          4  ##
  >60% (no-op)    5  ##
```

**Where the weight actually is** (content bytes, JSON scaffolding excluded):

| | | |
|---|---|---|
| tool results | 20.0 MB | 77.3% |
| tool calls | 2.9 MB | 11.1% |
| thinking | 1.6 MB | 6.4% |
| assistant text | 0.8 MB | 3.0% |
| user text | 0.6 MB | 2.3% |

**The conversation is 5.3% of what a session contains.** The other 94.7% is
machinery. That single number is the whole story — `/prose` isn't compressing
anything, it's deleting a 19:1 majority that was never conversation.

Practical form: of the 66 sampled sessions above 100k tokens of payload,
**65 fit under 20k tokens after `/prose`** — median **2k**, worst 22k. The 40 MB
monster with 3575 messages distills to ~21k tokens. 2.2 GB of history is ~36 MB
of things anyone actually said.

## Correctness at scale

Invariants asserted on all 172 sampled sessions that had a conversation —
**zero violations**:
- role sequence is legal: user/assistant turns, with toolResult runs only after
  an assistant that still holds the matching toolCalls (`+tools`)
- always opens on a user turn
- no empty text blocks
- no part type other than text/image (or native toolCall when `+tools`)
- no orphaned `textSignature`
- no surviving `providerPayload`
- every kept toolCall has a matching toolResult (`+tools`)

That is the property that matters: every one of those would be a provider-side
rejection when you resume the fork.

## Honest caveats

- **Message counts mislead, payload doesn't.** `236 → 2` isn't loss — an
  autonomous run with one prompt yields one user message and one merged
  assistant message. The 3.7M → 5K is the real figure.
- **`>60% kept` is correct behavior, not failure.** 9 of 180 sessions were
  tool-free chats; `/prose` has nothing to remove and says so by doing nothing.
- **Thinking is understated** at 6.4% — most providers store it encrypted, so
  the bytes generated were far larger than the bytes persisted.
- **File size is not branch payload.** One 1.4M file carried only 31K on its
  active branch; the rest was abandoned branches and retries, which `/prose`
  never sees.
- `/prose` reads the whole branch, so on a compacted session it **recovers
  messages that `/compact` had already summarized away**.
- `/prose ^N` trims via a `/clear`-style reset boundary: the original turns stay
  on the branch above it (state entries included), so a later bare `/prose`
  distills both the original region and the kept copies — the fork is a superset.
- **In-place trims never reopen sealed history.** Both `/prose N` and `/prose ^N`
  address only the region the host still emits — after the latest `/clear`
  boundary, or a compaction's summary plus the tail it kept. Distilling above
  that would put collapsed turns back into the context (and *grow* it), so
  turn numbering stops there and out-of-range asks say `turn(s) reachable`.
  Bare `/prose` is the exception, by design: a fork exports the full branch.
- After `/prose ^N` the context meter shows an **estimate** until the next real
  turn. The originals stay on the branch, and the host picks its context anchor
  by scanning the whole branch (it stops at a compaction, not at a reset
  boundary), so the copies deliberately shed `contextTokens`, `contextSnapshot`,
  and their exact timestamps — otherwise the trimmed session keeps reporting the
  pre-trim size and can trip auto-compaction immediately.
- **The numbers above predate the three-level redesign.** They were measured
  when the default traced only file touches and speech and dropped every other
  call. Re-run on 179 local sessions (105 MB of branch payload, 2026-08-10):
  that old default kept 3.8%, tracing *every* call keeps 4.3%. Universal
  tracing is essentially free. `+tools` is the far end — native tool turns,
  still smaller than the original because thinking, provider payloads and
  signatures are the remaining mass.

## Verdict

Two different tools, and the composition table explains why. `/compact` keeps a
lossy summary of everything, including the machinery. `/prose` keeps a lossless
copy of everything said and deletes everything done — 62x on average, because
the machinery was always the mass.

It won't help you remember *why* a file was edited. It's the right tool when the
reasoning is spent and the exchange is what you want to keep working from.
