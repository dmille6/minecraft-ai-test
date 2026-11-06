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
import re

from lib import alarm as AL

STATE = '~/digest'
FILES = (   # (file, label, stale after)
    ('haltwatch-fleet.json', 'fleet halt', dt.timedelta(minutes=20)),
    ('goalwatch-fleet.json', 'fleet goals', dt.timedelta(minutes=50)),
    ('rollout-fleet.json', 'fleet rollouts', dt.timedelta(minutes=30)),
    ('drift-latest.json', 'daily drift', dt.timedelta(hours=26)),
    # stallcheck.py (hourly, OWNER 10-31): owner-approved items that silently stopped -> '!! STALLED: n items -- top 3 ...'
    ('stallcheck-fleet.json', 'stalled commitments', dt.timedelta(minutes=150)),
    # promomerge.py (Mac tick every 15 min; a tick that runs the suite holds its lock ~20-40 min): every fleet promotion is
    # merged into main, or '!! promotion ... does NOT merge into main' (audit 11-01 flag 4)
    ('promomerge-fleet.json', 'promotion merge', dt.timedelta(minutes=120)),
    # effectwatch.py (hourly, OWNER 11-03 item 1): each promotion's targeted metric at +24 h / +72 h vs its baseline;
    # '!! EFFECT <run> NO-EFFECT|WORSE ... fix or remove' until the ledger has row effect-<run>
    ('effect-fleet.json', 'promotion effects', dt.timedelta(minutes=150)),
    # the same run (OWNER 11-03 item 6): fleet busy time over the last 24 final hours (skills / walking / decision / idle)
    ('busy-fleet.json', 'busy time', dt.timedelta(minutes=150)),
    # hourwatch.py (hourly :25, phase 1 11-06): value/bot-h vs the previous 24 h, the idle-lap share, towns with no workable
    # project; its alarms PUSH (lib/alarm tier 1)
    ('hourwatch-fleet.json', 'hourly checks', dt.timedelta(minutes=90)),
    # projectaudit.py (daily 12:05Z, OWNER 11-06): is every FINISHED project doing its job? One line per town; BROKEN /
    # DORMANT page (tier 1), UNDERUSED is digest
    ('projectaudit-fleet.json', 'project audit', dt.timedelta(hours=26)),
)
# MONITOR LOGS (audit 11-01 flag 9: cron outputs nothing read). Each is wired here, so the fleetstatus header IS its consumer:
# (log under ~, label, stale after, the line to show: regex on the last matching line, alarm when that line matches `bad`
# or fails `ok`). Retired instead (config/monitors.json `retired`): programread, avoidwatch, monitor-bots.
MONITOR_LOGS = (
    ('digest/ironfunnel.log', 'iron funnel', dt.timedelta(hours=26), r'^iron funnel', None, None),
    ('digest/stuckwatch.log', 'pinned bots', dt.timedelta(minutes=90),
     r'^\d{4}-\d\d-\d\dT\S+ (\d+ of \d+ bots|stuckwatch OK)|stuckwatch REFUSED', r' [1-9]\d* of \d+ bots|REFUSED', None),
    ('staffcensus/out/check.log', 'staff census check', dt.timedelta(minutes=90), r'^\d{4}-\d\d-\d\dT\S+ ', None, r'staff census OK'),
    # failmine weekly ends every run with 'failmine weekly OK|NO SCENES <gen>: ...' (11-02); a traceback ends on its exception
    # line, and a run that died without the summary ends on something else: only the OK summary reads plain
    ('failmine/weekly.log', 'failmine weekly', dt.timedelta(days=8), r'\S', r'Error|Traceback|BlindInput', r'^failmine weekly OK '),
    # flowledger-01 (resource-model-1102 s.9): hourly per-town stock + flow, bags counted; its alarms go here, not to a log
    ('digest/flowledger.log', 'flow ledger', dt.timedelta(minutes=150), r'^\d{4}-\d\d-\d\dT\S+ flowledger ',
     r' flowledger (ALARMS|ERROR)', None),
)
ES_KINDS = (   # (kind, label, stale after)
    ('showcase_halt', 'showcase halt', dt.timedelta(minutes=20)),
    ('showcase_goal', 'showcase goals', dt.timedelta(minutes=50)),
    ('showcase_projectaudit', 'showcase project audit', dt.timedelta(hours=26)),
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
    if 'town_lines' in d:      # projectaudit: the summary, then one short line per town ('!! ' on a BROKEN / DORMANT town)
        bad = any(str(k).startswith(('broken:', 'dormant:', 'projectaudit:')) for k in (d.get('alarms') or {}))
        return [('!! ' if bad or d.get('error') else '') + str(d.get('summary') or f'{label}: no summary')] + list(d['town_lines'])
    al = d.get('alarms') or {}
    if al:
        return [f'!! {x}' for x in al.values()]
    return [d.get('summary') or d.get('line') or f'{label}: OK']


def monitor_lines(now, home='~', logs=MONITOR_LOGS, tail_bytes=200_000):
    """One header line per wired monitor log: its newest matching line; '!! ' when stale, missing, `bad` or not `ok`."""
    import re
    out = []
    for rel, label, stale, pick, bad, ok in logs:
        p = os.path.join(os.path.expanduser(home), rel)
        try:
            with open(p, 'rb') as f:
                f.seek(0, 2)
                f.seek(max(0, f.tell() - tail_bytes))
                text = f.read().decode('utf8', 'replace')
            mt = dt.datetime.fromtimestamp(os.path.getmtime(p), dt.timezone.utc)
        except OSError as e:
            out.append(f'!! {label}: NO OUTPUT ({type(e).__name__}) at {p}')
            continue
        hits = [l for l in text.splitlines() if re.search(pick, l)]
        last = hits[-1].strip() if hits else '(no line)'
        if now - mt > stale:
            out.append(f'!! {label}: STALE (last written {AL._iso(mt)}; > {stale.total_seconds() / 3600:.0f} h) at {p}')
        elif not hits or (bad and re.search(bad, last)) or (ok and not re.search(ok, last)):
            out.append(f'!! {label}: {last[:220]} ({p})')
        else:
            out.append(f'{label}: {last[:220]}')
    return out


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


DEPLOYED_MARK = 'S1 canary declared'          # decide() names it whenever the manifest declares a canary (BUSY or BLOCK)
CAUSE_MIN_TICKS = 2                          # a cause must hold two ticks before it re-keys the alarm (no flapping)


def deployed(why):
    """PURE. The tick saw a canary DEPLOYED (the manifest declares one)."""
    return DEPLOYED_MARK in why


def tick_cause(dec, why):
    """PURE. One tick -> a stable cause code for the slotwatch key: '<decision>:<first reason code>[-qualifier]', e.g.
    block:H2-refused, wait:H2-building, busy:S8-hold, busy:S2-loop, wait:H1-after, block:H3, idle:Q, launch."""
    dec = dec.lower()
    if dec in ('launch', 'launching'):
        return 'launch'
    first = why.split(' | ')[0].strip()
    code = first.split(' ', 1)[0] if first else '?'
    if not re.match(r'^[A-Z]\d{1,2}$', code):
        code = '?'
    low = first.lower()
    qual = ''
    for words, q in ((('refused',), 'refused'), (('went silent', 'died'), 'dead'), (('is building', 'will cherry-pick'), 'building'),
                     (('stale',), 'stale'), (('install-hold',), 'hold'), (('sched-pause',), 'pause'), (('held:',), 'held'),
                     (('not before',), 'notbefore'), (('waits for', 'depends on'), 'after'), (('no patch source',), 'nopatch'),
                     (('canary-loop',), 'loop'), (('autorebase',), 'autorebase')):
        if any(w in low for w in words):
            qual = '-' + q
            break
    return f'{dec}:{code}{qual}'


def slot_cause(causes, prev=None, min_ticks=CAUSE_MIN_TICKS, recent=6):
    """PURE. causes: the streak's tick causes, NEWEST FIRST; prev: the cause of the key pushed last (or None).
    STICKY: the previous cause stays while it still shows >= min_ticks times in the `recent` newest ticks (alternating
    causes must not re-key every 5 min: a CLEARED + NEW push per tick, Claude review r1). Otherwise the cause of the newest
    run of >= min_ticks equal ticks; otherwise the previous cause, or 'mixed'."""
    if prev and causes[:recent].count(prev) >= min_ticks:
        return prev
    i = 0
    while i < len(causes):
        j = i
        while j < len(causes) and causes[j] == causes[i]:
            j += 1
        if j - i >= min_ticks:
            return causes[i]
        i = j
    return prev or 'mixed'


def slot_nodeploy(ticks, now, idle=SLOT_IDLE, stale=SCHED_STALE, prev_key=None):
    """PURE. ticks [(t, DECISION, reasons)] oldest first -> (key | None, line).
    The OWNER's rule (11-06): page when NO CANARY HAS BEEN DEPLOYED for `idle` (60 min), whatever the reason -- a live
    install-hold, a building or refused autorebase, a drawing loop and a blocked head all count (slot_idle counted only
    BLOCK/WAIT/IDLE ticks, so 10 h of a live hold on 11-05 never alarmed). The key names the CAUSE (slot_cause, sticky to
    prev_key's), so a new cause pushes again. A scheduler that stopped ticking is key slot:scheduler."""
    if not ticks:
        return 'slot:scheduler', 'canary slot: NO scheduler tick read from sched.log -- is canary-sched.py tick in cron here?'
    t_last, dec, why = ticks[-1]
    if now - t_last > stale:
        return 'slot:scheduler', (f'canary scheduler: last tick {AL._iso(t_last)} ({(now - t_last).total_seconds() / 60:.0f} '
                                  f'min ago) -- cron stopped?')
    if deployed(why):
        return None, f'canary slot: a canary is deployed ({dec.lower()} at {AL._iso(t_last)})'
    start, bounded, streak = t_last, False, []
    for t, d, w in reversed(ticks):
        if deployed(w):
            bounded = True
            break
        start = t
        streak.append((t, d, w))
    mins = (t_last - start).total_seconds() / 60
    if t_last - start < idle:
        return None, f'canary slot: no canary deployed for {mins:.0f} min (under {idle.total_seconds() / 60:.0f}); now {dec} {why[:120]}'
    prev = prev_key[len('slot:nodeploy:'):] if prev_key and prev_key.startswith('slot:nodeploy:') else None
    cause = slot_cause([tick_cause(d, w) for _, d, w in streak], prev)
    head = why.split(' | ')[0][:220]
    return f'slot:nodeploy:{cause}', (f'canary slot: NO canary deployed for {"" if bounded else ">= "}{mins:.0f} min (since '
                                      f'{AL._iso(start)}); cause {cause}: {dec} {head}')


def read_tail(path=SCHED_LOG, tail_bytes=TAIL_BYTES):
    """The last `tail_bytes` of sched.log (raises OSError when unreadable)."""
    with open(os.path.expanduser(path), 'rb') as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - tail_bytes))
        return f.read().decode('utf-8', errors='replace')


def slot_lines(now, path=SCHED_LOG):
    p = os.path.expanduser(path)
    try:
        text = read_tail(p)
    except OSError as e:
        return [f'!! canary slot: sched.log UNREADABLE ({type(e).__name__}) at {p}']
    return [slot_idle(parse_ticks(text), now)]


def lines(now, client=None, state_dir=STATE, conf=AL.CONF, sched_log=SCHED_LOG, home='~'):
    out = []
    try:
        ok, desc = AL.push_channel(conf)
        out.append(('' if ok else '!! ') + f'alarm push: {desc}' +
                   ('' if ok else ' -- alarms reach only this header and ~/digest/ALARMS.log'))
        nq, oldest = AL.outbox_status(os.path.expanduser(state_dir))
        if nq:
            out.append(f'!! alarm push: {nq} push(es) NOT DELIVERED, queued since {oldest} (retried every run; '
                       f'{state_dir}/ALARMS-delivery.log)')
        ng, gat = AL.gaveup_recent(os.path.expanduser(state_dir), now)
        if ng:
            out.append(f'!! alarm push: {ng} push(es) GIVEN UP undelivered after 24 h (last {gat}): the owner never got '
                       f'them -- read {state_dir}/ALARMS-delivery.log')
        out += slot_lines(now, sched_log)
        for name, label, stale in FILES:
            out += file_lines(now, name, label, stale, state_dir)
        out += monitor_lines(now, home)
        if client is not None:
            out += es_lines(now, client)
    except Exception as e:          # noqa: BLE001
        out.append(f'!! W5 alarms: header failed ({type(e).__name__}: {str(e)[:100]})')
    return out
