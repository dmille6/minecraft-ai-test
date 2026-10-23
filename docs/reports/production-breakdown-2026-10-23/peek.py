"""Print one sample row per skill kind, to learn the field layout. Read-only (ES)."""
import sys, json
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

ev = EsEvents.load('skill', since='2026-10-22T12:00:00Z', until='2026-10-22T12:10:00Z')
for k in sys.argv[1:] or ['gather', 'mine', 'craft', 'town_deposit']:
    rs = list(ev.rows(k, max_rows=5000))
    print('==', k, len(rs))
    if rs:
        print(json.dumps(rs[0], default=str)[:3500])
