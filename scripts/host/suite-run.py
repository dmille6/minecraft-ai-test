#!/usr/bin/env python3
"""suite-run: run the FULL bots test suite on a test host, never on the Mac mini.

OWNER 2026-11-03 "build the 2nd test suite on pve3". Two hosts share one convention: a
per-host `~/suite.lock` (flock), `nice -n 19`, `TEST_JOBS=6`, and a copied tree under ~/ci/.

    ci2   mike@10.0.0.34  vm-minecraft-ci2 (pve3 vmid 107, 16 vCPU / 24 GB), the dedicated test host
    w30   mike@10.0.0.30  block2-worlds (also runs the fleet's Paper worlds; user-space Node 22)

Usage (from the Mac, any worktree):

    python3 scripts/host/suite-run.py [WORKTREE] [--ref REF] [--label L] [--host ci2|w30]
                                      [--filter SUBSTR] [--log PATH] [--detach] [--keep]

  WORKTREE   default: the current directory's git top level. The tree shipped is that worktree AS IT
             STANDS (tracked files with their uncommitted edits, plus untracked non-ignored files;
             .wt-*/, videos/ and .claude/ are left out). With --ref, `git archive REF` is shipped instead.
  --host     force a host. Default: the first host whose ~/suite.lock is free (`flock -n`), ci2 first;
             if both are busy, queue on the host with fewer flock holders+waiters (ties -> ci2).
  --filter   passed to run-tests.mjs as its file-name filter (argv[2]).
  --log      local copy of the log (default /tmp/suite-run/<label>.<host>.log). The remote log is
             ~/ci/<label>.log on the host; the tree is ~/ci/<label>/ (bots/node_modules removed after).
  --detach   start the run and return; the printed `tail` command follows it.

It prints `host=... label=... remote_log=...` at the start and, when the run ends, the runner's own
summary lines (`wall ...`, `FAILED (n): ...`, `N/M files passed`) and `DONE rc=N`. Exit code = rc.

GIT CONTEXT (phase 1 item 3, 11-06). 121 of 152 ci2 runs were red on exactly three files -- ceilescape,
nothing-important-is-orphaned, protected-paths -- because the shipped tree had no .git (git rev-parse / ls-files /
git show 3cc5f14d). Now the tree is a real checkout: the commit is pushed (incrementally, the first push ~600 MB once) to
a bare mirror on the host (~/ci/.git-mirror.git, ref refs/suite/<label>), cloned --shared at that sha, and in worktree
mode the working tree is laid over it (uncommitted edits, untracked files; files deleted locally are deleted; files added
to the local index are `git add`ed), so ls-files / status answer as they would here. --no-git ships the bare tree as
before; the three files then print `SKIP (no git ...)` and exit 77, which run-tests.mjs reports as SKIPPED, never as a
pass or a failure.

DEADLINES (the same fix). ship() wrote the whole NUL file list into tar's stdin before ssh read tar's stdout, so a list
over the pipe buffer deadlocked; the wait loop had no deadline (runners hung up to 27 h). Now the list goes to a temp
file (`tar -T file`), and every stage has a deadline: upload --upload-min (10), node_modules prep 20 min, the lock wait
--lock-wait-min (60: `flock -w`, exit 75 = LOCK TIMEOUT), the suite --suite-min (60: `timeout -k 60`, exit 124 =
SUITE DEADLINE), the local wait = lock wait + suite + 10 min, and ssh unreachable for 10 min in a row stops the wait
(rc 2; the detached run continues on the host). The remote log always ends with `DONE rc=N`.

Old trees: a ~/ci/<label> directory whose log ended DONE more than PRUNE_DAYS (3) days ago is removed at the next run on
that host (ci2 held 40 GB of them, 12 GB free, on 11-06); the logs are kept.

node_modules: each host keeps ~/ci/.nm-cache/<sha256(package-lock)[:12]>/node_modules (made with
`npm ci` where npm exists -- ci2 -- or seeded from an existing ~/ci/*/bots tree with an identical
package-lock.json -- w30, which has no npm) and copies it into the tree.
"""
import argparse
import datetime as dt
import os
import shlex
import subprocess
import sys
import tempfile
import time

HOSTS = {
    'ci2': 'mike@10.0.0.34',
    'w30': 'mike@10.0.0.30',
}
ORDER = ['ci2', 'w30']
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
SKIP_PREFIXES = ('.wt-', 'videos/', '.claude/')


def ssh(host, cmd, timeout=120, **kw):
    """One ssh command with a deadline; a timeout reads as a failed command (rc 255), never a hang."""
    try:
        return subprocess.run(SSH + [HOSTS[host], cmd], text=True, capture_output=True, timeout=timeout, **kw)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, 255, '', f'ssh timed out after {timeout} s')


def lock_free(host):
    r = ssh(host, 'touch ~/suite.lock && flock -n ~/suite.lock true')
    return r.returncode == 0


def lock_users(host):
    # holders + waiters: every process whose argv starts with flock on this lock (grep's own argv starts with "grep")
    r = ssh(host, "ps -eo args | grep -c '^flock .*suite\\.lock' || true")
    try:
        return int((r.stdout or '0').strip().splitlines()[-1])
    except (ValueError, IndexError):
        return 10 ** 6  # unreachable host sorts last


def pick_host():
    for h in ORDER:
        if lock_free(h):
            return h, 'lock free'
    counts = {h: lock_users(h) for h in ORDER}
    h = min(ORDER, key=lambda x: (counts[x], ORDER.index(x)))
    return h, f'both busy, queued on fewer waiters {counts}'


def tree_files(wt):
    out = subprocess.run(['git', '-C', wt, 'ls-files', '-z', '-co', '--exclude-standard'],
                         capture_output=True, check=True).stdout
    files = []
    for p in out.decode().split('\0'):
        if not p or p.startswith(SKIP_PREFIXES):
            continue
        if os.path.lexists(os.path.join(wt, p)) and not os.path.isdir(os.path.join(wt, p)):
            files.append(p)
    return sorted(set(files))


MIRROR = 'ci/.git-mirror.git'
PRUNE_DAYS = 3
SSH_DOWN_S = 600
LOCK_TIMEOUT_RC = 75
SUITE_TIMEOUT_RC = 124


def run_deadline(argv, timeout, **kw):
    """subprocess.run with a deadline; -> CompletedProcess, or None when it timed out (the child is killed)."""
    try:
        return subprocess.run(argv, timeout=timeout, **kw)
    except subprocess.TimeoutExpired:
        return None


def ship(host, wt, ref, dest, timeout_s=600, files=None):
    """Upload the tree (worktree mode: `files`, a list of paths) or `git archive ref` and unpack it into ~/dest.
    The file list goes to a temp file (tar -T): nothing is written to a pipe before its reader runs (the old deadlock)."""
    mk = f'mkdir -p {dest} && tar -xzf - -C {dest}'
    env = dict(os.environ, COPYFILE_DISABLE='1')
    lst = None
    if ref and files is None:
        prod = subprocess.Popen(['git', '-C', wt, 'archive', '--format=tar.gz', ref], stdout=subprocess.PIPE)
    else:
        fd, lst = tempfile.mkstemp(prefix='suite-run-', suffix='.lst')
        with os.fdopen(fd, 'wb') as f:
            f.write(('\0'.join(files) + '\0').encode())
        prod = subprocess.Popen(['tar', '-czf', '-', '--no-xattrs', '-C', wt, '--null', '-T', lst],
                                stdout=subprocess.PIPE, env=env)
    try:
        cons = subprocess.Popen(SSH + [HOSTS[host], mk], stdin=prod.stdout, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        prod.stdout.close()          # the consumer owns the read end now; tar sees EPIPE if ssh dies
        try:
            _, err = cons.communicate(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            cons.kill(); prod.kill()
            sys.exit(f'suite-run: shipping the tree to {host} took over {timeout_s // 60} min (killed)')
        try:
            prc = prod.wait(timeout=60)
        except subprocess.TimeoutExpired:
            prod.kill(); prc = -9
        if prc != 0 or cons.returncode != 0:
            sys.exit(f'suite-run: shipping the tree to {host} failed (tar {prc}, ssh {cons.returncode}): {(err or "").strip()[:300]}')
    finally:
        if lst:
            os.unlink(lst)


def git_lines(wt, *a):
    out = subprocess.run(['git', '-C', wt] + list(a), capture_output=True, check=True).stdout
    return [p for p in out.decode().split('\0') if p]


def worktree_overlay(wt):
    """-> (files to ship, files to delete, files to `git add`) so the remote checkout answers ls-files / status as this
    worktree does: deleted = tracked at HEAD and absent here; add = in the local index but not in HEAD."""
    files = tree_files(wt)
    head = set(git_lines(wt, 'ls-tree', '-r', '-z', '--name-only', 'HEAD'))
    # in HEAD but not on disk here: a plain delete AND a staged `git rm` (ls-files --deleted misses the second, Codex r1)
    deleted = sorted(p for p in head if not p.startswith(SKIP_PREFIXES) and not os.path.lexists(os.path.join(wt, p)))
    added = sorted(p for p in git_lines(wt, 'ls-files', '-z', '--cached') if p not in head and not p.startswith(SKIP_PREFIXES)
                   and os.path.lexists(os.path.join(wt, p)))
    return files, deleted, added


def push_mirror(host, wt, sha_full, label, timeout_s=1800):
    """Push the commit to the host's bare mirror (created on first use). -> '' on success, else why not."""
    r = run_deadline(SSH + [HOSTS[host], f'test -d {MIRROR} || git init -q --bare {MIRROR}'], 60, text=True,
                     capture_output=True)
    if r is None or r.returncode != 0:
        return f'mirror init failed ({"timeout" if r is None else (r.stderr or "").strip()[:160]})'
    url = f'ssh://{HOSTS[host]}/home/mike/{MIRROR}'
    env = dict(os.environ, GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=10')
    r = run_deadline(['git', '-C', wt, 'push', '-q', '--no-verify', '--force', url, f'{sha_full}:refs/suite/{label}'],
                     timeout_s, text=True, capture_output=True, env=env)
    if r is None:
        return f'mirror push took over {timeout_s // 60} min'
    if r.returncode != 0:
        return f'mirror push failed: {(r.stderr or "").strip()[:200]}'
    return ''


def remote_checkout(host, dest, sha_full, timeout_s=600):
    cmd = (f'rm -rf {dest} && git clone -q --shared --no-checkout {MIRROR} {dest} && '
           f'git -C {dest} -c advice.detachedHead=false checkout -q --detach {sha_full} && git -C {dest} rev-parse HEAD')
    r = run_deadline(SSH + [HOSTS[host], cmd], timeout_s, text=True, capture_output=True)
    if r is None or r.returncode != 0 or sha_full not in (r.stdout or ''):
        return f'remote checkout failed ({"timeout" if r is None else (r.stderr or "").strip()[:200]})'
    return ''


def remote_fixup(host, dest, deleted, added, timeout_s=300):
    """Delete the locally deleted files and `git add` the locally added ones in the remote checkout (NUL lists)."""
    if not deleted and not added:
        return ''
    for name, lst in (('del', deleted), ('add', added)):
        data = b''.join(os.fsencode(p) + b'\0' for p in lst)
        r = run_deadline(SSH + [HOSTS[host], f'cat > {dest}.{name}.lst'], 60, input=data, capture_output=True)
        if r is None or r.returncode != 0:
            return f'remote fixup: list upload failed'
    cmd = (f'cd {dest} && xargs -0 -r rm -f -- < ../{os.path.basename(dest)}.del.lst && '
           f'if [ -s ../{os.path.basename(dest)}.add.lst ]; then git add --pathspec-from-file=../{os.path.basename(dest)}.add.lst '
           f'--pathspec-file-nul; fi; rc=$?; rm -f ../{os.path.basename(dest)}.del.lst ../{os.path.basename(dest)}.add.lst; exit $rc')
    r = run_deadline(SSH + [HOSTS[host], cmd], timeout_s, text=True, capture_output=True)
    if r is None or r.returncode != 0:
        return f'remote fixup failed ({"timeout" if r is None else (r.stderr or "").strip()[:200]})'
    return ''


def prune_remote(host, days=PRUNE_DAYS):
    """Remove ~/ci/<label> trees whose log ended DONE more than `days` ago (logs kept). Best effort, bounded."""
    cmd = (f'cd ~/ci 2>/dev/null || exit 0; find . -maxdepth 1 -name "*.log" -mtime +{days} -print0 | '
           f'while IFS= read -r -d "" l; do d="${{l%.log}}"; [ -d "$d" ] && tail -n 1 "$l" | grep -q "^DONE rc=" '
           f'&& rm -rf -- "$d"; done; true')
    run_deadline(SSH + [HOSTS[host], cmd], 600, text=True, capture_output=True)


def wait_action(now, started, last_ok, line, deadline_s, ssh_down_s=SSH_DOWN_S):
    """PURE. One poll of the remote log -> 'done' | 'wait' | 'deadline' | 'unreachable'. line is None when ssh failed."""
    if line is not None and line.startswith('DONE rc='):
        return 'done'
    if now - started > deadline_s:
        return 'deadline'
    if line is None and now - last_ok > ssh_down_s:
        return 'unreachable'
    return 'wait'


REMOTE_PREP = r'''
set -e
export PATH=$HOME/coopb5/node22/bin:$PATH
D=$1
L=$D/bots/package-lock.json
H=$(sha256sum "$L" | cut -c1-12)
C=$HOME/ci/.nm-cache/$H
mkdir -p "$HOME/ci/.nm-cache"
(
  flock 9
  if [ ! -d "$C/node_modules" ]; then
    rm -rf "$C.tmp"; mkdir -p "$C.tmp"
    if command -v npm >/dev/null; then
      cp "$D/bots/package.json" "$L" "$C.tmp/"
      (cd "$C.tmp" && npm ci --no-audit --no-fund --loglevel=error >/dev/null)
    else
      SRC=""
      for f in $(ls -t "$HOME"/ci/*/bots/package-lock.json 2>/dev/null); do
        b=$(dirname "$f")
        if [ "$b" != "$D/bots" ] && [ -d "$b/node_modules" ] && cmp -s "$f" "$L"; then SRC=$b; break; fi
      done
      [ -n "$SRC" ] || { echo "no npm on this host and no ~/ci tree with an identical package-lock.json to seed node_modules from" >&2; exit 3; }
      cp -a "$SRC/node_modules" "$C.tmp/"
    fi
    mv "$C.tmp" "$C"
  fi
) 9>"$HOME/ci/.nm-cache/.lock"
rm -rf "$D/bots/node_modules"
cp -a "$C/node_modules" "$D/bots/node_modules"
node -v
'''


def main():
    ap = argparse.ArgumentParser(description='Run the full bots suite on ci2 (10.0.0.34) or .30 under ~/suite.lock.')
    ap.add_argument('worktree', nargs='?')
    ap.add_argument('--ref')
    ap.add_argument('--label')
    ap.add_argument('--host', choices=ORDER)
    ap.add_argument('--filter', default='')
    ap.add_argument('--log')
    ap.add_argument('--detach', action='store_true')
    ap.add_argument('--keep', action='store_true', help='keep bots/node_modules in the remote tree')
    ap.add_argument('--no-git', action='store_true', help='ship a bare tree (no .git): the git-only tests SKIP')
    ap.add_argument('--upload-min', type=int, default=10)
    ap.add_argument('--lock-wait-min', type=int, default=60)
    ap.add_argument('--suite-min', type=int, default=60)
    a = ap.parse_args()

    wt = a.worktree or subprocess.run(['git', 'rev-parse', '--show-toplevel'], text=True,
                                      capture_output=True, check=True).stdout.strip()
    wt = os.path.abspath(wt)
    sha_full = subprocess.run(['git', '-C', wt, 'rev-parse', (a.ref or 'HEAD') + '^{commit}'], text=True,
                              capture_output=True, check=True).stdout.strip()
    sha = sha_full[:8]
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%m%dT%H%M%SZ')
    label = a.label or f'{os.path.basename(wt)}-{sha}-{stamp}'
    label = ''.join(c if c.isalnum() or c in '-_.' else '-' for c in label)

    if a.host:
        host, why = a.host, 'forced'
    else:
        host, why = pick_host()
    dest = f'ci/{label}'
    rlog = f'ci/{label}.log'
    llog = a.log or f'/tmp/suite-run/{label}.{host}.log'
    print(f'host={host} ({HOSTS[host]}; {why}) label={label} sha={sha}{" (worktree as it stands)" if not a.ref else ""} '
          f'remote_log=~/{rlog} local_log={llog}', flush=True)
    prune_remote(host)

    git_ctx = not a.no_git
    if git_ctx:
        why_not = push_mirror(host, wt, sha_full, label) or remote_checkout(host, dest, sha_full)
        if why_not:
            print(f'suite-run: NO GIT CONTEXT ({why_not}); shipping a bare tree -- the git-only tests will SKIP', flush=True)
            git_ctx = False
    if git_ctx:
        if not a.ref:
            files, deleted, added = worktree_overlay(wt)
            ship(host, wt, None, dest, timeout_s=a.upload_min * 60, files=files)
            bad = remote_fixup(host, dest, deleted, added)
            if bad:
                sys.exit(f'suite-run: {bad}')
        print(f'git context: a checkout of {sha} on {host}' + ('' if a.ref else ' with this worktree laid over it'), flush=True)
    else:
        ssh(host, f'rm -rf {dest}', timeout=600)
        ship(host, wt, a.ref, dest, timeout_s=a.upload_min * 60, files=None if a.ref else tree_files(wt))
    r = subprocess.run(SSH + [HOSTS[host], 'bash -s -- ' + shlex.quote(f'/home/mike/{dest}')],
                       input=REMOTE_PREP, text=True, capture_output=True, timeout=20 * 60)
    if r.returncode != 0:
        sys.exit(f'suite-run: node_modules prep on {host} failed: {r.stderr.strip()}')
    print(f'node {r.stdout.strip()} on {host}; tree ~/{dest}', flush=True)

    filt = (' ' + shlex.quote(a.filter)) if a.filter else ''
    cleanup = '' if a.keep else f'; rm -rf ~/{dest}/bots/node_modules'
    lock_s, suite_s = a.lock_wait_min * 60, a.suite_min * 60
    inner = (f'export PATH=$HOME/coopb5/node22/bin:$PATH; cd ~/{dest}/bots && '
             f'flock -w {lock_s} -E {LOCK_TIMEOUT_RC} ~/suite.lock timeout -k 60 {suite_s} nice -n 19 env TEST_JOBS=6 '
             f'node scripts/run-tests.mjs{filt} > ~/{rlog} 2>&1; rc=$?; '
             f'[ $rc = {LOCK_TIMEOUT_RC} ] && echo "LOCK TIMEOUT: ~/suite.lock busy for {a.lock_wait_min} min" >> ~/{rlog}; '
             f'[ $rc = {SUITE_TIMEOUT_RC} ] && echo "SUITE DEADLINE: killed after {a.suite_min} min" >> ~/{rlog}; '
             f'echo "DONE rc=$rc" >> ~/{rlog}{cleanup}')
    start = f'touch ~/suite.lock; : > ~/{rlog}; setsid nohup bash -c {shlex.quote(inner)} >/dev/null 2>&1 < /dev/null & echo started'
    r = ssh(host, start)
    if 'started' not in r.stdout:
        sys.exit(f'suite-run: start on {host} failed: {r.stderr.strip()}')
    t0 = time.time()
    if a.detach:
        print(f'detached. follow: ssh {HOSTS[host]} tail -f ~/{rlog}   (ends with "DONE rc=N")')
        return 0

    deadline_s = lock_s + suite_s + 600
    last_ok = t0
    while True:
        time.sleep(30)
        r = ssh(host, f'tail -n 1 ~/{rlog}', timeout=60)
        line = r.stdout.strip() if r.returncode == 0 else None
        if line is not None:
            last_ok = time.time()
        act = wait_action(time.time(), t0, last_ok, line, deadline_s)
        if act == 'done':
            break
        if act in ('deadline', 'unreachable'):
            print(f'suite-run: {"LOCAL DEADLINE" if act == "deadline" else "HOST UNREACHABLE for 10 min"}: stopped waiting '
                  f'after {(time.time() - t0) / 60:.0f} min; the run continues on {host}: ssh {HOSTS[host]} tail ~/{rlog}')
            return 2
    os.makedirs(os.path.dirname(llog) or '.', exist_ok=True)
    run_deadline(['scp', '-q', '-o', 'BatchMode=yes', f'{HOSTS[host]}:{rlog}', llog], 300)
    try:
        lines = open(llog).read().splitlines()
    except OSError:
        lines = ssh(host, f'cat ~/{rlog}').stdout.splitlines()
    summary = [l for l in lines if l.startswith(('wall ', 'FAILED (', 'SKIPPED (', 'DONE rc=', 'LOCK TIMEOUT', 'SUITE DEADLINE'))
               or l.endswith(' files passed')]
    print(f'--- {host} {label} ({(time.time() - t0) / 60:.1f} min incl. lock wait; git context: {"yes" if git_ctx else "NO"}) ---')
    print('\n'.join(summary))
    rc = next((int(l.split('=', 1)[1]) for l in reversed(lines) if l.startswith('DONE rc=')), 1)
    return rc


if __name__ == '__main__':
    sys.exit(main())
