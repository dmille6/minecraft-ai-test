#!/usr/bin/env python3
"""Tests for effectwatch-01: lib/busytime.py, lib/effectmetrics.py, lib/telemetry.stream_rows, host/effectcache.py and
host/effectwatch.py. Behaviour, not text: every second classified once and the classes sum to the window; END-stamped
sub-steps; a hole is unobserved; ratios are ratios of sums; a canary build is never fleet; the rotated generation is read;
a synthetic fleet whose metric halves after a promotion reads EFFECT, an unchanged one NO-EFFECT, a holed one UNREADABLE,
a minority-model A/B is excluded; the wiring (alarmhead FILES, monitors.json, installer) is present; every anchored mutant
is killed.
    python3 -B scripts/host/test_effectwatch.py
"""
import datetime as dt
import gzip
import importlib.util
import json
import os
import random
import sys
import subprocess
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
UTC = dt.timezone.utc
FAILS = []


def check(name, ok, info=''):
    print(('  PASS  ' if ok else '  FAIL  ') + name + ('' if ok else f'\n        {str(info)[:400]}'))
    if not ok:
        FAILS.append(name)


def load(path, name, replace=None, inject=None):
    src = open(path).read()
    if replace:
        old, new = replace
        assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE in {path}: {old!r}'
        src = src.replace(old, new)
    m = types.ModuleType(name)
    m.__file__ = path
    if inject:
        saved = {k: sys.modules.get(k) for k in inject}
        sys.modules.update(inject)
    try:
        exec(compile(src, path, 'exec'), m.__dict__)
    finally:
        if inject:
            for k, v in saved.items():
                if v is None:
                    sys.modules.pop(k, None)
                else:
                    sys.modules[k] = v
    return m


P_BT = os.path.join(REPO, 'scripts/lib/busytime.py')
P_EM = os.path.join(REPO, 'scripts/lib/effectmetrics.py')
P_TM = os.path.join(REPO, 'scripts/lib/telemetry.py')
P_EC = os.path.join(REPO, 'scripts/host/effectcache.py')
P_EW = os.path.join(REPO, 'scripts/host/effectwatch.py')


def mods(**mut):
    """Fresh modules; mut = {'bt': (old, new), ...} applies one mutant. effectwatch / effectcache see the mutated libs."""
    import lib
    bt = load(P_BT, 'lib.busytime', mut.get('bt'))
    em = load(P_EM, 'lib.effectmetrics', mut.get('em'))
    tm = load(P_TM, 'lib.telemetry', mut.get('tm'))
    inj = {'lib.busytime': bt, 'lib.effectmetrics': em, 'lib.telemetry': tm}
    setattr(lib, 'busytime', bt), setattr(lib, 'effectmetrics', em), setattr(lib, 'telemetry', tm)
    ec = load(P_EC, 'effectcache', mut.get('ec'), inject=inj)
    inj['effectcache'] = ec
    ew = load(P_EW, 'effectwatch', mut.get('ew'), inject=inj)
    return types.SimpleNamespace(bt=bt, em=em, tm=tm, ec=ec, ew=ew)


# ------------------------------------------------------------------------------------------------------------ busytime --
def t_busy(M):
    BT = M.bt
    ok = True
    gather = BT.skill_interval(0, 'gather', 100_000)          # [0, 100)
    sub = BT.skill_interval(50, '_craft_sync', 10_000)        # END-stamped: [40, 50) inside the gather
    tail = BT.skill_interval(300, '_build_visit', 20_000)     # END-stamped: [280, 300) -- inside the window only if END
    goto = BT.skill_interval(60, 'goto', 20_000)              # overlaps the gather: productive wins
    sec = BT.classify(0, 300, [gather, sub, tail, goto], [(130, 2.0)], stamps=list(range(0, 1300, 20)))
    ok &= abs(sum(sec.values()) - 300) < 1e-6
    ok &= abs(sec['productive'] - 120) < 1e-6                 # 0-100 + 280-300
    ok &= abs(sec['walking'] - 0) < 1e-6
    ok &= abs(sec['llm_wait'] - 2) < 1e-6 and abs(sec['between'] - 30) < 1e-6
    ok &= abs(sec['idle'] - 148) < 1e-6
    # a 15-minute hole with no row of either stream is unobserved, and leaves the denominator
    sec2 = BT.classify(0, 3600, [], [], stamps=[0, 100, 1100, 1500, 2000, 2500, 3000, 3500, 3600])
    ok &= abs(sec2['unobserved'] - 1000) < 1e-6 and abs(sum(sec2.values()) - 3600) < 1e-6
    sh = BT.shares(sec2)
    ok &= abs(sh['observed_h'] - 2600 / 3600) < 1e-9
    ok &= BT.pause_seconds('rule=pausewait runner paused; wake in 31s') == 31.0 and BT.pause_seconds('rule=vetoskip') is None
    sec3 = BT.classify(0, 100, [], [(90, 1.0)], pauses=[(0, 30)], deaths=[50], stamps=[0, 60, 100])
    ok &= abs(sec3['paused'] - 30) < 1e-6 and abs(sec3['dead'] - 10) < 1e-6
    return bool(ok), sec


# ------------------------------------------------------------------------------------------------------- effectmetrics --
def t_metrics(M):
    EM = M.em
    ok = True
    c = EM.new_cell('board-a')
    EM.add_skill_row(c, {'skill': {'name': 'gather', 'status': 'success', 'duration_ms': 5000, 'args': {'block': 'oak_log'},
                                   'inventory_delta': {'oak_log': 3, 'dirt': -1}}})
    EM.add_skill_row(c, {'skill': {'name': '_lid_clear', 'status': 'no_effect', 'detail': 'outcome=refused by=x lid=oak_planks'}})
    EM.add_skill_row(c, {'skill': {'name': '_death', 'status': 'failed', 'fail_class': 'drowning'}})
    EM.add_llm_row(c, {'trigger': 'idle', 'llm': {'latency_ms': 2000, 'prompt_tokens': 1000, 'schema_valid': True,
                                                  'error': 'repeat_loop', 'model': 'qwen', 'completion_tokens': 50}})
    ok &= c['k'].get('gather_log|success') == 1 and c['items'] == 3
    ok &= c['dk'].get('_lid_clear:refused:oak_planks') == 1 and c['fc'].get('_death|drowning') == 1
    ok &= c['llm']['err'].get('repeat_loop') == 1 and c['llm']['ptok'] == 1000
    # a work-order row of the llm stream (no completion_tokens, latency 0) is NOT a model call
    EM.add_llm_row(c, {'trigger': 'idle', 'llm': {'latency_ms': 0, 'prompt_tokens': 900, 'schema_valid': True,
                                                  'completion_tokens': None, 'model': 'qwen'}})
    ok &= c['llm']['n'] == 1 and c['llm']['orders'] == 1 and c['llm']['ptok'] == 1000
    # ratio of SUMS, not a mean of ratios
    a, b = EM.new_cell('p1'), EM.new_cell('p2')
    a['k'] = {'deposit|success': 1, 'deposit|failed': 9}
    b['k'] = {'deposit|success': 1}
    m = EM.measure([({'bot': 'x', 'pool': 'p1'}, a), ({'bot': 'y', 'pool': 'p2'}, b)], 'skill.share.v1',
                   {'name': 'deposit', 'status': 'success'})
    ok &= abs(m['value'] - 2 / 11) < 1e-9 and m['num'] == 2 and m['den'] == 11
    good = {'version': 1, 'targets': [{'metric': 'kind.rate.v1', 'params': {'name': 'x'}, 'direction': 'decrease',
                                       'minimum': 0.2, 'scale': 'relative'}]}
    ok &= EM.validate(good) == []
    ok &= bool(EM.validate({'version': 1, 'targets': [dict(good['targets'][0], metric='nope.v1')]}))
    ok &= bool(EM.validate({'version': 1, 'targets': [dict(good['targets'][0], params={})]}))
    ok &= bool(EM.validate({'version': 1, 'targets': [dict(good['targets'][0], direction='up')]}))
    ok &= bool(EM.validate({'version': 1, 'targets': []}))                        # neither targets nor none_reason
    ok &= EM.validate({'version': 1, 'targets': [], 'none_reason': 'a guard'}) == []
    side = json.load(open(os.path.join(REPO, 'config/effect-targets.json')))['runs']
    bad = {k: EM.validate(v) for k, v in side.items() if EM.validate(v)}
    ok &= not bad and len(side) >= 26
    return bool(ok), (m, bad)


# ------------------------------------------------------------------------------------------------------- stream_rows --
def t_stream(M):
    TM = M.tm
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, 'b1'))
    row = lambda t, n: json.dumps({'@timestamp': t, 'skill': {'name': n}}) + '\n'
    with gzip.open(os.path.join(d, 'b1', 'skill-b1.jsonl-20261102.gz'), 'wt') as f:
        f.write(row('2026-11-01T10:00:00.000Z', 'old') + row('2026-11-01T23:00:00.000Z', 'rotated'))
    with open(os.path.join(d, 'b1', 'skill-b1.jsonl'), 'w') as f:
        f.write(row('2026-11-02T00:30:00.000Z', 'live') + 'not json\n' + row('2026-11-02T05:00:00.000Z', 'late')
                + json.dumps({'skill': {'name': 'reordered-old'}, '@timestamp': '2026-11-01T05:00:00.000Z'}) + '\n')
    now = dt.datetime.now(UTC)
    for p in (os.path.join(d, 'b1', 'skill-b1.jsonl-20261102.gz'), os.path.join(d, 'b1', 'skill-b1.jsonl')):
        os.utime(p, (now.timestamp(), now.timestamp()))
    got = [r['skill']['name'] for _, r in TM.stream_rows(d, 'b1', dt.datetime(2026, 11, 1, 20, tzinfo=UTC),
                                                         dt.datetime(2026, 11, 2, 1, tzinfo=UTC))]
    return got == ['rotated', 'live'], got


# --------------------------------------------------------------------------------------------------------- the read ---
POOLS = [f'{g}-{x}' for g in ('board', 'hive', 'isolated', 'placebo') for x in 'abcd']
SHA0, SHA1, SHAC, SHAY = 'a' * 40, 'b' * 40, 'c' * 40, 'd' * 40
P_TIME = dt.datetime(2026, 11, 10, 12, 0, tzinfo=UTC)
D_TIME = P_TIME - dt.timedelta(hours=3)


def fake_fleet(M, cache_dir, post_factor, hole=None, seed=1, ab=False, dk_key=None, counted=True, uncount=None):
    """16 pools x 5 bots, hourly cells from P-11 d to P+4 d. Metric: furnace_drain rows per bot-hour ~2 (Poisson-ish),
    times post_factor on the promoted build after P. A canary build (SHAC) in two pools during the baseline with a huge
    count is the lineage control; with ab=True, three pools run another model with a huge count (the model control)."""
    EC, EM = M.ec, M.em
    rnd = random.Random(seed)
    h = P_TIME - dt.timedelta(days=11)
    end = P_TIME + dt.timedelta(days=4)
    while h < end:
        if hole is not None and h == hole:
            h += dt.timedelta(hours=1)
            continue
        bots = {}
        for pool in POOLS:
            for i in range(5):
                bot = f'{pool}-{i}'
                after = h >= P_TIME + dt.timedelta(hours=1)
                sha = SHA1 if after else SHA0
                canary = (not after) and pool in ('board-a', 'hive-b') and D_TIME - dt.timedelta(hours=30) <= h < D_TIME - dt.timedelta(hours=20)
                if canary:
                    sha = SHAC
                later = pool in ('board-a', 'hive-b') and P_TIME + dt.timedelta(hours=5) <= h < P_TIME + dt.timedelta(hours=9)
                if later:
                    sha = SHAY             # a LATER run's canary inside the post window: not fleet until its promotion
                c = EM.new_cell(pool)
                lam = 2.0 * (post_factor if after else 1.0) * (1 + 0.03 * rnd.uniform(-1, 1))
                n = max(0, int(round(lam + rnd.uniform(-0.6, 0.6))))
                if after and post_factor == 0:
                    n = 0
                if canary or later:
                    n = 500
                model = 'qwen2.5'
                if ab and pool in ('isolated-a', 'isolated-c', 'placebo-c'):
                    model, n = 'qwen3.5', 400
                c['k'] = {'furnace_drain|no_effect': n}
                if dk_key:
                    c['k'][dk_key.split(':')[0] + '|success'] = n
                    c['dk'] = {dk_key: n} if counted else {}
                c['rows'] = 900
                c['llm']['n'] = 100
                c['llm']['model'] = {model: 100}
                c['busy'] = {'productive': 1000.0, 'between': 2600.0}
                bots[bot] = {sha: c}
        EC.write_hour(cache_dir, h, {'bots': bots, 'controls': {'bot_dirs': 80, 'bots_with_rows': 80,
                                                              'skill_rows': 72000, 'llm_rows': 8000},
                                     'dk_keys': [dk_key] if dk_key and counted and not (uncount and uncount(h)) else [],
                                     'vocab': {dk_key.split(':')[0]: {x: 9 for x in dk_key.split(':')[1:]}} if dk_key else {}},
                      h)
        h += dt.timedelta(hours=1)


def journal():
    t = lambda x: x.strftime('%Y-%m-%dT%H:%M:%SZ')
    return [
        {'ts': t(P_TIME - dt.timedelta(days=20)), 'run': 'old-01', 'phase': 'promoted', 'note': SHA0 + ' fleet-wide'},
        {'ts': t(D_TIME - dt.timedelta(minutes=3)), 'run': 'x-01', 'phase': 'drawn', 'note': 'board-c,hive-d :: draw'},
        {'ts': t(D_TIME), 'run': 'x-01', 'phase': 'deployed', 'note': 'board-c,hive-d'},
        {'ts': t(P_TIME - dt.timedelta(minutes=10)), 'run': 'x-01', 'phase': 'recorded', 'note': 'KEEP'},
        {'ts': t(P_TIME), 'run': 'x-01', 'phase': 'promoted', 'note': SHA1 + ' fleet-wide'},
        {'ts': t(P_TIME + dt.timedelta(days=3)), 'run': 'y-01', 'phase': 'promoted', 'note': SHAY + ' fleet-wide'},
    ]


SIDE = {'x-01': {'version': 1, 'targets': [{'metric': 'kind.rate.v1', 'params': {'name': 'furnace_drain'},
                                            'direction': 'decrease', 'minimum': 0.3, 'scale': 'relative'}],
                 'guardrails': [], 'none_reason': None}}


def read(M, factor, hole=None, ab=False, horizon='h24', side=None, **kw):
    d = tempfile.mkdtemp()
    fake_fleet(M, d, factor, hole=hole, ab=ab, **kw)
    EW = M.ew
    promos = EW.promotions(journal())
    ti = [p['run'] for p in promos].index('x-01')
    return EW.read_run(EW.Cache(d), promos, ti, horizon, sidecar=side or SIDE)

def side_with(**eff):
    return {'x-01': dict(SIDE['x-01'], **eff)}


# ------------------------------------------------------------------------------------------- effectfix-01 (11-07) ---
def t_exposure(M):
    """effect.exposure is a STRING (every registration since leasegen-01) or a dict {'model': ...} (a model-env run).
    A string never filters (and never crashes: 11 hourly runs died on `(expo or {}).get`); a dict filters by model."""
    EM = M.em
    ok = EM.exposure_model('a canary bot in a pool ...') is None and EM.exposure_model(None) is None
    ok &= EM.exposure_model({'model': 'qwen3.5'}) == 'qwen3.5' and EM.exposure_model({'pools': 2}) is None
    ok &= EM.exposure_model(['x']) is None
    v_str = read(M, 0.4, side=side_with(exposure='every canary bot on the idle lap (81% of fleet bot time)'))
    v_none = read(M, 0.4)
    ok &= v_str['verdict'] == v_none['verdict'] == 'EFFECT'
    ok &= abs(v_str['targets'][0]['post']['value'] - v_none['targets'][0]['post']['value']) < 1e-9
    # the dict shape still filters: with a 3-pool qwen3.5 A/B (400 events a cell) the post holds ONLY qwen3.5 cells
    v_dict = read(M, 1.0, ab=True, side=side_with(exposure={'model': 'qwen3.5'}))
    t = (v_dict.get('targets') or [{}])[0]
    ok &= (t.get('post') or {}).get('value', 0) > 50 and (t.get('baseline') or {}).get('value', 99) < 5
    return bool(ok), (v_str['verdict'], v_none['verdict'], t.get('baseline'), t.get('post'))


def t_generic_keys(M):
    """A key '<name>:<tok>...' on a name the hand list does not know counts rows whose detail holds the tokens in order;
    the hand-listed names keep their regexes."""
    EM = M.em
    W = ['_keeper:keeper_take', '_idlework:met:bag_stop', '_build:tidy:place']
    k = lambda n, d: EM.detail_keys(n, d, W)
    ok = k('_keeper', 'project=tidy op=keeper_take gen=29') == ['_keeper:keeper_take']
    ok &= k('_keeper', 'project=tidy op=keeper_release gen=30 why=underground') == []
    ok &= k('_idlework', 'idle_work met: iron 0/6, bag_stop') == ['_idlework:met:bag_stop']
    ok &= k('_idlework', 'idle_work met: grounds 1/3') == []
    ok &= k('_idlework', 'idle_work open: bag_stop then met') == []                   # order matters
    ok &= k('_build', 'project=tidy op=clear place=3') == ['_build:tidy:clear']       # hand name: regex only
    ok &= EM.is_generic_key('_keeper:keeper_take') and not EM.is_generic_key('_build:tidy:place')
    ok &= not EM.is_generic_key('_keeper')
    c = EM.new_cell('p')
    EM.add_skill_row(c, {'skill': {'name': '_keeper', 'status': 'success', 'detail': 'project=tidy op=keeper_take gen=2'}}, W)
    EM.add_skill_row(c, {'skill': {'name': '_keeper', 'status': 'success', 'detail': 'project=tidy op=keeper_take gen=3'}})
    ok &= c['dk'] == {'_keeper:keeper_take': 1}                                       # only when wanted
    bad = EM.validate({'version': 1, 'targets': [{'metric': 'detail.rate.v1', 'params': {'key': '_keeper'},
                                                  'direction': 'decrease', 'minimum': 0.3, 'scale': 'relative'}]})
    ok &= any('kind.rate.v1' in b for b in bad)
    return bool(ok), (k('_idlework', 'idle_work open: bag_stop then met'), c['dk'], bad)


def t_cache_keys(M):
    """effectcache counts the wanted generic keys, records them per hour (dk_keys) with a vocabulary, and rebuilds a
    recent hour that did not count a newly wanted key; wanted_keys comes from registrations (bundle members too) and the
    effect targets."""
    EC = M.ec
    h = dt.datetime(2026, 11, 7, 3, tzinfo=UTC)
    row = lambda m, n, d: (h + dt.timedelta(minutes=m), {'skill': {'name': n, 'status': 'success', 'detail': d},
                                                          'code': {'version': 'abc'}, 'exp': {'pool': 'board-a'}})
    voc = {}
    out = EC.bot_cells([row(1, '_keeper', 'project=tidy op=keeper_take gen=1'), row(2, '_keeper', 'op=keeper_release')],
                       [], [h], ['_keeper:keeper_take'], voc)
    ok = out[h]['abc']['dk'] == {'_keeper:keeper_take': 1} and voc[h]['_keeper'].get('keeper_take') == 1
    d = tempfile.mkdtemp()
    EC.write_hour(d, h, {'bots': {'b': out[h]}, 'controls': {}, 'dk_keys': ['_keeper:keeper_take'], 'vocab': voc[h]}, h)
    hd = EC.load_hour(d, h)
    ok &= hd['dk_keys'] == ['_keeper:keeper_take'] and hd['vocab']['_keeper']['keeper_take'] == 1
    rk = h - dt.timedelta(days=2)
    ok &= EC.needs_build(hd, h, ['_keeper:keeper_take'], rk) == ''
    ok &= EC.needs_build(hd, h, ['_keeper:keeper_take', '_idlework:met:bag_stop'], rk).startswith('rekey')
    ok &= EC.needs_build(hd, h, ['_idlework:met:bag_stop'], h + dt.timedelta(hours=1)) == ''      # older than the window
    ok &= EC.needs_build(None, h, [], rk) == 'missing'
    rd = tempfile.mkdtemp()
    json.dump({'effect': {'targets': [{'metric': 'detail.rate.v1', 'params': {'key': '_keeper:keeper_take'}}],
                          'guardrails': [{'metric': 'detail.rate.v1', 'params': {'key': '_build:tidy:place'}}]}},
              open(os.path.join(rd, 'a-01.json'), 'w'))
    json.dump({'bundle': {'members': [{'run': 'b-01', 'effect': {'targets': [
        {'metric': 'detail.share.v1', 'params': {'key': '_idlework:met:bag_stop', 'of_name': '_idlework'}}]}}]}},
        open(os.path.join(rd, 'bundle-01.json'), 'w'))
    wk = EC.wanted_keys(rd, {'c-01': {'targets': [{'metric': 'detail.rate.v1', 'params': {'key': '_foo:bar'}}]}})
    ok &= wk == ['_foo:bar', '_idlework:met:bag_stop', '_keeper:keeper_take']
    return bool(ok), (out[h]['abc']['dk'], wk)


def t_uncounted_hole(M):
    """A generic key the cache hours did not count is a CACHE HOLE (retried, never committed), not a zero; counted, the
    same fleet reads EFFECT."""
    key = '_keeper:keeper_take'
    side = side_with(targets=[{'metric': 'detail.rate.v1', 'params': {'key': key}, 'direction': 'decrease',
                               'minimum': 0.3, 'scale': 'relative'}])
    v1 = read(M, 0.4, side=side, dk_key=key, counted=True)
    v0 = read(M, 0.4, side=side, dk_key=key, counted=False)
    ok = v1['verdict'] == 'EFFECT' and v0['verdict'] == 'UNREADABLE' and M.ew.is_hole_only(v0)
    return bool(ok), (v1['verdict'], v1.get('why'), v0['verdict'], v0.get('why'))


def t_rekey_whole_read(M):
    """Codex review r1 BLOCKERS 1-2: hours that did not count a generic key -- in a SECOND target, a guardrail, or only in a
    placebo anchor day -- make the whole read UNREADABLE and hole-only (retried), never a committed EFFECT."""
    key = '_keeper:keeper_take'
    gt = {'metric': 'detail.rate.v1', 'params': {'key': key}, 'direction': 'decrease', 'minimum': 0.3, 'scale': 'relative'}
    two = side_with(targets=[SIDE['x-01']['targets'][0], gt])
    v1 = read(M, 0.4, side=two, dk_key=key, counted=False)
    v2 = read(M, 0.4, side=side_with(guardrails=[dict(gt, direction='decrease')]), dk_key=key, counted=False)
    day = (P_TIME - dt.timedelta(days=4)).date()
    v3 = read(M, 0.4, side=side_with(targets=[gt]), dk_key=key, uncount=lambda h: h.date() == day)
    v4 = read(M, 0.4, side=side_with(targets=[gt]), dk_key=key)
    ok = all(v['verdict'] == 'UNREADABLE' and v.get('rekey') and M.ew.is_hole_only(v) for v in (v1, v2, v3))
    ok &= v4['verdict'] == 'EFFECT' and not v4.get('rekey')
    return bool(ok), [(v['verdict'], v.get('why', '')[:120]) for v in (v1, v2, v3, v4)]


def seen_hour(M):
    EM = M.em
    c = EM.new_cell('board-a')
    for r in ({'skill': {'name': '_well_dispose', 'status': 'success', 'detail': 'slots=29->28 cap=at_cap'}},
              {'skill': {'name': '_death', 'status': 'failed', 'fail_class': 'drowning'}},
              {'skill': {'name': '_idlework', 'status': 'success', 'detail': 'idle_work met: iron 0/6, bag_stop'}},
              {'skill': {'name': '_build', 'status': 'success', 'detail': 'project=tidy op=place'}}):
        EM.add_skill_row(c, r)
    c['busy'] = {'productive': 100.0, 'between': 50.0}
    c['llm']['err'] = {'bad_args': 3, '-': 10}
    voc = {}
    EM.add_vocab(voc, {'skill': {'name': '_idlework', 'detail': 'idle_work met: iron 0/6, bag_stop'}})
    return {'bots': {'b': {'abc': c}}, 'controls': {'bot_dirs': 1, 'bots_with_rows': 1}, 'dk_keys': [], 'vocab': voc}


def t_seen(M):
    """The registration check: a name never seen in the window is refused WITH the nearest seen names (the 11-07 audit's
    misnames: well_dispose, death, drowned); real names pass; an empty window never passes."""
    EM = M.em
    ix = EM.seen_index([seen_hour(M)])
    T = lambda m, p: {'metric': m, 'params': p, 'direction': 'decrease', 'minimum': 0.2, 'scale': 'relative'}
    badeff = {'version': 1, 'targets': [T('kind.rate.v1', {'name': 'well_dispose'}),
                                        T('detail.rate.v1', {'key': '_idlework:met:bagstop'})],
              'guardrails': [T('kind.rate.v1', {'name': 'death'}),
                             T('failclass.rate.v1', {'name': '_death', 'fail_class': 'drowned'}),
                             T('detail.rate.v1', {'key': '_build:tidy:clear'}), T('llm.veto_share.v1', {'error': 'bad_arg'})]}
    bad = EM.seen_problems(badeff, ix)
    j = ' | '.join(bad)
    ok = len(bad) == 6 and 'nearest: _well_dispose' in j and 'nearest: _death' in j and 'nearest: drowning' in j
    ok &= 'bag_stop' in j and '_build:tidy:place' in j and 'bad_args' in j
    good = {'version': 1, 'targets': [T('kind.rate.v1', {'name': '_well_dispose'}),
                                      T('detail.rate.v1', {'key': '_idlework:met:bag_stop'}),
                                      T('detail.rate.v1', {'key': '_build:tidy:place'}), T('busy.share.v1', {'cls': 'decision'})],
            'guardrails': [T('failclass.rate.v1', {'name': '_death', 'fail_class': 'drowning'}),
                           T('llm.veto_share.v1', {'error': 'bad_args'}),
                           T('skill.share.v1', {'name': '_build', 'status': 'success'})]}
    g = EM.seen_problems(good, ix)
    ok &= g == []
    ok &= any('nothing can be checked' in x for x in EM.seen_problems(good, EM.seen_index([])))   # positive control
    ok &= bool(EM.seen_problems({'targets': [T('skill.share.v1', {'name': '_build', 'status': 'refused'})]}, ix))
    ok &= bool(EM.seen_problems({'targets': [T('skill.share.v1', {'name': '_build', 'status': 3})]}, ix))   # no TypeError
    # Codex review r1 BLOCKER 4: one rebuilt hour that counted the key with no match does not refuse a key whose tokens
    # the hours not yet rebuilt hold; every hour counting it with no match does
    gk = {'targets': [T('detail.rate.v1', {'key': '_idlework:met:bag_stop'})]}
    h0 = {'bots': {'b': {'abc': EM.new_cell('p')}}, 'controls': {}, 'dk_keys': ['_idlework:met:bag_stop'], 'vocab': {}}
    h0['bots']['b']['abc']['rows'] = 5
    h0['bots']['b']['abc']['k'] = {'_idlework|success': 5}
    ok &= EM.seen_problems(gk, EM.seen_index([h0, seen_hour(M)])) == []
    ok &= bool(EM.seen_problems(gk, EM.seen_index([h0, h0])))
    # an ABSOLUTE INCREASE target may name a row the base cannot write: a warning, not a problem (Claude review r1)
    newi = {'targets': [dict(T('kind.rate.v1', {'name': '_brand_new'}), direction='increase', scale='absolute', minimum=0.1)]}
    pr, wr = EM.seen_report(newi, ix)
    ok &= pr == [] and len(wr) == 1 and EM.seen_problems({'targets': [T('kind.rate.v1', {'name': '_brand_new'})]}, ix) != []
    return bool(ok), (bad, g, pr, wr)


def t_validate_cmd(M):
    """`effectwatch.py validate` exits 1 on a misnamed metric (printing the nearest name) and passes a real one."""
    import contextlib
    import io
    EW = M.ew
    d = tempfile.mkdtemp()
    now = dt.datetime(2026, 11, 7, 14, tzinfo=UTC)
    for i in range(3, 30):
        M.ec.write_hour(d, now - dt.timedelta(hours=i), seen_hour(M), now)
    T = lambda n: {'version': 1, 'targets': [{'metric': 'kind.rate.v1', 'params': {'name': n}, 'direction': 'increase',
                                              'minimum': 0.2, 'scale': 'relative'}]}
    rd = tempfile.mkdtemp()
    res = {}
    for nm, eff in (('bad', T('well_dispose')), ('good', T('_well_dispose'))):
        p = os.path.join(rd, nm + '.json')
        json.dump({'run_id': 'x', 'effect': eff}, open(p, 'w'))
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                EW.main(['validate', p, '--cache', d, '--now', now.strftime('%Y-%m-%dT%H:%M:%SZ')])
            res[nm] = (0, buf.getvalue())
        except SystemExit as e:
            res[nm] = (e.code, buf.getvalue())
    ok = res['bad'][0] == 1 and '_well_dispose' in res['bad'][1] and res['good'][0] == 0 and 'valid' in res['good'][1]
    ok &= 'INVALID:' in res['bad'][1].splitlines()
    # a registration with no effect field is not a bare effect object (the 11-07 ready queue: kittrim/pause30/forest)
    p0 = os.path.join(rd, 'noeffect.json')
    json.dump({'run_id': 'x', 'sha': 'abc', 'notes': 'n'}, open(p0, 'w'))
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            EW.main(['validate', p0, '--cache', d, '--now', now.strftime('%Y-%m-%dT%H:%M:%SZ')])
        res['noeffect'] = (0, buf.getvalue())
    except SystemExit as e:
        res['noeffect'] = (e.code, buf.getvalue())
    ok &= res['noeffect'][0] in (0, None) and 'no effect field' in res['noeffect'][1]
    # an empty cache window: exit 3 (cannot check); a validator failure: exit 4 -- neither is the INVALID exit 1
    p = os.path.join(rd, 'good.json')
    for nm, cache_dir, patch in (('empty', tempfile.mkdtemp(), None), ('error', d, 'boom')):
        real = EW.validate_effects
        if patch:
            def boom(*a, **k):
                raise ValueError('a bug')
            EW.validate_effects = boom
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                EW.main(['validate', p, '--cache', cache_dir, '--now', now.strftime('%Y-%m-%dT%H:%M:%SZ')])
            res[nm] = (0, buf.getvalue())
        except SystemExit as e:
            res[nm] = (e.code, buf.getvalue())
        finally:
            EW.validate_effects = real
    ok &= res['empty'][0] == 3 and 'CANNOT CHECK' in res['empty'][1] and res['error'][0] == 4
    ok &= 'INVALID:' not in res['empty'][1] + res['error'][1]
    return bool(ok), res


def t_correction(M):
    """A config/effect-targets.json entry with `correction` wins over the registration's own field; without one the
    registration wins."""
    EW = M.ew
    rd = tempfile.mkdtemp()
    json.dump({'effect': dict(SIDE['x-01'], note='reg')}, open(os.path.join(rd, 'x-01.json'), 'w'))
    e1, s1 = EW.effect_for('x-01', regdir=rd, sidecar={'x-01': dict(SIDE['x-01'], note='side')})
    e2, s2 = EW.effect_for('x-01', regdir=rd, sidecar={'x-01': dict(SIDE['x-01'], note='side', correction='misnamed kind')})
    ok = e1.get('note') == 'reg' and s1 == 'registration' and e2.get('note') == 'side' and 'correction' in s2
    ok &= M.em.validate(dict(SIDE['x-01'], correction='why')) == []
    return bool(ok), (s1, s2)


def run_args(sd, d, jp, lp, now):
    return ['run', '--no-push', '--since', '2026-11-01T00:00:00Z', '--now', now, '--journal', jp, '--cache', d,
            '--state-dir', sd, '--ledger', lp]


def t_crash(M):
    """One read that raises does not stop the others and pages ONCE (its own dedup state); the next clean run CLEARS it.
    A crash of the whole run pages once, keeps the earlier verdict alarms in the header and re-raises."""
    EW = M.ew
    d, sd = tempfile.mkdtemp(), tempfile.mkdtemp()
    fake_fleet(M, d, 0.4)
    j = journal() + [{'ts': (P_TIME + dt.timedelta(minutes=30)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'run': 'z-01',
                      'phase': 'promoted', 'note': 'e' * 40 + ' fleet-wide'}]
    jp = os.path.join(sd, 'journal.jsonl')
    open(jp, 'w').write('\n'.join(json.dumps(r) for r in j) + '\n')
    lp = os.path.join(sd, 'ledger.json')
    json.dump({'items': []}, open(lp, 'w'))
    tp = os.path.join(sd, 'targets.json')
    side = dict(SIDE, **{'z-01': dict(SIDE['x-01'], exposure='a string')})
    json.dump({'runs': side}, open(tp, 'w'))
    EW.TARGETS, EW.TARGETS_REPO = tp, None
    EW.EC.FINAL_AFTER = dt.timedelta(hours=2)
    now = (P_TIME + dt.timedelta(hours=30)).strftime('%Y-%m-%dT%H:%M:%SZ')
    real = EW.read_run

    def boom(cache, promos, ti, hz, sidecar=None):
        if promos[ti]['run'] == 'x-01':
            raise AttributeError("'str' object has no attribute 'get'")
        return real(cache, promos, ti, hz, sidecar=sidecar)
    EW.read_run = boom
    try:
        EW.main(run_args(sd, d, jp, lp, now))
        EW.main(run_args(sd, d, jp, lp, now))
    finally:
        EW.read_run = real
    log = open(os.path.join(sd, 'ALARMS.log')).read()
    zfile = os.path.exists(os.path.join(sd, 'effect', 'z-01', 'h24.json'))
    xfile = os.path.exists(os.path.join(sd, 'effect', 'x-01', 'h24.json'))
    ok = zfile and not xfile and log.count('NEW     effectwatch effectwatch:read-crash:x-01:h24') == 1
    ok &= 'STILL   effectwatch effectwatch:read-crash' not in log
    EW.main(run_args(sd, d, jp, lp, now))
    log = open(os.path.join(sd, 'ALARMS.log')).read()
    ok &= 'CLEARED effectwatch effectwatch:read-crash:x-01:h24' in log
    ok &= os.path.exists(os.path.join(sd, 'effect', 'x-01', 'h24.json'))
    # the whole run dies: header keeps its alarms + the crash line; paged once over two crashed runs
    st0 = json.load(open(os.path.join(sd, 'effect-fleet.json')))
    st0['alarms']['effect:old-01:h24'] = 'an earlier verdict alarm'
    EW.AL.write_json_atomic(os.path.join(sd, 'effect-fleet.json'), st0)
    realp = EW.promotions

    def dead(j):
        raise KeyError('ts')
    EW.promotions = dead
    died = 0
    try:
        for _ in range(2):
            try:
                EW.main(run_args(sd, d, jp, lp, now))
            except KeyError:
                died += 1
    finally:
        EW.promotions = realp
    st = json.load(open(os.path.join(sd, 'effect-fleet.json')))
    log = open(os.path.join(sd, 'ALARMS.log')).read()
    ok &= died == 2 and 'effectwatch:crash' in st['alarms'] and 'effect:old-01:h24' in st['alarms']
    ok &= st['summary'].startswith('!! EFFECTWATCH CRASHED') and log.count('NEW     effectwatch effectwatch:crash ') == 1
    ok &= EW.AL.tier_of('effectwatch', 'effectwatch:crash') == EW.AL.TIER_DIGEST      # why tier= is passed explicitly
    return bool(ok), (zfile, xfile, died, sorted(st['alarms']), log[-600:])


def t_read_effect(M):
    v = read(M, 0.4)
    t = v['targets'][0] if v.get('targets') else {}
    ok = v['verdict'] == 'EFFECT' and abs(t.get('baseline', {}).get('value', 0) - 2.0) < 0.15
    return ok, (v['verdict'], v.get('why'), t.get('baseline', {}).get('value'), t.get('post', {}).get('value'), t.get('tau'))


def t_read_null(M):
    v = read(M, 1.0)
    return v['verdict'] == 'NO-EFFECT', (v['verdict'], v.get('why'))


def t_read_worse(M):
    v = read(M, 2.0)
    return v['verdict'] == 'WORSE', (v['verdict'], v.get('why'))


def t_read_short(M):
    v = read(M, 0.8)      # -20 % against a claimed minimum of 30 %: moved, but under half? 20 >= 15 -> EFFECT; use 0.88
    v2 = read(M, 0.87)
    return v['verdict'] == 'EFFECT' and v2['verdict'] == 'NO-EFFECT' and 'less than half' in v2.get('why', ''), \
        (v['verdict'], v.get('why'), v2['verdict'], v2.get('why'))


def t_read_hole(M):
    v = read(M, 0.4, hole=P_TIME + dt.timedelta(hours=5))
    return v['verdict'] == 'UNREADABLE' and 'hole' in v.get('why', ''), (v['verdict'], v.get('why'))


def t_read_ab(M):
    v = read(M, 1.0, ab=True)
    t = v['targets'][0] if v.get('targets') else {}
    return v['verdict'] == 'NO-EFFECT' and abs(t.get('baseline', {}).get('value', 0) - 2.0) < 0.15, \
        (v['verdict'], v.get('why'), t.get('baseline', {}).get('value'))


def t_lineage(M):
    EW = M.ew
    promos = EW.promotions(journal())
    L = EW.Lineage(promos)
    ok = not L.fleet(SHA1, P_TIME - dt.timedelta(hours=1)) and L.fleet(SHA1, P_TIME + dt.timedelta(hours=1))
    ok &= not L.fleet(SHAC, P_TIME) and L.before(1)(SHA0, P_TIME) and not L.before(1)(SHA1, P_TIME + dt.timedelta(hours=2))
    p = [x for x in promos if x['run'] == 'x-01'][0]
    ok &= p['D'] == D_TIME and p['pools'] == ['board-c', 'hive-d']
    return bool(ok), p


def t_decide(M):
    EW = M.ew
    ok = EW.decide(0.5, 0.1, 0.3, 16, 14, 2, 'relative')[0] == 'EFFECT'
    ok &= EW.decide(0.5, 0.1, 0.3, 16, 9, 7, 'relative')[0] == 'UNREADABLE'          # pools split
    ok &= EW.decide(0.5, 0.1, 0.3, 6, 6, 0, 'relative')[0] == 'UNREADABLE'           # too few pools
    ok &= EW.decide(0.12, 0.1, 0.3, 16, 15, 1, 'relative')[0] == 'NO-EFFECT'         # under half the claim
    ok &= EW.decide(0.05, 0.1, 0.3, 16, 10, 6, 'relative')[0] == 'NO-EFFECT'
    ok &= EW.decide(-0.4, 0.1, 0.3, 16, 1, 15, 'relative')[0] == 'WORSE'
    ok &= abs(EW.delta(2.0, 1.0, 'relative') + EW.delta(1.0, 2.0, 'relative')) < 1e-12      # symmetric (log ratio)
    ok &= EW.delta(0.0, 1.0, 'relative') is None and EW.delta(1.0, 0.0, 'relative') is None
    ok &= abs(EW.min_log(0.3, 'decrease', 'relative') - 0.35667) < 1e-4 and EW.min_log(0.05, 'x', 'absolute') == 0.05
    g = lambda v, guard=False: {'verdict': v, 'guardrail': guard, 'metric': 'm', 'why': ''}
    ok &= EW.overall([g('EFFECT'), g('WORSE', True)])[0] == 'WORSE'
    ok &= EW.overall([g('EFFECT'), g('NO-EFFECT')])[0] == 'NO-EFFECT'
    ok &= EW.overall([g('UNREADABLE'), g('EFFECT')])[0] == 'EFFECT'
    ok &= EW.overall([g('UNREADABLE')])[0] == 'UNREADABLE'
    return bool(ok), None


def t_hole_retry(M):
    """cmd_run does not commit a read made UNREADABLE only by a cache hole until HOLE_GRACE after it fell due."""
    EW = M.ew
    d, sd = tempfile.mkdtemp(), tempfile.mkdtemp()
    fake_fleet(M, d, 0.4, hole=P_TIME + dt.timedelta(hours=5))
    jp = os.path.join(sd, 'journal.jsonl')
    with open(jp, 'w') as f:
        f.write('\n'.join(json.dumps(r) for r in journal()) + '\n')
    lp = os.path.join(sd, 'ledger.json')
    json.dump({'items': []}, open(lp, 'w'))
    tp = os.path.join(sd, 'targets.json')
    json.dump({'runs': SIDE}, open(tp, 'w'))
    EW.TARGETS, EW.TARGETS_REPO = tp, None
    args = lambda now: ['run', '--no-push', '--since', '2026-11-01T00:00:00Z', '--now', now, '--journal', jp, '--cache', d,
                        '--state-dir', sd, '--ledger', lp]
    EW.EC.FINAL_AFTER = dt.timedelta(hours=2)
    EW.main(args((P_TIME + dt.timedelta(hours=30)).strftime('%Y-%m-%dT%H:%M:%SZ')))
    f24 = os.path.join(sd, 'effect', 'x-01', 'h24.json')
    first = os.path.exists(f24)
    EW.main(args((P_TIME + dt.timedelta(hours=80)).strftime('%Y-%m-%dT%H:%M:%SZ')))
    later = json.load(open(f24)) if os.path.exists(f24) else {}
    st = json.load(open(os.path.join(sd, 'effect-fleet.json')))
    own = os.path.exists(os.path.join(sd, 'ALARMS.log'))          # the fixture's alarms land in its temp state dir
    return (not first) and later.get('verdict') == 'UNREADABLE' and 'promotion effects' in st['summary'] and own, \
        (first, later.get('verdict'), own)


def t_undeclared_reread(M):
    """An UNDECLARED read is never final: a stale undeclared h24.json (the pre-11-05 write-once) and a fresh undeclared
    read alarm; once the entry exists the next run reads the target, replaces the file and the alarm clears."""
    EW = M.ew
    d, sd = tempfile.mkdtemp(), tempfile.mkdtemp()
    fake_fleet(M, d, 0.4)
    jp = os.path.join(sd, 'journal.jsonl')
    with open(jp, 'w') as f:
        f.write('\n'.join(json.dumps(r) for r in journal()) + '\n')
    lp = os.path.join(sd, 'ledger.json')
    json.dump({'items': []}, open(lp, 'w'))
    tp = os.path.join(sd, 'targets.json')
    json.dump({'runs': {}}, open(tp, 'w'))
    EW.TARGETS, EW.TARGETS_REPO = tp, None
    EW.EC.FINAL_AFTER = dt.timedelta(hours=2)
    now = (P_TIME + dt.timedelta(hours=30)).strftime('%Y-%m-%dT%H:%M:%SZ')
    args = ['run', '--no-push', '--since', '2026-11-01T00:00:00Z', '--now', now, '--journal', jp, '--cache', d,
            '--state-dir', sd, '--ledger', lp]
    f24 = os.path.join(sd, 'effect', 'x-01', 'h24.json')
    os.makedirs(os.path.dirname(f24))
    json.dump({'run': 'x-01', 'horizon': 'h24', 'verdict': 'UNREADABLE', 'undeclared': True, 'targets': []}, open(f24, 'w'))
    EW.main(args)
    a1 = json.load(open(os.path.join(sd, 'effect-fleet.json')))['alarms']
    json.dump({'runs': SIDE}, open(tp, 'w'))
    EW.main(args)
    a2 = json.load(open(os.path.join(sd, 'effect-fleet.json')))['alarms']
    v = json.load(open(f24))
    ok = 'effect:x-01:undeclared' in a1 and 'effect:x-01:undeclared' not in a2 and not v.get('undeclared') \
        and v.get('verdict') == 'EFFECT'
    return ok, (sorted(a1), sorted(a2), v.get('verdict'))


def t_targets_main(M):
    """load_targets reads origin/main of the clone (fetched), not the installed copy; the copy only when no clone."""
    EW = M.ew
    root = tempfile.mkdtemp()
    g = lambda *a: subprocess.run(['git', *a], cwd=root, check=True, capture_output=True)
    g('init', '-q', '--bare', '-b', 'main', 'origin.git')
    g('clone', '-q', 'origin.git', 'w')
    g('clone', '-q', 'origin.git', 'reader')
    w = os.path.join(root, 'w')
    os.makedirs(os.path.join(w, 'config'))
    json.dump({'runs': {'new-01': {'none_reason': 'x'}}}, open(os.path.join(w, 'config', 'effect-targets.json'), 'w'))
    gw = lambda *a: subprocess.run(['git', '-C', w, '-c', 'user.name=t', '-c', 'user.email=t@t', *a], check=True,
                                   capture_output=True)
    gw('add', '-A'), gw('commit', '-qm', 'x'), gw('push', '-q', 'origin', 'HEAD:main')
    inst = os.path.join(root, 'installed.json')
    json.dump({'runs': {'old-01': {}}}, open(inst, 'w'))
    EW.TARGETS = inst
    main_ = EW.load_targets(repo=os.path.join(root, 'reader'))        # the reader clone predates the commit: fetch
    copy = EW.load_targets(repo=os.path.join(root, 'missing'))
    return 'new-01' in main_ and 'old-01' not in main_ and 'old-01' in copy, (sorted(main_), sorted(copy))


def t_vanished(M):
    v = read(M, 0.0)
    return v['verdict'] == 'UNREADABLE' and 'vanished' in v.get('why', ''), (v['verdict'], v.get('why'))


def t_joint(M):
    """y-01 declares the SAME metric and is promoted 5 h after x-01: 3 clean post hours < 8 -> UNREADABLE."""
    d = tempfile.mkdtemp()
    fake_fleet(M, d, 0.4)
    EW = M.ew
    j = journal()
    j[-1] = dict(j[-1], ts=(P_TIME + dt.timedelta(hours=5)).strftime('%Y-%m-%dT%H:%M:%SZ'))
    promos = EW.promotions(j)
    ti = [p['run'] for p in promos].index('x-01')
    side = dict(SIDE, **{'y-01': SIDE['x-01']})
    v = EW.read_run(EW.Cache(d), promos, ti, 'h24', sidecar=side)
    v2 = EW.read_run(EW.Cache(d), promos, ti, 'h24', sidecar=SIDE)        # y-01 another metric: no joint read
    v3 = EW.read_run(EW.Cache(d), promos, ti, 'h72', sidecar=side)        # y-01 BEFORE the +48..72 window: still joint
    return v['verdict'] == 'UNREADABLE' and 'joint with y-01' in v.get('why', '') and 'joint' not in v2.get('why', '') \
        and 'joint with y-01' in v3.get('why', ''), \
        (v['verdict'], v.get('why'), v2['verdict'], v2.get('why'))


def t_write_once(M):
    d = tempfile.mkdtemp()
    p = os.path.join(d, 'r', 'h24.json')
    return M.ew.write_once(p, {'a': 1}) and not M.ew.write_once(p, {'a': 2}) and json.load(open(p)) == {'a': 1}, None


def t_wiring(M):
    ah = open(os.path.join(REPO, 'scripts/lib/alarmhead.py')).read()
    mon = json.load(open(os.path.join(REPO, 'config/monitors.json')))
    ids = {m.get('id') for m in mon.get('monitors') or []}
    inst = open(os.path.join(REPO, 'scripts/host/install-effectwatch.sh')).read()
    ok = "('effect-fleet.json'," in ah and "('busy-fleet.json'," in ah and 'effectwatch' in ids
    ok &= 'host/effectcache.py build' in inst and 'host/effectwatch.py run' in inst
    sb = open(os.path.join(REPO, 'scripts/host/scoreboard.py')).read()
    ok &= 'busytime' in sb
    orphan = open(os.path.join(REPO, 'bots/test/nothing-important-is-orphaned.test.mjs')).read()
    ok &= all(f"'{p}'" in orphan for p in ('scripts/host/effectwatch.py', 'scripts/host/effectcache.py',
                                           'scripts/lib/busytime.py', 'scripts/lib/effectmetrics.py',
                                           'config/effect-targets.json', 'scripts/host/test_effectwatch.py'))
    return bool(ok), sorted(ids)[-5:]


TESTS = [('busy-time classes, END stamps, holes', t_busy), ('metrics: keys, ratio of sums, schema, sidecar', t_metrics),
         ('stream_rows reads the rotated generation', t_stream), ('lineage + journal', t_lineage),
         ('decide / overall table', t_decide), ('write-once verdicts', t_write_once),
         ('synthetic fleet: halved metric -> EFFECT', t_read_effect), ('synthetic fleet: unchanged -> NO-EFFECT', t_read_null),
         ('synthetic fleet: doubled -> WORSE', t_read_worse), ('synthetic fleet: short of claim -> NO-EFFECT', t_read_short),
         ('synthetic fleet: cache hole -> UNREADABLE', t_read_hole), ('synthetic fleet: model A/B excluded', t_read_ab),
         ('a hole-only UNREADABLE is retried, not committed', t_hole_retry),
         ('an UNDECLARED read is re-read until declared, then committed', t_undeclared_reread),
         ('effect targets come from origin/main of the clone', t_targets_main),
         ('a vanished target event is UNREADABLE, not EFFECT', t_vanished),
         ('a same-metric promotion inside the post window: joint -> UNREADABLE', t_joint), ('wiring', t_wiring),
         ('exposure: a string never filters or crashes; a dict filters by model', t_exposure),
         ('generic detail keys: tokens in order; hand names keep their regex', t_generic_keys),
         ('cache: wanted keys counted + recorded, recent uncounted hour rebuilt', t_cache_keys),
         ('an uncounted generic key is a cache hole, not a zero', t_uncounted_hole),
         ('registration check: never-seen names refused with the nearest', t_seen),
         ('validate command: exit 1 on a misname, 0 on a real name', t_validate_cmd),
         ('a correction in effect-targets wins over the registration', t_correction),
         ('a crash pages once, never stops the other reads, clears', t_crash),
         ('uncounted hours anywhere in a read: UNREADABLE, retried', t_rekey_whole_read)]

MUTANTS = [
    ('bt', "        return (t - d, t, 'productive')            # logEvent: stamped at the END",
     "        return (t, t + d, 'productive')", t_busy),
    ('bt', "        if b - a > gap and a < end and b > start:", "        if b - a > gap * 100 and a < end and b > start:", t_busy),
    ('bt', "CLASSES = ('productive', 'walking', 'llm_wait',", "CLASSES = ('walking', 'productive', 'llm_wait',", t_busy),
    ('em', "        num += a\n", "        num += (a / b) if b else 0\n", t_metrics),
    ('em', "    if not tg and not effect.get('none_reason'):", "    if False:", t_metrics),
    ('em', "    return 'gather_log' if b.endswith('_log') else None", "    return None", t_metrics),
    ('tm', "    return rot + ([base] if os.path.exists(base) else [])", "    return [base] if os.path.exists(base) else []", t_stream),
    ('tm', "                    if since <= t < until:\n                        yield t, d",
     "                    if True:\n                        yield t, d", t_stream),
    ('ew', "        return P is not None and h >= hceil(P)", "        return P is not None", t_read_effect),
    ('ew', "        if ag / el < POOL_AGREE:\n            return 'UNREADABLE', f'pools split: {ag}/{el} agree",
     "        if False:\n            return 'UNREADABLE', f'pools split: {ag}/{el} agree", t_decide),
    ('ew', "        if half_min and s < half_min:", "        if False:", t_read_short),
    ('ew', "                elif n >= 3 and maj is not None and c['llm']['model'].get(maj, 0) / n < 0.5:",
     "                elif False:", t_read_ab),
    ('ew', "    if any(r['verdict'] == 'WORSE' for r in tg) or any(r['verdict'] == 'WORSE' for r in gd):",
     "    if any(r['verdict'] == 'WORSE' for r in tg):", t_decide),
    ('ew', "        if hd is None or hd['controls'].get('bots_with_rows', 0) < hd['controls'].get('bot_dirs', 0) / 2:",
     "        if hd is None and False:", t_read_hole),
    ('ew', "    tau = max(2 * statistics.stdev(pl), FLOOR[scale][mb['kind']])", "    tau = 0.0", t_read_null),
    ('em', "    if not is_model_call(row):\n        c['orders'] += 1", "    if False:\n        c['orders'] += 1", t_metrics),
    ('ew', "            if is_hole_only(v) and now < end", "            if False and now < end", t_hole_retry),
    ('ew', "    return None if base <= 0 or post <= 0 else math.log(post / base)", "    return None if base == 0 else (post - base) / base", t_decide),
    ('ew', "    if mp['num'] == 0 and mb['num'] > 0:          # any kind (Codex review r1 BLOCKER 2)", "    if False:", t_vanished),
    ('ew', "        if not (q['P'] < ph[-1] + H1):", "        if not (ph[0] <= q['P'] < ph[-1] + H1):", t_joint),
    ('ew', "                if not old.get('undeclared'):", "                if True:", t_undeclared_reread),
    ('ec', "    if path is None and repo:", "    if False:", t_targets_main),
    ('em', "    if isinstance(expo, dict):\n        m = expo.get('model')", "    if True:\n        m = expo.get('model')", t_exposure),
    ('em', "        return m if isinstance(m, str) and m else None", "        return None", t_exposure),
    ('ew', "    em = EM.exposure_model(expo)", "    em = None", t_exposure),
    ('em', "    return all(any(t == x for x in it) for t in tokens)", "    return all(t in detail_tokens(detail) for t in tokens)",
     t_generic_keys),
    ('em', "    if name not in HAND_NAMES:\n        for k in wanted:", "    if True:\n        for k in wanted:", t_generic_keys),
    ('ec', "        miss = set(wanted) - set(hd.get('dk_keys') or [])", "        miss = set()", t_cache_keys),
    ('ec', "           'dk_keys': list(data.get('dk_keys') or []), 'vocab': data.get('vocab') or {}}", "           }", t_cache_keys),
    ('ec', "            for e in reg_effects(reg):", "            for e in [reg.get('effect') or {}]:", t_cache_keys),
    ('ew', "        if need and not set(need) <= set(hd.get('dk_keys') or []):", "        if False:", t_uncounted_hole),
    ('em', "                if pk in p and p[pk] not in names:", "                if False:", t_seen),
    ('em', "                if f'{p[\"name\"]}|{p.get(\"fail_class\")}' not in ix['fc']:", "                if False:", t_seen),
    ('em', "                    miss = [x for x in toks if x not in voc]", "                    miss = []", t_seen),
    ('em', "    if ix['hours'] == 0 or ix['rows'] == 0:", "    if False:", t_seen),
    ('ew', "    if bad:\n        print('INVALID:')", "    if False:\n        print('INVALID:')", t_validate_cmd),
    ('ew', "    if isinstance(ent, dict) and ent.get('correction'):", "    if False:", t_correction),
    ('ew', "            except Exception as e:      # noqa: BLE001 -- one bad read never stops the others (11-07)",
     "            except ZeroDivisionError as e:", t_crash),
    ('ew', "    return AL.raise_alarms('effectwatch', active, now, os.path.join(sd, 'effect.crashstate.json'),",
     "    return AL.raise_alarms('effectwatch', active, now, os.path.join(sd, 'effect.pushstate.json'),", t_crash),
    ('ew', "            on_crash(a, e)\n", "            pass\n", t_crash),
    ('ew', "    al = dict(old.get('alarms') or {})", "    al = {}", t_crash),
    ('ew', "    if v.get('rekey'):\n        return True", "    if False:\n        return True", t_rekey_whole_read),
    ('ew', "    if unc:\n        # Codex review r1 BLOCKERS 1-2", "    if False:\n        # Codex review r1 BLOCKERS 1-2", t_rekey_whole_read),
    ('ew', "            res['uncounted'] += len(k1['uncounted']) + len(k2['uncounted'])", "            pass", t_rekey_whole_read),
    ('em', "                elif kn in HAND_NAMES or ix['counted_hours'].get(key, 0) >= ix['hours']:",
     "                elif kn in HAND_NAMES or key in ix['counted']:", t_seen),
    ('em', "    return kind == 'target' and t.get('scale') == 'absolute' and t.get('direction') == 'increase'", "    return False", t_seen),
    ('em', "                for st in ([p['status']] if not isinstance(p['status'], list) else p['status']):",
     "                for st in ([p['status']] if isinstance(p['status'], str) else p['status']):", t_seen),
    ('ew', "    except CannotCheck as e:\n        print(f'CANNOT CHECK: {e}')\n        raise SystemExit(EXIT_CANNOT)",
     "    except CannotCheck as e:\n        print(f'CANNOT CHECK: {e}')\n        raise SystemExit(1)", t_validate_cmd),
    ('ew', "        raise SystemExit(EXIT_ERROR)", "        raise", t_validate_cmd),
    ('ew', "    elif 'targets' in reg or 'none_reason' in reg:", "    elif True:", t_validate_cmd),
]


def main():
    live = os.path.expanduser('~/digest/ALARMS.log')
    live0 = os.path.getsize(live) if os.path.exists(live) else None
    M = mods()
    for name, fn in TESTS:
        try:
            ok, info = fn(M)
        except Exception as e:      # noqa: BLE001
            ok, info = False, f'{type(e).__name__}: {e}'
        check(name, ok, info)
    killed = 0
    for i, (which, old, new, fn) in enumerate(MUTANTS):
        try:
            Mm = mods(**{which: (old, new)})
        except AssertionError as e:
            check(f'mutant {i} anchor', False, e)
            continue
        try:
            ok, _ = fn(Mm)
        except Exception:           # noqa: BLE001
            ok = False
        if ok:
            print(f'  SURVIVED mutant {i} ({which}: {new.strip()[:70]})')
            FAILS.append(f'mutant {i}')
        else:
            killed += 1
    mods()
    print(f'mutants killed {killed}/{len(MUTANTS)}')
    live1 = os.path.getsize(live) if os.path.exists(live) else None
    check('the live ~/digest/ALARMS.log is untouched by the fixtures', live0 == live1, (live0, live1))
    print(f'{len(TESTS) - len([f for f in FAILS if not f.startswith("mutant")])}/{len(TESTS)} passed')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
