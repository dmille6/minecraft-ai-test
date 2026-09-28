# needsdrop-01 refuted its own premise in 90 minutes

2026-09-21. Canary `b72781e` on hive-b, hive-c, hive-d, board-c (4 pools / 20 bots),
declared 07:24:19Z. This is written at +90 min, before the verdict, because the
mechanism result is already decisive and waiting would not change it.

## What was built

`withTimeout`'s `needsDrop` installs `watchDigging`, a 1 Hz poller that calls
`pathfinder.stop()` + `stopDigging()` whenever the HELD item cannot harvest the
**bot-global** `bot.targetDigBlock`. It defaulted to TRUE. A brace-matched census of
cfc1c58 found **15 sites armed by that default, 13 of which were not digging for a
drop** — 11 `pathfinder.goto` and 2 `placeBlock` — against 2 that were. The change
made the default FALSE and had those 2 opt in.

The census was **correct**. The inference drawn from it was not.

## What the fleet said

**PRIMARY (registered): abort share of gather runs, ratio-DiD −2%.** Registered
expectation was −54%; KEEP needed ≤ −25%. Readable (534 canary gather runs post
against a 200 floor).

**MECHANISM: watchDigging cancels per bot-hour, ratio-DiD +2%.**

| caller | canary /bot-h | control /bot-h | ratio-DiD |
|---|---|---|---:|
| watchDigging (`skills.mjs:169`) | 0.74 → 0.46 | 0.49 → 0.30 | **+2%** |
| all collisions | 1.70 → 1.56 | 0.69 → 0.37 | +70% |

Disarming thirteen sites produced **no** reduction in the cancellations they were
supposed to be causing.

## The test that settles it

For every watchDigging cancel, which skill was the bot running?

| arm | era | n | skill |
|---|---|---:|---|
| CANARY | pre | 2 | gather 2 |
| CANARY | post | 13 | **gather 13** |
| control | pre | 5 | gather 5 |
| control | post | 17 | **gather 17** |

**37 of 37 — every one, both arms, both eras — under `gather`.** Zero under any of
the thirteen disarmed sites.

So those sites were armed, and were never firing. The entire population of
watchDigging cancellations comes from the two sites that still opt in: gather's
target dig at `:1195` and collectBlock at `:1672`. The change could not have moved
the endpoint, and −2% is the honest answer.

## Ruling out the alternative explanation first

A null result on a canary is indistinguishable from an inert canary, and this
project has shipped one (owner-01 ran 97 minutes as the baseline with its flag
unset and every other check green). So inertness was ruled out at the source level
rather than from the version string:

```
/srv/mcbots/harness-canary/src/skills.mjs :199   needsDrop = false   2 opt-ins
/srv/mcbots/harness/src/skills.mjs        :199   needsDrop = true    0 opt-ins
trees differ by 70 lines
hive-b, hive-c, hive-d, board-c -> harness-canary
board-a, placebo-c              -> harness
```

The code is live and doing exactly what it says. The premise was wrong, not the
deploy.

## What this actually points at, and it was in the review

Codex pass 1 said it and I under-weighted it:

> the equip ALREADY EXISTS three lines above the watched dig at 1191-1192 and
> returns only harvesting tools, so a collision there proves the equip failed or
> was undone.

`bestTool` skips any item the block cannot be harvested with, so it returns a
harvesting tool or `null`. The equip at `:1191-1192` is
`if (tool) await bot.equip(tool, 'hand').catch(() => {})` — **a swallowed failure**.
Three lines later the dig is watched, and 682 of 682 recorded cancels had a
harvesting pickaxe in the bot's inventory while the hand held dirt 67.9% of the
time and nothing 19.8%.

**The bug is the silently-failing equip, not which sites arm the watchdog.** That is
a smaller, better-targeted change with a much larger share of the population behind
it, and its first step is to stop swallowing the error so the failure has a name.

## What I got wrong, in order

1. **"13 of 15 dig collisions are watchDigging (87%)"** — true of a 15-row sample,
   false of the 1,258-row population, where it is 54.2%. Corrected before deploy,
   by the review rather than by me.
2. **The first census said 16 sites** and blamed `openFurnace` and four `placeBlock`
   sites; three of those already opted out. A 3-line window had truncated
   multi-line option objects. Corrected before deploy.
3. **The premise itself** — that the armed sites were producing the cancels — was
   never tested before building. It is a one-query test (which skill is running
   when the cancel fires) and it takes about a minute. I ran it *after* deploying.

The third is the one that matters. The first two were caught by review; this one
could have been caught by measurement, and the measurement was cheap.

## Harm

2 canary deaths in 28.1 bot-h (0.071/bot-h) against 1 control in 84.3 (0.012) —
a 6.0x rate ratio, but the exact Poisson split test gives **p = 0.156** on 2 of 3
deaths falling on 25% of the exposure. **The gate does not trip.** All three deaths
are drownings with an identical signature — `drowning_route … scoop=no`,
`water_no_air_route_ended: head started SUBMERGED, ended SUBMERGED, dAir 0` —
including the control one, so they are the known mechanism and not attributable to
this change.

Two defects in my own read script were found by this read and fixed:
- it printed **"ratio 0.00x"** for 2 canary deaths against 0 control, because it
  divided by a zero control rate and fell back to 0. The most extreme input read as
  the safest possible number. It now reports the ratio as unbounded and decides on
  an exact Poisson split test.
- it dropped the isolated pools from **both** arms, which removed a real control
  drowning (isolated-d-Comet, 08:29:23Z) and turned "2 vs 1" into "2 vs 0", biasing
  the gate toward tripping. Harm now counts them; productivity still does not.
