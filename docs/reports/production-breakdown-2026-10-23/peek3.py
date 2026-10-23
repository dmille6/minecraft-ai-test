"""Print the llm row field layout (prompt text stripped). Read-only (ES)."""
import sys, json
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

el = EsEvents.load('llm', since='2026-10-22T12:00:00Z', until='2026-10-22T12:01:00Z')
rs = list(el.rows(max_rows=5000))
def strip(d):
    if isinstance(d, dict):
        return {k: (strip(v) if k not in ('text', 'raw', 'response') else f'<{len(str(v))} chars>') for k, v in d.items()}
    return d
for r in rs[:2]:
    print(json.dumps(strip(r), default=str)[:3000])
print(el.terms('trigger'))
