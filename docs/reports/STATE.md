# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-07T08:20:01Z._

| | Now |
|---|---|
| **Fleet** | `63d28320` = gkstay-01 `63d28320` (KEEP 11-07 04:15Z, promoted 11-07 04:25Z) on stations-01 `3924314a` (KEEP 11-07 01:58Z, promoted 11-07 02:08Z) on gklease-01 `e447b65b` (KEEP 11-06 22:43Z, promoted 11-06 22:53Z) on idlework-02 `ed2cc02b` (KEEP 11-06 20:39Z, promoted 11-06 20:50Z) on gkforever-01 `9e9284d7` (KEEP 11-06 17:08Z, promoted 11-06 17:18Z) on decbundle-01 `47b8342d` (KEEP 11-06 13:40Z, promoted 11-06 13:50Z). Live builds: {'63d283208e08676c9a344d105d938efbc5461e2a+0cf398': 70, 'e6a1ea2b042ee9c776670868457ece91fd8789fc+278872': 10} |
| **Canary in slot** | **escdead-01** deployed 11-07 05:19Z; reads +90 11-07 06:49Z, +180 11-07 08:19Z; KEEP auto-promotes ~10 min after the +180 KEEP |
| **Queue (front)** | buildfix-01 -> gkwork-01 -> roughground-01 -> stairuse-01 -> pathsfix-01 -> forest-01 -> stoneworks-01 -> pause30-01 -> bamboowalk-01 -> marks-01 -> +10 more |
| **Scheduler** | busy S1 canary declared: e6a1ea2b042ee9c776670868457ece91fd8789fc on isolated-d,hive-c / S6 open loop: canary e6a1ea2 is deployed on isolated-d,hive-c with no KEEP/REVERT/INCONCLUSIVE recorded — read it before starting anything new / S7 esc |
| **Showcase release** | `d8dbd32a` (18,506 rows), `af3b9a8b` (16,363 rows); 13 bots in 3 h. Protected tree vs fleet KEEP: **no_base** (no kept fleet build has the live release d8dbd32a's protected tree: restack by hand; row 11-07 07:25Z) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Owner-direct / rollouts (24 h)** | mobgrief-1106: owner-direct-check 11-07 03:10Z |
| **Pending owner decisions** | **enchantshop-1104**: O-L: obsidian-01 is protected code (deep miner + bucket): ride a fleet canary with the job off outside the showcase pool (recommended), or allow a protected delta on the showcase?; **statusreport-1106**: statusreport: put the Anthropic key on the canary host (~/.config/mcai/anthropic.key, mode 600) so the 4x-daily report gets the Haiku 5.5 narrative (~$0.12/month), or keep data-only reports? |
| **Projects (daily audit)** | project audit fleet (11-06T14:02Z, 7 d, 153 projects, 12,956,789 lines / 80 bots): 13 underused, 70 effective, 40 unmeasured, 30 -; showcase: project audit showcase (11-06T14:04Z, 7 d, 32 projects, 1,508,346 lines / 15 bots): 2 broken, 1 dormant, 3 underused, 10 effective, 10 unmeasured, 1 not judged, 5 - -- showcase/cropfarm DORMANT; showcase/dress BROKEN; showcase/treefarm BROKEN |
| **Open alarms** | STALLCHECK 2026-11-07T07:35:01Z STALLED: 84. OPSAUDIT 2026-11-06 FLAGS: 16 (1 high). 59 active alarm(s): stuck goals 13 (board-b/tidy@-249_65_144, board-d/tidy@355_73_147, hive-a/tidy@355_73_147, hive-b/tidy@355_73_147, hive-d/tidy@68_65_68, isolated-a/tidy@355_73_147 ...); driftwatch drift:deaths_per_bot_h, driftwatch drift:value_per_bot_h, effectwatch effect:kitmulti-01:h24, effectwatch effect:kitmulti-01:h72, effectwatch effect:smeltgate-01:h24 |
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
