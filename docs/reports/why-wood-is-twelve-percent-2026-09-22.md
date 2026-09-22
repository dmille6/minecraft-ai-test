# Why wood collection is 12%, and why it should be 38%

**2026-09-22.** The owner asked why log gathering succeeds ~12% of the time when
it obviously should be higher. It should, and it is — on worlds the fleet has not
already eaten.

## The run-level funnel, 24 h, 14,647 log gathers

| outcome | share |
|---|---:|
| refused `no_safe_target` — liquid on a face, or a falling block above | **36.4%** |
| refused `unreachable` — no candidate has an exposed face | **32.1%** |
| succeeded | 11.5% |
| `no_path` — walked and could not get there | 9.5% |
| `nothing_found` — no logs in range at all | 5.5% |
| interrupted / budget | 4.6% |

**68.5% of attempts are refused before the bot takes a step.** Only 9.5% are a
genuine failure to reach something.

And when a run does get past admission it works: **67.6% of banking runs got
everything they asked for**, median 27 s. The median run banks 1 log because the
median run *asks* for 1 — that is a goal-setting fact, not a yield ceiling. I
briefly read it as a yield problem and it is not.

## Cause A, verified: leaves count as solid rock

`oak_leaves.boundingBox` is `'block'`, so `isExposed` sees a trunk inside its own
canopy as having six solid neighbours. Asked of the real predicates on Minecraft's
own generator shapes:

| vanilla oak | logs that are candidates |
|---|---|
| trunk height 4 | **1 of 4** (25%) |
| trunk height 5 | 2 of 5 (40%) |
| trunk height 6 | 3 of 6 (50%) |

**60% of the wood on an ordinary oak in an open field, with no water and no
overhang anywhere near it, reads as "buried — use mine to dig down."** This is not
an edge case. It is every tree.

## But cause A does not explain the rate, and saying so is the point

`gather` refuses `unreachable` only when *every* candidate fails, and `findBlocks`
returns up to 32. Run an intact 8-oak patch through the same predicates:

| slate size | exposed and safe |
|---|---|
| 8 | 5 |
| 16 | 8 |
| 32 | **14** |

In a standing forest the leaf bug hides most of the wood and still leaves 14
usable targets. It cannot produce a 32.1% refusal rate on its own. Something else
is emptying the slate.

## Cause B, and it is the dominant term: the fleet has eaten its own worlds

Two pools were re-seeded onto fresh terrain on 19 September. Identical code. This
was stated as a prediction before the query ran — `unreachable` should be *far*
lower on fresh worlds, because their trees are intact — and it is:

| log-gather outcome | RE-SEEDED (n=1,633) | un-reseeded (n=9,184) |
|---|---:|---:|
| **succeeded** | **38.3%** | **9.3%** |
| `unreachable` | 12.9% | 35.6% |
| `no_safe_target` | 15.7% | 34.8% |
| `no_path` | 19.4% | 10.1% |
| `nothing_found` | 4.3% | 5.7% |

**A 4.1x difference in success on the same code.** Both filter refusals roughly
halve, and `no_path` *rises* — which is the funnel moving forward: more candidates
are admitted, so more runs reach the walk and some fail there instead. That is
what a real improvement looks like in this table, and terrain is producing it
without a line of code changing.

The mechanism that unifies A and B: the fleet has taken every *reachable* basal log
near its homes over three weeks. What is left standing is the leaf-enclosed
remnant — exactly the part cause A makes invisible. Fresh worlds still have their
bottom two logs.

## What this is not

- **Not a clean terrain effect.** The re-seed was a reseed-*plus-reset*: fresh
  town, fresh supplies, cleared lessons and world-facts, world clock reset. Some of
  the 38.3% is a fresh start rather than fresh trees.
- **Not n=12.** It is n=2 pools, and the seed selection filters *for* flat, dry,
  wooded sites (`MAX_WET_FRACTION = 0.05`), which selects for the thing being
  measured.
- **Not permission to stop.** Standing owner constraint: the fix must be code that
  works in any Minecraft world. A policy that only works on pristine terrain is
  still a broken policy, and 38.3% is not good either — a human is near 100%.

The cut that separates terrain from reset is the **radius gradient**: sample terrain
inside the fleet's excavated envelope (≤128 blocks from home) and outside it
(256–512, pregenerated at world build and never visited) *on the same world*, with
the two re-seeded worlds as a negative control that must show no gradient. That is
read-only RCON, no re-seeding, no canary slot.

## What changes as a result

The census moves from second to first. The pre-registered reorder trigger —
terrain explaining ≥50% of between-bot variance plus a radius gradient demotes the
wood work below reliability-program step 4, the deterministic
gather→craft→smelt→mine→deposit worker — is now much closer to firing than it was
this morning.

The two queued wood fixes are still worth having, and this measurement says
*where*: both refusals are inflated on worn terrain, so relaxing them should help
most exactly where the fleet actually lives. `leaf-02` is live and targets cause A;
`shoreline-log` (718426d) targets the `no_safe_target` half. leaf-01 proved they
must ship together — it halved one refusal and the mass moved to the other.
