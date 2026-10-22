#!/usr/bin/env python3
"""Behaviour tests for frontiercensus.py (E0), its publisher frontierpublish.py and its alarm check-frontiercensus.py,
plus MUTANTS that must be killed by the case they were written against.

    python3 -B scripts/host/test_frontiercensus.py      (exit 1 on any failure; needs no ES and no network)

The fixture world and its hand-worked answers live in frontiercensus.selftest() (every live mode runs it first). This
file adds the boundary cases the fixture does not reach, the orchestration (run_tick with ES faked, es_fold_hour on a
fake ES, the publisher on temp dirs), then mutates each decision. A mutant must make the suite fail ON ITS INTENDED
CASE (the `want` substring must be among the failures; a crash counts only when `want` is 'CRASH'), and its anchor
must occur EXACTLY ONCE in the source with comments and docstrings removed structurally (tokenize + ast), so an anchor
can never match the explanation of the code (CLAUDE.md).
"""
import argparse
import ast
import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import tokenize

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
FILES = {'census': 'frontiercensus.py', 'checker': 'check-frontiercensus.py', 'publisher': 'frontierpublish.py'}


def load(mutated=None):
    """The census (and its checker and publisher) loaded from a temp copy of the three files, one of them replaced by
    `mutated` = (which, text). The census resolves its siblings from its own directory, so a mutated publisher or
    checker is the one it uses."""
    td = tempfile.mkdtemp(prefix='_fc_')
    try:
        for which, f in FILES.items():
            src = open(os.path.join(HERE, f)).read()
            if mutated and mutated[0] == which:
                src = mutated[1]
            with open(os.path.join(td, f), 'w') as fh:
                fh.write(src)
        if os.path.join(HERE, '..') not in sys.path:
            sys.path.insert(0, os.path.join(HERE, '..'))       # lib.estelemetry, for ZeroLooksWrong
        spec = importlib.util.spec_from_file_location(f'fc_{os.path.basename(td)}', os.path.join(td, FILES['census']))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        m._TESTDIR = td
        return m
    except BaseException:
        shutil.rmtree(td, ignore_errors=True)
        raise


class FakeEv:
    """Enough of EsEvents for es_fold_hour: the two aggregations answered from rows (fake_q1 / fake_q2), the row pull,
    the stub count and the home-start lookup (none)."""
    def __init__(self, m, rows, events, drop_q2=0):
        self.m, self.rows_, self.events, self.drop_q2 = m, rows, events, drop_q2

    def _query(self, **kw):
        return {'bool': {'filter': []}}

    def _search(self, body):
        if body.get('size') == 1:
            return {'hits': {'hits': []}}
        aggs = body['aggs']['b']['aggs']
        pos = [r for r in self.rows_ if r.get('x') is not None]
        if 'x' in aggs:
            return dict(self.m.fake_q1(pos), hits={'total': {'value': len(pos)}})
        return dict(self.m.fake_q2(pos), hits={'total': {'value': len(pos) - self.drop_q2}})

    def rows(self, **kw):
        return iter(self.events)

    def _count(self, q):
        return 0


def fold_with_fake_es(m, rows, events, counts, drop_q2=0):
    old = (m._ev, m.es_hour_counts, m.es_sample)
    m._ev = lambda a, b: FakeEv(m, rows, events, drop_q2)
    m.es_hour_counts = lambda a, b: {a: counts}
    m.es_sample = lambda t: {'at': m.iso(t), 'rows': []}
    try:
        return m.es_fold_hour(m.FX_H0, {'fx': m.FX_HOME})
    finally:
        m._ev, m.es_hour_counts, m.es_sample = old


def fake_tick(m, state, out, budget=999.0, unstable_hours=(), parity_ok=True, hours=6, nosample_hours=()):
    """run_tick with ES replaced: every hour of the last `hours` holds one bot per folded pool standing at home."""
    now = int(time.time() * 1000)
    settled = m.floor_hour(now - m.SETTLE_MS)
    H = [settled - k * m.HOUR_MS for k in range(hours, 0, -1)]

    def counts(since, until):
        return {h: [100, 0] for h in H}

    def fold(h0, homes):
        rec = {'hour': m.hour_key(h0), 'h0': h0, 'folded_at': f'{h0}.{len(homes)}', 'schema': m.FOLD_SCHEMA,
               'es_counts': [100, 0], 'homes': {p: list(h) for p, h in homes.items()}, 'void': False,
               'regions': {p: {m.rkey(*m.region_of(h[0], h[2])): [60, 60, h0, h0 + 1, 0, 0, 0]} for p, h in homes.items()},
               'presence': {p: {'0-48|surface': 60} for p in homes}, 'bots': {f'{p}-A': [p, 100, 60] for p in homes},
               'gather': {}, 'mine': {}, 'deaths': [], 'home': [], 'scans': [], 'turnbacks': [],
               'sample': {'at': m.iso(h0 + m.HOUR_MS),
                          'rows': [[f'{p}-A', p, h[0], h[1], h[2], 10, True, True, 20] for p, h in homes.items()]}}
        if h0 in unstable_hours:
            rec.update(unstable=True, es_counts=None)
        if h0 in nosample_hours:
            rec.pop('sample')
        return rec
    saved = (m.es_hour_counts, m.es_fold_hour, m.maybe_parity, m.last_parity)
    m.es_hour_counts, m.es_fold_hour = counts, fold
    par = {'ok': parity_ok, 'at': m.iso(now), 'hour': 'x', 'diffs': 0 if parity_ok else 3, 'raw_positioned_rows': 9}
    m.maybe_parity = lambda *a, **k: par
    m.last_parity = lambda out_: par
    try:
        res = m.run_tick(argparse.Namespace(state_dir=state, out_dir=out, budget_s=budget, pace_s=0))
    finally:
        m.es_hour_counts, m.es_fold_hour, m.maybe_parity, m.last_parity = saved
    bundle = json.load(open(os.path.join(out, 'publish', 'bundle.json')))
    return res, bundle


def mkpool(td, d, *files):
    os.makedirs(os.path.join(td, d), exist_ok=True)
    for f in files:
        open(os.path.join(td, d, f), 'w').close()


def cases(m):
    """-> [(name, ok)]."""
    out = []
    c = lambda name, ok: out.append((name, bool(ok)))     # noqa: E731
    chk, pub = m.load_checker(), m.PUB
    # ---- geometry, bands, row helpers
    c('band: 47.9 -> 0-48', m.band_of(47.9) == '0-48')
    c('band: 48 -> 48-100 (lo <= d < hi, as section 1.2)', m.band_of(48) == '48-100')
    c('band: 300 -> 300+', m.band_of(300) == '300+')
    c('depth: dy -8 is surface, -8.1 deep', (m.depth_of(56, 64), m.depth_of(55.9, 64)) == ('surface', 'deep'))
    c('region: floor for negatives (-0.1 -> -1, 63.9 -> 0, 64 -> 1)',
      (m.region_of(-0.1, 0), m.region_of(63.9, 0), m.region_of(64, 0)) == ((-1, 0), (0, 0), (1, 0)))
    c('rect_dist: 0 inside, 32 exactly at 32 out', (m.rect_dist(10, 10, 0, 0), m.rect_dist(96, 10, 0, 0)) == (0, 32))
    t = 10 ** 12
    c('unreached: one no_route + one deadline on one region is NOT unreached',
      m.unreached([[t, 'p', 'b', 10, 10, 'no_route'], [t, 'p', 'b', 20, 20, 'deadline']], t) == {})
    c('unreached: two no_route expire after 7 days',
      m.unreached([[t, 'p', 'b', 10, 10, 'no_route'], [t, 'p', 'b', 20, 20, 'no_route']], t + m.UNREACHED_MS + 1) == {})
    c('pick: 40% left counts, 39% does not',
      (m.good_pick({'iron_pickaxe': [{'used': 150, 'max': 250}]}), m.good_pick({'iron_pickaxe': [{'used': 153, 'max': 250}]}))
      == (True, False))
    c('slots: 64 cobble = 1, 65 = 2, eggs by 16, tools one each',
      m.slots({'cobblestone': 65, 'egg': 17, 'iron_pickaxe': 2}) == 2 + 2 + 2)
    c('target family: oak_log log, deepslate_iron_ore ore, cobblestone none',
      (m.target_family({'block': 'oak_log'}), m.target_family({'block': 'deepslate_iron_ore'}),
       m.target_family({'block': 'cobblestone'})) == ('log', 'ore', None))
    c('items_got: ore family only (raw_iron, coal; not cobbled_deepslate)',
      m.items_got({'raw_iron': 2, 'coal': 1, 'cobbled_deepslate': 5}, 'ore') == 3)
    c('alignment: home at the origin has no bearing', m.alignment((5, 64, 5), 100, 100) is None)
    g = [20, 20, 0, 0, 20, 9, 9]
    c('water: 9 of 20 wet and 11 dry -> land; 10 wet -> water',
      (m.water_label(g, None)[0], m.water_label([20, 20, 0, 0, 20, 10, 10], None)[0]) == ('perceived_land', 'perceived_water'))
    c('water: a scan beats perception', m.water_label([20, 20, 0, 0, 20, 20, 20], (1, 9))[0] == 'scanned_land')
    a = {'t': 5, 'kind': '_path_reset', 'x': 1.0, 'z': 1.0}
    b = {'t': 5, 'kind': 'goto', 'x': 90.0, 'z': 1.0}
    c('newest row tie: at the same ms an event row (instant) beats a skill row (END snapshot), either order',
      (m.newer(a, b), m.newer(b, a), m.newer(dict(b, t=6), a)) == (True, False, True))
    pres = m.fold_rows([dict(b, bot='q', pool='fx', y=64), dict(a, bot='q', pool='fx', y=64)], {'fx': (0, 64, 0)})['presence']
    c('presence: the tie resolves to the event row (0-48), not the skill row (48-100), in either stream order',
      pres == {'fx': {'0-48|surface': 1}} and m.fold_rows([dict(a, bot='q', pool='fx', y=64), dict(b, bot='q', pool='fx', y=64)],
                                                          {'fx': (0, 64, 0)})['presence'] == pres)
    np = m.fold_rows([{'t': 5, 'bot': 'q', 'pool': None, 'x': 1.0, 'y': 64, 'z': 1.0},
                      {'t': 6, 'bot': 'q', 'pool': 'fx', 'x': 1.0, 'y': 64, 'z': 1.0}], {'fx': (0, 64, 0)})
    c('fold: a first row without a pool does not pin the bot to no pool (Claude r3 P3-2)', np['bots']['q'][0] == 'fx')
    # ---- the fold planner (incremental reads)
    H = 10 ** 12 - 10 ** 12 % m.HOUR_MS
    S = m.FOLD_SCHEMA
    rec = lambda n, fa, pf, homes=None: {'es_counts': n, 'homes': homes or {'p': [1, 2, 3]}, 'schema': S,  # noqa: E731
                                         'folded_at': fa, 'prev_es_counts': pf, 'sample': {'at': 'x'}}
    have = {H: rec([5, 1], 'f0', None), H + m.HOUR_MS: rec([5, 1], 'f1', [5, 1]),
            H + 2 * m.HOUR_MS: rec([7, 0], 'f2', [5, 1])}
    counts = {H: [5, 2], H + m.HOUR_MS: [5, 1], H + 2 * m.HOUR_MS: [7, 0], H + 3 * m.HOUR_MS: [0, 0]}
    plan = dict(m.plan_folds(counts, have, {'p': [1, 2, 3]}))
    c('plan: a late unpositioned event row (event count 1 -> 2) refolds the hour and the next one; a new void hour is folded',
      (sorted(plan) == [H, H + m.HOUR_MS, H + 3 * m.HOUR_MS], plan.get(H + m.HOUR_MS), plan.get(H + 3 * m.HOUR_MS))
      == (True, 'after a refold', 'new'))
    c('plan: nothing changed -> nothing refolded',
      m.plan_folds({H: [5, 1], H + m.HOUR_MS: [5, 1]}, {H: have[H], H + m.HOUR_MS: have[H + m.HOUR_MS]}, {'p': [1, 2, 3]}) == [])
    cut = {H: rec([5, 2], 'f0-new', None), H + m.HOUR_MS: rec([5, 1], 'f1', [5, 1])}    # H refolded, then the tick ended
    c('plan: a tick that ended between a refold and the hour after it still refolds that hour next tick (Codex r2 P1)',
      m.plan_folds({H: [5, 2], H + m.HOUR_MS: [5, 1]}, cut, {'p': [1, 2, 3]}) == [(H + m.HOUR_MS, 'after a refold')])
    after = {H: rec([5, 2], 'f0-new', None), H + m.HOUR_MS: rec([5, 1], 'f1-new', [5, 2]),
             H + 2 * m.HOUR_MS: rec([7, 0], 'f2', [5, 1])}
    c('plan: a refold that changed nothing upstream does not cascade down the window (Claude r3 P3-1)',
      m.plan_folds({H: [5, 2], H + m.HOUR_MS: [5, 1], H + 2 * m.HOUR_MS: [7, 0]}, after, {'p': [1, 2, 3]}) == [])
    c('plan: an hour folded by another fold schema is refolded',
      [w.split(' ')[0] for _, w in m.plan_folds({H: [5, 1]}, {H: dict(have[H], schema=S - 1)}, {'p': [1, 2, 3]})] == ['schema'])
    c('plan: a home move refolds the hour', len(m.plan_folds({H: [5, 1]}, {H: have[H]}, {'p': [9, 9, 9]})) == 1)
    c('plan: an unstable hour (counts None) is refolded', len(m.plan_folds({H: [5, 1]}, {H: dict(have[H], es_counts=None)},
                                                                           {'p': [1, 2, 3]})) == 1)
    have1 = {H: rec([5, 1], 'f0', None, {'a': [1, 2, 3], 'z': [0, 0, 0]})}
    c('plan: a pool absent now (dropped or retired) refolds nothing',
      m.plan_folds({H: [5, 1]}, have1, {'a': [1, 2, 3]}) == [])
    c('plan: a pool the record lacks (newly folded) refolds the hour',
      [w.split(' ')[0] for _, w in m.plan_folds({H: [5, 1]}, have1, {'a': [1, 2, 3], 'b': [4, 5, 6]})] == ['homes'])
    # ---- the publisher: refusals, then real writes on temp dirs
    now_ms = m.ms_of('2026-10-22T12:00:00Z')
    good = {'pool': 'p', 'home': [1, 2, 3], 'generated_at': '2026-10-22T11:58:00Z', 'stale_after': '2026-10-22T13:00:00Z',
            'instrument_ok': True, 'measured_until': '2026-10-22T10:00:00Z', 'digest': 'd1'}
    c('publish: a good staged frontier is published', pub.publish_refusal(good, 'p', 'frontier-1_2_3', now_ms) is None)
    c('publish: refused past stale_after (ES blind: measured data too old)',
      'VOID' in (pub.publish_refusal(dict(good, stale_after='2026-10-22T11:00:00Z'), 'p', 'frontier-1_2_3', now_ms) or ''))
    c('publish: refused on an instrument failure',
      'instrument' in (pub.publish_refusal(dict(good, instrument_ok=False), 'p', 'frontier-1_2_3', now_ms) or ''))
    c('publish: refused when the census stopped staging (staged 30 min ago)',
      'stale' in (pub.publish_refusal(dict(good, generated_at='2026-10-22T11:30:00Z'), 'p', 'frontier-1_2_3', now_ms) or ''))
    c('publish: refused for another town\'s file', pub.publish_refusal(good, 'q', 'frontier-1_2_3', now_ms) is not None)
    c('publish: a per-bot, showcase or path-like pool name is never a town',
      all(pub.publish_refusal(dict(good, pool=p), p, 'frontier-1_2_3', now_ms) for p in
          ('self-isolated-a-Alpha', 'showcase', '../p', 'p/x', '', None)))
    c('publish: a malformed doc is a refusal, never a crash',
      'malformed' in (pub.publish_refusal({'pool': 'p', 'home': [1, 2, 3]}, 'p', 'frontier-1_2_3', now_ms) or ''))
    warm = {'complete': True, 'complete_at': '2026-10-22T00:00:00Z'}
    bnd = {'schema': 1, 'generated_at': '2026-10-22T11:58:00Z', 'warmup': warm,
           'entries': [{'pool': 'p', 'key': 'frontier-1_2_3', 'doc': good}]}
    c('bundle: refused when stale, not warm, warm-up in the future, or not a bundle',
      (pub.bundle_refusal(bnd, now_ms), bool(pub.bundle_refusal(dict(bnd, generated_at='2026-10-22T11:30:00Z'), now_ms)),
       'warm-up' in pub.bundle_refusal(dict(bnd, warmup={'complete': False}), now_ms),
       'warm-up' in pub.bundle_refusal(dict(bnd, warmup={'complete': True, 'complete_at': '2026-10-23T00:00:00Z'}), now_ms),
       bool(pub.bundle_refusal({'entries': 'x'}, now_ms))) == (None, True, True, True, True))
    with tempfile.TemporaryDirectory() as td:
        g1 = pub.create_gen(td, 'frontier-1_2_3', {'a': 1})
        g2 = pub.create_gen(td, 'frontier-1_2_3', {'a': 2})
        n, cur = pub.read_gen(td, 'frontier-1_2_3')
        c('generations: g1, g2, the reader takes the highest', (g1, g2, n, cur) == (1, 2, 2, {'a': 2}))
        with open(os.path.join(td, 'frontier-1_2_3.g3.json'), 'w') as fh:
            fh.write('{"other": 1}')
        lost = pub.create_gen(td, 'frontier-1_2_3', {'a': 3}, n=3)          # a racing writer that read N = 2
        c('generations: a number another writer took is never overwritten (link fails -> None)',
          (lost, json.load(open(os.path.join(td, 'frontier-1_2_3.g3.json')))) == (None, {'other': 1}))
        c('generations: the next writer takes g4', pub.create_gen(td, 'frontier-1_2_3', {'a': 4}) == 4)
        for _ in range(pub.KEEP_GENS + 2):
            pub.create_gen(td, 'frontier-1_2_3', {'a': 0})
        open(os.path.join(td, 'other.g9.json'), 'w').write('{}')
        left = sorted(int(f.split('.g')[1].split('.')[0]) for f in os.listdir(td) if f.startswith('frontier-1_2_3.g'))
        c('generations: pruned to the newest KEEP_GENS, no tmp left, another key never touched',
          (len(left), left[-1], any(f.endswith('.tmp') for f in os.listdir(td)), os.path.exists(os.path.join(td, 'other.g9.json')))
          == (pub.KEEP_GENS, 4 + pub.KEEP_GENS + 2, False, True))
    with tempfile.TemporaryDirectory() as td:
        for p, files in (('a', ['town-chest-1_2_3.cobble.jsonl', 'junkwell-site-1_2_3.g1.json']),
                         ('b', ['town-chest-1_2_3.cobble.jsonl', 'composter-site-4_5_6.g1.json']), ('c', [])):
            mkpool(td, f'_pool-{p}', *files)
        H3, P3 = m.pool_homes(td, m.pool_roster(td))
        c('homes: sources agree -> the home; disagree -> left out; none -> left out',
          (H3, sorted(P3)) == ({'a': (1, 2, 3)}, ['b', 'c']))
    me = os.geteuid()
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, '_pool-p'))
        r1 = pub.publish(bnd, td, now_ms, euid=me)
        r2 = pub.publish(bnd, td, now_ms, euid=me)
        c('publisher: g1 published; the same content again is unchanged, not g2',
          (r1.get('gens'), r2.get('published'), r2.get('unchanged'), sorted(os.listdir(os.path.join(td, '_pool-p'))))
          == (['p:g1'], 0, 1, ['frontier-1_2_3.g1.json']))
        r3 = pub.publish(dict(bnd, entries=[{'pool': 'q', 'key': 'frontier-1_2_3', 'doc': dict(good, pool='q')}]), td,
                         now_ms, euid=me)
        c('publisher: a town with no _pool dir is refused and no directory is ever created',
          (r3.get('published'), 'no usable pool dir' in ' '.join(r3.get('refused') or []),
           os.path.exists(os.path.join(td, '_pool-q'))) == (0, True, False))
        c('publisher: refuses to run as root', pub.publish(bnd, td, now_ms, euid=0)['status'] == 'refused')
        r4 = pub.publish(dict(bnd, entries=[{'pool': 'p', 'key': 'frontier-1_2_3', 'doc': dict(good, digest='d2')}]), td,
                         now_ms, euid=me + 1)
        c('publisher: a pool dir not owned by the publishing user is refused',
          (r4.get('published'), 'not owned' in ' '.join(r4.get('refused') or [])) == (0, True))
        cold = pub.publish(dict(bnd, warmup={'complete': False}, entries=bnd['entries'] + [
            {'pool': 'nodir', 'key': 'frontier-1_2_3', 'doc': good}]), td, now_ms, euid=me)
        c('publisher: a bundle that is not warm publishes nothing, but rehearses the real path (Claude r3 P2-3)',
          (cold.get('status'), cold.get('published'), cold.get('usable'), sorted(cold.get('unusable') or {}),
           len(os.listdir(os.path.join(td, '_pool-p'))))
          == ('warmup', 0, 1, ['nodir'], 1))
        c('publisher: the rehearsal names a pool dir the publishing user does not own',
          'not owned' in str(pub.publish(dict(bnd, warmup={'complete': False}), td, now_ms, euid=me + 1).get('unusable')))
        real = os.path.join(td, 'elsewhere')
        os.makedirs(real)
        os.symlink(real, os.path.join(td, '_pool-s'))
        r5 = pub.publish(dict(bnd, entries=[{'pool': 's', 'key': 'frontier-1_2_3', 'doc': dict(good, pool='s')}]), td,
                         now_ms, euid=me)
        c('publisher: a _pool dir that is a symlink is refused and nothing lands behind it',
          (r5.get('published'), os.listdir(real)) == (0, []))
        src = open(os.path.join(m._TESTDIR, 'frontierpublish.py'), 'rb').read()
        boot = next(ln.split('=', 1)[1].strip()[1:-1] for ln in open(os.path.join(HERE, 'frontiercensus-cron.sh'))
                    if ln.startswith('BOOT='))
        fresh = dict(bnd, generated_at=m.iso(int(time.time() * 1000)), warmup={'complete': True, 'complete_at': '2026-10-01T00:00:00Z'},
                     entries=[{'pool': 'p', 'key': 'frontier-1_2_3', 'doc': dict(good, generated_at=m.iso(int(time.time() * 1000)),
                                                                                  stale_after='2099-01-01T00:00:00Z', digest='boot')}])
        payload = str(len(src)).encode() + b'\n' + src + json.dumps(fresh).encode()
        pr = subprocess.run([sys.executable, '-I', '-B', '-c', boot, '--state-dir', td], input=payload, capture_output=True)
        out_lines = pr.stdout.decode().strip().splitlines()
        line = json.loads(out_lines[-1]) if out_lines else {}
        c('publisher: run the cron way (BOOT: count, program, bundle on one stdin) publishes and prints ONE json line',
          (len(out_lines), line.get('mode'), line.get('gens')) == (1, 'publish', ['p:g2']))
    # ---- hazards unreadable -> nothing offered
    recs = m.fixture_records()
    cov = {'uncovered_days': [], 'days': {'2026-10-10': {'covered': True}}}
    F = m.frontier('fx', m.FX_HOME, recs, cov, m.FX_H0 + 3 * m.HOUR_MS, m.FX_H0 + 3 * m.HOUR_MS, [], sites_error='OSError')
    c('frontier: an unreadable world-facts file withholds every candidate and says why',
      (F['counts']['candidates'], F['hazard_sources_ok'], bool(F['ranking_withheld'])) == (0, False, True))
    # ---- a VOID sample is not zero eligibility
    void = [dict(r, sample={'at': r['sample']['at'], 'rows': []}) if n == 1 else r for n, r in enumerate(recs)]
    B = m.baselines(void, ['fx'], {'fx': m.FX_HOME}, m.FX_H0, m.FX_H0 + 3 * m.HOUR_MS)['bag']
    c('bag: an empty sample is a VOID town-hour, not a zero-eligible one (3 hours -> 2 counted, 1 void)',
      (B['town_hours'], B['town_hours_void'], B['town_hours_with_eligible']) == (2, 1, 1))
    two = [dict(r, sample={'at': r['sample']['at'], 'rows': r['sample']['rows']}) for r in recs]
    B2 = m.baselines(two, ['fx', 'gx'], {'fx': m.FX_HOME, 'gx': (0, 64, 0)}, m.FX_H0, m.FX_H0 + 3 * m.HOUR_MS)['bag']
    c('bag: a town with no bot in a sample is VOID for that hour, not zero', (B2['town_hours'], B2['town_hours_void']) == (3, 3))
    vb = m.baselines([dict(recs[0], void=True)] + recs[1:], ['fx'], {'fx': m.FX_HOME}, m.FX_H0, m.FX_H0 + 4 * m.HOUR_MS)
    c('baselines: they say how many of their hours were VOID and how many were expected',
      (vb['hours'], vb['void_hours'], vb['hours_expected']) == (3, 1, 4))
    c('render: an undefined rate prints "-", never 0', m.fm(None, '6.1f') == '-' and m.fm(0.0, '.1f') == '0.0')
    # ---- the checker
    now_s = m.ms_of('2026-10-20T12:00:00Z') / 1000
    tick = lambda at, **kw: json.dumps(dict({'mode': 'tick', 'at': at, 'status': 'idle',             # noqa: E731
                                             'newest_measured_hour_end': '2026-10-20T11:00:00Z', 'towns': 12,
                                             'last_publish': {'at': '2026-10-20T11:58:30Z', 'status': 'warmup'}}, **kw))
    c('checker: a tick 40 min old is stale', any(x.startswith('FrontierStale') for x in chk.assess([tick('2026-10-20T11:20:00Z')], now_s)[0]))
    c('checker: a healthy idle tick is quiet', chk.assess([tick('2026-10-20T11:58:00Z', last_publish={
        'at': '2026-10-20T11:58:30Z', 'status': 'warmup'})], now_s)[0] == [])
    c('checker: a town left out alarms', any(x.startswith('FrontierTownMissing') for x in chk.assess(
        [tick('2026-10-20T11:58:00Z', home_problems={'q': 'conflicting homes'}, towns=11)], now_s)[0]))
    c('checker: fewer towns than earlier today alarms', any(x.startswith('FrontierTownMissing') for x in chk.assess(
        [tick('2026-10-20T11:00:00Z'), tick('2026-10-20T11:58:00Z', towns=11)], now_s)[0]))
    c('checker: unreadable hazards alarm', any(x.startswith('FrontierHazardUnread') for x in chk.assess(
        [tick('2026-10-20T11:58:00Z', site_errors={'q': 'OSError'})], now_s)[0]))
    c('checker: a void tick alarms even when fresh', any(x.startswith('FrontierVoid') for x in chk.assess(
        [tick('2026-10-20T11:59:00Z', status='void')], now_s)[0]))
    W = {'complete': True, 'complete_at': '2026-10-19T00:00:00Z'}
    okp = {'at': '2026-10-20T11:58:30Z', 'status': 'ok'}
    c('checker: warm, staging and publishing -> quiet',
      chk.assess([tick('2026-10-20T11:58:00Z', warmup=W, last_staged_at='2026-10-20T11:58:00Z', last_publish=okp)], now_s)[0]
      == [])
    c('checker: warm but nothing staged for 30 min alarms (Claude r2 P2-3)', any(x.startswith('FrontierNotStaging') for x in chk.assess(
        [tick('2026-10-20T11:58:00Z', status='behind', warmup=W, last_staged_at='2026-10-20T11:00:00Z', last_publish=okp)],
        now_s)[0]))
    c('checker: warm but the publisher silent, stale or not ok alarms',
      all(any(x.startswith('FrontierPublisher') for x in chk.assess(
          [tick('2026-10-20T11:58:00Z', warmup=W, last_staged_at='2026-10-20T11:58:00Z', last_publish=lp)], now_s)[0])
          for lp in (None, dict(okp, at='2026-10-20T11:30:00Z'), dict(okp, status='refused'))))
    hung = [tick('2026-10-20T10:00:00Z', warmup=W, last_staged_at='2026-10-20T10:00:00Z', last_publish=okp)] + \
        [tick(f'2026-10-20T11:{mm:02d}:00Z', status='locked') for mm in range(0, 60, 5)]
    c('checker: ticks that found the lock held are not fresh ticks: the newest that RAN is judged (Claude r3 P2-1)',
      (any(x.startswith('FrontierStale') for x in chk.assess(hung, now_s)[0]), chk.warm_of(hung)) == (True, True))
    c('checker: a pool dir the publisher cannot write alarms during the warm-up too',
      any('cannot write' in x for x in chk.assess([tick('2026-10-20T11:58:00Z', last_publish={
          'at': '2026-10-20T11:58:30Z', 'status': 'warmup', 'unusable': {'hive-c': 'not writable'}})], now_s)[0]))
    wp = lambda **kw: dict({'at': '2026-10-20T11:58:30Z', 'status': 'warmup', 'usable': 13, 'offered': 13}, **kw)  # noqa: E731
    c('checker: during the warm-up a live rehearsing publisher is quiet; a silent, stale, failing or short one alarms '
      '(Claude r4 P2-1)',
      (chk.assess([tick('2026-10-20T11:58:00Z', last_publish=wp())], now_s)[0],
       [any(x.startswith('FrontierPublisher') for x in chk.assess([tick('2026-10-20T11:58:00Z', last_publish=lp)], now_s)[0])
        for lp in (None, wp(at='2026-10-20T11:00:00Z'), wp(status='error'), wp(usable=12))])
      == ([], [True, True, True, True]))
    c('checker: warm comes from the newest tick line', (chk.warm_of([tick('x', warmup=W)]), chk.warm_of([tick('x')]))
      == (True, False))
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, 'out', 'publish'))
        os.makedirs(os.path.join(td, '_pool-p'))
        doc = {'pool': 'p', 'home': [1, 2, 3], 'digest': 'abc', 'generated_at': '2026-10-20T11:59:00Z',
               'digest_since': '2026-10-20T11:00:00Z', 'data_until': 'x'}
        with open(os.path.join(td, 'out', 'publish', 'bundle.json'), 'w') as f:
            json.dump({'schema': 1, 'entries': [{'pool': 'p', 'key': 'frontier-1_2_3', 'doc': doc}]}, f)
        o = os.path.join(td, 'out')
        m.create_gen(os.path.join(td, '_pool-p'), 'frontier-1_2_3', dict(doc, digest='older', generated_at='2026-10-20T11:50:00Z'))
        c('checker: warm, a bundle entry never published alarms although re-stamped every tick (digest_since)',
          any('is not published' in x for x in chk.assess_publish(o, td, now_s, True)[0]))
        c('checker: not warm -> the publish check is quiet by design', chk.assess_publish(o, td, now_s, False)[0] == [])
        m.create_gen(os.path.join(td, '_pool-p'), 'frontier-1_2_3', doc)
        c('checker: once published (same digest, a fresh generation) it is quiet', chk.assess_publish(o, td, now_s, True)[0] == [])
        m.create_gen(os.path.join(td, '_pool-p'), 'frontier-1_2_3', dict(doc, generated_at='2026-10-20T09:00:00Z'))
        c('checker: a published generation 3 h old alarms whatever its digest (the publisher\'s own clock)',
          any('min old' in x for x in chk.assess_publish(o, td, now_s, True)[0]))
        os.unlink(os.path.join(td, 'out', 'publish', 'bundle.json'))
        c('checker: warm and no bundle at all alarms', any(x.startswith('FrontierPublishStale') for x in
                                                           chk.assess_publish(o, td, now_s, True)[0]))
    # ---- coverage: VOID or missing hours uncover their day; the 80% rule per town against its OWN median
    D0 = m.ms_of('2026-10-12T00:00:00Z')
    full = lambda d, per=100, extra=None: [{'h0': D0 + d * m.DAY_MS + h * m.HOUR_MS,                  # noqa: E731
                                           'bots': dict({'a1': ['a', per, 60], 'b1': ['b', per, 60], 'c1': ['c', per, 60]},
                                                        **(extra or {}))} for h in range(24)]
    recs = full(0) + full(1) + full(2)
    recs[30] = {'h0': recs[30]['h0'], 'void': True, 'bots': {}}
    cv = m.coverage(recs, D0, D0 + 3 * m.DAY_MS)
    c('coverage: one VOID hour in a day at 96% uncovers that day', cv['uncovered_days'] == ['2026-10-13'])
    recs2 = full(0) + full(1) + full(2)
    for r in recs2[48:]:
        r['bots']['c1'] = ['c', 75, 60]             # town c at 75% of ITS OWN median on day 3; the fleet median holds
    cv2 = m.coverage(recs2, D0, D0 + 3 * m.DAY_MS)
    F = m.frontier('c', (0, 64, 0), recs2, cv2, D0 + 3 * m.DAY_MS, D0 + 3 * m.DAY_MS, [])
    G = m.frontier('a', (0, 64, 0), recs2, cv2, D0 + 3 * m.DAY_MS, D0 + 3 * m.DAY_MS, [])
    c('coverage: a town below 80% of its own median for a day is uncovered for that town only (Codex r2 P1)',
      (cv2['uncovered_days'], F['covered'], F['town_uncovered_days'], G['covered']) == ([], False, ['2026-10-14'], True))
    low = [{'h0': r['h0'], 'bots': dict(r['bots'], c1=['c', 50, 60])} for r in full(0) + full(1) + full(2)]
    cv3 = m.coverage(low, D0, D0 + 3 * m.DAY_MS)
    c('coverage: a town steadily at half the fleet\'s rows is covered (judged against itself, not the fleet)',
      m.frontier('c', (0, 64, 0), low, cv3, D0 + 3 * m.DAY_MS, D0 + 3 * m.DAY_MS, [])['covered'])
    lost = [{'h0': r['h0'], 'bots': dict(r['bots'], c1=['c', 10 if r['h0'] >= D0 + m.DAY_MS else 100, 60])}
            for r in full(0) + full(1) + full(2)]
    cvl = m.coverage(lost, D0, D0 + 3 * m.DAY_MS)
    c('coverage: a loss longer than half the window (it IS the town\'s own median) is caught by the 30% fleet floor '
      '(Claude r3 P1-1)', (cvl['days']['2026-10-13']['towns']['c'],
                           m.frontier('c', (0, 64, 0), lost, cvl, D0 + 3 * m.DAY_MS, D0 + 3 * m.DAY_MS, [])['covered'])
      == (1.0, False))
    c('coverage: a part day under 12 h is not judged against the town\'s own median (edge noise: 20% of 1-h part '
      'days read < 0.8); a 12-h one is; the 30% fleet floor applies to both',
      (m.town_day_uncovered(0.5, 0.9, 3), m.town_day_uncovered(0.5, 0.9, 12), m.town_day_uncovered(0.9, 0.2, 3),
       m.town_day_uncovered(None, 0.9, 24)) == (False, True, True, True))
    c('coverage: no complete day -> no median -> ratio None (printed "-"), never a measured 0',
      m.coverage(full(0)[:5], D0, D0 + 5 * m.HOUR_MS)['days']['2026-10-12']['ratio'] is None)
    # ---- hazards: a `_death` row older than 7 days is not a hazard; the site cutoff is the WALL clock
    now = 10 ** 12
    old = [[now - m.HAZARD_MS - 1, 'p', 'b', 10, 64, 10, 'fall']]
    c('hazard: an 8-day-old _death row is not a hazard, a 6-day-old one is',
      (m.hazard_points(old, [], 'p', now), len(m.hazard_points([[now - 6 * m.DAY_MS, 'p', 'b', 10, 64, 10, 'fall']], [], 'p', now)))
      == ([], 1))
    # ---- warm-up: void and locked ticks do not extend it; a new version restarts it
    T = m.ms_of('2026-10-20T00:00:00Z')
    hb = lambda n, st='ok', v='v1': json.dumps({'mode': 'tick', 'at': m.iso(T + n * 5 * m.MIN_MS), 'status': st, 'version': v})  # noqa: E731
    lines = [hb(n) for n in range(577)]
    c('warm-up: 48 h of measuring ticks completes', m.warmup(lines, T + 48 * m.HOUR_MS)['complete'])
    c('warm-up: 48 h of VOID ticks does not (the instrument never measured)',
      not m.warmup([hb(0)] + [hb(n, 'void') for n in range(1, 577)], T + 48 * m.HOUR_MS)['complete'])
    c('warm-up: the FIRST tick of a new version is not warm (Codex r3 P2)',
      (m.warmup(lines, T + 48 * m.HOUR_MS, 'v1')['complete'], m.warmup(lines, T + 48 * m.HOUR_MS, 'v2')['complete'])
      == (True, False))
    c('warm-up: a new script version restarts it',
      m.warmup(lines[:300] + [hb(n, v='v2') for n in range(300, 577)], T + 48 * m.HOUR_MS)['run_start'] == m.iso(T + 300 * 5 * m.MIN_MS))
    # ---- parity: the comparison itself
    ref = {'regions': {'p': {'1,1': [3, 1, 5, 6, 0, 0, 0]}}, 'presence': {'p': {'0-48|surface': 1}}, 'bots': {'b': ['p', 3, 1]}}
    c('parity: identical folds agree, one changed bot-minute is a diff',
      (m.parity_diffs(ref, ref), len(m.parity_diffs(ref, dict(ref, regions={'p': {'1,1': [3, 2, 5, 6, 0, 0, 0]}}))))
      == ([], 1))
    # ---- pools whose status changes (isolated -> shared, 10-21) and the pools that are not the bench
    c('cpool: an isolated bot\'s own pool folds into its world; a shared pool and None pass through',
      (m.cpool('self-isolated-b-Alpha'), m.cpool('board-a'), m.cpool('isolated-b'), m.cpool(None))
      == ('isolated-b', 'board-a', 'isolated-b', None))
    H2 = {'fx': m.FX_HOME}
    base = [r for r in m.fixture_rows()[:60] if r.get('x') is not None]
    iso2 = [dict(r, pool='self-fx-A', bot='a') for r in base] + [dict(r, pool='self-fx-B', bot='b') for r in base]
    fr = m.fold_rows(iso2, H2)
    c('fold: two isolated bots of one world fold into ONE census pool (bot-minutes add: two bots)',
      (sorted(fr['regions']), (fr['regions'].get('fx') or {}).get(m.rkey(16, 0), [None, None])[:2],
       (fr['bots'].get('a') or [None])[0]) == (['fx'], [12, 2], 'fx'))
    c('parse_q1: two bots of one world merge exactly as the reference fold does',
      m.parse_q1(m.fake_q1(iso2), H2) == {'fx': fr['regions'].get('fx')})
    # the conversion hour: ONE bot logs as self-fx-A, then as fx, with both names inside the same minutes
    conv = [dict(r, pool='self-fx-A', bot='a') for r in base[:30]] + [dict(r, pool='fx', bot='a') for r in base[27:]]
    def cz(name, fn):                               # a case whose computation itself may raise under a mutant
        try:
            c(name, fn())
        except Exception:                           # noqa: BLE001
            c(name, False)
    try:
        fc = m.fold_rows(conv, H2)
    except Exception:                               # noqa: BLE001
        fc = None
    cz('conversion hour: one bot under two ES names is one bot -- q1 equals the reference fold (Codex r2 P1)',
       lambda: m.parse_q1(m.fake_q1(conv), H2) == {'fx': fc['regions']['fx']})
    cz('conversion hour: q2 presence and bot counts equal the reference fold (no overwrite, no double minute)',
       lambda: m.parse_q2(m.fake_q2(conv), H2) == (fc['presence'], fc['bots']) and fc['bots']['a'][1] == len(conv))
    clash = [dict(r, pool='fx', bot='a') for r in base[:3]] + [dict(r, pool='gx', bot='a') for r in base[3:6]]
    raised = []
    for fn in (lambda: m.fold_rows(clash, {'fx': m.FX_HOME, 'gx': m.FX_HOME}),
               lambda: m.parse_q1(m.fake_q1(clash), {'fx': m.FX_HOME, 'gx': m.FX_HOME})):
        try:
            fn()
            raised.append(False)
        except m.TwoPools:
            raised.append(True)
    c('a bot under two CENSUS pools in one hour is an instrument failure on both paths, never a guess', raised == [True, True])
    # es_fold_hour on a fake ES: the conversion hour agrees with the reference fold; the instrument rules hold
    evs = [{'@timestamp': m.iso(m.FX_H0 + 60_000)[:-1] + '.000Z', 'bot': {'name': 'a', 'pos': {'x': 1030.5, 'y': 64, 'z': 5.5}},
            'exp': {'pool': 'fx'}, 'skill': {'name': '_death', 'fail_class': 'fall'}}]
    pos_n = len([r for r in conv if r.get('x') is not None])
    def conv_ok():
        rec0 = fold_with_fake_es(m, conv, evs, [pos_n, 1])
        return (m.parity_diffs(fc, rec0), rec0.get('unstable'), len(rec0['deaths'])) == ([], None, 1)
    cz('es_fold_hour: the conversion hour on a fake ES matches fold_rows exactly and is stable', conv_ok)
    cz('es_fold_hour: an event pull short of its own count is unstable, never folded as complete (Claude r2 P2-7)',
       lambda: fold_with_fake_es(m, conv, evs, [pos_n, 2]).get('unstable') is True)
    cz('es_fold_hour: Q1 / Q2 disagreeing is unstable',
       lambda: fold_with_fake_es(m, conv, evs, [pos_n, 1], drop_q2=1).get('unstable') is True)
    c('subset control: a pool the hour was not folded for is skipped, not "missing" (Claude r2 P2-6)',
      m.control_subset([dict(r, homes={}, regions={}) for r in m.fixture_records()], m.FX_H0, m.FX_H0 + 3 * m.HOUR_MS,
                       {'fx': m.FX_HOME})['missing_n'] == 0)
    with tempfile.TemporaryDirectory() as td:
        mkpool(td, '_pool-a', 'town-chest-1_2_3.cobble.jsonl')
        mkpool(td, '_pool-self-iso-Alpha', 'town-chest-7_8_9.cobble.jsonl', 'junkwell-site-7_8_9.g1.json')
        mkpool(td, '_pool-self-iso-Bravo', 'town-chest-7_8_9.cobble.jsonl')
        mkpool(td, '_pool-self-iso-Comet')                                    # a bot dir with no town state yet: no vote
        mkpool(td, '_pool-self-jso-Alpha', 'town-chest-7_8_9.cobble.jsonl')
        mkpool(td, '_pool-self-jso-Bravo', 'town-chest-1_1_1.cobble.jsonl')   # two homes in one isolated world: refused
        mkpool(td, '_pool-conv', 'town-chest-5_5_5.cobble.jsonl')             # converted: shared now on a NEW home
        mkpool(td, '_pool-self-conv-Alpha', 'town-chest-4_4_4.cobble.jsonl')
        mkpool(td, '_pool-rs', 'town-chest-2_2_2.cobble.jsonl')
        mkpool(td, '_pool-rs.pre-reseed-20261012T101500Z')                    # reseeded inside the window
        mkpool(td, '_pool-old', 'town-chest-3_3_3.cobble.jsonl')
        mkpool(td, '_pool-old.pre-reseed-20260927T130943Z')                   # before the window: harmless
        mkpool(td, '_pool-showcase', 'town-chest-6_6_6.cobble.jsonl')         # never the bench
        n1 = m.ms_of('2026-10-20T00:00:00Z')
        fold, shared, probs, iprobs = m.census_pools(td, n1)
        c('pools: shared towns publish; an isolated world with one home is folded only; showcase never',
          (shared, sorted(fold)) == (['a', 'conv', 'old'], ['a', 'conv', 'iso', 'old']))
        c('pools: a converted pool takes its SHARED home, not its old per-bot one', fold.get('conv') == (5, 5, 5))
        c('pools: a reseed inside the window leaves the town out and says so; one before it does not',
          ('rs' in probs and 'reseeded 20261012T101500Z' in probs['rs'], 'old' in probs) == (True, False))
        c('pools: a reseed that has aged out of the ROLLING window excludes nothing (Codex r2 P2, Claude r2 P2-2)',
          'rs' in m.census_pools(td, m.ms_of('2026-10-27T12:00:00Z'))[1])
        c('pools: an isolated world naming two homes is refused (informational), not guessed',
          'jso' in iprobs and 'jso' not in fold and 'jso' not in probs)
    c('towns_gone: a town published before with no dir now is named; one already explained is not',
      set(m.towns_gone({'a': 't1', 'b': 't2', 'c': 't3'}, ['a'], {'c': 'conflicting homes'})) == {'b'})
    # ---- the tick's decisions, and the tick itself with ES faked
    ts = m.tick_status
    c('status: an instrument failure outranks everything; ES blind is VOID, never idle; a backlog is behind',
      (ts(True, False, True, 3, 3, 1, 'x'), ts(False, False, True, 0, 0, 0, None), ts(False, True, False, 0, 0, 0, None),
       ts(False, False, False, 4, 4, 0, None), ts(False, False, False, 4, 1, 2, None), ts(False, False, False, 0, 0, 0, 'w'),
       ts(False, False, False, 2, 0, 0, None), ts(False, False, False, 0, 0, 0, None))
      == ('instrument', 'void', 'void', 'void', 'behind', 'behind', 'ok', 'idle'))
    now_p = m.ms_of('2026-10-22T12:00:00Z')
    fresh = {'ok': True, 'at': '2026-10-22T01:00:00Z'}
    c('parity: none during the first backfill is not an alarm; none after it is; a failed or 37-h-old one is',
      (m.parity_alarm(None, now_p, 5), m.parity_alarm(None, now_p, 0), m.parity_alarm(fresh, now_p, 0),
       m.parity_alarm(dict(fresh, ok=False), now_p, 5), m.parity_alarm(dict(fresh, at='2026-10-20T23:00:00Z'), now_p, 0))
      == (False, True, False, True, True))
    c('stage: a backlog or an unstable hour withholds the bundle; neither stages',
      (bool(m.stage_withheld(3, [], [])), bool(m.stage_withheld(0, ['2026-10-21T13'], [])), m.stage_withheld(0, [], []))
      == (True, True, None))
    R = [{'h0': 0, 'void': False}, {'h0': m.HOUR_MS, 'void': True}]
    c('measured_until: the newest NON-VOID hour (a VOID hour is never fresh data)',
      m.measured_until_of(R, 0, 9 * m.HOUR_MS) == m.HOUR_MS)
    Cok = {'measured_until': now_p - m.HOUR_MS, 'unstable': [], 'ctl': {'missing_n': 0}, 'shared': ['p'], 'since': 0,
           'records': [{'h0': now_p - 2 * m.HOUR_MS, 'schema': m.FOLD_SCHEMA, 'homes': {'p': [1, 2, 3]},
                        'sample': {'at': 'x'}}]}
    c('report: a fold whose newest measured hour is 4 h old is VOID, not today\'s frontier (Codex r2 P1)',
      (bool(m.report_staleness(dict(Cok, measured_until=now_p - 4 * m.HOUR_MS), now_p)), m.report_staleness(Cok, now_p),
       bool(m.report_staleness(None, now_p))) == (True, None, True))
    c('report: an unstable hour, a subset miss, an old-schema or an unsampled hour make the report NOT VALID (Codex r3 '
      'P1, r4 P2)',
      (bool(m.report_staleness(dict(Cok, unstable=['2026-10-22T09']), now_p)),
       bool(m.report_staleness(dict(Cok, ctl={'missing_n': 2}), now_p)),
       bool(m.report_staleness(dict(Cok, records=[dict(Cok['records'][0], schema=1)]), now_p)),
       bool(m.report_staleness(dict(Cok, records=[dict(Cok['records'][0], sample={})]), now_p))) == (True, True, True, True))
    h = m.FX_H0
    good_r = lambda k, **kw: dict({'h0': h + k * m.HOUR_MS, 'schema': m.FOLD_SCHEMA, 'homes': {'fx': [1, 2, 3]},  # noqa: E731
                                   'sample': {'at': 'x'}}, **kw)
    probs = m.record_problems([good_r(0), good_r(1, unstable=True), good_r(2, schema=1), good_r(3, homes={}),
                               good_r(4, sample={}), good_r(5, void=True)], [h + k * m.HOUR_MS for k in range(7)], ['fx'])
    c('record_problems: unstable, old schema, a town not folded, no sample, VOID and missing are each named',
      {k: len(v) for k, v in probs.items()} == {'unstable': 1, 'old_schema': 1, 'pool_not_folded': 1, 'no_sample': 1,
                                                'void': 1, 'missing': 1})
    cc = m.control_completeness([good_r(k, void=k == 2) for k in range(-1, 3)], m.FX_H0, m.FX_H0 + 3 * m.HOUR_MS, ['fx'])
    c('control: a window with a VOID or missing hour is INCOMPLETE and says which',
      (cc['expected'], cc['present'], cc['void'], cc['complete'], len(cc['missing'])) == (4, 4, 1, False, 0))
    cu = m.control_completeness([good_r(k, unstable=k == 1) for k in range(-1, 3)], m.FX_H0, m.FX_H0 + 3 * m.HOUR_MS, ['fx'])
    cp = m.control_completeness([good_r(k) for k in range(-1, 3)], m.FX_H0, m.FX_H0 + 3 * m.HOUR_MS, ['fx', 'gx'])
    c('control: an unstable hour, or a town the hours were not folded for, is INCOMPLETE too (Codex r3 P1)',
      (cu['complete'], 'unstable' in cu['problems'], cp['complete'], 'pool_not_folded' in cp['problems'],
       m.control_completeness([good_r(k) for k in range(-1, 3)], m.FX_H0, m.FX_H0 + 3 * m.HOUR_MS, ['fx'])['complete'])
      == (False, True, False, True, True))
    cs = m.control_status
    c('control status: valid only when complete AND its subset control holds; each reason named (Codex r4 P2, Claude '
      'r5 P2-1)', (cs({'complete': True}, {'missing_n': 0}), cs({'complete': True}, {'missing_n': 3})[0],
                   'regions the fold lacks' in ' '.join(cs({'complete': True}, {'missing_n': 3})[1]),
                   cs({'complete': False, 'problems': {'unstable': {}}}, {'missing_n': 0}))
      == (('ok', []), 'INCOMPLETE', True, ('INCOMPLETE', ['completeness: unstable'])))
    c('plan: an hour without its sample is refolded (the cross-check is never a dead end, Claude r5 P3-1)',
      [w for _, w in m.plan_folds({H: [5, 1]}, {H: dict(have[H], sample={})}, {'p': [1, 2, 3]})] == ['no sample'])
    with tempfile.TemporaryDirectory() as td:
        st, o = os.path.join(td, 'state'), os.path.join(td, 'out')
        mkpool(st, '_pool-a', 'town-chest-1_2_3.cobble.jsonl')
        mkpool(st, '_pool-b', 'town-chest-100_64_100.cobble.jsonl')
        mkpool(st, '_pool-self-iso-Alpha', 'town-chest-7_8_9.cobble.jsonl')
        res, bun = fake_tick(m, st, o)
        c('tick: stages one entry per SHARED town (never the isolated pool it folds), says so, records the towns',
          ([e['pool'] for e in bun['entries']], bun['withheld'], res['status'], res['isolated_folded'],
           sorted(json.load(open(os.path.join(o, 'expected-towns.json')))))
          == (['a', 'b'], None, 'ok', ['iso'], ['a', 'b']))
        c('tick: every entry is publishable by the publisher\'s own rule (instrument ok, fresh, its own key) and says a '
          'reader must treat it as VOID past stale_after (the mechanical half of the tombstone deferral)',
          bun['entries'] and all(pub.publish_refusal(e['doc'], e['pool'], e['key'], m.ms_of(bun['generated_at'])) is None
                                 and 'stale_after' in (e['doc'].get('withdrawal') or '') for e in bun['entries']))
        shutil.rmtree(os.path.join(st, '_pool-b'))
        res2, bun2 = fake_tick(m, st, o)
        c('tick: a town whose dir vanished is named "gone" and leaves the bundle at once (Codex r2 P1)',
          ([e['pool'] for e in bun2['entries']], 'gone' in res2['home_problems'].get('b', '')) == (['a'], True))
        fake_tick(m, st, os.path.join(td, 'out3'))
        res3, bun3 = fake_tick(m, st, os.path.join(td, 'out3'), budget=-1, hours=8)     # 2 new hours, none folded
        c('tick: a backlog stages nothing, says why, and reads behind',
          (bun3['entries'], 'backlog' in (bun3['withheld'] or ''), res3['status']) == ([], True, 'behind'))
        now0 = int(time.time() * 1000)
        hs = {m.floor_hour(now0 - m.SETTLE_MS) - m.HOUR_MS}
        res4, bun4 = fake_tick(m, st, os.path.join(td, 'out4'), unstable_hours=hs)
        c('tick: an unstable hour stages nothing', (bun4['entries'], 'unstable' in (bun4['withheld'] or '')) == ([], True))
        res4b, bun4b = fake_tick(m, st, os.path.join(td, 'out4b'), nosample_hours=hs)
        c('tick: an hour folded without its sample stages nothing this tick (the cross-check, Claude r5 P3-1)',
          (bun4b['entries'], bool(bun4b['withheld'])) == ([], True))
        real_fold_ns = m.es_fold_hour
        res5, bun5 = fake_tick(m, st, os.path.join(td, 'out5'), parity_ok=False)
        c('tick: a failed parity is an instrument failure; its entries carry instrument_ok false, which the publisher refuses',
          (res5['status'], [e['doc']['instrument_ok'] for e in bun5['entries']],
           all('instrument' in (pub.publish_refusal(e['doc'], e['pool'], e['key'], m.ms_of(bun5['generated_at'])) or '')
               for e in bun5['entries'])) == ('instrument', [False], True))
        def boom_fold(m_):
            real = m_.es_fold_hour
            def f(h0, homes):
                raise m_.TwoPools('bot q logged under census pools [a, b] in one hour')
            return real, f
        real_fold, f2 = boom_fold(m)
        m.es_fold_hour = f2
        try:
            o6 = os.path.join(td, 'out6')
            saved = (m.es_hour_counts, m.maybe_parity, m.last_parity)
            now6 = int(time.time() * 1000)
            hrs = [m.floor_hour(now6 - m.SETTLE_MS) - k * m.HOUR_MS for k in (2, 1)]
            m.es_hour_counts = lambda a, b: {x: [100, 0] for x in hrs}
            m.maybe_parity = m.last_parity = lambda *a, **k: None
            try:
                r6 = m.run_tick(argparse.Namespace(state_dir=st, out_dir=o6, budget_s=99, pace_s=0))
                b6 = json.load(open(os.path.join(o6, 'publish', 'bundle.json')))
                ok6 = (r6['hours_folded'], b6['entries'], r6['status'],
                       any('two census pools' in x for x in r6['instrument'])) == (2, [], 'instrument', True)
            except Exception:                       # noqa: BLE001
                ok6 = False
            c('tick: a TwoPools hour is recorded unstable, folding goes on, nothing stages, and it alarms (Claude r3 P2-2)', ok6)
        finally:
            m.es_fold_hour = real_fold
            m.es_hour_counts, m.maybe_parity, m.last_parity = saved
        o7 = os.path.join(td, 'out7')
        fake_tick(m, st, o7)
        def die(h0, homes):
            raise RuntimeError('ES went away')
        saved = (m.es_fold_hour, m.es_hour_counts)
        m.es_fold_hour = die
        now7 = int(time.time() * 1000)
        m.es_hour_counts = lambda a, b: {m.floor_hour(now7 - m.SETTLE_MS) + m.HOUR_MS * 5: [100, 0]}
        try:
            m.run_tick(argparse.Namespace(state_dir=st, out_dir=o7, budget_s=99, pace_s=0))
            died = False
        except RuntimeError:
            died = True
        finally:
            m.es_fold_hour, m.es_hour_counts = saved
        b7 = json.load(open(os.path.join(o7, 'publish', 'bundle.json')))
        c('tick: a tick that fails leaves NO publishable bundle behind (Codex r3 P1), but keeps the publisher-lag clocks '
          '(Claude r4 P3-5)', (died, b7['entries'], 'in progress' in (b7['withheld'] or ''), sorted(b7.get('clocks') or {}))
          == (True, [], True, ['a']))
        o8 = os.path.join(td, 'out8')
        os.makedirs(o8)
        m.heartbeat(o8, {'mode': 'tick', 'status': 'ok'})
        m.heartbeat(o8, {'mode': 'tick', 'status': 'locked'})
        c('heartbeat: a locked tick is logged but never overwrites heartbeat.json (Claude r3 P2-1)',
          (json.load(open(os.path.join(o8, 'heartbeat.json')))['status'],
           len(open(os.path.join(o8, 'heartbeat.jsonl')).read().splitlines())) == ('ok', 2))
        saved9 = m.es_fold_hour
        fake_tick(m, st, os.path.join(td, 'out9'))
        recf = os.path.join(td, 'out9', 'hours', sorted(os.listdir(os.path.join(td, 'out9', 'hours')))[-1])
        r9 = json.load(open(recf))
        r9.pop('sample', None)
        json.dump(r9, open(recf, 'w'))
        m.es_fold_hour = lambda h0, homes: (_ for _ in ()).throw(RuntimeError('no ES in this case'))
        try:
            C9 = m.compute(os.path.join(td, 'out9'), st, int(time.time() * 1000))
            w9 = m.stage_withheld(0, m.invalid_hours(C9), [])
        finally:
            m.es_fold_hour = saved9
        c('tick: the staging cross-check withholds a window holding an hour without its sample (Claude r5 P3-1)',
          bool(w9) and 'unstable' in w9)
        lnk = os.path.join(td, 'linked-out')
        os.symlink(o, lnk)
        try:
            fake_tick(m, st, lnk)
            refused = False
        except OSError:
            refused = True
        c('tick: an out dir that is a symlink is refused, never written through', refused)
    return out


def run_all(m):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        st = m.selftest(verbose=False)
    res = cases(m)
    run_all.why = [ln.strip()[3:] for ln in buf.getvalue().split('\n') if ln.strip().startswith('!!')] + \
        [n for n, ok in res if not ok]
    return st, res


def strip_code(src):
    """The source with every COMMENT token and every docstring blanked (tokenize + ast), line structure kept."""
    lines = src.split('\n')
    kill = []
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type == tokenize.COMMENT:
            kill.append((tok.start, tok.end))
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)) and node.body:
            d = node.body[0]
            if isinstance(d, ast.Expr) and isinstance(getattr(d, 'value', None), ast.Constant) and isinstance(d.value.value, str):
                kill.append(((d.lineno, d.col_offset), (d.end_lineno, d.end_col_offset)))
    for (l0, c0), (l1, c1) in sorted(kill, reverse=True):
        if l0 == l1:
            ln = lines[l0 - 1]
            lines[l0 - 1] = ln[:c0] + ' ' * (c1 - c0) + ln[c1:]
        else:
            lines[l0 - 1] = lines[l0 - 1][:c0]
            for k in range(l0, l1 - 1):
                lines[k] = ''
            lines[l1 - 1] = ' ' * c1 + lines[l1 - 1][c1:]
    return '\n'.join(lines)


# (name, anchor, replacement, want, [file]) -- the anchor occurs exactly once in strip_code(source) and in the raw
# source; the suite must fail with `want` inside one of the failure names (or the selftest's own lines); 'CRASH' accepts
# only a crash
MUTANTS = [
    ('band upper bound inclusive', "if d >= lo and (hi is None or d < hi):", "if d >= lo and (hi is None or d <= hi):",
     'band: 48 -> 48-100'),
    ('coverage ignores the 80% rule', "'covered': ratio is not None and ratio >= COVER_SHARE and D['void'] == 0",
     "'covered': ratio is not None and D['void'] == 0", 'coverage: the 70% day is uncovered'),
    ('uncovered reads not_observed', "status = 'visited' if g else ('not_observed' if covered else 'unknown')",
     "status = 'visited' if g else 'not_observed'", 'an uncovered day'),
    ('hazard radius dropped', "near = [p for p in hz if rect_dist(p[0], p[1], i, j) <= HAZARD_R]",
     "near = [p for p in hz if rect_dist(p[0], p[1], i, j) <= 0]", 'hazard: death row'),
    ('hazard age ignored', "if isinstance(t, (int, float)) and now_ms - HAZARD_MS < t <= now_ms + HOUR_MS:",
     "if isinstance(t, (int, float)):", 'hazard: death row'),
    ('site kind ignored', "if str(s.get('kind', '')).startswith('death:') and", "if True and", 'hazard: death row'),
    ('border margin dropped', "lim = border_r - BORDER_MARGIN", "lim = border_r", 'border: (28,0) in the domain'),
    ('unreached counts any reason', "if reason == 'no_route':", "if True:", 'unreached: one no_route + one deadline'),
    ('histogram key read as an index', "i, j = int(round(xb['key'] / GRID)), int(round(zb['key'] / GRID))",
     "i, j = int(xb['key']), int(zb['key'])", 'parse_q1 == fold_rows'),
    ('bot-minutes count rows', "regions[pool][k][1] = len(s)", "regions[pool][k][1] = regions[pool][k][0]",
     'fx-A path: 6 rows and 1 bot-minute'),
    ('subset control blind', "if k not in ((by_h.get(r['h0']) or {}).get('regions') or {}).get(p, {}):", "if False:",
     'control_subset POSITIVE CONTROL'),
    ('warm-up never restarts on a gap', "if last is None or t - last > WARMUP_GAP_MIN * MIN_MS or r.get('version') != ver:",
     "if last is None or r.get('version') != ver:", 'warm-up: a 40-min gap restarts it'),
    ('generation overwrites', "os.link(tmp, final, src_dir_fd=dfd, dst_dir_fd=dfd, follow_symlinks=False)",
     "os.replace(tmp, final, src_dir_fd=dfd, dst_dir_fd=dfd)", 'a number another writer took is never overwritten',
     'publisher'),
    ('ranking ignores the away half-plane', "return (WATER_RANK[c['water']], 0 if (al is None or al >= 0) else 1,",
     "return (WATER_RANK[c['water']], 0,", 'ranking: the away half-plane comes first'),
    ('wet and dry swapped', "if g[5] / g[4] >= LABEL_SHARE:", "if (g[4] - g[6]) / g[4] >= LABEL_SHARE:",
     'water: 9 of 20 wet'),
    ('depth sign', "return 'deep' if (y - home_y) < DEEP_DY else 'surface'",
     "return 'deep' if (y - home_y) > DEEP_DY else 'surface'", 'depth: dy -8 is surface'),
    ('pick threshold', "if (mx - (x.get('used', 0) or 0)) / max(1, mx) >= 0.4:",
     "if (mx - (x.get('used', 0) or 0)) / max(1, mx) >= 0.0:", 'pick: 40% left counts'),
    ('home start band from the end position', "sp = prev_pos(bot, t)", "sp = (p.get('x'), p.get('y'), p.get('z'))",
     'baseline: home by start band'),
    ('bag eligibility ignores at-town', "e = sl <= 24 and gp and (hp or 0) >= 18 and at",
     "e = sl <= 24 and gp and (hp or 0) >= 18", 'baseline: bag eligibility'),
    ('presence uses the oldest row', "if k0 not in newest or newer(r, newest[k0]):", "if k0 not in newest:",
     'presence: the tie resolves to the event row'),
    ('a same-ms skill row beats the event row', "return na < nb", "return na > nb", 'newest row tie'),
    ('edge day not pro-rated', "scale = 24 / n", "scale = 1", "the window's 6-h edge day"),
    ('missing hours pro-rated away (folded, not expected)', "scale = 24 / n", "scale = 24 / max(1, D['folded'])",
     'hours of the window with no record count as zero'),
    ('a changed count does not refold', "elif r.get('es_counts') != n:", "elif False:", 'a late unpositioned event row'),
    ('the hour after a refold is not refolded', "if why != 'new' and nxt in counts and nxt not in todo and nxt in have:",
     "if False:", 'a late unpositioned event row'),
    ('the successor is not recorded',
     "if prev is not None and h0 - HOUR_MS in counts and r.get('prev_es_counts') != prev.get('es_counts'):",
     "if False:", 'a tick that ended between a refold'),
    ('the successor compares files, not content', "r.get('prev_es_counts') != prev.get('es_counts')",
     "r.get('prev_es_counts') != prev.get('es_counts') or True", 'does not cascade'),
    ('the fold schema is ignored', "elif r.get('schema') != FOLD_SCHEMA:", "elif False:", 'another fold schema'),
    ('publish ignores stale_after', "if now > ms_of(doc['stale_after']):", "if False:", 'refused past stale_after',
     'publisher'),
    ('publish ignores the instrument', "if doc.get('instrument_ok') is not True:", "if False:",
     'refused on an instrument failure', 'publisher'),
    ('publisher runs as root', "if euid == 0:", "if False:", 'refuses to run as root', 'publisher'),
    ('publisher ignores the bundle refusal', "    why = bundle_refusal(bundle, now)\n    if why:",
     "    why = bundle_refusal(bundle, now)\n    if False:", 'a bundle that is not warm publishes nothing', 'publisher'),
    ('publisher ignores the owner', "if os.fstat(pfd).st_uid != euid:\n                    refused.append",
     "if False:\n                    refused.append", 'not owned by the publishing user', 'publisher'),
    ('the rehearsal ignores the owner', "if os.fstat(pfd).st_uid != euid:\n                    bad[pool]",
     "if False:\n                    bad[pool]", 'the rehearsal names a pool dir', 'publisher'),
    ('publisher follows a symlinked pool dir',
     "return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dir_fd)",
     "return os.open(path, os.O_RDONLY | os.O_DIRECTORY, dir_fd=dir_fd)", 'a _pool dir that is a symlink', 'publisher'),
    ('publisher accepts any pool name',
     "if not isinstance(pool, str) or not POOL_RE.match(pool) or pool.startswith('self-') or pool in NOT_TOWNS:",
     "if not isinstance(pool, str):", 'per-bot, showcase or path-like', 'publisher'),
    ('unreadable hazards still rank', "k not in unr and not sites_error:", "k not in unr:",
     'an unreadable world-facts file withholds'),
    ('void town absent from the sample counts', "if p not in seen:", "if False:", 'an empty sample is a VOID town-hour'),
    ('the checker uses the re-stamped time', "age = (now - _t(doc.get('digest_since') or doc['generated_at'])) / 60",
     "age = (now - _t(doc['generated_at'])) / 60", 're-stamped every tick', 'checker'),
    ('the checker forgets VOID', "if st == 'void':", "if False:", 'a void tick alarms', 'checker'),
    ('the checker forgets a stale tick', "if age > max_age_min:", "if False:", 'a tick 40 min old is stale', 'checker'),
    ('the checker ignores a dropped town', "if last.get('towns') is not None and last['towns'] < most:", "if False:",
     'fewer towns than earlier today', 'checker'),
    ('the checker ignores home problems', "if last.get('home_problems'):", "if False:", 'a town left out alarms', 'checker'),
    ('the checker ignores a census that stopped staging', "if lag is None or lag > NOT_STAGING_MIN:", "if False:",
     'nothing staged for 30 min', 'checker'),
    ('the checker ignores the publisher',
     "if lp is None or page is None or page > PUBLISHER_MAX_AGE_MIN or lp.get('status') != 'ok':",
     "if False:", 'the publisher silent', 'checker'),
    ('the checker trusts an old published generation', "if cur is None or cage is None or cage > PUBLISHED_MAX_AGE_MIN:",
     "if cur is None or cage is None:", 'a published generation 3 h old', 'checker'),
    ('the checker is quiet without a bundle',
     "return [f'FrontierPublishStale: warm, but the bundle {path} is unreadable ({type(e).__name__})'], notes",
     "return [], notes", 'no bundle at all', 'checker'),
    ('a void hour does not uncover its day', "ratio >= COVER_SHARE and D['void'] == 0 and D['folded'] == n,",
     "ratio >= COVER_SHARE,", 'one VOID hour in a day'),
    ('the town rule is not gated', "town_days = [d for d, D in cov['days'].items() if pool in (D.get('towns_uncovered') or ())",
     "town_days = [d for d, D in cov['days'].items() if False", 'below 80% of its own median'),
    ('no fleet floor', "return (hours >= TOWN_GATE_MIN_H and own_ratio < COVER_SHARE) or fleet_ratio < TOWN_FLOOR",
     "return (hours >= TOWN_GATE_MIN_H and own_ratio < COVER_SHARE)", 'longer than half the window'),
    ('edge part days gated per town', "return (hours >= TOWN_GATE_MIN_H and own_ratio < COVER_SHARE) or fleet_ratio < TOWN_FLOOR",
     "return (own_ratio < COVER_SHARE) or fleet_ratio < TOWN_FLOOR", 'a part day under 12 h'),
    ('the town judged against the fleet', "towns[p] = round(med / own[p], 3) if own[p] else None",
     "towns[p] = round(med / M, 3) if M else None", "steadily at half the fleet"),
    ('no median reads 0', "ratio = (statistics.median(counts) * scale / M) if (counts and M) else None",
     "ratio = (statistics.median(counts) * scale / M) if (counts and M) else 0.0", 'ratio None'),
    ('_death rows of any age are hazards',
     "if p == pool and x is not None and z is not None and now_ms - HAZARD_MS < t <= now_ms:",
     "if p == pool and x is not None and z is not None:", 'an 8-day-old _death row'),
    ('void ticks extend the warm-up', "if st not in ('ok', 'idle', 'behind'):", "if st not in ('ok', 'idle', 'behind', 'void'):",
     '48 h of VOID ticks'),
    ('a new version keeps the warm-up', "or r.get('version') != ver:", ":", 'a new script version restarts it'),
    ('parity ignores bot-minutes', "if A.get(k) != B.get(k):", "if (A.get(k) or [0])[0] != (B.get(k) or [0])[0]:",
     'one changed bot-minute is a diff'),
    ('unpositioned rows folded', "if r.get('x') is None or r.get('z') is None:\n            continue\n        r = dict(r, pool",
     "if False:\n            continue\n        r = dict(r, pool", 'CRASH'),
    ('isolated rows keep their self- pool', "return m.group(1) if m else p", "return p", 'two isolated bots of one world'),
    ('two bots of a region overwrite', "regs[rkey(i, j)] = g if o is None else", "regs[rkey(i, j)] = g if True else",
     'two bots of one world merge exactly'),
    ('q2 drops the row count', "bots[bb['key']] = [cp, bb['doc_count'], len(bb['m']['buckets'])]",
     "bots[bb['key']] = [cp, 1, len(bb['m']['buckets'])]", 'q2 presence and bot counts'),
    ('two census pools tolerated', "if len(cps) > 1:", "if False:", 'two CENSUS pools in one hour'),
    ('the event pull is not checked', "if len(rows) != counts[1]:", "if False:", 'an event pull short of its own count'),
    ('Q1/Q2 disagreement trusted', "if n1 != n2 or n1 != counts[0]:", "if False:", 'Q1 / Q2 disagreeing is unstable'),
    ('subset judges by today\'s homes', "if p not in homes or p not in own:", "if p not in homes:",
     'a pool the hour was not folded for is skipped'),
    ('plan compares the whole homes dict',
     "moved = sorted(p for p, h in want_homes.items() if (r.get('homes') or {}).get(p) != h)",
     "moved = ['all'] if r.get('homes') != want_homes else []", 'a pool absent now'),
    ('a converted pool keeps its isolated home', "if p in roster:\n            continue", "if False:\n            continue",
     'a converted pool takes its SHARED home'),
    ('reseeds ignored', "if t > since_ms:", "if False:", 'a reseed inside the window'),
    ('reseeds judged from 10-08 forever', "rs = reseeds(state_dir, window_start(now_ms))",
     "rs = reseeds(state_dir, ms_of(WINDOW_START))", 'aged out of the ROLLING window'),
    ('the showcase is a town', "and p not in EXCLUDE_POOLS:", "and True:", 'showcase never'),
    ('ES blind reads idle', "if no_records or blind or (folded and void == folded):", "if no_records:",
     'ES blind is VOID, never idle'),
    ('a backlog reads ok', "if backlog or withheld:\n        return 'behind'", "if withheld:\n        return 'behind'",
     'a backlog is behind'),
    ('parity never alarms when missing', "if par is None and backlog:\n        return False",
     "if par is None:\n        return False", 'none after it is'),
    ('a backlog stages', "    if backlog or unstable:\n        return f'backlog", "    if unstable:\n        return f'backlog",
     'a backlog stages nothing'),
    ('an unstable window stages', "    if backlog or unstable:\n        return f'backlog",
     "    if backlog:\n        return f'backlog", 'an unstable hour stages nothing'),
    ('measured_until counts VOID hours', "if not r.get('void') and since <= r['h0'] < until), default=None)",
     "if since <= r['h0'] < until), default=None)", 'the newest NON-VOID hour'),
    ('a failed tick leaves the old bundle', "    invalidate_bundle(a.out_dir, now, 'tick in progress", "    (a.out_dir, now, 'tick in progress",
     'a tick that fails leaves NO publishable bundle'),
    ('the warm-up ignores the running version', "or (version is not None and ver != version):", ":",
     'the FIRST tick of a new version'),
    ('TwoPools stops the census', "        except TwoPools as e:", "        except KeyError as e:", 'a TwoPools hour is recorded'),
    ('a locked tick overwrites heartbeat.json', "    if rec.get('status') != 'locked':", "    if True:",
     'a locked tick is logged but never overwrites'),
    ('the checker judges a locked tick', "    while recs and recs[-1].get('status') == 'locked':", "    while False:",
     'ticks that found the lock held', 'checker'),
    ('the checker ignores the rehearsal', "    if lp0.get('unusable'):", "    if False:", 'cannot write alarms during the warm-up',
     'checker'),
    ('the publisher does not rehearse', "            usable, bad = rehearse(bundle, state_dir, euid)",
     "            usable, bad = [], {}", 'rehearses the real path', 'publisher'),
    ('the report ignores unstable hours', "    if C['unstable']:\n        return f'unstable hours",
     "    if False:\n        return f'unstable hours", 'NOT VALID'),
    ('records judged without their schema', "        if r.get('schema') != FOLD_SCHEMA:\n            out['old_schema']",
     "        if False:\n            out['old_schema']", 'record_problems: unstable, old schema'),
    ('a None first pool pins the bot', "        if b[0] is None:\n            b[0] = r['pool']", "        if False:\n            b[0] = r['pool']",
     'a first row without a pool'),
    ('the report ignores unsampled hours', "k in ('old_schema', 'pool_not_folded', 'no_sample')}",
     "k in ('old_schema', 'pool_not_folded')}", 'or an unsampled hour make the report NOT VALID'),
    ('the checker ignores a silent publisher during warm-up',
     "if wage is None or wage > PUBLISHER_MAX_AGE_MIN or lp0.get('status') not in ('warmup', 'ok') \\",
     "if False and (wage is None or wage > PUBLISHER_MAX_AGE_MIN or lp0.get('status') not in ('warmup', 'ok')) \\",
     'a silent, stale, failing or short one alarms', 'checker'),
    ('a failed tick drops the clocks', "    invalidate_bundle(a.out_dir, now, 'tick in progress (or it failed: see heartbeat.json)', prior)",
     "    invalidate_bundle(a.out_dir, now, 'tick in progress (or it failed: see heartbeat.json)')", 'keeps the publisher-lag clocks'),
    ('the control ignores its subset control', "        ([f'{sub[\"missing_n\"]} sampled rows in regions the fold lacks'] if sub.get('missing_n') else [])",
     "        []", 'control status: valid only when complete'),
    ('no-sample hours are not refolded', "        elif not (r.get('sample') or {}).get('at'):\n            todo[h0] = 'no sample'",
     "        elif False:\n            todo[h0] = 'no sample'", 'an hour without its sample is refolded'),
    ('the staged doc forgets the withdrawal contract', "                   withdrawal='none yet:", "                   withdrawl='none yet:",
     'the mechanical half of the tombstone deferral'),
    ('the cross-check ignores record_problems', "    return sorted(set(C['unstable']) | {h for v in bad.values() for h in v})",
     "    return sorted(set(C['unstable']))", 'the staging cross-check withholds'),
    ('the tick skips the cross-check', "        withheld = stage_withheld(backlog, invalid_hours(C), instrument)",
     "        withheld = stage_withheld(backlog, C['unstable'], instrument)", 'an hour folded without its sample stages nothing'),
    ('a dropped town stays in the bundle', "if p not in shared and p not in problems}", "if False}", 'named "gone"'),
    ('the report ignores staleness', "if mu is None or now_ms - mu > STALE_AFTER_MS:", "if mu is None:",
     'a fold whose newest measured hour is 4 h old'),
    ('the control ignores VOID hours', "        if r.get('void'):\n            out['void']", "        if False:\n            out['void']",
     'INCOMPLETE and says which'),
    ('the out dir is followed through a symlink',
     "    if os.path.islink(path):\n        raise OSError(f'{path} is a symlink: refusing to write through it')\n    return path",
     "    if False:\n        raise OSError(f'{path} is a symlink: refusing to write through it')\n    return path",
     'an out dir that is a symlink'),
]


def main():
    fails = []
    m = load()
    st, res = run_all(m)
    if not st:
        fails.append('selftest fails on the real source')
    for name, ok in res:
        print(f'  {"ok " if ok else "FAIL"} {name}')
        if not ok:
            fails.append(name)
    sources = {k: open(os.path.join(HERE, f)).read() for k, f in FILES.items()}
    for name, old, new, want, *which in MUTANTS:
        which = which[0] if which else 'census'
        src = sources[which]
        n = strip_code(src).count(old)
        if n != 1 or src.count(old) != 1:
            fails.append(f'MUTANT {name}: anchor occurs {n} times in the stripped source, {src.count(old)} in the raw '
                         f'(must be 1 and 1)')
            print(f'  FAIL mutant {name}: ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE"} ({n}, raw {src.count(old)})')
            continue
        crash = None
        why = []
        try:
            mm = load((which, src.replace(old, new)))
            run_all(mm)
            why = run_all.why
        except Exception as e:                                  # noqa: BLE001
            crash = f'CRASH {type(e).__name__}: {e}'[:110]
        killed = (crash is not None) if want == 'CRASH' else (crash is None and any(want in w for w in why))
        shown = crash or (next((w for w in why if want in w), why[0] if why else '-'))[:110]
        print(f'  {"ok " if killed else "FAIL"} mutant killed: {name}  <- {shown}')
        if not killed:
            fails.append(f'MUTANT NOT KILLED BY ITS CASE: {name} (want {want!r}; failures {why[:3]} {crash or ""})')
    if fails:
        print(f'FAILED ({len(fails)}):')
        for f in fails:
            print('  !! ' + f)
        return 1
    print(f'ALL OK: {len(res)} behaviour cases, selftest, {len(MUTANTS)} mutants killed by their intended cases')
    return 0


if __name__ == '__main__':
    sys.exit(main())
