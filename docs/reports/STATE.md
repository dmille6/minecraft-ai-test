# STATE — one screen of current state

_Updated 2026-10-31 00:40Z (whole table refreshed: Codex ops audit 10-29 flag 1). Overwrite the facts below whenever they change; do not append history._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).
Live check: `python3 ~/canary-sched.py status | tail -20`, `tail ~/canary-journal.jsonl`, `head -30 ~/digest/latest.md`
on the canary host; `sudo /srv/showcase/bin/showcase_ops.py status` on the showcase host.

| | Now |
|---|---|
| **Fleet** | `69116052` (zigfleet-01 KEPT 22:51Z, promoted 10-30 23:01Z) on 80 bots: main's building stack (house-01 HOUSE on, ziggurat v2 + zigtidy, monumentOn `'*'`, shopwalls, workbench, coalsite-01, stuckwait-01) on lidplank-01 `4d43a9ca` (KEPT 18:59Z) on logsurface-01 `d1453ed2` (KEPT 15:44Z) on tdfull-01 `5aadb1ed` (KEPT 12:25Z). Rollback of the building stack: `MONUMENT=off` + `HOUSE=off`, or `4d43a9ca` |
| **Canary in slot** | shaft-02 `aad2506a` (town stair: 3x3 stone spiral to y=16, landings y48/32/16, build + use; tier 3, both engines APPROVE) deployed 10-30 23:42Z on board-c, board-d, placebo-a, placebo-d; reads +90 ~01:12Z, +180 ~02:42Z. `SHAFT=off`. Pre-deploy world backup of all 16 worlds: NAS `world-backups-adhoc/2026-10-30-preshaft` |
| **Queue (front)** | after shaft-02 the head is townfloor-01 (HELD, stale) -> **the slot idles unless the next entry is placed before it**. Being prepared: a model canary (qwen3.5:9b, env-only, served off .72) after shaft-02. bamboo-03, foldwatch-01, treefarm-03 PARKED. Cancelled 10-30 by the owner: monument-01, shaft-01, stonewithdraw-01 (stale). If shaft-02 REVERTs: no successor variant exists for its base yet |
| **Showcase release** | `a50a6782` (pathsclose-01show) on `3fcc9449` (zigtidy-02show) on `f72cec58` (voidfill) on `2ece6abb` (coalsite + stuckwait) on `3f02eb0e` (coal stack) on `b2cea773` (wall r5). Ziggurat COMPLETE 4889/4889 (voidfill 22:27Z), treads tidied 23:25Z+. Paths COMPLETE 263/263 (00:14Z). Wall building but in a 6 h stuck back-off (Gale 23:17Z, cells 35,68,6 / 34,69,4) -> fix in progress. Start gate red: brain replay feed 10 of 50 prompts (running bots unaffected; `start-bots.sh` would refuse). Rollback: activate the previous release id |
| **Death breaker** | ARMED 10-28 18:12Z: `mcai-tripper.timer` (5 min, `--apply`) on .31 from `/srv/mcai-tripper-armed`; alerts via ntfy |
| **Pending owner decisions** | Vendor terms before any Claude/GPT teacher labels are trained on (learning loop; labels are evaluation-only until then). Escape digs through project cells (`reflex.mjs`, tier 3): guard not built, owner undecided |
| **Open alarms** | The digest's quick-status line is broken (`/tmp/quickstatus.py` missing). Fleet stuck workshops: board-d, hive-d, isolated-b (one open project each, so stuckwait does not help) |

## In flight (fun mode)

- Owner showcase list 10-29: 1 ziggurat DONE, 2 house/paths DONE + wall building, 3 coal LIVE; next 4 tree farm, 5 short expeditions (camera each).
- Learning loop: candidate boot-01 FAILED the replay (imitated the fleet: rep_fail 50 vs base 28.3). Owner 10-30: teacher pilot + candidate 2 on cleaned data, judged against qwen3.5:9b; kill rule after two failures.
- Model canary qwen3.5:9b (replay rep_fail 26.7 vs fleet qwen2.5:7b 67.0) being prepared.

## Lab mode

None declared.
