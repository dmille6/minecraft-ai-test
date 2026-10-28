# STATE — one screen of current state

_Updated 2026-10-28 13:10Z (W1, fun mode). Overwrite the facts below whenever they change; do not append history._
Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: [`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).
Live check: `python3 ~/canary-sched.py status | tail -20`, `tail ~/canary-journal.jsonl`, `head -30 ~/digest/latest.md`
on the canary host; `sudo /srv/showcase/bin/showcase_ops.py status` on the showcase host.

| | Now |
|---|---|
| **Fleet** | `c030c2a4` (plugcut-01 KEPT chain on cavefall/ceilescape) on 70 bots; 10 canary bots on `1ac55837` |
| **Showcase release** | `fc300013` (piece fell-01, prev `78975c36`), staged 08:12Z. Not on main. Follow check 13:05Z says ROLLBACK to `8ad4d780` (auto off) |
| **Canary in slot** | respawnfall-01 `1ac55837` on placebo-b, board-b, deployed 08:14Z. **+180 read UNREADABLE** (11:16Z, "no evidence object"); death poll continues; 0 canary deaths |
| **Queue head** | after respawnfall-01: townfloor-01 (HELD on a townzone prerequisite); monument-01, shaft-01 HELD; bamboo-03, foldwatch-01, treefarm-03 PARKED (1 pool each) |
| **Pending owner decisions** | None open. The fun-mode plan W1–W6 was approved in full 10-28 and is in progress |
| **Open alarms** | OpenLoop on respawnfall-01 (unread canary). The showcase is not on main (W3 reconciles it). The digest's quick-status line is broken (`/tmp/quickstatus.py` missing) |

## In flight (fun mode, owner-approved 10-28)

- **W1 rules**: this page, `PROCESS-fun-mode.md` amendments, `config/protected-paths.txt` + `scripts/lib/protected.py`, short `CLAUDE.md`.
- **W2** showcase gate on the shared policy · **W3** one trunk: showcase stack onto main · **W4** generic canary read +90/+180;
  unstick respawnfall-01 first · **W5** rollout ledger, stuck-goal and drift alarms · **W6** test runner speed.
- Until W2 and W4 land, the scripts still enforce the old launch and showcase rules.

## Lab mode

None declared.
