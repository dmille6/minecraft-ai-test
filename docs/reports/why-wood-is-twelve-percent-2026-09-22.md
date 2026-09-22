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

---

# AMENDMENT, same day 05:20Z: the exhaustion mechanism is REFUTED

The report above named the radius gradient as the test that would separate "the
fleet did this" from "these worlds were always like this". It has been run, and it
refutes the mechanism the report proposed.

Measured within bot — each bot's own median position as its centre, its far half of
log gathers against its near half, so every bot-level difference cancels:

| | bots | median far − near | better further out |
|---|---:|---:|---:|
| worn worlds | 49 | **+7.4 pp** | 43 / 49 |
| RE-SEEDED (the negative control) | 10 | **+29.1 pp** | 10 / 10 |

The prediction, written before the query ran, was that worn worlds would show a
positive gradient and the re-seeded worlds — uniformly fresh terrain, two days old,
nothing stripped — would show little or none. **They show four times more.**

A negative control that moves harder than the treatment is not a weak result, it is
a refutation. If local exhaustion produced the gradient, fresh ground could not
have a steeper one.

## What the gradient almost certainly is instead

**Mobility selection.** A bot's "centre" is where it spends most of its time, and a
bot that is stuck spends most of its time in one place generating failures there.
When it does travel, it also gathers. Distance-from-centre and gather success share
a common cause — being able to move — and the within-bot design does *not* remove
it, because the near half is where the immobile runs live. 4 of 80 bots are pinned
≥4 h at any time, and that is enough to produce this.

So the gradient measures mobility, not terrain, and it cannot carry a causal claim
about either.

## What still stands, and what is now unexplained

**Stands:** 68.5% of log gathers are refused before the bot takes a step. 60% of the
wood on a vanilla oak reads as buried, verified against the real predicates. An
intact 8-oak patch still yields 14 usable targets from a 32-slate, so the leaf bug
alone cannot produce the refusal rate. And the re-seed split is real and large:
**38.3% against 9.3% on identical code**, with both filter refusals roughly halving
and `no_path` rising as the funnel moves forward.

**Unexplained:** *why* the fresh worlds are four times better. The re-seed was a
reseed-plus-reset — fresh town, fresh supplies, cleared lessons and world-facts,
world clock reset — and n is two pools on seeds selected for being flat, dry and
wooded. Terrain is one candidate among several and this report can no longer claim
it is the leading one.

## The test that is left

Count the thing itself rather than a proxy for it: **sample the ground and count
exposed basal logs**, near and far, on worn and fresh worlds. That is a property of
the world, not of the bot's behaviour, so mobility cannot confound it. Read-only
RCON on chunks that are already loaded, with the unloaded fraction reported as a
denominator and no chunk generated — because generating terrain the fleet has never
visited would be changing the world to answer a question about it.

Until that runs, the honest statement of the headline is: **log gather is 9.3% on
the fleet's worlds and 38.3% on two fresh ones, on identical code, and the reason is
not established.**

---

# SECOND AMENDMENT, 11:30Z: it is not a wood problem. Two thirds of the attempts never move.

Four wood explanations have now been tested and all four have failed:

| explanation | how it died |
|---|---|
| the fleet stripped the wood near its towns | refuted — its negative control, the fresh worlds, showed a **4x steeper** radius gradient |
| the radius gradient itself | measures mobility, not ground: a stuck bot's centre is where it is stuck |
| fresh worlds simply have more wood | **contradicted by the ground sample** — fresh worlds have *fewer* tree columns near their bots (4.3% vs 7.8%) and five times more water |
| accumulated avoid rules | the gap **survived a fleet-wide store wipe**: 4.0x before, 3.2x after |

## What the ground sample could and could not say

Read-only, 1,120 columns around all 80 bots, zero unloaded, nothing generated or
placed. Tree and water columns are solid. But **exposed basal logs came back n=1
across the whole fleet** — a random column through a canopy hits leaves, because the
trunk is a 1×1 inside a 5×5 crown, so only 12 of 82 tree columns contained a log at
all. That measurement is too sparse to use and no ratio should be quoted from it.

## The measurement that worked

Stratify every log gather by how far the bot actually moved during the run:

| bot moved | FRESH | worn | worn n |
|---|---:|---:|---:|
| **under 1 block** | 4.7% | **0.5%** | **12,686** |
| 1–8 b | 56.6% | 26.3% | 3,055 |
| 8–24 b | 70.1% | 33.3% | 1,699 |
| 24–64 b | 66.0% | 39.2% | 807 |

- **69.5% of worn-world log gathers move less than one block. On fresh worlds, 34.9%.**
- A run that does not move succeeds **0.5%** of the time.
- Reweighting worn worlds to fresh worlds' mobility mix: 9.6% → **19.9%**, taking the
  ratio from 4.4x to **2.1x**.

**Mobility explains about half the split.** The residual 2.1x is real and still open —
within every stratum fresh worlds are roughly twice as good — but the dominant term
is that two thirds of wood-gathering attempts are made by a bot that is not going
anywhere.

## What this means for the queue

The headline number was never a statement about chopping trees. `gather` is asked
18,258 times a day on worn worlds and 12,686 of those calls come from a bot that then
moves less than a block. Admission filters — `leaf-02`, `shoreline-log` — act on the
~30% that *do* travel. Mobility acts on the ~70%.

This is the same finding as the standing `entrapment-dominates` note, arrived at from
the opposite direction: productivity tracks whether a bot is stuck, not what it knows.

The pre-registered reorder trigger was written for terrain and does not fire on its
own terms. The conclusion it was protecting fires anyway: **the wood filters are not
the main lever, and reliability-program step 4 — the deterministic worker — is aimed
at the wrong half too.** What the fleet needs first is bots that go somewhere.

Not retracted, and worth keeping: 60% of an ordinary oak's wood reads as buried, and
37.3% of refusals are a mineshaft rule applied to shoreline trees. Both are real
defects in the 30% that moves, both are already built, and neither is the main event.

---

# THIRD AMENDMENT, 11:45Z: the mobility framing was CIRCULAR. Withdrawn.

"Two thirds of attempts never move" and "two thirds are refused at the candidate
filter" are the same event wearing two names. A run refused at the filter never
walks, so its `distance_moved` is 0 by construction. Cross-tabulated:

| worn worlds | refused at filter | got past filter | succeeded |
|---|---:|---:|---:|
| did not move | **66.5%** | 2.6% | 0.3% |
| moved | 9.9% | 11.3% | 9.3% |

**95.7% of the runs that did not move were filter refusals.** Only **3.0%** of all
runs got past admission and then failed to travel. The previous amendment's headline
is withdrawn: mobility is not an independent cause, it is the filter restated.

## The non-circular version of the same table

| | FRESH | worn |
|---|---:|---:|
| **refused at the candidate filter** | **33.1%** | **76.4%** |
| of the runs that travelled, succeeded | 62.2% | 30.4% |

Two separate facts, and both survive:

1. **The filter refuses 2.3x more often on worn worlds** — 76.4% against 33.1%, same
   code, same predicates. That is a property of what is standing within range.
2. **Among runs that got past it and walked, fresh worlds are still 2x better** —
   62.2% against 30.4%. That residual is not admission and is not explained.

## And the refusals are not "there are no trees"

`nothing_found` is only 5.5% of log gathers. The trees are **found and then
rejected** — 76% of the time on worn worlds. Combined with the ground sample, which
found *more* tree columns near worn-world bots (7.8% vs 4.3%), the picture is that
worn worlds have plenty of wood in range and almost all of it fails the two local
tests: leaves-count-as-rock, and a mineshaft liquid rule.

That is a better case for the two queued fixes than anything before it — they act on
exactly the 76%, and the population they act on is larger on the worlds the fleet
actually lives in. It is *not* a case that they will close the gap, because the 2x
residual among travelling runs is untouched by either.

## Standing after three amendments

- 60% of an ordinary oak's wood reads as buried. **Verified, unchanged.**
- 37.3% of refusals are a liquid rule written for shafts, 0.0% lava. **Verified.**
- The filter refuses 76.4% on worn worlds and 33.1% on fresh. **Measured today.**
- Among travelling runs, fresh is 2x better. **Measured, unexplained.**
- Exhaustion near home, the radius gradient, "fresh worlds have more wood",
  accumulated avoid rules, and the mobility framing: **all dead.**
