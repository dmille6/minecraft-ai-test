#!/usr/bin/env python3
# READ-ONLY: share of showcase bot time inside build visits, and what the rest is (milestone rung of llm rows), last H hours
import sys, re, glob, json, datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/showcase/trip')
from lib.telemetry import Events
H = float(sys.argv[1]) if len(sys.argv) > 1 else 12
now = dt.datetime.now(dt.timezone.utc); T0 = now - dt.timedelta(hours=H)
ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl*', since=T0)
kv = lambda s: dict(m.groups() for m in re.finditer(r'(\w+)=(\S+)', s or ''))
name = lambda r: (((r.get('raw') or {}).get('skill') or {}).get('name') or r.get('name') or '').lstrip('_')
bot = lambda r: (r.get('bot') or {}).get('name') or '?'
rows = ev.rows
span = defaultdict(lambda: [None, None])
for r in rows:
    b = bot(r); t = r['t']
    if span[b][0] is None or t < span[b][0]: span[b][0] = t
    if span[b][1] is None or t > span[b][1]: span[b][1] = t
boh = sum((v[1] - v[0]).total_seconds() for v in span.values()) / 3600
vis = defaultdict(float); vn = Counter()
for r in rows:
    if name(r) == 'build_visit':
        d = ((r.get('raw') or {}).get('skill') or {}).get('duration_ms') or 0
        p = kv(r.get('detail')).get('project'); vis[p] += (d or 0) / 3.6e6; vn[p] += 1
print('bot-h observed %.1f over %d bots; build-visit h %.1f (%.1f%%)' % (boh, len(span), sum(vis.values()), 100 * sum(vis.values()) / boh))
print(' by project', sorted(((p, round(h, 1), vn[p]) for p, h in vis.items()), key=lambda x: -x[1]))
# skill time by skill name (skill rows with durationMs)
sk = defaultdict(float); skn = Counter()
for r in rows:
    d = ((r.get('raw') or {}).get('skill') or {}).get('duration_ms')
    if d and not name(r).startswith('_') and not ((r.get('raw') or {}).get('skill') or {}).get('name','').startswith('_'):
        sk[name(r)] += d / 3.6e6; skn[name(r)] += 1
print('skill-h top', sorted(((k, round(v, 1), skn[k]) for k, v in sk.items()), key=lambda x: -x[1])[:25])
# llm milestone rungs
lr = Events.load(paths='/var/log/mcai/*/llm-*.jsonl*', since=T0).rows if glob.glob('/var/log/mcai/*/llm-*.jsonl*') else []
rung = Counter()
for r in lr:
    raw = r.get('raw') or r
    m = raw.get('messages')
    ms = (m[0].get('milestone') if isinstance(m, list) and m and isinstance(m[0], dict) else None) or '-'
    rung[re.sub(r'_\d+$', '_N', str(ms).split('#')[0])] += 1
print('llm rows', len(lr), 'rungs', rung.most_common(12))
