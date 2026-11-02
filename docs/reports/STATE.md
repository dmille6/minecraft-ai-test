# STATE — one screen of current state (GENERATED hourly)

_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is overwritten. The live copy is `~/digest/STATE.md` on the canary host._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).

<!-- GENERATED:BEGIN -->
_Generated 2026-11-02T13:24:11Z._

| | Now |
|---|---|
| **Fleet** | `c711879e` = fleetbuild-01 `c711879e` (KEEP 11-01 23:37Z, promoted 11-01 23:47Z) on apseal-01 `963e99af` (KEEP 11-01 20:05Z, promoted 11-01 20:15Z) on promptcache-01 `9246217d` (KEEP 11-01 16:14Z, promoted 11-01 16:24Z) on lavatarget-01 `dfb3ff13` (KEEP 11-01 12:24Z, promoted 11-01 12:34Z) on airpocketwin-01 `52d9281a` (KEEP 11-01 08:31Z, promoted 11-01 08:41Z) on tombexit-01 `1a0f9ddf` (KEEP 11-01 04:43Z, promoted 11-01 04:53Z). Live builds: {'c711879efec34974a1bc1c2d7ffd686c94a07104+a2162c': 60, 'f1f5c16cf13c095b0dd2e39535c3a39856d54706+184910': 20} |
| **Canary in slot** | **tidy-01** deployed 11-02 12:36Z; reads +90 11-02 14:06Z, +180 11-02 15:36Z; KEEP auto-promotes ~10 min after the +180 KEEP |
| **Queue (front)** | fewerdec-01 -> drainpick-01 -> stuckcells-01 -> deepminer-01. Held: servea-01 (HELD: released AUTOMATICALLY by the servea waiter (Mac launchd com.mcai.servea-waiter, scripts/h...); llmoai-01 (HELD: serving A (OWNER 11-02 'do what you recommend'): the oai+ client to the whole fleet, neede...); qwen35c2-01 (HELD: OWNER RELEASED 11-01 12:50Z but BLOCKED on upload: the Blackwell port 11438 is an aiohttp ...). Parked: townfloor-01, bamboo-03, foldwatch-01, treefarm-03 |
| **Scheduler** | busy S1 canary declared: f1f5c16cf13c095b0dd2e39535c3a39856d54706 on placebo-a,placebo-d,board-c,board-b / S6 open loop: canary f1f5c16 is deployed on placebo-a,placebo-d,board-c,board-b with no KEEP/REVERT/INCONCLUSIVE recorded — read it b |
| **Showcase release** | `d698024b` (15,791 rows); 10 bots in 3 h. !! no `showcase_restack` row: the protected-follows-fleet check is not running (restack_prep.py) |
| **Death breaker** | ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts |
| **Owner-direct / rollouts (24 h)** | qwen35-roll-s1: owner-direct-check 11-01 23:20Z; qwen35-roll: rollout-hourly 11-02 13:00Z |
| **Pending owner decisions** | none recorded (ledger rows with `owner_pending`); technical holds are under Queue |
| **Open alarms** | STALLCHECK 2026-11-02T12:35:01Z STALLED: 43. OPSAUDIT 2026-11-01 FLAGS: 10 (2 high). 13 active alarm(s): stuck goals 11 (board-a/house1@355_73_147, board-d/shop@355_73_147, hive-a/monument@355_73_147, hive-d/shaft@68_65_68, hive-d/shop@68_65_68, isolated-b/shop@355_73_147 ...); driftwatch drift:items_per_bot_h, driftwatch drift:value_per_bot_h |
<!-- GENERATED:END -->

## Notes

<!-- NOTES:BEGIN (hand-written; stategen.py keeps this block verbatim) -->
_Hand-written context the sources cannot say. Keep it short; date each line; delete what is done._

- **Fleet vs main (11-02, audit 11-01 MEDIUM 4):** none of the six promotions since zigfleet-02 (1a0f9ddf .. c711879e) is an
  ancestor of main, and main LACKS their code (airpocket/apseal/escapeguard hunks). The fleet line and main split at 281d5659;
  a trial merge conflicts in ~36 files. Owner row `main-carries-fleet`: the coordinator's promotion merge is broken -- open.
- **qwen3.5 A/B** (15 bots isolated-a/isolated-c/placebo-c on the Blackwell, 65 control): restarted 11-01 ~22:25Z after the
  false stop; hourly `qwen35-roll` rows; 24 h compare + mandatory rollback from that start.
- **Serving** (OWNER 11-01 vendor terms = A; serving = A + D; OWNER 11-02 ~12:45Z: Qwen3.5-4B r3 = serving direction + next
  model canary): servea-01 = 4B on the 5080, 10 bots, HELD for the learning agent's variant; 5080 host key verified 11-02.
  These owner questions are ANSWERED; what remains are technical holds (see Queue).
- **Learning loop** weekly (cron on the canary host); round 3 closed 11-02 05:06Z; the owner's 11-02 capacity rule is written
  (main dcedd094) before round 3 is re-gated.
- **Showcase:** restack onto fleet c711879e in progress (control session 11-02, audit MEDIUM 3); from now on
  `restack_prep.py` prepares each restack and alarms `restack-showcase`.
- **tidy-01** is in the slot as a fleet canary although it is a tier-2 town feature with the showcase switched off (audit 11-01
  flag 10): its showcase observation was not done first. Decide at its +180 read whether a showcase run is still owed.

## Lab mode

None declared.
<!-- NOTES:END -->
