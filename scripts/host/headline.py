#!/usr/bin/env python3
r"""headline.py -- the owner's four headline numbers, week by week (OWNER 2026-11-09 course correction, point 1:
"four headline numbers, weekly, on the owner status page"). statusreport.py puts the block at the top of every report
and writes the weekly summary from it; this module holds the definitions, the week arithmetic and the day cache.

THE FOUR NUMBERS (fleet, and the showcase where the source covers it):
  working   share of OBSERVED bot-seconds in a real skill: lib/busytime.py class `productive`, the report's "working".
            Denominator = observed bot-seconds (unobserved = down or not logging, and dead time, are excluded; the same
            rule as statusreport.busy_shares). Fleet: the effectwatch hourly cache (~/effectwatch/cache, every bot-hour,
            both streams). Showcase: the same busytime.classify over its own ES streams (showcase-skill + showcase-llm).
  built     projects finished per day: `_structure_complete` rows (the bot logs one when it publishes a record's
            completion), divided by the days read. The grounds clean-up (tidy / grounds / land: it regenerates forever) is
            left out of the number and counted beside it. Both worlds, from Elasticsearch.
  value     value per ACTIVE bot-hour from valuescore.py (scoreboard.py's value line): sum of value / sum of active
            bot-hours over the days. The day files ~/digest/valuescore/<day>.json are valuescore's own cron output; a day
            without one is measured once with valuescore.measure() and cached here. Fleet only: valuescore reads the fleet
            stream, and its floors are fleet-sized.
  deaths    `_death` rows x 100 / ACTIVE bot-hours ((bot, hour) pairs with at least one row): fleetstatus.py's rate.

WEEKS are 7 full UTC days; "this week" ends at today's 00:00Z (yesterday's if it ended less than DAY_SETTLE ago, so the
nightly valuescore file and the effectwatch hours exist). The trend is the last WEEKS weeks, oldest first.

NEVER A QUIET ZERO. Each day and each part is cached in ~/digest/headline/day-<YYYY-MM-DD>.json as either its numbers
or {'unread': why}. A week shows a number only when MIN_DAYS of its 7 days were read; otherwise it shows "unread" and
the reason. ES zeros are accepted only after the kind is PROVEN to occur in the whole 4-week window (a positive control
on the name), and only for a day that holds documents. A completed day never changes, so it is read once; a part that
was unread is retried on the next run (bounded by a per-run budget for the two expensive reads).

    python3 -B host/headline.py show            # the block as markdown (reads/updates the cache)
    python3 -B host/headline.py backfill        # fill every day of the 4 weeks with no budget limit (run once, nice)
"""
import datetime as dt
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)

UTC = dt.timezone.utc
HOME = os.path.expanduser('~')
CACHE = f'{HOME}/digest/headline'
EFFECT_CACHE = f'{HOME}/effectwatch/cache'
VALUESCORE = f'{HOME}/digest/valuescore'
WEEKS = 4
MIN_DAYS = 5                       # of 7: a week with fewer days read shows "unread", never a number
MIN_CACHE_HOURS = 20               # of 24: effectwatch cache hours a fleet day needs for its working share
DAY_SETTLE = dt.timedelta(hours=3)  # valuescore writes yesterday at 00:50Z, effectcache at :12 each hour
GROUNDS = ('tidy', 'grounds', 'land')
OBS_EXCLUDE = ('unobserved', 'dead')
FLAT = 0.05                        # a week-on-week change under 5 % reads as flat
SHOW_MARGIN = (dt.timedelta(minutes=30), dt.timedelta(minutes=15))   # effectcache's MARGIN_BEFORE / MARGIN_AFTER
BUDGET = {'measure': 1, 'show_busy': 1}   # per report run: valuescore backfills (~1 min), showcase busy days (~70 s)
WORLDS = ('fleet', 'showcase')
STREAM = {'fleet': 'skill', 'showcase': 'showcase-skill'}

METRICS = (
    # key, label, format, +1 = higher is better
    ('working', 'Working share of bot time', 'pct', +1),
    ('built', 'Projects finished per day', 'f1', +1),
    ('value', 'Value per bot-hour', 'f1', +1),
    ('deaths', 'Deaths per 100 bot-hours', 'f2', -1),
)
DEFS = {
    'working': 'share of observed bot-time spent in a real skill (gather, mine, craft, build ...; busytime class '
               '"productive"). Out of: observed bot-hours (down, unlogged and dead time left out). Fleet: effectwatch '
               'hourly cache; showcase: the same classes from its own logs.',
    'built': 'projects whose record was completed (a "structure complete" row), divided by the days read. The town '
             'clean-up (tidy) regenerates forever, so it is left out and counted beside it.',
    'value': 'items taken from the world weighted by worth (1 = one log; dirt and junk weigh 0), per active bot-hour: '
             'valuescore.py, the value line of scoreboard.py, as sum of value / sum of active bot-hours. Fleet only.',
    'deaths': 'deaths x 100 / active bot-hours (a bot-hour is active when the bot wrote a row in it); fleetstatus.py\'s '
              'rate.',
}
NA = {('showcase', 'value'): 'valuescore.py reads the fleet stream only (its floors are fleet-sized)'}


# ============================================================================================ pure
def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def weeks(now, n=WEEKS):
    """PURE. -> [(start, end)] oldest first, each 7 full UTC days; the newest ends at today's 00:00Z, or yesterday's
    while today's day is younger than DAY_SETTLE (yesterday's sources are not written yet)."""
    end = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    if now - end < DAY_SETTLE:
        end -= dt.timedelta(days=1)
    return [(end - dt.timedelta(days=7 * (i + 1)), end - dt.timedelta(days=7 * i)) for i in reversed(range(n))]


def days_of(a, b):
    """PURE. the UTC day starts in [a, b)."""
    out, d = [], a
    while d < b:
        out.append(d)
        d += dt.timedelta(days=1)
    return out


def observed(sec):
    return sum(v for k, v in (sec or {}).items() if k not in OBS_EXCLUDE)


def fold(parts, metric, min_days=MIN_DAYS):
    """PURE. parts: one world's day parts for one metric over a week (None = never read) -> {'v', 'read', 'of', 'num',
    'den', 'why', 'na'}. v is None unless MIN_DAYS days were read; a zero is a number only with a non-zero denominator."""
    of = len(parts)
    got = [p for p in parts if p and 'unread' not in p and 'na' not in p]
    out = {'v': None, 'read': len(got), 'of': of}
    nas = sorted({p['na'] for p in parts if p and 'na' in p})
    if nas and len(nas) == 1 and not got:
        out['na'] = nas[0]
        return out
    if len(got) < min_days:
        whys = sorted({p.get('unread') or p.get('na') for p in parts if p and ('unread' in p or 'na' in p)})
        if any(p is None for p in parts):
            whys.append('not read yet')
        out['why'] = f'{len(got)} of {of} days read' + (': ' + '; '.join(whys) if whys else '')
        return out
    if metric == 'working':
        num = sum((p['sec'] or {}).get('productive', 0) for p in got)
        den = sum(observed(p['sec']) for p in got)
        out['den_h'] = den / 3600
    elif metric == 'built':
        num = sum(v for p in got for k, v in (p.get('by_plot') or {}).items() if k not in GROUNDS)
        out['grounds'] = sum(v for p in got for k, v in (p.get('by_plot') or {}).items() if k in GROUNDS)
        den = len(got)
    elif metric == 'value':
        num, den = sum(p['value'] for p in got), sum(p['bot_hours'] for p in got)
    elif metric == 'deaths':
        num, den = 100 * sum(p['deaths'] for p in got), sum(p['bot_hours'] for p in got)
    else:
        raise ValueError(metric)
    if not den:
        out['why'] = f'{len(got)} of {of} days read, but the denominator is 0'
        return out
    out.update(v=num / den, num=num, den=den)
    return out


def fmt(v, kind):
    if v is None:
        return None
    if kind == 'pct':
        return f'{v * 100:.0f}%'
    if kind == 'f1':
        return f'{v:.1f}'
    return f'{v:.2f}'


def trend(vals, sign):
    """PURE. vals: the weekly values oldest first (None = unread); sign +1 when higher is better -> the arrow and word
    comparing the newest week with the one before it."""
    a, b = (vals[-2] if len(vals) > 1 else None), vals[-1]
    if a is None or b is None:
        return ''
    if a == 0:
        rel = 0.0 if b == 0 else 1.0
    else:
        rel = (b - a) / abs(a)
    if abs(rel) < FLAT:
        return '→ flat'
    up = rel > 0
    return ('↑ ' if up else '↓ ') + ('better' if (up and sign > 0) or (not up and sign < 0) else 'worse')


def table(h):
    """PURE. h = facts from collect() -> {world: {metric: [fold per week, oldest first]}}."""
    out = {}
    for w in WORLDS:
        out[w] = {}
        for key, _, _, _ in METRICS:
            out[w][key] = [fold([((h['days'].get(f'{d:%Y-%m-%d}') or {}).get(w) or {}).get(key)
                                 for d in days_of(ts(a), ts(b))], key)
                           for a, b in h['weeks']]
    return out


def ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


def cell(f, kind):
    if f.get('na'):
        return 'n/a'
    if f['v'] is None:
        return 'unread'
    s = fmt(f['v'], kind)
    return s + (f' ({f["read"]}/{f["of"]} d)' if f['read'] < f['of'] else '')


def render(h, link=None):
    """PURE. -> markdown lines for the block: a table (number x world: this week, last week, 4-week trend), one
    definition line per number, and every unread or n/a cell's reason."""
    t = table(h)
    wk = h['weeks']
    L = ['## Headline numbers (weekly)',
         f'_Weeks are 7 full days (UTC). This week = {wk[-1][0][5:10]} to {ts(wk[-1][1]) - dt.timedelta(days=1):%m-%d}; '
         f'the trend runs over the last {len(wk)} weeks, oldest first.'
         + (f' Weekly summary: {link}' if link else '') + '_', '',
         '| Number | World | This week | Last week | Trend (4 weeks) |', '|---|---|---|---|---|']
    notes = []
    for key, label, kind, sign in METRICS:
        for w in WORLDS:
            fs = t[w][key]
            cur, prev = fs[-1], (fs[-2] if len(fs) > 1 else {'v': None, 'read': 0, 'of': 7})
            if cur.get('na') and all(x.get('na') for x in fs):
                L.append(f'| {label} | {w} | n/a | n/a | |')
                notes.append(f'{label}, {w}: n/a -- {cur["na"]}.')
                continue
            vals = [x['v'] for x in fs]
            spark = ' · '.join(fmt(x['v'], kind) or ('n/a' if x.get('na') else '?') for x in fs)
            L.append(f'| {label} | {w} | {cell(cur, kind)} | {cell(prev, kind)} | {spark} {trend(vals, sign)} |'.replace('  |', ' |'))
            for i, x in enumerate(fs):
                if x['v'] is None and not x.get('na'):
                    notes.append(f'{label}, {w}, week to {ts(wk[i][1]) - dt.timedelta(days=1):%m-%d}: unread -- {x.get("why")}.')
            if key == 'built' and cur['v'] is not None:
                notes.append(f'{label}, {w}, this week: {cur["num"]} finished in {cur["den"]} days, plus '
                             f'{cur.get("grounds", 0)} town clean-up rounds (not counted).')
    L.append('')
    for key, label, _, _ in METRICS:
        L.append(f'- **{label}:** {DEFS[key]}')
    if notes:
        L.append('- Notes:')
        L += [f'  - {x}' for x in notes]
    for e in h.get('errors') or []:
        L.append(f'- could not read: {e}')
    return L


def week_label(h):
    """PURE. the ISO week of this week's first day, e.g. 2026-W45 (weeks start Monday when run on a Monday)."""
    y, w, _ = ts(h['weeks'][-1][0]).isocalendar()
    return f'{y}-W{w:02d}'


def weekly_md(h, closed=(), now=None):
    """PURE. The weekly summary: the block, day-by-day tables per world, what was finished by kind, and the canaries
    closed in the week. closed: [{'run', 'verdict', 't'}] (statusreport.canary_facts' 'closed')."""
    a, b = h['weeks'][-1]
    last = ts(b) - dt.timedelta(days=1)
    L = [f'# Weekly summary -- {week_label(h)} ({ts(a):%a %m-%d} to {last:%a %m-%d}, UTC)',
         f'_Generated {h.get("at", "")} by scripts/host/statusreport.py weekly; every number comes from the lab\'s own '
         'logs and checks (definitions below the table)._', '']
    L += render(h)
    days = days_of(ts(a), ts(b))
    for w in WORLDS:
        cols = [(k, lab, kind) for k, lab, kind, _ in METRICS if (w, k) not in NA]
        L += ['', f'## Day by day ({w})', '', '| Day | ' + ' | '.join(lab for _, lab, _ in cols) + ' |',
              '|---|' + '---|' * len(cols)]
        for d in days:
            rec = (h['days'].get(f'{d:%Y-%m-%d}') or {}).get(w) or {}
            cells = []
            for k, _, kind in cols:
                x = fold([rec.get(k)], k, min_days=1)
                cells.append('n/a' if x.get('na') else (fmt(x['v'], kind) if x['v'] is not None else 'unread'))
            L.append(f'| {d:%a %m-%d} | ' + ' | '.join(cells) + ' |')
    L += ['', '## Finished this week, by kind']
    for w in WORLDS:
        tot = {}
        for d in days:
            part = ((h['days'].get(f'{d:%Y-%m-%d}') or {}).get(w) or {}).get('built') or {}
            for k, v in (part.get('by_plot') or {}).items():
                tot[k] = tot.get(k, 0) + v
        main = ', '.join(f'{k} {v}' for k, v in sorted(tot.items(), key=lambda kv: (-kv[1], kv[0])) if k not in GROUNDS)
        gr = sum(v for k, v in tot.items() if k in GROUNDS)
        L.append(f'- {w}: ' + (main or 'nothing finished') + (f' (plus {gr} town clean-up rounds, not counted)' if gr else ''))
    L += ['', '## Testing pipeline this week']
    by = {}
    for c in closed:
        by.setdefault(c['verdict'], []).append(c['run'])
    if by:
        for v in ('KEEP', 'REVERT', 'INCONCLUSIVE'):
            if by.get(v):
                L.append(f'- {v}: {len(by[v])} ({", ".join(sorted(by[v]))})')
    else:
        L.append('- no canary closed this week (or the journal could not be read)')
    return '\n'.join(L) + '\n'


def built_by_plot(details):
    """PURE. `_structure_complete` details -> {plot: n} (the plot's first word: tidy.slot2 -> tidy)."""
    out = {}
    for d in details:
        m = re.search(r'\bproject=([^\s|;,]+)', d or '')
        p = (m.group(1) if m else '?').split('.')[0]
        out[p] = out.get(p, 0) + 1
    return out


def fleet_working_day(hour_dicts):
    """PURE. the effectwatch cache hours of one day (loaded dicts) -> {'sec', 'hours'} or {'unread'}."""
    sec = {}
    for d in hour_dicts:
        for b in (d.get('bots') or {}).values():
            for c in b.values():
                for k, v in (c.get('busy') or {}).items():
                    sec[k] = sec.get(k, 0.0) + v
    n = len(hour_dicts)
    if n < MIN_CACHE_HOURS:
        return {'unread': f'effectwatch cache holds {n} of the day\'s 24 hours (it keeps 21 days)'}
    if not observed(sec):
        return {'unread': 'effectwatch cache hours hold no observed time'}
    return {'sec': sec, 'hours': n}


# ============================================================================================ impure
def _jload(p):
    with open(p) as fh:
        return json.load(fh)


def _write(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(obj, fh, indent=1, sort_keys=True, default=str)
    os.replace(tmp, p)


def read_fleet_working(day):
    hs = []
    for i in range(24):
        p = os.path.join(EFFECT_CACHE, (day + dt.timedelta(hours=i)).strftime('%Y%m%dT%H') + '.json.gz')
        try:
            with gzip.open(p, 'rt') as fh:
                hs.append(json.load(fh))
        except (OSError, ValueError, EOFError):
            pass
    return fleet_working_day(hs)


def read_fleet_value(day, budget):
    p = f'{VALUESCORE}/{day:%Y-%m-%d}.json'
    try:
        d = _jload(p)
        if d.get('value') is not None and d.get('bot_hours'):
            return {'value': float(d['value']), 'bot_hours': float(d['bot_hours']), 'src': 'valuescore day file'}
    except (OSError, ValueError):
        pass
    if budget.get('measure', 0) <= 0:
        return {'unread': 'no valuescore day file; measuring it waits for a later run'}
    budget['measure'] -= 1
    import valuescore as VS
    try:
        res = VS.measure(iso(day), iso(day + dt.timedelta(days=1)))
    except VS.ValueBlind as e:
        return {'unread': f'valuescore refused the day: {str(e)[:120]}'}
    return {'value': float(res['value']), 'bot_hours': float(res['bot_hours']), 'src': 'valuescore.measure (headline)'}


def prove(world, a, b):
    """The positive control: both kinds must occur in the whole window; -> {'first_built': iso or None}."""
    from lib.estelemetry import EsEvents, ZeroLooksWrong
    ev = EsEvents.load(STREAM[world], since=a, until=b, gaps='clip')
    names = ev.names()
    if not names.get('_death'):
        raise ZeroLooksWrong(f'{world}: no _death row in {iso(a)}..{iso(b)} ({ev.total():,} docs): name changed?')
    first = None
    if names.get('_structure_complete'):
        for r in ev.rows('_structure_complete', fields=['@timestamp'], max_rows=50_000):
            first = r['@timestamp']
            break
    return {'first_built': first}


def read_es_day(world, day, proof):
    """-> {'deaths': part, 'built': part} for one world-day from Elasticsearch."""
    from lib.estelemetry import EsEvents
    ev = EsEvents.load(STREAM[world], since=day, until=day + dt.timedelta(days=1), gaps='clip')
    if not ev.total():
        why = {'unread': 'no documents that day (world stopped or ingest down)'}
        return {'deaths': why, 'built': why}
    bh = ev.coverage()['bot_hours']
    out = {'deaths': {'deaths': int(ev.count('_death', allow_zero=True)), 'bot_hours': bh, 'docs': ev.total()}}
    fb = proof.get('first_built')
    if not fb or day + dt.timedelta(days=1) <= ts(fb):
        out['built'] = {'na': 'no "structure complete" row exists before ' + (fb[:10] if fb else 'this window')}
    else:
        det = [((r.get('skill') or {}).get('detail') or '') for r in
               ev.rows('_structure_complete', fields=['skill.detail'], max_rows=50_000, allow_zero=True)]
        out['built'] = {'by_plot': built_by_plot(det)}
    return out


def read_show_working(day):
    """busytime over the showcase's ES streams for one day (effectcache's rule, per bot, margins included)."""
    from lib.estelemetry import EsEvents
    from lib import busytime as BT
    lo, hi = day - SHOW_MARGIN[0], day + dt.timedelta(days=1) + SHOW_MARGIN[1]
    ep = lambda s: ts(s).timestamp()
    bots = {}

    def B(name):
        return bots.setdefault(name, {'skills': [], 'pauses': [], 'deaths': [], 'stamps': [], 'llms': []})
    s = EsEvents.load('showcase-skill', since=lo, until=hi, gaps='clip')
    if not s.total():
        return {'unread': 'no showcase documents that day'}
    for r in s.rows(fields=['@timestamp', 'bot.name', 'skill.name', 'skill.duration_ms', 'skill.detail'], max_rows=900_000):
        sk = r.get('skill') or {}
        n, b = sk.get('name'), (r.get('bot') or {}).get('name')
        if not n or not b:
            continue
        e, x = ep(r['@timestamp']), B(b)
        x['stamps'].append(e)
        iv = BT.skill_interval(e, n, sk.get('duration_ms'))
        if iv:
            x['skills'].append(iv)
        if n == '_decision_skipped':
            ps = BT.pause_seconds(sk.get('detail'))
            if ps:
                x['pauses'].append((e, ps))
        if n == '_death':
            x['deaths'].append(e)
    lv = EsEvents.load('showcase-llm', since=lo, until=hi, gaps='clip')
    for r in lv.rows(fields=['@timestamp', 'bot.name', 'llm.latency_ms', 'llm.completion_tokens'], max_rows=400_000,
                     allow_zero=True):
        b = (r.get('bot') or {}).get('name')
        if not b:
            continue
        e, L = ep(r['@timestamp']), (r.get('llm') or {})
        x = B(b)
        x['stamps'].append(e)
        if L.get('completion_tokens') is not None:        # effectmetrics.is_model_call: an order row is no model call
            try:
                x['llms'].append((e, float(L.get('latency_ms') or 0) / 1000.0))
            except (TypeError, ValueError):
                pass
    a, z = day.timestamp(), (day + dt.timedelta(days=1)).timestamp()
    sec = {}
    for x in bots.values():
        for k, v in BT.classify(a, z, x['skills'], x['llms'], x['pauses'], x['deaths'], x['stamps']).items():
            sec[k] = sec.get(k, 0.0) + v
    if not observed(sec):
        return {'unread': 'showcase rows hold no observed time'}
    return {'sec': sec, 'bots': len(bots)}


def collect(now, budget=None, cache=None, log=None):
    """Read what the cache lacks for the WEEKS weeks and -> facts {'weeks': [[a, b]], 'days': {day: {world: {metric:
    part}}}, 'errors': [...]}. Writes ~/digest/headline/day-*.json; never touches anything else."""
    cache = cache or CACHE
    budget = dict(BUDGET if budget is None else budget)
    ws = weeks(now)
    h = {'weeks': [[iso(a), iso(b)] for a, b in ws], 'days': {}, 'errors': [], 'at': iso(now)}
    proofs = {}
    for day in reversed(days_of(ws[0][0], ws[-1][1])):            # newest first: this week fills first
        key = day.strftime('%Y-%m-%d')
        p = os.path.join(cache, f'day-{key}.json')
        try:
            rec = _jload(p)
        except (OSError, ValueError):
            rec = {}
        dirty = False
        for w in WORLDS:
            r = rec.setdefault(w, {})
            need = lambda m: m not in r or 'unread' in r[m]
            for m in ('value',):
                if (w, m) in NA:
                    if 'na' not in r.get(m, {}):
                        r[m], dirty = {'na': NA[(w, m)]}, True
                elif need(m):
                    try:
                        r[m] = read_fleet_value(day, budget)
                    except Exception as e:  # noqa: BLE001
                        r[m] = {'unread': f'{type(e).__name__}: {str(e)[:120]}'}
                    dirty = True
            if need('deaths') or need('built'):
                try:
                    if w not in proofs:
                        proofs[w] = prove(w, ws[0][0], ws[-1][1])
                    got = read_es_day(w, day, proofs[w])
                    for m in ('deaths', 'built'):
                        if need(m):
                            r[m] = got[m]
                except Exception as e:  # noqa: BLE001 -- a source down is an unread part, retried next run
                    for m in ('deaths', 'built'):
                        if need(m):
                            r[m] = {'unread': f'{type(e).__name__}: {str(e)[:120]}'}
                    if f'{w}: {type(e).__name__}' not in ' '.join(h['errors']):
                        h['errors'].append(f'{w} Elasticsearch: {type(e).__name__}: {str(e)[:120]}')
                dirty = True
            if need('working'):
                if w == 'fleet':
                    r['working'] = read_fleet_working(day)
                elif budget.get('show_busy', 0) > 0:
                    budget['show_busy'] -= 1
                    try:
                        r['working'] = read_show_working(day)
                    except Exception as e:  # noqa: BLE001
                        r['working'] = {'unread': f'{type(e).__name__}: {str(e)[:120]}'}
                else:
                    r['working'] = {'unread': 'showcase busy time for this day waits for a later run'}
                dirty = True
                if log:
                    log(f'{key} {w} working: {"read" if "sec" in r["working"] else r["working"]["unread"]}')
        if dirty:
            _write(p, rec)
        h['days'][key] = rec
    return h


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cmd', choices=['show', 'backfill'])
    ap.add_argument('--cache', default=CACHE)
    a = ap.parse_args(argv)
    now = dt.datetime.now(UTC)
    budget = {'measure': 99, 'show_busy': 99} if a.cmd == 'backfill' else None
    h = collect(now, budget, a.cache, log=(lambda s: print(s, flush=True)) if a.cmd == 'backfill' else None)
    print('\n'.join(render(h)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
