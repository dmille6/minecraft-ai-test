#!/usr/bin/env python3
"""Behaviour tests for goalboard.py's pure decisions, on SYNTHETIC rows shaped the way the bots write them.

    python3 scripts/host/test_goalboard.py            (exit 1 on any failure; needs no ES and no network)

Each decision that sets a scoreboard number is asked through goalboard's own functions, then MUTATED (bottom): a mutant
must change the answer, and its anchor must be present exactly once in the source (CLAUDE.md: a mutant that silently
fails to apply reads as "killed").
"""
import datetime as dt, importlib.util, os, sys, tempfile, types

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'goalboard.py')
UTC = dt.timezone.utc
T0 = dt.datetime(2026, 10, 18, tzinfo=UTC)


def load(src_text=None):
    # goalboard imports lib.estelemetry at module level; the pure functions never touch it, so stub it
    lib = types.ModuleType('lib'); est = types.ModuleType('lib.estelemetry')
    est.EsEvents = object; est.ZeroLooksWrong = type('ZeroLooksWrong', (LookupError,), {}); est.http = None
    sys.modules.setdefault('lib', lib); sys.modules['lib.estelemetry'] = est
    path = SRC
    if src_text is not None:
        fd, path = tempfile.mkstemp(suffix='.py'); os.write(fd, src_text.encode()); os.close(fd)
    spec = importlib.util.spec_from_file_location('gb_%d' % id(path), path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    if src_text is not None:
        os.unlink(path)
    return m


def disp(at=None, pos=(364.5, 74, 137.5), pool='board-a', bot='board-a-Alpha', t=T0):
    d = 'slots=36->35 freed=1 n=5' + (' at=%d,%d,%d stop=done' % at if at else '')
    return {'@timestamp': t.isoformat().replace('+00:00', 'Z'), 'skill': {'name': '_well_dispose', 'detail': d, 'status': 'success'},
            'bot': {'name': bot, 'pos': {'x': pos[0], 'y': pos[1], 'z': pos[2]}}, 'exp': {'pool': pool}}


def cases(g):
    out = []
    c = lambda name, ok, got=None: out.append((name, bool(ok), got))
    # wood: a log -> planks craft consumes nothing; a crafting table consumes one log; a stone pickaxe's sticks count
    c('wood: log->4 planks consumes 0', g.wood_used({'oak_log': -1, 'oak_planks': 4}) == 0, g.wood_used({'oak_log': -1, 'oak_planks': 4}))
    c('wood: crafting table consumes 1 log-eq', g.wood_used({'oak_planks': -4, 'crafting_table': 1}) == 1)
    c('wood: stone pickaxe (planks -2, sticks +2 made, then -2 used) via net delta', abs(g.wood_used({'spruce_planks': -2, 'stick': 2, 'cobblestone': -2}) - 0.25) < 1e-9,
      g.wood_used({'spruce_planks': -2, 'stick': 2, 'cobblestone': -2}))
    c('wood: a row that GAINED wood consumed 0, not a negative', g.wood_used({'oak_planks': 2, 'stick': 2, 'iron_shovel': 1}) == 0,
      g.wood_used({'oak_planks': 2, 'stick': 2, 'iron_shovel': 1}))
    # world grouping: isolated bots log their own pool
    c('world: self-isolated-a-Alpha -> isolated-a', g.pool_group('self-isolated-a-Alpha') == 'isolated-a')
    c('world: board-b stays board-b', g.pool_group('board-b') == 'board-b')
    # wells: a truncated row lands on the well it stood at, a far one is unlocated, never a new well
    rows = [disp(at=(364, 73, 137)), disp(at=None, pos=(364.7, 74, 136.2), bot='board-a-Bravo'),
            disp(at=None, pos=(500.0, 64, 500.0), bot='board-a-Comet')]
    loc = g.locate_wells(rows, {})
    c('wells: truncated row joins the at= well', loc[1][2] == (364, 73, 137), loc[1][2])
    c('wells: a row far from every known well is unlocated', loc[2][2] is None, loc[2][2])
    loc2 = g.locate_wells([disp(at=None, pos=(-246.5, 73, 135.5), pool='board-b')], {'board-b': [(-247, 72, 135)]})
    c('wells: truncated row uses a KNOWN site when no at= row exists today', loc2[0][2] == (-247, 72, 135), loc2[0][2])
    two = g.locate_wells([disp(at=(-76, 59, -75), pool='hive-c'), disp(at=(-79, 59, -74), pool='hive-c')], {})
    c('wells: two wells 3 blocks apart stay two', len({k for _, _, k in two}) == 2)
    # raised: only once the plinth is complete, and only near its cap
    cap = [(364, 73, 137, T0 + dt.timedelta(hours=2))]
    c('raised: before the plinth was done it is natural', not g.is_raised((364, 73, 137), T0, cap))
    c('raised: after it is raised', g.is_raised((364, 73, 137), T0 + dt.timedelta(hours=3), cap))
    c('raised: a well 6 blocks away is not', not g.is_raised((370, 73, 137), T0 + dt.timedelta(hours=3), cap))
    # streaks: everything inside the window; a death BEFORE the window is not seen, so the first interval is censored
    W0, W1 = T0 - dt.timedelta(days=6), T0 + dt.timedelta(days=1)
    D = {'a': [T0 - dt.timedelta(days=3), T0 + dt.timedelta(hours=10)], 'b': [], 'c': [W0 - dt.timedelta(days=1)],
         'd': [W0 + dt.timedelta(hours=1), W0 + dt.timedelta(hours=2)]}
    s = g.streaks(D, ['a', 'b', 'c', 'd'], W0, W1)
    c('streak: longest is the 82 h BETWEEN the two in-window deaths, exact (the 72 h before the first is shorter)',
      s['a']['longest_h'] == 82.0 and not s['a']['longest_censored'], s['a'])
    s2 = g.streaks({'e': [W0 + dt.timedelta(hours=100)]}, ['e'], W0, W1)
    c('streak: the 100 h from the window start to the first death is CENSORED (a death before the window is unseen)',
      s2['e']['longest_h'] == 100.0 and s2['e']['longest_censored'], s2['e'])
    c('streak: current = 14 h since the last death, exact', s['a']['current_h'] == 14.0 and not s['a']['current_censored'], s['a'])
    c('streak: no death -> whole window, censored, 0 deaths in window',
      s['b']['longest_h'] == 168.0 and s['b']['longest_censored'] and s['b']['deaths_in_window'] == 0, s['b'])
    c('streak: a death before the window counts as none in it; current capped at the window (168 h)',
      s['c']['deaths_in_window'] == 0 and s['c']['current_h'] == 168.0, s['c'])
    c('streak: between two in-window deaths is exact (1 h) but the longest is the 166 h run to the end, censored',
      s['d']['longest_h'] == 166.0 and s['d']['longest_censored'] and s['d']['deaths_in_window'] == 2, s['d'])
    # a truncated at= that still parses is never trusted (reviewer 10-19: 'at=240,69,-15' for -151)
    cut = ('slots=36->35 offlist=0 gclicked=0 stone=724 swords=0 sword_lost=0 sword_kept=0 cobble=0 cap=unknown '
           'offlist_items=- unnamed=0 freed=1 tossed=1 n=5 misses=0 aim_off=0 aim_read=1 retaken=0 recollected=0 '
           'nonlisted=0 other_loss=0 server=resync closed_open=0 cap_end=closed')
    cut = (cut + ' ' * 300)[:300 - len(' at=240,69,-15')] + ' at=240,69,-15'
    c('well_at: a 300-char detail ending in at= is truncated -> None', len(cut) == 300 and g.well_at(cut) is None, (len(cut), g.well_at(cut)))
    c('well_at: a short detail ending in at= is whole', g.well_at('n=5 at=240,69,-151') == (240, 69, -151))
    c('well_at: at= followed by more tokens is whole even at 300', g.well_at(('x' * 250) + ' at=240,69,-151 stop=done items=pp' + 'y' * 20) == (240, 69, -151))
    rr = disp(at=None, pos=(240.5, 70, -150.5), pool='placebo-a')
    rr['skill']['detail'] = cut
    loc3 = g.locate_wells([rr], {'placebo-a': [(240, 69, -151)]})
    c('wells: a truncated at= row lands on the real well by bot.pos, not a fake one', loc3[0][2] == (240, 69, -151), loc3[0][2])
    # census: a world census3 could not read is not an empty town
    cs2 = g.chest_summary({'worlds': {'ok': {'containers': [{'items': []}], 'incomplete': []},
                                      'bad': {'containers': [], 'incomplete': [], 'error': 'ConnectionError: rcon closed'}}})
    c('chests: a failed world is listed, not counted as 0 containers', cs2['worlds'] == 1 and 'bad' in cs2['worlds_failed'], cs2)
    # town box for the generic chest verbs
    fake = types.SimpleNamespace(homes={'board-a': [355, 73, 147]})
    c('town: a deposit at the bank is town', g.Day.in_town(fake, disp(pos=(360.5, 72, 150.5))))
    c('town: a deposit 200 blocks away is not', not g.Day.in_town(fake, disp(pos=(555.5, 64, 150.5))))
    c('town: no known home -> not town', not g.Day.in_town(fake, disp(pool='hive-c', pos=(-68, 68, -68))))
    # census choice: the closest to the day's end within [start, end + 3 h]; none -> None (not zero)
    f = [('x', T0 + dt.timedelta(hours=13)), ('y', T0 + dt.timedelta(hours=20)), ('z', T0 + dt.timedelta(hours=26))]
    c('census: closest to day end wins', g.pick_census(f, T0, T0 + dt.timedelta(days=1))[0] == 'z')
    c('census: none in range -> None', g.pick_census(f, T0 + dt.timedelta(days=3), T0 + dt.timedelta(days=4)) is None)
    cs = g.chest_summary({'worlds': {'w': {'containers': [{'items': [{'id': 'minecraft:cobblestone', 'count': 64}] * 27},
                                                          {'items': [{'id': 'minecraft:dirt', 'count': 3}]}], 'incomplete': []}}})
    c('chests: one full of two, 28/54 slots', cs['full'] == 1 and cs['slots_used'] == 28 and cs['slots'] == 54, cs)
    # kv must not read 'at' out of 'cap_end=closed' or 'n' out of 'gclicked'
    c('kv: at= is the whole key', g.kv('cap_end=closed nat=9 at=1,2,3', 'at') == '1,2,3')
    c('kv: n= is the whole key', g.kv('gclicked=10 n=5', 'n') == '5')
    # metric: a rate only per bot-hour
    c('metric: % is not divided again', 'rate' not in g.metric(67.7, '%', 's', 'w', ('deaths with a position', 31)))
    c('metric: per bot-hour rate', g.metric(31, 'deaths', 's', 'w', ('active bot-hours', 1920))['rate'] == round(31 / 1920, 4))
    return out


MUTANTS = [
    ('wood floor removed', '    return max(0.0, -eq)', '    return -eq'),
    ('truncated rows invent wells', "                if k not in keys[w]:\n                    keys[w].append(k)\n        out.append((r, w, k))",
     "                if k not in keys[w]:\n                    keys[w].append(k)\n            else:\n                k = b\n        out.append((r, w, k))"),
    ('raised ignores completion time', 'and (c[3] is None or c[3] <= t)', ''),
    ('streak edge never censored', 'cens = (a is None) or z == w_end', 'cens = False'),
    ('census closest-to-end flipped', "if best is None or abs((started - d_end).total_seconds()) < abs((best[1] - d_end).total_seconds()):",
     "if best is None:"),
    ('kv substring match', "m = re.search(r'(?:^|\\s)%s=(\\S+)' % re.escape(key), detail or '')", "m = re.search(r'%s=(\\S+)' % re.escape(key), detail or '')"),
    ('rate on everything', "            rate_ok = 'bot-hours' in what", '            rate_ok = True'),
    ('truncated at= trusted', "    if p and len(d) >= DETAIL_CAP and re.search(r'(?:^|\\s)at=\\S+$', d):", '    if False:'),
    ('census error read as empty', "        if v.get('error'):", '        if False:'),
    ('pre-window death counted in window', "inside = [t for t in deaths.get(b, []) if w_start <= t < w_end]",
     "inside = [t for t in deaths.get(b, []) if t < w_end]"),
    ('town box ignored', "        return abs(pos['x'] - h[0]) <= TOWN_XZ and", "        return True or abs(pos['x'] - h[0]) <= TOWN_XZ and"),
    ('chest full threshold off by one', 'if len(c.get(\'items\') or []) >= CHEST_SLOTS)', 'if len(c.get(\'items\') or []) > CHEST_SLOTS)'),
]


def main():
    g = load()
    res = cases(g)
    bad = [r for r in res if not r[1]]
    for name, ok, got in res:
        print('%s %s%s' % ('PASS' if ok else 'FAIL', name, '' if ok else '  got %r' % (got,)))
    src = open(SRC).read()
    for name, old, new in MUTANTS:
        n = src.count(old)
        assert n == 1, 'ANCHOR %s for mutant %r' % ('MISSING' if n == 0 else 'NOT UNIQUE (%d)' % n, name)
        mres = cases(load(src.replace(old, new, 1)))
        killed = any(not ok for _, ok, _ in mres)
        print('%s mutant: %s' % ('KILLED' if killed else 'SURVIVED', name))
        if not killed:
            bad.append((name, False, 'mutant survived'))
    print('%d checks, %d mutants, %d problems' % (len(res), len(MUTANTS), len(bad)))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
