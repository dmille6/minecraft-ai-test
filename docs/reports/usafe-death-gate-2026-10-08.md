# The underground-safety death gate (gate v34): design, calibration, power, airpocket exposure (2026-10-08)

**Status: BUILT AND STAGED, NOT INSTALLED.** The files are on `main` and staged on the fleet host in `~/gate-v34/`. The
install is the operator's step, between canaries (section 7). towndeposit-02 was live (deployed 00:15Z 10-08) when
this was staged, so the dry run says WOULD REFUSE.

## For the coordinator: the short version

1. **The problem is real, and measured.** No-change draws were made on the five drowning pools (hive-c, hive-d,
   placebo-a, placebo-b, placebo-d), using the draw's own 12-h drowning filter. Today's cross-sectional gate (canary POST
   vs control POST, lower bound > 1.25) **falsely trips 12.9% of runs within 6 h and 29.0% within 26 h**, polled every
   5 min. With hive-d in the draw it is 16.4% / 36.9%.
2. **The v34 gate compares each arm with itself.**
   - psi = (canary POST/PRE death rate) / (control POST/PRE), with PRE = the 24 h before declared_at.
   - The canary ratio uses the owner's exact Poisson lower bound.
   - The two-death floor is kept. The randomization p is kept, report-only.
   - Mechanism-linked deaths still revert, by explicit `link_rules` (section 1).
3. **The nominal 1.25 is too loose for deaths that cluster.** At 1.25 the DiD falsely trips 11.3% (6 h) and 16.7%
   (26 h). **The threshold is calibrated to 2.0** on the five-pool null, using the live gate's own estimator:

   | P(trip at any 5-min poll), DID24 at 2.0 | 6 h | 26 h |
   |---|---:|---:|
   | **false trip** (no change), all five-pool draws | **3.3%** [0.2, 5.5] | **4.4%** [0.6, 5.9] |
   | false trip, drawrec-like draws (any drowning pool, up to 4) | 2.9% [1.4, 3.4] | 3.0% [1.9, 3.6] |
   | false trip, draws whose PRE ran ≥ 2x control | 0.6% | 1.1% |
   | false trip, draws containing hive-d | 3.7% | 4.2% |
   | **power, a fix that doubles deaths** (k = 2) | **17.5%** | **25.4%** |
   | power, a fix that triples deaths (k = 3) | 42.9% | 59.0% |
   | **power, k = 2 / k = 3, elevated-PRE draws (airpocket's situation)** | **5.8% / 22.1%** | **3.3% / 34.1%** |

   The brackets are a day-block bootstrap 95% interval (section 3). It is rough: the data holds about 17
   non-overlapping 6-h windows and about 4 non-overlapping 26-h ones.

   **At this size the death gate is a tripwire, not proof of safety.** A doubling is caught about a quarter of the time
   within 26 h. The protection against the fix killing bots through its own action is the linkage (section 1) and the
   read's reserve gate C3, not the rate.

   **OWNER DECISION BEFORE AIRPOCKET LAUNCHES (round 2, Claude).** In the stratum airpocket is drawn for (pools already
   drowning at ≥ 2x the control, 26 h), DID24 at 2.0 catches a doubling of deaths 3.3% of the time and a tripling 34%:
   the rate gate is effectively blind there. The alternative, HYB at 2.5 (this DiD OR a matched-pool control), falsely
   trips at most 2.5% in every stratum and catches 35% / 76% there. Built: DID24 at 2.0, the more robust (MPC's control
   on a 4-of-5 draw is a single 5-bot pool). The owner should choose knowingly; section 3 has the table.
4. **Airpocket's exposure is NOT powered at 6 h. It is powered with the registered extension.**
   - The canary sees an expected **7.1 sealed drowning episodes per 6 h** on 2–4 drawn pools.
   - At a 25% admission share, P(≥ 2 attempts) is **50% at 6 h**, 79% at 12 h and **95% at 26 h**.
   - The registration's `extension` (until exposure, reads to +1560, deadline 1680) already covers that.
   - With 4 pools drawn: 75% at 6 h, 95% at 12 h.
   - This is a conditional estimate (section 5).
5. **Airpocket's registrations now declare `"class": "underground-safety"` and pass the check** (`USAFE OK` on both).
   - The former `linkage_extra` entry was a dict. It **crashes** both `verdict.py` and the live `changerowcheck.py`
     (`TypeError: unhashable type: 'dict'`, reproduced on the host), so the launch would have been refused by a
     traceback.
   - The linkage now lives in `underground_safety.link_rules`, and `linkage_extra` is `[]`.

## 1. The gate

**Where the code is.** The decisions are in `scripts/usaferule.py` (pure, in the bundle). The measuring is in
`scripts/usafegate.py` (in the bundle via `find_spec`). `verdict.py` uses them for `"class": "underground-safety"`, in
the 5-min poll and at every read. The cross-sectional gate is then reported as not applied.

**Counts and exposure:**
- deaths are rows whose own kind (`skill.name`) is `_death`, deduplicated per bot and timestamp;
- exposure is the sum of gaps between a bot's consecutive rows, each capped at 120 s, so a silent bot accrues none.

**The four windows:**
- canary POST, since declared_at;
- canary PRE, the `pre_hours` (24) before it;
- control POST;
- control PRE.

PRE is computed once and cached beside the verdict artifacts, but only when it was read without errors. Rows of other
builds in the canary PRE (a previous canary, restart lag) are counted and reported.

**The test:**
- R_c = canary POST/PRE rate ratio, with its one-sided 95% lower bound from `deathgate.ratio_lower_bound` (the v21
  machinery).
- R_k = control POST/PRE, as a point estimate with a 0.5 continuity correction (about 60 bots).
- **TRIP iff canary POST deaths ≥ 2 AND LB(R_c) / R_k > 2.0.**
- The fleet-wide drift over time cancels in R_k. The drawn pools' standing level cancels in R_c.

**Fail closed (UNREADABLE, never a clean HOLD) when:**
- a log file is unreadable, including a gz whose body is corrupt (`zlib.error`), or a complete death or own row does
  not parse. An unterminated last line (the bot mid-write) is skipped and read whole at the next poll;
- any arm-window has no measured exposure;
- a canary bot that logged ≥ 25% of the PRE logs < 25% of the POST (after the first hour). Stopped units, i.e.
  directories with no PRE rows, are named and excluded;
- a roster bot is no longer on disk. The first roster is written once beside the PRE cache and never shrinks, so a
  vanished directory cannot turn into a smaller canary that holds (round 2, Codex). The roster file is written
  atomically, and one that cannot be read or written is itself UNREADABLE (round 3, Codex);
- a declared canary pool has no bot running.

**What happens on UNREADABLE:**
- A poll that answers UNREADABLE is journalled and paged, on the first and on every 6th. An empty poll does not reset
  that count.
- At a **read**, an UNREADABLE death gate no longer stops the evaluation. The change's own lines (C0–C5), v15c and v11
  are still evaluated and can REVERT. UNREADABLE is returned only if nothing else reverts.
- Linkage still REVERTs when an unrelated file is unreadable.

**Mechanism linkage**, by `link_rules` in the registration (`usaferule.link_reason`, pure):

| rule | airpocket | linked |
|---|---|---|
| `{"kind": "_air_pocket_start", "until_kind": "_air_pocket", "window_s": 300}` | a death DURING an attempt: a start row with no end row of the same `id=` before the death | yes (C3's "any death between start and end") |
| `{"kind": "_air_pocket", "window_s": 120, "except_detail_re": …, "except_cause": "drown"}` | a death within 120 s after an attempt's end row | yes, EXCEPT a drowning after an `aborted`/`failed`/`opened` attempt that ended at ≥ 3 HP |
| `{"kind": "_air_pocket_preempt", "until_kind": "_air_pocket_start", "window_s": 120}` | a death after the step pre-empted an escape, with no step after it | yes |

How the rules read the rows:
- **The exception follows the read's C3.** An attempt that did not succeed but kept the reserve is clean in C3. The
  drowning after it is the base rate the fix could not prevent.
- Round 1 (Claude) found that the earlier "any death within 120 s of an `_air_pocket` row" would revert a working fix
  on exactly those drownings.
- **These are still linked:** a drowning after a success, after an attempt that spent the reserve (< 3 HP, or health
  unknown), and every non-drowning death after an attempt.
- The cause is the death detail before the first `;` (`drowned; idle at …`). That is the real `_death` row format, checked
  on the host.
- The end-row regex was checked against `airPocketRow` in `bots/src/airpocket.mjs` on `ap-on-c6e91a8`.
- Any linked death reverts once the canary is at the two-death floor -- except under a `rate` licence, where v31 makes
  every instrument of the change report-only: linked deaths are then REPORTED and the statistical gate still decides
  (round 4, Codex). **The floor binds the statistical gate and the
  linkage only** (v23). A registered `evidence: defect` own line is not a death rule: airpocket's C3 reverts at a read on
  the defect itself, and one death during an attempt is one, as every defect own line always has. Both are tested
  (one linked death holds; one death with C3 breached reverts by the own line).
- At a read, the defect own lines of an underground-safety canary are decided FIRST, before any section that can answer
  UNREADABLE or NOT_YET (a missing read, immobiledid not readable, an UNREADABLE v15c, a blind death gate). Bound,
  defined and failing, they revert there (round 2, Codex) -- except under a `rate` licence, which v31 makes
  report-only on every instrument, exactly as section 8 does (round 3).

**The randomization p** (v26) stays report-only. It is computed on the per-pool DiD excess (POST deaths minus PRE rate
× POST bot-h × R_k) and permuted over every pool.

## 2. Replays on recorded windows (`usafegate.py window`, real logs on 10.0.0.31, the staged v34 code)

| window | cross-sectional (today) | v34 DiD |
|---|---|---|
| airpocket dry run, hive-c + hive-d, 10-07 16:28–22:28Z (no change) | 4 deaths in 59.9 bh (0.067) vs control 0.026/bh: it would trip | **HOLD**: canary POST/PRE 0.74x, control 1.23x, psi 0.60, LB 0.18; randomization p 0.99 |
| junkwell-01, placebo-a + board-b, 10-05 10:05–15:13Z (reverted by the rung rule) | — | HOLD: POST/PRE 4.01x, control 0.89x, psi 4.51, LB 1.52 < 2.0; p 0.050 |
| chestfull-01, 3 pools, 10-05 02:47–03:17Z (reverted by the death gate) | LB 2.58, REVERT | **REVERT**: psi 39.3, LB 8.97; p 0.002 |

The junkwell-01 row shows the price of the calibrated threshold: a 4.5x point estimate over 5 h on 10 bots is held. No
real `_air_pocket` rows exist on the fleet yet (the step ran only in the Paper sandbox), so linkage is tested on
fixtures in the real row format (section 6).

## 3. Calibration and power (`scripts/host/usafe_null.py`; raw output in appendix A)

**Data:** `scripts/host/usafe_bins.py` runs **the live gate's own rows** (`usafegate.rows`) over 80 bots with data,
10-02 17:00Z → 10-08 00:15Z (9,412 bot-h, 0 unreadable files). It stores each consecutive-row pair credited to its END
bin, plus every pair that crosses a bin edge, so that a bin-aligned window counts exactly the pairs whose two rows are
both inside it, as the live scan does. Round 1 (Codex) found the first calibration used a different estimator; round 2
(Codex) found the second credited each window's last gap, which the live scan never sees.

**Positive controls** (asserted; the script exits 1 on failure):
- exposure and deaths from the bins equal `usafegate.scan` on the real logs for 60 random bot-windows of 1 bin to 24 h:
  **0 mismatches**;
- the fast trip test and `usaferule.did_gate` agree on 10,000 of 10,000 comparisons, at every threshold.

**The draws:**
- **FIVE:** every subset of 2–4 pools among the five that pass the draw's filter at the draw instant (a drowning in the
  prior 12 h).
- **DRAWREC:** closer to `drawrec.sh`. Any pool but placebo-c/isolated that qualifies, as many as are available up to
  4, with 10 random subsets per window.
- Windows start every hour, and polls run every 5 min.
- Power is measured by injecting extra canary deaths as Poisson, with mean Σ over the drawn pools of (k−1) × that
  pool's own 5-day rate × its exposure in the bin (round 2, Codex: per pool, so unequal exposure cannot change what a
  doubling means; asserted on a two-pool case).

**Gates, polled at the same thresholds:**
- **XS:** today's cross-sectional gate.
- **MPC:** a matched-pool control, i.e. canary vs the undrawn drowning pools of the five.
- **DID24:** v34.
- **HYB:** DID24 OR MPC. Round 1 (Claude) asked whether MPC buys the power DID24 lacks.

| P(trip), threshold 2.0 unless named | XS @1.25 (today) | MPC | **DID24** | HYB | HYB @2.5 |
|---|---|---|---|---|---|
| no change, FIVE, 6 h / 26 h | 12.9% / 29.0% | 0.6% / 3.0% | **3.3% / 4.4%** | 3.7% / 6.6% | 1.9% / 2.5% |
| no change, with hive-d | 16.4% / 36.9% | 0.9% / 4.9% | 3.7% / 4.2% | 4.4% / **7.8%** | 1.7% / 2.5% |
| no change, elevated PRE | 13.6% / 34.1% | 1.9% / 3.3% | 0.6% / 1.1% | 2.6% / 4.4% | 0.6% / 1.1% |
| no change, DRAWREC | 6.8% / 9.7% | 0.0% / 0.3% | 2.9% / 3.0% | 2.9% / 3.3% | 1.8% / 2.1% |
| k = 2, FIVE | — | 4.7% / 29.9% | 17.5% / 25.4% | 20.0% / 46.0% | 12.3% / 29.2% |
| k = 2, elevated PRE | — | 9.1% / 49.5% | 5.8% / 3.3% | 13.0% / 51.6% | 8.4% / 35.2% |
| k = 3, FIVE | — | 18.1% / 49.6% | 42.9% / 59.0% | 48.6% / 75.7% | 36.9% / 62.4% |
| k = 3, elevated PRE | — | 24.0% / 78.0% | 22.1% / 34.1% | 39.6% / 82.4% | 26.6% / 75.8% |

**Why DID24 at 2.0** (round 2, both reviewers: "the only candidate" was false -- MPC at 2.0, DID24 at 2.5 and HYB at
2.5 also stay at or under 5% everywhere):
- Among the candidates at or under 5% false trip everywhere that do NOT depend on a small matched-pool control (DID24
  at 2.0 and 2.5), DID24 at 2.0 has the most power: each arm against its own 24 h, nothing else.
- The power trade-off with the matched-pool candidates depends on the horizon (round 3, Codex): over all draws at 6 h
  DID24 at 2.0 has more (17.5% vs MPC 4.7% and HYB at 2.5 12.3%); at 26 h it has less (25% vs MPC 30% and HYB at 2.5 29%);
  in the elevated stratum it has far less at both. MPC's control on a 4-of-5 draw is one 5-bot pool, so its threshold
  rests on few independent events.
- HYB at 2.0 falsely trips 6.6%, and 7.8% with hive-d, at 26 h.
- **HYB at 2.5 is the real alternative**: at or under 2.5% false trip everywhere, about DID24's power over all draws
  (29% at 26 h), and far more in the elevated stratum (35% / 76% for k = 2 / 3, against DID24's 3% / 34%). Its
  elevated-stratum advantage rests on 91 overlapping 26-h draws, perhaps two independent episodes. **This is the
  owner's choice** (short version, item 3).

**DID24's weak spot is power in the elevated stratum.** Pools drawn on a drowning streak regress in POST, so the DiD
is conservative exactly there. That is the safe direction for false reverts and the unsafe one for missed harm.

**Coverage (the 25% bot-share rule) on no-change windows:**
- UNREADABLE at 3.1% of 6-h polls; 1.9% of 6-h windows end UNREADABLE (FIVE). At 26 h it is 0.2% of polls and 0.0% of
  windows at the final poll.
- **Every window with an UNREADABLE poll overlaps a fleet-wide outage:** 10-06 ~17–18Z (every bot silent) and 10-07
  05:03–11:54Z (all bots logged about 3–6 min an hour). Those windows all start 10-06 17Z → 10-07 11Z, and every bot
  of the draw is named in each.
- The rule never fired on a single silent bot in five days. Deploy restarts are not in this data, so this is the floor
  of the UNREADABLE rate, not its level.

**Disclosed limits:**
- **The threshold was chosen on the same null it is reported on.** No held-out data exists: 5 days, about 17
  independent 6-h windows. The bootstrap upper ends (5.5% / 5.9%) are the honest ceiling.
- **The deploy restarts only the canary pool**, so the first minutes of POST are warm-up the PRE does not have. It is
  NOT modelled, and its direction is unknown: the restart costs exposure, and whether deaths are more likely just after
  a restart was not measured (round 2, Claude).
- **The canary PRE may contain a previous canary's build** (24 h is longer than a short canary). Those rows are
  counted and reported (`pre_other_builds`), not excluded.
- The null is "any build". Real canaries ran on these pools on most days.
- The draw filter is approximated by "≥ 1 drowning death in the prior 12 h". The registration also asks for 3 oxygen-0
  ceilings, and a drowning is nearly always inside one. DRAWREC does not replicate the productivity band, the 12-h
  per-pool exclusion or the trapped-bot preference.
- The injected harm is Poisson. Harm clustered on the fix's own action is what linkage catches.

## 4. What v34 does not change

- Every other class keeps the cross-sectional gate exactly; the poll path is guarded by `not _USAFE`. v33's bag-fix
  rule is untouched (`SAME` check in the installer).
- v23's two-death floor binds every statistical death decision (this gate, the all-cause gate) and the mechanism
  linkage. A registered `evidence: defect` own line can revert independently on the defect it names (airpocket's C3:
  one death during an attempt is a breach); that is not a death rule and is unchanged by v34, apart from being decided
  first at a read.

## 5. Airpocket exposure (`scripts/host/usafe_exposure.py`)

**Inputs:**
- the sealed drowning episodes of ugsafe2's `an.pkl` on the same null draws. Every sealed episode there is also
  critical: 544 of 544. Round 1 (Codex) asked for sealed ∧ crit, and the count is unchanged;
- the admission share: p = 25% (43/170 drowning sites on today's save without ice), or 35% with ice.

| horizon | mean sealed episodes (2–4 pools) | P(≥ 2 attempts), p = 0.25 | p = 0.35 | 4 pools, p = 0.25 |
|---:|---:|---:|---:|---:|
| 3 h | 3.8 | 25% | 39% | 46% |
| 6 h | 7.1 | 50% | 66% | 75% |
| 12 h | 13.3 | 79% | 89% | 95% |
| 26 h | 26.4 | 95% | 98% | 99% |

**6 h alone is a coin flip.** The registered extension (until exposure, reads 540/720/1080/1560, deadline 1680) is what
makes it powered. The death poll runs for that whole time, so the gate was calibrated over 26 h.

**This is a CONDITIONAL estimate of attempts, not a measurement.** It assumes every sealed episode reaches the trigger,
and that non-fatal sealed episodes are admitted at the fatal sites' share; their geometry was not screened. The read's
`exposure_ready` is what decides.

## 6. Changes and tests

**Code:**
- **New:** `scripts/usaferule.py`, `scripts/usafegate.py`.
- **`scripts/verdict.py`:** the v34 block, with REVERT `by: death_gate_did` carrying counts and linkage. The bundle adds
  two parts. A death-gate UNREADABLE at a read is deferred behind the own lines.
- **`scripts/host/canary-loop.sh`:** the underground-safety registration preflight (`usafegate.py
  check-registration`, which refuses with a page); a poll answering UNREADABLE is journalled and paged.
- **`docs/reports/airpocket-01.{ee21207,dbb4d78}.json`:** `"class": "underground-safety"`, the `underground_safety`
  block (`pre_hours` 24, `link_rules`), and `linkage_extra: []`.

**`scripts/test_usafe.py` — 123/123 on the host, nothing skipped.** It covers:
- **the pure gate:** floor, calibrated threshold, 3x does not clear, control scaling, UNREADABLE cases;
- **11 `link_reason` cases on the REAL registration's rules:** during the step, id matching, the windows, the reserve
  exception for failed/aborted/opened, the exception refused for spent reserve or unknown health, success, non-drowning
  deaths, cause-before-`;`, rows after the death, pre-empt;
- **registration checks:** the pre-v34 `link_kinds` format is refused;
- **usafegate over fixture logs in the real row formats:** reserve-held drownings HOLD, linked deaths REVERT, a decoy
  `"name":"_death"` outside `skill` is not a death, a corrupt gz body, an unterminated last line, spaced JSON, a 3-date
  POST, a silent bot, a stopped unit, a missing pool, a roster bot whose directory disappears (after and inside the
  first hour), an unreadable roster file (UNREADABLE, round 3);
- **the CLI** on the real registrations, and the replay `window` deciding as the live gate does (rate licence: linkage
  reported, a 5x rise still REVERTs; kind licence: linkage REVERTs);
- **verdict.py:**
  - the positive control (XS REVERTs a no-change canary on pools drowning at 4x);
  - v34 HOLD, 6.7x REVERT, linked REVERT; under a rate licence linked deaths are reported and a 6.7x rise still
    REVERTs;
  - a poll UNREADABLE;
  - a read UNREADABLE;
  - a read with a blind death gate AND a C3 breach, which REVERTs by the own line; a blind death gate with a v15c REVERT;
  - C3 breached with the movement guard UNREADABLE, and with an unrelated read missing: both REVERT; the same with C3
    clean is UNREADABLE; another class is unchanged;
  - one canary death: the gate and linkage hold, the C3 defect line reverts; a RATE licence keeps the early defect
    check report-only (v31);
- **42 mutants** (all killed on the host), anchors asserted present and unique, each run on fresh state, scored only
  after the UNMUTATED copies pass the same path (round 6, Codex). Verdict mutants are scored only when the unmutated verdict cases
  pass.

**Calibration:** `scripts/host/usafe_bins.py`, `scripts/host/usafe_null.py`, `scripts/host/usafe_exposure.py`.

**Install:** `scripts/host/install-gate-v34.sh` with `--dry-run`, built like v33's. Its checks are:
- the base md5 of each live target, with usaferule/usafegate required to be absent;
- the live registrations must be the originals or this version;
- a shadow check: every staged module that also exists in `~/mcai-analysis` must equal it, because `verdict.py` puts
  that directory first;
- `check-registration` on both registrations;
- verified backups, rollback, the predicted digest.

The registrations go to `~/mcai-analysis/airpocket-01.*.json`; the launch copies one into `registrations/`.

## 7. Install (between canaries only)

```
ssh mike@10.0.0.31 'bash ~/gate-v34/install-gate-v34.sh --dry-run'
ssh mike@10.0.0.31 'bash ~/gate-v34/install-gate-v34.sh'      # only with no loop, no chain, no canary
```

## Appendix A. `usafe_null.py` raw output (host, `~/usafe-work/null_v4.txt`)

```
POSITIVE CONTROL 1: bins vs usafegate.scan on real logs, 60 bot-windows: 0 mismatches []
POSITIVE CONTROL: fast test vs usaferule.did_gate at thresholds [1.25, 1.5, 2.0, 2.5, 2.0]: 0 disagreements in 10000 comparisons
bins: 80 bots, 0 unreadable files; live-estimator bot-h 9412; five pools 0.0418 deaths/bh, the rest 0.0303 (1.38x)

UNCERTAINTY of the false-trip rate (k=1), day-block bootstrap; and COVERAGE (the 25% bot-share rule) on no-change windows
  FIVE     6h n= 856 (non-overlapping windows in the data: ~17)  DID24@2.0 3.3% [0.2, 5.5] (5 days)  MPC@2.0 0.6% [0.0, 1.6] (5 days)  HYB@2.0 3.7% [0.2, 6.7] (5 days)
            coverage: polls UNREADABLE (POST > 1 h) 3.1% of all; windows UNREADABLE at the final poll 1.9%; mean roster 12.9 bots
  FIVE    26h n= 756 (non-overlapping windows in the data: ~4)  DID24@2.0 4.4% [0.6, 5.9] (4 days)  MPC@2.0 3.0% [0.0, 4.6] (4 days)  HYB@2.0 6.6% [0.6, 9.2] (4 days)
            coverage: polls UNREADABLE (POST > 1 h) 0.2% of all; windows UNREADABLE at the final poll 0.0%; mean roster 13.0 bots
  DRAWREC  6h n= 665 (non-overlapping windows in the data: ~17)  DID24@2.0 2.9% [1.4, 3.4] (5 days)  MPC@2.0 0.0% [0.0, 0.0] (5 days)  HYB@2.0 2.9% [1.4, 3.4] (5 days)
            coverage: polls UNREADABLE (POST > 1 h) 1.8% of all; windows UNREADABLE at the final poll 0.6%; mean roster 19.8 bots
  DRAWREC 26h n= 629 (non-overlapping windows in the data: ~4)  DID24@2.0 3.0% [1.9, 3.6] (4 days)  MPC@2.0 0.3% [0.0, 0.7] (4 days)  HYB@2.0 3.3% [1.9, 4.3] (4 days)
            coverage: polls UNREADABLE (POST > 1 h) 0.2% of all; windows UNREADABLE at the final poll 0.0%; mean roster 20.0 bots

FIVE draws, stratum all (P(trip at any 5-min poll))
  hz  k    n   XS   @1.25  XS   @1.5   XS   @2.0   XS   @2.5   MPC  @1.25  MPC  @1.5   MPC  @2.0   MPC  @2.5   DID24@1.25  DID24@1.5   DID24@2.0   DID24@2.5   HYB  @1.25  HYB  @1.5   HYB  @2.0   HYB  @2.5 
   6   1   856       12.9%        8.4%        4.2%        1.3%        3.2%        1.5%        0.6%        0.4%       11.3%        9.1%        3.3%        1.6%       12.5%        9.8%        3.7%        1.9%
   6   2   856       51.9%       41.4%       24.2%       12.9%       17.3%       10.4%        4.7%        2.1%       38.8%       29.2%       17.5%       10.9%       43.7%       33.4%       20.0%       12.3%
   6   3   856       78.9%       73.4%       59.0%       41.9%       40.9%       30.7%       18.1%       10.6%       70.2%       61.9%       42.9%       31.9%       74.8%       67.4%       48.6%       36.9%
  26   1   756       29.0%       16.1%        6.3%        1.6%       16.0%        8.6%        3.0%        0.9%       16.7%       11.8%        4.4%        1.9%       28.0%       18.0%        6.6%        2.5%
  26   2   756       82.3%       74.9%       55.4%       31.3%       51.2%       42.9%       29.9%       16.8%       61.1%       44.6%       25.4%       15.2%       74.9%       64.7%       46.0%       29.2%
  26   3   756       96.4%       93.7%       83.2%       72.2%       74.7%       64.7%       49.6%       38.0%       93.0%       82.7%       59.0%       41.7%       94.7%       89.3%       75.7%       62.4%

FIVE draws, stratum elevated (P(trip at any 5-min poll))
  hz  k    n   XS   @1.25  XS   @1.5   XS   @2.0   XS   @2.5   MPC  @1.25  MPC  @1.5   MPC  @2.0   MPC  @2.5   DID24@1.25  DID24@1.5   DID24@2.0   DID24@2.5   HYB  @1.25  HYB  @1.5   HYB  @2.0   HYB  @2.5 
   6   1   154       13.6%        9.7%        5.8%        0.6%        3.2%        3.2%        1.9%        0.6%        2.6%        1.9%        0.6%        0.0%        5.2%        4.5%        2.6%        0.6%
   6   2   154       59.1%       50.0%       38.3%       24.7%       26.6%       18.2%        9.1%        5.8%       24.7%       14.3%        5.8%        3.9%       36.4%       25.3%       13.0%        8.4%
   6   3   154       81.8%       79.9%       70.1%       55.2%       57.1%       47.4%       24.0%       14.9%       50.6%       36.4%       22.1%       16.9%       69.5%       57.8%       39.6%       26.6%
  26   1    91       34.1%       18.7%        6.6%        0.0%       20.9%        8.8%        3.3%        1.1%        4.4%        3.3%        1.1%        0.0%       24.2%       11.0%        4.4%        1.1%
  26   2    91      100.0%       96.7%       82.4%       41.8%       84.6%       72.5%       49.5%       34.1%       26.4%       15.4%        3.3%        1.1%       86.8%       73.6%       51.6%       35.2%
  26   3    91      100.0%      100.0%      100.0%       98.9%       96.7%       95.6%       78.0%       72.5%       91.2%       71.4%       34.1%       16.5%       97.8%       96.7%       82.4%       75.8%

FIVE draws, stratum hive-d (P(trip at any 5-min poll))
  hz  k    n   XS   @1.25  XS   @1.5   XS   @2.0   XS   @2.5   MPC  @1.25  MPC  @1.5   MPC  @2.0   MPC  @2.5   DID24@1.25  DID24@1.5   DID24@2.0   DID24@2.5   HYB  @1.25  HYB  @1.5   HYB  @2.0   HYB  @2.5 
   6   1   544       16.4%       11.2%        5.3%        1.5%        3.9%        2.4%        0.9%        0.6%       11.0%        9.6%        3.7%        1.3%       12.9%       10.7%        4.4%        1.7%
   6   2   544       64.7%       51.3%       33.3%       18.0%       27.2%       18.8%        7.5%        4.6%       38.8%       30.5%       19.3%       11.8%       48.7%       38.6%       23.0%       14.5%
   6   3   544       93.2%       88.2%       70.6%       54.6%       55.5%       41.9%       23.9%       16.4%       75.0%       64.9%       44.9%       30.3%       83.1%       72.2%       52.4%       39.0%
  26   1   474       36.9%       20.9%        8.6%        1.9%       24.1%       13.7%        4.9%        1.5%       15.6%       11.6%        4.2%        1.5%       33.5%       21.5%        7.8%        2.5%
  26   2   474       99.6%       96.6%       73.0%       40.3%       72.4%       61.6%       44.1%       26.8%       66.5%       46.8%       24.1%       13.5%       88.0%       76.2%       55.1%       35.0%
  26   3   474      100.0%      100.0%       99.6%       94.9%       91.8%       85.2%       72.2%       57.4%       97.0%       88.8%       62.2%       39.9%       99.4%       98.3%       87.1%       71.9%

DRAWREC draws, stratum all (P(trip at any 5-min poll))
  hz  k    n   XS   @1.25  XS   @1.5   XS   @2.0   XS   @2.5   MPC  @1.25  MPC  @1.5   MPC  @2.0   MPC  @2.5   DID24@1.25  DID24@1.5   DID24@2.0   DID24@2.5   HYB  @1.25  HYB  @1.5   HYB  @2.0   HYB  @2.5 
   6   1   665        6.8%        4.4%        1.7%        0.2%        1.8%        0.5%        0.0%        0.0%        9.0%        7.4%        2.9%        1.8%       10.4%        7.8%        2.9%        1.8%
   6   2   665       36.7%       27.2%       13.1%        6.5%       12.0%        6.2%        3.0%        0.8%       38.3%       29.0%       16.5%       11.3%       41.7%       31.3%       18.3%       11.7%
   6   3   665       71.7%       62.4%       41.8%       27.4%       38.0%       27.7%       13.8%        5.9%       69.6%       60.2%       44.2%       30.7%       72.6%       63.5%       47.2%       32.5%
  26   1   629        9.7%        5.6%        1.3%        0.0%        5.7%        2.1%        0.3%        0.2%       10.2%        7.8%        3.0%        1.9%       14.3%        9.2%        3.3%        2.1%
  26   2   629       70.9%       56.8%       26.4%        8.7%       42.6%       31.3%       14.5%        7.5%       56.8%       41.0%       20.5%       11.8%       68.7%       53.9%       31.2%       18.1%
  26   3   629       91.4%       86.0%       67.9%       49.1%       67.9%       57.1%       40.7%       24.2%       90.8%       81.7%       55.3%       37.2%       92.8%       86.3%       66.9%       48.8%

DRAWREC draws, stratum elevated (P(trip at any 5-min poll))
  hz  k    n   XS   @1.25  XS   @1.5   XS   @2.0   XS   @2.5   MPC  @1.25  MPC  @1.5   MPC  @2.0   MPC  @2.5   DID24@1.25  DID24@1.5   DID24@2.0   DID24@2.5   HYB  @1.25  HYB  @1.5   HYB  @2.0   HYB  @2.5 
   6   1    29       20.7%       13.8%       10.3%        3.4%        3.4%        3.4%        0.0%        0.0%        0.0%        0.0%        0.0%        0.0%        3.4%        3.4%        0.0%        0.0%
   6   2    29       58.6%       55.2%       37.9%       20.7%       10.3%        6.9%        3.4%        3.4%       24.1%       10.3%        6.9%        3.4%       31.0%       13.8%       10.3%        6.9%
   6   3    29       86.2%       82.8%       69.0%       58.6%       37.9%       27.6%       24.1%       10.3%       58.6%       55.2%       34.5%       31.0%       62.1%       55.2%       48.3%       37.9%
  26   1     7        0.0%        0.0%        0.0%        0.0%       14.3%       14.3%        0.0%        0.0%        0.0%        0.0%        0.0%        0.0%       14.3%       14.3%        0.0%        0.0%
  26   2     7      100.0%      100.0%       57.1%       28.6%       57.1%       57.1%       42.9%       14.3%       14.3%        0.0%        0.0%        0.0%       71.4%       57.1%       42.9%       14.3%
  26   3     7      100.0%      100.0%       85.7%       85.7%      100.0%      100.0%       57.1%       57.1%       85.7%       71.4%       28.6%        0.0%      100.0%      100.0%       71.4%       57.1%

DRAWREC draws, stratum hive-d (P(trip at any 5-min poll))
  hz  k    n   XS   @1.25  XS   @1.5   XS   @2.0   XS   @2.5   MPC  @1.25  MPC  @1.5   MPC  @2.0   MPC  @2.5   DID24@1.25  DID24@1.5   DID24@2.0   DID24@2.5   HYB  @1.25  HYB  @1.5   HYB  @2.0   HYB  @2.5 
   6   1   413        9.2%        5.8%        2.2%        0.2%        2.9%        0.7%        0.0%        0.0%        9.0%        7.3%        1.9%        1.0%       11.1%        8.0%        1.9%        1.0%
   6   2   413       47.2%       37.8%       19.1%       10.4%       17.7%       10.7%        3.4%        1.5%       39.7%       32.2%       18.6%       12.3%       44.8%       35.6%       20.8%       13.3%
   6   3   413       89.6%       81.6%       54.2%       32.9%       55.2%       36.6%       17.9%        8.2%       78.0%       66.6%       45.8%       31.0%       83.3%       71.7%       50.1%       33.9%
  26   1   381       14.2%        7.9%        1.6%        0.0%        9.4%        3.4%        0.5%        0.3%       10.5%        7.9%        2.1%        1.0%       17.3%       10.2%        2.6%        1.3%
  26   2   381       95.3%       81.1%       38.6%       12.3%       67.2%       50.1%       24.4%       11.3%       61.2%       41.5%       21.3%       13.9%       81.6%       63.8%       37.3%       22.6%
  26   3   381      100.0%      100.0%       94.5%       73.5%       92.1%       85.6%       63.0%       40.7%       95.5%       87.9%       56.2%       35.2%       99.2%       95.5%       77.2%       55.9%
```
