#!/usr/bin/env python3
"""test_threepool.py -- THREE-POOL BAG FIXES and the 6-h STEADY release (operator + Codex 2026-10-10; throughput).
docs/reports/threepool-2026-10-10.md.

  A. bagfixrule (pure): n_pools, extend_min, bands, three_pool_ok, draw_decision.
  B. bagfixgate.py as the loop drives it (subprocess, fixture logs): draw-decide on a fixture journal, ext-min,
     extend-check at 3 / 2 pools, poll at 3, and final at 3 pools x +1920 (KEEP, NOT_YET before +1920, REVERT (c), a
     mild loss that only the THREE-pool band forgives, +1440-only evidence, 2 pools).
  C. drawsteady.py: candidates / steady (pure), and the CLI over fixture ledger, journal, manifest and logs.
  D. canary-loop.sh's DRAW BLOCK, run for real: the block's own text is cut out of the file and executed by bash with
     a stub drawrec (scripted picks), a fake clock, the real bagfixgate.py draw-decide and a real journal.
     Plus structural checks for what behaviour cannot reach (comments stripped): EXTMIN comes from ext-min and the
     deadline moves with it; drawrec subtracts drawsteady's release after the 12-h loop and before the live canary.
  Mutants on copies, anchors asserted present and unique, scored only after the unmutated copies pass."""
import os, sys, json, subprocess, tempfile, shutil, importlib.util, datetime as dt, re

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def find(*names, host=False):
    # host scripts (canary-loop.sh, drawrec.sh, bagread.py) resolve from scripts/host FIRST: scripts/ holds older,
    # different Mac copies of two of them. In a staging dir everything is in one directory.
    for n in names:
        for d in ((os.path.join(HERE, 'host'), HERE) if host else (HERE, os.path.join(HERE, 'host'))):
            if os.path.exists(os.path.join(d, n)):
                return os.path.join(d, n)
    raise SystemExit('missing: %s' % (names,))


RULE, GATE, STEADY = find('bagfixrule.py'), find('bagfixgate.py'), find('drawsteady.py')
LOOP, DRAWREC, BAGREAD = find('canary-loop.sh', host=True), find('drawrec.sh', host=True), find('bagread.py', host=True)
T = []; SKIP = []
UTC = dt.timezone.utc


def t(name, ok, detail=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', name, '' if ok else '\n        -> ' + str(detail)[-600:]))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


TB = load(find('test_bagfix.py'), 'tb_for_threepool')
NOW = dt.datetime(2026, 10, 10, 18, 0, tzinfo=UTC)


def J(phase, min_ago, run='r'):
    return {'ts': (NOW - dt.timedelta(minutes=min_ago)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'run': run, 'phase': phase, 'note': ''}


# ------------------------------------------------------------------------------------------------ A. pure rule
def pure(BR):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    c('n_pools counts distinct stripped names', BR.n_pools({'canary_pool': 'a, b,a,,c '}) == 3 and BR.n_pools({}) == 0)
    c('extend_min: 4 -> 1440, 3 -> 1920, 2/5 -> None', BR.extend_min(4) == 1440 and BR.extend_min(3) == 1920
      and BR.extend_min(2) is None and BR.extend_min(5) is None)
    c('bands: 4 -> the shipped -3.21/-0.127, 3 -> -4.09/-0.173 (bagband3.py), 2 -> None',
      BR.bands(4) == (-3.21, -0.127) and BR.bands(3) == (-4.09, -0.173) and BR.bands(2) is None)
    ok = lambda rows: BR.three_pool_ok(rows, NOW)[0]
    S = lambda *m: [J('draw', 200)] + [J('draw-short', x) for x in m]
    c('three_pool_ok: short draws at -80..-20 (blocked 80 min) -> yes', ok(S(80, 60, 40, 20)))
    c('three_pool_ok: blocked exactly 60 min -> no (> 1 h)', not ok(S(60, 40, 20)))
    c('three_pool_ok: blocked 61 min -> yes', ok(S(61, 41, 21)))
    c('three_pool_ok: a `draw` row (band gave < 2, or a loop restart) at -30 breaks the streak -> no',
      not ok(S(100, 80, 60, 40) + [J('draw', 30), J('draw-short', 20)]))
    c('three_pool_ok: a 50-min silence inside the streak breaks it -> no (restarts at -40)', not ok(S(110, 90, 40, 20)) and ok(S(110, 90, 70, 50, 30, 10)))
    c('three_pool_ok: the last short draw 50 min ago -> no (not continuous)', not ok(S(120, 100, 80, 50)))
    c('three_pool_ok: no rows / only `draw` -> no', not ok([]) and not ok([J('draw', 100)]))
    c('three_pool_ok: an unreadable ts breaks the streak', not ok(S(100, 80) + [dict(J('draw-short', 60), ts='garbage'), J('draw-short', 40), J('draw-short', 20)]))
    c('three_pool_ok: other phases are ignored', ok(S(80, 60) + [J('preflight-ok', 50)] + [J('draw-short', 40), J('draw-short', 20)]))
    dd = lambda p, rows: BR.draw_decision(p, rows, NOW)[0]
    long_ = S(80, 60, 40, 20)
    c('draw_decision: four pools -> DEPLOY with no history', dd('a,b,c,d', []) == 'DEPLOY')
    c('draw_decision: three pools after > 1 h of short draws -> DEPLOY', dd('a,b,c', long_) == 'DEPLOY')
    c('draw_decision: three pools without it -> SHORT', dd('a,b,c', S(40, 20)) == 'SHORT')
    c('draw_decision: TWO pools, even after hours -> SHORT (never two)', dd('a,b', long_ + [J('draw-short', 1)]) == 'SHORT')
    c('draw_decision: four names that are three pools are THREE', dd('a,b,c,a', S(40, 20)) == 'SHORT')
    c('draw_decision: zero or one pool -> NONE', dd('', long_) == 'NONE' and dd('a', long_) == 'NONE')
    return out


# ------------------------------------------------------------------------------------------------ B. bagfixgate
C3 = TB.POOLS_C[:3]


def final_world_n(tmp, canary, E, minutes_in, skip_every=0, primary=-1.3, primary_minute=None):
    """PRE E + POST E of 2-min snapshots, as test_bagfix.final_world but for `canary` pools and window E. skip_every=k:
    canary POST bots idle on every k-th step (a loss of ~30/k log-eq per bot-h)."""
    w = TB.World(tmp, minutes_in)
    w.man['canary_pool'] = ','.join(canary); json.dump(w.man, open(os.path.join(w.d, 'man.json'), 'w'))
    pre = w.decl - dt.timedelta(minutes=E); end = min(w.decl + dt.timedelta(minutes=E), w.now)
    cb = set(w.bots(canary))
    for b in w.bots(TB.POOLS_C + TB.POOLS_K):
        tt = pre; n = 0; step = 0
        while tt < end:
            if b in cb and skip_every and tt >= w.decl and step % skip_every == 0:
                w.add(b, TB.line(tt, b, 'explore', inv={'oak_log': n}))
            else:
                n += 1
                if n > 60:
                    n = 0; w.add(b, TB.line(tt, b, 'deposit', inv={'oak_log': n}))
                else:
                    w.add(b, TB.line(tt, b, 'gather', inv={'oak_log': n}))
            tt += dt.timedelta(minutes=2); step += 1
    w.flush(); w.primary(primary, minute=primary_minute or E); w.extend_recorded()
    return w


def three_trip(tmp, pools):
    """test_bagfix's trip world re-declared on `pools`: own rows on hive-a bots too, 4 more control deaths on hive-b."""
    w = TB.trip_world(tmp)
    cb = w.bots(TB.POOLS_C)
    for b in w.bots(['hive-a']):
        for i in range(3):
            w.add(b, TB.line(w.decl + dt.timedelta(minutes=30 + 10 * i), b, '_well_dispose', dur=4000))
    for i, b in enumerate(w.bots(['hive-b'])[:4]):
        w.add(b, TB.line(w.decl + dt.timedelta(minutes=70 + 15 * i), b, '_death'))
    w.flush()
    w.man['canary_pool'] = ','.join(pools); json.dump(w.man, open(os.path.join(w.d, 'man.json'), 'w'))
    return w


_W = {}


def worlds(tmp):
    if tmp not in _W:
        _W[tmp] = {'k3': final_world_n(tmp, C3, 1920, 1980), 'early3': final_world_n(tmp, C3, 1920, 1500),
                   'slow3': final_world_n(tmp, C3, 1920, 1980, skip_every=2),
                   'mild3': final_world_n(tmp, C3, 1920, 1980, skip_every=8),
                   'only1440': final_world_n(tmp, C3, 1920, 1980, primary_minute=1440),
                   'k2': final_world_n(tmp, TB.POOLS_C[:2], 1920, 1980),
                   'tr3': three_trip(tmp, C3), 'tr2': three_trip(tmp, TB.POOLS_C[:2]), 'tr4': TB.trip_world(tmp)}
    return _W[tmp]


def gate(gate_py, tmp):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    W = worlds(tmp)
    w = W['k3']

    def cli(world, *a):
        env = dict(os.environ, BAGFIX_LOG_ROOT=world.logs, BAGFIX_MANIFEST=os.path.join(world.d, 'man.json'),
                   BAGFIX_REG_DIR=world.regs, BAGFIX_READS_DIR=world.reads, BAGFIX_JOURNAL=world.journal,
                   BAGFIX_NOW=world.now.isoformat())
        r = subprocess.run([sys.executable, gate_py] + list(a), capture_output=True, text=True, env=env, timeout=900)
        return (r.stdout.strip().splitlines() or [''])[-1] + (r.stderr[-300:] if r.stderr else '')
    # draw-decide on a fixture journal (this run's rows, plus another run's long streak that must not count)
    jw = W['tr4']; jr = jw.journal
    rows = lambda mins, run=TB.RUN: [json.dumps({'ts': (jw.now - dt.timedelta(minutes=m)).strftime('%Y-%m-%dT%H:%M:%SZ'),
                                                 'run': run, 'phase': ph, 'note': ''}, separators=(',', ':')) for ph, m in mins]
    # another run's short draws INSIDE this run's streak (file order): counted, they would make it 95 min
    open(jr, 'w').write('\n'.join(rows([('draw', 200)]) + rows([('draw-short', 95), ('draw-short', 75)], run='other-01')
                                  + rows([('draw-short', 50), ('draw-short', 30), ('draw-short', 10)])) + '\n')
    g = cli(jw, 'draw-decide', TB.RUN, 'board-a,board-b,hive-a')
    c('draw-decide: three pools, this run blocked 50 min (another run\'s rows would make it 95) -> DRAW SHORT', g.startswith('DRAW SHORT '), g)
    with open(jr, 'a') as f:
        f.write('\n'.join(rows([('draw-short', 0)])) + '\n')
    jw.now = jw.now + dt.timedelta(minutes=19)
    g = cli(jw, 'draw-decide', TB.RUN, 'board-a,board-b,hive-a')
    c('draw-decide: the same run 19 min later (blocked 69 min) -> DRAW DEPLOY', g.startswith('DRAW DEPLOY '), g)
    g = cli(jw, 'draw-decide', TB.RUN, 'board-a,board-b')
    c('draw-decide: two pools after the hour -> DRAW SHORT (never two)', g.startswith('DRAW SHORT '), g)
    g = cli(jw, 'draw-decide', TB.RUN, '')
    c('draw-decide: no pick -> DRAW NONE', g.startswith('DRAW NONE '), g)
    os.chmod(jr, 0)
    g = cli(jw, 'draw-decide', TB.RUN, 'board-a,board-b,hive-a')
    os.chmod(jr, 0o644)
    c('draw-decide: an unreadable journal -> DRAW SHORT (fail closed), never DEPLOY', g.startswith('DRAW SHORT ') or os.geteuid() == 0, g)
    jw.now = jw.now - dt.timedelta(minutes=19); jw.reset_journal()
    # ext-min
    c('ext-min: 4 pools -> EXTMIN 1440', cli(W['tr4'], 'ext-min', TB.RUN) == 'EXTMIN 1440', cli(W['tr4'], 'ext-min', TB.RUN))
    c('ext-min: 3 pools -> EXTMIN 1920', cli(W['tr3'], 'ext-min', TB.RUN) == 'EXTMIN 1920', cli(W['tr3'], 'ext-min', TB.RUN))
    c('ext-min: 2 pools -> EXTMIN NONE', cli(W['tr2'], 'ext-min', TB.RUN).startswith('EXTMIN NONE'), cli(W['tr2'], 'ext-min', TB.RUN))
    # extend-check
    W['tr3'].verdict(0)
    g = cli(W['tr3'], 'extend-check', TB.RUN, '0')
    c('extend-check at 3 pools: 0 linked, LB <= 2 -> EXTEND to 1920', 'BAGFIX EXTEND' in g and 'EXTEND to 1920' in g, g)
    W['tr2'].verdict(0)
    g = cli(W['tr2'], 'extend-check', TB.RUN, '0')
    c('extend-check at 2 pools -> REVERT (no calibrated extension)', 'BAGFIX REVERT' in g and 'no calibrated extension' in g, g)
    W['tr4'].verdict(0)
    g = cli(W['tr4'], 'extend-check', TB.RUN, '0')
    c('extend-check at 4 pools -> EXTEND to 1440 (unchanged)', 'BAGFIX EXTEND' in g and 'EXTEND to 1440' in g, g)
    W['tr3'].extend_recorded()
    g = cli(W['tr3'], 'poll', TB.RUN)
    c('poll at 3 pools reports "of 1920 min"', 'of 1920 min' in g, g)
    # final
    g = cli(w, 'final', TB.RUN)
    c('final at 3 pools, +1980, output level, bound +1920 bag metric moved -> KEEP with the 3-pool band', 'BAGFIX KEEP' in g
      and '3 pools: +1920' in g and '-4.09' in g, g)
    g = cli(W['early3'], 'final', TB.RUN)
    c('final at 3 pools asked at +1500 -> NOT_YET (before +1920; +1440 is not enough)', 'BAGFIX NOT_YET' in g and 'before +1920' in g, g)
    g = cli(W['slow3'], 'final', TB.RUN)
    c('final at 3 pools, canary output halved -> REVERT (c)', 'BAGFIX REVERT' in g and '(c)' in g, g)
    g = cli(W['mild3'], 'final', TB.RUN)
    m = re.search(r'net ([+-][\d.]+) >= ', g) or re.search(r'net DiD ([+-][\d.]+)', g)
    net = float(m.group(1)) if m else None
    c('fixture: the mild loss lies BETWEEN the 4-pool and 3-pool bands (-4.09 < net < -3.21)', net is not None and -4.09 < net < -3.21, g)
    c('final at 3 pools, a mild loss inside the 3-pool null -> KEEP (the 4-pool band would REVERT it)', 'BAGFIX KEEP' in g, g)
    g = cli(W['only1440'], 'final', TB.RUN)
    c('final at 3 pools with only a +1440 bag metric -> INCONCLUSIVE (evidence must be at +1920)', 'BAGFIX INCONCLUSIVE' in g, g)
    g = cli(W['k2'], 'final', TB.RUN)
    c('final at 2 pools -> REVERT (no calibrated window)', 'BAGFIX REVERT' in g and 'no calibrated' in g, g)
    return out


# ------------------------------------------------------------------------------------------------ C. drawsteady
def steady_pure(DS):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    now = NOW

    def L(dec, pools, h_ago, sha='aaa1111', run='x-01'):
        return {'canary_sha': sha, 'canary_pool': pools, 'decision': dec, 'note': '%s: VERDICT %s' % (run, dec),
                'ts': (now - dt.timedelta(hours=h_ago)).isoformat()}

    def P(run, sha, h_ago):
        return {'ts': (now - dt.timedelta(hours=h_ago)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'run': run, 'phase': 'promoted', 'note': sha + ' fleet-wide'}
    ca = lambda led, jr: DS.candidates(led, jr, now)
    k, h = ca([L('KEEP', 'p1,p2', 7)], [P('x-01', 'aaa1111', 6.8)])
    c('candidates: KEEP promoted fleet-wide 7 h ago -> both pools', set(k) == {'p1', 'p2'} and not h, (k, h))
    k, h = ca([L('KEEP', 'p1', 5)], [P('x-01', 'aaa1111', 4.8)])
    c('candidates: 5 h ago -> held (< 6 h)', not k and 'p1' in h, (k, h))
    k, h = ca([L('REVERT', 'p1', 7)], [])
    c('candidates: REVERT 7 h ago -> held (12 h)', not k and 'p1' in h, (k, h))
    k, h = ca([L('KEEP', 'p1', 7)], [])
    c('candidates: KEEP never promoted -> held', not k and 'p1' in h, (k, h))
    k, h = ca([L('KEEP', 'p1', 7)], [P('x-01', 'bbb2222', 6.8)])
    c('candidates: promoted a DIFFERENT sha -> held', not k and 'p1' in h, (k, h))
    k, h = ca([L('KEEP', 'p1', 7)], [P('x-01', 'aaa1111', 7.5)])
    c('candidates: a promotion BEFORE the decision -> held', not k and 'p1' in h, (k, h))
    k, h = ca([L('KEEP', 'p1', 7), L('REVERT', 'p1', 9, sha='ccc3333', run='y-01')], [P('x-01', 'aaa1111', 6.8)])
    c('candidates: the same pool REVERTed 9 h ago too -> held', not k and 'p1' in h, (k, h))
    k, h = ca([L('KEEP', 'p1', 13)], [P('x-01', 'aaa1111', 12.8)])
    c('candidates: 13 h ago -> neither (out of the 12-h window)', not k and not h, (k, h))
    k, h = ca([L('KEEP', 'p1', 7), dict(L('REVERT', 'p1', 0), ts=(now + dt.timedelta(minutes=3)).isoformat())], [P('x-01', 'aaa1111', 6.8)])
    c('candidates: a decision 3 min in the future (clock skew) HOLDS', not k and 'p1' in h, (k, h))
    k, h = ca([L('KEEP', 'p1', 7), dict(L('REVERT', 'p1', 0), ts=(now + dt.timedelta(hours=3)).isoformat())], [P('x-01', 'aaa1111', 6.8)])
    c('candidates: a decision 3 h in the future does not exist yet (replay) -> released', 'p1' in k, (k, h))
    k, h = ca([dict(L('KEEP', 'p1', 7), ts='bad')], [])
    c('candidates: an unreadable ts holds the pool', not k and 'p1' in h, (k, h))
    cand = ('x-01', 'aaa1111', now - dt.timedelta(hours=7))
    good = {'b%d' % i: {'rows': 50, 'versions': {'aaa1111'}, 'mean_slots': 30.0 + i} for i in range(5)}
    ctl = {'q1': 29.0, 'q2': 31.0, 'q3': 33.0, 'q4': 35.0}
    st = lambda stats=good, ctl=ctl, fv='aaa1111', fd=None: DS.steady('p1', cand, stats, ctl, fv, fd)[0]
    c('steady: all on the fleet version, bag 32 inside 29..35 -> 6 h', st())
    c('steady: fleet on another version, no later deploy -> 12 h', not st(fv='zzz9999'))
    zz = {b: dict(s, versions={'zzz9999'}) for b, s in good.items()}
    c('steady: fleet on a LATER deploy (declared after the decision), the pool on it -> 6 h; declared before -> 12 h',
      st(stats=zz, fv='zzz9999', fd=now - dt.timedelta(hours=1)) and not st(stats=zz, fv='zzz9999', fd=now - dt.timedelta(hours=8)))
    bad = dict(good, b0=dict(good['b0'], versions={'aaa1111', 'old0000'}))
    c('steady: one bot still wrote an old-build row in the hour (restart lag) -> 12 h', not st(stats=bad))
    few = dict(good, b0=dict(good['b0'], rows=5))
    c('steady: one bot with 5 rows in the hour -> 12 h', not st(stats=few))
    hi = {b: dict(s, mean_slots=36.0) for b, s in good.items()}
    c('steady: bag fill 36 above the control range -> 12 h (carryover)', not st(stats=hi))
    lo = {b: dict(s, mean_slots=28.0) for b, s in good.items()}
    c('steady: bag fill 28 below the control range -> 12 h', not st(stats=lo))
    c('steady: three control pools -> 12 h', not st(ctl={'q1': 29.0, 'q2': 31.0, 'q3': 35.0}))
    c('steady: control pools with no bag reading do not count', not st(ctl=dict(ctl, q4=None, q3=None)))
    nob = {b: dict(s, mean_slots=None if b in ('b0', 'b1', 'b2') else s['mean_slots']) for b, s in good.items()}
    c('steady: bag read on 2 bots only -> 12 h', not st(stats=nob))
    c('steady: no live bot -> 12 h', not st(stats={}))
    c('steady: unreadable fleet version -> 12 h', not st(fv=''))
    return out


def steady_cli(steady_py, tmp):
    """drawsteady.py end to end on fixture files. Pools p-a (candidate) and five controls; every bot writes 40 rows in the
    last hour carrying a bag."""
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    d = tempfile.mkdtemp(dir=tmp)
    shutil.copy(steady_py, os.path.join(d, 'drawsteady.py')); shutil.copy(BAGREAD, os.path.join(d, 'bagread.py'))
    now = dt.datetime.now(UTC).replace(microsecond=0)

    def world(cand_slots=31, old_row=False, decision='KEEP', promoted=True, hours=7):
        w = tempfile.mkdtemp(dir=d); logs = os.path.join(w, 'logs')
        pools = {'pool-a': cand_slots, 'pool-b': 28, 'pool-c': 30, 'pool-d': 32, 'pool-e': 34, 'pool-f': 29}
        for p, slots in pools.items():
            for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo'):
                b = '%s-%s' % (p, n); os.makedirs(os.path.join(logs, b))
                with open(os.path.join(logs, b, 'skill-x.jsonl'), 'w') as f:
                    for i in range(40):
                        tt = now - dt.timedelta(minutes=58 - i * 1.4)
                        v = 'old0000+x' if (old_row and p == 'pool-a' and n == 'Bravo' and i == 3) else 'aaa1111+x'
                        f.write(json.dumps({'@timestamp': tt.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {'version': v},
                                            'bot': {'name': b, 'inventory': {'cobblestone': 64 * slots}},
                                            'skill': {'name': 'gather', 'duration_ms': 0}}) + '\n')
        dec = now - dt.timedelta(hours=hours)
        open(os.path.join(w, 'ledger'), 'w').write(json.dumps({'canary_sha': 'aaa1111', 'canary_pool': 'pool-a', 'decision': decision,
                                                                'note': 'x-01: VERDICT %s' % decision, 'ts': dec.isoformat()}) + '\n')
        open(os.path.join(w, 'journal'), 'w').write((json.dumps({'ts': (dec + dt.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ'),
                                                                 'run': 'x-01', 'phase': 'promoted', 'note': 'aaa1111 fleet-wide'}) + '\n') if promoted else '')
        json.dump({'declared_code_version': 'aaa1111', 'declared_at': (dec + dt.timedelta(minutes=1)).isoformat(), 'canary_pool': ''},
                  open(os.path.join(w, 'man'), 'w'))
        return w

    def run(w, **kw):
        env = dict(os.environ, STEADY_LEDGER=os.path.join(w, 'ledger'), STEADY_JOURNAL=os.path.join(w, 'journal'),
                   STEADY_MANIFEST=os.path.join(w, 'man'), STEADY_LOGROOT=os.path.join(w, 'logs'), **kw)
        r = subprocess.run([sys.executable, os.path.join(d, 'drawsteady.py')], capture_output=True, text=True, env=env, timeout=300)
        rel = [l for l in r.stdout.splitlines() if l.startswith('STEADY RELEASE ')]
        return (rel[-1][len('STEADY RELEASE '):] if rel else 'NO_LINE'), r.stdout + r.stderr[-300:]
    g, o = run(world())
    c('drawsteady CLI: KEEP+promoted 7 h ago, one build, bag 31 inside 28..34 -> releases pool-a', g == "['pool-a']", o)
    g, o = run(world(cand_slots=40))
    c('drawsteady CLI: bag 40 outside 28..34 -> releases nothing (carryover)', g == '[]' and 'carryover' in o, o)
    g, o = run(world(old_row=True))
    c('drawsteady CLI: one old-build row in the hour -> releases nothing (restart lag)', g == '[]' and 'restart lag' in o, o)
    g, o = run(world(decision='REVERT'))
    c('drawsteady CLI: a REVERT -> releases nothing', g == '[]', o)
    g, o = run(world(promoted=False))
    c('drawsteady CLI: a KEEP never promoted -> releases nothing', g == '[]', o)
    g, o = run(world(hours=5))
    c('drawsteady CLI: 5 h ago -> releases nothing', g == '[]', o)
    w = world(); os.remove(os.path.join(w, 'ledger'))
    g, o = run(w)
    c('drawsteady CLI: ledger unreadable -> RELEASE [] (fail closed)', g == '[]' and 'unreadable' in o, o)
    w = world()      # a CONTROL bot's extra file is unreadable: its pool would still measure on the good file
    open(os.path.join(w, 'logs', 'pool-b-Bravo', 'skill-y.jsonl.gz'), 'wb').write(b'not gzip')
    g, o = run(w)
    c('drawsteady CLI: an unreadable log file (a control bot) -> RELEASE [] (fail closed)', g == '[]' and 'failed' in o, o)
    return out


# ------------------------------------------------------------------------------------------------ D. the loop's draw block
def block_of(loop_src):
    a = '  while true; do D=$(bash $H/mcai-analysis/drawrec.sh "$RUN" 2>&1 | tail -4);'
    z = '    [ -n "$P" ] && break; sleep 1200; done\n'
    assert loop_src.count(a) == 1 and loop_src.count(z) == 1, 'DRAW BLOCK ANCHORS'
    return loop_src[loop_src.index(a):loop_src.index(z) + len(z)]


HARNESS = r'''set -u
H="$1"; RUN="$2"; BAGFIX="$3"; BAGFIX_POOLS=4; CLK="$4"; J="$5"
_n=0
_iso() { python3 -c "import datetime as d, sys; print(d.datetime.fromtimestamp(int(sys.argv[1]), d.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))" "$(cat $CLK)"; }
journal() { printf '{"ts":"%s","run":"%s","phase":"%s","note":"%s"}\n' "$(_iso)" "$RUN" "$1" "$(echo "$2" | tr -d '"\\' | cut -c1-200)" >> "$J"; }
page() { echo "PAGE $1 $2" >> "$H/pages"; }
sleep() { echo $(( $(cat $CLK) + $1 )) > $CLK; }
'''


def loop_block(loop_path, gate_py, tmp):
    """Run the real draw block. Draws (stub drawrec, one pick per 20 min): a scripted list. -> (P, journal phases, pages)."""
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    blk = block_of(open(loop_path).read())
    if not shutil.which('timeout'):
        SKIP.append('the loop draw block runs `timeout` (coreutils): host only'); return out

    def run(picks, bagfix='1', journal0=()):
        d = tempfile.mkdtemp(dir=tmp); h = os.path.join(d, 'h'); os.makedirs(os.path.join(h, 'mcai-analysis'))
        shutil.copy(gate_py, os.path.join(h, 'mcai-analysis', 'bagfixgate.py'))
        shutil.copy(os.path.join(os.path.dirname(gate_py), 'bagfixrule.py') if os.path.exists(os.path.join(os.path.dirname(gate_py), 'bagfixrule.py')) else RULE,
                    os.path.join(h, 'mcai-analysis', 'bagfixrule.py'))
        if os.path.exists(os.path.join(os.path.dirname(gate_py), 'deathgate.py')):
            shutil.copy(os.path.join(os.path.dirname(gate_py), 'deathgate.py'), os.path.join(h, 'mcai-analysis', 'deathgate.py'))
        else:
            shutil.copy(find('deathgate.py'), os.path.join(h, 'mcai-analysis', 'deathgate.py'))
        q = os.path.join(d, 'picks')
        fmt = lambda p: ('DRAW (none, owner C): NONE (fewer than 2 eligible)' if p == '-' else
                         'DRAW (%d pools = %d bots, owner C): %r' % (len(p.split(',')), 5 * len(p.split(',')), p.split(',')))
        open(q, 'w').write(''.join(fmt(p) + '\n' for p in picks))
        open(os.path.join(h, 'mcai-analysis', 'drawrec.sh'), 'w').write('head -1 %s; tail -n +2 %s > %s.t; mv %s.t %s\n' % (q, q, q, q, q))
        clk = os.path.join(d, 'clk'); open(clk, 'w').write(str(int(NOW.timestamp())))
        jr = os.path.join(d, 'journal'); open(jr, 'w').write(''.join(l + '\n' for l in journal0))
        script = os.path.join(d, 'blk.sh')
        open(script, 'w').write(HARNESS + 'journal draw "waiting for two pools"\n' + blk + 'echo "PICKED=$P"\n')
        env = dict(os.environ, BAGFIX_JOURNAL=jr, BAGFIX_NOW='@' + clk)
        r = subprocess.run(['bash', script, h, TB.RUN, bagfix, clk, jr], capture_output=True, text=True, env=env, timeout=600)
        ph = [json.loads(l)['phase'] for l in open(jr) if l.strip()]
        got = [l[len('PICKED='):] for l in r.stdout.splitlines() if l.startswith('PICKED=')]
        pages = open(os.path.join(h, 'pages')).read() if os.path.exists(os.path.join(h, 'pages')) else ''
        return (got[-1] if got else 'NO_PICK'), ph, pages, r.stdout[-400:] + r.stderr[-400:]
    P, ph, pg, o = run(['a-x,b-x,c-x,d-x'])
    c('loop draw block: four pools at once -> drawn, nothing journalled but the start', P == 'a-x,b-x,c-x,d-x' and ph == ['draw'], (P, ph, o))
    P, ph, pg, o = run(['a-x,b-x,c-x'] * 5)
    c('loop draw block: three pools every 20 min -> SHORT x4, then DEPLOY on the 5th (blocked 80 min), journalled draw-three and paged',
      P == 'a-x,b-x,c-x' and ph == ['draw'] + ['draw-short'] * 4 + ['draw-three'] and 'THREE pools' in pg, (P, ph, pg, o))
    P, ph, pg, o = run(['a-x,b-x'] * 4 + ['a-x,b-x,c-x'])
    c('loop draw block: two-pool draws count toward the hour (blocked by the minimum), and the third pool then deploys',
      P == 'a-x,b-x,c-x' and ph[-1] == 'draw-three', (P, ph, o))
    P, ph, pg, o = run(['a-x,b-x'] * 8 + ['a-x,b-x,c-x,d-x'])
    c('loop draw block: two pools for 2.7 h never deploy (never two); four then do', P == 'a-x,b-x,c-x,d-x' and ph.count('draw-short') == 8, (P, ph, o))
    P, ph, pg, o = run(['a-x,b-x,c-x'] * 2 + ['-'] + ['a-x,b-x,c-x'] * 4 + ['a-x,b-x,c-x,d-x'])
    c('loop draw block: a band-empty draw restarts the clock (journalled `draw`), so 3 more short draws are not enough',
      P == 'a-x,b-x,c-x,d-x' and ph.count('draw') == 2 and 'draw-three' not in ph, (P, ph, o))
    P, ph, pg, o = run(['a-x,b-x,c-x', 'a-x,b-x,c-x,d-x'], bagfix='')
    c('loop draw block: an ordinary canary takes three pools at once (unchanged, no bag-fix rows)', P == 'a-x,b-x,c-x' and ph == ['draw'], (P, ph, o))
    old = [json.dumps({'ts': (NOW - dt.timedelta(minutes=m)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'run': TB.RUN, 'phase': 'draw-short', 'note': ''})
           for m in (300, 280, 260)]
    P, ph, pg, o = run(['a-x,b-x,c-x', 'a-x,b-x,c-x,d-x'], journal0=old)
    c('loop draw block: an old streak before this loop\'s start does not count (the start row breaks it)',
      P == 'a-x,b-x,c-x,d-x' and 'draw-three' not in ph, (P, ph, o))
    return out


def strip_comments(src):
    return '\n'.join(l for l in src.splitlines() if not l.lstrip().startswith('#'))


def structural(loop_path, drawrec_path):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    L = strip_comments(open(loop_path).read())
    c('loop: no literal EXTMIN=1440 remains', not re.search(r'^\s*EXTMIN=1440\s*$', L, re.M))
    c('loop: EXTMIN is parsed from `bagfixgate.py ext-min` (numeric field 2 of an EXTMIN line)',
      '"$BF" ext-min "$RUN"' in L and """awk '$1 == "EXTMIN" && $2 ~ /^[0-9]+$/ {print $2}'""" in L)
    c('loop: no EXTMIN = REVERT, decided before the extension phase runs',
      re.search(r'if \[ -z "\$EXTMIN" \]; then _decide REVERT', L) is not None)
    c('loop: the containment deadline moves with the window (+ $EXTMIN - 1440)', "or 1560) + $EXTMIN - 1440)" in L)
    R = strip_comments(open(drawrec_path).read())
    i12 = R.find("if (now - ts).total_seconds() < 12 * 3600:"); isub = R.find('excl -= _early'); iman = R.find("man = json.loads(txt.split('=== MANIFEST')[1])")
    c('drawrec: the release is subtracted AFTER the 12-h ledger loop and BEFORE the live canary is added',
      0 < i12 < isub < iman, (i12, isub, iman))
    c('drawrec: _early comes only from a STEADY RELEASE line of drawsteady.py, and starts empty',
      "_early = set()\n" in R and "if _l.startswith('STEADY RELEASE '):" in R and "drawsteady.py'" in R)
    c('drawrec: a failed drawsteady releases nothing', "except Exception as _e:\n    _early = set()" in R)
    return out


MUTANTS = [
    ('bagfixrule.py', 'three pools at exactly 60 min', '    if blocked > THREE_POOL_AFTER_MIN:', '    if blocked >= THREE_POOL_AFTER_MIN:'),
    ('bagfixrule.py', 'a `draw` row does not break the streak', "        if ph == 'draw' or t is None or", "        if t is None or"),
    ('bagfixrule.py', 'silence inside the streak ignored', "or (last is not None and (t - last).total_seconds() > THREE_POOL_GAP_MIN * 60):", "or False:"),
    ('bagfixrule.py', 'stale last short draw ignored', "    if last is not None and (now - last).total_seconds() > THREE_POOL_GAP_MIN * 60:\n", "    if False:\n"),
    ('bagfixrule.py', 'two pools deploy', "    if n == 3:\n        ok, why = three_pool_ok(rows, now)", "    if n in (2, 3):\n        ok, why = three_pool_ok(rows, now)"),
    ('bagfixrule.py', 'three pools deploy at once', "        ok, why = three_pool_ok(rows, now)\n        if ok:", "        ok, why = True, 'x'\n        if ok:"),
    ('bagfixrule.py', 'duplicates counted as pools', "    n = len({p.strip() for p in ps if p and p.strip()})", "    n = len([p for p in ps if p and p.strip()])"),
    ('bagfixrule.py', 'three pools get 24 h', "EXTEND_MIN_BY_POOLS = {4: EXTEND_MIN, 3: 1920}", "EXTEND_MIN_BY_POOLS = {4: EXTEND_MIN, 3: 1440}"),
    ('bagfixrule.py', 'three pools get the four-pool bands', "BANDS_BY_POOLS = {4: (NET_P025, IRON_P025), 3: (-4.09, -0.173)}", "BANDS_BY_POOLS = {4: (NET_P025, IRON_P025), 3: (NET_P025, IRON_P025)}"),
    ('bagfixgate.py', 'final ignores the pool count for the bands', "net, BD[0], iron, BD[1])", "net, BR.NET_P025, iron, BR.IRON_P025)"),
    ('bagfixgate.py', 'final window fixed at 24 h', "end = cut + dt.timedelta(minutes=E); pre = cut - dt.timedelta(minutes=E)",
     "end = cut + dt.timedelta(minutes=BR.EXTEND_MIN); pre = cut - dt.timedelta(minutes=BR.EXTEND_MIN)"),
    ('bagfixgate.py', 'final evidence at +1440 always', "    moved, pwhy = primary_at_final(run, reg, man, E)", "    moved, pwhy = primary_at_final(run, reg, man, BR.EXTEND_MIN)"),
    ('bagfixgate.py', 'extend-check at any pool count', "    if E is None:\n        return emit(run, 'extend', M, 'REVERT'", "    if False:\n        return emit(run, 'extend', M, 'REVERT'"),
    ('bagfixgate.py', 'draw-decide errors deploy', "        word, why = 'SHORT', 'draw decision failed", "        word, why = 'DEPLOY', 'draw decision failed"),
    ('bagfixgate.py', 'draw-decide counts other runs', "                if isinstance(r, dict) and r.get('run') == run:\n                    rows.append(r)\n            word", "                if isinstance(r, dict):\n                    rows.append(r)\n            word"),
    ('canary-loop.sh', 'any DRAW answer keeps the pick', '        "DRAW DEPLOY "*)\n', '        "DRAW "*)\n'),
    ('canary-loop.sh', 'a band-empty draw not journalled', '          journal draw "${_DD#DRAW NONE } :: ', '          true "${_DD#DRAW NONE } :: '),
    ('canary-loop.sh', 'a short draw keeps the pick', '          journal draw-short "${_DD#DRAW SHORT } -- the band gave ${P:-nothing}; waiting 20 min"; P=""',
     '          journal draw-short "${_DD#DRAW SHORT } -- the band gave ${P:-nothing}; waiting 20 min"'),
    ('canary-loop.sh', 'the decision skipped for bag fixes', '    if [ -n "$BAGFIX" ]; then\n      _DD=', '    if false; then\n      _DD='),
    ('canary-loop.sh', 'deadline not moved', "or 1560) + $EXTMIN - 1440)", "or 1560))"),
    ('drawrec.sh', 'release subtracted after the live canary', "excl -= _early\n", "pass\n"),
    ('drawsteady.py', 'any decision qualifies', "        if row.get('decision') != 'KEEP':", "        if False:"),
    ('drawsteady.py', 'promotion not required', "        elif not prom:", "        elif False:"),
    ('drawsteady.py', 'no 6-h floor', "        elif age_h < EARLY_H:", "        elif False:"),
    ('drawsteady.py', 'a held pool can still be released', "    return {p: v for p, v in ok.items() if p not in held}, held", "    return ok, held"),
    ('drawsteady.py', 'clock skew ignored', "        if t > now + dt.timedelta(minutes=10):", "        if t > now:"),
    ('drawsteady.py', 'promotion before the decision accepted', "if s == sha and pt is not None and t <= pt <= now]", "if s == sha and pt is not None]"),
    ('drawsteady.py', 'restart lag ignored', "        if s['versions'] != {fv}:", "        if fv not in s['versions']:"),
    ('drawsteady.py', 'row floor ignored', "        if s['rows'] < MIN_ROWS:", "        if False:"),
    ('drawsteady.py', 'carryover ignored', "    if not (lo <= pm <= hi):", "    if False:"),
    ('drawsteady.py', 'too few control pools accepted', "    if len(cm) < MIN_CONTROL_POOLS:", "    if False:"),
    ('drawsteady.py', 'fleet version not checked', "    if fv != sha and not (fleet_declared_at is not None and fleet_declared_at >= decided):", "    if False:"),
    ('drawsteady.py', 'unreadable logs ignored', "                if bad:\n                    raise OSError", "                if False:\n                    raise OSError"),
]


def all_cases(paths, tmp, quick=False):
    BR = load(paths['bagfixrule.py'], 'br_%d' % abs(hash(paths['bagfixrule.py'])))
    DS = load(paths['drawsteady.py'], 'ds_%d' % abs(hash(paths['drawsteady.py'])))
    res = pure(BR) + steady_pure(DS)
    if quick and not all(ok for _n, ok, _d in res):
        return res
    res += structural(paths['canary-loop.sh'], paths['drawrec.sh']) + steady_cli(paths['drawsteady.py'], tmp)
    if quick and not all(ok for _n, ok, _d in res):
        return res
    res += loop_block(paths['canary-loop.sh'], paths['bagfixgate.py'], tmp)
    if quick and not all(ok for _n, ok, _d in res):
        return res
    return res + gate(paths['bagfixgate.py'], tmp)


if __name__ == '__main__':
    tmp = tempfile.mkdtemp(prefix='threepool-')
    FILES = {'bagfixrule.py': RULE, 'bagfixgate.py': GATE, 'drawsteady.py': STEADY, 'canary-loop.sh': LOOP, 'drawrec.sh': DRAWREC,
             'deathgate.py': find('deathgate.py')}

    def copies(mut=None):
        d = tempfile.mkdtemp(dir=tmp)
        for f, p in FILES.items():
            shutil.copy(p, os.path.join(d, f))
        if mut:
            f, old, new = mut
            open(os.path.join(d, f), 'w').write(open(FILES[f]).read().replace(old, new, 1))
        return {f: os.path.join(d, f) for f in FILES}
    for n, ok, d in all_cases(FILES, tmp):
        t(n, ok, d)
    ctl = all_cases(copies(), tmp)
    t('mutant runner control: the UNMUTATED copies pass every case (%d)' % len(ctl), ctl and all(ok for _n, ok, _d in ctl),
      [n for n, ok, _d in ctl if not ok])
    CTL_OK = bool(ctl) and all(ok for _n, ok, _d in ctl) and all(T)
    print('\nmutants (copies; anchors present and unique):')
    for f, name, old, new in MUTANTS:
        src = open(FILES[f]).read()
        assert src.count(old) == 1, 'ANCHOR %s: %s (%d)' % (f, name, src.count(old))
        if not CTL_OK:
            t('mutant NOT SCORED: %s (the unmutated cases fail)' % name, False); continue
        if f == 'canary-loop.sh' and 'EXTMIN' not in old and not shutil.which('timeout'):
            SKIP.append('canary-loop.sh draw-block mutants: host only'); continue
        try:
            res = all_cases(copies((f, old, new)), tmp, quick=True)
            failed = [n for n, ok, _d in res if not ok]
        except AssertionError as e:
            failed = ['assertion: %s' % e]
        except Exception as e:
            failed = ['raised %s' % type(e).__name__]
        t('mutant killed: %s: %s' % (f, name), bool(failed), 'SURVIVED')
    for x in sorted(set(SKIP)):
        print('SKIPPED  ' + x)
    print('\n%d/%d pass%s' % (sum(T), len(T), ('; %d SKIPPED (not passes)' % len(set(SKIP))) if SKIP else ''))
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(0 if all(T) else 1)
