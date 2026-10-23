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
- **Method.** History is the fleet's 72 h and 120 h. Each simulated run draws 4 random canary pools and a random cut. The
  canary's post-period repeats are thinned by the assumed effect. A run KEEPs if the margin is ≥ 0 at +180 or at the
  final read.

| history | effect | +180/+360 | +180/+720 | +180/+1440 | +180/+2880 |
|---|---|---|---|---|---|
| 72 h | 0.7 | 0.20 | 0.41 | 0.78 | (no history) |
| 120 h | 0.7 | 0.18 | 0.29 | 0.46 | 0.62 |
| 120 h | 0.9 | 0.23 | 0.50 | 0.66 | **0.83** |
| 120 h | 0 (null) | 0.01 | 0.01 | 0.00 | 0.00 |

- **Reading of the table.** Only a final read at +2880 (48 h) reaches 80%, and only if the skip removes about 90% of the
  repeats. It should: a repeat is exactly a townmate's empty finding with no load between.
- **If the removal is nearer 70%,** no schedule of 48 h or less reaches 80%. The design then has B3 close
  INCONCLUSIVE: underpowered.
- **False-KEEP rate under the null:** 1% or less.
- **This is recorded in advance:** registration reads at +180 and +360, a final read at +2880, and the lane held up to
  48 h.
