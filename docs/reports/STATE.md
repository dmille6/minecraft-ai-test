# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-13T17:20:02Z._

| | Now |
|---|---|
| **Fleet** | `6683f96b` = ironchain-02 `6683f96b` (KEEP 11-13 15:47Z, promoted 11-13 15:57Z) on regcount-01 `b5ec000e` (KEEP 11-13 09:51Z, promoted 11-13 10:01Z) on gathermem-01 `41e0c5fd` (KEEP 11-13 08:03Z, promoted 11-13 08:13Z) on chestmerge-01 `e525ddbd` (KEEP 11-13 02:33Z, promoted 11-13 02:44Z) on stationsback-01 `d045828c` (KEEP 11-12 22:37Z, promoted 11-12 22:47Z) on ironchain-01 `8924d4de` (KEEP 11-12 18:30Z, promoted 11-12 18:40Z). Live builds: {'6683f96b8143be9635c70f11aa0e17be76b55ba1+b5a24c': 70, '960f8a241f67416b7deb809b5b994700a8cefe83+4b76c6': 10} |
| **Canary in slot** | **boardwalk-03** deployed 11-13 17:09Z; reads +90 11-13 18:39Z, +180 11-13 20:09Z; KEEP auto-promotes ~10 min after the +180 KEEP |
| **Queue (front)** | glass-01 -> villageunlock-01 -> coalsale-01 -> coalsale-02 -> jobsite-01 -> market-01 -> market-02 -> market-03 -> roughground-01 -> irongap-01 -> +7 more. Held: forest-01 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...) |
| **Scheduler** | busy S1 canary declared: 960f8a241f67416b7deb809b5b994700a8cefe83 on placebo-b,hive-c / S6 open loop: canary 960f8a2 is deployed on placebo-b,hive-c with no KEEP/REVERT/INCONCLUSIVE recorded — read it before starting anything new / S7 board |
| **Showcase release** | `326e8be4` (27,568 rows), `52d8285f` (14,050 rows), `735d3e61` (7,732 rows); 14 bots in 3 h. Protected tree vs fleet KEEP: **no_base** (no kept fleet build has the live release 326e8be4's protected tree: restack by hand; row 11-13 16:25Z) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Pending owner decisions** | none recorded (ledger rows with `owner_pending`); technical holds are under Queue |
| **Projects (daily audit)** | project audit fleet (11-13T12:05Z, 7 d, 172 projects, 15,541,353 lines / 80 bots): 2 broken, 7 underused, 84 effective, 55 unmeasured, 24 - -- isolated-a/shop BROKEN; placebo-a/house1 BROKEN; showcase: project audit showcase (11-13T12:05Z, 7 d, 43 projects, 2,130,942 lines / 15 bots): 2 dormant, 14 effective, 15 unmeasured, 12 - -- showcase/enchantshop DORMANT; showcase/treefarm DORMANT |
| **Open alarms** | STALLCHECK 2026-11-13T16:35:01Z STALLED: 211. OPSAUDIT 2026-11-12 FLAGS: 11 (1 high). 136 active alarm(s): stuck goals 18 (board-b/tidy@-249_65_144, board-c/shaft@355_73_147, hive-a/monument@355_73_147, hive-b/tidy@355_73_147, hive-d/monument@68_65_68, hive-d/tidy@68_65_68 ...); driftwatch drift:value_per_bot_h, effectwatch effect:cobbleroom-01:h24, effectwatch effect:escdead-01:h72, effectwatch effect:gklease-02:h72, effectwatch effect:gkwork-01:h24 |
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
