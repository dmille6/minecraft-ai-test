#!/usr/bin/env python3
"""
test_verdict_acceptance_mutants.py -- the acceptance suite's own test.

Ten green acceptance cases prove nothing on their own. "A source test that has
never been seen to fail is not a test" (CLAUDE.md), and this project has already
scored a mutant that silently failed to apply as a kill. So every mutant here:

  - asserts its ANCHOR is PRESENT and UNIQUE before it is applied, and
  - is written to a COPY, never into `scripts/verdict.py`. An in-place mutant on
    this project once survived the runner's SIGKILL on disk, and a later read
    took it for the real file.

Each mutation restores one specific rule to the way it behaved when it made a
real mistake, and names the case that must flip. A mutant that flips NOTHING
means the case it targets is not actually testing that rule.

Run: python3 scripts/test_verdict_acceptance_mutants.py
"""
import os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'verdict.py')
SUITE = os.path.join(HERE, 'test_verdict_acceptance.py')

# (label, file, anchor, replacement, case that must flip, verdict it must flip to, why)
MUTANTS = [
    ('v23 removed -- a single death licences a revert again',
     'verdict.py',
     "_v23_rev, _v23_why = licence_reverts(licensed, ndeaths)",
     "_v23_rev, _v23_why = (bool(licensed), 'PRE-v23: one licensed change row reverts')",
     'one canary death', 'REVERT',
     "This is the branch that ended owner-01b at +0 on one death, while the aggregate "
     "gate was at that same moment correctly holding a 10.00x ratio at a 0.78x bound."),

    ('v21 undone -- the death gate back on the POINT ratio',
     'deathgate.py',
     '    if lb > threshold:',
     '    if point > threshold:',
     'two deaths, lower bound 0.58x', 'REVERT',
     "falls-01 was a report-only log row and was reverted on a 4.7x point ratio whose "
     "lower bound was 0.58x. If this mutant does not flip the case, the case is not "
     "testing the lower bound."),

    ('evidence binding loosened -- the sha check dropped',
     'verdict.py',
     "if o.get('sha') != reg['sha']: why.append(f'{name}: evidence sha {o.get(\"sha\")} != registration sha {reg[\"sha\"]}'); continue",
     "pass",
     'evidence sha != registration sha', 'KEEP',
     "Without it a verdict can be issued on a finished trial's numbers -- which is "
     "exactly what the tier-1 analyst did for two days."),

    ('staleness check dropped -- a four-hour-old read counts as current',
     'verdict.py',
     "if age > 90: why.append(f'{name}: evidence stale ({age:.0f} min)'); continue",
     "pass",
     'evidence 240 min old', 'KEEP',
     "A read describes a window. An old one describes a window that has closed."),

    ('a missing endpoint scored as a failure instead of unreadable',
     'verdict.py',
     """why.append(f"own line {ln['read']}.{ln['field']} is {val!r} -- undefined, not a failure"); (out('UNREADABLE'))""",
     """why.append(f"own line {ln['read']}.{ln['field']} is {val!r} -- undefined, not a failure"); (out('REVERT'))""",
     'primary endpoint missing', 'REVERT',
     "owner-01b's primary ratio-DiD divided by zero and printed `+nan% FAIL`. You "
     "cannot reduce immobility from zero; that is not a change making things worse."),

    ('exposure ignored -- an inert canary reaches KEEP',
     'verdict.py',
     "    val = ev.get(ex['read'], {}).get(ex['field']) or 0; exposed = val >= ex['min']; why.append(f\"exposure {ex['read']}.{ex['field']} = {val} (min {ex['min']})\")",
     "    val = ev.get(ex['read'], {}).get(ex['field']) or 0; exposed = True; why.append(f\"exposure {ex['read']}.{ex['field']} = {val} (min {ex['min']})\")",
     'zero exposure', 'KEEP',
     "owner-01 shipped inert with every other check green. Exposure was the only tell, "
     "and a KEEP here would have promoted a change that never ran."),

    ('the movement guard demoted to a WATCH',
     'verdict.py',
     "if v['verdict'].startswith('REVERT'): why.append('v15c ' + v['verdict']); (out('REVERT'))",
     "pass",
     'v15c REVERT is forwarded', 'KEEP',
     "The harm signal must survive every loosening of the death gate. This is the guard "
     "that catches a bot held still by its own owner."),

    ('a NaN endpoint scored as a failing one (the pre-2026-09-19 behaviour)',
     'verdict.py',
     "    if val is None or (isinstance(val, float) and val != val) or val in (float('inf'), float('-inf')):",
     "    if val is None:",
     'primary endpoint is nan', 'REVERT',
     "owner-01b's ratio-DiD printed `+nan% FAIL`. Every comparison against NaN is False, "
     "so an `on_fail: REVERT` line reverts on an arithmetic hole. This is the branch that "
     "was live until today and that the suite's own first draft did not reach."),

    ('the 1.25x threshold quietly raised to 5x',
     'deathgate.py',
     'floor=2, threshold=1.25, alpha=0.05',
     'floor=2, threshold=5.0, alpha=0.05',
     '3x regression, lower bound 1.40x', 'KEEP',
     "The 21x case passes a threshold of 5 without noticing. This is the case that pins "
     "the calibrated number itself."),

    ('v19 undone -- a rung-linked single death reverts again',
     'verdict.py',
     "if linked and reg.get('ladder_change', False):",
     "if linked and reg.get('ladder_change', False): why.append('PRE-v19 rung linkage'); (out('REVERT'))\nif False:",
     'rung-linked single death', 'REVERT',
     "The OTHER path to owner-01b's mistake, and a different branch from the change-row "
     "one. It ended -08c, -13 and -13b on one death each and was never calibrated."),

    # ANCHOR REPOINTED 2026-09-23 (v24). The previous anchor was
    #   "if _rev: why.append(_why); (out('REVERT'))"
    # and v24 appended the exposure note to that line, so the mutant stopped applying. The
    # harness did the right thing and SKIPPED it with "ANCHOR MISSING OR NOT UNIQUE ... this
    # mutant proves nothing and must not be scored" -- which is the only reason the loss was
    # visible at all. A mutant whose anchor has drifted reads exactly like a passing one.
    ('the death gate silenced entirely',
     'verdict.py',
     "if _rev: why.append(_why + f' [{_expo_note}]'); (out('REVERT'))",
     "if False: why.append(_why); (out('REVERT'))",
     '9 deaths in 30 bot-h vs 3 in 210', 'KEEP',
     "swim_to shipped and tripled drowning deaths. A suite that only ever proves the "
     "harness does NOT revert has tested one direction of one rule."),

    # NEW 2026-09-23. Removing the guard restores the KeyError, which the loop turns into an
    # empty journal note. The mutant's expected verdict is the empty string, because that is
    # literally what the canary recorded three times.
    ('the missing-immobiledid guard removed -- back to a crash that reads as silence',
     'verdict.py',
     "    if 'immobiledid' not in ev:",
     "    if False:",
     'registration omits immobiledid', 'CRASH',
     "banktruth-01 journalled three empty verdicts in four and a half hours because a "
     "KeyError went to a stderr the loop discards."),

    # NEW 2026-09-23. Skipping the friction loop restores the state the format shipped in:
    # a registered guard that is declared, never evaluated, and indistinguishable from one
    # that passed.
    ('the friction section unimplemented again',
     'verdict.py',
     "for fr in reg.get('friction', []):",
     "for fr in []:",
     'registered friction rule fails', 'KEEP',
     "recovery-ladder-1011b registered a friction rule that never ran. verdict.py did not "
     "contain the string 'friction' at all, for the whole life of the format."),

    # NEW 2026-09-23. Dropping the UNREADABLE branch sends an undefined-guard read back to
    # KEEP, which is where it went before the fix: the string matched neither the REVERT nor
    # the WATCH prefix and fell through.
    ('the undefined-guard refusal removed -- v15c UNREADABLE falls through to KEEP again',
     'verdict.py',
     "if v['verdict'].startswith('UNREADABLE'): why.append('v15c ' + v['verdict']); (out('UNREADABLE'))",
     "if False: pass",
     'v15c guards all undefined', 'KEEP',
     "A guard that cannot be computed cannot fail. 37 evidence objects show this has never "
     "fired in practice, which is exactly why it needs a test rather than a memory."),

    # NEW, v24. Locks the amendment in: putting the invented control denominator back must
    # be caught. Before v24 the gate fell back to control_bot_h = canary_bot_h * 7.0 -- the
    # fleet's old 70/10 split, a guess and not a reading -- and it decided verdicts. With 3
    # canary deaths and an unmeasurable control the honest answer is UNREADABLE; the mutant
    # reverts instead, on a denominator nobody measured.
    ('the invented control denominator restored (canary x 7)',
     'verdict.py',
     "_kbh = im.get('control_bot_h') or 0.0",
     "_kbh = (im.get('control_bot_h') or 0.0) or ((im.get('canary_bot_h') or 0.0) * 7.0)",
     'control has no measured exposure', 'REVERT',
     "MEASURED on the live canary 2026-09-23: 20 canary bots and 56.8 measured bot-h "
     "against the 30.8 the old hardcoded ten implied -- a death rate inflated 1.85x, "
     "biasing toward a false REVERT. Exposure must be read, never assumed."),
]


# THE MUTANT DIRECTORY MUST REPRODUCE verdict.py's IMPORT ENVIRONMENT, lib/ included.
# It copied only scripts/*.py, and verdict.py imports canary_manifest and version_split from
# scripts/lib -- so every mutant CRASHED on ModuleNotFoundError rather than producing a verdict,
# and 14 of 15 scored as SURVIVED for a reason with nothing to do with the mutation. A suite that
# reports 1/15 because of its own staging is worse than one that reports nothing.
#
# Copying lib/ is safe because run_suite launches verdict.py as a SUBPROCESS, so the copied
# modules' class objects never meet the originals. Doing the same thing IN-PROCESS is a known
# trap: a copied `Roster` is not the class the test imported, and it scores mutants as killed on
# the artefact.
#
# verdict.py puts /home/mike/mcai-analysis AHEAD of its own directory on
# sys.path, so ON THE BOTS HOST a mutated deathgate.py or singledeath.py in the
# mutant's directory is SHADOWED by the host's real one -- the mutant would be
# applied, bypassed, and then scored by whatever the host copy does. Checked,
# not assumed: this runner refuses to score on a host where that directory
# exists. (Codex, 2026-09-19.)
HOSTLIB = '/home/mike/mcai-analysis'


def run_suite(verdict_path):
    """Return ({case name: verdict}, whole_suite_passed)."""
    env = dict(os.environ, ACCEPTANCE_VERDICT_PY=verdict_path)
    r = subprocess.run([sys.executable, SUITE], capture_output=True, text=True,
                       env=env, timeout=600)
    got = {}
    for line in r.stdout.splitlines():
        if line.startswith('CASE\t'):
            _, name, g, _want = line.split('\t')
            got[name] = g
    return got, r.returncode == 0


# What the UNMUTATED suite must say for each targeted case. A mutant is only
# evidence if the baseline was right to begin with.
WANT_BASE = {
    'one canary death': 'KEEP',
    'rung-linked single death': 'KEEP',
    'two deaths, lower bound 0.58x': 'KEEP',
    'evidence sha != registration sha': 'UNREADABLE',
    'evidence 240 min old': 'UNREADABLE',
    'primary endpoint missing': 'UNREADABLE',
    'primary endpoint is nan': 'UNREADABLE',
    'zero exposure': 'INCONCLUSIVE',
    'v15c REVERT is forwarded': 'REVERT',
    '9 deaths in 30 bot-h vs 3 in 210': 'REVERT',
    '3x regression, lower bound 1.40x': 'REVERT',
    # v24: was 'REVERT' while the gate invented control_bot_h = canary_bot_h * 7.0. With
    # exposure read rather than assumed, three canary deaths against an UNMEASURABLE control
    # is a broken instrument -- neither a pass nor a revert.
    'control has no measured exposure': 'UNREADABLE',
    'v15c guards all undefined': 'UNREADABLE',
    'registered friction rule fails': 'REVERT',
    'registration omits immobiledid': 'UNREADABLE',
}


def main():
    if os.path.isdir(HOSTLIB):
        print(f"REFUSING to score: {HOSTLIB} exists, and verdict.py imports from it BEFORE "
              f"its own directory. A mutated deathgate.py or singledeath.py would be "
              f"shadowed and the kill would be meaningless. Run this off the bots host.")
        return 2
    # THE WHOLE BASELINE MUST PASS, NOT JUST THE TARGETED CASES. Scoring kills
    # against a suite that is already failing somewhere else means the mutants
    # are being read against a harness known to be wrong. (Codex pass 2.)
    base, base_ok = run_suite(SRC)
    if not base_ok:
        bad = [k for k, v in base.items() if k in WANT_BASE and v != WANT_BASE[k]]
        print(f"REFUSING to score: the unmutated acceptance suite does not pass "
              f"(targeted cases wrong: {bad or 'none -- an untargeted case is failing'}). "
              f"Fix the suite before reading anything into a mutant.")
        return 2
    print(f"baseline: {len(base)} cases, all passing")
    missing = [m[4] for m in MUTANTS if m[4] not in base]
    if missing:
        print("ABORT: these mutants target cases the suite does not run:", missing)
        return 1
    print()

    killed = 0
    for label, fname, anchor, repl, case, want, why in MUTANTS:
        d = tempfile.mkdtemp(prefix='mutant-')
        for f in os.listdir(HERE):
            if f.endswith('.py'):
                shutil.copy(os.path.join(HERE, f), d)          # a COPY, never the source
        if os.path.isdir(os.path.join(HERE, 'lib')):
            shutil.copytree(os.path.join(HERE, 'lib'), os.path.join(d, 'lib'),
                            ignore=shutil.ignore_patterns('__pycache__'))
        target = os.path.join(d, fname)
        src = open(target, encoding='utf-8').read()
        n = src.count(anchor)
        if n != 1:
            print(f"[SKIP] {label}\n       ANCHOR MISSING OR NOT UNIQUE in {fname} ({n} occurrences) "
                  f"-- this mutant proves nothing and must not be scored")
            continue
        open(target, 'w', encoding='utf-8').write(src.replace(anchor, repl, 1))
        assert open(target, encoding='utf-8').read() != src, "mutant did not change the file"

        got, _ = run_suite(os.path.join(d, 'verdict.py'))
        got = got.get(case)
        # A KILL NEEDS THREE THINGS, NOT ONE. `got == want` alone would score a
        # kill on a case that ALREADY returned `want` before the mutation, which
        # is a mutant that changed nothing being counted as proof. So: the
        # baseline must have been the expected verdict, the mutant must differ
        # from the baseline, and it must land on the predicted one.
        want_base = WANT_BASE[case]
        ok = (base.get(case) == want_base) and (got != base.get(case)) and (got == want)
        killed += ok
        print(f"[{'KILLED' if ok else 'SURVIVED'}] {label}")
        print(f"          case {case!r}: {base.get(case)} -> {got} "
              f"(baseline must be {want_base}, mutant must give {want})")
        print(f"          {why}")
        if base.get(case) != want_base:
            print("          BASELINE WRONG: the unmutated suite does not pass this case, "
                  "so nothing here is evidence about the mutation.")
        elif got == base.get(case):
            print("          The case did not move at all, so it is not testing this rule.")
        print()

    scored = sum(1 for m in MUTANTS if m[4] in base)
    print('=' * 72)
    print(f"{killed}/{len(MUTANTS)} mutants killed")
    return 0 if killed == len(MUTANTS) else 1


if __name__ == '__main__':
    sys.exit(main())
