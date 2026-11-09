#!/usr/bin/env python3
r"""finishline.py -- the "Finish line" block of the owner's status report (OWNER 2026-11-09 ~14:00Z, via the coordinator).

The finish line = M1-M3 passing plus the owner's yes on M5, on two FRESH worlds, at the small footprint. Until such a run
exists this block measures the CURRENT worlds (fleet and showcase as they are), labelled so. Every criterion, its exact
measure, source, window, threshold and the pass/partial rule are in docs/reports/finish-line-2026-11-09.md; the constants
below are the same numbers. A criterion with no source is 'unread (<why>)' and NEVER counts as a pass.

PURE: criteria(), milestone_status(), town_m2(), render(). IMPURE: collect() (Elasticsearch, the effectwatch cache, the
showcase release log), called by statusreport.py with the facts it already gathered (stuck goals, headline numbers).
"""
import datetime as dt
import gzip
import json
import os
import re

UTC = dt.timezone.utc
HOME = os.path.expanduser('~')
EFFECT_CACHE = f'{HOME}/effectwatch/cache'
DOC = 'docs/reports/finish-line-2026-11-09.md'
TIMELAPSE_LINK = 'http://10.0.0.186/videos/'
LABEL = 'current worlds (not a fresh-world run)'

STUCK_BOT_H = 1.0            # M1: a bot is stuck when a whole clock hour of its rows stays inside a STUCK_BOX box
STUCK_BOX = 2.0              # blocks, on each of x, y, z
STUCK_MIN_ROWS = 20          # rows in that hour (a bot that barely logged is not judged)
M1_DEATHS = 1.0              # per 100 active bot-hours, the headline's 7-day number
M2_HOUSES = 4
M2_STUCK_H = 6.0
M2_WORKING = 0.50
M4_DIAMOND_SHARE = 0.50
WINDOW_D = 7
STRUCT_SINCE = '2026-10-20T00:00:00Z'   # the oldest showcase-skill day; structures are counted ever-completed from here
KINDS = {                    # M2 kinds: a town has the kind when a project of these plots ever completed
    'walls': r'^(wall|wallext)$',
    'houses': r'^(house\d*|cottage\d*|hall)$',
    'storage': r'^(storehouse|storehub|shopchest)$',
    'farm': r'^(cropfarm|treefarm|canefarm|forest|farm)$',
    'roads': r'^(paths|road)$',
    'mine': r'^(shaft|stepwell|minewell)$',
}
ADMIN_EVENTS = ('owner-repair', 'owner-direct-world-edit')
DIAMOND = re.compile(r'^(diamond|netherite)_(pickaxe|axe|shovel|sword|hoe)$')
NOT_EMPLOYED = ('none', 'nitwit')


# ============================================================================================ pure
def crit(name, measured, ok, unread=None):
    """one criterion: {'name', 'measured', 'state': pass | fail | unread}."""
    if unread:
        return {'name': name, 'measured': f'unread ({unread})', 'state': 'unread'}
    return {'name': name, 'measured': measured, 'state': 'pass' if ok else 'fail'}


def milestone_status(cs):
    """PURE. pass only when every criterion passes; 'not yet' when none does; else 'partial'. Unread never passes."""
    if not cs:
        return 'unread'
    n = sum(c['state'] == 'pass' for c in cs)
    un = sum(c['state'] == 'unread' for c in cs)
    s = 'pass' if n == len(cs) else ('not yet' if n == 0 else 'partial')
    return s + (f' ({un} unread)' if un else '')


def kinds_of(plots):
    """PURE. completed plot names -> {kind: [plots]}; houses as a list (counted)."""
    out = {k: sorted(p for p in plots if re.match(rx, p)) for k, rx in KINDS.items()}
    return out


def town_m2(town, plots, stuck_h, working, admin):
    """PURE. One town's M2 criteria. plots: completed plot names; stuck_h: longest stuck project hours (0 = none) or None
    (unread); working: share or None; admin: admin edits in the window or None (unread, never a pass)."""
    k = kinds_of(plots)
    cs = []
    for kind in ('walls', 'storage', 'farm', 'roads', 'mine'):
        cs.append(crit(kind, ', '.join(k[kind]) or 'none', bool(k[kind])))
    cs.append(crit(f'{M2_HOUSES}+ roofed houses', f'{len(k["houses"])}', len(k['houses']) >= M2_HOUSES))
    cs.append(crit(f'no project stuck > {M2_STUCK_H:g} h', f'longest {stuck_h:.1f} h' if stuck_h else 'none stuck',
                   (stuck_h or 0) <= M2_STUCK_H, None if stuck_h is not None else 'stuck goals not read'))
    cs.append(crit(f'working share > {M2_WORKING:.0%}', f'{working:.0%}' if working is not None else '',
                   working is not None and working > M2_WORKING, None if working is not None else 'no busy time for this town'))
    cs.append(crit('no admin edits (7 d)', f'{admin}' if admin is not None else '', admin == 0,
                   None if admin is not None else 'no admin-edit journal for this world'))
    return {'town': town, 'criteria': cs, 'status': milestone_status(cs)}


def m2_world(towns):
    """PURE. per-town M2 -> the world's status: pass when every town passes; partial when any criterion passes somewhere."""
    if not towns:
        return {'status': 'unread', 'pass_towns': 0, 'towns': 0, 'by_crit': {}, 'town_rows': []}
    by = {}
    for t in towns:
        for c in t['criteria']:
            by.setdefault(c['name'], [0, 0, 0])
            by[c['name']][{'pass': 0, 'fail': 1, 'unread': 2}[c['state']]] += 1
    np_ = sum(t['status'] == 'pass' for t in towns)
    anyp = any(v[0] for v in by.values())
    un = sum(1 for v in by.values() if v[2])
    s = 'pass' if np_ == len(towns) else ('partial' if anyp else 'not yet')
    return {'status': s + (f' ({un} criteria unread)' if un else ''), 'pass_towns': np_, 'towns': len(towns), 'by_crit': by}


def admin_count(rows, since):
    """PURE. release-log rows -> (admin edits since `since`, None) or (None, why). An edit found is a count even when the log
    does not reach back the whole window; NO edit found counts as 0 only when the log covers the window."""
    ts_ = [_ts(r['t']) for r in rows if r.get('t')]
    n = sum(1 for r in rows if r.get('event') in ADMIN_EVENTS and r.get('t') and _ts(r['t']) >= since)
    if n or (ts_ and min(ts_) <= since):
        return n, None
    return None, 'the release log served does not reach back 7 days and holds no admin edit'


def stuck_bots(buckets):
    """PURE. [(bot, hour, rows, (minx, maxx), (miny, maxy), (minz, maxz))] -> {bot: hours stuck}. A full clock hour with at
    least STUCK_MIN_ROWS rows whose positions stay inside STUCK_BOX on every axis is one stuck hour."""
    out = {}
    for bot, _h, rows, *rng in buckets:
        if rows >= STUCK_MIN_ROWS and all(a is not None and b is not None and b - a <= STUCK_BOX for a, b in rng):
            out[bot] = out.get(bot, 0) + 1
    return {b: h for b, h in out.items() if h >= STUCK_BOT_H}


def employed(details):
    """PURE. `_merchant_seen` details -> sightings of an employed villager (profession not none/nitwit)."""
    n = 0
    for d in details:
        m = re.match(r'\s*villager (\S+) L\d', d or '')
        if m and m.group(1) not in NOT_EMPLOYED:
            n += 1
    return n


def diamond_share(snaps):
    """PURE. {bot: _source with bot.tools / bot.inventory} -> (holders, bots)."""
    held = 0
    for s in snaps.values():
        b = s.get('bot') or {}
        names = set((b.get('tools') or {}).keys()) | set((b.get('inventory') or {}).keys())
        held += any(DIAMOND.match(n) for n in names)
    return held, len(snaps)


def render(fl):
    """PURE. -> markdown lines."""
    L = [f'## Finish line -- {LABEL}',
         '_Goal = M1-M3 passing plus the owner\'s yes on M5, on 2 fresh worlds, at the small footprint. Measured here on the '
         f'worlds as they are. Definitions: {DOC}. Unread never counts as a pass._', '',
         '| Milestone | World | Status | Measured |', '|---|---|---|---|']
    for mk, title in (('M1', 'Survives anywhere'), ('M2', 'Builds a town by itself'), ('M3', 'Town economy'),
                      ('M4', 'Progression'), ('M5', 'Looks like a town')):
        for w in ('fleet', 'showcase'):
            m = ((fl.get(w) or {}).get(mk)) or {}
            if mk == 'M2' and m.get('towns') == 1 and m.get('town_rows'):
                meas = '; '.join(f'{c["name"]}: {c["measured"]}' for c in m['town_rows'][0]['criteria'])
            elif mk == 'M2' and m.get('towns') is not None:
                meas = f'{m["pass_towns"]} of {m["towns"]} towns pass; ' + '; '.join(
                    f'{k} {v[0]}/{m["towns"]}' for k, v in m['by_crit'].items())
            else:
                meas = '; '.join(f'{c["name"]}: {c["measured"]}' for c in m.get('criteria') or []) or m.get('measured', '')
            L.append(f'| {mk} {title} | {w} | **{m.get("status", "unread")}** | {meas} |')
    for e in fl.get('errors') or []:
        L.append(f'- could not read: {e}')
    return L


# ============================================================================================ impure
def _ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


def _hour_buckets(EsEvents, stream, since, until):
    ev = EsEvents.load(stream, since=since, until=until, gaps='clip')
    q = ev._query()
    q['bool']['filter'].append({'exists': {'field': 'bot.pos.x'}})
    mm = lambda f: {f'min_{f}': {'min': {'field': f'bot.pos.{f}'}}, f'max_{f}': {'max': {'field': f'bot.pos.{f}'}}}
    aggs = {}
    for f in 'xyz':
        aggs.update(mm(f))
    r = ev._search({'size': 0, 'query': q, 'aggs': {'b': {'terms': {'field': 'bot.name', 'size': 500}, 'aggs': {
        'h': {'date_histogram': {'field': '@timestamp', 'fixed_interval': '1h', 'min_doc_count': 1}, 'aggs': aggs}}}}})
    out = []
    for bb in ev._complete(r['aggregations']['b'], 'bot terms')['buckets']:
        for hb in bb['h']['buckets']:
            hs = _ts(hb['key_as_string'])
            if hs < since or hs + dt.timedelta(hours=1) > until:
                continue                     # only whole clock hours inside the window
            out.append((bb['key'], hb['key_as_string'], hb['doc_count'],
                        *((hb[f'min_{f}']['value'], hb[f'max_{f}']['value']) for f in 'xyz')))
    return out, len(ev.bots_present())


def _working_by_pool(now):
    sec = {}
    hours = 0
    end = now.replace(minute=0, second=0, microsecond=0)
    for i in range(1, WINDOW_D * 24 + 1):
        p = os.path.join(EFFECT_CACHE, (end - dt.timedelta(hours=i)).strftime('%Y%m%dT%H') + '.json.gz')
        try:
            with gzip.open(p, 'rt') as fh:
                d = json.load(fh)
        except (OSError, ValueError, EOFError):
            continue
        hours += 1
        for b in (d.get('bots') or {}).values():
            for c in b.values():
                s = sec.setdefault(c.get('pool') or '-', {})
                for k, v in (c.get('busy') or {}).items():
                    s[k] = s.get(k, 0.0) + v
    if hours < WINDOW_D * 24 * 0.8:
        return None, hours
    out = {}
    for pool, s in sec.items():
        obs = sum(v for k, v in s.items() if k not in ('unobserved', 'dead'))
        out[pool] = s.get('productive', 0) / obs if obs else None
    return out, hours


def collect(now, f, show_releases=None):
    """-> {'fleet': {M1..M5}, 'showcase': {...}, 'errors': [...]}. f = statusreport's facts (goals, showcase, headline)."""
    from lib.estelemetry import EsEvents
    import headline as HL
    errors = []
    fl = {'fleet': {}, 'showcase': {}, 'errors': errors, 'label': LABEL}
    until = now - dt.timedelta(minutes=5)
    wk = until - dt.timedelta(days=WINDOW_D)
    day = until - dt.timedelta(hours=24)
    stream = {'fleet': 'skill', 'showcase': 'showcase-skill'}
    hl = None
    try:
        hl = HL.table(f['headline']) if f.get('headline') else None
    except Exception as e:  # noqa: BLE001
        errors.append(f'headline numbers: {type(e).__name__}: {e}')

    # admin edits: the showcase release log (owner-repair / owner-direct-world-edit); the fleet has no such journal
    admin = {'fleet': None, 'showcase': None}
    admin_why = {'fleet': 'the fleet has no admin-edit journal (no world-edit row kind in canary-journal.jsonl)'}
    if show_releases is not None:
        admin['showcase'], admin_why['showcase'] = admin_count(show_releases, wk)
    else:
        admin_why['showcase'] = 'the showcase release log was not read'

    for w in ('fleet', 'showcase'):
        R = fl[w]
        try:
            ev7 = EsEvents.load(stream[w], since=wk, until=until, gaps='clip')
            names = ev7.names()
            if not names.get('_death'):
                raise RuntimeError(f'{stream[w]}: no _death row in 7 d ({ev7.total():,} docs): window or names wrong')
        except Exception as e:  # noqa: BLE001
            errors.append(f'{w} Elasticsearch: {type(e).__name__}: {str(e)[:120]}')
            for mk in ('M1', 'M2', 'M3', 'M4'):
                R[mk] = {'status': 'unread', 'criteria': [crit('all', '', False, 'Elasticsearch not read')]}
            R['M5'] = {'status': 'owner review pending', 'criteria': [crit('owner judgement', f'timelapse {TIMELAPSE_LINK}', False)]}
            continue
        # ---- M1
        cs = []
        try:
            bk, nb = _hour_buckets(EsEvents, stream[w], day, until)
            sb = stuck_bots(bk)
            cs.append(crit('bots stuck > 1 h (24 h)', f'{len(sb)} of {nb}' + (': ' + ', '.join(
                f'{b} {h} h' for b, h in sorted(sb.items(), key=lambda x: -x[1])[:4]) if sb else ''), not sb,
                None if bk else 'no position rows'))
        except Exception as e:  # noqa: BLE001
            cs.append(crit('bots stuck > 1 h (24 h)', '', False, f'{type(e).__name__}'))
        dv = hl[w]['deaths'][-1] if hl else None
        cs.append(crit('deaths per 100 bot-h (7 d)', f'{dv["v"]:.2f}' if dv and dv['v'] is not None else '',
                       bool(dv and dv['v'] is not None and dv['v'] < M1_DEATHS),
                       None if dv and dv['v'] is not None else 'headline deaths unread'))
        cs.append(crit('admin edits (7 d)', f'{admin[w]}' if admin[w] is not None else '', admin[w] == 0,
                       None if admin[w] is not None else admin_why.get(w)))
        R['M1'] = {'status': milestone_status(cs), 'criteria': cs}
        # ---- M2 (per town)
        try:
            evs = EsEvents.load(stream[w], since=_ts(STRUCT_SINCE), until=until, gaps='clip')
            plots = {}
            for r in evs.rows('_structure_complete', fields=['skill.detail', 'exp.pool'], max_rows=50_000, allow_zero=True):
                town = 'showcase' if w == 'showcase' else ((r.get('exp') or {}).get('pool') or '-')
                m = re.search(r'\bproject=([^\s|;,]+)', (r.get('skill') or {}).get('detail') or '')
                if m:
                    plots.setdefault(town, set()).add(m.group(1).split('.')[0] if m.group(1).startswith('tidy') else m.group(1))
            if w == 'fleet':
                towns = sorted(set(ev7.by_pool(allow_zero=True).keys()) - {'<missing>'})
                g = f.get('goals') or {}
                stuck = {} if g.get('read') else None
                for s in (g.get('stuck') or []):
                    stuck[s['town']] = max(stuck.get(s['town'], 0), s['hours'])
                wp, _ = _working_by_pool(now)
            else:
                towns = ['showcase']
                sc = f.get('showcase') or {}
                stuck = {} if 'stuck' in sc else None
                for s in (sc.get('stuck') or []):
                    stuck['showcase'] = max(stuck.get('showcase', 0), s['hours'])
                wv = hl['showcase']['working'][-1]['v'] if hl else None
                wp = {'showcase': wv} if wv is not None else None
            T = [town_m2(t, plots.get(t, set()), (stuck.get(t, 0) if stuck is not None else None),
                         (wp or {}).get(t) if wp is not None else None, admin[w]) for t in towns]
            R['M2'] = m2_world(T)
            R['M2']['town_rows'] = T
        except Exception as e:  # noqa: BLE001
            errors.append(f'{w} M2: {type(e).__name__}: {str(e)[:120]}')
            R['M2'] = {'status': 'unread', 'criteria': [crit('towns', '', False, f'{type(e).__name__}')]}
        # ---- M3
        cs = []
        if names.get('_merchant_seen'):
            det = [((r.get('skill') or {}).get('detail') or '') for r in
                   ev7.rows('_merchant_seen', fields=['skill.detail'], max_rows=100_000)]
            e = employed(det)
            cs.append(crit('villagers employed', f'{e} employed sightings of {len(det)} villager sightings', e > 0))
        else:
            cs.append(crit('villagers employed', '', False, 'no _merchant_seen (villager scout) rows in 7 d'))
        cs.append(crit('births', '', False, 'no villager birth/breeding row kind exists'))
        cs.append(crit('trades', '', False, 'no executed-trade row kind exists'
                       + (f' (wandering-trader offers seen: {names["_trade_seen"]})' if names.get('_trade_seen') else '')))
        cs.append(crit('food produced', '', False, 'no harvest/food-production row kind exists'))
        eaten = int(ev7.count('eat', status='success', allow_zero=True)) if names.get('eat') else None
        cs.append(crit('food eaten', f'{eaten} meals', bool(eaten), None if eaten is not None else 'no eat rows in 7 d'))
        R['M3'] = {'status': milestone_status(cs), 'criteria': cs}
        # ---- M4
        cs = []
        try:
            snaps = ev7.__class__.load(stream[w], since=day, until=until, gaps='clip').latest(
                require='bot.pos.x', fields=['bot.tools', 'bot.inventory'])
            h, n = diamond_share(snaps)
            cs.append(crit('bots holding a diamond tool', f'{h} of {n}', n > 0 and h / n >= M4_DIAMOND_SHARE,
                           None if n else 'no snapshots'))
        except Exception as e:  # noqa: BLE001
            cs.append(crit('bots holding a diamond tool', '', False, f'{type(e).__name__}'))
        if names.get('_enchant_tool'):
            en = int(ev7.count('_enchant_tool', status='success', allow_zero=True))
            cs.append(crit('enchanting (7 d)', f'{en} enchanted of {names["_enchant_tool"]} tries', en > 0))
        else:
            cs.append(crit('enchanting (7 d)', '', False, 'no _enchant_tool rows in 7 d'))
        R['M4'] = {'status': milestone_status(cs), 'criteria': cs}
        R['M5'] = {'status': 'owner review pending', 'criteria': [crit('owner judgement', f'latest timelapse {TIMELAPSE_LINK}',
                                                                         False)]}
    return fl
