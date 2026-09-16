# STATE — the operator's state file (regenerated at every verdict; a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-16 21:40 UTC_

## Fleet
- 80 bots / 16 Peaceful worlds, all on **1d6c97d** (= 08a3da2 + flooded-pocket rung with step 4b + canopy drop measure; promoted 18:13Z 16 Sep). main = 1d6c97d; previous mains: main-pre-2026-09-16b (08a3da2), main-pre-2026-09-16 (426058d). Verified 20:35Z 16 Sep by RCON on all sixteen servers: 80/80 online, TPS 20.0.
- Deaths: 96 h to 16 Sep 0.054/bot-h (416 on 7,680 bot-h: lava 198, drown 120, fall 96). AFTER the 08a3da2 promotion (05:35Z 16 Sep, 1,216 bot-h): 0.026/bot-h — lava 5, drown 15, fall 11. Before/after on the whole fleet, not a DiD; the 72-h read is the instrument.

## Live canary
- **recovery-ladder-13 = the -13a+-13b BUNDLE, b1659c0 (= 1d6c97d + 2 commits), under the host canary loop** (`~/canary-loop.sh recovery-ladder-13` on .31, started 21:12Z 16 Sep; journal ~/canary-journal.jsonl, pages ~/digest/page.jsonl, deploy log ~/digest/deploy-recovery-ladder-13.log). DEPLOYED by the loop: drawn 21:33:47Z placebo-a,placebo-b (±25%, median 38.5), declared_at 2026-09-16T21:33:48.783275Z, VERIFIED split 21:36Z (1d6c97d+46f884 vs b1659c0+ab74e7). Reads land at 22:04Z (+30), 23:04Z (+90), 00:34Z (+180), 03:34Z (+360); extension +540 06:34Z / +720 09:34Z until a sealed verdict on the canary; deadline +780 = 10:34Z. The first draw at 21:13Z found one pool at ±25% and slept: drawrec.sh (both copies) now widens to ±40% when fewer than TWO qualify, not only when none do (fixed 21:25Z) Reads at +30/+90/+180/+360 (immobiledid, depositread, pocketread, deathread), extension to +540/+720 until a sealed verdict on the canary; the loop acts on verdict.py (KEEP -> promote fleet-wide via fleet-deploy + main fast-forward; REVERT -> three-step teardown). Registration: docs/reports/recovery-ladder-registration.md v17 (RULE.md synced), ~/mcai-analysis/registrations/recovery-ladder-13.json (Mac and host).
- -13a pocket-rung remedies (drowning = 15 of the last 31 deaths): tool-free pillar plans, no cooldown on a refusal, no dig without a pickaxe. -13b death-site exclusion (lava residue; 101/198 lava deaths in 96 h repeated a site in the same pool): deaths become priced sites (pathfinder step price 16, explore target skip, fallback-walk check). Evidence and both reviews: docs/reports/deaths-review-2026-09-16.md. Suite 188/188 at b1659c0. Sandbox: ledge-over-lava with a seeded death site on the pool, candidate b1659c0 vs control 1d6c97d, scripted goto to a goal INSIDE the disc: both alive (moved 14 vs 11), the candidate logged five `death_site_route_crossed` rows (the price is live and the positive control fires) and reached the goal (a bot can still enter and leave a disc). Avoidance itself is not shown by this fixture (the goal sits in the disc); it is read on the canary. corpus-results.tsv 20260916T2109.
- What to read first on the canary: pocketread rung rows by outcome (tool-free runs appear as `flooded_pocket_rung` success/failed rows without "no pickaxe" refusals); deathread `death_site_recorded` (exposure), `death_site_route_crossed` (positive control, expect ~0 once recorded), `control_own_rows` = 0, noPath/bh vs pre. Falls: an analysis item (explore, 35 blocks median; the pathfinder's `infiniteLiquidDropdownDistance` hypothesis; if a path log confirms it, the fix is one flag) — NOT built.

## Canary loop (docs/reports/canary-loop-design.md v3)
- On .31: `~/canary-loop.sh <run_id> [--no-act]`; FIRST REAL RUN is recovery-ladder-13 (the 1011b run was --no-act beside hand reads and skipped the draw phase). The host had no `~/mcai-analysis/drawrec.sh` until 16 Sep 21:05Z (installed: the Mac script with the remote part run locally). Watch the first draw/deploy lines in the journal.
- Tier-1 local analyst every 30 min (`~/digest/*.verdict.json`); tier-0 digest `~/digest/latest.md`.

## Queue (histogram order, queue-order.py — QUEUE dict updated 16 Sep 20:50Z)
- next after the -13 verdict: FALLS analysis (path log at every fall: executed path's drop, movement profile; test the liquid-dropdown hypothesis), then the pocket-rung block floor (need+4 with 5 held: plan the exit geometry, docs/reports/deaths-review §4 (b); both reviews said need+1 cannot fund a side exit), then the POOLING rule -12 (iron; docs/reports/pooling-rule-design.md v3; build NOT started — no worktree has it), then iron supply.
- Seed canary (owner): Wed 17 Sep 10:00Z draw, AFTER the 72-h read; if recovery-ladder-13 is still live at 10:00Z the seed draw waits for its verdict (one canary at a time; the bundle counts as one).

## Rules in force (docs/reports/recovery-ladder-registration.md)
- v12 linkage, v14c, v15c movement guards (calibrated 2% false-revert / 97% detection), v16 (calibrate before revert; trace refusals to fallbacks; histogram slot order; bundles of two disjoint changes), v17 (this bundle's own lines), the owner's death gate (two canary deaths and > 1.25x control), draws at deploy (12-h ledger exclusions, ±25% then ±40%, 5080 half, never placebo-c/isolated), `fleet-deploy` refuses a --pool sha that does not descend from declared_code_version.

## Standing wake-ups
- 17 Sep 09:34Z: 72-h program STATUS read (`survival72.py 2026-09-14T09:34:09Z` on .31; five numbers by version; no revert unless a rung-linked mechanism). A live canary on 10 bots is on another version: read by version.
- 17 Sep 10:00Z: seed canary draw (two re-seeded worlds vs fourteen, 72-h DiD) — only if no canary is live.
- Nightly 00:07Z: iron-funnel line (`~/digest/ironfunnel.log` on .31).
- Tier-1 local analyst every 30 min; Monitor its pages in a fresh session.

## Daily session rotation
- Desktop scheduled task `mcai-daily-session` starts a FRESH session at 06:08 America/Chicago (11:08 UTC). It reads this file first, closes any open canary (the loop may have done so: check the ledger `check-open-loop.py` and the journal BEFORE acting), re-arms the list below, does the queue, rewrites this file.

## Instruments fixed 16 Sep (docs branch d775841)
- `scripts/fleet-status.sh` now points at .31/.30 and asks all sixteen servers over RCON (`scripts/lib/rcon-list.py`); `scripts/fleet-doctor.py` exits 2 instead of printing "0/80 all present" when it asked no server; `Events.rate(bots='auto')` no longer crashes on dict bots (`Events.bots()`); `queue-order.py` QUEUE lists the current candidates.

## Standing constraints (verbatim from the owner)
- No world changes to fix a bot (sandbox only). Swimming is travel. No 192.168.19x network; no UniFi API on 10.0.0.1; never disable rpcbind; never touch the apt timer. One canary at a time (a bundle counts as one). Teardown is THREE steps. Deploy only via `~/bin/fleet-deploy`. Commit with `git commit -F -` heredocs. Two Codex passes per patch, then a smaller patch. Never share a live canary's inference endpoint/model; ARBITER stays OFF. Lab SSH `mike@10.0.0.31` (bots) / `mike@10.0.0.30` (worlds); the lab key on the mini is ~/.ssh/id_ed25519. Status reports live in docs/reports. Use `date -u` for clock labels.

## Worktrees
mcai-deathsites (recovery-ladder-13-deathsites, LIVE candidate b1659c0), mcai-b1011b (1d6c97d = main), mcai-rl02 (recovery-ladder-03 = docs/scripts branch), mcai-recovery (recovery-ladder, iron tools; pooling NOT started), mcai-rllava, mcai-rliron, mcai-rl10, mcai-canopy, mcai-scene (sandbox harness). Scripts: ~/mcai-analysis (reads incl. deathread.py, drawrec, arm-read, guardcal, queue-order); /tmp on .31 mirrors the reads; ~/mcai-analysis on .31 holds drawrec.sh + registrations for the loop.

## Re-arm on a fresh session (monitors are session-local)
1. Loop pages: Monitor tailing `~/digest/page.jsonl` on .31 (new lines) — the loop pages every verdict, deploy, teardown, promotion and error.
2. Death poll: `ssh mike@10.0.0.31 'python3 ~/verdict.py recovery-ladder-13 0 --poll'` every 5 min while the canary is live.
3. Local analyst: Monitor on the latest `~/digest/*.verdict.json` (page=True / gates / REVERT / versions_ok=False only).
4. Wake-ups above (09:34Z read; 10:00Z seed draw if no canary is live).
5. If the loop is dead (`pgrep -f canary-loop`) with a canary declared in the manifest: read `~/canary-journal.jsonl`, take the reads by hand (`bash ~/mcai-analysis/arm-read.sh <M> recovery-ladder-13 "..."`), record the verdict with `check-open-loop.py --record` under sudo BEFORE touching the manifest, then promote or tear down (THREE steps).
