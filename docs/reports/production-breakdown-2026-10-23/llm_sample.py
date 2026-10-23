"""A systematic SAMPLE of LLM decisions (four whole hours a day: 00, 06, 12 and 18Z, = 1/6 of each
day) with the bot's state at decision time: perception (nearest block of each kind within the
scan), inventory, tools, position, milestone, chosen skill, outcome. Read-only (ES).

perception.blocks is NOT indexed in ES (_field_caps returns nothing for it), so it can only be
read from _source rows; hence the sample. Positive control: every hour's streamed row count
equals its server-side count (rows() raises otherwise), and the per-hour totals are written.

Output: out/llm_sample/<day>.jsonl.gz (compact rows) and <day>.counts.json
"""
import sys, os, json, gzip, re, datetime as dt
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'llm_sample')
os.makedirs(OUT, exist_ok=True)
FIELDS = ['@timestamp', 'bot.name', 'exp.pool', 'messages.milestone', 'tool_calls.skill', 'tool_calls.args',
          'outcome.status', 'perception.blocks', 'bot.pos', 'bot.inventory', 'bot.tools', 'trigger']
HOURS = (0, 6, 12, 18)


def compact(r):
    b = r.get('bot') or {}
    tools = {}
    for name, lst in (b.get('tools') or {}).items():
        if name.endswith('_pickaxe') and isinstance(lst, list):
            tools[name] = [max(0, (t.get('max') or 0) - (t.get('used') or 0)) for t in lst if isinstance(t, dict)]
    tc = (r.get('tool_calls') or [{}])
    tc = tc[0] if isinstance(tc, list) and tc else {}
    ms = r.get('messages') or [{}]
    m = next((x.get('milestone') for x in ms if isinstance(x, dict) and x.get('milestone')), None)
    p = b.get('pos') or {}
    return {'t': r.get('@timestamp'), 'b': b.get('name'), 'p': (r.get('exp') or {}).get('pool'),
            'm': re.sub(r'#\d+$', '', m) if m else None, 'sk': tc.get('skill'),
            'blk': (tc.get('args') or {}).get('block') if isinstance(tc.get('args'), dict) else None,
            'st': (r.get('outcome') or {}).get('status'), 'per': (r.get('perception') or {}).get('blocks') or {},
            'x': p.get('x'), 'y': p.get('y'), 'z': p.get('z'), 'inv': b.get('inventory') or {}, 'picks': tools,
            'tr': r.get('trigger')}


d = dt.date.fromisoformat(sys.argv[1])
end = dt.date.fromisoformat(sys.argv[2])
while d <= end:
    path = os.path.join(OUT, f'{d}.jsonl.gz')
    counts = {}
    with gzip.open(path + '.tmp', 'wt') as f:
        for h in HOURS:
            s = dt.datetime(d.year, d.month, d.day, h, tzinfo=dt.timezone.utc)
            u = s + dt.timedelta(hours=1)
            if u > dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=10):
                continue
            ev = EsEvents.load('llm', since=s.strftime('%Y-%m-%dT%H:%M:%SZ'), until=u.strftime('%Y-%m-%dT%H:%M:%SZ'))
            n = 0
            for r in ev.rows(fields=FIELDS, max_rows=100_000):
                f.write(json.dumps(compact(r), separators=(',', ':')) + '\n')
                n += 1
            counts[h] = n
    os.replace(path + '.tmp', path)
    json.dump(counts, open(os.path.join(OUT, f'{d}.counts.json'), 'w'))
    print(d, counts, flush=True)
    d += dt.timedelta(days=1)
