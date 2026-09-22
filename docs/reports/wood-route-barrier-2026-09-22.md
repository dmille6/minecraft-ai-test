# The fleet is walling itself in with its own excavations

**2026-09-22.** Chasing the residual that neither queued wood fix can touch: among log
gathers that got *past* admission and actually travelled, the two re-seeded worlds are
**65.4% productive** and the other ten are **43.4%**.

## The residual is route, and it is not time and not tools

Conditioned on "the bot got a candidate and walked", so filter refusals are out of the
population by construction:

| | FRESH | worn |
|---|---:|---:|
| productive | 65.4% | 43.4% |
| **`no_path`** | 21.4% | **37.0%** |
| ran out of the collect budget | 2.4% | 5.1% |
| interrupted | 8.9% | 12.5% |
| holding an axe | 60.3% | 51.6% |
| duration, median | 24 s | **18 s** |

Worn runs are *shorter*, so it is not a time budget. The axe gap is 9 pp, too small to
carry a 22 pp difference. Essentially all of it is `no_path`.

## And `no_path` is a real dead end, not a mis-measurement

gather's barren-limit message already carried the discriminating fact:

| `no_path` wood failures | FRESH | worn |
|---|---:|---:|
| A\* reached a candidate | 50.8% | 22.1% |
| **A\* reached none** | 49.2% | **77.9%** |

and what collect said: on worn worlds **48.3%** are
`arrived_out_of_reach: [pathfinder said: NoPath]` against 28.8% on fresh. That is the
full pathfinder with `searchRadius: -1`, not the 600 ms probe. The route genuinely does
not exist.

## What A\* actually cannot cross

Built in the offline harness, five barriers between a bot and a tree:

| barrier | route? |
|---|---|
| dry stone wall, 3 high | **reaches** — A\* digs through |
| wet stone wall with a pond behind | **reaches** |
| flooded trench, 8 deep | **reaches** — swimming works |
| **dry trench, 8 deep** | **no route** |

`dontCreateFlow` refuses nothing here — that hypothesis is dead, and with it the idea
that the shoreline fix might help the route half. The single barrier is a **dry drop
deeper than `maxDropDown = 6`**: the bot will not step down into it and could not climb
out if it did.

One correction on the way: `reachable()` in the harness skipped every move carrying
`toBreak`, which is right for the travel profile and wrong for the gather profile. Before
that was fixed, a plain dry wall read as impassable and I briefly believed it. The
conclusion above is from the fixed harness.

## The ground, measured

Read-only RCON, four radial transects of 14 adjacent columns around every bot, 4,480
columns, **zero unloaded**, nothing generated or placed. A step deeper than 6 between
adjacent columns, with no water in it, is an impassable edge:

| | FRESH | worn |
|---|---:|---:|
| columns read | 560 | 3,920 |
| **dry steps deeper than 6** | 13 | **625** |
| as a share of steps | **2.32%** | **15.94%** |
| wet steps deeper than 6 (passable) | 2 | 14 |

**6.9x**, and every single worn pool shows it — 17 to 72 per 280 columns, against 2 and
11 on the two fresh ones.

## What this means

The chain, end to end, all measured today:

1. **76.4%** of log gathers on worn worlds are refused at the candidate filter (33.1% on
   fresh) — leaves counting as solid rock, and a mineshaft liquid rule.
2. Of the runs that get past and travel, **37.0%** fail on route (21.4% on fresh).
3. **77.9%** of those are a genuine dead end, not a timeout.
4. Worn worlds carry **6.9x** the density of impassable dry drops.

The fleet mines, and mining leaves pits deeper than the profile will step down. Those
pits accumulate, and they are walls. Nothing in the wood code can fix that, and the
standing constraint is that nothing may fill them either — *the fix must be code that
works in any Minecraft world.*

A flooded trench is passable and a dry one is not, which says the direction of the fix is
**crossing**, not avoiding: the bot needs a way down-and-across that it currently lacks.
It can already pillar up (`allow1by1towers`). What it cannot do is get down a 7-block
drop and back out.

Not proposed yet, and deliberately: the obvious move is to let gather bridge with held
blocks, and this project has a standing note that a bridge stranded a bot for 19 hours.
That needs designing against the harness before it needs a canary.
