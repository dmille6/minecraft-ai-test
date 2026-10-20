#!/usr/bin/env python3
"""Behaviour tests for frontiercensus.py's pure decisions (E0), plus MUTANTS that must be killed.

    python3 -B scripts/host/test_frontiercensus.py      (exit 1 on any failure; needs no ES and no network)

The fixture world and its hand-worked answers live in frontiercensus.selftest() (every live mode runs it first). This
file adds boundary cases the fixture does not reach, then mutates each decision: a mutant must make the suite fail, and
its anchor must be present EXACTLY ONCE in the source (CLAUDE.md: a mutant that silently fails to apply reads as
"killed"). Comments are stripped before anchoring, so an anchor can never match the explanation of the code.
"""
import importlib.util
import io
import contextlib
import os
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'frontiercensus.py')


def load(text=None):
    path = SRC
    if text is not None:
        fd, path = tempfile.mkstemp(suffix='.py', prefix='_fc_mutant_', dir=HERE)   # same dir: the checker resolves
        with os.fdopen(fd, 'w') as f:
            f.write(text)
    try:
        spec = importlib.util.spec_from_file_location(f'fc_{abs(hash(path))}', path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m
    finally:
        if text is not None:
            os.unlink(path)


def cases(m):
    """-> [(name, ok)]. Boundary behaviour the fixture does not reach."""
    out = []
    c = lambda name, ok: out.append((name, bool(ok)))     # noqa: E731
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
    chk = m.load_checker()
    c('checker: a void tick alarms even when fresh',
      any(x.startswith('FrontierVoid') for x in chk.assess(['{"mode":"tick","at":"2026-10-20T11:59:00Z","status":"void",'
                                                            '"newest_measured_hour_end":"2026-10-20T11:00:00Z"}'],
                                                           m.ms_of('2026-10-20T12:00:00Z') / 1000)[0]))
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, 'out', 'publish', 'p'))
        os.makedirs(os.path.join(td, '_pool-p'))
        import json
        doc = {'pool': 'p', 'home': [1, 2, 3], 'digest': 'abc', 'generated_at': '2026-10-20T11:00:00Z',
               'warmup': {'complete': True}, 'data_until': 'x'}
        with open(os.path.join(td, 'out', 'publish', 'p', 'frontier-1_2_3.json'), 'w') as f:
            json.dump(doc, f)
        now = m.ms_of('2026-10-20T12:00:00Z') / 1000
        c('checker: a warm staged frontier never published alarms after 15 min',
          any(x.startswith('FrontierPublishStale') for x in chk.assess_publish(os.path.join(td, 'out'), td, now)[0]))
        m.create_gen(os.path.join(td, '_pool-p'), 'frontier-1_2_3', doc)
        c('checker: once published (same digest) it is quiet', chk.assess_publish(os.path.join(td, 'out'), td, now)[0] == [])
    return out


def run_all(m):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        st = m.selftest(verbose=False)
    res = cases(m)
    run_all.why = [ln.strip()[3:] for ln in buf.getvalue().split('\n') if ln.strip().startswith('!!')] + \
        [n for n, ok in res if not ok]
    return st, res


def strip_comments(src):
    out = []
    for line in src.split('\n'):
        s = line.lstrip()
        out.append('' if s.startswith('#') else line)
    return '\n'.join(out)


# (name, anchor, replacement) -- each anchor must occur exactly once in the comment-stripped source
MUTANTS = [
    ('band upper bound inclusive', "if d >= lo and (hi is None or d < hi):", "if d >= lo and (hi is None or d <= hi):"),
    ('coverage ignores the 80% rule', "'covered': bool(M) and ratio >= COVER_SHARE,", "'covered': True,"),
    ('uncovered reads not_observed', "status = 'visited' if g else ('not_observed' if covered else 'unknown')",
     "status = 'visited' if g else 'not_observed'"),
    ('hazard radius dropped', "near = [p for p in hz if rect_dist(p[0], p[1], i, j) <= HAZARD_R]",
     "near = [p for p in hz if rect_dist(p[0], p[1], i, j) <= 0]"),
    ('hazard age ignored', "if isinstance(t, (int, float)) and now_ms - HAZARD_MS < t <= now_ms + HOUR_MS:",
     "if isinstance(t, (int, float)):"),
    ('site kind ignored', "if str(s.get('kind', '')).startswith('death:') and", "if True and"),
    ('border margin dropped', "lim = border_r - BORDER_MARGIN", "lim = border_r"),
    ('unreached counts any reason', "if reason == 'no_route':", "if True:"),
    ('histogram key read as an index', "i, j = int(round(xb['key'] / GRID)), int(round(zb['key'] / GRID))",
     "i, j = int(xb['key']), int(zb['key'])"),
    ('bot-minutes count rows', "regions[pool][k][1] = len(s)", "regions[pool][k][1] = regions[pool][k][0]"),
    ('subset control blind', "if k not in ((by_h.get(r['h0']) or {}).get('regions') or {}).get(p, {}):", "if False:"),
    ('warm-up never restarts on a gap', "if last is None or t - last > WARMUP_GAP_MIN * MIN_MS:", "if last is None:"),
    ('generation overwrites', "os.link(tmp, final)", "os.replace(tmp, final)"),
    ('ranking ignores the away half-plane', "return (WATER_RANK[c['water']], 0 if (al is None or al >= 0) else 1,",
     "return (WATER_RANK[c['water']], 0,"),
    ('wet and dry swapped', "if g[5] / g[4] >= LABEL_SHARE:", "if (g[4] - g[6]) / g[4] >= LABEL_SHARE:"),
    ('depth sign', "return 'deep' if (y - home_y) < DEEP_DY else 'surface'", "return 'deep' if (y - home_y) > DEEP_DY else 'surface'"),
    ('pick threshold', "if (mx - (x.get('used', 0) or 0)) / max(1, mx) >= 0.4:", "if (mx - (x.get('used', 0) or 0)) / max(1, mx) >= 0.0:"),
    ('home start band from the end position', "sp = prev_pos(bot, t)", "sp = (p.get('x'), p.get('y'), p.get('z'))"),
    ('bag eligibility ignores at-town', "e = sl <= 24 and gp and (hp or 0) >= 18 and at", "e = sl <= 24 and gp and (hp or 0) >= 18"),
    ('presence uses the oldest row', "if k0 not in newest or r['t'] >= newest[k0]['t']:", "if k0 not in newest:"),
    ('part day not pro-rated', "scale = 24 / D['hours'] if D['hours'] else 0", "scale = 1 if D['hours'] else 0"),
    ('unpositioned rows folded', "if r.get('x') is None or r.get('z') is None:\n            continue\n        b = bots",
     "if False:\n            continue\n        b = bots"),
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
    src = open(SRC).read()
    code = strip_comments(src)
    for name, old, new in MUTANTS:
        n = code.count(old)
        if n != 1:
            fails.append(f'MUTANT {name}: anchor occurs {n} times in the comment-stripped source (must be 1)')
            print(f'  FAIL mutant {name}: ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE"} ({n})')
            continue
        assert src.count(old) >= 1
        mut = src.replace(old, new) if src.count(old) == 1 else code.replace(old, new)
        try:
            mm = load(mut)
            mst, mres = run_all(mm)
            killed = (not mst) or any(not ok for _, ok in mres)
            why = run_all.why[0][:110] if run_all.why else '-'
        except Exception as e:                                  # a mutant that crashes the suite is killed
            killed, why = True, f'CRASH {type(e).__name__}: {e}'[:110]
        print(f'  {"ok " if killed else "FAIL"} mutant killed: {name}  <- {why}')
        if not killed:
            fails.append(f'MUTANT SURVIVED: {name}')
    if fails:
        print(f'FAILED ({len(fails)}):')
        for f in fails:
            print('  !! ' + f)
        return 1
    print(f'ALL OK: {len(res)} behaviour cases, selftest, {len(MUTANTS)} mutants killed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
