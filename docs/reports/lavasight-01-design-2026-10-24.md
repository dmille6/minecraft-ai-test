# lavasight-01: the per-seed lava map tells the planner which moves the guard will refuse (design r5, 2026-10-24)

Mineshaft safety fix **F5b** (`docs/reports/mineshaft-safety-2026-10-23.md` §7, approved r10; OWNER ANSWERS O3). **OWNER
2026-10-24:** run it right after lavastep-01, and feed it **from the per-seed hazard map from day one**
(`docs/reports/hazardmap-2026-10-24.md` §7, `mcai.hazardmap` v1).

Base: fleet `fb8de72f` (ironsmelt-01, promoted 10-24 ~08:28Z: rows carry `run_id ironsmelt-01-promote`, `code.version
fb8de72f`). Branch `lavasight-on-fb8de72`. No bot, host, queue, scheduler, manifest, env or world was changed. Host actions
were read-only: the population query (§1) and a dry run of the read against live rows (§7).

**r5** answers the r4 reviews (Codex CHANGE, 1 P1 + 1 P2; Claude APPROVE + 1 P2): the segment into a climbable is charged
at the minimum over its two forms and SETTLED on the child that fixes the form, so an accepted route is never priced (the
descent Codex reproduced now costs exactly the base and passes a cap of 1); coverage counts liveness only in observed slots;
the primary line needs a fall beyond the null range.

**r4** answered the r3 reviews (Codex CHANGE, 1 P1 + 2 P2; Claude APPROVE + 1 P2): a ladder or vine is processed by its
successor (centred only when the next node is lower), so the move INTO a climbable is judged on both of its forms and the
move OUT on the one its successor picks; the slab test now holds a segment the guard refuses; the capped test uses real caps
with a binding control; the incremental note is bounded and in place; the read's bot-time comes only from rows both builds
write; the installer patches the header line before it adds the cron.

**r3** answered the r2 reviews (Codex CHANGE, 4 P1; Claude APPROVE with P2s; §10): a move is now judged in the ONE form
the guard is handed (postProcessPath's support tops before the first dig, raw cells after, the bot's floored start), which
makes the price exact on executed paths and keeps every cost-capped search the base passes by an accepted route; the read
counts observed bot-time; the publisher requires the refresh heartbeat and ships with its cron wrapper, rehearsal and
header line.

**r2** answered the r1 reviews (both CHANGE). The mechanism moved from the step hook to the **move level**, which makes
"never a wall" true by construction instead of by arithmetic; the footprint is now the guard's own refusal set, proved cell
by cell; the ring, egress and warn rows are gone.

## 0. Answers first

1. **The map already knows the lava the guards refuse.** Out of sample (rows after the map's own `window.until`, 10-24
   08:46-13:15Z, 80 bots, 285,939 rows walked): of **224 distinct (world, cell)** lava cells named by a guard refusal, **219
   (97.8%)** lie within 1 block of a map cell of that world; by rows 1,380 of 1,385 (99.6%). **Negative control:** the map moved
   48 east and 48 south covers **0.0%**.
2. **Why routing is the lever.** The corridor guard (`lavaguard.mjs corridorSafe`, the `path_update` hook) refuses a planned leg
   whose 0.5-block samples have lava within ~2 beside, 3 below, or beside a drop up to 12 deep. The pathfinder prices none of
   it: it plans the leg, the guard refuses it, and the bot plans it again (468 corridor refusals in 4.5 h; 80 of 84 lava deaths
   in the mineshaft week were preceded by such a refusal). **lavasight tells the planner, before it plans, which moves the
   guard would refuse**, so a detour the guard accepts is found first.
3. **A price on moves the base already made, never a wall.** The base move generator decides which moves exist;
   `wrapNeighbors` only adds `CORE_MOVE` (50) to the cost of a move the guard would refuse for a remembered lava cell.
   - The neighbour set is the base's by construction: no `cost > 100` deletion inside the generator is reachable from a cost
     added afterwards. So **the move graph is identical**, an uncapped search reaches exactly the goals the base reaches, and
     memory alone never makes a goal unreachable. Tested over the installed pathfinder's own generators, with and without
     digging, and with a filtering mutant that the test and gate G3 both catch.
   - Egress follows: a bot standing in the footprint has every base move out, priced; the cheapest leaves the footprint first
     (tested).
   - r10's egress window, downgrade re-plan and exemptions are not needed and are not built.
   - Prior art agrees on finite pricing: Baritone's `Avoidance` is a precomputed position-hash -> cost-coefficient map (§8).
4. **Exact, not approximate.** The footprint of a lava cell is the set of feet cells at which `corridorSafe` refuses a sample
   because of that cell, with the live world's solid blocks (occlusion) and drops; **equal cell by cell to the guard on 60
   synthetic worlds** (§3.2). A move is priced **iff** the guard would refuse it in either node form the guard is handed
   (§3.3; proved over every neighbour on 20 worlds).
5. **Delivery.** A host publisher on 10.0.0.31 (the bots and the map live there) writes one `lava-map.json` per pool directory,
   as mcbot, atomically, only after a good hazardmap refresh. The bot binds it **to its world by recomputing the login packet's
   hashedSeed from the file's seed string** (3 of 3 live worlds) **and to its pool by name**, judges `stale_after` on every
   refresh, and **fails open** with a logged state on any missing, stale, foreign or malformed file.
6. **Scope.** Lava-like cells only. **Drowning, cave falls and dripstone are not routed and not delivered**; the read reports
   deaths at every map hazard by kind (that is the warn-only treatment, in the read, not in the bot). Drowning stays terrain by
   the owner's rule; the town's lake is beside home. Bot-built traps and entombment are per world and other arms own them.
7. **Composition.** No price while a body-moving reflex holds the body (keepout's rule). The step hook and its prices (death
   sites 16, keepout 101, well 1,000, water entry 1, protectzone) are untouched: lavasight adds no per-cell charge. homefix's
   relocation never targets beside live remembered lava (fallback home unchanged).
8. **Tier 3** (routing-wide), as F5b was registered; `drawexposure.py` decides the draw under the 4-pool policy (§7).

## 1. Population (read-only, 10.0.0.31, `scripts/host/lavasight_population.py`)

- **Window:** after the map's `window.until` 2026-10-24T08:46:43Z, to 13:15Z (4.49 h). Live files only (the script refuses a
  window that crosses a log rotation). 285,939 rows, 80 bots.
- **Refusal rows naming a lava cell:** 1,604 parsed, **0 unparsed**; 1,385 in the judged window.

| kind | rows | map within 0 | within 1 | within 2 | own refusal within 1 in the prior 60 min | distinct (world, cell) | of them within 1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `_lava_corridor` | 468 | 94.2% | 99.4% | 99.6% | 62.4% | 147 | 144 (98.0%) |
| `_explore_blind_step_refused` (lava) | 906 | 95.9% | 99.7% | 99.8% | 84.8% | 126 | 124 (98.4%) |
| `_reflex_danger_block` (feet lava-like) | 11 | 90.9% | 100% | 100% | 90.9% | 9 | 9 |
| **all** | **1,385** | 95.3% | **99.6%** | 99.7% | 77.3% | **224** | **219 (97.8%)** |
| null: map moved (48, 0, 48) | | | **0.0%** | | | | |

- Map cells per world (lava hazards not `absent`; `sightings.cells` + `deaths.cells`): 1,862 in each of the 10 shared-seed
  worlds; 111-623 in the six singletons. All under the 4,096 cap.
- **Not shown:** that a priced route is found and accepted. That is Paper's and the canary's question.

## 2. Delivery

### 2.1 The publisher (`scripts/host/lavasight/lavamap_publish.py`, staged; the operator installs)

- **Triggered by a good refresh** (Claude r1 R5), and the heartbeat is **required** (Codex r2 P2): it publishes only when
  `~/hazardmap/out/heartbeat.json` says `ok` at this map's `generated_at` (live check 10-24: heartbeat `at` 08:56:43Z = the
  map's `generated_at`, `refresh_ok` true); otherwise it writes nothing and exits 0. An hourly cron at :40 picks the 05:10Z
  refresh up.
- **How it runs** (`lavamap-cron.sh`, the frontier publisher's pattern): mcbot cannot read /home/mike, so mike's shell sends
  everything on stdin -- the program text, the map, the heartbeat -- to a one-line BOOT under `sudo -n -u mcbot`, one run at
  a time (flock). Rehearsed end to end on .31 into a trial root as mike (16 of 16 pools written, `check` OK; removed after).
- **Install** (`install-lavamap.sh --rehearse | --install | --rollback`, the operator's step, before the draw): the app copy,
  the suite, one real publish, the cron line, and the fleetstatus header line (`patch_fleetstatus.py`, anchored on the
  frontier lines like the hazardmap patch; patch + revert rehearsed byte-identical on a copy of the installed file).
- Refuses an unknown `schema`/`schema_version`, a map past `stale_after`, or seed keys that are not decimal strings: exit 3,
  nothing written (the bots' own rule then fails them open at the old file's `stale_after`).
- For each world W of `seeds[s].worlds` whose `/var/lib/mcai/_pool-W` exists: lava hazards whose
  `exists.by_world[W].state` is not `absent`; **sighting cells first, most-seen first, then death cells** (Claude r1 P3-3);
  deduplicated; at most 4,096.
- Writes `lava-map.json` by temp file in the same directory, fsync, rename. As **mcbot** via `sudo -n -u mcbot` (the frontier
  publisher's pattern), never root (refused), never through a symlink (refused), never creates a directory. A re-run of the
  same map is byte-identical and leaves the file alone (the file carries no clock of its own).
- `check` gives the fleetstatus header line: `lavamap OK: N of N pool files inside stale_after`, or `LAVAMAP ALARM: ...`
  (absent, unreadable, stale; zero pools examined is an alarm too), over the pools whose world the map lists, skipping
  `.pre-reseed-*` and `_pool-self-*` directories. Live 10-24, before any install: `LAVAMAP ALARM: 16 of 16 pool files bad`,
  as it should be.
- Base builds never open the file, so publishing to every pool cannot touch the control arm.
- Tests: 8 behaviour cases and 11 anchored mutants (`test_lavamap_publish.py`, run inside `npm test` by
  `lavamap-publish.test.mjs`, which also feeds the publisher's own output to the bot's parser: one contract, both halves).

### 2.2 The file (`mcai.lavamap` v1)

```
{ "schema": "mcai.lavamap", "schema_version": 1, "world": "board-a", "seed": "1239381899",
  "generated_at": <the map's>, "stale_after": <the map's>, "source": {"map_sha256": ..., "map_generated_at": ...},
  "cells": [[x, y, z], ...] }                          // <= 4096 lava-like evidence cells
```

### 2.3 The bot (`bots/src/lavasight.mjs`, pure; wired in index.mjs beside protectzone's reader)

- Read at spawn, then every 60 s on a timer (never in the A* step). The bytes are re-parsed when mtime, size, the login world
  or the pool change; **the decision is re-made on every refresh, so a file goes stale at its `stale_after` untouched**.
- **World binding.** `hashedSeedOf(seed)` = SHA-256 over the seed as a little-endian int64, first 8 bytes as a little-endian
  int64, rendered `hi:lo` as signed int32s (how `worldIdFromLogin` renders the login packet). Live check: 1239381899 ->
  `-1909043226:-504800724` (board-a), 8948499624371160708 -> `174057850:195548254` (placebo-a), 4394143238757369828 ->
  `-23873500:595148475` (hive-c). BigInt parse; a number seed is refused.
- **Pool binding** (Codex r1 P2, Claude r1 P2-5): ten worlds share a seed, so the file's `world` must equal the bot's pool
  (`config.memory.pool`); a pool directory is one world. `POOL_STATE_DIR` overrides and pools without a directory simply
  have no file (absent, fail open).
- **States** (`_lavasight_mode` on spawn and every change): `ok`, `absent`, `unreadable`, `bad_schema`, `world_unknown` (no
  login seed yet: a reseeded world never inherits old lava), `world_mismatch`, `world_label`, `stale`, `off`. Anything but `ok`
  = no map cells. **No last-good retention** (Codex r1 P2).
- Overworld only.

## 3. Routing

### 3.1 Memory, re-read live

- Memory = the file's cells ∪ this bot's own sighting ring (512, in-process): cells named by its own `_lava_corridor` refusal
  and lava-naming blind-step refusals, **filtered at the source** to lava reasons, never `unknown` (Claude r1 P3-2).
- Every 20 s (a timer), memory cells within 192 blocks horizontally are re-read:
  - loaded and lava-like now (`lavaguard.LAVA_LIKE`) -> **active**;
  - loaded and not -> **removed** for this process (a sealed pool or a changed world stops costing at once; a new map
    re-admits them);
  - unloaded -> kept, inactive (the pathfinder cannot plan through an unloaded cell).
- The index (§3.2) is rebuilt from the active cells with the live world's solidity. Measured upper bound (board-a's 1,862 cells,
  all active, no occlusion): 130k entries, 18 ms, ~11 MB of a 768 MB heap; capped at 250k (`full` in the liveness row).

### 3.2 The footprint is the guard's refusal set

For an active cell L, the feet cells F at which `corridorSafe([F, F])` refuses because of L:
- **beside:** F.y = L.y, |dx| <= 2, |dz| <= 2 except the four (±2, ±2) corners (the guard's 3x3 sample of `cellLavaSafe`'s
  five-cell beside check);
- **over:** F within Chebyshev 1 of L's column, F.y = L.y+1..L.y+3, L's column open (non-solid) strictly between
  (`cellLavaSafe`'s below scan stops at the first solid);
- **drop:** F in L's column or a cardinal of it, F.y = L.y+1..L.y+12, F's own column open from F.y-1 down to L.y+1
  (`dropLavaSafe`: straight down, and lava beside the falling column, before the first solid).

Unknown cells count as open (more price, never less). **Test:** 60 synthetic worlds (lava from 10 under the floor to the floor
itself, random caves and slabs, open shafts), every feet cell in an 11x11x17 box: core == guard refusal for all of them, with
a positive control (core is neither empty nor everything), and two mutants (no occlusion; no drop column) that break it.

### 3.3 The move surcharge, in the form the guard will see

- index.mjs's corridor hook hands the guard `[floor(bot position), ...result.path]`, and postProcessPath has moved every node
  **before the first dig or place** onto the top of its support (water and climbables: the cell centre; else the top of the
  feet cell's shapes, else of the cell below's, else one below), leaving the rest as raw cells. On a bottom slab a node sits at
  y - 0.5 and the guard floors it a cell lower (Codex r2 P1-1).
- So each generated move is annotated (`_lsRaw`: it digs or places, or its parent was raw) and judged on ONE segment: from the
  parent's executed form (the search's start = the bot's floored position) to its own (`processedPos`, a transcription of
  postProcessPath and getPositionOnTopOf, or the raw cell), sampled exactly as `corridorSafe` samples (k = 1..n at 0.5 steps,
  floored). r2 judged the union of two forms, which priced moves the guard accepts (Codex r2 P1-2).
- Any sample in the footprint -> `CORE_MOVE` = 50 (a detour of up to ~50 blocks per refused move is preferred).
- **Tests, on the REAL pathfinder** (the installed plugin on a fake bot, so getPathFromTo applies postProcessPath): every
  segment of every planned path on 40 noisy worlds with slabs, carpets, water and digging profiles is priced iff the guard
  refuses that executed segment; and a slab-floor world where the processed nodes sit at y - 0.5.
- **Climbables** (Codex r3 P1, r4 P1): postProcessPath centres a ladder or vine only when the NEXT node is lower, else puts
  it on top of the climbable's shape (y + 1, offset to the wall). So the segment INTO a climbable is charged, when that move is
  generated, at the MINIMUM over the climbable's two forms, and the rest is SETTLED on each child move once the child fixes
  the form (max(0, actual - charged): never negative, as A* needs). Every segment of a complete path is then charged exactly as
  the guard refuses it, except that a path ENDING on a climbable can under-charge its last segment -- never over-charge. r4
  charged a move into a climbable on either form, which priced an accepted descent and walled off a capped search (Codex's
  reproduction, now a test). Tested on the real plugin: a climb up past lava is charged exactly for its refused segments; the
  accepted descent costs exactly the base and passes a cap of 1; mutants for "either form" and "never settle".
- Not modelled: pathFromPlayer can drop the first node(s) of a re-plan, so the guard's first segment can span more than one
  move (Claude r2 P3-1). It only shifts price; the guard is unchanged.

### 3.4 Never a wall, and what can still change

- **The neighbour set is the base's** (§0.3). An exhaustive search (no cost cap) is noPath for the candidate iff it is for the
  base (tested on a fenced plot). One caveat (Claude r2 P2-4): A* keys nodes on xyz, but a node carries `remainingBlocks`
  (scaffold left), which gates towers and bridges downstream; a raised cost can make A* keep a different predecessor of a
  node, with fewer blocks left. That can only differ where the base's best route to the node crosses a priced (= refused)
  move, so it is harmless in practice and not claimed away.
- **What can change:**
  - which path is chosen (the point);
  - **timeouts**, because A* explores more before accepting a priced move (no-harm line in the read);
  - **cost-capped searches** (`searchRadius` is a cost cap: the gather approach and its re-plans, slack 400; the ore tunnel,
    400; reachprobe, 96). A move the guard accepts is never priced, so **wherever the base reaches a goal within a cap by a
    route the guard accepts, the candidate does too, at no greater cost** -- tested as a property over noisy worlds at the
    tightest cap the base passes, with GoalBlock goals so every cap is a real one (searchRadius >= 0) and a control that half
    of each cap fails the base (Codex r3 P2). Climbables keep it: a segment into one is charged its minimum form, so an accepted one is charged 0 whatever the
    successor (r5). The property is per search slice: a time-sliced search (40 ms ticks on the
    fleet) is nondeterministic in the base itself by about one move (Claude r3 P3-1). A capped search fails for the candidate only where every route within the
    cap has a refused move, which the base would have executed into the guard's refusal. Reported through movement
    successes in the no-harm line.

### 3.5 Where it applies

- The wrapper is an own property set on the walk profile **before every clone** (gather, the ore tunnel, ascent, descent, water,
  the town-deposit walk), so all of them carry it; `composterSafeMovements` now calls the base profile's generator instead of
  the prototype's (Claude r1 P1-1), so the composter walk carries it too (behaviour-tested both ways).
- **Off while a body-moving reflex holds the body** (`stopReflexes.activeReflex()` non-null and not `eat`: drowning rescue,
  entombed escape, the marooned arm, the pocket rung). Not covered by that list, and therefore priced: the unstick arm's
  pathfinder gotos and climb/stair claims (Claude r1 P3-1). Harmless (identical graph); said here and in G2's note.
- lavastep's danger arm does not use the pathfinder.

## 4. Composition

| Component | Effect |
|---|---|
| **lavastep-01** (F1, next canary) | Its danger move is its own verified executor, not the pathfinder: unaffected. lavasight touches no line of reflex.mjs, so the successor variant onto lavastep's sha has no textual overlap in the danger arm. After lavastep's move, the next skill's plan prices the footprint, so it is less likely to plan back to the edge. |
| **corridor guard** | Unchanged; it still refuses. It is the positive control: its refusals per check should fall. |
| **death sites / keepout / well / water entry / protectzone** | All live in the step hook or the break/place hooks, which lavasight does not touch. No per-cell price changes anywhere. keepout's 101 and the well's 1,000 stay deliberate deletions. |
| **keepout `_keepout_exit`** | A skill: its walk is priced, and every base move stays (identical graph). |
| **poolescape-01, entombed, drowning rescue** | Reflexes: no price. poolescape's live lava check unchanged. |
| **ceilescape-01** (if it lands first) | A reflex (entombed arm): no price; no shared file. |
| **homefix (watchdog)** | Level 1: `composeRelocationForbid(fire, lava, relocationForbidden)`: fire answers exactly as keepout's forbid did; a target whose feet are within 3 (xz), -1..+3 (y) of an active lava cell is refused as `lavasight` in the reasons (Claude r1 P3-4). No target -> the existing fallback, home (chain tested: every candidate forbidden -> `no_dry_target`). |
| **runner reservation** | Untouched: the price keys on reflex ownership. |
| **F6 deep stair** | Not built. |

**Refusal chain.** lavasight refuses nothing. A goal near lava stays reachable on the same graph; the corridor guard still
refuses an unsafe leg as today, and today's chain runs from there.

## 5. Rows

| Row | When | Args (structured) |
|---|---|---|
| `_lavasight_mode` | spawn, every state change | `on`, `state`, `why`, `world`, `world_id`, `cells`, `generated_at`, `stale_after` |
| `_lavasight` | every 10 min, whatever happened | `state`, `file_cells`, `ring`, `active`, `unloaded`, `removed`, `index`, `full`, `rebuild_ms`, `priced_moves`, `held_seen`, `held_priced`, `set_changed`, `corridor_checks`, `corridor_refused`, `ring_added` (counters are per 10 min) |
| `_lavasight_route` | `path_update` success/partial at most 1 per 30 s, plus every noPath/timeout | `status`, `profile`, `nodes`, `core_nodes`, `min_d`, `refused`, `priced` (moves surcharged since the last route row), `held`, `active`, `index`, `goal` |

- `held_priced` and `set_changed` are **code-regression tripwires, 0 by construction in this wiring** (Claude r2 P2-1): the
  wrapper decides and counts from the same reflex value, and it maps over the base's own array. Each has a mutant that makes
  it nonzero (§6), so a regression is caught; neither can see an arm that owns the body without appearing in
  `activeReflex()`. G2 is reported **NOT EXERCISED** when `held_seen` = 0 (no held search met the footprint at all).
- `corridor_checks` / `corridor_refused` count every guard decision, unsampled (Codex r1 P2).
- Rollback: `LAVASIGHT=0` (no wrapper installed, no ring, no relocation forbid; the mode row says `off`).

## 6. Tests

`bots/test/lavasight.test.mjs` (25), `bots/test/lavamap-publish.test.mjs` (3: the python suite, the read's selftest, the
publisher -> parser contract), `bots/test/keepout-homefix.test.mjs` (the relocation wiring re-anchored on the composed forbid).
- binding: the three live pairs; a negative seed; number and junk seeds refused;
- the file: every state fails open with no cells; bad cells named; the cap; the reader goes absent -> ok -> stale **on the
  clock** -> unreadable, never keeping a last-good copy;
- the footprint == the guard (60 worlds) + 2 mutants; the move priced iff the guard refuses (20 worlds);
- never a wall: identical neighbour sets with and without digging + a filtering mutant (the test and G3 catch it);
- routes on a real A*: the base's edge route is refused by the guard, the candidate's detour is accepted; a sealed 1-wide tunnel
  beside lava gives the same path (no dead end, priced); a bot on the edge leaves the footprint first; exhaustive noPath is the
  base's;
- scope: off under each body-moving reflex, on while eating; G2 counts a held surcharge only when one is applied (mutant);
- homefix chain; composter's clone behaviour; WIRED (comments stripped, anchors unique, a mutant shows each can fail): the
  wrapper before every clone and gated on the reflex, the counters, the ring at both guards, the rows.
- The full `npm test` from bots/ and eslint no-undef (one hit: the pre-existing `withinBody` in reflex.mjs, as the base).

## 7. Read and registration (`scripts/host/lavasightread.py`)

- **Defects (REVERT):** G2 `held_priced` > 0 and G3 `set_changed` > 0 (tripwires, §5); G4 any `_lavasight*` row on a control
  pool after the deploy; G5 a canary `_lavasight` row without its gate fields. Each has a failing fixture in `--selftest`
  (run inside `npm test`).
- **Bot-time is observed, not assumed** (Codex r2 P1-3): bot-hours are (bot, 10-min slot) pairs with a retained row / 6, so a
  bot restarted onto the canary build mid-window, or one whose off-build rows were skipped, adds only the slots it was seen
  in (a staggered-restart fixture shows no manufactured fall). Only rows BOTH builds write count (Claude r3 P2): the canary's
  own 10-min liveness row would otherwise mark every connected canary slot observed and none of the control's (fixture).
- **Liveness (blocks KEEP):** a canary licence `on=1`; >= 80% of **all** canary bots (a bot without a mode row is unmapped;
  Codex r2 P1-4) with newest mode state `ok` ("mapped": the publisher ran); liveness coverage >= 0.75 of the canary's
  observed slots, counting liveness only inside an observed slot (Codex r4 P2), and both arms present (INSTRUMENT).
- **Primary (DiD, per bot-h):** lava refusal **episodes** -- bot-minutes with >= 1 `_lava_corridor` or lava blind-step row
  (rows are throttled at 5 s and a failed leg writes up to four blind-step rows; Claude r1 P2-3), never counting a refusal for
  an unknown cell (Claude r2 P3-7). **Co-primary:** danger-block
  episodes on lava-like blocks. Descriptive on the canary: guard refusals per check (unsampled), priced moves, core nodes.
- **No-harm:** `path_noPath` and `path_timeout` per bot-h DiD; movement successes (goto, explore, gather) per bot-h DiD.
- **Report lines:** deaths by family per arm (**the two-death floor applies**: one death is named, never a verdict); **deaths at
  map hazards** of the pool's seed (within 3 xz / 4 y of a hazard cell or centre) by kind per arm -- the warn-only treatment of
  drowning, falls and dripstone.
- **Exposure:** canary priced moves >= 200, >= 30 canary lava refusal episodes, and mapped.
- **The null** (four base-build dry runs of the read, 180 min, four pools each, at -200/-260/-330/-400 min, 10-24): primary
  episode DiD -0.48 .. +0.96 (rates ~1-2 per bot-h); noPath DiD -44.6 .. +24.7 (rates ~60); timeout -4.5 .. +2.3 (~19); movement
  successes -4.0 .. +2.9 (~16). The windows overlap, so this is roughly two independent samples (Claude r4). The no-harm lines
  sit outside that band (noPath <= +50, timeout <= +6, movement >= -6). **The primary line needs episode DiD <= -0.5, a fall
  beyond the whole null range** (Claude r4 P2-1): a KEEP means the refusal episodes fell, not merely that nothing objected; a
  smaller or absent fall closes INCONCLUSIVE.
- **Dry run on live rows** (10-24 13:5xZ, `CANARY_DRYRUN` with four pools, 90 min, base build): 189,919 rows walked; episodes
  2.40 / 2.62 (canary-to-be pre/post) v 0.90 / 0.84 (control) per bot-h, danger episodes nonzero on both arms, every gate 0,
  licence and instrument correctly BLIND (no lavasight rows on a base build), and 5,769 rows of a pool running another canary
  (townplan-01 on board-c, 2d1aa8c1) correctly skipped as off-build.
- **Draw exposure:** worlds with >= 50 lava refusal rows in the 24 h before the draw (13 of 16 pass in 4.5 h alone).
- **Tier** from `scripts/drawexposure.py <run> --registrations <tmpdir>` under the 4-pool policy; expected tier 3.

## 8. Prior art (searched 10-24)

- **Baritone `Avoidance`** (`baritone/utils/pathing/Avoidance.java`): a `Long2DoubleOpenHashMap` from block-position hash to a
  cost coefficient, built once per path computation around mob spawners and hostile mobs, multiplicative, never infinite. The
  same shape as the footprint index: precomputed per refresh, a hash lookup in the hot path, finite.
- **Baritone movement rules:** no walking through fire or on magma, no cornering over lava, no breaking a block touching a
  liquid (`MovementHelper.avoidWalkingInto`, FEATURES.md): per-move vetoes on the immediate cells, with no memory.
- **mineflayer-pathfinder** 2.4.5: lava in `blocksToAvoid`; `exclusionAreasStep/Break/Place` are summed per-cell callbacks
  charged before its `cost > 100` deletions (movements.js:113-140, 284, 352-494), which is why r2 does not use them. Issue #141
  ("Pathfinder doesn't avoid lava") is open.
- **Mindcraft, Voyager, Odyssey:** no lava memory (mineshaft §10).

## 9. Settled with the reviewers

- **R7.** `CORE_MOVE` = 50: kept (Claude r2): a priced move is a refused move, so the size trades a detour found against search
  effort; the no-harm timeout line measures it.
- **R8.** Cost-capped searches: accept and report (Claude r2), now with the property test (§3.4) that a guard-accepted route
  within the base's cap is always found.

## 10. Review record

**Code r3 / design r4** (`8e755c7e`): Codex CHANGE (1 P1, 1 P2); Claude APPROVE (1 P2, 4 P3). What r5 changed:
- the climbable rule: minimum-form charge on the move into it, settled on the child (Codex P1, Claude P3-2/P3-3), with the
  descent regression, a capped-at-1 control and two mutants;
- coverage only from liveness in observed slots, with a fixture (Codex P2);
- the primary line at <= -0.5, beyond the null range (Claude P2-1); the incremental note reports `full` at once (Claude P3-4).

**Code r2 / design r3** (`502103d1`): Codex CHANGE (1 P1, 2 P2); Claude APPROVE (1 P2, 5 P3). What r4 changed:
- ladders and vines processed by their successor (Codex P1; Claude P3-3), with a real-plugin climb test;
- the slab test holds a segment the guard refuses (and a mutant that prices raw cells misses it); the capped test uses GoalBlock
  goals, asserts every cap is real, and a control that half the cap fails the base (Codex P2);
- the note's footprint added in place and bounded through `addFootprint`, which the rebuild uses too (Codex P2, Claude P3-2);
- the read's bot-time only from rows both builds write, with a fixture (Claude P2);
- WIRED asserts both call sites of the guard hook (Claude P3-4); the installer patches the header line before the cron, and its
  failure stops the install (Claude P3-5);
- the no-harm thresholds calibrated on four null dry runs (§7).

**Design r2 + code r1** (`72189ab4`): Codex CHANGE (4 P1, 3 P2); Claude APPROVE (no P1; 4 P2, 10 P3). What r3 changed:
- the move judged in the one executed form, with postProcessPath's support tops, tested on the real pathfinder over every
  planned segment and on a slab floor (Codex P1-1, P1-2; Claude P3-1); capped searches tested as a property (Codex P1-2, R8);
- the read's bot-time from observed slots, a staggered-restart fixture (Codex P1-3); the mapped share over all canary bots
  (Codex P1-4); unknown-cell refusals out of the primary (Claude P3-7); G2/G3 relabelled tripwires, G2 NOT EXERCISED without
  a held search (Claude P2-1);
- unknown cells stop the footprint's scans as they stop the guard's, with a two-implication oracle where an unknown cell can
  refuse first, and a mutant (Codex P2); one scan per column (Claude P3-4);
- the overworld checked at every consumer (Codex P2); a guard-named cell re-admitted and priced at once (Claude P3-2, P3-3);
- the publisher: heartbeat required, honest `check` totals and an alarm on zero pools, the directory fsync, the stdin cron
  wrapper, the installer and the header line (Codex P2, Claude P2-3, P3-8); python mutants count only an assertion as a
  kill, and the WIRED mutant moves the block rather than deleting it (Claude P3-9);
- wording: `remainingBlocks` (Claude P2-4); the route row's `priced` is per row interval (Claude P3-5).
- Not built: a no-price counterfactual search on terminal routes (Claude r1 P2-4); the noPath/timeout DiD stands in for it.
- The full runner caught one stale source anchor on r2 (lava-guards-wired.test.mjs: the corridor refusal block's window);
  the lavasight hook now sits inside that block, after the goal is cleared.

**Design r1** (`882dfb66`): Codex CHANGE (4 P1, 3 P2); Claude CHANGE (2 P1, 5 P2, 6 P3). What r2 changed:
- the step-hook price and its bound argument -> a move-level surcharge on an identical move graph (Codex P1-1/P1-2, Claude
  P2-1: entity costs, 6-charging diagonals, liquidCost, the death disc is 16 not 25, dig labour);
- the approximate footprint -> the guard's exact refusal set with occlusion and drops, proved cell by cell, and the move judged
  in both node forms (Codex P1-3, Claude P1-1);
- G2 recomputed from the wrapper's own action, G3 from the returned list, each with a mutant (Codex P1-4, Claude P1-2/P2-4);
- egress dropped (Claude P2-2); the ring and warn rows dropped (both R4); episodes not rows, unsampled guard counters, movement
  successes as no-harm (Codex P2, Claude P2-3);
- pool label binding, the clock re-judged every refresh, no last-good, refresh-triggered publisher, sightings ranked first,
  ring filtered at source, composter's generator, `lavasight` as homefix's reason (Codex P2, Claude P2-5, P3-1..P3-4).
- Codex P2 "recovery tests stop before execution": routes now assert the guard's verdict on the planned path, and the homefix
  chain is driven through `pickRelocationTarget`. The full executed escape is Paper's (§11).
