# townmine-01: a proper town mine (2026-11-09)

Owner, 11-09 ~12:45Z: "i want all of those things done". The ask: a lit, stepped main shaft from town down to diamond level,
with rest landings every 10-15 steps, a chest and a crafting/smelting nook at the bottom, branch tunnels at the iron and diamond
levels, torches throughout, water and lava sealed (never bridged), and bots that mine there instead of digging random holes.
Clear of the protected zones.

| piece | branch | sha | state |
|---|---|---|---|
| showcase | `townmine-01show` on `b9fa002e` (glass-01show) | see the branch tip | ready to stage, NOT released |
| fleet port | `townmine-01-on-bcdba35f` (the live fleet sha) | `46b1e7e2` | registration + draft queue entry on the canary host, NOT queued |

Rollback for both is `TOWNMINE=off`. The showcase piece defaults to `TOWNMINE_POOLS=showcase`; the fleet port defaults to `*`.

## 1. The baseline: why the shared mines are underused

`projectaudit` reported "most attempts fail: 216 of 466 attempt visits succeeded" (board-d, 7 days to 11-08). That figure counts
`_shaft_use` visits: rows with ok=1 against rows with ok=0 (but not why=no_plan), grouped into 20-minute visits.

**Fleet (Elasticsearch, 80 bots):**

| measure | value |
|---|---|
| 7 d, all towns | 4,131 use / 2,957 fail visits. 1,928 of the fail visits began with the old descent's `walk` failure |
| the old path, by day (down rows, 11-02..11-07) | 14-54 % success |
| since stairuse-01 (promoted 11-08 01:26Z; 36.7 h) | **1,454 use / 348 fail visits = 81 %** (board-d 77 %) |
| what still fails (348 visits) | approach 206 (59 %), hop 71, old walk 24, ascent walk 12, egress_hop 11 |
| approach failures | mostly instant (7-226 ms: the no-dig walk to the collar finds no path). The paths project lists `shaft:unreachable` in 10+ towns |
| ascents through the stair | 177 of 4,001 up attempts (4.4 %). 3,824 `no_plan`, from y 0-63, mostly more than 12 blocks from the stair |
| deep miner, iron trips (3 d) | 886 trips found 214 iron (0.24 a trip) |
| deep miner, iron branches (3 d) | 2,030 `stair_cells` + 748 `void`, **all with 0 cells** |
| deep miner, diamond trips (3 d) | 701 trips, 41 stranded, 2,381 ore |

**Showcase (log files, 15 bots, 48 h):**

| measure | value |
|---|---|
| iron gathers | 170 success / 742 failed |
| where those 170 happened | 150 (88 %) more than 24 blocks from the stair; 6 within 8 (the random holes) |
| deep miner since 11-06 | **0 iron in 42 iron trips**. 516 branch attempts at the stub (25,16,-30): 373 `stair_cells` + 136 `void`, 8 cells in all |

Why:

1. **Most of the 52 % was the old descent.** It is fixed by stairuse-01 on the fleet; visits now succeed 81 % of the time. The
   7-day audit window still carries the old rows until about 11-15. The showcase does not have stairuse-01 yet; its restack
   onto the fleet line brings it.
2. **The approach** (the surface walk to the collar) is the largest remaining failure. Its fix is pathsfix-01, which routes the
   collar as a paths destination; it is "ready" in the queue. Not duplicated here.
3. **The deep miner's iron branches never dug.** `deepBranch` started where the bot stood, inside the 16 landing's stub (v=5).
   The bearing "away from the stair" runs along the stub, whose cells are the stair's own, so it returned `stair_cells`. The side
   bearings hit the cave, so they returned `void`. **This is fixed here:** the iron gallery starts at the stub's END FACE.
4. **Nobody comes back up the stair, and ore is mined in random holes.** No permanent tunnels lead back to the stair. **This is
   fixed here** with the galleries, the hall, and the trail back through them.

## 2. Design

Codex and an independent Claude subagent each proposed a design from the same brief. Both converged on these points:

- extend the existing spiral rather than build a second shaft;
- freeze the phase (`stairShape` derives `s0` from the bottom, and `planStair` capped K at the 16 landing);
- bottom at **feet -53** (owner O6; lava lakes start at y ≤ -55);
- the deep part cannot be built inside the 180 s skill cap (down about 85 s and up about 100 s, measured), so only the deep
  miner's trip state machine can work it, and that is **tier 3**;
- the iron branch fix: start outside the stub.

Reconciled:

- **The extension is the same stair record.** The record gains `ext = { Kb, bottom: -53 }`. `planStair` continues the same
  spiral to step Kb and adds **rooms** (`shaftgeom.mjs mineRooms`), so the stair's own egress, keep-out and gather exclusion
  all know the deep part.
- **The stair's own upkeep reads only to `rec.K`** (`firstUndone maxK`): `stairDamaged`, `buildStair` and `deepRepair` never
  walk the town builder 100 steps down. Tested, with a mutant.
- **Rest bays every 12 steps, on the spiral's side cells:** 2 deep and 2 high, with a torch. At g=68 they are at feet
  52/40/28 above the landing and 4/-8/-20/-32/-44 below it. The existing landings at 48/32/16 are rests too, so no two rests are
  more than 12 steps apart below the first. The upper bays are built by the town stair builder's upkeep.
- **The hall:** 5×5×3, off the bottom step, outside the 3×3. A crafting table, a chest and a furnace stand recessed in its far
  wall; the diamond gallery's portal is in the middle of that wall. It has four torches.
- **Galleries (fishbone strip mines):** a 24-cell spine with paired 12-cell branches every 3 spine cells, so 2 rock lie between
  neighbouring branches. The iron gallery runs from the 16 stub's end face; the diamond gallery from the hall. Each cell is
  probed before it is opened, sealed if it meets a liquid, and lit with a torch every 6. A cell in a protected zone or another
  record ends that slot.
- **Lit throughout:** two torches a turn below the landing. The build's finishing pass places any missing torch it can reach.
- **Liquids:** a liquid in a deep step's own cell is **sealed** (a block placed into it, then dug as stone), not a stop.
  Above the 16 landing the town stair keeps its own rule. Water is never bridged.
- **Who builds it:** the deep miner's new **`build` trip** (`deepmine.mjs tripTarget`; one miner per town, owner O13). It runs
  the stair's own `runStairVisit` on the extended plan, then the fixtures and torches. The build has a stall clock: three build
  trips that cut nothing park it for 6 h, so ore trips get the miner back.
- **Who uses it:**
  - **Iron trips** work the iron gallery (coal ore counts too);
  - **diamond trips** walk the finished mine to the hall (no private `mine` staircase) and work its gallery;
  - **every trip** comes back along the trail and the extended stair.
- **Deferred (tier 3, gather/mine/cognitive):** routing *regular* bots' gather and mine into the galleries. The deep miner is
  the town's miner, and its ore reaches town chests (withdraw-from-every-chest), so this route is indirect.
- **Borrowed:** the town's single miner job follows Project Sid's emergent miner role. The hall's kit chest is MineColonies'
  warehouse idea, kept local. See `docs/reports/minecraft-ai-landscape-2026-11-09.md` §1 and §3.

**Owner questions (both engines raised them):**

- **Depth.** Feet -53 (O6) against "y around -58". The constant is `MINE_BOTTOM_FEET`.
- **A second underground slot during construction.** M8 allows two; this piece keeps one (O13).
- **Which descent is the showcase's.** The stepwell's planned `DESCENT` overlaps this one.

## 3. Pictures (the bots' own plan over a region copy of the showcase)

They are drawn by `bots/scripts/townmine-render.mjs` from `planStair` + `townmine.mjs`, over a block dump of the showcase world
(region-file copies, x -12..50, z -70..8).

Legend:

| colour | meaning |
|---|---|
| tan | stair air |
| brown | treads |
| yellow | bays |
| pale yellow | the hall |
| red | torches |
| sienna | fixtures |
| teal | galleries |
| black | cave air and the bots' own old tunnels |
| grey | stone |
| darker grey | deepslate |
| orange, blue | lava, water |
| cyan | diamond ore |
| pink | iron ore |
| gold | other ores |

- [`showcase-sheet.png`](townmine-2026-11-09/showcase-sheet.png) shows everything. From the left: side before, side after, then
  the y=16 level (before | after) over the y=-53 level (before | after).
  - The side views show the existing stair to 16, and the bots' own diagonal staircases below it (the random holes).
  - The "after" side shows the stair continued to -53, with the hall and its gallery at the bottom.
- The single views are `showcase-side-before.png`, `showcase-side-after.png`, `showcase-iron-before.png`,
  `showcase-iron-after.png`, `showcase-hall-before.png` and `showcase-hall-after.png`.
- [`showcase-survey.json`](townmine-2026-11-09/showcase-survey.json) says what the 990 new cells meet in the showcase world:
  - **0** liquid in a cell to be opened, and 0 liquid beside one;
  - 46 cells already cave air;
  - the iron gallery crosses 80 cells of the bots' old tunnels;
  - the diamond gallery's walls hold 4 diamond and 31 other ore.
- Zones: none of the 2,489 mine and gallery cells is inside a protected-zone box, and none is one of the tripwire's 155,229
  baseline cells (`/srv/showcase/trip/zones-baseline.json`).

## 4. Evidence

**Tier 3.** `protected.py` flags `deepmine.mjs` and `skills.mjs` `deep*`.

**Reviews:**

- Design: Codex and a Claude subagent proposed independently.
- Code round 1:
  - The Claude subagent found 3 blockers:
    - a liquid in a room crashed the visit (`w.landing` undefined);
    - the hall's trail back did not reach the route;
    - a build that never progresses starved the ore trips.
  - Codex found 2: the shared room crash, and a fixture's wall cell dug beside a seal that failed.
  - All are fixed, each with a test.
- Round 2: Codex **NO BLOCKERS**; Claude **NO BLOCKERS**. Its two notes (a stalled mine past its retry may complete; a hall
  trip keeps the full way back) were taken.

**Tests:** `bots/test/townmine.test.mjs`, 26 tests.

- The real mineflayer-pathfinder A* walks from the collar to the hall and back for 4 orientations, with no digs.
- A whole build runs on a fake world, with a water pocket and a lava pocket sealed.
- Upkeep bound, phase freeze and gallery start are covered by anchored mutants.
- Also covered: the refusal chain for a stalled build, a dropped bay, and a fixture beside liquid.
- deepmine, town-stair, stair-egress and stair-descent pass, with their anchors updated.

**Paper:** `sandbox/deepmine/deepmine-e2e.mjs` scenes `mine`, `gallery` and `hall`. The whole bot runs, with the 180 s runner
cut, nothing commanded.

- **`mine`** (sandbox5, an arena carved with the town stair to 16):
  - The first trip sited the mine. A build trip then dug the deep stair to -53 in 6 calls of about 140 s: 302 cells, 21
    torches. The steps reached were k79, k95, k111 and k124, then the hall.
  - It placed the crafting table, chest and furnace, and climbed back from -53 to the collar in 90 s.
  - Server truth after `save-all` (region files): every one of the 308 new air cells open (292 air + 16 torches), all 3
    fixtures standing, **breach 0, flowing 0**.
  - The run ended there: the town deposit banked the iron pickaxes, so no diamond trip followed. That is the next scene.
- **`gallery`** (sandbox3, mine refused, an iron trip): the gallery dug spine 23 cells, then branches of 12, 3 and 12 cells.
  Iron ore was found, and no `stair_cells` came up.
- **`hall`** (sandbox5, the mine standing): see the ledger row for the result.

## 5. Effect metric (owner rule 11-06)

- **Primary:** `detail.rate.v1 _deepmine:ore` (ore found by the deep miner per bot-h), increase, minimum 30 % relative.
- **Guardrails:** `items.per_bot_hour.v1`, `_needs_rescue` rate, `_deepmine:end:stranded` rate.
- `effectwatch.py validate`: valid.
- Project-level signals: `_townmine op=complete`, `op=gallery cells=`, `op=fixture`.

## 6. Open

- The showcase restack onto the fleet line (stairuse-01 is missing on the showcase).
- pathsfix-01 for the approach failures.
- Routing regular bots' gather and mine into the galleries (tier 3).
- The owner questions in §2.
