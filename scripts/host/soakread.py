#!/usr/bin/env python3
"""The test world's SOAK READ: what one release did in 3 hours on a copy of the showcase town, and under the load step.
Plan: docs/reports/testworld-plan-2026-11-18.md. Runbook: docs/runbooks/testworld.md.

    soakread.py --run NAME            on block2-bots: collect, judge, write /srv/testworld/soak/NAME/soak-read.{md,json}

It exists because two memory defects reached the live showcase on 11-17/18 after 44-minute rig runs: one needed 100+ minutes,
one needed reconnects (about 15-22 MB of chunk data kept per reconnect, reconnleak-01show). So it reports, per bot:
memory every 5 minutes (the unit's cgroup), reconnects from the Paper server's own log lines, AND THE TWO SIDE BY SIDE,
because that pairing is what found the leak; deaths (the server's statistics and the bots' rows, which must agree);
restarts and kernel memory kills; blocks placed and cleared per hour from the block-history database; model calls.
Every number carries its denominator, and every "none" sits beside a count that shows the instrument could see.

The verdict is a pure function of the collected inputs (build_report), so the test drives it with lines in the hosts' own
shapes. FAIL names what broke; INCONCLUSIVE means the read could not see enough to say; PASS is neither.
"""
import argparse, datetime as dt, json, os, re, sqlite3, statistics, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

ROOT = '/srv/testworld'
CAP_MB = 1536                 # mctest@.service MemoryMax
NEAR_CAP = 0.85               # a bot at 85% of its ceiling in the untouched 3 hours has no room left: FAIL
SLOPE_FLAG = 100.0            # MB/h over the last 90 untouched minutes: named, not failed, until several runs set a band
LEAK_MB = 8.0                 # MB of chunk buffers kept per forced reconnect: the fixed build keeps one old world at most
#                               between collections (<= 22 MB over 6 reconnects = 3.7); the leak kept 14-22 MB EACH
LEAK_MIN_RECONNECTS = 4       # a bot with fewer forced reconnects says nothing about the leak
LEAK_MIN_BOTS = 10            # and fewer bots than this is not the town
RECOVER_MIN = 10              # minutes after the last pause ends for every bot to be back in the world
DEATHS_FAIL = 2               # the death gate's floor: one death is named, two fail
SAMPLE_S = 300

JOIN = re.compile(r'^\[\d\d:\d\d:\d\d INFO\]: (\S+) joined the game$')
LOST = re.compile(r'^\[\d\d:\d\d:\d\d INFO\]: (\S+) lost connection: (.*)$')
MEM = re.compile(r'^\[(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.\d+Z\] \w+\s+memory rss_mb=(\d+) heap_used_mb=(\d+) .*?array_buffers_mb=(\d+)')
OOM = re.compile(r'(?i)out of memory|oom-kill')
# PROTECTED ZONES (the pool's protected-zones.json: villages and the trial chambers, kept as scenery; the showcase tripwire's
# S4). 11-18 15:13Z: a spruce sapling a marooned bot planted at 121,67,-8 grew into a tree inside village-taiga-6_1 and the
# tripwire stopped the town. The copy runs the same code on the same ground, so the read reports what the bots aimed at,
# were refused, and did inside every zone box. Reported and named; never part of the verdict.
GROWTH_MARGIN = 8             # protectzone.mjs GROWTH_MARGIN: no plant spot within a zone box grown by 8 on x and z
AT = re.compile(r'\bfound at=(-?\d+),(-?\d+),(-?\d+)')
ORDER = re.compile(r'^place (\{.*?\}) ')
XYZ = re.compile(r'^(-?\d+),(-?\d+),(-?\d+)$')
# The block history credits a grown tree's logs and leaves to whoever planted the sapling (seen 11-18: "showcase-Lumen placed
# spruce_log" five times in one second at the sapling's block), and to `#tree` when nobody did. Nothing a bot does places a
# log or a leaf inside a zone (every placement there is refused), so either one inside a zone box is a tree that grew.
TREE = re.compile(r'(_log|_leaves|_wood)$')
GROWS = re.compile(r'(sapling|propagule|seeds|wheat|carrots|potatoes|beetroots|bone_meal|sugar_cane|bamboo|cactus|kelp|berry|stem|nether_wart|vine|azalea|moss)')

# ------------------------------------------------------------------------------------------------ pure
def ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp()


def hm(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%H:%M')


def paper_events(lines, bots):
    """[(epoch, message)] of the Paper server's console -> [(epoch, bot, 'join'|'lost', reason)] for the named bots. Pure."""
    out = []
    for t, msg in lines:
        m = JOIN.search(msg)
        if m and m.group(1) in bots:
            out.append((t, m.group(1), 'join', None))
            continue
        m = LOST.search(msg)
        if m and m.group(1) in bots:
            out.append((t, m.group(1), 'lost', m.group(2).strip()[:60]))
    return sorted(out)


def reconnects(events, bots, a, b):
    """Per bot in [a, b): joins (each one is a reconnect: every bot was in the world when the soak began) and why each
    connection was lost. Pure."""
    out = {x: {'joins': 0, 'lost': {}} for x in bots}
    for t, bot, kind, reason in events:
        if a <= t < b:
            if kind == 'join':
                out[bot]['joins'] += 1
            else:
                out[bot]['lost'][reason] = out[bot]['lost'].get(reason, 0) + 1
    return out


def slope_mb_h(points):
    """Least-squares slope of [(epoch, mb)] in MB per hour; None under 6 points. Pure."""
    if len(points) < 6:
        return None
    xs = [(t - points[0][0]) / 3600.0 for t, _ in points]
    ys = [v for _, v in points]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    den = sum((x - mx) ** 2 for x in xs)
    return round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den, 1) if den else None


def mem_stats(samples, bot, a, b):
    """The cgroup memory of one bot's unit over [a, b) from the 5-minute samples. A sample of a stopped unit carries
    mem_mb None and is counted as `down`, never as 0 MB. Pure."""
    rows = [(ts(r['t']), r.get('mem_mb')) for r in samples if r.get('bot') == bot and a <= ts(r['t']) < b]
    pts = [(t, v) for t, v in rows if v is not None]
    if not pts:
        return {'n': 0, 'down': len(rows)}
    vals = [v for _, v in pts]
    return {'n': len(pts), 'down': len(rows) - len(pts), 'first': vals[0], 'last': vals[-1], 'min': min(vals),
            'median': round(statistics.median(vals), 1), 'max': max(vals), 'share_of_cap': round(max(vals) / CAP_MB, 3),
            'slope_last90_mb_h': slope_mb_h([(t, v) for t, v in pts if t >= b - 5400])}


def restarts(samples, bot, a, b):
    """Scheduled restarts of the unit across [a, b] (NRestarts, last minus first seen). None when it was never seen. Pure."""
    vals = [r['restarts'] for r in samples if r.get('bot') == bot and a <= ts(r['t']) <= b and r.get('restarts') is not None]
    return (vals[-1] - vals[0]) if vals else None


def memory_lines(lines, unit_prefix='mctest@'):
    """[(unit, message)] of the bots' journal -> [(epoch, bot, rss_mb, heap_used_mb, array_buffers_mb)]: the bot's own
    `memory` line (process.memoryUsage every 5 min, and whenever rss moved 40 MB). Pure."""
    out = []
    for unit, msg in lines:
        m = MEM.match(msg)
        if m and unit.startswith(unit_prefix):
            bot = unit[len(unit_prefix):].split('.service')[0]
            out.append((ts(m.group(1) + '+00:00'), bot, int(m.group(2)), int(m.group(3)), int(m.group(4))))
    return sorted(out)


def med(vals):
    return round(statistics.median(vals), 1) if vals else None


def leak_table(mem, events, bots, pauses_start, load_end):
    """For each bot: chunk buffers (array_buffers_mb, the bot's own line) in the 15 min before the load step and in the
    last 10 min of it, the reconnects forced in between, and the MB kept per reconnect. `pauses_start` is the START OF THE
    LOAD STEP: a bot the CPU squeeze drops reconnects too, and that reconnect counts and keeps memory like any other. Pure."""
    out = {}
    for bot in bots:
        before = [ab for t, b, _, _, ab in mem if b == bot and pauses_start - 900 <= t < pauses_start]
        after = [ab for t, b, _, _, ab in mem if b == bot and load_end - 600 <= t <= load_end]
        rss_b = [r for t, b, r, _, _ in mem if b == bot and pauses_start - 900 <= t < pauses_start]
        rss_a = [r for t, b, r, _, _ in mem if b == bot and load_end - 600 <= t <= load_end]
        n = sum(1 for t, b, kind, _ in events if b == bot and kind == 'join' and pauses_start <= t <= load_end)
        row = {'forced_reconnects': n, 'buffers_before_mb': med(before), 'buffers_after_mb': med(after),
               'rss_before_mb': med(rss_b), 'rss_after_mb': med(rss_a), 'mb_per_reconnect': None}
        if n and before and after:
            row['mb_per_reconnect'] = round((row['buffers_after_mb'] - row['buffers_before_mb']) / n, 1)
        out[bot] = row
    return out


def back_in_world_minutes(events, bots, last_continue):
    """Minutes after the last pause ended until every bot is in the world at once: 0 when they all already are, None when
    that never happens. The server's join and lost lines are replayed, so a bot that drops again LATER for another reason
    is a separate reconnect and not a slow recovery (11-18: every bot was back 12 s after the last pause, one dropped
    with "Disconnected" 14 minutes on and rejoined in 10 s, and the first version of this rule failed the run on it). Pure."""
    here = {b: True for b in bots}                 # every bot is in the world when a soak begins
    after = []
    for t, b, kind, _ in sorted(events):
        if b not in here:
            continue
        if t <= last_continue:
            here[b] = kind == 'join'
        else:
            after.append((t, b, kind))
    if all(here.values()):
        return 0.0
    for t, b, kind in after:
        here[b] = kind == 'join'
        if all(here.values()):
            return round((t - last_continue) / 60.0, 1)
    return None


def death_delta(start, end):
    """{bot: deaths} from the server's own statistics at the start and the end ({bot: count}); a bot missing at either end
    is None, never 0. Pure."""
    return {b: (end[b] - start[b]) if b in start and b in end else None for b in sorted(set(start) | set(end))}


def zone_of(zones, x, y, z, margin=0, use_y=True):
    """The id of the first zone whose box [x1, y1, z1, x2, y2, z2] (grown by `margin` on x and z) holds the point, or None. Pure."""
    for zn in zones:
        x1, y1, z1, x2, y2, z2 = zn['box']
        if x1 - margin <= x <= x2 + margin and z1 - margin <= z <= z2 + margin and (not use_y or y1 <= y <= y2):
            return zn['id']
    return None


def zone_report(zones, rows, first_pos, last_pos, history):
    """What the bots aimed at, were refused and did inside the protected zones. Pure.
    rows: [(epoch, bot, skill name, args, detail, status, (x, y, z) or None)];  first_pos / last_pos: {bot: (x, y, z)};
    history: [(epoch, user, x, y, z, material, action)] from the block history, action 1 = placed, 0 = broken."""
    out = {'zones': len(zones), 'spots': {'n': 0, 'in_zone': [], 'near': []}, 'orders': {'n': 0, 'in_zone': []},
           'planted': {'n': 0, 'in_zone': []}, 'refused': {}, 'refused_n': 0, 'refused_with_remedy': 0,
           'walks': {}, 'walk_out_inside': [], 'rescue': {}, 'deaths': {'n': 0, 'in_zone': []},
           'history': {'placed_in_zone': {}, 'grows_in_zone': [], 'tree_in_zone': 0, 'tree_logs': [], 'broken_in_zone': {}},
           'inside_at_end': [], 'started_inside': {}}
    def spot(kind, t, bot, x, y, z):
        out[kind]['n'] += 1
        zid = zone_of(zones, x, y, z)
        if zid:
            out[kind]['in_zone'].append((t, bot, x, y, z, zid))
        return zid
    for t, bot, name, args, detail, status, pos in rows:
        args, detail = args or {}, detail or ''
        if name == '_plant_spot':
            m = AT.search(detail)
            if m:
                x, y, z = map(int, m.groups())
                if not spot('spots', t, bot, x, y, z) and zone_of(zones, x, y, z, GROWTH_MARGIN, use_y=False):
                    out['spots']['near'].append((t, bot, x, y, z, zone_of(zones, x, y, z, GROWTH_MARGIN, use_y=False)))
        elif name == '_work_order':
            m = ORDER.match(detail)
            if m:
                try:
                    a = json.loads(m.group(1))
                except ValueError:
                    continue
                if GROWS.search(str(a.get('item', ''))) and all(isinstance(a.get(k), (int, float)) for k in 'xyz'):
                    spot('orders', t, bot, int(a['x']), int(a['y']), int(a['z']))
        elif name == 'place' and status == 'success' and GROWS.search(str(args.get('item', ''))) \
                and all(isinstance(args.get(k), (int, float)) for k in 'xyz'):
            spot('planted', t, bot, int(args['x']), int(args['y']), int(args['z']))
        elif name == '_protect_zone_refused':
            f = dict(re.findall(r'(\w+)=(\S*)', detail.split(' | ')[0]))
            key = f"op={f.get('op', '?')} purpose={f.get('purpose', '?')} struct={f.get('struct', '?')}"
            out['refused'][key] = out['refused'].get(key, 0) + 1
            out['refused_n'] += 1
            out['refused_with_remedy'] += 1 if 'walk out first (goto ' in detail else 0
        elif name == '_zone_walk':
            f = dict(re.findall(r'(\w+)=(\S*)', detail))
            oc = f.get('outcome', '?')
            out['walks'][oc] = out['walks'].get(oc, 0) + 1
            m = XYZ.match(f.get('to', ''))
            if oc == 'out' and m and zone_of(zones, *map(int, m.groups()), use_y=False):
                out['walk_out_inside'].append((t, bot, f.get('to')))
        elif name == '_needs_rescue' and 'arm=zone_walk' in detail:
            out['rescue'][bot] = out['rescue'].get(bot, 0) + 1
        elif name == '_death':
            out['deaths']['n'] += 1
            if pos and zone_of(zones, *pos):
                out['deaths']['in_zone'].append((t, bot, tuple(round(v) for v in pos), zone_of(zones, *pos)))
    h = out['history']
    for t, user, x, y, z, material, action in history:
        if not zone_of(zones, x, y, z):
            continue
        mat = material.replace('minecraft:', '')
        if action == 1 and (user == '#tree' or TREE.search(mat)):
            h['tree_in_zone'] += 1
            if mat.endswith('_log'):
                h['tree_logs'].append((t, user, x, y, z, mat))
        elif user == '#tree':
            continue
        elif action == 1:
            h['placed_in_zone'][mat] = h['placed_in_zone'].get(mat, 0) + 1
            if GROWS.search(mat):
                h['grows_in_zone'].append((t, user, x, y, z, mat))
        elif action == 0:
            h['broken_in_zone'][user] = h['broken_in_zone'].get(user, 0) + 1
    for bot, pos in sorted(last_pos.items()):
        if pos and zone_of(zones, *pos):
            out['inside_at_end'].append((bot, tuple(round(v) for v in pos), zone_of(zones, *pos)))
    for bot, pos in sorted(first_pos.items()):
        if pos and zone_of(zones, *pos):
            end = last_pos.get(bot)
            walks = {}
            for t, b, name, args, detail, status, _ in rows:
                if b == bot and name == '_zone_walk':
                    oc = dict(re.findall(r'(\w+)=(\S*)', detail or '')).get('outcome', '?')
                    walks[oc] = walks.get(oc, 0) + 1
            out['started_inside'][bot] = {'from': tuple(round(v) for v in pos), 'zone': zone_of(zones, *pos),
                                          'to': tuple(round(v) for v in end) if end else None,
                                          'inside_at_end': bool(end and zone_of(zones, *end)), 'walks': walks,
                                          'broke_in_zone': h['broken_in_zone'].get(bot, 0),
                                          'placed_in_zone': sum(1 for r in history if r[1] == bot and r[6] == 1 and zone_of(zones, r[2], r[3], r[4]))}
    return out


def build_report(inp):
    """The whole read from collected inputs -> dict with 'verdict', 'fails', 'blind', 'flags' and every table. Pure.
    inp: run, expected_version, bots, t0, quiet_end, t1, load {'start','end','pauses_start','last_continue'} or None,
    stopped (why the guard stopped it, or None), samples, paper [(epoch, msg)], bot_lines [(unit, msg)], oom_lines [str],
    rows_by_bot {bot: n}, versions {version: n}, death_rows {bot: n}, stats_start/stats_end {bot: deaths},
    blocks [(hour_epoch, placed, cleared)], llm {'calls','p50_ms','p95_ms','failed'}, guards [{'t','verdict','p95_ms','calls'}],
    guard_before {'p95_ms','calls'}."""
    bots = inp['bots']
    t0, qe, t1 = inp['t0'], inp['quiet_end'], inp['t1']
    load = inp.get('load')
    ev = paper_events(inp['paper'], set(bots))
    mem = memory_lines(inp['bot_lines'])
    quiet_h = (qe - t0) / 3600.0
    rq = reconnects(ev, bots, t0, qe)
    rl = reconnects(ev, bots, qe, t1 + 1)
    fails, blind, flags = [], [], []

    # ---- what the read could see (every "none" below leans on these)
    seen = [b for b in bots if inp['rows_by_bot'].get(b)]
    if len(seen) < len(bots):
        blind.append(f'only {len(seen)} of {len(bots)} bots wrote rows (missing: {", ".join(b for b in bots if b not in seen)})')
    other = {v: n for v, n in inp['versions'].items() if v != inp['expected_version']}
    if other:
        blind.append(f'rows on another version: {other} (expected {inp["expected_version"]})')
    want = max(1, int((qe - t0) // SAMPLE_S))
    per_bot = {b: mem_stats(inp['samples'], b, t0, qe) for b in bots}
    thin = [b for b in bots if per_bot[b]['n'] < 0.9 * want]
    if thin:
        blind.append(f'memory samples under 90% of the {want} expected for {len(thin)} bot(s): {", ".join(thin[:5])}')
    if not inp['paper']:
        blind.append('no line of the Paper server\'s log was read: reconnects cannot be counted')
    if inp.get('stopped'):
        blind.append('the run was stopped early: ' + inp['stopped'])
    if inp.get('load_only'):
        flags.append(f'LOAD-STEP CHECK ONLY ({quiet_h * 60:.0f} quiet minutes, then the load step): this says nothing about the untouched hours')
    elif quiet_h < 2.9:
        blind.append(f'the untouched stretch was {quiet_h:.2f} h, not 3')

    # ---- memory, restarts, kills
    rs = {b: restarts(inp['samples'], b, t0, t1) for b in bots}
    for b in bots:
        m = per_bot[b]
        if m['n'] and m['share_of_cap'] >= NEAR_CAP:
            fails.append(f'{b} reached {m["max"]:.0f} MB, {m["share_of_cap"]:.0%} of its {CAP_MB} MB ceiling, in the untouched hours')
        if m['n'] and m.get('slope_last90_mb_h') is not None and m['slope_last90_mb_h'] > SLOPE_FLAG:
            flags.append(f'{b} memory rose {m["slope_last90_mb_h"]:.0f} MB/h over the last 90 untouched minutes')
        if rs[b]:
            fails.append(f'{b}: its unit was restarted {rs[b]} time(s) by systemd (a crash or a kill)')
    ooms = [l for l in inp['oom_lines'] if OOM.search(l)]
    if ooms:
        fails.append(f'{len(ooms)} kernel memory-kill line(s), first: {ooms[0][:140]}')

    # ---- reconnects in the untouched hours
    nq = sum(r['joins'] for r in rq.values())
    if nq:
        why = {}
        for r in rq.values():
            for k, v in r['lost'].items():
                why[k] = why.get(k, 0) + v
        flags.append(f'{nq} reconnect(s) in the untouched hours ({nq / (len(bots) * quiet_h):.2f} per bot-hour); lost: {why}')

    # ---- deaths: the server's statistics and the bots' own rows
    dd = death_delta(inp['stats_start'], inp['stats_end'])
    unknown = [b for b in bots if dd.get(b) is None]
    n_stat = sum(v for b, v in dd.items() if b in bots and v)
    n_rows = sum(inp['death_rows'].get(b, 0) for b in bots)
    if unknown:
        blind.append(f'no death statistic at one end for {len(unknown)} bot(s): {", ".join(unknown[:5])}')
    if n_stat != n_rows:
        flags.append(f'deaths disagree: the server counts {n_stat}, the bots\' rows {n_rows}')
    deaths = max(n_stat, n_rows)
    if deaths >= DEATHS_FAIL:
        fails.append(f'{deaths} deaths in {len(bots) * (t1 - t0) / 3600.0:.1f} bot-hours')
    elif deaths:
        flags.append(f'1 death ({", ".join(b for b in bots if dd.get(b) or inp["death_rows"].get(b))})')

    # ---- the load step
    leak, back = None, None
    if load:
        leak = leak_table(mem, ev, bots, load['start'], load['end'])
        ok = [b for b in bots if leak[b]['forced_reconnects'] >= LEAK_MIN_RECONNECTS and leak[b]['mb_per_reconnect'] is not None]
        if len(ok) < LEAK_MIN_BOTS:
            blind.append(f'the load step forced {LEAK_MIN_RECONNECTS}+ reconnects with a memory line on both sides for only {len(ok)} '
                         f'of {len(bots)} bots: the leak rule cannot speak')
        else:
            kept = statistics.median(leak[b]['mb_per_reconnect'] for b in ok)
            leak['_median_mb_per_reconnect'] = round(kept, 1)
            leak['_bots_counted'] = len(ok)
            if kept > LEAK_MB:
                fails.append(f'memory kept per forced reconnect: median {kept:.1f} MB of chunk buffers over {len(ok)} bots '
                             f'(limit {LEAK_MB:.0f}): connections are not being let go')
        back = back_in_world_minutes(ev, bots, load['last_continue'])
        last = {}
        for t, b, kind, _ in ev:
            if b in bots and t >= load['start']:
                last[b] = kind
        out_now = sorted(b for b, k in last.items() if k == 'lost')
        if back is None:
            fails.append(f'{len(out_now)} bot(s) never came back after the load step: {", ".join(out_now)}' if out_now else
                         'the bots were never all in the world at once after the last pause')
        elif back > RECOVER_MIN:
            fails.append(f'the last bot was back {back:.0f} min after the last pause ended (limit {RECOVER_MIN})')
    elif not inp.get('stopped'):
        flags.append('the load step was not run: this read says nothing about reconnects or a starved host')

    # ---- the showcase beside it
    trips = [g for g in inp['guards'] if g.get('verdict') == 'TRIP']
    blinds = [g for g in inp['guards'] if g.get('verdict') == 'BLIND']
    off = inp.get('guard_off')
    if off:
        flags.append(f'THE SHOWCASE GUARD WAS OFF for this run (the showcase was stopped: {off["why"]})'
                     + (f'; it re-armed at {hm(off["armed_at"])}Z when the showcase\'s rows came back' if off.get('armed_at') else
                        '; the showcase\'s rows never came back, so nothing was beside the test world on the model'))
    elif blinds:
        flags.append(f'the showcase guard could not see for {len(blinds)} of {len(inp["guards"])} checks')

    # ---- the protected zones (reported and named, never part of the verdict)
    zr = zone_report(inp.get('zones') or [], inp.get('zone_rows') or [], inp.get('first_pos') or {}, inp.get('last_pos') or {},
                     inp.get('zone_history') or [])
    if zr['spots']['in_zone'] or zr['spots']['near']:
        flags.append(f'plant spots chosen inside a protected zone: {len(zr["spots"]["in_zone"])}; within {GROWTH_MARGIN} blocks of one: {len(zr["spots"]["near"])} '
                     f'(of {zr["spots"]["n"]} chosen)')
    if zr['planted']['in_zone'] or zr['history']['grows_in_zone']:
        flags.append(f'PLANTED INSIDE A PROTECTED ZONE: {len(zr["planted"]["in_zone"])} by the bots\' rows, {len(zr["history"]["grows_in_zone"])} by the block history')
    if zr['history']['tree_in_zone']:
        trunks = sorted({(x, z) for _, _, x, _, z, _ in zr['history']['tree_logs']})
        flags.append(f'A TREE GREW INSIDE A PROTECTED ZONE: {zr["history"]["tree_in_zone"]} blocks of logs and leaves by the block history, '
                     f'{len(trunks)} trunk(s) at ' + ', '.join(f'{x},{z}' for x, z in trunks[:6]))
    if zr['deaths']['in_zone']:
        flags.append(f'{len(zr["deaths"]["in_zone"])} death(s) inside a protected zone')
    if zr['walk_out_inside']:
        flags.append(f'{len(zr["walk_out_inside"])} zone walk(s) said "out" but ended inside a zone box')
    if zr['inside_at_end']:
        flags.append('inside a protected zone at the end: ' + ', '.join(f'{b.replace("showcase-", "")} at {",".join(map(str, p))}' for b, p, _ in zr['inside_at_end']))

    verdict = 'FAIL' if fails else ('INCONCLUSIVE' if blind else 'PASS')
    return {'run': inp['run'], 'verdict': verdict, 'fails': fails, 'blind': blind, 'flags': flags,
            'expected_version': inp['expected_version'], 't0': t0, 'quiet_end': qe, 't1': t1, 'quiet_hours': round(quiet_h, 2),
            'bots': bots, 'memory': per_bot, 'restarts': rs, 'oom_lines': len(ooms),
            'reconnects_quiet': rq, 'reconnects_load': rl, 'leak': leak, 'back_minutes': back,
            'deaths': {'server': n_stat, 'rows': n_rows, 'per_bot': {b: dd.get(b) for b in bots}},
            'zones': zr, 'guard_off': off, 'load_only': bool(inp.get('load_only')), 'blocks': inp['blocks'], 'llm': inp['llm'], 'rows_by_bot': inp['rows_by_bot'], 'versions': inp['versions'],
            'samples_expected': want, 'paper_lines': len(inp['paper']), 'memory_lines': len(mem),
            'guards': {'checks': len(inp['guards']), 'trips': len(trips), 'blind': len(blinds),
                       'p95_max_ms': max((g['p95_ms'] for g in inp['guards'] if g.get('p95_ms')), default=None),
                       'before': inp.get('guard_before')}, 'load': load}


def fmt0(v):
    return '?' if v is None else format(v, '.0f')


def render(r):
    """The report as markdown. Pure."""
    L = []
    w = L.append
    w(f'# {"Load-step check" if r.get("load_only") else "Soak read"} `{r["run"]}`: **{r["verdict"]}**')
    w('')
    w(f'Release `{r["expected_version"]}`, {len(r["bots"])} bots. Untouched {hm(r["t0"])}-{hm(r["quiet_end"])}Z '
      f'({r["quiet_hours"]} h = {len(r["bots"]) * r["quiet_hours"]:.1f} bot-hours)'
      + (f', load step to {hm(r["t1"])}Z.' if r['load'] else '; no load step.'))
    for name, items in (('FAILED', r['fails']), ('COULD NOT SEE', r['blind']), ('Named, not failed', r['flags'])):
        if items:
            w('')
            w(f'**{name}:**')
            for i in items:
                w(f'- {i}')
    w('')
    w('## What the read could see')
    rows = sum(r['rows_by_bot'].values())
    w(f'- {rows:,} skill rows from {sum(1 for v in r["rows_by_bot"].values() if v)} of {len(r["bots"])} bots; versions: '
      + ', '.join(f'`{v[:8]}…{v[-7:]}` {n:,}' for v, n in sorted(r['versions'].items(), key=lambda x: -x[1])))
    w(f'- memory samples: {min(m["n"] for m in r["memory"].values())}-{max(m["n"] for m in r["memory"].values())} a bot '
      f'of {r["samples_expected"]} expected; {r["memory_lines"]:,} of the bots\' own memory lines; {r["paper_lines"]:,} Paper log lines')
    g = r['guards']
    before = g.get('before') or {}
    sec = lambda v: 'not read' if v is None else f'{v / 1000:.2f} s'     # noqa: E731
    w(f'- showcase model p95 beside it: {sec(before.get("p95_ms"))} in the 30 min before the test bots started; highest 30-min value during '
      f'{sec(g["p95_max_ms"])} over {g["checks"]} checks ({g["trips"]} past 6 s, {g["blind"]} blind)')
    m = r['llm']
    w(f'- test bots\' model calls: {m["calls"]:,} answered ({m["calls"] / max(0.01, (r["t1"] - r["t0"]) / 60):.1f}/min), '
      f'p50 {m["p50_ms"] / 1000:.2f} s, p95 {m["p95_ms"] / 1000:.2f} s, {m["failed"]} failed' if m.get('calls') else '- test bots\' model calls: none read')
    w('')
    w('## Memory against reconnects, per bot')
    w('')
    w('| bot | MB min / median / max (3 h) | of cap | slope last 90 min | restarts | reconnects 3 h | forced reconnects | buffers before -> after | MB kept each |')
    w('|---|---|---|---|---|---|---|---|---|')
    for b in r['bots']:
        m = r['memory'][b]
        lk = (r['leak'] or {}).get(b) or {}
        w(f'| {b.replace("showcase-", "")} | '
          + (f'{m["min"]:.0f} / {m["median"]:.0f} / {m["max"]:.0f} | {m["share_of_cap"]:.0%} | '
             f'{"n/a" if m.get("slope_last90_mb_h") is None else format(m["slope_last90_mb_h"], "+.0f") + " MB/h"}' if m['n'] else 'no sample | - | -')
          + f' | {"?" if r["restarts"][b] is None else r["restarts"][b]} | {r["reconnects_quiet"][b]["joins"]} | '
          + (f'{lk.get("forced_reconnects", 0)} | {fmt0(lk.get("buffers_before_mb"))} -> {fmt0(lk.get("buffers_after_mb"))} MB | '
             f'{"n/a" if lk.get("mb_per_reconnect") is None else lk["mb_per_reconnect"]}' if r['leak'] else '- | - | -') + ' |')
    if r['leak'] and r['leak'].get('_median_mb_per_reconnect') is not None:
        w('')
        w(f'Median kept per forced reconnect: **{r["leak"]["_median_mb_per_reconnect"]} MB** over {r["leak"]["_bots_counted"]} bots '
          f'(limit {LEAK_MB:.0f}; the 11-18 leak kept 14-22). All bots back in the world {r["back_minutes"]} min after the last pause.')
    w('')
    w('## Deaths, kills, building')
    d = r['deaths']
    w(f'- deaths: {d["server"]} by the server\'s statistics, {d["rows"]} by the bots\' rows, in '
      f'{len(r["bots"]) * (r["t1"] - r["t0"]) / 3600:.1f} bot-hours; kernel memory-kill lines: {r["oom_lines"]}')
    lost = {}
    for part in ('reconnects_quiet', 'reconnects_load'):
        for x in r[part].values():
            for k, v in x['lost'].items():
                lost[k] = lost.get(k, 0) + v
    w(f'- connections lost over the whole run, by the server\'s reason: {lost or "none"}')
    if r['blocks']:
        w('- blocks by hour (block-history database, the bots only): '
          + '; '.join(f'{hm(h)}Z {p:,} placed / {c:,} cleared' for h, p, c in r['blocks']))
    else:
        w('- blocks by hour: no row read from the block-history database')
    z = r.get('zones')
    if z and z['zones']:
        def where(items):
            return '; '.join(f'{hm(i[0])}Z {str(i[1]).replace("showcase-", "")} at {i[2]},{i[3]},{i[4]}' for i in items[:10])
        w('')
        w(f'## Protected zones ({z["zones"]} boxes from the pool\'s protected-zones.json)')
        sp = z['spots']
        w(f'- plant spots chosen (`_plant_spot found`): {sp["n"]}; **{len(sp["in_zone"])} inside a zone**'
          + (f' ({where(sp["in_zone"])})' if sp['in_zone'] else '')
          + f'; **{len(sp["near"])} within {GROWTH_MARGIN} blocks of one**' + (f' ({where(sp["near"])})' if sp['near'] else ''))
        w(f'- orders to plant (`_work_order place` of something that grows): {z["orders"]["n"]}; **{len(z["orders"]["in_zone"])} inside a zone**'
          + (f' ({where(z["orders"]["in_zone"])})' if z['orders']['in_zone'] else ''))
        w(f'- planted, by the bots\' `place` rows: {z["planted"]["n"]}; **{len(z["planted"]["in_zone"])} inside a zone**'
          + (f' ({where(z["planted"]["in_zone"])})' if z['planted']['in_zone'] else ''))
        hh = z['history']
        w(f'- block history inside the zone boxes: placed by the bots {sum(hh["placed_in_zone"].values())}'
          + (f' {dict(sorted(hh["placed_in_zone"].items(), key=lambda x: -x[1])[:8])}' if hh['placed_in_zone'] else '')
          + f'; **things that grow: {len(hh["grows_in_zone"])}**'
          + (' (' + '; '.join(f'{hm(t)}Z {u.replace("showcase-", "")} {m} at {x},{y},{zz}' for t, u, x, y, zz, m in hh['grows_in_zone'][:10]) + ')' if hh['grows_in_zone'] else '')
          + f'; **tree growth: {hh["tree_in_zone"]} blocks of logs and leaves**'
          + (' (first log of each trunk: ' + '; '.join(f'{hm(t)}Z {u.replace("showcase-", "")} at {x},{y},{zz}' for t, u, x, y, zz, _ in
                                                      {(x, zz): (t, u, x, y, zz, m) for t, u, x, y, zz, m in reversed(hh['tree_logs'])}.values()) + ')' if hh.get('tree_logs') else '')
          + f'; broken by the bots: {sum(hh["broken_in_zone"].values())}'
          + (f' {dict((k.replace("showcase-", ""), v) for k, v in hh["broken_in_zone"].items())}' if hh['broken_in_zone'] else ''))
        w(f'- refusals (`_protect_zone_refused`): {z["refused_n"]}'
          + (f', {z["refused_with_remedy"]} naming the walk-out remedy; by kind: ' + ', '.join(f'{k}: {n}' for k, n in sorted(z['refused'].items(), key=lambda x: -x[1])) if z['refused_n'] else ''))
        w(f'- zone walks (`_zone_walk`): {sum(z["walks"].values())}' + (f' by outcome {z["walks"]}' if z['walks'] else '')
          + f'; "out" that ended inside a zone box: {len(z["walk_out_inside"])}; `_needs_rescue arm=zone_walk`: {sum(z["rescue"].values())}'
          + (f' {dict((k.replace("showcase-", ""), v) for k, v in z["rescue"].items())}' if z['rescue'] else ''))
        w(f'- deaths: {z["deaths"]["n"]} by the bots\' rows; **{len(z["deaths"]["in_zone"])} inside a zone**'
          + (' (' + '; '.join(f'{hm(t)}Z {b} at {p}' for t, b, p, _ in z['deaths']['in_zone']) + ')' if z['deaths']['in_zone'] else ''))
        w('- inside a zone box at the end: ' + (', '.join(f'{b.replace("showcase-", "")} at {",".join(map(str, p))} ({zid})' for b, p, zid in z['inside_at_end']) or 'no bot'))
        for b, d in z['started_inside'].items():
            how = 'STAYED inside' if d['inside_at_end'] else ('WALKED OUT' if d['walks'].get('out') else 'LEFT (no zone walk said "out")')
            w(f'- **{b.replace("showcase-", "")} began inside {d["zone"]}** at {",".join(map(str, d["from"]))} and ended at '
              f'{",".join(map(str, d["to"])) if d["to"] else "?"}: **{how}**; zone walks {d["walks"] or "none"}; '
              f'it broke {d["broke_in_zone"]} and placed {d["placed_in_zone"]} blocks inside the zone (block history)')
    return '\n'.join(L) + '\n'


# ------------------------------------------------------------------------------------------------ collecting (the host)
def sh(*cmd):
    return subprocess.run(list(cmd), capture_output=True, text=True).stdout


def journal_json(unit, a, b, grep=None):
    cmd = ['journalctl', '-u', unit, '--since', f'@{int(a)}', '--until', f'@{int(b) + 1}', '-o', 'json', '--no-pager']
    if grep:
        cmd += ['-g', grep]
    out = []
    for line in sh(*cmd).splitlines():
        try:
            d = json.loads(line)
            msg = d.get('MESSAGE')
            if isinstance(msg, str):
                out.append((int(d['__REALTIME_TIMESTAMP']) / 1e6, d.get('_SYSTEMD_UNIT', ''), msg))
        except (ValueError, KeyError):
            continue
    return out


def stats_dir(path, uuid_name):
    out = {}
    for f in os.listdir(path) if os.path.isdir(path) else []:
        name = uuid_name.get(f[:-5])
        if name and f.endswith('.json'):
            try:
                s = json.load(open(os.path.join(path, f)))
                out[name] = int(((s.get('stats') or {}).get('minecraft:custom') or {}).get('minecraft:deaths', 0))
            except (OSError, ValueError):
                continue
    return out


def block_hours(db, bots, a, b):
    c = sqlite3.connect(f'file:{db}?mode=ro', uri=True, timeout=30)
    try:
        ids = [i for i, u in c.execute('select id, user from co_user') if u in bots]
        if not ids:
            return []
        q = (f'select (time / 3600) * 3600, sum(action = 1), sum(action = 0) from co_block where time >= ? and time < ? '
             f'and user in ({",".join("?" * len(ids))}) group by 1 order by 1')
        return [(int(h), int(p or 0), int(cl or 0)) for h, p, cl in c.execute(q, [int(a), int(b)] + ids)]
    finally:
        c.close()


def zone_blocks(db, bots, zones, a, b):
    """[(epoch, user, x, y, z, material, action)]: every block the bots or a growing tree placed or broke inside a zone
    box in [a, b), from the block history."""
    if not zones:
        return []
    c = sqlite3.connect(f'file:{db}?mode=ro', uri=True, timeout=30)
    out = []
    try:
        for zn in zones:
            x1, y1, z1, x2, y2, z2 = zn['box']
            q = ("select b.time, u.user, b.x, b.y, b.z, m.material, b.action from co_block b join co_user u on u.id = b.user "
                 "join co_material_map m on m.id = b.type where b.time >= ? and b.time < ? and b.action in (0, 1) "
                 "and b.x between ? and ? and b.z between ? and ? and b.y between ? and ? order by b.time")
            out += [(int(t), u, int(x), int(y), int(z), m, int(act)) for t, u, x, y, z, m, act in
                    c.execute(q, [int(a), int(b), x1, x2, z1, z2, y1, y2]) if u in bots or u == '#tree']
    finally:
        c.close()
    return out


def collect(run, server=None):
    """server: another server folder to read the block history and the player names from (a world set aside under old/ by
    a later restore), so an earlier run can be read again."""
    from lib import telemetry as T
    rows = [json.loads(l) for l in open(f'{ROOT}/ops/deploy.jsonl') if l.strip()]
    start = [r for r in rows if r.get('event') == 'soak-start' and r.get('run') == run][-1]
    t0 = ts(start['t'])
    after = [r for r in rows if ts(r['t']) >= t0]
    def first(event):
        return next((r for r in after if r.get('event') == event and r.get('run', run) == run), None)
    end = first('soak-end')
    t1 = ts(end['t']) if end else dt.datetime.now(dt.timezone.utc).timestamp()
    qe = first('quiet-end')
    quiet_end = ts(qe['t']) if qe else t1
    ls, le = first('load-step-start'), first('load-step-end')
    load = None
    if ls and le:
        ps = next((r for r in after if r['event'] == 'pauses-start'), None)
        conts = [ts(r['t']) for r in after if r['event'] == 'continue' and ts(r['t']) <= ts(le['t'])]
        if ps and conts:
            load = {'start': ts(ls['t']), 'end': ts(le['t']), 'pauses_start': ts(ps['t']), 'last_continue': max(conts),
                    'squeeze': next((r for r in after if r['event'] == 'squeeze-on'), None)}
    sys.path.insert(0, HERE)
    import testworld as TW
    server = server or TW.SERVER
    bots = list(TW.BOTS)
    samples = []
    for l in open(TW.SAMPLES):
        try:
            r = json.loads(l)
        except ValueError:
            continue
        if t0 - 1 <= ts(r['t']) <= t1 + 1:
            samples.append(r)
    paper = [(t, m) for t, _, m in journal_json(TW.PAPER, t0, t1)]
    bot_lines = [(u, m) for _, u, m in journal_json(f'{TW.UNIT}*', t0 - 60, t1, grep=' memory rss_mb=')]
    oom = [l for l in sh('journalctl', '-k', '--since', f'@{int(t0)}', '--until', f'@{int(t1) + 1}', '-o', 'cat', '--no-pager').splitlines()
           if OOM.search(l)]
    since = dt.datetime.fromtimestamp(t0, dt.timezone.utc)
    until = dt.datetime.fromtimestamp(t1, dt.timezone.utc)
    ev = T.Events.load(paths=f'{TW.LOGS}/*/skill-*.jsonl*', since=since, until=until)
    by = ev.by_bot()
    rows_by_bot = {b: len(by.get(b, [])) for b in bots}
    # the zero of deaths is allowed only because the same load just counted every bot's rows (the line above)
    death_rows = {b: len(v) for b, v in ev.by_bot('_death', allow_zero=True).items()}
    lat, failed = [], 0
    for b in bots:
        for _, d in T.stream_rows(TW.LOGS, b, since, until, stream='llm'):
            ms = (d.get('llm') or {}).get('latency_ms')
            if isinstance(ms, (int, float)):
                lat.append(ms)
            elif (d.get('outcome') or {}).get('status') == 'endpoint_failed':
                failed += 1
    lat.sort()
    llm = {'calls': len(lat), 'p50_ms': lat[len(lat) // 2] if lat else None,
           'p95_ms': lat[int(len(lat) * 0.95)] if lat else None, 'failed': failed}
    cache = json.load(open(f'{server}/usercache.json'))
    uuid_name = {u['uuid']: u['name'] for u in cache}
    run_dir = f'{TW.SOAK}/{run}'
    guards = [r for r in after if r['event'] == 'guard' and ts(r['t']) <= t1]
    guard_off = None
    if start.get('showcase_stopped'):
        armed = next((r for r in after if r['event'] == 'guard-armed' and ts(r['t']) <= t1), None)
        guard_off = {'why': start['showcase_stopped'], 'armed_at': ts(armed['t']) if armed else None}
    zone_rows, first_pos, last_pos = [], {}, {}
    def pos_of(raw):
        p = (raw.get('bot') or {}).get('pos') or {}
        return (p['x'], p['y'], p['z']) if all(isinstance(p.get(k), (int, float)) for k in 'xyz') else None
    for b, rs in by.items():
        ps = [pos_of(r['raw']) for r in rs]
        ps = [p for p in ps if p]
        if ps and b in bots:
            first_pos[b], last_pos[b] = ps[0], ps[-1]
    for name in ('_plant_spot', '_work_order', 'place', '_protect_zone_refused', '_zone_walk', '_needs_rescue', '_death'):
        # a zero here is allowed only because the same load counted every bot's rows above (rows_by_bot)
        for r in ev.of(name, allow_zero=True):
            sk = r['raw'].get('skill') or {}
            zone_rows.append((r['t'].timestamp(), (r['raw'].get('bot') or {}).get('name'), sk.get('name'), sk.get('args'), sk.get('detail'), sk.get('status'), pos_of(r['raw'])))
    try:
        zones = json.load(open(f'{TW.STATE}/_pool-showcase/protected-zones.json')).get('zones') or []
    except (OSError, ValueError):
        zones = []
    zone_history = zone_blocks(f'{server}/plugins/CoreProtect/database.db', set(bots), zones, t0, t1)
    before = [r for r in rows if r['event'] == 'guard' and r.get('phase') == 'before-start' and ts(r['t']) < t0]
    return {'run': run, 'expected_version': start['expected_version'], 'bots': bots, 't0': t0, 'quiet_end': quiet_end, 't1': t1,
            'load': load, 'stopped': (end or {}).get('stopped') or (None if end else 'no soak-end row: the driver did not finish'),
            'samples': samples, 'paper': paper, 'bot_lines': bot_lines, 'oom_lines': oom, 'rows_by_bot': rows_by_bot,
            'versions': ev.versions(), 'death_rows': death_rows,
            'stats_start': stats_dir(f'{run_dir}/stats-start', uuid_name), 'stats_end': stats_dir(f'{run_dir}/stats-end', uuid_name),
            'blocks': block_hours(f'{server}/plugins/CoreProtect/database.db', set(bots), t0, t1), 'llm': llm,
            'guards': guards, 'guard_before': before[-1] if before else None, 'guard_off': guard_off,
            'zones': zones, 'zone_rows': zone_rows, 'first_pos': first_pos, 'last_pos': last_pos, 'zone_history': zone_history,
            'load_only': bool(start.get('load_only'))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True)
    ap.add_argument('--server', help='read the block history from this server folder (a world set aside under old/)')
    a = ap.parse_args()
    inp = collect(a.run, a.server)
    rep = build_report(inp)
    out = f'{ROOT}/soak/{a.run}'
    os.makedirs(out, exist_ok=True)
    json.dump(inp, open(f'{out}/soak-inputs.json', 'w'), default=str)      # what was collected, so the page can be rebuilt
    md = render(rep)
    open(f'{out}/soak-read.md', 'w').write(md)
    json.dump(rep, open(f'{out}/soak-read.json', 'w'), indent=1, default=str)
    print(md)
    return 0 if rep['verdict'] == 'PASS' else (1 if rep['verdict'] == 'FAIL' else 3)


if __name__ == '__main__':
    sys.exit(main())
