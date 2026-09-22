# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-22 12:01 UTC — **LIVE CANARY `shoreline-01` (9b572aa) on hive-a, hive-b, hive-d, board-c,
declared 11:58:17Z — DEPLOYED BY THE OTHER SESSION, NOT BY ME.** Fleet baseline `842e017+623b31`.
Ledger 57 decisions. **An open loop exists and it is not mine. Read it, do not start new analysis.**_

> # ⚠ A SECOND SESSION WAS RUNNING ON THIS FLEET TODAY. READ THIS FIRST.
> At **11:20:59Z**, while this daily session was mid-analysis, **another operator session deployed
> `pickup-sweep` (842e017) FLEET-WIDE** and rewrote the manifest (`run_id: pickup-sweep`,
> `declared_code_version: 842e017`, `canary_pool` empty, notes: "fleet-wide correctness, not a canary").
> It is also writing project memory. Its work is sound and was LEFT ALONE: 80/80 bots on one version,
> and the `pickup_skipped` change row fires 330×/23 bots in 12 min, so it did not ship inert.
> **Before doing anything, re-read the manifest and the journal — this file can be overtaken mid-session.**
> The owner's standing directive is ONE session per day; two autonomous sessions with deploy authority
> can each satisfy "one canary at a time" separately and violate it jointly. **This needs the owner's
> decision.** A PushNotification was attempted and did not reach (Remote Control inactive).

> **TWO COPIES OF THIS FILE EXIST.** The daily task reads `mcai-rl02/docs/reports/STATE.md` first and falls
> back to the repo copy. **If the two disagree, take the later `_updated` stamp, not the documented order.**
> Both copies are written together today. **Today's reports are in the REPO tree** (branch `veto-feedback`):
> `veto-faces-2026-09-22.md`, `status-report-2026-09-22.md`.

## ⚠ LIVE CANARY — `shoreline-01`, deployed by the OTHER session at 11:58:17Z
- **sha `9b572aa`**, pools **hive-b, hive-a, board-c, hive-d** (4 pools / 20 bots, the registered k=20 draw),
  half mix `{5080: 5, 3090: 1}` — **record the half of each drawn pool as a read covariate.**
- **Rebased onto the deployed baseline `842e017`** (verified: 842e017 is an ancestor of 9b572aa), so the
  `fleet-deploy` descent rule is satisfied. `canary-loop.sh shoreline-01` is alive and owns the reads.
- **CLAUDE.md: while a canary is deployed and unread, no new analysis starts.** That binds whoever reads
  this next. Close it before taking anything off the queue.
- **It must be decided and torn down before 24 Sep 00:00Z** (the program-read window). A +540 read from
  11:58Z lands ~21:00Z tonight, so there is room — but it is the LAST slot before the freeze.
- **My dual review of the BROADER proposal is at `~/digest/SHORELINE-01-REVIEW-EVIDENCE.md` on .31, WITH
  AN ADDENDUM THAT CORRECTS IT.** Read the addendum: **the shipped change is far narrower than what I
  reviewed** — only a natural log, only when the veto cause is exactly `liquid`, no liquid above, no lava
  on any face, no terrain overhead, and only while the bot is already standing dry/clear/solid at or above
  the target, re-asked immediately before `bot.dig`; `Movements` is never mutated. **That is independently
  the partition my review asked for.** Two objections survive, both prospective:
  - **POWER.** A 20-bot read on acquired wood against a placebo null of **sd 3.00 vs a canary-arm baseline
    of 0.64** (`sandbox/make-tree-fixture.py`). **INCONCLUSIVE is the most likely verdict and is a
    legitimate close** — do not let it be rescued by a mechanism number.
  - **DRIFT.** `pickupNearbyItems` still snapshots `drop.position` once (`skills.mjs:1240`) and retires
    each drop after one walk, so a drop carried by the flow the dig creates is abandoned. **If it reads
    NEGATIVE on acquired wood, look there first** — it is an instrumentation question (dig confirmed vs
    inventory delta), not a reason to revert the scoping.

## Fleet
- 80 bots / 16 Peaceful worlds. **`842e017` fleet-wide, ONE version on all 80 (`842e017+623b31`)**, verified
  by a version census (12-min walk, 8,258 rows, 80/80 bots, one string) AFTER the other session's 11:21Z
  deploy. Earlier today the fleet was `9fc3968+107160` (also verified, 45-min walk). `main` = 9fc3968;
  **842e017 is ahead of `main` and `main` has NOT been fast-forwarded to it.**
- **`main-pre-2026-09-22` was MISSING and has been created at `cfc1c58`.** The owner's rule is
  fast-forward `main` on every promote *and keep* `main-pre-<date>`; the overnight promotion did the first
  half only. Previous: main-pre-2026-09-20 (b1659c0), main-pre-2026-09-16b (08a3da2).
- Fleet gather success **22.2%** over 8,736 runs / 360 min (committed 2-week gate is ≥40%).
- **3 of 80 bots pinned ≥ 4 h** (`stuckwatch`, down from 5): hive-b-Comet at y=0, isolated-d-Alpha (drowning
  rows), isolated-d-Echo (`path_no_legal_move`). Two of the three are in `isolated-d` — **the wettest world
  in the fleet by today's measurement.** An operations alarm, not a fleet mechanism and not a canary endpoint.
- **keepInventory=true and doImmediateRespawn=true on every world.** Owner: stays ON through the program
  window, OFF fleet-wide after 27 Sep as its own registered program change, never a canary.

## The ledger, and the loop that closed ITSELF this morning (leaf-02)
Ledger holds **57** decisions. Newest: **leaf-02 KEEP** 22 Sep 04:43:47Z, then PROMOTED 04:53:28Z.
Verified this morning: `check-open-loop.py` (sudo) says "no open canary"; `canary_pool` and
`canary_code_version` empty; anchored `pgrep -af "canary-loop[.]sh"` → NONE; **no systemd drop-ins**;
`~/MANUAL-READS-UNTIL` already moved aside to `.expired-2026-09-21`.
- **STATE.md was stale by one canary and that is structural, not a mistake.** Yesterday's file was written
  12:05Z; leaf-02 was deployed 19:41Z. **A fresh session must read the JOURNAL and the LEDGER before
  trusting STATE.md's canary section**, which is already rule 4 of the re-arm list and earned its keep today.
- **leaf-02's KEEP reads like a failed gate and is not one**: `no_path_share_did = 0.072` against `<= 0.05`
  is a **WATCH** line, not a deciding gate. Correct under v23. Do not "re-open" it.

## The telemetry outage at ~11:24Z — real symptom, and my first diagnosis was WRONG
`Events.load()` began raising `WalkTooWide` **on a 30-minute window**; the same query worked at 11:15Z.
Mechanism is real: the stale `telemetry.py` sizes the **whole corpus regardless of `since_minutes`** —
1,124 mostly-empty `.gz` generations (0.42 GB raw, assumed 10.62 GB at 25x) + 0.38 GB live = est
**10.99 GB vs a 6.00 GB cap** — so once rotated history crossed the cap every walk was refused alike.
- **THE DURABLE DEFECT IS ALREADY ON RECORD, and is not mine:** `recovery-ladder-03` 3f2f9c1 (04:52Z
  today) — *"the telemetry walk-cap fix (c79d57b) is not on the deployed line, so today's promotion put
  the broken copy back on the host."* **Any deploy OR promotion reinstalls a window-blind telemetry.py.**
- **What today adds is why it surfaced when it did.** The estimate is a property of the CORPUS, not the
  query, so a window-blind lib sits harmless until rotated history crosses the cap. It crossed ~11:20Z —
  which is why the identical query worked at 11:15Z and failed at 11:24Z with no promotion in between.
  Both the 04:53Z promotion and the 11:21Z deploy had installed the broken copy; **which was in place at
  11:24Z cannot be separated and does not matter.** `fleet-deploy` restores golden at line 90 after a
  deploy; **whether the PROMOTE path does was never tested** — treat that as open, not as settled either way.
- **My mistake, which is the useful half:** I wrote a patch before diffing against the golden copy, and
  `~/mcai-analysis/lib/telemetry.py` **already had the fix**, in a better form (`predates_window(f, since)`
  shared between estimate and walk through ONE frozen glob, plus a second in-walk `read_chars` guard).
  Restored golden over it; my patch kept only as `telemetry.py.mypatch-2026-09-22`.
- Verified after restore, **both directions**: `since=30` → 18,780 rows/80 bots; `since=360` → 210,419
  rows/80 bots; **a 60-day walk is STILL refused** (OOM guard intact). `/opt` lib now matches golden.
- **Durable lesson:** during a fleet-wide deploy there is a window in which EVERY telemetry read on the
  host fails, and the canary loop reads through the same path. And:
  **`WalkTooWide` on a narrow window is never about that window.**
- **Before patching anything under `/opt/.../lib`, diff it against `~/mcai-analysis/lib/` FIRST.**

## SEED CANARY — CLOSED. Both +72 h reads taken; no KEEP/REVERT applies (no code change).
- **placebo-a +72 h** (00:03Z, positive control 3,225,930 rows / 80 bots / 132 kinds / 97.5 h):
  gather DiD **+29.3 pp** all-controls, **+32.7 pp** clean. Treatment 13.0% → 43.1% on 1,972 → 6,572
  terminal rows. Stock +7.818/bot-h. **Replicates the +48 h read (+29.1 / +32.1) to ~0.5 pp.**
- **placebo-b +72 h** (11:28Z, positive control 3,268,301 rows / 80 bots / 134 kinds / 97.5 h):
  gather DiD **+29.9 pp** all-controls (treatment 10.0% → 42.9%), **+33.6 pp** clean. Stock
  +15.886/bot-h; iron-pick share +27.1 pp.
- **⚠ THE CLEAN ARM WAS OOM-KILLED and was re-run.** The scheduled reader's clean walk died
  (`902677 Killed`) because I had several wide walks running concurrently while it started its 97.5 h
  walk. **A single 97.5 h walk takes ~29 GB of the host's 46 GB — run wide walks ONE AT A TIME.**
  `WalkTooWide` prices one walk, not two. Recovered by re-running with the reader's exact list.
- **THE SERIES, CLOSED** (all-controls / clean): placebo-a +48 h **+29.1 / +32.1**, placebo-b +48 h
  **+32.8 / +38.4**, placebo-a +72 h **+29.3 / +32.7**, placebo-b +72 h **+29.9 / +33.6**.
  Four reads, two pools, two timepoints, **+29.1 to +32.8 pp on all-controls every time.**
- **The precision caveat is NOT resolved and must not be quietly dropped.** The "clean" arm is **one pool**
  (placebo-c), the noisiest comparator available (null sd 0.608 at k=5 vs 0.313 at k=20); the all-controls
  arm carries real canary exposure. **Sign and size are not in doubt; precision is.**
- **The `isolated*` admission stays a PROPOSAL for a future read.** Changing the comparator after seeing the
  answer is choosing the comparator on the answer. It was correctly not slipped into these reads.
- Sample caveat still in force: the population is seeds on which the town SITES — flat, dry, low relief.

## THE `no_safe_target` VETO — a band the source called undecidable is CLOSED
Full read `veto-faces-2026-09-22.md`. Scripts `vetoread.py`, `vetowhere.py`, `pickupexp.py` in
`~/mcai-analysis` on **both** this Mac and .31.
- Denominator 8,736 gather runs / 80 bots / 360 min. `no_safe_target` = **1,878 = 21.5% of all gathers**,
  29.9% of failures. (unreachable 2,179 / 24.9%; no_path 1,669 / 19.1%; nothing_found 532 / 6.1%.)
- Across the **9,944** candidates named by those refusals, from **76 of 80 bots**:
  **liquid 68.1%, falling 25.6%, both 6.2%** → liquid-involved **74.3%**. Of 9,786 face labels,
  **lava is 4 = 0.04%.** `skills.mjs`'s own "bounded between 3% and 97%, too wide to decide anything on"
  is now closed. **It is water.**
- Positive control on the instrument: the `none` face bucket (2,536) and the independently computed
  `falling` cause (2,550) agree to **0.6%**.
- oak_log is **1,316 of the 1,878** refusals and 37.1% of all 3,545 oak gathers; sand 376 of 1,014.

### CORRECTION — queue item 3's hypothesis is not supported
Item 3 said *"leading hypothesis: the bots excavate and flood their own surroundings."* That predicts a
**uniform** share across pools, since every pool runs identical code. Measured: **8.4% (placebo-d) to 33.7%
(isolated-d) — 4.0x, sd 8.7 pp across 16 pools**, and 4x **within one arm** (placebo-c 33.5% vs placebo-d
8.4%). Each pool is its own port and world (verified: 16 ports, 5 bots each), so a pool difference IS a
world difference. **The refusal tracks the terrain a pool was given.** It does not prove zero self-flooding;
it bounds how much of the variance behaviour can carry.

## WHY NO CANARY TODAY — read this before spending the slot on the wood thread
Both engines were given the same written proposal independently (plus an open-source search of
mineflayer-pathfinder issues and Minecraft item-entity behaviour). **Both returned DO NOT CANARY**, agreeing
on two grounds:
1. **Underpowered by ~4x.** Recovering *every* one of the 1,878 refusals at the fleet's own 22.2% conversion
   is ~417 extra successes ≈ **0.69 sd** against null sd 0.313 on the items/bot-h ratio-DiD; realistic band
   +5% to +12%. **And the wood read is worse**: this project's own rig header measures the placebo null for
   wood at **sd 3.00 against a canary-arm baseline of 0.64.**
2. **A named mechanism by which it reads NEGATIVE**, verified in source here, not taken on trust:
   - `COLLECTBLOCK_ENABLED` is in **0 of 80** env files → `mustCollectManually` true for every block
     (`skills.mjs:988-990`) → **every gather digs raw and banks through `pickupNearbyItems`**.
   - `pickupNearbyItems` (`skills.mjs:1227-1249`) snapshots the drop position **once** (`:1240`) and returns
     on seeing the same entity twice (`:1236`). **It cannot chase a drifting drop** — and admitting
     water-adjacent targets is exactly what puts drops in moving water. That is **leaf-01's loss channel on
     a new candidate class**, and `skills.mjs:4904` already says so.
Two facts the proposal had not accounted for, both verified here:
- **`index.mjs:473-482`**: in the 14 bot-hours `6d1fdba` ran with `dontCreateFlow` off on the approach
  profile, **five bots died against zero in the windows either side.** Wider blast radius than the target
  filter, but it is the only measurement of this flag relaxed, and it points against.
- **`isExposed` counts water as an opening.** `water.boundingBox === 'empty'` — checked against
  minecraft-data 1.21.1 on the harness, not assumed (lava too). So the "WATER IS NOT AN OPENING" comment at
  `skills.mjs:1412` describes a fix that is **not in that function**, and **the liquid veto is the only
  remaining guard against targeting a block reachable solely through water.** Load-bearing twice over.
- **Face count is a fake axis.** `side_waterx1` vs `x4` predicts no physical quantity; a `<= N faces` gate
  would be `canary-gate-was-noise` repainted. If this is ever built, the partition with a mechanism behind
  each condition is: **above must be dry** + **at least one `air` open face** + **`*_log` only** (which
  excludes the 376 sand candidates for free — sand beside water is the drown-yourself-digging case and
  `dontMineUnderFallingBlock` does not protect it, because the sand is beside, not above).

**Nothing needed building.** `shoreline-log` (718426d, base 7dd3775) and `pickup-sweep` (842e017, base
9fc3968) already existed. Both pass the canonical runner: **shoreline-log 194/194, pickup-sweep 193/193.**

**`pickup-sweep` IS NOW SHIPPED FLEET-WIDE** by the other session (11:21Z), so it is no longer a
candidate — it is the code the fleet runs. Its exposure, re-measured here on the live sha rather than
trusted from its commit message: **777 of 8,741 gathers = 8.9%, 70 of 80 bots, 1.619/bot-h.** But
**74.3% of those runs are `dirt` and only 4.2% of log gathers are affected**, so do not expect it to
move the wood endpoint, and do not let a flat wood number be read as its failure. Its change row is
live and firing (330 rows / 23 bots / 12 min).

### The sandbox corpus — the test BOTH engines demanded, run today
Run `CORPUS=sandbox/corpus-wood.tsv REPEATS=5`, candidate `718426d` vs control `7dd3775` (the change's
own base — single-variable, verified 0 vs 4 occurrences of `shorelineExemptAt`). Scored `logs+N` from the
**inventory delta**.

| fixture | control | candidate | gate |
|---|---|---|---|
| `open` POSITIVE CONTROL | 12 logs / 5 runs | 9 logs / 5 runs | both arms take it — **PASS** |
| `canopy` | 0 / 5 | 0 / 5 | untargeted, as expected |
| **`shoreline`** | **6 / 5** | **8 / 5** | control must be `logs+0` — **PRECONDITION FAILED** |

**THE SHORELINE FIXTURE IS BLIND AND THE REASON IS STRUCTURAL.** It holds five logs stacked at y=70–74
and **only the basal one has a water face**; the other four are unvetoed, so either arm can take them.
The most the fixture can express is **one log per run**, against a measured run-to-run spread of 0–11
logs on the positive control. Its docstring's "the ONLY thing refusing is the liquid rule" is true of
*why the basal log is refused* and false of *what the run measures*.
**Do not cite `wood-shoreline-nosafetarget` as evidence either way until it is rebuilt** to offer ONLY
water-adjacent logs (a one- or two-log stump beside the pond, or water at every trunk level). Small fix,
and the rest of the corpus is sound — the positive control passes on both arms.
**This ran against `718426d`; the deployed canary is the narrower `9b572aa`. It does not bound it.**

**AND IT IS SYSTEMATIC, with one rule behind it.** Counting cells against each fixture's goal:

| fixture | goal | cells the veto refuses | legal cells that ALSO satisfy the goal | discriminates? |
|---|---|---:|---:|---|
| `shoreline` | gather 4 oak_log | **1** basal log | **4** above it | **NO** |
| `wetstone` | gather 1 stone | **2** wet stones | **5,526** dry stones | **NO** |
| `buried` | gather 1 oak_log | **1** enclosed log | **0** | **yes** |
| `open` | gather 4 oak_log | 0 (positive control) | all | yes, passes both arms |

**A fixture can only measure a refusal when the refused cell is the ONLY way to satisfy the goal.**
`wetstone` returned candidate `stone+3` / control `stone+5` against a `stone+0` line — that is not
leakage, it is both arms walking to one of 5,526 dry stones. **`wetstone` cannot currently detect the
leakage it exists for.** Fix: shoreline → make the pond-adjacent log the only log; wetstone → remove the
dry stone in range. Then re-run; the whole corpus costs minutes and its positive control is sound.

**`buried` produced ONE unexplained signal**: candidate `0,1,0,0,0` vs control `0,0,0,0,0` — one run
banked the fully-enclosed log. NOT attributable to the change (`isExposed` is false with stone on all six
faces, so `safeTarget` is never reached, and the exemption needs veto cause exactly `liquid`). n=1, no
mechanism, did not recur. **An open thread, not a leak** — and `buried` is the fixture worth re-running
at higher repeats, because it is the one that can see.

## Queue
1. **The 24–27 Sep program read.** Registration **IS committed** (`0627ddc`) — the standing wake-up is
   satisfied. **Window opens 24 Sep 00:00Z**; the fleet must sit on ONE `declared_code_version` for the whole
   72 h; any canary must be **decided and torn down before then**. `programread.py 72`.
2. **falls-02 — HELD until after 27 Sep, deliberately.** It is cheap and behaviour-inert, but "behaviour-
   inert" is a claim this repo has been wrong about twice (`canary-can-ship-inert`,
   `report-only-trips-the-death-gate`), and shipping an unvalidated instrument fleet-wide 36 h before a
   registered 72 h read is a bad trade. Worktree `mcai-falls` (fc28885), rebase onto 9fc3968.
3. **NAVIGATION / GATHER** — still the only failing committed metric, but **item 3's stated hypothesis is
   now corrected** (above) and **its named next change has been reviewed and refused** (above). What is left
   that is real: `unreachable` is 2,179 (24.9%), still larger than `no_safe_target`, and has had no
   `veto_faces`-grade instrument pointed at it. **That is the better-posed question.** Read any wood change
   on **acquired wood**, never on refusals avoided.
4. **The drifting-drop pickup.** `pickupNearbyItems` cannot chase a moving drop (above). `pickup-sweep`
   fixes a DIFFERENT bug (one unreachable drop abandoning the whole sweep) and does **not** fix drift — it
   still walks to a stale position, and now retires the drop after one walk. **These are two bugs; do not
   let the branch name imply otherwise.**
5. **owner-01c — the movement owner, third attempt.** Pre-flight landmine unchanged and still verified:
   `index.mjs:259` calls `runner.arb.installActuatorGate(...)` guarded only by `runner?.arb`, but that method
   does not exist outside `movement-owner-1`. Assert it exists and `bot.dig.__arbiterGated` is true before
   declaring attempt three. **ARBITER authorised for owner-01c only.**
6. **DROWNING — demoted.** Deaths cost 0.04% of bot-h. Health floor is "not at full health", NOT "below 5".
7. **`keepInventory` OFF — after 27 Sep**, a registered program change, never a canary.
8. **Extend `drawexposure.py`** — non-degenerate pre-period; exposure against the MDE-implied n.
   REPORT-only until calibrated.
9. **Teach the analyst the two-part OpenLoop test.** **TRAP: `pgrep -f canary-loop` SELF-MATCHES** — use
   `pgrep -af "canary-loop[.]sh"` and prove the detector reports DEAD before trusting it.
10. **The death gate's invented control denominator** (`control_bot_h = canary_bot_h * 7`). Calibrate or
    amend to UNREADABLE; prospective, pinned by `test_verdict_acceptance.py`.
11. **Restore the golden analysis lib after PROMOTIONS too**, not only `fleet-deploy --pool`. Today's
    incident. The durable fix is to land library changes on the bots line so deployed shas carry them.
12. Pocket-rung block floor (need+4 with 5 held). **13.** Pooling rule -12 (iron).

## Rules in force (docs/reports/recovery-ladder-registration.md)
**v24** (an own-line value that is None, NaN or ±inf is UNREADABLE, not a failure) — LIVE. **v23** (no single
canary death reverts by ANY path; gates carry `role: deciding|tripwire`) — LIVE. v22 WITHDRAWN unregistered.
v12 linkage, v14c, v15c movement guards, v16 (calibrate before revert; histogram slot order; bundles of two
**disjoint** changes), v17/v18, v19 (a change/linkage row must DISCRIMINATE — `changerowcheck.py` pre-deploy,
`license_change_rows()` at read time), **v21** (death gate on the LOWER BOUND of the rate ratio), the owner's
floor of **two** canary deaths, draws at deploy (12-h ledger exclusions, ±25% then ±40%, the inference half an
unadjusted covariate, never placebo-c/isolated), `fleet-deploy` refuses a `--pool` sha not descending from
`declared_code_version`, `CANARY_ENV` + the `/proc/<pid>/environ` assertion, and `fleet-deploy --pool` refuses
without a reader.
- **THE DRAW IS FOUR POOLS / 20 BOTS.** Null sd of the pool-mean ratio-DiD on items/bot-h is 0.313 at
  k=20/3 h vs 0.608 at k=5/3 h. At k=5 the floor is sd 0.262 — MDE ~51% at ANY window. `drawrec.sh` degrades
  4 → 3 → 2 and says which. **CLAUDE.md still says "randomize five bots"; this is the registered change to it.**
- `~/digest/RULES-IN-FORCE.md` is **AUTHORITATIVE** and matches `scripts/host/RULES-IN-FORCE.md` by md5
  (verified today). `~/digest/RULE.md`'s **header is nine days stale** (it still names recovery-ladder-01 as
  live) — this is COSMETIC: `analyst.py` reads only from `## v14c` onward and treats RULES-IN-FORCE as
  authoritative. Do not raise it as an alarm; do fix the header when RULE.md is next touched.

## RETRACTIONS still in force — read before using any 19 Sep noise number
- **The planted-effect positive control was an ARITHMETIC IDENTITY** (spread 7e-16 across f). Every
  "planted +30% → +30.0% ok" from `sweep/endpoints/candidates/halfdid/halfmix` is arithmetic, not evidence.
- **The inference half is NOT cleared as a confounder** (`llm.mjs:430`). UNADJUSTED covariate; the ±band STAYS.
- **"Time is not a design lever" is UNVERIFIED.** An operational breakage guard only, never a success criterion.
- **`leaf-01` is the counterexample to gating on mechanism and harm alone**: mechanism improved, deaths held,
  acquired wood collapsed −0.650 against a −0.5 gate.
- **The exhaustion mechanism for the wood gap is REFUTED by its own negative control** (radius gradient +7.4 pp
  worn vs +29.1 pp fresh). And the mobility framing that replaced it was **withdrawn as circular** — a run
  refused at the candidate filter never walks, so `distance_moved` is 0 by construction. The non-circular
  halves: the filter refuses **76.4% worn vs 33.1% fresh**, and among runs that DID travel fresh is still 2x.

## Standing wake-ups
- **Before any canary read, check `~/digest/RULE.md` and `~/digest/RULES-IN-FORCE.md`** against
  `recovery-ladder-registration.md`. RULES-IN-FORCE verified current today by md5.
- **Run `python3 scripts/test_verdict_acceptance.py` before and after touching the verdict path**, and
  `test_verdict_acceptance_mutants.py` OFF the bots host.
- **Nightly 00:12Z `~/programread.py 24` → `~/digest/programread.log`**; nightly 00:07Z iron-funnel. Last
  iron line: 11 raw iron / 16 ingots / 0 picks crafted, 10 gone, share 15.9% — **iron is falling**.
- Tier-1 local analyst every 30 min (`~/digest/*.verdict.json`); tier-0 digest `~/digest/latest.md`.
  `versions_ok=False` is the known build-suffix false-fail (`<sha>+<buildhash>`), not an alarm.
- `canarywatch.py` cron */10 (STALE + ORPHANED); `stuckwatch.py` cron :17/:47.
- **The program read window is 24–27 Sep. Keep promotions, canaries and world changes out of it.**

## Known false alarm — the analyst pages OpenLoop for the whole life of every canary
`check-open-loop.py` reports OpenLoop whenever the manifest declares a canary with no decision, which is the
NORMAL state from deploy to verdict. The discriminating test is the **anchored**
`pgrep -af "canary-loop[.]sh"` **plus** the deadline.

## Daily session rotation
- Desktop task `mcai-daily-session` starts a FRESH session at 06:08 America/Chicago (11:08 UTC).
- **The ledger is `/var/log/mcai/_canary-decisions.jsonl`** (not under /srv/mcbots). `check-open-loop.py`
  lives at **`/opt/minecraft-ai/scripts/check-open-loop.py` on .31** and needs sudo.
- **`~/mcai-analysis/arm-read.sh` DOES NOT EXIST** despite older re-arm text naming it. The loop takes a read
  as `cd /opt/minecraft-ai/scripts && python3 /tmp/<read>.py <M>` then `python3 ~/verdict.py <run> <M>`.
- **Telemetry row shape**: `Events.load()` rows are FLATTENED to `{bot, detail, name, raw, t}`. `r['bot']` is
  a **dict** (`.get('name')`), the event kind is `r['name']` (leading underscore for `logEvent` kinds), and
  everything else is under `r['raw']` — `raw.bot.tools` (per-tool `{slot, used, max}`, **the only place
  durability lives**), `raw.bot.inventory` (name→count, no durability), `raw.bot.pos`, `raw.code.version`,
  `raw.skill.{status, fail_class, detail, args, duration_ms}`.
  **A gather outcome is `skill.status` / `skill.fail_class`, NEVER a substring of `skill.detail`.**

## Standing constraints (verbatim from the owner)
- Full autonomy: deploy, canary, promote, tear down without waiting. Wake the owner on every promote or
  revert and on anything needing a human hand.
- No world changes to fix a bot (sandbox 10.0.0.30:25599-25602 only). Swimming is travel. No 192.168.19x
  network; no UniFi API on 10.0.0.1; never disable rpcbind; never touch the apt timer. One code canary at a
  time (a bundle of two **disjoint** changes counts as one). **Teardown is THREE steps plus killing the
  detached readers and clearing `~/MANUAL-READS-UNTIL`.** Deploy only via `~/bin/fleet-deploy`. Commit with
  `git commit -F -` heredocs. Two Codex passes per patch, then a smaller patch. Never share a live canary's
  inference endpoint/model; ARBITER OFF as the fleet default (authorised for owner-01c only). Never
  `git add -A bots` in a worktree with a node_modules symlink. Readers include rotated `.gz` generations.
  Lab SSH `mike@10.0.0.31` (bots) / `mike@10.0.0.30` (worlds); key `~/.ssh/id_ed25519`. Use `date -u`.
- Independent Claude **and** ChatGPT review, plus a real search of open source, issues and forums, before
  proposing to build — scoped to design changes, new research claims and deploy-impacting conclusions.
- Run any long-running shell script from a copy outside the tree you may edit (bash re-reads by byte offset).

## Worktrees
`mcai-leafb (9fc3968 = NOW MAIN)`, mcai-shore (shoreline-log 718426d, base 7dd3775 — the water relaxation,
reviewed and REFUSED as a canary today), **mcai-pickup (pickup-sweep 842e017, base 9fc3968, 193/193 green,
change row present — the strongest unspent candidate)**, mcai-anylog (7dd3775), mcai-digwatch (cfc1c58),
mcai-falls (fc28885 — falls-02), mcai-owner (owner-01c 93f5b8f), mcai-deathsites (b1659c0),
**mcai-rl02 (recovery-ladder-03 = docs/scripts branch)**, mcai-scene (sandbox harness).
**The main repo checkout is on branch `veto-feedback`**, which does **NOT** contain the live sha —
**read live source with `git show 9fc3968:bots/src/<file>`, never the working tree.** This bit today.
Scripts: `~/mcai-analysis` on this Mac and on .31; on .31 also `lib/` — the golden analysis library.

## Re-arm on a fresh session (monitors are session-local)
0. **A CANARY IS LIVE (`shoreline-01`) AND IT IS NOT MINE.** Items 1–4 apply immediately. Verify the loop
   with the anchored `pgrep -af "canary-loop[.]sh"` before assuming it is reading.
1. **Loop pages AND journal phases**: Monitor tailing **both** `~/digest/page.jsonl` **and**
   `~/canary-journal.jsonl` on .31, filtered to
   `verdict|error|flag|PROMOTED|REVERT|deployed|torn-down|KEEP|INCONCLUSIVE|read-|phase`, **new lines only**
   (`tail -n 0 -F`). **`page.jsonl` ALONE IS NOT A HEARTBEAT.** Neither file is complete — needsdrop-01's
   REVERT reached the LEDGER and neither. Treat silence as a reason to run the anchored pgrep.
2. **Local analyst**: Monitor running `bash ~/analystwatch.sh` on .31. **DO NOT FILTER ON MESSAGE TEXT.**
   **IT IS AN ALARM, NOT A HEARTBEAT** — `analystflag.py` prints NOTHING when there is nothing to flag, so a
   silent watch is indistinguishable from a dead one. **Confirm the analyst is alive from
   `ls -t ~/digest/*.verdict.json`, never from the monitor being quiet.**
3. **Death poll**: the loop runs `verdict.py <run> 0 --poll` every 5 min and pages on REVERT, so item 1
   covers it — **only if the loop is actually alive.** Verify with the anchored pgrep.
4. **If the loop is dead with a canary declared**: read the journal, take the reads by hand at their
   registered minutes, record with `check-open-loop.py --record` under sudo **BEFORE** touching the manifest,
   then promote or tear down (THREE steps + kill detached readers + clear `~/MANUAL-READS-UNTIL`).
5. **After any deploy OR PROMOTION, check the analysis library survived** — note the CWD, which the old copy
   of this list got wrong:
   `cd /opt/minecraft-ai && python3 -c "import sys; sys.path.insert(0,'/opt/minecraft-ai/scripts'); from lib.telemetry import Events; print(len(Events.load(since_minutes=30).rows))"`
   Expect ~18-19k rows / 80 bots over 30 min. If it raises `WalkTooWide` **on a narrow window**, the lib is
   stale — **`diff` it against `~/mcai-analysis/lib/telemetry.py` and restore that copy; do not write a patch.**
6. **The seed canary is CLOSED** — both +72 h reads are taken. No monitor, no further reads.
7. **RE-CENSUS THE LIVE VERSION BEFORE PUBLISHING ANY NUMBER.** The fleet moved twice today while this
   session was running (9fc3968 → 842e017 at 11:21Z, then a 20-bot canary at 11:58Z). Stamp every
   measurement with the sha it was taken on, as this file's readings are.
