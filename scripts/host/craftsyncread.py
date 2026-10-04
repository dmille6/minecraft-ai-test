#!/usr/bin/env python3
# craftsyncread.py [window_min] -- the read for canary `craftsync-01`.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: during bot.craft, inventory clicks run in lockstep with the server (wait for quiet after each click, one
# forced resync on opening a container), each craft is verified against server resyncs of window 0 before and after
# (craft_unconfirmed otherwise), and `count` means ITEMS (crafts = ceil(count / yield)); a whole-tree planner crafts each
# intermediate once. SANDBOX (Paper 1.21.8, through the real craft skill, RCON oracle): control lost 13 of 29 table crafts
# while reporting success and over-crafted 7 times (4 sticks -> 16); candidate 65 of 65, 0 lost, exact counts.
#
#   LIVENESS     canary `_craft_sync` rows from the canary build (>= 1); control 0.
#   CORRECTNESS  canary crafts the runner called done that gained nothing ("nothing changed that craft exists to change"):
#                0, judged on >= 10 canary crafts. The control's same rows are the positive control.
#   INSTRUMENT   share of canary window-0 resyncs that Paper did NOT answer (resync_answered < resyncs, over rows that sent
#                one) > 5% BLOCKS KEEP -- the verification depends on Paper answering them. AMENDED 10-04 01:15Z before
#                the first read: the original line counted every row whose verify_source != 'resync', which also counts
#                unconfirmed crafts where the resync was deliberately SKIPPED after an unanswered click (verify_source
#                'local (before unanswered)', reported honestly as unconfirmed) and aborts; it measured the wrong thing.
#                The old share is still printed. A craft CONFIRMED by anything but a resync (must be 0) is a separate line.
# REPORTED: outcomes, click/quiet/resync cap hits, preemptions, crafts and pickaxe crafts per bot-hour (DiD), duplicate
# tool crafts (the bot already held a usable copy -- now they succeed and spend materials; Claude review), usable
# pickaxe holders canary vs control.
# ALSO REPORTED (Claude review 10-03): craftsync waits for the server on every click, so a long batch could outlast the
# fleet's 20 s stuck watchdog and be interrupted -- craft durations p50/p95/max, crafts ending aborted, and
# `_reflex_stuck` rows per bot-hour (DiD).
import sys, os, json, re
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
NOTHING = 'nothing changed that craft exists to change'


def load_window(since, until):
    """Rotation-aware (oretunnelread's pattern): skill logs rotate daily at ~23:59Z (copytruncate), so day D's rows live
    in skill-*.jsonl-<D+1>.gz and the live file starts at ~23:59Z. Reading only the live files silently drops every row
    before the last rotation -- found 10-04 01:08Z when a 6 h window walked 58k rows instead of ~290k."""
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
    key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
    out, seen = [], set()
    for r in ev.rows:
        if key(r) not in seen:
            out.append(r); seen.add(key(r))
    import glob as _glob
    for k in range(0, (until.date() - since.date()).days + 1):
        tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
        for g in _glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
            try:
                e2 = Events.load(paths=g, since=since, until=until, allow_zero=True)
            except TypeError:
                e2 = Events.load(paths=g, since=since, until=until)
            for r in e2.rows:
                if key(r) not in seen:
                    out.append(r); seen.add(key(r))
    return out


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def skill(r):
    return (r.get('raw') or {}).get('skill') or {}


class _EV: pass
ev = _EV(); ev.rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(ev.rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
sync = defaultdict(Counter); outcomes = Counter(); src = Counter(); caps = Counter(); offbuild = 0
crafts = defaultdict(Counter); picks = defaultdict(Counter); nothing = Counter(); judged_n = Counter(); dup = 0
botsets = defaultdict(lambda: defaultdict(set)); last = {}
durs = []; aborted = 0; stuck = defaultdict(Counter)
for r in ev.rows:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    botsets[period][arm].add(b)
    k = r.get('name'); d = r.get('detail') or ''
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    if period == 'post' and not other and ((r.get('raw') or {}).get('bot') or {}).get('tools') is not None:
        last[b] = r
    if k == '_craft_sync' and period == 'post':
        if other:
            offbuild += 1
            continue
        a = skill(r).get('args') or {}
        sync[arm]['rows'] += 1
        if arm == 'canary':
            outcomes[str(a.get('outcome'))] += 1
            src[str(a.get('verify_source'))] += 1
            sent = int(a.get('resyncs') or 0); got = int(a.get('resync_answered') or 0)
            if sent > 0:
                caps['resync_rows'] += 1
                caps['resync_unanswered_rows'] += int(got < sent)
            if str(a.get('confirmed')) == 'yes' and a.get('verify_source') != 'resync':
                caps['confirmed_locally'] += 1
            for c in ('click_caps', 'quiet_caps', 'resync_caps'):
                caps[c] += int(a.get(c) or 0)
            caps['preempted'] += int(bool(a.get('preempted')))
            dm = skill(r).get('duration_ms') or skill(r).get('durationMs')   # rows carry skill.duration_ms
            if isinstance(dm, (int, float)):
                durs.append(dm)
            aborted += int(a.get('outcome') == 'aborted')
    if k == '_reflex_stuck' and not other:
        stuck[period][arm] += 1
    if k == 'craft' and not other:
        item = str((skill(r).get('args') or {}).get('item') or '')
        st = skill(r).get('status')
        crafts[period][arm] += 1
        if item.endswith('_pickaxe') and st == 'success':
            picks[period][arm] += 1
        if period == 'post':
            judged_n[arm] += 1
            if NOTHING in d:
                nothing[arm] += 1
            if arm == 'canary' and st == 'success' and re.search(r'_(pickaxe|axe|shovel|sword|hoe)$', item):
                tools = ((r.get('raw') or {}).get('bot') or {}).get('tools') or {}
                if sum(1 for e in tools.get(item, []) if e.get('max', 0) - e.get('used', 0) > 10) >= 2:
                    dup += 1


def per_bh(c, period, arm):
    n = len(botsets[period][arm])
    return c[period][arm] / (n * W / 60) if n else float('nan')


def did(c):
    return (per_bh(c, 'post', 'canary') - per_bh(c, 'pre', 'canary')) - (per_bh(c, 'post', 'control') - per_bh(c, 'pre', 'control'))


def usable(arm):
    n = g = 0
    for b, r in last.items():
        if (pool_of(b) in CANS) != (arm == 'canary'):
            continue
        tools = ((r.get('raw') or {}).get('bot') or {}).get('tools') or {}
        n += 1
        g += any(e.get('max', 0) - e.get('used', 0) > 10 for k, v in tools.items() if k.endswith('_pickaxe') for e in v)
    return g, n


rows = sum(src.values())
nonresync = rows - src['resync']
old_share = nonresync / rows if rows else float('nan')
rrows = caps['resync_rows']; unans = caps['resync_unanswered_rows']
share = unans / rrows if rrows else float('nan')
judged = judged_n['canary'] >= 10
gc, nc = usable('canary'); gk, nk = usable('control')
print('-' * 78)
print('LIVENESS     canary _craft_sync rows %d (>= 1) | control %d (must be 0) | other build %d' % (sync['canary']['rows'], sync['control']['rows'], offbuild))
print('CORRECTNESS  canary crafts with "nothing changed": %d of %d (0; %s)' % (nothing['canary'], judged_n['canary'], 'judged' if judged else 'NOT judged: < 10'))
print('INSTRUMENT   control crafts with "nothing changed": %d of %d (positive control, >= 1)' % (nothing['control'], judged_n['control']))
print('TRIPWIRE     resyncs Paper did not answer: %d of %d rows that sent one = %.1f%% (> 5%% blocks KEEP) | crafts confirmed without a resync %d (must be 0)'
      % (unans, rrows, 100 * share if rrows else float('nan'), caps['confirmed_locally']))
print('             (pre-amendment measure, reported only: rows not verified by a resync %d of %d = %.1f%%)' % (nonresync, rows, 100 * old_share if rows else float('nan')))
print('REPORTED     outcomes %s | caps %s | crafts/bot-h DiD %+.2f | pickaxe crafts/bot-h DiD %+.3f | duplicate tool crafts %d'
      % (dict(outcomes), dict(caps), did(crafts), did(picks), dup))
print('             usable pickaxe holders: canary %d/%d control %d/%d' % (gc, nc, gk, nk))
q = lambda f: (sorted(durs)[min(len(durs) - 1, int(f * len(durs)))] / 1000) if durs else float('nan')
print('             craft durations s: p50 %.1f p95 %.1f max %.1f (n %d) | aborted %d | _reflex_stuck/bot-h DiD %+.3f (watchdog 20 s)'
      % (q(.5), q(.95), (max(durs) / 1000 if durs else float('nan')), len(durs), aborted, did(stuck)))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('craftsyncread', W, {
        'sync_rows_canary': sync['canary']['rows'], 'sync_rows_control': sync['control']['rows'], 'offbuild_canary': offbuild,
        'crafts_canary': judged_n['canary'], 'nothing_canary': nothing['canary'],
        'nothing_judged': int(judged and nothing['canary'] > 0), 'nothing_control': nothing['control'],
        'nonresync_share': None if not rrows else round(share, 4), 'nonresync_over_5pct': int(rrows >= 20 and share > 0.05),
        'confirmed_locally': caps['confirmed_locally'], 'old_nonresync_share': None if not rows else round(old_share, 4),
        'click_caps': caps['click_caps'], 'preempted': caps['preempted'], 'duplicate_tool_crafts': dup,
        'crafts_did_per_bh': round(did(crafts), 3), 'pickaxe_crafts_did_per_bh': round(did(picks), 4),
        'usable_pick_canary': gc, 'bots_canary': nc, 'usable_pick_control': gk, 'bots_control': nk,
        'craft_p95_s': None if not durs else round(q(.95), 2), 'craft_max_s': None if not durs else round(max(durs) / 1000, 2),
        'crafts_aborted': aborted, 'stuck_did_per_bh': round(did(stuck), 4),
        'exposure_ready': int(judged and nothing['control'] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
