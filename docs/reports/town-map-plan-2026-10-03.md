# Town map ("shared mind map") — staged plan, 2026-10-03

Owner (10-03): a town map of explored/unexplored areas and resources; bots update it and read it. Then (after the
data below): "yes, shared mind map is fine" — updates go to the shared map every few minutes from wherever the bot is,
not only at town.

Both engines designed it independently. They agree: 16x16 chunk cells; record where gathering WORKED and where it
FAILED (a failed approach is not a depleted forest); wood first; no rendering, no wider scans (findBlocks cost nearly
took the host down at radius 96). They differ on scope: Codex builds the full map + expedition orders; Claude says
start with the measured waste. Taken: staged, both.

## Why (measured 10-03, 80 bots, 3 h, full walk)
- Of 1,290 failed log gathers, 1,248 had a log within 40 blocks (median 5). Only 3.2% of log gathers failed
  "nothing found". The bots see wood; they fail to REACH it.
- 696 of 1,062 hard failures (65.5%) are the same bot failing within 16 blocks of its own failure in the previous
  30 min. The cooldown (45 s, keyed on skill+count+block, not place) cannot catch them.
- Town visits are rare: ~0.17 per bot-hour, so a town-only sync would be ~6 h stale -> live shared updates.
- world-facts (today's shared store) is a recent trail: all 12 pool files at the 200-entry cap, oldest 1-4 h,
  oldest-dropped first; sightings only, no outcomes, no inter-process lock.

## Stage 1 — remember where it failed, go where it worked (smallest, first)
Per bot, in memory: a cell grid of gather outcomes by kind (ok / fail with reason, time). Before a gather: if this bot
has >= 2 hard failures for this kind in this cell within 30 min and no success since, refuse (non-voting class) AND
immediately explore toward the nearest cell where that kind succeeded (this bot or, in stage 2, any bot), else the
nearest cell not visited recently within a 96-block ring, else the existing explore bearing. Cap 160 blocks; no night
trips without a bed or within 32 blocks. The refusal chain is tested as a chain (no loop on one spot). Canary: 5 random
bots vs the rest, DiD; primary logs per bot-hour (positive control first); secondary repeat-fail share (baseline 65.5%),
decisions per log; tripwires: refusals/bot-h, explore no_path, deaths.

## Stage 2 — the shared mind map
Per world `town-map-<pool>.json` (versioned, world identity checked): per cell visited/last-visit, per kind seen
(samples, not inventory), ok/fail counts with last times and reasons, a few exact candidates, death/lava marks.
Writes batched every few minutes from wherever the bot is (owner OK), with an OS lock across reread-merge-tmp-rename;
monotonic merges; never sum overlapping samples; corrupt file fails closed. Reads whenever a target is chosen.
Caps: 4,096 cells, 8 MiB. explore-toward's knownTarget reads cells where gathering SUCCEEDED.

## Stage 3 — expeditions (Codex design)
A persistent order prepare -> travel -> gather -> home -> deposit to a known good cell or the frontier of unexplored
land, with limits: 384 blocks, 8 min out + 4 min reserved for return, health/hunger >= 16, food carried, daylight,
2 free slots; refusals enqueue executable remedies; exhausted remedies end in an explicit blocked state.

## Separately (the bigger wood lever, both engines)
Gather's own reach failures: 503 no_path, 218 unreachable, 229 no_safe_target in 3 h ("A* reached a candidate [collect
threw nothing]", "11 of 13 candidates beside water"). Stage 1 routes around them; fixing them is its own change.
