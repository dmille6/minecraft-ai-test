# STATE — one screen of current state

_Updated 2026-10-31 17:55Z (Fleet, Canary, Queue rows: shaft-03 promoted; zigfleet-02 queued). Overwrite the facts below whenever they change; do not append history._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).
Live check: `python3 ~/canary-sched.py status | tail -20`, `tail ~/canary-journal.jsonl`, `head -30 ~/digest/latest.md`
on the canary host; `sudo /srv/showcase/bin/showcase_ops.py status` on the showcase host.

| | Now |
|---|---|
| **Fleet** | `281d5659` (shaft-03, the stuck town stairs, KEPT goal-unverified 17:00Z, promoted 17:10Z) on shaft-02 `aad2506a` on zigfleet-01 `69116052`. 24 h qwen3.5 model experiment (05-model.conf drop-ins, install-hold until ~11-01 03:11Z). Rollback of the stair fix: `SHAFT=off` or `aad2506a` |
| **Canary in slot** | none (shaft-03 closed KEEP 17:00Z); the qwen35 fleet move holds new launches until ~11-01 03:11Z |
| **Queue (front)** | escapeguard-01 (S, held for the qwen35 move) -> **zigfleet-02** (P: voidfill + zigtidy-02 + pathsclose + wallstuck + treefarm-04 code (off) + paths/wall fleet-wide + furnaceseen-01; variants `693b28c9` on 281d5659, `2717bc1c` on escapeguard a11ffbb8; rollback PATHS=off WALL=off FURNACE_SEEN=off) -> tombexit-01 (S, another agent) -> townfloor-01 (PARKED). Closed 10-31: towniron-01 (superseded), cobbleoverflow-01 (no demand) |
| **Showcase release** | `a50a6782` (pathsclose-01show) on `3fcc9449` (zigtidy-02show) on `f72cec58` (voidfill) on `2ece6abb` (coalsite + stuckwait) on `3f02eb0e` (coal stack) on `b2cea773` (wall r5). Ziggurat COMPLETE 4889/4889 (voidfill 22:27Z), treads tidied 23:25Z+. Paths COMPLETE 263/263 (00:14Z). Wall building but in a 6 h stuck back-off (Gale 23:17Z, cells 35,68,6 / 34,69,4) -> fix in progress. Start gate red: brain replay feed 10 of 50 prompts (running bots unaffected; `start-bots.sh` would refuse). Rollback: activate the previous release id |
| **Death breaker** | ARMED 10-28 18:12Z: `mcai-tripper.timer` (5 min, `--apply`) on .31 from `/srv/mcai-tripper-armed`; alerts via ntfy |
| **Pending owner decisions** | Vendor terms before any Claude/GPT teacher labels are trained on (learning loop; labels are evaluation-only until then); release or not of the HELD `qwen35c2-01` (learning-loop candidate 2); OpenAI credit for the GPT teacher arm. Escape digs through project cells (`reflex.mjs`, tier 3): guard not built, owner undecided |
| **Open alarms** | **Stall check** (owner-commitments ledger `config/owner-commitments.json`, hourly `stallcheck.py` on .31, header line `!! STALLED`, report `~/digest/stallcheck-latest.md`): first run 10-31 18:07Z STALLED 30 -- qwen35c2-01 + townfloor-01 dead variants, towniron approved never queued, mine-safety lane F2-F6 unstarted, survival lane, cobbleoverflow, 7 crons nobody reads. (10-31 audit closed: quick status, showcase rollout 0/10, timelapse `.staging`, lavamap retired, idle-slot alarm added.) Fleet stuck workshops: board-d, hive-d, isolated-b (one open project each, so stuckwait does not help) |

## In flight (fun mode)

- Owner showcase list 10-29: 1 ziggurat DONE, 2 house/paths DONE + wall building, 3 coal LIVE; next 4 tree farm, 5 short expeditions (camera each).
- Learning loop: candidate 2 (`cand-qwen35-9b-c2-q8`, Qwen3.5-9B 8-bit LoRA on 5,768 cleaned examples) PASSES the offline bar vs qwen3.5:9b (600-item replay: rep_fail 16.7 vs 25.3, post-veto 7 vs 54, hard 2.0 vs 3.0, schema 100%) -- but stock qwen3.5:9b at Q8_0 is already 20.3/33/1.7 and the candidate answers `surface` on 65% of post-veto items. `qwen35c2-01` HELD at the queue END (owner decision + Blackwell upload, think-unset template check, capacity test first). Teacher pilot: Claude $11.61; OpenAI arm not run (no credit). Report `docs/reports/learnloop-c2-2026-10-31.md`.
- Model canary qwen35-01 (qwen3.5:9b on the Blackwell): KEEP 06:10Z, not promoted (live p50 1.44 s / p95 2.55 s); promotion onto the 5080 is a separate owner step.

## Lab mode

None declared.
