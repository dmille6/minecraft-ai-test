import sys, collections, re, json; sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

ev = EsEvents.load('skill', since_minutes=24 * 60, until='2026-10-23T21:00:00Z', bots=['board-a-Comet'])
print('24h docs', ev.total(), ev.caveats[:1])
kinds = ev.terms('skill.name')
print(sorted(kinds.items(), key=lambda x: -x[1]))
# deaths, positive control fleet-wide
evf = EsEvents.load('skill', since='2026-10-08T00:00:00Z', until='2026-10-23T21:00:00Z')
print('fleet _death', evf.count('_death'))
evc = EsEvents.load('skill', since='2026-10-08T00:00:00Z', until='2026-10-23T21:00:00Z', bots=['board-a-Comet'])
print('Comet _death', evc.count('_death', allow_zero=True), 'Comet _spawn-ish', {k: v for k, v in evc.terms('skill.name').items() if 'spawn' in k or 'death' in k or 'respawn' in k or 'join' in k or 'loop_restart' in k})
# sample details per kind (distinct detail texts, normalised digits)
out = collections.defaultdict(collections.Counter)
statuses = collections.defaultdict(collections.Counter)
for r in ev.rows(fields=['@timestamp', 'skill.name', 'skill.status', 'skill.detail', 'skill.fail_class']):
    s = r.get('skill', {})
    k = s.get('name')
    d = (s.get('detail') or '')
    norm = re.sub(r'-?\d+(\.\d+)?', '#', d)[:400]
    out[k][norm] += 1
    statuses[k][(s.get('status'), s.get('fail_class'))] += 1
json.dump({k: {'statuses': {str(a): b for a, b in statuses[k].items()}, 'details': out[k].most_common(8)} for k in out}, open('q5.json', 'w'), indent=1)
print('wrote q5.json')
