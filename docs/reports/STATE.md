# STATE — one screen of current state

_Updated 2026-10-29 15:45Z (monument-01 on the showcase); earlier 2026-10-29 13:10Z (fun mode). Overwrite the facts below whenever they change; do not append history._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).
Live check: `python3 ~/canary-sched.py status | tail -20`, `tail ~/canary-journal.jsonl`, `head -30 ~/digest/latest.md`
on the canary host; `sudo /srv/showcase/bin/showcase_ops.py status` on the showcase host.

| | Now |
|---|---|
| **Fleet** | `5acfe13c` (chestreach-01 KEPT, promoted 09:51Z; contains smeltgate-01 + kitmulti-01) on 80 bots. Main `878f0e37` carries them (merged with the showcase stack) |
| **Showcase release** | `81f6d786` = 0fb6c0b7 (workbench-01 r3 + succfix-01show + house-01) + **monument-01** r1-r5 (the ziggurat, B=30, the town's third project; piece branch zig-show-on-0fb6c0b; same bots/ tree as main 22ad0ef0). monument-01 first live 15:17Z (9e4440ba): sited at once (corner -55,-43, base y 69, stair face e, 4,889 cells; camera `ziggurat`), 0 deaths, tripwire WATCH only; r3-r5 activated 16:07Z (the foundation in four segments; visits end inside the runner's 180-s clock). 60-min check due 17:07Z. Tripwire S6 reads every project record (shopread from 7799b7d0, 15:00Z). Rollback: activate 9e4440ba (or 0fb6c0b7; MONUMENT=off). AUTO_FOLLOW off |
| **Canary in slot** | cornerwalk-01 `8f2bd82b` deployed 10:29Z (board-a, hive-c, hive-a, placebo-d) |
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
