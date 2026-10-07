#!/usr/bin/env python3
"""ugsafe2_analyse.py <rowsdir> <out.pkl>  -- underground safety phase 2 (2026-10-07): one pass per bot over the
ugsafe2_extract.py pickles (rows already deduplicated and SORTED BY t). Produces, for every bot:

  bins      5-minute bins {bin: Counter} -- bot-seconds (gaps capped 120 s, y carried forward), underground seconds
            (y < 56, phase 1's definition) and per-band seconds, items gained (bagcost.py's definition: the positive
            step in total items between consecutive snapshots), mine / _ore_tunnel / gather rows, deaths by cause,
            water episodes (all / oxygen-critical / sealed / fatal), climbs and climb->water hits, items and iron
            pickaxes carried at death.
  deaths    one record per `_death` row: cause, depth, activity, fall height, milestone (the decision stream), the bag
            (pickaxe uses, iron pickaxes, placeable blocks, buckets, items), the entry route and the 180 s before.
  episodes  water-family episodes (climbfloodread's a4 kinds, 90 s gaps): start/end, y, critical, sealed, fatal and
            the entry route in the 30 s before the first water row (phase 1's priority order).
  climbs    runs of `_scaffold_pick` pillar_out/dig_straight_up rows < 15 s apart; hit = a water episode starting
            within 20 s after the climb's last row with no water row in the 60 s before the climb (phase 1 a12).
"""
import sys, os, re, glob, pickle, bisect, json
from collections import Counter, defaultdict
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ugsafe2_extract import (F_T, F_BOT, F_KIND, F_STATUS, F_DETAIL, F_X, F_Y, F_Z, F_HP, F_FOOD, F_VER, F_POOL,
                             F_DUR, F_HELD, F_ARGS, F_PICK, F_IRONPICK, F_BLOCKS, F_BUCKET, F_WBUCKET, F_NITEMS,
                             F_DELTA, F_FULLINV, F_TRIGGER, F_RUN, PLACEABLE)

WATER = {'_oxygen_critical_state', '_air_drowning_observed', '_drowning_route', '_drowning_up', '_drowning_ceiling_no_air',
         '_drowning_rescue_yielded', '_flooded_pocket_rung', '_water_no_air_route', '_reflex_drowning',
         '_drowning_to_air', '_drowning_breathing', '_flooded_pocket_side_exit', '_water_surface_out'}
CRIT = {'_oxygen_critical_state', '_reflex_drowning'}
GAP, CAP, UG_Y, BIN = 90, 120, 56, 300
BANDS = [(63, 1e9, 'b63'), (55, 63, 'b55'), (40, 55, 'b40'), (16, 40, 'b16'), (0, 16, 'b0'), (-1e9, 0, 'bneg')]
FELL = re.compile(r'fell (\d+)')
FALLING = re.compile(r'after falling (\d+) blocks')
SKILLS_ENTRY = ['mine', 'gather', 'surface', 'goto', 'explore']
ESCAPE_KINDS = {'_entombed_ramp_cut', '_marooned_ramp_cut', '_climb_flood_ramp', '_entombed', '_marooned',
                '_marooned_underfoot', '_stranded_escape_try'}


def band(y):
    for lo, hi, n in BANDS:
        if lo <= y < hi:
            return n
    return None


def cause_of(d):
    d = d or ''
    if 'drown' in d: return 'drowning'
    if 'lava' in d or 'fire' in d or 'flames' in d or 'burn' in d: return 'lava'
    if 'suffocat' in d: return 'suffocation'
    if 'fell' in d or 'falling' in d or 'impaled' in d or 'hit the ground' in d: return 'fall'
    return 'other'


def activity_of(d):
    m = re.search(r'was running (\w+)', d or '')
    if m: return m.group(1)
    if 'idle at the moment' in (d or ''): return 'idle'
    return '?'


def bag_at_death(full):
    try:
        j = json.loads(full) if full else {}
    except Exception:
        j = {}
    inv = j.get('inventory') if isinstance(j.get('inventory'), dict) else {}
    tools = j.get('tools') if isinstance(j.get('tools'), dict) else {}
    pick, iron = -1, 0
    for k, v in tools.items():
        if k.endswith('_pickaxe') and isinstance(v, list):
            for e in v:
                left = (e.get('max', 0) - e.get('used', 0)) if isinstance(e, dict) else 0
                pick = max(pick, left)
                if k in ('iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe') and left > 0:
                    iron += 1
    return {'pick': pick, 'iron_pick': iron,
            'blocks': sum(c for k, c in inv.items() if isinstance(c, (int, float)) and PLACEABLE.search(k)),
            'bucket': inv.get('bucket', 0), 'water_bucket': inv.get('water_bucket', 0),
            'items': sum(c for c in inv.values() if isinstance(c, (int, float))),
            'iron_items': sum(inv.get(k, 0) for k in ('raw_iron', 'iron_ingot', 'iron_ore', 'deepslate_iron_ore')),
            'torch': inv.get('torch', 0), 'ladder': inv.get('ladder', 0)}


def entry_route(rows, ts, t0, back=30.0, fwd=2.0):
    """Phase 1's priority order over the rows in [t0-back, t0+fwd]: fall>=3 > pillar_out > dig_straight_up > escape
    dig > mine > ore_tunnel > gather > surface > goto > explore > other skill > none. Skill rows are stamped at their
    START and cover [t, t+duration]."""
    lo = bisect.bisect_left(ts, t0 - back); hi = bisect.bisect_right(ts, t0 + fwd)
    tags = set()
    fall = 0
    for r in rows[lo:hi]:
        k, d = r[F_KIND], r[F_DETAIL] or ''
        if k == '_fall_path':
            m = FELL.search(d)
            if m: fall = max(fall, int(m.group(1)))
        elif k == '_scaffold_pick':
            tags.add(d.split(':', 1)[0])
        elif k in ESCAPE_KINDS:
            tags.add('escape')
        elif k == '_ore_tunnel':
            tags.add('ore_tunnel')
    # skills covering t0 (started up to 10 min before)
    lo2 = bisect.bisect_left(ts, t0 - 600)
    running = None
    for r in rows[lo2:hi]:
        k = r[F_KIND]
        if k.startswith('_'):
            continue
        dur = (r[F_DUR] or 0) / 1000.0
        if r[F_T] - 1 <= t0 + fwd and r[F_T] + dur >= t0 - back:
            running = k   # the latest skill overlapping the window
            if k in SKILLS_ENTRY or k == 'mine':
                tags.add(k)
            else:
                tags.add('skill:' + k)
    if fall >= 3: return 'fall', fall, tags
    for p in ('pillar_out', 'dig_straight_up', 'escape', 'mine', 'ore_tunnel', 'gather', 'surface', 'goto', 'explore'):
        if p in tags: return p, fall, tags
    other = sorted(t for t in tags if t.startswith('skill:'))
    if other: return other[0], fall, tags
    return 'none', fall, tags


def analyse_bot(res, llm_ms):
    rows = res['rows']
    ts = [r[F_T] for r in rows]
    bins = defaultdict(Counter)
    vers = defaultdict(Counter)
    pool = None
    # OBSERVATIONS ARE RE-TIMED (Codex review 10-07): a skill row is stamped at its START but its bot snapshot (pos,
    # inventory) is taken at its END, so the snapshot is placed at t + duration before exposure and items are carried
    # forward. Underscore rows are instantaneous. The trapped-bots analysis found this moves headline totals < 0.2 pt.
    obs = sorted(((r[F_T] + ((r[F_DUR] or 0) / 1000.0 if not r[F_KIND].startswith('_') else 0.0), r[F_Y], r[F_NITEMS], r[F_HP], r[F_KIND])
                  for r in rows), key=lambda o: o[0])
    lasty, prev_items = None, None
    for i, (to, y, nit, hp, kind) in enumerate(obs):
        b = int(to // BIN)
        if y is not None: lasty = y
        if i + 1 < len(obs):
            gap = min(obs[i + 1][0] - to, CAP)
            if gap > 0:
                bins[b]['sec'] += gap
                if lasty is not None:
                    if lasty < UG_Y: bins[b]['ug'] += gap
                    bins[b][band(lasty)] += gap
        if nit is not None and hp is not None:
            if prev_items is not None and kind != '_death':
                bins[b]['gained'] += max(0, nit - prev_items)
            prev_items = nit
    lasty = None
    for i, r in enumerate(rows):
        t = r[F_T]
        b = int(t // BIN)
        if r[F_POOL]: pool = r[F_POOL]
        if r[F_VER]: vers[b][r[F_VER]] += 1
        if r[F_Y] is not None: lasty = r[F_Y]
        k = r[F_KIND]
        if k == 'mine':
            bins[b]['mine'] += 1
            if lasty is not None and lasty < UG_Y: bins[b]['mine_ug'] += 1
        elif k == '_ore_tunnel':
            bins[b]['ore_tunnel'] += 1
        elif k == 'gather':
            bins[b]['gather'] += 1
            if lasty is not None and lasty < UG_Y: bins[b]['gather_ug'] += 1
        elif k == 'explore':
            bins[b]['explore'] += 1
            if lasty is not None and lasty < 0: bins[b]['explore_deep'] += 1
    # ---- water episodes
    eps = []
    cur = None
    for i, r in enumerate(rows):
        if r[F_KIND] not in WATER: continue
        if cur and r[F_T] - cur['last'] <= GAP:
            cur['last'] = r[F_T]; cur['n'] += 1
        else:
            if cur: eps.append(cur)
            cur = {'start': r[F_T], 'last': r[F_T], 'n': 1, 'i0': i, 'y': r[F_Y]}
        if r[F_KIND] in CRIT: cur['crit'] = True
        d = r[F_DETAIL] or ''
        if r[F_KIND] == '_drowning_ceiling_no_air' or (r[F_KIND] == '_drowning_route' and ('sealed' in d or 'unscanned' in d)):
            cur['sealed'] = True
    if cur: eps.append(cur)
    deaths = []
    death_idx = [i for i, r in enumerate(rows) if r[F_KIND] == '_death']
    for i in death_idx:
        r = rows[i]
        d = r[F_DETAIL] or ''
        c = cause_of(d)
        m = FALLING.search(d)
        rec = {'t': r[F_T], 'bot': r[F_BOT], 'pool': r[F_POOL] or pool, 'ver': r[F_VER], 'x': r[F_X], 'y': r[F_Y], 'z': r[F_Z],
               'cause': c, 'activity': activity_of(d), 'fell': int(m.group(1)) if m else 0, 'detail': d,
               'bag': bag_at_death(r[F_FULLINV])}
        j = bisect.bisect_right(llm_ms[0], r[F_T]) - 1
        rec['milestone'] = llm_ms[1][j] if j >= 0 and r[F_T] - llm_ms[0][j] < 1800 else None
        rec['last_skill'] = llm_ms[2][j] if j >= 0 and r[F_T] - llm_ms[0][j] < 1800 else None
        # episode containing / just before the death
        ep = None
        for e in eps:
            if e['start'] - 1 <= r[F_T] <= e['last'] + 30:
                ep = e
        rec['episode'] = None
        if ep:
            ep['fatal'] = True
            rec['episode'] = {'start': ep['start'], 'len': r[F_T] - ep['start'], 'sealed': ep.get('sealed', False),
                              'crit': ep.get('crit', False), 'y0': ep['y']}
            route, fall, tags = entry_route(rows, ts, ep['start'])
        else:
            route, fall, tags = entry_route(rows, ts, r[F_T])
        rec['entry'], rec['entry_fall'], rec['entry_tags'] = route, fall, sorted(tags)
        lo = bisect.bisect_left(ts, r[F_T] - 180)
        rec['ctx'] = [(round(x[F_T] - r[F_T], 1), x[F_KIND], x[F_STATUS], (x[F_DETAIL] or '')[:220], x[F_Y], x[F_DUR], x[F_ARGS][:60] if x[F_ARGS] else '')
                      for x in rows[lo:i + 1]]
        rec['ctx_ms'] = [(round(t - r[F_T], 1), ms, sk, oc) for t, ms, sk, oc in zip(*llm_ms) if -600 <= t - r[F_T] <= 0][-6:]
        bins[int(r[F_T] // BIN)]['death_' + c] += 1
        bins[int(r[F_T] // BIN)]['death'] += 1
        bins[int(r[F_T] // BIN)]['lost_items'] += rec['bag']['items']
        bins[int(r[F_T] // BIN)]['lost_ironpick'] += rec['bag']['iron_pick']
        if r[F_Y] is not None and r[F_Y] < UG_Y:
            bins[int(r[F_T] // BIN)]['death_ug'] += 1
        deaths.append(rec)
    eprec = []
    for e in eps:
        b = int(e['start'] // BIN)
        bins[b]['wep'] += 1
        if e.get('crit'): bins[b]['wep_crit'] += 1
        if e.get('sealed'): bins[b]['wep_sealed'] += 1
        if e.get('fatal'): bins[b]['wep_fatal'] += 1
        route, fall, tags = entry_route(rows, ts, e['start']) if (e.get('sealed') or e.get('fatal')) else (None, 0, set())
        eprec.append({'bot': rows[e['i0']][F_BOT], 'start': e['start'], 'end': e['last'], 'n': e['n'], 'y': e['y'],
                      'crit': e.get('crit', False), 'sealed': e.get('sealed', False), 'fatal': e.get('fatal', False),
                      'entry': route, 'entry_tags': sorted(tags)})
    # ---- climbs
    ep_starts = [e['start'] for e in eps]
    water_ts = [r[F_T] for r in rows if r[F_KIND] in WATER]
    climbs = []
    cur = None
    ly = None
    for r in rows:
        if r[F_Y] is not None: ly = r[F_Y]   # `_scaffold_pick` rows carry no position: carry the last known y
        if r[F_KIND] == '_scaffold_pick' and (r[F_DETAIL] or '').split(':', 1)[0] in ('pillar_out', 'dig_straight_up'):
            if cur and r[F_T] - cur['end'] < 15:
                cur['end'] = r[F_T]; cur['n'] += 1
            else:
                if cur: climbs.append(cur)
                cur = {'start': r[F_T], 'end': r[F_T], 'n': 1, 'y': ly}
    if cur: climbs.append(cur)
    for c in climbs:
        j = bisect.bisect_left(water_ts, c['start'] - 60)
        dry = not (j < len(water_ts) and water_ts[j] < c['start'])
        k = bisect.bisect_left(ep_starts, c['start'])
        hit = None
        while k < len(eps) and eps[k]['start'] <= c['end'] + 20:
            hit = eps[k]; break
        b = int(c['start'] // BIN)
        bins[b]['climb'] += 1
        if c['y'] is not None and c['y'] < UG_Y: bins[b]['climb_ug'] += 1
        if dry and hit:
            bins[b]['climb_hit'] += 1
            if hit.get('sealed'): bins[b]['climb_hit_sealed'] += 1
            if hit.get('fatal'): bins[b]['climb_hit_fatal'] += 1
    # guard/refusal rows from climbflood
    for r in rows:
        if r[F_KIND] in ('_climb_flood_guard', '_climb_flood_refused', '_climb_flood_breach', '_lava_corridor',
                         '_reflex_danger_block', '_explore_blind_step_refused', '_lava_adjacent_no_retreat',
                         '_lava_adjacent_stand_off'):
            k = r[F_KIND]
            if k == '_reflex_danger_block' and 'lava' not in (r[F_DETAIL] or ''):
                continue
            bins[int(r[F_T] // BIN)][k] += 1
    return pool, dict(bins), dict(vers), deaths, eprec


if __name__ == '__main__':
    rowsdir, out = sys.argv[1], sys.argv[2]
    ALL = {'bins': {}, 'vers': {}, 'pool': {}, 'deaths': [], 'episodes': [], 'rows': 0}
    for f in sorted(glob.glob(os.path.join(rowsdir, '*.pkl'))):
        res = pickle.load(open(f, 'rb'))
        llm = res['llm']
        llm_ms = ([x[0] for x in llm], [x[1] for x in llm], [x[2] for x in llm], [x[3] for x in llm])
        bot = os.path.basename(f)[:-4]
        pool, bins, vers, deaths, eps = analyse_bot(res, llm_ms)
        ALL['bins'][bot] = bins; ALL['vers'][bot] = vers; ALL['pool'][bot] = pool
        ALL['deaths'] += deaths; ALL['episodes'] += eps; ALL['rows'] += len(res['rows'])
        print(bot, len(res['rows']), len(deaths), len(eps), flush=True)
    ALL['deaths'].sort(key=lambda d: d['t'])
    pickle.dump(ALL, open(out, 'wb'), protocol=4)
    print('rows', ALL['rows'], 'deaths', len(ALL['deaths']), 'episodes', len(ALL['episodes']))
