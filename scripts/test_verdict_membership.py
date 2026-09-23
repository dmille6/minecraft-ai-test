#!/usr/bin/env python3
"""verdict.py's death scan must find the canary's bots -- including a within-world one.

THE DEFECT. The scan globbed by POOL PREFIX: `{LOGROOT}/{pool}-*/skill-*.jsonl` for each entry of
`canary_pool`. A within-world canary declares the sentinel `split:<run_id>`, and no bot directory
begins with that. VERIFIED on the fleet:

    canary_pool='hive-a'           ->  6 log files matched
    canary_pool='split:wwtest-01'  ->  0 log files matched

Zero files means zero rows means ndeaths=0, so the owner's TWO-DEATH GATE WOULD HAVE REPORTED A
CLEAN CANARY however many bots died. The control scan was the mirror image: its complement
`[p for p in allp if p not in pools]` excluded nothing, so treated bots counted as their own
control.

Membership is now resolved per BOT through canary_manifest.members_of, which returns a Roster for a
split declaration and the legacy pool string otherwise; in_canary_pool accepts both. The two cases
become one code path, and the legacy case must select EXACTLY what the prefix glob selected -- that
equivalence is the load-bearing assertion here.

Run: python3 scripts/test_verdict_membership.py
"""
import glob
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from canary_manifest import members_of          # noqa: E402
from version_split import in_canary_pool        # noqa: E402

WORLDS = [f'{p}-{s}' for p in ('board', 'hive', 'isolated', 'placebo') for s in 'abcd']
BOTS = [f'{w}-{n}' for w in WORLDS for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]

ok = []
def check(name, got, want, why=''):
    good = got == want
    ok.append(good)
    print(f"  [{'PASS' if good else 'FAIL'}] {name}" + ('' if good else f'  got {got!r} want {want!r}'))
    if not good and why:
        print(f'         {why}')


# A fixture fleet on disk, so the OLD prefix glob can be run for real rather than imitated.
ROOT = tempfile.mkdtemp(prefix='membership-')
for b in BOTS:
    os.makedirs(os.path.join(ROOT, b), exist_ok=True)
    open(os.path.join(ROOT, b, f'skill-{b}.jsonl'), 'w').close()
print(f'fixture: {len(BOTS)} bots across {len(WORLDS)} worlds in {ROOT}')

def old_glob(pool_field):
    """Exactly what verdict.py used to do."""
    pools = [p.strip() for p in str(pool_field).split(',')]
    return sorted({os.path.basename(os.path.dirname(f))
                   for p in pools for f in glob.glob(f'{ROOT}/{p}-*/skill-*.jsonl')})

def new_resolve(man):
    """Exactly what verdict.py does now."""
    m = members_of(man)
    return sorted(b for b in BOTS if in_canary_pool(b, m))


print('\n1. LEGACY: the new per-bot resolution selects EXACTLY the old prefix glob')
for spec in ('hive-a', 'hive-a,board-c', 'placebo-d,hive-c,board-b,board-c', 'isolated-a'):
    man = {'canary_pool': spec, 'canary_code_version': 'deadbee'}
    check(f'{spec:34s} identical', new_resolve(man), old_glob(spec))
check('and that is not vacuous -- it selected bots',
      len(new_resolve({'canary_pool': 'hive-a,board-c', 'canary_code_version': 'deadbee'})), 10)

print('\n2. THE BLINDNESS: the old glob finds NOTHING for a split sentinel')
check('a split sentinel matched zero directories', old_glob('split:wwtest-01'), [],
      'zero rows -> ndeaths 0 -> the death gate reports a clean canary whatever happened')

print('\n3. SPLIT: the roster is selected and its world-mates stay in control')
roster = ['hive-a-Alpha', 'hive-a-Bravo', 'board-c-Alpha', 'board-c-Bravo']
split = {'canary_pool': 'split:wwtest-01', 'canary_split': 'within-world',
         'canary_roster': roster, 'canary_code_version': 'deadbee'}
sel = new_resolve(split)
check('exactly the four declared bots', sel, sorted(roster))
ctrl = [b for b in BOTS if b not in set(sel)]
check('hive-a world-mates are CONTROL, which is the design',
      sorted(b for b in ctrl if b.startswith('hive-a-')),
      ['hive-a-Comet', 'hive-a-Delta', 'hive-a-Echo'])
check('control is everyone else', len(ctrl), len(BOTS) - 4)
check('and no treated bot is in control', [b for b in sel if b in ctrl], [])

print('\n4. a split declaration with no roster must RAISE, not degrade')
try:
    new_resolve({'canary_pool': 'split:wwtest-01', 'canary_split': 'within-world',
                 'canary_code_version': 'deadbee'})
    check('missing roster raises', 'returned', 'raised',
          'a guard must go blind loudly, never confidently')
except Exception as e:
    check('missing roster raises', type(e).__name__ != '', True)
    print(f'         {type(e).__name__}: {str(e)[:110]}')

print('\n5. verdict.py really does resolve per bot (not by pool prefix any more)')
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'verdict.py')).read()
stripped = '\n'.join(l for l in src.split('\n') if not l.strip().startswith('#'))
check('it imports members_of', 'from canary_manifest import members_of' in stripped, True)
check('the death scan uses the resolved bot list', '_scan(CANARY_BOTS)' in stripped, True)
check('no pool-prefix glob remains in the scan',
      "glob.glob(f'{LOGROOT}/{pool}-*/skill-*.jsonl')" in stripped, False)

import shutil; shutil.rmtree(ROOT, ignore_errors=True)
print(f'\n{sum(ok)}/{len(ok)} membership cases pass')
sys.exit(0 if all(ok) else 1)
