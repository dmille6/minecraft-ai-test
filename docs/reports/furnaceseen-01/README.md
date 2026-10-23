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

### r2: the read's own machinery (the result that stands)
After both round-1 reviews the simulation was rebuilt (`power-r2-120h-400sims.log`):
- It uses the read's own machinery: the frozen 24 h pre-period, the frozen eligible control set, span bot-hours and
  `effect_line`.
- Each simulated run has ONE treated trajectory, which both of its reads see.
- The removal share is estimated from the base logs, and binomial intervals are reported.

| 120 h history, 400 runs | +180/+720 | +180/+1440 | +180/+2880 |
|---|---|---|---|
| removal 1.00 (the estimate) | 0.68 (0.64-0.73) | **0.74 (0.70-0.79)** | 0.69 (0.65-0.74) |
| null (effect 0) | 0.007 | 0.015 | 0.005 |

- **The removal share** is estimated at 1.00: in every repeat, the earlier townmate empty was logged before the
  repeating drain's pick. That is an upper bound. Races and lit sightings, which release some walks, are not modelled.
- **No schedule of 48 h or less reaches 80%, even at full removal.** This is also before the tier-2 clean-baseline
  rule, which a +1440 or +2880 tier-2 KEEP additionally needs: verdict.py requires the 4 pools on the controls' build
  for max(240, M) min before the cut.
- **So design 6.3 B3's own rule applies.** *Recorded in advance: furnaceseen-01, registered as designed, closes
  INCONCLUSIVE: underpowered.* Whether it runs at all, or with a changed design, is an owner decision. The options:
  - a lower bar (it is 0.25 x the pre rate; at full removal the true effect is about 1.0 x);
  - more canary pools (tier 3, the old behaviour);
  - a longer horizon than 48 h;
  - shipping it tier 1 as a correctness-only change with the D1 defect line as the tripwire.
- **False-KEEP rate under the null:** 1.5% or less.

### r1 (superseded): the first simulation
Its denominators differed from the read, and it thinned each read independently.

| history | effect | +180/+360 | +180/+720 | +180/+1440 | +180/+2880 |
|---|---|---|---|---|---|
| 72 h | 0.7 | 0.20 | 0.41 | 0.78 | (no history) |
| 120 h | 0.7 | 0.18 | 0.29 | 0.46 | 0.62 |
| 120 h | 0.9 | 0.23 | 0.50 | 0.66 | 0.83 |

## The read on the base build, r2 (`dryrun-base-r2-2026-10-23T1540Z.txt`)
- **The frozen control set:** 9 pools. isolated-a, -c and -d are dropped, because they converted to shared towns
  inside the pre-period.
- **Effect line:** R = -0.08, lower bound -0.47, bar 0.10, margin -0.57, so no false KEEP.
- **D1:** 0. Its positive control reads 0, which is correct: there is no skip build on the base.
- **Positive control:** 26 control repeats.
