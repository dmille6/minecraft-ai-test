# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-12T23:20:02Z._

| | Now |
|---|---|
| **Fleet** | `d045828c` = stationsback-01 `d045828c` (KEEP 11-12 22:37Z, promoted 11-12 22:47Z) on ironchain-01 `8924d4de` (KEEP 11-12 18:30Z, promoted 11-12 18:40Z) on loggate-01 `482b05c5` (KEEP 11-12 14:20Z, promoted 11-12 14:30Z) on toolrank-01 `d065f71e` (KEEP 11-12 11:02Z, promoted 11-12 11:12Z) on fullplace-01 `29c8bc57` (KEEP 11-12 09:13Z, promoted 11-12 09:23Z) on townmine-01 `54c4835a` (KEEP 11-12 05:37Z, promoted 11-12 05:47Z) |
| **Canary in slot** | EMPTY (last close stationsback-01 KEEP 11-12 22:37Z) |
| **Queue (front)** | chestmerge-01 -> gathermem-01 -> regcount-01 -> ironchain-02 -> glass-01 -> boardwalk-03 -> villageunlock-01 -> coalsale-01 -> coalsale-02 -> jobsite-01 -> +12 more. Held: forest-01 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...) |
| **Scheduler** | wait H2 chestmerge-01: no variant for the fleet base d045828 (have: 482b05c): autorebase of 482b05c5..825f2a3d is building (step rerun, pid 2174314, heartbeat 2026-11-12T23:19:33Z) |
| **Showcase release** | `9a6502e2` (20,667 rows), `da8db7fe` (12,257 rows), `99b4d8b0` (11,989 rows); 14 bots in 3 h. Protected tree vs fleet KEEP: **no_base** (no kept fleet build has the live release 9a6502e2's protected tree: restack by hand; row 11-12 22:25Z) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Pending owner decisions** | none recorded (ledger rows with `owner_pending`); technical holds are under Queue |
| **Projects (daily audit)** | project audit fleet (11-12T12:05Z, 7 d, 172 projects, 15,016,143 lines / 80 bots): 1 broken, 8 underused, 81 effective, 58 unmeasured, 24 - -- isolated-a/shop BROKEN; showcase: project audit showcase (11-12T12:05Z, 7 d, 39 projects, 2,012,080 lines / 15 bots): 3 dormant, 13 effective, 12 unmeasured, 11 - -- showcase/canefarm DORMANT; showcase/enchantshop DORMANT; showcase/treefarm DORMANT |
| **Open alarms** | STALLCHECK 2026-11-12T22:35:01Z STALLED: 205. OPSAUDIT 2026-11-12 FLAGS: 11 (1 high). 120 active alarm(s): stuck goals 12 (board-a/tidy@355_73_147, hive-a/monument@355_73_147, hive-b/tidy@355_73_147, hive-d/monument@68_65_68, isolated-a/monument@355_73_147, isolated-b/monument@355_73_147 ...); effectwatch effect:cobbleroom-01:h24, effectwatch effect:escdead-01:h72, effectwatch effect:gklease-02:h72, effectwatch effect:gkwork-01:h24, effectwatch effect:gkwork-01:h72 |
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
