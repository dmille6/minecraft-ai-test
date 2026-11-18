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
# The showcase's protected village (tripwire S4, zone village-taiga-6_1). 11-18 15:13Z: a spruce sapling a bot planted at
# 121,67,-8 grew into a tree inside it and the tripwire stopped the town. The copy runs the same code on the same ground,
# so the read counts every sapling aimed at or put inside it (reported, not part of the verdict).
VILLAGE = {'name': 'village-taiga-6_1', 'x': (49, 157), 'z': (-59, 45)}
AT = re.compile(r'\bfound at=(-?\d+),(-?\d+),(-?\d+)')
ORDER = re.compile(r'^place (\{.*?\}) ')


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
    """Minutes after the last pause ended until the last bot's last join; 0 when nobody joined after it (nobody was out).
    Pure."""
    later = [t for t, b, kind, _ in events if kind == 'join' and b in bots and t >= last_continue]
    return round((max(later) - last_continue) / 60.0, 1) if later else 0.0


def death_delta(start, end):
    """{bot: deaths} from the server's own statistics at the start and the end ({bot: count}); a bot missing at either end
    is None, never 0. Pure."""
    return {b: (end[b] - start[b]) if b in start and b in end else None for b in sorted(set(start) | set(end))}


def in_zone(x, z, zone=VILLAGE):
    return zone['x'][0] <= x <= zone['x'][1] and zone['z'][0] <= z <= zone['z'][1]


def sapling_rows(rows, zone=VILLAGE):
    """[(epoch, bot, skill name, args, detail, status)] -> per kind {'n', 'in_zone': [(epoch, bot, x, y, z)]}:
    spots (`_plant_spot ... found at=x,y,z`: where the bot decided to plant), orders (`_work_order place {"item":
    "*_sapling", x, y, z}`), placed (`place` rows of a sapling that succeeded). Pure."""
    out = {k: {'n': 0, 'in_zone': []} for k in ('spots', 'orders', 'placed')}
    def add(kind, t, bot, x, y, z):
        out[kind]['n'] += 1
        if in_zone(x, z, zone):
            out[kind]['in_zone'].append((t, bot, x, y, z))
    for t, bot, name, args, detail, status in rows:
        if name == '_plant_spot':
            m = AT.search(detail or '')
            if m:
                add('spots', t, bot, *map(int, m.groups()))
        elif name == '_work_order':
            m = ORDER.match(detail or '')
            if m:
                try:
                    a = json.loads(m.group(1))
                except ValueError:
                    continue
                if str(a.get('item', '')).endswith('_sapling') and all(isinstance(a.get(k), (int, float)) for k in 'xyz'):
                    add('orders', t, bot, int(a['x']), int(a['y']), int(a['z']))
        elif name == 'place' and status == 'success' and str((args or {}).get('item', '')).endswith('_sapling') \
                and all(isinstance((args or {}).get(k), (int, float)) for k in 'xyz'):
            add('placed', t, bot, int(args['x']), int(args['y']), int(args['z']))
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
    if quiet_h < 2.9:
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
        if out_now:
            fails.append(f'{len(out_now)} bot(s) never came back after the load step: {", ".join(out_now)}')
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

    # ---- saplings and the protected village (reported, never part of the verdict)
    sap = sapling_rows(inp.get('sapling_rows') or [])
    sap['history'] = {'n': len(inp.get('sapling_places') or []),
                      'in_zone': [p for p in (inp.get('sapling_places') or []) if in_zone(p[2], p[4])]}
    n_in = len(sap['placed']['in_zone']) + len(sap['history']['in_zone'])
    if n_in or sap['spots']['in_zone'] or sap['orders']['in_zone']:
        flags.append(f'saplings and the protected village {VILLAGE["name"]}: {len(sap["spots"]["in_zone"])} plant spot(s) chosen inside it, '
                     f'{len(sap["orders"]["in_zone"])} order(s) to plant there, {len(sap["placed"]["in_zone"])} planted by the bots\' rows, '
                     f'{len(sap["history"]["in_zone"])} by the block history')

    verdict = 'FAIL' if fails else ('INCONCLUSIVE' if blind else 'PASS')
    return {'run': inp['run'], 'verdict': verdict, 'fails': fails, 'blind': blind, 'flags': flags,
            'expected_version': inp['expected_version'], 't0': t0, 'quiet_end': qe, 't1': t1, 'quiet_hours': round(quiet_h, 2),
            'bots': bots, 'memory': per_bot, 'restarts': rs, 'oom_lines': len(ooms),
            'reconnects_quiet': rq, 'reconnects_load': rl, 'leak': leak, 'back_minutes': back,
            'deaths': {'server': n_stat, 'rows': n_rows, 'per_bot': {b: dd.get(b) for b in bots}},
            'saplings': sap, 'guard_off': off, 'blocks': inp['blocks'], 'llm': inp['llm'], 'rows_by_bot': inp['rows_by_bot'], 'versions': inp['versions'],
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
    w(f'# Soak read `{r["run"]}`: **{r["verdict"]}**')
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
          f'(limit {LEAK_MB:.0f}; the 11-18 leak kept 14-22). Last bot back {r["back_minutes"]} min after the last pause.')
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
    sp = r.get('saplings')
    if sp:
        w('')
        w(f'## Saplings and the protected village ({VILLAGE["name"]}, x {VILLAGE["x"][0]}..{VILLAGE["x"][1]}, z {VILLAGE["z"][0]}..{VILLAGE["z"][1]})')
        names = (('spots', 'plant spots chosen (`_plant_spot found`)'), ('orders', 'orders to plant (`_work_order place *_sapling`)'),
                 ('placed', 'saplings planted, by the bots\' `place` rows'), ('history', 'saplings planted, by the block history'))
        for k, label in names:
            z_ = sp[k]['in_zone']
            w(f'- {label}: {sp[k]["n"]} in all, **{len(z_)} inside the village**'
              + (': ' + '; '.join(f'{hm(t)}Z {str(b).replace("showcase-", "")} at {x},{y},{zz}' for t, b, x, y, zz in z_[:12]) if z_ else ''))
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


def sapling_places(db, bots, a, b):
    """[(epoch, bot, x, y, z)] of every sapling the bots PLACED in [a, b), from the block-history database."""
    c = sqlite3.connect(f'file:{db}?mode=ro', uri=True, timeout=30)
    try:
        q = ("select b.time, u.user, b.x, b.y, b.z from co_block b join co_user u on u.id = b.user join co_material_map m on m.id = b.type "
             "where m.material like '%sapling' and b.action = 1 and b.time >= ? and b.time < ? order by b.time")
        return [(int(t), u, int(x), int(y), int(z)) for t, u, x, y, z in c.execute(q, [int(a), int(b)]) if u in bots]
    finally:
        c.close()


def collect(run):
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
    cache = json.load(open(f'{TW.SERVER}/usercache.json'))
    uuid_name = {u['uuid']: u['name'] for u in cache}
    run_dir = f'{TW.SOAK}/{run}'
    guards = [r for r in after if r['event'] == 'guard' and ts(r['t']) <= t1]
    guard_off = None
    if start.get('showcase_stopped'):
        armed = next((r for r in after if r['event'] == 'guard-armed' and ts(r['t']) <= t1), None)
        guard_off = {'why': start['showcase_stopped'], 'armed_at': ts(armed['t']) if armed else None}
    sap_rows = []
    for name in ('_plant_spot', '_work_order', 'place'):
        # a zero here is allowed only because the same load counted every bot's rows above (rows_by_bot)
        for r in ev.of(name, allow_zero=True):
            sk = r['raw'].get('skill') or {}
            sap_rows.append((r['t'].timestamp(), (r['raw'].get('bot') or {}).get('name'), sk.get('name'), sk.get('args'), sk.get('detail'), sk.get('status')))
    sap_places = sapling_places(f'{TW.SERVER}/plugins/CoreProtect/database.db', set(bots), t0, t1)
    before = [r for r in rows if r['event'] == 'guard' and r.get('phase') == 'before-start' and ts(r['t']) < t0]
    return {'run': run, 'expected_version': start['expected_version'], 'bots': bots, 't0': t0, 'quiet_end': quiet_end, 't1': t1,
            'load': load, 'stopped': (end or {}).get('stopped') or (None if end else 'no soak-end row: the driver did not finish'),
            'samples': samples, 'paper': paper, 'bot_lines': bot_lines, 'oom_lines': oom, 'rows_by_bot': rows_by_bot,
            'versions': ev.versions(), 'death_rows': death_rows,
            'stats_start': stats_dir(f'{run_dir}/stats-start', uuid_name), 'stats_end': stats_dir(f'{run_dir}/stats-end', uuid_name),
            'blocks': block_hours(f'{TW.SERVER}/plugins/CoreProtect/database.db', set(bots), t0, t1), 'llm': llm,
            'guards': guards, 'guard_before': before[-1] if before else None, 'guard_off': guard_off,
            'sapling_rows': sap_rows, 'sapling_places': sap_places}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True)
    a = ap.parse_args()
    inp = collect(a.run)
    rep = build_report(inp)
    out = f'{ROOT}/soak/{a.run}'
    os.makedirs(out, exist_ok=True)
    md = render(rep)
    open(f'{out}/soak-read.md', 'w').write(md)
    json.dump(rep, open(f'{out}/soak-read.json', 'w'), indent=1, default=str)
    print(md)
    return 0 if rep['verdict'] == 'PASS' else (1 if rep['verdict'] == 'FAIL' else 3)


if __name__ == '__main__':
    sys.exit(main())
