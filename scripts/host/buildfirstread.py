#!/usr/bin/env python3
"""The read of buildfirst-01show on the test world: do idle bots build, and does making bag room work?
Asked for by the control session 11-18, beside the soak read of the same run (scripts/host/soakread.py).

    buildfirstread.py --run NAME      on block2-bots: the run's window from the journal, the bots' rows from their logs;
                                      writes /srv/testworld/soak/NAME/buildfirst-read.md

Since the same day it also reads drawshort-01show (the stack f7cc2a19): `_build_bag` need / tried / short, `_draw_short`
retries and caps, `_structure_complete` by project, and each unfinished building's parts (roof ...) from `_build` and `_build_seg`.
The release (802f4ba3): an idle bot goes to an unfinished building first; to carry for it, it makes bag room in sequence
(the room bank, the yard, surplus cobblestone down the junk well, clay balls compacted), else holds that plot 10 minutes.
What this counts, each with its denominator:
  blocks placed per hour by project (`_build_visit placed=`), split unfinished buildings / repairs / tidy;
  `_room_well` trips, blocks thrown by kind, slots before -> after; clay compactions (`_compact op=bag from=clay_ball`);
  `_room_hold` rows by reason; bag slots used, median per hour (`_build_first free=`, the exact count at each idle order);
  idle orders split building / grounds; build visits that ended no_material, by project;
  any bot at the well more than 5 minutes, or going well -> hold -> well.
summarize() is pure and is tested on rows in the bots' own shapes.
"""
import argparse, datetime as dt, json, os, re, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

UNFINISHED = ('civicH', 'civicM', 'cropfarm', 'stepwell', 'warehouse', 'storehub')    # control session 11-18
TIDY = ('tidy',)
WELL_STAND = (12, 74, 6)        # the junk well's standing cell on the 11-18 copy (`_well_refused ... standing cell at 12,74,6`)
WELL_NEAR = 3                   # blocks, each axis
STAY_GAP_S = 120                # rows further apart than this do not join into one stay
STAY_MIN_S = 300
LOOP_S = 1800                   # well -> hold -> well on one plot within 30 minutes is a loop
KV = re.compile(r'(\w+)=(\S*)')
SLOTS = re.compile(r'\bslots=(\d+)->(\d+)')
STAND = re.compile(r'\bstand(?:ing cell at)?[= ](-?\d+),(-?\d+),(-?\d+)')


def kv(detail):
    return dict(KV.findall(detail or ''))


def group(project):
    return 'unfinished' if project in UNFINISHED else 'tidy' if project in TIDY else 'repairs'


def hold_reason(d):
    """Why no remedy made room, from a `_room_hold` detail (`well=<slots>:<why> well_ok=<0|1> bank= plus= yard_room=`). Pure.
    cap_unknown / cap_below: the well's own answer; well_dead: the well is not usable; short_of_8: every remedy together
    frees fewer than the 8 slots a building needs; other:<why> for anything this does not know."""
    f = kv(d)
    well = f.get('well', '-')
    why = well.split(':', 1)[1] if ':' in well else '-'
    if 'cap_unknown' in why:
        return 'cap_unknown'
    if 'cap_below' in why:
        return 'cap_below'
    if f.get('well_ok') == '0':
        return 'well_dead'
    num = lambda v: int(v) if str(v).lstrip('-').isdigit() else 0     # noqa: E731
    if num(f.get('bank')) + num(f.get('plus')) + num(well.split(':', 1)[0]) < 8:
        return 'short_of_8'
    return 'other:' + why


def stays(points, stand=WELL_STAND):
    """[(epoch, x, y, z)] of one bot, time-ordered -> [(start, seconds)] of every stretch near the well longer than
    STAY_MIN_S (rows within WELL_NEAR of the standing cell, no more than STAY_GAP_S apart). Pure."""
    out, start, last = [], None, None
    for t, x, y, z in points:
        near = all(abs(a - b) <= WELL_NEAR for a, b in zip((x, y, z), stand))
        if near and start is not None and t - last <= STAY_GAP_S:
            last = t
            continue
        if start is not None and last - start >= STAY_MIN_S:
            out.append((start, last - start))
        start, last = (t, t) if near else (None, None)
    if start is not None and last - start >= STAY_MIN_S:
        out.append((start, last - start))
    return out


def loops(events):
    """[(epoch, 'well'|'hold', plot)] of one bot, time-ordered -> [(epoch of the first well trip, plot)] for every
    well -> hold -> well on the same plot within LOOP_S. Pure."""
    out = []
    for i in range(len(events) - 2):
        a, b, c = events[i:i + 3]
        if (a[1], b[1], c[1]) == ('well', 'hold', 'well') and a[2] == b[2] == c[2] and c[0] - a[0] <= LOOP_S:
            out.append((a[0], a[2]))
    return out


def summarize(rows, t0, t1):
    """rows: [(epoch, bot, skill name, status, detail, (x, y, z) or None)] in [t0, t1) -> the whole read as a dict. Pure."""
    hours = sorted({int(t // 3600) * 3600 for t, *_ in rows if t0 <= t < t1})
    hr = lambda t: int(t // 3600) * 3600      # noqa: E731
    out = {'t0': t0, 't1': t1, 'rows': 0, 'bots': set(), 'hours': hours,
           'placed': {h: {} for h in hours}, 'visits': {}, 'no_material': {}, 'outcomes': {},
           'well': {'trips': 0, 'threw': 0, 'thrown': {}, 'slots': [], 'stops': {}},
           'yard': {'trips': 0, 'stocked': {}}, 'clay': {'rows': 0, 'done': 0, 'made': 0},
           'holds': {}, 'holds_raw': {}, 'slots_by_hour': {h: [] for h in hours}, 'first_slots': None,
           'idle': {'building': 0, 'grounds': 0}, 'build_first': {}, 'look': {}, 'room_skips': {}, 'stays': [], 'loops': [],
           # drawshort-01show: what a building visit asked the town for and could not get; false shortages re-asked; completions
           'bag': {'rows': 0, 'asked': 0, 'short': 0, 'short_by_item': {}, 'short_by_project': {}},
           'draw_short': {'short': 0, 'cap': 0, 'by_plot': {}}, 'complete': {}, 'segs': {}}
    per_bot_pos, per_bot_ev = {}, {}
    stand = WELL_STAND
    for t, bot, name, status, detail, pos in sorted(rows, key=lambda r: r[0]):
        if not (t0 <= t < t1):
            continue
        out['rows'] += 1
        out['bots'].add(bot)
        f = kv(detail)
        if pos:
            per_bot_pos.setdefault(bot, []).append((t, *pos))
        if name == '_build_visit':
            p = f.get('project', '?')
            n = int(f['placed']) if f.get('placed', '').isdigit() else 0
            g = out['placed'][hr(t)].setdefault(group(p), {})
            g[p] = g.get(p, 0) + n
            out['visits'][p] = out['visits'].get(p, 0) + 1
            oc = f.get('outcome', '?')
            out['outcomes'].setdefault(p, {})
            out['outcomes'][p][oc] = out['outcomes'][p].get(oc, 0) + 1
            if 'no_material' in (oc, f.get('stop')):
                out['no_material'][p] = out['no_material'].get(p, 0) + 1
        elif name == '_build_bag':
            b = out['bag']
            b['rows'] += 1
            b['asked'] += 1 if f.get('need', '-') not in ('-', '') else 0
            short = [x.split(':')[0] for x in f.get('short', '-').split(',') if ':' in x]
            if short:
                b['short'] += 1
                p = f.get('project', '?')
                b['short_by_project'][p] = b['short_by_project'].get(p, 0) + 1
                for item in short:
                    b['short_by_item'][item] = b['short_by_item'].get(item, 0) + 1
        elif name == '_draw_short':
            d = out['draw_short']
            op = 'cap' if f.get('op') == 'cap' else 'short'
            d[op] += 1
            d['by_plot'].setdefault(f.get('plot', '?'), {'short': 0, 'cap': 0})[op] += 1
        elif name == '_structure_complete':
            p = f.get('project', '?')
            out['complete'][p] = out['complete'].get(p, 0) + 1
        elif name == '_build' and f.get('project') in UNFINISHED and f.get('op') == 'place':
            sg = out['segs'].setdefault((f['project'], f.get('seg', '-')), {'placed': 0, 'open': None, 'done': None})
            sg['placed'] += 1
        elif name == '_build_seg' and f.get('project') in UNFINISHED:
            sg = out['segs'].setdefault((f['project'], f.get('seg', '-')), {'placed': 0, 'open': None, 'done': None})
            sg['open'], sg['done'] = f.get('open'), f.get('done')          # rows are time-ordered: the last one stands
        elif name == '_room_well':
            w = out['well']
            w['trips'] += 1
            threw = 0
            for k in ('cobblestone', 'cobbled_deepslate'):
                n = int(f[k]) if f.get(k, '').isdigit() else 0
                threw += n
                if n:
                    w['thrown'][k] = w['thrown'].get(k, 0) + n
            w['threw'] += 1 if threw else 0
            m = SLOTS.search(detail or '')
            if m:
                w['slots'].append((int(m.group(1)), int(m.group(2))))
            w['stops'][f.get('stop', f.get('then', '-'))] = w['stops'].get(f.get('stop', f.get('then', '-')), 0) + 1
            per_bot_ev.setdefault(bot, []).append((t, 'well', f.get('plot', '-')))
        elif name == '_room_yard':
            out['yard']['trips'] += 1
            for k in ('cobblestone', 'cobbled_deepslate'):
                n = int(f[k]) if f.get(k, '').isdigit() else 0
                if n:
                    out['yard']['stocked'][k] = out['yard']['stocked'].get(k, 0) + n
        elif name == '_compact' and f.get('op') == 'bag' and f.get('from') == 'clay_ball':
            c = out['clay']
            c['rows'] += 1
            if status == 'success':
                c['done'] += 1
                c['made'] += int(f['made']) if f.get('made', '').isdigit() else 0
        elif name == '_room_hold':
            r = hold_reason(detail)
            out['holds'][r] = out['holds'].get(r, 0) + 1
            raw = f"{f.get('well', '-')} well_ok={f.get('well_ok', '-')}"
            out['holds_raw'][raw] = out['holds_raw'].get(raw, 0) + 1
            per_bot_ev.setdefault(bot, []).append((t, 'hold', f.get('plot', '-')))
        elif name == '_build_first':
            why = f.get('why', '?')
            out['build_first'][why] = out['build_first'].get(why, 0) + 1
            # the steer's own decision is the idle split's "building" (its order reaches the log as a plain `build_shop {}`
            # or a room trip, seen 11-18); what it looked at says why not: away, skip:<plot>:room, idle:<plot>:complete ...
            out['idle']['building'] += 1 if why == 'building' else 0
            parts = f.get('look', '-').split(':')
            kind = parts[0] if len(parts) < 3 else f'{parts[0]}:{parts[-1]}'
            out['look'][kind] = out['look'].get(kind, 0) + 1
            if len(parts) == 3 and parts[0] == 'skip' and parts[2] == 'room':
                out['room_skips'][parts[1]] = out['room_skips'].get(parts[1], 0) + 1
            if f.get('free', '').isdigit():
                used = 36 - int(f['free'])
                out['slots_by_hour'][hr(t)].append(used)
                if out['first_slots'] is None:
                    out['first_slots'] = used
        elif name == '_work_order' and (detail or '').startswith('build_shop {'):
            head = detail.split(' \u2014 ')[0]
            if '"why":"idle"' in head and '"grounds":true' in head:
                out['idle']['grounds'] += 1
        elif name in ('_well_refused', '_well_step'):
            m = STAND.search(detail or '')
            if m:
                stand = tuple(map(int, m.groups()))
    out['well_stand'] = stand
    for bot, pts in per_bot_pos.items():
        out['stays'] += [(bot, s, sec) for s, sec in stays(pts, stand)]
    for bot, evs in per_bot_ev.items():
        out['loops'] += [(bot, t, plot) for t, plot in loops(evs)]
    out['bots'] = sorted(out['bots'])
    return out


def hm(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%H:%M')


def render(r, run, version):
    L = []
    w = L.append
    span_h = (r['t1'] - r['t0']) / 3600.0
    w(f'# buildfirst read `{run}`')
    w('')
    w(f'Release `{version}`. {hm(r["t0"])}-{hm(r["t1"])}Z ({span_h:.2f} h), {r["rows"]:,} rows from {len(r["bots"])} bots.')
    w('')
    w('## Blocks placed by build visits, per hour')
    w('')
    w('| hour | unfinished buildings | repairs and upkeep | tidy |')
    w('|---|---|---|---|')
    tot = {'unfinished': 0, 'repairs': 0, 'tidy': 0}
    for h in r['hours']:
        cells = []
        for g in ('unfinished', 'repairs', 'tidy'):
            d = r['placed'][h].get(g, {})
            tot[g] += sum(d.values())
            cells.append(f'{sum(d.values())}' + (' (' + ', '.join(f'{p} {n}' for p, n in sorted(d.items(), key=lambda x: -x[1]) if n) + ')' if any(d.values()) else ''))
        w(f'| {hm(h)}Z | ' + ' | '.join(cells) + ' |')
    allp = sum(tot.values())
    w(f'| all | {tot["unfinished"]} | {tot["repairs"]} | {tot["tidy"]} |')
    w('')
    w(f'Of {allp} blocks placed in {sum(r["visits"].values())} build visits, {tot["unfinished"]} '
      f'({(100.0 * tot["unfinished"] / allp) if allp else 0:.0f}%) went into unfinished buildings.')
    w('')
    w('## Unfinished buildings, one by one')
    for p in UNFINISHED:
        v = r['visits'].get(p, 0)
        placed = sum(r['placed'][h].get('unfinished', {}).get(p, 0) for h in r['hours'])
        oc = r['outcomes'].get(p, {})
        segs = sorted((sg, d) for (pp, sg), d in r['segs'].items() if pp == p)
        w(f'- {p}: {v} visits, {placed} placed' + ('; ended ' + ', '.join(f'{k} {n}' for k, n in sorted(oc.items(), key=lambda x: -x[1])) if oc else '')
          + (f'; **completed** ({r["complete"][p]} `_structure_complete`)' if r['complete'].get(p) else '; not completed')
          + ('; parts: ' + ', '.join(f'{sg} {d["placed"]} cells placed (now open={d["open"]} done={d["done"]})' for sg, d in segs) if segs else ''))
    other = {p: n for p, n in r['complete'].items() if p not in UNFINISHED}
    if other:
        w(f'- also completed: {other}')
    w('')
    w('## Materials for building (the draw)')
    b = r['bag']
    w(f'- build visits that logged their bag (`_build_bag`): {b["rows"]}; asked the town for something: {b["asked"]}; **left short of something: {b["short"]}**'
      + (' by item: ' + ', '.join(f'{k} {n}' for k, n in sorted(b['short_by_item'].items(), key=lambda x: -x[1]))
         + '; by project: ' + ', '.join(f'{k} {n}' for k, n in sorted(b['short_by_project'].items(), key=lambda x: -x[1])) if b['short'] else ''))
    d = r['draw_short']
    w(f'- false shortages re-asked (`_draw_short op=short`): {d["short"]}; gave up after two (`op=cap`): {d["cap"]}'
      + (f'; by plot: {d["by_plot"]}' if d['by_plot'] else ''))
    w('')
    w('## Making bag room')
    wl = r['well']
    w(f'- junk well trips (`_room_well`): {wl["trips"]}, of which {wl["threw"]} threw something; thrown: '
      + (', '.join(f'{n:,} {k}' for k, n in sorted(wl['thrown'].items())) or 'nothing')
      + (f'; slots before -> after, median {statistics.median(a for a, _ in wl["slots"]):.0f} -> {statistics.median(b for _, b in wl["slots"]):.0f}'
         f' (each trip: {", ".join(f"{a}->{b}" for a, b in wl["slots"][:20])})' if wl['slots'] else '')
      + (f'; ended: {wl["stops"]}' if wl['stops'] else ''))
    w(f'- yard trips (`_room_yard`): {r["yard"]["trips"]}; stocked: ' + (', '.join(f'{n:,} {k}' for k, n in sorted(r['yard']['stocked'].items())) or 'nothing'))
    c = r['clay']
    w(f'- clay compactions (`_compact op=bag from=clay_ball`): {c["done"]} done of {c["rows"]} tried, {c["made"]} clay blocks made')
    nh = sum(r['holds'].values())
    w(f'- plot holds (`_room_hold`): {nh}' + (' by reason: ' + ', '.join(f'{k} {n}' for k, n in sorted(r['holds'].items(), key=lambda x: -x[1]))
                                              + f'; as logged: {r["holds_raw"]}' if nh else ''))
    w('')
    w('## Bags')
    if any(r['slots_by_hour'].values()):
        w(f'- slots used at idle orders (`_build_first free=`, exact), first seen {r["first_slots"]}/36; median per hour: '
          + '; '.join(f'{hm(h)}Z {statistics.median(v):.0f}/36 (n={len(v)})' for h, v in sorted(r['slots_by_hour'].items()) if v))
    else:
        w('- slots used: no `_build_first` row carried a count (0 rows): this release may not be buildfirst')
    w('')
    w('## Idle orders')
    i = r['idle']
    n = i['building'] + i['grounds']
    w(f'- idle orders: {n}; to a building {i["building"]} ({(100.0 * i["building"] / n) if n else 0:.0f}%; `_build_first why=building`), '
      f'to the grounds {i["grounds"]} (`_work_order build_shop {{"grounds":true,"why":"idle"}}`)')
    w(f'- the steer\'s decisions (`_build_first why=`): {dict(sorted(r["build_first"].items(), key=lambda x: -x[1])) or "no row"}'
      + (f'; what it looked at: {dict(sorted(r["look"].items(), key=lambda x: -x[1]))}' if r['look'] else '')
      + (f'; passed over for want of bag room, by plot: {dict(sorted(r["room_skips"].items(), key=lambda x: -x[1]))}' if r['room_skips'] else ''))
    w('')
    w('## Visits that ended for want of material')
    if r['no_material']:
        for p, n in sorted(r['no_material'].items(), key=lambda x: -x[1]):
            w(f'- {p}: {n} of its {r["visits"].get(p, 0)} visits ended no_material')
    else:
        w(f'- none of {sum(r["visits"].values())} build visits ended no_material')
    w('')
    w(f'## At the junk well (standing cell {",".join(map(str, r["well_stand"]))})')
    if r['stays']:
        for bot, s, sec in sorted(r['stays'], key=lambda x: -x[2])[:20]:
            w(f'- {bot.replace("showcase-", "")} stood there {sec / 60:.1f} min from {hm(s)}Z')
    else:
        w(f'- no bot stayed within {WELL_NEAR} blocks of it for more than {STAY_MIN_S // 60} minutes ({len(r["bots"])} bots\' positions read)')
    if r['loops']:
        for bot, t, plot in r['loops'][:20]:
            w(f'- LOOP: {bot.replace("showcase-", "")} went well -> hold -> well for {plot} from {hm(t)}Z')
    else:
        w(f'- no well -> hold -> well loop on one plot ({wl["trips"]} well trips and {nh} holds read)')
    return '\n'.join(L) + '\n'


def collect(run):
    from lib import telemetry as T
    sys.path.insert(0, HERE)
    import testworld as TW
    rows = [json.loads(l) for l in open(TW.DEPLOY) if l.strip()]
    ts = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()     # noqa: E731
    start = [r for r in rows if r.get('event') == 'soak-start' and r.get('run') == run][-1]
    end = next((r for r in rows if r.get('event') == 'soak-end' and r.get('run') == run), None)
    t0 = ts(start['t'])
    t1 = ts(end['t']) if end else dt.datetime.now(dt.timezone.utc).timestamp()
    ev = T.Events.load(paths=f'{TW.LOGS}/*/skill-*.jsonl*', since=dt.datetime.fromtimestamp(t0, dt.timezone.utc),
                       until=dt.datetime.fromtimestamp(t1, dt.timezone.utc))
    out = []
    for r in ev.rows:
        raw = r['raw']
        sk = raw.get('skill') or {}
        p = (raw.get('bot') or {}).get('pos') or {}
        pos = (p['x'], p['y'], p['z']) if all(isinstance(p.get(k), (int, float)) for k in 'xyz') else None
        out.append((r['t'].timestamp(), (raw.get('bot') or {}).get('name'), sk.get('name'), sk.get('status'), sk.get('detail') or '', pos))
    return out, t0, t1, start['expected_version']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True)
    a = ap.parse_args()
    rows, t0, t1, version = collect(a.run)
    md = render(summarize(rows, t0, t1), a.run, version)
    out = f'/srv/testworld/soak/{a.run}'
    os.makedirs(out, exist_ok=True)
    open(f'{out}/buildfirst-read.md', 'w').write(md)
    print(md)
    return 0


if __name__ == '__main__':
    sys.exit(main())
