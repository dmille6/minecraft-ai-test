#!/usr/bin/env python3
"""test_heavyread.py -- heavyread.sh (the serialized, memory-capped read runner) and the OOM path end to end.
HOST ONLY for the scope and verdict sections (sudo systemd-run, version_split): elsewhere they are SKIPPED, loudly.

  A. heavyread.sh: under a 200M cap a 400 MB read is KILLED (exit 137 in a scope, MemoryError under ulimit) and says
     so; a light read runs as the caller, with the caller's environment and cwd, inside its own scope; a held lock
     -> exit 75 and the command NEVER runs; the lock fd is not inherited (an orphan cannot keep the lock).
  B. THE OOM PATH THROUGH THE REAL verdict.py (coordinator 10-10: "a read killed -> UNREADABLE/NOT_YET, never KEEP"):
     a clean four-pool bag fix that KEEPs at +180 under rule A' (positive control: its read, run through heavyread.sh
     under a 2G cap, writes its evidence and the verdict is KEEP); the SAME read under a 200M cap is killed before it
     writes, and the verdict is not KEEP.
  C. canary-loop.sh (comments stripped): every registered read runs through heavyread.sh, none directly, and a missing
     heavyread.sh stops the loop before any read.
Mutants on copies (anchors present and unique) after an unmutated control passes."""
import os, sys, json, subprocess, tempfile, shutil, importlib.util, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def find(n):
    for d in (os.path.join(HERE, 'host'), HERE):
        if os.path.exists(os.path.join(d, n)):
            return os.path.join(d, n)
    raise SystemExit('missing ' + n)


HR, LOOP = find('heavyread.sh'), find('canary-loop.sh')
T = []; SKIP = []


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, '' if ok else '\n        -> ' + str(d)[-500:]))


def scope_ok():
    return subprocess.run(['sudo', '-n', 'systemd-run', '--scope', '--quiet', '-p', 'MemoryMax=64M', '--uid=%d' % os.getuid(),
                           '--gid=%d' % os.getgid(), '/bin/true'], capture_output=True).returncode == 0


HOG = "import sys; x = bytearray(400 * 1024 * 1024); x[::4096] = b'1' * len(x[::4096]); open(sys.argv[1], 'w').write(sys.argv[2])"


def hr(hr_path, tmp, cmd, cap='200M', mode=None, lock=None, wait='5', timeout='60', env=None):
    out = tempfile.mktemp(dir=tmp)
    e = dict(os.environ, HEAVYREAD_LOCK=lock or os.path.join(tmp, 'lock'), HEAVYREAD_WAIT=wait, **(env or {}))
    if cap:
        e['HEAVYREAD_MAX'] = cap
    else:
        e.pop('HEAVYREAD_MAX', None)
    if mode:
        e['HEAVYREAD_MODE'] = mode
    r = subprocess.run(['bash', hr_path, timeout, out, '--'] + cmd, capture_output=True, text=True, env=e, cwd=tmp, timeout=300)
    return r.returncode, (open(out).read() if os.path.exists(out) else '')


def section_a(hr_path, tmp):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    if not shutil.which('flock'):
        SKIP.append('heavyread sections A/B: no flock here (host only)'); return out
    modes = (['scope'] if scope_ok() else []) + (['ulimit'] if sys.platform.startswith('linux') else [])
    if 'scope' not in modes:
        SKIP.append('heavyread scope mode: sudo systemd-run unavailable here (host only)')
    for mode in modes:
        f = tempfile.mktemp(dir=tmp, prefix='ev-%s-' % mode)
        rc, o = hr(hr_path, tmp, [sys.executable, '-c', HOG, f, 'x'], cap='200M', mode=mode)
        c('%s: a 400 MB read under a 200M cap is killed before it writes, non-zero, and says why' % mode,
          rc != 0 and not os.path.exists(f) and ('KILLED' in o or 'out of memory' in o), (rc, o))
        f = tempfile.mktemp(dir=tmp, prefix='ev2-%s-' % mode)
        rc, o = hr(hr_path, tmp, [sys.executable, '-c', HOG, f, 'x'], cap='2G', mode=mode)
        c('%s: the same read under a 2G cap runs and writes (positive control)' % mode, rc == 0 and os.path.exists(f), (rc, o))
        rc, o = hr(hr_path, tmp, [sys.executable, '-c', 'import os; print(os.getuid(), os.getcwd(), os.environ.get("HRTEST"), open("/proc/self/cgroup").read().strip())'],
                   cap='1G', mode=mode, env={'HRTEST': 'v1'})
        w = o.split()
        c('%s: runs as the caller, in the caller\'s cwd, with its environment' % mode,
          rc == 0 and len(w) >= 3 and w[0] == str(os.getuid()) and w[1] == os.path.realpath(tmp) and w[2] == 'v1', (rc, o))
        if mode == 'scope':
            c('scope: the read runs in its own transient scope', rc == 0 and '.scope' in o, o)
    for gb, want in ((46, 'cap 22G'), (96, 'cap 32G'), (64, 'cap 32G'), (50, 'cap 26G')):
        mi = tempfile.mktemp(dir=tmp, prefix='meminfo-'); open(mi, 'w').write('MemTotal:       %d kB\nMemFree: 1 kB\n' % (gb * 1048576))
        rc, o = hr(hr_path, tmp, ['true'], cap='', mode=modes[0] if modes else 'ulimit', env={'HEAVYREAD_MEMINFO': mi})
        c('cap sized from the host: %d GB -> %s (min(32G, MemTotal - 24G))' % (gb, want), rc == 0 and want + ' via' in o, (rc, o))
    mi = tempfile.mktemp(dir=tmp, prefix='meminfo-'); open(mi, 'w').write('MemTotal:       %d kB\n' % (26 * 1048576))
    marker0 = tempfile.mktemp(dir=tmp, prefix='must-not-exist-')
    rc, o = hr(hr_path, tmp, ['touch', marker0], cap='', env={'HEAVYREAD_MEMINFO': mi})
    c('a host too small to size a cap (26 GB) -> NOT run, never uncapped', rc != 0 and not os.path.exists(marker0) and 'NOT run' in o, (rc, o))
    lock = tempfile.mktemp(dir=tmp, prefix='heldlock-')
    holder = subprocess.Popen(['flock', lock, 'sleep', '8'])
    time.sleep(1)
    marker = tempfile.mktemp(dir=tmp, prefix='must-not-exist-')
    rc, o = hr(hr_path, tmp, ['touch', marker], lock=lock, wait='2', mode=modes[0] if modes else 'ulimit')
    holder.wait()
    c('a held heavy-read lock -> exit 75 and the command never runs', rc == 75 and not os.path.exists(marker) and 'NOT run' in o, (rc, o))
    for mode in modes:
        # (scope: sudo already closes inherited fds; ulimit: only heavyread's own `7>&-` does)
        lock2 = tempfile.mktemp(dir=tmp, prefix='orphanlock-')
        rc, o = hr(hr_path, tmp, ['bash', '-c', 'sleep 20 >/dev/null 2>&1 &'], lock=lock2, mode=mode)
        r2 = subprocess.run(['flock', '-w', '2', lock2, 'true'])
        c('%s: the lock is not inherited: an orphan of the read does not keep it' % mode, rc == 0 and r2.returncode == 0, (rc, r2.returncode))
    return out


def section_b(hr_path, tmp):
    """The OOM path through the real verdict.py, with test_keep180's clean A' case."""
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    if not scope_ok():
        SKIP.append('OOM -> verdict section: host only'); return out
    for cand in (os.path.join(HERE, 'lib'), '/home/mike/mcai-analysis/lib'):
        if os.path.isdir(cand):
            sys.path.insert(1, cand); break
    try:
        from version_split import in_canary_pool  # noqa: F401
    except ImportError:
        SKIP.append('OOM -> verdict section: no version_split here (host only)'); return out
    spec = importlib.util.spec_from_file_location('tva_hr', os.path.join(HERE, 'test_verdict_acceptance.py'))
    A = importlib.util.module_from_spec(spec); spec.loader.exec_module(A)
    A.VERDICT = os.path.join(HERE, 'verdict.py')
    P4 = 'board-b,hive-a,board-c,hive-b'
    BF = {'class': 'bag-fix', 'bag_fix': {'primary': {'read': 'bagread', 'field': 'slots_did', 'op': '<=', 'value': -0.5}}}

    def case(cap):
        r = dict({'reads': ['immobiledid', 'bagread'], 'read_minutes': [180, 360], 'licence': {'class': 'kind'}, 'own_lines': []}, **BF)
        cs = A.Case(tmp, reg_extra=r, manifest_extra={'canary_pool': P4})
        cs.evidence('immobiledid', A.immobiledid(readable=True, v15c='OK', canary_deaths=0, canary_bh=60.0, control_deaths=2, control_bh=300.0), M=180, pools=P4)
        cs.evidence('bagread', {'slots_did': -0.5, 'full_share_did': 0.0, 'pick_slots_did': 0.0, 'sword_slots_did': 0.0,
                                'cobble_slots_did': 0.0, 'canary_bot_h_post': 60.0}, M=180, pools=P4)
        # the immobiledid evidence is now written BY A READ, run through heavyread.sh under `cap`
        p = os.path.join(cs.reads, '%s-immobiledid-180.json' % A.RUN)
        body = open(p).read(); os.remove(p)
        rc, o = hr(hr_path, tmp, [sys.executable, '-c', HOG, p, body], cap=cap)
        v, head = cs.run(M=180, env_extra={'VERDICT_MODULE_DIR': HERE})
        return rc, os.path.exists(p), v, head
    rc, wrote, v, head = case('2G')
    c('positive control: the read under a 2G cap writes its evidence and the clean four-pool bag fix KEEPs at +180',
      rc == 0 and wrote and v == 'KEEP', (rc, wrote, v, head))
    rc, wrote, v, head = case('200M')
    c('THE OOM PATH: the same read KILLED by a 200M cap writes nothing, and the verdict is NOT KEEP (%s)' % v,
      rc != 0 and not wrote and v != 'KEEP' and v in ('UNREADABLE', 'NOT_YET', 'INCONCLUSIVE'), (rc, wrote, v, head))
    return out


def strip(src):
    return '\n'.join(l for l in src.splitlines() if not l.lstrip().startswith('#'))


def section_c(loop_path):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    L = strip(open(loop_path).read())
    i0 = L.find('_run_reads() {'); i1 = L.find('\n}\n', i0)
    body = L[i0:i1]
    c('loop: _run_reads runs each read through heavyread.sh', 'bash $H/mcai-analysis/heavyread.sh 900 $H/digest/reads/$RUN-$s-$M.txt -- python3 $RD/$s.py $M' in body, body[-600:])
    c('loop: no read is run directly (no `python3 $RD/` outside heavyread)', body.count('python3 $RD/') == 1 and 'timeout 900 python3 $RD' not in L)
    c('loop: a missing heavyread.sh stops the loop before any read (exit 4)',
      '[ -f $H/mcai-analysis/heavyread.sh ] || {' in body and 'exit 4; }' in body
      and body.find('heavyread.sh ] ||') < body.find('for s in $SCRIPTS; do\n    (cd'))
    return out


MUTANTS = [
    ('heavyread.sh', 'no memory cap (scope)', '-p MemoryMax="$CAP" -p MemorySwapMax=0', '-p MemorySwapMax=0'),
    ('heavyread.sh', 'lock not taken', 'if ! flock -w "$WAIT" 7; then', 'if false; then'),
    ('heavyread.sh', 'lock refusal runs anyway', '  exit 75\nfi', '  true\nfi'),
    ('heavyread.sh', 'lock fd inherited by the read (ulimit)', 'exec timeout "$T" "$@" ) > "$OUT" 2>&1 7>&-', 'exec timeout "$T" "$@" ) > "$OUT" 2>&1'),
    ('heavyread.sh', 'exit status swallowed', 'exit $RC\n', 'exit 0\n'),
    ('heavyread.sh', 'cap not bounded at 32G', '[ $_C -gt 32 ] && _C=32', 'true'),
    ('heavyread.sh', 'no bot reserve', '_C=$(( _MT - 24 ))', '_C=$(( _MT ))'),
    ('heavyread.sh', 'tiny host runs anyway', 'NOT run" > "$OUT"; exit 2\n  fi', 'NOT run" > "$OUT"; _MT=64\n  fi'),
    ('canary-loop.sh', 'reads run uncapped', 'bash $H/mcai-analysis/heavyread.sh 900 $H/digest/reads/$RUN-$s-$M.txt -- python3 $RD/$s.py $M',
     'timeout 900 python3 $RD/$s.py $M > $H/digest/reads/$RUN-$s-$M.txt 2>&1'),
    ('canary-loop.sh', 'a missing heavyread.sh tolerated', '[ -f $H/mcai-analysis/heavyread.sh ] || {', 'true || {'),
]


def all_cases(paths, tmp, quick=False):
    res = section_c(paths['canary-loop.sh'])
    if quick and not all(ok for _n, ok, _d in res):
        return res
    res += section_a(paths['heavyread.sh'], tmp)
    if quick and not all(ok for _n, ok, _d in res):
        return res
    return res + section_b(paths['heavyread.sh'], tmp)


if __name__ == '__main__':
    tmp = tempfile.mkdtemp(prefix='heavyread-')
    FILES = {'heavyread.sh': HR, 'canary-loop.sh': LOOP}
    for n, ok, d in all_cases(FILES, tmp):
        t(n, ok, d)
    d0 = tempfile.mkdtemp(dir=tmp)
    ctlp = {f: shutil.copy(p, os.path.join(d0, f)) for f, p in FILES.items()}
    ctl = all_cases(ctlp, tmp)
    t('mutant runner control: the unmutated copies pass (%d)' % len(ctl), ctl and all(ok for _n, ok, _d in ctl), [n for n, ok, _d in ctl if not ok])
    ok_all = all(T)
    for f, name, old, new in MUTANTS:
        src = open(FILES[f]).read()
        assert src.count(old) == 1, 'ANCHOR %s: %s (%d)' % (f, name, src.count(old))
        if not ok_all:
            t('mutant NOT SCORED: %s' % name, False); continue
        if f == 'heavyread.sh' and not shutil.which('flock'):
            SKIP.append('heavyread.sh mutants: host only'); continue
        dm = tempfile.mkdtemp(dir=tmp)
        mp = {g: shutil.copy(p, os.path.join(dm, g)) for g, p in FILES.items()}
        open(mp[f], 'w').write(src.replace(old, new, 1))
        try:
            res = all_cases(mp, tmp, quick=True)
            killed = not all(ok for _n, ok, _d in res)
        except Exception:
            killed = True
        t('mutant killed: %s: %s' % (f, name), killed, 'SURVIVED')
    for s in sorted(set(SKIP)):
        print('SKIPPED  ' + s)
    print('\n%d/%d pass%s' % (sum(T), len(T), ('; %d SKIPPED (not passes)' % len(set(SKIP))) if SKIP else ''))
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(0 if all(T) else 1)
