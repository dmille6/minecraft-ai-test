# blindstep-01 was deployed unreadable: its registered read script was not on the host (24 Sep 13:10 UTC)

**Fixed, and the canary is readable again.** `~/mcai-analysis/blindread.py` existed; `/tmp/blindread.py`, which is
where the loop actually runs it from, did not. I verified the source compiled, copied it in without overwriting
anything, and ran it against the live canary to confirm it produces its evidence object.

```
13:03:10  ERROR  registered read script(s) missing from /tmp: blindread --
                 nothing copies them in and a reboot empties /tmp.
```

The loop's own message is the correct diagnosis. This is the second ephemeral-location failure in two days: the
telemetry library is read from `/opt`, which every promotion rewrites, and the read scripts are run from `/tmp`,
which nothing populates and a reboot empties. **The canonical copies are in `~/mcai-analysis/`; the loop runs
`/tmp/$s.py`.** Nothing bridges the two, so a registration can name a script that the loop then cannot find, and the
canary is deployed before anyone learns that.

Worth fixing at the loop rather than by hand: before the deploy, for each name in the registration's `reads`, copy
`~/mcai-analysis/$s.py` to `/tmp/$s.py` and refuse if the source is absent. That turns a six-hour surprise into a
declare-time refusal, which is the same shape as the fix wanted for yesterday's missing-safety-read.

## While I was in there: the change is NOT inert, which is the other way this could have been lost

Checked because a canary has shipped inert before with every other signal green:

| check | result |
|---|---|
| canary pools on the canary sha | **20/20 bots on 8168289**; control 60/60 on the baseline |
| reverse code in the canary tree | present, one emit at `harness-canary/src/skills.mjs:3585` |
| reverse code in the baseline tree | **absent**, so the linkage line (control must emit 0) holds structurally |

## The early read, for context rather than judgement

At +30 the new behaviour has fired **0 times against an exposure floor of 30**, and the primary is moving the wrong
way (+0.38 where the read states plainly that a negative number is the change working). Neither means much yet: the
reverse only fires when all four candidate headings are refused, and refusals fell from 8.1 to 2.0 per bot-hour on
the canary in this window, with control falling similarly, so the triggering situation is simply rare right now. If
exposure does not accrue, the honest close is INCONCLUSIVE on the exposure interlock rather than a verdict on the
primary.
