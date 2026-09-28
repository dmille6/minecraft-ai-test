# vetob2-01: the ledger says KEEP, the pre-registered effect rule says INCONCLUSIVE, and the primary metric is 63% channels the change cannot touch (26 Sep 09:30 UTC)

Read-only. **Nothing here disputes the recorded KEEP** -- the read itself states what that KEEP means and does not
mean. It is worth writing down because the ledger entry will outlive the nuance.

## What the recorded KEEP actually certifies

From the read rule, in the registration:

> `verdict.py` puts `primary` in `_ADVISORY` (verdict.py:906), so **THE GATE NEVER TESTS THE EFFECT**: a verdict.py
> KEEP means exposure, linkage and the death gate were clean, nothing more. The effect call is the analyst's and must
> be reported separately.

So: exposure met (1,198 `_veto_feedback` rows against a floor of 500), linkage clean (control 0, 10/10 bots settled,
0 over-cap rows, off-limits table 129-137 chars against a 240 cap), deaths 0 canary against 2 control. All true, all
worth having. None of it is the effect.

## The effect, against its own pre-registered rule

The rule was amended against a **measured null**: 66 same-shape assignments on identical code, pre-deploy.

```
KEEP needs   vetoes_did <= -5.03   (p5 of the null; the null mean is 0.00, sd 3.31)
        AND  repeat_loop_did <= +1.40  OR  cooldown_did <= -2.29   (hive-only stratum range endpoints)
REVERT needs vetoes_did >= +5.17.   Otherwise INCONCLUSIVE.
```

Warm window (minute 30 onward, which the rule designates as deciding because the canary pool was restarted and
control was not):

| component | canary | control | DiD | its threshold | met? |
|---|---|---|---|---|---|
| **all vetoes / bot-h** | 48.93 | 37.54 | **-3.50** | <= -5.03 | **no** |
| repeat_loop | 5.97 | 18.13 | **-8.71** | <= +1.40 | **yes, by a wide margin** |
| cooldown | 7.65 | 7.02 | +1.46 | <= -2.29 | no |
| learned_avoid | 30.70 | 5.59 | +3.41 | (WATCH; null max +4.90) | within null, and flagged |

The rule requires the aggregate **AND** a component. The component passes decisively; the aggregate misses by 1.5
points. **On its own rule this is INCONCLUSIVE, not a validated effect.**

## Why the aggregate could not see it, which is the finding

`learned_avoid` is **30.70 of the canary's 48.93 vetoes per bot-hour -- 63% of the primary metric** -- and the
registration states plainly that *"B2 does not touch it"*. The arithmetic follows:

```
treatment's own channel:      repeat_loop   DiD  -8.71
channels it cannot touch:     cooldown      DiD  +1.46
                              learned_avoid DiD  +3.41
                                            net  +4.87
aggregate                                        -3.50
```

**The change moved its own channel by -8.71 and was denied by +4.87 of movement in channels it does not act on.** The
registration anticipated exactly this and wrote the `learned_avoid` WATCH for it: *"a large learned_avoid DiD is
evidence the aggregate is being driven by something other than the treatment."* That WATCH fired at +3.41, inside the
null range but in the direction that masks the effect.

This is the mirror image of the failure this project usually guards against. The usual danger is an aggregate that
flatters a change. Here the aggregate **hides** one, because the treatment can only reach a third of it.

## What I would put to the operator

1. **Record the effect call separately in the ledger**, or the KEEP will be read as "veto feedback works". On the
   evidence it is: live, safe, exposure met, intended mechanism moved hard, aggregate not established.
2. **The primary should be `repeat_loop`, not all vetoes**, for a change that only acts on repeat proposals -- with
   the aggregate kept as a report line. The null is already measured per component (`repeat_loop` hive-only mean
   +3.01, range +1.40..+4.63), so this needs no new calibration work.
3. **The read rule names +240 as a deciding read and the registration does not schedule one** (`read_minutes` max
   180). The canary was torn down at +180, so the second deciding read could not happen. Worth reconciling before a
   re-run, in the same spirit as drop5-01's deadline invariant.

## Context worth keeping

This change was **built 2026-09-11 and sat undeployed for 15 days**, and it is the agreed successor to three cooldown
canaries that all reverted and established that the WAIT is not the bottleneck -- a shorter cooldown bought +41% model
calls that became vetoed re-proposals of just-failed actions. It is the first change in a week of movement and refusal
work to address the failing endpoint (gather terminal 18.5% against a 40% two-week target). A -8.71/bot-h fall in
repeat-loop vetoes is the most endpoint-relevant number measured this week, and it deserves a rule that can see it.
