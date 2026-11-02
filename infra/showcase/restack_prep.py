#!/usr/bin/env python3
"""SHOWCASE RESTACK PREP -- after every fleet KEEP+promotion, prepare the showcase release that carries it (Codex ops audit
11-01 MEDIUM 3: the showcase sat on fleet 2717bc1c while six safety KEEPs were promoted; PROCESS-fun-mode.md "The showcase
follows main": protected code follows the fleet line, restack after each promotion).

ON THE SHOWCASE VM, as root, hourly at :25 (systemd showcase-restack.timer; after the :05 follower refreshed the feed).
It PREPARES and ALERTS. It never records, stages or activates: the gate needs BOTH engines' APPROVE for a release whose
protected code changes, and the process gives no automatic activation (PROCESS-fun-mode.md: reviews, then the gate).

  1. F = the newest fleet build that is KEEP+promoted (the bench journal in ops/feed-last.json); L = the live release.
  2. protected_diff(F, L) == []           -> in_sync (nothing to do; the alarm clears)
  3. B = the newest kept build whose protected code equals L's (the build L was stacked on); none -> no_base
  4. git merge-tree --write-tree --merge-base B L F: tree = F + the showcase deltas (B..L); conflicts -> conflict (files)
  5. C = commit-tree <tree> -p L (one parent: the gate's piece rule), local branch showcase-on-fleet-<F8> in the
     showcase clone; protected_diff(F, C) must be [] (else error)
  6. record compat: recordcompat.mjs for L and for C on two COPIES of _pool-showcase -> identical | differs
  7. npm test (nice 19, TEST_JOBS=3, as mike) on C; if anything fails, the same suite on F: C's failures within F's are
     `same_as_fleet` (this host's environment), anything else is tests_failed
  8. -> ready | tests_failed | compat_differs: ops/restack-latest.json, ops/restack.jsonl, a `showcase_restack` heartbeat
     row (filebeat -> mcai-showcase-ops; stategen.py puts it in STATE.md), and an alarm (ALARMS.log + push) with the next
     steps, re-pushed every 6 h while the showcase is behind.
Each C is tested once (restack/<C8>/result.json). A run is skipped while another holds restack/.lock.

    restack_prep.py run [--no-tests] [--dry-run]     # --dry-run: decide and print, write nothing (no branch, no row)
"""
import argparse, datetime as dt, fcntl, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.append(os.path.join(HERE, '..', '..', 'scripts', 'lib'))
import showcase_ops as SO  # noqa: E402
import followrule as FR    # noqa: E402

ROOT = SO.ROOT
WORK = f'{ROOT}/restack'
LATEST = f'{SO.OPS}/restack-latest.json'
LOG = f'{SO.OPS}/restack.jsonl'
HEARTBEAT = '/var/log/showcase/heartbeat.jsonl'
ALARMS_LOG = '/home/mike/digest/ALARMS.log'
ALARM_STATE = '/home/mike/digest/restack-showcase.pushstate.json'
POOL = '/var/lib/mcai/_pool-showcase'
RUN_AS = 'mike'
TEST_JOBS = '3'
TEST_TIMEOUT_S = 3 * 3600
ALERTING = ('ready', 'conflict', 'no_base', 'error', 'tests_failed', 'compat_differs', 'diverged')
UTC = dt.timezone.utc


def now_utc():
    return dt.datetime.now(UTC)


# ------------------------------------------------------------------------------------------------ pure decisions (tested)
def kept_promotions(journal, resolve):
    """[(ts, sha, run)] newest first: the `promoted` rows of runs with a recorded KEEP. Pure over its inputs."""
    keep = {r.get('run') for r in journal
            if r.get('phase') == 'recorded' and str(r.get('note', '')).strip().split(' ')[0].upper() == 'KEEP'}
    return [p for p in FR.promotions(journal, resolve) if p[2] in keep]


def unresolved_newer(journal, resolve, kept):
    """Codex r1 BLOCK 1: a KEEP run's `promoted` row NEWER than the newest resolved one whose sha this clone cannot resolve
    (a failed fetch, a sha not pushed) -> [(ts, run, hex)]. Non-empty = the target is unknown: never in_sync on an older
    build. Pure."""
    keep = {r.get('run') for r in journal
            if r.get('phase') == 'recorded' and str(r.get('note', '')).strip().split(' ')[0].upper() == 'KEEP'}
    t0 = kept[0][0] if kept else None
    out = []
    for r in journal:
        if r.get('phase') != 'promoted' or r.get('run') not in keep:
            continue
        t = FR.parse_ts(r.get('ts'))
        hx = FR.HEX.findall(str(r.get('note', '')))
        if t and hx and not any(resolve(h) for h in hx) and (t0 is None or t > t0):
            out.append((t, r.get('run'), hx[0]))
    return out


def plan(live, kept, prot, is_anc):
    """-> {'status': in_sync|no_fleet|no_base|diverged|restack|error, ...}. Pure.
      live   the live release sha; kept the kept promotions (newest first); prot(a, b) -> [hit] | None (protected_diff)
      is_anc(a, b) -> bool. `restack` carries target F and base B: F the newest kept build, B the newest kept build whose
      protected code equals the live release's (the build the live release stacks on)."""
    if not live:
        return {'status': 'error', 'detail': 'no live release (harness/RELEASE.json unreadable)'}
    if not kept:
        return {'status': 'no_fleet', 'detail': 'no KEEP+promoted fleet build in the bench journal (feed-last.json)'}
    f = kept[0]
    h = prot(f[1], live)
    if h is None:
        return {'status': 'error', 'detail': f'the protected decider could not read {f[1][:8]}..{live[:8]}'}
    if not h:
        return {'status': 'in_sync', 'fleet': f[1], 'run': f[2], 'detail': f'protected tree == fleet {f[1][:8]} ({f[2]})'}
    base = next((k for k in kept[1:] if prot(k[1], live) == []), None)
    if base is None:
        return {'status': 'no_base', 'fleet': f[1], 'run': f[2], 'hits': h[:5],
                'detail': f'no kept fleet build has the live release {live[:8]}\'s protected tree: restack by hand'}
    if not is_anc(base[1], f[1]):
        return {'status': 'diverged', 'fleet': f[1], 'run': f[2], 'base': base[1],
                'detail': f'the base {base[1][:8]} ({base[2]}) is not an ancestor of fleet {f[1][:8]}: restack by hand'}
    behind = [k[2] for k in kept if k[0] > base[0]]
    return {'status': 'restack', 'fleet': f[1], 'run': f[2], 'base': base[1], 'base_run': base[2], 'behind': behind,
            'detail': f'live {live[:8]} sits on {base[1][:8]} ({base[2]}); behind by {len(behind)}: {", ".join(behind)}'}


def failed_files(log_text):
    """run-tests.mjs output -> the set of failed test files, or None when the run did not finish. Pure."""
    m = re.search(r'^FAILED \(\d+\): (.*)$', log_text or '', re.M)
    if m:
        return set(m.group(1).split())
    if re.search(r'^\d+/\d+ files passed', log_text or '', re.M):
        return set()
    return None


def judge_tests(c_failed, f_failed):
    """-> (result, summary). Pure. c_failed: C's failures (None = unfinished); f_failed: F's (None = not run)."""
    if c_failed is None:
        return 'unfinished', 'the suite on the restack did not finish'
    if not c_failed:
        return 'pass', 'npm test: every file passed'
    if f_failed is None:
        return 'tests_failed', f'{len(c_failed)} failed ({" ".join(sorted(c_failed))}); the fleet build was not run'
    extra = c_failed - f_failed
    if extra:
        return 'tests_failed', f'{len(extra)} failed only on the restack: {" ".join(sorted(extra))}'
    return 'same_as_fleet', f'{len(c_failed)} failed, all also failing on fleet build itself here ({" ".join(sorted(c_failed))})'


def next_steps(C, L, F, run):
    tag = f'showcase-on-fleet-{F[:8]}'
    return (f'review `git diff {L[:8]} {C[:8]}` (Codex + Claude, blockers only: protected scope changes); then '
            f'showcase_ops.py record --run {tag} --sha {C} --base {L} --kind reconcile --tests PASS:{C}:<summary> '
            f'--review codex:APPROVE:{C}:<who> --review claude:APPROVE:{C}:<who>; stage {C[:8]} --piece {tag} --dry-run; '
            f'stage; activate releases/<dir>; check 10/10 bots + tripwire + records 30 min later')


# ------------------------------------------------------------------------------------------------ impure steps
def git(*a, check=True, inp=None):
    r = subprocess.run(['git', '-C', SO.REPO, *a], capture_output=True, text=True, input=inp)
    if check and r.returncode:
        raise RuntimeError(f'git {a[0]}: {r.stderr.strip()[:200]}')
    return r


def merge_tree(base, live, fleet):
    """-> (tree, []) | (None, [conflicted paths])."""
    r = git('merge-tree', '--write-tree', '--name-only', f'--merge-base={base}', live, fleet, check=False)
    lines = r.stdout.strip().splitlines()
    if r.returncode == 0 and lines:
        return lines[0].strip(), []
    if r.returncode == 1:
        files = []
        for ln in lines[1:]:
            if not ln.strip():
                break
            files.append(ln.strip())
        return None, files
    raise RuntimeError(f'merge-tree rc={r.returncode}: {r.stderr.strip()[:200]}')


def make_commit(tree, live, fleet, run, base, base_run):
    branch = f'showcase-on-fleet-{fleet[:8]}'
    old = git('rev-parse', '--verify', '--quiet', f'refs/heads/{branch}', check=False).stdout.strip()
    if old and git('rev-parse', f'{old}^{{tree}}').stdout.strip() == tree and \
            git('rev-parse', f'{old}^').stdout.strip() == live:
        return old, branch
    msg = (f'showcase-on-fleet: the showcase onto fleet {fleet[:8]} ({run}) -- prepared by restack_prep.py\n\n'
           f'TREE = fleet {fleet[:8]} + the showcase deltas {base[:8]}..{live[:8]} (git merge-tree --merge-base {base[:8]}, '
           f'{base_run} -> {run}); single parent = the live release {live[:8]}. Not reviewed, not recorded: see the alarm.\n')
    env = dict(os.environ, GIT_AUTHOR_NAME='showcase restack_prep', GIT_AUTHOR_EMAIL='restack@showcase.local',
               GIT_COMMITTER_NAME='showcase restack_prep', GIT_COMMITTER_EMAIL='restack@showcase.local')
    c = subprocess.run(['git', '-C', SO.REPO, 'commit-tree', tree, '-p', live, '-F', '-'], input=msg, text=True,
                       capture_output=True, env=env, check=True).stdout.strip()
    git('update-ref', f'refs/heads/{branch}', c)
    return c, branch


def unpack(sha, dst, deps_dir):
    """bots/ of `sha` into dst, node_modules from the live release (same deps digest is checked by the caller)."""
    shutil.rmtree(dst, ignore_errors=True)
    os.makedirs(dst)
    arch = subprocess.run(['git', '-C', SO.REPO, 'archive', sha, 'bots'], capture_output=True, check=True).stdout
    subprocess.run(['tar', '-C', dst, '-xf', '-', '--strip-components=1'], input=arch, check=True)
    os.symlink(os.path.join(deps_dir, 'node_modules'), os.path.join(dst, 'node_modules'))
    subprocess.run(['chown', '-R', RUN_AS, dst], check=True)


def run_suite(dst, log_path):
    cmd = ['runuser', '-u', RUN_AS, '--', 'nice', '-n', '19', 'env', f'TEST_JOBS={TEST_JOBS}', 'node', 'scripts/run-tests.mjs']
    with open(log_path, 'w') as fh:
        try:
            subprocess.run(cmd, cwd=dst, stdout=fh, stderr=subprocess.STDOUT, timeout=TEST_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            fh.write('\nTIMEOUT\n')
    subprocess.run(['chown', RUN_AS, log_path])
    return failed_files(open(log_path, errors='replace').read())


def compat(live_dir, c_src, work):
    """recordcompat.mjs on two copies of the live records -> ('identical'|'differs'|'error', detail)."""
    env_file = os.path.join(live_dir, 'env', 'showcase-Alpha.env')
    subprocess.run(['chown', RUN_AS, work], check=True)   # the harness makes its scratch beside the copy, as RUN_AS
    outs = {}
    for name, src in (('live', live_dir), ('restack', c_src)):
        cp = os.path.join(work, f'pool-{name}')
        shutil.rmtree(cp, ignore_errors=True)
        subprocess.run(['cp', '-a', POOL, cp], check=True)
        subprocess.run(['chown', '-R', RUN_AS, cp], check=True)
        r = subprocess.run(['runuser', '-u', RUN_AS, '--', 'nice', '-n', '19', 'node', os.path.join(HERE, 'recordcompat.mjs'),
                            '--src', src, '--pool-copy', cp, '--env', env_file], capture_output=True, text=True, timeout=600)
        shutil.rmtree(cp, ignore_errors=True)
        if r.returncode:
            return 'error', f'{name}: rc={r.returncode} {r.stderr.strip()[-200:]}'
        outs[name] = r.stdout
        with open(os.path.join(work, f'compat-{name}.json'), 'w') as fh:
            fh.write(r.stdout)
    if outs['live'] == outs['restack']:
        d = json.loads(outs['live'])
        if d.get('wrote'):
            return 'differs', 'identical answers, but a release WROTE into the record copy during the reads'
        return 'identical', f'{len(d.get("heads", {}))} records: same heads, build order and damage in 3 worlds'
    return 'differs', f'see {work}/compat-live.json vs compat-restack.json'


def report(row, dry):
    print(json.dumps(row))
    if dry:
        return
    SO.append(LOG, row)
    with open(LATEST + '.tmp', 'w') as fh:
        json.dump(row, fh, indent=1)
    os.replace(LATEST + '.tmp', LATEST)
    try:
        import alarm as AL
    except ImportError:
        sys.path.append('/home/mike/w5alarms/scripts/lib')
        import alarm as AL
    hb = {'kind': 'showcase_restack', 't': row['t'], 'ok': row['status'] not in ('error',),
          **{k: row.get(k) for k in ('status', 'detail', 'fleet', 'run', 'live', 'commit', 'branch', 'tests', 'compat')}}
    try:
        AL.ship_row(HEARTBEAT, hb)
    except Exception as e:  # noqa: BLE001
        print(f'heartbeat row not shipped: {e}')
    active = {}
    if row['status'] in ALERTING:
        active['showcase:restack'] = (f'showcase protected tree is BEHIND fleet {str(row.get("fleet"))[:8]} ({row.get("run")}): '
                                      f'{row["status"]} -- {row.get("detail")}' + (f'. NEXT: {row["next"]}' if row.get('next') else ''))[:900]
    AL.raise_alarms('restack-showcase', active, now_utc(), ALARM_STATE, log_path=ALARMS_LOG)


def run(a):
    os.makedirs(WORK, exist_ok=True)
    lk = open(f'{WORK}/.lock', 'a')
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('another restack_prep run holds the lock'); return 0
    t = now_utc()
    row = {'t': FR.iso(t)}
    SO.fetch()
    try:
        feed = json.load(open(f'{SO.OPS}/feed-last.json'))
    except (OSError, ValueError) as e:
        row.update(status='error', detail=f'feed-last.json unreadable ({e}); the follower has not run')
        return report(row, a.dry_run) or 1
    rel = SO.current_release() or {}
    live = rel.get('sha')
    row['live'] = live
    kept = kept_promotions(feed.get('journal') or [], SO.resolve)
    lost = unresolved_newer(feed.get('journal') or [], SO.resolve, kept)
    if lost:
        row.update(status='error', detail=f'the newest KEEP promotion {lost[-1][1]} ({lost[-1][2][:12]}) is not in the showcase '
                                          f'clone: fetch failed or the sha was never pushed -- the target is unknown')
        return report(row, a.dry_run) or 1
    main_tip = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}', check=False).stdout.strip() or None
    pats = SO.read_protected([live, kept[0][1] if kept else None, main_tip])
    prot = lambda x, y: SO.protected_diff(x, y, pats) if pats else None
    p = plan(live, kept, prot, SO.is_anc)
    row.update({k: v for k, v in p.items() if k != 'status'}, status=p['status'])
    if p['status'] != 'restack':
        return report(row, a.dry_run) or 0
    F, B = p['fleet'], p['base']
    tree, conflicts = merge_tree(B, live, F)
    if tree is None:
        row.update(status='conflict', conflicts=conflicts[:20], detail=f'{p["detail"]}; merge conflicts in {", ".join(conflicts[:6])}')
        return report(row, a.dry_run) or 0
    if a.dry_run:
        row.update(status='ready (dry run)', tree=tree)
        return report(row, True) or 0
    C, branch = make_commit(tree, live, F, p['run'], B, p.get('base_run'))
    row.update(commit=C, branch=branch, tree=tree)
    h = prot(F, C)
    if h != []:
        row.update(status='error', detail=f'the restack {C[:8]} differs from fleet {F[:8]} in protected code: {(h or ["undecided"])[:3]}')
        return report(row, False) or 1
    if git('diff', '--quiet', live, C, '--', 'bots/package.json', 'bots/package-lock.json', check=False).returncode:
        row.update(status='error', detail='the fleet changed bots/package.json or its lock: the deps digest changes; restack by hand')
        return report(row, False) or 1
    work = f'{WORK}/{C[:8]}'
    os.makedirs(work, exist_ok=True)
    res_path = f'{work}/result.json'
    res = json.load(open(res_path)) if os.path.exists(res_path) else {}
    live_dir = os.path.realpath(SO.HARNESS)
    if 'compat' not in res:
        unpack(C, f'{work}/bots', live_dir)
        res['compat'] = compat(live_dir, f'{work}/bots', work)
    if not a.no_tests and 'tests' not in res:
        cf = run_suite(f'{work}/bots', f'{work}/tests-restack.log')
        ff = None
        if cf:
            unpack(F, f'{work}/fleet-bots', live_dir)
            ff = run_suite(f'{work}/fleet-bots', f'{work}/tests-fleet.log')
            shutil.rmtree(f'{work}/fleet-bots', ignore_errors=True)
        res['tests'] = judge_tests(cf, ff)
    with open(res_path, 'w') as fh:
        json.dump(res, fh, indent=1)
    row['compat'] = res['compat'][0]
    row['tests'] = (res.get('tests') or ['not run'])[0]
    detail = [p['detail'], f'compat {res["compat"][0]}: {res["compat"][1]}']
    if res.get('tests'):
        detail.append(f'tests {res["tests"][0]}: {res["tests"][1]} (log {work}/tests-restack.log)')
    status = 'ready'
    if res['compat'][0] != 'identical':
        status = 'compat_differs'
    elif res.get('tests') and res['tests'][0] not in ('pass', 'same_as_fleet'):
        status = 'tests_failed'
    row.update(status=status, detail='; '.join(detail), next=next_steps(C, live, F, p['run']))
    return report(row, False) or 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['run'])
    ap.add_argument('--no-tests', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    try:
        return run(a)
    except Exception as e:  # noqa: BLE001 -- Codex r1 BLOCK 2: a crash is an alarm, never a silent stop
        report({'t': FR.iso(now_utc()), 'status': 'error', 'live': (SO.current_release() or {}).get('sha'),
                'detail': f'restack_prep crashed: {type(e).__name__}: {str(e)[:200]}'}, a.dry_run)
        return 1


if __name__ == '__main__':
    sys.exit(main())
