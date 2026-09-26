# The avoid gate has a numerator and no denominator

2026-09-26. Read CLAUDE.md and docs/reports/STATE.md first. The LIVE checkout is
/Users/darrellmiller/Documents/mcai-rl02; `main` == `efa2853` == the deployed sha.
Fleet: 80 bots, one version, NO canary running (vetob2-01 closed and torn down at 09:08Z).

## Why this, now — it is the wall the last canary hit

vetob2-01 (B2 veto feedback) closed today. Its mechanism was CONFIRMED on two
independent measures: `repeat_loop` vetoes fell from 18.13 to 5.97/bot-h (warm DiD
**-8.71**, past the pooled 5% null bound of -7.03 and far outside the hive-only null
range +1.40..+4.63), and the share of consecutive ADMITTED decisions that repeat fell
from 0.100 to 0.083 (DiD **-0.043**, past the pooled p5 -0.0415, below every one of six
hive-only draws, stable at -0.042/W=95 and -0.043/W=180, and measured from the JSONL
with the gate nowhere in the path).

But total vetoes barely moved: warm DiD **-3.50** against a gate of -5.03 -> INCONCLUSIVE.
The gain relocated: `repeat_loop` -8.71, `cooldown` +1.46, **`learned_avoid` +3.41**,
net -3.50. ~56% absorbed. `learned_avoid` is 13.4% of vetoes fleet-wide and the
DOMINANT class in hive pools (30.70/bot-h canary vs 5.59 control).

So the next target is the avoid gate itself.

## The defect, source-verified

`admission.mjs:536` `const priorFails = this.lessons?.failCount(skill, args) ?? 0`
`admission.mjs:650` `if (priorFails >= 4) {` -> reason `learned_avoid`
also gated at `:553` (milestone-producing) and `:643` (wooden_pickaxe special case).

**The gate NEVER consults successes.** A repo grep for `winCount|\.worked|wins` in
`bots/src/admission.mjs` returns NOTHING. Positive control, same file: `failCount` /
`priorFails` return five hits at the lines above. And `bots/src/lessons.mjs` exposes NO
win-count accessor at all — `failCount` exists, there is no `winCount` — so the gate
could not consult successes even if it wanted to.

Meanwhile the store DOES record them: `lessons.mjs:595-601` maintains
`this.data.worked[k] = {skill, args, wins}`, and `recordSuccess` refuses to run without
a measured observation (`:588-592` throws a TypeError), so a stored win is evidence-backed
by construction.

`priorFails >= 4` is therefore an **absolute count with no denominator**. A key with
19,231 recorded wins and 4 recent failures is throttled identically to a key with 4
failures and zero wins.

## What it is throttling, measured

64 stores at `/var/lib/mcai/*/lessons-*.json` (pre-reseed backups excluded; hive pools
share one store, named `_pool-hive-<x>`), joined against 24 h of telemetry (880,686
rows, 80 bots, 22,201 distinct (skill,args) keys attempted; 182 of 225 avoid keys appear
in the attempt table). `stores_>=4` is the only column that throttles anything.

    KEY                              stores_>=4  median_fails  max | attempts success%  items/s  stored_wins
    craft:{"item":"stone_pickaxe"}         26         1       91 |       1    0.0%      -        5090
    gather cobblestone count=8             24         3     1864 |     973    3.4%   5.33        1854
    gather oak_log count=1                 19         2     3323 |    4860    7.1%   1.40        7393
    gather stone count=1                   16         3      115 |     292   22.3%   1.82         515
    craft:{"item":"wooden_pickaxe"}        14         3       24 |       0     n/a      -        2459
    gather dirt count=1                    12         3     4037 |    1641   65.4%   1.24       19231
    gather oak_log count=8                 11         4       10 |     557   16.9%   7.06        1246
    gather dirt count=8                    10         4     2561 |     633   44.2%   4.81        5787
    goto {x:355,y:73,z:147}                10         4       93 |    2076   66.1%   0.01       79364
    gather iron_ore count=1                10         3       32 |    1268    0.3%   2.25         526

Note what the gate gets RIGHT: `iron_ore` at 0.3% and `smelt raw_iron` at 0.0% deserve
throttling. The problem is the ones it gets wrong, and they are the fleet's economy:
`gather dirt count=1` at **65.4% success with 19,231 stored wins**, `goto {355,73,147}`
at **66.1% with 79,364 wins**, `craft stone_pickaxe` with **5,090 wins** and the
MOST-throttled key on the fleet.

**median_fails is 1-4, not thousands.** I first reported max_fails (up to 4,037) as if it
were representative; it is one pathological store. The decrement mechanism works — a
success does `fails--` (`lessons.mjs:640`) and deletes at <=0 — so counters hover AT the
threshold rather than running away. That is the actual problem: the system sits exactly
on its decision boundary, so these keys flicker in and out of throttle continuously.

## It is a throttle, not a block — and possibly self-reinforcing

`admission.mjs:675-689`: every 5th proposal passes (`n % 5 == 0`) and after
`MAX_VETO_STREAK = 4` consecutive learned_avoid vetoes the next proposal passes
regardless. So it is an ~80% throttle. That is why `gather dirt count=1` still shows
1,641 attempts.

**Hypothesis to destroy:** the throttle cuts the attempt rate ~5x, which slows the
accumulation of the successes needed to decrement the rule (each success is only -1),
so a wrongly-throttled key clears itself 5x more slowly than it was condemned. If true
this is a mild trap of exactly the shape CLAUDE.md warns about.

## Candidate change (do NOT assume it is right)

Give the gate a denominator: gate on `fails >= 4 AND fails > wins` — or on a rate,
`fails / (fails + wins) > r` for some r — instead of `fails >= 4` alone. Requires a
`winCount(skill, args)` accessor on the lessons class. Extract the decision into an
exported pure function so it is behaviour-testable, per CLAUDE.md.

## What I want from you

1. **Destroy the central claim.** Is the gate genuinely blind to successes? Find any
   path by which a stored win reaches the admission decision that I missed.
2. **Is the ratio the right fix?** A key with 19,231 wins and 4 failures passes under
   `fails > wins` forever, even if the world has genuinely changed and it now always
   fails. What is the failure mode of a ratio gate, and is a windowed/recency form
   better? Note DECAY_MS = 6 h and MAX_AVOID = 40 (`lessons.mjs:25,29`), and that 8 of
   64 stores hold >= 40 rules with one at 52 — the cap appears not to apply on load.
3. **Is the self-reinforcement hypothesis real?** Check it against the code, not the story.
4. **Is `stored_wins` trustworthy as a denominator?** `recordSuccess` throws without a
   measured observation, and `cognitive.mjs:781` routes `unknown` outcomes to
   `noteFailure`. So a success with nothing measurable behind it counts as a FAILURE and
   never as a win. Does that make the denominator systematically too small, and by how
   much can you bound it from the code?
5. **What would make you say do not build this?** And is there a cheaper change with the
   same effect — e.g. raising the threshold, changing the 1-in-5 valve, or shortening
   DECAY_MS — that does not require a new accessor?

RULES: every negative claim carries a positive control. file:line for everything.
Distinguish measured / source-verified / inferred. Rank by what a wrong decision costs.
End with ONE sentence naming the single most valuable thing to do first.
