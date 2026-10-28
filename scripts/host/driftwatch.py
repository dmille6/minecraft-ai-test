#!/usr/bin/env python3
r"""driftwatch.py -- the DAILY DRIFT ALARM (W5, fun mode 2026-10-28): yesterday's fleet against its own last 7 days.

METRICS (one UTC day each, fleet skill stream, Elasticsearch -- these are wide windows, CLAUDE.md):
  items/bot-h   intake units / active bot-hours -- valuescore.py's `units` and `bot_hours` (the scoreboard's intake line:
                items taken from the world by gather, mine, explore, goto, surface, home)
  value/bot-h   valuescore.py's value_per_bot_h (the owner's value-weighted line, 10-23)
  deaths/bot-h  `_death` rows / active bot-hours (estelemetry coverage: (bot, hour) pairs with a document)
A day's numbers come from ~/digest/drift/<day>.json when cached, else from valuescore's own daily JSON
(~/digest/valuescore/<day>.json, cron 00:50Z), else valuescore.measure(); deaths always from ES. Each computed day is cached.

ALARM when yesterday moved more than THRESH (30 %) from the MEDIAN of the 7 days before it (>= MIN_DAYS of them readable).
Deaths are counts of tens per day, where 30 % can be noise, so a deaths move alarms only when the count is ALSO outside
the central 95 % Poisson interval of median-rate x yesterday's bot-hours; a 30 % move inside it is printed, not pushed.
Every line names its denominators (bot-hours, counts) and the days it compared against.

    python3 driftwatch.py                  (cron 01:20Z on 10.0.0.31, after valuescore's 00:50Z run)
    python3 driftwatch.py --day 2026-10-27 --no-push
"""
import argparse
import datetime as dt
import json
import math
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
from lib import alarm as AL  # noqa: E402

UTC = dt.timezone.utc
THRESH = 0.30
HISTORY = 7
MIN_DAYS = 5
METRICS = ('items_per_bot_h', 'value_per_bot_h', 'deaths_per_bot_h')


# ------------------------------------------------------------------------------------------------ pure
def poisson_cdf(k, mu):
    if k < 0:
        return 0.0
    p = c = math.exp(-mu)
    for i in range(1, int(k) + 1):
        p *= mu / i
        c += p
    return min(c, 1.0)


def drift(day, history, thresh=THRESH, min_days=MIN_DAYS):
    """PURE. day: {'items_per_bot_h', 'value_per_bot_h', 'deaths', 'bot_hours', ...}; history: list of such dicts.
    -> {metric: {'value', 'median', 'change', 'n', 'alarm', 'note'}}."""
    out = {}
    for m in METRICS:
        hv = [h[m] for h in history if h.get(m) is not None]
        v = day.get(m)
        if v is None or len(hv) < min_days:
            out[m] = {'value': v, 'median': None, 'change': None, 'n': len(hv), 'alarm': False,
                      'note': f'not judged: {len(hv)} readable history days (< {min_days})' if v is not None else 'no value'}
            continue
        med = statistics.median(hv)
        if med == 0:
            out[m] = {'value': v, 'median': 0, 'change': None, 'n': len(hv), 'alarm': v > 0,
                      'note': 'median is 0' + (' and yesterday is not' if v > 0 else '')}
            continue
        ch = (v - med) / med
        alarm, note = abs(ch) > thresh, ''
        if m == 'deaths_per_bot_h' and alarm:
            mu = med * (day.get('bot_hours') or 0)
            k = day.get('deaths') or 0
            lo, hi = poisson_cdf(k, mu), 1 - poisson_cdf(k - 1, mu)
            if min(lo, hi) >= 0.025:
                alarm, note = False, f'moved {ch:+.0%} but {k} deaths is inside the Poisson 95 % band of {mu:.1f} expected'
            else:
                note = f'{k} deaths vs {mu:.1f} expected (two-sided Poisson p < 0.05)'
        out[m] = {'value': v, 'median': med, 'change': ch, 'n': len(hv), 'alarm': alarm, 'note': note}
    return out


def lines(day_str, d, res, hist_days):
    head = (f"drift {day_str}: {d.get('bot_hours', 0):,.0f} active bot-h, {d.get('units', 0):,} intake units, "
            f"{d.get('deaths', 0)} deaths; vs median of {len(hist_days)} days {hist_days[0] if hist_days else '-'}.."
            f"{hist_days[-1] if hist_days else '-'}")
    parts, alarms = [], {}
    for m in METRICS:
        r = res[m]
        if r['change'] is None:
            s = f"{m} {r['value'] if r['value'] is None else round(r['value'], 4)} ({r['note']})"
            parts.append(('!! ' if r['alarm'] else '') + s)
            if r['alarm']:                      # a zero median has no percentage, and still alarms
                alarms[f'drift:{m}'] = f'DRIFT {day_str} {s}; {head}'
            continue
        s = f"{m} {r['value']:.4g} vs {r['median']:.4g} ({r['change']:+.0%})" + (f" [{r['note']}]" if r['note'] else '')
        parts.append(('!! ' if r['alarm'] else '') + s)
        if r['alarm']:
            alarms[f'drift:{m}'] = f'DRIFT {day_str} {s}; {head}'
    return head + ' | ' + '; '.join(parts), alarms


# ------------------------------------------------------------------------------------------------ data
def es_deaths(day):
    from lib.estelemetry import EsEvents
    ev = EsEvents.load('skill', since=dt.datetime.combine(day, dt.time(), UTC),
                       until=dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), UTC), gaps='allow')
    n = ev.total()
    if not n:
        raise RuntimeError(f'{day}: no skill documents in ES (ingest gap) -- not a quiet day')
    cov = ev.coverage()
    return int(ev.count('_death', allow_zero=True)), cov['bot_hours'], n     # n > 0 is the positive control


def day_values(day, cache_dir, vs_dir):
    cp = os.path.join(cache_dir, f'{day}.json')
    try:
        return json.load(open(cp))
    except (OSError, ValueError):
        pass
    vs = None
    try:
        vs = json.load(open(os.path.join(vs_dir, f'{day}.json')))
        src = 'valuescore cron json'
    except (OSError, ValueError):
        import valuescore
        vs = valuescore.measure(f'{day}T00:00:00Z', f'{day + dt.timedelta(days=1)}T00:00:00Z', old=False)
        src = 'valuescore.measure'
    deaths, dbh, docs = es_deaths(day)
    bh = vs.get('bot_hours') or 0
    d = {'day': str(day), 'source': src, 'units': vs.get('units'), 'value': vs.get('value'), 'bot_hours': bh,
         'items_per_bot_h': (vs['units'] / bh) if bh and vs.get('units') is not None else None,
         'value_per_bot_h': vs.get('value_per_bot_h'), 'deaths': deaths, 'deaths_bot_hours': dbh, 'docs': docs,
         'deaths_per_bot_h': deaths / dbh if dbh else None}
    if day < dt.datetime.now(UTC).date() - dt.timedelta(days=0):
        AL.write_json_atomic(cp, d)
    return d


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--day', help='UTC day judged (default yesterday)')
    ap.add_argument('--state-dir', default='~/digest')
    ap.add_argument('--valuescore-dir', default='~/digest/valuescore')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--no-state', action='store_true')
    a = ap.parse_args(argv)
    now = dt.datetime.now(UTC).replace(microsecond=0)
    day = dt.date.fromisoformat(a.day) if a.day else now.date() - dt.timedelta(days=1)
    sd = os.path.expanduser(a.state_dir)
    cache = os.path.join(sd, 'drift')
    vsd = os.path.expanduser(a.valuescore_dir)
    errors = []
    try:
        d = day_values(day, cache, vsd)
        hist, hdays = [], []
        for k in range(HISTORY, 0, -1):
            h = day - dt.timedelta(days=k)
            try:
                hist.append(day_values(h, cache, vsd)); hdays.append(str(h))
            except Exception as e:
                errors.append(f'{h}: {type(e).__name__}: {str(e)[:100]}')
        res = drift(d, hist)
        text, alarms = lines(str(day), d, res, hdays)
    except Exception as e:
        d, res = None, None
        text = f'drift {day}: CHECK FAILED ({type(e).__name__}: {str(e)[:160]})'
        alarms = {'drift:check': text}
    if errors:
        text += f' | history days unreadable: {errors}'
    print(text)
    if a.no_state:
        return 0
    AL.write_json_atomic(os.path.join(sd, 'drift-latest.json'),
                         {'generated_at': AL._iso(now), 'day': str(day), 'line': text, 'alarms': alarms,
                          'values': d, 'result': res})
    AL.raise_alarms('driftwatch', alarms, now, os.path.join(sd, 'drift.pushstate.json'),
                    log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push, repush=dt.timedelta(hours=20))
    return 0


if __name__ == '__main__':
    sys.exit(main())
