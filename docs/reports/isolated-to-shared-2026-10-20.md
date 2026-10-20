# Isolated pools -> shared towns (isolated-a..d, 20 bots): measurements, design, rollout

_2026-10-20, written by an agent session for the coordinator. OWNER APPROVED about 12:45Z ("i agree do it all, get it working").
Fleet at writing: `9e7d9980` (cobblekeep-01, promoted 11:23Z) on 70 bots. bagbudget-01 `31416ee5` has been live on board-d and
hive-a since 11:35Z. Branch: `isolated2shared-on-9e7d998`, cut from the fleet sha. It changes **no bot code**: the changes are a
host tool, a wrapper, a tripwire, one test file and this document. Revision r2 folds in the r1 reviews (Codex CHANGE, Claude
CHANGE); section 10 lists each finding and how it was handled._

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
* keep the `install-hold` until the next canary's longest read window has passed the last transition (section 5.2).

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
| `town-chest-<H>.containers.json` | per container, a fold of every bot's entry in `at` order by chestfull.mjs recordOutcome's rules: an opening (full or took) clears strikes and the unusable mark; an unknown or unavailable keeps every strike (the last 8) and the latest `unusableUntil` since the last opening, from ANY bot. The `_` maps are merged leaf-wise: per container, and per need inside `_ingredient_miss`; the newest time wins. | two bots' failures are the town's evidence, as they would have been in one file (Claude r1 P2-6). A miss that a later `took` outdates is cleared by the readers' own rule (containerPickMiss / containerIngredientMiss). |
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

* `/tmp/mcai-canary.lock` is busy. The tool re-runs itself under `flock -n` unless the wrapper already holds the lock (Claude
  r1 P2-2).
* A canary is declared in the manifest, or any `mcbot@*.service.d/*.conf` drop-in exists.
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
resumes from the marker.

**`rollback`** (units stopped):

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
bash isolated2shared-direct.sh [--rollback] <owner> <hold-minutes> <pool>...
```

The wrapper does this, in order:

1. Takes `flock -n /tmp/mcai-canary.lock` for the whole run.
2. Runs `canary-sched.py install-hold <owner> <hold-minutes>`. If the slot is not free it refuses and releases the hold.
3. Runs a clean `plan` for every pool.
4. Per pool: writes the journal row `owner-direct`, stops the 5 units, runs `apply` (or `rollback`), starts the 5 units 12 s
   apart, and writes the journal row `apply-done` (or `rollback-done`), which carries the tripwire command.

If an apply does not complete, the wrapper starts the units again, journals `apply-refused` with the tool's `status` line, and
stops. The hold stays in place until it expires or until `install-release`.

### 4.3 `scripts/host/isolated2sharedtrip.py --since <stop ISO> --pools <p>[,...]` (read-only)

This is a full file walk of every bot over `[since − 24 h, now]`. The comparators are the still-isolated pools (same seed and
home, old config) and the shared pools, minus any declared canary. The last line is `TRIPWIRE BREACH ...`, `BLIND ...`,
`EARLY` (under 180 min with nothing wrong) or `OK`.

* **I1 CONFIG** (BREACH from +15 min). Every converted bot's newest row carries `exp.pool=<pool>`, `memory_scope=private` and
  `arm=town`. The bot also wrote its once-per-spawn licence rows after the stop: `_plinthfirst_mode policy=1 shared=1` and
  `_plinth021_mode shared=1`. These prove the **code path** took the config, not just the env (Claude r1 P2-5), and they are
  I2's instrument control.
* **I2 WELL** (BREACH). A `_plinth stage=planned` or a `_well_pit_dug` in a converted pool whose complete `at=` is not a cap
  the town already had. The known caps are the town record, the site gens, and every old per-bot record and site gen. At a
  known cap it is only NAMED (a rebuild of the town's own well; Claude r1 P3-9).
* **I3 DEATHS** (BREACH). Three or more deaths after the stop, AND a rate above 2x the pool's own 24 h PRE rate, AND above 2x
  the shared pools' POST rate. Fewer deaths are NAMED. Exposure is the capped-gap estimator.
* **I4 FURNACE** (BREACH). Two different bots of one converted pool inside one furnace session at once, neither unleased,
  counted from stop + 5 min + 240 s. The tripwire groups by the converted pool itself; smeltjobread's rule skips `isolated*`.
  Its self-test proves an overlapping isolated-b pair is seen (Codex r1 P1-1, Claude r1 P3-10).
* **I5 EXPOSURE** (BLIND from +120 min if missing). Per pool: at least one `_well_dispose` success at a known cap, and at least
  one `_smelt_job_tally` row (the job is on and was considered at town).
* **I6 COBBLE** (BLIND from +60 min, BREACH from +180 min). The fail-closed start must really close: `*_unknown` refusals with
  no `_stock_recount` that counted anything is a dead end.
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
**W_head + 60 min**, where W_head is the longest read minute of the queue head's registration at that time. The extra 60 min
let the restart transient (the first recounts and the first smelt trips) clear before the next PRE begins. The hold is the
wrapper's `install-hold <owner> <minutes>`, a mechanism that already exists. Every PRE of the next canary then starts after the
switch has settled, at every read, deciding or not. Nothing here is report-only (Codex r1 P2-7, Claude r1 P2-3).

**Cost, for today's queue.**

* Queued registrations: toolkit-03 reads [180, 360, 720]; ironpick-01, bamboo-03 and treefarm-03 read [180, 360]; foldwatch-01
  reads [180].
* With toolkit-03 at the head: about 3 h (the pilot's tripwire) + 13 h = **about 16 h of empty slot**.
* With a [180, 360] head: 3 h + 7 h = **about 10 h**.
* With foldwatch-01 first: 3 h + 4 h = **about 7 h**.

Queue order is the coordinator's and the owner's call (section 9).

The underground-safety and bag-fix classes (PRE 24 h, 24-h null bands) need **24 h** after the last transition. None is
queued.

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

1. **Pilot.** Into an empty slot: `bash ~/isolated2shared/isolated2shared-direct.sh <owner> 240 isolated-b`. The 240-min hold
   covers the 180-min tripwire.
2. Run the tripwire at +15 min (I1 must not breach), +60 and +180.
   * BREACH -> `--rollback` (hold W_head + 60), and record REVERT in the journal and in STATE.
   * OK at +180 -> record KEEP for the pilot.
   * BLIND -> read again at +360; the hold must be extended (`install-hold` again).
3. **The rest**, right after the pilot's OK, still inside the empty slot:
   `bash ~/isolated2shared/isolated2shared-direct.sh <owner> <W_head+60> isolated-a isolated-c isolated-d`.
   The hold is re-written to start now.
4. Run the tripwire for the three pools at +15, +60 and +180 (`--pools isolated-a,isolated-c,isolated-d`). The same decision
   rule applies, per pool.
5. When the hold expires, the scheduler resumes the queue. Do not `install-release` early: the hold is the analysis guard
   (5.2).
6. Record: KEEP or REVERT per phase in the journal and in STATE.md; memory SHIPPED. Archive (4.5) after the KEEP of the rest.

## 7. Evidence produced here

**Tests.** `node scripts/run-tests.mjs` (bots/) runs `bots/test/isolated2shared.test.mjs`: 18 checks.

* The constants and the record-state rule agree with plinth.mjs and with the real WorldFacts class's prune (behaviour, not
  text).
* foldContainer and mergeContainers work, read back through chestfull and withdrawpick.
* The world-facts union keeps its clocks, expires what the class expires, and the class reads the death sites back.
* choosePlinth and the env rewrite (exactly 3 lines).
* `plan` writes nothing (the whole tree is hashed).
* apply: backups, the seed, untouched old dirs, no stray `_pool-*`.
* **The composed chain on the seeded dir** (real plinthWant: `complete`), with its positive control (the newer no-site record
  makes it `plan`).
* Idempotence and resume.
* Seven refusals, each writing nothing.
* rollback keeps a later CODE_VERSION.
* **A real bot process on the converted env**: the world model is the seeded pool file, lessons stay per bot, the smelt job is
  on, records are shared, and the system prompt is byte-identical to isolated's (positive control: the `board` scope changes
  it).

Four anchored mutants are killed: copying the no-site records, dropping the canary check, a byte-exact env restore, and
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
for f in isolated2shared.mjs isolated2shared-direct.sh isolated2sharedtrip.py; do git -C <checkout> show <sha>:scripts/host/$f > ~/isolated2shared/$f; done
sudo node ~/isolated2shared/isolated2shared.mjs status            # all four: env isolated, town dir absent
sudo node ~/isolated2shared/isolated2shared.mjs plan --pool isolated-b

# PILOT, into an empty slot (python3 ~/canary-sched.py status | tail -3: DECISION not busy):
bash ~/isolated2shared/isolated2shared-direct.sh <owner> 240 isolated-b
cd ~/isolated2shared && nice -n 19 python3 isolated2sharedtrip.py --since <T0 from the apply-done row> --pools isolated-b   # +15, +60, +180

# REST, after the pilot's TRIPWIRE OK (W_head = the queue head's max read minute, e.g. 360 -> 420):
bash ~/isolated2shared/isolated2shared-direct.sh <owner> 420 isolated-a isolated-c isolated-d
cd ~/isolated2shared && nice -n 19 python3 isolated2sharedtrip.py --since <T0 of the first> --pools isolated-a,isolated-c,isolated-d

# ROLLBACK (any converted pool, any time between canaries):
bash ~/isolated2shared/isolated2shared-direct.sh --rollback <owner> <W_head+60> isolated-b
```

## 9. Owner decisions (none blocks the pilot; recommendations in bold)

1. Scope for the converted towns: **`private`** (only towns become shared), or `shared` (lessons pooled as well).
2. The post-conversion hold:
   * **the mechanical rule (5.2)**, which costs about 7-16 h of slot depending on the queue head; or
   * putting foldwatch-01 (reads [180] only) at the head for that window, which brings the cost to about 7 h.
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
