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
  entry [`bucketfix-01.entry.draft.json`](obsidian-2026-11-04/bucketfix-01.entry.draft.json). **Suite w30 at `88c981a1`: 388/393**
  (ceilescape, nothing-important-is-orphaned, protected-paths, well: the base; plinth-skill: a known flake).

## 6. Pieces and owner decision

| Piece | Tier / lane |
|---|---|
| bucketfix-01 (built) | 3, fleet canary (S lane: water; a defect fix of the model's verb) |
| obsidian-survey (the 78 natural blocks against zones and backing; isolated lava sources at the miner's depth) | 1, read-only |
| obsidian-01 (deepminer-02: the contained cast in the deep trip, request-driven, OBSIDIAN on only in the showcase pool) | 3, Paper e2e first, two engines, fleet canary with it off |

**O-L (owner):** protected code reaches the showcase only through a fleet KEEP (process: "protected code follows the fleet line"). Read
"showcase only" as: the code rides a fleet canary with the job switched off outside the showcase pool (an unexposed fleet KEEP is "goal
unverified"), and the job runs only on the showcase. Or allow a protected delta on the showcase for this one piece?

## 7. Revision 11-07: OWNER "Both at once" -- obsidian-01 built for the fleet AND the showcase

**Owner 11-07 ~13:20Z (in chat):** obsidian mining "Both at once": fleet and showcase together (overrides O-L's "showcase only via a
fleet KEEP" for this piece). Goal: obsidian for the enchanting table.

**Measured first (showcase region copy, +-150 of home, 11-07; the census scripts are in the 11-07 memory file):**

| Population at the cast level (lake surface y -55, miner feet -53) | Count |
|---|---|
| top-layer lava sources at -55 | 1,734 |
| ...the section-3 ISOLATED source (four sides + floor solid) | 5 (0.3%) |
| ...with a solid rock hole cell over it and walls (the 11-04 design's site, liquid sides sealable) | **6** in 90,000 m2 |
| ...under open cave air (a lake in a cave) | 998 |
| ...with a dry shore a stand two above it can use AND rock behind the shore for a basin | **237 lake cells, 48 distinct 16x16 areas** |
| natural obsidian at -55 (where lava met water) | 78; with a solid floor and no liquid side 14, all under water |
| water sources -55..-31 (aquifers) | ~4,300, mostly infinite |
| fleet 48 h (80 bots): diamond trips started / banked home | 439 / 405; work rows at y -60..-50: 585; bucket rows 3,261, all `failed` (point.minus) |

So section 3's isolated in-place cast has no population. **The cast is made in a basin the miner digs itself** (the 11-04 O6 proof's
geometry, but with the lava brought to it): the tunnel at feet f = -53 toward the lake (bearing d), cells P3 P2 P1 S; the lake source Lq
two below the cave cell C ahead of S; the basin H under P2 and W under P3 (f-1), in rock the miner has read (every wall and floor full,
dry, natural). ONE bucket in turn: (1) water into W from P1 (two out: the ray crosses the open H) -> a contained source; (2) the empty
bucket takes ONE lava source from the lake from S (two below, one ahead: the lake refills it with flowing lava, nothing rises);
(3) the lava into H from P1 (one out: every aim hits H's floor) -> obsidian the instant it lands beside W's water (no open lava stands);
(4) W's water back; (5) H dug with the diamond pickaxe (75 s with mineflayer's digTime); (6) the drop picked up by stepping into H and
out. Repeat to the town's need (4, the table), then H and W are filled with blocks. The first water: an INFINITE source (>= 2 source
neighbours: the fill takes nothing) within 40 of the stair top before the descent, else a water lake at depth by the same cave-edge
geometry. Everything is read back after each step: loose lava is sealed at once; lava still open at the feet's level after its seals
turns the trip home at once (and that call ends there); a lava bucket never outlives the cast (back into the lake from S).

**The refusal chain (each a different job, never a wait):** OBSIDIAN off / an iron trip / the town index unreadable / the town (+bag)
holds 4 / no diamond pickaxe with 8 uses (the bank phase makes one from 3 diamonds) / no bucket / under 8 seal blocks -> an ordinary
diamond trip; at depth: not at feet -53 after 3 deepen tries, no site in +-24 after 3 looks, 3 failed steps, 8 casts -> the cast is off
and the ore and branches go on.

**Codex's 11-04 points kept:** contained casts, no lava to town, water recovered before the dig, one harvest a call (the dig starts
only with 95 s of the call's 140 s left), the deep trip's lease, trail, credit, reserves and return limits reused, the board is not a
command channel (the need is the town index's count). **Changed from 11-04:** lava IS scooped (one source, by the cast only; owner
11-01 allows buckets on lava; the model's `bucket` verb still refuses lava); the job runs on BOTH lines (owner 11-07).

Built: section 8.

## 8. Built 11-07 (both lines; NOT queued, NOT staged)

| Line | Branch @ sha | Base | Contents |
|---|---|---|---|
| fleet | `obsidian-01b` @ `c5a33c08` | live fleet `45defefa` (buildfix-01 promoted 14:00Z) | bucketfix-01 (2 commits, patch identical to 88c981a1) + obsidian-01 + mine's tread probe |
| showcase | `obsidian-01show` @ `5a3f0558` | live release `272288e1` | the same commits, cherry-picked clean (deepMine identical on both lines) |

Earlier builds: `bucketfix-02` @ `ee078a2c` (bucketfix rebuilt on e6a1ea2b, identical patch), `obsidian-01` @ `29a11d69` (on e6a1ea2b, superseded by 01b).

- **Code:** `bots/src/deepmine.mjs` (obsidian section: obsidianWant, obsKit, siteCells, siteWhy, approachLegs, findSites, castNext, castGate,
  looseLava, spillState, spilledWater, waterFill; returnWhy `obsidian`), `bots/src/bucket.mjs` (fillWater, scoopLava, pourInto, castPourRefusal,
  fillRefusal, lavaScoopRefusal; the model's verb unchanged), `bots/src/skills.mjs` (deepObs* executor; the trip-start hook; the work hook;
  the cast trip's deepen to the cast level; `mineTreadProbe` -- lava under the next tread refuses), `bots/src/bankable.mjs` (obsidian in
  DEPOSIT_ALWAYS). Kill switch `OBSIDIAN=off`. Tests `bots/test/obsidian.test.mjs` (30: behaviour over a synthetic deep layer, the refusal
  chain composed, 7 anchored mutants, wiring).
- **Paper (sandbox3, the whole bot, `sandbox/enchant/obsidian-e2e.mjs`):** fleet run 8 -- 3 casts at two sites, **3 obsidian in the town
  chest** (server count), 0 deaths, no lava/water in the site rows, water kept; run 7 -- 2 casts, 2 banked. Showcase run -- 2 casts, 2
  banked, 0 deaths, clean; its second site's approach refused by the branch probe (void), a clean stop. Runs 1-6 found the fixes: the town
  count read a `dirty` chest as unknown; DEEP_OK stopped the deepen at -50; stairWalk arrives within 1; a diagonal lava aim clipped S's wall;
  a cast that stopped sealed its water; a spent lake was not left.
- **Reviews (protected scope, two engines):** Codex r1 BLOCK 3 (lava held forever; lava-back unchecked; failed seals went on) -> r2 BLOCK 1
  (a spill fell through to the ore work) -> r3 APPROVE -> r4 APPROVE (the Paper fixes) -> r5 APPROVE (the probe fix). Claude subagent r1
  APPROVE (5 notes, 3 taken) -> r2 APPROVE -> r3 BLOCK 1 (mine's tread probe read lava as hollow: a 1-2 deep pit over a lake let the bot
  step in; the cast trip deepens exactly there) -> r4 APPROVE. Not taken: Claude's note to aim the lava-back at the shore's face (the ray
  hits the shore's top and lands in S; the reviewer withdrew it).
- **Full suites (suite-run, w30, git context):** fleet c5a33c08 413/417 (lavastep flake; nothing-important-is-orphaned, plinth-skill, well: known
  base); showcase 5a3f0558 459/462 (orphaned bagdiet as on the live release, plinth-skill, well). An earlier run caught evidence-gate (a spill
  return with no failClass) -> fixed in c5a33c08.
- **Tripwire:** OB1/OB2 in main's `docs/reports/shop-01-2026-10-25/shopread.py.txt` (selftest + 3 mutants + the row-shape copy check),
  NOT installed.
- **Fleet:** registration `obsidian-01.c5a33c08.json` (effect: none_reason -- a new instrument) and draft entry `obsidian-01.entry.draft.json`
  here and in `~/mcai-analysis` on the canary host. ONE bundle; it supersedes the queued `bucketfix-01`.
