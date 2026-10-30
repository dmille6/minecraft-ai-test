# STATE — one screen of current state

_Updated 2026-10-30 08:40Z (wall-01 on the showcase); earlier 2026-10-30 04:15Z (paths-01); earlier 2026-10-29 13:10Z (fun mode). Overwrite the facts below whenever they change; do not append history._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).
Live check: `python3 ~/canary-sched.py status | tail -20`, `tail ~/canary-journal.jsonl`, `head -30 ~/digest/latest.md`
on the canary host; `sudo /srv/showcase/bin/showcase_ops.py status` on the showcase host.

| | Now |
|---|---|
| **Fleet** | `5acfe13c` (chestreach-01 KEPT, promoted 09:51Z; contains smeltgate-01 + kitmulti-01) on 80 bots. Main `878f0e37` carries them (merged with the showcase stack) |
| **Showcase release** | `b2cea773` (piece wall-01r5) on `960e8c20` (r4) on `8871ab19` (wall-01) on `4133c91a` (paths-01r2). **wall-01** (the town wall, 5th project, WALL on in the showcase pool; main `ffed3412`): sited 06:12:32Z by Comet (ring x -46..35, z -20..39, margin 7; 941 cells: 536 wall, 400 terrace steps, 4 stone-brick posts, 1 torch; gateways at the monument road and the plan's N gate spoke; 12 Q7 sally ports; meets the ziggurat at its NW corner); building (live fixes: r3 the ziggurat tidy is upkeep, r4 lights last + parts drawn first, r5 a repair that does not take -- the paths cell 19,67,16 under a grass block -- waits behind the wall). Report data `docs/reports/wall-01-2026-10-30/`. 60-min check 09:00Z PASS (0 deaths, 10/10, tripper OK; WATCH only: pre-existing + leaves dug in wall cells 20-21,71,-20 read as tree debris). 08:51Z: 179 placed, 798 cleared. Cameras incl. `wall` (capture ~630-670 s of 780). Rollback: activate 960e8c20 / 8871ab19, or 4133c91a (pre-wall); WALL=off. AUTO_FOLLOW off |
| **Canary in slot** | tdfull-01 `5aadb1ed` (on fleet `16052ad8`, coalfirst-01 promoted 10-29 21:31Z) deployed 10-30 09:22:59Z (board-b, board-c, board-d, hive-c); reads +90 ~10:53Z, +180 ~12:23Z. **The slot sat EMPTY 11.5 h (10-29 21:31Z -> 10-30 09:20Z): coalfirst-01's promotion moved the base and no tdfull-01 variant was pre-built for it (H2 block). Pre-build successors for BOTH outcomes before a read closes** |
| **Queue (front)** | kitmulti-01 -> chestreach-01 -> cornerwalk-01 -> tdoffer-01 -> tdfull-01 -> logsurface-01 -> townfloor-01 (HELD); monument-01, shaft-01 HELD; bamboo-03, foldwatch-01, treefarm-03 PARKED. Each promotion moves the base: `replace-variant` the next entry before its turn |
| **Death breaker** | ARMED 10-28 18:12Z: `mcai-tripper.timer` (5 min, `--apply`) on .31 from `/srv/mcai-tripper-armed` @ 48955003; alerts via ntfy (`/etc/mcai-alert.conf` on .31 and .40) |
| **Pending owner decisions** | placebo-a plank-lidded chest (250,74,-141): code fix and/or owner one-off removal. Showcase COAL: the town holds 0 coal (smelt_town 73/75 no_effect "no coal"); bots never mine coal on purpose and burn their incidental pickups (+39/day) on their own batch-1 iron smelts. Options: a coal-run order (cognitive.mjs, tier 3), or let smelt_town burn planks/charcoal (owner "smelt with coal" / Q3 rule) |
| **Open alarms** | The digest's quick-status line is broken (`/tmp/quickstatus.py` missing) |

## In flight (fun mode, owner-approved 10-28)

- W1-W6 landed (rules, showcase gate, one trunk, generic reads, alarms, parallel tests).
- Success-rate fixes (owner 10-28): the seven queue entries above. workbench-01 (workshop = town workbench) live on the showcase.
- Learning loop: Qwen replay comparison overnight; d1-3B tested (not a candidate); Clef-flash on the 3090 after the replays.

## Lab mode

None declared.
