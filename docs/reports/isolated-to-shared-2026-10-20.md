# Isolated pools -> shared towns (isolated-a..d, 20 bots): measurements, design, rollout

_2026-10-20, written by an agent session for the coordinator. OWNER APPROVED about 12:45Z ("i agree do it all, get it working").
Fleet at writing: `9e7d9980` (cobblekeep-01, promoted 11:23Z) on 70 bots. bagbudget-01 `31416ee5` has been live on board-d and
hive-a since 11:35Z. Branch: `isolated2shared-on-9e7d998`, cut from the fleet sha. It changes **no bot code**: the changes are a
host tool, a wrapper, a tripwire, one test file and this document. Revision r7 folds in the r1-r6 reviews and the coordinator's hold question (5.2a); section 10 lists each finding and how it was handled._

## 0. Summary

Isolated mode is **two environment values, not code**: `MEMORY_SCOPE=isolated` and `MEMORY_POOL=self-isolated-<pool>-<Bot>`.
Every isolated behaviour in `bots/src` is derived from these two values (section 1). Converting a pool to a normal shared town
therefore takes four steps, in this order:

1. Stop the pool's five bots.
2. Seed the town's state dir once, from the five per-bot dirs.
3. Rewrite three env lines per bot.
4. Start the bots again, 12 s apart.

Because no bot code changes, this ships as an **owner-direct (tier-1-style) rollout with a tripwire**, not as a canary
(section 6).

The canary machinery stays exactly as it treats these pools today:

* they are never drawn;
* the reads that drop `isolated-*` from control by bot name keep dropping them.

Admitting the converted pools to draws and controls is a **separate, later gate change**. It needs post-conversion data to
recalibrate (section 5.3).

The one analysis cost is a one-time step in the control arm of the reads that include isolated bots. The rollout handles it
mechanically:

* convert only into an empty slot;
* keep the install-hold until the longest read window of any ready canary (+60 min) has passed the last transition. The
  wrapper releases it only then (section 5.2).

## 1. Every branch on isolated / self-isolated / MEMORY_SCOPE

### 1.1 Bot code (`bots/src`, executable lines only)

These rows were checked by both reviewers. They are also tested in a real bot process (section 7, last test).

| file:line | branch | today (isolated) | after (scope `private`, pool `isolated-x`) |
|---|---|---|---|
| config.mjs:105-108 | `memory.scope = MEMORY_SCOPE`, `memory.pool = MEMORY_POOL` | the two inputs | same inputs, new values |
| worldfacts.mjs:374 `poolStateDir` | `POOL_STATE_DIR`, else `dirname(STATE_DIR)/_pool-<MEMORY_POOL>` | `_pool-self-isolated-x-<Bot>`: one TOWN dir per bot | `_pool-isolated-x`: one per town |
| plinth.mjs:1047 `townRecordsShared` | `scope === 'isolated'` -> false; also false when the pool name contains the bot name | false: no plinth planned or built | true |
| plinth.mjs:1139 `plinthFirstPolicy` | needs townRecordsShared; `PLINTH_FIRST=0` turns it off | policy 0 (24 h: 68 `_plinthfirst_mode` rows `policy=0 shared=0`) | policy 1 (as the 269 shared rows) |
| smeltjob.mjs:71 `smeltJobEnabled` | `SMELT_JOB=0` -> off; `scope === 'isolated'` -> off (owner D2) | **0 `smelt_town` rows in 24 h** in isolated-a..d | on |
| furnacelease.mjs (dir = poolStateDir) | one lease dir per bot | the 5 bots never exclude each other at a furnace | one lease dir per town |
| cobblecap.mjs / stocktarget (journal in poolStateDir) | per-bot `town-chest-<H>.cobble.jsonl` | 5 cap states for one set of chests (`cap=at_cap` and `cap=unknown` side by side in one world) | one fold per town |
| chestfull.mjs:292 town memory | per-bot `containers.json` | each bot knows only the outcomes it saw | one memory per town |
| composter / junk-well site (skills.mjs 6817, 7516, 7520) | per-bot `composter-site`, `junkwell-site`, `junkwell-nosite` | per-bot records; 11 of 20 bots hold a no-site record | one per town |
| worldfacts.mjs:365 `openWorldFacts` | `scope !== 'isolated'` -> pooled file | per-bot `world-facts-<Bot>.json` in STATE_DIR | `world-facts-isolated-x.json` in the town dir |
| comms.mjs:131 | `scope === 'isolated'` -> ingest nothing | peers' hazard / unreachable chat ignored | ingests messages whose pool token is `isolated-x` |
| lessons.mjs:958 | `scope === 'shared'` pools lessons | per-bot `lessons-<Bot>.json` | **unchanged** under `private` (same file) |
| prompt.mjs:260, cognitive.mjs:125, skills.mjs:4088 | `board` / `checkpoint` get the board verb | no board verb | **unchanged**: the system prompt is byte-identical (tested) |
| logger.mjs:71-79 | `exp.memory_scope`, `exp.pool`, `exp.arm` on every row | `isolated`, `self-isolated-x-Bot`, `isolated` | `private`, `isolated-x`, `town` |

**Overrides.** `POOL_STATE_DIR`, `SMELT_JOB` and `PLINTH_FIRST` would change what the conversion does. None of them is set in
any env file today. The tool refuses if one is set, unless that variable is named with `--allow-override NAME` (Codex r1 P2-9).
The unit file sets the environment only through `EnvironmentFile=`. Any canary drop-in makes the tool refuse.

**Why scope `private`.** Of the scopes in the code, `private` is the only one whose prompt and lesson store are what isolated
bots have today: per-bot lessons in STATE_DIR, and no board verb. The conversion therefore changes exactly one thing: town
state and world state become the town's. `shared` would also pool the lessons, which is a second, confounded change. `board`
and `checkpoint` add a walk to the board.

No pool runs `private` today: the 80 bots are 20 each on shared, board, checkpoint and isolated. `private` is the code's own
default (config.mjs:106). Nothing tests for `'private'` explicitly: it takes every default branch, which are the same town
branches the other 60 bots take.

Positive controls for the zero and one-sided claims above:

* `smelt_town` is present in all 12 shared pools in the same ES window, with 17-250 rows each.
* `_plinthfirst_mode` is present on both arms.

### 1.2 Host scripts

The live copies are in ~/mcai-analysis on 10.0.0.31. Where an md5 was checked, it matches the repo.

* **Draws: never draw isolated-*.**
  * Rules: drawrec.sh:171 (live md5 986e18d2 = repo scripts/host/drawrec.sh), drawrequire.py:38, drawexposure.py:122,
    drawsteady.py:423, keep180_guards.py:15, v36_livecheck.py:40, reseed-pool.sh:17, climbfloodread.py:62.
  * All of them test bot-name pools, so they keep excluding the converted pools. **Unchanged** (5.3).
* **Controls that drop isolated bots by name.**
  * Scripts: immobiledid.py:46 (both arms), brainread.py:104, gathernull.py:95, monumentread.py:270, shaftread.py:223,
    smeltjobread.py:83/183, poolrank2.py:29, gatep.py:51, queue-order.py:27.
  * These populations are calibrated: keep180 was calibrated "isolated-* and self-* excluded" (RULES-IN-FORCE v35).
  * **Unchanged**, and consistent across the switch.
* **Controls that INCLUDE isolated bots** (every non-canary bot):
  * verdict.py: the death gate (cross-sectional, POST only), the change-row discrimination, usafegate (24 h PRE) and tierrule.
    The tierrule clean baseline checks canary rows only.
  * The queued canaries' registered reads, all with `PRE = CUT - W`: ironpickread, kitsearchread (its `pool_of` strips
    `self-`), bambooread, foldwatchread, treefarmread, bagbudgetread, cobblekeepread.
  * These reads see the conversion as a step in control. Section 5.2 handles it.
* **Labels.**
  * fleetstatus.py:120 and goalboard.py:84 `pool_group` map `self-isolated-x-Bot` to `isolated-x` and pass `isolated-x`
    through, so the display is continuous across the switch.
  * After the switch, `exp.pool == pool_of(bot)` holds for all 80 bots.
  * A hand-written ES query across the switch must ask for both forms of `exp.pool`.
* **Plinth tripwires.**
  * plinth2trip.py:57 and plinthfirsttrip.py glob both `_pool-<pool>` and `_pool-self-<pool>-*`. The old per-bot dirs stay on
    disk for the rollback, and they name the same cap, so neither C6 nor T4 fires.
  * plinthfirsttrip's T4 skips `isolated*` towns, so the new tripwire's I2 covers that case.
  * The tool keeps every set-aside dir under `/var/lib/mcai/_isolated2shared/`. That never matches `_pool-*` (Claude r1
    P3-11).
* **The manifest, the tripper and deploys.**
  * deploy-fleet.sh rewrites only `CODE_VERSION` and `RUN_ID` (lines 187-189).
  * Canary drop-ins carry only those two lines (canary-tree.sh:46).
  * So the memory lines survive promotions. The tripper matches `canary_pool`, so it is unaffected.
  * The journal rows this rollout writes (`owner-direct`, `apply-done`, ...) use the strict shape drawsteady requires. They are
    never `promoted`.

## 2. What isolated mode does today (measured)

**ES, 24 h to 10-20 about 12:20Z, 80 bots.** Gaps were clipped. estelemetry printed its caveats: one log rotation in the
window, and the backfilled 10-19 hole.

| | isolated-a | isolated-b | isolated-c | isolated-d | 12 shared pools |
|---|---:|---:|---:|---:|---:|
| deaths | 6 | 0 | 2 | 10 | 22 (0-4 each) |
| smelt_town rows (the job) | 0 | 0 | 0 | 0 | 17-250 each |
| `_furnace_session` | 37 | 45 | 26 | 22 | 42-290 |
| town_deposit (ok) | 88 (18) | 30 (11) | 39 (9) | 22 (15) | 4-219 (3-14) |
| `_well_dispose` | 26 | 21 | 15 | 11 | 2-19 |

**Deaths.**

* The isolated pools had **18 of the fleet's 40 deaths in 24 h, on 20 of 80 bots**: 7 falls, 5 drownings, 3 fire,
  2 stalagmite, 1 suffocation.
* The isolated worlds share the seed and home (355,73,147) of hive-a and board-a, and those two pools had 2 deaths.
* This is not a mechanism claim: world age and the per-bot world models also differ. It is why the pilot is the 0-death pool
  (6.2), and why deaths are a tripwire line.

**Wells: every isolated pool has ONE raised cap, and it is in service.** `_well_dispose` successes in 48 h:

* isolated-a: 45 at 361,73,133 (all 5 bots).
* isolated-b: 38 at 357,74,160 (all 5 bots).
* isolated-c: 29 at 351,72,134 (4 bots; c-Alpha sits at y≈47).
* isolated-d: 26 at 369,72,151 (all 5 bots).

The `_well_refused` rows in the same window are `unreachable` or `player_near` at those caps' stands. None is structural.

**Per-bot records** (the state dirs, read 12:15Z, together with `plan` dry runs of the tool on the host):

| pool | plinth records (all at ONE cap) | no-site records | composter-site | merged containers / world facts |
|---|---|---|---|---|
| isolated-a | Alpha complete; Bravo/Comet/Delta plan; Echo none — 361,73,133 | Bravo, Comet, Delta, Echo (Comet's is NEWER than Alpha's completion) | Bravo = Delta 351,72,143 | 22 containers / 120 sites, 1 unreachable, 200 resources |
| isolated-b | Alpha/Bravo/Comet complete; Delta, Echo none — 357,74,160 | Delta, Echo (both OLDER than every doneAt) | Comet 351,72,144 | 20 / 120, 2, 200 |
| isolated-c | all 5 complete — 351,72,134 (gen 1 of their site was the natural well 342,70,138, C6 on 10-17) | none | Bravo 354,78,150 | 16 / 118, 3, 200 |
| isolated-d | Comet complete; Alpha/Bravo/Delta plan; Echo none — 369,72,151 | Alpha, Bravo, Delta, Echo | Alpha 351,68,144 | 15 / 112, 2, 200 |

Other per-bot state:

* All four worlds report one world id (`-1909043226:-504800724`, the shared seed). This is harmless: each pool's records live
  in its own dirs.
* furnace-leases: 22-68 generation files per bot. Their TTL is 240 s.
* Cobble journals: 100-211 KB per bot.
* isolated-b-Bravo holds a `.recount.json` (Claude r1 P3-8). It is not copied, so its recount misses start empty.
* Lessons: per-bot `lessons-<Bot>.json` in STATE_DIR. This work does not touch them.
* Today the per-bot cobble path is already exercised: in 24 h isolated-b had 80 `*_unknown` stock refusals and 64 recounts
  that counted something (the tripwire's positive-control run, section 7).

## 3. Merge plan: one town state per pool

Principle: **seed the town dir from what the five bots already agree on, and never invent a record.** Anything that cannot be
merged faithfully starts empty, and the code's own fail-closed path rebuilds it. Each rule is an advisory **snapshot** policy.
The files hold each bot's last state, not its history, so the seed is not a reconstruction of a shared history (Codex r1 P1-3,
P2-5). Nothing in the world is touched.

| record | rule | why |
|---|---|---|
| `junkwell-plinth-<H>.json` | the `complete` record (v = PLINTH_VERSION) with the newest `doneAt`, copied verbatim. **Refused** if two records name different caps or worlds, or if plan records exist and none is complete (remedy `--plinth-from <bot>` or `none`). If no bot has a record, nothing is seeded and the town plans its own. | prefers the existing raised plinth (the owner's ask); all 4 pools pass, with one cap each |
| `.lease.gN.json` | not copied | a complete record needs no lease; the 10-17 leases expired long ago |
| `junkwell-site-<H>.g1.json` | `{x,y,z,world,at}` = the chosen cap (format of composter.mjs createSiteGen) | the raised well every bot already uses |
| `junkwell-nosite-<H>.json` | **never copied** | one newer than `doneAt` with no `lost` evidence makes plinthWant replan a finished plinth (`complete_lost/no_evidence`, plinth.mjs:932-935). That is real for isolated-a (Comet's) and harmless in isolated-b (older); never copying is simpler than judging. A test and a mutant show it. |
| `composter-site-<H>.g1.json` | the newest record's site; refused if two records are more than 2 blocks apart (remedy `--composter-from`) | one candidate per pool today |
| `town-chest-<H>.containers.json` | per container, chestfull.mjs recordOutcome **replayed** over what the snapshots still show: the LATEST visible opening (full or took, any bot), then every strike NEWER than it as an unknown, and any newer `unavailable`. Strikes older than that opening are dropped, and `unusableUntil` is **re-derived** from the kept strikes, never copied. The `_` maps are merged leaf-wise: per container, and per need inside `_ingredient_miss`; the newest time wins. | two bots' unknowns 10+ min apart make the container unusable, as one shared file would (Codex r2 P2-8); a strike from before another bot's later `took` cannot (Claude r2 P2-3). A randomized test checks the fold against recordOutcome over the merged history in every case where no snapshot hides an opening. Two cases cannot be replayed exactly. The first is an opening a bot later overwrote with its own unknown, which can keep a
strike for at most 6 h. The second is a mark resting on strikes a bot has evicted (it keeps 8): such a mark is kept only
when the latest visible opening is older than unusableUntil − 2·TTL, so no visible opening can have cleared it (Codex r3
P2-4, r4 P2-4). That rule never resurrects a cleared mark; otherwise the mark is dropped and the container is retried. A miss that a later `took` outdates is cleared by the readers' own rule. |
| `town-chest-<H>.cobble.jsonl` (+ ckpt, gens) | **not created** | the journal is an ordered fold of claims and counts by process instance, and five files have no faithful interleaving. A missing journal folds to an empty state (cobblecap.mjs:531-535): every container is UNKNOWN until a bot opens it, and the deterministic `count_town` order (recount.mjs:58, skills.mjs:3424) counts unknown containers. Withdraw `draw` claims are always admitted (cobblecap.mjs:493). The I6 tripwire watches that the recount really closes (Codex r1 P1-4, Claude r1 P2-4). |
| `.recount.json`, `furnace-leases/`, `treefarm-*`, `.cN` chest claims | not copied | recreated lazily; the leases have expired; the others do not exist in isolated dirs |
| `world-facts-<pool>.json` | each bot's file is decayed to `now` by the class's own rule (counts below 1 dropped), then the files are UNIONED: every site and resource stays its own entry on its own clock, with no summed count, so no old count inherits a fresh timestamp. Entries are ordered oldest `last` first, so the class's `slice(-N)` keeps the newest; the caps are 120 sites and 200 resources. Unreachable entries older than 24 h are dropped; an id reported by several bots gets `by` and `where` unioned, the newest `last`, and the first reporter's detail. | keeps every bot's death sites, which the pathfinder prices (the class reads them back: tested). A rejuvenating fold was rejected (Codex r1 P1-3). |
| lessons | untouched | under `private` they stay in the same per-bot file |
| old per-bot dirs `_pool-self-isolated-x-*` and per-bot world facts | **left in place** | the rollback uses them (4.4); they are archived after the KEEP (4.5) |

**Extra wells and chests.** Nothing is torn down.

* Chests: every town container within the town radius was always physically shared. The merged memory just lets each bot know
  the outcomes the others saw.
* Wells: isolated-c's natural well at 342,70,138 stays in the world. `findTownWells` may still find it, and throwing junk into
  either well is valid.
* With the seeded complete record, plinthWant answers `complete` on the seeded dir (tested through the real plinth.mjs).
  Without it, wellUsableNow (a physical read of the cap) and plinth-first's `areaLoaded` guard would still stop most replans.

**Order: quiesce, seed, start** (Codex r1 P1-2 and P2-6).

1. All five units are **stopped** before the final read of their dirs. The tool refuses while any of them is active.
2. The seed is built in `_isolated2shared/tmp-*` and renamed into place.
3. The env lines are rewritten.
4. Only then do the units start, 12 s apart.

With this order no old-env bot is running while the town dir exists, and a started bot cannot find an empty town dir.

## 4. The tool, the wrapper, the tripwire

### 4.1 `scripts/host/isolated2shared.mjs` (Node, no dependencies; the pure functions are exported for the tests)

```
node isolated2shared.mjs plan     --pool isolated-b     # DEFAULT: dry run; prints the seed and the env diff; writes nothing
node isolated2shared.mjs apply    --pool isolated-b     # backups first, then the seeded dir, then 3 env lines per bot
node isolated2shared.mjs rollback --pool isolated-b     # the 3 lines back; town dir and per-bot journals set aside
node isolated2shared.mjs status  [--pool isolated-b]
```

**Refusals.** `apply` and `rollback` exit 2 and write nothing when any of these holds:

* `/tmp/mcai-canary.lock` is busy. The tool re-runs itself under `flock -n -E 75` unless the wrapper already holds the lock
  (Claude r1 P2-2), so a busy lock (75) is never confused with a crash (Claude r2 P2-2).
* A canary is declared in the manifest, or any `mcbot@*.service.d/*.conf` drop-in exists, or the unit dir cannot be read
  (fail-closed: Codex r2 P2-11).
* A key of the three is assigned more than once in any env file. Every rewrite is computed before anything is written
  (Codex r2 P2-7).
* rollback: the inventory is incomplete (fewer than five env files, a bad path; Codex r2 P1-6).
* apply: the marker says a rollback started and did not finish. Only the rollback may continue (Claude r2 P3-5).
* Any of the pool's five units is active.
* An env file is neither exactly isolated nor exactly converted (mixed is allowed only to resume).
* An override variable is set (1.1).
* `_pool-<pool>` exists without this tool's marker.
* The plinth or composter rule refuses.

**Backups first.** These go to `/var/backups/mcai-isolated2shared/<stamp>-<pool>/`, and the env copies are verified by sha256
before anything changes:

* the 5 env files;
* copies of the 5 per-bot pool dirs and the 5 per-bot world-facts files;
* `plan.json`: the seed's digests, the source files' sha256, and the three env values before the change.

**The seed.** It is built under `/var/lib/mcai/_isolated2shared/tmp-<stamp>-<pool>` (same filesystem), then:

* fsynced;
* chowned to the owner of /var/lib/mcai (mcbot);
* given a `MIGRATED.json` marker;
* renamed to `_pool-<pool>`.

**The env.** Exactly `MEMORY_SCOPE=private`, `MEMORY_POOL=<pool>` and `EXP_ARM=town` are rewritten, through a temp file and a
rename that keep owner and mode. Every other line is byte-identical (tested). A key that appears twice is refused.

**Idempotent and resumable.** A converted pool with its marker is a no-op. A half-done env step (a crash after the seed)
resumes from the marker. The marker also freezes `known_caps`: every plinth cap and newest well site the five bots recorded
before the switch. The tripwire's I2 judges against these (Codex r2 P1-5).

**`rollback`** (units stopped). Its steps run in this order: mark the marker `rollback_started`; the env; the journals; the
town dir LAST (it holds the marker). So a crash at any step leaves a state that the same command finishes (tested; Codex r2
P1-3).

* It writes back **only the three lines**, to the values recorded in `plan.json`. `CODE_VERSION`, `RUN_ID` and every other
  line stay as they are NOW, so a promotion in between is kept (Claude r1 P1; tested, and a mutant shows a byte-exact restore
  would put the stale sha back).
* It moves the per-bot `town-chest-<H>.cobble.*` journals into the backup, so each bot restarts its journal at the same
  fail-closed recount (their counts predate the town's activity; Codex r1 P1-2).
* It moves the town dir to `_isolated2shared/rolledback-<stamp>-<pool>`, kept and not deleted.

What a rollback does not undo: whatever the bots did in the world, in their inventories and in their per-bot lessons in the
meantime.

### 4.2 `scripts/host/isolated2shared-direct.sh` (the coordinator's one command)

```
bash isolated2shared-direct.sh [--quiet <min> --why <text>] <owner> <pool>...     # convert
bash isolated2shared-direct.sh --rollback <owner> <pool>...                      # roll back
bash isolated2shared-direct.sh --release <owner>                                 # end the quiet period (refuses before)
```

The wrapper does this, in order:

1. Refuses within 30 min of fleet-recycle.timer, or while it runs. That timer restarts every unit, stopped ones included, and
   takes no lock.
2. Takes this rollout's own lock (`~/isolated2shared/rollout.lock`, every mode, `--release` included), so a release can never
   race a conversion (Codex r3 P1-1).
3. Computes QUIET (5.2) with `isolated2sharedhold.py quiet`: the scheduler's own status table plus the queue's registrations,
   and 1440 for a ready underground-safety or bag-fix entry. It fails closed: if ANY ready registration is unreadable, it
   refuses (Codex r3 P2-6) unless `--quiet` and `--why` are given. `--quiet` can only raise a computed value. QUIET is at
   least 240. A ROLLBACK whose computation fails falls back to the recorded quiet period (Claude r3 P3-6). A release never does: it
   refuses, or takes an explicit `--quiet` with `--why` (Codex r4 P2-1).
4. **Claims the install-hold first** (`isolated2sharedhold.py claim`: the installers' own `holdtoken.py claim`, the
   scheduler's slot checks under its tick lock, refused if any other hold exists), and **then** takes
   `flock -n /tmp/mcai-canary.lock`. The scheduler counts a held loop lock as a busy slot, so the order matters (Codex r2
   P1-1). A later phase REUSES the recorded hold only when it is the live one (a non-empty token, `HOLD.json` written by tmp
   + rename), and EXTENDS its `until` to now + QUIET + 60 under the tick lock, never shorter (Claude r3 P2-1, P2-3).
5. Runs a clean `plan` for every pool. A refusal before any transition drops a hold this run claimed (Claude r3 P3-5).
6. Per pool: journal `owner-direct`; stop the 5 units; `apply` (or `rollback`). Then by exit code:
   * 0: restart the 5 units 12 s apart (`restart`, never `start`), verify all 5 are active, journal `apply-done` with the
     not-before time and the pool's own tripwire command.
   * 2: the tool wrote nothing. Restart the units ONLY if `status` shows the pool uniformly isolated or converted AND no
     rollback under way. An earlier interrupted run may have left it mixed, or with a half rollback's stale journals, and
     then the units stay stopped (Codex r3 P1-2, r4 P2-3).
   * anything else: the tool died part-way. **The units stay stopped** (a mixed pool is worse than five idle bots), it
     journals `apply-incomplete` with `status`, and it says to re-run (apply resumes) or roll back (Codex r2 P1-4, Claude r2
     P2-2).
7. The hold is **not** released on exit. `--release` releases it only once QUIET minutes have passed since the LAST transition
   row in the journal. That row is `owner-direct` (written before the units stop), `*-done`, `*-refused` or `*-incomplete`.
   Release also refuses while the newest transition has no outcome row (an interrupted run), or ended `*-incomplete`: those
   are reconciled by a re-run or a rollback, never by time (Codex r4 P2-2). QUIET is recomputed at release time as max(recorded,
   now), so a long canary queued during the hold is covered (Claude r3 P2-2); a raised QUIET also extends the hold's `until`
   (Claude r4 P3-1). It verifies the hold is gone before it journals
   `hold-released` (Claude r3 P3-4).

### 4.3 `scripts/host/isolated2sharedtrip.py --since <stop ISO> --pools <p>[,...]` (read-only)

This is a full file walk of every bot over `[since − 24 h, now]`. Run it **one pool per run, with that pool's own T0** (its
`apply-done` row), so no old-env rows land in POST (Claude r2 P3-6). The comparators are:

* the still-isolated pools: same seed and home, old config. A pool that shows any row with a non-`self-` `exp.pool` in the
  window is converted or mixed, and leaves the comparators (Codex r2 P2-10);
* the shared pools, minus any declared canary. The last line is `TRIPWIRE BREACH ...`, `BLIND ...`,
`EARLY` (under 180 min with nothing wrong) or `OK`.

* **I1 CONFIG** (BREACH from +15 min). Every converted bot's newest row carries `exp.pool=<pool>`, `memory_scope=private` and
  `arm=town`. The bot also wrote its once-per-spawn licence rows after the stop: `_plinthfirst_mode policy=1 shared=1` and
  `_plinth021_mode shared=1`. These prove the **code path** took the config, not just the env (Claude r1 P2-5), and they are
  I2's instrument control.
* **I2 WELL** (BREACH). A `_plinth stage=planned` or a `_well_pit_dug` in a converted pool whose complete `at=` is not one of
  the caps **frozen in the marker** at the switch. Live records are never used: a bot writes a new plan's record before it logs
  `stage=planned`, so a live record would let a second well authorize itself (Codex r2 P1-5). At a known cap it is only NAMED
  (a rebuild of the town's own well; Claude r1 P3-9). No marker means BLIND.
* **I3 DEATHS** (BREACH). Three or more deaths after the stop, AND a rate above 2x the pool's own 24 h PRE rate, AND above 2x
  the shared pools' POST rate. Fewer deaths are NAMED. Exposure is the capped-gap estimator.
* **I4 FURNACE** (BREACH). Two different bots of one converted pool inside one furnace session at once, neither unleased,
  counted from stop + 5 min + 240 s. The tripwire groups by the converted pool itself; smeltjobread's rule skips `isolated*`.
  Its self-test proves an overlapping isolated-b pair is seen (Codex r1 P1-1, Claude r1 P3-10).
* **I5 EXPOSURE** (BLIND from +120 min if missing). Per pool: at least one `_well_dispose` success at a known cap, and at least
  one `_smelt_job_tally` row (the job is on and was considered at town).
* **I6 COBBLE** (BLIND from +60 min, BREACH from +180 min). The fail-closed start must really close (Codex r2 P2-9). Not
  closing means either of these:
  * `*_unknown` refusals with no counted `_stock_recount` in the whole POST;
  * a trailing-120-min unknown-refusal rate above 3x max(own PRE rate, shared POST rate, 0.2/bh), with no counted recount in
    that tail. The tail's bot-hours are MEASURED from the rows in it, never scaled from the whole POST (Codex r3 P2-5).

  For calibration, isolated-b on its old config read 0.51/bh against a reference of 0.62/bh: ok.
* **I7 DiD** (REPORT ONLY). Per bot-hour, PRE to POST, the converted pool against the still-isolated and the shared pools:
  deaths, `_deposit_new_chest`, town_deposit ok, smelt_town ok, gather ok (Codex r1 P2-8). There is no absolute new-chest
  breach any more.
* An INSTRUMENT line counts every selected kind fleet-wide, as the parsers' positive control.

### 4.4 Rollback (any phase)

Run `bash isolated2shared-direct.sh --rollback <owner> <hold> <pool>`. It stops the 5 units, writes back the three lines, sets
aside the journals and the town dir, and restarts the units 12 s apart. A rollback is also a transition, so it gets the same
post-transition hold (5.2).

### 4.5 Close (after the KEEP; not built now)

Archive `_pool-self-isolated-x-*` into `_isolated2shared/pre-shared-<stamp>/`. Only after the decision is recorded.

## 5. Canary machinery and analysis

### 5.1 What changes now: nothing in the machinery

Nothing changes in drawrec, drawsteady, drawrequire, immobiledid, verdict, any registered read, the manifest, the tripper,
canary-sched or fleet-deploy. The converted pools keep their names, so every `startswith('isolated')` rule keeps doing exactly
what it does today.

### 5.2 The one-time step in control: a mechanical hold

The reads that include isolated bots in control see the converted pools change at the switch: smelting turns on, the shared
chest memory takes effect, and the recount backlog settles.

* **The pre-window.** A queued read at minute W has `PRE = [deploy − W, deploy)`. If a transition (a conversion or a rollback)
  falls inside that window, its control arm compares mixed baseline behaviour with post-change behaviour.
* **The restart transient.** If a canary launched right after the restart, the transient itself would sit in its PRE (Claude
  r1 P2-3).
* **The death gate.** It is cross-sectional (canary POST vs control POST), so for it "not mid-canary" is enough.

**Rule.** Never convert mid-canary; convert only into an empty slot. After the LAST transition, the slot stays held for
**QUIET = W + 60 min**, where W is the longest read minute over every READY queue entry's registrations. That is conservative:
it is not just the head's W, so a queue reorder cannot shorten it. The wrapper computes it; on 10-20 at 13:00Z it read **780**
(toolkit-03's +720). The extra 60 min
let the restart transient (the first recounts and the first smelt trips) clear before the next PRE begins. The hold is the
scheduler's install-hold, claimed with holdtoken.py. An EXPIRED hold keeps blocking launches (canary-sched S8 "STALE") until
it is released, and `--release` refuses before last transition + QUIET (Claude r2 P2-1, Codex r2 P1-2). Every PRE of the next canary then starts after the
switch has settled, at every read, deciding or not. Nothing here is report-only (Codex r1 P2-7, Claude r1 P2-3).

**Cost, for today's queue** (`--quiet <min> --why` overrides the computed value; the override is journalled).

* Queued registrations: toolkit-03 reads [180, 360, 720]; ironpick-01, bamboo-03 and treefarm-03 read [180, 360]; foldwatch-01
  reads [180].
* The computed QUIET is 780 min while toolkit-03 is ready: about 3 h (the pilot's tripwire) + 13 h = **about 16 h of empty
  slot**.
* After toolkit-03 has run, the ready entries top out at +360: 3 h + 7 h = **about 10 h**.
* An owner-chosen `--quiet 420 --why "<owner decision>"` with a [180, 360] canary deliberately placed next: about 10 h. A
  shorter value accepts contamination of that canary's later reads; it is journalled.

The choice is the owner's (section 9).

The underground-safety and bag-fix classes (PRE 24 h, 24-h null bands) need **24 h** after the last transition. None is
queued.

### 5.2a Why not exclude the converted pools instead of holding? (coordinator question, 10-20)

**Draws: the converted pools are already excluded, by name, and stay excluded.** Every draw rule tests
`startswith('isolated')`. `draw-exclude.txt` would add nothing.

**Controls: no exclusion mechanism exists, and building one is a gate change.**

* drawrec.sh's `excl` and `draw-exclude.txt` feed the DRAW only.
* No read takes a control list. Control is every non-canary bot:
  * verdict.py: `ALLBOTS - CANARY_BOTS`, in the digest-pinned gate bundle;
  * every queued registered read: `arm = 'canary' if pool_of(b) in CANS else 'control'` (kitsearchread.py:141,
    ironpickread.py:329, bagbudgetread.py:178, and bambooread, foldwatchread, treefarmread the same).
* toolkit-03's queue entry pins `kitsearchread_md5`, and every registration carries its sha256.
* Excluding the four pools from control for N hours therefore means editing verdict.py (a new bundle digest and gate
  generation) plus every queued read, then re-registering and replacing each variant. That needs both reviews and an install
  under install-hold. It is the right long-term mechanism, and it belongs with 5.3 (admission). It is far larger than this
  rollout, so it is not built here.
* immobiledid.py already drops isolated-* bots on both arms, so the movement guard needs nothing.

**What the hold actually protects, and for how long.**

1. **The pilot's rollback window: 180 min.** The tool refuses while any canary is declared (correctly: a rollback is a
   transition). If a canary launched during the pilot's tripwire window, a BREACH could not be rolled back until that canary
   ended, or it would land mid-read in its control.
2. **The next canary's deciding baseline: that read's PRE.** Every queued registration is tier 2 and can KEEP at +180, with
   PRE = 180 min. If a conversion falls inside that PRE, the control arm's PRE is the old config and its POST is the new
   one. The full step then lands in the DiD, weighted 5/70 of control for the pilot and 15/70 for the rest. The metrics the
   queued canaries measure (toolkit search, iron pickaxes, bag budget, smelting) are town and chest metrics, and those are
   exactly what the conversion changes.
3. **The later reads (+360/+720) of the same canary.** These matter only if +180 did not KEEP. With a 240-min hold, the step
   sits in the first third (+360) or two-thirds (+720) of their PRE.

**Minimum design: 240 min after each phase, not zero.**

1. Convert the pilot in a canary gap.
2. Read its tripwire at +180.
3. Convert the rest at pilot +180, inside the same hold.
4. Hold 240 min after that last transition.

That is **about 180 + 240 = 7 h** of empty slot, instead of about 16 h under the 780-min rule while toolkit-03 is queued (or
8 h if the rest waits a full 240 after the pilot).

The residual is contamination of the reads after +180 of a canary that did not KEEP at +180. It is known, but not bounded:
the step size is unmeasured before the conversion. It is owner-accepted, and the wrapper journals a dedicated
`contamination-accepted` row naming who decided.

Reordering the queue does not make it cheaper. QUIET is the maximum over every ready entry, and a later +720 read would still
straddle the switch.

The 240 floor is the 180-min tripwire plus 60 min of transient. Each phase can BREACH on its own, so each needs it. Nothing
below 240 is defensible, and zero is a dead end: apply and rollback refuse while a canary is declared, so a BREACH could not
be undone.

The wrapper supports this as an explicit, journalled choice:
`--quiet 240 --why "<text>" --accept-contamination "<who decided>"`.

* (SUPERSEDED 10-22, section 11.2.) The acceptance is now RECORDED in HOLD.json and honoured: a plain `--release` and a
  later phase that reuses the hold keep the accepted quiet, unless a longer-reading canary became ready since (then the
  helper prints RAISED and the hold is extended). Passing the same three options again is harmless but no longer needed.
  The pre-10-22 tool needed them on `--release` -- and even then a plain `--release` wrote the computed value into HOLD.json.
* Without the flag, `--quiet` can only raise the computed value.
* The 240-min floor cannot be lowered: it is the rollback window.

**Zero hold (exclusion only) is not available** without the gate change above. If it were taken anyway, a pilot BREACH
could not be rolled back during the next canary, and that canary's +180 KEEP would read the conversion as part of its
control.

### 5.3 Later: admit the 4 towns to draws and to the name-excluding controls (a separate gate change, NOT built here)

After at least 72 h of post-conversion history:

* replace the `startswith('isolated')` draw rules with one shared predicate;
* add the four pools to the populations of immobiledid and the other name-excluding reads;
* **recalibrate** what was calibrated without them: the keep180 guards, the gathernull bands and drawrec's noise band.

The control pools for those reads would then go from 12 to 16 shared, and the drawable pools from 11 to 15 (placebo-c stays
out). This needs its own design, both reviews, and an install under install-hold. immobiledid drops isolated bots on BOTH arms
today, so a converted pool drawn before that change would leave its canary bots invisible to the movement guard.

The `arm` field: `exp.arm` becomes `town` for the 20 bots. No live script reads `exp.arm`. I grepped scripts/lib, scripts/host,
verdict, immobiledid, deathgate, canary-report and infra/guard; there, `arm` always means canary or control.

## 6. Rollout, tier, pilot

### 6.1 Tier: owner-direct (tier-1 style), journal phase `owner-direct`

CLAUDE.md on origin/main (Deploys, tiers; OWNER DECISION 2026-10-19) defines tier 1 as "a constant: light review, then an
owner-direct fleet rollout with a tripwire (journal owner-direct). This is not a canary." This change is configuration plus a
state seed. Its rollback is configuration, plus setting the cobble journals aside.

A canary is not available here anyway:

* these pools cannot be drawn (5.3);
* the comparison a canary would make, converted vs unconverted, is exactly the pilot against the other three, and the
  tripwire's I7 reads it.

Precedents with journal phase `owner-direct`: plinth-02 (10-17), logcap-01 and plinthfirst-01. Because state is merged, the
review was more than "light": both engines reviewed the design and the code (Codex r1 P2-9).

### 6.2 Pilot: isolated-b

Why isolated-b:

* Three complete records and three site records agree on one cap (357,74,160), and the other two bots hold no plinth record.
* Its two no-site records are older than every completion.
* It has one composter record.
* All five bots dispose at that cap (38 in 48 h).
* It had **0 deaths in 24 h**, which makes it the most sensitive pool for I3.

isolated-c also agrees 5 of 5, but it has the C6 natural well and a bot stuck underground. isolated-d has 10 deaths in 24 h.

### 6.3 Procedure for the coordinator, between canaries

On 10.0.0.31, once: `mkdir -p ~/isolated2shared`, then copy the three files from this branch into it (section 8).

1. **Pilot.** Into an empty slot: `bash ~/isolated2shared/isolated2shared-direct.sh <owner> isolated-b`. The wrapper claims the
   hold with the computed QUIET.
2. Run the tripwire at +15 min (I1 must not breach), +60 and +180, using the command in the `apply-done` row.
   * BREACH -> `--rollback`, and record REVERT in the journal and in STATE. The rollback is a transition too, so the quiet
     period restarts from it.
   * OK at +180 -> record KEEP for the pilot.
   * BLIND -> read again at +360.
3. **The rest**, after the pilot's OK, while the hold is still in place:
   `bash ~/isolated2shared/isolated2shared-direct.sh <owner> isolated-a isolated-c isolated-d` (it reuses the hold).
4. Tripwire per pool, each with its own T0, at +15, +60 and +180. The same decision rule applies, per pool.
5. When QUIET minutes have passed since the last transition: `bash ~/isolated2shared/isolated2shared-direct.sh --release <owner>`
   (it refuses earlier). The scheduler then resumes. An expired hold does not resume it by itself.
6. Record KEEP or REVERT per phase in the journal and in STATE.md, and mark memory SHIPPED. Archive (4.5) after the KEEP of
   the rest.

## 7. Evidence produced here

**Tests.** `node scripts/run-tests.mjs` (bots/) runs `bots/test/isolated2shared.test.mjs`: 31 checks. The r4 additions:

* a half rollback with every env still converted is refused;
* a truncated strike history keeps a bot's valid mark;
* the hold helper's rules self-test;
* the wrapper parses (`bash -n`);
* the tripwire's tail exposure is measured.

* The constants and the record-state rule agree with plinth.mjs and with the real WorldFacts class's prune (behaviour, not
  text).
* foldContainer re-derives unusable (Codex's 700-s probe; Claude's strike from before a later took) and agrees with
  recordOutcome over the merged history in every comparable case of 400 randomized ones. mergeContainers reads back through
  chestfull and withdrawpick.
* The world-facts union keeps its clocks, expires what the class expires, and the class reads the death sites back.
* choosePlinth and the env rewrite (exactly 3 lines).
* `plan` writes nothing (the whole tree is hashed).
* apply: backups, the seed, untouched old dirs, no stray `_pool-*`.
* **The composed chain on the seeded dir** (real plinthWant: `complete`), with its positive control (the newer no-site record
  makes it `plan`).
* Idempotence and resume.
* Nine refusals, each writing nothing: canary declared, drop-in present, unreadable unit dir, foreign town dir,
  disagreeing caps, plan-only, an override, a mixed env, a duplicated key.
* An interrupted rollback is only ever finished, and a finished one is not repeated.
* known_caps are frozen into the marker, and the Python tripwire reads them back. A new plan in the live record does not
  become a known cap.
* rollback keeps a later CODE_VERSION.
* **A real bot process on the converted env**: the world model is the seeded pool file, lessons stay per bot, the smelt job is
  on, records are shared, and the system prompt is byte-identical to isolated's (positive control: the `board` scope changes
  it).

A randomized property test checks foldContainer against recordOutcome. Four anchored mutants are killed: copying the no-site records, dropping the canary check, a byte-exact env restore, and
taking the first entry instead of folding.

**Dry runs on the host** (`plan`, read-only, 12:4xZ). All four pools plan cleanly; the numbers are in section 2. The only
refusal is the expected "a canary is declared (bagbudget-01)".

**Tripwire positive control on the host**, run on the UNCONVERTED pools:

* I1 BREACHES for every bot (`pool=self-...`, no licence rows). This shows I1 can fail.
* I5 sees 16 disposals at isolated-b's cap in 24 h.
* I6 sees 80 unknown refusals and 64 counted recounts.
* I4 parsed 43 sessions.
* The walk takes about 20 s for 3.8 M lines.

## 8. Ready-to-run commands (the coordinator; nothing here was run on the fleet)

```bash
# once, on 10.0.0.31 (from a checkout of branch isolated2shared-on-9e7d998, or with git show <sha>:<path>):
mkdir -p ~/isolated2shared
for f in isolated2shared.mjs isolated2shared-direct.sh isolated2sharedtrip.py isolated2sharedhold.py; do git -C <checkout> show <sha>:scripts/host/$f > ~/isolated2shared/$f; done
sudo node ~/isolated2shared/isolated2shared.mjs status            # all four: env isolated, town dir absent
sudo node ~/isolated2shared/isolated2shared.mjs plan --pool isolated-b

# PILOT, into an empty slot (python3 ~/canary-sched.py status | tail -3: DECISION not busy):
bash ~/isolated2shared/isolated2shared-direct.sh <owner> isolated-b
cd ~/isolated2shared && nice -n 19 python3 isolated2sharedtrip.py --since <T0 from the apply-done row> --pools isolated-b   # +15, +60, +180

# REST, after the pilot's TRIPWIRE OK (same hold):
bash ~/isolated2shared/isolated2shared-direct.sh <owner> isolated-a isolated-c isolated-d
cd ~/isolated2shared && nice -n 19 python3 isolated2sharedtrip.py --since <that pool's T0> --pools isolated-a   # and -c, -d

# END OF THE QUIET PERIOD (refuses before last transition + QUIET):
bash ~/isolated2shared/isolated2shared-direct.sh --release <owner>

# ROLLBACK (any converted pool, any time between canaries; it is a transition: the quiet period restarts):
bash ~/isolated2shared/isolated2shared-direct.sh --rollback <owner> isolated-b
```

## 9. Owner decisions (none blocks the pilot; recommendations in bold)

1. Scope for the converted towns: **`private`** (only towns become shared), or `shared` (lessons pooled as well).
2. The post-conversion hold (5.2a). This is the decision the coordinator asked for:
   * **the minimum, 240 min per phase (about 7 h in total)**: `--quiet 240 --why ... --accept-contamination "<owner>"`. It
     protects the pilot's rollback window and every tier-2 +180 decision; reads after +180 of a canary that did not KEEP
     carry a bounded step. Recommended, given the queue is the bottleneck; or
   * the full mechanical rule (default): about 16 h while toolkit-03 is queued, about 10 h after it has run; or
   * control exclusion instead of a hold: not available without a gate change (verdict.py and every queued read). Proposed
     for 5.3.
3. 5.3, admission to draws and controls: **later, with its own design, after at least 72 h**.

## 10. Review log

**r1, Codex CHANGE:**

| finding | handled in |
|---|---|
| P1-1 overlap checker blind to isolated | own grouping + positive self-test (I4) |
| P1-2 rollback with live writers; stale journals | units must be stopped; journals set aside; honest scope (4.1) |
| P1-3 world-facts fold rejuvenated counts | union on own clocks, expiry (3) |
| P1-4 recovery not proven | I6 BLIND/BREACH (4.3) |
| P2-5 nested miss maps; snapshot policy | leaf-wise merge, wording (3) |
| P2-6 quiesce | stop, seed, start (3) |
| P2-7 hold and bias bound | mechanical hold after the last transition, bound dropped (5.2) |
| P2-8 tripwire exposure, DiD, new chests | I5 per pool, I7, no absolute breach (4.3) |
| P2-9 overrides; tier citation | refusals (1.1); 6.1 |

**r1, Claude CHANGE:**

| finding | handled in |
|---|---|
| P1 byte-exact rollback (three versions) | 3 lines only, tested, mutant (4.1) |
| P2-2 no deploy lock | flock (4.1, 4.2) |
| P2-3 later-read bias reaches decisions | hold W_head + 60 (5.2) |
| P2-4 I5 should test the chain | I6 |
| P2-5 licence rows in I1 | I1 |
| P2-6 strikes and unusableUntil | foldContainer (3) |
| P3-7 no-site wording | 3 |
| P3-8 recount.json | 2 |
| P3-9 I2 known caps | I2 |
| P3-10 I4 lease TTL | I4 |
| P3-11 set-aside dirs | `_isolated2shared/` |
| P3-12 no pool runs private | 1.1 |

**r2, Codex CHANGE / CHANGE:**

| finding | handled in |
|---|---|
| P1-1 the lock before the hold blocks itself | holdtoken claim first, then flock (4.2) |
| P1-2 the hold is not mechanical; an expired hold blocks | computed QUIET, guarded `--release` (4.2, 5.2) |
| P1-3 rollback loses its marker | marker-last order + `rollback_started` (4.1) |
| P1-4 a partial failure restarts a mixed pool | only exit 2 restarts (4.2) |
| P1-5 I2 lets a new well authorize itself | frozen known_caps (4.1, 4.3) |
| P1-6 rollback ignores inventory | refused (4.1) |
| P2-7 duplicate key found after writes | precomputed rewrites + refusal (4.1) |
| P2-8 unusable not derived | replay (3) |
| P2-9 I6 cannot prove recovery | trailing-rate rule (4.3) |
| P2-10 converted pilot counted as isolated | mixed pools excluded (4.3) |
| P2-11 drop-in scan fails open | fail-closed (4.1) |

**r2, Claude CHANGE / CHANGE:**

| finding | handled in |
|---|---|
| P2-1 the hold runs short; release text | QUIET >= 240 and computed, guarded release (4.2, 6.3) |
| P2-2 any non-zero exit restarts; flock exit 1 | exit 2 only; `-E 75` (4.1, 4.2) |
| P2-3 strikes before an opening survive | replay drops them; test (3) |
| P3-4 header comment | fixed |
| P3-5 apply resumes a half rollback | refused (4.1) |
| P3-6 one T0 for three pools | per-pool runs (4.3) |
| P3-7 duplicate hazards in prompt lines | accepted: pricing uses the nearest site; prompt lines are capped at 4 and can repeat one place for at most one decay period. Noted, not changed. |

**r3, Claude DESIGN APPROVE / CODE CHANGE:**

| finding | handled in |
|---|---|
| P2-1 a reused hold is never extended | extend under the tick lock (4.2) |
| P2-2 QUIET frozen at claim, class ignored | recomputed at release; 24 h classes (4.2, hold helper) |
| P2-3 reuse with no hold; torn HOLD.json | non-empty live token; atomic write |
| P3-4 release journals regardless | verified gone first |
| P3-5 claimed hold kept after a first refusal | dropped when no transition |
| P3-6 rollback needs --quiet | recorded fallback |
| note: known_caps holds only the newest site gen | accepted: build_well digs only at the recorded site |

**r3, Codex CHANGE / CHANGE:**

| finding | handled in |
|---|---|
| P1-1 release races a conversion | rollout lock, every mode |
| P1-2 exit 2 restarts a mixed pool | restart only when uniform |
| P2-3 half rollback read as converted | refused before the no-op |
| P2-4 truncated strikes lose a mark | own mark kept when all 8 are newer than the opening |
| P2-5 I6 tail scaled | measured |
| P2-6 unreadable registrations skipped | refuse |

**r4, Claude DESIGN APPROVE / CODE APPROVE.** Its three P3s were applied: the hold is extended when release raises QUIET, the
extend write uses a with-block and fsync, and the truncated carry is now sound (below).

**r4, Codex CHANGE / CHANGE:**

| finding | handled in |
|---|---|
| P2-1 release falls back on a failed recompute | rollback only |
| P2-2 an interrupted transition is ignored | `owner-direct` counts; release refuses while unreconciled |
| P2-3 uniform env with a half rollback | status names it; restart refused |
| P2-4 truncated carry resurrects a mark | kept only when the opening predates u − 2·TTL; test with Codex's case |

**r5, Claude APPROVE / APPROVE** (P3s applied: journal order, not timestamp then phase; a run whose refusals restarted uniform
pools may drop its unused hold). **r5, Codex CHANGE / CHANGE:**

| finding | handled in |
|---|---|
| P2-1 an unsafe refusal clears reconciliation | a refusal that leaves units stopped is journalled `*-blocked`, which is UNSAFE |
| P2-2 reconciliation ignores the pool | rows carry a `pool` field; every pool's last row must be safe |

**r6, Claude APPROVE / APPROVE** (P3s applied: wording, a dedicated `contamination-accepted` row, the usage line).
**r6, Codex DESIGN APPROVE / CODE CHANGE:** P2-1, a uniform refusal whose restart failed was journalled SAFE. It is now
`*-blocked` unless every unit is verified active. Its P3s are applied: release journals its quiet period and WHY, and the
timing and the release invocation are clarified in 5.2a.

**r7: Codex APPROVE / APPROVE, Claude APPROVE / APPROVE** at 0ff5686f, with no P1 or P2 open. Both r7 P3 nits were applied in
the final commit: the `contamination-accepted` row is built after the 240 clamp, and it is journalled only after the hold is
claimed.

**Coordinator question (10-20):** exclusion vs hold, in 5.2a. The new `--accept-contamination` lowers the hold to the
240-min floor, as a journalled decision.

## 11. 10-22: the pilot's read, the accepted-quiet fix, and phase 2

### 11.1 What went wrong on 10-21

The owner accepted a 240-min quiet period. The journal row is `contamination-accepted` at 13:53:20Z: "quiet 240 below computed
420". `--release` then refused until 20:54Z, which is the last transition (13:54:21Z) + 420. The operator hand-set HOLD.json
`quiet_min` to 240 (backup `HOLD.json.bak-1754Z`, which shows 420) and released at 17:54:55Z.

**The claim did not write the 420; a refused `--release` did.** The evidence:

* The scheduler log shows the install-hold's `until` as 18:53:20Z on every tick from 13:55 to 17:50Z. That is the claim time
  (13:53:20Z) + 240 + 60, so the claim used 240. In the c6bea93b code, the claim writes the same `quiet` into HOLD.json.
* In the old code, `--release <owner>` with no `--quiet` passed the computed 420. `cmd_release` took max(recorded 240,
  computed 420) = 420 and refused. Because 420 > 240, it also wrote `quiet_min` 420 into HOLD.json and extended the hold.
* The log's last tick before the release was 17:50:01Z. The refused attempt fell between that tick and 17:54Z, so the log
  never showed the extended `until`.

STATE.md's "the claim recorded quiet_min 420" was the natural reading of HOLD.json afterwards. The mechanism was the release.

### 11.2 The fix (isolated2sharedhold.py, isolated2shared-direct.sh)

* **The wrapper tells the helper where QUIET came from.** The source is `cli` (an explicit `--quiet`), `computed`, or
  `recorded` (a rollback whose computation failed). It also passes the value computed now and the `--accept-contamination`
  text. The helper's last line is `QUIET <n>`, the effective quiet, and every later row and message uses it.
* **HOLD.json records the acceptance** as `accepted` = {quiet, computed, by, at}.
* **`effective_quiet()` decides.** It is pure and self-tested at import:
  * Suppose an acceptance is recorded and QUIET is merely the computed value. Then the accepted quiet stands, and the helper
    prints `KEPT`.
  * The exception is a computed value above the one the acceptance was made against, which means a longer-reading canary
    became ready since. Then that call uses the higher value, prints `RAISED: ...` with the remedy, and extends the hold. It
    does not overwrite the accepted floor, so the raise lapses if that canary leaves the queue. It is remembered as
    `raised_min`, which binds only a later call whose computation FAILS (an unreadable registration). An empty queue is not
    a failure: `quiet` exits 3 only when the scheduler status ran and lists every queue entry with none ready, and the
    wrapper then passes 0, so the raise lapses. A crashed or incomplete status is unreadable and holds the raise. A
    superseding acceptance clears `raised_min`.
  * An explicit `--quiet` still raises the quiet period, and the raise is recorded.
  * A re-acceptance against a new computed value is recorded, and the helper prints `ACCEPTED`. The wrapper journals
    `contamination-accepted` only on that line, so a refused call that recorded nothing writes no row.
  * An acceptance is made only by an explicit `--quiet` BELOW the computed value. A bare `--accept-contamination` is refused
    by the wrapper and ignored by the helper, so it can never re-attribute the owner's decision.
* **Two earlier P3s are fixed:**
  * Every refused release now extends the hold to last + quiet + 60 and checks the result. Before, it extended only when the
    quiet period rose, and it ignored a failed extension while still writing the raised value.
  * HOLD.json and the INSTALL-HOLD extension each go through the same `atomic_write` helper, in separate writes: tmp
    file, flush, fsync, replace, then a directory fsync. The tmp file is removed on failure.
* `H` and the canary-lock path can be overridden from the environment (`SCHED_HOME`, `I2S_CANARY_LOCK`). This exists only so
  the fixture test never opens the live lock. Production uses the defaults.

**Tests** (bots/test/isolated2shared.test.mjs, 44/44). They run the REAL wrapper and helper with the repo's real
holdtoken.py against a fixture home. flock, sudo, systemctl, date and sleep are fakes on PATH. The scheduler is a fake
canary-sched.py whose status table and queue each test writes. Journal rows are aged by rewriting their ts, so no clock hook
exists in the code. The cases:

* **10-21 through the wrapper:** apply with `--quiet 240 --accept-contamination` (computed 420), then a plain `--release`.
  At +239 it refuses, and HOLD.json keeps 240. At +240 it releases, and the scheduler hold is gone.
* **A new bag-fix canary** raises the quiet to 1500. The release refuses with RAISED, the hold is extended to last + 1560,
  and `quiet_min` stays 240. When that canary leaves the queue, the release goes through at +240.
* **A bare `--accept-contamination`** is refused, writes no row, and leaves the owner's acceptance untouched.
* **A later phase** keeps 240 (`KEPT`, and the `owner-direct` row says 240), and writes no second acceptance row.
* **An explicit `--quiet 480`** raises the quiet period and is recorded.
* **Mutants**, each with its anchor present and unique: release = max(recorded, computed), the old behaviour (refuses at
  +240 and writes 420; the import-time self-test also refuses it); the wrapper's source always `cli`; a claim that records
  the computed value; a refused release that does not extend the hold; the bare-acceptance refusal removed; I5 without the
  position fallback; a `--until` replay without its future-row skip (checked by hand).

### 11.3 The pilot's +180 BLIND was the instrument, not the exposure

At +180, I5 read "0 well disposals" and returned BLIND. The real rows say something else:

* **The first disposal came at +36 min.** isolated-b-Delta disposed at the cap at 14:29:08Z: 8 items tossed, cap=at_cap,
  bot.pos 357.5,75,159.5.
* **The position was cut off.** Its 300-char detail ends `... cap_end=closed at=357,74,160` exactly at the cap. `at_of()`
  rightly refuses a token there, because a cut token could look like a real one.
* **Every bot disposed.** Since the switch there have been 11 disposals at 357,74,160, by all five bots. In 8 of them the
  `at=` token is cut.
* **The installed tripwire reads OK now.** At +1331 min it reads TRIPWIRE OK, counting the 3 disposals it can position. I3
  shows 1 death in 136.7 bot-h, against 1 in 139.0 before the switch.

The cut token is the same in every isolated pool. Window: 10-21 12:00Z to 10-22 ~12:00Z; 120-140k rows walked per pool,
5 bots each.

| pool | cap | disposals | complete at= | cut at=, bot.pos within 2 of the cap | cut, elsewhere |
|---|---|---|---|---|---|
| isolated-a | 361,73,133 | 18 | 11 | 7 | 0 |
| isolated-b | 357,74,160 | 11 | 3 | 8 | 0 |
| isolated-c | 351,72,134 | 13 | 6 | 7 | 0 |
| isolated-d | 369,72,151 | 16 | 10 | 6 | 0 |

**Fix (isolated2sharedtrip.py).** `disposal_cap()` decides each row:

* A complete `at=` token decides alone. A complete token at another cap is never rescued by the bot's position.
* Only an unreadable token in a detail of at least 300 characters (the cap) falls back to `near_cap(bot.pos)`.

bot.pos rides into the row tuple inside a copy of `exp`, under `_pos`. `--until` replays a read as of a past time.

**Replay on the host** of the pilot's +180 read (`--since 2026-10-21T13:53:20Z --until 2026-10-21T16:53:20Z`):

* With the fix, I5 = 1 (placed by bot.pos) and TRIPWIRE OK.
* With the fallback removed, I5 = 0 and TRIPWIRE BLIND, which is exactly the 10-21 read. The replay's 44 smelt tallies match
  the recorded read.
* With the fix, the read at +1337 min counts 11 disposals (8 placed by bot.pos), matching the row count above.

### 11.4 Recommendation: do not require another observed disposal on isolated-b

The disposal has been observed, both in the rows and by the tripwire's own strict rule, which reads OK. The 10-21 BLIND was
the 300-char detail cap, which is "a cheap negative from an instrument that could not see a presence" (CLAUDE.md). Waiting
for one more disposal adds nothing.

Install the I5 fix before phase 2 instead. Otherwise each phase-2 pool's +180 read can come back BLIND for the same reason.
The odds:

* **Expected exposure.** Before the switch, the phase-2 pools disposed 13-18 times in ~24 h (0.55-0.75/h). That gives
  P(no disposal in 3 h) ≈ e^-1.6 to e^-2.25 ≈ 10-20% per pool with the fix.
* **Without the fix,** only ~60% of disposals are countable, so P(BLIND at +180) ≈ 25-40% per pool.
* **A BLIND is not a breach.** The procedure in 6.3 is to read again at +360.

### 11.5 Phase 2: isolated-a, isolated-c, isolated-d (nothing below has been run)

**Preconditions.**

* **The fixes are installed** (`install-i2s-hostfix-1022.sh`). It refuses while HOLD.json exists.
* **The slot is empty.** On 10-22 ~12:10Z, `plan` reported WOULD REFUSE for the live canary on hive-b and placebo-a.
* **fleet-recycle.timer is more than 30 min away.** The wrapper checks this.
* **The owner's 10-21 acceptance holds:** "240-min quiet per phase", made against a computed 420. Phase 2 makes a FRESH
  claim, which binds nothing to that acceptance. So: computed > 420 means ask the owner before passing
  `--accept-contamination`, because that would be a new decision. Computed <= 240 means drop `--quiet`, `--why` and
  `--accept-contamination` (the wrapper refuses an acceptance that lowers nothing). If no entry is ready, the computation
  fails: pass `--quiet 240 --why "<text>"` without `--accept-contamination`.

**The read-only plan, as of 10-22 ~12:10Z.** All three pools seed cleanly apart from the canary:

| pool | plinth cap | plinth records | composter | containers | world facts |
|---|---|---|---|---|---|
| isolated-a | 361,73,133 | 1 complete + 3 plan, all at that cap; 4 no-site records not copied | 351,72,143 | 22 | 120 sites |
| isolated-c | 351,72,134 | 5 complete | 354,78,150 | 16 | 114 sites |
| isolated-d | 369,72,151 | 1 complete + 3 plan; 4 no-site records not copied | 351,68,144 | 15 | 120 sites |

**The commands, on 10.0.0.31 as mike:**

```
cd ~/isolated2shared
python3 isolated2sharedhold.py quiet                      # the computed QUIET now (420 on 10-21 with toolkit-03 ready)
for p in isolated-a isolated-c isolated-d; do sudo node isolated2shared.mjs plan --pool $p; done   # each: no WOULD REFUSE
bash isolated2shared-direct.sh --quiet 240 --why "OWNER 10-21 01:30Z: 240-min quiet per phase" \
     --accept-contamination "owner (darrellmiller) 10-21 01:30Z" operator-claude isolated-a isolated-c isolated-d
#   expect: ACCEPTED quiet 240 below computed <CQ> / CLAIMED ...; quiet 240 / QUIET 240 / three DONE apply lines, each with T0
#   journal: contamination-accepted, then per pool owner-direct + apply-done (pool field set)
```

**The tripwire.** Run it per pool, each with its own T0, at +15, +60 and +180. The T0 is the stop time INSIDE that pool's
`apply-done` note ("isolated-a since <T0>", the same T0 as in the printed command), not the row's own ts. Run one pool
at a time; each run is a ~50 s full walk.

```
cd ~/isolated2shared && nice -n 19 python3 isolated2sharedtrip.py --since <T0 of isolated-a> --pools isolated-a
cd ~/isolated2shared && nice -n 19 python3 isolated2sharedtrip.py --since <T0 of isolated-c> --pools isolated-c
cd ~/isolated2shared && nice -n 19 python3 isolated2sharedtrip.py --since <T0 of isolated-d> --pools isolated-d
```

* **BREACH:** `bash ~/isolated2shared/isolated2shared-direct.sh --rollback operator-claude <pool>`, then record REVERT for that
  pool. A rollback is a transition, so the quiet period restarts from it.
* **OK at +180:** record KEEP for that pool.
* **BLIND:** read again at +360.
* **Comparator change.** After phase 2 no pool is still isolated, so the "still-isolated" comparator is empty and I7 prints
  `-` for it. I3 still judges each pool against its own PRE and the shared pools' POST.
* **Watch isolated-d first.** It had the most deaths before the switch (design 6.2).

**Release.** Once the last transition + 240 min has passed:

```
bash ~/isolated2shared/isolated2shared-direct.sh --release operator-claude
```

* **Before that time,** it refuses and names the time.
* **If a longer-reading canary was queued** during the hold, it prints `RAISED` and the time moves out. To keep 240 anyway,
  the owner must accept again: `--quiet 240 --why ... --accept-contamination ...`.
* **On success,** it journals `hold-released` with the effective quiet.

**Close.** Record KEEP or REVERT per pool in the journal and STATE.md, then mark memory SHIPPED. Archive (4.5) after the
last KEEP.

### 11.6 Review log (10-22, hostfix-1022; drawrec.sh's endpoint lines were reviewed in the same rounds)

* **r1.** Codex: DESIGN APPROVE, CODE CHANGE. Claude: DESIGN APPROVE, CODE CHANGE. Both confirmed the 11.1 reading of 10-21.
  * Codex P2s, all fixed: the i2s installer could leave a partial install, so it now rolls back all three files, verified;
    `--until` leaked future rows into `mixed`, so the walk now skips them; drawrec collapsed endpoints to a hostname, so it
    now compares normalized URLs; a pool with missing bot env files read as agreement, so it now needs exactly 5; the env
    parse differed from systemd on continuations and quotes.
  * Claude P2, fixed: a bare `--accept-contamination` re-attributed the owner's acceptance.
  * P3s fixed: the remembered raise (`raised_min`), `_pos` in the I1 detail, the I5 fallback only on a 300-char detail, the
    REPLAY disclosure, taking the lock before the precheck, no flock in a dry run, an empty `OLLAMA_BASE_URL`, and doc 5.2a.
* **r2.** Both DESIGN APPROVE. Codex CODE CHANGE: a re-acceptance left a stale `raised_min`, so it is now cleared. Claude
  CODE APPROVE with P3s: `raised_min` never expired on an empty queue, so it now lapses there; wording; doc 11.
* **r3.** Codex APPROVE / APPROVE. Claude CODE CHANGE: a crashed scheduler status read as "nothing ready". Fixed: the pure
  `status_ready`, `quiet` exiting 3 only on a complete table, and the wrapper matching the exit code rather than text, with a
  test and a mutant.
* **r4.** Codex APPROVE / APPROVE. Claude APPROVE / APPROVE. No P1 or P2 open.
