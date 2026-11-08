# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-08T23:20:01Z._

| | Now |
|---|---|
| **Fleet** | `ef774d02` = hivedrop-01 `ef774d02` (KEEP 11-08 21:17Z, promoted 11-08 21:28Z) on sandrung-01 `1e593b9b` (KEEP 11-08 12:33Z, promoted 11-08 12:44Z) on placeaudit-fleet-01 `17df15e2` (KEEP 11-08 09:04Z, promoted 11-08 09:14Z) on escpocket-01 `de538429` (KEEP 11-08 05:35Z, promoted 11-08 05:45Z) on stairuse-01 `2510549e` (KEEP 11-08 01:15Z, promoted 11-08 01:26Z) on gkwork-01 `de9fe23d` (KEEP 11-07 20:44Z, promoted 11-07 20:54Z) |
| **Canary in slot** | EMPTY (last close hivedrop-01 KEEP 11-08 21:17Z) |
| **Queue (front)** | scaftown-01b -> stuckclose-01 -> stoneworks-01 -> glass-01 -> gathermem-01 -> roughground-01 -> irongap-01 -> obsidian-01 -> roughground-02 -> roughground-04 -> +8 more. Held: forest-01 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...); coalsale-01 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...); coalsale-02 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...); jobsite-01 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...); market-01 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...); market-02 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...) |
| **Scheduler** | block H2 stuckclose-01: no variant for the fleet base ef774d0 (have: 1e593b9): no patch source, so no autorebase: build the variant by hand, or `queue set-patch stuckclose-01 <src_base>` / K scaftown-01b skipped (autorebase-refused): scafto |
| **Showcase release** | `dd79b56a` (28,955 rows), `63bc4795` (3,968 rows); 14 bots in 3 h. Protected tree vs fleet KEEP: **no_base** (no kept fleet build has the live release dd79b56a's protected tree: restack by hand; row 11-08 22:25Z) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Pending owner decisions** | **statusreport-1106**: statusreport: put the Anthropic key on the canary host (~/.config/mcai/anthropic.key, mode 600) so the 4x-daily report gets the Haiku 5.5 narrative (~$0.12/month), or keep data-only reports? |
| **Projects (daily audit)** | project audit fleet (11-08T12:05Z, 7 d, 169 projects, 13,793,865 lines / 80 bots): 5 underused, 87 effective, 51 unmeasured, 26 -; showcase: project audit showcase (11-08T12:05Z, 7 d, 33 projects, 1,795,088 lines / 15 bots): 2 broken, 1 underused, 13 effective, 12 unmeasured, 5 - -- showcase/enchantshop BROKEN; showcase/treefarm BROKEN |
| **Open alarms** | STALLCHECK 2026-11-08T22:35:01Z STALLED: 119. OPSAUDIT 2026-11-08 FLAGS: 12 (2 high). 81 active alarm(s): stuck goals 17 (board-a/paths@355_73_147, board-b/tidy@-249_65_144, board-c/shaft@355_73_147, hive-a/tidy@355_73_147, hive-d/monument@68_65_68, isolated-a/monument@355_73_147 ...); driftwatch drift:items_per_bot_h, driftwatch drift:value_per_bot_h, effectwatch effect:buildfix-01:h24, effectwatch effect:gklease-01:h24, effectwatch effect:idlework-02:h24 |
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
