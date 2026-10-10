# Canary throughput: the 6-h steady release and three-pool bag fixes (gate v35, 2026-10-10)

**Status: BUILT AND STAGED with rule A' (`~/gate-v35`), NOT INSTALLED.** The coordinator installs it between canaries.

## The problem

The operator and Codex agreed this under the owner's delegation; the owner wants throughput.

Four-pool bag fixes starve:
- withdraw2-01 (REVERT 05:00Z) and toolhygiene-01 (KEEP 11:21Z, promoted 11:31Z) each held four pools for 12 h. That
  left four candidates.
- The productivity band and the exposure filter then left 2–3.
- peacefulkit-01 journalled `draw-short` from 11:39Z onward.
- Every later bag fix hits the same wall.

## Fix (1): six hours instead of twelve, only for a verified steady pool

The rule lives in `scripts/drawsteady.py`. `drawrec.sh` subtracts drawsteady's release from its 12-h ledger exclusion,
before it adds the live canary and the manual exclusions.

A pool is released at 6 h only when **all** of these hold:

1. **Every** ledger decision naming the pool in the last 12 h meets all three conditions:
   - it is a **KEEP**;
   - it was **promoted fleet-wide**: the run's journal `promoted` row names the canary sha, at or after the decision;
   - it is at least 6 h old.

   A REVERT, an INCONCLUSIVE or an unpromoted KEEP keeps 12 h. A decision up to 10 min in the future (clock skew)
   holds the pool. **The ledger is parsed strictly:** any malformed line, an unreadable ts, or a row naming no pool
   releases **nothing**, because an unreadable row could be the REVERT that holds a pool (round 3, Codex).
2. **The pool runs the promoted version, verified, on its whole membership.**
   - Membership is the systemd unit list (`mcbot@<bot>.service`, `--all`), never log activity. A down bot holds its
     pool rather than vanishing from it (round 3, Codex), and the retired `-Charlie` log dirs are not members.
   - Every unit must be active and running.
   - Every bot needs at least 20 rows in the last 60 min, with no unreadable file and no corrupt row. All of those rows
     must be on the fleet version: the promoted sha, or a later fleet deploy declared after the decision.
3. **The carryover has cleared and is not still moving.**
   - Every bot must carry a bag reading in both halves of the hour.
   - The pool's bag fill (bagread's minimum-stack slots, averaged per bot and then per pool) must lie inside the control
     pools' min..max **for the hour, for each half, and for the change between halves**. A pool drifting down through
     the band (36 → 28, averaging 32) fails on the change (round 3, Codex).
   - Control pools are those no decision touched in 12 h, excluding isolated-*, placebo-c and a live canary. Each must
     pass **the same** membership, version, row, corruption and two-halves checks as the candidate (round 3, Codex).
   - At least 4 qualified controls are needed.

Anything unreadable releases nothing: the ledger, the manifest, the unit list or a log file. So does any shortfall in
rows or qualified controls, and so does drawsteady failing or not answering. In every such case the exclusion is 12 h,
exactly as before. Malformed **journal** lines are skipped: losing one can only lose a `promoted` row, which holds the
pool.

**Replay** (`scripts/host/drawsteady_replay.sh`, read-only, the live ledger, journal, logs and current unit list, with
the manifest as it was after each promotion):

| run | +5.5 h | +6.5 h | +8 h | +11 h |
|---|---|---|---|---|
| towndeposit-02 (placebo-b, board-c) | both held: < 6 h | both held: bag fill 35.4 and 34.7, above the controls' 30.6–34.5 | placebo-b released; board-c held (35.0 vs ≤ 34.9) | board-c released; placebo-b held (35.2 vs ≤ 34.7) |
| airpocket-01 (hive-d, placebo-a) | both held: < 6 h | placebo-a released; hive-d held: change -0.47 vs the controls' -0.13..+1.16 | placebo-a released; hive-d held: change -0.45 vs -0.25..+0.49 | both released |

Notes on the replay:
- In the towndeposit-02 replay, hive-d and placebo-a were running airpocket-01's canary build. As controls they were
  correctly **not qualified** (restart lag), and 7 controls remained.
- It found one bug before anything shipped. Decisions made *after* the replay clock counted as held. A decision more
  than 10 min in the future now does not exist yet; a future decision closer than that holds the pool, at age 0.
- **Limit:** the replay uses today's unit list. The `-Charlie` units that existed on 10-08 are not in it, so those
  bots were outside the replay's membership.

The tests are strict. A pool can move in and out of release between draws, which costs throughput and never safety.

## Fix (2): three pools after an hour blocked solely by the four-pool minimum

`bagfixrule.draw_decision` decides, through `bagfixgate.py draw-decide`; the loop only acts on its one line.

**The draw:**
- **DEPLOY** at four or more distinct pools.
- **DEPLOY** at exactly three when the run's own journal shows an unbroken streak of `draw-short` rows that began more
  than 60 min ago (`three_pool_ok`). The streak breaks in four ways:
  - a `draw` row: the loop's start row, or a draw where the band gave fewer than two pools;
  - a `draw-error` row: the decision could not be read (round 3, both engines);
  - a silence of more than 45 min between draw rows;
  - an unreadable timestamp.

  So blocking by the band itself never counts toward the hour. A loop restarted after an install starts a new hour.
- **SHORT** at two (never two), or at three without the hour. It is journalled as `draw-short`.
- **Anything else** (a crash, a timeout, garbled output, or `DRAW ERROR`) is journalled as `draw-error`, and the run
  keeps waiting. Unknown time never counts as time blocked solely by the four-pool minimum (round 3, both engines).
- **NONE** below two. It is journalled as `draw`, which restarts the clock.

A three-pool deploy is journalled as `draw-three` and paged.

**A three-pool run's v33 extension:**
- It reads to **+1920** (24 h × 4/3). That gives the same ~480 nominal bot-h as 20 bots × 24 h.
- The registered containment deadline moves by the same 480 min.
- `extend_min`, `bands`, `ext-min`, extend-check, poll and final all follow the manifest's pool count. Any count other
  than 3 or 4 means the tripped gate stands (REVERT).

**(c)'s bands at three pools** (`scripts/host/bagband3.py`, host data 10-02..10-07):
- The script runs `ugsafe2_gaterule2.py` part A unchanged, with the same data, code and seed as the shipped four-pool
  bands. It first reproduces those bands exactly: **positive control -3.21 / -0.127, REPRODUCED**.

| null, net DiD p2.5 / p50 / p97.5 (log-eq/bot-h) | iron p2.5 (ingot/bot-h) | draws |
|---|---|---|
| 4 pools × 24 h (shipped): -3.21 / +0.65 / +3.28 | -0.127 | 150 |
| **3 pools × 32 h (new): -4.09 / +0.24 / +4.16** | **-0.173** | 102 |
| 3 pools × 24 h: -3.86 / +0.45 / +3.64 | -0.206 | 150 |
| 4 pools × 32 h: -2.46 / +0.23 / +3.68 | -0.116 | 102 |

**The bag metric's own edge at three pools** (round 3, Claude 2a):
- A KEEP at the final read needs the fix's bag metric to move beyond its no-change band. The registered edges are the
  4 pools × 24 h null.
- A three-pool final uses `bag_fix.primary_by_pools["3"]` instead: the 3 pools × 32 h null under the fix's own draw
  filter (`scripts/host/bagnull.py` with BAGNULL_K=3 BAGNULL_H=32, then bagbands.py).
- **A three-pool final with no such edge registered cannot KEEP.** `bagfixrule.primary_spec` returns None, so the read
  is INCONCLUSIVE. The four-pool edge is never applied to a three-pool read (tested).

**Stated plainly:** (c) is less sensitive on three pools. The extra 8 h does not buy back the lost pool: four pools at
32 h would give -2.46. The band is also noisy. With 102 overlapping draws, the 2.5th percentile is roughly the third-lowest
draw.

**Unchanged:**
- the 400 canary bot-h floor at the final read (MIN_EXPOSURE_BH), so a three-pool run that falls short closes
  INCONCLUSIVE;
- (a), (b), coverage, blindness, PAUSED and the deadline containment;
- A', which needs exactly four pools and so never applies at three. Three-pool runs read at +180 and +360 as before.

## Tests

- **`scripts/test_threepool.py`: 116/116 on the host**, with every mutant killed after the unmutated copies pass.
  - **Pure rule:** three_pool_ok, draw_decision, extend_min and bands.
  - **bagfixgate on fixture worlds:**
    - draw-decide on a journal that interleaves another run's rows;
    - ext-min;
    - extend-check at 3, 2 and 4 pools;
    - poll;
    - final at 3 pools: KEEP, NOT_YET at +1500, REVERT (c), +1440-only evidence, and 2 pools. One case is a mild loss
      that lies between the two bands: the three-pool band KEEPs it, and the four-pool band would REVERT it.
  - **drawsteady:** pure cases, plus the CLI on fixture files.
  - **The loop's draw block, executed:** its own text is cut from canary-loop.sh and run by bash with a stub drawrec,
    a fake clock, the real draw-decide and a real journal. Cases:
    - four pools;
    - three pools for 80 min, then deploy;
    - two-pool draws counting toward the hour;
    - never two, for 2.7 h;
    - a band-empty draw restarting the clock;
    - an ordinary canary unchanged;
    - an old streak not counting.
  - **Structural checks, comments stripped:** the EXTMIN and deadline wiring, and where drawrec subtracts.
- **`scripts/host/test_bagfix_loop.py`: 20/20.** The new `keep3` runs the real loop on a three-pool manifest. It extends
  to +1920, reads +180, +360 and +1920 (never +1440), and the final KEEPs on the three-pool bands.
- **`scripts/test_bagfix.py`:** unchanged behaviour. One mutant anchor follows the renamed minute variable.
