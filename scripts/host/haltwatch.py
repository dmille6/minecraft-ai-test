#!/usr/bin/env python3
r"""haltwatch.py -- the HALT ALARM (W5 addition, 2026-10-28): the showcase tripwire stopped all ten bots at 12:37Z and
nobody noticed for ~37 min. A stop that is not followed by a start within GRACE (15 min) now reaches the owner.

SHOWCASE (10.0.0.40). The stop is the newest `stop-bots` row of /srv/showcase/ops/deploy.jsonl; start-bots.sh writes no
row, so "started again" is read from systemd: every mcshow@<bot> unit (FIXTURE excluded) active, or an `activated` row
with running_bots > 0 after the stop. Alarm: a stop >= GRACE old with units still down, naming the stop's why (a
tripwire's TRIP reasons). Also: units down with NO stop recorded (a crash or an unlogged stop), once >= GRACE.
FLEET (10.0.0.31). A halt is the death tripper's incident bundle (/var/lib/mcai-tripper/incident-*.json) that stopped
bots which are still not active >= GRACE later (naming the trips), or fewer than HALF of the mcbot@ units running.
One long-failed unit (board-a-Charlie) is not a halt; it is printed as the denominator.

    python3 haltwatch.py --label showcase --ship /var/log/showcase/heartbeat.jsonl     (cron */5 on .40)
    python3 haltwatch.py --label fleet                                                 (cron */5 on .31)

Writes <state-dir>/haltwatch-<label>.json, ALARMS.log events and pushes (lib/alarm.py, deduplicated, 6 h re-push).
"""
import argparse
import datetime as dt
import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import alarm as AL  # noqa: E402

UTC = dt.timezone.utc
GRACE = dt.timedelta(minutes=15)
HALF = 0.5


def _ts(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None


def units(pattern):
    """{unit_name: active_state} for units matching pattern, FIXTURE units excluded; None if systemctl fails."""
    try:
        r = subprocess.run(['systemctl', 'list-units', '--all', '--no-legend', '--plain', pattern],
                           capture_output=True, text=True, timeout=20)
    except Exception:
        return None
    if r.returncode != 0:
        return None
    out = {}
    for l in r.stdout.splitlines():
        p = l.split()
        if len(p) > 2 and 'FIXTURE' not in p[0]:
            out[p[0]] = p[2]
    return out


# ------------------------------------------------------------------------------------------------ pure decisions
def judge_showcase(deploy_rows, unit_states, now, grace=GRACE):
    """PURE. deploy_rows: parsed deploy.jsonl rows in file order; unit_states: {unit: 'active'|...} or None.
    -> (alarm line | None, summary line)."""
    if unit_states is None:
        return 'showcase bot census UNREADABLE (systemctl failed) -- cannot tell running from stopped', 'census unreadable'
    total = len(unit_states)
    up = sum(1 for v in unit_states.values() if v == 'active')
    stop = None
    for r in deploy_rows:
        t = _ts(r.get('t'))
        if t is None or t > now:
            continue
        if r.get('event') == 'stop-bots':
            stop = (t, str(r.get('why') or ''))
        elif r.get('event') == 'activated' and (r.get('running_bots') or 0) > 0:
            stop = None
    if total == 0:
        return 'showcase: NO mcshow@ units found -- the bots are not installed or the census is wrong', 'no units'
    if up == total:
        return None, f'showcase running {up}/{total} bot units'
    if stop is not None:
        age = now - stop[0]
        kind = 'TRIPWIRE' if stop[1].strip().lower().startswith('tripwire') else 'deliberate'
        why = stop[1].split('TRIP --', 1)[1].strip() if 'TRIP --' in stop[1] else stop[1]
        summ = f'showcase {up}/{total} running; {kind} stop {stop[0]:%m-%d %H:%MZ} ({age.total_seconds() / 60:.0f} min ago)'
        if age < grace:
            return None, summ + ' -- inside the 15-min grace'
        return (f'SHOWCASE HALTED {age.total_seconds() / 3600:.1f} h: {kind} stop-bots {stop[0]:%m-%d %H:%MZ}, '
                f'{up}/{total} bot units running, no start since; reason: {why[:200]} -- read /srv/showcase/ops/trip.log '
                f'on 10.0.0.40'), summ
    down = sorted(u for u, v in unit_states.items() if v != 'active')
    return (f'SHOWCASE BOTS DOWN with NO stop-bots row: {up}/{total} running; down {", ".join(down[:5])}'
            f'{" ..." if len(down) > 5 else ""} -- a crash or an unlogged stop; check journalctl on 10.0.0.40'), \
        f'showcase {up}/{total} running, no stop recorded'


def judge_fleet(incidents, unit_states, now, grace=GRACE, unit_of=None):
    """PURE. incidents: [{'at': dt, 'trips': [[scope, reason]], 'stopped': [bot], 'dry_run': bool}];
    unit_states: {'mcbot@<instance>.service': state} or None; unit_of: {bot display name: systemd instance} (the
    tripper's own /srv/mcbots/bot-manifest.json -- incidents name BOTS, units are INSTANCES). -> (alarm | None, summary)."""
    unit_of = unit_of or {}
    if unit_states is None:
        return 'fleet bot census UNREADABLE (systemctl failed)', 'census unreadable'
    total = len(unit_states)
    up = sum(1 for v in unit_states.values() if v == 'active')
    summ = f'fleet running {up}/{total} mcbot units'
    if total == 0:
        return 'fleet: NO mcbot@ units found', 'no units'
    alarms = []
    for inc in sorted(incidents, key=lambda i: i['at']):
        if inc.get('dry_run') or not inc.get('stopped') or now - inc['at'] < grace:
            continue
        still = [b for b in inc['stopped'] if unit_states.get(f'mcbot@{unit_of.get(b, b)}.service') != 'active']
        if still:
            why = '; '.join(f'{s}: {r}' for s, r in (inc.get('trips') or []))[:200]
            alarms.append(f'FLEET HALT: the death tripper stopped {len(inc["stopped"])} bot(s) at {inc["at"]:%m-%d %H:%MZ} '
                          f'and {len(still)} are still down ({", ".join(still[:5])}); trips: {why}')
    if up < HALF * total:
        alarms.append(f'FLEET HALT: only {up}/{total} mcbot units running (< {HALF:.0%})')
    return (' | '.join(alarms) or None), summ


def load_incidents(d, now, horizon=dt.timedelta(days=2)):
    out = []
    for p in glob.glob(os.path.join(d, 'incident-*.json')):
        try:
            r = json.load(open(p))
            at = dt.datetime.strptime(r['at'], '%Y%m%dT%H%M%SZ').replace(tzinfo=UTC)
        except (OSError, ValueError, KeyError):
            continue
        if now - at <= horizon:
            out.append({'at': at, 'trips': r.get('trips'), 'stopped': r.get('stopped') or [], 'dry_run': r.get('dry_run')})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', required=True, choices=['fleet', 'showcase'])
    ap.add_argument('--deploy-log', default='/srv/showcase/ops/deploy.jsonl')
    ap.add_argument('--incidents', default='/var/lib/mcai-tripper')
    ap.add_argument('--manifest', default='/srv/mcbots/bot-manifest.json', help="the tripper's bot -> unit map")
    ap.add_argument('--state-dir', default='~/digest')
    ap.add_argument('--ship')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--no-state', action='store_true')
    a = ap.parse_args(argv)
    now = dt.datetime.now(UTC).replace(microsecond=0)
    try:
        if a.label == 'showcase':
            rows = []
            for line in open(a.deploy_log):
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
            line, summ = judge_showcase(rows, units('mcshow@*.service'), now)
        else:
            try:
                unit_of = json.load(open(a.manifest)).get('bots') or {}
            except (OSError, ValueError, AttributeError):
                unit_of = {}
            line, summ = judge_fleet(load_incidents(a.incidents, now), units('mcbot@*.service'), now, unit_of=unit_of)
    except Exception as e:
        line, summ = f'haltwatch {a.label} FAILED: {type(e).__name__}: {str(e)[:200]}', 'check failed'
    active = {f'halt:{a.label}': line} if line else {}
    rep = {'generated_at': AL._iso(now), 'label': a.label, 'summary': summ, 'alarms': active}
    print(('!! ' + line) if line else summ)
    if a.no_state:
        return 0
    sd = os.path.expanduser(a.state_dir)
    AL.write_json_atomic(os.path.join(sd, f'haltwatch-{a.label}.json'), rep)
    AL.raise_alarms(f'haltwatch-{a.label}', active, now, os.path.join(sd, f'haltwatch-{a.label}.pushstate.json'),
                    log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
    if a.ship:
        AL.ship_row(a.ship, {'kind': f'{a.label}_halt', 't': AL._iso(now), 'ok': not line,
                             'event': 'halt' if line else 'running', 'why': line or summ})
    return 0


if __name__ == '__main__':
    sys.exit(main())
