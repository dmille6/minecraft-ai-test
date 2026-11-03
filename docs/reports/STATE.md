# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-03T11:20:01Z._

| | Now |
|---|---|
| **Fleet** | `5d862a8a` = stuckcells-01 `5d862a8a` (KEEP 11-03 09:53Z, promoted 11-03 10:03Z) on deepminer-01 `259a36f3` (KEEP 11-03 06:00Z, promoted 11-03 06:09Z) on drainpick-01 `e54d1cce` (KEEP 11-03 00:35Z, promoted 11-03 00:45Z) on fewerdec-01 `10aa0e1d` (KEEP 11-02 19:47Z, promoted 11-02 19:57Z) on tidy-01 `f1f5c16c` (KEEP 11-02 15:37Z, promoted 11-02 15:47Z) on fleetbuild-01 `c711879e` (KEEP 11-01 23:37Z, promoted 11-01 23:47Z). Live builds: {'209beee1696c9da35f6587e180bb5fe7e9f09c3a+29da98': 10, '5d862a8a2d81f700b4b3db5c596c13576f9afe5c+7efadc': 70} |
| **Canary in slot** | **servea-01** deployed 11-03 10:48Z; reads +90 11-03 12:18Z, +180 11-03 13:48Z; KEEP auto-promotes ~10 min after the +180 KEEP |
| **Queue (front)** | bagdiet-01 -> swimcentre-01 -> stationkeep-01 -> marks-01 -> towngate-01 -> groundskeeper-01. Held: llmoai-01 (HELD: serving A (OWNER 11-02 'do what you recommend'): the oai+ client to the whole fleet, neede...). Parked: townfloor-01, bamboo-03, foldwatch-01, treefarm-03 |
| **Scheduler** | busy S1 canary declared: 209beee1696c9da35f6587e180bb5fe7e9f09c3a on hive-c,hive-b / S6 open loop: canary 209beee is deployed on hive-c,hive-b with no KEEP/REVERT/INCONCLUSIVE recorded — read it before starting anything new / S7 servea-01 i |
| **Showcase release** | `adbf9e41` (18,077 rows); 10 bots in 3 h. Protected tree vs fleet KEEP: **in_sync** (protected tree == fleet 5d862a8a (stuckcells-01); row 11-03 10:25Z) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Owner-direct / rollouts (24 h)** | qwen35-roll: rollout-compare 11-02 22:36Z |
| **Pending owner decisions** | none recorded (ledger rows with `owner_pending`); technical holds are under Queue |
| **Open alarms** | STALLCHECK 2026-11-03T10:35:01Z STALLED: 62. OPSAUDIT 2026-11-02 FLAGS: 8 (1 high). 35 active alarm(s): stuck goals 7 (board-a/house1@355_73_147, hive-a/monument@355_73_147, hive-b/monument@355_73_147, isolated-a/monument@355_73_147, isolated-c/monument@355_73_147, placebo-b/tidy@282_65_-388 ...); driftwatch drift:items_per_bot_h, driftwatch drift:value_per_bot_h, effectwatch effect:kitmulti-01:h24, effectwatch effect:kitmulti-01:h72, effectwatch effect:smeltgate-01:h24 |
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
  model canary): servea-01 = 4B on the 5080, 10 bots, HELD (learning agent's registration adopted 11-02 ~14:00Z); 5080 host key verified 11-02.
  These owner questions are ANSWERED; what remains are technical holds (see Queue).
- **Learning loop** weekly (cron on the canary host); round 3 closed 11-02 05:06Z; the owner's 11-02 capacity rule is written
  (main dcedd094) before round 3 was re-gated: 13:51Z regate on the 5080 evidence -> **best = r3 Qwen3.5-4B** (80/min within
  gates vs c2 0, not significantly worse on hard/rep_fail/post_veto; on the 3090 it is 1.4x, recorded). servea-01 adopted
  with the learning-loop registration (`servea-01.d48467f8-4bll.json`), still HELD for the servea waiter.
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
