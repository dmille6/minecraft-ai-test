# monustuck-01: the stuck fleet ziggurats (design, 2026-11-03)

Control-session item "monustuck". Owner 11-03: "design all using both claude and codex, put them in the queue and implement
and deploy where you feel is right". Built on the live fleet sha `53fd28ee`, branch `monustuck-01`.

## 1. Measured (fleet, 11-02 21Z to 11-03 21Z)

Window: 1,979,348 skill rows, 80 bots, 16 pools, 24 h (1,920 bot-h). Full walks per pool with `scripts/lib/telemetry.py`.
World facts come from read-only region copies (`townplan_blockdump.py`, 11-03 21:13Z). Pool state comes from copies of
`/var/lib/mcai/_pool-*`.

Thirteen of the sixteen fleet towns share one seed, with home at 355,73,147. In that seed the ziggurat's east foundation
segment, F-E, is sited over a **bamboo grove**.

| site | stuck | what every visit does | cost |
|---|---|---|---|
| placebo-c monument | 41 h | F-E plinth cells 329,69,104 / 329,69,106 / 330,69,106 hold bamboo. Each is `clear_failed result=sealed why=deep_3+_above`, then `deferred why=sealed`, then `stuck_on_cell`, with 6,018 open cells waiting. 51 deferring visits summed. | The town's only open project. 196 `shop_skip stuck_on_cell` in 24 h: no building at all. |
| hive-a monument | 35 h | 331,68,117 is bamboo, the foot of a stalk running y68..79, its four sides the foundation's own cobblestone. Two clear core cells (326,68,119 and 325,68,118, air, no stand) were **never waived**, with 8,711 open cells waiting. | Tidy and wall still ran, 6 monument visits a day. |
| isolated-a monument | recurring (21:30Z alarm, 3.1 h) | Three bamboo cells and two clear no-stand cells, with 7,199 open cells waiting. 964 `clear_failed sealed` rows on 11-02..03. | One cell holds back 7,199. |
| isolated-c monument | recurring | Two bamboo plinth cells, 1,586 cells waiting. | |
| isolated-d monument | 82 h (cleared 19:45Z) | Same seed. Aborted visits (stuck 6, entombed 3). | |
| board-d monument | 6.7 h (sited 14:15Z) | 67 aborted visits / 64 bot-min. **46 of the 67 end at one spot, 338,71,114**, inside the grove. Each time: `_path_reset stuck` every 3.5 s, `_reflex_stuck` at 35 s, `build_shop aborted stuck (GoalChanged)`, no `_build` row. The cell is F-E 331,69,104 bamboo (`result=unreached` twice). | The visit never reaches the site. |
| placebo-b tidy | 24 h | Not a defect. The monument is the active project and moving (6,529 to 9,106 of 9,309 cells today). The tidy runs only when the monument's 2 slots are full, and its 4 visits were aborted (stuck 2, entombed 1). | It resumes when the monument completes. |
| workshops board-d (70 h), isolated-b (131 h) | **cleared** 11-03 10:30Z | stuckcells-01 promoted. | |

**Positive controls.** The same queries find bamboo `clear` rows: hive-b cleared 70 bamboo cells where a stand existed, and
isolated-a 518. On hive-a and placebo-c, the same visits **waived** clear cells in F-S and F-W, so the waiver itself works.

**Aborted monument visits fleet-wide (24 h): 287, costing 246 bot-min.** By interrupt: stuck 178, entombed 78, stagnation 30.
**No visit was cut by the decision cooldown** (15 s since 11-03 19:24Z), so the brief's cooldown hypothesis is out. Since
11-02 23Z there were 359 aborted build visits, and 103 of them ended at a spot repeated at least 3 times (board-d 46,
placebo-a 24 at 252,75,-144, placebo-b 14).

**Ranking by bot-time lost.** Direct visit time is small: 1,640 bot-min a day across all visits, 1.4% of bot-time. The real
cost is **stalled building**:

1. **The bamboo-sealed foundation.** Four live sites (placebo-c, hive-a, isolated-a, isolated-c) and isolated-d before it.
   It stalls 2,000 to 8,700 open cells per town indefinitely, and placebo-c builds nothing at all.
2. **The wedged dig walk** (board-d). About 64 bot-min a day is wasted, and the project never starts.
3. Everything else is ordering or already fixed.

## 2. Root causes (Claude; Codex agreed independently)

1. **Two correct guards compose into a dead end.** fleetbuild-01 (ZIGBAMBOO) made bamboo diggable. digNamed then finds no
   stand, because the foot's sides are the foundation's own blocks. The sealed-column dig (sealedAbove, then overburdenAbove)
   counts every stalk block as overburden and refuses past OVERBURDEN_MAX = 3 (`deep_3+_above`). The cell is deferred, never
   waived (correctly: its block is foreign), then stuck_on_cell and a 6-h back-off, and the cycle repeats. But vanilla breaks
   a bamboo or sugar cane stalk above any broken block. **One dig at the cell's top clears the stalk**, and that block has
   air beside it on the live copies (hive-a 330,69,117 and 332,69,117; placebo-c 330,70,104).
2. **The waiver's segment-wide veto.** The waiver ran only when every open cell of the segment read clear. One sealed bamboo
   cell held back clear no-stand cells the waiver was built for (hive-a's two core cells, isolated-a's 322,68,95).
3. **The dig walk leaves nothing to learn from.** Since shopwalls-04, a click walk records a pending stand, and the next visit
   bans it. digNamed, which is both the clears' dig and the foreign-cell dig, did not. digStand is deterministic, so every
   visit walked the same way into the same wedge and was cut by the stuck reflex. An aborted visit counts nothing, so the F4
   machinery never saw the cell. Codex added a caveat: "no `_build` row" does not by itself prove a dig walk, since the
   withdrawal comes first. The spot is about 25 blocks from the town chests, on the line to the F-E cell, and the two
   `unreached` rows name that cell, so the dig walk is the best-supported reading. The new `stand_banned` rows name the phase.

## 3. Codex's independent design (codex exec, read-only; summary)

- (a) The same three root causes, cited to the same lines. It added the withdrawal caveat above.
- (b1) **Bamboo-specific clearance** before the generic sealed handling: break the lowest reachable section and re-read the
  column. Also clear a bounded corridor of obstructing stalks toward an inaccessible target. Never raise OVERBURDEN_MAX
  globally, and never relabel bamboo "empty" for walking.
- (b2) **Pending-walk recording and alternate stands for digNamed.** Keep the failures across aborts, and repair access when
  every stand has failed.
- (b3) **Remove the segment-wide veto for individually clear candidates. Never waive the bamboo itself.** Do not make
  stampLiftable "any cell".
- (d) **Paper:** random bamboo offsets, cascade timing, escape from the real trapped spot, subsequent visits.

## 4. Reconciliation

| point | Claude | Codex | shipped (piece 1) |
|---|---|---|---|
| stalk | fell at the cell's top (one dig), then the cell | fell the lowest reachable section, re-read | **Claude's form.** It is the lowest stalk block above the cell, and the live copies show it reachable. The whole run is checked first: no veto, no unread block, no foreign record cell, at most STALK_MAX = 24. A stalk that may not be felled falls back to the old column logic. |
| corridor clearance toward inaccessible stalks | not in piece 1 | yes | **Deferred to piece 2.** The live cells do not need it. It is a new walk-time behaviour. |
| waive the bamboo cell itself | first draft: yes | no | **Codex's.** A waived bamboo foot leaves the L00-E skin over it sealed, so the dead end moves up one layer. Clear cells are waived beside a sealed one. The sealed cell is deferred and counted, never waived. |
| dig bans | pending stand plus `unreached` ban; DIG_BANS_MAX = 2 in DIG_BAN_MS = 2 h, then `no_stand` | pending plus alternates; "access repair" when all fail | **Claude's bound.** The visit stops paying for the wedge (bounded) and hands the cell to the existing remedies: the sealed column (now with stalkFell), the F4 count, stuck_on_cell's back-off, and the waiver. Codex's access repair is piece 2. |
| stampLiftable | unchanged | unchanged (no "any cell") | unchanged |

## 5. Pieces, tiers, placement

- **Piece 1 `monustuck-01`** (built, branch `monustuck-01` on `53fd28ee`). `protected.py --files bots/src/buildrun.mjs
  bots/src/stuckcells.mjs` gives "not protected", so this is **tier 2**. The cascade is vanilla behaviour, and the fleet
  already shows hive-b's 70 bamboo clears working. The rollback is `MONUSTUCK=off`.
  - Codex's view: canary with rollback flags.
  - Claude's view: progress-lane fleet canary, as the brief asks.
  - Exposure: placebo-c and isolated-* are never drawable, so a canary can expose only **hive-a** (bamboo), **board-d**
    (the wedge), and hive-b. With 4 of 11 drawable pools, about 79% of draws include one of the three. If none is drawn, the
    read is "KEEP, goal unverified" and the fleet-wide promotion still reaches placebo-c and isolated-*.
  - Placement: **P lane, after swimcentre-01 (S)**, ahead of bundle-1103a, or in it. It shares no state with stationkeep or
    marks, so it could be a bundle member.
- **Piece 2 `bamboowalk-01`** (design only, tier 3: movement). Avoid the wedge at its source. The proposed mechanism: the
  server applies bamboo's random XZ offset, but minecraft-data calls bamboo a full block and the client physics uses the
  un-offset post. Remedy: treat a bamboo column as an obstacle whose neighbouring cells the pathfinder never stands in
  diagonally against, plus Codex's bounded corridor clearance of obstructing stalks. It must be proven in a Paper sandbox on
  board-d's grove (338,71,114) before any build. Searched mineflayer-pathfinder issues #29, #157 and #223 (bounding box vs
  collision shape, side-of-block sticking): nothing bamboo-specific.
- **goalwatch** (tooling, optional): a project queued behind an active, moving project of the same town (placebo-b's tidy)
  should read WAITING, not STUCK.

## 6. Proof so far

- `bots/test/monustuck.test.mjs`, 12 tests, on the **live hive-a geometry** (`test/fixtures/monustuck-hive-a-1103.json`).
  - The control reproduces `deep 3+ above`. With the rule, the digs are [331,69,117 stalk, 331,68,117]. Once felled, the cell
    has a dig stand and a placement step.
  - Chains on the fake server, each killed by an anchored mutant. The stalk is felled, the foundation completes and the
    waiting layer is built. The clear core cell is waived beside a sealed one, and the sealed cell is never waived. The cut
    dig walk bans its stand, the second walk goes to a different stand, and after DIG_BANS_MAX the visits stop being cut.
    MONUSTUCK=off controls show the live behaviour.
- `stuckcells.test.mjs`: two mutant anchors were re-anchored, and it passes.
- Offline on the region copies (`scripts/stuckcells-offline.mjs --cascade`: the real runVisit, a fake builder, a server
  that breaks a stalk above a broken stalk block), 1 builder, 2 visits:

  | town | MONUSTUCK=off | MONUSTUCK=on |
  |---|---|---|
  | hive-a | 0 placed; `stuck_on_cell` x2 (an earlier 12-visit run gave 12/12 `stuck_on_cell`) | **706 placed**; 52 clears including the stalk; the two core cells **waived** (34 visits); open 8,716 -> 8,010; the next stop is `cell_deferred` (3 new cells in L00-E, counted) |
  | placebo-c | 0 placed; `stuck_on_cell` x2 | **693 placed**; 71 clears; open 6,018 -> 5,325; `cell_deferred` (2 new cells) |

  The walk in this harness is instant, so it measures the stalk rule and the waiver, not the wedge.
- Paper sandbox: none for piece 1. Piece 2 must have one.
- Review: Codex blockers-only, one round: **BLOCKERS: none**. It checked cascade ownership and vetoes, ban keys, the shared
  callers (paths, wall, tidy, shop), and bounded expiry.
