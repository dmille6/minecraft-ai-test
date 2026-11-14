# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-14T14:20:02Z._

| | Now |
|---|---|
| **Fleet** | `5904919d` = lidground-01 `5904919d` (KEEP 11-14 08:28Z, promoted 11-14 08:38Z) on roughground-01 `e32152d8` (KEEP 11-14 03:02Z, promoted 11-14 03:12Z) on villageunlock-01 `0c9a6138` (KEEP 11-13 23:35Z, promoted 11-13 23:45Z) on boardwalk-03 `960f8a24` (KEEP 11-13 20:10Z, promoted 11-13 20:20Z) on ironchain-02 `6683f96b` (KEEP 11-13 15:47Z, promoted 11-13 15:57Z) on regcount-01 `b5ec000e` (KEEP 11-13 09:51Z, promoted 11-13 10:01Z) |
| **Canary in slot** | EMPTY (last close lidground-01 KEEP 11-14 08:28Z) |
| **Queue (front)** | glass-01 -> irongap-01 -> obsidian-01 -> roughground-02 -> roughground-04 -> bamboowalk-01 -> kittrim-01 -> pathsfix-01 -> pause30-01 -> coalsale-01 -> +5 more. Held: forest-01 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...) |
| **Scheduler** | busy S3 the loop lock is held (pid 2715367) / S8 INSTALL-HOLD by servea-40bots until 2026-11-14T14:47:41Z |
| **Showcase release** | `46286e9e` (20,357 rows); 14 bots in 3 h. Protected tree vs fleet KEEP: **no_base** (no kept fleet build has the live release 46286e9e's protected tree: restack by hand; row 11-14 13:25Z) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Pending owner decisions** | none recorded (ledger rows with `owner_pending`); technical holds are under Queue |
| **Projects (daily audit)** | project audit fleet (11-14T12:05Z, 7 d, 188 projects, 15,443,471 lines / 80 bots): 3 broken, 1 dormant, 5 underused, 88 effective, 51 unmeasured, 40 - -- isolated-a/shop BROKEN; placebo-a/house1 BROKEN; placebo-d/wall BROKEN; isolated-d/well DORMANT; showcase: project audit showcase (11-14T12:05Z, 7 d, 43 projects, 2,229,052 lines / 15 bots): 2 dormant, 14 effective, 15 unmeasured, 12 - -- showcase/enchantshop DORMANT; showcase/treefarm DORMANT |
| **Open alarms** | STALLCHECK 2026-11-14T13:35:01Z STALLED: 235. OPSAUDIT 2026-11-13 FLAGS: 13 (2 high). 101 active alarm(s): stuck goals 13 (board-b/waterwalk@-249_65_144, board-c/shaft@355_73_147, hive-a/monument@355_73_147, hive-b/tidy@355_73_147, hive-b/waterwalk@355_73_147, hive-c/tidy@-68_68_-68 ...); driftwatch drift:items_per_bot_h, driftwatch drift:value_per_bot_h, effectwatch effect:cobbleroom-01:h24, effectwatch effect:escdead-01:h72, effectwatch effect:gathermem-01:h24 |
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
