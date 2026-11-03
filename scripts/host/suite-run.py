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

Known failures on a copied tree (no .git): nothing-important-is-orphaned, protected-paths, plus the
base failures listed in docs/reports/STATE.md's notes at the time; compare against a base run, not zero.

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
import time

HOSTS = {
    'ci2': 'mike@10.0.0.34',
    'w30': 'mike@10.0.0.30',
}
ORDER = ['ci2', 'w30']
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
SKIP_PREFIXES = ('.wt-', 'videos/', '.claude/')


def ssh(host, cmd, **kw):
    return subprocess.run(SSH + [HOSTS[host], cmd], text=True, capture_output=True, **kw)


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


def ship(host, wt, ref, dest):
    mk = f'rm -rf {dest} && mkdir -p {dest} && tar -xzf - -C {dest}'
    env = dict(os.environ, COPYFILE_DISABLE='1')
    if ref:
        prod = subprocess.Popen(['git', '-C', wt, 'archive', '--format=tar.gz', ref], stdout=subprocess.PIPE)
    else:
        files = tree_files(wt)
        prod = subprocess.Popen(['tar', '-czf', '-', '--no-xattrs', '-C', wt, '--null', '-T', '-'],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
        prod.stdin.write(('\0'.join(files) + '\0').encode())
        prod.stdin.close()
    r = subprocess.run(SSH + [HOSTS[host], mk], stdin=prod.stdout, text=True, capture_output=True)
    prod.stdout.close()
    if prod.wait() != 0 or r.returncode != 0:
        sys.exit(f'suite-run: shipping the tree to {host} failed: {r.stderr.strip()}')


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
    a = ap.parse_args()

    wt = a.worktree or subprocess.run(['git', 'rev-parse', '--show-toplevel'], text=True,
                                      capture_output=True, check=True).stdout.strip()
    wt = os.path.abspath(wt)
    sha = subprocess.run(['git', '-C', wt, 'rev-parse', '--short=8', a.ref or 'HEAD'], text=True,
                         capture_output=True, check=True).stdout.strip()
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

    ship(host, wt, a.ref, dest)
    r = subprocess.run(SSH + [HOSTS[host], 'bash -s -- ' + shlex.quote(f'/home/mike/{dest}')],
                       input=REMOTE_PREP, text=True, capture_output=True)
    if r.returncode != 0:
        sys.exit(f'suite-run: node_modules prep on {host} failed: {r.stderr.strip()}')
    print(f'node {r.stdout.strip()} on {host}; tree ~/{dest}', flush=True)

    filt = (' ' + shlex.quote(a.filter)) if a.filter else ''
    cleanup = '' if a.keep else f'; rm -rf ~/{dest}/bots/node_modules'
    inner = (f'export PATH=$HOME/coopb5/node22/bin:$PATH; cd ~/{dest}/bots && '
             f'flock ~/suite.lock nice -n 19 env TEST_JOBS=6 node scripts/run-tests.mjs{filt} > ~/{rlog} 2>&1; '
             f'echo "DONE rc=$?" >> ~/{rlog}{cleanup}')
    start = f'touch ~/suite.lock; : > ~/{rlog}; setsid nohup bash -c {shlex.quote(inner)} >/dev/null 2>&1 < /dev/null & echo started'
    r = ssh(host, start)
    if 'started' not in r.stdout:
        sys.exit(f'suite-run: start on {host} failed: {r.stderr.strip()}')
    t0 = time.time()
    if a.detach:
        print(f'detached. follow: ssh {HOSTS[host]} tail -f ~/{rlog}   (ends with "DONE rc=N")')
        return 0

    last = ''
    while True:
        time.sleep(30)
        r = ssh(host, f'tail -n 1 ~/{rlog}')
        if r.returncode != 0:
            continue  # transient ssh failure: keep waiting, the run is detached on the host
        line = r.stdout.strip()
        if line.startswith('DONE rc='):
            break
        if line != last and ('[' in line and '/' in line):
            last = line
    os.makedirs(os.path.dirname(llog) or '.', exist_ok=True)
    subprocess.run(['scp', '-q', '-o', 'BatchMode=yes', f'{HOSTS[host]}:{rlog}', llog], check=False)
    try:
        lines = open(llog).read().splitlines()
    except OSError:
        lines = ssh(host, f'cat ~/{rlog}').stdout.splitlines()
    summary = [l for l in lines if l.startswith(('wall ', 'FAILED (', 'DONE rc=')) or l.endswith(' files passed')]
    print(f'--- {host} {label} ({(time.time() - t0) / 60:.1f} min incl. lock wait) ---')
    print('\n'.join(summary))
    rc = next((int(l.split('=', 1)[1]) for l in reversed(lines) if l.startswith('DONE rc=')), 1)
    return rc


if __name__ == '__main__':
    sys.exit(main())
