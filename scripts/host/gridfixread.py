#!/usr/bin/env python3
# gridfixread.py [window_min] -- the read for canary `gridfix-01` (craftsync grid clear, branch gf-on-1918bb5).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE DEFECT (sandbox + builder repro 10-04, live 2 of 82 craftsync canary crafts): an ABORTED 2x2 inventory craft
# (stuck watchdog, interrupt, reflex preempt) after the first click left the 2x2 grid + cursor loaded -- craftsync
# never closed window 0 on the cancel path. The items came back on the next craft (which then failed once) or dropped
# at logout. THE CHANGE: on any unclean exit with window-0 clicks since the last close, craftsync closes window 0,
# fences a click mineflayer still holds (<= fenceMs), resyncs and reads slots 1-4 + the cursor off the server's
# window_items: `grid_clear` on the `_craft_sync` row = yes | no | unverified_<why> | error | skipped_disconnected |
# skipped_window_open | null (clean exit, or no window-0 click to clear).
#
#   LIVENESS     canary `_craft_sync` rows carrying the grid_clear field (the canary build) >= 1; control rows with it: 0.
#   EXPOSURE     canary unclean 2x2 exits with clicks (outcome != ok, not a table craft, clicks > 0). Below 1 the
#                CORRECTNESS gate is NOT judged (INCONCLUSIVE, extend) -- a gate on nothing is not a pass.
#   CORRECTNESS  canary grid_clear == 'no' (the server still shows grid or cursor loaded after the clear): 0.
#   TRIPWIRE     canary grid_clear unverified_* or error > 10% of the set values (and >= 2) blocks KEEP: the clear could
#                not be checked. skipped_* are reported (no send possible / a container open).
#   POSITIVE CONTROL  control unclean 2x2 exits with clicks >= 1, and their NEXT craftsync craft on the same bot: share
#                that failed (the stranded-grid symptom). The canary's same share is reported beside it (effect, small n).
#   CRAFTSYNC HOLDS  canary crafts the runner called done that gained nothing: 0 (craftsync-01's gate, must not regress);
#                canary resyncs Paper did not answer > 5% blocks KEEP (as craftsync-01).
# REPORTED: grid_clear value counts, residue strings, fence timeouts, late clicks dropped, preempt timeouts, craft
# durations, crafts/bot-h DiD, craft success share DiD, _reflex_stuck/bot-h DiD.
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
withfield = Counter(); syncrows = Counter(); gc = Counter(); residue = Counter(); offbuild = 0
unclean = Counter(); nxt_fail = Counter(); nxt_n = Counter(); pending = {}
misc = Counter(); durs = []; nothing = Counter(); judged_n = Counter(); rrows = runans = 0
crafts = defaultdict(Counter); ok = defaultdict(Counter); stuck = defaultdict(Counter); botsets = defaultdict(lambda: defaultdict(set))
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
    if k == '_reflex_stuck' and not other:
        stuck[period][arm] += 1
    if k == 'craft' and not other:
        crafts[period][arm] += 1
        ok[period][arm] += skill(r).get('status') == 'success'
        if period == 'post':
            judged_n[arm] += 1
            nothing[arm] += NOTHING in d
    if k != '_craft_sync' or period != 'post':
        continue
    if other:
        offbuild += 1
        continue
    a = skill(r).get('args') or {}
    syncrows[arm] += 1
    if b in pending:                                   # the next craftsync craft after an unclean 2x2 exit
        nxt_n[pending[b]] += 1
        nxt_fail[pending[b]] += skill(r).get('status') == 'failed' or str(a.get('outcome')) != 'ok'
        del pending[b]
    if 'grid_clear' in a:
        withfield[arm] += 1
    is_unclean = str(a.get('outcome')) != 'ok' and not a.get('table') and int(a.get('clicks') or 0) > 0
    if is_unclean:
        unclean[arm] += 1
        pending[b] = arm
    if arm != 'canary':
        continue
    v = a.get('grid_clear')
    if v is not None:
        gc[str(v)] += 1
        if v == 'no' and a.get('grid_residue'):
            residue[str(a.get('grid_residue'))] += 1
    for f in ('fence_timeouts', 'late_clicks_dropped', 'preempt_timeouts'):
        misc[f] += int(a.get(f) or 0)
    sent = int(a.get('resyncs') or 0); got = int(a.get('resync_answered') or 0)
    if sent > 0:
        rrows += 1; runans += int(got < sent)
    dm = skill(r).get('duration_ms') or skill(r).get('durationMs')
    if isinstance(dm, (int, float)):
        durs.append(dm)


def per_bh(c, period, arm):
    n = len(botsets[period][arm])
    return c[period][arm] / (n * W / 60) if n else float('nan')


def did(c):
    return (per_bh(c, 'post', 'canary') - per_bh(c, 'pre', 'canary')) - (per_bh(c, 'post', 'control') - per_bh(c, 'pre', 'control'))


def share(c, n, period, arm):
    return c[period][arm] / n[period][arm] if n[period][arm] else float('nan')


set_n = sum(gc.values())
unver = sum(v for k2, v in gc.items() if k2.startswith('unverified') or k2 == 'error')
unver_share = unver / set_n if set_n else float('nan')
exposed = unclean['canary'] >= 1
rshare = runans / rrows if rrows else float('nan')
ok_did = (share(ok, crafts, 'post', 'canary') - share(ok, crafts, 'pre', 'canary')) - (share(ok, crafts, 'post', 'control') - share(ok, crafts, 'pre', 'control'))
pf = lambda arm: (nxt_fail[arm], nxt_n[arm], 100 * nxt_fail[arm] / nxt_n[arm] if nxt_n[arm] else float('nan'))
print('-' * 78)
print('LIVENESS     canary _craft_sync rows with grid_clear %d of %d (>= 1) | control with it %d of %d (must be 0) | other build %d'
      % (withfield['canary'], syncrows['canary'], withfield['control'], syncrows['control'], offbuild))
print('EXPOSURE     canary unclean 2x2 exits with clicks %d (>= 1 to judge) | control %d' % (unclean['canary'], unclean['control']))
print('CORRECTNESS  canary grid_clear == no: %d (must be 0; %s)  residue %s' % (gc['no'], 'judged' if exposed else 'NOT judged: no exposure', dict(residue) or '-'))
print('TRIPWIRE     canary grid_clear unverified/error %d of %d set = %.1f%% (> 10%% and >= 2 blocks KEEP)' % (unver, set_n, 100 * unver_share if set_n else float('nan')))
print('POS CONTROL  control: next craftsync craft after an unclean 2x2 exit failed %d of %d (%.0f%%) | canary %d of %d (%.0f%%)' % (pf('control') + pf('canary')))
print('CRAFTSYNC    canary "nothing changed" %d of %d (must be 0) | control %d of %d | resyncs unanswered %d of %d rows (> 5%% blocks KEEP)'
      % (nothing['canary'], judged_n['canary'], nothing['control'], judged_n['control'], runans, rrows))
q = lambda f: (sorted(durs)[min(len(durs) - 1, int(f * len(durs)))] / 1000) if durs else float('nan')
print('REPORTED     grid_clear values %s | %s | craft durations s p50 %.1f p95 %.1f max %.1f (n %d)'
      % (dict(gc), dict(misc), q(.5), q(.95), (max(durs) / 1000 if durs else float('nan')), len(durs)))
print('             crafts/bot-h DiD %+.2f | craft success share DiD %+.3f | _reflex_stuck/bot-h DiD %+.3f' % (did(crafts), ok_did, did(stuck)))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('gridfixread', W, {
        'sync_rows_canary': syncrows['canary'], 'gridfield_canary': withfield['canary'], 'gridfield_control': withfield['control'],
        'offbuild_canary': offbuild, 'unclean_canary': unclean['canary'], 'unclean_control': unclean['control'],
        'grid_no': gc['no'], 'grid_no_judged': int(exposed and gc['no'] > 0), 'grid_set': set_n, 'grid_unverified': unver,
        'grid_unverified_block': int(unver >= 2 and set_n and unver_share > 0.10),
        'next_fail_control': nxt_fail['control'], 'next_n_control': nxt_n['control'],
        'next_fail_canary': nxt_fail['canary'], 'next_n_canary': nxt_n['canary'],
        'nothing_canary': nothing['canary'], 'nothing_judged': int(judged_n['canary'] >= 10 and nothing['canary'] > 0),
        'resync_unanswered_share': None if not rrows else round(rshare, 4), 'resync_over_5pct': int(rrows >= 20 and rshare > 0.05),
        'fence_timeouts': misc['fence_timeouts'], 'late_clicks_dropped': misc['late_clicks_dropped'],
        'crafts_did_per_bh': round(did(crafts), 3), 'craft_ok_share_did': None if ok_did != ok_did else round(ok_did, 4),
        'stuck_did_per_bh': round(did(stuck), 4),
        'exposure_ready': int(exposed and unclean['control'] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
