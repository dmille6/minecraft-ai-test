"""Daily mix of the milestone (task) each LLM decision was made under, and of the skill the
model chose, from the llm stream (server-side terms). Read-only (ES).

`messages.milestone` carries e.g. "gather_iron_ore_3#2097"; the "#N" suffix is stripped here.
`tool_calls.skill` is the chosen skill. Positive control: the sum of the milestone buckets
(including <missing>) must equal the day's decision count.
Output: out/milestones_daily.json
"""
import sys, os, re, json, datetime as dt
from collections import Counter
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
res = {}
d = dt.date(2026, 10, 8)
while d <= dt.date(2026, 10, 23):
    s, u = f'{d}T00:00:00Z', f'{d + dt.timedelta(days=1)}T00:00:00Z'
    now = dt.datetime.now(dt.timezone.utc)
    if dt.datetime.fromisoformat(u.replace('Z', '+00:00')) > now:
        u = (now - dt.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ')
    ev = EsEvents.load('llm', since=s, until=u)
    ms = ev.terms('messages.milestone', size=20000)
    sk = ev.terms('tool_calls.skill', size=2000)
    tot = ev.total()
    mc = Counter()
    for k, v in ms.items():
        mc[re.sub(r'#\d+$', '', k)] += v
    res[str(d)] = {'decisions': tot, 'milestones': dict(mc), 'skills': dict(sk),
                   'milestone_bucket_sum': sum(ms.values())}
    print(d, tot, 'milestone-sum', sum(ms.values()), 'top', mc.most_common(8), flush=True)
    d += dt.timedelta(days=1)
json.dump(res, open(os.path.join(OUT, 'milestones_daily.json'), 'w'), indent=1, sort_keys=True)
