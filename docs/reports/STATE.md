# STATE — one screen of current state

_Updated 2026-10-29 00:05Z (fun mode). Overwrite the facts below whenever they change; do not append history._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).
Live check: `python3 ~/canary-sched.py status | tail -20`, `tail ~/canary-journal.jsonl`, `head -30 ~/digest/latest.md`
on the canary host; `sudo /srv/showcase/bin/showcase_ops.py status` on the showcase host.

| | Now |
|---|---|
| **Fleet** | `d4602c9e` (trunk-01 KEPT, promoted 22:45Z) on 80 bots. One trunk: fleet and showcase both from main |
| **Showcase release** | `85aaebdb` (main lineage incl. workbench-01), activated 22:54Z, 60-min watch clean. Workshop@1 COMPLETE 18:37Z. AUTO_FOLLOW off; the follower's ROLLBACK line predates following main (rule to update) |
| **Canary in slot** | smeltgate-01 `25f605b9` launched 23:35Z (drawing) |
| **Queue (front)** | kitmulti-01 -> chestreach-01 -> cornerwalk-01 -> tdoffer-01 -> tdfull-01 -> logsurface-01 -> townfloor-01 (HELD); monument-01, shaft-01 HELD; bamboo-03, foldwatch-01, treefarm-03 PARKED. Each promotion moves the base: `replace-variant` the next entry before its turn |
| **Death breaker** | ARMED 10-28 18:12Z: `mcai-tripper.timer` (5 min, `--apply`) on .31 from `/srv/mcai-tripper-armed` @ 48955003; alerts via ntfy (`/etc/mcai-alert.conf` on .31 and .40) |
| **Pending owner decisions** | placebo-a plank-lidded chest (250,74,-141): code fix and/or owner one-off removal |
| **Open alarms** | The digest's quick-status line is broken (`/tmp/quickstatus.py` missing) |

## In flight (fun mode, owner-approved 10-28)

- W1-W6 landed (rules, showcase gate, one trunk, generic reads, alarms, parallel tests).
- Success-rate fixes (owner 10-28): the seven queue entries above. workbench-01 (workshop = town workbench) live on the showcase.
- Learning loop: Qwen replay comparison overnight; d1-3B tested (not a candidate); Clef-flash on the 3090 after the replays.

## Lab mode

None declared.
