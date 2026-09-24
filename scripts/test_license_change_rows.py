#!/usr/bin/env python3
"""Behavioural test for verdict.py's v19 change-row licensing decision.

Three canaries were ended by a change row that could not discriminate (-08c, -13, -13b).
The decision now lives in a pure function so it can be tested instead of trusted, and
these cases are the three that actually happened plus the one that must still fire.

    python3 test_license_change_rows.py           # against ~/verdict.py on the bots host
"""
import importlib.util, os, sys

path = os.environ.get('VERDICT_PY', os.path.expanduser('~/verdict.py'))
src = open(path).read()
# verdict.py runs on import (it is a script); take just the function.
import ast
tree = ast.parse(src)
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'license_change_rows')
ns = {}
exec(compile(ast.Module(body=[fn], type_ignores=[]), path, 'exec'), ns)
license_change_rows = ns['license_change_rows']

FAILED = []


def check(name, got, want):
    # A mutant must produce a clean FAIL line, not a traceback from the NEXT assertion:
    # a crash and a failure look different in a log, and only one of them gets read.
    if callable(got):
        try: got = got()
        except Exception as e: got = f'raised {type(e).__name__}: {e}'
    ok = got == want
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        print(f'        got  {got}\n        want {want}')
        FAILED.append(name)


# 1. The gate must still FIRE. A row the old code cannot write, seen on the canary away
#    from any death, and present in this death's window: that is the change acting.
lic, ref = license_change_rows(
    [('hive-a-Bravo', '04:09:35', ['death_site_route_crossed'], 'drowned')],
    away={'death_site_route_crossed'}, ctrl_at_death=set())
check('a discriminating row licenses a REVERT', (len(lic), len(ref)), (1, 0))

# 2. recovery-ladder-13b: `flooded_pocket_rung` is fleet-wide on 1d6c97d, and a control
#    bot (isolated-a-Echo, 00:01:45) died carrying it. Baseline, not the change.
lic, ref = license_change_rows(
    [('hive-a-Bravo', '04:09:35', ['flooded_pocket_rung'], 'drowned')],
    away={'flooded_pocket_rung'}, ctrl_at_death={'flooded_pocket_rung'})
check('a row control deaths carry is refused', (len(lic), len(ref)), (0, 1))
check('  and the reason names the baseline', lambda: 'baseline behaviour' in ref[0], True)

# 3. recovery-ladder-13: `death_site_recorded` is written BY the death handler, so it was
#    never seen away from a death. A consequence cannot be a cause.
lic, ref = license_change_rows(
    [('placebo-a-Delta', '23:20:15', ['death_site_recorded'], 'drowned')],
    away=set(), ctrl_at_death=set())
check('a row only ever seen at a death is refused', (len(lic), len(ref)), (0, 1))
check('  and the reason names the death handler', lambda: 'written by the death' in ref[0], True)

# 4. Mixed: one row licenses, one is refused -- the licensed one must still revert.
lic, ref = license_change_rows(
    [('hive-a-Bravo', '04:09:35', ['flooded_pocket_rung', 'death_site_route_crossed'], 'x')],
    away={'flooded_pocket_rung', 'death_site_route_crossed'},
    ctrl_at_death={'flooded_pocket_rung'})
check('a real row still fires alongside a refused one', (len(lic), len(ref)), (1, 1))

# 5. No deaths at all: nothing licensed, nothing refused (the quiet case must stay quiet).
check('no death windows -> no verdict either way',
      license_change_rows([], away={'x'}, ctrl_at_death=set()), ([], []))

# ---------------------------------------------------------------- v25 ------
# The presence test above has almost no power: `ctrl_at_death` only holds rows carried by
# control deaths INSIDE this window, and at ~0.05 deaths/bot-h that is usually one or two
# deaths. Audited 2026-09-24 across all 23 reverts, two rows licensed a REVERT while
# control was emitting them constantly. These cases are those two, with their MEASURED
# control rates, plus the two rows that did discriminate and must still fire.

# 6. recovery-ladder-04 `6d843a1`: `entombed` licensed the revert. Control emitted it at
#    6.16/bot-h -- a 64.2% chance of a coincidental link in the audit's 600 s window and
#    9.8% in this file's 60 s one. Either way it is not evidence.
lic, ref = license_change_rows(
    [('hive-a-Bravo', '23:04:00', ['entombed'], 'drowned')],
    away={'entombed'}, ctrl_at_death=set(), ctrl_rate={'entombed': 6.16})
check('v25: a row control emits at 6.16/bot-h is refused', (len(lic), len(ref)), (0, 1))
check('  and the reason gives the rate and the probability',
      lambda: '6.160/bot-h' in ref[0] and 'P=0.098' in ref[0], True)

# 7. recovery-ladder-03 `612d1c8`: `marooned` at 4.77/bot-h, 54.8% at 600 s.
lic, ref = license_change_rows(
    [('placebo-b-Echo', '21:06:00', ['marooned'], 'drowned')],
    away={'marooned'}, ctrl_at_death=set(), ctrl_rate={'marooned': 4.77})
check('v25: a row control emits at 4.77/bot-h is refused', (len(lic), len(ref)), (0, 1))

# 8. A REGRESSION TEST, NOT A DISCRIMINATION TEST -- and the difference matters.
#    `fall_path` was 0 in 115.4 control bot-h (falls-01 fc28885) and `escape_rung` 0 in
#    178.0 (owner-01b aa44514), so a measured-zero rate must license exactly as before or
#    this fix has silently narrowed the gate. That is all this case proves.
#
#    IT IS NOT EVIDENCE THAT THOSE ROWS DISCRIMINATE. A row INTRODUCED BY THE CHANGE has
#    lambda = 0 on control BY CONSTRUCTION -- the old code cannot emit a row it does not
#    contain -- so this formula awards it maximal apparent discrimination no matter how
#    often harmless treatment-side episodes emit it. That is the documented owner-01b trap
#    (recovery-ladder-registration.md:413), and a Codex pass raised it against this very
#    test. Two further limits of the same kind, recorded so they are not mistaken for
#    solved: the link window ENDS AT A DEATH rather than falling at a random time, so the
#    quantity that actually matters is P(row in the preceding 60 s | a comparable baseline
#    death), and a marginal fleet rate can UNDERestimate that; and these rows are emitted
#    by persistent states (entombed, marooned), which is clustered rather than Poisson --
#    under a Cox process P(any) = 1 - E[exp(-Lambda)] <= 1 - exp(-E[Lambda]), so the
#    homogeneous figure is too HIGH for randomly placed windows, which refuses more and
#    therefore errs toward keeping rather than reverting.
#
#    So the rate filter is a REFUSAL, never a licence: it can only move a row from
#    licensed to refused, never the reverse. That monotonicity is what makes it safe to
#    land ahead of the conditional estimator, and case 12 below asserts it.
for row, rate, bh in (('fall_path', 0.0, 115.4), ('escape_rung', 0.0, 178.0)):
    lic, ref = license_change_rows(
        [('placebo-a-Delta', '04:39:00', [row], 'fell')],
        away={row}, ctrl_at_death=set(), ctrl_rate={row: rate})
    check(f'v25: {row} at 0/bot-h over {bh} control bot-h licenses as it did before',
          (len(lic), len(ref)), (1, 0))

# 12. THE MONOTONICITY THE COMMENT ABOVE CLAIMS. For every rate, the v25 filter must
#     license a SUBSET of what the presence-only test licensed. If this ever fails, the
#     filter has become a licence and the argument for landing it early collapses.
_mono = []
for lam in (0.0, 0.01, 0.5, 3.0, 3.08, 6.16, 100.0):
    base_l, _ = license_change_rows([('b', 't', ['r'], 'd')], away={'r'}, ctrl_at_death=set())
    new_l, _ = license_change_rows([('b', 't', ['r'], 'd')], away={'r'}, ctrl_at_death=set(),
                                   ctrl_rate={'r': lam})
    _mono.append(len(new_l) <= len(base_l))
check('v25: the rate filter only ever REFUSES, never licenses (7 rates)',
      all(_mono), True)

# 9. An UNMEASURED row (absent from ctrl_rate) must keep the old behaviour, not be
#    silently licensed OR silently refused -- a hole in the instrument is not a finding.
lic, ref = license_change_rows(
    [('hive-a-Bravo', '04:09:35', ['death_site_route_crossed'], 'drowned')],
    away={'death_site_route_crossed'}, ctrl_at_death=set(), ctrl_rate={'something_else': 9.0})
check('v25: an unmeasured row falls through to the presence test', (len(lic), len(ref)), (1, 0))

# 10. THE BOUNDARY IS THE DECISION. At the 60 s window, p_max=0.05 sits at
#     lambda = -ln(0.95)*60 = 3.0776/bot-h. A rate just under licenses, just over refuses.
#     A test that never sees the line move is not testing the line.
import math
_lam_crit = -math.log(1 - 0.05) * 3600 / 60
for lam, want, label in ((_lam_crit * 0.98, (1, 0), 'just below'), (_lam_crit * 1.02, (0, 1), 'just above')):
    lic, ref = license_change_rows(
        [('b', 't', ['r'], 'd')], away={'r'}, ctrl_at_death=set(), ctrl_rate={'r': lam})
    check(f'v25: {label} the {_lam_crit:.3f}/bot-h boundary -> {want}', (len(lic), len(ref)), want)

# 11. The window is a parameter, and widening it must refuse MORE, never fewer. The audit
#     quoted 600 s; this file uses 60 s; a rate safe at 60 s can be unsafe at 600 s.
lic60, _ = license_change_rows([('b', 't', ['r'], 'd')], away={'r'}, ctrl_at_death=set(),
                               ctrl_rate={'r': 1.0}, window_s=60)
lic600, ref600 = license_change_rows([('b', 't', ['r'], 'd')], away={'r'}, ctrl_at_death=set(),
                                     ctrl_rate={'r': 1.0}, window_s=600)
check('v25: 1.0/bot-h licenses at 60 s', (len(lic60),), (1,))
check('v25: the same rate is refused at 600 s', (len(lic600), len(ref600)), (0, 1))

# ---------------------------------------------------------------- v27 ------
# MEASURED 2026-09-24 across all 15 death-involved reverts. Linkage at a 60 s window
# separates the two REAL harms from the background; the death RATE provably cannot
# (rl-08b real and falls-01 false both read a 0.58 lower bound).
#
#   case                 truth  row             canary rate   control rate   nearest row
#   aa44514 owner-01b    REAL   escape_rung     6.733/bot-h   0 in 249.5 bh    -9.6 s
#   3810457 rl-08b       REAL   lava_corridor   0.977/bot-h   0 in 171.8 bh    -5.3 s
#   fc28885 falls-01     FALSE  fall_path       1.338/bot-h   0 in 162.2 bh  -519.7 s
#   a242d64 rl-02        FALSE  (no new row ever fired)
#
# Background false-link rate: 5.0% at 60 s (1 of 20 background deaths) vs 20.0% at 600 s.
# False REVERT per 3 h read: 3.0% at 60 s vs 10.6% at 600 s. THE WINDOW IS THE CALIBRATED
# PARAMETER, and 60 s is the calibrated value. Do not widen it without redoing that count.

# 13. The canary-rate arm: REPORTED, never a refusal. `escape_rung` at 6.733/bot-h has a
#     10.6% chance of landing in a 60 s window with any death, above this function's own
#     ceiling -- yet it is the licensing row of a revert the audit calls CORRECT. So the
#     note goes on the row and the licence still stands.
lic, ref = license_change_rows(
    [('hive-a-Bravo', '16:38:46', ['escape_rung'], 'drowned')],
    away={'escape_rung'}, ctrl_at_death=set(),
    ctrl_rate={'escape_rung': 0.0}, canary_rate={'escape_rung': 6.733})
check('v27: escape_rung at 6.733/bot-h is still LICENSED (owner-01b stays revertable)',
      (len(lic), len(ref)), (1, 0))
check('  and the row carries the canary-rate note', lambda: 'REPORTED, not refused' in lic[0][2], True)
check('  and the note gives q = 0.106', lambda: 'q=0.106' in lic[0][2], True)

# 14. A quiet new row gets no note at all: lava_corridor at 0.977/bot-h is q = 0.016.
lic, ref = license_change_rows(
    [('placebo-a-Delta', '06:02:00', ['lava_corridor'], 'tried to swim in lava')],
    away={'lava_corridor'}, ctrl_at_death=set(),
    ctrl_rate={'lava_corridor': 0.0}, canary_rate={'lava_corridor': 0.977})
check('v27: rl-08b lava_corridor at 0.977/bot-h licenses cleanly', (len(lic), len(ref)), (1, 0))
check('  and carries NO note (q = 0.016, inside the ceiling)',
      lambda: 'REPORTED' not in lic[0][2], True)

# 15. The canary-rate arm must never be the thing that refuses. Even an absurd rate keeps the
#     licence, because turning this into a veto would have cost owner-01b -- and that decision
#     is recorded in the function, not left to a reader.
lic, ref = license_change_rows(
    [('b', 't', ['r'], 'd')], away={'r'}, ctrl_at_death=set(),
    ctrl_rate={'r': 0.0}, canary_rate={'r': 999.0})
check('v27: even a 999/bot-h canary row is licensed, not refused', (len(lic), len(ref)), (1, 0))

# 16. And omitting canary_rate entirely must behave exactly as v25 did.
lic, ref = license_change_rows(
    [('b', 't', ['r'], 'd')], away={'r'}, ctrl_at_death=set(), ctrl_rate={'r': 0.0})
check('v27: no canary_rate supplied -> v25 behaviour, no note',
      (len(lic), len(ref), 'REPORTED' in lic[0][2]), (1, 0, False))

print(f"\n{'ALL PASS' if not FAILED else str(len(FAILED)) + ' FAILED: ' + ', '.join(FAILED)}")
sys.exit(1 if FAILED else 0)
