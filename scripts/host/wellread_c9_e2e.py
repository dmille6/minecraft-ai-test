#!/usr/bin/env python3
"""wellread C9 END TO END (junkwell-02, Codex r1 P2: "feed an actual orphan-pit row through parsing, emission and verdict").

    python3 scripts/host/wellread_c9_e2e.py [docs/reports/junkwell-02.<base>.json ...]

A. ROWS -> FIELD. The read's own code (scripts/host/wellread.py, everything before the walk, with the manifest stubbed)
   is executed, and the bot's row strings -- as bots/src/skills.mjs writes them -- go through the SAME pit_event /
   pit_left_open the walk uses: a pit dug and never closed gives breach_pit_left_open 1; one covered gives 0.
B. FIELD -> VERDICT. scripts/verdict.py (the file the canary loop runs) is driven through the acceptance suite's Case
   fixture with each registration's OWN own_lines, licence and exposure: every line at a passing value reaches KEEP
   (the positive control: the fixture can reach a verdict), and the same evidence with breach_pit_left_open = 1 REVERTS.
C. READ MUTANTS. Each anchor is asserted present exactly once; every mutant must be killed by the read's self-tests.
Exit 0 only if all of it holds.

RUN IT ON THE FLEET HOST against the verdict the canary loop runs:
    ACCEPTANCE_VERDICT_PY=/home/mike/verdict.py python3 scripts/host/wellread_c9_e2e.py
(the repo's scripts/lib/version_split.py lacks the host lib's in_canary_pool, so B cannot run off the host).
10-08 01:5xZ on 10.0.0.31: ALL HOLD -- A1-A4, B both registrations clean KEEP / one pit REVERT, C 5 of 5 killed.
"""
import datetime as dt, glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
READ = os.path.join(HERE, 'wellread.py')
FAILS = []


def check(name, ok, detail=''):
    print('%s  %s%s' % ('PASS' if ok else 'FAIL', name, ('  -- ' + detail) if detail and not ok else ''))
    if not ok:
        FAILS.append(name)


def read_head(src):
    os.environ['CANARY_DRYRUN'] = 'hive-a:abc1234:2026-10-08T00:00:00Z'
    src = src.replace("man = json.load(open('/srv/mcbots/trial-manifest.json'))", 'man = {}')
    g = {'__name__': 'wellread_head'}
    exec(compile(src[:src.index('ev_rows = sorted(load_window(PRE, END)')], READ, 'exec'), g)
    return g


BASE = open(READ).read()
assert BASE.count("man = json.load(open('/srv/mcbots/trial-manifest.json'))") == 1, 'ANCHOR: the manifest load'
g = read_head(BASE)

# ---- A. rows -> field ------------------------------------------------------------------------------------------------
T0 = dt.datetime(2026, 10, 8, 1, 0, tzinfo=dt.timezone.utc)
m = lambda n: T0 + dt.timedelta(minutes=n)
ROWS_KILLED = [('_well_pit_dug', 'at=1308,119,1314 from=fresh stage=dug', m(0))]                       # a build killed after its dig
ROWS_ABORT = ROWS_KILLED + [('_well_pit_open', 'at=1308,119,1314 stage=dug why=aborted', m(1))]       # aborted, nobody covered it
ROWS_COVERED = ROWS_ABORT + [('_well_pit_covered', 'at=1308,119,1314 stage=dug by=visitor item=dirt', m(2))]
ROWS_BUILT = ROWS_KILLED + [('_well_built', 'at=1308,119,1314 facing=north floor=1 wood=oak pit_first=1 pit_tossed=2 pit_items=32 free=3', m(3))]


def field_of(rows, pool='hive-a', end=m(60)):
    opens, closes = [], []
    for k, d, t in rows:
        ev = g['pit_event'](k, g['kv'](d), 'hive-a-3', t, pool, 'canary')
        (opens if ev[0] == 'open' else closes).append(ev[1])
    return len(g['pit_left_open'](opens, closes, end)[0])


check('A1 a pit dug and never closed (a killed build) -> breach_pit_left_open >= 1', field_of(ROWS_KILLED) >= 1)
check('A2 aborted and left -> breach', field_of(ROWS_ABORT) >= 1)
check('A3 covered by a visitor 2 min later -> 0', field_of(ROWS_COVERED) == 0)
check('A4 built 3 min after the dig -> 0', field_of(ROWS_BUILT) == 0)

# ---- B. field -> verdict ---------------------------------------------------------------------------------------------
import test_verdict_acceptance as A
import tempfile
regs = sys.argv[1:] or sorted(glob.glob(os.path.join(ROOT, 'docs/reports/junkwell-02.*.json')))
check('B0 registrations found', bool(regs), 'no docs/reports/junkwell-02.*.json')
tmp = tempfile.mkdtemp(prefix='wellread-c9-e2e-')
for path in regs:
    reg = json.load(open(path))
    name = os.path.basename(path)
    lines = [ln for ln in reg.get('own_lines', []) if ln.get('read') == 'wellread']
    c9 = [ln for ln in lines if ln.get('field') == 'breach_pit_left_open']
    check('B1 %s registers C9 as a REVERT own_line' % name, len(c9) == 1 and c9[0].get('on_fail') == 'REVERT', json.dumps(c9))
    if len(c9) != 1:
        continue

    def passing(ln):
        return ln['value']                       # every registered op here is <= / >= against its value: the bound passes
    fields = {ln['field']: passing(ln) for ln in lines}
    exp = reg.get('exposure') or {}
    if exp.get('read') == 'wellread':
        fields[exp['field']] = exp.get('min', 1)
    reads = ['immobiledid'] + [r for r in reg.get('reads', []) if r == 'wellread']
    extra = {'reads': reads, 'own_lines': lines, 'licence': reg.get('licence'), 'exposure': exp or None}
    for label, val, want in (('clean', 0, 'KEEP'), ('a pit left open', field_of(ROWS_KILLED), 'REVERT')):
        c = A.Case(tmp, reg_extra=extra)
        c.evidence('immobiledid', A.immobiledid())
        c.evidence('wellread', dict(fields, breach_pit_left_open=val))
        got, out = c.run()
        check('B2 %s: %s (breach_pit_left_open=%s) -> %s' % (name, label, val, want), got == want, '%s: %s' % (got, out[-300:]))

# ---- C. read mutants -------------------------------------------------------------------------------------------------
MUTS = [
    ('a dug pit is not an open', "    if k in ('_well_pit_dug', '_well_pit_open'):", "    if k in ('_well_pit_open',):"),
    ('no 10-minute limit', '<= PIT_CLOSE_S for p, a, tc, *_ in closes_', '<= 99999 for p, a, tc, *_ in closes_'),
    ('any pool closes a site', '        if any(p == pool and a == at and 0 <= ', '        if any(a == at and 0 <= '),
    ('a cover is not a close', "    if k == '_well_pit_covered':\n        return 'close'", "    if k == '_well_pit_coveredX':\n        return 'close'"),
    ('the control arm is judged', "        if arm != 'canary':\n            continue", '        if False:\n            continue'),
]
for name, old, new in MUTS:
    n = BASE.count(old)
    check('C0 anchor present once: %s' % name, n == 1, 'found %d' % n)
    if n != 1:
        continue
    try:
        read_head(BASE.replace(old, new))
        check('C1 mutant killed: %s' % name, False, 'the self-tests passed')
    except AssertionError:
        check('C1 mutant killed: %s' % name, True)

print('\n%s (%d failure(s))' % ('ALL HOLD' if not FAILS else 'FAILED', len(FAILS)))
sys.exit(1 if FAILS else 0)
