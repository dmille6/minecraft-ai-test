# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-05T15:20:02Z._

| | Now |
|---|---|
| **Fleet** | `aea83708` = llmoai-01 `aea83708` (KEEP 11-04 23:41Z, promoted 11-04 23:51Z) on dirtrung-01 `493c198a` (KEEP 11-04 21:12Z, promoted 11-04 21:22Z) on swimunder-01 `3a7badea` (KEEP 11-04 17:34Z, promoted 11-04 17:43Z) on monustuck-01 `704acf91` (KEEP 11-04 14:02Z, promoted 11-04 14:12Z) on shafttrap-02 `beb79ed2` (KEEP 11-04 09:36Z, promoted 11-04 09:46Z) on swimcentre-01 `0542fccb` (KEEP 11-04 03:58Z, promoted 11-04 04:08Z) |
| **Canary in slot** | EMPTY (last close llmoai-01 KEEP 11-04 23:41Z) |
| **Queue (front)** | dropdig-01 -> leasegen-01 -> pause30-01 -> bamboowalk-01 -> stationkeep-01 -> marks-01 -> towngate-01 -> groundskeeper-01 -> bucketfix-01 -> kittrim-01 -> +9 more |
| **Scheduler** | block H2 dropdig-01: no variant for the fleet base aea8370 (have: 0542fcc): autorebase REFUSED at step repo: the source range 0542fccb..b34bb69b no longer has the queued diff (sha256 c25dbdf805de, queued cdf5219a21cc) -- the head stays bloc |
| **Showcase release** | `9950c3ff` (24,377 rows), `0e8a1cfa` (10,529 rows); 15 bots in 3 h. Protected tree vs fleet KEEP: **conflict** (live 9950c3ff sits on 9fbfdf22 (bagdiet-01); behind by 6: llmoai-01, dirtrung-01, swimunder-01, monustuck-01, shafttrap-02, swimcentre-01; merge conflicts in bo; row 11-05 14:25Z) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Owner-direct / rollouts (24 h)** | servea-roll-s1: owner-direct-check 11-05 01:10Z; servea-roll-s2: owner-direct-check 11-05 02:30Z; servea-roll-s3: owner-direct-check 11-05 03:50Z; servea-roll: rollout-released 11-05 13:55Z |
| **Pending owner decisions** | **enchantshop-1104**: O-L: obsidian-01 is protected code (deep miner + bucket): ride a fleet canary with the job off outside the showcase pool (recommended), or allow a protected delta on the showcase?; **visuals-1105**: visuals-1105 skins: OK to publish the 15 custom skin PNGs through MineSkin (public gallery unless a MineSkin key is given), or upload them yourself at skinsrestorer.net/upload? |
| **Open alarms** | STALLCHECK 2026-11-05T14:35:01Z STALLED: 57. OPSAUDIT 2026-11-04 FLAGS: 10 (1 high). 33 active alarm(s): stuck goals 4 (hive-d/monument@68_65_68, isolated-a/wall@355_73_147, isolated-b/wall@355_73_147, placebo-b/tidy@282_65_-388); effectwatch effect:bagdiet-01:undeclared, effectwatch effect:cooldown15-02:undeclared, effectwatch effect:kitmulti-01:h24, effectwatch effect:kitmulti-01:h72, effectwatch effect:shafttrap-02:undeclared |
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
