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
SCHED_LOG = '~/digest/sched.log'    # canary-sched.py tick (cron */5): one '<ISO> <DECISION>: <reasons>' line per tick
SLOT_IDLE = dt.timedelta(minutes=60)
SCHED_STALE = dt.timedelta(minutes=20)
TAIL_BYTES = 6_000_000              # ~2 days of ticks; a streak longer than the tail reads as 'idle >= <tail span>'
# A tick whose decision is one of these means the slot is FREE and the head cannot launch (canary-sched.decide: block |
# wait | idle). BUSY (a canary, deploy, install or chain is present), LAUNCH and LAUNCHING end a streak.
IDLE_DECISIONS = ('BLOCK', 'WAIT', 'IDLE')
DECISIONS = IDLE_DECISIONS + ('BUSY', 'LAUNCH', 'LAUNCHING')   # anything else (QUEUE UNREADABLE, a lock note) is no tick
# decide() returns BLOCK with its busy reasons appended (block + busy): a BLOCK that also says a canary is declared, a loop
# or deploy is running, the loop lock is held, drop-ins are present or a run is live is an OCCUPIED slot, not a free one.
OCCUPIED = ('S1 canary declared', 'S2 running', 'S3 the loop lock', 'S4 canary drop-ins')


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


def parse_ticks(text):
    """PURE. sched.log text -> [(t, DECISION, reasons)] for its tick lines, oldest first ('note:' lines skipped)."""
    out = []
    for line in text.splitlines():
        parts = line.split(' ', 2)
        if len(parts) < 2 or not parts[0][:4].isdigit():
            continue
        dec = parts[1].rstrip(':').upper()
        if dec not in DECISIONS:
            continue
        try:
            t = AL._ts(parts[0])
        except (TypeError, ValueError):
            continue
        if t is not None:
            out.append((t, dec, parts[2] if len(parts) > 2 else ''))
    return out


def is_idle(dec, why):
    """PURE. True when a tick found the slot FREE with nothing it could launch."""
    if dec not in IDLE_DECISIONS:
        return False
    rs = why.split(' | ')
    return not any(r.startswith(OCCUPIED) or (r.startswith('S7 ') and r.endswith(' is live'))
                   or (r.startswith('S8 INSTALL-HOLD') and 'STALE' not in r) for r in rs)   # a live installer (Codex r2)


def slot_idle(ticks, now, idle=SLOT_IDLE, stale=SCHED_STALE):
    """PURE. -> one header line. '!! ' when the scheduler has not ticked for `stale`, or when every tick for >= `idle`
    found the slot FREE with nothing it could launch (the slot sat idle 11.5 h on 10-29 and 7 h on 10-31 unnoticed)."""
    if not ticks:
        return '!! canary slot: NO scheduler tick read from sched.log -- is canary-sched.py tick in cron here?'
    t_last, dec, why = ticks[-1]
    if now - t_last > stale:
        return f'!! canary scheduler: last tick {AL._iso(t_last)} ({(now - t_last).total_seconds() / 60:.0f} min ago) -- cron stopped?'
    if not is_idle(dec, why):
        return f'canary slot: {dec.lower()} (occupied) at {AL._iso(t_last)}'
    start, bounded = t_last, False
    for t, d, w in reversed(ticks):
        if not is_idle(d, w):
            bounded = True
            break
        start = t
    mins = (t_last - start).total_seconds() / 60
    head = why.split(' | ')[0][:220]
    if t_last - start >= idle:
        return (f'!! canary slot IDLE {"" if bounded else ">= "}{mins:.0f} min (since {AL._iso(start)}) with nothing runnable '
                f'in the queue: {dec} {head} -- release, re-variant or reorder the head, or queue the next canary')
    return f'canary slot: free {mins:.0f} min, nothing runnable yet ({dec} {head[:120]})'


def slot_lines(now, path=SCHED_LOG):
    p = os.path.expanduser(path)
    try:
        with open(p, 'rb') as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - TAIL_BYTES))
            text = f.read().decode('utf-8', errors='replace')
    except OSError as e:
        return [f'!! canary slot: sched.log UNREADABLE ({type(e).__name__}) at {p}']
    return [slot_idle(parse_ticks(text), now)]


def lines(now, client=None, state_dir=STATE, conf=AL.CONF, sched_log=SCHED_LOG):
    out = []
    try:
        ok, desc = AL.push_channel(conf)
        out.append(('' if ok else '!! ') + f'alarm push: {desc}' +
                   ('' if ok else ' -- alarms reach only this header and ~/digest/ALARMS.log'))
        out += slot_lines(now, sched_log)
        for name, label, stale in FILES:
            out += file_lines(now, name, label, stale, state_dir)
        if client is not None:
            out += es_lines(now, client)
    except Exception as e:          # noqa: BLE001
        out.append(f'!! W5 alarms: header failed ({type(e).__name__}: {str(e)[:100]})')
    return out
