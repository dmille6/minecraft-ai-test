#!/usr/bin/env python3
# digsyncread.py [window_min] -- the read for canary `digsync-01` (branch dig-rollback).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (proven 2026-09-29 on the sandbox, RCON-verified): mineflayer writes AIR into the bot's world model when
# its dig timer fires and never rolls back a dig the server refused, so every refused dig left a PERMANENT ghost block.
# Two causes measured: no `player_loaded` packet (Paper drops digs for ~3 s after every join and respawn) and out-of-
# reach digs. The fix sends player_loaded on every spawn and settles every dig on the server's ack like the vanilla
# client (restore the prior block when the server said nothing), with a 5 s backstop.
#
# WHAT THIS READ GATES (a fix: correctness -- owner "short canary for fixes"):
#   LIVENESS     every canary bot writes `_dig_sync` heartbeats (10-min cadence) from the CANARY build; control 0.
#   WIRING       canary player_loaded sent >= spawns (the handshake ran on every join and respawn).
#   CORRECTNESS  predictFailed == 0 on the canary (the bookkeeping never failed in front of a real dig).
#   INSTRUMENT   control `_reflex_stuck` rows >= 1 (the outcome query sees a presence).
# REPORTED, NOT GATED (DiD, window vs same-length pre-window, per bot-hour): _reflex_stuck, _entombed_unrecoverable,
# _support_cache_outvoted; and on the canary: rollbacks per 1,000 digs, backstop share, falseRestore share, repeatMax.
# TRIPWIRES printed: repeatMax >= 10 (a re-dig loop), falseRestore > half of rollbacks, re-deaths within 30 s.
# `dig_unconfirmed` failures WILL rise on the canary: collectManually can now see a refused dig. Measurement change,
# excluded from any failure-class comparison.
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import Events

man = json.load(open('/srv/mcbots/trial-manifest.json'))
ovr = os.environ.get('CANARY_DRYRUN')
if ovr:
    CAN, CV, ISO = ovr.split(':', 2)
    CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else:
    CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
    CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(dt.timezone.utc)
elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
END = CUT + dt.timedelta(minutes=W)
PRE = CUT - dt.timedelta(minutes=W)
KV = re.compile(r'\b(predicted|confirmed|rolledBack|backstop|falseRestore|repeatMax|predictFailed|spawns|loadedSent)=(\d+)')
FIELDS = ['predicted', 'confirmed', 'rolledBack', 'backstop', 'falseRestore', 'predictFailed', 'spawns', 'loadedSent']


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def load(since_minutes):
    """Rotation-aware and deduped, as deathfixread: day D's rows live in -{D+1}.gz."""
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
    rows, seen = [], set()
    for r in ev.rows:
        if key(r) not in seen:
            rows.append(r); seen.add(key(r))
    start = now - dt.timedelta(minutes=since_minutes)
    for d in {(start + dt.timedelta(days=k)).date() for k in range(0, (now - start).days + 2)}:
        for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % (d + dt.timedelta(days=1)).strftime('%Y%m%d')):
            try:
                e2 = Events.load(paths=g, since_minutes=since_minutes, allow_zero=True)
            except TypeError:
                e2 = Events.load(paths=g, since_minutes=since_minutes)
            for r in e2.rows:
                if key(r) not in seen:
                    rows.append(r); seen.add(key(r))
    return rows


def session_totals(rows_of_bot):
    """Counters are per PROCESS and restart at 0 on a bot restart: sum each process's last value."""
    tot, last, rmax = Counter(), None, 0
    for r in rows_of_bot:
        kv = {k: int(v) for k, v in KV.findall(r.get('detail') or '')}
        if not kv:
            continue
        rmax = max(rmax, kv.get('repeatMax', 0))
        if last and any(kv.get(f, 0) < last.get(f, 0) for f in FIELDS):   # a new process
            for f in FIELDS:
                tot[f] += last.get(f, 0)
        last = kv
    if last:
        for f in FIELDS:
            tot[f] += last.get(f, 0)
    return tot, rmax


# POSITIVE CONTROL for the parser and the restart logic, before any fleet row.
_rows = [{'detail': 'predicted=10 confirmed=9 rolledBack=1 backstop=0 falseRestore=0 repeatMax=1 predictFailed=0 spawns=1 loadedSent=1'},
         {'detail': 'restored 1 block(s) ... | predicted=20 confirmed=18 rolledBack=2 backstop=1 falseRestore=0 repeatMax=2 predictFailed=0 spawns=2 loadedSent=2'},
         {'detail': 'predicted=3 confirmed=3 rolledBack=0 backstop=0 falseRestore=0 repeatMax=0 predictFailed=0 spawns=1 loadedSent=1'}]
_t, _m = session_totals(_rows)
assert _t['predicted'] == 23 and _t['rolledBack'] == 2 and _t['spawns'] == 3 and _m == 2, (_t, _m)

rows = load(int(elapsed + W + 60))
rows.sort(key=lambda r: r['t'])
bots_seen = {(r.get('bot') or {}).get('name') for r in rows if r.get('bot')}
print('rows walked %d  bots %d  |  canary %s  sha %s  cutoff %s  window +%d min'
      % (len(rows), len(bots_seen), CAN, CV, CUT.strftime('%H:%MZ'), W))

sync_rows = defaultdict(list)
sync_bots, offbuild, sync_control = set(), 0, 0
kinds = defaultdict(Counter)                      # [period][(arm, kind)]
botsets = defaultdict(lambda: defaultdict(set))   # [period][arm] -> bots
deaths = defaultdict(list)
OUT = ['_reflex_stuck', '_entombed_unrecoverable', '_support_cache_outvoted']
for r in rows:
    t = r.get('t'); name = (r.get('bot') or {}).get('name')
    if t is None or not name or not (PRE <= t < END):
        continue
    arm = 'canary' if pool_of(name) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    botsets[period][arm].add(name)
    k = r.get('name')
    if k in OUT:
        kinds[period][(arm, k)] += 1
    if k == '_death' and period == 'post':
        deaths[name].append(t)
    if k in ('_dig_sync', '_dig_rollback') and period == 'post':
        if arm == 'control':
            sync_control += 1
            continue
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if CV and not ver.startswith(CV):
            offbuild += 1
            continue
        sync_rows[name].append(r)
        if k == '_dig_sync':
            sync_bots.add(name)

tot, rmax = Counter(), 0
for b, rs in sync_rows.items():
    tb, mb = session_totals(rs)
    tot.update(tb); rmax = max(rmax, mb)
canary_units = sorted(b for b in botsets['post']['canary'])
redeaths = Counter('canary' if pool_of(b) in CANS else 'control' for b, ts in deaths.items() for a, c in zip(ts, ts[1:]) if (c - a).total_seconds() <= 30)


def per_bh(period, arm, kind):
    n = len(botsets[period][arm])
    return kinds[period][(arm, kind)] / (n * W / 60) if n else float('nan')


print('-' * 78)
print('canary bots seen %d; with a canary-build _dig_sync heartbeat %d (LIVENESS: all)' % (len(canary_units), len(sync_bots)))
print('control _dig_sync/_dig_rollback rows %d (must be 0)   canary rows from another build %d' % (sync_control, offbuild))
print('canary totals: %s  repeatMax %d' % (dict(tot), rmax))
per_k = 1000 * tot['rolledBack'] / tot['predicted'] if tot['predicted'] else float('nan')
print('rollbacks per 1,000 digs %.2f   backstop share %.2f   falseRestore share %.2f'
      % (per_k, tot['backstop'] / tot['rolledBack'] if tot['rolledBack'] else 0, tot['falseRestore'] / tot['rolledBack'] if tot['rolledBack'] else 0))
did = {}
for k in OUT:
    v = {(p, a): per_bh(p, a, k) for p in ('pre', 'post') for a in ('canary', 'control')}
    did[k] = (v[('post', 'canary')] - v[('pre', 'canary')]) - (v[('post', 'control')] - v[('pre', 'control')])
    print('%-26s /bot-h canary %.3f -> %.3f | control %.3f -> %.3f | DiD %+.3f'
          % (k, v[('pre', 'canary')], v[('post', 'canary')], v[('pre', 'control')], v[('post', 'control')], did[k]))
print('re-deaths within 30 s: canary %d control %d' % (redeaths['canary'], redeaths['control']))
print('-' * 78)
print('LIVENESS     heartbeat bots %d of %d canary bots seen' % (len(sync_bots), len(canary_units)))
print('WIRING       player_loaded sent %d for %d spawns' % (tot['loadedSent'], tot['spawns']))
print('CORRECTNESS  predictFailed %d (must be 0)' % tot['predictFailed'])
print('INSTRUMENT   control _reflex_stuck rows %d (must be >= 1)' % kinds['post'][('control', '_reflex_stuck')])
print('TRIPWIRES    repeatMax %d (>= 10 = a re-dig loop); falseRestore %d of %d rollbacks' % (rmax, tot['falseRestore'], tot['rolledBack']))

try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('digsyncread', W, {
        'heartbeat_bots_canary': len(sync_bots), 'canary_bots_seen': len(canary_units),
        'heartbeat_missing_canary': max(0, len(canary_units) - len(sync_bots)),
        'sync_rows_control': sync_control, 'offbuild_canary': offbuild,
        'loaded_short_canary': max(0, tot['spawns'] - tot['loadedSent']),
        'predict_failed_canary': tot['predictFailed'],
        'rolled_back_canary': tot['rolledBack'], 'predicted_canary': tot['predicted'],
        'rollbacks_per_1000_digs': None if tot['predicted'] == 0 else round(per_k, 3),
        'false_restore_canary': tot['falseRestore'], 'repeat_max_canary': rmax,
        'reflex_stuck_control': kinds['post'][('control', '_reflex_stuck')],
        'stuck_did_per_bh': round(did['_reflex_stuck'], 4),
        'unrecoverable_did_per_bh': round(did['_entombed_unrecoverable'], 4),
        'outvoted_did_per_bh': round(did['_support_cache_outvoted'], 4),
        'redeaths_canary': redeaths['canary'], 'redeaths_control': redeaths['control'],
        'exposure_ready': int(len(sync_bots) >= 1 and tot['predicted'] >= 100 and kinds['post'][('control', '_reflex_stuck')] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
