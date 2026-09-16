# STATE — the operator's state file (regenerated at every verdict; a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-16 11:35 UTC_

## Fleet
- 80 bots / 16 Peaceful worlds, all on **08a3da2** (lava guards v2 + guarded fallback + iron retention; promoted 05:35Z 16 Sep). main = 08a3da2; old main = main-pre-2026-09-16 (426058d).
- Deaths: 0.048/bot-h over 15 Sep; the 90 min after the 05:35 rollout ran 0.083 (restart band, 6 of 10 were pocket drownings).

## Live canary
- **-10+-11 bundle** recovery-ladder-1011b **1d6c97d** (flooded-pocket rung + step 4b, canopy drop measure) on **hive-b,board-b**, declared **2026-09-16T08:58:37Z**, under v12+v14c+v15c+v16. Reads 09:28 ✓ / 10:28 ✓ (clean, 1 unlinked fall, no pocket exposure yet) / **11:58** / **14:58** = verdict. Monitor bgk54x5h8. Promotion: `scratchpad/promote1011.sh "<note>"` (1d6c97d ff of main verified). Teardown template: `teardown1011.sh` pattern (ledger record with sudo BEFORE clearing the manifest; drop-ins; manifest; restart the pool's bots 12 s apart; confirm versions).

## Queue (histogram order, queue-order.py)
- next: nothing built beyond the live bundle. Candidates for later: seed canary (Wed 17 Sep 10:00Z, after the 72-h read), iron supply (approach-at-depth, week 2), the arbiter (parked).

## Rules in force (docs/reports/recovery-ladder-registration.md)
- v12 linkage (M list; a rung-linked death reverts for LADDER changes), v14c (non-ladder changes: revert unless four report conditions hold), v15c movement guards (blocks moved -30 / working share -20 / immobile +10 pp & 2 bots / items -50; one breach = WATCH, two or one severe = REVERT; calibrated: 2% false-revert, 97% detection), v16 (calibrate before revert; trace refusals to fallbacks; histogram slot order; bundles of two disjoint changes), the owner's death gate (two canary deaths and > 1.25x control), draws at deploy (12-h ledger exclusions, ±25% then ±40% stated, 5080 half, never placebo-c/isolated), `fleet-deploy` refuses a --pool sha that does not descend from declared_code_version (BASE_OK=1 for a reverse canary).

## Standing wake-ups
- 17 Sep 09:34Z: 72-h program STATUS read (`survival72.py 2026-09-14T09:34:09Z` on .31; five numbers by version; no revert unless a rung-linked mechanism).
- 17 Sep 10:00Z: seed canary draw (two re-seeded worlds vs fourteen, 72-h DiD).
- Nightly 00:07Z: iron-funnel line (`~/digest/ironfunnel.log` on .31); first fleet-scale retention read = 17 Sep.
- Tier-1 local analyst every 30 min (`~/digest/*.verdict.json` on .31); Monitor bj8yewx4q surfaces flags.

## Standing constraints (verbatim from the owner)
- No world changes to fix a bot (sandbox only). Swimming is travel. No 192.168.19x network; no UniFi API on 10.0.0.1; never disable rpcbind; never touch the apt timer. One canary at a time (a bundle counts as one). Teardown is THREE steps. Deploy only via `~/bin/fleet-deploy`. Commit with `git commit -F -` heredocs. Two Codex passes per patch, then a smaller patch. Never share a live canary's inference endpoint/model; ARBITER stays OFF. Lab SSH `mike@10.0.0.31` (bots) / `mike@10.0.0.30` (worlds). Status reports live in docs/reports (files under ~/ do not open for the owner). Use `date -u` for clock labels.

## Worktrees
mcai-recovery (recovery-ladder), mcai-rl02 (recovery-ladder-03 = docs/scripts branch), mcai-rllava (lava), mcai-rliron (iron), mcai-rl10 (pocket on 426058d), mcai-canopy, mcai-b0809 (promoted), mcai-b1011b (live), mcai-scene (sandbox harness). Scripts: ~/mcai-analysis (reads, drawrec, arm-read, guardcal, queue-order), /tmp on .31 mirrors them.
