# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-27 12:00 UTC — **NO LIVE CANARY.** Fleet on **`268c074+b4d009`, ONE version, 80 bots**
(41,552 rows / 80 bots / one version in the 60 min to 11:55Z). Ledger **67**. Today:
**PLANTING WORKS AND IS MEASURED.** 986 saplings placed fleet-wide from a history of ZERO ever, and
**302 of 847 readable coordinates (35.7%) now hold a log against 2.07% ambient**. KEEP recorded.
**Nothing has been reseeded.** **AND I PUBLISHED A FALSE NEGATIVE ABOUT THE RESEEDER AND THEN BUILT A
DUPLICATE OF IT — corrected below in FINDING 5.** `scripts/reseed-pool.sh` exists, is better than what I
wrote, and had one real bug, now fixed. Reseed held until the 18:22Z read._

> # ⚠ TWO SESSIONS WERE LIVE IN THIS WORKTREE TODAY, AND THE OTHER ONE IS TALKING TO THE OWNER.
> At **12:13:34Z** a second session wrote `docs/reports/reseed-and-variance-memo-2026-09-27.md` into this
> worktree — **one minute before I wrote this file** — and I committed it by accident in `0cfa38c` before
> noticing. It says *"Owner has asked for fresh worlds twice and is asking again"* and *"the owner has asked
> three times"*, so **the owner has been interacting with it today and may already have answered things this
> file lists as waiting on him.** `ps` shows a resumed remote-control SDK session (pid 1519).
> **READ THAT MEMO BEFORE ACTING ON THIS FILE.** Its per-world growth table is real and is not in here:
> an **8.1x spread**, `placebo-b` 67.7% against `board-d` 8.3%, same code, same maturity cut. It also
> corrected me on `place-town.py` (below) and I have corrected it on `reseed-pool.sh`.
> **NEITHER SESSION HAS RESEEDED ANYTHING. Whoever goes first must check the other has not.**
>
> **TWO COPIES OF THIS FILE EXIST.** The daily task reads `mcai-rl02/docs/reports/STATE.md` first and falls
> back to the repo copy. **If they disagree, take the later `_updated` stamp, not the documented order.**

> **THIS FILE IS STRUCTURALLY STALE BY WHATEVER HAPPENS AFTER IT IS WRITTEN, AND IT WAS AGAIN TODAY.**
> Yesterday's copy said "NO LIVE CANARY, fleet on `efa2853`". By the time it was read, an overnight session
> had promoted `859af48` fleet-wide (23:27Z) and then `268c074` (06:22Z) on a fresh OWNER DIRECTIVE, and
> **neither promotion was in the ledger.** Re-arm rules 0 and 4, and read the MANIFEST before this section.

---

## ⚠ THE OWNER HAS NOW BEEN UN-NOTIFIED **SIX** DAYS RUNNING. THIS FILE IS THE ONLY CHANNEL.
PushNotification attempted again today — same "Remote Control inactive" failure as 22–26 Sep.

## OWNER CALLS WAITING
0. **PLANTING IS THE FIRST THING IN WEEKS THAT MOVED A REAL NUMBER, AND IT IS ALREADY FLEET-WIDE.** No
   decision needed to keep it. The decision needed is §1 below, and **the light defect** in TODAY'S
   FINDINGS 2 — 5% of plantings go where nothing can grow, and fixing it is a code change nobody has
   scoped.
1. **THE SIXTEEN FRESH WORLDS: reseed all 16, or hold four worn sentinels?** Your directive was "start
   fresh worlds". Both review engines prefer a staged reset keeping a few worn pools for 24–48 h, and
   **the reason is now stronger than when they said it**: planting works, so the only way to ever ask
   "does planting arrest depletion" is to have a worn pool left to compare against. Reseeding all 16
   destroys that question permanently. **Everything is built and dry-run; say 16 or 12+4.** Default if you
   say nothing: **12 + 4 sentinels**, which is what both engines asked for, and the four are reseeded
   24–48 h later so you lose nothing but time.
2. **THREE KEPT CANARIES STILL SIT UNPROMOTED** — `falls-02` is now promoted (it is in `859af48`), so this
   is down to `vetob2-01` (`efabf13`) and `banktruth-01` (`9a6aa13`). Both registered `promotion: none`.
   **Does `promotion: none` mean "measure then decide" or "never promote"?** (was call 0, unchanged)
3. **The 24–27 Sep program window.** Ended early by the 25 Sep fleet-wide promotion, and overrun twice
   more since by your own planting directive. **Restart, or abandon the concept?** (unchanged)
4. **The v21 death-gate lower bound** — trips on 0 of 15 death-involved reverts. A question about the
   BOUND. (unchanged)
5. **The audit (`8019b1d`) finds 7 of 23 reverts CONFIRMED FALSE and 5 more suspect.** (unchanged)
6. **Commits headed "OWNER DECISION" with no artefact recording one** — three over 24–25 Sep. (unchanged)

---

## WHAT HAPPENED WHILE NO SESSION WAS WATCHING (read it; do not re-derive it)
| when | what | recorded? |
|---|---|---|
| 2026-09-26 23:27:09Z | **`859af48` FLEET-WIDE** — promotion of `falls-02`'s fall-path recorder | **was NOT. Recorded today**, ledger 67 |
| 2026-09-27 06:22:00Z | **`268c074` FLEET-WIDE** — the planting obligation, on a fresh OWNER DIRECTIVE | **was NOT. Recorded today** KEEP, ledger 66 |
| 2026-09-27 01:00Z | a full second-engine review of the planting plan, `codex exec` | in the scratchpad only; its conclusions are in this file |

**The overnight session did the hard part and left the loop open.** It built and deployed planting, got a
serious review, wrote `docs/reports/planting-and-reseed-memo-2026-09-27.md` — and ended without taking the
+3 h read its own manifest note declared, and without committing the memo. Both are done now.

**`check-open-loop.py` CANNOT SEE EITHER OF THOSE.** A fleet-wide deploy leaves `canary_pool` empty, so
`canary_sha()` returns `''` and `--record` exits 2. Both were recorded by pointing `--manifest` at a
temp file naming the fleet-wide sha, which is the same shape the 25 Sep `drop5-01` promotion used.
**Queue item 1.**

---

## TODAY'S FINDINGS

### 1. PLANTING WORKS. The instrument is the COORDINATE, and it is not close.
Denominators kept apart, because the review was explicit that merging them is the whole trick —
**issued orders 1,002 → executed placements 986 → readable cells 847 → mature trees 302**:

| the recorded cell now holds | n | of 847 readable | **ambient** (same cells ±7, n=3,389) |
|---|---|---|---|
| **log** | **302** | **35.7%** | **2.07%** (log 9 + leaves 61) |
| sapling | 225 | 26.6% | **0.00%** (0 of 3,389) |
| air | 247 | 29.2% | 43.0% |
| dirt / other / water | 73 | 8.6% | 54.9% |

- **17x on growth, and the sapling row is the positive control**: 225 saplings stand against **0 of
  3,389** ambient cells. The instrument identifies presence, not only absence.
- **Air is NOT evidence of a destroyed sapling** — 29.2% at planted cells against **43.0%** ambient. Air is
  what this terrain is. It is still ambiguous between a popped sapling and a grown tree the fleet chopped.
- **All 16 worlds show growth** (log per pool 4…35, none zero), and all 16 read `control=OK`.
- 139 of 986 cells sat in **unloaded chunks** and are excluded from every rate: an unloaded chunk fails
  every block test and would have read as a destroyed sapling. `execute if loaded` is tested first.
- The channel opened on 80 of 80 bots: `_plant_spot` 28/29/30 per bot min/median/max in 290 min, **which
  IS the 10-minute cap** — so charging the cooldown on the SCAN is live and the 72-cell sweep is not
  running per decision. Both engines caught that bug; this is the evidence it is fixed.
- Saplings are 97.6% of the whole `place` channel now (891 of 913 rows), at **890 success / 1 failed**.

*Denominator: 986 plantings / 80 bots / 16 worlds over the 5.5 h from 06:22Z on `268c074+b4d009`.*

### 2. NAMED AND NOT FIXED: 5% of plantings go where nothing can ever grow
`y<55`: n=47 readable, **1 grew (2.1%)**, 25 still saplings. `y>=55`: n=801, **305 grew (38.1%)**.
`isPlantable` (`bots/src/skills.mjs:3076`) checks soil, a replaceable cell and the measured 5–7 block
column. **It does not check light.** Sapling growth needs light ≥ 9, so a dirt-floored tunnel with six air
above passes every predicate and can never grow. Queue item 3.

### 3. NO AGGREGATE HARM SIGNAL DETECTED IN THIS WINDOW — and that wording is deliberate
Equal 4 h windows either side of 06:22Z with the deploy hour dropped, 307 vs 320 bot-h:
`_death` 5 → 7 raw (0.016 → 0.022/bot-h, **under the owner's two-death floor, unmeasurable at this n**);
gather success 21.1% → 20.8% and 4.16 → 4.13/bot-h; skill invocations 47.4 → 49.6/bot-h.
**A fleet-wide before/after cannot credit an effect and cannot exclude harm masked by favourable drift** —
the per-pool ratio spread on this fleet runs 0.46–2.66. The second engine asked for "no aggregate harm
signal detected in this window" instead of "no harm" and it is right.

**THE DECLARED RESIDUAL HAS NOT BITTEN, and is still a residual.** `place` declares `args [item]` only, so
every planting shares one `learned_avoid` key and `priorFails>=4` could veto the whole channel.
`_rule_contradicted` post-deploy is 900 rows and **0 name place** (positive control: the top contradicted
subject is `gather:{"block":"dirt"}`); sapling place per hour 125/193/203/190 against `_plant_spot`
364/461/467/511. A closing gate shows place falling against a flat scan count. **Re-read at +12 h.**

### 4. TWO WRONG-NAME ZEROS, CAUGHT BY THE KIND CENSUS
The first harm script reported **`deaths 0` over 307 bot-h** and **`learned_avoid 0`**. The kind is
**`_death`**, and **the avoid gate emits no event of its own** — no kind in the 117 contains "avoid".
Both were caught by enumerating kinds before believing an absence. This is the fifth time this project
has bought a confident zero from a wrong field name, and it cost four minutes because of the census.

### 5. I PUBLISHED A FALSE NEGATIVE ABOUT THE RESEEDER, THEN BUILT A DUPLICATE OF IT
**`scripts/reseed-pool.sh` EXISTS.** 21,571 bytes, tracked, on `recovery-ladder-03` — the branch checked
out at `mcai-rl02`, where I was standing all day. I wrote and published that it "does not exist on either
host or in the repo", built a two-script replacement for it, and committed a paragraph explaining why one
command was impossible. **The second review engine cited `scripts/reseed-pool.sh:207` back at me.**

**How the negative got made, because the mechanism matters more than the mistake.** The memo said "`find`
across the repo, .30 and .31 returns nothing by that name" and **that was true of where it looked**: the
file is on `recovery-ladder-03` ONLY — `git ls-tree` finds it on no other branch, not `main`, not
`veto-feedback` — and it is never shipped to a host, because it is an operator tool that runs on the
operator's machine. The overnight session was in the main checkout and the plant worktree. **I then
inherited the claim and repeated it without running one `ls`.** That is the rule at the top of CLAUDE.md,
broken by me, on the day's largest piece of work: *every negative claim carries a positive control.* The
control here was one command.

**And my "one command is impossible" reasoning was wrong too.** There is genuinely no inter-host ssh —
verified both ways, and that part stands. But `reseed-pool.sh` runs on **this Mac** and ssh's to both
hosts, which is the obvious third position I never considered.

**MY TWO SCRIPTS ARE DELETED** — from the repo and from both hosts. Two implementations of one operation is
the `verdict.py`/`canary-loop.sh` double-copy failure this project already carries twice.
`reseed-pool.sh` is better on every axis: it journals each stage and **resumes**; it derives the roster,
the five state dirs **and** the pool dir from the host instead of guessing `/var/lib/mcai/<bot>`; it waits
for the service's own "Done" **plus** a live RCON answer rather than RCON alone; it places the town and
**then** pregens around it, which is the order the review prefers; it has a guarded `--new-seed` for a seed
with no placeable town; and its canary exclusion reads `canary_manifest.worlds_touched`, which handles a
within-world canary that a comma-split on `canary_pool` resolved to nothing — a guard that **once failed
OPEN and would have deleted a world with treated bots in it.**

**THE ONE REAL BUG IN IT, AND IT MEANT IT COULD NOT RUN AT ALL.** Its ledger-exclusion guard pipes a remote
`cat` into a **local** `python3` that did `sys.path.insert(0, '/opt/minecraft-ai/scripts/lib')` — a path on
the bots host. On the operator's machine the import raised `ModuleNotFoundError`, which exits 1, **which
the caller mapped to "refusing: $POOL had a canary decision in the last 12 h".** A missing dependency was
reporting itself as a ledger exclusion, so **the script refused every pool for a reason that was not
true.** It fails CLOSED, so nothing was lost. It has been broken since the `canary_manifest` guard landed
on **23 Sep — after the only two reseeds it has ever performed**, so that guard has never once run.
Fixed: the path resolves from the repo (`RESEED_REPO`, default `.`), and a new **exit 4** distinguishes
"the guard could not run" from "the guard said no". Both paths proven: good repo → `preconditions ok`;
bad repo → `refusing: the ledger guard could not run -- see stderr. NOT a ledger exclusion`.

**A second bug I introduced while fixing the first, recorded because it is CLAUDE.md's rule in a new
place.** That python body sits inside a **double-quoted shell string**, so a backtick in a *comment* is
command substitution. My first comment contained one and the dry run printed `cat: ...: No such file or
directory` out of a comment. The block now says so in capitals. Same family as "`git commit -m` with
double quotes silently eats backticked identifiers".

**WHAT STILL BLOCKS A 16-WORLD RESEED WITH THIS TOOL:** it refuses `isolated-*` and `placebo-c` by the
canary DRAW rule (`^(hive|board|placebo)-[a-d]$` plus an explicit `placebo-c` refusal), so it covers
**11 of 16 worlds**. That refusal is about drawing canary pools, not about reseeding. Queue item 2.

### 6. THE HOST's `place-town.py` HELD EIGHT WORLDS — and the REPO has had sixteen since 24 August
**I HAD THE DRIFT BACKWARDS AND THE OTHER SESSION CAUGHT IT.** `scripts/place-town.py` in this repo lists
all sixteen worlds and has since `853d118`, 2026-08-24. **The stale copy was the one on 10.0.0.30**, which
is the Aug-20 file. So this was never "a map that goes stale"; it was **a month-old deployment gap**, and
the fix I reached for first was the wrong shape.

**AND THE TWO ARE NOT COPIES — the repo holds a NEWER IMPLEMENTATION that was never deployed.** It does
`from probe import Survey, classify_execute_if, UnknownWorldState`, and `probe.py` is **not on .30 at all**.
I scp'd the repo file to the host, **broke it with `ModuleNotFoundError: No module named 'probe'`**, and
restored it inside two minutes from the timestamped `.bak` I had taken first — which is the only reason
this is a paragraph and not an incident. **Reconciling the two implementations is a real job with a real
dependency and it is queue item 6, not an end-of-session tidy.**

**What the host actually runs now:** the Aug-20 implementation with the world map **derived from the
filesystem** and both guards, verified `16 worlds; board-a 25672`. `scripts/host/place-town.py` is the
tracked mirror of that — the same role `scripts/host/RULE.md` and `scripts/host/canary-loop.sh` already
have — **not** a third implementation. `scripts/place-town.py` is untouched.

Why derive it rather than hand-list sixteen: the hand list is wrong again at thirty-two worlds, and its
index→port mapping is a guess that currently happens to hold. Derived — a fleet world is a directory holding `TOWN-PLACED.json`, which is exactly what
separates the 16 from `sandbox`…`sandbox4` (ports 25699–25702, no town) and `template` (no
`server.properties`). The value is still "the offset that yields the port", so all six importers keep their
meaning, and the fallback that was **wrong for eight of sixteen worlds** is right by construction.
`scripts/host/test_world_map.py` — **15 behaviour checks** on fixtures shaped like the real `/srv/block2`
and **4 mutants** (drop the town filter, restore the alphabetical index, drop the duplicate-port guard,
drop the partial-discovery guard), each asserting its anchor present and unique. **All killed.**

**PARTIAL DISCOVERY NOW REFUSES, and the review was right that it had to.** The first version silently
dropped a world with a town but no readable port, so **fifteen worlds could have become the denominator of
`for world in sorted(ARMS)` with no warning** — this project's confident-zero in the shape of a loop. The
two cases are now told apart: **none** readable is the unprivileged import (warn, fall back, say the c/d
ports are wrong), **some** readable is a genuine fault (refuse, name the world). Verified live: 16 under
sudo with `board-a` at 25672, and the fallback warning under `mike`.

**And two of my own tests were not testing what they said.** Case 2 asserted a townless-port world is
"excluded", which is exactly the dangerous behaviour — it now asserts the refusal. Case 4 claimed to test
the module-level fallback and could not reach it, because the module runs `_discover_worlds()` at IMPORT
against the real `ROOT`, before the test replaces it; the warnings I saw came from the real fleet, not the
fixture. It now imports a copy whose `ROOT` is already the empty fixture, and asserts both the 8-world
fallback and the word WRONG on stderr.

**Consequence: `fleet-doctor.py` computes `total = len(ARMS) * len(NAMES)`, so it has been checking 40 bots
on 8 worlds against an 80-bot fleet.** It now sees 16. Separately it **produced no output in 100 s under
sudo** — queue item 5.

### 7. BOTH POSITIVE CONTROLS IN THE GROWTH READ FAILED FOR THEIR OWN REASONS, AND ARE FIXED
`plantgrow.py` probed the first cohort cell, which is often in an unloaded chunk, so **three worlds read
`control=FAILED` while the channel answered perfectly**. `plantnull.py` probed `0 64 0` on the theory that
a spawn chunk is always loaded; these towns sit near 355,73,147 and it was loaded in **0 of 16 worlds,
every run**. Both now walk to a cell that is actually loaded. All 16 read `control=OK`.
**A control that fails for its own reasons is worse than no control**, because the next reader takes it as
evidence about the instrument.

## Fleet
- **80 bots / 16 Peaceful worlds. ONE version `268c074+b4d009`.** Manifest `run_id plant-20260927`,
  `declared_code_version 268c074`, `declared_at 2026-09-27T06:22:00.666606Z`, `canary_pool` and
  `canary_code_version` **empty strings** (note: empty, not `null`, this time).
- **The analysis library survived both overnight deploys.** The four golden files are md5-identical between
  `/opt/minecraft-ai/scripts/lib/` and `~/mcai-analysis/lib/`: telemetry `7b451486`, openloop `7d11f39a`,
  version_split `fd440348`, vocabulary `2cde98b9`. Only `.bak`/`.pre-restore` files differ. Queue item 6.
- Iron funnel 24 h / 1,439 bot-h: raw iron **3 (0.00/bot-h)**, 4 ingots, 0 pickaxes crafted, iron-pickaxe
  bot-hour share 14.9%. **The wall is depth** — 0.37% of 2,401 attempts, 84.7% tried at y≥48. Untouched.
- **FIVE `*-Charlie` units are still `failed` and it is BENIGN**: no env file, never started; 84 unit
  instances for 80 bots. **`reseed-bots.sh` derives its roster from the env files that exist, so it cannot
  start one by accident.** Deleting them is queue item 7.
- **keepInventory=true / doImmediateRespawn=true on every world.**
- **14 of 16 worlds share seed `1239381899` and the identical town at 355,73,147.** Only `placebo-a`
  (`8948499624371160708`) and `placebo-b` (`7843072457371465157`) differ — the 19 Sep reseeds, now eight
  days worn. RCON ports, read from each world's own file, not derived: hive-a/b 25670/25671,
  board-a/b 25672/25673, isolated-a/b 25674/25675, placebo-a/b 25676/25677, hive-c/d 25678/25679,
  board-c/d 25680/25681, isolated-c/d 25682/25683, placebo-c/d 25684/25685.

## THE PLANTING READ STILL TO COME — 18:22Z TODAY, AND IT IS SCHEDULED ON THE HOST
| what | value |
|---|---|
| read | +12 h, **2026-09-27 18:22:00Z** |
| mechanism | **`plant-read-12h.timer` on 10.0.0.30** (`systemd-run --on-calendar`), verified by running it once |
| cohort | **FROZEN**: `/home/mike/plant-cohort-frozen.tsv` on .30, 986 plantings, written 11:51Z |
| output | `/home/mike/plant-read-12h-<ts>.txt` on .30, and one line in `/home/mike/plant-read-12h.log` |
| registration | `docs/reports/plant-growth-registration-2026-09-27.md` — **written before the read** |
| PASS | mature ≥ **20%** of readable cells in the ≥10 h sub-cohort |
| FAIL | mature < **5%** with the ambient control holding → **BLOCKS THE RESEED** |
| UNREADABLE | ambient log/leaves > 10%, or ambient sapling > 1% |

**It is on the host and not in a session on purpose: the +3 h read was missed because a session ended.**
The cohort is frozen so it cannot be re-selected after the fact. .30 cannot reach .31, which is why the
cohort is a file rather than a query.

## THE RESEED — built, dry-run, guard-tested, AND NOT RUN
**Nothing has been reseeded. No world has been touched.** Held because the second engine's §8 says
*"do not reseed away the growth cohort before reading it"*, and the cohort's cells are in those worlds.

- `scripts/host/reseed-world.sh <pool> [--new-seed N] [--go]` → **10.0.0.30** at `~/scripts/`
- `scripts/host/reseed-bots.sh <handoff.json> [--go] [--keep-lessons]` → **10.0.0.31** at `~/bin/`
- **DRY RUN IS THE DEFAULT.** `--go` executes. **ONE POOL PER INVOCATION**, enforced.
- Archives, never deletes, under the same `.pre-reseed-<ts>` names the 19 Sep reseed used and which are
  still on disk: `world`, `TOWN-PLACED.json`, `/var/lib/mcai/<bot>`, `/var/lib/mcai/_pool-<pool>`.
- **EVERY REFUSAL HAS BEEN SEEN TO FIRE**, because a guard nobody has watched fail is not a guard.
  reseed-world: no `TOWN-PLACED.json`; two pools in one call; `--new-seed` equal to the old; non-root;
  a world that does not exist; **an existing archive target** (proven to refuse, then to proceed once
  removed). reseed-bots: non-root; missing handoff; two handoffs; a pool with no env files; a handoff
  missing keys; **a live `canary_pool`**. `RESEED_TS` and `MANIFEST` are seams that exist only so the last
  two are reachable.
- **Two defects found in my own code by those tests.** The canary refusal did not fire the first time — the
  test passed `env MANIFEST=...` at a path the script had hardcoded, so the guard was unreachable and the
  test read as a pass. And a thin handoff died with `POOL: unbound variable` instead of naming the missing
  keys, because the validator wrote to stderr while the caller `eval`s stdout.
- **WHAT A RESEED COSTS, stated because it is not optional.** Inventories live in `world/playerdata`, so
  archiving the world **destroys the 10,125 saplings the fleet is holding**, and `PLANT_RESERVE = 8` is
  **per species** — so the planting obligation is INERT in a reseeded pool until bots re-accumulate >8
  saplings of one species. **Time-to-first-`_plant_spot`-with-`ordered=1` is the number the first reseeded
  pool must be judged on.** Carrying `playerdata` across was considered and rejected: it places bots at
  coordinates chosen for different terrain, and it is the owner's "do not change the world to fix a bot".
- **THE POSITIVE CONTROL BEFORE SCALING, which is the second engine's §4 and is not negotiable:** one
  completed pool must pass town validity, env/coordinate agreement, restored service health, and
  **five real bots in the world by RCON `list`** — five ACTIVE units is not five bots in a world.

## Queue
1. **`check-open-loop.py` CANNOT SEE A PROMOTION.** A fleet-wide deploy leaves `canary_pool` empty, so
   `canary_sha()` returns `''` and `--record` exits 2 — and **two promotions went unrecorded in two days**
   because of it. This is the "merged but never closed" failure CLAUDE.md opens with, with the mechanism
   that was supposed to catch it looking the other way. **Make `open_loop()` raise on a
   `declared_code_version` with no decision against it.** Highest-value item on this list.
2. **THE RESEED ITSELF** — owner call 1, gated on the 18:22Z read. **Use `scripts/reseed-pool.sh` from
   the repo root** (`RESEED_REPO=$PWD ./scripts/reseed-pool.sh <pool> --go`), not anything I wrote.
   **It refuses `isolated-*` and `placebo-c` by the canary DRAW rule, so it covers 11 of 16 worlds** — that
   refusal needs to become conditional before a full-fleet reseed, and the change must not weaken the
   canary exclusion beside it. Remaining review findings to settle first, all from the 2026-09-27 pass and
   none of them mine to wave away: `WORLD_BORDER_RADIUS` is not in the handoff or validated;
   `horizontalDistanceFromSpawn()` measures from (0,0) while the server centres the border on the town
   (`bots/src/state.mjs:57`); `STATE_DIR`/`POOL_STATE_DIR`/`MEMORY_POOL` can override where state lives;
   `pregen-world.py`'s 256-block tiles are not chunk-aligned and span 272–289 chunks at a non-origin town,
   over the documented 256-chunk command cap, and it ignores command responses; and `place-town.py` writes
   `TOWN-PLACED.json` even when its placement commands only warn (`place-town.py:561,582`).
3. **THE LIGHT PREDICATE.** `isPlantable` does not check light, and `y<55` grew 1 of 47. Cheap, bounded,
   and it is 5% of every planting. Needs sandbox proof (`randomTickSpeed` 2000 under a ceiling is already
   the rig that measured the 5-and-6-block clearance).
4. **`place` declares `args [item]` only**, so all planting shares one `learned_avoid` key. Not biting yet;
   if it starts, the whole channel closes at once. Widening the key to include the coordinate is the fix.
5. **`fleet-doctor.py` produced NO OUTPUT in 100 s under sudo**, and it is named in memory as a
   ground-truth online check. An instrument that cannot finish is not one. Now 16 worlds, so slower.
6. **RECONCILE THE TWO `place-town.py` IMPLEMENTATIONS.** The repo's is newer and better (a derived pad,
   tri-state probes that can answer "I don't know") and **has never been deployed**; the host runs the
   Aug-20 one. The blocker is `probe.py`, which exists at `/opt/minecraft-ai/scripts/lib/probe.py` on
   **.31** and nowhere on **.30**. Both engines want this settled before a reseed runs through it. Do NOT
   scp the repo file to .30 without `probe.py` — I did, and it raised `ModuleNotFoundError` on import.
7. **Land the analysis library on the bots line so deployed shas carry it.**
8. **Delete the 5 orphan `*-Charlie` unit instances.**
8. **`container_open` 446 of 4,160 deposit rows (10.7%) is UNCHARACTERISED** — the one named deposit bucket
   nobody has read. Cheap.
9. **`storage_full` / place-a-chest — 907 chest-holding deposit failures in 24 h** across all four buckets,
   3.2x what `storage_full` alone scopes. Read on acquired stock, never on refusals avoided. Make the
   remedy deterministic, not advisory. **This was yesterday's item 1 and planting overtook it.**
10. **Consolidate the TWO schedule guards in `verdict.py`.** Both live, both tested, one invariant.
11. **`scripts/canary-loop.sh` (md5 `c3227ceb`) IS A STALE SECOND COPY** of `scripts/host/canary-loop.sh`
    (`0a01b3c1`, byte-identical to the host). Delete or symlink it.
12. **NAVIGATION / GATHER.** `unreachable` is the largest gather-fail bucket (8,911 in 24 h vs
    no_safe_target 7,963, no_path 7,658) with no `veto_faces`-grade instrument.
13. **`keepInventory` OFF** — a registered program change, never a canary. Re-time with owner call 3.
14. **Extend `drawexposure.py`** — non-degenerate pre-period. REPORT-only until calibrated.
15. **Teach the analyst the two-part OpenLoop test.** Use the **anchored**
    `pgrep -af "^bash /home/mike/canary-loop\.sh"`; **the bracketed form `canary-loop[.]sh` SELF-MATCHES.**
16. **17 existing WATCH lines: leave them.** Promoting them adds 2 false reverts and corrects none.
17. **`MEMORY.md` is 264 lines against a ~200 line load limit, so the tail is SILENTLY NEVER READ** — it
    truncates at line 201 and the warning now says so explicitly. Run `consolidate-memory`: the index needs
    **shrinking**, not more lines. **This got worse today, not better.**
18. **The `WalkTooWide` message names a remedy that cannot be performed.** The golden `predates_window()`
    is the fix.
19. **`deploy-fleet.sh` run directly as `/root/d.sh` SKIPS `fleet-deploy`'s golden-lib restore**, and
    CLAUDE.md points at that route while this file says `fleet-deploy` only. Reconcile.
20. **`~/digest/RULE.md` has NO tracked source of truth** and is 103 KB of hand-maintained duplicate,
    0.58-similar to the registration document with 139 unique lines. **`.bak` before every edit.**

## Rules in force (docs/reports/recovery-ladder-registration.md — current through **v32**)
**Unchanged today. No gate code was touched, so there is no new generation and no `GATE DIGEST` update.**
**v32** (the live gate code must be the registered gate code; `gatedigest.py` refuses a launch on a
mismatch) — **verified `OK` twice today, exit 0**, **v31** (a canary must NAME its instrument and its
CLASS; `licencecheck.py` refuses at launch), **v30**, **v29**, **v28c**, **v28b**, **v28**, **v27b**, v27,
**v26b**, v26, **v25**, **v24**, **v23**, v22 WITHDRAWN unregistered, v12 linkage, v14c, v15c, v16,
v17/v18, v19, **v21** (owner call 4), the owner's floor of **two** canary deaths, draws at deploy,
`fleet-deploy` refuses a `--pool` sha not descending from `declared_code_version`, `CANARY_ENV` + the
`/proc/<pid>/environ` assertion, and `fleet-deploy --pool` refuses without a reader.
- **THE DRAW IS FOUR POOLS / 20 BOTS**; `drawrec.sh` degrades 4 → 3 → 2 and says which. **Record the draw
  shape with every read. CLAUDE.md still says "randomize five bots"; the registered change supersedes it.**
- **THE REGISTERED GATE: bundle md5 `863a725917e4c32ac9b37a2fff37c5fc`** — `arms.py 9d563283`,
  `deathgate.py 450d32bf`, `singledeath.py 08bd12cd`, `verdict.py b3179121`. Read it with
  `python3 ~/verdict.py --gate-digest`; check it with `python3 ~/mcai-analysis/gatedigest.py`.
- **`~/digest/RULES-IN-FORCE.md` is AUTHORITATIVE**, md5 **`96b7be11`**, unchanged today.
  **`~/digest/RULE.md` md5 `746c65e4`**, unchanged today, tracked at `scripts/host/RULE.md`.
  **Neither rule file was edited today**, so nothing needed syncing. If you edit RULE.md: `.bak` first —
  it was destroyed by one careless `cat >>` on 26 Sep and only a timestamped backup saved it — and append
  to the END, because `analyst.py:12` takes a blind 20,000-character TAIL.

## RETRACTIONS still in force
- **`drop5-01`'s INCONCLUSIVE is an INSTRUMENT close, not a finding about the change.**
- **"stock 0.80 items/bot-h" was a per-version nominal line, not the program endpoint.**
- **`banktruth-01`'s "2,078 of 2,079 = 100.0%" is a tautology** (`admission.mjs:326`), **and it renamed
  the refusal rather than removing it** — "nothing matching X to hand" 250 rows → "you are carrying X,
  but …" 143 rows, still firing at a similar rate. Flagged 27 Sep, not addressed.
- **The planted-effect positive control was an ARITHMETIC IDENTITY** (spread 7e-16 across f).
- **The inference half is NOT cleared as a confounder** (`llm.mjs:430`); the ±band STAYS.
- **"Time is not a design lever" is UNVERIFIED** — an operational breakage guard only.
- **`leaf-01` is the counterexample to gating on mechanism and harm alone.**
- **The exhaustion mechanism for the wood gap is REFUTED by its own negative control.**
- **The sealed-cell retrieval-loss hypothesis is REFUTED at fleet scale** (−5.7% server ledger gap).
- **`owner-01b`'s own lines are UNRECONSTRUCTABLE** — false-trip rate **0/0, not 0%**.
- **`vetob2-01`'s KEEP is a GATE keep, not an effect.** `primary` is `_ADVISORY`; the effect is INCONCLUSIVE.
- **The deposit "median bankable carried ~300" is an UPPER BOUND on a looser definition** than queue item
  9's 55, and the two must not be compared.
- **NEW: `859af48`'s +42.3% items move is NOT creditable** — per-pool ratio spread 0.46–2.66 over n=12, a
  fleet-wide before/after. Recorded in the ledger as such.
- **NEW: planting's harm line is "no aggregate harm signal detected in this window", NOT "no harm".**

## Standing wake-ups
- **THE 18:22Z PLANTING READ IS ON A HOST TIMER, NOT IN A SESSION.** `systemctl list-timers
  plant-read-12h.timer` on **10.0.0.30**. If a session is alive then, read
  `/home/mike/plant-read-12h-*.txt` and record the verdict against the registration. If not, the next
  session must. **The reseed is gated on it.**
- **THE GATE DIGEST IS THE ANSWER TO "IS THIS THE REGISTERED GATE".** Do not grep for `vNN` — three
  generations hid that way. Run `gatedigest.py`. **If you change `verdict.py`, `deathgate.py`,
  `singledeath.py` or `arms.py`, update the `GATE DIGEST` line and register the generation IN THE SAME
  COMMIT**, or the next canary cannot launch.
- **A FLEET-WIDE DEPLOY IS AN OPEN LOOP THAT NOTHING RAISES ON.** Until queue item 1 lands, after any
  promotion record it by hand: write a temp manifest with `canary_code_version` set to the fleet sha and
  `canary_pool: "FLEET-WIDE (80 bots)"`, then `sudo check-open-loop.py --record <V> --manifest <that>`.
- **PUT `immobiledid` IN A REGISTRATION'S `reads` LIST** — `verdict.py` refuses the final read without it.
- **`deadline_min` ≥ `max(read_minutes)` + 30.** v30 refuses at launch.
- **A REGISTRATION NEEDS A `licence` WITH A CLASS.** v31 refuses at launch; 18 of 20 on file have none.
- **`licencecheck.py`'s BASELINE WINDOW IS 6 h AND INCLUDES A JUST-FINISHED CANARY'S OWN ROWS**, so a
  re-run of a canary torn down in the last 6 h is refused for a reason about the WINDOW, not the licence.
- **Run before and after touching the verdict path:** `scripts/test_verdict_acceptance.py` (83/83),
  `test_verdict_acceptance_mutants.py` **OFF** the bots host (33/33), `scripts/test_launch_guards.py`,
  `scripts/test_schedule_invariant.py` (set `CANARY_LOOP_PATH` on the host).
  **New, and run it before touching any world:** `python3 ~/scripts/test_world_map.py` on .30 — 9 checks,
  3 mutants, no root needed.
- **Nightly 00:12Z `~/programread.py 24`**; nightly 00:07Z iron-funnel. Tier-1 analyst every 30 min —
  alive, the 11:00Z run reads `fleet_healthy=True`, `versions_ok=True`, `prompt_tokens` 8,745.
- **WHAT THE ANALYST ACTUALLY READS.** `analyst.py:12` does `rule = rule[-20000:]` — a **blind 20,000-char
  tail** of the `## v14c`-onward slice — then prepends `RULES-IN-FORCE.md` in full. ≈8.7K tokens, which
  matches 8,745. **Nothing is being cut by `num_ctx` (24,576).** Two consequences: rules older than the
  last ~20 KB of RULE.md are already outside the window by design (that is what `RULES-IN-FORCE.md` is
  for), and **new rules must be APPENDED TO THE END** or the analyst never sees them.
- `canarywatch.py` cron */10; `stuckwatch.py` cron :17/:47; `monitor.py` */10 on BOTH hosts.

## Known false alarm — the analyst pages OpenLoop for the whole life of every canary
Normal from deploy to verdict. The discriminating test is the **anchored**
`pgrep -af "^bash /home/mike/canary-loop\.sh"` **plus** the deadline.

## Apparatus notes
- **`check-open-loop.py` is at `/opt/minecraft-ai/scripts/`, NOT `~/mcai-analysis/`.** Ledger:
  `/var/log/mcai/_canary-decisions.jsonl` (`MCAI_DECISIONS` overrides), **67 entries.**
- **Registrations live in `~/mcai-analysis/registrations/<run_id>.json`** (20 on file). **There is none for
  `plant-20260927`** — it is a fleet-wide deploy, and its read is registered in `docs/reports/` instead.
- **The preflight checkers live in `~/mcai-analysis/`:** `changerowcheck.py`, `licencecheck.py`,
  `gatedigest.py`. `v30check.py` is at `~/v30check.py`.
- **THE PLANTING READ SCRIPTS.** On .31: `~/mcai-analysis/plantcohort.py` (builds the cohort TSV),
  `plantread1.py`, `plantharm2.py`. On .30: `~/scripts/plantgrow.py`, `~/scripts/plantnull.py` (ambient
  control), `~/scripts/plantread12h.sh` (the scheduled wrapper). All tracked in `scripts/host/`.
- **THERE IS NO INTER-HOST SSH.** .30↔.31 both refuse, publickey. **But THIS MACHINE reaches both**, and
  that is where `scripts/reseed-pool.sh` runs — I reasoned from the host-to-host gap to "one command is
  impossible" and missed the operator's own machine.
- **`scripts/reseed-pool.sh` IS ON `recovery-ladder-03` AND NO OTHER BRANCH**, and is never shipped to a
  host. **Searching the main checkout or either host for it returns nothing and that is a FALSE
  NEGATIVE** — it cost a day's duplicate work. Run it as `RESEED_REPO=$PWD ./scripts/reseed-pool.sh`.
- **RCON on .30 is `127.0.0.1:<port>` with a PER-WORLD password in that world's own
  `server.properties`, which is root-only.** `place-town.py`'s vendored `Rcon` class is the client; never
  derive the port from a list index.
- **`execute if loaded <pos>` BEFORE any `execute if block`** — an unloaded chunk fails every block test,
  and 139 of 986 cohort cells were unloaded.
- **`fleet-deploy` finds the reader with `pgrep -f '^bash /home/mike/canary-loop.sh'`.** Launch the loop as
  `setsid bash /home/mike/canary-loop.sh <run_id> </dev/null > ~/canary-loop-<run_id>.out 2>&1 & disown`.
- **AFTER EVERY DEPLOY OR PROMOTION, diff `/opt/minecraft-ai/scripts/lib/` against `~/mcai-analysis/lib/`
  AND CHECK WHICH WAY THE DIFFERENCE RUNS** — and diff the FOUR files by md5, not the directories, which
  are full of `.bak` and `.pre-restore` noise that reads as a difference.
- **`Events.count_class` exists on the Events class, not in `lib/vocabulary.py`.**
- **Use `date -u`. Do not estimate elapsed time from the flow of the work.**
- **NEVER `open(p,'w').write(x)` when `x` might not be a string** — it truncates before it raises. Write to
  a temp file and `os.replace`. Every script written today does this.
- **`timeout` DOES NOT EXIST on the mini** (macOS). A `codex exec` watchdog needs
  `cmd & pid=$!; (sleep N; kill -9 $pid) & wait $pid` — the first pass today was lost to `command not
  found: timeout` and read as an empty review.

## Telemetry row shape and walk discipline
- Rows are FLATTENED to `{bot, detail, name, raw, t}`. `r['bot']` is a **dict** (`.get('name')`), kind is
  `r['name']` (**leading underscore for `logEvent` kinds** — `_death`, `_plant_spot`,
  `_rule_contradicted`), everything else under `r['raw']` — `raw.bot.tools` (the only place durability
  lives), `raw.bot.inventory`, `raw.bot.pos`, `raw.code.version`,
  `raw.skill.{status, fail_class, detail, args, duration_ms, inventory_delta}`.
- **THERE IS NO `decision` KIND and NO `death` KIND, and no kind contains "avoid".** A decision denominator
  is the sum of skill-name rows (`gather goto mine place deposit craft explore smelt home board bucket
  surface eat withdraw status`), ~48/bot-h. The avoid gate's visible channel is `_rule_contradicted`.
- **A gather or deposit outcome is `skill.status` / `skill.fail_class`, NEVER a substring of `skill.detail`**
  — but for `skill_error` the SUB-CAUSE is only in `detail`, and it is pathfinder prose.
- **`_plant_spot` detail is `found|none at=x,y,z item=<sapling> sap=N kinds=K ordered=0|1`.** The
  coordinate is the CELL the sapling goes in (`plantableSpotNear` returns `cell.position`,
  `skills.mjs:3117`), not the soil below it.
- **Full walks only**; `grep -a`; readers must include rotated `.gz` generations. A 24 h walk is ~880k rows
  and ~4 s; a 300 min walk is ~200k rows and 24 s.
- **A wide walk takes ~29 GB of the host's 46 GB — run wide walks ONE AT A TIME.**

## Worktrees
**`plant-on-859` = `268c074` is THE LIVE FLEET SHA**, and its worktree is in a **dead session's scratchpad**
(`/private/tmp/claude-501/…/5e1eb303-…/scratchpad/wt-plant`) — treat it as gone; the branch is on `origin`.
`promote-2026-09-26` = `859af48`. mcai-banktruth (`deposit-truth-msg` 9a6aa13 — KEPT, unpromoted),
mcai-deposit (`deposit-truth` 73acd47 — refused by both engines), mcai-shore (9b572aa), mcai-pickup
(842e017), mcai-leafb (9fc3968), mcai-anylog (7dd3775), mcai-digwatch (cfc1c58), mcai-falls (fc28885 —
falls-02 `37a68c3`, **now promoted in `859af48`**), mcai-owner (owner-01c 93f5b8f), mcai-deathsites
(b1659c0), mcai-place (`place-readback` 2d985b4 — **cherry-picked into `268c074`**),
**mcai-rl02 (`recovery-ladder-03` = docs/scripts branch)**, mcai-scene. Branch `veto-b2-01` = `efabf13`
(vetob2-01 KEPT, unpromoted).
**The main repo checkout is on branch `veto-feedback` at `2e9be81`**, which does **NOT** contain the live
sha — **read live source with `git show 268c074:bots/src/<file>`, never the working tree.**
**Uncommitted in `mcai-rl02` and NOT mine:** `bots/scripts/check-movement-writers.mjs` (modified),
`bots/test/movement-ratchet.test.mjs`, `scripts/botview.sh` (untracked). Left alone, third day running.

## Re-arm on a fresh session (monitors are session-local)
0. **VERIFY THE FLEET STATE YOURSELF — this file has been wrong about it three days running, and today it
   was wrong about the SHA, not just the canary.** Four checks: `check-open-loop.py`; `canary_pool` AND
   **`declared_code_version`** in the manifest; the **anchored** pgrep; and a census of
   `raw.code.version`. **A changed `declared_code_version` with no ledger entry against it is an open
   loop that nothing will raise.**
1. **RUN `python3 ~/mcai-analysis/gatedigest.py` FIRST.** One command; exit 0 = the live gate is the
   registered gate.
2. **CHECK `systemctl list-timers plant-read-12h.timer` ON 10.0.0.30** and read any
   `/home/mike/plant-read-12h-*.txt`. **The reseed is gated on that read and the owner is waiting on it.**
3. **Loop pages AND journal phases**: Monitor tailing **both** `~/digest/page.jsonl` **and**
   `~/canary-journal.jsonl` on .31, filtered to
   `verdict|error|flag|PROMOTED|REVERT|deployed|torn-down|KEEP|INCONCLUSIVE|read-|recorded|CRASH|refused`,
   `tail -n 0 -F`. **Neither file is complete; `page.jsonl` ALONE IS NOT A HEARTBEAT**, and **neither
   recorded either of the two fleet-wide promotions** — the journal's last entry is still `vetob2-01`'s
   teardown at 09:12Z on 26 Sep. Monitors expire at 30 min; re-arm. **An expiry with 0 events means
   nothing on its own.**
4. **Local analyst**: Monitor running `bash ~/analystwatch.sh` on .31. **DO NOT FILTER ON MESSAGE TEXT.**
   **IT IS AN ALARM, NOT A HEARTBEAT.** Confirm it is alive from `ls -t ~/digest/*.verdict.json`.
5. **Death poll**: the loop runs `verdict.py <run> 0 --poll` every 5 min — **only if a canary is live and
   the loop is alive.** Neither is true now.
6. **AFTER ANY DEPLOY OR PROMOTION, CHECK THE ANALYSIS LIBRARY SURVIVED:**
   `cd /opt/minecraft-ai && sudo python3 -c "import sys; sys.path.insert(0,'/opt/minecraft-ai/scripts'); from lib.telemetry import Events; print(len(Events.load(since_minutes=30).rows))"`
   Expect ~18–19k rows / 80 bots. Then md5 the FOUR files against `~/mcai-analysis/lib/` **both ways**.
7. **CHECK HOST FILE MTIMES BEFORE TRUSTING THIS FILE'S APPARATUS SECTION.**
8. **RE-CENSUS THE LIVE VERSION BEFORE PUBLISHING ANY NUMBER**, and stamp every measurement with its sha.
9. **CHECK WHETHER ANOTHER SESSION IS RUNNING** before editing shared files: `git log --oneline -5` and
   `git status` in **both** `mcai-rl02` and the main checkout — **today the main checkout held eight
   commits `mcai-rl02` knew nothing about, and an uncommitted memo that was the whole plan** — and
   `sudo tail /var/log/auth.log` on .31 for commands you did not issue. **Today: none but this session's.**
