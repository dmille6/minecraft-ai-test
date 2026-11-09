# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-09T21:20:01Z._

| | Now |
|---|---|
| **Fleet** | `7d7978e8` = pipeline-01 `7d7978e8` (KEEP 11-09 18:53Z, promoted 11-09 19:03Z) on workboard-01 `3d8ef9de` (KEEP 11-09 15:04Z, promoted 11-09 15:14Z) on stuckclose-01 `bcdba35f` (KEEP 11-09 11:25Z, promoted 11-09 11:36Z) on scaftown-01b `c13e6732` (KEEP 11-09 03:48Z, promoted 11-09 03:58Z) on hivedrop-01 `ef774d02` (KEEP 11-08 21:17Z, promoted 11-08 21:28Z) on sandrung-01 `1e593b9b` (KEEP 11-08 12:33Z, promoted 11-08 12:44Z). Live builds: {'058bf56a8b7d877982cf1c4ccd252185c4be5933+1828e5': 10, '7d7978e8831edb211d7340db3ced5f824cfc4f80+67b00a': 70} |
| **Canary in slot** | **seapocket-01** deployed 11-09 19:15Z; reads +90 11-09 20:45Z, +180 11-09 22:15Z; KEEP auto-promotes ~10 min after the +180 KEEP |
| **Queue (front)** | hivedrop-02 -> stuckfleet-01 -> stuckfleet-02 -> planahead-01 -> stoneworks-01 -> logcap-02 -> cobbleroom-01 -> chestcarry-01 -> toolrank-01 -> gathermem-01 -> +22 more. Held: forest-01 (HELD: queue plan 11-07: held until the showcase shows it working (market 0 trades in 10.5 h; for...) |
| **Scheduler** | busy S1 canary declared: 058bf56a8b7d877982cf1c4ccd252185c4be5933 on placebo-d,placebo-a / S6 open loop: canary 058bf56 is deployed on placebo-d,placebo-a with no KEEP/REVERT/INCONCLUSIVE recorded — read it before starting anything new / S7 |
| **Showcase release** | `de992551` (12,225 rows), `a5ba4078` (7,821 rows); 15 bots in 3 h. Protected tree vs fleet KEEP: **no_base** (no kept fleet build has the live release de992551's protected tree: restack by hand; row 11-09 20:25Z) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Pending owner decisions** | **statusreport-1106**: statusreport: put the Anthropic key on the canary host (~/.config/mcai/anthropic.key, mode 600) so the 4x-daily report gets the Haiku 5.5 narrative (~$0.12/month), or keep data-only reports?; **zoneguard-1109**: zoneguard-01show: accept that a drowning/suffocating bot no longer digs a tripwire-baseline cell for air, and that pours whose flow could reach a guarded cell are refused?; **townmine-1109**: townmine-01: depth feet -53 (owner O6) or -58 (11-09 ask)? keep one deep miner (O13) while the mine is being built?; **citywall-1109**: citywall-1109: the gatehouse on the extension's east road gateway (inset, 12-wide passage) as the default, or the north road R1 / the south side? Grey stone-brick face on the showcase, dark deepslate on the fleet? |
| **Projects (daily audit)** | project audit fleet (11-09T12:05Z, 7 d, 172 projects, 14,239,977 lines / 80 bots): 3 underused, 90 effective, 53 unmeasured, 26 -; showcase: project audit showcase (11-09T12:05Z, 7 d, 33 projects, 1,909,532 lines / 15 bots): 1 dormant, 2 underused, 13 effective, 12 unmeasured, 5 - -- showcase/treefarm DORMANT |
| **Open alarms** | STALLCHECK 2026-11-09T20:35:01Z STALLED: 140. OPSAUDIT 2026-11-08 FLAGS: 12 (2 high). 84 active alarm(s): stuck goals 19 (board-a/paths@355_73_147, board-b/tidy@-249_65_144, board-c/tidy@355_73_147, board-d/tidy@355_73_147, hive-a/tidy@355_73_147, hive-d/monument@68_65_68 ...); driftwatch drift:items_per_bot_h, driftwatch drift:value_per_bot_h, effectwatch effect:gkwork-01:h24, effectwatch effect:idlework-01:h72, effectwatch effect:kitmulti-01:h24 |
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
