#!/usr/bin/env python3
"""test_launch_guards.py -- the two LAUNCH refusals, v31 and v32, and whether they are WIRED.

WHY THIS FILE EXISTS. `licencecheck.py` was written on 2026-09-25 and its own docstring says it
refuses a canary at launch. Found 2026-09-26: **canary-loop.sh never invoked it.** The positive
control is in the same grep -- the loop calls `changerowcheck.py` at line 22 and `v30check.py` at
line 52 -- so the absence was real and not a broken search. Two of twenty registrations on file
declare a `licence` at all, which is what an unwired refusal looks like from the outside.

That is the defect class CLAUDE.md names: a remedy that is PRINTED but not reachable. One refusal
printed its correct remedy 262 times and the model never acted on it. A checker whose refusal is
never called is the same shape -- worse, because the docstring reads as protection.

So this suite asserts the WIRING, not the intention:
  v31  the loop invokes licencecheck.py in executable text and exits non-zero on its refusal,
       and licencecheck.py really does refuse a registration that names no instrument.
  v32  the same for gatedigest.py, plus the behaviour of the comparison itself: a match passes,
       a mismatch refuses, and AN ABSENT RECORD REFUSES rather than passing its own null case.

Every source assertion here strips comments first (this codebase's comments quote the code they
explain, so a naive grep matches the explanation), anchors on the executable line, and is proved by
a mutant that makes it fail for the intended reason. A source test that has never been seen to fail
is not a test.

Run: python3 scripts/test_launch_guards.py      [CANARY_LOOP_PATH=... to point at the host copy]
"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LOOP = os.environ.get('CANARY_LOOP_PATH', os.path.join(HERE, 'host', 'canary-loop.sh'))
GATEDIGEST = os.path.join(HERE, 'host', 'gatedigest.py')
LICENCECHECK = os.path.join(HERE, 'host', 'licencecheck.py')
fails = []


def ok(msg):
    print('  [PASS] ' + msg)


def bad(msg, key):
    print('  [FAIL] ' + msg)
    fails.append(key)


def executable_text(path):
    """The loop's code with comment lines removed -- see the module docstring."""
    return '\n'.join(l for l in open(path).read().splitlines() if not l.lstrip().startswith('#'))


# ------------------------------------------------------------------ 1. gatedigest behaviour
print('=' * 72)
print('v32 -- the comparison itself: does it discriminate, and does it refuse its null case?')
print('=' * 72)


# A STUB GATE, because the digest is now whatever `verdict.py --gate-digest` prints and this suite
# must be able to vary it. The stub reports a bundle over itself plus a sibling module, which is how
# the deathgate.py case below is expressed: that file is decision-bearing (the acceptance mutant
# runner mutates it to flip a verdict) and the first draft of v32 hashed verdict.py alone.
STUB = '''import hashlib, os, sys
def _b():
    parts = []
    for n in ('verdict.py', 'deathgate.py'):
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), n)
        parts.append((n, hashlib.md5(open(p, 'rb').read()).hexdigest() if os.path.exists(p) else 'UNRESOLVED'))
    parts.sort()
    return hashlib.md5(' '.join('%s=%s' % x for x in parts).encode()).hexdigest(), parts
if '--gate-digest' in sys.argv:
    d, p = _b()
    print(d)
    for n, h in p:
        print('  %-16s %s' % (n, h))
    sys.exit(0)
'''


def make_gate(dep=b'# dep\n'):
    """A throwaway gate directory. Returns (dir, verdict_path, live_bundle_digest)."""
    d = tempfile.mkdtemp(prefix='gatedigest-')
    v = os.path.join(d, 'verdict.py')
    open(v, 'w').write(STUB)
    open(os.path.join(d, 'deathgate.py'), 'wb').write(dep)
    got = subprocess.run([sys.executable, v, '--gate-digest'], capture_output=True, text=True,
                         timeout=60)
    return d, v, got.stdout.strip().splitlines()[0].strip()


def run_gd(rules_text=None, rules_missing=False, verdict_missing=False, dep=b'# dep\n',
           upper=False):
    d, v, live = make_gate(dep)
    if verdict_missing:
        os.unlink(v)
    r = os.path.join(d, 'RULES-IN-FORCE.md')
    if not rules_missing:
        open(r, 'w').write((rules_text if rules_text is not None else '')
                          .replace('@LIVE@', live.upper() if upper else live))
    p = subprocess.run([sys.executable, GATEDIGEST, '--verdict', v, '--rules', r],
                       capture_output=True, text=True, timeout=60)
    return p.returncode, (p.stdout + p.stderr).strip(), live

# POSITIVE CONTROL FIRST. Without a case that PASSES, every refusal below could be a checker that
# refuses unconditionally -- which is a detector that answers uniformly, and this project has shipped
# six of those.
rc, out, _ = run_gd('preamble\nGATE DIGEST verdict-bundle md5 @LIVE@\ntrailer\n')
(ok if rc == 0 else lambda m: bad(m + ' :: ' + out, 'gd-match'))(
    'POSITIVE CONTROL: the registered digest passes (exit %d)' % rc)

rc, out, _ = run_gd('GATE DIGEST verdict-bundle md5 @LIVE@\n', upper=True)
(ok if rc == 0 else lambda m: bad(m + ' :: ' + out, 'gd-case'))(
    'a digest recorded in UPPERCASE still matches (exit %d)' % rc)

rc, out, _ = run_gd('GATE DIGEST verdict-bundle md5 %s\n' % ('0' * 32))
(ok if rc == 2 and 'NOT THE REGISTERED GATE' in out else
 lambda m: bad(m + ' :: ' + out, 'gd-mismatch'))(
    'a MISMATCH refuses with exit 2 and names both digests')

# THE NULL CASE IS THE POINT. changerowcheck.py exits 0 when a registration declares nothing, and
# 9 of 18 registrations passed it that way. A provenance checker that waves through an absent record
# repeats that defect in the one place written to catch it.
rc, out, _ = run_gd('a rules file with no digest line at all\n')
(ok if rc == 2 and 'NO line of the form' in out else lambda m: bad(m + ' :: ' + out, 'gd-null'))(
    'NO digest line REFUSES -- the checker does not pass its own null case')

rc, out, _ = run_gd(rules_missing=True)
(ok if rc == 2 else lambda m: bad(m + ' :: ' + out, 'gd-norules'))(
    'a MISSING rules file refuses (exit %d)' % rc)

rc, out, _ = run_gd(verdict_missing=True, rules_text='GATE DIGEST verdict-bundle md5 @LIVE@\n')
(ok if rc == 2 else lambda m: bad(m + ' :: ' + out, 'gd-noverdict'))(
    'a MISSING gate file refuses rather than comparing nothing (exit %d)' % rc)

# TWO records is the two-copies-of-verdict.py failure in a new place: ~/verdict.py and
# scripts/verdict.py were found disagreeing about the death rule on 2026-09-18, and whichever a
# reader found first looked authoritative.
rc, out, _ = run_gd('GATE DIGEST verdict-bundle md5 @LIVE@\n'
                    'GATE DIGEST verdict-bundle md5 %s\n' % ('0' * 32))
(ok if rc == 2 and 'DIFFERENT gate bundle digests' in out else
 lambda m: bad(m + ' :: ' + out, 'gd-two'))('TWO different records refuse rather than picking one')

rc, out, _ = run_gd('GATE DIGEST verdict-bundle md5 @LIVE@\nGATE DIGEST verdict-bundle md5 @LIVE@\n')
(ok if rc == 0 else lambda m: bad(m + ' :: ' + out, 'gd-dup'))(
    'the SAME record twice is not a conflict (exit %d)' % rc)

# THE BUNDLE IS THE CORRECTION A REVIEW PASS FORCED. v32's first draft hashed verdict.py alone.
# `deathgate.py` carries the v21 lower-bound test and the acceptance mutant runner MUTATES THAT FILE
# to flip a case from KEEP to REVERT; `singledeath.py` carries v23's two-death floor. Either could be
# rewritten with verdict.py untouched. Two assertions, because "the digest moved" and "the guard
# refuses" are different claims.
_, _, live_a = make_gate(dep=b'# dep A\n')
_, _, live_b = make_gate(dep=b'# dep B -- the v21 bound rewritten\n')
(ok if live_a != live_b else lambda m: bad(m, 'gd-bundle-digest'))(
    'a change to a DECISION DEPENDENCY moves the bundle digest (%s -> %s)'
    % (live_a[:8], live_b[:8]))
rc, out, _ = run_gd('GATE DIGEST verdict-bundle md5 %s\n' % live_a, dep=b'# dep B -- the v21 bound rewritten\n')
(ok if rc == 2 and 'NOT THE REGISTERED GATE' in out else
 lambda m: bad(m + ' :: ' + out, 'gd-bundle'))(
    'a registered verdict.py with a REWRITTEN deathgate.py is REFUSED (exit %d)' % rc)
# ...and the parts must be NAMED, or the operator is told the bundle moved without being told which
# file moved -- a refusal whose remedy cannot be performed from where it is.
(ok if 'deathgate.py' in out else lambda m: bad(m + ' :: ' + out, 'gd-parts'))(
    'the refusal NAMES the per-file digests, not just the bundle')

# ------------------------------------------------------------------ 2. mutants on gatedigest
print()
print('=' * 72)
print('v32 mutants -- each assertion above must be shown to fail for the intended reason')
print('=' * 72)
SRC = open(GATEDIGEST).read()
MUTANTS = [
    # THIS MUTANT ASSERTS THE MESSAGE, NOT THE EXIT CODE, AND THAT IS A FINDING. Removing the
    # branch does NOT let a canary launch: `want = recorded[0]` then raises IndexError and the
    # loop still sees a non-zero exit, so the null case is defended twice. What the branch buys is
    # the DIAGNOSIS -- "record the digest" instead of a traceback. The first draft of this mutant
    # checked `exit == 0`, survived, and would have been scored as "the branch is decorative".
    ('the null-case DIAGNOSIS removed -- an absent record becomes an IndexError traceback',
     "    if not recorded:", "    if False:",
     lambda: 'NO line of the form' not in run_gd('a rules file with no digest line at all\n')[1],
     'changerowcheck.py exits 0 on its own null case and 9 of 18 registrations passed it that way. '
     'This branch is why the absent record refuses WITH A REMEDY the operator can perform, rather '
     'than with a stack trace -- and a refusal that names no remedy is the defect class CLAUDE.md '
     'opens with.'),
    ('the comparison removed -- any gate code passes',
     "    if live != want:", "    if False:",
     lambda: run_gd('GATE DIGEST verdict-bundle md5 %s\n' % ('0' * 32))[0] == 0,
     'v31 shipped live and unregistered for 20 h and the only tell was the md5. Without the '
     'comparison the guard is a file-existence check wearing a digest.'),
    ('the two-record refusal removed -- a reader may pick whichever digest it finds first',
     "    if len(set(recorded)) > 1:", "    if False:",
     lambda: run_gd('GATE DIGEST verdict-bundle md5 @LIVE@\n'
                    'GATE DIGEST verdict-bundle md5 %s\n' % ('0' * 32))[0] == 0,
     'Two copies of verdict.py disagreeing about the death rule cost a day on 2026-09-18. Two '
     'records of its digest is the same failure one level up.'),
]
killed = 0
for desc, old, new, mutant_passes, why in MUTANTS:
    # A MUTANT MUST ASSERT ITS ANCHOR IS PRESENT AND UNIQUE. One on this project used
    # replace(old, '', 1) on a string at several call sites and silently deleted a different
    # function's line, and read as "killed".
    n = SRC.count(old)
    if n != 1:
        print('  [ANCHOR] %r appears %d times, not once -- mutant NOT APPLIED: %s' % (old, n, desc))
        fails.append('anchor:' + desc)
        continue
    bak = GATEDIGEST + '.bak'
    os.rename(GATEDIGEST, bak)
    try:
        open(GATEDIGEST, 'w').write(SRC.replace(old, new, 1))
        if mutant_passes():
            print('  [KILLED] ' + desc)
            print('           ' + why)
            killed += 1
        else:
            print('  [SURVIVED] ' + desc + ' -- the case did not move, so it is not testing this')
            fails.append('survived:' + desc)
    finally:
        os.unlink(GATEDIGEST)
        os.rename(bak, GATEDIGEST)
print('  %d/%d mutants killed' % (killed, len(MUTANTS)))

# ------------------------------------------------------------------ 3. the wiring
print()
print('=' * 72)
print('THE WIRING -- a checker nobody calls is not a refusal (licencecheck.py, 2026-09-25/26)')
print('=' * 72)
if not os.path.exists(LOOP):
    print('  [SKIP] %s not in this worktree -- assert it on the host before deploying' % LOOP)
else:
    code = executable_text(LOOP)
    # POSITIVE CONTROL for the grep itself: the two checkers that WERE wired must be found by the
    # same method. When licencecheck.py was found unwired, this is what proved the search worked.
    for known in ('changerowcheck.py', 'v30check.py'):
        (ok if known in code else lambda m: bad(m, 'control:' + known))(
            'POSITIVE CONTROL: the grep finds %s, which was already wired' % known)
    for gen, checker, path in (('v31', 'licencecheck.py', LICENCECHECK),
                               ('v32', 'gatedigest.py', GATEDIGEST)):
        if checker not in code:
            bad('%s: the loop does not INVOKE %s -- the refusal in its docstring does not exist'
                % (gen, checker), 'wired:' + checker)
            continue
        # ...and the invocation must be able to STOP the launch. A call whose failure is ignored
        # reads as protection and is none.
        blk = [l for l in code.splitlines() if checker in l]
        if not any(l.lstrip().startswith('if ! ') for l in blk):
            bad('%s: %s is called but its exit status is not tested (`if ! ...`)' % (gen, checker),
                'status:' + checker)
        elif 'exit 2' not in code:
            bad('%s: the loop never exits 2 -- a refusal that returns to the draw is not a refusal'
                % gen, 'exit:' + checker)
        elif not os.path.exists(path):
            bad('%s: the loop calls %s but it is not in this worktree -- a dangling call'
                % (gen, checker), 'missing:' + checker)
        else:
            ok('%s: the loop invokes %s in executable text, tests its status, and exits 2'
               % (gen, checker))

# ------------------------------------------------------------------ 4. the poll arm reads the FIELD
# The death-poll arm matched `case "$V" in *REVERT*)` on the WHOLE verdict line and set FINAL=REVERT
# from the substring, while the scheduled-read arm below it has always taken `awk '{print $2}'`. Two
# rules about the same question, and the loose one ran on the poll. MEASURED 2026-09-26: 8 of 42
# why.append sites in verdict.py carry the literal "REVERT"; six are on the same statement as
# out('REVERT') and the other two print it while the verdict is INCONCLUSIVE, but both sit past the
# poll's out('POLL_OK') exit -- so the route was LATENT, not live. The v32 advisory IS reachable
# under --poll, which is what made a latent false-revert route worth closing.
print()
if os.path.exists(LOOP):
    code = executable_text(LOOP)
    poll = [l for l in code.splitlines() if 'poll-revert' in l]
    if not poll:
        bad('the loop has no death-poll revert arm -- this assertion is looking in the wrong place',
            'poll-arm-missing')
    elif '*REVERT*' in poll[0]:
        bad('the death-poll arm still matches *REVERT* on the WHOLE line: any advisory carrying that '
            'word is a false revert', 'poll-substring')
    elif "awk '{print $2}'" not in poll[0]:
        bad('the death-poll arm neither matches the line nor extracts the field -- unclear',
            'poll-unclear')
    else:
        ok('the death-poll arm reads the VERDICT FIELD, not a substring of the line')
        # POSITIVE CONTROL that the search is looking at real text: the scheduled-read arm, which
        # always did this correctly, must be found by the same method.
        sched = [l for l in code.splitlines() if 'UNREADABLE' in l and 'awk' in l]
        (ok if sched else lambda m: bad(m, 'poll-control'))(
            'POSITIVE CONTROL: the scheduled-read arm, which was always correct, is found the same way')

# END TO END for v31: the wired checker must actually refuse a registration that names nothing.
# licencecheck.py reads the fleet's own logs to verify a licence, so only the NULL case is testable
# off the host -- and the null case is the one that mattered: 9 of 18 registrations named nothing.
print()
if os.path.exists(LICENCECHECK):
    d = tempfile.mkdtemp(prefix='licence-')
    regs = os.path.join(d, 'regs'); os.makedirs(regs)
    json.dump({'sha': 'abc1234', 'read_minutes': [30], 'reads': ['immobiledid']},
              open(os.path.join(regs, 'nolicence-01.json'), 'w'))
    p = subprocess.run([sys.executable, LICENCECHECK, 'nolicence-01', '--hours', '6',
                        '--registrations', regs], capture_output=True, text=True, timeout=120,
                       env=dict(os.environ, LICENCE_LOG_ROOT=os.path.join(d, 'no-logs')))
    out = (p.stdout + p.stderr)
    (ok if p.returncode == 2 and 'REFUSED' in out else
     lambda m: bad(m + ' :: rc=%d %s' % (p.returncode, out.strip()[:300]), 'licence-null'))(
        'END TO END: a registration naming NO licence is refused (exit %d)' % p.returncode)

print()
print('=' * 72)
if fails:
    print('FAILURES: ' + ', '.join(fails))
    sys.exit(1)
print('all v31/v32 launch-guard cases and mutants pass')
