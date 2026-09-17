# Status — 2026-09-17 (daily operator session)

_All times UTC. Clock from `date -u` on this Mac and on 10.0.0.31._

## Summary

Overnight the canary loop reverted and tore down `recovery-ladder-13b` at 04:13Z on a single
death. **That revert was the instrument, not the change — for the second night running, and the
third time overall.** The bundle has now been deployed three times and read zero times.

The day's work was to stop that happening again, mechanically, and then finally get the bundle
measured. Both are done: `recovery-ladder-13c` (same sha, `b1659c0`, change unmodified) is live
on board-b,hive-b from 11:30:00Z under a fixed instrument.

## 1. Open loop: closed before anything else

The host loop had already recorded the verdict and torn down correctly. Verified rather than
assumed: ledger says `no open canary`, manifest `canary_pool`/`canary_code_version` are null,
and **80/80 bots report one version, `1d6c97d`** — the three-step teardown completed, including
the restarts.

## 2. Why -13b's revert was the instrument

The poll fired on `flooded_pocket_rung` inside `hive-a-Bravo`'s 60-second death window
(04:09:35, *"drowned; idle at the moment of death"*). But the rung is **fleet-wide code on the
`1d6c97d` baseline**. Yesterday's own registration note says exactly that — it is why the
`control_rung_rows <= 0` own line had been removed the evening before. The row was left in
`change_rows` and `linkage_extra` anyway.

Positive control over -13b's own window (23:46:01Z–04:13:13Z), denominators first — canary
10 bots / 17,476 rows, control 70 bots / 117,891 rows:

| | canary (hive-a,board-a) | control (14 pools) |
|---|---|---|
| deaths | 1 | 4 |
| `flooded_pocket_rung` rows | 10 | 12 |
| deaths with a change row in the 60-s window | **1 of 1** | **1 of 4** |

The control death carrying it is `isolated-a-Echo` at 00:01:45 — same mechanism, *"drowned;
idle at the moment of death"*. **Applied to the control arm, the test would have reverted
control.** One death in 44 canary bot-h is 0.022/bh against control 0.013/bh: below the owner's
two-death floor, and meaningless as an interval at n=1.

This is the same defect three times, migrating one row at a time:

| canary | row it fired on | why it could not discriminate |
|---|---|---|
| -08c (15 Sep) | `marooned_ramp_cut` | its own ledger note: *"present in both arms; not the change"* |
| -13 (16 Sep 23:20Z) | `death_site_recorded` | written **by** the death handler, so every death carried it |
| -13b (17 Sep 04:13Z) | `flooded_pocket_rung` | fleet-wide baseline code; a control death carried it too |

The root cause is one line of reasoning, not three rows: **`change_rows` was evaluated with no
control comparison and no upstream test.** That is cross-sectional inference inside a rule book
that requires difference-in-differences everywhere else, and a negative claim with no positive
control.

## 3. The fix (v19, prospective)

Two mechanical guards and one demotion, so none of it depends on remembering v19:

1. **Pre-deploy** — `scripts/changerowcheck.py`, wired into `canary-loop.sh` *before the draw*.
   While the fleet is all on baseline, every pool is a control; any declared row the baseline
   already emits is REFUSED and the loop exits without drawing or deploying. It prints its own
   denominators first and refuses to certify anything from a thin read (< 40 bots, < 20 row
   kinds, 0 rows) — a silent instrument must not read as a clean bill of health.
   Proven against the -13b registration: `flooded_pocket_rung` 24, `flooded_pocket_side_exit` 9
   in 6 h across 80 bots → REFUSED, no draw, no deploy.
2. **At read time** — `license_change_rows()` in `verdict.py`. A change row licenses a REVERT
   only if (a) no control death in the same window carries it, and (b) it has been seen on the
   canary at least once *away* from a death. (b) catches a consequence row like
   `death_site_recorded`, which guard 1 cannot see because the baseline is correctly silent on
   new code. The decision is a **pure function** with a behavioural test
   (`scripts/test_license_change_rows.py`, 5 cases incl. "a discriminating row still fires"),
   and a mutant that disables the control check kills it — anchor asserted present and unique,
   applied to a copy, never to `~/verdict.py`.
3. **The single-death rung-linkage override is demoted to a reported WATCH.** It bypassed the
   owner's own calibrated death gate (TWO deaths **and** > 1.25× control), was never calibrated
   itself (v16 requires that of anything that can revert), and its live record is 3 reverts and
   3 false positives. Real harm still reverts: the death gate, the v15c movement guards, the
   v11 guards, the deposit line, and a change row that does discriminate.

**Replay proof:** the exact -13b poll that reverted at 04:13Z returns `POLL_OK` under v19,
naming both refusals and its control denominator; the old instrument on the same data returns
`REVERT`.

## 4. 72-h program status read (wake-up 09:34Z, run 11:10Z)

Window ±72 h around 2026-09-14 09:34Z; coverage 11 Sep 09:34 – 17 Sep 09:34. By version, the
two that matter (`isolated` excluded by the script; this is before/after by version, **not** a
DiD):

| version | bot-h | deaths/bh | immobile | iron-pick | gather ok | items/bh |
|---|---|---|---|---|---|---|
| 08a3da2 (previous) | 751 | 0.031 | 4.6% | 8.3% | 30% | 15.2 |
| **1d6c97d (current)** | **955** | **0.024** | **2.3%** | **9.5%** | **22%** | **6.5** |
| targets (2 wk) | | ≤ 0.05 | ≤ 2% | ≥ 8% | ≥ 40% | ≥ 20 |

Survival is going the right way and is inside target: deaths 0.031 → 0.024/bh, immobile
4.6% → 2.3%, iron-pickaxe share 8.3% → 9.5%. **The two production numbers went the other way:
gather 30% → 22% and items 6.5/bh against 15.2.** No revert is taken on this (the wake-up is a
status read, and no rung-linked mechanism is implicated), and the caveat is real: 1d6c97d's 955
bot-h is ~17 h dominated by the overnight window, before/after by version is not a DiD, and this
project has measured pools swinging −45% → +77% in six hours with no code change at all. It goes
to the queue as the thing to read properly, not as a finding.

## 5. Live canary

`recovery-ladder-13c` = the same bundle, `b1659c0`, **unmodified**. Preflight passed (both
declared rows silent on the baseline; positive control 181,937 rows / 80 bots / 108 kinds).
Drawn at deploy → **board-b,hive-b**; declared_at 2026-09-17T11:30:00.890741Z.
`change_rows` = `death_site_route_crossed`, `explore_target_skipped_death_site`;
`linkage_extra` = `death_site_route_crossed`. `flooded_pocket_rung` and
`flooded_pocket_side_exit` stay as pocketread REPORT lines.
Reads +30/+90/+180/+360 = 12:00, 13:00, 14:30, 17:30Z; extension to +540/+720 until a sealed
verdict; deadline +780 = 00:30Z 18 Sep.

## 6. For the owner

- **The seed canary did not start today.** Its precondition (the 72-h read) is met and nothing
  was live at 10:00Z, so it was due. I ran the code bundle first: it is 6–13 h against the seed
  canary's 72 h, and it field-validates the instrument fix that the seed canary's own reads
  depend on. It slips the seed draw by under a day.
- **A scheduling collision the plan does not resolve, and I did not resolve unilaterally.** The
  seed canary reads two re-seeded worlds against the other fourteen for 72 h by DiD. Any
  fleet-wide promotion inside that window changes the control arm underneath it, and the queue
  promotes roughly daily. Either promotions freeze for the 72 h, or the seed read is accepted as
  coarse. Owner's call; it is queued, not decided.
- **Ledger note defect, carried:** the loop composes its ledger note by re-running `verdict.py`
  at the read loop's last M, so both -13 and -13b recorded a generic `VERDICT UNREADABLE (+N)`
  instead of the reason they were reverted. Noted as cosmetic at v17; it has now cost two
  post-hoc reconstructions, so it is real. Queued.
