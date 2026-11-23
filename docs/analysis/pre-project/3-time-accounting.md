# 3. Time accounting: where does bot time go?

Pre-project analysis for the platform rebuild. Data: the fleet skill stream (`mcai-skill-agents`, 105 non-empty days
08-05..11-18, 9.12M real-skill rows plus ~110M `_` event rows, 95 bots) and the showcase stream (`mcai-skill-showcase`,
30 days 10-20..11-22, 0.48M real-skill rows, 16 bots), plus the model-call table `parquet/decisions` (15.0M fleet and
0.57M showcase calls). 2026-10-07 is skipped (duplicate docs). Computed on the analysis VM (10.0.0.45), read-only on the data.

Scripts (in `infra/analysis/pre-project/`): `ta_build.py` (raw -> compact parquet), `ta_extract.py` (intervals and
classes), `ta_controls.py` (positive controls), `ta_sweep.py` (per-bot priority sweep), `ta_report.py` (tables).
Intermediate data is in `~/mcai/parquet/ta3/` and `~/mcai/parquet/ta3x/` on the VM.

## Headline

| share of observed bot-time | fleet (168,692 bot-h) | showcase (7,827 bot-h) |
|---|---|---|
| **productive** (work skill that changed inventory or placed blocks) | **6.4%** | **8.1%** |
| travel (goto/explore/home/surface... that succeeded) | 7.2% | 10.8% |
| waiting for the model (no skill running) | 4.6% | 4.1% |
| failed: navigation (no_path, unreachable, stranded, path_budget/timeout...) | 3.2% | 2.6% |
| failed: interrupted (a reflex cut the skill short) | 3.1% | 6.9% |
| failed: other (ingredients, inventory full, nothing found...) | 0.8% | 0.6% |
| stuck / escape / rescue skills | 4.1% | 5.2% |
| no-op (ran, changed nothing) | 1.7% | 4.6% |
| runner paused after a failure streak | 1.8% | 3.4% |
| **decision gap** (no skill, no model call, within 45 s before the next call) | **63.6%** | **45.3%** |
| idle (anything else observed) | 3.4% | 8.4% |
| *offline (row gaps 10 min..6 h), as % of observed+offline* | *0.3%* | *2.0%* |

1. **Most wall-clock time is not spent in any skill.** Real skills cover 26.5% of fleet time and 38.8% of showcase
   time. Most of the rest is the gap between one skill ending and the next model call starting. That is the decision
   cooldown and tick wait: the fleet makes 89 model calls per bot-hour, one every 40 s, and most skills last only a few
   seconds. The model's own latency is small by comparison (median 1.7 s fleet, 2.0 s showcase; 4.6% and 4.1% of
   time). **The cadence costs more than the model does.** A platform that chains skills without a cooldown gets the
   biggest gain for free.
2. **Navigation is the main way skill time is lost.** I count as navigation-attributable: failed_nav, stuck/escape, and
   interrupts by entombed, stuck, stagnation or timeout reflexes. That comes to **10.0% of fleet time and 15.0% of
   showcase time**, more than all productive time in both worlds (6.4% and 8.1%). It is **89% (fleet) and 98%
   (showcase) of all lost skill time** (failed plus stuck). Travel plus navigation losses make up 65% of fleet
   skill-executing time.
3. **The baseline to beat**, per observed bot-hour (fleet / showcase): **43 / 41 items gathered**, 34 / 33 of them in
   skills that count as productive; **0.9 / 10.2 blocks placed**; 2.6 / 1.6 items crafted; 20 / 29 items deposited. The
   November fleet is the strongest month: 81 gathered and 4.1 placed per bot-hour.

**Verdict: confirmed.** The data supports making navigation the first skill contract. By time it is the largest loss
class in both worlds. By count, navigation fail classes are 56% of fleet failure rows and 46% of showcase failure rows.
Navigation failures also show up a second way: as reflex interrupts and escape skills. A navigation contract has to own
those too (entombed, stuck, stagnation, marooned), not only `no_path`. One more lever matters as much as navigation:
the decision gap, 64% of fleet time and 45% of showcase time.

## Method: how each second is attributed

Each bot has a span from its first row to its last row, across both streams. Every second of that span gets exactly
one class. Where intervals overlap, the first class in this priority order wins:

`productive > stuck_escape > failed_nav > failed_interrupted > failed_other > travel > noop > llm_wait > paused > dead >
between(decision gap) > absent > offline > idle`

These are the interval sources and the assumptions behind each:

- **Real skill rows** (name without `_`) cover `[t, t + duration_ms]`. `logSkill` stamps `@timestamp` at the *start*
  (`bots/src/logger.mjs:59`). Durations are clipped at 3,600 s. The class of each row comes from its trigger, name,
  status, fail_class and inventory delta (`ta_extract.py`):
  - **stuck_escape**: trigger `livelock_escape*`, `watchdog_*`, or `llm:<trouble>` (entombed, stagnation,
    liveness_restart, stuck, drowning, timeout and so on). This means any trigger except `llm:idle`/`llm:startup`.
    **Not `interrupt:X`**: `runner.mjs:586` stamps that on the *original* skill when reflex X cut it short. My first
    pass got this wrong: it put 3,300 h of successful gathers into stuck_escape. Those skills are now classed by their
    own outcome.
  - **travel**: a travel skill with status success. A travel skill that failed or ended unknown is **failed_nav**.
  - **failed_interrupted**: status failed or aborted with fail_class `interrupted`.
  - **failed_nav**: a failure whose fail_class is one of no_path, unreachable, stranded, travel_incomplete,
    path_budget, path_timeout, wrong_elevation, goal_changed, no_stand, no_safe_target, marooned, entombed, stuck,
    path_interrupted, or `*_unreachable`.
  - **productive**: status success or unknown **and** the inventory delta is non-zero, or a build/place-family skill
    with status success. *Intent rows are not outcomes*: a "success" that changed nothing is **noop**. Status
    no_effect is also noop.
- **Model calls** (decisions table) cover `[ts, ts + latency]` and are stamped at the start of the call. They only count
  where no skill is running, so pipelined decisions do not inflate the wait.
- **paused**: `_decision_skipped rule=pausewait ... wake in Ns`, covering `[t, t + N]`.
- **dead**: from a `_death` row to the next skill start, capped at 600 s. The total is about 0%.
- **between (decision gap)**: otherwise uncovered time in the 45 s before a model call starts. This is the same
  definition as `scripts/lib/busytime.py` (the cooldown is 30 s). **This 45 s cap is the biggest assumption in the
  report.** A shorter cap would move time from this class to idle without changing the skill shares.
- **offline / absent**: gaps over 10 min between consecutive rows of either stream. A gap under 6 h is offline: a
  restart or disconnect. A gap of 6 h or more is absent (not deployed) and is excluded from every denominator. Absent
  totals 801 h (fleet) and 946 h (showcase); offline totals 576 h and 162 h.
- **`_` sub-steps with a duration** (`_build_visit`, `_craft_sync`, `_toolkit`, `_kit_*`) are *not* used. They sit
  inside a real skill, so adding them would double-count. Control 3 below shows they overlap a real skill 100% of the
  time.
- Every bot's class seconds are asserted to sum to its span (`ta_sweep.py`).

Denominator: **observed bot-hours**, meaning the span minus absent and offline time. That is 168,692 fleet bot-hours
across 95 bots and 7,159 bot-days, and 7,827 showcase bot-hours across 16 bots and 386 bot-days.

### Positive controls (`ta_controls.py`)

| control | 09-15 | 10-25 | 11-15 | reading |
|---|---|---|---|---|
| 1. real skill rows stamped at START: next skill starts before this one ends (>1 s) | 19 of 97,095 | 17 of 90,145 | 757 of 181,903 | under 0.5%. If rows were END-stamped, 4,589 / 9,016 / 39,000 rows would violate. **Start-stamp confirmed.** |
| 2. model calls stamped at START: median(next llm-triggered skill start - (ts + latency)) | 31 s | 43 s | 0.5 s | 40 to 58% start within 2 s. The non-zero medians are calls that ran no skill: 76% of fleet calls end aborted, failed, unknown or no_effect, for example vetoed or on cooldown. Consistent with start-stamping. |
| 3. `_` sub-steps with a duration overlap a real skill | - | 93% fully inside | 100% overlapping (12% fully inside, from timing jitter) | safe to drop them |

I checked the same three on 11-10 and 08-22 with the same result. The sweep's pct_removed column (table I) shows how
much overlap the priority rule resolved. Skill classes lose 0.0 to 3% and model wait loses 2.4 to 3.5%. So overlapping
events were rare, and none of them were counted twice.

## By month

| world | month | obs bot-h | productive | travel | llm_wait | failed_nav | failed_intr | failed_other | stuck_escape | noop | paused | decision gap | idle | offline* |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fleet | 2026-08 | 20,080 | 3.4 | 4.8 | 5.4 | 3.4 | 3.9 | 0.9 | 2.9 | 0.6 | 0.0 | 73.4 | 1.1 | 1.5 |
| fleet | 2026-09 | 57,553 | 3.9 | 6.8 | 3.9 | 3.2 | 2.1 | 1.0 | 3.2 | 0.7 | 0.0 | 71.8 | 3.2 | 0.1 |
| fleet | 2026-10 | 57,381 | 7.7 | 6.2 | 4.4 | 3.2 | 3.1 | 0.5 | 4.8 | 0.7 | 0.0 | 65.7 | 3.7 | 0.4 |
| fleet | 2026-11 | 33,678 | 10.5 | 11.2 | 5.7 | 3.1 | 4.3 | 0.8 | 5.1 | 5.6 | 9.1 | 40.3 | 4.3 | 0.0 |
| show | 2026-10 | 1,201 | 3.4 | 15.0 | 4.4 | 1.7 | 7.1 | 0.3 | 3.1 | 2.5 | 0.0 | 53.0 | 9.6 | 2.8 |
| show | 2026-11 | 6,627 | 9.0 | 10.0 | 4.1 | 2.7 | 6.9 | 0.7 | 5.6 | 5.0 | 4.0 | 43.9 | 8.1 | 1.9 |

*All values are % of observed time. offline is % of observed+offline.*

Productive share roughly tripled from August to November, from 3.4% to 10.5%. Navigation losses stayed flat at 10 to
11%, and stuck/escape grew (2.9% to 5.1%). In November the fleet's `paused` share is 9.1% and its noop share is 5.6%.
Both come from the runner pausing after failure streaks. Before November `pausewait` was not logged, so those months
read 0.0, not "no pauses".

## By pool group (arm)

`bot.role` is `gatherer` for every bot in this data (checked on 11-10: 95 of 95 bots), so role cannot split anything.
The split below is by `exp.arm` instead.

| world | group | obs bot-h | productive | travel | llm_wait | failed_nav | failed_intr | stuck_escape | decision gap | gathered/h | placed/h |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fleet | board | 41,417 | 6.7 | 7.5 | 4.6 | 3.2 | 3.1 | 4.3 | 62.7 | 45.5 | 0.8 |
| fleet | hive | 41,432 | 6.1 | 6.2 | 4.6 | 3.2 | 3.3 | 4.1 | 65.4 | 43.4 | 0.9 |
| fleet | isolated | 41,972 | 6.8 | 6.8 | 4.5 | 3.2 | 3.2 | 4.3 | 63.2 | 23.2 | 0.0 |
| fleet | placebo | 41,423 | 6.4 | 8.6 | 4.6 | 3.3 | 2.9 | 4.0 | 62.6 | 43.0 | 1.0 |
| fleet | private (Aug) | 1,687 | 1.9 | 2.7 | 8.9 | 4.8 | 1.7 | 2.0 | 70.4 | 1.6 | 0.0 |
| fleet | shared (Aug) | 761 | 1.0 | 2.0 | 7.2 | 2.4 | 1.4 | 1.1 | 83.0 | 17.3 | 0.0 |
| show | showcase | 7,827 | 8.1 | 10.8 | 4.1 | 2.6 | 6.9 | 5.2 | 45.3 | 41.4 | 10.2 |

The four main arms spend their time almost the same way. Navigation loss is 3.2 to 3.3% failed_nav plus about 4%
stuck in every arm, so it is not specific to any arm. `isolated` gathers half as much per hour while spending a
similar share of time productive. Its gathers yield fewer items each; I did not investigate why. One row with a null
arm had 0 observed hours and is dropped.

## Productivity baseline (per observed bot-hour)

| world | month | gathered | gathered in productive skills | blocks placed | crafted | smelted | deposited |
|---|---|---|---|---|---|---|---|
| fleet | all | **43.4** | 34.5 | **0.9** | 2.6 | 0.4 | 19.8 |
| fleet | 2026-08 | 25.1 | 18.8 | 0.0 | 5.6 | - | 6.5 |
| fleet | 2026-09 | 27.1 | 20.8 | 0.0 | 2.8 | 0.1 | 8.2 |
| fleet | 2026-10 | 43.9 | 35.4 | 0.2 | 1.3 | 0.3 | 12.6 |
| fleet | 2026-11 | 81.3 | 65.9 | 4.1 | 2.5 | 1.6 | 59.9 |
| show | all | **41.4** | 33.3 | **10.2** | 1.6 | 0.4 | 28.5 |
| show | 2026-11 | 43.6 | 35.0 | 11.3 | 1.7 | 0.4 | 30.4 |

How each column is measured:

- **gathered**: the sum of positive `skill.inventory_delta` on gather, mine and deep_mine rows, *whatever their
  status*. Partial credit in failed or escaping skills is real items. About 20% of gathered items come from rows that
  are not classed productive, for example digging out while entombed.
- **blocks placed**: the sum of negative inventory delta on `build*` and `place` rows. This is a proxy: it counts
  items consumed, so it can include scaffold that was later taken back.
- **crafted** and **smelted**: positive delta on craft/make_material/toolkit and on smelt/smelt_town/furnace_drain.
- **deposited**: negative delta on deposit/town_deposit/dispose_well.

A new platform should beat the **November** numbers: fleet 81 gathered and 4.1 placed per bot-hour, showcase 44 and 11.
The all-time averages are lower because of the weaker early months.

## Navigation: share of failures and lost time

Failure rows by class (real skills; raw hours before the sweep):

| world | class | rows | % rows | raw h | % failure hours |
|---|---|---|---|---|---|
| fleet | failed_nav | 2,159,497 | 56.2 | 5,511 | 45.4 |
| fleet | failed_interrupted | 781,184 | 20.3 | 5,299 | 43.6 |
| fleet | failed_other | 904,408 | 23.5 | 1,339 | 11.0 |
| show | failed_nav | 55,310 | 45.6 | 200 | 24.5 |
| show | failed_interrupted | 50,192 | 41.4 | 563 | 69.0 |
| show | failed_other | 15,709 | 13.0 | 53 | 6.5 |

- **Interrupts are mostly navigation.** These are the reflexes that cut a failed_interrupted skill short, in fleet
  hours: entombed 2,005, stuck 1,157, stagnation 932, drowning 614, timeout 466, everything else under 100. On the
  showcase: stuck 318, entombed 126, timeout 66, stagnation 52. That puts stuck, entombed, stagnation and timeout at
  86% of fleet interrupted hours and 99% of showcase interrupted hours.
- **Top navigation fail classes** (fleet, raw hours): no_path 4,278; path_budget 633; path_interrupted 523; unreachable
  505; stranded 465; travel_incomplete 315; wrong_elevation 213; path_timeout 166. **gather** accounts for 3,542 h of
  fleet failed_nav, because it reports `no_path` to its target. goto accounts for 827 h, surface 486 and explore 387.
- **Navigation failures fail fast but often.** Median failed_nav duration is 0.8 s (fleet) and 1.4 s (showcase); 55%
  and 44% last under 1 s; p90 is 31 s and 41 s. So by count navigation is the largest failure class, but each failure
  is cheap in time. The time cost is in the slow tail and in the escapes that follow.
- **Stuck/escape skills**, fleet raw hours by trigger: llm:entombed 1,809; livelock_escape 1,701; watchdog_relocate
  903; llm:stagnation 757; llm:liveness_restart 709; llm:stuck 335. These rows still gained 1.2M items, mostly by
  digging out, so escape time is not all waste.
- **Point events per observed bot-hour**, fleet / showcase: `_path_noPath` 44 / 21; `_path_timeout` 17 / 15;
  `_path_no_legal_move` 13 / 7; `_entombed` 5.2 / 4.9; `_livelock_escape` 3.5 / 1.2; `_watchdog_rescue` 2.6 / 7.7;
  `_marooned` 2.5 / 1.4; `_stagnation` 2.5 / 2.1. Positive control: in the same table `_path_reset` reads 129 / 170
  and `_affordance_scan` 92 / 94. These events have no duration, so they count occurrences only and are not part of the
  time shares.
- **Total navigation-attributable time**: failed_nav, plus stuck_escape, plus interrupts by entombed, stuck,
  stagnation or timeout (4,560 h fleet, 562 h showcase). That comes to **10.0% of fleet time and 15.0% of showcase
  time**: 89% of fleet lost skill time and 98% of showcase lost skill time. Drowning interrupts (614 fleet h, 0.4%) are
  left out; adding them as "water travel" would raise the share.

## Double-counting risks and how they were handled

1. **Overlapping skills of one bot**, from a reflex preempting a running skill or a logger timing overlap. The priority
   sweep assigns each second once. The raw-versus-swept difference is 0.3 to 3% per class (table I in the
   `ta_report.py` output).
2. **Sub-step events nested in skills** (`_build_visit` alone is 224 h on 11-15): excluded, because they are covered by
   their parent skill (control 3).
3. **Model calls overlapping skills** (pipelined decisions): the model wait ranks below every skill class, so it only
   counts while no skill runs. 2.4% (fleet) and 3.5% (showcase) of raw latency was removed this way.
4. **Decision rows against skill rows**: the decisions table carries a skill and a status, so the same action appears
   in both streams. Decision rows are used only for their timing (ts and latency), never as outcomes.
5. **Midnight log rotation and day splits**: all rows are loaded and sorted per bot over the whole period, and spans
   are split at UTC midnight only when the tables are built.
6. **10-07 duplicate docs**: skipped in every input. Time on 10-07 is dropped. Gap segments that spill into 10-06 and
   10-08 are classed as absent, so they are excluded.

## Limitations

- The **decision gap** depends on the 45 s cap. It is not observed waiting; it is time with no skill and no model call
  running. It may hide reflex work that does not log a duration.
- The **walk inside gather, mine and build** is counted as productive, or as failed_nav when the skill fails with
  no_path. The skill stream has no pathing spans to split it out. True travel share is therefore higher than 7%.
- **`swim_to` is not in the travel list.** Its failures are still classed failed_nav by fail class, but its successes
  land in productive or noop.
- **Blocks placed** is an item-consumption proxy. **Deaths** are approximate (6,156 fleet and 29 showcase in total,
  about 0% of time).
- Failure classes cover runner-level skills only. Escape and pathing activity that happens inside reflexes, without a
  real-skill row, is visible only as point events.
