# STATE — the operator's state file (regenerated at every verdict; a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-16 15:05 UTC_

## Fleet
- 80 bots / 16 Peaceful worlds, all on **08a3da2** (lava guards v2 + guarded fallback + iron retention; promoted 05:35Z 16 Sep). main = 08a3da2; old main = main-pre-2026-09-16 (426058d).
- Deaths: 0.048/bot-h over 15 Sep; the 90 min after the 05:35 rollout ran 0.083 (restart band, 6 of 10 were pocket drownings).

## Live canary
- **-10+-11 bundle** recovery-ladder-1011b **1d6c97d** (flooded-pocket rung + step 4b, canopy drop measure) on **hive-b,board-b**, declared **2026-09-16T08:58:37Z**, under v12+v14c+v15c+v16. Reads 09:28 ✓ 10:28 ✓ 11:58 ✓ 14:58 ✓ all clean on safety (deaths 0.017 vs 0.017 at +360; v15c within); pocket exposure 0 sealed verdicts through +360, canopy 1 refusal; EXTENSION in force: reads **17:58 (+540)** and **20:58 (+720)**; verdict at the first read with a sealed verdict on the canary, else KEEP-ON-SAFETY at +720. Monitor bumbj6mbj. Monitor bgk54x5h8. Promotion: `scratchpad/promote1011.sh "<note>"` (1d6c97d ff of main verified). Teardown template: `teardown1011.sh` pattern (ledger record with sudo BEFORE clearing the manifest; drop-ins; manifest; restart the pool's bots 12 s apart; confirm versions).

## Canary loop (built 16 Sep, docs/reports/canary-loop-design.md v3)
- On .31: `~/canary-loop.sh <run_id> [--no-act]` (lock, journal ~/canary-journal.jsonl, draw, deploy via host `~/bin/fleet-deploy` (baseline tripwire), reads from `registrations/<run_id>.json`, `verdict.py` (standing rules + own lines + exposure; `--poll` = linkage + death gate), act, pages to ~/digest/page.jsonl; Monitor bt9wdd969 tails the pages). First run: --no-act beside the hand reads on 1011b; its verdicts matched at +30/+90/+180. Next canary runs under the loop for real once its +360/+540/+720 verdicts match too.
- Tier-1 local analyst reads the current rule + the reads; Monitor bjbdg3c09 surfaces its pages/gates/REVERTs.

## Queue (histogram order, queue-order.py)
- next: the POOLING rule (docs/reports/pooling-rule-design.md v3, two passes closed; build starting 16 Sep 15:00), then iron supply (approach-at-depth, week 2); seed canary Wed 17 Sep 10:00Z after the 72-h read; the arbiter parked.

## Rules in force (docs/reports/recovery-ladder-registration.md)
- v12 linkage (M list; a rung-linked death reverts for LADDER changes), v14c (non-ladder changes: revert unless four report conditions hold), v15c movement guards (blocks moved -30 / working share -20 / immobile +10 pp & 2 bots / items -50; one breach = WATCH, two or one severe = REVERT; calibrated: 2% false-revert, 97% detection), v16 (calibrate before revert; trace refusals to fallbacks; histogram slot order; bundles of two disjoint changes), the owner's death gate (two canary deaths and > 1.25x control), draws at deploy (12-h ledger exclusions, ±25% then ±40% stated, 5080 half, never placebo-c/isolated), `fleet-deploy` refuses a --pool sha that does not descend from declared_code_version (BASE_OK=1 for a reverse canary).

## Standing wake-ups
- 17 Sep 09:34Z: 72-h program STATUS read (`survival72.py 2026-09-14T09:34:09Z` on .31; five numbers by version; no revert unless a rung-linked mechanism).
- 17 Sep 10:00Z: seed canary draw (two re-seeded worlds vs fourteen, 72-h DiD).
- Nightly 00:07Z: iron-funnel line (`~/digest/ironfunnel.log` on .31); first fleet-scale retention read = 17 Sep.
- Tier-1 local analyst every 30 min (`~/digest/*.verdict.json` on .31); Monitor bj8yewx4q surfaces flags.

## Daily session rotation (created 16 Sep 17:52 UTC)
- Desktop scheduled task `mcai-daily-session` (~/.claude/scheduled-tasks/mcai-daily-session/SKILL.md) starts a FRESH session every day at 06:08 America/Chicago (11:08 UTC; 12:08 UTC once CDT ends 1 Nov). It reads this file first, closes any open canary, re-arms the list below, does the queue, and rewrites this file. It fires only while the desktop app is open (a missed run fires at next launch). The previous day's session should be ended once its last verdict is recorded; wake-ups it holds (e.g. 17 Sep 09:34Z/10:00Z) fall to the daily run if it is closed, which runs them ~1.5 h late (the 72-h read takes a fixed window end, so late is fine).

## Standing constraints (verbatim from the owner)
- No world changes to fix a bot (sandbox only). Swimming is travel. No 192.168.19x network; no UniFi API on 10.0.0.1; never disable rpcbind; never touch the apt timer. One canary at a time (a bundle counts as one). Teardown is THREE steps. Deploy only via `~/bin/fleet-deploy`. Commit with `git commit -F -` heredocs. Two Codex passes per patch, then a smaller patch. Never share a live canary's inference endpoint/model; ARBITER stays OFF. Lab SSH `mike@10.0.0.31` (bots) / `mike@10.0.0.30` (worlds). Status reports live in docs/reports (files under ~/ do not open for the owner). Use `date -u` for clock labels.

## Worktrees
mcai-recovery (recovery-ladder), mcai-rl02 (recovery-ladder-03 = docs/scripts branch), mcai-rllava (lava), mcai-rliron (iron), mcai-rl10 (pocket on 426058d), mcai-canopy, mcai-b0809 (promoted), mcai-b1011b (live), mcai-scene (sandbox harness). Scripts: ~/mcai-analysis (reads, drawrec, arm-read, guardcal, queue-order), /tmp on .31 mirrors them.

## Re-arm on a fresh session (monitors are session-local)
1. Reads: `for M in <minutes>; do (bash ~/mcai-analysis/arm-read.sh $M <LABEL> "<read cmds>" > $S/<label>-read-$M.out 2>&1 &); done` (arm-read reads declared_at from the manifest and ships each output to .31 ~/digest/reads/).
2. Death poll + reads-landing Monitor: poll `ssh mike@10.0.0.31 'python3 ~/verdict.py <run_id> 0 --poll'` every 5 min (prints POLL_OK/REVERT with linkage + death gate) and grep the read files for the key lines.
3. Loop pages: Monitor tailing `~/digest/page.jsonl` on .31 (new lines).
4. Local analyst: Monitor on the latest `~/digest/*.verdict.json` (page=True / gates / REVERT / versions_ok=False only).
5. Wake-ups: 17 Sep 09:34Z (72-h read), 17 Sep 10:00Z (seed canary) -- re-arm if the session that holds them ended.
6. Draws: Monitor running `bash ~/mcai-analysis/drawrec.sh` every 20 min, emitting only on DRAW READY (never "not ready").
