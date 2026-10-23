"""Per-death context: the bot's skill rows in the 150 s before each death and its latest milestone (llm stream)."""
import sys, json, datetime as dt
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

deaths = json.load(open('/home/mike/mineshaft-1023/deaths7d.json'))


def P(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00'))


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


out = []
for i, d in enumerate(deaths):
    t = P(d['@timestamp']); b = d['bot']['name']
    ev = EsEvents.load('skill', since=iso(t - dt.timedelta(seconds=150)), until=iso(t + dt.timedelta(seconds=5)), bots=[b])
    ctx = list(ev.rows(fields=['@timestamp', 'trigger', 'skill.name', 'skill.status', 'skill.detail', 'skill.args',
                               'skill.duration_ms', 'skill.fail_class', 'bot.pos', 'bot.health', 'bot.held'],
                       allow_zero=True, max_rows=5000))
    evl = EsEvents.load('llm', since=iso(t - dt.timedelta(minutes=30)), until=iso(t + dt.timedelta(seconds=1)), bots=[b])
    ll = list(evl.rows(fields=['@timestamp', 'trigger', 'messages', 'tool_calls', 'outcome.status'], allow_zero=True,
                       max_rows=5000))
    ms = None
    for r in ll:
        for m in (r.get('messages') or []):
            if isinstance(m, dict) and m.get('milestone'):
                ms = m['milestone']
    out.append({'death': d, 'ctx': ctx, 'milestone': ms, 'llm_last': ll[-3:]})
    if i % 25 == 0:
        print(i, b, len(ctx), ms, flush=True)
json.dump(out, open('/home/mike/mineshaft-1023/deathctx.json', 'w'))
print('done', len(out))
