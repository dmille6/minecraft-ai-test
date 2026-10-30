# STATE — one screen of current state

_Updated 2026-10-30 04:15Z (paths-01 on the showcase); earlier 2026-10-29 15:45Z (monument-01 on the showcase); earlier 2026-10-29 13:10Z (fun mode). Overwrite the facts below whenever they change; do not append history._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).
Live check: `python3 ~/canary-sched.py status | tail -20`, `tail ~/canary-journal.jsonl`, `head -30 ~/digest/latest.md`
on the canary host; `sudo /srv/showcase/bin/showcase_ops.py status` on the showcase host.

| | Now |
|---|---|
| **Fleet** | `5acfe13c` (chestreach-01 KEPT, promoted 09:51Z; contains smeltgate-01 + kitmulti-01) on 80 bots. Main `878f0e37` carries them (merged with the showcase stack) |
| **Showcase release** | `4133c91a` (piece paths-01r2) = `a090d28e` (paths-01) on `6a805b17` (zigtidy-01s on monument-01 r7 `76128aa9`). **paths-01** (the town's paths, 4th project, PATHS on in the showcase pool): sited 02:30Z (5 legs: farm, well, house1, workshop, ziggurat stair; 231 cells), COMPLETE 02:56Z (181 dirt_path by shovel, 49 cobblestone fill/pave); r2 04:06Z extended it to the store row's chests -5,71,8 / -7,71,8 / -8,71,6 (spruce at -8,9 felled, stands' head leaves cleared; their G3 lid_unreach acks can go), COMPLETE 04:06Z. Monument complete; zig2-01 (v2) is on main, not released. 60-min check 03:32Z: WATCH only (pre-existing), 0 deaths. Cameras incl. `paths` (capture ~580 s of 780). Rollback: activate a090d28e (r1) or 6a805b17 (PATHS=off). AUTO_FOLLOW off |
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
