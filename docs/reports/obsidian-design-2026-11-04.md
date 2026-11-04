# obsidian-01: 4 obsidian for the enchanting table (design + Paper proof + first piece, 2026-11-04)

**Owner 11-04 (enchantshop E2):** "obsidian on showcase only for now" -- tier 3 (bucket.mjs and the deep miner are protected scope),
Paper sandbox proof first, two engines. Ledger `enchantshop-1104` (the workshop's table needs 2 diamonds, 4 obsidian, 1 book).

**Status.** The proof is done (section 2). The first piece, **bucketfix-01**, is BUILT for the fleet lane (branch `bucketfix-01` @
`88c981a1` on the live fleet `3a7badea`, pushed; registration and a draft queue entry in this folder; NOT queued). The obsidian job itself
(obsidian-01 proper) is designed, not built: it needs the lane decision in section 6.

## 1. Measured (showcase, 11-04)

- Town diamonds 18 (the workshop's fitter keeps 3); every bot holds one empty bucket; obsidian 0 anywhere.
- A region copy round home (+-112, y -64..98, 11-04 18:45Z): **no lava and no obsidian above y 56**; **lava 16,375 cells, all at y -64..-55**
  (lava lakes; nearest -37,-62,-40); **natural obsidian 78 blocks, all at y -55** (where lava aquifers met water; the nearest two, 78,-55,69
  and 56,-55,89, are inside the trial chambers' protected zone -- Codex). Lava was in 76 of 125,879 bot affordance scans in 7 days.
- The town stair bottoms at y 16; the deep miner (deepmine.mjs) runs diamond trips to feet y -53, "a block of floor over the lava level",
  and its header names "water buckets on lava and obsidian for the enchanting table -- deepminer-02" as not in its slice.

## 2. Paper proof (sandbox3, 11-04, [`sandbox/enchant/obsidian-proof.cjs`](../../sandbox/enchant/obsidian-proof.cjs); the bot's own bucket.mjs)

| Step | Result |
|---|---|
| bucket.mjs pourLiquid / scoopLiquid as they are | **throw `point.minus is not a function`**: the aims are plain {x,y,z}, mineflayer 4.37 lookAt needs a Vec3. Every pour and scoop in the bot code fails today (0 live rows) |
| O6 contained cast: a lava source 1 below a 1x1 hole in a stone floor, water poured into the hole | **obsidian**; the water stays in the hole (no spread); **scooped back** (bucket refilled) |
| O6 dig with a diamond pickaxe | **75 s** (mineflayer digTime 75,000 ms; done; block gone); the drop rests 2 below the floor and was picked up only when the bot stepped into the hole (feet ended 1 below the floor: it must climb out) |
| O1 water poured above a lava source on an OPEN floor | obsidian, but the water spread over the floor, turned another lava source to obsidian and flowing lava to cobblestone, and could not be scooped back ("flowing") |
| E1 the workshop's ring: 15 bookshelves placed by the bot on the 5x5 ring less its front middle, the 3x3 between air | **offers [4, 10, 30] / [8, 13, 30]: level 30** |
| E2 a torch in the gap before 5 shelves | offers [5, 5, 24] / [5, 11, 24]: the gap rule holds |
| The same O6 with the FIXED bucket.mjs (bucketfix-01, no wrapper) | pour and scoop work on Paper |

## 3. The design (Claude)

The obsidian comes from a **contained cast**, proven above, never from opening natural obsidian (it caps lava lakes: "already obsidian" is
not "safe to break" -- Codex), and never from lava carried to town (lava scooping stays refused; a carried lava bucket is new risk).
A deep-miner trip with the town's request open (`_enchantshop_gate fit=table short=obsidian:n`) and a diamond pickaxe in the bag:
at its working depth (feet -53) it looks for an **isolated** lava source -- a source whose four sides and floor are solid, under a cell
the miner can open as a 1x1 hole with solid sides, from a dry grounded stand beside it, off every protected zone. It pours water into
the hole (bucket.mjs, fixed), checks obsidian and that nothing else turned, scoops the water back BEFORE digging, digs the obsidian from
the stand (75 s: one dig per call, started only with the call's budget for it), steps into the 1-deep hole for the drop and steps out
(the cast cell's floor is solid by the isolation rule, so the hole is 2 deep only over the cast cell: it seals or fills it after). Four
casts. The trip banks the obsidian with its diamonds; the workshop's fitter crafts the table when the book exists.

## 4. Codex's independent design ([`obsidian-2026-11-04/codex-design.md`](obsidian-2026-11-04/codex-design.md)) and the reconciliation

| Point | Codex | Claude | Taken |
|---|---|---|---|
| Source | natural obsidian off protected zones if a safe target exists, else contained casts at depth | contained casts only | **casts first**: every natural block measured lies on a lava lake's surface; a tier-1 read-only survey of the 78 against zones and backing comes first and may add natural targets |
| Lava to town | defer | no | agreed |
| Safety | probe-refusals kept; a narrow cast operation; water recovered before the dig; no general digging beside liquids | the same + the isolation rule | agreed |
| The 75 s dig | one harvest a call, start only with ~125 s left of the 140 s deepMine budget | the same | agreed; Paper must show the margin |
| Composition | an obsidian target in bot.deepTrip (survey -> prepare -> cast -> harvest -> exit -> return -> bank); the board is evidence, a dispatcher rechecks | the same | agreed |
| First piece | the bucket Vec3 fix, tier 3 | the same | **built** (section 5) |
| Showcase only vs protected code | protected code reaches the showcase only through a fleet canary; enable acquisition only in the showcase pool | the same | agreed; owner decision O-L in section 6 |

## 5. Built: bucketfix-01 (fleet, tier 3)

- Branch `bucketfix-01` @ `88c981a1` on fleet `3a7badea`, pushed. `bots/src/bucket.mjs`: `aimPoint` (the aim as a Vec3 by pos.offset);
  `emptyRefusal` compares cells and refuses the feet AND head cells. `bots/src/skills.mjs bucketSkill`: cells from the floored feet; the
  fill detail reads `r.reason`. `bots/test/bucket-aim.test.mjs` (mineflayer's lookAt contract; fractional positions; three anchored
  mutants). No lava policy change.
- Reviews (two engines): **Codex r1 BLOCK 1** and **Claude subagent r1 BLOCK 1**, the same finding: with pours live for the first time,
  the model's `bucket pour` tried the head cell first and the body guard compared a fractional target, so it never fired (a self-flood).
  Fixed in `88c981a1`; **both re-checked APPROVE** ([`codex-bucketfix-review-r1.md`](obsidian-2026-11-04/codex-bucketfix-review-r1.md),
  [`claude-bucketfix-review.md`](obsidian-2026-11-04/claude-bucketfix-review.md)). Search: mineflayer's own lookAt (physics.js) takes a Vec3;
  the bucket module's header already noted that filling is unvalidated across the mineflayer ecosystem.
- Paper: the fixed module poured and scooped on sandbox3 (section 2).
- Registration [`bucketfix-01.88c981a1.json`](obsidian-2026-11-04/bucketfix-01.88c981a1.json) (effect: none_reason, validated) and draft
  entry [`bucketfix-01.entry.draft.json`](obsidian-2026-11-04/bucketfix-01.entry.draft.json). Suite: see the ledger row.

## 6. Pieces and owner decision

| Piece | Tier / lane |
|---|---|
| bucketfix-01 (built) | 3, fleet canary (S lane: water; a defect fix of the model's verb) |
| obsidian-survey (the 78 natural blocks against zones and backing; isolated lava sources at the miner's depth) | 1, read-only |
| obsidian-01 (deepminer-02: the contained cast in the deep trip, request-driven, OBSIDIAN on only in the showcase pool) | 3, Paper e2e first, two engines, fleet canary with it off |

**O-L (owner):** protected code reaches the showcase only through a fleet KEEP (process: "protected code follows the fleet line"). Read
"showcase only" as: the code rides a fleet canary with the job switched off outside the showcase pool (an unexposed fleet KEEP is "goal
unverified"), and the job runs only on the showcase. Or allow a protected delta on the showcase for this one piece?
