# The showcase as the progress lane — start record and procedures (2026-10-25)

OWNER: 10-22 "start bare ground" (founding may spend the stockpile for founding only); 10-23 Q4 "the showcase gets each
building piece FIRST, gated by Paper plus a tripwire read on the showcase"; 10-25 "lets also do 3. where the showcase is
making progress and building things. we will integrate the new survival tactics as they are proven" (a survival fix
reaches the showcase only after it is KEPT on the fleet). Design of the world itself: `docs/reports/showcase-2026-10-20.md`
(VM 207, 10.0.0.40, 10 bots, gemma4 26B on the M4 Studio through `mike@ai.ticrcorp.com`).

The fleet is untouched by everything here: no fleet, queue, scheduler, manifest or fleet-bot change. The showcase is
invisible to every bench enumerator by construction (design section 4).

## 1. Host state before the start (read 2026-10-25 14:51-15:06Z)

| check | result |
|---|---|
| VM | `showcase`, up 5 d, load 0.35, 31 GB RAM (28 free), 299 GB free |
| Paper | `showcase-paper` active; peaceful, survival, `white-list` + `enforce-whitelist`, `online-mode=false`, seed 1020202620, 0 of 20 online |
| whitelist | the 10 `showcase-*` bots + `mike`; root cron sets `mike` spectator every minute (owner 10-21) |
| protected zones (what the bots read) | `/var/lib/mcai/_pool-showcase/protected-zones.json` md5 `e9d6e661`: 7 villages + `trial-chambers-home-se` (owner 10-21 #18). The repo copy now equals it byte for byte (section 3) |
| siting | `/srv/showcase/town-site.json` and `/var/lib/mcai/_pool-showcase/town-site.json` installed 15:03Z from `infra/showcase/town-site.json` at d55ce14d (md5 `b05f7f04`): home 0,70,0, `builds_core: true` (bare ground, no stamp), ring@1 W, seed avoid box = the trial-chambers zone box |
| brain | tunnel `showcase-studio-tunnel` active since 10-23 06:10Z; `/healthz` `{"ok": true, "model": "brain"}`; Studio launchd `com.mcai.showcase.proxy` running, no pause file (`GPU_RESERVED`, `brain01/LIVE`, `showcase/OFF` absent, `pause.d` empty) |
| brain replay on the new release | 15:05:48Z: 50/50 schema-valid, served `gemma4:26b` 50/50, system hash 50/50 match, p50 1.6 s, p95 2.0 s, PASS |
| timelapse | `showcase-tl.timer` every 15 min; last heartbeats 14:15, 14:30, 14:45Z all `ok`, `missing_24h 0 of 96`; videos daily/weekly/history timers present |
| ES shipping | filebeat active, acked 49, dropped 0 (15 min) |
| follower | hourly, observe-only (no `AUTO_FOLLOW`); fleet verified on d55ce14d (census 80/80 at 13:05Z, 60/60 at 14:05Z); its 24-h target is `fb8de72f` (ironsmelt-01) -- d55ce14d becomes eligible ~10-26 05:15Z |
| release | staged `d55ce14d-6dd0ded8-fdd64ead` (bootstrap: promoted junkout-01 sha = the verified fleet build), expected `code.version` `d55ce14d...+83e4d9` = the fleet's own; activated 15:05Z (symlink only, no bot running). Previous release `9e7d9980-...` kept for rollback |
| start gate | `showcase_ops.py gate`: **17 of 17 PASS** |

## 2. The start condition (owner O9: Paper + a no-harm bench read)

townplan-01 KEEP 10-24 15:15Z (promoted `2d1aa8c1`) and found-01 KEEP 10-24 21:45Z (promoted `21dd0ce1`) are the no-harm
bench reads; their Paper records are `docs/reports/townplan-found-paper-jit-1023c.txt`. `REQUIRED_KEPT` (draft at d55ce14d)
filled from the 10-25 journal and installed as `/srv/showcase/REQUIRED_KEPT`; every line is KEEP + promoted and an ancestor of
d55ce14d (checked with `git merge-base --is-ancestor` on the VM's clone):

toolkit-03 `34d3e5e9`, keepout-01 `f39471bb`, protectzone-01 `1f5b4b4e`, townindex-01 `c0fec812`, poolescape-01 `6e1afb52`,
chatgate-01 `3cc5f14d`, ironsmelt-01 `fb8de72f`, townplan-01 `2d1aa8c1`, found-01 `21dd0ce1`, junkout-01 `d55ce14d`.

Two draft lines are **dropped, with reasons**: `indexsearch-01` closed INCONCLUSIVE 10-23 15:21Z (unexposed) and was never in
a fleet build -- a search change, not a town-plan piece; `sortdeposit-01` is not built, and under Q4 a building piece reaches
the showcase FIRST, so it cannot be a prerequisite of the start -- it arrives through section 5.

## 3. The trial-chambers zone in the repo (the found Q3 gap)

`infra/showcase/protected-zones.showcase.json` = the live file (md5 `e9d6e661`). protectzone.test's DATA rule is now a pure
function `zoneShapeProblems`: villages are whole columns with a deep floor (unchanged); the trial chambers are the ONE reviewed
underground exemption -- exactly the owner's survey (x -16..84, y -43..27, z 69..160) padded 4, no `floor_y` (closed to everyone
inside it; survival digs excepted as for every zone), top >= 30 below the town's ground so ring@1's SE plots stay buildable; any
other kind or a second underground zone fails until it gets its own exemption. Positive controls for each refused shape; the new
DATA test was seen to FAIL on the old 7-zone file. found-compose's gap pin became "same zone ids, same boxes" (8 zones).
Branch `showcase-start-1025` (on d55ce14d: the found tests live there).

**Residual, named:** the trial box stops at y -47. A deep miner BELOW it (y -64..-48) whose way up is through the box must go
round it sideways (up to ~55 blocks); `mine`'s zone keep-out walks it off the footprint and survival digs are never refused,
so it is not a sealed trap, but it is the village "tunnel under a footprint" shape, and the composed escape chain is NOT
proved for it (Codex 10-25 P1). Disposition for the start: made OBSERVABLE, not proved -- the tripwire's S3 UNDER line
reports any bot below the box inside its footprint (WATCH) and TRIPs (stops the bots) when one stays there >= 15 min with
< 3 blocks moved. Reaching y < -47 from a bare-ground start takes a deep stair the bots cannot cut on day one. **Owner
question:** give the trial chambers the village shape (y0 -64, `floor_y -48`), which closes the case by construction -- a
change to the owner's zone, so the owner's call; until then a Paper scene of a miner under the box is the open proof.

## 4. The start plan (exact commands; everything as root on 10.0.0.40 via `ssh mike@10.0.0.40 sudo ...`)

0. Preconditions (done above): gate 17/17; zone baseline `/srv/showcase/trip/zones-baseline.json` taken from the 10-25 04:15Z
   nightly stage (before any bot), mirror compare INTACT on the 3 zones the mirror covers.
1. Make the follower unable to act, by mechanism (Codex 10-25 P1: stopping the timer alone leaves a running or lock-waiting
   service able to act after `start-bots.sh` creates AUTO_FOLLOW): the drop-in
   `/etc/systemd/system/showcase-follow.service.d/lane.conf` replaces ExecStart with `showcase_ops.py follow --observe-only`
   (installed 15:12Z, `daemon-reload`); then `systemctl stop showcase-follow.timer` and `systemctl is-active
   showcase-follow.service` = inactive. Why: `start-bots.sh` ends with `touch AUTO_FOLLOW`; the follower's target is `fb8de72f`,
   which lacks found-01 and junkout-01, so an acting follower would DUE -> `pieces_in` fails -> STOP the bots; and in the
   progress lane showcase pieces run AHEAD of the fleet, which an acting follower would roll back.
2. `/srv/showcase/bin/start-bots.sh` -- the gate again, envs, `mcshow@showcase-<Name>` enabled 12 s apart, then within 10 min a
   skill row on `d55ce14d...+83e4d9` and an llm row from all ten, then >= 90 % gemma4. Any failure stops all ten itself.
3. `rm -f /srv/showcase/AUTO_FOLLOW; systemctl start showcase-follow.timer` (observe-only from here; its rows keep the ledger).
4. Verify (+10 to +60 min): ten `joined the game` lines in `server/logs/latest.log`; `_townplan_mode` and `_found_mode`
   licence rows; a `_townplan op=root` row and `townplan-0_70_0.g1.json` in `/var/lib/mcai/_pool-showcase`; `_found` rows
   (the first table / chest / furnace placed into the plan's cells); the next timelapse frames (`/srv/showcase/timelapse/frames/
   {topdown,angled}/20261025/`) and the live map `http://10.0.0.40:8100`.
5. The tripwire: `/srv/showcase/trip/showcase_trip.py read --minutes 180 --json /srv/showcase/ops/trip-last.json` by hand at
   +30, +60 and +180 min; root cron `35 * * * * /srv/showcase/trip/trip-cron.sh` appends every read to
   `/srv/showcase/ops/trip.log` and runs `stop-bots.sh "tripwire: <verdict>"` only on rc 2 WITH a `VERDICT TRIP` line (argparse
   also exits 2; a crash exits 1 and is logged, never a stop). It skips the read when no `mcshow@` unit is active (intentional
   downtime). The far villages (outside the timelapse mirror's x,z -512..511) are compared daily against the nightly stage by
   `0 5 * * * /srv/showcase/trip/trip-cron.sh --far` (`zones-compare` exits 3 on a BREACH, which stops the bots).
   **Recovery after a tripwire stop** is a human's: read `trip.log`, fix or roll back the release, then `start-bots.sh` (its
   10-min verifier needs all ten on the expected build; it writes the run epoch `/srv/showcase/trip/RUN_SINCE`, and with
   `/srv/showcase/LANE` present it never creates AUTO_FOLLOW). The read then judges deaths, stuck, zones and plan defects only
   on evidence newer than the restart; earlier plan defects are printed, not judged again. **A structure BREACH is permanent**
   until the baseline is retaken: accepting one (a repaired or owner-accepted change) needs the owner's OK and then
   `showcase_trip.py zones-baseline --regions <a fresh copy> --out /srv/showcase/trip/zones-baseline.json`.
   **The town epoch** `/srv/showcase/trip/TOWN_SINCE` (`2026-10-25T15:13:00Z`, written by hand at the start, root) is the
   founding: the plan and found gates read their history from it, so it moves only with a new world. That history is bounded
   by log retention (logrotate 14 days): a placement older than that loses its G1 cover; the plan generations keep it.

**Tripwire lines** (`infra/showcase/showcase_trip.py` r2; each with its denominator): S0 liveness (TRIP 0 of 10 writing for
15 min, WATCH fewer than 10); S1 deaths (TRIP >= 4 inside any 180-min span -- the fleet's 0.0195 / bot-h gives ~0.6 per 180 min
on 10 bots, P(>= 4) ~ 0.3 %; WATCH 2-3; each death named, observed bot-hours printed); S2 stuck (bots still -- 3-D, no sample
gap > 5 min -- for >= 30 min to the window's end: WATCH only, never a stop: waiting at home is legal); S3 zones (Z1 a bot inside
a protected box >= 15 min with < 3 blocks moved: TRIP; UNDER a bot below the trial chambers inside their footprint: WATCH, still
>= 15 min there: TRIP; Z2 >= 60 refusals by one bot in 10 min: WATCH; refusals by op reported); S4 integrity (the protected
structures' PLACED-block cells -- structcount's BUILT palette + dirt paths + the trial chambers' tuff bricks, polished/chiseled
tuff, copper, vault, trial spawner, decorated pot; natural blocks such as logs, stone and plain tuff are deliberately NOT
counted -- vs the pre-start baseline: one removed or changed cell is a BREACH, TRIP; every chunk of the box must read `ok` now
and in the baseline, else UNKNOWN = WATCH, never OK); S5 town plan (townplanread D1-D5 and foundread G1-G5 over the showcase as
ONE shared pool: any > 0 is TRIP; a failed read is WATCH; no accepted plan after 60 min is WATCH -- zero defects with zero
exposure mean nothing). Baseline: the 10-25 04:15Z nightly stage (pre-bot), 8 zones, every box chunk `ok`; the mirror compare
reads INTACT on the 3 zones it covers; a one-cell mutant baseline reads BREACH (village and trial chambers).

**S6 SHOP (r9, 10-26, coordinator: the workshop's rows must never pass silently).** `showcase_trip.py` runs shopread (the
workshop's own read, installed beside it from a named sha: `/srv/showcase/trip/shopread.py` from shop-on-27babc1's
`docs/reports/shop-01-2026-10-25/shopread.py.txt`) over the showcase as ONE pool, rows from the town epoch.
- **TRIP** on the read's defect gates. They are sticky until acknowledged (`ack`), like S5:
  - H1 off_record: a placement in no record cell;
  - H2 clear_outside;
  - H3 zone: a mutation in a protected box;
  - H4 lease_overlap;
  - H5 felled_unplanted (a skipped replant is no obligation, owner 10-26);
  - H6 bag_loss: a lost material;
  - H7 unknown_stood;
  - H8 conformance: a completed workshop whose newest counted survey has F1 < 0.98.
- **WATCH**, from this run's rows only (RUN_SINCE), and never a stop:
  - stuck_on_cell, and a STALLED pool (stalled=true, with the cells waiting);
  - stuck_unwritten and replant_skipped;
  - the blind gates g5_unjudged, oracle_missing and zone_unknown;
  - a completed workshop with no survey (conformance UNJUDGED: the showcase has no survey job yet);
  - shopread missing, or the shop read failing.
- An EXPOSURE line for the shop (record, visits, placements, complete); zero visits reads UNEXPOSED.
- Tests: the selftest (S6 fixtures; plan_rows feet from a real log line, by shopread's own pos_of; a BROKEN shopread: S5 still
  read, S6 a WATCH, the shop acks kept, `ack` refused) and `test_showcase_trip_mutants.py --shopread <path>` (each mutant killed
  by an assertion).
- **A shop read that fails** (shopread missing, replaced mid-install, crashing) is a WATCH. It carries the shop acknowledgements
  through unchanged, so the next good read does not re-trip what a human acknowledged. `ack` REFUSES until shopread runs.
- **Named limits (r1 reviews, P3):**
  - **Retroactive zones.** History is judged against the CURRENT zones file and the current record head, so a protected box
    added later turns earlier placements into defects (as G5 does).
  - **One shop project key per pool.** shopread merges every shop project key in the pool dir; a second one (a moved plan
    home) is not reachable today.
  - **Permanent WATCH.** Once the workshop completes, "conformance UNJUDGED" stays lit until a survey job exists on the
    showcase. That WATCH means "not surveyed", not "damage".
  - **Repeated damage.** Each new failing survey is a new H8 item and trips again.

**Rollback.** `/srv/showcase/bin/stop-bots.sh "<why>"` (12 s apart, disabled, AUTO_FOLLOW off; the world, plan generations and
logs stay). Since r4 every `activate` checks REQUIRED_KEPT, so the pre-start release `9e7d9980` is REFUSED (it lacks all ten
pieces) -- by design: the showcase never runs without the town plan's pieces. The rollback for a bad release is the previous
release that passes REQUIRED_KEPT; for the start itself it is stopping, nothing else. Undo the start inputs: `rm /srv/showcase/REQUIRED_KEPT /srv/showcase/town-site.json
/var/lib/mcai/_pool-showcase/town-site.json` (the gate then refuses any restart). Nothing in the world is reverted: the
showcase never edits the world (design section 7), and a breach is reported, not repaired.

## 5. Procedure: a building piece reaches the showcase FIRST (owner Q4)

A building piece = a change whose purpose is building or the town (siting, storehouse, stations, plots, paths, farms,
monuments). It runs on the showcase BEFORE the fleet; the fleet canary follows as usual and decides KEEP.

1. **Build** on a branch from the showcase's CURRENT release sha (`jq -r .sha /srv/showcase/harness/RELEASE.json`), one change,
   named `<run>-show-on-<sha8>`. Reviews as CLAUDE.md scopes them (both engines + an open-source search for design or
   Minecraft/mineflayer/Paper behaviour). Full `npm test` from `bots/`.
2. **Paper.** The piece's own Paper scenes on a sandbox under the shared sandbox lock, PASS with a BASE control on the same
   scene; the record in `docs/reports/<run>-paper-*.txt`. No Paper PASS, no showcase.
3. **Register** the piece: one line appended to `/srv/showcase/PIECES.jsonl` --
   `{"run", "sha", "base": <the sha it builds on>, "kind": "building",
   "paper": {"result": "CANDIDATE_PASS", "sha": <the sha the Paper ran>, "record": <docs/reports/... path>},
   "reviews": [{"engine": "codex", "verdict": "APPROVE", "sha": <the approved sha>, "round": "r6"}, {"engine": "claude", ...}],
   "tripwire_extra": <the piece's own defect gates, or null>, "owner": "10-23 Q4"}`. Every sha is 40 hex. The paper and
   review shas must be the line's `sha`, or an ancestor of it with ONLY `docs/` changed since (the review record committed
   after the approval); free-text reviews never count. A re-stacked piece gets a NEW line naming its re-stacked sha.
4. **Deploy to the showcase** (AUTO_FOLLOW stays OFF while any piece is ahead of the fleet):
   `showcase_ops.py stage <sha> --piece <run>[,<run>...]` -- BUILT 10-25 (branch `showcase-stage-piece`; see the note below;
   nothing may be staged by hand around it). `activate --lane` and piece-aware rollback are not built yet. The build item, on main's `infra/showcase/showcase_ops.py` + `test_showcase.py`, with Codex's 10-25 P1s
   as its acceptance:
   * `stage --piece`: the current release is the sha's ancestor; a PIECES line names it with a Paper PASS; REQUIRED_KEPT still
     passes against it; RELEASE.json carries `piece: <run>` and `prev: <release>`;
     **BUILT 10-25 (branch `showcase-stage-piece`, owner: a STACK -- matset-01 + mats-01 + shop-01 -- stages together):**
     `showcase_ops.py stage <sha> --piece matset-01,mats-01,shop-01`. The rule is `piece_stack_refusal()` (pure, tested): the
     current release is the tip's ancestor and the stack adds commits; every named run's NEWEST PIECES line is kind `building`
     (a structured Paper PASS and a Codex AND a Claude APPROVE, each of the line's sha: step 3) or `survival` (KEEP and a
     promotion naming its sha in the follower's journal); every piece's sha is an ANCESTOR of the tip and its base is the stack's
     ancestor; EVERY commit in `release..sha` lies in some named piece's own range `(base, sha]` (no unreviewed commit rides
     along; the tip's ancestry is not enough); no REVOKED sha is in the stack (by ancestry or as a cherry-pick). The command
     runs only in the lane (`LANE` present, `AUTO_FOLLOW` absent), on a verified observation (its policy and dependency
     digests), with REQUIRED_KEPT checked against the stack; EVERY refusal is journalled `piece-refused` in ops/deploy.jsonl.
     RELEASE.json carries `piece: [runs, sorted]`, `prev: <release sha>`, `prev_release: <the harness release dir>`; a cached
     release is reused only for the same piece record, and a plain stage never reuses a piece release. Stage only: activation
     is `activate <release>` as before. `activate --lane` and piece-aware rollback below are STILL NOT BUILT.
     **r2 (Codex r1 CHANGES: 1 P1, 1 P2, 2 P3; Claude r1 CHANGES: 1 P2, 4 P3):** the paper and the reviews are structured and
     bound to the piece's sha (above), so a line whose sha moved past its approval is refused; a SURVIVAL piece needs a
     recorded KEEP and a `promoted` row naming ITS sha (`survival_kept`; followrule.kept_runs ignores the sha, and
     `owner-direct` does not count for a piece); patch equivalence is NOT membership (the stray rule needs ancestry, so it
     could only ever fail closed): a piece's line names the sha actually in the stack.
   * `activate --lane`: restarts and verifies ALL TEN (not only the running ones -- with AUTO_FOLLOW off `activate()` today
     verifies only active bots, and after a stop it only switches the symlink);
   * piece-aware rollback: `release_admissible()` judges against the fleet build, so a showcase-only previous release is
     "inadmissible" and a failed activation STOPS instead of switching back. The lane needs "the previous release is a SHOWN
     piece release or a fleet-admissible one" as its rule. Until then a failed piece activation stops the bots (safe, manual
     recovery), which the procedure accepts.
5. **Tripwire read on the showcase**: `showcase_trip.py read --since <activation ISO>` at +60 and +180 min, plus the piece's own
   gates. SHOWN needs EXPOSURE, not only zero defects (Codex P2): the piece's own rows / placements present, and the read's
   EXPOSURE line non-zero for what the piece touches; an unexposed +180 reads on, never SHOWN. TRIP -> the previous release
   (`activate --lane <prev>`; until built: `stop-bots.sh`, `activate <prev>`, `start-bots.sh`, `rm -f AUTO_FOLLOW`), and the
   piece goes back to step 1 with the tripwire text. +180 clean and exposed -> **SHOWN** (a line in
   `/srv/showcase/ops/deploy.jsonl` and in STATE.md); it then enters the fleet queue as a normal canary.
6. **Converge.** The lane drop-in (`showcase-follow.service.d/lane.conf`) comes off only when the follower's OWN eligible
   target -- the newest promoted sha that stayed 24 h inside the fleet, which can lag a promotion by a day (Codex P2) -- contains
   every piece the showcase runs. A piece the fleet REVERTS is removed from the showcase at the next release (a release without
   it) and written to `/srv/showcase/REVOKED`.

## 6. Procedure: a survival fix KEPT on the fleet reaches the showcase

A survival fix = deaths, drowning, lava, falls, entombment, stuck, escape. It reaches the showcase ONLY after the fleet KEEP
(owner 10-25), never first.

1. **Precondition**: the journal has `recorded KEEP` + `promoted <sha>` for the run (the follower's `kept_runs` reads this from
   the feed).
2. **If no showcase-only piece is outstanding** (the showcase release is an ancestor of the promoted sha): the existing path --
   `showcase_ops.py stage <promoted sha> --bootstrap` then `activate`; or, with AUTO_FOLLOW on, the follower does it once the
   sha has stayed 24 h inside the fleet.
3. **If showcase pieces are ahead of the fleet**: a branch `<run>-show-on-<showcase sha8>` = the showcase release + the fix's
   commits (`git cherry-pick <base>..<promoted sha>`). A conflict is a reviewed rebase (Codex on the range-diff, as
   `prepare-variant.sh` records it). Full `npm test`. Stage with `--piece <run>` and `"kind": "survival"`, `"kept": <journal
   rows>` in its PIECES line (the `--piece` check also requires `pieces_in` to find the run kept and patch-equivalent in the
   release). REQUIRED_KEPT gains the run's line (`<run> <promoted sha>`) only AFTER the fix is SHOWN (Claude verify P2: before
   that, every activation would refuse the previous release, which is the rollback); from then `pieces_in` checks this run's
   KEEP + promoted rows and its patch-equivalence on every later deploy. Note: `kept_runs` matches the run name, not the sha in
   the promoted row (both reviews, P2, open). No Paper re-run is
   needed beyond the fleet's own record unless the cherry-pick conflicted.
   **NOT SUPPORTED by the built `stage --piece` (10-25 r3, Codex r2 P3):** its survival check (`survival_kept`) needs a
   `promoted` row naming the piece line's OWN sha, and membership is by ancestry, so a cherry-picked fix (a new sha) can
   satisfy neither. Until a reviewed binding between a promoted sha and its re-stacked sha exists, a survival fix reaches the
   showcase only by step 2 (no showcase-only piece outstanding), or by the fleet promoting a sha that already contains the
   showcase's pieces; and `pieces_in`/REQUIRED_KEPT is not this step's check (the stack rule is).
4. **Tripwire read** as 5.5: `showcase_trip.py read --since <activation>` at +60 and +180; TRIP -> back to the previous
   release. A survival fix is never judged by the showcase (one pool, no control): the showcase only refuses it if it broke
   something the owner protects.
5. Record: deploy.jsonl and STATE.md (`SHOWCASE <run> <sha8> SHOWN` or `ROLLED BACK <why>`).

## 7. Review record

**Codex (read-only), 10-25 ~15:08Z, on the plan r1 + showcase_trip.py r1 + the zone commit: CHANGE (5 P1, 5 P2).**

| finding | disposition |
|---|---|
| P1 S2 would stop the showcase on three bots legally waiting at home; ignores vertical movement and sample gaps | stuck is WATCH only; 3-D movement; a sample gap > 5 min restarts the spell (selftests) |
| P1 per-bot plan re-keying breaks shared-town G1/G3/G4 | every showcase row judged as ONE pool `showcase` |
| P1 the underground escape is unproved | not proved; made observable: S3 UNDER (WATCH; TRIP still >= 15 min); owner question for the village shape (section 3) |
| P1 holding only the timer is insufficient | the observe-only drop-in makes AUTO_FOLLOW inert by mechanism; timer stopped, service checked inactive |
| P1 the procedures promise unsupported activation / rollback | section 5 says the lane cannot run until `stage --piece`, `activate --lane` and the piece-aware rollback rule are built; a failed activation meanwhile STOPS (safe) |
| P2 zero defects can mean no exposure | EXPOSURE line; WATCH when no accepted plan after 60 min; SHOWN requires exposure |
| P2 the death denominator | max deaths inside any 180-min span; observed bot-hours and the fleet expectation printed |
| P2 integrity can pass incomplete coverage; palette not "every cell" | every box chunk `ok` now and in the baseline, same chunks, none undecoded, else UNKNOWN; the palette is stated as placed blocks only |
| P2 the cron contract | `zones-compare` exits 3 on BREACH; the cron stops only on rc 2 + a `VERDICT TRIP` line or rc 3; skips when no bot runs; recovery is a human's |
| P2 convergence and survival runs in `pieces_in` | the drop-in comes off only against the follower's own eligible target; a survival run is added to REQUIRED_KEPT |

The fixes were not re-reviewed before the start (the owner asked for one quick review; the weekly limit is near). The start
proceeded because every P1 that could act during the start (S2, follower, re-keying) is closed by mechanism, and the open one
(the underground escape) cannot be reached from bare ground on day one and is now a TRIP line.

## 7b. Re-review of the start as deployed (operator request, 10-25 16:2x-17:1xZ)

**Codex re-review: CHANGE, 4 P1 flagged LIVE NOW** -- G1-G4 cover expiring after 3 h (18:55Z for the first table), the r2
shared-pool rewrite breaking D5, a filled cauldron reading as a removal, and REQUIRED_KEPT skipped by a manual activation with
AUTO_FOLLOW off. **Independent Claude review: CHANGE, 0 P1 + 6 P2.** Per the operator's rule **the bots were stopped
16:34-16:36Z** (`stop-bots.sh "re-review 10-25: Codex P1s flagged LIVE NOW ..."`). Fixes r4 (038b213d) -- see its message;
seen on the VM: activating the older release REFUSED, the current one passes; a bare `follow` with AUTO_FOLLOW and LANE present
did not act; doWeatherCycle false (the cauldron case was not reachable live). **Verification:** Claude APPROVE (no P1);
Codex confirmed all four P1s closed and found ONE NEW P1 (a plan defect from before a stop re-trips every read after the
restart) -> r5 (a22fa0db): S5 judges only evidence newer than RUN_SINCE. Claude's P2s taken in r6: the plan history is
streamed (an hourly read on the VM: 1.5 s, max RSS 154 MB; 186 of 9,728 lines kept), Z1 TRIPs only with a refusal inside the
still spell (else WATCH: a village path is walkable), and this doc's rollback, recovery, epoch and REQUIRED_KEPT notes.
Open P2s: no bounded emergency stop behind ops.lock; `kept_runs` not bound to the promoted sha; the underground escape still
unproved (owner question); exit 4 surfaces only in trip.log.

**Verify-2 (Codex): CHANGE, 3 new P1** in r5/r6 -- the "defects before the run" subtraction is unsound (G1/G3 not monotone; D4
read from the current plan in both passes) and the row filter missed `"name": "x"`. -> r7 (43b53edc): S5 is STICKY until a
human acknowledges it by item (`showcase_trip.py ack --why ...`, multiset, pruned when an item goes away so it re-arms); regex
filter; bad files named. **Verify-3 (Codex): CHANGE** on the ack path (unlocked writes, no prune while stopped, an unreadable
ACK, bad files dropping defects, D4 identity) -> r8 (5e3ca7f0) fixes each. **Accepted residual:** a G1/G3 item string has no
time, so an acknowledged item that is replaced and fails again with an identical string between two hourly reads stays
acknowledged; the ack path is unused until a defect occurs (none so far). **Bots restarted 16:49:04Z** (gate 17/17, ten on the
expected build, 37/37 decisions gemma4, LANE: AUTO_FOLLOW not created, RUN_SINCE written).

## 8. Start record (2026-10-25)

- **15:12Z** follower drop-in installed, timer stopped, service inactive. **15:13:03Z** `start-bots.sh`: gate 17/17; ten
  `joined the game` 15:13:05 .. 15:14:55Z (12 s apart); verifier: all ten with a skill row on `d55ce14d...+83e4d9` and an llm
  row; 12 of 12 decisions served by gemma4:26b. AUTO_FOLLOW removed and the timer restarted 15:15:06Z. Tripwire cron installed.
- **Licences, 10 of 10 bots:** `_townplan_mode plan=on template=ring@1 seed=ok zones=8`, `_found_mode found=on floor_wood=8
  floor_stone=8 below_stockpile=1`, `_protectzone_mode zones=8 why=ok`.
- **Town plan adopted:** 15:13:35Z showcase-Alpha `_townplan op=root result=accepted gen=1 mode=greenfield orient=W
  store=storehouse:7 work=5x3:5` -> `/var/lib/mcai/_pool-showcase/townplan-0_70_0.g1.json`.
- **Founding:** 15:55:22Z showcase-Echo `_found order=work kind=crafting_table step=F1 outcome=placed at=-7,71,-7
  source=crafted gen=3`; 16:06:30Z showcase-Echo `_found order=work kind=furnace step=F3b outcome=placed at=-8,71,-7 gen=5`.
  The world agrees (the timelapse's own region copy reads `crafting_table` at -7,71,-7 and `furnace` at -8,71,-7). In the first
  hour: 50 gathers ok, crafts of 9 crafting tables, 9 wooden and 8 stone pickaxes, 3 furnaces.
- **Timelapse:** frames every 15 min continued through the start (15:00, 15:15, ... 16:15Z topdown + angled); render time rose
  from ~5 s to 69-82 s as the world started changing. The 16:15Z frame shows the felling round home; the two stations are too
  small at that camera distance to see.
- **Tripwire reads:** 15:35Z (cron) OK. 15:45Z (+32 min) **TRIP, a FALSE BREACH**: two unwaxed `copper_block` cells of the trial
  chambers (69..70,-2,134) had weathered to `exposed_copper`, with no bot near; the cron would have stopped the bots at 16:35Z.
  Fixed in r3 (canonical names: the oxidation stage dropped; the baseline retaken from the same pre-bot stage with the wider
  palette); no stop happened. 16:20Z (+67 min): **OK** -- 8,342 rows, 10 of 10 live, 11.0 bot-h, deaths 0 (0.22 expected),
  stuck none, under none, Z1 none, refusals `place_refused 4`, `find_filtered` 1.27 M (the guard hiding zone blocks from
  searches), 3 near zones INTACT, D1-D5 and G1-G5 all 0 with EXPOSURE 1 plan, 5 generations, 2 found placements.
- **Open:** the trial chambers' under-box residual (owner question, section 3); `stage --piece` / `activate --lane` / the
  piece-aware rollback rule before the first showcase-first piece (section 5); the zone-file branch `showcase-start-1025-zones`
  (on d55ce14d, `npm test` 302/302) merges after junkout-01 reaches main.

## 9. The town close-up camera (owner 10-25)

A third timelapse camera `town`: flat orthographic on home (0.5,70,0.5), BlueMap distance 95, 1440 x 1440 -- a real render
through the timelapse's own BlueMap path (same capture.mjs run as the pair, every 15 min). It spans ~ +-57 blocks at ~12.7 px a
block (measured against the taiga village's west edge, x 49), so the storehouse (x -15..-7), the workshop and the ring to ~60
are in frame; the existing topdown is ~8.7 px a block over ~ +-110 x +-62. It is an EXTRA view: published on its own, never part
of the pair, so the pair's slot accounting is unchanged; the daily / weekly / history / monthly videos build a `town` video from
its own frames. Cost (18:00Z slot, the first): capture 14.1 CPU-s (10.0-10.2 before), capture wall 249 s (151-167 s), +3.7 MB a
frame (~355 MB a day; 319 GB free, min_free_gb 20 unchanged). The 18:00Z frame shows the founding blocks as distinct ~13 px
blocks round the plan cells (four storehouse chests at x -9..-13, z -2..2; the workshop table and furnace at -7/-8,-7); where
the forest canopy still covers a cell a top-down camera cannot see under the leaves -- the plots clear as they are built.
Codex review: CHANGE, no P1 (a town-only month was skipped; extra-camera diagnostics dropped) -> fixed in r2 (cefd19f9).


## 10. Owner decisions 10-25 (via the coordinator), applied

1. **REQUIRED_KEPT drops confirmed** (indexsearch-01, sortdeposit-01). Recorded in `/srv/showcase/REQUIRED_KEPT`
   ("OWNER CONFIRMED 2026-10-25", backup `.bak-20261025-owner`); gate still 17 of 17.
2. **The trial chambers run to bedrock with a floor (the village shape).** Zone `trial-chambers-home-se` = box
   [-20,-64,65,88,31,164], `floor_y -47` (the old bottom: survey -43 padded 4), so the chambers' protected volume is unchanged and
   y -64..-48 under the footprint is added: nobody tunnels in under them, a bot already below the floor digs out sideways.
   Branch `showcase-start-1025-zones` d27c9f2b: the infra file, the fixture and town-site.json's seed avoid box (the "showcase
   agrees with itself" tests); protectzone's DATA exemption demands y0 -64 and floor_y = the padded bottom, with the positive
   control that cells at y -48 / -60 / -64 under the chambers are in the zone, closed to a bot west of the footprint at y -55
   and to one on the surface, open to a bot already at y -55 inside it, the chambers still closed to it; the r1 shape, no floor
   and a wrong floor are refused; the DATA test was seen to fail on the r1 file. `npm test` 302/302. **Codex: APPROVE** (no
   P1/P2; noted: the assertions prove the permissions, and mine's exit columns work underground, but no Paper scene runs an
   actual escape from under the chambers).
   **Live 18:11Z:** `/var/lib/mcai/_pool-showcase/protected-zones.json` (md5 b47a3a65) and both town-site.json copies (md5
   7535523b) installed, backups `.bak-20261025-bedrock`. Tripwire baseline retaken from the pre-bot 04:15Z stage (8 zones,
   every box chunk ok); the mirror compare INTACT. **Restart** 18:13:45Z (stop-bots / start-bots): all ten logged
   `_protectzone_mode zones=8 why=ok` (18:13:46-18:15:37Z) and `_townplan_mode seed=ok zones=8`; 26/26 decisions gemma4.
   **Tripwire (r9):** the space under the chambers is now their DEEP part (WATCH); the UNDER line sees only a floorless
   underground zone (none) and is a warning, never a stop. Read 18:35Z: OK, trial chambers INTACT.
