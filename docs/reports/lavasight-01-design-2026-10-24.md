# lavasight-01: the per-seed lava map in the route price, never a wall (design r1, 2026-10-24)

Mineshaft safety fix **F5b** (`docs/reports/mineshaft-safety-2026-10-23.md` §7, approved r10; OWNER ANSWERS O3). **OWNER
2026-10-24:** run it right after lavastep-01, and feed it **from the per-seed hazard map from day one**
(`docs/reports/hazardmap-2026-10-24.md` §7, `mcai.hazardmap` v1).

Base: fleet `fb8de72f` (ironsmelt-01, promoted 10-24 08:2xZ: board-a-Alpha's rows carry `run_id ironsmelt-01-promote`,
`code.version fb8de72f`). This is a design for the both-engine review. No bot, host, queue, scheduler, manifest, env or
world was changed; the one host action was a read-only population query (§1).

## 0. Answers first

1. **The map already knows the lava the guards refuse.** Out of sample (rows after the map's own `window.until`,
   10-24 08:46-13:15Z, 80 bots, 285,939 rows walked): of **224 distinct (world, cell)** lava cells named by a guard refusal
   (`_lava_corridor`, `_explore_blind_step_refused` naming lava, `_reflex_danger_block` on lava), **219 (97.8%)** lie within
   1 block of a map cell of that world. By rows, 1,380 of 1,385 (99.6%). **Negative control:** the same map moved 48 east and
   48 south covers **0.0%**. The bot's own refusals in the hour before cover 77.3% of rows.
2. **Why routing is the lever.** The corridor guard (`lavaguard.mjs corridorSafe`, the `path_update` hook) refuses a planned
   leg whose swept footprint has lava within ~2 blocks beside or 3 below. The pathfinder prices none of that: it plans the
   leg, the guard refuses it, and the bot plans it again. 468 corridor refusals in 4.5 h; the mineshaft report found 80 of 84
   lava deaths preceded by such a refusal, and 81 of 84 "idle at death" beside the lava after one. **lavasight makes the
   planner price exactly the footprint the guard refuses**, from a precomputed index, so a detour the guard would accept is
   found first.
3. **A price, never a wall (departure from the r10 text).** r10 specified hard exclusions with three escape hatches (egress
   for the first 6 nodes, a downgrade re-plan on noPath, exemptions). This design uses **a bounded price only**:
   - a plain walk, jump or drop move gains at most 16 per charging of the step hook, and keeps a cost far below the 100 at
     which mineflayer-pathfinder deletes a move. **So memory alone never deletes a walk move, and no goal becomes
     unreachable because of it, by construction** (§3.4, tested over every move type).
   - Egress is a rule too: within 2 blocks of the bot's own feet only the ring price applies, so a bot standing beside lava
     pays at most 4 per charging to step away.
   - The downgrade re-plan and both exemptions disappear: there is nothing to downgrade. That removes the two pieces the
     r10 reviews found hardest (a noPath interceptor inside pathfinder internals, and per-node path depth that the step hook
     cannot see).
   - Prior art agrees: Baritone's `Avoidance` is a precomputed position-hash -> cost-coefficient map, finite, never
     infinite (§8).
4. **Delivery.** A host publisher on 10.0.0.31 (where the bots and the map both live) writes one `lava-map.json` per pool
   directory, as mcbot, atomically, from `~/hazardmap/out/hazardmap.json`. The bot reads it at spawn and on change, **binds
   it to its world by recomputing the login packet's hashedSeed from the file's seed string** (verified on three worlds,
   §2.3), refuses a past-`stale_after` file as void, and **fails open** with a logged state on any missing, stale, foreign
   or malformed file.
5. **Scope.** Lava-like cells route (price). Drowning, cave falls and dripstone **warn only** (a sampled row when a planned
   route passes one; no behaviour change). Bot-built traps (water pits, ceiling traps) and entombment are not delivered:
   they are per world and other arms own them. **Drowning is warn-only by the owner's rule** ("swimming is travel, water is
   terrain"), and the town's own lake would otherwise be priced next to home.
6. **Composition.** The price is off whenever a reflex holds the body (keepout's rule), so lavastep, poolescape, entombed,
   the drowning rescue and the air arms plan exactly as today. It combines with the death-site price by **max, not sum**,
   so no cell costs more than today's death disc already does where both apply. keepout's 101 stays a deliberate deletion.
   protectzone prices breaks and places, not steps: independent. homefix's level-1 relocation never targets the lava
   footprint (its fallback, home, is unchanged).
7. **Tier 3** (routing-wide), as F5b was registered; `drawexposure.py` decides the draw under the 4-pool policy (§7).

## 1. Population (read-only, 10.0.0.31, `scripts/host/lavasight_population.py`)

- **Window:** after the map's `window.until` 2026-10-24T08:46:43Z, to 13:15Z (4.49 h). Live files only (no rotation in the
  window; the script refuses a window that crosses one). 285,939 rows, 80 bots.
- **Refusal rows naming a lava cell:** 1,604 parsed, **0 unparsed**; 1,385 in the judged window.

| kind | rows | map within 0 | within 1 | within 2 | own refusal within 1 in the prior 60 min | distinct (world, cell) | of them within 1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `_lava_corridor` | 468 | 94.2% | 99.4% | 99.6% | 62.4% | 147 | 144 (98.0%) |
| `_explore_blind_step_refused` (lava) | 906 | 95.9% | 99.7% | 99.8% | 84.8% | 126 | 124 (98.4%) |
| `_reflex_danger_block` (feet lava-like) | 11 | 90.9% | 100% | 100% | 90.9% | 9 | 9 |
| **all** | **1,385** | 95.3% | **99.6%** | 99.7% | 77.3% | **224** | **219 (97.8%)** |
| null: map moved (48, 0, 48) | | | **0.0%** | | | | |

- Map cells per world (lava hazards not `absent`; `sightings.cells` + `deaths.cells`): 1,862 for each of the 10 shared-seed
  worlds; 111-623 for the six singletons. All under the 4,096 cap F5b set.
- Judged rows per world: board-d 346, isolated-c 272, isolated-d 197, board-c 137, placebo-d 98, isolated-a 79, hive-a 65,
  isolated-b 45, hive-b 44, board-a 40, board-b 21, hive-c 13, placebo-c 13, hive-d 11, placebo-a 3, placebo-b 1.
- **What it is not.** Coverage of refused cells is not prevention. Whether a priced route is found, and whether the guard
  then accepts it, is Paper's and the canary's question.

## 2. Delivery

### 2.1 The publisher (`scripts/host/lavasight/lavamap_publish.py`, staged; the operator installs)

- Reads `~/hazardmap/out/hazardmap.json`. Refuses an unknown `schema`/`schema_version` and a map past `stale_after`
  (publishes nothing new; the bots' own staleness rule then fails them open at the old file's `stale_after`).
- For each world W in `seeds[s].worlds` whose pool directory `/var/lib/mcai/_pool-W` exists: the per-world view of the
  hazardmap report §7:
  - `cells`: lava hazards whose `exists.by_world[W].state` is not `absent`; `sightings.cells` + `deaths.cells`; deduplicated;
    ranked by the hazard's deaths, then the cell's sighting rows; at most 4,096.
  - `warn`: drowning, cave_fall and dripstone hazards with at least one death, not `absent` in W: `{kind, center, deaths}`,
    ranked by deaths, at most 256.
- Writes `lava-map.json` (§2.2) with a temp file in the same directory, `fsync`, `rename`. Runs as **mcbot** via
  `sudo -n -u mcbot` (the frontier publisher's pattern: the pool dirs are mcbot 0755), never as root, never through a
  symlink, never creates a directory. Skips a world whose output would be byte-identical.
- Cron on .31 at 05:40Z (after the 05:10Z refresh) and hourly at :40 (idempotent: it rewrites only when the map changed).
  Its heartbeat line joins the fleetstatus header like the hazardmap's (`patch_fleetstatus.py`, anchored, revertible).
- Writing a file nobody on the base reads is harmless to the control arm: base builds never open it.

### 2.2 The file (`mcai.lavamap` v1)

```
{ "schema": "mcai.lavamap", "schema_version": 1, "world": "board-a", "seed": "1239381899",
  "generated_at": <the map's>, "stale_after": <the map's>, "published_at": ..., "source": {"map_sha256": ..., "hazards": n},
  "cells": [[x, y, z], ...],                    // <= 4096, lava-like evidence cells
  "warn":  [{"kind": "drowning", "center": [x, y, z], "deaths": n}, ...] }   // <= 256
```

### 2.3 The bot (`bots/src/lavasight.mjs`, pure; wired in index.mjs beside protectzone's reader)

- Read at spawn, then a 60 s `stat` (re-read on mtime change) on a timer, never in the A* step.
- **Binding.** `hashedSeedOf(seedString)` = the first 8 bytes of SHA-256 over the seed as a little-endian int64, as two
  signed int32 `hi:lo`, which is how `worldIdFromLogin` renders the login packet's `hashedSeed`. Checked against live
  `_plinth_mode` rows: 1239381899 -> `-1909043226:-504800724` (board-a), 8948499624371160708 -> `174057850:195548254`
  (placebo-a), 4394143238757369828 -> `-23873500:595148475` (hive-c): 3 of 3 equal. The seed is parsed with BigInt (64-bit
  seeds exceed a JS number; the map keeps seeds as strings for this reason). A mismatch refuses the file
  (`world_mismatch`); an unknown login seed refuses too (a reseeded world must not inherit the old seed's lava).
- **States** (`_lavasight_mode` on spawn and on every change): `ok`, `absent`, `stale` (now > `stale_after`: VOID),
  `world_mismatch`, `bad_schema`, `unreadable`, `off` (`LAVASIGHT=0`). Anything but `ok` = no map cells: **fail open**,
  the bot routes as the base (the own-sighting ring still works, §3.2).
- Overworld only (the protectzone rule).

## 3. Routing

### 3.1 Cells: memory, re-read live

- **Memory** = the file's cells ∪ this bot's own sighting ring (§3.2).
- **Live re-read** every 20 s, with the death-site refresh (a timer, never inside A*), for memory cells within 192 blocks
  horizontally of the bot:
  - loaded and lava-like now (`lavaguard.LAVA_LIKE`, the corridor guard's own set) -> **active**;
  - loaded and not lava-like -> **removed_live** (dropped for this process; a sealed pool or a changed world stops costing
    at once);
  - unloaded -> kept, inactive (the pathfinder cannot plan through an unloaded cell anyway).
- The price index is rebuilt only when the active set changes.

### 3.2 The own-sighting ring

- An in-process ring of 512 cells: the cell named by this bot's own `_lava_corridor` refusal (`v.at`), its blind-step
  refusals (`at`), and its danger-block feet cell when lava-like. That closes the planner/guard loop after a single
  refusal, for lava newer than the map and for the 2.2% the map misses.
- **No shared live write in v1.** F5b r10 wrote sightings to world facts under keepout's lock. With the map covering 97.8%
  of refused cells out of sample, and lava not moving, a same-day shared store would add lock contention on the file
  keepout's fire sites live in, for the residual. Question R1 for the reviewers.

### 3.3 The footprint: what the guard refuses, priced

For an active cell L = (x, y, z), feet cells F:
- **core** (16 per charging):
  - beside: F.y = y and (|dx| <= 2, |dz| <= 2) except the four (±2, ±2) corners. This is exactly the set at which
    `corridorSafe`'s 3x3 sample of `cellLavaSafe` (lava within 1 beside) fails for a sample at F;
  - over: F.y in y+1..y+3 and max(|dx|, |dz|) <= 1 (`cellLavaSafe`'s "lava below" within 3, under the 3x3).
- **ring** (4 per charging): max(|dx|, |dz|) <= 3 and F.y in y-1..y+4, outside the core.
- The hook sees cells, not feet: mineflayer-pathfinder charges `exclusionAreasStep` on a move's feet cell (twice for a
  forward move) and its head cell. A head-cell charge prices a feet cell one lower. That only adds price, beside lava.
- **Egress:** a cell within Chebyshev 2 (xz) and 2 (y) of the bot's own feet at plan time is charged the ring price at most.

### 3.4 The bound, and why nothing is deleted

mineflayer-pathfinder 2.4.5 deletes a candidate move when its running cost exceeds 100 (`if (cost > 100) return`). Its
step hook is charged per cell: forward 3 times (feet twice, head once), jump-up 3, diagonal 4, diagonal jump-up 5, drop and
descend 2-3. A plain walk move costs 1 to 2.42, plus at most 1 per wet charging (`WATER_ENTRY_COST`).

- **Combination:** today's step array is `[waterEntryPenalty, deathSitePenalty, wellPenalty]`, and `deathSitePenalty` is
  `deathSiteStepCost + keepoutStepPenalty`. lavasight changes that one function to
  `max(deathSiteStepCost, lavaPrice) + keepoutStepPenalty`. The well's 1,000 and keepout's 101 stay deliberate deletions,
  untouched.
- **Where no death disc applies:** a plain move gains at most 16 x 5 = 80, so it costs at most 80 + 2.42 + 5 = 87.4 < 100.
  Scaffold placements (`placeCost` 5, index.mjs:486) are inside the bound too: a jump-up that places twice is
  2 + 10 + 3 x 16 = 60; a 1x1 tower step 1 + 5 + 16 = 22. Parkour is off on every profile.
  **No walk, jump, drop or scaffold move is deleted by lavasight.** A move that DIGS can be: its labour is
  `(1 + 3 x digTime/1000) x digCost`, unbounded by hand. Those are digs within 2 blocks of lava, which the gather
  profile's `dontCreateFlow` and the corridor guard already refuse; G3 counts any deletion anyway.
- **Where a death disc applies** (25 per charging), max() leaves the cell at 25: **identical to the base**.
- Test: every move generator of the installed pathfinder, run on synthetic worlds with and without the price, asserting
  that the set of walk/jump/drop neighbours is identical and only costs differ (§6).

**What the price buys.** A forward step into the core costs 1 + 48 = 49 against 1 for open ground: a detour of up to ~48
blocks per core step is preferred. Crossing the 5-cell core band of a pool edge costs ~240.

### 3.5 Where it applies

- Every profile that shares the step array (walk, gather, the ore tunnel, ascent, descent, the composter and town-deposit
  walks) and the water profile, which carries `deathSitePenalty` too.
- **Off while a reflex holds the body:** `stopReflexes.activeReflex()` non-null and not `eat` (keepout's `scopeHolds` rule,
  reused). A drowning rescue, an entombed escape, the marooned arm and the pocket rung plan as if lavasight did not exist.
  lavastep's danger arm does not use the pathfinder.

### 3.6 Warn-only kinds

On `path_update` success/partial (the corridor hook, after the guard accepted the leg): if any planned node lies within 3
(xz) and 4 (y) of a warn hazard's centre, one `_lavasight_warn` row per 60 s: `kind`, `center`, `deaths`, `node`, `goal`,
`profile`. No price and no refusal.

## 4. Composition

| Component | Effect |
|---|---|
| **lavastep-01** (F1, next canary) | The danger arm moves the body with its own verified moves, not the pathfinder; reflex-held -> no price. lavastep's runner reservation is separate. After lavastep's move, the next skill's plan prices the footprint, so it is less likely to plan back to the edge. |
| **corridor guard** (`_lava_corridor`) | Unchanged; still refuses. It is the positive control: its rate should fall. |
| **death sites** | Combined by max per cell: no cell above today's 25 where a disc applies. |
| **keepout-01** | Separate kind; its 101 route veto and break veto unchanged; never disputes or writes a fire site; no dig rule. `_keepout_exit` is a skill, so its walk is priced, and its outward walk stays legal (§3.4). |
| **protectzone-01** | Break/place price only; lavasight prices steps. Independent. |
| **poolescape-01** | A reflex (marooned arm): no price. Its lava check is live and unchanged. |
| **ceilescape-01** (if it lands first) | A reflex (entombed arm): no price. |
| **homefix (watchdog)** | Level-1 relocation: `forbid` also refuses a target whose feet are within 3 (xz), -1..+3 (y) of an active lava cell, composed with the fire-column forbid by OR. No target -> its existing fallback, home. |
| **entombed** | A reflex: no price. |
| **runner reservation** | Untouched: the price keys on reflex ownership, not the runner. |
| **minewell / well** | The well's 1,000 stays; no change. |
| **F6 deep stair** | Not built. When it is, its cells are exempt (a check in the price function). |

**Refusal chain.** lavasight refuses nothing. A goal near lava stays reachable at a price; the corridor guard still refuses
an unsafe leg as today, and today's chain runs from there.

## 5. Rows

| Row | When | Args (structured) |
|---|---|---|
| `_lavasight_mode` | spawn, every state change | `on`, `state`, `world`, `seed_ok`, `cells`, `warn`, `generated_at`, `stale_after` |
| `_lavasight` | liveness, every 10 min | `state`, `file_cells`, `ring`, `active`, `unloaded`, `removed_live`, `index`, `rebuild_ms`, `priced_calls`, `held_calls` |
| `_lavasight_route` | `path_update` success/partial/noPath, at most 1 per 30 s, plus every noPath | `status`, `profile`, `nodes`, `core_nodes`, `ring_nodes`, `min_d` (nearest active cell), `held` (reflex), `priced` (index non-empty and not held), `goal` |
| `_lavasight_warn` | §3.6 | as there |

Rollback: `LAVASIGHT=0` (no price, no ring, no relocation forbid; the mode row says `off`).

## 6. Tests (behaviour on exported pure functions; anchored unique mutants via `withMutant`)

- `parseLavaMap`: every state; a 64-bit seed string; a number seed refused; `stale_after` past -> stale; cell cap; bad
  cells dropped and named.
- `hashedSeedOf`: the three live pairs of §2.3.
- `footprintPrice`: core/ring/egress tables, cell by cell, against `corridorSafe` itself on synthetic worlds (a sample is
  core-priced iff the guard refuses it for that lava cell).
- **The bound:** the installed pathfinder's move generators over synthetic grids around a lava pool: identical neighbour
  sets with and without the price for walk/jump/drop moves; costs only rise; max per-move gain 80.
- **Routing behaviour:** a real `bot.pathfinder` A* on a synthetic world (mineflayer's `getPathFromTo` with a fake
  `blockAt`): base plans along the pool edge, the candidate plans the detour; with no detour, the candidate still finds the
  edge path (no dead end); a bot standing beside lava gets out.
- **Chains:** the reflex-held scope (price off under `escape`, `marooned`, `drown_rescue`, `flooded_pocket`; on under
  `eat`); a homefix pick with every candidate forbidden falls to home; a stale file -> base routing.
- Mutants: ignore egress; sum instead of max; price while reflex-held; skip the seed binding; accept a stale file;
  invert removed_live; drop the head-cell rule.
- The full `npm test` from bots/ and eslint no-undef.

## 7. Read and registration

- **Correctness gates (defect = REVERT):**
  - G1 licence and coverage: every canary bot's `_lavasight_mode` row exists with `on=1`; in a mapped world `state=ok`
    after the publisher's first write; `_lavasight` liveness coverage >= 0.9 of canary bot-10-min buckets.
  - G2 held: 0 `_lavasight_route` rows with `held=1` and `priced=1` (recomputed from args).
  - G3 bound: the price function never returns more than 16 (or 4 within egress): `_lavasight` liveness carries
    `max_price` per interval, recomputed nowhere else; any value above 16 is a defect. (The step hook cannot see a move's
    running cost, so a deletion is not observable on the fleet; the bound itself is proved by the move-generator test, §6,
    and every canary noPath row carries `priced_calls` for the search, as no-harm evidence.)
  - G4 contamination: 0 `_lavasight_*` rows on control pools; canary rows on the canary build only.
- **Effect (DiD, canary vs control, pre vs post):** `_lava_corridor` + lava blind-step refusals per bot-h (primary);
  danger-block episodes per bot-h; `core_nodes` per route (canary only, descriptive).
- **No-harm:** `path_noPath` and `path_timeout` per bot-h; goto success; gather ok per bot-h; iron per bot-h.
- **Report lines:** deaths by kind (the two-death floor applies; one death is named, not a verdict); deaths at map hazards
  (the canary's and control's deaths within 3 of a map hazard of their world, by kind).
- **Draw exposure:** pools whose worlds logged >= 50 lava refusals in the 24 h before the draw (§1: 13 of 16 worlds pass in
  4.5 h alone).
- Tier from `scripts/drawexposure.py <run> --registrations <tmpdir>` under the 4-pool policy; expected tier 3.

## 8. Prior art (searched 10-24)

- **Baritone `Avoidance`** (`baritone/utils/pathing/Avoidance.java`): a `Long2DoubleOpenHashMap` from block-position hash to
  a cost **coefficient**, built once per path computation around mob spawners and hostile mobs (`mobSpawnerAvoidance*`,
  `mobAvoidance*` settings), applied multiplicatively, never infinite. lavasight's index is the same shape: precomputed per
  refresh, a hash lookup in the hot path, finite.
- **Baritone movement rules:** no walking through fire or on magma, no cornering over lava, no breaking a block touching a
  liquid (FEATURES.md; `MovementHelper.avoidWalkingInto`). They are per-move vetoes on the immediate cells, with no memory.
- **mineflayer-pathfinder** 2.4.5: lava is in `blocksToAvoid` and `exclusionAreasStep/Break/Place` are summed callbacks
  (movements.js:113-140); issue #141 ("Pathfinder doesn't avoid lava") is open. No consumer we found prices lava adjacency.
- **Mindcraft, Voyager, Odyssey:** no lava memory (mineshaft §10).
- **Taken:** the precomputed finite-cost map (Baritone); "never a wall" (this repo's death-site price, 09-16).

## 9. Questions for the reviewers

- **R1.** Map + own ring in v1, no shared same-day world-facts write (§3.2). Agree?
- **R2.** Price-only instead of r10's exclusions + egress + downgrade (§0.3, §3.4). Is the bound argument complete? Which
  move type did I miss?
- **R3.** Prices 16 / 4 and the max() combination with death sites: right shape?
- **R4.** Warn-only for drowning, cave falls, dripstone: worth the rows, or drop them?
- **R5.** The publisher as a separate staged host job vs folding it into `hazardmap.py refresh`.
- **R6.** The read: is `_lava_corridor` per bot-h the right primary, given the planner change also changes how often the
  guard is consulted?
