# Canary tiers (gate v36) — design, 2026-10-19 (round 4, final)

OWNER DECISION 10-19 ~12:30Z ("yes"): cut the time per change from 8–10 h to ~1 h for settings and 3–4 h
for small fixes. Three tiers; a registration declares its tier with `"tier": 2`. **Absent = tier 3 = today.**

| tier | what | path |
|---|---|---|
| 1 SETTINGS | a constant changes | light review, owner-direct fleet rollout + tripwire (the existing manual path, journal phase `owner-direct`). **No tooling change.** |
| 2 SMALL FIX | strong Paper evidence | (a) 4 pools where eligible, (b) KEEP allowed at +180, (c) short pool cool-off |
| 3 BIG BEHAVIOUR | ziggurat, mineshaft, town floor, underground safety | unchanged |

## One definition: `tierrule.py` (new, pure, in the gate bundle)

`tier_of(reg)` = 2 only when `reg["tier"]` is the integer 2 (`type(t) is int`: not `True`, `"2"`, `2.0`) AND the
registration has no `class` (bag fixes keep A′/v33, underground-safety keeps v34 and is tier 3 by the owner).
Anything else = 3. `tier_problem(reg)` names a present-but-ignored tier, printed only when the key exists.

## (a) Four pools where eligible — no code change

`drawrec.sh` already takes `min(TARGET_K=4, len(eligible))`. It draws fewer because pools are excluded, which (c)
relaxes. A tier-2 run does not wait for four; drawn at 2–3 pools it does not get (b) and decides at +360.

## (b) KEEP at +180 — `verdict.py`

New block after rule A′, before section 9's `NOT_YET`. Every REVERT path (death gate + two-death floor, v15c, v11,
deposit, own lines incl. `evidence: defect`, friction, licensed change rows, `_USAFE_BLIND`) has run and exited
above it; `--poll` exits at `POLL_OK` above it. It can only turn a NOT_YET into a KEEP. `tierrule.keep_early` (pure)
requires ALL of, each a mutant:

1. tier 2; the read is +180; 180 is registered and is not the last read;
2. **exactly 4 distinct pools** (A′'s calibrated configuration), counted as A′ counts them; **no `canary_split`**;
3. **>= 48 measured canary bot-h** and measured control bot-h > 0, both finite;
4. **an exposure block** with `read` in `reg["reads"]`, a string `field`, a numeric `min >= 1`, and a **finite,
   numeric, non-bool value >= min** (today `exposed` defaults to True with no block, and `True >= 1` passes);
5. **no WATCH of any kind** — including the death gate's HOLD note (A′ tolerates it; tier 2 does not) — and **no
   blocked deciding line**;
6. **every own line and friction rule defined** — a `nullable` line skipped as None/NaN/inf refuses (verdict.py
   collects these in section 8 instead of only `continue`-ing); every registered read readable (its own check,
   `readable` not False on every evidence object; not A′'s bagread clause);
7. **a licence present and not `rate`** (a rate licence is report-only, so nothing could have objected);
8. the cumulative canary death RATE <= the control's (point estimate). One death does not by itself block it;
9. **the baseline is single-build for this read's lookback** (below, `baseline_clean`).

Otherwise NOT_YET exactly as today; a zero-exposure tier-2 +180 EXTENDS. A tier-2 KEEP carries
`extra.keep_rule = "tier-2 +180"` (A′'s label untouched). canary-loop.sh already promotes a KEEP at any minute.

**At a later tier-2 read** (+360, extension reads) a KEEP also requires `baseline_clean` for that read; if it fails the
read says NOT_YET while registered reads remain and INCONCLUSIVE at the final read — contaminated evidence never
authorizes a tier-2 KEEP. REVERT paths are unchanged (see residuals).

**`baseline_clean(M)`** — LOG-BASED; the decision is the pure `tierrule.asymmetric_rows`, the rows are read by
verdict.py ONLY for tier 2 and only where a KEEP would otherwise be printed. Window W = [declared_at − L(M),
declared_at), L(M) = max(240, M) (immobiledid's PRE 180 + its 60-min trailing window; M for scripts with PRE =
CUT − W), cut into 10-min buckets.
- **Loader**: per bot, EVERY generation `skill-*.jsonl*` (live, rotated, `.gz`) whose mtime is not older than the
  window, read by time span — the logs rotate ~23:59Z and a live-only read would drop the window's start. A
  complete line that does not parse, lacks `@timestamp` or `code.version`, an unreadable file or a decompression
  error = NOT clean.
- **Roster** (stable denominator): the ENABLED units (`multi-user.target.wants/mcbot@<bot>.service`) — canary arm =
  enabled bots of the drawn pools, control arm = every other enabled bot. A missing log dir is an unseen bot.
- **Majority by BOT**, not by row: each bot's modal version in a bucket is one vote; the control majority of a bucket
  is the version with the most bot-votes; a tie, or no control vote, = NOT clean.
- **Coverage**: canary-arm rows in EVERY bucket of W and a control majority in EVERY bucket; >= 80% of the canary
  roster "seen" = >= 20 rows AND rows in both the first and the last 60 min of W. (A bot never seen contributes no
  row to any read either — the reads are computed from the same logs — and is capped at 20% of the arm.)
- **Match**: every canary row's version == its own bucket's control majority. The ONLY exception is a fleet
  transition: when the control majority differs between bucket b and b−1 or b+1, a row matching that neighbour's
  majority passes. Bounded: one bucket either side of a change of the control majority, and such rows <= 10% of the
  canary rows (else NOT clean). A canary on a build the controls never ran as their majority never passes.
- **Never a crash**: any exception in the loader, the check or the tier-2 block is "not clean" with its reason, so
  the read says NOT_YET (or INCONCLUSIVE at the final read); a mutant raises inside the loader to prove it.
- **Reported, not gated**: the control arm's heterogeneity (share of control bot-buckets off the majority) is
  printed at every tier-2 KEEP point, so residual (v) is measured on every run.

## (c) Short cool-off — `drawsteady.py` only (drawrec.sh unchanged)

drawrec.sh exports `DRAW_RUN` and subtracts drawsteady's `STEADY RELEASE [...]`. **Only when the INCOMING run
(`DRAW_RUN`) is tier 2** does drawsteady use a new pure path `candidates_t2`; otherwise `candidates` (unchanged, every
existing mutant anchor intact) runs exactly as today. The incoming registration is looked up exactly as drawrec looks it up
(`~/mcai-analysis/registrations/<run>.json`, then `/tmp/registrations/<run>.json`); absent or unreadable = tier 3.
The draw-time checks are an eligibility FILTER; the decisive contamination interlock is verdict.py's log check.

`candidates_t2`: every ledger decision naming the pool in 12 h must be CLOSED and old enough **counted from its LAST close row** (the
run's latest journal `torn-down`, or fleet-wide `promoted` of its sha, at/after the decision and <= now; an
interrupted teardown finished later counts from the later row). For a tier-2 draw the journal is parsed STRICTLY:
one malformed line releases nothing early (a lost later teardown row would make an earlier close look final; the
tier-3 path keeps its tolerant parser; the live journal had 0 malformed lines in 863 on 10-19):
- predecessor **recorded as tier 2 at decision time**: a tier-2 run's verdict line always begins
  `VERDICT <W> (+M) :: tier 2 (v36) | ...` (`_TIER` is computed immediately after `why = []`, before the gate-digest
  note or any other append) (first `why` element, so every artifact and every poll carries it, and
  out() also writes `"tier": 2` into every artifact); the loop records that line in the LEDGER note, which is
  immutable and bound to the decision. drawsteady reads the predecessor tier from the ledger note only, by an ANCHORED full-prefix match
  `^<run>: VERDICT [A-Z_]+ \(\+\d+\) :: tier 2 \(v36\) \|` (never a substring search); a manual
  close, a truncated or other note = tier 3: **240 min**;
- tier-3 KEEP promoted fleet-wide: 360 min (today's 6 h, but from the promotion);
- anything else: held (12 h from the decision, today's drawrec exclusion).

Then rules 2 and 3 run unchanged (membership, rows, one build in the hour, bag carryover inside >= 4 qualified
controls), plus **`version_clean`: every enabled bot of the pool active, on ONLY the fleet build for the last
240 min, with rows in both the first and the last hour of it, and the pool with rows in every 10-min bucket**
(own 240-min scan through bagread.bot_rows, which reads every generation by time span; bot_stats/qualify stay on
STEADY_MIN = 60). A torn-down (not promoted) predecessor passes
steady()'s fleet-version test with its teardown time as the build's start; that is sound only because version_clean
reads every bot's rows — a mutant asserts it. The owner asked for ~3 h; the estimator's 240-min lookback makes ~4 h
after the teardown the shortest cool-off whose +180 baseline is single-build.

## Why tier 3 / absent is byte-identical in behaviour

- verdict.py: every new branch is guarded by `_TIER == 2`; the ledger/journal are read only then; `"tier"` is
  written into the artifact only then; `'tier'` added to `_EVALUATED` affects only registrations carrying it; the
  section-8 collection of skipped nullable lines only appends to a list. No `why` line or exit changes otherwise.
- drawsteady.py: `candidates_t2` and `version_clean` run only for a tier-2 `DRAW_RUN`; with any other incoming run
  the code path, output lines and RELEASE are today's. A tier-3 run is never drawn on an early-released pool.
- Existing suites (test_threepool 163, test_keep180, test_verdict_acceptance, test_bagfix, test_usafe) pass unchanged.
- Install-time positive controls: the staged drawsteady on the live ledger with today's `DRAW_RUN` values prints the
  installed one's RELEASE; the staged verdict.py `--dryrun` on recorded evidence of past runs prints the installed
  one's verdict line (rules pointed at the staged record).
- What changes for everyone: the gate bundle digest (verdict.py edited, tierrule.py added), re-registered as v36.

## Risks, named

1. **Carry-over contamination.** Mitigated as above (incoming tier-2 only; 240 min single-build from logs at the draw;
   log-based baseline check at every tier-2 KEEP). Residual: (i) a read script with a lookback longer than
   max(240, M) is not covered; (ii) a non-defect own line (calibrated/support) can still REVERT on a contaminated
   pre-window at +360 — its v25/v28 calibration is the only guard; (iii) world state (tunnels, farms, chests) persists
   at any cool-off; (v) CONTROL-ARM contamination (Claude r2): with one slot, the run that just closed has its pools
held, so they sit in the next run's control arm; after a promotion ~4 of ~11 control pools spent the PRE on the
predecessor's build, leaving roughly predecessor-effect x 4/11 in the DiD (KEEP-favouring for a beneficial
predecessor). baseline_clean checks the canary arm against the control MAJORITY, not control homogeneity. The same
confound exists for tier 3 and A′ today. **ACCEPTED for tier 2 (round 4), not mitigated**: the mitigation — a
homogeneous control arm over L — would forbid any tier-2 KEEP within 240 min of the previous canary's close, i.e.
every back-to-back run, which is the owner's whole goal. Measured report-only on every tier-2 KEEP (above); a
replay estimate is a follow-up; flagged for the owner; (iv) consequence: a tier-2 run on early-released pools that misses the +180 KEEP will usually close
   INCONCLUSIVE at +360 — runs needing long reads should register tier 3.
2. **A +180 KEEP on thin exposure.** Conditions 2–8. A′'s calibration (keep180-2026-10-08.md) is for exactly four
   pools at +180: death-gate false KEEP for x2/x3/x5 deaths 72.7/41.6/12.5% vs 75.7/55.5/24.8% at today's 2-pool +360
   (better); BUT near-threshold movement/work/gathering harms (−40/−30/−60%) pass the guards — **false KEEP** —
   92.6/98.1/87.1% vs 89.3/95.5/83.3% today: **the +180 read is somewhat LESS sensitive to those harms**, accepted by
   the owner for A′ and now for tier 2. Rare-event defect lines get half the wall-clock to fire.
3. **The two-death floor still applies**; nothing here can revert. Any held death gate refuses the early KEEP.
4. **Tier is self-declared**; the variant's `approved` reviewer is the control. Classes with own rules cannot be tier 2.
5. **Throughput limits:** drawsteady needs >= 4 qualified untouched control pools; with 4-pool runs back to back the
   12-h `touched` set grows and the early release fails closed (no release, today's exclusions) — stated, not a hazard.
6. More KEEPs per day promoted at +180 means more false KEEPs reach the fleet per week; the scoreboard and tripwires
   are the backstop, as for A′.

## Files

repo `scripts/tierrule.py` (new), `scripts/verdict.py`, `scripts/drawsteady.py`, `scripts/test_tiers.py` (new),
`scripts/host/install-gate-v36.sh` (new), `scripts/host/RULES-IN-FORCE.md` (synced from the host), CLAUDE.md,
STATE.md. Host: `~/verdict.py`, `~/mcai-analysis/{tierrule.py,drawsteady.py}`, `~/digest/RULES-IN-FORCE.md`.

## Code review (implementation)
- Round 5: Codex REQUEST CHANGES (strict journal record SHAPE, not only JSON; the replay must reject crashes) and Claude
  REQUEST CHANGES (a LIVE positive control for the loader on real logs -- tierrule.load_buckets is now the one loader,
  shared by verdict.py and scripts/host/v36_livecheck.py; the install-hold 180 min and re-verified before install).
  Both applied with tests. Round 6: **Codex APPROVE, Claude APPROVE.**
- Live control on 10.0.0.31, 10-19 ~13:45Z: 80/80 enabled bots with rows over 240 min, bad 0, CLEAN, control
  heterogeneity 2.4% (treefarm-02 live on 2 pools), version_clean True on board-b (one build adbec4f), 7 s.
- Follow-up, not done: once a later-read baseline is dirty a longer window cannot become clean (unless the cause was an
  exception) -- closing INCONCLUSIVE at once would save extension bot-hours (Claude r5 optional b).

## Round 4: Claude APPROVE; Codex one change -> applied
- Codex r4: strict journal parsing for the tier-2 draw (a malformed line releases nothing early), with a test of an
  earlier valid close followed by a malformed later one. Claude r4 notes: re.escape the run id; stream the loader
  as (bucket, version) counts; fixtures crossing 23:59Z with the first hour only in a rotated .gz, and one bot on
  the old build in one mid-window bucket.

## Round 3 (both REQUEST CHANGES) -> round 4
- Codex r3 + Claude r3: rotated logs loaded by time span; canary rows in EVERY bucket and a control majority in every
  bucket; seen bots need first- and last-hour rows; stable roster from enabled units; majority by bot; ties and
  missing versions fail closed; the same coverage rule for drawsteady's version_clean.
- Codex r3: the transition exception is bounded (one bucket either side of a control-majority change, <= 10% of rows).
- Claude r3: never a crash (any exception = not clean, mutant). Anchored full-prefix marker; tier before any append.
- Codex r3: residual (v) explicitly ACCEPTED for tier 2 with the reason, measured report-only on every tier-2 KEEP.

## Round 2 (both REQUEST CHANGES) -> round 3
- Codex r2 + Claude r2: records cannot prove completeness or restoration -> baseline_clean is now LOG-based over the
  full L(M) (catches record-failed runs, hand-finished teardowns, failed restarts at +360). The 48-h horizon is gone.
- Claude r2 2a: the cool-off counts from the LAST close row. Claude r2 (3): drawrec's registration lookup.
- Codex r2: predecessor tier bound to the decision -> read from the immutable ledger note's `tier 2 (v36)` marker.
  Claude r2 (4): the marker is the first `why` element and out() writes `"tier": 2`, so polls carry it too.
- Claude r2: control-arm contamination named as residual (v), not mitigated.

## Round 1 (both REQUEST CHANGES) -> round 2
- Codex 1 / Claude 1: early release only for a tier-2 INCOMING run (`DRAW_RUN`). Done.
- Codex 2: lookback is PRE 180 + 60 trailing = 240. Done (version_clean 240; L >= 240).
- Codex 3: +360 contamination must not authorize KEEP. Done (baseline_clean at every tier-2 KEEP; INCONCLUSIVE).
- Codex 4: calibration meaning corrected (risk 2); exactly four pools. Done.
- Claude 2: count from the close (promotion/teardown), not the decision. Done (also for the 6-h path of a tier-2 draw).
- Claude 3: own lines/friction defined, licence not rate, no canary_split, numeric non-bool exposure on a registered
  read, exactly 4. Done. Claude 4: own keep_rule label and own readability. Done. Claude 5: predecessor tier recorded
  at decision time (verdict artifact). Done. Torn-down with failed restarts: version_clean + a test.
