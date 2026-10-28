#!/usr/bin/env python3
r"""goalwatch.py -- the STUCK-GOAL ALARM (W5, fun mode, OWNER 2026-10-28: "stuck goal -> owner in 3 h").

A visible goal is an OPEN town project: the newest generation of /var/lib/mcai/_pool-<pool>/project-<home>.<plot>.g<N>.json
whose record is not structure_complete (and whose state is not 'complete'). It is STUCK when nothing has advanced it for
STALL (3 h). Advancing means any of:
  - the project's own progress record  project-<home>.<plot>.progress.json  ('at', written on every placement);
  - a `_build` row with status success and op in place / clear / fell / replant / fill, for that pool and project;
  - a `_build_visit` row whose placed + cleared + planted > 0;
  - a `structure_complete` row (the build finished);
  - a townplan transition (townplan-<home>.g<N>.json 'transitions'[].at) for the same home.
The stall clock starts at the newest of those, or at the project's FIRST generation's publish time if there is none.

THE ALARM NAMES THE BLOCKER. The last `_build_visit` row of that project (outcome, stop, why, bot, time), the visit
outcomes since the last progress, and how many of the host's bot units are running (a stopped showcase is the most common
reason nothing moves). DENOMINATORS: projects scanned / open, rows walked and bots seen in the window.

    python3 goalwatch.py --label showcase --state-dir ~/digest --ship /var/log/showcase/heartbeat.jsonl   (10.0.0.40)
    python3 goalwatch.py --label fleet --state-dir ~/digest                                               (10.0.0.31)
    python3 goalwatch.py --label showcase --no-push --print                                               (a dry look)

Writes <state-dir>/goalwatch-<label>.json (the fleetstatus header reads it on .31), appends NEW/STILL/CLEARED events to
~/digest/ALARMS.log and pushes them through /etc/mcai-alert.conf (lib/alarm.py; deduplicated, re-pushed every 6 h).
--ship appends a kind=showcase_goal row to the showcase's filebeat-shipped heartbeat file, which is how the .31 header
sees the showcase (the two hosts cannot read each other's files). READ ONLY on the bots: files and logs, nothing else.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import alarm as AL  # noqa: E402

UTC = dt.timezone.utc
STALL = dt.timedelta(hours=3)
WINDOW = dt.timedelta(hours=4)          # rows walked: STALL plus margin; older progress comes from progress.json
PROGRESS_OPS = ('place', 'clear', 'fell', 'replant', 'fill')
REC_RE = re.compile(r'_pool-(?P<pool>[^/]+)/project-(?P<home>-?\d+_-?\d+_-?\d+)\.(?P<plot>[A-Za-z0-9_-]+)\.g(?P<gen>\d+)\.json$')
PLAN_RE = re.compile(r'_pool-(?P<pool>[^/]+)/townplan-(?P<home>-?\d+_-?\d+_-?\d+)\.g(?P<gen>\d+)\.json$')


def ms_to_dt(v):
    try:
        return dt.datetime.fromtimestamp(float(v) / 1000.0, UTC)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def kv(detail):
    """'project=shop outcome=blocked stop=blocked why=x' -> dict. Values carry no spaces in these rows."""
    out = {}
    for tok in str(detail or '').split():
        if '=' in tok:
            k, v = tok.split('=', 1)
            out[k] = v
    return out


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


# ------------------------------------------------------------------------------------------------ pure decisions
def row_progress(name, status, d):
    """Is this one row progress on its project? `name` without the leading underscore, d = kv(detail)."""
    n = str(name or '').lstrip('_')
    if n == 'structure_complete':
        return True
    if n == 'build':
        return status == 'success' and d.get('op') in PROGRESS_OPS
    if n == 'build_visit':
        return _int(d.get('placed')) + _int(d.get('cleared')) + _int(d.get('planted')) > 0
    return False


def town_placements(rows):
    """{pool: newest townplan placement} -- `_townplan` rows whose op starts 'placed' and `_found` rows with op=place*.
    CONTEXT in the alarm line ("the town plan is still placing"), never progress on a project: a moving town plan must not
    hide a stuck building."""
    out = {}
    for r in rows:
        n = str(r.get('name') or '').lstrip('_')
        if n not in ('townplan', 'found') or r.get('status') not in (None, 'success'):
            continue
        if str(kv(r.get('detail')).get('op', '')).startswith('place'):
            if r.get('pool') not in out or r['t'] > out[r.get('pool')]:
                out[r.get('pool')] = r['t']
    return out


def summarize_rows(rows):
    """rows: [{'t', 'name', 'status', 'detail', 'pool', 'bot'}] (any order) -> {(pool, project): facts}.
    facts: last_progress (dt|None), last_visit (dict|None), outcomes_since_progress (Counter), visits, completed_at."""
    out = {}
    for r in sorted(rows, key=lambda r: r['t']):
        d = kv(r.get('detail'))
        proj = d.get('project')
        n = str(r.get('name') or '').lstrip('_')
        if not proj or not (n.startswith('build') or n == 'structure_complete'):
            continue
        f = out.setdefault((r.get('pool'), proj), {'last_progress': None, 'last_visit': None, 'visits': 0,
                                                    'outcomes_since_progress': Counter(), 'completed_at': None})
        if row_progress(n, r.get('status'), d):
            f['last_progress'] = r['t']
            f['outcomes_since_progress'] = Counter()
            if n == 'structure_complete':
                f['completed_at'] = r['t']
        if n == 'build_visit':
            f['visits'] += 1
            f['last_visit'] = {'t': r['t'], 'bot': r.get('bot'), 'outcome': d.get('outcome'), 'stop': d.get('stop'),
                               'why': d.get('why'), 'placed': _int(d.get('placed'))}
            if not row_progress(n, r.get('status'), d):
                f['outcomes_since_progress'][f"{d.get('outcome')}/{d.get('stop')}"] += 1
    return out


def judge(goal, now, stall=STALL):
    """PURE. goal: {'pool','home','plot','created_at','progress_times':[dt|None], 'row_facts': facts|None,
    'window': timedelta, 'units': (running, total)|None, 'stop': str|None, 'rows_in_window': int}.
    -> None (moving, or not old enough) or an alarm line naming the blocker."""
    times = [t for t in goal.get('progress_times') or [] if t is not None]
    rf = goal.get('row_facts') or {}
    if rf.get('last_progress'):
        times.append(rf['last_progress'])
    last = max(times) if times else None
    clock = last or goal.get('created_at')
    if clock is None:
        return (f"{goal['pool']}/{goal['plot']}@{goal['home']}: open project with NO progress record and no creation "
                f"time -- cannot time the stall; treat as stuck")
    idle = now - clock
    if idle < stall:
        return None
    h = idle.total_seconds() / 3600
    since = f"last progress {last:%m-%d %H:%MZ}" if last else f"no progress since the project was published {clock:%m-%d %H:%MZ}"
    lv = rf.get('last_visit')
    win_h = goal.get('window', WINDOW).total_seconds() / 3600
    if lv:
        blocker = (f"last _build_visit {lv['t']:%H:%MZ} by {lv['bot']}: outcome={lv['outcome']} stop={lv['stop']} "
                   f"why={lv['why'] or '-'}")
        oc = rf.get('outcomes_since_progress') or {}
        if oc:
            blocker += '; visits since progress ' + ', '.join(f'{k} x{v}' for k, v in Counter(oc).most_common(4))
    elif goal.get('rows_in_window'):
        blocker = f"NO _build_visit row in {win_h:.0f} h ({goal['rows_in_window']:,} skill rows walked): no bot is visiting the site"
    else:
        blocker = f"NO skill rows at all in {win_h:.0f} h: the bots are not running or not logging"
    u = goal.get('units')
    if u is not None:
        blocker += f"; bot units running {u[0]}/{u[1]}"
    if goal.get('stop'):
        blocker += f"; {goal['stop']}"
    if goal.get('town_placement'):
        blocker += f"; town plan last placed {goal['town_placement']:%m-%d %H:%MZ}"
    return f"STUCK {h:.1f} h: {goal['pool']}/{goal['plot']}@{goal['home']} -- {since}; blocker: {blocker}"


# ------------------------------------------------------------------------------------------------ loaders (files)
def newest_records(root):
    """{(pool, home, plot): (gen, path, first_gen_path)} for every project record, skipping .pre-reseed pools."""
    best, first = {}, {}
    for p in glob.glob(os.path.join(root, '_pool-*', 'project-*.g*.json')):
        m = REC_RE.search(p)
        if not m or '.pre-reseed' in p:
            continue
        k, g = (m.group('pool'), m.group('home'), m.group('plot')), int(m.group('gen'))
        if k not in best or g > best[k][0]:
            best[k] = (g, p)
        if k not in first or g < first[k][0]:
            first[k] = (g, p)
    return {k: (g, p, first[k][1]) for k, (g, p) in best.items()}


def townplan_transitions(root, pool, home):
    plans = []
    for p in glob.glob(os.path.join(root, '_pool-%s' % pool, 'townplan-%s.g*.json' % home)):
        m = PLAN_RE.search(p)
        if m:
            plans.append((int(m.group('gen')), p))
    if not plans:
        return None
    try:
        rec = json.load(open(max(plans)[1]))
    except (OSError, ValueError):
        return None
    ts = [ms_to_dt(t.get('at')) for t in rec.get('transitions') or [] if isinstance(t, dict)]
    ts = [t for t in ts if t]
    return max(ts) if ts else None


def unit_census(pattern):
    """(running, total) of systemd units matching pattern (mcshow@*.service / mcbot@*.service), or None."""
    try:
        r = subprocess.run(['systemctl', 'list-units', '--all', '--no-legend', '--plain', pattern],
                           capture_output=True, text=True, timeout=20)
        lines = [l.split() for l in r.stdout.splitlines() if l.strip()]
        lines = [l for l in lines if 'FIXTURE' not in l[0]]
        return sum(1 for l in lines if len(l) > 2 and l[2] == 'active'), len(lines)
    except Exception:
        return None


def last_stop(deploy_log):
    """The newest stop-bots row of a showcase deploy.jsonl that no later 'activated' row with running bots supersedes."""
    if not deploy_log:
        return None
    stop = None
    try:
        for line in open(deploy_log):
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get('event') == 'stop-bots':
                stop = r
            elif r.get('event') == 'activated' and (r.get('running_bots') or 0) > 0:
                stop = None
    except OSError:
        return None
    return f"last stop-bots {stop.get('t')}: {str(stop.get('why') or '')[:110]}" if stop else None


def collect(root, log_root, now, window=WINDOW, unit_pattern=None, deploy_log=None):
    """-> report dict: goals judged, denominators, alarms {key: line}."""
    recs = newest_records(root)
    plans = {(m.group('pool'), m.group('home')) for m in map(PLAN_RE.search, glob.glob(os.path.join(
        root, '_pool-*', 'townplan-*.g*.json'))) if m and '.pre-reseed' not in m.group('pool')}
    open_goals = []
    for (pool, home, plot), (gen, path, firstp) in sorted(recs.items()):
        try:
            rec = json.load(open(path))
        except (OSError, ValueError) as e:
            open_goals.append({'pool': pool, 'home': home, 'plot': plot, 'unreadable': f'{type(e).__name__}'})
            continue
        if rec.get('structure_complete') or rec.get('state') == 'complete':
            continue
        try:
            created = ms_to_dt(json.load(open(firstp)).get('at'))
        except (OSError, ValueError):
            created = ms_to_dt(rec.get('at'))
        prog = None
        try:
            pr = json.load(open(os.path.join(os.path.dirname(path), f'project-{home}.{plot}.progress.json')))
            prog = ms_to_dt(pr.get('at'))
        except (OSError, ValueError):
            pass
        open_goals.append({'pool': pool, 'home': home, 'plot': plot, 'gen': gen, 'state': rec.get('state'),
                           'created_at': created, 'progress_json': prog,
                           'townplan_transition': townplan_transitions(root, pool, home)})
    rep = {'generated_at': AL._iso(now), 'records_scanned': len(recs), 'townplans_scanned': len(plans),
           'open': len(open_goals), 'goals': [], 'alarms': {}}
    if not open_goals:
        return rep
    from lib.logwindow import load_window
    ev = load_window(now - window, now, root=log_root)
    rows = [{'t': r['t'], 'name': r['name'], 'status': ((r['raw'].get('skill') or {}).get('status')),
             'detail': r['detail'], 'pool': ((r['raw'].get('exp') or {}).get('pool')),
             'bot': (r.get('bot') or {}).get('name')} for r in ev.rows]
    facts = summarize_rows(rows)
    town = town_placements(rows)
    rep['rows_walked'] = len(rows)
    rep['bots_seen'] = len({r['bot'] for r in rows if r['bot']})
    rep['build_rows'] = sum(1 for r in rows if str(r['name']).lstrip('_').startswith('build'))
    units = unit_census(unit_pattern) if unit_pattern else None
    # start-bots.sh journals nothing, so a stop-bots row is only the blocker while units are actually down
    stop = last_stop(deploy_log) if units is None or units[0] < units[1] else None
    for g in open_goals:
        key = f"goal:{g['pool']}/{g['plot']}@{g['home']}"
        if g.get('unreadable'):
            rep['alarms'][key] = f"{g['pool']}/{g['plot']}@{g['home']}: project record UNREADABLE ({g['unreadable']})"
            continue
        rf = facts.get((g['pool'], g['plot']))
        goal = dict(g, progress_times=[g['progress_json'], g['townplan_transition']], row_facts=rf, window=window,
                    units=units, stop=stop, rows_in_window=len(rows), town_placement=town.get(g['pool']))
        line = judge(goal, now)
        last = max([t for t in goal['progress_times'] + [(rf or {}).get('last_progress')] if t], default=None)
        rep['goals'].append({'key': key, 'gen': g['gen'], 'state': g['state'], 'last_progress': last and AL._iso(last),
                             'created_at': g['created_at'] and AL._iso(g['created_at']),
                             'visits_in_window': (rf or {}).get('visits', 0),
                             'last_visit': {k: (AL._iso(v) if isinstance(v, dt.datetime) else v)
                                            for k, v in ((rf or {}).get('last_visit') or {}).items()} or None,
                             'stuck': bool(line), 'line': line})
        if line:
            rep['alarms'][key] = line
    return rep


def summary_line(label, rep):
    den = f"{rep['open']} open of {rep['records_scanned']} project records ({rep['townplans_scanned']} townplans scanned)"
    if rep.get('rows_walked') is not None:
        den += f"; {rep['rows_walked']:,} rows / {rep.get('bots_seen', 0)} bots in {WINDOW.total_seconds() / 3600:.0f} h"
    if rep['alarms']:
        return f"{label} goals: {len(rep['alarms'])} STUCK >= {STALL.total_seconds() / 3600:.0f} h; {den}"
    moving = [g for g in rep['goals'] if not g['stuck']]
    tail = '; '.join(f"{g['key'][5:]} last progress {g['last_progress'] or 'none'}" for g in moving[:3])
    return f"{label} goals OK: {den}" + (f"; {tail}" if tail else '')


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', required=True, help='fleet | showcase (names the state file and the alarm source)')
    ap.add_argument('--root', default='/var/lib/mcai')
    ap.add_argument('--logs', default='/var/log/mcai')
    ap.add_argument('--state-dir', default='~/digest')
    ap.add_argument('--units', help="systemd unit glob for the bot census (default mcshow@*.service for showcase, "
                                    "mcbot@*.service otherwise)")
    ap.add_argument('--deploy-log', help='showcase deploy.jsonl, for the last stop-bots row')
    ap.add_argument('--ship', help='append a kind=showcase_goal row to this filebeat-shipped file')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--no-state', action='store_true', help='print only: no state file, no ALARMS.log, no push')
    ap.add_argument('--now')
    a = ap.parse_args(argv)
    now = (dt.datetime.fromisoformat(a.now.replace('Z', '+00:00')) if a.now else dt.datetime.now(UTC)).replace(microsecond=0)
    units = a.units or ('mcshow@*.service' if a.label == 'showcase' else 'mcbot@*.service')
    deploy_log = a.deploy_log or ('/srv/showcase/ops/deploy.jsonl' if a.label == 'showcase' else None)
    try:
        rep = collect(a.root, a.logs, now, unit_pattern=units, deploy_log=deploy_log)
        rep['summary'] = summary_line(a.label, rep)
    except Exception as e:      # a watcher that crashes must alarm, not go quiet
        rep = {'generated_at': AL._iso(now), 'error': f'{type(e).__name__}: {str(e)[:300]}', 'goals': [],
               'alarms': {f'goalwatch:{a.label}': f'goalwatch {a.label} FAILED: {type(e).__name__}: {str(e)[:200]}'}}
        rep['summary'] = f'{a.label} goals: CHECK FAILED ({rep["error"][:120]})'
    rep['label'] = a.label
    print(rep['summary'])
    for line in rep['alarms'].values():
        print('  !! ' + line)
    if a.no_state:
        return 0
    sd = os.path.expanduser(a.state_dir)
    AL.write_json_atomic(os.path.join(sd, f'goalwatch-{a.label}.json'), rep)
    AL.raise_alarms(f'goalwatch-{a.label}', rep['alarms'], now, os.path.join(sd, f'goalwatch-{a.label}.pushstate.json'),
                    log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
    if a.ship:
        AL.ship_row(a.ship, {'kind': f'{a.label}_goal', 't': AL._iso(now), 'ok': not rep['alarms'],
                             'event': 'goal_stuck' if rep['alarms'] else 'goal_ok', 'why': rep['summary'],
                             'alarms': sorted(rep['alarms'].values()), 'goals': rep['goals']})
    return 0


if __name__ == '__main__':
    sys.exit(main())
