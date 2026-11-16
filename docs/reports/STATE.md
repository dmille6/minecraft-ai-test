# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-16T08:20:02Z._

| | Now |
|---|---|
| **Fleet** | `c3cf4cff` = pause30-01 `c3cf4cff` (KEEP 11-15 08:02Z, promoted 11-15 08:13Z) on roughground-04 `01ab2784` (KEEP 11-15 04:46Z, promoted 11-15 04:59Z) on roughground-02 `382cda91` (KEEP 11-15 01:14Z, promoted 11-15 01:25Z) on glass-01 `147802fd` (KEEP 11-14 21:05Z, promoted 11-14 21:16Z) on lidground-01 `5904919d` (KEEP 11-14 08:28Z, promoted 11-14 08:38Z) on roughground-01 `e32152d8` (KEEP 11-14 03:02Z, promoted 11-14 03:12Z). Live builds: {'80563d74119aa3bb5bc781a5eaf2ddc419daa080+1c2a05': 20, 'c3cf4cff5fcebd486620c2bdee32ce17f51ef50b+481f91': 60} |
| **Canary in slot** | **bamboowalk-01** deployed 11-16 05:34Z; reads +90 11-16 07:04Z, +180 11-16 08:34Z; KEEP auto-promotes ~10 min after the +180 KEEP |
| **Queue (front)** | irongap-01 -> obsidian-01 -> kittrim-01 -> pathsfix-01 -> coalsale-01 -> coalsale-02 -> jobsite-01 -> market-01 -> market-02 -> market-03. Held: forest-01 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...) |
| **Scheduler** | busy S1 canary declared: 80563d74119aa3bb5bc781a5eaf2ddc419daa080 on hive-c,placebo-d,hive-b,board-c / S6 open loop: canary 80563d7 is deployed on hive-c,placebo-d,hive-b,board-c with no KEEP/REVERT/INCONCLUSIVE recorded — read it before st |
| **Showcase release** | `0fd594eb` (24,977 rows), `591d45cd` (24,935 rows); 14 bots in 3 h. Protected tree vs fleet KEEP: **no_base** (no kept fleet build has the live release 591d45cd's protected tree: restack by hand; row 11-16 07:25Z) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Pending owner decisions** | none recorded (ledger rows with `owner_pending`); technical holds are under Queue |
| **Projects (daily audit)** | project audit fleet (11-15T12:05Z, 7 d, 188 projects, 15,528,410 lines / 80 bots): 3 broken, 1 dormant, 4 underused, 89 effective, 52 unmeasured, 39 - -- placebo-a/house1 BROKEN; placebo-d/shop BROKEN; placebo-d/wall BROKEN; isolated-d/well DORMANT; showcase: project audit showcase (11-15T12:05Z, 7 d, 43 projects, 2,319,110 lines / 15 bots): 3 dormant, 13 effective, 15 unmeasured, 12 - -- showcase/canefarm DORMANT; showcase/enchantshop DORMANT; showcase/treefarm DORMANT |
| **Open alarms** | STALLCHECK 2026-11-16T07:35:02Z STALLED: 202. OPSAUDIT 2026-11-15 FLAGS: 9 (0 high). 75 active alarm(s): stuck goals 23 (board-a/tidy@355_73_147, board-a/waterwalk@355_73_147, board-b/tidy@-249_65_144, board-b/waterwalk@-249_65_144, board-c/shaft@355_73_147, board-d/waterwalk@355_73_147 ...); effectwatch effect:cobbleroom-01:h24, effectwatch effect:escdead-01:h72, effectwatch effect:fullplace-01:h72, effectwatch effect:gathermem-01:h24, effectwatch effect:gklease-02:h72 |
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
