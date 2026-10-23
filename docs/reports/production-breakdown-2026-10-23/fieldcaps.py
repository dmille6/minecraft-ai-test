"""Print the ES mapping type of a few fields (read-only _field_caps)."""
import sys, json
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import http
for idx in ('mcai-llm-agents', 'mcai-skill-agents'):
    for f in sys.argv[1:]:
        r = http('GET', f'{idx}/_field_caps?fields={f}', None)
        print(idx, f, json.dumps(r.get('fields', {}).get(f))[:300])
