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


def hr(hr_path, tmp, cmd, cap='1G', lock=None, wait='5', timeout='60', env=None, role='calibration', man=None, bg=False):
    out = tempfile.mktemp(dir=tmp)
    if man is None:
        man = os.path.join(tmp, 'man-idle.json')
        if not os.path.exists(man):
            json.dump({'canary_pool': '', 'canary_code_version': ''}, open(man, 'w'))
    e = dict(os.environ, HEAVYREAD_LOCK=lock or os.path.join(tmp, 'lock'), HEAVYREAD_WAIT=wait, HEAVYREAD_ROLE=role,
             HEAVYREAD_MANIFEST=man, HEAVYREAD_LOOP_RE='^heavyread-test-no-such-loop$',
             HEAVYREAD_LOOP_LOCK=os.path.join(tmp, 'loop-lock-free'))
    e.update(env or {})
    if cap:
        e['HEAVYREAD_MAX'] = cap
    else:
        e.pop('HEAVYREAD_MAX', None)
    if bg:
        return subprocess.Popen(['bash', hr_path, timeout, out, '--'] + cmd, env=e, cwd=tmp), out
    r = subprocess.run(['bash', hr_path, timeout, out, '--'] + cmd, capture_output=True, text=True, env=e, cwd=tmp, timeout=300)
    return r.returncode, (open(out).read() if os.path.exists(out) else '')


def section_a(hr_path, tmp):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    if not shutil.which('flock') or not scope_ok():
        SKIP.append('heavyread sections A/B: no flock or no sudo systemd-run scope here (host only)'); return out
    f = tempfile.mktemp(dir=tmp, prefix='ev-')
    rc, o = hr(hr_path, tmp, [sys.executable, '-c', HOG, f, 'x'], cap='300M')
    c('a 400 MB read under a 300M cap is KILLED before it writes (137), and says so', rc == 137 and not os.path.exists(f) and 'KILLED' in o, (rc, o))
    failed = subprocess.run(['systemctl', 'list-units', '--all', '--failed', '--no-legend', '--plain', 'heavyread-*'], capture_output=True, text=True).stdout
    c('the killed run leaves no FAILED heavyread unit behind (its name would block a reused PID)', 'heavyread-' not in failed, failed[:300])
    f = tempfile.mktemp(dir=tmp, prefix='ev2-')
    rc, o = hr(hr_path, tmp, [sys.executable, '-c', HOG, f, 'x'], cap='2G')
    c('the same read under a 2G cap runs and writes (positive control)', rc == 0 and os.path.exists(f), (rc, o))
    MULTI = ("import subprocess, sys; ps = [subprocess.Popen([sys.executable, '-c', \"x = bytearray(250 * 1024 * 1024); "
             "x[::4096] = b'1' * len(x[::4096]); import time; time.sleep(3)\"]) for _ in range(3)]; "
             "sys.exit(max(p.wait() != 0 for p in ps))")
    rc, o = hr(hr_path, tmp, [sys.executable, '-c', MULTI], cap='500M')
    c('the cap is on the WHOLE job: three 250 MB workers under 500M do not all survive (round 4, Codex: not per process)', rc != 0, (rc, o))
    rc, o = hr(hr_path, tmp, [sys.executable, '-c', 'import os; print(os.getuid(), os.getcwd(), repr(os.environ.get("HRTEST")), open("/proc/self/cgroup").read().strip())'],
               cap='1G', env={'HRTEST': 'lit${HOME}x$$y $(id)'})
    c('runs as the caller, in the caller\'s cwd, with its environment VERBATIM ($ not expanded), in its own scope',
      rc == 0 and o.split()[0] == str(os.getuid()) and o.split()[1] == os.path.realpath(tmp)
      and "'lit${HOME}x$$y $(id)'" in o and 'heavyread-calibration-' in o and '.scope' in o, (rc, o))
    for gb, want in ((46, 'cap 22G'), (96, 'cap 32G'), (64, 'cap 32G'), (50, 'cap 26G')):
        mi = tempfile.mktemp(dir=tmp, prefix='meminfo-'); open(mi, 'w').write('MemTotal:       %d kB\nMemFree: 1 kB\n' % (gb * 1048576))
        rc, o = hr(hr_path, tmp, ['true'], cap='', env={'HEAVYREAD_MEMINFO': mi})
        c('cap sized from the host: %d GB -> %s (min(32G, MemTotal - 24G))' % (gb, want), rc == 0 and want + ' via' in o, (rc, o))
    for bad in ('invalid', '20', '100M', '1.5G', '-1G'):
        marker = tempfile.mktemp(dir=tmp, prefix='must-not-exist-')
        rc, o = hr(hr_path, tmp, ['touch', marker], cap=bad)
        c('an invalid cap %r -> NOT run (exit 2), never uncapped (round 4, Codex)' % bad, rc == 2 and not os.path.exists(marker) and 'NOT run' in o, (rc, o))
    mi = tempfile.mktemp(dir=tmp, prefix='meminfo-'); open(mi, 'w').write('MemTotal:       %d kB\n' % (26 * 1048576))
    marker0 = tempfile.mktemp(dir=tmp, prefix='must-not-exist-')
    rc, o = hr(hr_path, tmp, ['touch', marker0], cap='', env={'HEAVYREAD_MEMINFO': mi})
    c('a host too small to size a cap (26 GB) -> NOT run', rc == 2 and not os.path.exists(marker0), (rc, o))
    p = subprocess.run(['bash', hr_path, '--probe'], capture_output=True, text=True, env=dict(os.environ, HEAVYREAD_MAX='4G'))
    c('--probe: "HEAVYREAD scope cap 4G", exit 0', p.returncode == 0 and p.stdout.strip() == 'HEAVYREAD scope cap 4G', p.stdout)
    p = subprocess.run(['bash', hr_path, '--probe'], capture_output=True, text=True, env=dict(os.environ, HEAVYREAD_MAX='junk'))
    c('--probe with an invalid cap: UNAVAILABLE, exit 1', p.returncode == 1 and 'UNAVAILABLE' in p.stdout, p.stdout)
    # calibration refuses while a canary is active
    live = os.path.join(tmp, 'man-live.json'); json.dump({'canary_pool': 'hive-d', 'canary_code_version': 'abc1234'}, open(live, 'w'))
    marker = tempfile.mktemp(dir=tmp, prefix='must-not-exist-')
    rc, o = hr(hr_path, tmp, ['touch', marker], man=live)
    c('a CALIBRATION job refuses (76) while a canary is declared, and never runs', rc == 76 and not os.path.exists(marker) and 'REFUSED' in o, (rc, o))
    rc, o = hr(hr_path, tmp, ['touch', marker], man=os.path.join(tmp, 'no-such-manifest.json'))
    c('a CALIBRATION job refuses (76) when the manifest is unreadable', rc == 76 and not os.path.exists(marker), (rc, o))
    fake = subprocess.Popen(['bash', '-c', 'exec -a hrtest-fake-canary-loop sleep 30'])
    time.sleep(0.5)
    rc, o = hr(hr_path, tmp, ['touch', marker], env={'HEAVYREAD_LOOP_RE': '^hrtest-fake-canary-loop'})
    fake.kill(); fake.wait()
    c('a CALIBRATION job refuses (76) while a canary LOOP process runs (manifest idle)', rc == 76 and not os.path.exists(marker), (rc, o))
    ll = os.path.join(tmp, 'loop-lock-held')
    holdl = subprocess.Popen(['flock', ll, 'sleep', '6']); time.sleep(0.5)
    rc, o = hr(hr_path, tmp, ['touch', marker], env={'HEAVYREAD_LOOP_LOCK': ll})
    holdl.wait()
    c('a CALIBRATION job refuses (76) while the canary loop LOCK is held (round 5, Claude)', rc == 76 and not os.path.exists(marker), (rc, o))
    rc, o = hr(hr_path, tmp, ['touch', marker], man=live, role='loop')
    c('a LOOP read runs while its canary is declared', rc == 0 and os.path.exists(marker), (rc, o))
    # PREEMPTION: a loop read takes the lock from a calibration job within ~2 waits; never from another loop read
    lock = tempfile.mktemp(dir=tmp, prefix='plock-')
    pc, pout = hr(hr_path, tmp, ['sleep', '120'], lock=lock, bg=True)
    time.sleep(3)
    t0 = time.time()
    marker = tempfile.mktemp(dir=tmp, prefix='ran-')
    rc, o = hr(hr_path, tmp, ['touch', marker], lock=lock, wait='3', role='loop')
    dt_ = time.time() - t0
    pc.wait(30)
    po = open(pout).read() if os.path.exists(pout) else ''
    unit = 'heavyread-calibration-%d.scope' % pc.pid          # pc runs heavyread.sh directly: its $$ is pc.pid
    units = subprocess.run(['systemctl', 'is-active', unit], capture_output=True, text=True).stdout.strip()
    c('PREEMPTION: a loop read behind a 120-s calibration job runs within ~2 waits (%.0f s), the calibration is killed and says PREEMPTED'
      % dt_, rc == 0 and os.path.exists(marker) and dt_ < 15 and pc.returncode != 0 and 'PREEMPTED' in po and 'PREEMPTED' in o, (rc, dt_, pc.returncode, po, o))
    c('PREEMPTION: the preempted calibration scope itself is GONE (systemctl is-active: %s)' % units, units != 'active', units)
    lock = tempfile.mktemp(dir=tmp, prefix='plock2-')
    pl, plout = hr(hr_path, tmp, ['sleep', '20'], lock=lock, bg=True, role='loop')
    time.sleep(3)
    marker = tempfile.mktemp(dir=tmp, prefix='must-not-exist-')
    rc, o = hr(hr_path, tmp, ['touch', marker], lock=lock, wait='2', role='loop')
    c('a loop read never preempts ANOTHER loop read: exit 75, not run, and the holder survives',
      rc == 75 and not os.path.exists(marker) and pl.poll() is None, (rc, o, pl.poll()))
    pl.wait(60)
    lock = tempfile.mktemp(dir=tmp, prefix='plock3-')
    pc2, _o = hr(hr_path, tmp, ['sleep', '20'], lock=lock, bg=True)
    time.sleep(3)
    rc, o = hr(hr_path, tmp, ['touch', marker], lock=lock, wait='2')
    c('a calibration job never preempts: exit 75 behind another calibration job', rc == 75 and not os.path.exists(marker) and pc2.poll() is None, (rc, o))
    pc2.wait(60)
    # a read that IGNORES SIGTERM is SIGKILLed after the 60-s grace (round 5, Codex)
    t0 = time.time()
    rc, o = hr(hr_path, tmp, [sys.executable, '-c', 'import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(600)'],
               timeout='3')
    c('a TERM-ignoring read is KILLED (137) within timeout + 60 s (%.0f s)' % (time.time() - t0), rc == 137 and time.time() - t0 < 90, (rc, o))
    # a malformed or foreign holder record is never signalled: the loop read waits and is not run
    lock = tempfile.mktemp(dir=tmp, prefix='plock4-')
    victim = subprocess.Popen(['sleep', '60'])
    open(lock + '.holder', 'w').write('calibration %d heavyread-calibration-%d.scope\n' % (victim.pid, victim.pid))
    hold = subprocess.Popen(['flock', lock, 'sleep', '12'])
    time.sleep(1)
    rc, o = hr(hr_path, tmp, ['true'], lock=lock, wait='2', role='loop')
    c('a holder record whose pid is not a heavyread wrapper is NOT signalled: victim alive, read not run (75)',
      rc == 75 and victim.poll() is None, (rc, o, victim.poll()))
    victim.kill(); victim.wait(); hold.wait()
    # THE PREEMPTED SCOPE SURVIVES (a refused `systemctl kill`, via a sudo shim on PATH): the loop read is NOT run
    shim = tempfile.mkdtemp(dir=tmp, prefix='shim-')
    open(os.path.join(shim, 'sudo'), 'w').write('#!/bin/bash\n[ "$2" = systemctl ] && [ "$3" = kill ] && exit 1\nexec /usr/bin/sudo "$@"\n')
    os.chmod(os.path.join(shim, 'sudo'), 0o755)
    lock = tempfile.mktemp(dir=tmp, prefix='plock5-')
    pc, pout = hr(hr_path, tmp, ['sleep', '60'], lock=lock, bg=True)
    time.sleep(3)
    marker = tempfile.mktemp(dir=tmp, prefix='must-not-exist-')
    rc, o = hr(hr_path, tmp, ['touch', marker], lock=lock, wait='3', role='loop', env={'PATH': shim + ':' + os.environ['PATH']})
    alive = pc.poll() is None
    c('a preempted scope that SURVIVES (kill refused) -> the loop read is NOT run (75); never two heavy jobs (round 5, Codex)',
      rc == 75 and not os.path.exists(marker) and alive and 'did not stop' in o, (rc, o, alive))
    subprocess.run(['sudo', '-n', 'systemctl', 'kill', '--signal=KILL', 'heavyread-calibration-%d.scope' % pc.pid], capture_output=True)
    pc.wait(30)
    # THE LOCK FREES BUT THE SCOPE STAYS ACTIVE (round 7, Codex: only the scope check can refuse here). The kill is refused;
    # during the loop read's is-active wait the calibration WRAPPER is SIGKILLed (its flock fd closes, the lock is free)
    # while its scope's process keeps running. The loop read must still NOT run.
    lock = tempfile.mktemp(dir=tmp, prefix='plock7-')
    pc, pout = hr(hr_path, tmp, ['sleep', '60'], lock=lock, bg=True)
    time.sleep(3)
    marker = tempfile.mktemp(dir=tmp, prefix='must-not-exist-')
    lr, lout = hr(hr_path, tmp, ['touch', marker], lock=lock, wait='6', role='loop', env={'PATH': shim + ':' + os.environ['PATH']}, bg=True)
    time.sleep(8.5)                      # inside the loop read's is-active window (t = 6 .. 12 s)
    pc.kill(); pc.wait(10)
    lr.wait(60)
    unit7 = 'heavyread-calibration-%d.scope' % pc.pid
    act = subprocess.run(['systemctl', 'is-active', unit7], capture_output=True, text=True).stdout.strip()
    lo = open(lout).read() if os.path.exists(lout) else ''
    c('the lock is FREE but the preempted scope is still ACTIVE -> the loop read is NOT run (75) (scope %s)' % act,
      lr.returncode == 75 and not os.path.exists(marker) and act == 'active', (lr.returncode, lo, act))
    subprocess.run(['sudo', '-n', 'systemctl', 'kill', '--signal=KILL', unit7], capture_output=True)
    # A RECORD NAMING A LIVE HEAVYREAD PID WITH ANOTHER UNIT: that unit is never signalled
    vunit = 'hrtest-victim-%d' % os.getpid()
    victim = subprocess.Popen(['sudo', '-n', 'systemd-run', '--scope', '--quiet', '--unit=' + vunit, '--uid=%d' % os.getuid(), 'sleep', '60'])
    lock = tempfile.mktemp(dir=tmp, prefix='plock6-')
    pc, pout = hr(hr_path, tmp, ['sleep', '30'], lock=lock, bg=True)
    time.sleep(3)
    open(lock + '.holder', 'w').write('calibration %d %s.scope\n' % (pc.pid, vunit))
    rc, o = hr(hr_path, tmp, ['true'], lock=lock, wait='3', role='loop')
    va = subprocess.run(['systemctl', 'is-active', vunit + '.scope'], capture_output=True, text=True).stdout.strip()
    c('a holder record whose unit is not heavyread-calibration-<pid>.scope is NOT signalled (victim scope %s; read 75)' % va,
      va == 'active' and rc == 75, (rc, o, va))
    subprocess.run(['sudo', '-n', 'systemctl', 'kill', '--signal=KILL', vunit + '.scope'], capture_output=True); victim.wait(30)
    subprocess.run(['sudo', '-n', 'systemctl', 'kill', '--signal=KILL', 'heavyread-calibration-%d.scope' % pc.pid], capture_output=True); pc.wait(60)
    lock2 = tempfile.mktemp(dir=tmp, prefix='orphanlock-')
    rc, o = hr(hr_path, tmp, ['bash', '-c', 'sleep 20 >/dev/null 2>&1 &'], lock=lock2)
    r2 = subprocess.run(['flock', '-w', '2', lock2, 'true'])
    c('the lock is not inherited: an orphan of the read does not keep it', rc == 0 and r2.returncode == 0, (rc, r2.returncode))
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
    rc, wrote, v, head = case('300M')
    c('THE OOM PATH: the same read KILLED by a 300M cap writes nothing, and the verdict is NOT KEEP (%s)' % v,
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
    c('loop: _run_reads runs each read through heavyread.sh', 'bash $H/mcai-analysis/heavyread.sh $_to $H/digest/reads/$RUN-$s-$M.txt -- python3 $RD/$s.py $M' in body, body[-600:])
    c('loop: no read is run directly (no `python3 $RD/` outside heavyread)', body.count('python3 $RD/') == 1 and 'timeout 900 python3 $RD' not in L)
    c('loop: reads run as role loop (priority over calibration)', 'HEAVYREAD_ROLE=loop bash $H/mcai-analysis/heavyread.sh' in body)
    i_rm = body.find('rm -f $H/digest/reads/$RUN-$s-$M.json\n    (cd'); i_run = body.find('HEAVYREAD_ROLE=loop bash')
    c('loop: a read\'s previous evidence is removed BEFORE each attempt, and again after a failed one (round 4, Codex)',
      0 < i_rm < i_run and '[ $_rc -ne 0 ] && rm -f $H/digest/reads/$RUN-$s-$M.json' in body)
    c('loop: the timeout is 1800 s from +1440 (measured +1920 reads: up to 846 s)', 'local _to=900; [ "$M" -ge 1440 ] && _to=1800' in body
      and 'heavyread.sh $_to ' in body)
    c('loop: the heavyread probe is journalled at every read minute', 'journal heavyread-mode' in body and 'heavyread.sh --probe' in body)
    c('loop: a missing heavyread.sh stops the loop before any read (exit 4)',
      '[ -f $H/mcai-analysis/heavyread.sh ] || {' in body and 'exit 4; }' in body
      and 0 <= body.find('heavyread.sh ] ||') < body.find('HEAVYREAD_ROLE=loop bash'))
    return out


MUTANTS = [
    ('heavyread.sh', 'no memory cap', '-p MemoryMax="$CAP" -p MemorySwapMax=0 \\\n', '-p MemorySwapMax=0 \\\n'),
    ('heavyread.sh', 'lock not taken', 'exec 7>>"$LOCK"\nif ! flock -w "$WAIT" 7; then', 'exec 7>>"$LOCK"\nif false; then'),
    ('heavyread.sh', 'busy lock runs anyway', '-- NOT run" > "$OUT"; exit 75\n  fi\nfi', '-- NOT run" > "$OUT"\n  fi\nfi'),
    ('heavyread.sh', 'exit status swallowed', 'exit $RC\n', 'exit 0\n'),
    ('heavyread.sh', 'cap not bounded at 32G', '[ $c -gt 32 ] && c=32', 'true'),
    ('heavyread.sh', 'no bot reserve', 'local c=$(( mt - 24 ))', 'local c=$(( mt ))'),
    ('heavyread.sh', 'invalid cap accepted', '>= 256 * 1024 else 1)" "$HEAVYREAD_MAX" || return 1', '>= 256 * 1024 else 1)" "$HEAVYREAD_MAX" || true'),
    ('heavyread.sh', 'calibration runs during a canary', '  if [ "$_cp" != "no" ] || [ -n "$_lp" ] || [ -n "$_ll" ]; then', '  if false; then'),
    ('heavyread.sh', 'loop lock not checked', '  if [ "$_cp" != "no" ] || [ -n "$_lp" ] || [ -n "$_ll" ]; then', '  if [ "$_cp" != "no" ] || [ -n "$_lp" ]; then'),
    ('heavyread.sh', 'loop never preempts', '  if [ "$ROLE" = loop ] && [ "$_hrole" = calibration ] && [[', '  if false && [ "$_hrole" = calibration ] && [['),
    ('heavyread.sh', 'loop preempts another loop read',
     'if [ "$ROLE" = loop ] && [ "$_hrole" = calibration ] && [[ "$_hpid" =~ ^[0-9]+$ ]] \\\n     && [ "$_hunit" = "heavyread-calibration-$_hpid.scope" ]',
     'if [ "$ROLE" = loop ] && [[ "$_hrole" =~ . ]] && [[ "$_hpid" =~ ^[0-9]+$ ]] \\\n     && [ "$_hunit" = "heavyread-$_hrole-$_hpid.scope" ]'),
    ('heavyread.sh', 'failed unit left behind', 'sudo -n systemctl reset-failed "$UNIT.scope" 2>/dev/null\n', '\n'),
    ('heavyread.sh', 'no SIGKILL escalation', 'timeout --kill-after=60 "$T"', 'timeout "$T"'),
    ('heavyread.sh', 'loop read runs although the scope survived', '    if [ -z "$_dead" ] || ! flock -w "$WAIT" 7; then', '    if ! flock -w "$WAIT" 7; then'),
    ('heavyread.sh', 'any holder record is preempted', '     && [ "$_hunit" = "heavyread-calibration-$_hpid.scope" ] && grep', '     && true && grep'),
    ('canary-loop.sh', 'reads run uncapped', 'HEAVYREAD_ROLE=loop bash $H/mcai-analysis/heavyread.sh $_to $H/digest/reads/$RUN-$s-$M.txt -- python3 $RD/$s.py $M',
     'timeout 900 python3 $RD/$s.py $M > $H/digest/reads/$RUN-$s-$M.txt 2>&1'),
    ('canary-loop.sh', 'a missing heavyread.sh tolerated', '[ -f $H/mcai-analysis/heavyread.sh ] || {', 'true || {'),
    ('canary-loop.sh', 'loop reads run as calibration', 'HEAVYREAD_ROLE=loop bash $H/mcai-analysis/heavyread.sh', 'HEAVYREAD_ROLE=calibration bash $H/mcai-analysis/heavyread.sh'),
    ('canary-loop.sh', 'stale evidence kept after a failed read', '    [ $_rc -ne 0 ] && rm -f $H/digest/reads/$RUN-$s-$M.json\n', '\n'),
    ('canary-loop.sh', 'old evidence kept before a rerun', '    rm -f $H/digest/reads/$RUN-$s-$M.json\n    (cd', '    (cd'),
    ('canary-loop.sh', 'fixed 900-s timeout at +1920', '[ "$M" -ge 1440 ] && _to=1800', 'true'),
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
        if f == 'heavyread.sh' and not (shutil.which('flock') and scope_ok()):
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
