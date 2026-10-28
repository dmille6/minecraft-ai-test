"""alarmhead.py -- the W5 alarm lines at the top of fleetstatus (10.0.0.31). NEVER raises: every missing, stale or
unreadable input is itself a '!! ' line (an alarm that cannot be read has not passed).

Sources: this host's state files (written by goalwatch / haltwatch / driftwatch / rollout --label fleet, cron here) and
the showcase's rows in Elasticsearch (mcai-showcase-ops, kinds showcase_goal / showcase_halt / showcase_rollout, shipped
by the same tools on 10.0.0.40 through its filebeat-shipped heartbeat file, because neither host can read the other's
files).
"""
import datetime as dt
import json
import os

from lib import alarm as AL

STATE = '~/digest'
FILES = (   # (file, label, stale after)
    ('haltwatch-fleet.json', 'fleet halt', dt.timedelta(minutes=20)),
    ('goalwatch-fleet.json', 'fleet goals', dt.timedelta(minutes=50)),
    ('rollout-fleet.json', 'fleet rollouts', dt.timedelta(minutes=30)),
    ('drift-latest.json', 'daily drift', dt.timedelta(hours=26)),
)
ES_KINDS = (   # (kind, label, stale after)
    ('showcase_halt', 'showcase halt', dt.timedelta(minutes=20)),
    ('showcase_goal', 'showcase goals', dt.timedelta(minutes=50)),
)
OPS = 'mcai-showcase-ops'


def _age(now, s):
    try:
        return now - AL._ts(s)
    except (TypeError, ValueError):
        return None


def file_lines(now, name, label, stale, state_dir=STATE):
    p = os.path.join(os.path.expanduser(state_dir), name)
    try:
        d = json.load(open(p))
    except (OSError, ValueError) as e:
        return [f'!! {label}: NO STATE ({type(e).__name__}) at {p} -- its cron is not running here']
    age = _age(now, d.get('generated_at'))
    if age is None or age > stale:
        return [f'!! {label}: STALE state ({d.get("generated_at")}; > {stale.total_seconds() / 60:.0f} min) at {p}']
    if name.startswith('rollout'):
        out = [f'!! {x}' for x in d.get('recent') or [] if x.split('60-min: ')[-1].strip() in ('FAIL', 'WATCH', 'ERROR')]
        n = len(d.get('recent') or [])
        out.append(f'{label}: {n} in 24 h, {len(d.get("pending") or [])} awaiting their 60-min check'
                   + ('' if out else ' -- all checked PASS or pending'))
        return out
    al = d.get('alarms') or {}
    if al:
        return [f'!! {x}' for x in al.values()]
    return [d.get('summary') or d.get('line') or f'{label}: OK']


def es_lines(now, client):
    out = []
    for kind, label, stale in ES_KINDS:
        try:
            r = client('POST', f'{OPS}/_search', {'size': 1, 'sort': [{'@timestamp': {'order': 'desc'}}],
                                                  'query': {'term': {'kind': kind}}})
            hits = r['hits']['hits']
            if not hits:
                out.append(f'!! {label}: NO row of kind {kind} in {OPS} -- the 10.0.0.40 cron is not shipping')
                continue
            s = hits[0]['_source']
            age = _age(now, s.get('t'))
            if age is None or age > stale:
                out.append(f'!! {label}: STALE (newest {s.get("t")}) -- the 10.0.0.40 cron stopped or filebeat is behind')
                continue
            if s.get('ok'):
                out.append(f'{label}: {s.get("why")}')
            else:
                out += [f'!! {x}' for x in (s.get('alarms') or [s.get('why')])]
        except Exception as e:      # noqa: BLE001
            out.append(f'!! {label}: UNREADABLE ({type(e).__name__}: {str(e)[:80]})')
    try:
        since = (now - dt.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')
        r = client('POST', f'{OPS}/_search', {'size': 20, 'sort': [{'@timestamp': {'order': 'desc'}}],
                                              'query': {'bool': {'filter': [{'term': {'kind': 'showcase_rollout'}},
                                                                            {'range': {'@timestamp': {'gte': since}}}]}}})
        rows, seen = [], set()
        for h in r['hits']['hits']:          # newest first: a re-check SUPERSEDES an older row for the same rollout
            x = h['_source']
            k = (x.get('release') or '').split('@')[0] or str(x.get('why') or '').split(':', 1)[0]
            if k not in seen:
                seen.add(k)
                rows.append(x)
        bad = [x for x in rows if not x.get('ok')]
        out += [f'!! showcase rollout {x.get("event")}: {x.get("why")}'[:400] for x in bad]
        out.append(f'showcase rollouts: {len(rows)} 60-min check(s) in 24 h, {len(bad)} not PASS')
    except Exception as e:      # noqa: BLE001
        out.append(f'!! showcase rollouts: UNREADABLE ({type(e).__name__}: {str(e)[:80]})')
    return out


def lines(now, client=None, state_dir=STATE, conf=AL.CONF):
    out = []
    try:
        ok, desc = AL.push_channel(conf)
        out.append(('' if ok else '!! ') + f'alarm push: {desc}' +
                   ('' if ok else ' -- alarms reach only this header and ~/digest/ALARMS.log'))
        for name, label, stale in FILES:
            out += file_lines(now, name, label, stale, state_dir)
        if client is not None:
            out += es_lines(now, client)
    except Exception as e:          # noqa: BLE001
        out.append(f'!! W5 alarms: header failed ({type(e).__name__}: {str(e)[:100]})')
    return out
