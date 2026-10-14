# READ-ONLY: bag fullness and town-order activity per bot in the un-recounted towns, vs two towns that did recount
import sys, collections
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events
ev = Events.load(since_minutes=145)
rows = [r for r in ev.rows if (r['raw'].get('@timestamp') or '') >= '2026-10-14T02:22:44Z']
print('raw bot keys:', sorted(rows[-1]['raw']['bot'].keys()))
for w in ('hive-a', 'placebo-a', 'hive-c', 'placebo-b', 'board-c', 'placebo-d'):
    for b in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo'):
        n = '%s-%s' % (w, b); rs = [r for r in rows if r['raw']['bot']['name'] == n]
        if not rs: continue
        last = rs[-1]['raw']['bot']; inv = last.get('inventory') or {}
        slots = last.get('slots_used') or last.get('slots') or None
        unk = sum(1 for r in rs if r['name'] == '_stock_refused' and '_unknown' in (r['detail'] or ''))
        town = collections.Counter(r['name'] for r in rs if 'town' in (r['name'] or '') or 'reconcile' in (r['name'] or '') or 'count' in (r['name'] or ''))
        print('%-18s names %2d items %5d slots %s refused_unknown %3d town/count rows %s' % (n, len(inv), sum(v for v in inv.values() if isinstance(v, int)), slots, unk, dict(town)))
