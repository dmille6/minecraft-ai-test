#!/usr/bin/env python3
# digtownread.py [window_min] -- the read for canary `digtown-01` (branch dt-on-82aef34): the `_dig_town` INSTRUMENT,
# telemetry only. Run under `nice`. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/digtown.mjs, townground.mjs; townground-2026-10-13.md 2.3): bot.dig is wrapped; every dig is
#   counted in a one-minute `_dig_town_sum` row (structured counts in skill.args: all, o_<outcome>, z_<zone>_<class>_
#   <purpose>_<outcome>, overflow, ierr) and every dig of a town-ground cell (a square of half-width 16 around home,
#   above home.y - 12, terrain only) gets its own `_dig_town` row (args: x,y,z, block, cls, purpose, by, outcome, dt_ms).
#   Outcome from the server's raw block_change words: confirmed | foreign | rejected | unconfirmed (10 s silence) |
#   aborted | death | error | pending. Purpose: bot.digScope > the pathfinder (its profile tag, else transit) > a reflex
#   (survival) > the skill (gather/mine target, else other). NOTHING READS THESE ROWS TO DECIDE ANYTHING.
#
# WHY IT NEEDS ITS OWN CANARY: the zone's canary (townzone-01) reads its DiD on these rows, so BOTH arms must carry the
#   instrument, before and after -- the instrument has to be KEPT and promoted fleet-wide first ("done means read on the
#   fleet"). This read proves it is live, complete and inert.
#
#   LICENCE      kind `_dig_town_sum` (the base cannot write it).
#   GATES        I1 breach_overflow: any canary summary with overflow > 0 (digs not tracked: the instrument incomplete).
#                I2 breach_ierr: instrument errors > 1% of canary digs (ierr / all).
#                I3 breach_blind: >= 50 non-aborted settled canary digs and the server's word seen for < 50% of them
#                   (confirmed + foreign + rejected) / (those + unconfirmed): the packet listener is not hearing the server.
#                   Readiness needs the SAME 50 (Codex code r1 P2: ready must not precede the blindness check).
#                   Paper sandbox 10-13: 19/19 non-aborted fixture digs heard (the one refused dig is the only silence).
#                I4 breach_coverage: canary bots online >= 60 min in the window that wrote NO summary while their
#                   _pickups show ground items (the wrapper missing on a live bot).
#                LEAK control `_dig_town*` rows (BLOCKS KEEP; no evidence key).
#   INSTRUMENT   positive control: the canary's `_pickups` ground items (collected by digging) vs its counted digs --
#                both > 0 together; the ratio is reported.
#   PRIMARY      REPORTED: digs per bot-h by outcome; town-ground rows by purpose (deduped cell +-2 s across bots); the
#                ambiguous share (two bots confirmed one cell). NEUTRALITY (reported; harm is immobiledid + deaths):
#                gather successes / mine rows / ground pickups per bot-h, canary vs control, pre vs post (DiD).
import sys, os, re, json
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

DEDUPE = dt.timedelta(seconds=2)
GROUND = {'cobblestone', 'cobbled_deepslate', 'dirt', 'gravel', 'sand', 'red_sand', 'andesite', 'diorite', 'granite', 'tuff',
          'calcite', 'dripstone_block', 'sandstone', 'clay_ball'}


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def args_of(r):
    return (((r.get('raw') or {}).get('skill') or {}).get('args')) or {}


def dedupe_confirmed(rows):
    """PURE. rows: [(t, bot, x, y, z)] confirmed digs. Keyed by the bot's POOL too: two worlds share coordinates
    (ten towns share one seed and one home), so the same cell in two pools is two removals (Codex code r1 P2). -> (unique, ambiguous): one per (cell, +-2 s) cluster across bots,
    and how many extra confirmations were folded (two bots finishing one cell in the same instant both read confirmed:
    attempt attribution, not actor attribution -- Paper fixture S2, 10-13)."""
    by = defaultdict(list)
    for t, b, x, y, z in rows:
        w = b if (b or '').startswith('isolated-') else pool_of(b)
        by[(w, x, y, z)].append(t)
    uniq = amb = 0
    for cell, ts in by.items():
        ts.sort()
        start = None
        for t in ts:
            if start is not None and t - start <= DEDUPE:
                amb += 1
                continue
            start = t; uniq += 1
    return uniq, amb


def heard_share(outcomes):
    """PURE. outcomes: Counter. -> share of non-aborted settled digs the server spoke about (None if none)."""
    heard = outcomes.get('confirmed', 0) + outcomes.get('foreign', 0) + outcomes.get('rejected', 0)
    tot = heard + outcomes.get('unconfirmed', 0)
    return None if not tot else heard / tot


def pickup_ground_items(detail):
    """PURE. A `_pickups` summary 'name n source mode; ... | k items ...' -> ground items in it."""
    n = 0
    for part in (detail or '').split(' | ')[0].split('; '):
        m = re.match(r'^(\S+) (\d+) (\S+) (\S+)$', part.strip())
        if m and m.group(1) in GROUND:
            n += int(m.group(2))
    return n


# ---- positive controls on the bot's own row shapes (digtown.mjs summaryDetail / the row args) ---------------------------
_T = dt.datetime(2026, 10, 13, tzinfo=dt.timezone.utc)
_s = lambda n: _T + dt.timedelta(seconds=n)
assert dedupe_confirmed([(_s(0), 'board-a-Alpha', 1, 2, 3), (_s(1), 'board-a-Bravo', 1, 2, 3)]) == (1, 1), 'two bots, one cell, one second apart: one removal'
assert dedupe_confirmed([(_s(0), 'a', 1, 2, 3), (_s(30), 'a', 1, 2, 3)]) == (2, 0), 'the same cell dug again later (re-placed): two'
assert dedupe_confirmed([(_s(0), 'a', 1, 2, 3), (_s(0), 'a', 1, 2, 4)]) == (2, 0)
assert dedupe_confirmed([]) == (0, 0)
assert dedupe_confirmed([(_s(0), 'board-a-Alpha', 1, 2, 3), (_s(0), 'board-c-Alpha', 1, 2, 3)]) == (2, 0), 'same cell, two worlds'
assert heard_share(Counter(confirmed=9, unconfirmed=1)) == 0.9 and heard_share(Counter(aborted=5)) is None
assert pickup_ground_items('cobblestone 6 mine:y66 passive; dirt 3 gather:dirt sought; oak_log 2 gather:oak_log sought | 11 items in 9 pickups in 60s') == 9

if __name__ == '__main__':
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

    def load_window(since, until):
        """Rotation-aware (wellsiteread's pattern): day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
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
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    bots = defaultdict(set); nrows = Counter(); offbuild = 0
    n = Counter(); outc = Counter(); zone = Counter(); leak = 0; overflow_rows = 0; ierr = 0; alldigs = 0
    span = defaultdict(lambda: [None, None]); summ_bots = set(); pick_bots = Counter()
    conf_rows = []; ground_rows = Counter()
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(period, arm)].add(b); nrows[(period, arm)] += 1
        if period == 'post' and arm == 'canary':
            sp = span[b]; sp[0] = t if sp[0] is None else sp[0]; sp[1] = t
        k = (r.get('name') or '').lstrip('_'); d = r.get('detail') or ''
        if k in ('dig_town', 'dig_town_sum'):
            if arm == 'control' and period == 'post':
                leak += 1
            if arm != 'canary' or period != 'post':
                continue
            a = args_of(r)
            if k == 'dig_town_sum':
                summ_bots.add(b); n['licence'] += 1
                alldigs += int(a.get('all') or 0); ierr += int(a.get('ierr') or 0)
                if int(a.get('overflow') or 0) > 0:
                    overflow_rows += 1
                for kk, v in a.items():
                    if kk.startswith('o_'):
                        outc[kk[2:]] += int(v or 0)
                    elif kk.startswith('z_'):
                        zone[kk[2:]] += int(v or 0)
            else:
                ground_rows[(a.get('purpose'), str(a.get('by') or '').split(':')[0], a.get('outcome'))] += 1
                if a.get('outcome') == 'confirmed':
                    conf_rows.append((t, b, a.get('x'), a.get('y'), a.get('z')))
        elif k == 'pickups':
            g = pickup_ground_items(d)
            n[(period, arm, 'ground_items')] += g
            if period == 'post' and arm == 'canary' and g:
                pick_bots[b] += g
        elif k == 'gather' and (((r.get('raw') or {}).get('skill') or {}).get('status') == 'success'):
            n[(period, arm, 'gather_ok')] += 1
        elif k == 'mine':
            n[(period, arm, 'mine')] += 1
        elif k == 'goto' and (((r.get('raw') or {}).get('skill') or {}).get('status') == 'success'):
            n[(period, arm, 'goto_ok')] += 1   # r2 wraps goto in a scope (Claude code r1 P3): goto success reported

    hours = W / 60.0
    def rate(period, arm, what):
        nb = len(bots[(period, arm)])
        return n[(period, arm, what)] / (nb * hours) if nb and hours else float('nan')
    def did(what):
        return (rate('post', 'canary', what) - rate('pre', 'canary', what)) - (rate('post', 'control', what) - rate('pre', 'control', what))

    hs = heard_share(outc)
    settled = sum(outc.get(kk, 0) for kk in ('confirmed', 'foreign', 'rejected', 'unconfirmed'))   # non-aborted, settled
    blind = int(settled >= 50 and hs is not None and hs < 0.5)
    long_online = {b for b, (a0, a1) in span.items() if a0 and a1 and (a1 - a0) >= dt.timedelta(minutes=60)}
    uncovered = sorted(b for b in long_online if b not in summ_bots and pick_bots[b] > 0)
    ierr_share = (ierr / alldigs) if alldigs else 0.0
    uniq, amb = dedupe_confirmed(conf_rows)
    can_bots = len(bots[('post', 'canary')])
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  offbuild canary rows %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), can_bots,
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), offbuild))
    print('LIVENESS     canary _dig_town_sum rows %d from %d of %d canary bots | digs counted %d (%.1f per bot-h)'
          % (n['licence'], len(summ_bots), can_bots, alldigs, alldigs / (can_bots * hours) if can_bots and hours else float('nan')))
    print('I1 (gate)    summaries with overflow > 0: %d' % overflow_rows)
    print('I2 (gate)    instrument errors %d of %d digs (%.3f%%; gate > 1%%)' % (ierr, alldigs, 100 * ierr_share))
    print('I3 (gate)    server word heard for %s of %d settled non-aborted digs (gate: < 50%% with >= 50) | outcomes %s'
          % ('-' if hs is None else '%.1f%%' % (100 * hs), settled, dict(outc)))
    print('I4 (gate)    canary bots online >= 60 min with ground pickups but NO summary: %d %s' % (len(uncovered), uncovered[:5]))
    print('LEAK         control _dig_town* rows post %d (blocks KEEP)' % leak)
    print('INSTRUMENT   canary ground items picked %d vs digs counted %d (ratio %.2f) | control ground items post %d'
          % (sum(pick_bots.values()), alldigs, (sum(pick_bots.values()) / alldigs) if alldigs else float('nan'), n[('post', 'control', 'ground_items')]))
    print('PRIMARY      town-ground rows by (purpose, skill, outcome): %s' % dict(ground_rows.most_common(12)))
    print('             zone counts from the summaries: %s' % dict(zone.most_common(10)))
    print('             confirmed town-ground digs deduped %d (ambiguous extra confirmations %d)' % (uniq, amb))
    for what, label in (('gather_ok', 'gather successes'), ('mine', 'mine rows'), ('goto_ok', 'goto successes'), ('ground_items', 'ground items picked')):
        print('NEUTRALITY   %-20s per bot-h  canary %.3f -> %.3f  control %.3f -> %.3f  DiD %+.3f'
              % (label, rate('pre', 'canary', what), rate('post', 'canary', what), rate('pre', 'control', what), rate('post', 'control', what), did(what)))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        emit('digtownread', W, {
            'rows_canary': nrows[('post', 'canary')], 'rows_control': nrows[('post', 'control')], 'offbuild_canary': offbuild,
            'licence_rows': n['licence'], 'summary_bots': len(summ_bots), 'digs_counted': alldigs,
            'breach_overflow': overflow_rows, 'breach_ierr': int(ierr_share > 0.01), 'ierr': ierr,
            'breach_blind': blind, 'heard_share': None if hs is None else round(hs, 4), 'breach_coverage': len(uncovered),
            'control_dig_rows': leak, 'confirmed_ground_deduped': uniq, 'confirmed_ground_ambiguous': amb,
            'gather_ok_did': nanless(did('gather_ok')), 'mine_did': nanless(did('mine')), 'goto_ok_did': nanless(did('goto_ok')), 'ground_items_did': nanless(did('ground_items')),
            'exposure_ready': int(n['licence'] >= 1 and len(summ_bots) >= max(1, can_bots - 1) and settled >= 50 and W >= 150),
        })
    except Exception as e:
        print('emit failed:', e)
