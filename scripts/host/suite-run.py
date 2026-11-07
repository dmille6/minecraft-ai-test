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
  --host     force a host. Default: host_plan -- lock-free hosts first (ci2 first), then busy ones by fewer flock
             holders+waiters; a host without npm or this lock's node_modules cache is seeded from one that has it,
             and a host whose seed or prep fails is skipped for the next (FALLBACK below).
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

Old trees: a ~/ci/<label> directory whose log ended DONE more than PRUNE_MIN (12 h) ago, or whose log is over 24 h old, is removed at the next run on
that host (ci2 held 40 GB of them, 12 GB free, on 11-06); the logs are kept.

FALLBACK (incident 11-07). The fleet base moved to a new package-lock (ede0e5d23b1a); w30 has no npm and no seed tree, so
its prep failed, and the old pick_host chose w30 every time ci2's lock was busy: 100 min of retries, then the autorebase ran the
suite on the loaded fleet host. Now one probe per host reads (lock free, cache for THIS lock hash, npm, waiters), host_plan
(PURE) orders the hosts and says which one needs its cache SEEDED from another host's (ssh src tar | ssh dst untar, over
the Mac, into a .seed.tmp then mv, under the cache's flock), and a host whose seed or prep fails is skipped for the next
one in the plan. Each failed try prints `attempt host=<h> result=<why>`; the `host=...` line is printed once, for the
host that runs.

node_modules: each host keeps ~/ci/.nm-cache/<sha256(package-lock)[:12]>/node_modules (made with
`npm ci` where npm exists -- ci2 -- or seeded from an existing ~/ci/*/bots tree with an identical
package-lock.json -- w30, which has no npm) and copies it into the tree.
"""
import argparse
import datetime as dt
import os
import re
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


def parse_probe(out):
    """PURE. probe_cmd's stdout -> {'free', 'cache', 'npm': bool, 'waiters': int}, or None when the host did not answer."""
    lines = (out or '').split()
    if 'PROBED' not in lines:
        return None
    w = 0
    for i, tok in enumerate(lines):
        if tok == 'WAITERS' and i + 1 < len(lines) and lines[i + 1].isdigit():
            w = int(lines[i + 1])
    return {'free': 'FREE' in lines, 'cache': 'CACHE' in lines, 'npm': 'NPM' in lines, 'waiters': w}


def probe_cmd(lock_hash):
    h = lock_hash if lock_hash and re.match(r'^[0-9a-f]{12}$', lock_hash) else 'none'
    return ('touch ~/suite.lock; flock -n ~/suite.lock true && echo FREE; '
            f'test -d ~/ci/.nm-cache/{h}/node_modules && echo CACHE; '
            '(PATH=$HOME/coopb5/node22/bin:$PATH; command -v npm >/dev/null) && echo NPM; '
            "echo WAITERS $(ps -eo args | grep -c '^flock .*suite\\.lock'); echo PROBED")


def host_plan(order, probes, forced=None):
    """PURE. probes {host: parse_probe() or None} -> [(host, seed_from or None)], the order to try.
    A host is READY when it holds the cache for this lock hash or has npm; otherwise it is tried with its cache seeded
    from a host that holds it (busy or not: seeding reads the cache, not the lock). Lock-free hosts first (in `order`),
    then busy ones by fewer waiters (ties in order). A host with neither is kept, LAST, with no seed (its prep may still
    find a ~/ci tree to copy from). An unreachable host is left out. forced: only that host (seeded if it needs it)."""
    up = {h: p for h, p in probes.items() if p is not None and h in order}
    holders = [h for h in order if h in up and up[h]['cache']]

    def seed(h):
        if up[h]['cache'] or up[h]['npm']:
            return None
        return next((s for s in holders if s != h), False)
    hosts = [forced] if forced else sorted(up, key=lambda h: (0, 0, order.index(h)) if up[h]['free']
                                           else (1, up[h]['waiters'], order.index(h)))
    plan, last = [], []
    for h in hosts:
        if h not in up:
            continue
        s = seed(h)
        (last if s is False else plan).append((h, None if s is False else s))
    return plan + last


def one_line(why):
    """PURE. A failure detail flattened to one line: it goes into the `host=...` record, which the relay parses per line."""
    return ' '.join(str(why or '').split())


def try_hosts(plan, seed, prep, failed=lambda h, what, why: None):
    """Walk the plan: seed the host's cache when the plan says so, then prep it; a host whose seed or prep fails is skipped
    for the next. seed(src, host) -> '' | why; prep(host) -> (result, '' | why); failed(host, 'seed-failed'|'prep-failed',
    why) is told of each skip. -> (host, src, result, tried) -- host None when every host failed."""
    tried = []
    for host, src in plan:
        bad = one_line(seed(src, host) if src else '')
        if bad:
            failed(host, 'seed-failed', bad)
            tried.append(f'{host}: {bad}')
            continue
        res, bad = prep(host)
        bad = one_line(bad)
        if bad:
            failed(host, 'prep-failed', bad)
            tried.append(f'{host}: {bad}')
            continue
        return host, src, res, tried
    return None, None, None, tried


def lock_hash_of(wt, ref):
    """sha256(bots/package-lock.json)[:12] as the run will see it (the ref's blob, or the worktree's file), or None."""
    try:
        if ref:
            data = subprocess.run(['git', '-C', wt, 'show', f'{ref}:bots/package-lock.json'], capture_output=True,
                                  check=True).stdout
        else:
            data = open(os.path.join(wt, 'bots', 'package-lock.json'), 'rb').read()
    except (OSError, subprocess.CalledProcessError):
        return None
    import hashlib
    return hashlib.sha256(data).hexdigest()[:12]


def seed_dst_cmd(lock_hash):
    """The destination half of a cache seed: untar into <hash>.seed.tmp under the cache flock, then mv into place. A cache
    that appeared meanwhile is kept (the stream is drained)."""
    h = lock_hash
    return (f'set -e; mkdir -p ~/ci/.nm-cache; cd ~/ci/.nm-cache; exec 9>.lock; flock -w 1200 9; trap "rm -rf {h}.seed.tmp" EXIT; '
            f'if [ -d {h}/node_modules ]; then cat >/dev/null; echo present; exit 0; fi; '
            f'rm -rf {h}.seed.tmp; mkdir {h}.seed.tmp; tar -xzf - -C {h}.seed.tmp; test -d {h}.seed.tmp/{h}/node_modules; '
            f'rm -rf {h}; mv {h}.seed.tmp/{h} {h}; rmdir {h}.seed.tmp; echo seeded')


def seed_cache(src, dst, lock_hash, timeout_s=1200):
    """Copy ~/ci/.nm-cache/<hash> from src to dst through this machine (the test hosts have no keys to each other).
    -> '' on success, else why not."""
    if not lock_hash or not re.match(r'^[0-9a-f]{12}$', lock_hash):
        return 'no lock hash'
    prod = subprocess.Popen(SSH + [HOSTS[src], f'tar -czf - -C ~/ci/.nm-cache {lock_hash}'], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL)
    try:
        cons = subprocess.Popen(SSH + [HOSTS[dst], seed_dst_cmd(lock_hash)], stdin=prod.stdout, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        prod.stdout.close()
        try:
            out, err = cons.communicate(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            cons.kill(); prod.kill()
            return f'seed took over {timeout_s // 60} min'
        try:
            prc = prod.wait(timeout=60)
        except subprocess.TimeoutExpired:
            prod.kill(); prc = -9
    finally:
        if prod.poll() is None:
            prod.kill()
    if cons.returncode != 0 or ('present' not in out and prc != 0):
        return f'seed {src}->{dst} failed (tar {prc}, untar {cons.returncode}): {(err or "").strip()[:200]}'
    return ''


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
RESERVED_LABELS = ('.nm-cache', '.git-mirror.git')   # ~/ci/<label> is rm -rf'd; these name the caches
PRUNE_MIN = 720          # 11-06: ci2's 58 GB root reached 86% on 3 days of trees (44 GB, 183 dirs); 12 h fits
PRUNE_STALE_MIN = 1440   # a tree whose log never ended DONE (killed / hung) is dead after the 60-min deadlines
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


def mirror_ref(label):
    """The mirror ref for a label -> 'refs/suite/<safe>'. Pure. git refuses a component that starts with '.' (every
    `.wt-*` worktree label did: its run silently got a bare tree and the git-only tests skipped), ends in '.lock', or holds
    '..', '~', '^', ':', '?', '*', '[', '\\' or whitespace -- each is replaced, a leading dot stripped."""
    safe = re.sub(r'[^A-Za-z0-9._-]+', '-', label).lstrip('.-') or 'run'
    safe = safe.replace('..', '-')
    if safe.endswith('.lock'):
        safe = safe[:-5] + '-lock'
    return 'refs/suite/' + safe


def push_mirror(host, wt, sha_full, label, timeout_s=1800):
    """Push the commit to the host's bare mirror (created on first use). -> '' on success, else why not."""
    r = run_deadline(SSH + [HOSTS[host], f'test -d {MIRROR} || git init -q --bare {MIRROR}'], 60, text=True,
                     capture_output=True)
    if r is None or r.returncode != 0:
        return f'mirror init failed ({"timeout" if r is None else (r.stderr or "").strip()[:160]})'
    url = f'ssh://{HOSTS[host]}/home/mike/{MIRROR}'
    env = dict(os.environ, GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=10')
    r = run_deadline(['git', '-C', wt, 'push', '-q', '--no-verify', '--force', url, f'{sha_full}:{mirror_ref(label)}'],
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


def prune_cmd(done_min=PRUNE_MIN, stale_min=PRUNE_STALE_MIN):
    """PURE. The remote prune: a ~/ci/<label> tree goes when its log ended DONE over done_min minutes ago, or its log is
    over stale_min minutes old whatever it says (a killed or hung run). Logs, the git mirror and the node_modules cache
    (~/ci/.nm-cache) are kept, even if a stray .nm-cache.log / .git-mirror.git.log exists."""
    return (f'cd ~/ci 2>/dev/null || exit 0; find . -maxdepth 1 -name "*.log" -mmin +{done_min} -print0 | '
            f'while IFS= read -r -d "" l; do d="${{l%.log}}"; case "$d" in ./.nm-cache|./.git-mirror.git) continue;; esac; '
            f'[ -d "$d" ] || continue; '
            f'if tail -n 1 "$l" | grep -q "^DONE rc=" || [ -n "$(find "$l" -mmin +{stale_min})" ]; then rm -rf -- "$d"; fi; done; true')


def prune_remote(host, done_min=PRUNE_MIN):
    """Remove old ~/ci/<label> trees (prune_cmd). Best effort, bounded."""
    cmd = prune_cmd(done_min)
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

    if label in RESERVED_LABELS:
        sys.exit(f'suite-run: label {label!r} is reserved (it names a cache under ~/ci)')
    dest = f'ci/{label}'
    rlog = f'ci/{label}.log'
    lh = lock_hash_of(wt, a.ref)
    probes = {h: parse_probe(ssh(h, probe_cmd(lh), timeout=60).stdout) for h in ORDER}   # all: a forced host may need a seed
    plan = host_plan(ORDER, probes, forced=a.host)
    if not plan:
        sys.exit(f'suite-run: no test host answered ({", ".join(ORDER if not a.host else [a.host])})')

    def seed(src, host):
        return seed_cache(src, host, lh)

    def prep(host):
        prune_remote(host)
        return prepare(host, wt, a, sha_full, sha, label, dest)

    def failed(host, what, bad):
        print(f'attempt host={host} result={what} {bad}', flush=True)
        if what == 'prep-failed':
            ssh(host, f'rm -rf ~/{dest}', timeout=600)     # no log is written, so the prune would never find it
    host, src, git_ctx, tried = try_hosts(plan, seed, prep, failed)
    if host is None:
        sys.exit('suite-run: no host could prepare the run -- ' + ' | '.join(tried))
    why = 'forced' if a.host else (
        'lock free' if probes[host]['free'] else
        f'busy, queued on fewer waiters { {h: p["waiters"] for h, p in probes.items() if p} }')
    if src:
        why += f'; node_modules cache seeded from {src}'
    if tried:
        why += '; after ' + ' | '.join(tried)
    llog = a.log or f'/tmp/suite-run/{label}.{host}.log'
    print(f'host={host} ({HOSTS[host]}; {why}) label={label} sha={sha}{" (worktree as it stands)" if not a.ref else ""} '
          f'remote_log=~/{rlog} local_log={llog}', flush=True)
    return run_suite(host, a, label, dest, rlog, llog, git_ctx)


def ship_or_why(host, wt, ref, dest, timeout_s, files):
    """ship(), with its exit turned into a reason (an upload failure falls back to the next host, Codex r1)."""
    try:
        ship(host, wt, ref, dest, timeout_s=timeout_s, files=files)
    except SystemExit as e:
        return str(e) or 'shipping failed'
    return ''


def prepare(host, wt, a, sha_full, sha, label, dest):
    """Ship the tree to one host and prep node_modules there. -> (git_ctx, '' or why it failed)."""
    git_ctx = not a.no_git
    if git_ctx:
        why_not = push_mirror(host, wt, sha_full, label) or remote_checkout(host, dest, sha_full)
        if why_not:
            print(f'suite-run: NO GIT CONTEXT ({why_not}); shipping a bare tree -- the git-only tests will SKIP', flush=True)
            git_ctx = False
    if git_ctx:
        if not a.ref:
            files, deleted, added = worktree_overlay(wt)
            bad = ship_or_why(host, wt, None, dest, a.upload_min * 60, files)
            if bad:
                return git_ctx, bad
            bad = remote_fixup(host, dest, deleted, added)
            if bad:
                return git_ctx, bad
        print(f'git context: a checkout of {sha} on {host}' + ('' if a.ref else ' with this worktree laid over it'), flush=True)
    else:
        ssh(host, f'rm -rf {dest}', timeout=600)
        bad = ship_or_why(host, wt, a.ref, dest, a.upload_min * 60, None if a.ref else tree_files(wt))
        if bad:
            return git_ctx, bad
    try:
        r = subprocess.run(SSH + [HOSTS[host], 'bash -s -- ' + shlex.quote(f'/home/mike/{dest}')],
                           input=REMOTE_PREP, text=True, capture_output=True, timeout=20 * 60)
    except subprocess.TimeoutExpired:
        return git_ctx, 'node_modules prep took over 20 min'
    if r.returncode != 0:
        print(f'suite-run: node_modules prep on {host} failed: {r.stderr.strip()}', flush=True)
        return git_ctx, f'node_modules prep failed (rc {r.returncode}): {r.stderr.strip()[-200:]}'
    print(f'node {r.stdout.strip()} on {host}', flush=True)
    return git_ctx, ''


def run_suite(host, a, label, dest, rlog, llog, git_ctx):
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
