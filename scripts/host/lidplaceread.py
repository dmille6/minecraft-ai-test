#!/usr/bin/env python3
# lidplaceread.py [window_min] -- the read for canary `lidplace-01` (the pathfinder's scaffold avoids chest lids and town-plan
# cells: a surcharge of 20 per guarded landing, added after legality, never a veto). CANARY_DRYRUN=pool[,pool]:sha:iso for
# dry runs (never emits). Judges the CANARY ARM; difference-in-differences against control for the effect; DENOMINATORS FIRST.
#
# WHY (diagnosed 10-26): moves.exclusionAreasPlace held only the protected-zone price, so a pillar/bridge block landed on a
# town chest's lid (showcase 10-25: found-01's store chest; tripwire G3 stopped every bot 18 h). Fleet `_lid_clear
# outcome=dug` 37 in 7 d across 16 pools: lids the bots themselves covered with dirt/cobble.
#
# MEMORY: STREAMED (lidclearread's pattern): only the kinds below are held.
#
# THE CHANGE (rows only this build writes):
#   _lidplace_mode  once per spawn: the licence (on= cost= row_window_ms=)
#   _lidplace       a route the planner CHOSE still places on a lid / in a plan cell (the surcharge was outbid): moves= n=
#                   lid= plan= surcharge= cells=x,y,z:why|... status= profile= goal= off=  -- one row per distinct cell set
#                   per 30 s. DIRECT evidence the price bit and lost; it never says a block was placed (the executor may
#                   still be refused by the server).
#   _dig_approach   ... lid_fallback=1 ... (a capped dig-approach search admitted only at the base's costs)
#
#   PRIMARY (reported, the effect) lid_scaffold_dug: `_lid_clear outcome=dug` with lid= dirt|grass_block|cobblestone|
#              cobbled_deepslate (what a scaffold leaves) per bot-h, canary vs control, DiD with the pre period: should FALL.
#              RARE (~5/day fleet-wide): a 3 h window on 4 pools sees ~0-2. Read it at the deadline, never as a verdict
#              alone; `lid_blocked` count_town rows (lidclearread's population) are the denominator-rich companion.
#   ARMS       lidplace_rows_control: control _lidplace / _lidplace_mode rows (must be 0) -- REVERTS (defect: the arms mixed)
#   LIVENESS   licence_canary >= 1 (the build is live). lidplace_rows_canary is REPORTED, not gated: 0 is the hoped-for
#              value (every chosen route went round), and a route that must cover a lid still covers it (price, not veto).
#   REPORTED   gather success per bot-h DiD (the composition: a tower one cell aside -- Paper 10-26 -- must not cost logs);
#              _pickup_skipped err=path_budget per bot-h DiD (the drop falling beside the tower); lid_fallback rows;
#              _lidplace cells by why= (lid | plan), by profile=.
#   INSTRUMENT control `_lid_clear` rows >= 1 OR control count_town lid_blocked >= 1 (the population is visible in control)
#   EXPOSURE   FROZEN BEFORE THE DEPLOY: >= 1 canary `_lid_clear outcome=dug` scaffold row OR >= 3 count_town lid_blocked rows
#              in the FIXED 72 h before declared_at (a drawn canary town has lids its bots cover).
import sys, os, json, re, glob, gzip
import datetime as dt
from collections import Counter, defaultdict

KEEP = ('_lid_clear', '_lidplace', '_lidplace_mode', '_dig_approach', 'gather', '_pickup_skipped', 'count_town')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
SCAFFOLD = re.compile(r'^(dirt|grass_block|cobblestone|cobbled_deepslate)$')
EXPOSURE_PRE_H = 72


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def mine(r):
    return r['name'] in ('_lidplace', '_lidplace_mode') or (r['name'] == '_dig_approach' and 'lid_fallback=1' in (r['detail'] or ''))


def scaffold_dug(r):
    if r['name'] != '_lid_clear':
        return False
    f = kv(r['detail'])
    return f.get('outcome') == 'dug' and bool(SCAFFOLD.match(f.get('lid') or ''))


def lid_blocked_count(r):
    return r['name'] == 'count_town' and 'lid_blocked' in (kv(r['detail']).get('fails') or '')


def stream(since, until, cut, cans, logroot='/var/log/mcai'):
    files = sorted(glob.glob(logroot + '/*/skill-*.jsonl'))
    for k in range(0, (until.date() - since.date()).days + 2):
        tag = (since.date() + dt.timedelta(days=k)).strftime('%Y%m%d')
        files += sorted(glob.glob(logroot + '/*/skill-*.jsonl-%s.gz' % tag))
    seen, kept, walked, bad = set(), [], 0, 0
    bots = defaultdict(set)
    s_iso, u_iso = since.strftime('%Y-%m-%dT%H:%M:%S'), until.strftime('%Y-%m-%dT%H:%M:%S')
    for f in files:
        try:
            fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
        except OSError:
            continue
        with fh:
            for line in fh:
                ts = line[15:34] if line.startswith('{"@timestamp":"') else None
                if ts is None or ts < s_iso or ts >= u_iso:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    bad += 1
                    continue
                sk = d.get('skill') or {}
                n = sk.get('name')
                b = (d.get('bot') or {}).get('name')
                key = (d.get('@timestamp'), b, n, sk.get('detail'))
                if key in seen:
                    continue
                seen.add(key)
                walked += 1
                t = dt.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                arm = 'canary' if pool_of(b) in cans else 'control'
                per = 'post' if t >= cut else 'pre'
                if b:
                    bots[(per, arm)].add(b)
                if n in KEEP:
                    kept.append({'t': t, 'per': per, 'arm': arm, 'name': n, 'status': sk.get('status'), 'fail_class': sk.get('fail_class'),
                                 'detail': sk.get('detail') or '', 'bot': b})
    kept.sort(key=lambda r: r['t'])
    return kept, walked, bots, bad


def judge(rows, exposure_pre=None):
    """exposure_pre: (scaffold_dug, lid_blocked) canary rows in the fixed EXPOSURE_PRE_H before the deploy (None: use the
    rows' own pre period, for the selftest)."""
    out = {}
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    lp = [r for r in post_c if r['name'] == '_lidplace']
    out['licence_canary'] = sum(1 for r in post_c if r['name'] == '_lidplace_mode' and kv(r['detail']).get('on') == '1')
    out['licence_off_canary'] = sum(1 for r in post_c if r['name'] == '_lidplace_mode' and kv(r['detail']).get('on') == '0')
    out['lidplace_rows_control'] = sum(1 for r in rows if r['arm'] == 'control' and mine(r))
    out['lidplace_rows_canary'] = len(lp)
    out['lidplace_cells_lid'] = sum(int(kv(r['detail']).get('lid') or 0) for r in lp)
    out['lidplace_cells_plan'] = sum(int(kv(r['detail']).get('plan') or 0) for r in lp)
    out['lidplace_by_profile'] = dict(Counter(kv(r['detail']).get('profile') or '?' for r in lp))
    out['lid_fallback_canary'] = sum(1 for r in post_c if r['name'] == '_dig_approach' and 'lid_fallback=1' in r['detail'])
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            sel = [r for r in rows if r['per'] == per and r['arm'] == arm]
            out['lid_scaffold_dug_%s_%s' % (per, arm)] = sum(1 for r in sel if scaffold_dug(r))
            out['lid_clear_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == '_lid_clear')
            out['lid_blocked_%s_%s' % (per, arm)] = sum(1 for r in sel if lid_blocked_count(r))
            out['gather_ok_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == 'gather' and r['status'] == 'success')
            out['gather_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == 'gather')
            out['pickup_budget_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == '_pickup_skipped' and 'err=path_budget' in r['detail'])
    out['instrument_control'] = int(out['lid_clear_post_control'] + out['lid_clear_pre_control'] >= 1 or out['lid_blocked_post_control'] >= 1)
    if exposure_pre is None:
        exposure_pre = (out['lid_scaffold_dug_pre_canary'], out['lid_blocked_pre_canary'])
    out['exposure_pre_scaffold_dug'], out['exposure_pre_lid_blocked'] = exposure_pre
    out['exposure_ready'] = int(exposure_pre[0] >= 1 or exposure_pre[1] >= 3)
    out['_lists'] = {'lidplace': [(r['bot'], str(r['t']), r['detail'][:160]) for r in lp[:5]]}
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 26, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='hive-a-Alpha', arm='canary', per='post', status='success': {
        't': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'fail_class': None, 'detail': detail, 'bot': bot}
    LC = lambda lid='dirt', outcome='dug', **k: R('_lid_clear', 'outcome=%s by=deposit at=1,2,3 key=1,2,3 lid=%s above=air tool=hand dig_ms=750 budget=3250' % (outcome, lid), **k)
    LP = lambda lid=1, plan=0, **k: R('_lidplace', 'moves=1 n=%d lid=%d plan=%d surcharge=20 cells=1,3,3:lid status=success profile=gather goal=1,9,3 off=0' % (lid + plan, lid, plan), **k)
    MODE = lambda on=1, **k: R('_lidplace_mode', 'on=%d cost=20 row_window_ms=30000' % on, **k)
    ctl = [LC(arm='control', bot='placebo-b-Alpha')]
    r = judge([MODE(), LP(), LP(lid=0, plan=1), LC(per='pre')] + ctl)
    assert r['licence_canary'] == 1 and r['lidplace_rows_canary'] == 2 and r['lidplace_cells_lid'] == 1 and r['lidplace_cells_plan'] == 1, r
    assert r['lidplace_rows_control'] == 0 and r['exposure_ready'] == 1 and r['instrument_control'] == 1, r
    assert judge([MODE(on=0)] + ctl)['licence_canary'] == 0, 'LIDPLACE=0 is not a live licence'
    assert judge([MODE(arm='control', bot='board-a-Bravo')] + ctl)['lidplace_rows_control'] == 1, 'ARMS: a control licence row'
    assert judge([LP(arm='control', bot='board-a-Bravo')] + ctl)['lidplace_rows_control'] == 1, 'ARMS: a control _lidplace row'
    assert judge([R('_dig_approach', 'spruce_log 1,2,3: planned 0 block(s), in_reach=true [visited=6 ms=7 lid_fallback=1 walk_ms=1 dig_ms=0]', arm='control', bot='board-a-Bravo')] + ctl)['lidplace_rows_control'] == 1
    assert judge([R('_dig_approach', 'spruce_log 1,2,3: planned 0 block(s), in_reach=true [visited=6 ms=7 walk_ms=1 dig_ms=0]', arm='control', bot='board-a-Bravo')] + ctl)['lidplace_rows_control'] == 0, 'control: a plain dig_approach row'
    d = judge([LC(), LC('cobblestone'), LC('oak_leaves'), LC('dirt', outcome='refused')] + ctl)
    assert d['lid_scaffold_dug_post_canary'] == 2 and d['lid_clear_post_canary'] == 4, d
    assert judge(ctl)['exposure_ready'] == 0, 'no canary lid rows before: not exposed'
    assert judge(ctl, exposure_pre=(0, 3))['exposure_ready'] == 1 and judge(ctl, exposure_pre=(1, 0))['exposure_ready'] == 1
    assert judge(ctl, exposure_pre=(0, 2))['exposure_ready'] == 0
    assert judge([LC()])['instrument_control'] == 0, 'the instrument is its own gate'
    g = judge([R('gather', 'collected 1 spruce_log'), R('gather', 'x', status='failed'), R('_pickup_skipped', 'drop 1 refused the walk; err=path_budget item=spruce_log d=0,4,0 ms=6001')] + ctl)
    assert g['gather_ok_post_canary'] == 1 and g['gather_post_canary'] == 2 and g['pickup_budget_post_canary'] == 1, g
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    ovr = os.environ.get('CANARY_DRYRUN')
    if ovr:
        CAN, CV, ISO = ovr.split(':', 2)
        CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
    else:
        man = json.load(open('/srv/mcbots/trial-manifest.json'))
        CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
        CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
    CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = (now - CUT).total_seconds() / 60
    assert elapsed > 0 and CAN, 'no canary declared'
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 180)
    END, PRE = CUT + dt.timedelta(minutes=W), CUT - dt.timedelta(minutes=W)
    rows, walked, bots, bad = stream(PRE, END, CUT, CANS)
    xrows, xwalked, _, _ = stream(CUT - dt.timedelta(hours=EXPOSURE_PRE_H), CUT, CUT, CANS)
    xpre = (sum(1 for r in xrows if r['arm'] == 'canary' and scaffold_dug(r)), sum(1 for r in xrows if r['arm'] == 'canary' and lid_blocked_count(r)))
    res = judge(rows, exposure_pre=xpre)
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    didof = lambda k: (rate(res[k + '_post_canary'], 'post', 'canary') - rate(res[k + '_pre_canary'], 'pre', 'canary')) \
        - (rate(res[k + '_post_control'], 'post', 'control') - rate(res[k + '_pre_control'], 'pre', 'control'))
    dids = {k: didof(k) for k in ('lid_scaffold_dug', 'lid_clear', 'lid_blocked', 'gather_ok', 'gather', 'pickup_budget')}
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs('post', 'canary'), hrs('post', 'control')))
    print('PRIMARY      lid scaffold dug (_lid_clear outcome=dug, lid=dirt|grass|cobble) canary %d -> %d control %d -> %d | DiD %+.4f /bot-h (should FALL; RARE -- read at the deadline)'
          % (res['lid_scaffold_dug_pre_canary'], res['lid_scaffold_dug_post_canary'], res['lid_scaffold_dug_pre_control'], res['lid_scaffold_dug_post_control'], dids['lid_scaffold_dug']))
    print('             all _lid_clear canary %d -> %d control %d -> %d DiD %+.4f | count_town lid_blocked canary %d -> %d control %d -> %d DiD %+.4f'
          % (res['lid_clear_pre_canary'], res['lid_clear_post_canary'], res['lid_clear_pre_control'], res['lid_clear_post_control'], dids['lid_clear'],
             res['lid_blocked_pre_canary'], res['lid_blocked_post_canary'], res['lid_blocked_pre_control'], res['lid_blocked_post_control'], dids['lid_blocked']))
    print('INSTRUMENT   _lidplace rows (a chosen route still on a lid/plan cell) canary %d: lid cells %d plan cells %d by profile %s | lid_fallback %d | e.g. %s'
          % (res['lidplace_rows_canary'], res['lidplace_cells_lid'], res['lidplace_cells_plan'], res['lidplace_by_profile'], res['lid_fallback_canary'], res['_lists']['lidplace'][:2]))
    print('LIVENESS     licence rows on=1 %d (on=0 %d) | ARMS control rows %d (must be 0)' % (res['licence_canary'], res['licence_off_canary'], res['lidplace_rows_control']))
    print('REPORTED     gather ok canary %d -> %d control %d -> %d DiD %+.3f /bot-h | pickup path_budget canary %d -> %d control %d -> %d DiD %+.4f'
          % (res['gather_ok_pre_canary'], res['gather_ok_post_canary'], res['gather_ok_pre_control'], res['gather_ok_post_control'], dids['gather_ok'],
             res['pickup_budget_pre_canary'], res['pickup_budget_post_canary'], res['pickup_budget_pre_control'], res['pickup_budget_post_control'], dids['pickup_budget']))
    print('EXPOSURE     -> %s (frozen: canary scaffold lid digs %d / lid_blocked rows %d in the %d h before declared_at, %d rows walked; need >= 1 / >= 3) | INSTRUMENT control -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['exposure_pre_scaffold_dug'], res['exposure_pre_lid_blocked'], EXPOSURE_PRE_H, xwalked,
             'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('lidplaceread', W, {k: v for k, v in res.items() if not k.startswith('_')} | {'%s_did' % k: clean(v) for k, v in dids.items()})
    except Exception as e:
        print('emit failed:', e)
