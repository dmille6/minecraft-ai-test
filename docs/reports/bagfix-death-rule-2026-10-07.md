# The bag-fix death rule (gate v33): value measure, re-run table, backtest, implementation (2026-10-07)

**Status: BUILT AND STAGED, NOT INSTALLED.** The files are on `main`, staged on the fleet host in `~/bagfix-v33/`, and
the install's dry run passes. The install is the operator's step, between canaries (section 6).

**At 20:43Z the dry run correctly reported WOULD REFUSE.** `~/launch-td02.sh` is waiting to launch towndeposit-02 at
22:20Z.

## For the owner: the short version

1. **Your decision (10-07 ~19:45Z) is implemented as written, with one substitution.**
   - Mid-run widening is not safe. A bag fix is instead **drawn at four pools (20 bots) from the start**, so the extension runs on the
     same bots with the same `declared_at`.
   - Section 5 explains why.
   - The cost:
     - a bag fix's first 6 h use 20 bots;
     - the loop **waits for a four-pool draw**. Since 09-28 the band gave 4 pools in 6 of 21 draws.
2. **The value-weighted output measure exists** (section 2).
   - It counts in log-equivalents:
     - junk, ballast, anything a disposal fix re-picks up, and cobble above the 64 reserve count **0**;
     - iron counts **10 per ingot**;
     - usable tools count at material cost;
     - logs count up to 64 and saplings up to 16.
   - Output is the **net** change in bag value, excluding chest transfers and deaths.
   - Its 24-h null band is **−3.21 log-eq/bot-h** (2.5th percentile). Iron has its own band: **−0.127 ingot/bot-h**.
3. **The re-run table** (section 3; P(REVERT) for a fix that multiplies deaths by k, no output gain):

   | k | today, 10 bots, 6 h | today, 20 bots, 6 h | section 7 as written (24 h for all) | **your rule, as built** |
   |---:|---:|---:|---:|---:|
   | 1 (harmless) | 4.4% | 4.3% | 8.1% | **1.6%** |
   | 1.5 | 13.9% | 15.3% | 32.1% | **11.3%** |
   | 2 | 28.7% | 34.8% | 63.7% | **28.7%** |
   | 3 | 58.3% | 73.2% | 98.9% | **72.2%** |

   **Your rule is more lenient than today's gate on the same 20 bots at every k. That is by construction:** it can only
   turn a death-gate revert into an extension, and a fix that does not trip the gate in 6 h is never read for 24 h.
   - It wrongly reverts far fewer harmless fixes: 1.6% against 4.3%.
   - At k = 2 it reverts about as often as today's 10-bot read.
   - The safety gain of section 7, a 24-h read for every bag fix, is **not** in this rule.
4. **Backtest** (section 4):
   - Of the **17 reverts where deaths entered the decision**, today's gate trips on only 2: chestfull-01 and junkwell-01.
   - **Only junkwell-01 would have extended.** 0 of its 6 deaths were linked, and 13 of its own rows were seen on 7 bots.
     Its lower bound was 1.39.
   - What the extension would have concluded is **unknown**: it was torn down at +308 min.
   - Over 5 h its value net DiD was −17.6 log-eq/bot-h and its iron net −0.36. If those rates had held for 24 h, (c)
     would have reverted it. That is not a 24-h reading.
   - chestfull-01's revert stands either way: its own rows were invisible, and its ceiling bound was 2.47 > 2.0.
5. **Needs you** (section 8):
   - the four-pool substitution, and the draw wait it brings;
   - five fail-closed additions (listed in section 8);
   - the enforced next-slot reservation;
   - the "any build" null band.

## 1. What was built

All of these are in the gate bundle, `python3 ~/verdict.py --gate-digest`, except the loop and canarywatch.

| file | role |
|---|---|
| `scripts/bagfixrule.py` | **The decisions, as pure functions.** `at_trip`, `extended_poll`, `final`, `coverage_ok`, `registration_problems`, `evidence_bound`, `death_linked`, `p_link`, `linked_beyond_chance` and `ceiling_trips`. Also the value measure (`bag_value`, `iron_units`, `value_delta`) and **`accumulate`**: the one estimator used by both the calibration and the live read. The bands live here too. |
| `scripts/bagfixgate.py` | **The loop's measuring half.** Commands: `extend-check`, `poll`, `final` and `check-registration`, plus `window` for backtests. Output is one `BAGFIX <WORD>` line and a JSON artifact. Unreadable logs are counted, never silent. |
| `scripts/verdict.py` | The death-gate REVERT artifact now carries `extra = {by: "death_gate", cd, cbh, kd, kbh}`. Only that REVERT may extend; any other REVERT has no `by`. `--bagfix-extended` makes the all-cause gate report-only, so own lines, v15c and v11 still revert. It is honoured only for a bag fix whose extension the journal records, and is otherwise IGNORED, with a message saying so. The bundle also hashes `bagfixrule.py`, `bagfixgate.py` and `changerowcheck.py`. |
| `scripts/host/canary-loop.sh` | Launch preflights: the bag-fix registration check, drawrec's four-pool target, and the next-slot reservation. Bag fixes are drawn at 4 pools. The REVERT goes to `extend-check`. The extension: re-runs the tripping read with the gate off; polls (a)/(b), reverting if blind ×3; runs reads still due plus a full +1440 read; then `final`. Every decision is journalled before acting, and a resume never records twice. Replay overrides are for tests only. |
| `scripts/host/canarywatch.py` | A recorded extension moves a bag fix's STALE deadline to `bag_fix.extended_deadline_min`. |
| `scripts/changerowcheck.py` | (coordinator item, 10-07) Counts declared change rows from the **baseline build only**. Rows from other builds are a note. A row seen only with no version is refused, and says so. The positive control counts baseline bots only. |
| `scripts/host/install-bagfix-gate.sh` | The install, with `--dry-run`. |
| `scripts/host/v33-rules-paragraph.md` | The v33 entry for `~/digest/RULES-IN-FORCE.md`. |
| `scripts/host/ugsafe2_value.py`, `ugsafe2_gaterule2.py` | The value walk, and the re-run simulation. |

**The registration** of a bag fix adds the block below. `bagfixgate.py check-registration` refuses a malformed one
before the draw.

```json
"class": "bag-fix",
"bag_fix": {"own_kinds": ["_well_dispose", "..."],
            "primary": {"read": "wellread", "field": "junk_slots_did", "op": "<=", "value": -0.5},
            "extended_deadline_min": 1560}
```

- `primary.read` must be one of the registration's `reads`. Its +1440 evidence object must be bound to this canary
  (sha, pools, run, `declared_at`, minute) and fresh. Otherwise the result is INCONCLUSIVE.

## 2. The value-weighted output measure (precondition 2(c))

**The unit is one log** (4 planks, 8 sticks). The weights are in `bagfixrule.py`. Every unlisted name is **0**.

That covers:
- dirt, sand and gravel;
- food (the fleet is peaceful);
- flowers, seeds and bone meal;
- bamboo and slabs;
- the owner's 10-04 junk list and all 124 junk-well names.

| group | weight | cap per bot |
|---|---|---|
| logs / wood / stems (1), planks (¼), sticks (⅛), pooled | 1 per log | 64 log-eq |
| saplings (any) | 1 | 16, the sapling reserve default |
| cobblestone, cobbled_deepslate, raw andesite/diorite/granite, pooled | 0.1 | 64, the reserve; above it 0 |
| raw_iron, iron_ingot, iron ore (both) | 10 (one ingot) | none |
| iron_nugget / iron_block | 10/9, 90 | none |
| coal, charcoal, coal ore | 1 | 32 |
| diamond 20; raw/ingot gold 3; raw/ingot copper 0.5 | | none |
| each **usable** tool copy, at material cost | wooden 0.5–1; stone 0.33–0.55; iron pickaxe/axe 30.25, shovel 10.25, sword 20.1, hoe 20.25; shears 20; flint_and_steel 10; bucket (any) 30; diamond 20–60 | none |
| a spent tool (0 uses left) | 0, so wear-out is consumption | |
| crafting_table 1, furnace 1 | | 1 each |
| chest 2 | | 2 |
| torch 0.25 / ladder 0.3 | | 32 / 16 |

**Why these weights.**
- **Iron is by the ingot.** It is the owner's ceiling, and a stone-tier bot spends roughly ten logs' worth of time per
  ingot.
- **Tools are at material cost, per copy**, so crafting conserves value. 3 ingots + 2 sticks equals one iron pickaxe,
  and the test pins it.
- **Caps are "up to need".**

**Output is the NET change in bag value** between consecutive snapshots. The first version summed only positive
steps; both reviewers showed that churn then counts as production.

**Excluded steps:**
- **a death row:** the bag at death is counted once, as value carried into the death;
- **the respawn step after a death:** that loss belongs to the same death;
- **any transfer, matched by prefix** (`withdraw*`, `deposit*`, `town_deposit*`). This covers the skill rows and the
  events that carry the post-transfer bag. Round 1 found that `_withdraw_pick` credited a withdrawn iron pickaxe as 30
  log-eq of output.
- **any row INSIDE a transfer skill's (start, end) interval** (round 2, `bagfixrule.to_obs`). An event written
  mid-deposit carries the transfer's bag change, whatever its own kind.

**What this fixes:**
- A placed-and-retaken table, a placed-and-broken chest, or a scaffold block placed and re-mined now nets to 0.
- A junk well that re-picks up its own junk scores 0.
- **Net** = (value change − value carried into deaths) per bot-h. **Iron net** is the same on `iron_units`.

**One estimator.** `bagfixrule.accumulate()` produces both the calibration's 5-minute bins and the live 24-h read.
- `bagfixrule.to_obs()` does the re-timing and the transfer intervals for both.
- The live read walks from 6 h before the PRE window to 10 min after the POST window. It therefore sees the previous
  snapshot and the next observation as the continuous calibration walk does.
- `test_bagfix.py` runs BOTH real pipelines on one boundary fixture and requires equal window sums of value, iron, lost
  and bot-seconds. The fixture has a 16-min gap before the window, an event mid-deposit, a death, and an observation
  at the window's end.
- Round 1 found a 10 log-eq edge mismatch; round 2 found that a 16-min gap still mismatched. Each now has a mutant
  (lead 15 min; tail 0).
- A bot silent for more than 6 h before a window still differs between the two walks. That is disclosed, not fixed.

**Positive controls** (value walk over 10-02 17:00Z → 10-07 17:45Z, 80 bots):
- the walk re-derives phase 2's raw measure: gained +0.06%, carried into deaths +0.28%, deaths 304 against 303;
- `accumulate()`'s bot-h equals an.pkl's: 8,886 against 8,881 (+0.06%).

**Fleet totals:**
- net value change: +48,409 log-eq;
- carried into deaths: 34,095 log-eq (112 per death);
- net iron change: +783 ingot-eq;
- iron carried into deaths: 1,271 ingot-eq. **The fleet loses more iron in deaths than it nets.**

**Coverage, checked at the read.** Every arm-window needs at least 20 inventory snapshots per bot-h (the fleet runs
about 350) and a bag on at least 90% of its deaths. Otherwise the result is INCONCLUSIVE. Round 1 showed that stripped
telemetry used to read as zero harm.

## 3. The table, re-run on the value measure, plus the rule as approved

Produced by `scripts/host/ugsafe2_gaterule2.py ~/ugsafe2/an.pkl val3.pkl`; the raw output is in appendix A.

**Inputs:**
- r0 = 0.0341 deaths/bot-h;
- a death carries 112.2 log-eq and 4.18 ingot-eq;
- p_link = 4.7%;
- 2,000 repetitions, about ±2 pp near 50%.

**24-h null, 4 pools, 150 overlapping draws, any build:**
- value net DiD: p2.5 **−3.21**, p50 +0.65, p97.5 +3.28 log-eq/bot-h;
- iron: p2.5 **−0.127**, p50 +0.013, p97.5 +0.153 ingot/bot-h;
- raw items reproduce section 7's −14.3 / +4.4 / +24.1.

**What a doubling of deaths costs:** 3.83 log-eq/bot-h and 0.143 ingot/bot-h. Both bands are about one doubling wide.

**P(REVERT)**, with [extra canary deaths before the decision]. g = +4.6 log-eq/bot-h is 1.2× what a doubling costs.

| k | g | today 6 h/10 | today 6 h/20 | section 7 (24 h for all) | **as built (20 bots)** | widened 10→20 (idealised) | P(EXTEND) as built |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 4.4% [0.0] | 4.3% [0.0] | 8.1% [0.0] | **1.6% [0.0]** | 3.1% | 3.5% |
| 1.5 | 0 | 13.9% [0.9] | 15.3% [1.9] | 32.1% [7.9] | **11.3% [2.6]** | 9.5% | 12.6% |
| 2 | 0 | 28.7% [1.7] | 34.8% [3.4] | 63.7% [14.2] | **28.7% [5.6]** | 25.2% | 24.6% |
| 3 | 0 | 58.3% [2.8] | 73.2% [4.9] | 98.9% [16.6] | **72.2% [9.4]** | 58.1% | 51.9% |
| 1 | +4.6 | 5.9% | 4.2% | 5.1% | **2.4%** | 2.5% | 4.5% |
| 2 | +4.6 | 28.3% | 33.0% | 58.4% | **28.5%** | 24.5% | 24.6% |
| 3 | +4.6 | 58.1% | 72.5% | 97.7% | **73.9%** | 57.7% | 53.2% |

**Where the rule-as-built reverts come from, at k = 2, g = 0:**
- 10.2: (b) in the extension;
- 9.3: a coincidental link at the trip, which is no extension;
- 7.2: the value band;
- 1.4: the iron band;
- 0.5: (b) at the trip;
- 0.1: (a).

**Reading it:**
- **The rule as approved is a leniency rule.** It never adds a 24-h read to a fix that did not trip.
- **The coincidental-link condition at the trip does real work.** The owner's rule allows no extension when any death
  is linked. With about 6 deaths at a trip and p_link at about 5%, roughly a quarter of tripped fixes are reverted on a
  link that is coincidence. That is conservative, and it is the rule as written.
- **Widening 10→20 at the trip** (idealised: none of the section 5 hazards modelled) reverts less than starting at 20.
  It runs the first 6 h on half the bots, so it trips less often.
- **Not simulated:**
  - the round-1 fail-closed conditions (blind polls, own rows on ≥ 2 bots, coverage, the gate cross-check), all of
    which can only add reverts or INCONCLUSIVE;
  - the INCONCLUSIVE outcomes (bag metric, exposure).

**The null is uniform over eligible pools. Live draws are not.**
- drawrec matches on a productivity band and requires exposure.
- junkwell-01's canary ran its PRE window at 4× control on this measure (9.7 against 2.4 log-eq/bot-h). That is the
  regression-to-the-mean setup that pushes (c) toward a false REVERT, and this null does not model it.
- The null's median is +0.70, not 0. Real canaries sit on both sides of the band.
- **The band is approximate.** It should be re-measured on band-matched draws once 48 h of single-build pools exist.

## 4. Backtest: every revert where deaths entered the decision

**Sources:**
- `~/gatecost-20260924/replay.py` for the 14 reverts up to 09-24, using counts quoted from the ledger;
- the canary journal and `~/digest/reads/*-verdict-*.json` for the later ones;
- re-measurement from the logs with `bagfixgate.py window`, the same code `extend-check` runs.

**For each revert:**
- **Today's gate** = `deathgate.death_gate` (the v21 lower bound with the two-death floor).
- **Bag fix?** = would its primary metric free bag slots (section 7 2(a))?

| revert | deaths (c / k, bot-h) | recorded reason | today's gate | bag fix? | as a bag fix |
|---|---|---|---|---|---|
| cooldown-20s-a | 1/15 vs 5/225 | point ratio, 1 death | holds (below floor) | no | n/a (no trip) |
| hole-walks | 1/7.5 vs 4/113 | point ratio, 1 death | holds | no | n/a |
| approach-04 | 2/7.1 vs 17/137 | point ratio 2.28x | holds (LB 0.38) | no | n/a |
| rl-02 | 2/6 vs 3/90 | point ratio 10x | holds (LB 1.24) | no | n/a |
| rl-03 | 1/50 vs 12/200 | v9 linkage, 1 death | holds | no | n/a |
| rl-04 | 1/2.8 vs 10/200 | v10 linkage, 1 death | holds | no | n/a |
| rl-08 | 1/15 vs 8/150 | own-line defect | holds | no | n/a |
| rl-08b | 2/25 vs 2/154 | point ratio + mechanism | holds (LB 0.67) | no | n/a |
| rl-08c | 2/55 vs 8/275 | v12 linkage | holds (LB 0.19) | no | n/a |
| rl-13 | 1/50 vs 10/250 | UNREADABLE + linkage | holds | no | n/a |
| rl-13b | 1/50 vs 10/250 | UNREADABLE + linkage | holds | no | n/a |
| falls-01 | 2/23.3 vs 2/154 | point ratio | holds (LB 0.71) | no | n/a |
| owner-01b | 1/10 vs 3/111 | change row, 1 death | holds | no | n/a |
| needsdrop-01 | 2/57.4 vs 2/172 | primary refuted | holds (LB 0.32) | no | n/a |
| blindstep-01 | 4/113.9 vs 3/341.8 | v23 licensed change row | holds (LB 0.87) | no | n/a. Not the all-cause gate, and 1 death is linked (`explore_blind_step_reverse`, hive-b-Echo 17:07:44). It stands. |
| **chestfull-01** | 3/7.5 vs 0/31.7 | **death gate**, LB 2.58 | **trips** | yes | **REVERT stands.** 0 of the fix's own rows in 30 min. The positive control is 1,928 canary-build rows on board-a with no `_deposit_*` row. And (b) holds anyway: LB 2.47 > 2.0. |
| **junkwell-01** | 6/51.3 vs 11/358.2 | **death gate**, LB 1.40 | **trips** | yes | **EXTEND.** 0 of 6 linked, 13 own rows on 7 bots (all death-free), p_link 0.008, LB 1.39 ≤ 2.0. |

**Notes:**
- The table lists 14 replay cases plus 3 later ones. The 15th that `deathgate.py` mentions predates the ledger
  (swim_to).
- fixes-02 and towndeposit-01 are reverts where deaths did not decide: fixes-02 had its gate held at LB 0.34, and
  towndeposit-01 was reverted on v11 climbs.

**What junkwell-01's extension would have concluded: unknown.** The canary was torn down at +308 min, so no 24-h
window on its code exists, and none is invented here.

**What data does exist (descriptive only), over its 5.13 h:**
- value net:
  - canary 9.7 → −5.7;
  - control 2.4 → 4.6;
  - DiD **−17.6 log-eq/bot-h**;
- iron net DiD **−0.36 ingot/bot-h**.
- Both are far beyond the 24-h bands. A 5-h band is wider, and the canary's PRE was 4× control.
- If those rates had held for 24 h, (c) would have reverted it on both. Whether they would have held is what the
  extension exists to learn.

**The loop replay** (`test_bagfix_loop.py --junkwell`, real 10-05 logs, bagfixgate's clock frozen at the recorded
poll-revert):
- extend-check re-measures **6 canary deaths in 51.3 bot-h against 11 in 359.0**. The recorded gate said 51.1 / 358.2,
  which is the positive control.
- It EXTENDS.
- Polls CONTINUE on the frozen data.
- +1440 is never reached on real data. `final` answers NOT_YET, and the extension deadline closes it INCONCLUSIVE.

## 5. Why not widen mid-run, and what is done instead

**A second `fleet-deploy <sha> <run> --pool A,B,C,D` mid-canary is unsafe in five ways:**
1. `deploy-fleet.sh` (which ships with each canary sha, so it cannot be fixed for a given canary) rewrites the whole
   manifest with **one** fresh `declared_at`. Every reader keys on that one field: verdict.py's death poll and its
   evidence binding, immobiledid and every registered read, the tripper's grace, and canarywatch. The trip-time deaths
   on the original pools would fall out of the very poll that must keep reading them.
2. It restarts every target bot, including the pools already on canary. That clears their gate state
   (failedCooldowns, `recent`) and adds old-build restart-lag rows.
3. If only the new pools are passed, `canary_pool` names only them. The tripper then sees the old pools as
   wrong-version bots.
4. `mcai-canary-tree build` does `rm -rf` on the canary tree's `src` under running canary bots.
5. Per-pool `declared_at` would need a manifest field that deploy-fleet.sh's heredoc erases. Every read script would
   also need per-pool windows.

**The safe equivalent, implemented:** a bag fix is drawn at 4 pools (20 bots) from the start.
- `drawrec.sh` on the host targets 4 (`TARGET_K = 4`). The loop and the installer both check that it does.
- When the band gives fewer, the loop journals `draw-short`, redraws every 20 min, and pages once after 3 h.
- The 6-h phase and the extension share bots, pools and `declared_at`. Teardown stays the existing three steps on the
  same pools.

## 6. Install (between canaries only)

`scripts/host/install-bagfix-gate.sh` refuses if any of these hold:
- a `canary-loop.sh` is running;
- any `chain-*`/`launch-*` script is running;
- the manifest is unreadable, or does not say explicitly that no canary is live;
- `drawrec.sh` does not target 4 pools;
- the loop's lock is held.

The real install **holds the loop's lock** until it exits.

**What it does:**
1. It tests in its own staging directory: test_changerowcheck, the 83-case acceptance suite, test_bagfix (which
   refuses if a section is SKIPPED), `bash -n`, and the canarywatch selftest.
2. It predicts the new bundle digest from the files.
3. It rewrites a scratch copy of `RULES-IN-FORCE.md` (exactly one GATE DIGEST line, the parts block, and the v33
   paragraph), and checks it with gatedigest's own regex.
4. It **backs up and verifies every target, and stages every replacement, before touching anything**.
5. It renames each file into place under a rollback trap.
6. It requires `verdict.py --gate-digest` to equal the prediction AND `gatedigest.py` to print OK. **Otherwise it
   restores exactly what existed.**

**Commands** (stage first; see the script header):

```
ssh mike@10.0.0.31 'bash ~/bagfix-v33/install-bagfix-gate.sh --dry-run'
ssh mike@10.0.0.31 'bash ~/bagfix-v33/install-bagfix-gate.sh'      # only with no loop, no chain, no canary
```

The dry-run output is in appendix B.

## 7. Tests and reviews

**`scripts/test_bagfix.py`** (163/163 on the host; 151 off it, where the verdict section reports SKIPPED). It covers:
- **pure behaviour:**
  - weights, crafting conservation, net change, transfers (by prefix and by interval), respawn, and `to_obs`;
  - linkage boundaries, and section 7's linked-deaths table reproduced exactly;
  - every fail-closed branch of `at_trip` (all four gate counts), `extended_poll` (stale and outage), `coverage_ok`
    and `final`;
  - evidence binding and registration checks;
- **bagfixgate as a subprocess over fixture logs:**
  - EXTEND, and REVERT for ten reasons, including no control logs and an unreadable gz;
  - CONTINUE / UNREADABLE (no control, canary logging stopped) / PAUSED (outage) / (b);
  - NOT_YET / KEEP / REVERT (c) ×2 / INCONCLUSIVE ×5;
- **verdict.py v33:**
  - the counts and `by`;
  - `--bagfix-extended` honoured only with a bag fix and a recorded extension, and never labelled "held";
- **one estimator:** the real calibration pipeline against the real live window on a boundary fixture;
- **canarywatch;**
- **45 mutants**, each with its anchor asserted present and unique (two belt-and-braces guards are equivalent behind
  another and are named, not listed).

**`scripts/test_changerowcheck.py`** (14): the towndeposit-02 shape end to end, plus 6 mutants.

**`scripts/host/test_bagfix_loop.py`** (18 + 3, all pass on the host): the loop path, `--no-act`, end to end on a fake
clock. Scenarios:
- keep;
- ceiling;
- linked;
- **readtrip** (the gate trips at a scheduled read, which is re-run gate-off, and an own line there reverts);
- **blind** (3 failed polls → REVERT);
- **resume** (a journalled decision is never re-read);
- **pending** (a crash during extend-check is re-run, and REVERTs on a stale artifact);
- **rerun** (a lost gate-off re-run of the tripping read is redone);
- **readfail** (guard reads that never evaluate are journalled as failed, never done, and 3 REVERT);
- **redeploy** (a decided run id with the manifest cleared is refused before any draw);
- **noguards** (NOT_YET reads that stopped before the guards are failed reads);
- **checkcrash** (a crash after `bagfix-check` keeps the pending REVERT);
- **outage** (every bot silent → PAUSED, paged, 12 → INCONCLUSIVE);
- **basefail / basefail2** (a base read that never evaluated, UNREADABLE before or after the guards, is re-read and
  evaluated in the extension before any final);
- the junkwell-01 recorded replay.

**Acceptance suite:** 83/83 on the host with the new verdict.py.

**Reviews:** appendix C.

## 8. For the owner

1. **Four pools from the start instead of widening** (section 5). The draw may wait. Since 09-28 the band gave 2 pools
   12 times, 3 pools 3 times and 4 pools 6 times.
2. **Fail-closed additions (operator, both reviewers).** Each keeps today's REVERT, or refuses KEEP.
   - **No extension** when:
     - the fix's own rows are visible on fewer than 2 canary bots;
     - either arm's exposure is unmeasured, or a log is unreadable;
     - the re-measurement sees fewer deaths than the gate counted.
   - **REVERT** after three blind extension polls in a row, or after a due guard read fails to evaluate on 3 polls
     in a row.
   - **PAUSED, not blind**, when both arms' telemetry is stale (a fleet outage). It is paged at once. Twelve in a row
     (1 h) close the extension INCONCLUSIVE, because a logging failure with bots running looks the same. Stale
     telemetry in one arm is blind.
   - **INCONCLUSIVE** when value coverage is missing, or when the bag metric is not from a bound +1440 read.
3. **The next-slot reservation is enforced.** While `~/digest/NEXT-SLOT.json` is pending, the loop refuses to launch
   anything that does not declare `"class": "underground-safety"`. Only a VERIFIED deploy of one consumes the
   reservation. airpocket's registration will need that class.
4. **The bands come from an "any build", uniformly drawn null** (section 3). They are approximate.
5. **The extension's guards are only partly simulated.** The table models (a), (b) and (c), not the fail-closed
   conditions.
6. **Loop changes that reach every canary, not only bag fixes** (round 2):
   - A run id that the journal shows deployed or decided is refused at launch when the manifest no longer names its
     sha, because a half-finished teardown used to redeploy it.
   - `recorded` is journalled only after the ledger write succeeds; a failed write pages. A KEEP is promoted only
     once it is recorded. Otherwise the canary stays deployed and the loop exits, and the relaunch retries.
   - A resumed loop does not record a decision twice.
7. **One operator check remains before the first bag fix.** The extension runs the fix's registered read scripts at
   the off-schedule +1440. verdict.py's own +1440 path is tested. A read script that cannot evaluate at +1440 makes
   the extension REVERT as blind. Before the first bag fix, run its reads once at 1440 against a past canary window
   (`CANARY_DRYRUN=pools:sha:iso python3 /tmp/<read>.py 1440`).
8. **Not fixed, disclosed:**
   - A loop relaunched during an interrupted teardown refuses and pages, rather than finishing the restarts itself.
   - A death row torn before its `"name"` field is invisible to the death scan, the poll and the value walk alike.
   - A death row that carries no bag (coverage allows up to 10%) loses its carried value from (c).
   - When a REVERT or INCONCLUSIVE ledger write fails, the teardown still runs and the page asks for a manual ledger
     entry.
9. **20 bots × 24 h is about 440 bot-h at the fleet's uptime.** That is marginal against the 400 bot-h floor: an outage
   during the extension will make it INCONCLUSIVE.

## Appendix A: raw output of `ugsafe2_gaterule2.py` (10.0.0.31 ~/bagfix-work/raw_gaterule2c.txt)

```
POSITIVE CONTROL raw gained an.pkl 535603 vs value walk 535907 (+0.06%); items carried into deaths 153041 vs 153477 (+0.28%); deaths 303 vs 304 with an inventory
POSITIVE CONTROL bot-h an.pkl 8881 vs accumulate() 8886 (+0.06%)
totals: value net change 48409 log-eq (net of transfers and deaths), carried into deaths 34095; iron net change 783.0 ingot-eq, into deaths 1271.0

A  24-h null, 4 pools, any build: n=150 draws (heavily overlapping windows)
   VALUE net DiD log-eq/bot-h: p2.5 -3.21  p50 +0.65  p97.5 +3.28
   IRON  net DiD ingot/bot-h:  p2.5 -0.127  p50 +0.013  p97.5 +0.153
   RAW   net DiD items/bot-h:  p2.5 -14.3  p50 +4.4  p97.5 +24.1  (section 7 printed -14.3/+4.4/+24.1)

B  r0 = 303 deaths / 8880 bot-h = 0.0341/bot-h; value carried into a death = 112.2 log-eq, iron 4.18 ingot-eq; p_link 4.7%
   a doubling of deaths costs 3.83 log-eq/bot-h and 0.143 ingot/bot-h

B2 P(REVERT) [extra canary deaths before the decision], 2000 reps; g in log-eq/bot-h (+4.6 = 1.2x what a doubling costs)
   k     g  |        today6_10 |        today6_20 |             sec7 |          adapt20 |         adapt10w | P(EXTEND) adapt20 | adapt20 reverts by
  1.0   +0.0 |    4.4% [ 0.0] |    4.3% [ 0.0] |    8.1% [ 0.0] |    1.6% [ 0.0] |    3.1% [ 0.0] |    3.5%          | b 0.8 b@trip 0.1 c 0.1 c-iron 0.1 linked@trip 0.5
  1.5   +0.0 |   13.9% [ 0.9] |   15.3% [ 1.9] |   32.1% [ 7.9] |   11.3% [ 2.6] |    9.5% [ 1.4] |   12.6%          | b 3.2 b@trip 0.3 c 2.4 c-iron 1.0 linked@trip 4.4
  2.0   +0.0 |   28.7% [ 1.7] |   34.8% [ 3.4] |   63.7% [14.2] |   28.7% [ 5.6] |   25.2% [ 3.4] |   24.6%          | a 0.1 b 10.2 b@trip 0.5 c 7.2 c-iron 1.4 linked@trip 9.3
  3.0   +0.0 |   58.3% [ 2.8] |   73.2% [ 4.9] |   98.9% [16.6] |   72.2% [ 9.4] |   58.1% [ 5.8] |   51.9%          | a 0.1 b 45.9 b@trip 1.6 c 5.7 c-iron 0.2 linked@trip 18.9
  1.0   +4.6 |    5.9% [ 0.0] |    4.2% [ 0.0] |    5.1% [ 0.0] |    2.4% [ 0.0] |    2.5% [ 0.0] |    4.5%          | b 0.8 c-iron 0.6 linked@trip 0.9
  2.0   +4.6 |   28.3% [ 1.7] |   33.0% [ 3.4] |   58.4% [14.3] |   28.5% [ 5.6] |   24.5% [ 3.2] |   24.6%          | a 0.1 b 11.2 b@trip 0.7 c 0.2 c-iron 7.4 linked@trip 9.1
  3.0   +4.6 |   58.1% [ 2.8] |   72.5% [ 4.8] |   97.7% [16.5] |   73.9% [ 9.3] |   57.7% [ 5.8] |   53.2%          | a 0.1 b 47.1 b@trip 2.8 c 1.5 c-iron 3.9 linked@trip 18.6
```

**Reproduce on the host:**
1. `python3 ugsafe2_value.py 2026-10-02T17:00:00Z 2026-10-07T17:45:00Z val3.pkl` (about 8 min);
2. `REPS=2000 python3 ugsafe2_gaterule2.py ~/ugsafe2/an.pkl val3.pkl`.

Keep `bagfixrule.py`, `ugsafe2_report.py`, `deathgate.py` and `lib/telemetry.py` beside them.

## Appendix B: install dry run (10.0.0.31, 2026-10-07)

Run 22:00Z 10-07 from `~/bagfix-v33/` (final staged files). Nothing live was changed:
- WOULD REFUSE: `launch-td02.sh` is waiting.
- Staged tests: test_changerowcheck 14/14, acceptance 83/83, test_bagfix 163/163, canarywatch selftest 19/19.
- Predicted bundle digest: **ac3da3b64d3fa5e31be5678c33d84ac0**. Parts:
  - verdict 07ad5e09
  - bagfixgate e8291c15
  - bagfixrule 1560c53e
  - changerowcheck e8211c76
  - deathgate 450d32bf, singledeath 08bd12cd, arms 9d56328c (all unchanged)
- The rules file was rewritten in scratch with exactly one record of that digest.
- Would install: canary-loop.sh 19a06267 (replacing d06e5639), verdict.py 07ad5e09 (replacing b3179121),
  changerowcheck.py e8211c76 (replacing d895ebed), canarywatch.py 7283002f (replacing 42b38567), and the two new
  modules. A re-stage after any edit changes these md5s, and the installer re-predicts them.

## Appendix C: reviews

**Round 1.**
- **Claude** (independent subagent): CHANGE. 14 findings, including:
  - a trip at a scheduled read skipping that read's guards;
  - a missing control arm leading to EXTEND;
  - a blind extension;
  - the +360 bag metric;
  - transfer events, churn and the stale-band selection bias;
  - registration validation;
  - an advisory next slot;
  - surviving mutants.
- **Codex:** CHANGE. 12 findings, including:
  - final skipping (a)/(b);
  - missing inventory read as zero harm;
  - a resume erasing a REVERT;
  - the hidden REVERT at the tripping read;
  - unmeasured exposure leading to EXTEND;
  - `_withdraw_pick` counted as output;
  - unbound primary evidence;
  - the manifest-read refusal;
  - install rollback;
  - the estimator mismatch;
  - changerowcheck's baseline bots;
  - the advisory next slot.
- **Every item was fixed as described in sections 1–8,** except the null's selection bias, which is disclosed in
  section 3 and not fixed.

**Round 2.**
- **Claude:** APPROVE-WITH-CHANGES. All 16 round-1 items were fixed. It raised two medium items:
  - base-phase REVERT and FROM re-run resume safety;
  - guard reads journalled as done when they never evaluated.
  It also raised low items: the poll timeout, final vs blind, next-slot consumption, run-id scoping, transfer
  intervals, the empty-kind alignment, and CLAUDE.md pending.
- **Codex:** CHANGE. It raised four P1 items:
  - a failed +1440 read could reach KEEP;
  - a restart could skip the tripping re-run;
  - stale telemetry was never blind;
  - resume could redeploy a decided canary.
  It raised four P2 items: ledger failures marked as recorded, the gate cross-check, the estimator boundary (a
  tautological test), and premature next-slot consumption.
- **All were fixed** (sections 1, 2, 6, 7, 8 and the loop): `bagfix-pending`; FROM carried in `bagfix-extend` and
  redone; reads done only when evaluated, with separate read and poll blindness counters; `final` only after an
  evaluated +1440 read; freshness with PAUSED; the redeploy guard; status-checked recording; all four gate counts;
  `to_obs` with intervals; the 6-h lead and 10-min tail plus a real two-pipeline test; consumption after a verified
  deploy; CLAUDE.md marked pending until install. Bands re-measured: value −3.21.

**Round 3.**
- **Codex:** CHANGE. Three P1 items and one P2:
  - a NOT_YET from an unreadable immobiledid counted as an evaluated guard read;
  - crash windows around `bagfix-check` and the read's REVERT;
  - `final` could run with another due read still failing;
  - a resumed tripping read retried stale evidence.
- **Claude:** CHANGE. One high item: **a death inside a deposit or withdraw interval was relabelled a transfer, so
  its bag vanished from (c).** Two medium items: PAUSED was silent and unbounded, and the off-schedule +1440 read was
  untested. Low items: a crash after `bagfix-check`, a heal during an interrupted teardown, and a promotion without a
  ledger record.
- **Fixed:**
  - verdict.py's artifact carries `guards`, and a read is done only when it got past them;
  - `bagfix-pending` is journalled BEFORE the tripping read or poll is marked, and any pending without an
    extension or decision is recovered;
  - `final` waits for every due read;
  - a resumed tripping read refreshes its evidence first;
  - deaths are never transfers, and a transfer interval ends at a death inside it (the band was re-measured:
    unchanged, so no calibration death sat inside a transfer);
  - PAUSED is paged and bounded;
  - an acceptance case covers verdict.py at +1440;
  - promotion only after `recorded`.
- **Disclosed rather than fixed:** the interrupted-teardown heal, and the registered reads at +1440 (section 8).

**Round 4.**
- **Claude:** APPROVE.
- **Codex:** CHANGE.
  - Base-phase reads journalled as done even when they never evaluated.
  - Malformed death rows vanished from (c).
  - An infinite bag metric licensed KEEP.
- **Fixed:**
  - a new `eval-read-M` phase, written only for evaluated reads; the extension re-reads every due minute without it,
    and `final` requires it;
  - malformed in-window death rows count as errors, and POST deaths are reconciled against the death scan;
  - a finite metric and a finite edge are required.

**Round 5.**
- **Claude:** APPROVE.
- **Codex:** CHANGE. The base marker accepted UNREADABLE when it followed the guards.
- **Fixed:** the base marker now uses the same allowlist as the extension. A new replay, `basefail2`, covers it, and
  malformed deaths are counted only inside [pre, end).

**Round 6.**
- **Codex:** APPROVE. It found no fail-open in either edit, passing 27 verdict/guard combinations and 6 window
  boundaries.
- **Final verdicts:** Claude APPROVE (round 5), Codex APPROVE (round 6).
