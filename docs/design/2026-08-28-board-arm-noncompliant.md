# The board arm has never used the board

**Status:** finding, 2026-08-28. Block 2 shakedown, before the measurement
clock started.

## What was measured

A full walk of every board-arm bot's skill log — 20 bots, **1,285,287 skill
records**, 2026-08-20 to 2026-08-28:

| | |
|---|---|
| `board` skill invocations | **10** |
| distinct bots that ever called it | 4 of 20 |
| pool `board-d` | 0 |

For scale, one bot alone logged `gather` 3,774 times, `explore` 3,259 and
`mine` 3,124 over the same period.

This is not a detector artifact. The same counter reported twelve other skills
correctly, and the record schema (`skill.name`) was confirmed against a raw
record before counting. An earlier version of the query returned an empty
result because it filtered on a `kind` field that skill records do not have —
that reading was discarded, not reported.

## Why it voids the arm rather than merely weakening it

Two lines of source decide what each arm shares:

- `bots/src/lessons.mjs` — `const shared = config.memory.scope === 'shared'`
- `bots/src/worldfacts.mjs` — `const pooled = config.memory.scope !== 'isolated'`

So for `scope === 'board'`: lessons are **private**, and world facts are
**pooled automatically**. Walking to the board is the *only* path by which a
board bot can ever receive another bot's lesson. With that walk effectively
never taken, the board arm reduces to:

> private lessons + pooled world facts

which is precisely the **placebo** arm. Two of the four rungs of the dose
ladder are the same rung. Any Block 2 claim about *costly* shared memory —
the entire point of the third arm — has no arm to rest on.

Corroborating, from `treatment-liveness` over 6h: `board-b`, `board-c` and
`board-d` report LESSONS INSUFFICIENT with `inherited=0`, and board calls read
0 across all four pools.

## What it is not

It is not a plumbing failure. `prompt.mjs` names the board in the capability
appendix for `scope === 'board'`, so the model can see it and can call it. The
model simply almost never chooses it. That places this with
`recent-events-frequency-bias` — a question about how the agent selects a verb,
not about whether the verb exists.

## Consequences

1. Mark board **treatment-failed / noncompliant** for Block 2 and exclude it
   from any claim about costly shared lessons until it is fixed and re-shaken.
2. The pre-registration's four-arm dose ladder needs an amendment recording
   that board did not administer its dose in this block.
3. Do **not** fix it by forcing or auto-scheduling board visits. That changes
   the treatment from "sharing that costs a walk" to "sharing that is
   compelled", which is a different independent variable and needs its own
   shakedown.

## Why this is a good outcome

The measurement clock had not started. Shakedown exists to find exactly this,
and it found it with 1.3M records of evidence rather than at analysis time with
a published effect size attached.
