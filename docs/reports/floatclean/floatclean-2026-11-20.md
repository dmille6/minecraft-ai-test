# floatclean-01show, 2026-11-20: bots clean up the floating blocks other bots left behind

**In one line.** A host survey lists every block a bot placed (proven by CoreProtect) that now floats over air, and every tidy
visitor takes a lap through that list. On a copy of the showcase world, three bots took down **121 of the step well's 150 listed
blocks**, 24 of the 45 west of it and 217 in the town in an hour. There were **0 deaths**, and nothing outside the list was dug.

## Pictures (before / after, the stepwell-render approach)

| | Before | After |
|---|---|---|
| The step well and its pit | [before-stepwell.png](before-stepwell.png) | [after-stepwell.png](after-stepwell.png) |
| The town, home ±40 | [before-town.png](before-town.png) | [after-town.png](after-town.png) |

Magenta marks a listed block that still floats, green one that was taken down, orange one that is now held. The SVGs sit beside
the PNGs. The renderer is `bots/scripts/floatclean-render.mjs`.

## The survey (host side, read-only copies, never on the showcase VM)

Sources: the showcase's nightly backup copy (11-20 04:15Z), pulled from the worlds host to ci2 `~/floatclean/src1120/`. It gives
the region files, `plugins/CoreProtect/database.db` and the pool.

1. `scripts/host/floatclean_cp.py` finds, for each cell, CoreProtect's last second. A cell counts as bot-placed when that second
   holds a placement by a bot's user (`^showcase-[A-Z][a-z]+$`) that was not rolled back.
   - Box ±136 × y 40-120: 630,863 rows, 217,971 cells seen, 45,106 last placed by a bot.
   - **Positive control:** Maple's 11-16 17:35:40Z bridge dirt at -58,70,-74 is found as a placement. The script exits 3 when a
     control is missing.
   - The full rows near the pit show Maple's whole bridge: 17:35:21-17:35:48, with Echo's and Comet's earlier beams.
2. `bots/scripts/floatclean-survey.mjs` keeps only the cells that pass all of these:
   - the block still stands (dirt and grass count as one);
   - it is a bot's walking material;
   - it is perched: air under it, or another such block that is itself perched;
   - it is open to the sky for 24 blocks (no mine or cave cells);
   - it is no record's cell or clear in any of the 36 records (35,386 cells), and not in a town plan plot;
   - it is in no protected zone (the 8 villages and the trial chambers);
   - no liquid touches it, and it holds nothing up.

   The list is ordered by area (the step well's box + 8, then the west, then the town within 128), then beam by beam, each beam top down.

   | | count |
   |---|---|
   | bot's last placement, standing | 43,801 |
   | perched | 14,561 |
   | **listed** | **4,017** (stepwell 150, west 45, town 3,822; 2,366 beams) |
   | held: covered (mine/cave/roof) | 4,132 |
   | held: a record's cell or clear | 3,647 |
   | held: holds something up | 2,444 |
   | held: zone | 219 |
   | held: wet | 18 |

   - Maple's bridge stands -59,70,-74/-75/-76 are listed.
   - The step well's own cut -58,70,-74 is not listed: it is a record cell, so it stays the step well's (stepwell-03's set-aside).
   - Natural overhangs never enter the list, because they have no bot placement row.
   - The bundled list is `bots/src/floatclean/showcase.json`. A newer `floatclean.json` in the pool directory takes precedence,
     so the host can refresh the list without a release.

## The work (bot side)

- **Where it runs.** `skills.mjs floatcleanLap` runs at the head of every tidy visit (keeper or helper), in the same place as the
  boardwalk water lap. It runs at most every 5 min, or again at once after a lap that dug something.
- **What it reuses.** It uses the visit's own clear machinery (`buildrun.mjs runVisit`): a dig stand on the town's walk nodes,
  eye in reach and sight clear, the town walk (no scaffold, no towers, no digging), 3 slots, and the crew splitting the list by beam.
- **New rules.**
  - The list's order is kept (`clearKeepOrder`).
  - No stand on any listed floating block (`clearNoFloor`).
  - Each cell is judged again just before its dig (`floatClearOk`). It must still be listed, perched, unguarded and dry, and must
    hold nothing up.
  - It is never the block under this bot, and the bot never digs while it stands on a floating block. (Codex r1.)
  - It is never a block another player or mob stands on. (Rig run 1: Kite dug the block Juno stood on.)
  - The guard is every guarded record's cells and clears, the bridges and the plan's plots, read strictly. One unreadable record
    means no lap. (Codex r1/r2.)
- **Outcomes.**
  - A cell already gone closes.
  - A held cell gets a row.
  - A cell the lap reached and left standing twice is set aside for 6 h, with a row. It is never waived.
- **Rows.** `_floatclean op=survey` (the list's census), `op=dig` (cell, block, CoreProtect placer, beam, area),
  `op=aside` (why), and `op=pass`.
- **Switch:** `FLOATCLEAN=off`.

## Evidence

- **Offline replay.** `bots/scripts/floatclean-replay.mjs` runs the real `runVisit` over the region copy, with every walk driven by
  the real mineflayer-pathfinder under prismarine-physics. Over 8 laps on the step well's 150 cells: 120 dug, 27 set aside with no
  ground stand, 1 held. Every walk arrived.
- **Paper rig on sandbox3** (lock taken and released, world restored). The world was a copy of the same 11-20 backup; the bots
  were Kite, Juno and Echo; the pool was a copy.

  | | run 1 (40 min, 1dfb108a) | run 2 (20 min, f93629d6) |
  |---|---|---|
  | laps / thrown | 150 / 0 | 39 / 0 |
  | deaths | **0** | **0** |
  | dug: stepwell / west / town | 121 / 24 / 175 | 0 / 0 / 42 |
  | stepwell area, standing | 150 → 29 | 29 (all set aside: no ground stand) |

- **Whole-world diff**, before vs after run 2 (±136, y 40-120): 357 listed cells gone. Of the cells **not on the list, none was
  dug**. The other changes are trees growing (sapling→log 24, leaves 1,136), grass spreading, and **2 cobblestone at 32,65-66,9**.
  Juno left those climbing out of the hole after Kite dug the block under her, and the other-body rule now stops that. A live bot
  also runs takeback.

## Reviews and tests

- **Scope.** `protected.py`: not protected, so one engine. Codex rounds:
  - r1: 2 blockers (digging under the body after a failed walk; the guard missed clears and plots). Fixed.
  - r2: 1 blocker (the plan head is `head.plan`). Fixed.
  - r3: NO BLOCKERS.
  - r4 (structural and try fixes): NO BLOCKERS.
  - r5 (the other-body rule): 1 blocker (a wide mob's middle column was left out). Fixed in r6 with the pure `floorKeys`.
  - r6: NO BLOCKERS.
- **Tests.** `bots/test/floatclean.test.mjs`, 16 tests. They cover the verdict, the survey (a natural overhang is never listed),
  and the composed chain on the real visit loop: a beam over a pit taken top down from the rim, never from the beam; the held
  cells; the middle set aside after two laps; the bot left on the beam digs nothing; another body's block waits. They also check
  the lap's wiring. Every guard has an anchored mutant.
- **Full suite.** Head 1dfb108a on ci3 vs base db59a782 on ci4: 4 new failures, all structural tests of other pieces that met
  floatclean's lines (boardwalk3, shop, keeperstall, plus ledger, which passes alone). They are fixed in 327700ad.
  The failures on both base and head are nothing-important-is-orphaned (`bagdiet.test.mjs` is not on this base), plinth-skill,
  protected-paths and well.
- **Final full suite** at f93629d6 on ci3: **552/555**. The 3 failures are lavastep, nothing-important-is-orphaned and well, and
  all three fail on the base too (ci4, db59a782). The r6 change since is one pure function: floatclean, boardwalk3, keeperstall,
  shop, upkeep and buildrun pass on it.

## Open

- 29 step-well cells hang over the pit's middle, and no ground stand reaches them. They are set aside, retried every 6 h, and
  never waived. A temporary stand or the step well's own descent would reach them.
- Laps whose walks never arrive end on their 100 s deadline (run 2: 26 of 39 laps dug nothing). Each such cell gets a try, and
  two tries set it aside. Sharing set-asides across the crew (as stepwell-03's pool files do) would cut this.
- Older litter (before CoreProtect, 11-07) cannot be proven bot-made and is never listed.
- The mess source is untouched: explorers bridge, and takeback expires after 5 min.
