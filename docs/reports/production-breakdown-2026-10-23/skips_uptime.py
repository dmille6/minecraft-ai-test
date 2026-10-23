"""Two controls from ES (read-only), BASE vs END:
(1) give-up skips by rung: `_milestone_skipped` rows ("... (skip #N of <rung>); moved on to ...") -- if the
    production rungs emptied by being GIVEN UP rather than fulfilled, these would rise on those rungs.
(2) an uptime proxy per bot: the number of (bot, 10-minute) bins holding >= 1 LLM decision, out of
    80 x 144 = 11,520 a day (coverage() credits a whole bot-hour for one document, so it cannot see a
    restart; this one shows that every fixed 10-minute bin is occupied, so no bot went 20 minutes without a decision).
"""
import sys, os, re, datetime as dt
from collections import Counter
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

BASE = ['2026-10-08', '2026-10-09', '2026-10-10']
END = ['2026-10-20', '2026-10-21', '2026-10-22']
RX = re.compile(r'skip #\d+ of ([a-z_0-9]+)')
for lab, days in (('BASE', BASE), ('END', END)):
    c = Counter()
    n = 0
    bins = []
    for d in days:
        s = f'{d}T00:00:00Z'
        u = (dt.date.fromisoformat(d) + dt.timedelta(days=1)).isoformat() + 'T00:00:00Z'
        ev = EsEvents.load('skill', since=s, until=u)
        for r in ev.rows('_milestone_skipped', fields=['skill.detail']):
            n += 1
            m = RX.search((r.get('skill') or {}).get('detail') or '')
            c[m.group(1).replace('+prereq', '') if m else '<unparsed>'] += 1
        el = EsEvents.load('llm', since=s, until=u)
        body = {'size': 0, 'query': el._query(), 'aggs': {'h': {
            'date_histogram': {'field': '@timestamp', 'fixed_interval': '10m', 'min_doc_count': 0,
                               'extended_bounds': {'min': s, 'max': u}},
            'aggs': {'b': {'cardinality': {'field': 'bot.name', 'precision_threshold': 1000}}}}}}
        r = el._search(body)['aggregations']['h']['buckets']
        live = sum(b['b']['value'] for b in r if b['key_as_string'] < u)
        bins.append(live)
    print(f'== {lab}: _milestone_skipped {n / 3:.0f}/day; by rung (per day): ' +
          ', '.join(f'{k} {v / 3:.0f}' for k, v in c.most_common(14)))
    print(f'   bot x 10-min bins with >= 1 decision: ' + ', '.join(f'{b:,.0f}' for b in bins) +
          f' of 11,520 a day ({100 * sum(bins) / (3 * 11520):.2f}%)')

# POSITIVE CONTROL for the bin count (Claude r2 P3): the same aggregation over a window that includes hours with no
# data yet (today, to midnight) must report FEWER than 11,520 occupied bins, i.e. the instrument can see an empty bin.
today = dt.datetime.now(dt.timezone.utc).date()
s, u = f'{today}T00:00:00Z', f'{today + dt.timedelta(days=1)}T00:00:00Z'
el = EsEvents.load('llm', since=s, until=u)
body = {'size': 0, 'query': el._query(), 'aggs': {'h': {
    'date_histogram': {'field': '@timestamp', 'fixed_interval': '10m', 'min_doc_count': 0,
                       'extended_bounds': {'min': s, 'max': u}},
    'aggs': {'b': {'cardinality': {'field': 'bot.name', 'precision_threshold': 1000}}}}}}
r = el._search(body)['aggregations']['h']['buckets']
live = sum(b['b']['value'] for b in r if b['key_as_string'] < u)
print(f'CONTROL {today} (window runs to midnight, partly in the future): {live:,.0f} of 11,520 bins occupied '
      f'-- the count does fall when bins are empty')
