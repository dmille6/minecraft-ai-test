#!/usr/bin/env python3
"""Tests for headline.py's pure parts (week math, the four definitions, rendering): python3 -B scripts/host/test_headline.py

Each MUTANT (one changed line of headline.py, its anchor asserted present and unique) re-runs the check it should break
against the mutated module and must FAIL there."""
import datetime as dt
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'headline.py')
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 9, 13, 30, tzinfo=UTC)
FAILS = []


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


H = load(SRC, 'headline_under_test')
R = load(os.path.join(HERE, 'statusreport.py'), 'statusreport_for_headline')


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok:
        FAILS.append(name)


def sec(prod, idle, unobs=0.0, dead=0.0):
    return {'productive': prod, 'walking': 0.0, 'llm_wait': 0.0, 'paused': 0.0, 'dead': dead, 'between': 0.0,
            'unobserved': unobs, 'idle': idle}


def facts(M, days_read=7, show_value_na=True):
    """4 weeks to 11-09; the fleet reads every day, the showcase only `days_read` days of the newest week."""
    ws = M.weeks(NOW)
    h = {'weeks': [[M.iso(a), M.iso(b)] for a, b in ws], 'days': {}, 'errors': [], 'at': M.iso(NOW)}
    for wi, (a, b) in enumerate(ws):
        for i, d in enumerate(M.days_of(a, b)):
            fleet = {'working': {'sec': sec(1800 + 100 * wi, 1800)}, 'built': {'by_plot': {'wall': 1, 'tidy': 9}},
                     'value': {'value': 1000.0 * (wi + 1), 'bot_hours': 100.0},
                     'deaths': {'deaths': 4 - wi, 'bot_hours': 200.0}}
            ok = wi == 3 and i < days_read
            show = {'working': {'sec': sec(900, 2700)} if ok else {'unread': 'waits'},
                    'built': {'by_plot': {'decor': 1}} if ok else {'unread': 'no documents'},
                    'value': {'na': 'fleet only'},
                    'deaths': {'deaths': 0, 'bot_hours': 50.0} if ok else {'unread': 'no documents'}}
            h['days'][f'{d:%Y-%m-%d}'] = {'fleet': fleet, 'showcase': show}
    return h


def ck_weeks(M):
    w = M.weeks(NOW)
    early = M.weeks(dt.datetime(2026, 11, 9, 1, 0, tzinfo=UTC))
    return (len(w) == 4 and w[-1][1] == dt.datetime(2026, 11, 9, tzinfo=UTC) and w[0][0] == dt.datetime(2026, 10, 12, tzinfo=UTC)
            and early[-1][1] == dt.datetime(2026, 11, 8, tzinfo=UTC) and all((b - a).days == 7 for a, b in w))


def ck_fold_min_days(M):
    part = {'deaths': 1, 'bot_hours': 100.0}
    four = M.fold([part] * 4 + [{'unread': 'x'}] * 3, 'deaths')
    five = M.fold([part] * 5 + [None] * 2, 'deaths')
    return four['v'] is None and '4 of 7' in four['why'] and abs(five['v'] - 1.0) < 1e-9 and five['read'] == 5


def ck_working(M):
    f = M.fold([{'sec': sec(10, 10, unobs=80, dead=5)}] * 7, 'working')
    agrees = abs(R.busy_shares(sec(10, 10, unobs=80, dead=5))['skills'] - f['v']) < 1e-9
    return abs(f['v'] - 0.5) < 1e-9 and agrees


def ck_built(M):
    f = M.fold([{'by_plot': {'tidy': 10, 'wall': 2}}] * 7, 'built')
    zero = M.fold([{'by_plot': {}}] * 7, 'built')
    return abs(f['v'] - 2.0) < 1e-9 and f['grounds'] == 70 and zero['v'] == 0


def ck_value(M):
    f = M.fold([{'value': 100.0, 'bot_hours': 10.0}, {'value': 0.0, 'bot_hours': 90.0}] + [{'value': 0.0, 'bot_hours': 0.0}] * 3,
               'value')
    return abs(f['v'] - 1.0) < 1e-9          # sum/sum = 100/100, not the mean of ratios (2.0)


def ck_deaths(M):
    f = M.fold([{'deaths': 1, 'bot_hours': 50.0}] * 7, 'deaths')
    return abs(f['v'] - 2.0) < 1e-9


def ck_trend(M):
    return (M.trend([2.0, 1.0], -1) == '↓ better' and M.trend([0.2, 0.1], +1) == '↓ worse'
            and M.trend([1.0, 1.02], +1) == '→ flat' and M.trend([None, 1.0], +1) == '' and M.trend([1, 2], +1) == '↑ better')


def ck_fleet_working_day(M):
    hour = {'bots': {'b1': {'sha': {'busy': sec(1800, 1800)}}}}
    return 'unread' in M.fleet_working_day([hour] * 19) and abs(M.fleet_working_day([hour] * 24)['sec']['productive'] - 43200) < 1e-6


def ck_built_by_plot(M):
    d = M.built_by_plot(['project=tidy.slot2 op=complete kind=tidy gen=4', 'project=wall op=complete', 'no project here'])
    return d == {'tidy': 1, 'wall': 1, '?': 1}


def ck_render(M):
    h = facts(M, days_read=3)
    L = M.render(h, link='http://x/weekly-latest.html')
    md = '\n'.join(L)
    row = lambda lab, w: next(x for x in L if x.startswith(f'| {lab} | {w} |'))
    sw = row('Working share of bot time', 'showcase')
    fw = row('Working share of bot time', 'fleet')
    fv = row('Value per bot-hour', 'fleet')
    return (L[0] == '## Headline numbers (weekly)' and '| unread |' in sw and '0%' not in sw and '3 of 7 days read' in md
            and '| n/a | n/a |' in row('Value per bot-hour', 'showcase') and '| 54% | 53% |' in fw
            and '| 40.0 | 30.0 | 10.0 · 20.0 · 30.0 · 40.0 ↑ better |' in fv
            and all(f'**{lab}:**' in md for _, lab, _, _ in M.METRICS) and 'weekly-latest.html' in md
            and '| 0.50 | 1.00 |' in row('Deaths per 100 bot-hours', 'fleet'))


def ck_weekly(M):
    md = M.weekly_md(facts(M, days_read=7), [{'run': 'a-01', 'verdict': 'KEEP', 't': 'x'},
                                              {'run': 'b-01', 'verdict': 'REVERT', 't': 'y'}])
    return ('2026-W45' in md and '## Day by day (fleet)' in md and '## Day by day (showcase)' in md
            and '| Mon 11-02 |' in md and 'KEEP: 1 (a-01)' in md and 'REVERT: 1 (b-01)' in md
            and 'fleet: wall 7 (plus 63 town clean-up rounds, not counted)' in md and 'showcase: decor 7' in md)


def ck_table_html(M):
    html = R.md_to_html('# T\n| A | B |\n|---|---|\n| 1 | **2** |\n- x\n')
    md = R.render({'generated_at': '2026-11-09T13:30:00Z', 'since': '2026-11-09T07:30:00Z', 'window_h': 6,
                   'errors': {}, 'headline': facts(M)}, R.judge({'generated_at': '2026-11-09T13:30:00Z',
                   'since': '2026-11-09T07:30:00Z', 'window_h': 6, 'errors': {}}), NOW)
    return ('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td><strong>2</strong></td></tr></table>' in html
            and '<li>x</li>' in html and md.index('## Headline numbers') < md.index('## 1. Headline'))


CHECKS = [ck_weeks, ck_fold_min_days, ck_working, ck_built, ck_value, ck_deaths, ck_trend, ck_fleet_working_day,
          ck_built_by_plot, ck_render, ck_weekly, ck_table_html]

MUTANTS = [
    ('a week with too few days still shows a number', "    if len(got) < min_days:", "    if len(got) < 1:", ck_fold_min_days),
    ('unobserved time counted as observed', "OBS_EXCLUDE = ('unobserved', 'dead')", "OBS_EXCLUDE = ('dead',)", ck_working),
    ('the grounds clean-up counted as finished projects',
     "num = sum(v for p in got for k, v in (p.get('by_plot') or {}).items() if k not in GROUNDS)",
     "num = sum(v for p in got for k, v in (p.get('by_plot') or {}).items())", ck_built),
    ('value as a mean of daily ratios', "num, den = sum(p['value'] for p in got), sum(p['bot_hours'] for p in got)",
     "num, den = sum(p['value'] / p['bot_hours'] for p in got if p['bot_hours']), len(got)", ck_value),
    ('deaths not per 100 bot-hours', "num, den = 100 * sum(p['deaths'] for p in got)", "num, den = sum(p['deaths'] for p in got)",
     ck_deaths),
    ('trend ignores which way is good', "('better' if (up and sign > 0) or (not up and sign < 0) else 'worse')",
     "('better' if up else 'worse')", ck_trend),
    ('an unsettled day counted', "    if now - end < DAY_SETTLE:", "    if False:", ck_weeks),
    ('a day with missing cache hours read as whole', "    if n < MIN_CACHE_HOURS:", "    if n < 1:", ck_fleet_working_day),
    ('an unread week shown as a number', "    if f['v'] is None:\n        return 'unread'", "    if False:\n        return 'unread'",
     ck_render),
]


def run_mutants():
    src = open(SRC).read()
    with tempfile.TemporaryDirectory() as d:
        for i, (name, old, new, ck) in enumerate(MUTANTS):
            assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {name}'
            p = os.path.join(d, f'mut{i}.py')
            with open(p, 'w') as fh:
                fh.write(src.replace(old, new))
            M = load(p, f'headline_mut{i}')
            try:
                survived = bool(ck(M))
            except Exception:
                survived = False
            check(f'mutant killed: {name} (by {ck.__name__})', not survived)


if __name__ == '__main__':
    for ck in CHECKS:
        try:
            ok = bool(ck(H))
        except Exception as e:  # noqa: BLE001
            print(f'      {ck.__name__}: {type(e).__name__}: {e}')
            ok = False
        check(ck.__name__, ok)
    run_mutants()
    print(f'\n{len(CHECKS)} checks, {len(MUTANTS)} mutants: ' + ('ALL PASS' if not FAILS else f'{len(FAILS)} FAILED: {FAILS}'))
    sys.exit(1 if FAILS else 0)
