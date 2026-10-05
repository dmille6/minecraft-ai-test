# Status 2026-10-05 — daily operator session

- 11:08Z start. This branch's STATE.md was from 10-03 12:15Z; `main` (origin 4ec8cfc, pushed 10:13Z today) is 30+ commits ahead
  and its STATE.md is canonical. Local `main` fast-forwarded to 4ec8cfc. The owner-granted autonomous session (worktree
  heuristic-nightingale-49eee9, remote control active, last activity 10:13Z) still OWNS `main`, the queue and the canonical STATE.
  This session therefore yielded on launches and on `main`, as the 10-03 operator did: it verified, watched, and wrote here.
- **The 10-04 daily operator session left nothing**: no STATE commit on this branch, no status report, last activity 11:08:07Z
  (one tick after start). The 10-04 day was carried entirely by the autonomous session (craftroom-01 KEEP, composter-01 KEEP,
  toolclean-01 KEEP, the one-time chest clear).
- **Overnight (host, verified 11:09Z):** toolclean-01 KEPT +360 at 00:05Z and PROMOTED 1918bb5 fleet-wide 00:14Z.
  chestfull-01 (6c9a8fb, 15 bots) was REVERTED by the death gate at +30 min (03:17Z: 3 canary deaths in 7.2 bot-h vs 0 control
  in 31.7 bot-h, randomization p = 0.0018) and torn down 03:22Z; the ledger holds the decision (check-open-loop names only
  junkwell-01 open). No re-run until a mechanism is found (the owning session's Codex causal review).
- **Live canary junkwell-01 (911d792 on 1918bb5; placebo-a + board-b, 10 bots; declared 10:05:20Z):** canary-loop pid 2608819
  (under chain-after pid 2608817) does the reads. Reads +180 **13:05Z**, +360 **16:05Z** (KEEP possible from +360), extensions
  to 1560, deadline 1680 min. Reads: wellread + immobiledid; change_rows well_built/well_dispose/well_inside/well_pit_open/
  well_retired; licence kind `_well_dispose` min_rows 1.
  - Versions at 11:09Z, 8 min window: exactly two — 1918bb5 (6,905 rows) and 911d792 (889 rows). 70-minute walk: 61,467 rows
    from 80 bots; 8,584 rows from the 10 canary bots (all five of each pool).
  - Verdict poll 11:09Z: POLL_OK, 0 canary deaths in 10.6 bot-h; local analyst 11:00Z: NOT_YET, no gate tripped, no anomalies.
  - **Exposure is already real** (out of 8,584 canary rows): 2 `_well_built` (board-b-Alpha at -260,64,146 10:05Z;
    placebo-a-Delta at 240,68,-155 10:06Z), 3 `_well_dispose` (28 + 17 + 38 = 83 items: eggs, flint, glow ink sacs; slots freed
    4/2/4; misses 0, off-list 0, non-listed 0, other_loss 0, cap closed every time), 1 `_well_refused` (player_near, with the
    wait-and-retry remedy). The licence row exists. Positive control: the fleet-wide walk has the SAME five well kinds and no
    others, i.e. no 1918bb5 bot emits a well row, as the registration claims.
  - A first query of mine returned "0 canary rows"; it read `code.version` on the wrapped row instead of `raw`. The 889-row
    versions() count was the positive control that caught it. Use `Events.load(version=...)`.
- Rule file: `~/digest/RULE.md` on 10.0.0.31 = repo `scripts/host/RULE.md` (md5 746c65e4), nothing to sync.
- Shadow mayor still running (pid 2243789); its decision date is **2026-10-06 03:18Z** — tomorrow's session.
- Iron funnel (24 h, latest line): raw iron 93, ingots 87, iron pickaxes crafted 11, gone 15 — the best 24 h line in the log;
  the tunnel has been fleet-wide since 10-03 22:48Z.
