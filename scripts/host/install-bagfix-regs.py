#!/usr/bin/env python3
"""install-bagfix-regs.py [--dry-run]  -- stage the seven queued bag fixes as `"class": "bag-fix"` (owner D1, 10-08) on
the fleet host, BETWEEN CANARIES ONLY, plus the read their bag_fix.primary names (bagread.py).

STAGE FIRST (on the Mac, at the commit being installed):
    ssh mike@10.0.0.31 'mkdir -p ~/bagfix-regs'
    scp docs/reports/{toolhygiene-01,peacefulkit-01,junkwell-02,gridfix-01,bamboo-01,stonecap-01,bamboocraft-01}.*.json \\
        scripts/host/bagread.py scripts/host/install-bagfix-regs.py BASE-MD5.txt mike@10.0.0.31:bagfix-regs/
  BASE-MD5.txt: "<file> <md5>" lines, one per version of each registration EVER COMMITTED to main before this change --
  a live copy that is none of them and not the staged one holds content main never had (an edit on the host), and is
  NOT overwritten (refused, named).
THEN:  python3 ~/bagfix-regs/install-bagfix-regs.py --dry-run      (touches nothing live)
       python3 ~/bagfix-regs/install-bagfix-regs.py                (only with NO loop, NO chain and NO canary declared)

WHAT IT CHANGES (nothing in the gate bundle; no digest re-registration):
  ~/mcai-analysis/<run>.<base>.json   each variant's registration (where the build staged it; a new one is added)
  ~/mcai-analysis/bagread.py, /tmp/bagread.py   the read (the loop runs reads from /tmp: canary-loop.sh RD)
A registration a loop is ALREADY using (~/mcai-analysis/registrations/<run>.json) is never touched: the launch copies the
variant in. Every replaced file is backed up (.bak-bfregs-<stamp>) and verified; a manifest records every md5.
"""
import os, sys, json, glob, shutil, hashlib, subprocess, fcntl, atexit, datetime as dt
DRY = '--dry-run' in sys.argv
H = os.path.expanduser('~'); S = os.path.dirname(os.path.abspath(__file__))
STAMP = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
RUNS = ('toolhygiene-01', 'peacefulkit-01', 'junkwell-02', 'gridfix-01', 'stonecap-01')   # bamboo-01, bamboocraft-01: ordinary canaries (operator + Codex 10-08)
md5 = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()
refuse = []


def die(msg):
    print('REFUSED: ' + msg); sys.exit(2)


print('== 1. nothing may be running')
# THE SCHEDULER'S INSTALL-HOLD FIRST (round 2, Codex): no NEW launch while it exists, and canary-sched.py's own slot
# checks (S1-S5, S7: manifest, processes, the loop lock, canary drop-ins, unit freshness, open runs) must pass -- exit 2
# otherwise. Released at exit, whatever happens. A dry run does not write a hold; it checks drop-ins itself.
SCHED = os.path.join(H, 'canary-sched.py')
DROPINS = sorted(glob.glob('/etc/systemd/system/mcbot@*.service.d/10-canary.conf'))
if DRY:
    if DROPINS:
        print('  (dry run) WOULD REFUSE: canary drop-ins present: ' + ', '.join(DROPINS[:4]))
    if not os.path.exists(SCHED):
        print('  (dry run) WOULD REFUSE: %s is missing (the install-hold is required)' % SCHED)
else:
    if DROPINS:
        die('canary drop-ins present (an incomplete teardown?): ' + ', '.join(DROPINS[:4]))
    if not os.path.exists(SCHED):
        # the scheduler's slot checks (unit freshness, closure of earlier runs) cannot be replaced here (round 3, Codex)
        die('%s is missing: the install-hold and its slot checks are required' % SCHED)
    if True:
        hr = subprocess.run([sys.executable, SCHED, 'install-hold', 'install-bagfix-regs', '30'], capture_output=True, text=True)
        atexit.register(lambda: subprocess.run([sys.executable, SCHED, 'install-release'], capture_output=True))
        if hr.returncode != 0:
            die('canary-sched.py install-hold: the slot is not free: ' + (hr.stdout + hr.stderr).strip().replace('\n', ' | ')[:600])
        print('  ' + hr.stdout.strip().splitlines()[-1][:200])
# THE LOOP'S OWN LOCK, held from here to the end (round 1, both engines): a loop launched meanwhile exits 3 instead of
# reading a half-installed set. A dry run only probes it.
_lockfh = open('/tmp/mcai-canary.lock', 'a')
try:
    fcntl.flock(_lockfh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if DRY:
        fcntl.flock(_lockfh, fcntl.LOCK_UN)
    lock_ok = True
except OSError:
    lock_ok = False


def busy():
    """-> [reasons]: a loop, a chain/launch script, a declared canary, or a manifest that does not SAY "no canary"."""
    why = []
    loop = subprocess.run("pgrep -af 'canary-loop.sh' | grep -v -e pgrep -e install-bagfix", shell=True, capture_output=True, text=True).stdout.strip()
    chain = subprocess.run("pgrep -af 'chain-[a-z0-9-]*\\.sh|launch-[a-z0-9-]*\\.sh|chain-after' | grep -v -e pgrep -e install-bagfix",
                           shell=True, capture_output=True, text=True).stdout.strip()
    if loop:
        why.append('canary loop running: ' + loop.replace('\n', ' | '))
    if chain:
        why.append('chain/launch script running: ' + chain.replace('\n', ' | '))
    try:
        m = json.load(open('/srv/mcbots/trial-manifest.json'))
        if not isinstance(m, dict) or 'canary_pool' not in m:
            why.append('manifest does not state canary_pool (an unreadable manifest is not an inactive one)')
        elif m.get('canary_pool') or m.get('canary_code_version'):
            why.append('a canary is declared: %s %s' % (m.get('canary_pool'), m.get('canary_code_version')))
    except Exception as e:
        why.append('manifest unreadable (%s)' % type(e).__name__)
    return why


for what in busy() + ([] if lock_ok else ['/tmp/mcai-canary.lock is held']):
    (print('  (dry run) WOULD REFUSE: ' + what) if DRY else die(what))

print('== 2. the staged files check out (nothing live)')
regs = sorted(f for f in glob.glob(os.path.join(S, '*.json')) if os.path.basename(f).rsplit('.', 2)[0] in RUNS)
if not regs:
    die('no staged registrations in %s' % S)
base = {}
for line in open(os.path.join(S, 'BASE-MD5.txt')):
    w = line.split()
    if len(w) == 2:
        base.setdefault(w[0], set()).add(w[1])
sys.path[:0] = [H + '/mcai-analysis']
import bagfixrule as BR       # the INSTALLED v33 rule decides what a well-formed bag-fix registration is
for f in regs:
    r = json.load(open(f))
    bad = BR.registration_problems(r)
    if r.get('class') != 'bag-fix' or bad:
        die('%s: class %r, problems %s' % (os.path.basename(f), r.get('class'), bad))
    if 'bagread' in r['reads'] and not os.path.exists(os.path.join(S, 'bagread.py')):
        die('%s reads bagread but bagread.py is not staged' % os.path.basename(f))
    if any(not isinstance(x, str) for x in (r.get('linkage_extra') or [])):
        die('%s: linkage_extra must be strings (a dict crashes verdict.py)' % os.path.basename(f))
r = subprocess.run([sys.executable, os.path.join(S, 'bagread.py'), '--selftest'], capture_output=True, text=True)
if r.returncode != 0:
    die('bagread.py self-test failed: %s' % (r.stdout + r.stderr)[-300:])
print('  %d registrations: class bag-fix, bagfixrule.registration_problems == [] ; bagread.py self-test ok' % len(regs))

print('== 3. what would change')
plan = []
for f in regs:
    n = os.path.basename(f); live = os.path.join(H, 'mcai-analysis', n)
    if os.path.exists(live):
        lm = md5(live)
        if lm == md5(f):
            print('  same    %s' % n); continue
        if lm not in base.get(n, set()):
            refuse.append('%s: live %s is no version main ever had, nor the staged copy (edited on the host?)' % (n, lm[:8]))
            continue
    plan.append((f, live))
for dest in (os.path.join(H, 'mcai-analysis', 'bagread.py'), '/tmp/bagread.py'):
    src = os.path.join(S, 'bagread.py')
    if not (os.path.exists(dest) and md5(dest) == md5(src)):
        plan.append((src, dest))
for src, dest in plan:
    print('  %s %s -> %s (%s)' % ('replace' if os.path.exists(dest) else 'add    ', os.path.basename(src), dest, md5(dest)[:8] if os.path.exists(dest) else 'NEW'))
if refuse:
    die('; '.join(refuse))
mf = os.path.join(S, 'MANIFEST-bfregs.txt')
mfdone = None
lines = ['# bag-fix registrations staged install manifest %s %s' % (STAMP, '(dry run)' if DRY else '')]
lines += ['target %s %s -> %s (live before: %s)' % (os.path.basename(s_), md5(s_), d, md5(d) if os.path.exists(d) else 'ABSENT') for s_, d in plan]
lines += ['staged %s %s' % (n, md5(os.path.join(S, n))) for n in sorted(os.listdir(S)) if os.path.isfile(os.path.join(S, n)) and not n.startswith('MANIFEST')]
with open(mf + '.tmp', 'w') as fh:
    fh.write('\n'.join(lines) + '\n'); fh.flush(); os.fsync(fh.fileno())
os.replace(mf + '.tmp', mf)
# the manifest describes the files exactly: every hash re-read from disk (round 1, Claude)
for line in open(mf):
    w = line.split()
    if w and w[0] in ('target', 'staged'):
        assert md5(os.path.join(S, w[1])) == w[2], 'manifest hash for %s is stale' % w[1]
print('  manifest: %s (%d targets), every hash verified' % (mf, len(plan)))
if DRY:
    print('DRY RUN: nothing live was changed.'); sys.exit(0)

print('== 4. install: backups verified first, then each file by rename')
again = busy() + (['canary drop-ins present'] if glob.glob('/etc/systemd/system/mcbot@*.service.d/10-canary.conf') else [])
if again:                # re-checked UNDER the held lock and the install-hold: nothing may have started since step 1
    die('; '.join(again))
done = []
try:
    for src, dest in plan:
        if os.path.exists(dest):
            shutil.copy2(dest, dest + '.bak-bfregs-' + STAMP)
            assert md5(dest) == md5(dest + '.bak-bfregs-' + STAMP), 'backup of %s differs' % dest
    for src, dest in plan:
        shutil.copy2(src, dest + '.new-bfregs'); assert md5(src) == md5(dest + '.new-bfregs')
        os.replace(dest + '.new-bfregs', dest); done.append(dest)
        print('  installed %s' % dest)
except Exception as e:
    print('FAILED (%s): rolling back' % e)
    for src, dest in plan:
        b = dest + '.bak-bfregs-' + STAMP
        if os.path.exists(b):
            os.replace(b, dest)
        elif dest in done:
            os.remove(dest)
        if os.path.exists(dest + '.new-bfregs'):
            os.remove(dest + '.new-bfregs')
    sys.exit(3)
print('INSTALLED: %d files; backups *.bak-bfregs-%s; manifest %s' % (len(plan), STAMP, mf))
