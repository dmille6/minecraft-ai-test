# drop5-01 met every registered line and closed with no verdict: a deadline off-by-one plus an unreviewed false linkage (25 Sep 12:10 UTC)

Read-only. **On the evidence it produced, this was a KEEP.** It closed INCONCLUSIVE with the ledger note
`deadline +360 reached without a verdict (containment)`. Two mechanical causes, both cheap to fix, and neither is
about the change.

## Cause 1: `deadline_min` equals the last read minute, so the final read can never run

Registration: `read_minutes: [30, 90, 180, 360]`, `deadline_min: 360`. Deployed 05:44:07, so +360 is 11:44:07.

The loop waits for each read minute inside a 5-minute death-poll loop, and the deadline test is evaluated **inside**
that loop, after the sleep:

```bash
while [ $elapsed -lt $((M * 60)) ]; do
    sleep 300
    ...poll...
    if [ $elapsed -gt $((DEADLINE * 60)) ]; then FINAL=INCONCLUSIVE; break 2; fi   # fires first
done
```

At 11:41 elapsed was 21,442 s and the loop slept again; at 11:46:29 elapsed was ~21,742 s, the deadline test fired,
and it broke out. **The +360 read never ran** -- `ls ~/digest/reads/drop5-01-*` has 30, 90 and 180 for both scripts
and nothing at 360. With a 5-minute poll, `deadline_min == max(read_minutes)` guarantees this.

`blindstep-02` carried the same shape and would have hit the same wall had it not been aborted first.

**Fix:** `deadline_min` must exceed the last read minute by more than the poll interval. A floor of
`max(read_minutes) + 30` would do, or the loop should run a pending final read before honouring the deadline.

## Cause 2: a rung-linked death flag that the change cannot have caused

`+180 :: rung-linked death on a non-ladder change (v14c: report unless the four conditions fail; operator review)`.
v14c correctly declined to auto-revert and referred it to a human. The deadline arrived before the review did.

The flagged death, `hive-d-Comet 08:47:24`, is not this change's doing. Its own rows:

```
08:46:25  _lava_corridor   497,6,258   lava below at 496,14,263 after 41 samples; the leg is refused
08:46:34  _lava_corridor   496,7,258   lava below at 496,14,263 ... refused
08:47:13  _lava_corridor   496,8,258   lava below at 496,14,263 ... refused
08:47:15  _entombed        493,11,258  walled in at y=11
08:47:15  _maroon_climb_refused        will not start a 24-block climb with 0 placeable block(s)
08:47:23  _reflex_low_health 497,14,265  health 6
08:47:24  _death           497,14,265  death:fire -- tried to swim in lava; idle at the moment of death
```

A bot at y=6-14 deep underground, two blocks from lava the guard had already named three times, with **zero placeable
blocks** so the climb refused. **There is no blind-step row, no drop and no fall anywhere in the sequence**, and
drop5-01 changes only the drop bound on blind-step candidates. The canary's own fall counters agree: `falls 0`,
`fall deaths/bot-h 0.0`, cap refusals 0.

The linkage fired on `rung-in-60s-and-no-skill-since=['entombed']` -- and `_entombed` is a **detector row the baseline
emits too**. This is the failure already recorded twice this month: a consequence row is not linkage, and a row the
control also emits cannot attribute a mechanism. Worse, the very next row shows the ladder **refusing** to act, so the
ladder was not the last actor; nothing was.

## What the change actually did, at +180

| line | canary | control | verdict |
|---|---|---|---|
| exposure `(limit 5)` rows | **101** | n/a | floor 60, **met** |
| liveness | 10/10 bots on the canary build, contamination rows **0** | n/a | clean |
| drop-4-to-5 refusals / bot-h | **0.0** | 2.34 | the intended collapse |
| boxed-share DiD | **-0.24** | | should fall, it fell |
| immobile share | 1.3% -> **0.1%** | 3.6% -> 5.7% | DiD **-3.3 pp** |
| items gathered / bot-h | **+27%** | | v15c all within |
| fall deaths / bot-h | **0.0** | 0.0 | the named harm, absent |
| low-health fires / bot-h | **0.0** | 0.027 | better than control |
| total-fall-damage cap refusals | 0 | 0 | control must be 0, it is |

The cap that was added because of `blindstep-01`'s 37-block fall was never needed: not one candidate was refused for
total fall damage, and no canary bot took fall damage at all.

## Recommendation

Re-run it unchanged, with `deadline_min` raised above the last read, and record the lava death as reviewed and NOT
attributable before the next attempt so v14c's referral does not stall a second slot. The measurement that justified
it -- 91.5% of stranding refusals are drops, admission rising 64.8% -> 80.6% between bounds 4 and 5 -- is unaffected
by anything here.
