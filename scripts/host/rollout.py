#!/usr/bin/env python3
r"""rollout.py -- the ROLLOUT LEDGER (W5, fun mode 2026-10-28): one structured row per rollout, with its 60-minute check.

NO THIRD STORE. The ledger is two existing append-only files, read as one table:
  fleet     ~/canary-journal.jsonl on 10.0.0.31 -- a tier-1 owner-direct rollout is a phase `owner-direct` row (the phase
            showcase followrule and showcase-feed already read), now carrying sha / prev / env / tier / reviewer; its check
            is a phase `owner-direct-check` row for the same run. Neither phase starts with `read-` nor is DEPLOYED
            evidence, so canary-sched never mistakes a rollout for a canary (canary-sched.py: deployment()).
  showcase  /srv/showcase/ops/deploy.jsonl on 10.0.0.40 -- every `activated` row (showcase_ops.py writes it) IS a ledger
            row; sha / prev / piece come from its `staged` row, reviewer from a `reviewer` field there (W2) or a
            `rollout` annotation row this CLI appends; the check is an `event: rollout-check` row.

    rollout.py add --env fleet --run tidy-01 --sha 1a2b3c4d --prev auto --tier 1 --reviewer codex [--at ISO] [--note ..]
    rollout.py add --env showcase --release fc300013-6dd0ded8-fdd64ead --tier 1 --reviewer claude   (annotation only)
    rollout.py list [--env fleet|showcase] [--days 7]
    rollout.py check --due [--env ..]          (cron, every 10 min: every row >= 60 min old with no check)
    rollout.py check --run tidy-01 | --release <name>          (by hand; prints, appends, alarms)

THE 60-MINUTE CHECK reads [t0, t0 + 60 min] (t0 = the row's time), whenever it runs:
  tripper   fleet: `sudo -n env TRIPPER_LOCAL=1 /usr/local/bin/mcai-tripper` (dry: it can stop nothing without --apply),
            only while the check runs within 30 min of the window's end (it reads the present); showcase: every tripwire
            run in /srv/showcase/ops/trip.log between t0 and t0 + 100 min (it runs hourly at :35).
  deaths    _death rows in the window over ACTIVE bot-hours (bots x 10-min slots with a row), against a BASELINE rate:
            the 24 h before t0 (fleet: Elasticsearch, a wide window; showcase: its own files). Flag when the count is
            >= 2 (the two-death floor) AND above the Poisson 99.5 % bound of baseline x bot-hours (FAIL), or 95 % (WATCH).
  versions  bots whose newest row in the window runs the sha / of the bots present (positive control: rows and bots).
  crashes   units with >= 3 'Scheduled restart job' lines in the window (crash loop), and units that entered `failed`
            after t0; units already failed before t0 are listed, not blamed.
  VERDICT   FAIL (tripper TRIP, a crash loop, a unit failed after t0, deaths over 99.5 %) | WATCH (no bot-hours, sha not
            on every present bot, tripper unreadable, deaths over 95 %) | PASS. FAIL and WATCH go to ALARMS.log + push.
"""
import argparse
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import alarm as AL  # noqa: E402

UTC = dt.timezone.utc
JOURNAL = os.path.expanduser(os.environ.get('ROLLOUT_JOURNAL', '~/canary-journal.jsonl'))
DEPLOY = os.environ.get('ROLLOUT_DEPLOY', '/srv/showcase/ops/deploy.jsonl')
TRIP_LOG = '/srv/showcase/ops/trip.log'
TRIP_SLACK = dt.timedelta(minutes=40)
LATE = dt.timedelta(minutes=30)             # the fleet tripper reads NOW: past t1 + LATE it no longer describes the hour
CHECK_AFTER = dt.timedelta(minutes=60)
DUE_HORIZON = dt.timedelta(hours=24)        # older unchecked rows are listed UNCHECKED, never auto-run
BASELINE = dt.timedelta(hours=24)
LOOP_RESTARTS = 3
SHA_RE = re.compile(r'^[0-9a-f]{7,40}$')


def _ts(s):
    try:
        t = dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
        return t if t.tzinfo else None
    except (TypeError, ValueError):
        return None


def read_jsonl(path):
    out = []
    try:
        for line in open(path):
            try:
                r = json.loads(line)
                if isinstance(r, dict):
                    out.append(r)
            except ValueError:
                continue
    except OSError:
        pass
    return out


def append_jsonl(path, row):
    line = json.dumps(row, sort_keys=False) + '\n'
    try:
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o664)
    except PermissionError:
        # the showcase's deploy.jsonl is root's (showcase_ops.py runs as root): append through sudo, keep the owner
        r = subprocess.run(['sudo', '-n', 'tee', '-a', path], input=line, text=True, capture_output=True, timeout=20)
        if r.returncode != 0:
            raise PermissionError(f'{path}: not writable and sudo -n tee -a failed: {r.stderr.strip()[:120]}')
        return
    try:
        os.write(fd, line.encode())             # one write(2) on O_APPEND: never interleaves with another writer's line
    finally:
        os.close(fd)


# ------------------------------------------------------------------------------------------------ pure: the ledger
def fleet_ledger(journal):
    """Journal rows -> ledger rows (owner-direct), each with its LAST check row joined."""
    checks = {}
    for r in journal:
        if r.get('phase') == 'owner-direct-check' and r.get('of_ts'):
            checks[(r.get('run'), r.get('of_ts'))] = r
    out = []
    for r in journal:
        if r.get('phase') != 'owner-direct':
            continue
        out.append({'env': 'fleet', 'id': r.get('run'), 't': _ts(r.get('ts')), 'ts': r.get('ts'), 'sha': r.get('sha'),
                    'prev': r.get('prev'), 'tier': r.get('tier'), 'reviewer': r.get('reviewer'),
                    'note': r.get('note'), 'pool': r.get('pool'), 'legacy': not r.get('sha'),
                    'check': checks.get((r.get('run'), r.get('ts')))})
    return out


def showcase_ledger(deploy):
    """deploy.jsonl rows -> ledger rows (one per `activated`), staged facts and annotations joined by release name."""
    staged, notes, checks = {}, {}, {}
    for r in deploy:
        ev, rel = r.get('event'), r.get('release')
        if ev == 'staged' and rel:
            staged[rel] = r
        elif ev == 'rollout' and rel:
            notes[rel] = r
        elif ev == 'rollout-check' and rel:
            checks[(rel, r.get('of_t'))] = r
    out = []
    for r in deploy:
        if r.get('event') != 'activated':
            continue
        rel = r.get('release')
        s, n = staged.get(rel, {}), notes.get(rel, {})
        out.append({'env': 'showcase', 'id': rel, 't': _ts(r.get('t')), 'ts': r.get('t'),
                    'sha': s.get('sha') or (rel or '').split('-')[0], 'prev': s.get('prev') or (r.get('previous') or '').split('-')[0],
                    'tier': n.get('tier') or s.get('tier'), 'reviewer': n.get('reviewer') or s.get('reviewer'),
                    'note': s.get('why') or '', 'piece': s.get('piece'), 'running_bots': r.get('running_bots'),
                    'legacy': False, 'check': checks.get((rel, r.get('t')))})
    return supersede(out, staged)


def supersede(rows, staged):
    """PURE. Mark each showcase row whose window [t0, t0 + 60] is cut short by the NEXT release: 'until' = the next
    release's staged time (its bots restart between staged and activated), 'superseded_by' = its id. Without this a
    release replaced inside its hour was judged on the next release's rows and read 'sha on 0/10 bots' (10-29..10-31:
    every 0/10 check was a release superseded within 60 min; every unsuperseded one read 10/10)."""
    rows = sorted(rows, key=lambda r: r['t'] or dt.datetime.min.replace(tzinfo=UTC))
    for a, b in zip(rows, rows[1:]):
        if a['t'] is None or b['t'] is None:
            continue
        s = staged.get(b['id'], {})
        cut = min([x for x in (_ts(s.get('staged_at')), _ts(s.get('t')), b['t']) if x is not None and x > a['t']] or [b['t']])
        if cut < a['t'] + CHECK_AFTER:
            a['until'], a['superseded_by'] = cut, b['id']
    return rows


def due(rows, now, after=CHECK_AFTER, horizon=DUE_HORIZON):
    """Rows whose check is due: not legacy, no check, t0 + after <= now, t0 >= now - horizon."""
    return [r for r in rows if not r['legacy'] and r['check'] is None and r['t'] is not None
            and r['t'] + after <= now and r['t'] >= now - horizon]


def poisson_upper(mu, q):
    """Smallest k with P(X <= k) >= q for X ~ Poisson(mu)."""
    if mu <= 0:
        return 0
    k, p, cdf = 0, math.exp(-mu), math.exp(-mu)
    while cdf < q and k < 10000:
        k += 1
        p *= mu / k
        cdf += p
    return k


def verdict(f):
    """PURE. f: facts dict (see check_*). -> (PASS|WATCH|FAIL, [reasons])."""
    fail, watch = [], []
    tr = f.get('tripper') or {}
    if tr.get('verdict') == 'TRIP':
        fail.append(f"tripper TRIP: {'; '.join(tr.get('trips') or [])[:160]}")
    elif tr.get('verdict') not in ('OK', 'SKIP'):
        watch.append(f"tripper {tr.get('verdict') or 'UNREAD'}: {tr.get('why') or ''}"[:160])
    loops = f.get('crash_loops') or {}
    if loops:
        fail.append('crash loop: ' + ', '.join(f'{u} x{n}' for u, n in sorted(loops.items())[:5]))
    if f.get('failed_after'):
        fail.append('failed after the rollout: ' + ', '.join(f['failed_after'][:5]))
    bh, d = f.get('bot_hours') or 0, f.get('deaths') or 0
    if bh <= 0:
        watch.append('no active bot-hours in the window: nothing ran on the release (no exposure)')
    else:
        rate = f.get('baseline_rate')
        if rate is None:
            watch.append('no baseline death rate: deaths not judged')
        else:
            mu = rate * bh
            if d >= 2 and d > poisson_upper(mu, 0.995):
                fail.append(f'deaths {d} in {bh:.1f} bot-h vs {mu:.2f} expected (> Poisson 99.5 %)')
            elif d >= 2 and d > poisson_upper(mu, 0.95):
                watch.append(f'deaths {d} in {bh:.1f} bot-h vs {mu:.2f} expected (> Poisson 95 %)')
        on, present = f.get('bots_on_sha', 0), f.get('bots_present', 0)
        if present and on < present:
            watch.append(f'sha on {on}/{present} present bots: {", ".join((f.get("bots_off_sha") or [])[:4])}')
    return ('FAIL' if fail else 'WATCH' if watch else 'PASS'), fail + watch


def describe(f, v, why):
    rate = f.get('baseline_rate')
    base = f'{rate:.4f}/bot-h over {f.get("baseline_bot_hours", 0):,.0f} bot-h' if rate is not None else 'none'
    sup = (f"superseded by {f['superseded_by']} after {f.get('superseded_after_min')} min (window cut there); "
           if f.get('superseded_by') else '')
    return (f"{v}: {sup}deaths {f.get('deaths', 0)} / {f.get('bot_hours', 0):.1f} active bot-h (baseline {base}); "
            f"sha on {f.get('bots_on_sha', 0)}/{f.get('bots_present', 0)} bots ({f.get('rows', 0):,} rows); "
            f"tripper {(f.get('tripper') or {}).get('verdict')}; crash loops {len(f.get('crash_loops') or {})} "
            f"({f.get('unit_lines')} systemd unit lines read); "
            f"failed after t0 {len(f.get('failed_after') or [])} (before: {len(f.get('failed_before') or [])})"
            + (f" -- {'; '.join(why)}" if why else ''))


# ------------------------------------------------------------------------------------------------ fact gathering
def same_sha(a, b):
    """Two sha prefixes name the same commit when both have >= 7 hex digits and the shorter prefixes the longer."""
    a, b = str(a or '').lower(), str(b or '').lower()
    if len(a) < 7 or len(b) < 7:
        return False
    n = min(len(a), len(b))
    return a[:n] == b[:n]


def window_facts(rows, sha, start=None):
    """From Events rows of [t0, t0+60]: deaths, active bot-hours, bots on the sha (newest row per bot)."""
    from lib.logwindow import bot_hours
    newest = {}
    for r in rows:
        b = (r.get('bot') or {}).get('name')
        if b:
            newest[b] = r
    on, off = [], []
    for b, r in sorted(newest.items()):
        ver = str(((r.get('raw') or {}).get('code') or {}).get('version') or '').split('+')[0]
        (on if same_sha(ver, sha) else off).append(b)
    deaths = sum(1 for r in rows if str(r.get('name')).lstrip('_') == 'death')
    return {'rows': len(rows), 'bots_present': len(newest), 'bots_on_sha': len(on), 'bots_off_sha': off,
            'deaths': deaths, 'bot_hours': round(bot_hours(rows, start=start), 2)}


def file_baseline(t0, log_root):
    from lib.logwindow import load_window, bot_hours
    ev = load_window(t0 - BASELINE, t0, root=log_root)
    if not ev.rows:
        return None, 0.0
    bh = bot_hours(ev.rows, start=t0 - BASELINE)
    d = ev.count('_death', allow_zero=True)            # proven live: ev.rows is non-empty (the positive control)
    return (d / bh if bh else None), bh


def es_slot_bot_hours(ev, slot_min=10):
    """Active bot-hours in the SAME unit as the rollout window's (logwindow.bot_hours): bots with >= 1 document per
    slot_min-minute slot, summed. estelemetry's coverage() counts whole hours, which over-weights a bot that ran a few
    minutes of an hour; the baseline rate must be in the unit it is multiplied by (Codex r1)."""
    r = ev._search({'size': 0, 'query': ev._query(), 'aggs': {'s': {
        'date_histogram': {'field': '@timestamp', 'fixed_interval': f'{slot_min}m', 'min_doc_count': 1},
        'aggs': {'b': {'cardinality': {'field': 'bot.name', 'precision_threshold': 3000}}}}}})
    return sum(b['b']['value'] for b in r['aggregations']['s']['buckets']) * slot_min / 60.0


def es_baseline(t0):
    from lib.estelemetry import EsEvents
    ev = EsEvents.load('skill', since=t0 - BASELINE, until=t0, gaps='allow')
    if not ev.total():
        return None, 0.0
    bh = es_slot_bot_hours(ev)
    d = ev.count('_death', allow_zero=True)            # ev.total() > 0 above is the positive control
    return (d / bh if bh else None), bh


def tripper_fleet():
    try:
        r = subprocess.run(['sudo', '-n', 'env', 'TRIPPER_LOCAL=1', '/usr/local/bin/mcai-tripper'], capture_output=True,
                           text=True, timeout=180)
    except Exception as e:
        return {'verdict': 'UNREAD', 'why': f'{type(e).__name__}'}
    out = r.stdout + r.stderr
    trips = [l.strip()[5:].strip() for l in out.splitlines() if l.strip().startswith('TRIP ')]
    if trips:
        return {'verdict': 'TRIP', 'trips': trips, 'at': AL._iso(dt.datetime.now(UTC))}
    if 'no threshold tripped' in out:
        return {'verdict': 'OK', 'at': AL._iso(dt.datetime.now(UTC))}
    return {'verdict': 'UNREAD', 'why': (out.strip().splitlines() or ['no output'])[-1][:120]}


TRIP_RUN_RE = re.compile(r'^===== (\S+) rc=')


def parse_trip_log(text):
    """PURE. showcase trip.log -> [(t, verdict, why)] one per run block ('===== <iso> rc=N' ... 'VERDICT  X -- why')."""
    out, cur = [], None
    for line in text.splitlines():
        m = TRIP_RUN_RE.match(line)
        if m:
            cur = _ts(m.group(1))
            continue
        if line.startswith('VERDICT') and cur is not None:
            body = line[len('VERDICT'):].strip()
            v, _, why = body.partition(' -- ')
            out.append((cur, v.strip(), why.strip()))
            cur = None
    return out


def trip_in_window(runs, t0, t1, slack=TRIP_SLACK, superseded=False):
    """PURE. The showcase tripwire's verdict over the rollout's hour: TRIP if any run in [t0, t1 + slack] tripped, OK if
    at least one ran there and none tripped, UNREAD if none ran (the tripwire runs hourly at :35, so slack is 40 min).
    SUPERSEDED (t1 = the next release's staged time): no slack, since a later run judges the successor's code (Codex r1),
    and a short life with no run in it is SKIP (named, not a WATCH): the successor's own check covers what follows."""
    if superseded:
        slack = dt.timedelta(0)
    inside = [r for r in runs if t0 <= r[0] <= t1 + slack]
    if not inside:
        if superseded:
            return {'verdict': 'SKIP', 'why': f'no tripwire run in the release\'s life {t0:%H:%MZ}..{t1:%H:%MZ} (superseded)'}
        return {'verdict': 'UNREAD', 'why': f'no tripwire run between {t0:%H:%MZ} and {t1 + slack:%H:%MZ}'}
    trips = [r for r in inside if r[1] == 'TRIP']
    if trips:
        return {'verdict': 'TRIP', 'trips': [f'{r[0]:%H:%MZ} {r[2]}' for r in trips], 'runs': len(inside)}
    return {'verdict': 'OK', 'runs': len(inside), 'why': ', '.join(f'{r[0]:%H:%MZ} {r[1]}' for r in inside)}


def tripper_showcase(t0, t1, path=TRIP_LOG, superseded=False):
    try:
        return trip_in_window(parse_trip_log(open(path, errors='replace').read()), t0, t1, superseded=superseded)
    except OSError as e:
        return {'verdict': 'UNREAD', 'why': f'{path}: {type(e).__name__}'}


def restart_counts(journal_json_lines, prefix):
    """PURE. systemd's own (_PID=1) journal as JSON lines -> ({unit: 'Scheduled restart job' count}, unit lines seen).
    The second number is the positive control: the manager logs Started/Stopped for these units, so a window with
    bots running and NO unit line at all means the read saw nothing, not that nothing restarted."""
    loops, seen = {}, 0
    for line in journal_json_lines:
        try:
            j = json.loads(line)
        except ValueError:
            continue
        u = str(j.get('UNIT') or '')
        if not u.startswith(prefix):
            continue
        seen += 1
        if 'Scheduled restart job' in str(j.get('MESSAGE')):
            loops[u] = loops.get(u, 0) + 1
    return loops, seen


def crash_facts(pattern, t0, t1):
    loops, failed_after, failed_before, seen = {}, [], [], None
    try:
        # _PID=1 = the service manager's own lines only. `-u mcbot@*` also returns every bot's stdout and took > 120 s
        # for 80 bots x 1 h; the restart lines are the manager's, so this loses nothing.
        r = subprocess.run(['sudo', '-n', 'journalctl', '--no-pager', '-o', 'json', '_PID=1',
                            '--since', t0.strftime('%Y-%m-%d %H:%M:%S UTC'), '--until', t1.strftime('%Y-%m-%d %H:%M:%S UTC')],
                           capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip()[:120])
        loops, seen = restart_counts(r.stdout.splitlines(), pattern.split('*')[0])
    except Exception:
        loops = {'<journal unreadable>': LOOP_RESTARTS}
    loops = {u: n for u, n in loops.items() if n >= LOOP_RESTARTS}
    try:
        r = subprocess.run(['systemctl', 'list-units', '--all', '--state=failed', '--no-legend', '--plain', pattern],
                           capture_output=True, text=True, timeout=20)
        for l in r.stdout.splitlines():
            u = l.split()[0] if l.split() else None
            if not u:
                continue
            s = subprocess.run(['systemctl', 'show', '-p', 'InactiveEnterTimestamp', '--timestamp=utc', u],
                               capture_output=True, text=True, timeout=10).stdout.strip().split('=', 1)[-1]
            try:
                when = dt.datetime.strptime(s.replace(' UTC', ''), '%a %Y-%m-%d %H:%M:%S').replace(tzinfo=UTC)
            except ValueError:
                when = None
            (failed_after if when and when >= t0 else failed_before).append(u)
    except Exception:
        pass
    return {'crash_loops': loops, 'failed_after': failed_after, 'failed_before': failed_before, 'unit_lines': seen}


def run_check(row, log_root='/var/log/mcai'):
    from lib.logwindow import load_window
    t0 = row['t']
    t1 = min(t0 + CHECK_AFTER, row.get('until') or t0 + CHECK_AFTER)
    ev = load_window(t0, t1, root=log_root, bots='showcase-*' if row['env'] == 'showcase' else '*')
    rows = ev.rows
    if row['env'] == 'fleet':
        rows = [r for r in rows if not str((r.get('bot') or {}).get('name') or '').startswith('showcase')]
    f = window_facts(rows, row.get('sha') or '', start=t0)
    if row['env'] == 'fleet':
        try:
            f['baseline_rate'], f['baseline_bot_hours'] = es_baseline(t0)
        except Exception as e:
            f['baseline_rate'], f['baseline_error'] = None, f'{type(e).__name__}: {str(e)[:120]}'
        if dt.datetime.now(UTC) <= t1 + LATE:
            f['tripper'] = tripper_fleet()
        else:
            f['tripper'] = {'verdict': 'UNREAD', 'why': f'check ran after {AL._iso(t1 + LATE)}: the tripper reads the present'}
        f.update(crash_facts('mcbot@*.service', t0, t1))
    else:
        f['baseline_rate'], f['baseline_bot_hours'] = file_baseline(t0, log_root)
        f['tripper'] = tripper_showcase(t0, t1, superseded=bool(row.get('superseded_by')))
        f.update(crash_facts('mcshow@*.service', t0, t1))
    f['window'] = [AL._iso(t0), AL._iso(t1)]
    if row.get('superseded_by'):
        f['superseded_by'], f['superseded_after_min'] = row['superseded_by'], round((t1 - t0).total_seconds() / 60, 1)
    v, why = verdict(f)
    return v, why, f


def record_check(row, v, why, f, now):
    line = describe(f, v, why)
    if row['env'] == 'fleet':
        append_jsonl(JOURNAL, {'ts': AL._iso(now), 'run': row['id'], 'phase': 'owner-direct-check', 'of_ts': row['ts'],
                               'sha': row.get('sha'), 'verdict': v, 'note': line[:900], 'facts': f})
    else:
        append_jsonl(DEPLOY, {'t': AL._iso(now), 'event': 'rollout-check', 'release': row['id'], 'of_t': row['ts'],
                              'verdict': v, 'why': line[:900], 'facts': f})
    return line


# ------------------------------------------------------------------------------------------------ CLI
def ledger(env):
    rows = []
    if env in (None, 'fleet') and os.path.exists(JOURNAL):
        rows += fleet_ledger(read_jsonl(JOURNAL))
    if env in (None, 'showcase') and os.path.exists(DEPLOY):
        rows += showcase_ledger(read_jsonl(DEPLOY))
    return sorted(rows, key=lambda r: r['t'] or dt.datetime.min.replace(tzinfo=UTC))


def auto_prev(at, log_root='/var/log/mcai'):
    """The majority code.version of the fleet's rows in the hour before the rollout."""
    from lib.logwindow import load_window
    ev = load_window(at - dt.timedelta(minutes=60), at - dt.timedelta(minutes=2), root=log_root)
    from collections import Counter
    c = Counter(str(((r['raw'].get('code') or {}).get('version') or '')).split('+')[0] for r in ev.rows)
    c.pop('', None)
    if not c:
        raise SystemExit('--prev auto: no rows with code.version in the hour before the rollout; pass --prev SHA')
    return c.most_common(1)[0][0]


def cmd_add(a):
    now = dt.datetime.now(UTC).replace(microsecond=0)
    at = _ts(a.at) if a.at else now
    if at is None:
        raise SystemExit('--at must be ISO with a zone, e.g. 2026-10-28T14:00:00Z')
    if not a.reviewer:
        raise SystemExit('--reviewer is required: a rollout row names who reviewed it')
    if a.env == 'fleet':
        if not (a.run and a.sha and SHA_RE.match(a.sha)):
            raise SystemExit('fleet: --run NAME and --sha (7-40 hex) are required')
        prev = auto_prev(at) if a.prev == 'auto' else a.prev
        if not prev or not SHA_RE.match(prev):
            raise SystemExit('fleet: --prev SHA|auto is required (the rollback target)')
        row = {'ts': AL._iso(at), 'run': a.run, 'phase': 'owner-direct',
               'note': a.note or f'tier {a.tier} owner-direct rollout {a.sha[:8]} (prev {prev[:8]}), reviewed by {a.reviewer}',
               'sha': a.sha, 'prev': prev, 'env': 'fleet', 'tier': a.tier, 'reviewer': a.reviewer}
        append_jsonl(JOURNAL, row)
    else:
        if not a.release:
            raise SystemExit('showcase: --release NAME (an activated release in deploy.jsonl) is required')
        if not any(r['id'] == a.release for r in showcase_ledger(read_jsonl(DEPLOY))):
            raise SystemExit(f'showcase: no activated row for {a.release} in {DEPLOY}')
        row = {'t': AL._iso(now), 'event': 'rollout', 'release': a.release, 'tier': a.tier, 'reviewer': a.reviewer,
               'why': a.note or ''}
        append_jsonl(DEPLOY, row)
    print('ADDED ' + json.dumps(row))
    return 0


def fmt(r):
    c = r['check']
    now = dt.datetime.now(UTC)
    chk = ((c.get('verdict') or '?') if c else 'never checked (legacy row: no sha)' if r['legacy'] else
           'UNCHECKED (before the ledger / past the 24 h due horizon)' if r['t'] and r['t'] < now - DUE_HORIZON else 'PENDING')
    return (f"{r['ts'] or '?':<21} {r['env']:<8} {str(r['id'])[:28]:<28} sha {str(r['sha'] or '-')[:8]:<8} "
            f"prev {str(r['prev'] or '-')[:8]:<8} tier {r['tier'] or '-'} reviewer {r['reviewer'] or '<not recorded>'}  "
            f"60-min: {chk}")


def cmd_list(a):
    now = dt.datetime.now(UTC)
    for r in ledger(a.env):
        if r['t'] and r['t'] >= now - dt.timedelta(days=a.days):
            print(fmt(r))
    return 0


def cmd_check(a):
    now = dt.datetime.now(UTC).replace(microsecond=0)
    rows = ledger(a.env)
    if a.due:
        todo = due(rows, now)
    else:
        key = a.run or a.release
        todo = [r for r in rows if r['id'] == key and not r['legacy']][-1:]
        if not todo:
            raise SystemExit(f'no ledger row with a sha for {key}')
    alarms = {}
    for r in todo:
        try:
            v, why, f = run_check(r)
            line = record_check(r, v, why, f, now)
        except Exception as e:      # recorded too, so a broken check is reported once, not re-run every 10 min
            v = 'ERROR'
            line = record_check(r, v, [f'check failed: {type(e).__name__}: {str(e)[:200]}'], {}, now)
        print(f"{r['env']} {r['id']} {str(r['sha'])[:8]} @ {r['ts']}: {line}")
        if v != 'PASS':
            alarms[f"rollout:{r['env']}/{r['id']}@{r['ts']}"] = f"ROLLOUT {r['env']} {r['id']} {str(r['sha'])[:8]} {line}"
        if a.ship and r['env'] == 'showcase':
            AL.ship_row(a.ship, {'kind': 'showcase_rollout', 't': AL._iso(now), 'ok': v == 'PASS', 'event': v,
                                 'release': f"{r['id']}@{r['ts']}",
                                 'why': f"{r['id']}: {line}"[:1500]})
    sd = os.path.expanduser(a.state_dir)
    label = a.env or 'all'
    latest = {'generated_at': AL._iso(now), 'checked': len(todo),
              'pending': [r['id'] for r in rows if not r['legacy'] and r['check'] is None and r['t'] and r['t'] + CHECK_AFTER > now],
              'recent': [fmt(r) for r in rows if r['t'] and r['t'] >= now - dt.timedelta(days=1)]}
    AL.write_json_atomic(os.path.join(sd, f'rollout-{label}.json'), latest)
    # a check runs once per rollout, so its non-PASS is a ONE-SHOT event: logged and pushed once, never 'cleared'
    AL.one_shot(f'rollout-{label}', alarms, now, log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('add')
    p.add_argument('--env', required=True, choices=['fleet', 'showcase'])
    p.add_argument('--run'); p.add_argument('--sha'); p.add_argument('--prev'); p.add_argument('--release')
    p.add_argument('--tier', type=int, default=1); p.add_argument('--reviewer'); p.add_argument('--at'); p.add_argument('--note')
    p = sub.add_parser('list')
    p.add_argument('--env', choices=['fleet', 'showcase']); p.add_argument('--days', type=float, default=7)
    p = sub.add_parser('check')
    p.add_argument('--env', choices=['fleet', 'showcase']); p.add_argument('--due', action='store_true')
    p.add_argument('--run'); p.add_argument('--release'); p.add_argument('--state-dir', default='~/digest')
    p.add_argument('--ship'); p.add_argument('--no-push', action='store_true')
    a = ap.parse_args(argv)
    return {'add': cmd_add, 'list': cmd_list, 'check': cmd_check}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())
