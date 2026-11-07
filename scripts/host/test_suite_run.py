#!/usr/bin/env python3
"""suite-run.py (phase 1 item 3, 11-06): the tar deadlock, the deadlines and the git-context overlay. No network: ship()
runs against a local "host" (bash in a temp directory).

    python3 scripts/host/test_suite_run.py        (exit 1 on failure)
"""
import contextlib
import importlib.util
import io
import os
import shutil
import subprocess
import sys
import tempfile
import time
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'suite-run.py')
FAILS = []
HERE_RELAY = [os.path.join(HERE, 'autorebase-suite-relay.py')]
ENV = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t',
           GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')


def load(src_text=None):
    path = SRC
    if src_text is not None:
        fd, path = tempfile.mkstemp(suffix='.py', dir=HERE)
        os.write(fd, src_text.encode()); os.close(fd)
    try:
        spec = importlib.util.spec_from_file_location('suiterun_%d' % id(path), path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
    finally:
        if src_text is not None:
            os.unlink(path)
    return m


def check(name, cond, detail=''):
    if not cond:
        FAILS.append(f'{name} {str(detail)[:300]}')


def t_wait(S):
    check('wait: DONE line ends it', S.wait_action(100, 0, 100, 'DONE rc=0', 50) == 'done')
    check('wait: past the deadline', S.wait_action(4000, 0, 4000, '[3/400]', 3600) == 'deadline')
    check('wait: inside the deadline', S.wait_action(100, 0, 100, '[3/400]', 3600) == 'wait')
    check('wait: ssh down 11 min', S.wait_action(1000, 0, 300, None, 3600, ssh_down_s=600) == 'unreachable')
    check('wait: ssh down 2 min keeps waiting', S.wait_action(420, 0, 300, None, 3600, ssh_down_s=600) == 'wait')


def t_ship(S):
    """A file list far over a pipe buffer (the old deadlock: the list was written to tar's stdin before ssh read). Measured
    11-06: the main version of ship() is still blocked after 30 s on exactly this input (positive control, by hand)."""
    src = tempfile.mkdtemp(prefix='sr-src-')
    host = tempfile.mkdtemp(prefix='sr-host-')
    try:
        files = []
        for i in range(3000):
            p = f'd{i % 7}/{"n" * 40}-{i:05d}.txt'
            os.makedirs(os.path.join(src, os.path.dirname(p)), exist_ok=True)
            open(os.path.join(src, p), 'wb').write(os.urandom(2048))     # incompressible: tar's output passes 64 KB early
            files.append(p)
        check('ship: the list is over 64 KB', len('\0'.join(files)) > 65536)
        S.SSH = ['bash', '-c']
        S.HOSTS['local'] = f'cd {host} && eval "$0"'
        done = {}
        th = threading.Thread(target=lambda: done.update(r=S.ship('local', src, None, 'ci/x', timeout_s=120, files=files)))
        th.start(); th.join(150)
        check('ship: completes (no deadlock)', not th.is_alive())
        got = sum(len(fs) for _, _, fs in os.walk(os.path.join(host, 'ci', 'x')))
        check('ship: every file arrives', got == len(files), got)
    finally:
        shutil.rmtree(src, ignore_errors=True); shutil.rmtree(host, ignore_errors=True)


def t_overlay(S):
    d = tempfile.mkdtemp(prefix='sr-git-')
    try:
        g = lambda *a: subprocess.run(['git', '-C', d, *a], check=True, capture_output=True, env=ENV)
        g('init', '-q')
        for f in ('a.txt', 'gone.txt', 'docs/kept.md'):
            os.makedirs(os.path.dirname(os.path.join(d, f)) or d, exist_ok=True)
            open(os.path.join(d, f), 'w').write(f)
        g('add', '-A'); g('commit', '-q', '-m', 'base')
        os.unlink(os.path.join(d, 'gone.txt'))
        g('rm', '-q', 'docs/kept.md')                       # a STAGED deletion (Codex review r1)
        open(os.path.join(d, 'staged.txt'), 'w').write('s'); g('add', 'staged.txt')
        open(os.path.join(d, 'untracked.txt'), 'w').write('u')
        open(os.path.join(d, 'a.txt'), 'w').write('edited')
        files, deleted, added = S.worktree_overlay(d)
        check('overlay: deleted AND staged-deleted files are deleted remotely', deleted == ['docs/kept.md', 'gone.txt'], deleted)
        check('overlay: the staged new file is git-added remotely', added == ['staged.txt'], added)
        check('overlay: untracked stays untracked (not added)', 'untracked.txt' in files and 'untracked.txt' not in added, files)
        check('overlay: edited files are shipped', 'a.txt' in files and 'gone.txt' not in files, files)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_mirror_ref(S):
    """A `.wt-*` worktree label made an invalid ref (11-06: the git-only tests silently skipped); git's own check is the oracle."""
    for lab in ('.wt-promomerge-x-0fcb1293', 'ok-label', 'a..b', 'x.lock', 'sp ace', '..', '.'):
        ref = S.mirror_ref(lab)
        ok = subprocess.run(['git', 'check-ref-format', ref], capture_output=True).returncode == 0
        check('mirror_ref valid: %s -> %s' % (lab, ref), ok)
    check('mirror_ref keeps a good label', S.mirror_ref('ok-label') == 'refs/suite/ok-label')


def t_prune(S):
    """11-06: ci2 hit 86% on 3 days of trees. A DONE tree over 12 h and any tree whose log is over 24 h go; a fresh one,
    its log and the git mirror stay. Runs the real shell command against a temp HOME."""
    home = tempfile.mkdtemp(prefix='sr-prune-')
    try:
        ci = os.path.join(home, 'ci')
        for d in ('old', 'hung', 'fresh', '.git-mirror.git', '.nm-cache'):
            os.makedirs(os.path.join(ci, d))
        for name, text, old in (('old', 'DONE rc=0', True), ('hung', '[3/400]', True), ('fresh', 'DONE rc=1', False),
                                ('.nm-cache', 'DONE rc=0', True), ('.git-mirror.git', 'DONE rc=0', True)):
            with open(os.path.join(ci, name + '.log'), 'w') as f:
                f.write(text + '\n')
            if old:
                t = time.time() - 2 * 86400
                os.utime(os.path.join(ci, name + '.log'), (t, t))
        subprocess.run(['bash', '-c', S.prune_cmd()], env=dict(os.environ, HOME=home), check=True)
        left = sorted(os.listdir(ci))
        check('prune: old DONE tree and hung tree removed', 'old' not in left and 'hung' not in left, left)
        check('prune: fresh tree, logs and mirror kept', all(x in left for x in ('fresh', '.git-mirror.git', 'old.log', 'hung.log')), left)
        check('prune: the node_modules cache is kept even beside an old DONE .nm-cache.log', '.nm-cache' in left, left)
    finally:
        shutil.rmtree(home, ignore_errors=True)


def t_relay(_S=None):
    spec = importlib.util.spec_from_file_location('relay_t', os.path.join(HERE, 'autorebase-suite-relay.py'))
    R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
    A, B = 'a' * 40, 'b' * 40
    key = 'foo-01--%s--%s' % (A[:12], B[:12])
    req = {'base': A, 'sha': B, 'ref': 'refs/heads/autorebase-suite/foo-01-on-%s' % A[:8]}
    check('relay: a well-formed request', R.valid_request(key, req) == '')
    check('relay: key must match the shas', R.valid_request('foo-01--%s--%s' % (B[:12], A[:12]), req) != '')
    check('relay: a ref outside autorebase-suite/ is refused', R.valid_request(key, dict(req, ref='refs/heads/main')) == 'bad ref')
    check('relay: a short sha is refused', 'full sha' in R.valid_request(key, dict(req, sha='bbbb')))
    out = ('host=ci2 (mike@10.0.0.34; lock free) label=ar-foo sha=bbbbbbbb remote_log=~/ci/ar-foo.log local_log=/tmp/x\n'
           'git context: a checkout\ndetached. follow: ...')
    check('relay: parse suite-run --detach', R.parse_detach(out) == ('ci2', 'ar-foo', 'ci/ar-foo.log'), R.parse_detach(out))
    now = datetime_now()
    st = {'started': (now - _td(10)).strftime('%Y-%m-%dT%H:%M:%SZ')}
    check('relay: DONE rc=0', R.action(st, 'DONE rc=0\n', now) == ('done', 0))
    check('relay: running', R.action(st, '[200/417] ...', now) == ('wait', None))
    check('relay: gives up after 150 min', R.action({'started': (now - _td(151)).strftime('%Y-%m-%dT%H:%M:%SZ')}, '', now)
          == ('giveup', None))


def P(free=False, cache=False, npm=False, waiters=0):
    return {'free': free, 'cache': cache, 'npm': npm, 'waiters': waiters}


def t_plan(S):
    """INCIDENT 11-07: ci2 busy (with the cache and npm), w30 free with neither -> w30 seeded FROM ci2, ci2 as the fallback.
    The old pick_host sent every request to w30 and its prep failed for 100 min."""
    O = ['ci2', 'w30']
    got = S.host_plan(O, {'ci2': P(cache=True, npm=True, waiters=3), 'w30': P(free=True)})
    check('plan: incident -> seed w30 from ci2, then ci2', got == [('w30', 'ci2'), ('ci2', None)], got)
    got = S.host_plan(O, {'ci2': P(free=True, npm=True), 'w30': P(free=True, cache=True)})
    check('plan: both free -> ci2 first, nothing seeded', got == [('ci2', None), ('w30', None)], got)
    got = S.host_plan(O, {'ci2': P(npm=True, waiters=3), 'w30': P(cache=True, waiters=1)})
    check('plan: both busy -> fewer waiters first', got == [('w30', None), ('ci2', None)], got)
    got = S.host_plan(O, {'ci2': P(npm=True, waiters=1), 'w30': P(cache=True, waiters=1)})
    check('plan: both busy, tie -> ci2', got == [('ci2', None), ('w30', None)], got)
    got = S.host_plan(O, {'ci2': P(npm=True, waiters=3), 'w30': P(free=True)})
    check('plan: nobody holds the cache -> unseedable w30 goes LAST', got == [('ci2', None), ('w30', None)], got)
    got = S.host_plan(O, {'ci2': None, 'w30': P(free=True, cache=True)})
    check('plan: an unreachable host is left out', got == [('w30', None)], got)
    got = S.host_plan(O, {'ci2': P(cache=True, npm=True, waiters=3), 'w30': P(free=True)}, forced='w30')
    check('plan: forced w30 is still seeded', got == [('w30', 'ci2')], got)
    got = S.host_plan(O, {'ci2': P(free=True), 'w30': None}, forced='w30')
    check('plan: forced unreachable -> nothing', got == [], got)


def t_probe(S):
    check('probe: parsed', S.parse_probe('FREE\nCACHE\nWAITERS 2\nPROBED\n') == P(True, True, False, 2))
    check('probe: npm only', S.parse_probe('NPM\nWAITERS 0\nPROBED\n') == P(npm=True))
    check('probe: no answer -> None', S.parse_probe('') is None and S.parse_probe('FREE') is None)
    check('probe: a bad hash is never put in a path', 'nm-cache/none/' in S.probe_cmd('x; rm -rf ~'))
    # the real command, run locally against a temp HOME with a cache (positive) and without (negative)
    home = tempfile.mkdtemp(prefix='sr-probe-')
    try:
        os.makedirs(os.path.join(home, 'ci', '.nm-cache', 'abcdef012345', 'node_modules'))
        env = dict(os.environ, HOME=home, PATH=_stub_path(home) + os.pathsep + os.environ['PATH'])
        run = lambda h: S.parse_probe(subprocess.run(['bash', '-c', S.probe_cmd(h)], env=env, capture_output=True,
                                                     text=True).stdout)
        check('probe cmd: cache present', (run('abcdef012345') or {}).get('cache') is True, run('abcdef012345'))
        check('probe cmd: cache absent', (run('0123456789ab') or {}).get('cache') is False, run('0123456789ab'))
    finally:
        shutil.rmtree(home, ignore_errors=True)


def _stub_path(home):
    """A `flock` stub for the Mac (macOS has none): it runs nothing and succeeds (`flock -n F true`, `flock -w N 9`)."""
    d = os.path.join(home, '.stubbin')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'flock'), 'w') as f:
        f.write('#!/bin/sh\nexit 0\n')
    os.chmod(os.path.join(d, 'flock'), 0o755)
    return d


def t_try(S):
    plan = [('w30', 'ci2'), ('ci2', None)]
    seen = []
    got = S.try_hosts(plan, lambda src, h: 'no route', lambda h: ('ctx-' + h, ''), lambda h, w, why: seen.append((h, w)))
    check('try: a failed seed falls back to the next host', got[0] == 'ci2' and got[2] == 'ctx-ci2', got)
    check('try: the skip is reported', seen == [('w30', 'seed-failed')], seen)
    got = S.try_hosts(plan, lambda src, h: '', lambda h: ('r', 'rc 3 no npm' if h == 'w30' else ''))
    check('try: a failed prep falls back', got[0] == 'ci2' and len(got[3]) == 1, got)
    got = S.try_hosts(plan, lambda src, h: '', lambda h: ('r', ''))
    check('try: the first good host runs, seeded', got[:2] == ('w30', 'ci2') and got[3] == [], got)
    got = S.try_hosts(plan, lambda src, h: 'cp: one\ncp: two', lambda h: ('r', 'x\ny' if h == 'ci2' else ''))
    check('try: failure details are one line (the host= record is parsed per line, Codex r1)',
          all('\n' not in t for t in got[3]) and len(got[3]) == 2, got)
    got = S.try_hosts(plan, lambda src, h: '', lambda h: ('r', 'bad'))
    check('try: every host failed -> None', got[0] is None and len(got[3]) == 2, got)


def t_seed(S):
    """seed_cache through local "hosts" (bash with its own HOME): the cache arrives whole, no .seed.tmp is left, an
    existing cache is kept, and a missing source cache is an error (never an empty cache)."""
    root = tempfile.mkdtemp(prefix='sr-seed-')
    try:
        homes = {n: os.path.join(root, n) for n in ('src', 'dst', 'empty')}
        h = 'abcdef012345'
        nm = os.path.join(homes['src'], 'ci', '.nm-cache', h, 'node_modules', 'pkg')
        os.makedirs(nm)
        open(os.path.join(nm, 'index.js'), 'w').write('module.exports = 1\n')
        os.makedirs(os.path.join(homes['empty'], 'ci', '.nm-cache'))
        stub = _stub_path(root)
        S.SSH = ['bash', '-c']
        for n, hm in homes.items():
            S.HOSTS[n] = f'export HOME={hm} PATH={stub}:$PATH; eval "$0"'
        bad = S.seed_cache('src', 'dst', h, timeout_s=60)
        dst = os.path.join(homes['dst'], 'ci', '.nm-cache')
        check('seed: ok', bad == '', bad)
        check('seed: the file arrived', os.path.isfile(os.path.join(dst, h, 'node_modules', 'pkg', 'index.js')))
        check('seed: no .seed.tmp left', not os.path.exists(os.path.join(dst, h + '.seed.tmp')), os.listdir(dst))
        open(os.path.join(dst, h, 'node_modules', 'pkg', 'mine'), 'w').write('x')
        bad = S.seed_cache('src', 'dst', h, timeout_s=60)
        check('seed: an existing cache is kept', bad == '' and os.path.exists(os.path.join(dst, h, 'node_modules', 'pkg', 'mine')), bad)
        S.HOSTS['dst2'] = f'export HOME={os.path.join(root, "dst2")} PATH={stub}:$PATH; eval "$0"'
        bad = S.seed_cache('empty', 'dst2', h, timeout_s=60)
        check('seed: no source cache -> an error', bad != '', bad)
        check('seed: ... and no cache made', not os.path.exists(os.path.join(root, 'dst2', 'ci', '.nm-cache', h)))
        check('seed: ... and no .seed.tmp left', not os.path.exists(os.path.join(root, 'dst2', 'ci', '.nm-cache', h + '.seed.tmp')))
        check('seed: a bad hash is refused', S.seed_cache('src', 'dst', '../x') != '')
    finally:
        shutil.rmtree(root, ignore_errors=True)


def t_relay_retry(_S=None):
    spec = importlib.util.spec_from_file_location('relay_r', HERE_RELAY[0])
    R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
    out = ('attempt host=w30 result=prep-failed node_modules prep failed (rc 3)\n'
           'attempt host=ci2 result=seed-failed x\nsuite-run: no host could prepare the run')
    check('relay: failed hosts parsed', R.failed_hosts(out) == ['w30', 'ci2'], R.failed_hosts(out))
    check('relay: 1st failure -> suite-run picks', R.next_args({'fails': 1, 'hosts': ['w30']}) == [])
    check('relay: 2nd failure on w30 -> try ci2', R.next_args({'fails': 2, 'hosts': ['w30']}) == ['--host', 'ci2'])
    check('relay: 2nd failure on ci2 -> try w30', R.next_args({'fails': 2, 'hosts': ['ci2']}) == ['--host', 'w30'])
    check('relay: every host failed -> suite-run picks', R.next_args({'fails': 5, 'hosts': ['ci2', 'w30']}) == [])
    k = 'gkwork-01--e6a1ea2b042e--76db6dd20bb6'
    check('relay: a retried key with a stale .expired is LIVE (11-07 drop/start cycle)', R.gone_keys({k: {}}, {k}) == set())
    check('relay: an .expired with no .req is gone', R.gone_keys({}, {k}) == {k})
    t = R.record_failure({}, out, [])
    check('relay: a failure is counted with its hosts', t == {'fails': 1, 'hosts': ['ci2', 'w30']}, t)
    t = R.record_failure({'fails': 1, 'hosts': ['w30']}, 'suite-run: no test host answered', ['--host', 'ci2'])
    check('relay: a forced host that failed is recorded', t == {'fails': 2, 'hosts': ['ci2', 'w30']}, t)
    # the incident: two passes fail on w30 -> the 3rd start forces ci2, and exactly one alarm is due over the passes
    t, alarms, args = {}, 0, []
    for _ in range(5):
        args.append(R.next_args(t))
        t = R.record_failure(t, 'attempt host=w30 result=prep-failed rc 3' if not args[-1] else '', args[-1])
        if R.should_alarm(t):
            alarms += 1; t['alarmed'] = True
    check('relay: incident -> ci2 forced from the 3rd start', args[:3] == [[], [], ['--host', 'ci2']], args)
    check('relay: incident -> ONE alarm over 5 failed passes', alarms == 1, alarms)
    check('relay: no alarm on the 1st failure', not R.should_alarm({'fails': 1}))
    check('relay: alarm on the 2nd', R.should_alarm({'fails': 2}))
    check('relay: alarm ONCE', not R.should_alarm({'fails': 9, 'alarmed': True}))
    check('relay: parse_detach takes the host= line, not an attempt line',
          R.parse_detach('attempt host=w30 result=prep-failed x (y) label=z remote_log=~/q\n'
                         'host=ci2 (mike@x; lock free) label=ar-k sha=1 remote_log=~/ci/ar-k.log local_log=/tmp/l\n')
          == ('ci2', 'ar-k', 'ci/ar-k.log'))


def datetime_now():
    import datetime as dt
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def _td(m):
    import datetime as dt
    return dt.timedelta(minutes=m)


MUTANTS = [
    ("[ -n \"$(find \"$l\" -mmin +{stale_min})\" ]", "false", t_prune),
    ("    safe = re.sub(r'[^A-Za-z0-9._-]+', '-', label).lstrip('.-') or 'run'", "    safe = re.sub(r'[^A-Za-z0-9._-]+', '-', label) or 'run'", t_mirror_ref),
    ("    if now - started > deadline_s:\n        return 'deadline'", "    if False:\n        return 'deadline'", t_wait),
    ("    if line is None and now - last_ok > ssh_down_s:", "    if False:", t_wait),
    ("    added = sorted(p for p in git_lines(wt, 'ls-files', '-z', '--cached') if p not in head",
     "    added = sorted(p for p in git_lines(wt, 'ls-files', '-z', '--cached', '--others') if p not in head", t_overlay),
    ("    deleted = sorted(p for p in head if not p.startswith(SKIP_PREFIXES) and not os.path.lexists(os.path.join(wt, p)))",
     "    deleted = sorted(p for p in git_lines(wt, 'ls-files', '-z', '--deleted') if not p.startswith(SKIP_PREFIXES))", t_overlay),
    # 11-07 fallback
    ("        return next((s for s in holders if s != h), False)", "        return False", t_plan),
    ("    hosts = [forced] if forced else sorted(up, key=lambda h: (0, 0, order.index(h)) if up[h]['free']",
     "    hosts = [forced] if forced else sorted(up, key=lambda h: (0, 0, order.index(h)) if not up[h]['free']", t_plan),
    ("        (last if s is False else plan).append((h, None if s is False else s))", "        (plan if s is False else plan).append((h, None if s is False else s))", t_plan),
    ("        if bad:\n            failed(host, 'seed-failed', bad)\n            tried.append(f'{host}: {bad}')\n            continue",
     "        if bad:\n            failed(host, 'seed-failed', bad)\n            tried.append(f'{host}: {bad}')\n            break", t_try),
    ("        if bad:\n            failed(host, 'prep-failed', bad)\n            tried.append(f'{host}: {bad}')\n            continue",
     "        if False:\n            continue", t_try),
    ("test -d {h}.seed.tmp/{h}/node_modules; '", "mkdir -p {h}.seed.tmp/{h}; '", t_seed),
    ("    if cons.returncode != 0 or ('present' not in out and prc != 0):", "    if False:", t_seed),
    ('trap \"rm -rf {h}.seed.tmp\" EXIT; ', '', t_seed),
    ("        bad = one_line(bad)\n", "", t_try),
    ("        bad = one_line(seed(src, host) if src else '')", "        bad = seed(src, host) if src else ''", t_try),
    ('case "$d" in ./.nm-cache|./.git-mirror.git) continue;; esac; ', '', t_prune),
]

RELAY_SRC = os.path.join(HERE, 'autorebase-suite-relay.py')
RELAY_MUTANTS = [
    ("    if int(tries.get('fails') or 0) < 2:\n        return []", "    if False:\n        return []"),
    ("    return int(tries.get('fails') or 0) >= 2 and not tries.get('alarmed')", "    return int(tries.get('fails') or 0) >= 2"),
    ("    other = [h for h in hosts if h not in bad]", "    other = list(hosts)"),
    ("    return set(expired) - set(live)", "    return set(expired)"),
    ("    t['fails'] = int(t.get('fails') or 0) + 1", "    t['fails'] = int(t.get('fails') or 0)"),
]


def relay_mutants():
    src = open(RELAY_SRC).read()
    killed = 0
    for old, new in RELAY_MUTANTS:
        assert src.count(old) == 1, f'RELAY MUTANT ANCHOR MISSING OR NOT UNIQUE: {old!r} x{src.count(old)}'
        fd, path = tempfile.mkstemp(suffix='.py', dir=HERE)
        os.write(fd, src.replace(old, new).encode()); os.close(fd)
        FAILS.clear()
        saved = HERE_RELAY[0]
        HERE_RELAY[0] = path
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                t_relay_retry()
        except Exception as e:      # noqa: BLE001
            FAILS.append(f'crash {e}')
        finally:
            HERE_RELAY[0] = saved
            os.unlink(path)
        if FAILS:
            killed += 1
        else:
            print(f'RELAY MUTANT SURVIVED: {old.strip()[:80]!r}')
    return killed


def main():
    S = load()
    for t in (t_wait, t_ship, t_overlay, t_mirror_ref, t_prune, t_relay, t_plan, t_probe, t_try, t_seed, t_relay_retry):
        t(S)
    base = list(FAILS)
    for f in base:
        print('FAIL', f)
    src = open(SRC).read()
    killed = 0
    for old, new, test in MUTANTS:
        assert src.count(old) == 1, f'MUTANT ANCHOR MISSING OR NOT UNIQUE: {old!r} x{src.count(old)}'
        FAILS.clear()
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                test(load(src.replace(old, new)))
        except Exception as e:      # noqa: BLE001
            FAILS.append(f'crash {e}')
        if FAILS:
            killed += 1
        else:
            print(f'MUTANT SURVIVED: {old.strip()[:80]!r}')
    rk = relay_mutants()
    FAILS[:] = base
    print(f'suite-run tests: {"FAIL" if base else "ok"} ({len(base)} failures); mutants killed {killed}/{len(MUTANTS)}; '
          f'relay mutants killed {rk}/{len(RELAY_MUTANTS)}')
    return 1 if base or killed < len(MUTANTS) or rk < len(RELAY_MUTANTS) else 0


if __name__ == '__main__':
    sys.exit(main())
