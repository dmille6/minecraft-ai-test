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

### r5: the result that stands (`power-r5-contamination-exact-120h-200sims.log`)
r5 changes three things in the r4 simulation (Codex r4):
- the contamination rule is applied over exactly the read's window, [cut - 24 h, cut), minute-aligned;
- it requires the read's own minimum of 4 canary pools plus 4 controls;
- every cut is reported, defined or not.

- **The result.** In **200 of 200** cuts over the last 120 h, the clean pools were too few, so every simulated run reads
  UNDEFINED at every schedule. KEEP is 0/200, and the null is also 0/200.
- **What it means.** In today's lane, a 4 + 4 clean draw over a 24 h pre-period did not occur once in this sample.
  "Do not queue as is" follows. The owner options below stand.

### r4 (superseded: whole-bucket windows, 6-pool minimum) (`power-r4-contamination-120h-400sims.log`)
- **The method.** At each simulated cut, the simulation now applies the read's own contamination rule to the 24 h
  pre-period (Codex r3 P2): more than 5% of a pool's rows off the fleet majority of their 10-min bucket.
- **The result.** In 92-95% of cuts over the last 120 h, fewer than 4 clean canary pools plus 2 clean controls exist.
  Such a run reads UNDEFINED. **Over all cuts, KEEP is 0/400 for every schedule, even at full removal.** The null is
  also 0/400.
- **So in today's lane (one canary after another, tier-2 pools reused after 240 min), furnaceseen-01 as designed is
  UNDEFINED in the great majority of draws.** Of the few defined ones, none KEEPs in this sample. The share of defined
  draws is too small here to measure power among them. "Do not queue as is" follows; "never readable" is not claimed.
- **The cause** is the 24 h frozen pre-period plus the contamination rule. Both are needed so that a predecessor
  canary's build cannot fake an effect (Claude r2 P2-2).
- **Recorded in advance:** registered as designed, furnaceseen-01 closes UNREADABLE / INCONCLUSIVE. It should not be
  queued as is.
- **Options for the owner.** Each changes the design, so each would need its own review:
  - a 24 h draw cool-off for this run, or a launch preflight that the drawn pools are clean (Claude r3 P3-2);
  - a shorter frozen pre-period (it is 24 h), which is noisier;
  - a proportional statistic, a lower bar, or more pools (tier 3);
  - tier 1, a correctness change with the D1 defect line as its tripwire. The change is small and observe-and-skip
    only, and B2's ledger already measures the opportunity (`repeat_empty_other_bot`).

### r3 (superseded: contamination not modelled) (`power-r3-120h-400sims.log`)
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
