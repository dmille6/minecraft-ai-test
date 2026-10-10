#!/usr/bin/env python3
"""test_holdtoken.py -- behaviour of scripts/host/holdtoken.py against canary-sched.py's own paths() in a fixture
SCHED_HOME, plus mutants (anchors asserted present and unique; an unmutated copy is the control).
The slot check is stubbed (free / busy / raising) through claim()'s slot_check argument; the CLI's default wiring to the
scheduler's gather/ancestors/slot_blockers is asserted structurally (comments stripped)."""
import importlib.util, os, shutil, subprocess, sys, tempfile, threading, time, json

HERE = os.path.dirname(os.path.abspath(__file__))
HT = next(p for p in (os.path.join(HERE, 'host', 'holdtoken.py'), os.path.join(HERE, 'holdtoken.py')) if os.path.exists(p))
SCHED = next((p for p in (os.path.join(HERE, 'host', 'canary-sched.py'), os.path.join(HERE, 'canary-sched.py'),
                          '/home/mike/canary-sched.py') if os.path.exists(p)), None)
T = []


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, ('\n        -> ' + str(d)[:300]) if not ok and d else ''))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


def cases(ht):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    home = tempfile.mkdtemp(prefix='holdtok-')
    os.environ['SCHED_HOME'] = home; os.environ['HOLDTOKEN_SCHED'] = SCHED
    H = load(ht, 'ht_%d' % abs(hash(ht + home)))
    P = load(SCHED, 'cs_%d' % abs(hash(home))).paths()
    hold = P['install_hold']
    free = lambda P: []
    busy = lambda P: [('S2', 'a canary loop is running (stub)')]

    def boom(P):
        raise RuntimeError('stub')
    own = lambda: H.owner_of(hold)
    c('the hold path is canary-sched.paths()["install_hold"] under SCHED_HOME', hold.startswith(home), hold)
    c('no hold: owner is None', own() is None)
    c('claim with no hold, slot free -> rc 0, owner A:1', H.claim(P, 'A:1', 45, free) == 0 and own() == 'A:1')
    c('a second claim is REFUSED (rc 3) and A:1 still owns it', H.claim(P, 'B:2', 45, free) == 3 and own() == 'A:1')
    c('release by a non-owner leaves the hold', H.release(P, 'B:2') == 0 and own() == 'A:1')
    c('release by the owner removes it', H.release(P, 'A:1') == 0 and not os.path.exists(hold))
    c('release with no hold -> rc 0, nothing created', H.release(P, 'A:1') == 0 and not os.path.exists(hold))
    c('claim on a BUSY slot -> rc 2 and our own hold withdrawn (no hold left)', H.claim(P, 'C:3', 45, busy) == 2 and not os.path.exists(hold))
    c('claim whose slot check RAISES -> rc 2 (fail closed), hold withdrawn', H.claim(P, 'C:3', 45, boom) == 2 and not os.path.exists(hold))
    os.makedirs(os.path.dirname(hold), exist_ok=True); open(hold, 'w').write('{not json')
    c('an UNREADABLE hold is a hold: claim refused, file untouched', H.claim(P, 'D:4', 45, free) == 3 and open(hold).read() == '{not json')
    H.release(P, 'D:4')
    c('an unreadable hold is not released by a token', os.path.exists(hold))
    if os.path.exists(hold):
        os.remove(hold)
    # ATOMICITY (round 3, Codex P1): another operation's hold attempt DURING our slot check must wait for the tick lock,
    # then find our hold -- it can never interleave between our write and our check.
    seen = {}

    def slow(P):
        seen['inside'] = own()
        th = threading.Thread(target=lambda: seen.__setitem__('other', H.claim(P, 'E:5', 45, free)))
        th.start(); time.sleep(0.5)
        seen['other_done_during_check'] = not th.is_alive()
        seen['th'] = th
        return []
    r = H.claim(P, 'F:6', 45, slow)
    seen['th'].join(10)
    c('atomic: a competing claim during our slot check blocks on the tick lock, then is REFUSED; we keep the hold',
      r == 0 and seen.get('inside') == 'F:6' and seen.get('other_done_during_check') is False and seen.get('other') == 3
      and own() == 'F:6', seen)
    H.release(P, 'F:6')
    shutil.rmtree(home, ignore_errors=True)
    return out


def strip(src):
    return '\n'.join(l for l in src.splitlines() if not l.lstrip().startswith('#'))


def structural(ht, inst):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    s = strip(open(ht).read())
    c('holdtoken CLI claim wires the scheduler\'s own slot check', "claim(P, a[1], int(a[2]), sched_slot_check(m))" in s
      and 'm.gather(P, full=False)' in s and 'm.slot_blockers(st)' in s and 'm.ancestors(P, os.getpid())' in s)
    if inst:
        i = strip(open(inst).read())
        c('the installer never calls canary-sched install-hold or install-release',
          'canary-sched.py install-hold' not in i and 'install-release' not in i, None)
        k = i.find('holdtoken.py claim'); tr = i.find("trap 'python3 $S/holdtoken.py release")
        c('the installer arms the release trap only AFTER a successful claim (claim || die, then trap)',
          0 < k < tr and '|| die "install-hold not claimed' in i[k:tr])
    return out


MUTANTS = [
    ('claim overwrites an existing hold', "        if cur is not None:\n            print('REFUSED", "        if False:\n            print('REFUSED"),
    ('release ignores the owner', "        if cur != token:\n", "        if False:\n"),
    ('busy slot keeps the hold', "            os.remove(P['install_hold'])           # ours", "            pass           # ours"),
    ('busy slot ignored', "        if live:\n", "        if False:\n"),
    ('slot check outside the lock', "    return _locked(P, go)\n\n\ndef release", "    return go()\n\n\ndef release"),
]

if __name__ == '__main__':
    if not SCHED:
        print('SKIPPED: canary-sched.py not found'); sys.exit(1)
    INST = next((p for p in (os.path.join(HERE, 'host', 'install-gate-v35.sh'), os.path.join(HERE, 'install-gate-v35.sh')) if os.path.exists(p)), None)
    for n, ok, d in cases(HT) + structural(HT, INST):
        t(n, ok, d)
    src = open(HT).read()
    tmp = tempfile.mkdtemp(prefix='holdtok-m-')
    ctl = os.path.join(tmp, 'ctl.py'); shutil.copy(HT, ctl)
    cres = cases(ctl)
    t('mutant runner control: the unmutated copy passes (%d)' % len(cres), cres and all(ok for _n, ok, _d in cres))
    for name, old, new in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR %s (%d)' % (name, src.count(old))
        mp = os.path.join(tmp, 'm_%d.py' % abs(hash(name))); open(mp, 'w').write(src.replace(old, new, 1))
        try:
            killed = not all(ok for _n, ok, _d in cases(mp))
        except Exception as e:
            killed = True          # a mutant that crashes the cases is caught by them
        t('mutant killed: ' + name, killed, 'SURVIVED')
    shutil.rmtree(tmp, ignore_errors=True)
    print('\n%d/%d pass' % (sum(T), len(T)))
    sys.exit(0 if all(T) else 1)
