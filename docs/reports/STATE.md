# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-04T20:20:01Z._

| | Now |
|---|---|
| **Fleet** | `3a7badea` = swimunder-01 `3a7badea` (KEEP 11-04 17:34Z, promoted 11-04 17:43Z) on monustuck-01 `704acf91` (KEEP 11-04 14:02Z, promoted 11-04 14:12Z) on shafttrap-02 `beb79ed2` (KEEP 11-04 09:36Z, promoted 11-04 09:46Z) on swimcentre-01 `0542fccb` (KEEP 11-04 03:58Z, promoted 11-04 04:08Z) on bagdiet-01 `9fbfdf22` (KEEP 11-03 23:58Z, promoted 11-04 00:08Z) on cooldown15-02 `53fd28ee` (KEEP 11-03 19:14Z, promoted 11-03 19:24Z). Live builds: {'3a7badeab3f95b2798e219958b5d16e761175b9f+0bebc2': 70, '493c198ae7019a2fbe062654ed2fc1fa9ba0dfbb+9017fc': 10} |
| **Canary in slot** | **dirtrung-01** deployed 11-04 18:13Z; reads +90 11-04 19:43Z, +180 11-04 21:13Z; KEEP auto-promotes ~10 min after the +180 KEEP |
| **Queue (front)** | llmoai-01 -> pause30-01 -> bamboowalk-01 -> stationkeep-01 -> marks-01 -> towngate-01 -> groundskeeper-01 -> bucketfix-01 -> kittrim-01 -> depositoffer-01 -> +5 more. Held: dropdig-01 (HELD: control session 11-04: HOLD until the 4B staged rollout (servea waiter -> modelrollout.py,...) |
| **Scheduler** | busy S1 canary declared: 493c198ae7019a2fbe062654ed2fc1fa9ba0dfbb on hive-d,board-d / S6 open loop: canary 493c198 is deployed on hive-d,board-d with no KEEP/REVERT/INCONCLUSIVE recorded — read it before starting anything new / S7 dirtrung- |
| **Showcase release** | `a7efcca2` (21,189 rows), `d3773f8b` (19,603 rows); 15 bots in 3 h. Protected tree vs fleet KEEP: **conflict** (live a7efcca2 sits on 9fbfdf22 (bagdiet-01); behind by 4: swimunder-01, monustuck-01, shafttrap-02, swimcentre-01; merge conflicts in bots/scripts/stuckcells-of; row 11-04 19:25Z) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Pending owner decisions** | **enchantshop-1104**: O-L: obsidian-01 is protected code (deep miner + bucket): ride a fleet canary with the job off outside the showcase pool (recommended), or allow a protected delta on the showcase? |
| **Open alarms** | STALLCHECK 2026-11-04T19:35:01Z STALLED: 45. OPSAUDIT 2026-11-03 FLAGS: 5 (1 high). 32 active alarm(s): stuck goals 8 (hive-a/monument@355_73_147, hive-a/tidy@355_73_147, hive-d/monument@68_65_68, isolated-a/wall@355_73_147, isolated-b/wall@355_73_147, isolated-c/monument@355_73_147 ...); driftwatch drift:value_per_bot_h, effectwatch effect:kitmulti-01:h24, effectwatch effect:kitmulti-01:h72, effectwatch effect:smeltgate-01:h24, effectwatch effect:stuckcells-01:undeclared |
<!-- GENERATED:END -->

## Notes

<!-- NOTES:BEGIN (hand-written; stategen.py keeps this block verbatim) -->
_Hand-written context the sources cannot say. Keep it short; date each line; delete what is done._

- **Fleet vs main (11-02, audit 11-01 flag 4): RECONCILED.** main 9294d28b carries all promotions to fleetbuild-01 c711879e
  (merge 65b735f8; full suite on .30: 6 failures, all failing alone on main too). From now `promomerge.py` (Mac, 15 min)
  merges each promotion (suite on .30) or records it when main already carries it, else pages `!! promotion ... does NOT
  merge into main` (header line `promotion merge`). Row `main-carries-fleet` closes when tidy-01 f1f5c16c lands that way.
- **qwen3.5 A/B** (15 bots isolated-a/isolated-c/placebo-c on the Blackwell, 65 control): restarted 11-01 ~22:25Z after the
  false stop; hourly `qwen35-roll` rows; 24 h compare + mandatory rollback from that start.
- **Serving** (OWNER 11-01 vendor terms = A; serving = A + D; OWNER 11-02 ~12:45Z: Qwen3.5-4B r3 = serving direction + next
  model canary): servea-01 = 4B on the 5080, 10 bots: ran 11-03 10:45Z (canary 209beee1), KEEP 13:51Z, teardown finished by hand
  15:17Z (all ten bots checked) -- DONE, not held (11-04 audit flag 1). llmoai-01 is back in the queue (after servea-01, at the
  tail behind groundskeeper-01); the staged 4B rollout follows its promotion. Owner questions ANSWERED.
- **Learning loop** weekly (cron on the canary host); round 3 closed 11-02 05:06Z; the owner's 11-02 capacity rule is written
  (main dcedd094) before round 3 was re-gated: 13:51Z regate on the 5080 evidence -> **best = r3 Qwen3.5-4B** (80/min within
  gates vs c2 0, not significantly worse on hard/rep_fail/post_veto; on the 3090 it is 1.4x, recorded). servea-01 adopted
  with the learning-loop registration (`servea-01.d48467f8-4bll.json`) and KEPT 11-03 13:51Z (see Serving).
- **Showcase (11-02 13:29Z):** release `4c92880a` = fleet c711879e protected tree (tombexit, airpocketwin, lavatarget,
  promptcache, apseal, zigsealed, fleetbuild) + every showcase piece (expeditions/wholemap S1a, storehouse/shopchest,
  sortstore, showchat, copperhall, stale-stuck rule, SHAFT off); prev `d698024b` is the rollback. From now on
  `restack_prep.py` (showcase VM, :25) prepares each restack and alarms `restack-showcase`; activation stays by hand.
- **Showcase (11-03):** tripwire S6 tidy rule tidyread-01 (main 230c204b) installed 04:02Z; groundskeeper + copperrun release
  `dc617030` live 04:15Z (60-min PASS, 2-h 0 deaths; tidy stage 0 stuck on 21,66,0 until waived 06:07Z, no land plan yet;
  copperrun unexposed); yard release `c2a0de4f` (yardsite-01, main 556ba468: yard@1 SW homes beyond the wall) live 06:17Z, read 07:17Z.

## Lab mode

None declared.
<!-- NOTES:END -->
