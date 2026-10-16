#!/usr/bin/env python3
# lidclearread.py [window_min] -- the read for canary `lidclear-01` (lid-blocked town chests: the recount clears the lid,
# and every lid dig equips the cheapest harvesting tool with a digTime budget). CANARY_DRYRUN=pool[,pool]:sha:iso for dry
# runs (never emits). Judges the CANARY ARM; difference-in-differences against control for the effect; DENOMINATORS FIRST.
#
# WHY (docs/reports/lidclear-2026-10-16.md): 18 of 293 town containers in 7 worlds carry cobblestone on their lid; the
# recount never tried them (`count_town ... fails=lid_blocked:N`) and the deposit/withdraw lid digs raced a bare hand's
# 10,000 ms against a 10,000 ms timeout. One unopened container keeps the town's stock UNKNOWN, so cobblecap admits
# nothing (`_stock_refused ... cobble_unknown`).
#
# MEMORY: STREAMED (stockrecountread's pattern): only the kinds below are held.
#
# THE CHANGE (rows only this build writes):
#   _lidclear_mode  once per spawn: the licence (proves the build is live, not the effect)
#   _lid_clear      one per blocked half judged: outcome= by= at= key= lid= above= tool= dig_ms= budget= [why=]
#                   outcome: dug | refused | failed | unconfirmed | slow | no_time | reach | hand | aborted. `dug` is the
#                   bot's own world model, NOT the server's word -- the WINDOW-BACKED COUNT after it is (below)
#   _dig_town       ... purpose=lid ... (the dig instrument's row: its outcome= is the server's packet word)
#
#   LIVENESS   counted_after_dig: canary-dug keys with a journal `cnt` for that key captured AFTER the dig and inside the
#              read's window (the count is written only from a real server window: the lid really opened; a count from
#              after the window cannot pass an earlier read -- Codex code r2). >= 1. Mechanism, read from the journals.
#   ARMS       lid_rows_control: control _lid_clear / _lidclear_mode / purpose=lid rows (must be 0)
#   DEFECTS (each REVERTS; each has a failing fixture in --selftest)
#     D1 breach_lid_protected: a canary _lid_clear that DUG or tried (outcome dug/failed/unconfirmed) a block that is
#        storage, a station, a door, a bed or any block entity -- lidrule.mjs LID_BREAKABLE must have refused it
#     D2 breach_lid_slow: a canary dig whose budget exceeded LID_DIG_MAX_MS (15,000) -- the bound broken
#   REPORTED   count_town rows with lid_blocked per bot-h, canary vs control, DiD with the pre period (should FALL);
#              cobble_unknown refusals per bot-h DiD (should FALL); count_town rows that completed the town (unknown_after=0)
#              DiD (should RISE); _lid_clear outcomes by `by`, and the BLOCKS refused (a new blocker material shows here
#              first); deposit/withdraw container_blocked failures DiD (should FALL); unique keys dug; per-arm `fails=`
#              reasons, so a lid_blocked that merely turned into lid_not_cleared / lid_dug_open_timed_out is visible
#   TRIPWIRES  (never a verdict) GHOST CLEARS: count_town fails `lid_dug_open_timed_out` (the bot dug, the server kept the
#              block); RE-BLOCKING: one lid CELL dug twice or more by the canary in the window (name the placer; the two
#              halves of a double chest are two cells, not a re-block -- Codex code r2 P3); new town
#              chests placed DiD. Deaths near a lid dig are the gate's linkage (registration change_rows: _lid_clear).
#   INSTRUMENT control count_town rows (>= 1) and control lid_blocked rows (>= 1: the population is visible in control)
#   EXPOSURE   FROZEN BEFORE THE DEPLOY (Codex design r1, both code reviews r2): >= 3 canary count_town lid_blocked rows
#              in the FIXED 12 h before declared_at (a drawn canary town had a blocked lid) -- the same at every poll,
#              independent of the DiD window and of anything after the deploy. A post-deploy attempt is a mechanism read,
#              not eligibility; the instrument (control rows) is its own gate, reported separately.
import sys, os, json, re, glob, gzip
import datetime as dt
from collections import Counter, defaultdict

KEEP = ('count_town', '_stock_refused', '_lid_clear', '_lidclear_mode', '_dig_town', '_deposit_new_chest', 'deposit', 'withdraw_pick', 'withdraw')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
LID_DIG_MAX_MS = 15000
DUG = ('dug', 'failed', 'unconfirmed')
PROTECTED = re.compile(r'(chest|barrel|shulker_box|furnace|smoker|crafting_table|composter|hopper|dispenser|dropper|_bed|_door|trapdoor|_sign|lectern|beacon|anvil|enchanting_table|brewing_stand|jukebox|spawner|bell|campfire|torch|lantern)')
REBLOCK_MIN = 2
EXPOSURE_PRE_H = 12
STATE_ROOT = '/var/lib/mcai'


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def num(f, k, default=0):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return default


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def lid_blocked_count(r):
    return r['name'] == 'count_town' and 'lid_blocked' in (kv(r['detail']).get('fails') or '')


def cobble_unknown(r):
    return r['name'] == '_stock_refused' and 'cobble_unknown' in r['detail']


def container_blocked(r):
    return r['name'] in ('deposit', 'withdraw_pick', 'withdraw') and r.get('fail_class') == 'container_blocked'


def mine(r):
    return r['name'] in ('_lid_clear', '_lidclear_mode') or (r['name'] == '_dig_town' and ' purpose=lid ' in ' %s ' % r['detail'])


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


def journal_counts(pools, root=STATE_ROOT):
    """{ (pool, key): [capture ms, ...] } from every town journal generation of the given pools (`cnt` records only)."""
    out = defaultdict(list)
    for pool in pools:
        for f in glob.glob('%s/_pool-%s/town-chest-*.cobble*.jsonl' % (root, pool)):
            try:
                fh = open(f, errors='replace')
            except OSError:
                continue
            with fh:
                for line in fh:
                    if '"t":"cnt"' not in line:
                        continue
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if r.get('t') == 'cnt' and r.get('k') and isinstance(r.get('cap', r.get('at')), (int, float)):
                        out[(pool, r['k'])].append(r.get('cap', r.get('at')))
    return out


def judge(rows, counts=None, end=None, exposure_pre=None):
    """exposure_pre: canary count_town lid_blocked rows in the fixed EXPOSURE_PRE_H before the deploy (None: use the
    rows' own pre period, for the selftest). end: the window's end; a count captured after it does not count."""
    out = {}
    counts = counts or {}
    end_ms = end.timestamp() * 1000 if end else float('inf')
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    post_k = [r for r in rows if r['per'] == 'post' and r['arm'] == 'control']
    lc = [r for r in post_c if r['name'] == '_lid_clear']
    oc = Counter((kv(r['detail']).get('outcome') or '?') for r in lc)
    out['lid_attempts'] = len(lc)
    out['lid_dug'] = oc.get('dug', 0)
    out['lid_outcomes'] = dict(oc)
    out['lid_by'] = dict(Counter('%s:%s' % (kv(r['detail']).get('by') or '?', kv(r['detail']).get('outcome') or '?') for r in lc))
    out['lid_blocks'] = dict(Counter(kv(r['detail']).get('lid') or '?' for r in lc))
    out['lid_refused_blocks'] = dict(Counter(kv(r['detail']).get('lid') or '?' for r in lc if kv(r['detail']).get('outcome') == 'refused'))
    dug = [(pool_of(r['bot']), kv(r['detail']).get('key') or kv(r['detail']).get('at'), r['t'], kv(r['detail']).get('at'))
           for r in lc if kv(r['detail']).get('outcome') == 'dug']
    out['keys_dug'] = len({(p, k) for p, k, _, _ in dug})
    seen_after = set()
    for p, k, t, _ in dug:
        ms = t.timestamp() * 1000
        if any(ms <= c <= end_ms for c in counts.get((p, k), [])):
            seen_after.add((p, k))
    out['counted_after_dig'] = len(seen_after)
    out['lid_rows_control'] = sum(1 for r in rows if r['arm'] == 'control' and mine(r))
    out['licence_canary'] = sum(1 for r in post_c if r['name'] == '_lidclear_mode')
    out['dig_lid_canary'] = sum(1 for r in post_c if r['name'] == '_dig_town' and ' purpose=lid ' in ' %s ' % r['detail'])
    prot, slow = [], []
    for r in lc:
        f = kv(r['detail'])
        if f.get('outcome') in DUG and PROTECTED.search(f.get('lid') or ''):
            prot.append((r['bot'], f.get('at'), f.get('lid'), str(r['t'])))
        if f.get('outcome') in DUG and num(f, 'budget') > LID_DIG_MAX_MS:
            slow.append((r['bot'], f.get('at'), num(f, 'budget'), str(r['t'])))
    out['breach_lid_protected'] = len(prot)
    out['breach_lid_slow'] = len(slow)
    per_chest = Counter('%s:%s' % (p, at) for p, _, _, at in dug)
    out['reblocked_chests'] = sorted([(k, n) for k, n in per_chest.items() if n >= REBLOCK_MIN], key=lambda x: -x[1])[:5]
    fails = {'canary': Counter(), 'control': Counter()}
    for r in rows:
        if r['per'] == 'post' and r['name'] == 'count_town':
            for part in (kv(r['detail']).get('fails') or '-').split(','):
                w, _, n = part.partition(':')
                if n.isdigit():
                    fails[r['arm']][w] += int(n)
    out['fails_canary'] = dict(fails['canary'])
    out['fails_control'] = dict(fails['control'])
    out['ghost_clears'] = fails['canary'].get('lid_dug_open_timed_out', 0)
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            sel = [r for r in rows if r['per'] == per and r['arm'] == arm]
            out['count_town_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == 'count_town')
            out['lid_blocked_%s_%s' % (per, arm)] = sum(1 for r in sel if lid_blocked_count(r))
            out['complete_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == 'count_town' and kv(r['detail']).get('unknown_after') == '0')
            out['cobble_unknown_%s_%s' % (per, arm)] = sum(1 for r in sel if cobble_unknown(r))
            out['container_blocked_%s_%s' % (per, arm)] = sum(1 for r in sel if container_blocked(r))
            out['new_chests_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == '_deposit_new_chest' and r['status'] == 'success' and 'placed=1' in r['detail'])
    out['instrument_control'] = int(out['count_town_post_control'] >= 1 and out['lid_blocked_post_control'] >= 1)
    out['exposure_pre_rows'] = out['lid_blocked_pre_canary'] if exposure_pre is None else exposure_pre
    out['exposure_ready'] = int(out['exposure_pre_rows'] >= 3)
    out['_lists'] = {'protected': prot[:5], 'slow': slow[:5]}
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 16, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='hive-a-Alpha', arm='canary', per='post', status='success', fc=None: {
        't': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'fail_class': fc, 'detail': detail, 'bot': bot}
    LC = lambda outcome, lid='cobblestone', at='355,72,147', budget=3000, by='count_town', **k: R('_lid_clear', 'outcome=%s by=%s at=%s key=%s lid=%s above=air tool=stone_pickaxe dig_ms=750 budget=%d' % (outcome, by, at, at, lid, budget), **k)
    CT = lambda fails='-', ua=1, **k: R('count_town', 'trigger=order refused=1 keys=1 counted=0 tried=1 unknown_after=%d fails=%s names=cobblestone:cobble_unknown' % (ua, fails), **k)
    ctl = [CT('lid_blocked:1', arm='control', bot='placebo-b-Alpha')]
    PRE = [CT('lid_blocked:1', per='pre')] * 3
    after = {('hive-a', '355,72,147'): [(T0 + dt.timedelta(minutes=1)).timestamp() * 1000]}
    before = {('hive-a', '355,72,147'): [(T0 - dt.timedelta(minutes=1)).timestamp() * 1000]}
    ok = judge([LC('dug'), CT('-', 0)] + ctl + PRE, after)
    assert ok['lid_dug'] == 1 and ok['counted_after_dig'] == 1 and ok['breach_lid_protected'] == 0 and ok['breach_lid_slow'] == 0 and ok['exposure_ready'] == 1 and ok['complete_post_canary'] == 1, ok
    assert judge([LC('dug')] + ctl, before)['counted_after_dig'] == 0, 'a count captured BEFORE the dig is not the lid opening'
    late = {('hive-a', '355,72,147'): [(T0 + dt.timedelta(days=1)).timestamp() * 1000]}
    assert judge([LC('dug')] + ctl, late, end=T0 + dt.timedelta(minutes=180))['counted_after_dig'] == 0, 'a count after the window cannot pass this read'
    assert judge([LC('dug')] + ctl, after, end=T0 + dt.timedelta(minutes=180))['counted_after_dig'] == 1, 'positive control: inside the window'
    assert judge([LC('dug')] + ctl, {('hive-b', '355,72,147'): after[('hive-a', '355,72,147')]})['counted_after_dig'] == 0, 'another pool\'s town is not this one'
    assert judge([LC('dug', lid='chest')] + ctl)['breach_lid_protected'] == 1, 'D1: a dug chest'
    assert judge([LC('failed', lid='barrel')] + ctl)['breach_lid_protected'] == 1, 'D1: a dig attempted on a barrel'
    assert judge([LC('refused', lid='barrel')] + ctl)['breach_lid_protected'] == 0, 'D1 control: a refusal is the rule working'
    assert judge([LC('dug', lid='cobblestone')] + ctl)['breach_lid_protected'] == 0, 'D1 control: cobblestone'
    assert judge([LC('dug', budget=16000)] + ctl)['breach_lid_slow'] == 1, 'D2: past the 15 s bound'
    assert judge([LC('slow', budget=0)] + ctl)['breach_lid_slow'] == 0, 'D2 control: a refused slow dig'
    assert judge(PRE + ctl)['exposure_ready'] == 1, 'pre-window lid_blocked rows are exposure'
    assert judge([CT('lid_blocked:1', per='pre')] * 2 + ctl)['exposure_ready'] == 0, 'two are not'
    assert judge([LC('dug')] * 5 + ctl)['exposure_ready'] == 0, 'a post-deploy attempt is mechanism, not eligibility'
    assert judge(ctl, exposure_pre=3)['exposure_ready'] == 1 and judge(PRE + ctl, exposure_pre=0)['exposure_ready'] == 0, 'the fixed 12 h count decides, not the DiD window'
    assert judge(PRE)['instrument_control'] == 0 and judge(PRE)['exposure_ready'] == 1, 'the instrument is its own gate'
    gh = judge([CT('lid_dug_open_timed_out:1,walk_timeout:1')] + ctl)
    assert gh['ghost_clears'] == 1 and gh['fails_canary'] == {'lid_dug_open_timed_out': 1, 'walk_timeout': 1}, gh
    assert judge([CT('walk_timeout:1')] + ctl)['lid_blocked_post_canary'] == 0, 'another failure is not lid_blocked'
    c = judge([LC('dug', arm='control', bot='board-a-Alpha'), R('_lidclear_mode', 'phase=mode', arm='control', bot='board-a-Alpha'),
               R('_dig_town', 'pos=1,2,3 block=cobblestone class=ground purpose=lid by=count_town outcome=confirmed', arm='control', bot='board-a-Alpha'),
               R('_dig_town', 'pos=1,2,3 block=cobblestone class=ground purpose=other by=deposit:x outcome=confirmed', arm='control', bot='board-a-Alpha')])
    assert c['lid_rows_control'] == 3 and c['lid_dug'] == 0, c
    rb = judge([LC('dug', mins=m) for m in range(2)] + ctl)
    assert rb['reblocked_chests'] == [('hive-a:355,72,147', 2)] and rb['keys_dug'] == 1, rb
    two = judge([R('_lid_clear', 'outcome=dug by=count_town at=%s key=355,72,147 lid=cobblestone above=air tool=hand dig_ms=10000 budget=12500' % a) for a in ('355,72,147', '356,72,147')] + ctl)
    assert two['reblocked_chests'] == [] and two['keys_dug'] == 1, 'both halves of a double chest are not a re-block'
    assert judge([LC('dug')] + ctl)['reblocked_chests'] == [], 'dug once is not re-blocking'
    rf = judge([LC('refused', lid='oak_planks')] + ctl)
    assert rf['lid_refused_blocks'] == {'oak_planks': 1} and rf['breach_lid_protected'] == 0, rf
    assert judge([R('withdraw_pick', 'the chest at 1,2,3 has cobblestone on its lid and it would not break', status='failed', fc='container_blocked')])['container_blocked_post_canary'] == 1
    assert judge([R('_stock_refused', 'via=deposit n=1 cobble=1 stock=0 at_cobble=0 at_stock=0 cobblestone:64:cobble_unknown')])['cobble_unknown_post_canary'] == 1
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
    # EXPOSURE, frozen: the fixed 12 h before declared_at, whatever the read window
    xrows, xwalked, _, _ = stream(CUT - dt.timedelta(hours=EXPOSURE_PRE_H), CUT, CUT, CANS)
    xpre = sum(1 for r in xrows if r['arm'] == 'canary' and lid_blocked_count(r))
    res = judge(rows, journal_counts(CANS), end=END, exposure_pre=xpre)
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    didof = lambda k: (rate(res[k + '_post_canary'], 'post', 'canary') - rate(res[k + '_pre_canary'], 'pre', 'canary')) \
        - (rate(res[k + '_post_control'], 'post', 'control') - rate(res[k + '_pre_control'], 'pre', 'control'))
    dids = {k: didof(k) for k in ('lid_blocked', 'cobble_unknown', 'complete', 'container_blocked', 'new_chests')}
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs('post', 'canary'), hrs('post', 'control')))
    print('COUNT_TOWN   rows canary %d -> %d control %d -> %d | lid_blocked canary %d -> %d control %d -> %d | DiD %+.3f /bot-h'
          % (res['count_town_pre_canary'], res['count_town_post_canary'], res['count_town_pre_control'], res['count_town_post_control'],
             res['lid_blocked_pre_canary'], res['lid_blocked_post_canary'], res['lid_blocked_pre_control'], res['lid_blocked_post_control'], dids['lid_blocked']))
    print('             completed the town (unknown_after=0) canary %d -> %d control %d -> %d | DiD %+.3f /bot-h'
          % (res['complete_pre_canary'], res['complete_post_canary'], res['complete_pre_control'], res['complete_post_control'], dids['complete']))
    print('LIVENESS     canary-dug keys COUNTED from a window after the dig %d of %d keys dug | lid rows: dug %d of %d judged | outcomes %s | by %s | blocks %s | refused blocks %s'
          % (res['counted_after_dig'], res['keys_dug'], res['lid_dug'], res['lid_attempts'], res['lid_outcomes'], res['lid_by'], res['lid_blocks'], res['lid_refused_blocks']))
    print('             purpose=lid digs %d | licence rows %d | control rows %d (must be 0) | count_town fails canary %s control %s'
          % (res['dig_lid_canary'], res['licence_canary'], res['lid_rows_control'], res['fails_canary'], res['fails_control']))
    print('DEFECTS      D1 protected block dug %d %s | D2 budget past %d ms %d %s'
          % (res['breach_lid_protected'], res['_lists']['protected'], LID_DIG_MAX_MS, res['breach_lid_slow'], res['_lists']['slow']))
    print('REPORTED     cobble_unknown refusals canary %d -> %d control %d -> %d | DiD %+.3f /bot-h | deposit/withdraw container_blocked canary %d -> %d control %d -> %d | DiD %+.4f'
          % (res['cobble_unknown_pre_canary'], res['cobble_unknown_post_canary'], res['cobble_unknown_pre_control'], res['cobble_unknown_post_control'], dids['cobble_unknown'],
             res['container_blocked_pre_canary'], res['container_blocked_post_canary'], res['container_blocked_pre_control'], res['container_blocked_post_control'], dids['container_blocked']))
    print('TRIPWIRES    ghost clears (dug, open timed out) %d | keys dug >= %d times %s | new town chests canary %d -> %d control %d -> %d DiD %+.4f'
          % (res['ghost_clears'], REBLOCK_MIN, res['reblocked_chests'], res['new_chests_pre_canary'], res['new_chests_post_canary'], res['new_chests_pre_control'], res['new_chests_post_control'], dids['new_chests']))
    print('EXPOSURE     -> %s (frozen before the deploy: canary lid_blocked count_town rows in the %d h before declared_at %d of %d rows walked, need 3) | INSTRUMENT control count_town %d, control lid_blocked %d -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', EXPOSURE_PRE_H, res['exposure_pre_rows'], xwalked, res['count_town_post_control'], res['lid_blocked_post_control'],
             'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('lidclearread', W, {k: v for k, v in res.items() if not k.startswith('_')} | {'%s_did' % k: clean(v) for k, v in dids.items()})
    except Exception as e:
        print('emit failed:', e)
