#!/usr/bin/env python3
"""v30 behaviour tests: a registration whose last read minute is not strictly inside its
deadline cannot be read, and `schedule_violation` must say so.

WHY THIS IS A BEHAVIOUR TEST AND NOT A GREP. The defect it guards was invisible to every
source assertion available: `canary-loop.sh` reads `deadline_min` correctly, `verdict.py`
reads `read_minutes` correctly, and the collision only exists in the RELATION between two
values that live in a JSON file neither of them validates. Five grep assertions passed for
the wrong reason in one day in this project; a decision belongs in a pure function.

Run: python3 scripts/test_schedule_invariant.py     (safe anywhere -- no fleet, no walk)
The mutant section rewrites a COPY in a temp dir. It never writes into scripts/.
"""
import json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
VERDICT = os.path.join(HERE, 'verdict.py')

# ---------------------------------------------------------------- load the function under test
# verdict.py runs top-level work on import (it is a script), so lift the function out by
# exec'ing just its source. That keeps this test pointed at the REAL text of the shipped file
# -- `scripts/verdict.py` and `~/verdict.py` were found disagreeing on 2026-09-18, and a test
# that reimplements the rule tests the reimplementation.
def load_schedule_violation(src_text):
    m = re.search(r"^READ_GRACE_MIN = .*?^    return None\n", src_text, re.S | re.M)
    assert m, "ANCHOR MISSING: could not find READ_GRACE_MIN..schedule_violation block"
    ns = {'os': os}
    exec(m.group(0), ns)
    assert 'schedule_violation' in ns, "block did not define schedule_violation"
    return ns['schedule_violation'], m.group(0)

SRC = open(VERDICT).read()
schedule_violation, BLOCK = load_schedule_violation(SRC)

fails = []
def case(name, reg, want, grace=30):
    got = schedule_violation(reg, grace=grace)
    ok = (got is None) if want is None else (got is not None and want in got)
    print(("  [PASS] " if ok else "  [FAIL] ") + name)
    if not ok:
        print("         want %r, got %r" % (want, got))
        fails.append(name)

print("=" * 72)
print("v30 -- the read schedule must fit inside the deadline")
print("=" * 72)

# THE INCIDENT, verbatim. drop5-01 as actually registered on 2026-09-25.
case("drop5-01 as registered (360/360) is UNREADABLE",
     {'read_minutes': [30, 90, 180, 360], 'deadline_min': 360}, 'SCHEDULE UNREADABLE')

# The two other registrations carrying the pattern, both from the last two days.
case("blindstep-01 (360/360) is UNREADABLE",
     {'read_minutes': [30, 90, 180, 360], 'deadline_min': 360}, 'SCHEDULE UNREADABLE')
case("blindstep-02 (360/360) is UNREADABLE",
     {'read_minutes': [30, 90, 180, 360], 'deadline_min': 360}, 'SCHEDULE UNREADABLE')

# The 15 registrations that were always fine must stay fine -- a guard that fails these
# would refuse every canary this project has ever run, which reads as "strict" and is broken.
case("shoreline-01 (360/780) passes",
     {'read_minutes': [30, 90, 180, 360], 'deadline_min': 780}, None)
case("digwatch-02 (360/420) passes",
     {'read_minutes': [30, 90, 180, 360], 'deadline_min': 420}, None)
case("banktruth-01 (360/600) passes",
     {'read_minutes': [30, 90, 180, 360], 'deadline_min': 600}, None)
case("needsdrop-01 (540/660) passes",
     {'read_minutes': [30, 90, 180, 540], 'deadline_min': 660}, None)

# The boundary, stated both ways so neither side can drift.
case("deadline exactly last+grace passes (390/360)",
     {'read_minutes': [360], 'deadline_min': 390}, None)
case("one minute inside the grace is TIGHT (389/360)",
     {'read_minutes': [360], 'deadline_min': 389}, 'SCHEDULE TIGHT')
case("deadline one minute past the last read is still TIGHT, not OK (361/360)",
     {'read_minutes': [360], 'deadline_min': 361}, 'SCHEDULE TIGHT')
case("deadline BEFORE the last read is UNREADABLE (300/360)",
     {'read_minutes': [30, 360], 'deadline_min': 300}, 'SCHEDULE UNREADABLE')

# Unordered read_minutes must not fool it: the loop sorts, so max() is the contract.
case("unsorted read_minutes still caught (360 last, deadline 360)",
     {'read_minutes': [360, 30, 180], 'deadline_min': 360}, 'SCHEDULE UNREADABLE')

# Absent fields are NOT a violation: verdict.py defaults DEADLINE to 780 when unset, and a
# registration with no reads is caught by the immobiledid rule, not this one. Reporting a
# violation here would fire on every replay fixture and train the reader to ignore it.
case("no deadline_min declared -> not this guard's business",
     {'read_minutes': [30, 360]}, None)
case("no read_minutes declared -> not this guard's business",
     {'deadline_min': 360}, None)
case("empty read_minutes -> not this guard's business",
     {'read_minutes': [], 'deadline_min': 360}, None)

# String-typed JSON values happen in hand-staged registrations under /tmp.
case("string-typed minutes are coerced, not crashed",
     {'read_minutes': ['30', '360'], 'deadline_min': '360'}, 'SCHEDULE UNREADABLE')

# ---------------------------------------------------------------- mutants
# A mutant that silently fails to apply reads as "killed". Every anchor below is asserted
# PRESENT and UNIQUE before the replacement, per CLAUDE.md.
print()
print("=" * 72)
print("mutants -- each must be killed, and each anchor must be present exactly once")
print("=" * 72)

MUTANTS = [
    ("guard removed entirely (returns None always)",
     "    if dl <= last:", "    if False:"),
    ("`<=` weakened to `<` -- the exact off-by-one that let drop5-01 through",
     "    if dl <= last:", "    if dl < last:"),
    ("grace check deleted, so a 1-minute margin passes",
     "    if dl < last + grace:", "    if False:"),
    ("grace zeroed out",
     "READ_GRACE_MIN = int(os.environ.get('VERDICT_READ_GRACE_MIN', '30'))",
     "READ_GRACE_MIN = int(os.environ.get('VERDICT_READ_GRACE_MIN', '0'))"),
    ("max() swapped for min(), so only the FIRST read is checked",
     "    dl, last = int(dl), max(rm)", "    dl, last = int(dl), min(rm)"),
]

def run_mutant(desc, old, new):
    n = BLOCK.count(old)
    if n != 1:
        print("  [FAIL] %s -- ANCHOR %s (%d occurrences, need exactly 1)"
              % (desc, "MISSING" if n == 0 else "NOT UNIQUE", n))
        fails.append("mutant anchor: " + desc)
        return
    mutated = BLOCK.replace(old, new, 1)
    assert mutated != BLOCK, "replacement produced identical text"
    ns = {'os': os}
    try:
        exec(mutated, ns)
        fn = ns['schedule_violation']
    except Exception as e:
        print("  [PASS] %s -- killed (mutant does not even load: %s)" % (desc, e))
        return
    # THE PROBE MUST DISCRIMINATE THE MESSAGE, NOT MERELY "DID IT FLAG".
    # Found while writing this test, 2026-09-25: three mutants survived a weaker probe because
    # `dl <= last` implies `dl < last + grace`, so deleting the UNREADABLE branch leaves the
    # TIGHT branch still flagging drop5-01 -- protective, but no longer able to say the final
    # read is IMPOSSIBLE rather than merely at risk. That distinction is the branch's whole job,
    # so a probe that accepts either message cannot see the branch disappear.
    # One probe deliberately omits `grace=` so that mutating the DEFAULT constant is reachable;
    # every probe passing grace explicitly would make READ_GRACE_MIN untestable by construction.
    survived = True
    probes = [
        ({'read_minutes': [30, 90, 180, 360], 'deadline_min': 360}, 'SCHEDULE UNREADABLE', 30),
        ({'read_minutes': [30, 360], 'deadline_min': 300}, 'SCHEDULE UNREADABLE', 30),
        ({'read_minutes': [360], 'deadline_min': 361}, 'SCHEDULE TIGHT', 30),
        ({'read_minutes': [360], 'deadline_min': 380}, 'SCHEDULE TIGHT', None),  # default grace
        ({'read_minutes': [30, 90, 180, 360], 'deadline_min': 780}, None, 30),   # shoreline-01
        ({'read_minutes': [30, 90, 180, 360], 'deadline_min': 420}, None, 30),   # digwatch-02
    ]
    for reg, want, grace in probes:
        try:
            got = fn(reg) if grace is None else fn(reg, grace=grace)
        except Exception:
            survived = False
            break
        ok = (got is None) if want is None else (got is not None and want in got)
        if not ok:
            survived = False
            break
    if survived:
        print("  [FAIL] %s -- SURVIVED" % desc)
        fails.append("mutant survived: " + desc)
    else:
        print("  [PASS] %s -- killed" % desc)

for desc, old, new in MUTANTS:
    run_mutant(desc, old, new)

# ---------------------------------------------------------------- the loop's own refusal
# verdict.py can only ANNOTATE; canary-loop.sh is what prevents the loss. Assert the refusal
# is wired into the executable path and not merely present as a constant or a comment.
print()
print("=" * 72)
print("canary-loop.sh must refuse to launch (the only place the loss is preventable)")
print("=" * 72)
LOOP = os.environ.get('CANARY_LOOP_PATH', os.path.join(HERE, 'host', 'canary-loop.sh'))
if not os.path.exists(LOOP):
    print("  [SKIP] %s not in this worktree -- assert it on the host before deploying" % LOOP)
else:
    text = open(LOOP).read()
    # strip comments first: this codebase's comments quote the code they explain, so a naive
    # grep matches the explanation rather than the executable line. The refusal MESSAGE lives
    # in v30check.py, not in the loop, so asserting the message here would look for it in the
    # wrong file -- which this assertion did on its first run, and said so.
    code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith('#'))
    checker = os.environ.get('V30CHECK_PATH', os.path.expanduser('~/v30check.py'))
    if 'v30check.py' not in code or 'exit 1' not in code:
        print("  [FAIL] loop does not INVOKE the v30 checker and exit non-zero "
              "-- verdict.py alone is too late by construction")
        fails.append("canary-loop.sh does not invoke v30check.py")
    elif not os.path.exists(checker):
        print("  [FAIL] loop calls %s but it does not exist -- the refusal is a dangling call"
              % checker)
        fails.append("v30check.py missing")
    elif 'REFUSING TO LAUNCH (v30)' not in open(checker).read():
        print("  [FAIL] %s carries no refusal message -- it would exit 0 and wave the canary through"
              % checker)
        fails.append("v30check.py has no refusal")
    else:
        print("  [PASS] loop invokes %s in executable text and exits 1 on refusal" % checker)
        # END TO END: the checker must actually refuse the incident and pass the historical
        # registrations. A wired call that always exits 0 reads as protection and is none.
        import subprocess, json as _json, tempfile as _tf
        def probe(rm, dl):
            with _tf.NamedTemporaryFile('w', suffix='.json', delete=False) as fh:
                _json.dump({'read_minutes': rm, 'deadline_min': dl}, fh)
                p = fh.name
            try:
                return subprocess.run([sys.executable, checker, p, str(dl)],
                                      capture_output=True).returncode
            finally:
                os.unlink(p)
        if probe([30, 90, 180, 360], 360) == 0:
            print("  [FAIL] checker ACCEPTS the drop5-01 schedule it exists to refuse")
            fails.append("v30check.py accepts drop5-01")
        elif probe([30, 90, 180, 360], 780) != 0:
            print("  [FAIL] checker REFUSES shoreline-01, which was always legal")
            fails.append("v30check.py refuses a legal schedule")
        else:
            print("  [PASS] checker refuses drop5-01 (360/360) and accepts shoreline-01 (360/780)")

print()
print("=" * 72)
if fails:
    print("FAILURES (%d): %s" % (len(fails), "; ".join(fails)))
    sys.exit(1)
print("all v30 schedule-invariant cases and mutants pass")
