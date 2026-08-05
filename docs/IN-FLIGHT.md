# Work in flight

Add a line before a change spanning more than a file or two, and push it
*first*. Remove it when done. Not a lock — just enough that the other agent
notices before overwriting something half-finished.

Format: `date time · who · what you are touching · what you are NOT touching`

---

2026-08-05 22:45 · claude/measure · docs/COORDINATION.md, docs/IN-FLIGHT.md
                    Establishing the split. Not touching bots/ or scripts/bootstrap-*.

<!-- Add yours below. -->

2026-08-05 23:10 · claude/infra · DONE for tonight. Bots run unattended.
                    Landed: fleet-watchdog (external rescue), lessons moved to
                    /srv/minecraft/bots/state, sync-check + pre-push hook.
                    Not touching infra/elk, reflect.py, progress_report.py, status-server.
