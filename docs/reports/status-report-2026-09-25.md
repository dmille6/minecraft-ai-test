# Status 2026-09-25 — a canary that could not reach its own final read, a gate live in no registration for the second day, and a promotion that silently reverted the instrument

All timestamps UTC from `date -u`. Session opened 11:08Z, closed 12:40Z.

## What the session found, in one line each

1. **`drop5-01` closed INCONCLUSIVE because its registration made the final read unreachable** — not
   because the change failed. Its primary was never evaluated.
2. **A gate generation (v29) was live in the decision path and in no registration** — 23 hours after the
   24 Sep entry was written to stop exactly that.
3. **A fleet-wide promotion at 11:57Z, made by a concurrent session on a claimed owner decision this
   session cannot verify**, ended the 24–27 Sep program window as originally scoped.
4. **That promotion silently reverted three analysis-library files**, which broke every telemetry walk
   until it was caught and restored.

## 1. `drop5-01`: the deadline fired instead of the final read

The canary (`efa2853`, maxDrop 3→5 on blind-step candidates plus a 4 half-heart fall-damage cap) deployed
05:44:07Z on `board-b,hive-d` and registered `read_minutes [30, 90, 180, 360]` with **`deadline_min 360`**.

`canary-loop.sh` tests `elapsed > DEADLINE * 60` **inside** the read loop. The loop therefore arrived at
the +360 read at **362 min elapsed**, journalled `deadline +360 reached without a verdict: containment`,
recorded INCONCLUSIVE at 11:46:29Z and tore down.

**The evidence that settles it is an absence with a positive control.** The reads directory holds
`drop5read-{3,30,90,180}.json` and `immobiledid-{30,90,180}.json` — and **no `-360` of either**. The last
evidence on file is 08:49Z against a close at 11:46Z. The read was never taken; it did not fail.

At the moment it closed, the canary had **met every precondition to be readable**: exposure 101 `(limit 5)`
rows against a registered floor of 60, linkage clean, safety clean.

**Denominator: 3 of the 18 registrations on file set `deadline_min == max(read_minutes)` —
`blindstep-01`, `blindstep-02`, `drop5-01`.** All three were written in the last two days; the other 15
leave 60–420 minutes of margin. Only `drop5-01` reached the collision, because `blindstep-01` reverted at
+90 and `blindstep-02` was operator-aborted at +58. The defect was latent in the three newest registrations
and fired once.

### What the data said, recorded as a hand read and not as a verdict

From the +180 evidence (29.9 canary bot-h vs 149.7 control), corroborated independently by the concurrent
session: targeted drop-4-to-5 refusals went **2.34/bot-h in control → exactly 0.0/bot-h in the canary**;
boxed share **−24.3 pp DiD**; immobility DiD −3.3 pp; items **+27%**; **zero fall deaths and zero
low-health fires**; canary deaths 0 vs control 2 over 150 bot-h.

**The ledger's INCONCLUSIVE stands.** Amendments are prospective only, and a verdict is not retrofitted
because the numbers look good. What is recorded is that the close was an *instrument* close.

### The one death was not the change

`hive-d-Comet`, 08:47:24Z, flagged by v14c as a rung-linked death on a non-ladder change. Hand review of
the row chain: `_death` at 496,14,265, **`fail_class: fire`**, detail *"tried to swim in lava; idle at the
moment of death"*. No fall, no drop, no blind-step row anywhere in the window; `_lava_corridor` had refused
that leg three times and the bot died idle two blocks away. The death poll independently reports **0 deaths
with a change row**. One death against the owner's two-death floor: reported and named, not a verdict.

The concurrent session added the point this hand read missed: the v14c flag fired on `_entombed`, **a row
the baseline emits too**, so the linkage was false in the first place.

## 2. v29 was live in the decision path and in no registration

`faf7cf7`, titled "gate v29", added 52 lines to `verdict.py` at **2026-09-24 12:11Z** — about 23 hours
after `a9e13e1` registered v25–v28c after the identical gap. The host's `~/verdict.py` and the repo's
`scripts/verdict.py` were byte-identical (`891ce5bb`), so it was **live on the fleet**.

**Why it hid: the code never spells the string "v29".** The gate is the `false_trip_rate_ci_upper`
requirement plus the `CAL_MAX_AGE_H` staleness check. A grep for the label returns nothing, which reads as
"not live" — and that was the first conclusion this session drew before checking the md5s.

**It has never decided anything, and that is measured.** Of the **18** registrations on file, **zero** carry
`evidence: "calibrated"`, which is the only path v29 gates. Positive control: the same grep finds
`evidence: "defect"` in three of them, so it can see a presence. Registered **prospectively** today.

v29 is good work and its substance deserves recording: it found that a registration naturally sets
`at_threshold` at its calibration's own p95, which makes the realised false-trip rate **0.0500 by
construction**, so v28's `ftr > 0.05` **could never fire**. And it **closes queue item 12** — `CAL_MAX_AGE_H
= 48` is now measured over 19 read anchors (48 h passes at a 9.5% CI upper; 72 h is the first to cross at
10.7%), registered with the honest caveat that an age limit buys little, since read-era variance of 3.5 pp
is beyond its reach.

## 3. The promotion, and the owner call it raises

At **11:53:22Z** a ledger entry recorded `KEEP efa2853 FLEET-WIDE (80 bots)` citing *"EXPLICIT OWNER
DECISION 2026-09-25: 'promote bound-5'"*. At **11:56:45Z** `sudo cp deploy-fleet.sh /root/d.sh`, and at
11:56Z `/root/d.sh efa2853 drop5-promote` deployed to all 80 bots.

**This session did not make that decision and cannot verify it.** It was written by a concurrent Claude
session. It is recorded as **unverifiable from here, not as unsanctioned** — the same treatment yesterday's
file gave the two "OWNER DECISION 2026-09-24" commits. That is now three instances in two days and is worth
settling.

The deploy was **not interrupted**: killing a fleet deploy mid-run strands the fleet on mixed versions and
halts the tripper, which is materially worse than letting it finish. It was allowed to complete and then
verified.

**It ends the 24–27 Sep program window as originally scoped.** Rule 1 of that window was that fleet-wide
promotions may not happen inside it, and that the window restarts if one does. A 24–27 aggregate must not
now be reported as clean: it spans two code versions with a fleet-wide change 3.5 days in.

**Verified after the deploy:** one version `efa2853+c7b045` on all 80 bots (2,032 rows over the 3 minutes
to 12:19Z); teardown of the preceding canary clean (**0 `efa2853` rows at or after 11:51Z** from the
canary pools); `check-open-loop.py` reports no open canary.

Four systemd units are `failed` — `board-b-Charlie`, `hive-a-Charlie`, `hive-b-Charlie`,
`placebo-a-Charlie`. **Benign:** they have no env file ("Failed to load environment files"), were never
started today, and are leftovers among **84 unit instances for 80 bots** that the teardown's
restart-everything loop wakes and fails. Worth deleting so they stop reading as an alarm.

## 4. The promotion silently reverted the analysis library

`/opt` is reset by every deploy. The 11:57Z promotion overwrote three files in
`/opt/minecraft-ai/scripts/lib/`, all stamped 11:57:04Z:

| file | golden (`~/mcai-analysis/lib/`) | after promotion |
|---|---:|---:|
| `telemetry.py` | 27,459 B (23 Sep) | 13,249 B |
| `openloop.py` | 8,237 B (18 Sep) | 4,349 B |
| `version_split.py` | 14,338 B (23 Sep) | 3,595 B |

`openloop.py` backs `check-open-loop.py` and `version_split.py` backs the census, so this was not cosmetic.

**The symptom was a false refusal that named an impossible remedy.** Every telemetry walk began failing at
*any* window size with `WalkTooWide`: "this walk would read ~10.7 GB … **Narrow the window with
`since_minutes=`**". But the estimate globs all **1,208** matching files (**1,124** of them `.gz`, counted
at 25x = 10.30 GB against 0.43 GB of plain data) and is **window-independent** — so narrowing the window
cannot help, and a 4-minute walk fails identically to a 200-minute one. The golden copy's
`predates_window()` is precisely the fix, and its docstring names this bug: *"the estimate counted files
the walk would never open, and the cap refused windows that were in fact tiny."*

Restored from the golden tree at 12:15Z, md5-verified, and proven by a 30-minute walk returning **19,049
rows / 80 bots** — exactly the re-arm rule's expectation. Backups left at `*.pre-restore-20260925T1215Z`.

**This promotes queue item 8** ("land the analysis library on the bots line") from a nicety to a
requirement: every deploy silently reverts three instrument files, and only re-arm rule 5 catches it.

## What was built: v30, the deadline collision as a raise

Registered prospectively, and enforced where it can actually act.

- **`canary-loop.sh` now refuses to launch** via `~/v30check.py` when
  `deadline_min <= max(read_minutes) + 30`. This is the only place the loss is preventable — by the
  deadline it is already too late, which is the same defect as a remedy the bot cannot perform from where
  it is.
- **`verdict.py` reports it on every read** through a pure `schedule_violation()`, so a canary that somehow
  starts in this state says so from +30 rather than at its deadline.
- **A grace margin, not a bare `>`.** A read is a full walk: the +180 read landed 7 minutes after its
  minute. 30 minutes is ~4x the largest observed lag and costs nothing, because the deadline exists to
  contain a *hung* loop, not to clip a working one.

**Tests.** 67/67 acceptance (63 before the new cases), 26/26 acceptance mutants run **off** the bots host,
and a new behaviour suite for the pure function: 16 cases, 5 mutants, all killed.

Two test-writing notes worth keeping, both of which were failures first:

- **Three mutants survived a weaker probe.** `dl <= last` implies `dl < last + grace`, so deleting the
  UNREADABLE branch leaves the TIGHT branch still flagging — protective, but no longer able to say the
  final read is *impossible* rather than merely at risk. The probe now asserts the **message**, not merely
  that something flagged. A fourth survived because every probe passed `grace=` explicitly, which made the
  default constant unmutatable; one probe now omits it deliberately.
- **The loop assertion failed on its first run, correctly.** It looked for the refusal message in
  `canary-loop.sh` when the message lives in `v30check.py`. It now anchors on the executable call and
  proves end-to-end that the checker refuses 360/360 and accepts 360/780.

`canary-loop.sh` and `v30check.py` are now committed — they existed **only on the host**.

Committed as `3a1fd0d` on `recovery-ladder-03`.

## Rule files, resynced

No canary was live, which is the only safe window to touch them.

| file | before | after |
|---|---|---|
| `~/digest/RULES-IN-FORCE.md` | `29ba5e26` | **`eb03a7f8`** (matches `scripts/host/` exactly) |
| `~/digest/RULE.md` | `395d8988` | **`a38827a9`** (header corrected, v29/v30 appended) |
| `~/verdict.py` / `scripts/verdict.py` | `891ce5bb` | **`6dda048d`**, byte-identical to each other |

`RULE.md`'s header had claimed "NO LIVE CANARY as of 2026-09-24 … fleet-wide promotions MAY NOT" — false on
both counts by the time it was read. It now states the promotion and its consequence for the window.

## Two sessions ran concurrently, in the same worktree

A concurrent Claude session was active throughout (commits `4b7a652`, `50656f1`, the promotion, and
uncommitted edits to `verdict.py` and both acceptance suites that appeared mid-session). It reached the
same diagnosis of the deadline defect independently — corroboration rather than duplication — and caught
the false `_entombed` linkage.

`verdict.py` now carries **two** schedule guards, written independently: this session's pure
`schedule_violation()` (report-only, with the grace margin) and the concurrent session's
`REGISTRATION CANNOT CONCLUDE` (UNREADABLE at the first read). **Both are kept.** They are complementary
and both tested, and refactoring a file another session is actively editing is a worse risk than the
duplication. Consolidating them is queued.

## Honest scope: what was not done

- **`storage_full` (queue item 1), the largest lever found, was not built.** It needs a sandbox mechanism
  proof, two Codex passes and independent Claude *and* ChatGPT review; that is a full day's work and was
  not completable alongside closing the loop, registering two gates and restoring the instrument. Its
  measurement stands from yesterday and is unchanged.
- **`skill_error` (queue item 2), the cheap read that would feed item 1, was not started.** Wide walks had
  to stay serialized around the canary's own read, and then the library was broken from 12:07Z to 12:15Z.
- **The owner was not reached.** PushNotification failed at 11:57Z — "Remote Control inactive" — the
  **fourth consecutive day**. STATE.md is the only channel, and the owner calls are at the top of it.

## Fleet, for the record

Nightly program read (00:12Z, fleet line, pre-promotion): deaths 0.0188/bot-h **pass** (≤0.05), iron-pick
share 15.1% **pass**, immobile 3/80 = 3.8% **FAIL** (≤2%), gather 19.4% **FAIL** (≥40%), stock 2.34
items/bot-h **FAIL** (≥20). **Two of five.** The nightly stock series is now
**6.00 → 5.88 → 3.95 → 2.95 → 2.96 → 2.34** with no code change behind it — consistent with the known ±77%
six-hour world drift, and **not to be read as a regression or credited to any fix**.
