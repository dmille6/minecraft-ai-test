# blindstep-01 REVERTED at +90 on a real fall, and the defect is not the one the revert implies (24 Sep 18:30 UTC)

Read-only. **The revert is correct.** But the change is not careless, and "check the reverse too" is already done, so
the fix that matters is somewhere else.

```
VERDICT REVERT (+90) :: control emission rates for licensing rows over 341.3 control bot-h:
  explore_blind_step_reverse=0.000/bh
  | change row inside a death window, discriminating: ('hive-b-Echo', '17:07:44', 'explore_blind_step_reverse')
```

Linkage is sound: control emitted **zero** reverse rows over 341 control bot-hours, so the row discriminates and the
v19 requirement holds.

## The death

```
17:07:36  blind_step: drop of 8 ahead (limit 3) at 564,101,278: the fallback walk is refused
17:07:36  blind_step: no floor within 12 ahead at 563,101,280     (x4 more, all y=101)
17:07:41  blind_step: no floor within 12 ahead at 565,101,264     (x5 more, all y=101)
17:07:44  death:fall x1 at 566,66,272 (after a 37-block fall)
17:07:44  fell from a high place after falling 37 blocks; idle at the moment of death
```

The bot was on high ground at **y=101** with every forward candidate refused for having no floor within twelve blocks.
That is precisely the state the change was built for. The reverse fired, and seconds later the bot was dead at y=66,
three blocks away in x and six in z. **It fell essentially where it stood.**

## What the code actually does, which changes the diagnosis

`harness-canary/src/skills.mjs:3575-3590`. The reverse candidate is last in the list, and before it can be taken it
passes **both** shared guards:

```js
const v = stepLineSafe(..., bot.entity.position, cand)
if (!v.safe) { ...refused...; continue }
const ds = lineHitsDeathSite(bot.deathSitesNow?.() ?? [], bot.entity.position, cand)
if (ds) { ...refused...; continue }
if (candName === 'reverse') { logEvent({ kind: 'explore_blind_step_reverse', ... }) }
ang = cand; stepOk = true; break
```

The source comment states the intent plainly and the code matches it: *"it is checked by the SAME guard and the SAME
death-site list as the others: `just walked it` is a reason to try it first among the refusals, not a reason to trust
it."* So the reverse was **judged safe by the same floor and drop test that had just refused all four forward legs**,
and the bot still fell. The obvious fix is already implemented; the death happened anyway.

## Hypothesis, offered as a hypothesis

`stepLineSafe` checks a **line**. The walk that follows is `look(ang)` then `forward` held for **1200 ms** and then
cleared. On a narrow feature at height those are not the same thing: a one-block ridge is safe along its centre line
and lethal one block either side, and a 1.2-second held-forward on uneven ground does not track a line. Every
refusal in this episode says "no floor within 12" in five different directions, which is the signature of a narrow
perch surrounded by void, and it is the terrain where a line-check most overstates what a blind walk will do.

I cannot settle this from the rows: they carry the refusal reasons and the death, but not the per-tick positions
between the reverse and the fall. **The instrument needed is a position sample at the end of the blind walk**, which
would separate "the line was wrong" from "the bot did not follow the line". That is the same gap the falls work hit
in September, where the conclusion was to snapshot the descent onset before designing anything.

## Two things that should temper the revert

1. **Exposure was 5 of a required 30.** Reverse fired five times total across three bots (hive-c-Echo 3, hive-b-Echo
   1, hive-c-Comet 1). On the exposure interlock this canary was heading for INCONCLUSIVE regardless; the death
   arrived first. One death against five firings is a rate nobody should quote.
2. **This failure class predates the change.** `EXPLORE WALKS OFF LEDGES (blind walk after a refusal)` is already a
   recorded fleet mechanism, and the same shape reverted a lava canary in September when a guard's refusal fed a
   blind fallback walk. The change did not invent the blind walk; it added one more occasion to take it.

## What I would put to whoever re-runs this

Do not simply add a check to the reverse leg -- it has one. Either bound the walk to what was verified (step the
verified distance rather than holding forward for a fixed 1200 ms), or verify the **corridor** rather than the line
before any blind walk at height. And snapshot the position at the end of the blind step first, so the next canary can
tell those two apart instead of arguing about them.
