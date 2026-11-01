# STATE — one screen of current state

_Updated 2026-11-01 12:45Z (control session; answers the 10-31 Codex ops-audit HIGH flag: STATE contradicted completed events)._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).
Live check: `python3 ~/canary-sched.py status | tail -20`, `tail ~/canary-journal.jsonl`, `head -30 ~/digest/latest.md`,
`~/digest/stallcheck-latest.md` on the canary host; `sudo /srv/showcase/bin/showcase_ops.py status` on the showcase host.

| | Now |
|---|---|
| **Fleet** | `52d9281a` = airpocketwin-01 (KEEP 08:31Z, promoted 08:41Z) on tombexit-01 `1a0f9ddf` (KEEP 04:43Z) on zigfleet-02 `2717bc1c` (KEEP 00:52Z: paths/wall fleet-wide, voidfill, zigtidy, wallstuck, furnaceseen, treefarm code off) on escapeguard-01 `a11ffbb8` (KEEP 10-31 21:35Z) on shaft-03. All 80 bots on qwen2.5:7b on the 5080 (no model experiment running -- see In flight) |
| **Canary in slot** | lavatarget-01 KEEP (goal-unverified) recorded 12:24Z, promoting ~12:35Z |
| **Queue (front)** | promptcache-01 (P, prompt diet) -> apseal-01 (S, sea-level drowning: seal the roof cell's wet sides) -> fleetbuild-01 (P: FLEETPATHS no-site so walls start, ZIGBAMBOO, zigsealed) -> cooldown15-01 (P, setting: decision cooldown cap 30 s -> 15 s in config.mjs, 4 pools; read lines + capacity in docs/reports/cooldown15-01-2026-11-01.md) -> fewerdec-01 (P, serving D: PAUSEWAIT/VETOSKIP/CONTINUE; predicted -15..20% model calls, in-skill share up) -> tidy-01 (P, town-ground tidy: cut pillars, fill pits, grade the paths' corridors, re-site the paths; offline 7/16 towns' paths route after it, 1 before; docs/reports/tidy-01-2026-11-01.md) -> servea-01 (HELD: serving A, 5 bots on the 3090 llama-server, cand-c2-q8; docs/reports/serving-A-2026-11-01.md) -> parked: townfloor-01, bamboo-03, foldwatch-01, treefarm-03 (dead variants), qwen35c2-01 (held). Scheduler v39 auto-rebases a head with a `patch` onto the live tip |
| **Showcase release** | `f18de545` (zigsealed) on `01e64d4e` (= fleet 2717bc1c protected tree + expeditions + SHAFT off). Rule: showcase protected code follows the latest fleet KEEP. All 6 project records complete (ziggurat 4889/4889, wall 940/941, paths 263/263, house, workshop, tree farm). Expeditions live. 10/10 bots, tripwire WATCH |
| **Death breaker** | ARMED (`mcai-tripper.timer`, 5 min, `--apply`) on .31; ntfy alerts |
| **Pending owner decisions** | **5080 (pve4) SSH host key changed 10-02, unverified: owner verifies at the console before llama-server goes there (serving A)**; Vendor output terms before any Claude/GPT teacher label is trained on (labels quarantined, eval-only); release of `qwen35c2-01`; qwen3.5 for the fleet needs serving the 5080/3090 cannot give at 107/min (see batching report) -- owner rule: Blackwell is testing-only |
| **Open alarms** | Stallcheck STALLED ~32 (dead-variant parked entries, towniron re-stacks, mine-safety lane items, crons nobody reads). Stuck fleet projects: board-a house1 (39 h, no_stand), workshops board-d / hive-d / isolated-b, hive-a shaft (no_support), ziggurats hive-b (bamboo -> fleetbuild-01), isolated-d, placebo-a. Cooperation census control `xfer_through_chain` FAILED 11-01 |

## In flight

- **qwen3.5 A/B (15 bots isolated-a/isolated-c/placebo-c on the Blackwell vs 65 control):** started 10-31 22:03Z, FALSE-STOPPED ~1 h later (crash_loops probe treated a quiet journal as unreadable; rollback proven). Probe fix + relaunch in progress; 24 h DiD compare + mandatory rollback from the new start. The 80-bot run 10-31 17:11-18:58Z collapsed (512/610 decisions aborted at 90 s in the 18:30Z bin) and auto-rolled back -- the Blackwell cannot serve 80 bots on qwen3.5.
- **Cooperation B5 Paper arms** on the worlds host (sandboxes 5/6/8, lock `coop`, Mac relay `caller_relay.py`): still running at 12:30Z; read with `sandbox/coop/arms-read.py`; B6 shadow only if the oracle beats rotation.
- **Learning loop:** teacher pilot DONE -- Claude Opus 5.5 $11.61, GPT-6.1-sol $4.97 (Claude vs GPT agree 72.5%, local teacher ~59%); candidate 2 passes the offline bar (most rep_fail gain is the Q8 quant). 3090 batching test: llama-server tops out ~46/min (prompt prefill-bound), not fleet-capable; prompt diet = promptcache-01.
- **Survival lane** (10-23 order restarted 10-31): tombexit, airpocketwin, lavatarget KEPT; apseal-01 queued; minelava not built (2/42 fire deaths). Town-ground tidy = tidy-01, queued (P).

## Lab mode

None declared.
