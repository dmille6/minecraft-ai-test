#!/usr/bin/env python3
"""test_holdtoken.py -- behaviour of scripts/host/holdtoken.py against canary-sched.py's own paths() in a fixture
SCHED_HOME, plus mutants (anchors asserted present and unique; an unmutated copy is the control)."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HT = next(p for p in (os.path.join(HERE, 'host', 'holdtoken.py'), os.path.join(HERE, 'holdtoken.py')) if os.path.exists(p))
SCHED = next((p for p in (os.path.join(HERE, 'host', 'canary-sched.py'), os.path.join(HERE, 'canary-sched.py'),
                          '/home/mike/canary-sched.py') if os.path.exists(p)), None)
T = []


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, ('\n        -> ' + str(d)[:300]) if not ok and d else ''))


def cases(ht):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    home = tempfile.mkdtemp(prefix='holdtok-')
    env = dict(os.environ, SCHED_HOME=home, HOLDTOKEN_SCHED=SCHED)
    hold = os.path.join(home, 'digest', 'INSTALL-HOLD')
    run = lambda *a: subprocess.run([sys.executable, ht] + list(a), env=env, capture_output=True, text=True)
    own = lambda: run('owner').stdout.strip()
    r = run('owner'); c('no hold: owner is empty', r.returncode == 0 and r.stdout.strip() == '', r.stdout + r.stderr)
    r = run('claim', 'A:1', '45'); c('claim with no hold -> rc 0, owner A:1', r.returncode == 0 and own() == 'A:1', r.stdout + r.stderr)
    r = run('claim', 'B:2', '45'); c('a second claim is REFUSED (rc 3) and A:1 still owns it', r.returncode == 3 and own() == 'A:1', r.stdout)
    r = run('release', 'B:2'); c('release by a non-owner leaves the hold', r.returncode == 0 and os.path.exists(hold) and own() == 'A:1', r.stdout)
    r = run('release', 'A:1'); c('release by the owner removes it', r.returncode == 0 and not os.path.exists(hold), r.stdout)
    r = run('release', 'A:1'); c('release with no hold -> rc 0, nothing created', r.returncode == 0 and not os.path.exists(hold), r.stdout)
    os.makedirs(os.path.dirname(hold), exist_ok=True); open(hold, 'w').write('{not json')
    r = run('claim', 'C:3', '45'); c('an UNREADABLE hold is a hold: claim refused, file untouched',
                                     r.returncode == 3 and open(hold).read() == '{not json', r.stdout)
    r = run('release', 'C:3'); c('an unreadable hold is not released by a token', os.path.exists(hold), r.stdout)
    shutil.rmtree(home, ignore_errors=True)
    return out


MUTANTS = [
    ('claim overwrites an existing hold', "        if cur is not None:\n            print('REFUSED", "        if False:\n            print('REFUSED"),
    ('release ignores the owner', "        if cur != token:\n", "        if False:\n"),
]

if __name__ == '__main__':
    if not SCHED:
        print('SKIPPED: canary-sched.py not found'); sys.exit(1)
    for n, ok, d in cases(HT):
        t(n, ok, d)
    src = open(HT).read()
    tmp = tempfile.mkdtemp(prefix='holdtok-m-')
    ctl = os.path.join(tmp, 'ctl.py'); shutil.copy(HT, ctl)
    cres = cases(ctl)
    t('mutant runner control: the unmutated copy passes (%d)' % len(cres), cres and all(ok for _n, ok, _d in cres))
    for name, old, new in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR %s (%d)' % (name, src.count(old))
        mp = os.path.join(tmp, 'm.py'); open(mp, 'w').write(src.replace(old, new, 1))
        t('mutant killed: ' + name, not all(ok for _n, ok, _d in cases(mp)), 'SURVIVED')
    shutil.rmtree(tmp, ignore_errors=True)
    print('\n%d/%d pass' % (sum(T), len(T)))
    sys.exit(0 if all(T) else 1)
