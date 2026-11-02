#!/usr/bin/env python3
"""promomerge.py -- every fleet PROMOTION is merged into main, mechanically (audit 11-01 flag 4, control session 11-02).

THE GAP IT CLOSES. canary-loop.sh promotes a KEEP fleet-wide and pages "operator: fast-forward main". Nothing did it: the
"coordinator merges a promoted sha within 1-25 min" was a session's habit, not a job. From 11-01 04:53Z six promotions
(tombexit-01 .. fleetbuild-01) were never merged, main lacked their airpocket / apseal / escapeguard code, and the trial merge
conflicted in 36 files. stallcheck (f) saw it but only in its once-a-day digest. This job does the merge after each promotion,
and when it cannot, it pages.

THREE ROLES, ONE FILE (the canary host has the journal and the alarm channel but no GitHub push key and no route to the test
host; the Mac controller has both, and does only light work: a fetch, a merge, an scp, a push -- the suite runs on .30):

  tick     (Mac, launchd com.mcai.promomerge, every 15 min; scripts/mac/promomerge.sh)
           1. reads the canary journal on .31 (~/canary-journal.jsonl): every `promoted` row of the last PROMO_RECENT_D days
           2. fetches origin into a private scratch clone (~/promomerge/repo; never the user's checkout, never a hook)
           3. the newest promotion that is NOT an ancestor of origin/main is the target (an older one it contains goes with it)
           4. `git merge --no-ff <sha>` onto origin/main.  conflict -> abort, ALARM (the files), wait for a human
           5. `node --check` every changed .mjs/.cjs.     a syntax error -> ALARM
           6. the FULL suite on .30 (`ci` below), ONE suite at a time, nice -n 19, TEST_JOBS=6.  a hard failure -> ALARM
           7. push HEAD:main, never forced. Refused because main moved: re-merge onto the new main and push without a re-test
              only when the new main commits touch nothing under bots/ (tests cannot see the rest); else re-test next tick
           8. publishes its status to .31 (`publish`)
  ci       (.30, run over ssh by tick) clones the bundle's three trees (merge, main, promoted sha), runs the suite on the merge,
           then TRIAGES each failing file: run alone on the merge twice (passes once = a host-load flake, the .30/.31 lesson of
           11-01/11-02); still failing -> run alone on main and on the promoted sha: failing on either = pre-existing (the merge
           did not cause it); failing only on the merge = HARD. Prints one JSON line.
  publish  (.31, run over ssh by tick) raises the alarms through lib/alarm.py (dedup by key, NEW push, STILL every 6 h,
           CLEARED) -- the death tripper's /etc/mcai-alert.conf channel -- and writes ~/digest/promomerge-fleet.json, which
           alarmhead.py prints in the fleetstatus header. A Mac that stopped ticking reads there as '!! STALE state'.

The backstop when this job is dead: stallcheck (f) `promo:<run>` now PAGES (raise_alarms) once a promotion is 6 h off main.

    python3 -B scripts/host/promomerge.py tick [--dry-run]          # Mac
    python3 -B scripts/host/promomerge.py status                     # Mac: print the state
"""
import argparse
import datetime as dt
import fcntl
import json
import os
import re
import subprocess
import sys
import time

UTC = dt.timezone.utc
HOST31 = 'mike@10.0.0.31'
HOST30 = 'mike@10.0.0.30'
GH = 'git@github.com:dmille6/minecraft-ai-test.git'
HOME = os.path.expanduser('~/promomerge')
REMOTE_CI = '/home/mike/ci/promomerge'
JOURNAL = '~/canary-journal.jsonl'
PROMO_RECENT_D = 14
RETRY_FAILED_H = 1          # a failed attempt is retried only after main moved AND this long
MISSING_GRACE_H = 1         # a promoted sha not yet on origin (the canary branch push) is an alarm after this
PENDING_ALARM_H = 3         # a promotion off main this long with no failure recorded (CI busy, Mac asleep) is an alarm
CI_WAIT_S = 3 * 3600        # how long ci waits for another suite on .30 to finish
TEST_JOBS = 6
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=10']
JS = re.compile(r'\.(mjs|cjs|js)$')
FAILED_LINE = re.compile(r'^FAILED \((\d+)\): (.*)$', re.M)
PASSED_LINE = re.compile(r'^(\d+)/(\d+) files passed$', re.M)


def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def ts(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).astimezone(UTC)
    except (TypeError, ValueError):
        return None


def hours(now, t):
    return (now - t).total_seconds() / 3600


# ------------------------------------------------------------------------------------------------------------- pure --
def promotions(journal_text, now, recent_d=PROMO_RECENT_D):
    """PURE. [(run, sha, ts)] oldest first, from the journal's `promoted` rows of the last recent_d days (the note's first
    token is the promoted sha, as canary-loop.sh writes it: 'journal promoted "$SHA fleet-wide"'). Bad lines are skipped."""
    out = []
    for line in journal_text.splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if not isinstance(r, dict) or r.get('phase') != 'promoted':
            continue
        sha = (str(r.get('note') or '').split() or [''])[0]
        t = ts(r.get('ts'))
        if re.fullmatch(r'[0-9a-f]{7,40}', sha) and t and hours(now, t) <= recent_d * 24:
            out.append((str(r.get('run') or '?'), sha, t))
    return sorted(out, key=lambda p: p[2])


def pick_target(pending):
    """PURE. pending: [(run, sha, ts)] off main, oldest first -> the newest (merging it brings every older one it contains;
    one it does not contain is still pending at the next tick)."""
    return pending[-1] if pending else None


def should_attempt(entry, main, now, retry_h=RETRY_FAILED_H):
    """PURE. entry: this sha's last attempt record (or None). A failure is not retried on the same main (it would fail the
    same way and re-page); once main moved (a human may have fixed it) it is retried after retry_h."""
    if not entry:
        return True
    st = entry.get('status')
    if st in ('conflict', 'syntax', 'testfail'):
        t = ts(entry.get('at'))
        return entry.get('main') != main and (t is None or hours(now, t) >= retry_h)
    return True        # ci-error / ci-busy / stale-main / pushed-but-not-ancestor: try again


def parse_suite(text):
    """PURE. run-tests.mjs output -> (completed: bool, failed: [file]). Completed = its 'n/m files passed' line exists."""
    m = FAILED_LINE.search(text)
    failed = m.group(2).split() if m else []
    return bool(PASSED_LINE.search(text)), failed


def triage(failed, alone_merge, alone_main, alone_fleet):
    """PURE. failed: files failing in the full run. alone_*: {file: [result, ...]} runs of the file alone on each tree, each
    result 'pass' | 'fail' (the file ran to its summary and FAILED) | 'absent' (no such test on that tree) | 'error' (timeout,
    no summary). -> {'flake', 'preexisting', 'hard'}. flake = passed alone on the merge at least once; pre-existing = a
    CONFIRMED 'fail' alone on main or on the promoted sha (Codex r1: an absent or broken run proves nothing -- a new test
    failing on the merge and missing on main must not pass as pre-existing); everything else is hard."""
    out = {'flake': [], 'preexisting': [], 'hard': []}
    for f in failed:
        if 'pass' in (alone_merge.get(f) or []):
            out['flake'].append(f)
        elif 'fail' in (alone_main.get(f) or []) or 'fail' in (alone_fleet.get(f) or []):
            out['preexisting'].append(f)
        else:
            out['hard'].append(f)
    return out


def alone_result(text, f, exists=True):
    """PURE. One alone run's run-tests.mjs output -> 'pass' | 'fail' | 'absent' | 'error'. A file the runner killed (its
    per-file timeout: '[killed: timeout]', exit 'signal SIGKILL') or that died on a signal is 'error', never a confirmed
    'fail' (Codex r2: a timed-out base run must not prove a merge failure pre-existing)."""
    if not exists:
        return 'absent'
    done, failed = parse_suite(text)
    if not done:
        return 'error'
    if f not in failed:
        return 'pass'
    m = re.search(r'^--- ' + re.escape(f) + r' \(exit ([^,)]+)[^\n]*---\n(.*?)(?=^--- |\nslowest files:|\Z)', text, re.M | re.S)
    if not m or m.group(1).startswith('signal') or '[killed: timeout]' in m.group(2):
        return 'error'
    return 'fail'


def push_safe_without_retest(changes):
    """PURE. changes: [(status letter, path)] main gained while the suite ran (git diff --name-status) -> may the re-merge
    onto the new main be pushed untested? Only for an allowlist the suite cannot see (Codex r1: the suite runs scripts/ and
    config/ tests too): Markdown under docs/ that was added or modified -- the hourly STATE.md relay and reports. A deletion
    re-tests (nothing-important-is-orphaned lists docs)."""
    return bool(changes) and all(st[:1] in ('A', 'M') and p.startswith('docs/') and p.endswith('.md') for st, p in changes)


def alarms_for(state, pending, missing, now):
    """PURE. -> {key: line} the alarms active now. state: {'attempts': {sha: entry}}; pending/missing: [(run, sha, ts)]."""
    al = {}
    att = (state or {}).get('attempts') or {}
    for run, sha, t in pending:
        e = att.get(sha) or {}
        st = e.get('status')
        k = sha[:8]
        if st == 'conflict':
            fs = e.get('files') or []
            al['conflict:' + k] = (f'promotion {run} {k} does NOT merge into main ({len(fs)} conflicted: {" ".join(fs[:8])}'
                                   f'{" ..." if len(fs) > 8 else ""}) -- reconcile by hand: fetch, merge, never force-push')
        elif st == 'syntax':
            al['syntax:' + k] = f'promotion {run} {k} merges into main but fails node --check: {" ".join(e.get("files") or [])[:300]}'
        elif st == 'testfail':
            al['testfail:' + k] = (f'promotion {run} {k}: the merge into main FAILS tests that pass on both parents: '
                                   f'{" ".join(e.get("hard") or [])[:300]} -- reconcile by hand (scratch {HOME}/repo)')
        elif hours(now, t) > PENDING_ALARM_H:
            why = f'last attempt {st} {e.get("at", "")}: {str(e.get("detail") or "")[:160]}' if st else 'never attempted'
            al['pending:' + k] = f'promotion {run} {k} is off main {hours(now, t):.1f} h ({why})'
    for run, sha, t in missing:
        if hours(now, t) > MISSING_GRACE_H:
            al['missing:' + sha[:8]] = f'promotion {run} {sha[:8]} is not on origin (no branch carries it) -- push its canary branch'
    return al


def summary_line(state, pending, n_promos):
    last = (state or {}).get('last_pushed') or {}
    if not pending:
        return (f'promotion merge: main carries all {n_promos} promotions of {PROMO_RECENT_D} d'
                + (f' (last auto-merge {last.get("run")} {str(last.get("sha"))[:8]} at {last.get("at")})' if last else ''))
    return f'promotion merge: {len(pending)} promotion(s) off main, newest {pending[-1][0]} {pending[-1][1][:8]}'


# --------------------------------------------------------------------------------------------------------- plumbing --
def run(cmd, cwd=None, check=False, timeout=None, input=None):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, input=input)
    if check and p.returncode != 0:
        raise RuntimeError(f'{" ".join(cmd)[:200]} -> {p.returncode}: {(p.stderr or p.stdout)[-400:]}')
    return p


def git(repo, *a, check=True, timeout=600):
    return run(['git', '-C', repo, *a], check=check, timeout=timeout)


def ancestor(repo, a, b):
    return git(repo, 'merge-base', '--is-ancestor', a, b, check=False).returncode == 0


def load_state(path):
    try:
        d = json.load(open(path))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(path, d):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(d, f, indent=1, sort_keys=True)
    os.replace(tmp, path)


def log(msg):
    print(f'{iso(dt.datetime.now(UTC))} {msg}', flush=True)


def merge_onto(repo, main, run_id, sha):
    """Scratch repo only: detach at main, merge sha. -> (ok, conflicted files)."""
    git(repo, 'merge', '--abort', check=False)
    git(repo, 'checkout', '-q', '--detach', '-f', main)
    git(repo, 'reset', '-q', '--hard', main)
    git(repo, 'clean', '-qfdx')
    msg = (f'promomerge: merge promotion {run_id} {sha[:8]} into main (automatic)\n\n'
           f'The canary loop promoted {sha} fleet-wide. scripts/host/promomerge.py merged it onto main {main[:8]}\n'
           f'(clean merge, node --check, full suite on the test host with flake/pre-existing triage).\n\n'
           f'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n')
    p = git(repo, 'merge', '--no-ff', '-q', '-m', msg, sha, check=False)
    if p.returncode == 0:
        return True, []
    files = git(repo, 'diff', '--name-only', '--diff-filter=U', check=False).stdout.split()
    git(repo, 'merge', '--abort', check=False)
    return False, files or ['(merge failed: ' + (p.stderr or p.stdout).strip()[-120:] + ')']


def syntax_errors(repo, main, sha):
    changed = set(git(repo, 'diff', '--name-only', main, 'HEAD').stdout.split()) | set(git(repo, 'diff', '--name-only', sha, 'HEAD').stdout.split())
    bad = []
    for f in sorted(changed):
        if JS.search(f) and f.startswith('bots/') and '/_mutant-tree' not in f and os.path.isfile(os.path.join(repo, f)):
            if run(['node', '--check', os.path.join(repo, f)]).returncode != 0:
                bad.append(f)
    return bad


def remote_ci(repo, main, sha, merge):
    """Ship a bundle + this file to .30, run `ci` there, return its JSON."""
    b = os.path.join(HOME, 'ci.bundle')
    for ref, v in (('pm-merge', merge), ('pm-main', main), ('pm-fleet', sha)):
        git(repo, 'branch', '-f', ref, v)
    git(repo, 'bundle', 'create', b, 'pm-merge', 'pm-main', 'pm-fleet', timeout=900)
    run(SSH + [HOST30, f'mkdir -p {REMOTE_CI}'], check=True, timeout=60)
    run(['scp', '-q', '-o', 'BatchMode=yes', b, os.path.abspath(__file__), f'{HOST30}:{REMOTE_CI}/'], check=True, timeout=900)
    p = run(SSH + [HOST30, f'cd {REMOTE_CI} && python3 -B promomerge.py ci --bundle {REMOTE_CI}/ci.bundle'],
            timeout=CI_WAIT_S + 4 * 3600)
    lines = [x for x in (p.stdout or '').splitlines() if x.startswith('{')]
    if not lines:
        return {'status': 'ci-error', 'detail': f'no result (rc={p.returncode}): {(p.stderr or p.stdout)[-300:]}'}
    return json.loads(lines[-1])


def publish(status):
    """Copy the status to .31 and let it raise the alarms there (its lib/alarm.py and /etc/mcai-alert.conf)."""
    tmp = os.path.join(HOME, 'status.json')
    save_state(tmp, status)
    ok = run(['scp', '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', tmp, f'{HOST31}:digest/promomerge-status.json'],
             timeout=120).returncode == 0
    if ok:
        p = run(SSH + [HOST31, 'cd ~/promomerge/app/scripts && python3 -B host/promomerge.py publish'], timeout=300)
        ok = p.returncode == 0
        log(f'publish rc={p.returncode} {(p.stdout or p.stderr).strip()[-200:]}')
    return ok


# -------------------------------------------------------------------------------------------------------- commands --
def cmd_tick(a):
    os.makedirs(HOME, exist_ok=True)
    lk = open(os.path.join(HOME, 'lock'), 'w')
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log('another tick is running (its CI can take an hour); skipped')
        return 0
    now = dt.datetime.now(UTC)
    sp = os.path.join(HOME, 'state.json')
    state = load_state(sp)
    state.setdefault('attempts', {})
    repo = os.path.join(HOME, 'repo')
    os.environ['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes -o ConnectTimeout=20'
    errors = []
    p = run(SSH + [HOST31, f'cat {JOURNAL}'], timeout=120)
    if p.returncode != 0:
        log(f'journal unreadable: {p.stderr.strip()[-200:]}')
        return 1          # nothing to publish to: .31 is unreachable (the header shows the state going STALE)
    promos = promotions(p.stdout, now)
    if not os.path.isdir(os.path.join(repo, '.git')):
        run(['git', 'clone', '-q', GH, repo], check=True, timeout=1800)
    git(repo, 'fetch', '-q', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*', timeout=900)
    main = git(repo, 'rev-parse', 'origin/main').stdout.strip()
    have = lambda s: git(repo, 'cat-file', '-e', s + '^{commit}', check=False).returncode == 0
    missing = [x for x in promos if not have(x[1])]
    pending = [x for x in promos if have(x[1]) and not ancestor(repo, x[1], main)]
    tgt = pick_target(pending)
    if tgt and not a.dry_run and should_attempt(state['attempts'].get(tgt[1]), main, now):
        run_id, sha, _ = tgt
        sha = git(repo, 'rev-parse', sha).stdout.strip()
        e = {'run': run_id, 'main': main, 'at': iso(now)}
        log(f'attempt {run_id} {sha[:8]} onto main {main[:8]}')
        ok, files = merge_onto(repo, main, run_id, sha)
        if not ok:
            e.update(status='conflict', files=files)
        else:
            bad = syntax_errors(repo, main, sha)
            if bad:
                e.update(status='syntax', files=bad)
            else:
                merge = git(repo, 'rev-parse', 'HEAD').stdout.strip()
                # the suite holds this tick for ~20-40 min: say so in the header first (a CI > 2 h then reads STALE)
                publish({'generated_at': iso(dt.datetime.now(UTC)), 'main': main, 'alarms': alarms_for(state, pending, missing, now),
                         'summary': f'promotion merge: testing {run_id} {sha[:8]} merged onto main {main[:8]} on the test host '
                                    f'(since {iso(dt.datetime.now(UTC))})'})
                try:
                    r = remote_ci(repo, main, sha, merge)
                except Exception as ex:   # noqa: BLE001 -- a CI that cannot run is a status, never a silent stop
                    r = {'status': 'ci-error', 'detail': f'{type(ex).__name__}: {str(ex)[:300]}'}
                e.update({k: r.get(k) for k in ('status', 'detail', 'failed', 'flake', 'preexisting', 'hard', 'passed') if k in r})
                if r.get('status') == 'pass':
                    e.update(_push(repo, run_id, sha, main, merge, state, now))
        state['attempts'][tgt[1]] = e
        log(f'result {run_id} {sha[:8]}: {e.get("status")} {str(e.get("detail") or e.get("files") or e.get("hard") or "")[:200]}')
        git(repo, 'fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main', check=False)
        main = git(repo, 'rev-parse', 'origin/main').stdout.strip()
        pending = [x for x in promos if have(x[1]) and not ancestor(repo, x[1], main)]
    for k in list(state['attempts']):          # forget shas that are on main and older than the window
        if k not in {x[1] for x in promos} and ancestor(repo, k, main):
            state['attempts'].pop(k, None)
    save_state(sp, state)
    now = dt.datetime.now(UTC)
    status = {'generated_at': iso(now), 'main': main, 'summary': summary_line(state, pending, len(promos)),
              'pending': [{'run': r, 'sha': s, 'promoted': iso(t), **(state['attempts'].get(s) or {})} for r, s, t in pending],
              'alarms': alarms_for(state, pending, missing, now), 'errors': errors}
    log(status['summary'] + (f' | ALARMS {len(status["alarms"])}' if status['alarms'] else ''))
    if a.dry_run:
        print(json.dumps(status, indent=1))
        return 0
    publish(status)
    return 0


def _push(repo, run_id, sha, main, merge, state, now):
    """Push the tested merge to main, never forced. -> fields for the attempt record."""
    for attempt in range(3):
        p = git(repo, 'push', '-q', 'origin', 'HEAD:refs/heads/main', check=False, timeout=300)
        if p.returncode == 0:
            pushed = git(repo, 'rev-parse', 'HEAD').stdout.strip()
            state['last_pushed'] = {'run': run_id, 'sha': sha, 'merge': pushed, 'at': iso(dt.datetime.now(UTC))}
            return {'status': 'pushed', 'merge': pushed, 'detail': f'pushed {pushed[:8]} (attempt {attempt + 1})'}
        git(repo, 'fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main')
        new = git(repo, 'rev-parse', 'origin/main').stdout.strip()
        if ancestor(repo, sha, new):
            return {'status': 'merged-elsewhere', 'detail': f'origin/main {new[:8]} already carries it'}
        changed = [tuple(l.split('\t')[:2]) for l in git(repo, 'diff', '--name-status', '--no-renames', main, new).stdout.splitlines() if '\t' in l]
        if not push_safe_without_retest(changed):
            return {'status': 'stale-main', 'detail': f'main moved to {new[:8]} with bots/ changes while the suite ran; re-test next tick'}
        ok, files = merge_onto(repo, new, run_id, sha)
        if not ok:
            return {'status': 'conflict', 'files': files, 'main': new}
        main = new
    return {'status': 'stale-main', 'detail': 'push refused 3 times'}


def _alone(tree, f, env):
    """One file alone (run-tests.mjs filters by substring, so a longer name containing it runs too: only `f` is judged)."""
    try:
        p = subprocess.run(['nice', '-n', '19', 'node', 'scripts/run-tests.mjs', f], cwd=os.path.join(tree, 'bots'),
                           capture_output=True, text=True, timeout=1800, env=env)
    except subprocess.TimeoutExpired:
        return 'error'
    return alone_result(p.stdout, f, os.path.isfile(os.path.join(tree, 'bots', 'test', f)))


def _busy():
    p = run(['ps', '-eo', 'comm=,args='])
    return any(l.split(None, 1)[0] == 'node' and 'run-tests.mjs' in l for l in p.stdout.splitlines() if l.strip())


def cmd_ci(a):
    """On .30: clone the three trees, run the suite on the merge, triage. Prints ONE JSON line."""
    d = os.path.dirname(os.path.abspath(a.bundle))
    trees = {}
    for name, ref in (('merge', 'pm-merge'), ('main', 'pm-main'), ('fleet', 'pm-fleet')):
        t = os.path.join(d, name)
        run(['rm', '-rf', t])
        run(['git', 'clone', '-q', '-b', ref, a.bundle, t], check=True, timeout=900)
        trees[name] = t
    # node_modules: .30 has no npm. A cache keyed by the lock's hash, seeded from any ~/ci tree with the same lock.
    for name, t in trees.items():
        lock = os.path.join(t, 'bots', 'package-lock.json')
        h = run(['md5sum', lock]).stdout.split()[0] if os.path.exists(lock) else 'nolock'
        cache = os.path.join(d, 'nm', h, 'node_modules')
        if not os.path.isdir(cache):
            src = None
            for cand in sorted(os.listdir(os.path.expanduser('~/ci'))):
                cl = os.path.expanduser(f'~/ci/{cand}/bots/package-lock.json')
                cn = os.path.expanduser(f'~/ci/{cand}/bots/node_modules')
                if os.path.isdir(cn) and os.path.exists(cl) and run(['md5sum', cl]).stdout.split()[0] == h:
                    src = cn
                    break
            if not src:
                print(json.dumps({'status': 'ci-error', 'detail': f'no node_modules for {name} lock {h} on .30 (no npm): seed {cache}'}))
                return 0
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            run(['cp', '-a', src, cache], check=True, timeout=900)
        run(['cp', '-a', cache, os.path.join(t, 'bots', 'node_modules')], check=True, timeout=900)
    t0 = time.time()
    while _busy():
        if time.time() - t0 > CI_WAIT_S:
            print(json.dumps({'status': 'ci-busy', 'detail': f'another suite ran on .30 for {CI_WAIT_S // 3600} h'}))
            return 0
        time.sleep(30)
    env = dict(os.environ, TEST_JOBS=str(TEST_JOBS))
    p = subprocess.run(['nice', '-n', '19', 'node', 'scripts/run-tests.mjs'], cwd=os.path.join(trees['merge'], 'bots'),
                       capture_output=True, text=True, timeout=4 * 3600, env=env)
    open(os.path.join(d, 'suite.log'), 'w').write(p.stdout + p.stderr)
    done, failed = parse_suite(p.stdout)
    passed = (PASSED_LINE.search(p.stdout).group(0) if done else None)
    if not done:
        print(json.dumps({'status': 'ci-error', 'detail': 'the suite did not complete: ' + (p.stdout + p.stderr)[-300:]}))
        return 0
    env1 = dict(os.environ, TEST_JOBS='1')
    am, amain, afl = {}, {}, {}
    for f in failed:
        am[f] = []
        for _ in range(2):
            am[f].append(_alone(trees['merge'], f, env1))
            if am[f][-1] == 'pass':
                break
        if 'pass' not in am[f]:
            amain[f] = [_alone(trees['main'], f, env1)]
            afl[f] = [_alone(trees['fleet'], f, env1)]
    tr = triage(failed, am, amain, afl)
    print(json.dumps({'status': 'testfail' if tr['hard'] else 'pass', 'passed': passed, 'failed': failed, **tr,
                      'detail': f'{passed}; flakes {len(tr["flake"])}, pre-existing {len(tr["preexisting"])}, hard {len(tr["hard"])}'}))
    return 0


def cmd_publish(a):
    """On .31: raise the status's alarms (dedup/push via lib/alarm.py) and write the header file."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    from lib import alarm as AL
    now = dt.datetime.now(UTC)
    st = load_state(os.path.expanduser(a.status))
    active = st.get('alarms') if isinstance(st.get('alarms'), dict) else {}
    ev = AL.raise_alarms('promomerge', active, now, '~/digest/promomerge-alarm-state.json', push=not a.no_push)
    AL.write_json_atomic(os.path.expanduser('~/digest/promomerge-fleet.json'),
                         {'generated_at': st.get('generated_at') or iso(now), 'alarms': active,
                          'summary': st.get('summary') or 'promotion merge: no summary', 'pending': st.get('pending') or []})
    print(f'{iso(now)} events {len(ev)}; ' + (st.get('summary') or ''))
    return 0


def cmd_status(a):
    print(json.dumps(load_state(os.path.join(HOME, 'state.json')), indent=1))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    t = sub.add_parser('tick')
    t.add_argument('--dry-run', action='store_true', help='read and decide, never merge, push or publish')
    c = sub.add_parser('ci')
    c.add_argument('--bundle', required=True)
    pb = sub.add_parser('publish')
    pb.add_argument('--status', default='~/digest/promomerge-status.json')
    pb.add_argument('--no-push', action='store_true')
    sub.add_parser('status')
    a = ap.parse_args(argv)
    return {'tick': cmd_tick, 'ci': cmd_ci, 'publish': cmd_publish, 'status': cmd_status}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())
