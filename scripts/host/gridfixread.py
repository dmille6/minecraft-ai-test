#!/usr/bin/env python3
# gridfixread.py [window_min] -- the read for canary `gridfix-01` (craftsync grid clear, branch gf-on-1918bb5 @ 8c9239d).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE DEFECT (sandbox + builder repro 10-04, live 2 of 82 craftsync canary crafts): an ABORTED 2x2 inventory craft
# (stuck watchdog, interrupt, reflex preempt) after the first click left the 2x2 grid + cursor loaded -- craftsync
# never closed window 0 on the cancel path. The items came back on the next craft (which then failed once) or dropped
# at logout. THE CHANGE: on any unclean exit with window-0 clicks since the last close, craftsync waits (bounded) for
# every issued click to settle, closes window 0, resyncs, and reads slots 1-4 + the cursor off the server's
# window_items; clicks are window-bound (inflight.mjs, shared with withdraw) and invalidated on a stop or a click-cap.
# FINAL VALUE SET of `grid_clear` on EVERY `_craft_sync` row of the canary build (craftsync.mjs gridExitVerdict):
#   yes                                 the server showed grid + cursor empty after the clear
#   no                                  the server still showed grid or cursor loaded            -> THE DEFECT GATE
#   unverified_{unanswered,skipped,inflight,noverdict}, error, skipped_window_open   -> could not be checked (TRIPWIRE)
#   skipped_disconnected                nothing can be sent after a disconnect (Paper drops the cursor/grid itself)
#   na_clean, na_no_clicks              nothing to clear: a verified craft / no window-0 click     -> EXCLUDED
#
#   LIVENESS     canary-build `_craft_sync` rows carrying grid_clear >= 1; canary-build rows WITHOUT it: 0 (every exit
#                has a verdict); control rows with it: 0 (arms).
#   EXPOSURE     canary ABORTED 2x2 exits with clicks (outcome aborted, not a table, clicks > 0 -- the cancel path the
#                old build left loaded) >= 1 AND the control positive control >= 1. Until then the defect gate is
#                read but the verdict waits (extension) -- a gate on nothing is not a pass.
#   DEFECT       canary grid_clear == 'no': 0 (any 'no' on any exit is the server contradicting the clear).
#   TRIPWIRE     canary (unverified_* + error + skipped_window_open) > 10% of the verdict-bearing values (yes, no,
#                unverified_*, error, skipped_window_open) AND >= 2: BLOCKS KEEP. skipped_disconnected is its own
#                bucket (reported); na_* are excluded from both sides.
#   POSITIVE CONTROL  control aborted 2x2 exits with clicks >= 1, and the share of their NEXT craftsync craft on the
#                same bot that failed (the stranded-grid symptom; 111/135 = 82% measured 10-04 over all unclean exits).
#                The canary's same share is reported beside it (the effect, small n).
#   CRAFTSYNC HOLDS  canary crafts the runner called done that gained nothing: 0 (craftsync-01's gate, must not
#                regress); canary resyncs Paper did not answer > 5% blocks KEEP (as craftsync-01).
# REPORTED: grid_clear value counts, residue strings, the release facts (late clicks dropped, in flight at release,
# inflight-wait expiries, window changes, wire drops, pre-invoke refusals, dead waits released, deferred writes,
# preempt timeouts), the click rows this build alone writes (_click_refused, _click_dropped, _click_drop_repair) per
# arm, craft durations, crafts/bot-h DiD, craft success share DiD, _reflex_stuck/bot-h DiD.
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
CLICK_ROWS = ('_click_refused', '_click_dropped', '_click_drop_repair')
NA = ('na_clean', 'na_no_clicks')


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


def bucket(v):
    """grid_clear -> the read's bucket. None (a row without the field) is 'missing'."""
    if v is None:
        return 'missing'
    v = str(v)
    if v in NA:
        return 'na'
    if v == 'yes':
        return 'yes'
    if v == 'no':
        return 'no'
    if v == 'skipped_disconnected':
        return 'disconnected'
    if v.startswith('unverified') or v == 'error' or v == 'skipped_window_open':
        return 'unverified'
    return 'unknown'   # a value outside the final set: counted as unverified below (it could not be read as a verdict)


class _EV: pass
ev = _EV(); ev.rows = sorted(load_window(PRE, END), key=lambda r: r['t'])   # rows sorted by t: "next craft" is ordered
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(ev.rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
withfield = Counter(); syncrows = Counter(); gc = Counter(); gb = Counter(); residue = Counter(); offbuild = 0
aborted = Counter(); unclean = Counter(); outcomes = defaultdict(Counter); nxt_fail = Counter(); nxt_n = Counter(); pending = {}
aborted_gc = Counter()
misc = Counter(); durs = []; nothing = Counter(); judged_n = Counter(); rrows = runans = 0
clicks = defaultdict(Counter); click_eg = {}
crafts = defaultdict(Counter); ok = defaultdict(Counter); stuck = defaultdict(Counter); botsets = defaultdict(lambda: defaultdict(set))
FACTS = ('late_clicks_dropped', 'inflight_at_release', 'window_changes', 'bind_drops', 'pre_invoke_refusals',
         'dead_waits_released', 'deferred_writes', 'preempt_timeouts')
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
    if k in CLICK_ROWS and period == 'post' and not other:
        clicks[arm][k] += 1
        click_eg.setdefault((arm, k), '%s %s: %s' % (r['t'].strftime('%H:%M:%SZ'), b, d[:120]))
    if k != '_craft_sync' or period != 'post':
        continue
    if other:
        offbuild += 1
        continue
    a = skill(r).get('args') or {}
    syncrows[arm] += 1
    if b in pending:                                   # the next craftsync craft after an aborted 2x2 exit
        nxt_n[pending[b]] += 1
        nxt_fail[pending[b]] += skill(r).get('status') == 'failed' or str(a.get('outcome')) != 'ok'
        del pending[b]
    if 'grid_clear' in a:
        withfield[arm] += 1
    two_by_two_clicked = not a.get('table') and int(a.get('clicks') or 0) > 0
    if str(a.get('outcome')) != 'ok' and two_by_two_clicked:
        unclean[arm] += 1
        outcomes[arm][str(a.get('outcome'))] += 1
    if str(a.get('outcome')) == 'aborted' and two_by_two_clicked:
        aborted[arm] += 1
        pending[b] = arm
        if arm == 'canary':
            aborted_gc[str(a.get('grid_clear'))] += 1
    if arm != 'canary':
        continue
    v = a.get('grid_clear')
    gc[str(v)] += 1
    gb[bucket(v)] += 1
    if v not in (None, 'yes') and str(v) not in NA and a.get('grid_residue'):
        residue['%s: %s' % (v, a.get('grid_residue'))] += 1
    for f in FACTS:
        misc[f] += int(a.get(f) or 0)
    misc['inflight_wait_expired'] += int(bool(a.get('inflight_wait_expired')))
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


# the tripwire: unverified_* + error + skipped_window_open (+ any value outside the final set) over the verdict-bearing
# values; skipped_disconnected and na_* on neither side; a row MISSING the field is its own (liveness) line
unver = gb['unverified'] + gb['unknown']
set_n = gb['yes'] + gb['no'] + unver
unver_share = unver / set_n if set_n else float('nan')
exposed = aborted['canary'] >= 1
rshare = runans / rrows if rrows else float('nan')
ok_did = (share(ok, crafts, 'post', 'canary') - share(ok, crafts, 'pre', 'canary')) - (share(ok, crafts, 'post', 'control') - share(ok, crafts, 'pre', 'control'))
pf = lambda arm: (nxt_fail[arm], nxt_n[arm], 100 * nxt_fail[arm] / nxt_n[arm] if nxt_n[arm] else float('nan'))
print('-' * 78)
print('LIVENESS     canary _craft_sync rows with grid_clear %d of %d (>= 1; missing %d, must be 0) | control with it %d of %d (must be 0) | other build %d'
      % (withfield['canary'], syncrows['canary'], gb['missing'], withfield['control'], syncrows['control'], offbuild))
print('EXPOSURE     canary ABORTED 2x2 exits with clicks %d (>= 1 to be exposed; their grid_clear %s) | control %d'
      % (aborted['canary'], dict(aborted_gc) or '-', aborted['control']))
print('             all unclean 2x2 exits with clicks: canary %d %s | control %d %s'
      % (unclean['canary'], dict(outcomes['canary']) or '', unclean['control'], dict(outcomes['control']) or ''))
print('DEFECT       canary grid_clear == no: %d (must be 0; %s)  residue %s'
      % (gb['no'], 'exposed' if exposed else 'NOT exposed yet', dict(residue) or '-'))
print('TRIPWIRE     canary unverified_*/error/skipped_window_open %d of %d verdict-bearing = %.1f%% (> 10%% and >= 2 blocks KEEP)'
      ' | skipped_disconnected %d (own bucket) | na_* %d (excluded)'
      % (unver, set_n, 100 * unver_share if set_n else float('nan'), gb['disconnected'], gb['na']))
print('POS CONTROL  control: next craftsync craft after an aborted 2x2 exit failed %d of %d (%.0f%%) | canary %d of %d (%.0f%%)' % (pf('control') + pf('canary')))
print('CRAFTSYNC    canary "nothing changed" %d of %d (must be 0) | control %d of %d | resyncs unanswered %d of %d rows (> 5%% blocks KEEP)'
      % (nothing['canary'], judged_n['canary'], nothing['control'], judged_n['control'], runans, rrows))
q = lambda f: (sorted(durs)[min(len(durs) - 1, int(f * len(durs)))] / 1000) if durs else float('nan')
print('REPORTED     grid_clear values %s' % dict(gc))
print('             release facts %s' % dict(misc))
print('             click rows (this build only): canary %s | control %s (the baseline cannot write them)'
      % (dict(clicks['canary']) or '{}', dict(clicks['control']) or '{}'))
for (arm, k), eg in sorted(click_eg.items()):
    print('               e.g. %s %s %s' % (arm, k, eg))
print('             craft durations s p50 %.1f p95 %.1f max %.1f (n %d)' % (q(.5), q(.95), (max(durs) / 1000 if durs else float('nan')), len(durs)))
print('             crafts/bot-h DiD %+.2f | craft success share DiD %+.3f | _reflex_stuck/bot-h DiD %+.3f' % (did(crafts), ok_did, did(stuck)))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('gridfixread', W, {
        'sync_rows_canary': syncrows['canary'], 'gridfield_canary': withfield['canary'], 'gridfield_missing_canary': gb['missing'],
        'gridfield_control': withfield['control'], 'offbuild_canary': offbuild,
        'aborted_canary': aborted['canary'], 'aborted_control': aborted['control'],
        'unclean_canary': unclean['canary'], 'unclean_control': unclean['control'],
        'grid_yes': gb['yes'], 'grid_no': gb['no'], 'grid_set': set_n, 'grid_unverified': unver,
        'grid_skipped_disconnected': gb['disconnected'], 'grid_na': gb['na'],
        'grid_unverified_block': int(unver >= 2 and set_n > 0 and unver_share > 0.10),
        'next_fail_control': nxt_fail['control'], 'next_n_control': nxt_n['control'],
        'next_fail_canary': nxt_fail['canary'], 'next_n_canary': nxt_n['canary'],
        'nothing_canary': nothing['canary'], 'nothing_judged': int(judged_n['canary'] >= 10 and nothing['canary'] > 0),
        'resync_unanswered_share': None if not rrows else round(rshare, 4), 'resync_over_5pct': int(rrows >= 20 and rshare > 0.05),
        'late_clicks_dropped': misc['late_clicks_dropped'], 'inflight_wait_expired': misc['inflight_wait_expired'],
        'click_refused_canary': clicks['canary']['_click_refused'], 'click_dropped_canary': clicks['canary']['_click_dropped'],
        'click_repair_canary': clicks['canary']['_click_drop_repair'], 'click_rows_control': sum(clicks['control'].values()),
        'crafts_did_per_bh': round(did(crafts), 3), 'craft_ok_share_did': None if ok_did != ok_did else round(ok_did, 4),
        'stuck_did_per_bh': round(did(stuck), 4),
        'exposure_ready': int(exposed and aborted['control'] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
