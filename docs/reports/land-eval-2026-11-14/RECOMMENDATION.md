# Land cleanup: keep, restructure or start fresh? Recommendation (2026-11-14)

The owner asked for the present code for filling holes, removing trash pillars and removing dirt that does not belong to
be evaluated by both Claude and Codex before any work starts, to decide whether to keep going or start fresh.

Two evaluators worked alone from the same brief ([QUESTION.md](QUESTION.md)) and the same evidence
([evidence.md](evidence.md)), on the live showcase code (commit 46286e9e3). Their answers:
[claude-eval.md](claude-eval.md), [codex-eval.md](codex-eval.md). This page reconciles them. Lines of code named here are in
`bots/src/` of that commit; the ones marked "checked" were read again for this page.

## The answer

**Both reached the same verdict: restructure around a new core.** Not another round of patches, and not a full rewrite.

- **Replace** the part that decides what ground should exist, what counts as junk, and when a repair is finished.
- **Keep** the part that makes a bot walk to a spot, stand safely, dig and place, and the two features that stop new mess.

## Why, in three points

1. **The code never knows what the ground should be.** It takes "the ground" to be the highest solid block in each column
   (`tidy.mjs:95-110`, checked) and judges holes and bumps against the heights around them. A grass deck over a gap looks
   like level ground, so the largest defect in the town is invisible to it: 26,116 air blocks under the lawn, with fills
   planned in under 2% of those columns. Worse, later repairs are fitted to the deck, so old mess becomes the reference.
2. **"Does not belong" is guessed from material and shape.** The list of "a bot's materials" includes dirt, grass and
   cobblestone (`tidy.mjs:45`, checked), so natural dirt and bot-placed dirt are the same thing to it. The one time ownership
   was taken from the server's block history instead (the 11-10 admin clean), it found 1,027 cells the shape rules had
   missed. Seven rounds of shape-rule fixes since 11-07 still leave 368 pits.
3. **Giving up counts as finished.** A cut a bot fails three times is "given up" and counted as done; a fill deferred twice
   can be waived and counted as done (`tidy.mjs:351-375`, checked); a bot's duty to remove its own temporary block expires
   after five minutes (`takeback.mjs:54`, checked). So a project can read complete while the junk is still there.

The part that does the work is not what is broken: when it is handed a cell it can reach, it places the block. In the
30-hour log window the tidy work placed at least 979 fills.

## Where the two differ, and the call

| Question | Claude | Codex | Call |
|---|---|---|---|
| How to know the ground that should exist | Regenerate the untouched world from its seed and compare | Capture the untouched terrain before any work and keep a record of every intended change | **For a new world, use frame zero.** The camera design already requires a copy of the world before the first bot joins. That copy is the exact natural ground, with no regeneration and no guessing. Regeneration from the seed is needed only for the old showcase |
| How to tell bot-made from natural | Differs from the untouched world and the block history names a bot | The same, and "no history" must mean unknown, never natural | Both. In these worlds there are no human players, so nearly every difference from frame zero is the bots' doing or a natural process (growth, water, grass). The block history says who and when |
| The gap under the lawn | Decide first whether to fill it or remove the deck | Do not assume every cavity should be filled | Agreed, and neither could establish whether the deck is bot-made. The ground ledger (below) answers it before any plan is made |
| What "done" means | The next read of the world's files shows every cell at target | The same; running out of retries never means accepted | Agreed. Unfinished work stays on the books as a debt |
| Size of a job | 8 to 24 cells, with a standing spot proven beforehand | The same, plus the way in, the way out and the removal of temporary blocks | Agreed |
| Pillars and floating junk | Closest to right today; mostly fixable in place | Needs a debt that survives restarts | Fix in place, on the new ownership test and the non-expiring debt |

## The strongest argument against, which both raised

**Speed may be the real limit, not detection.** The bots manage about 1,000 fills in 30 hours. A core that can see the gap
under the lawn raises the work from about 2,400 blocks to about 28,000: roughly a month, and 26,000 blocks of material. A
better list does not by itself make a cleaner town. The log window agrees that the doing is slow: 918 cells deferred
against 979 placed, 540 temporary-stand attempts refused, 579 of 794 grounds turns that changed nothing.

The answer is in the order of work: the target is decided first (removing a deck may be far cheaper than filling under
it), speed is measured on the test courses from the first run, and the standing-spot and visit-time faults are fixed in
the kept code.

## What gets built, in order

| Step | What | Bot code? | Proven by |
|---|---|---|---|
| N1 | **The ground ledger.** A read-only tool on the host: the untouched world, the world now, the block history and the town's build records go in; every column comes out as natural, bot-placed, bot-dug, deck over a gap, or part of a build | No | Course A: it reproduces today's scorecard, agrees with the 1,027 cells of 11-10, and gives nonsense on purpose when fed the wrong seed. Course B: it calls under 1% of untouched land bot-made |
| N2 | **Debts that do not expire.** Every temporary block a bot places, the escape pillars included, is owed until the world shows it gone or it is adopted on purpose | Yes | Course B, twin copies: bot-made blocks left standing per bot-hour, new code against today's |
| N3 | **The planner and the acceptance test.** Sets the target ground, cuts the difference into small jobs with the way in proven on the saved blocks, hands them to the existing worker code in its present record format, and accepts a job only when the world's files show it done | Yes | Course A, twin copies, 24 hours: pits, air under the lawn and stray blocks fall; cells deferred per cell placed drops well under today's 0.94 |
| N4 | **Speed of the kept worker code:** standing spots, visit length, materials in the bag | Yes | Blocks placed per bot-hour on course A |

Retired once N3 works: surface-height detection as the authority, material as proof of ownership, the size caps on holes,
and waivers counted as done. They may stay as hints that propose candidates.

N1 needs no bot code, so it can start before the trunk merge. It is also the tool that answers the open question about
the lawn, and it becomes the hourly mess meter for the land world.

## What this means for the land world

- It must have **frame zero** and **block history from the start**. Rehearsal-0's world has frame zero (its day-0
  snapshot) but no block-history plugin. The plugin is added when that world is switched to land-only at the end of the
  rehearsal; its first 48 hours are covered by comparing against frame zero.
- The old showcase is the harder case: its block history starts 2026-11-07 (checked in the capsule: 523,533 rows from
  11-07 00:06Z), 17 days after the town began. Course A therefore depends on regenerating the untouched world from the
  seed, which the 11-08 boardwalk work did once with 94 to 96% agreement.

## Not established

- Whether the deck over the gap is bot-made, and so whether to fill or remove. N1 answers it.
- Why 234 one-column pits, which the present rules should cover, are on no plan.
- Whether a town can supply 26,000 blocks of fill.
- How much of the 13,952 escape-pillar placements in 30 hours happened inside the town.
- Neither evaluator ran the code; both read it. The separate line-by-line inventory of the land code was still being
  written when this page was made and has not been checked against either evaluation.
