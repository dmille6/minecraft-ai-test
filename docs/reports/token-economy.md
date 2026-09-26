# Token economy — where the operator's tokens go and how to cut them (16 Sep 2026, Claude's pass; ChatGPT's pass and the reconciled plan follow)

Owner's question: "How will the local model help my token usage? Let's use ChatGPT and Claude to find effective ways to reduce it."

## Part 1 — Claude's analysis

### The cost model
An agentic session bills roughly `turns × context length`. Every tool call is a turn; every turn re-reads the whole conversation (a stable prefix is cache-discounted; the growing tail is not). So the two levers are: fewer turns, and a shorter context per turn. Output tokens are minor by comparison.

### Where this session's tokens actually went (15–16 Sep, measured by counting)
| Activity | Turns per canary (approx.) | Notes |
|---|---|---|
| Deploy + verifier + early read | 5 | scripted now (`deploy*.sh`), still 3–5 turns of glue |
| Four reads + interpretation | 8–12 | the monitor prints the summary lines, I still pull the tables |
| Death events | 2–6 | one turn per death, plus a trace read when it matters |
| Verdict + promotion/teardown + docs + memory + status | 6–10 | mostly scripted, still several turns |
| Draw ticks, "still holding" turns, harness nudges | 6–10 | pure overhead: a turn that replays 150k+ tokens to say "waiting" |
| Builds and reviews (code, tests, Codex) | 20–60 per change | the productive part; Codex tokens are ChatGPT's, not mine |

Per canary: 30–40 operator turns, at a context that grew from 50k to well over 150k tokens over the day. The context growth is the multiplier: the same turn at the end of the day costs three times what it cost in the morning.

### What the local model saves
Little, by itself. The 30-minute checkups were never Claude turns; they were cron scripts. The analyst's value is that a verdict arrives pre-formed at each read, so I stop pulling tables — perhaps a quarter fewer turns per canary — and that it pages on the conditions I was watching for by hand.

### What cuts the bill (ordered by effect)
1. **Run the canary loop on the host, end to end.** Draw → deploy → reads → mechanical verdict (the read scripts already print it) → promotion or teardown → ledger, docs line, page. The local model checks the verdict and lists anomalies; the operator is paged only on a verdict, a flag, or an exception. 35 turns per canary become about 5. Safe now because the rules are calibrated and mechanical (v15c, v14c, v16, the baseline tripwire).
2. **A fresh session every day from a compact state file.** Replace the append-only handoff (now 300+ lines) with `STATE.md` regenerated at each verdict: fleet sha, live canary, queue, rules in force, open wake-ups. A morning session starting from 5k tokens of state instead of 150k of history cuts every subsequent turn by that ratio.
3. **No turn that says nothing.** Draw monitors emit only when ready (not "not ready" hourly); death polls emit only on a death; waiters are single-notification; the harness's "say what you're doing" nudges should get one line, not a tool call.
4. **Small tool outputs.** `head`, `cut`, summaries — already the habit; make it a rule: never print a table the monitor already summarised, never re-read a transcript to recover a command (commands live in scripts).
5. **Reviews stay on ChatGPT** (Codex) — they are the heaviest reads and they are not on the operator's bill; keep the prompts to the diff plus a one-paragraph brief, not the whole doc history.

### Expected effect
Items 1–3 together: roughly a fivefold reduction per canary and a two- to threefold reduction per turn from the shorter context, so a day like yesterday (four canaries, three builds) at perhaps a fifth of the operator tokens. Item 1 is the day's build.

## Question for the reviewer
Is the cost model right for an agentic CLI session with prompt caching (turns × context, with a cached prefix)? Which of the five items is wrong or missing, and what would you add? Name at most three defects with one-line remedies, then ACCEPTABLE or NOT ACCEPTABLE.

## Part 2 — ChatGPT's pass (Codex, independent)
Directionally right (host automation, compact state, fewer wake-ups, no re-reading) but: (1) the cost model is too crude — with prompt caching a turn bills uncached input, cache writes, cache reads and output at different rates; previous tails become cacheable; expiry matters; measure before claiming 3× or 5×. (2) Event suppression needs batching and session boundaries: debounce fleet events into bounded summaries, escalate urgent exceptions at once, suppress idle nudges before inference, rotate sessions at task/context boundaries from STATE.md, log offsets and artifact references. (3) Delegation is underspecified and "Codex is free" is unsupported: route routine triage to scripts or the local 27B returning only actionable summaries, and count every provider's cost or subscription limit. NOT ACCEPTABLE as written.

## Part 3 — reconciled (both engines), and what changes today
**The corrected cost model.** Observed in this session: the per-call budget counter falls by roughly 1–10k tokens per tool call, not by the context size — the replayed conversation is served from cache. What is expensive: (a) every NEW token (tool output, my text and reasoning) — so small tool outputs and short replies are the first lever; (b) a COLD START after an idle gap longer than the cache lifetime (about an hour), which re-writes the whole context at the write rate — and a canary's reads are 1–3 h apart, so most wake-ups in a long session are cold starts on a 150k-token context; (c) sheer turn count only through (a) and (b). Claude's "35 turns × 150k" framing overstated it; ChatGPT's "measure first" stands, and the counter is what we measure with.

**What follows, ordered by effect:**
1. **Short context, always.** A fresh session every morning from `docs/reports/STATE.md` (written 16 Sep, ~3.6 KB), and mid-day when a task boundary lands after a verdict. A cold start on 5k tokens is negligible; on 150k it is the single largest cost in a day of waiting. The append-only handoff stays as the audit trail, never as the thing a session reads.
2. **No wake-up that says nothing.** Monitors emit only on a read landing, a death, a flag or a ready draw (no "not ready" ticks); waiters are single-notification; an idle nudge gets one line and no tool call. Events already batch within a window.
3. **Routine triage off the operator.** The local analyst (fixed 16 Sep: current rule, the reads' key lines) returns one verdict object per 30 min; the monitor surfaces only flags. The read scripts print their verdict lines; the operator reads those lines, not the tables.
4. **The canary loop on the host** (draw → deploy → reads → mechanical verdict → promote/teardown → ledger → page), operator paged on verdicts and exceptions only. This is the structural cut; it is the next build.
5. **Count every provider.** Codex runs on a subscription with its own limits; reviews stay scoped (diff + one paragraph). Measure: note the budget counter at each session boundary in STATE.md and report the day's spend in the status report.
Claimed effect, honestly: not a multiplier we can state before measuring; the cold-start and new-token levers are the ones the counter will show first.
