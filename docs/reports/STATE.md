# STATE — one screen of current state

_Updated 2026-10-29 13:10Z (fun mode). Overwrite the facts below whenever they change; do not append history._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).
Live check: `python3 ~/canary-sched.py status | tail -20`, `tail ~/canary-journal.jsonl`, `head -30 ~/digest/latest.md`
on the canary host; `sudo /srv/showcase/bin/showcase_ops.py status` on the showcase host.

| | Now |
|---|---|
| **Fleet** | `5acfe13c` (chestreach-01 KEPT, promoted 09:51Z; contains smeltgate-01 + kitmulti-01) on 80 bots. Main `878f0e37` carries them (merged with the showcase stack) |
| **Showcase release** | `0fb6c0b7` = e307fbf0 (workbench-01 r3) + succfix-01show 87ff0dd2 (smeltgate/kitmulti/chestreach; tree == merge of fleet 5acfe13c) + house-01; on main via 878f0e37. Activated 12:52Z, 10/10. **house1 COMPLETE 12:59Z** (sited 12:54Z, W sector, box -39..-33 / -9..-3; camera `house1`). 60-min check FAIL = tripwire S6 H1 off_record 134 (all house1 cells: shopread reads only the `.shop` record); stopped 13:37Z, acked, restarted 13:52Z; 0 deaths. Follow-up: shopread over every project record. AUTO_FOLLOW off |
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
