# Code evaluation: SHOWCASE release and safety path (read-only, 2026-11-06 ~02:30Z)

Scope: infra/showcase (showcase_ops.py 1,244 lines, showcase_trip.py 1,232, restack_prep.py 347, followrule.py 249,
start/stop/trip-cron .sh), shopread (docs/reports/shop-01-2026-10-25/shopread.py.txt, 2,621 lines on main; 2,522 installed),
scripts/host/haltwatch.py (judge_showcase), timelapse/BlueMap/plugins. Live data from mike@10.0.0.40: ops/deploy.jsonl (371 rows),
ops/trip.log (254 reads), PIECES.jsonl (192 rows), ops/restack.jsonl (86), ops/follow.jsonl (446), systemd journal, skill logs.
Window 10-22 00:00Z .. 11-06 02:30Z = 362.6 h unless stated. Nothing changed on any host or branch.
Working files (scripts, ledger copies, Codex prompt/output): `.../scratchpad/codeeval/showcase/`.

## (a) Summary

1. The tripwire stopped all showcase bots 12 times in 14 days. 8 of the 12 were false positives (I and Codex classified them
   separately and agree). 6 of those 8 came from a row kind or record the per-project S6/G3 rules did not know yet. Showcase
   downtime was 35.2 h of 362.6 h (9.7%), and 34.4 h of that (98%) followed tripwire stops. About 352 bot-h were lost.
2. Most of that time went on waiting for a person, not on the trips themselves. Two overnight stops waited for a human: 17.96 h
   on 10-25 and 11.37 h on 10-31, together 29.3 h (85% of the downtime). They were a marginal G3 trip and the one real S4
   breach. The 8 false trips cost 4.7 h (55 bot-h), plus about 7 tooling-tier tripwire changes, each with two engines and mutants.
3. The per-project rule design does not scale. shopread grew from 58 KB to 217 KB between 10-26 and 11-06 (44 commits on main
   in 11 days). judge() is 377 lines of if/elif over plot x op x kind, with 25 `*_ok` predicates. Of the last ~20 features,
   about 13 needed their own hand-written rule (SW1-5, RO1/RT1/RT2, DC1-5, SH1, EF1, CF1, G9, WX1, SK1, ...). Bots emitted 233
   distinct (plot, op, kind) combinations across 23 plots in 7 days, and nothing checks the bot schema against the reader.
4. The release flow is fast for ordinary pieces: median 0.4 h, p90 1.4 h from the fold commit to live (n=106). It is a real
   stall source for anything protected. The restack has been in `conflict` for 45 h straight and is 8 fleet KEEPs behind
   (64% of all restack hours behind). The showcase is a fork: 98 of 117 piece shas are not on main; skills.mjs is 26,366 lines
   live vs 22,286 on main vs 21,157 on the fleet, and about 8 k lines of modules (stepwell, sinks, terrace, townstyle, storehub,
   siteprep, cropfarm, canefarm, atlas) are absent from main.
5. Detection mostly fires quickly, but it fires into nothing. The restack alarm has said STILL every 6 h for 45 h. The follower
   has written ROLLBACK 290 times and cannot act. WATCH appears on 191 of 245 reads, all of it "legal ground" / tree debris.
   haltwatch reports a tripwire stop as "NO mcshow@ units -- census wrong".

## (b) Findings, ranked by impact on "bots keep working / progress keeps moving"

| id | finding | evidence | impact (denominator) | rec | effort | risk |
|---|---|---|---|---|---|---|
| S1 | **A TRIP stops all 15 bots and waits for a human.** trip-cron always runs stop-bots (disable --now, AUTO_FOLLOW removed). S5/S6 items stay sticky until someone edits ACK.json by hand. The docstring's other remedy, "re-activate the previous release when a piece was just deployed", is not implemented. | trip-cron.sh:30; showcase_trip.py:43 (docstring) vs 58-60 (sticky ACK); ACK.json has 9 hand edits (.bak files) | 34.4 h of 35.2 h downtime. Two overnight waits = 29.3 h (~293 bot-h of ~352). | FIX: an automatic remedy per trip class: (a) a trip within 3 h of a piece activation re-activates the previous release, restarts the bots and pages; (b) a conformance-only trip (S6 H1/H2/H4, S5 G) becomes REPORT and does not stop; (c) S1 deaths, S4 breach and Z1 trapped still latch and stop, with a loud page. | S-M | low: S4/S1 still stop |
| S2 | **The per-project S6/G3 rules are a whitelist that fails closed.** A new plot, kind or record meaning is judged as off_record / clear_outside, so every bot stops. Each piece must ship a tooling-tier rule (two engines + mutants). | shopread judge() at :1189 (377 lines); 25 `*_ok` predicates; cover touched 4 rule paths (:334,393,660,1497 per Codex); the ledger: house1 10-29, tidy 11-03, yard 11-03, wallretired 11-05, cover 11-05 (all FALSE trips) | 6 of 8 false trips. Rule growth 58 KB -> 217 KB in 10 days, 44 commits. About 13 of ~20 recent features needed a rule. 233 (plot, op, kind) combinations. | REFACTOR: one generic rule. The bot already writes each project's record. A placement or clear is clean if it falls inside the declared footprint (cells/box/reservation) of an open record or land-plan zone of that pool at that time. Outside every footprint and not debris, it is a REPORT. An unknown kind is WATCH "unjudged", never TRIP. Fine-grained conformance (H8 etc.) is reported, not a stop. Move shopread into infra/showcase as real code. | M-L | medium: less strict on in-footprint mistakes (the S4 integrity + deaths cover harm) |
| S3 | **The showcase is a fork, so restacking onto the fleet is hand work that never ends.** Pieces fold onto the live release (`--piece` requires ancestry). Showcase code edits the same core files as fleet fixes, so merge-tree conflicts. Protected code then needs both engines again at the gate, although the fleet already reviewed it. | restack.jsonl: 47 conflict, 8 tests_failed, 31 in_sync of 86 hourly rows; conflict streak 11-04 05:25Z..now; conflicts in skills.mjs, buildrun.mjs, shaftgeom.mjs, shaftvisit.mjs, stuckcells*.mjs; showcase_ops.py:423 (ancestry), :626; PROCESS "one trunk" vs main lacking stepwell.mjs/sinks.mjs/terrace.mjs/... | 45 h current lag, 8 KEEPs missing (swimcentre-01, shafttrap-02, monustuck-01, swimunder-01, dirtrung-01, llmoai-01, leasegen-01, dropdig-01). leasegen-01 is the fleet fix for lease-file growth. The showcase instead runs a `leaseprune4h` cron workaround after an 11-05 event-loop stall (35,447 lease files). villageunlock-01 has been held since 11-03 for the same reason. Showcase deaths are low (2 in 14 d over 1.9 M rows), so the cost is lag and hand work, not deaths. | REFACTOR (process + code): land showcase pieces on main behind a per-pool feature flag (`SHOWCASE_*` env or pool config). The showcase deploys main plus its flags, and restack_prep becomes a no-op. Until then: do the reconcile now, with an owner and a deadline. A protected tree byte-identical to a fleet KEEP+promotion needs no second review. | L (S for the interim) | medium |
| S4 | **Alarms fire into nothing.** The restack alarm has pushed STILL every 6 h for 45 h. The follower wrote ROLLBACK on 290 of 446 rows since 10-26 and acted on none: auto=false on all 446, and a gated release is observe-only. WATCH appears on 191 of 245 reads, and every WATCH line carries S3 DEEP "legal ground" or tree debris. Nothing pages on "built, reviewed, never recorded". | ALARMS.log restack-showcase rows; follow.jsonl; showcase_ops.py:195-205; trip.log verdict counts | Hides real signal. No action for 45 h. Pieces gksweep-01, gkunblock-01 and outbands-01 (Codex r4) were built and reviewed and have sat 1-2 d with no PIECES row and no alarm. villageunlock-01 has been held 3 d. | DELETE the follower's ROLLBACK/DUE decision in lane/gated mode; keep the observation, since stage needs a verified feed. FIX: drop the two always-on WATCH classes into counts; escalate an alarm that has been STILL for more than 12 h to a named owner; add a "built-not-staged > 12 h" check over `*show` branches vs PIECES. | S | low |
| S5 | **haltwatch misreads a tripwire stop.** stop-bots `disable --now` unloads the units, so `list-units` returns 0 and judge_showcase returns "NO mcshow@ units found -- census is wrong" before it looks at the stop row. A planned restart also reads as HALTED, because only `activated` with running_bots>0 clears a stop and `start-bots-after-restart` does not. alarm.py ignores curl's exit status, so a failed push still counts as sent and the retry waits 6 h (Codex). | haltwatch.py:95-96 vs 97-111; ALARMS.log 11-05 19:40Z, 23:40Z ("NO mcshow@ units"), 11-05 02:50Z/03:25Z (false HALTED); alarm.py:104-123 | The page arrives within 5 min but names the wrong problem. The owner reports ~50 min unnoticed on 11-05 (stop to next run epoch was 59.9 min). | FIX: check the stop row first and use `list-unit-files` / an enabled census; let any start event clear a stop; check the push return code and retry. | S | low |
| S6 | **The reader lives outside the tests and the release.** shopread is a `.py.txt` under docs/reports, hand-copied to /srv/showcase/trip (installed = coverread 6c18818a; main is 2 commits ahead, "NOT installed"). test_showcase.py (139 tests) and the mutant files are not run by npm test or suite-run. A bot-side row change can therefore never fail a showcase test. wholemap.py on the host (1,199 lines) is from a commit not on main. | test_showcase_trip_mutants.py:4,20; git blob check of host files; bots/scripts/run-tests.mjs has no python | The cover and retired-cell trips passed every existing selftest before going live. | FIX: put the reader in the release bundle, digest-pinned (Codex), and install it with install-bin.sh. Before activation, replay the candidate's own rows from Paper/offline runs plus the last 3 h of live rows through the candidate reader, and refuse if anything is new. Wire the python tests into suite-run. | S-M | low |
| S7 | **Every activation restarts all 15 bots** (12 s stagger plus a 10-min verify). 76 activations in 14 days, up to 13 per day. Each one interrupts in-flight visits and leases. | showcase_ops.py:953-958; deploy.jsonl | Measured direct downtime is small (70 restarts, about 0.1 h on Alpha). Lost visit progress was not measured. | KEEP the verify. Batching pieces (as 11-04/05 already does) is the cheap lever. | - | - |
| S8 | **Plugins and visuals go straight onto the live world.** SkinsRestorer: bots fell into a reconnect loop after skins were applied, and it was removed 2.3 h after install. The camera list is hard-coded per project (tl_video.py:33 EXTRA; 17 .bak copies on the host, one per project). | deploy.jsonl 11-05 01:05-03:32Z; tl_video.py:33 | Small: bots kept logging rows through the window (Alpha 230-830 rows/10 min). Mostly a per-project chore. | FIX: test plugins against a mineflayer client on a Paper sandbox first; derive cameras from open project records. | S | low |
| S9 | **The roster lives in 8 hand-kept copies** (stop/start/trip-cron, make_env, showcase_trip.NAMES, world-init, filebeat, restack text). | commit 34dedb1a | Pinned by test_showcase.Roster (4 mutants), so it is a chore rather than a stall. | FIX later: generate them from make_env.NAMES. | S | low |

Trip classification (12 TRIPs out of 245 ordinary reads; downtime measured from the systemd journal of one bot, Alpha):

| trip (UTC) | gate | class | down h | bots |
|---|---|---|---|---|
| 10-25 19:35 | S5 G3 1 lid unreachable (visit aborted F3) | marginal true (Codex: true) | 17.96 (overnight) | 10 |
| 10-27 12:35 | S6 H4 2 ms lease handover | FALSE | 2.02 | 10 |
| 10-28 12:35 | S6 H2 one floating spruce leaf | FALSE (debris rule added) | 0.68 | 10 |
| 10-29 13:35 | S6 H1 134 = house1 record unknown | FALSE | 0.26 | 10 |
| 10-29 17:35 | S5 G3 chest cell blocked by a sapling | marginal true | 0.21 | 10 |
| 10-31 02:35 | S4 trial-chambers BREACH (escape reflex) | TRUE | 11.37 (overnight) | 10 |
| 11-01 15:35 | S5 G3 5 stale audits (standing fix 8ada8a2e) | FALSE | 0.11 | 10 |
| 11-03 03:35 | S6 H2 4 = tidy's own cuts | FALSE | 0.07 | 10 |
| 11-03 07:35 | S6 H1 138 = yard piles | FALSE | 0.04 | 10 |
| 11-03 13:35 | S5 G3 5 = real access hole (Juno escape) | TRUE | 0.14 | 10 |
| 11-05 19:35 | S6 H1 119 = retired wall cells | FALSE | 0.47 | 15 |
| 11-05 23:35 | S6 H2 1 = kind=cover | FALSE | 1.05 | 15 |

All 7 S6 trips were false. The 4 S5 G3 trips split 2 marginal, 1 false and 1 true. The one S4 trip was true.

## (c) Codex's independent evaluation and reconciliation

Codex got the area, the file list, the incident evidence, the ledger copies and the five questions, but not my findings.
Output: `.../scratchpad/codeeval/showcase/codex-output.md`.

Codex's ranking:
1. A reader mismatch stops every bot (REFACTOR L): ship a versioned reader contract with each release and replay before activation.
2. A stop closes the loop instead of opening a recovery (FIX M): journal starts, retry failed pushes, escalate.
3. The folded release line is a demonstrated stall (REFACTOR L): converge on the trunk model.
4. Running is not progressing; WATCH is not a recovery plan (FIX M).
5. Activation is weaker than staging and returns success with zero bots running (showcase_ops.py:947).
6. Tests miss the deployment boundary.
7. Visuals/plugins disrupt runtime; Chunky holds the test-host suite lock (visuals/chunky-render-nightly.sh).
8. KEEP the digests, snapshots, rollback, verify and recordcompat. DELETE the unused `new_defects` (showcase_trip.py:634).

Its numbers match mine independently: 8/12 false, about 4.6 h / 53 bot-h false, 34.5 h total stopped, piece->live median
23 min, restack 46 h conflict / 8 h tests / 31 h in sync, 290/446 ROLLBACK with auto=false on all.

Where we agree: the same top three themes (reader/tripwire design, recovery waits on a human, the fork/restack). The per-project
reader does not scale. Keep the safety foundations. The follower's ROLLBACK is misleading noise. Partial refactor, no rewrite.

Where we differ:
- **Fixing the reader.** Codex keeps a full per-release reader and binds it to the release with replay before activation. I go
  further and change what is allowed to stop the world: conformance becomes a report, and one generic footprint rule replaces
  most per-project rules. Reconciled: do both. Replay-before-activate (S6) is the cheap S step that would have caught cover and
  retired cells. The generic rule plus TRIP-only-for-harm (S1+S2) is what removes the per-feature rule tax.
- **The 10-25 G3 trip.** Codex: true. Me: marginal (one lid, a visit aborted by F3:interrupted). This changes no recommendation.
  Its cost came from the overnight wait, not from the classification.
- **What Codex found and I missed (both verified in code):** alarm.py ignores the push exit status (:104-123); activation with
  zero bots returns 0 (showcase_ops.py:950-952, by design, but start-bots is the only verifier); Chunky's suite-lock hold.
- **What I found and Codex missed:** the haltwatch census-before-stop bug (S5) and the false HALTED after a planned restart. The
  fork's size (98/117 piece shas not on main; ~8 k lines of showcase modules absent from main). The built-not-staged pieces
  with no alarm. The leaseprune workaround that exists only because leasegen-01 cannot be restacked in. WATCH being 100%
  always-on noise.

## (d) Top 3 to do first in this area

1. **Stop latching the world on conformance; recover automatically** (S1, S5; S, about 1 day). In trip-cron, an S6/S5-G trip
   becomes a REPORT with a page. A trip within 3 h of a piece activation re-activates `prev_release` and restarts. Only S1
   deaths, S4 breach and Z1 trapped still stop and latch. Fix haltwatch's census order and the restart-clears-stop rule, and
   check the push result. Expected gain on the 14-day sample: the 8 false trips (55 bot-h) disappear, and the overnight
   class (293 bot-h) shrinks to the true S4-style breaches only (about 114 bot-h in the sample).
2. **Reconcile the showcase with the fleet now, then stop forking** (S3; S for the reconcile with a named owner, L for the
   flags). Hand-restack the 8 KEEPs (6 conflicting files) this week. Treat a protected tree byte-identical to a fleet
   KEEP+promotion as already reviewed. Then land each showcase piece on main behind a per-pool flag, so the showcase deploys
   main and restack_prep has nothing to do. This removes the 45 h lag class, the leaseprune workaround and the held
   protected pieces (villageunlock-01, leasegen show).
3. **Make the reader generic and part of the release** (S2, S6; M). Move shopread into infra/showcase, install it by digest
   with the release, and replay the candidate's own rows before activation. An unknown kind becomes WATCH "unjudged". Replace
   the per-plot branches with one rule: inside the declared footprint of an open record or land-plan zone. Delete the
   follower's ROLLBACK decision and the two always-on WATCH classes, and add a built-not-staged alarm. This ends the
   "every feature ships a tripwire rule" tax: about 13 rules and 7 hotfix rounds in 10 days.

## (e) Refactor verdict

**PARTIAL.** Refactor two things: the tripwire's S6/G3 reader, from a per-project whitelist that stops the world to a generic
footprint rule plus a harm-only stop, and the release model, from a long-lived folded fork to main plus per-pool flags. Keep the
rest and give it targeted fixes: showcase_ops gates, snapshots, digests, rollback target, start verifier, S4 zone integrity,
ledgers, restack_prep's merge-tree + test machinery (still useful for the interim reconcile), roster test. The code mostly works
and fails safe. The stalls come from the policy encoded in it (stop everything, wait for a human, a rule per feature, a separate
history), not from bugs in the mechanics.
