# Drowning is a 104-second pipeline with one strategy — 18 September 2026

Read over the 24 h to 2026-09-18 11:40 UTC. Positive control on every query:
739,000+ rows, 80 bots, 114 distinct event kinds; 27-28 drowning deaths against
20 non-drowning deaths present in the same walk (the drowning count moves
between 27 and 28 as the rolling window advances; both figures appear below and
neither changes a conclusion).

## The number that prompted this

48 deaths / 1,920 bot-h = 0.025/bot-h, which clears both the two-week (<=0.05)
and six-week (<=0.03) program gates. But the composition is unchanged from
weeks ago: **28 drowned (58%)**, 11 lava, 7 falls of 23-42 blocks, 1
suffocation, 1 unknown.

## What discriminates

Every water-ish event kind, ranked by P(drowning death within 180 s | fire):

| kind | fires | bots | P(death) |
|---|---:|---:|---:|
| `_water_no_air_route_ended` | 89 | 32 | **80.9%** |
| `_water_no_air_route` | 91 | 32 | **76.9%** |
| `_drowning_up` | 340 | 61 | 38.8% |
| `_drowning_ceiling_no_air` | 384 | 44 | 26.3% |
| `_drowning_route` | 551 | 61 | 23.2% |
| `_drowning_rescue_yielded` | 291 | 27 | 18.9% |
| `_oxygen_critical_state` | 456 | 62 | 6.1% |
| `_water_surface` | 12,706 | 80 | 0.21% |
| `_water_float` | 13,504 | 80 | **0.03%** |

`_water_float` is the negative control and it works: 13,504 fires, 4 deaths.
The instrument can tell these apart.

## The mechanism

`_drowning_rescue_yielded` reads, verbatim, at the moment it fires:

> `4 ceilings expired here with no air and no harm (health 3.16, moved on) — yielding the body to the escape handlers`

**"no harm" at health 3.16 of 20.** The predicate behind it,
`drownRescueSuppressed` (reflex.mjs:1086), is correct as written —
`if (healthDropped) return false`. The defect is its input.
`drownFailHealth` is reset to the *then-current* health at every ceiling expiry
(reflex.mjs:~1881), so `healthDropped` only ever asks "did health fall since the
last ceiling", never "is this bot nearly dead". A bot can go 20 -> 3 across four
ceilings with every individual step reading "no harm".

Split by absolute health, the suppression's two populations separate cleanly:

| yields at | n | share | P(drowning death <= 180 s) |
|---|---:|---:|---:|
| full health (>= 19.9) | 235 | 80.8% | **1.7%** |
| health < 5 | 23 | 7.9% | **100.0%** (23/23) |

The 235 full-health yields are the mechanism doing exactly the job it was built
for on 2026-09-04 — phantom drowning, full tank, untouched health, correctly
standing down. The 23 low-health yields are the same code applied outside its
designed case, and every single one is followed by a death.

Coverage runs both ways: of 27 drowning deaths, **23 carry a low-health yield**
in the prior 180 s, 4 carry only full-health yields, and **0 carry no yield at
all**.

Not a few chronic bots: the 23 are spread over **20 distinct bots in 11 of the
12 pools**.

## But the yield is a MARKER, not the cause

The tight health band (3.17-4.67, every one of the 23) said this might simply be
the last event of a lost fight, so the episode was timed. Medians over the 27
deaths:

| | median | min | max |
|---|---:|---:|---:|
| episode length | 104 s | 34 | 143 |
| first ceiling -> death | **73 s** | 71 | 107 |
| last full health -> death | 81 s | 10 | 92 |
| yield -> death | 11 s | 8 | 36 |
| ceilings in the episode | **4** (25 of 27) | 0 | 5 |

Un-suppressing the rescue at the yield buys **11 seconds**, and buys them for a
strategy that has already failed four times in the preceding 73. The regularity
is the tell: 25 of 27 deaths run 4 ceilings and 71-74 seconds. This is a
deterministic pipeline, not misfortune.

**The real defect is that there is no second strategy.** `assessAir` returns
`act: 'swim' | 'fallthrough' | 'none'` and nothing else; the rescue path
contains no dig, no place, no bucket. When "route to air" is impossible it
re-runs "route to air" until the bot is dead. The yield hands the body to
"the escape handlers", which then emit

> `_water_no_air_route`: `afloat and unowned — no_air_route (head water, health 4.5)`

— they do not take it either. This is the project's named bug class exactly:
**two individually-correct guards composing into a dead end**, the rescue
standing down for a handler that cannot act on a floating body.

A working remedy already exists and is never reachable from here:
`_goto_float_dig` fires 72 times across 38 bots with **zero** following deaths —
a floating bot *can* dig — but it lives in `goto`'s retry path
(skills.mjs:502) and no drowning code calls it.

## What to build, and how to validate it

1. **A dig-up remedy inside the drowning rescue, armed at the FIRST ceiling**
   (73 s of budget), not at the yield (11 s). `floatDigTargets` / `floatDigOk`
   (digapproach.mjs:475,516) are the proven pieces.
2. **An absolute health floor on `drownRescueSuppressed`** — never suppress
   below a floor regardless of the per-ceiling delta. One line, in a pure
   exported function that already has tests and mutants. It is the smaller,
   safer half and it touches 23 events/24 h without disturbing the 235.

**Do not canary this on deaths.** 27 drowning deaths / 1,920 bot-h = 0.014/bot-h;
a 10-bot 6-hour canary expects **0.84 deaths** and cannot see an effect. The
episode is the measurable thing: `_drowning_ceiling_no_air` runs 0.2/bot-h, so
the same canary sees ~12 ceilings. **Register the endpoint as "ceilings per
drowning episode" or "share of episodes reaching a 4th ceiling"**, which has
real exposure, and keep deaths as a tripwire only.

## Standing caveats honoured

The oxygen readings in these rows (`lowest air -1/20`, `oxygen -1`) are the
known upstream mineflayer defect — `bot.oxygenLevel` written from any nearby
entity's `air_supply`, guarded 2026-09-09, three fixes already failed. Nothing
above rests on an oxygen reading: the discrimination is health, position and
event sequence.
