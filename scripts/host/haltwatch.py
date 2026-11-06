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

SLOT PUSH, keyed by CAUSE (ONE PAGER, phase 1 11-06). The push now fires when NO CANARY HAS BEEN DEPLOYED for 60 min,
whatever the reason (alarmhead.slot_nodeploy): a live install-hold, an autorebase building or refused, a drawing loop and
a blocked head all count, and the key is slot:nodeploy:<cause>, so a new cause pushes again (11-05: a live hold 00:00-09:55Z
never alarmed and a cause change at 14:00Z did not re-push). The header line (alarmhead.slot_idle) is unchanged.

SLOT PUSH (fleet only, 11-02, superseded above). The canary slot sat idle 2.5 h (23:50Z-02:25Z) behind a BLOCKED head (an autorebase
refusal: "no variant for the fleet base"). alarmhead.slot_idle saw it -- '!! canary slot IDLE' from 00:50Z -- but that
line exists only in the fleetstatus header, which nobody ran, and canary-sched's own BLOCKED page goes to
~/digest/page.jsonl, which nothing pushes. Now every fleet run also reads ~/digest/sched.log through the SAME
alarmhead.slot_idle and PUSHES its '!! ' line (a free slot that BLOCK / WAIT / IDLE ticks held >= 60 min, or a scheduler
that stopped ticking) as source `slotwatch`, deduplicated by its own push state (slotwatch.pushstate.json): pushed when it
starts, every 6 h while it lasts, once when it clears. It is kept out of haltwatch-fleet.json's alarms (the header already
prints the slot line itself).
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
from lib import alarmhead as AH  # noqa: E402

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
def slot_alarm(line):
    """PURE. alarmhead's slot line -> {key: text} to push (empty when it is not a '!! ' line). Two stable keys, so an idle
    streak whose minutes and head text change every tick is ONE alarm, not a new one per run."""
    if not line or not line.startswith('!! '):
        return {}
    text = line[3:]
    return {'slot:idle' if text.startswith('canary slot IDLE') else 'slot:scheduler': text}


# the start journal (start-bots.sh, phase 1 item 4): only a VERIFIED start clears a stop. The legacy row written by the 11-05
# visuals restart (start-bots-after-restart, rc 0) counts the same way.
STARTED = ('start-verified',)
GRACE_ROLLBACK = dt.timedelta(minutes=30)   # a tripwire stop that trip-remedy is rolling back + restarting: time to verify
GRACE_TRIP = dt.timedelta(minutes=5)        # a tripwire stop whose remedy row is not written yet (stop-bots takes ~3 min)


def showcase_lifecycle(deploy_rows, now):
    """PURE. deploy.jsonl rows in file order -> {'stop': (t, why) | None, 'plan': trip-remedy plan of that stop | None,
    'quarantined': {bot}, 'started': t | None}. A stop stays open until a later VERIFIED start; an `activated` row no longer
    clears it (Codex 11-06: activation restarts only running bots, it is not a start). A later stop wins over an earlier start.
    A quarantine (Z1: one trapped bot's unit stopped) is expected-down until the next verified start."""
    stop, plan, quar, started = None, None, set(), None
    for r in deploy_rows:
        t = _ts(r.get('t'))
        if t is None or t > now:
            continue
        ev = r.get('event')
        if ev == 'stop-bots':
            stop, plan = (t, str(r.get('why') or '')), None
        elif ev == 'trip-remedy' and stop is not None and isinstance(r.get('plan'), dict):
            plan = r['plan']
        elif ev in STARTED or (ev == 'start-bots-after-restart' and r.get('rc') == 0):
            stop, plan, quar, started = None, None, set(), t
        elif ev == 'quarantine':
            quar |= {str(b) for b in r.get('bots') or []}
    return {'stop': stop, 'plan': plan, 'quarantined': quar, 'started': started}


def judge_showcase(deploy_rows, unit_states, now, grace=GRACE):
    """PURE. deploy_rows: parsed deploy.jsonl rows in file order; unit_states: {unit: 'active'|...} or None.
    -> (alarm line | None, summary line). The STOP ROW IS READ FIRST (phase 1 item 4): stop-bots `disable --now` unloads the
    units, so an empty census during a stop is the stop, never "the census is wrong"."""
    lc = showcase_lifecycle(deploy_rows, now)
    stop = lc['stop']
    total = len(unit_states) if unit_states is not None else 0
    up = sum(1 for v in (unit_states or {}).values() if v == 'active')
    if stop is not None and (unit_states is None or up < total or total == 0):
        age = now - stop[0]
        kind = 'TRIPWIRE' if stop[1].strip().lower().startswith('tripwire') else 'deliberate'
        why = stop[1].split('TRIP --', 1)[1].strip() if 'TRIP --' in stop[1] else stop[1]
        plan = lc['plan'] or {}
        g = ({'rollback-restart': GRACE_ROLLBACK, 'stop': dt.timedelta(0), 'rollback-stopped': dt.timedelta(0)}.get(plan.get('action'), GRACE_TRIP)
             if kind == 'TRIPWIRE' else grace)
        census = 'census UNREADABLE' if unit_states is None else f'{up}/{total} bot units running'
        remedy = f'; remedy: {plan.get("action")} -- {str(plan.get("why"))[:160]}' if plan else ''
        summ = f'showcase {census}; {kind} stop {stop[0]:%m-%d %H:%MZ} ({age.total_seconds() / 60:.0f} min ago)'
        if age < g:
            return None, summ + f' -- inside the {g.total_seconds() / 60:.0f}-min grace'
        return (f'SHOWCASE HALTED {age.total_seconds() / 3600:.1f} h: {kind} stop-bots {stop[0]:%m-%d %H:%MZ}, {census}, no '
                f'verified start since; reason: {why[:200]}{remedy} -- read /srv/showcase/ops/trip.log on 10.0.0.40'), summ
    if unit_states is None:
        return 'showcase bot census UNREADABLE (systemctl failed) -- cannot tell running from stopped', 'census unreadable'
    if total == 0:
        return 'showcase: NO mcshow@ units found and no stop recorded -- the bots are not installed or were stopped by hand', 'no units'
    if up == total:
        q = sorted(lc['quarantined'])
        return None, f'showcase running {up}/{total} bot units' + (f'; quarantined (Z1): {", ".join(q)}' if q else '')
    down = sorted(u for u, v in unit_states.items() if v != 'active')
    qu = {f'mcshow@{b}.service' for b in lc['quarantined']}
    if set(down) <= qu:
        return None, f'showcase running {up}/{total}; quarantined (Z1, paged when it happened): {", ".join(down)}'
    down = [u for u in down if u not in qu]
    return (f'SHOWCASE BOTS DOWN with NO stop-bots row: {up}/{total} running; down {", ".join(down[:5])}'
            f'{" ..." if len(down) > 5 else ""} -- a crash or an unlogged stop; check journalctl on 10.0.0.40'), \
        f'showcase {up}/{total} running, no stop recorded'


# ------------------------------------------------------------------------------------------------ the tripwire's pages
EVENT_KINDS = ('auto-rollback', 'auto-rollback-start', 'quarantine')
TRIP_STALE = dt.timedelta(minutes=130)        # the read runs hourly at :35


def showcase_events(deploy_rows, cursor):
    """PURE. -> ([(key, line)] of the remedy events after `cursor` (the newest paged row's t and how many rows carried that t),
    new cursor). cursor None = the first run: nothing is paged, the cursor starts at the end (history is not news)."""
    rows = [r for r in deploy_rows if r.get('event') in EVENT_KINDS and _ts(r.get('t'))]
    end = max((r['t'] for r in rows), default=None)
    new_cur = {'t': end, 'n': sum(1 for r in rows if r['t'] == end)} if end else (cursor or {'t': None, 'n': 0})
    if cursor is None:
        return [], new_cur
    ct, cn = cursor.get('t'), int(cursor.get('n') or 0)
    out, seen_at_ct = [], 0
    for r in rows:
        if ct and r['t'] < ct:
            continue
        if ct and r['t'] == ct:
            seen_at_ct += 1
            if seen_at_ct <= cn:
                continue
        ev = r['event']
        if ev == 'auto-rollback':
            line = (f'AUTO-ROLLBACK {r.get("from")} -> {r.get("to")} for {r.get("classes")}: '
                    f'{"restarting the bots (start-bots.sh)" if r.get("restart") else "the bots stay STOPPED"} (rc {r.get("rc")}); {str(r.get("why"))[:200]}')
        elif ev == 'auto-rollback-start':
            line = (f'AUTO-ROLLBACK START on {r.get("release")}: start-bots.sh rc {r.get("rc")}'
                    f'{" -- VERIFIED, running" if r.get("rc") == 0 else " -- FAILED, the bots are stopped: " + str(r.get("tail"))[-160:]}')
        else:
            line = f'QUARANTINE (Z1 trapped in a zone): stopped only {", ".join(r.get("bots") or [])}; the world goes on. {str(r.get("why"))[:200]}'
        out.append((f'{ev}:{r["t"]}', line))
    return out, new_cur


def showcase_reports(trip, now, stop_open, prev_active):
    """PURE. trip: trip-last.json or None. -> {key: line}: one tier-1 key per REPORT gate (plan conformance: paged, never a
    stop), with its new items. A Z1 quarantine is paged by its event instead. A stale read (> TRIP_STALE, bots running)
    keeps the previous report keys (no false CLEARED) and adds trip:stale; during a stop the read is skipped by design."""
    t = _ts((trip or {}).get('t'))
    if t is None or now - t > TRIP_STALE:
        out = dict(prev_active or {})
        if not stop_open:
            out['trip:stale'] = (f'the showcase tripwire read is {"missing" if t is None else "%.1f h old" % ((now - t).total_seconds() / 3600)}'
                                 f' (it runs hourly at :35): nothing is judging the showcase -- check root cron and /srv/showcase/ops/trip.log')
        return out
    items = (trip or {}).get('new_items') or {}
    out = {}
    for r in (trip or {}).get('reports') or []:
        p = str(r).split()
        if len(p) < 2 or (p[0] == 'S3' and p[1] == 'Z1'):
            continue
        gate = ' '.join(p[1:3]) if p[0] in ('S5', 'S6') else ' '.join(p[:2])
        sample = items.get(gate) or []
        out[f'report:{p[0]} {p[1]}'] = (f'REPORT (no stop) {r}; new items {sample[:3]}{" +%d" % (len(sample) - 3) if len(sample) > 3 else ""}'
                                         f' -- the tripwire\'s plan-conformance defect, read at {trip.get("t")}; acknowledge in ACK.json '
                                         f'(showcase_trip.py ack) or silence the page (pager.py ack showtrip \'report:*\')')
    return out


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


def page_showcase(rows, a, sd, now):
    """The tripwire's pages on the showcase VM (phase 1 item 4): its REPORT gates (source showtrip, tier 1, re-pushed every 2 h
    until acknowledged or gone) and the remedy events (auto-rollback, its start, a quarantine: one push each). Never raises."""
    try:
        try:
            trip = json.load(open(a.trip_json))
        except (OSError, ValueError):
            trip = None
        st_path = os.path.join(sd, 'showtrip.pushstate.json')
        try:
            prev = {k: v.get('line', '') for k, v in json.load(open(st_path)).items()}
        except (OSError, ValueError, AttributeError):
            prev = {}
        stop_open = showcase_lifecycle(rows, now)['stop'] is not None
        rep = showcase_reports(trip, now, stop_open, {k: v for k, v in prev.items() if k.startswith('report:')})
        print('showtrip reports: %s' % (sorted(rep) or 'none'))
        if not a.no_state:
            AL.raise_alarms('showtrip', rep, now, st_path, log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
        cp = os.path.join(sd, 'showtrip-events.cursor.json')
        try:
            cur = json.load(open(cp))
        except (OSError, ValueError):
            cur = None
        evs, new_cur = showcase_events(rows, cur)
        for k, v in evs:
            print('showtrip event %s: %s' % (k, v))
        if not a.no_state:
            if evs:
                AL.one_shot('showtrip', dict(evs), now, log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
            AL.write_json_atomic(cp, new_cur)
    except Exception as e:      # noqa: BLE001 -- the halt alarm above must never be lost to this
        print('showtrip pages FAILED: %s: %s' % (type(e).__name__, str(e)[:160]))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', required=True, choices=['fleet', 'showcase'])
    ap.add_argument('--deploy-log', default='/srv/showcase/ops/deploy.jsonl')
    ap.add_argument('--trip-json', default='/srv/showcase/ops/trip-last.json', help="showcase: the tripwire's newest read")
    ap.add_argument('--incidents', default='/var/lib/mcai-tripper')
    ap.add_argument('--manifest', default='/srv/mcbots/bot-manifest.json', help="the tripper's bot -> unit map")
    ap.add_argument('--state-dir', default='~/digest')
    ap.add_argument('--ship')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--no-state', action='store_true')
    ap.add_argument('--sched-log', default=AH.SCHED_LOG, help="canary-sched.py tick's log (fleet: the slot push)")
    a = ap.parse_args(argv)
    now = dt.datetime.now(UTC).replace(microsecond=0)
    showcase_rows = None
    try:
        if a.label == 'showcase':
            rows = []
            for line in open(a.deploy_log):
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
            line, summ = judge_showcase(rows, units('mcshow@*.service'), now)
            showcase_rows = rows
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
    if a.label == 'showcase' and showcase_rows is not None:
        page_showcase(showcase_rows, a, sd, now)
    if a.label == 'fleet':
        try:
            try:
                prev = next(iter(k for k in json.load(open(os.path.join(sd, 'slotwatch.pushstate.json')))
                                 if k.startswith('slot:nodeploy:')), None)
            except (OSError, ValueError, TypeError, AttributeError):
                prev = None
            key, sline = AH.slot_nodeploy(AH.parse_ticks(AH.read_tail(a.sched_log)), now, prev_key=prev)
        except Exception as e:      # noqa: BLE001
            key, sline = 'slot:scheduler', f'canary slot: the slot check FAILED ({type(e).__name__}: {str(e)[:120]})'
        slot = {key: sline} if key else {}
        print(('!! ' if key else '') + sline)
        AL.raise_alarms('slotwatch', slot, now, os.path.join(sd, 'slotwatch.pushstate.json'),
                        log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
    if a.ship:
        AL.ship_row(a.ship, {'kind': f'{a.label}_halt', 't': AL._iso(now), 'ok': not line,
                             'event': 'halt' if line else 'running', 'why': line or summ})
    return 0


if __name__ == '__main__':
    sys.exit(main())
