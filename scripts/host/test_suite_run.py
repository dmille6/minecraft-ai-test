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
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'suite-run.py')
FAILS = []
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


def datetime_now():
    import datetime as dt
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def _td(m):
    import datetime as dt
    return dt.timedelta(minutes=m)


MUTANTS = [
    ("    safe = re.sub(r'[^A-Za-z0-9._-]+', '-', label).lstrip('.-') or 'run'", "    safe = re.sub(r'[^A-Za-z0-9._-]+', '-', label) or 'run'", t_mirror_ref),
    ("    if now - started > deadline_s:\n        return 'deadline'", "    if False:\n        return 'deadline'", t_wait),
    ("    if line is None and now - last_ok > ssh_down_s:", "    if False:", t_wait),
    ("    added = sorted(p for p in git_lines(wt, 'ls-files', '-z', '--cached') if p not in head",
     "    added = sorted(p for p in git_lines(wt, 'ls-files', '-z', '--cached', '--others') if p not in head", t_overlay),
    ("    deleted = sorted(p for p in head if not p.startswith(SKIP_PREFIXES) and not os.path.lexists(os.path.join(wt, p)))",
     "    deleted = sorted(p for p in git_lines(wt, 'ls-files', '-z', '--deleted') if not p.startswith(SKIP_PREFIXES))", t_overlay),
]


def main():
    S = load()
    for t in (t_wait, t_ship, t_overlay, t_mirror_ref, t_relay):
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
    FAILS[:] = base
    print(f'suite-run tests: {"FAIL" if base else "ok"} ({len(base)} failures); mutants killed {killed}/{len(MUTANTS)}')
    return 1 if base or killed < len(MUTANTS) else 0


if __name__ == '__main__':
    sys.exit(main())
