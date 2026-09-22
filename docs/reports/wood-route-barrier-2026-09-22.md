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

---

# CORRECTION, 12:45Z: the trench result was a scene artifact. The barrier is NOT established.

The route test above concluded that a dry drop deeper than `maxDropDown = 6` is the one
barrier A\* cannot cross. **That was my scene being wrong, not the game.**

That scene pre-filled terrain only down to y = −6, then dug a trench to y = −8 with a
floor at −9. Every cell below −6 outside the trench was therefore never set — **void**,
not diggable ground. A\* cannot tunnel through void, so it had no way around, and the
scene answered a question about my own fill loop.

Rebuilt with ground down to y = −14 and re-run, four barriers × four movement profiles:

| barrier | as deployed (empty-handed) |
|---|---|
| dry trench 8 deep, 2 wide | **reaches** |
| dry trench 8 deep, 6 wide | **reaches** |
| dry pit 12 deep, 3 wide | **reaches** |
| flooded trench | reaches |

`canDig = true` means A\* **digs through or around a pit**. Carrying scaffolding and
raising `maxDropDown` to 12 change nothing, because nothing needed changing.

**So the pit-as-barrier mechanism is withdrawn.** This is the third scene artifact caught
in this harness today — after `reachable()` denying digging to both profiles, and the
`bestHarvestTool` throw that made every scene read `no_path`. The harness is worth having;
every scene in it needs a positive control, and a scene that answers "no route" needs one
most of all.

## What survives the correction

- **The ground difference is real and independently measured**: 15.94% of adjacent-column
  steps on worn worlds are dry drops deeper than 6, against 2.32% on fresh — 6.9x, across
  4,480 columns with zero unloaded, every worn pool showing it. That is a fact about the
  worlds.
- **The route-failure difference is real**: 37.0% vs 21.4% among travelling runs, with
  77.9% of worn failures reporting "A\* reached none" and 48.3% carrying
  `pathfinder said: NoPath` from the full search.
- **What is NOT established is the link between them.** I had a mechanism, tested it, and
  the test killed it. The label "impassable" on those 625 dry steps is withdrawn — they
  are steep, and steepness is measured; impassability is not.

## What to test next, and it is cheap

`NoPath` from a search that may dig is a strange verdict: with `canDig = true` and
`searchRadius: -1`, A\* should nearly always find *something*. Three candidates, in order
of how cheap they are to separate:

1. **The search is bounded somewhere the report did not look** — `collectManually`'s own
   `goto` may carry a tighter radius or timeout than the probe's. Read the call site.
2. **The search space explodes on broken ground** and the result is a timeout reported as
   NoPath rather than as Timeout. Distinguishable in the library's own return.
3. **The bots are genuinely enclosed** — sealed in by terrain in a way a single trench
   scene does not reproduce. Testable by replaying a captured fleet scene rather than a
   synthetic one, which is what `dig-approach.test.mjs` already does for six of them.
