# furnaceseen-01 (cooperation tier B3) — build record

Design: `docs/reports/cooperation-tier-2026-10-23.md` (origin/main) §6.3 row B3, §6.4 rows B3. Builds on ledger-01 (B2):
this branch carries B2's commits underneath, and B3 is registered only after B2 is KEPT and promoted.

## The change
The furnace drain skips the walk to a furnace a TOWNMATE found empty less than 60 minutes ago (the town ledger's newest
`station` entry), unless newer contrary evidence exists:
- a newer entry that holds items or is lit (a load);
- this bot's own later look that found items;
- this bot's own sighting of the furnace lit (the block state) at or after the empty.

- **The skip is one pure exported function**, `smeltjob.mjs seenSkip`, of exactly the inputs the drain logs at pick time:
  the entry relied on (`se=`), the lit-seen time (`sl=`), this bot's own memory (`so=`), and the fold offset (`off=`).
- **One shared pick.** The ORDER path (`cognitive.mjs`) and the skill's re-pick (`skills.mjs furnaceDrain`) both call
  `skills.mjs drainPickNow`. So a skipped furnace is never ordered and then refused.
- **Rows.** Each skipped (furnace, entry) writes one `_furnace_seen_skip` row, the licence.
- **Rollback.** `FURNACE_SEEN=off` gives the base exactly.

## The read (`scripts/host/furnaceseenread.py`)
- **D1 (defect).** The read replays `seen_skip`, a port bound to the JS function by `bots/test/fixtures/seenskip-golden.json`,
  on the logged inputs. A walk whose inputs say "skip" is a defect, and so is a skip whose inputs say "walk".
  - An entry the read cannot find is unresolved.
  - Two kinds of walk are reported but not counted: appends that raced the pick, and walks released by a lit sighting.
- **Effect.** R = (control's change in repeat empty drains per bot-h) − (canary's change).
  - Its lower bound comes from randomization over towns: every relabelling, one-sided at α = 0.025, which is the
    Bonferroni correction over k = 2 reads that can KEEP.
  - The registered line is lower bound − 0.25 × the canary's pre-period repeat rate ≥ 0.
  - It is `on_fail: REVERT` with no evidence class, so a failure blocks KEEP. An undefined value reads UNREADABLE.
- **Drain body time.** Reported as body-seconds per bot-h, DiD, split by stop class, so the saving is measured.
- **Dry run on the base build** (4 pools as canary, 180 min, 10-23 15:40Z):
  - D1: 0.
  - Null effect: R = 0.345, lower bound 0.0001, bar 0.0835, margin −0.083, so not KEEP.
  - Positive control: 51 control repeat empty drains.

## Power (pre-launch simulation, `scripts/host/furnaceseenpower.py`; logs here)

### r3: the result that stands (`power-r3-120h-400sims.log`)
r3 fixes three things in the r2 simulation:
- **The treated trajectory is sequential.** Removing B@10 makes B@20 compare to A@0, which is retained, so B@20 is
  skipped too (Codex r2 P2-1). There is a fixture for this.
- **The control set is frozen from the pre-period**, with contamination excluded.
- **+360 is now simulated.**

| 120 h history, 400 runs | +180/+360 | +180/+720 | +180/+1440 | +180/+2880 |
|---|---|---|---|---|
| full removal (the estimate) | 0.47 | 0.67 | **0.72** | 0.70 |
| null (no effect) | 0.000 | 0.003 | 0.003 | 0.007 |

- **The intervals are not binomial.** The simulated cuts share history: only about 16, 8, 4 and 2 non-overlapping post
  windows lie in the range. The figures are best read as "about 0.7 at best".
- **Removal is estimated at 1.00, an upper bound** (races and lit sightings are not modelled). So the conclusion holds in
  direction: no schedule of 48 h or less reaches 80%.
- **The tier-2 clean-baseline rule makes it worse.** A tier-2 KEEP after +180 needs the 4 pools on the controls' build
  for max(240, M) min.
- **Registered schedule:** reads at +180 and +360, with the final at +1440, the most powerful one
  (`scripts/host/furnaceseen_reg.py`).
- **Recorded in advance: as registered, furnaceseen-01 closes INCONCLUSIVE: underpowered.** Running or redesigning it is
  an owner decision. The options:
  - a proportional statistic: the change divided by the pre rate, or the log-ratio of pooled rates; the additive shift
    bound is what wastes the 4-pool design (Claude r2 P3-5);
  - a lower bar;
  - more pools (tier 3);
  - tier 1 as a correctness change, with the D1 defect line as the tripwire.

### r1 (superseded): the first simulation
Its denominators differed from the read, and it thinned each read independently.

| history | effect | +180/+360 | +180/+720 | +180/+1440 | +180/+2880 |
|---|---|---|---|---|---|
| 72 h | 0.7 | 0.20 | 0.41 | 0.78 | (no history) |
| 120 h | 0.7 | 0.18 | 0.29 | 0.46 | 0.62 |
| 120 h | 0.9 | 0.23 | 0.50 | 0.66 | 0.83 |

## The read on the base build, r3 (`dryrun-base-r3-2026-10-23T1540Z.txt`)
- **Contamination rule (Claude r2 P2-2).** A pool whose 24 h pre-period ran another build is out. "Ran another build"
  means more than 5% of its rows were off the fleet's majority build within the same 10-min bucket.
  - Applied to the dry run's canary pools, this makes the effect line UNDEFINED. Board-a, hive-b, hive-c and placebo-a
    all ran other canaries in the 24 h before 10-23 15:40Z: 20-37% of their rows.
  - It also dropped 5 controls, leaving 4.
- **What that means for the lane.** As it runs today, a 24 h clean pre-period across 4 drawn pools is rare. So besides
  being underpowered, B3 as designed would mostly read UNREADABLE. This is a second reason for the owner decision above.
  A draw cool-off of at least 24 h for this run is the alternative Claude r2 named.
- **D1:** 0, and its positive control reads 0 (no skip build on the base).
- **Positive control:** control repeat empty drains are present.

## The read on the base build, r2 (`dryrun-base-r2-2026-10-23T1540Z.txt`)
- **The frozen control set:** 9 pools. isolated-a, -c and -d are dropped, because they converted to shared towns
  inside the pre-period.
- **Effect line:** R = -0.08, lower bound -0.47, bar 0.10, margin -0.57, so no false KEEP.
- **D1:** 0. Its positive control reads 0, which is correct: there is no skip build on the base.
- **Positive control:** 26 control repeats.
