"""For each lava death: the moment health first dropped (last full-health row -> first hurt row), and which actors
logged in the 4 s before it. Also: was the bot inside a running skill, and the _fall_path 'path ACTIVE/none' verdict."""
import json, collections, os, sys, re, datetime as dt
D = os.path.dirname(os.path.abspath(__file__)) + '/'
sys.path.insert(0, D)
from d1 import cls
X = json.load(open(D + 'deathctx.json'))
C = collections.Counter


def P(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00'))


NOISE = {'_affordance_scan', '_reach_probe', '_pickups', '_pickup_skipped', '_dig_town_sum', '_inventory_mutation',
         '_chunks_evicted', '_scaffold_pick', '_path_failure_shapes', '_rule_contradicted', '_reflex_low_health',
         '_death_site_recorded', '_plant_spot'}
actors = C(); first_hurt_gap = []; fallpath = C(); skill_running = C()
for x in X:
    d = x['death']
    if cls(d) not in ('lava', 'lava-fall', 'magma'):
        continue
    t = P(d['@timestamp'])
    rows = sorted([r for r in x['ctx'] if (t - P(r['@timestamp'])).total_seconds() >= 0], key=lambda r: r['@timestamp'])
    hurt_at = None
    for r in rows:
        h = r.get('bot', {}).get('health')
        if h is not None and h < 20 and hurt_at is None and (t - P(r['@timestamp'])).total_seconds() <= 12:
            hurt_at = P(r['@timestamp'])
    if hurt_at is None:
        hurt_at = t
    first_hurt_gap.append(round((t - hurt_at).total_seconds(), 1))
    seen = set()
    for r in rows:
        dtt = (hurt_at - P(r['@timestamp'])).total_seconds()
        nm = r.get('skill', {}).get('name') or ''
        if -0.5 <= dtt <= 4 and nm not in NOISE:
            tag = nm
            if nm == '_reflex_danger_block':
                tag += ':' + ('lava' if (r['skill'].get('detail') or '') in ('lava', 'magma_block', 'fire') else 'over-lava')
            if not nm.startswith('_'):
                tag = 'SKILL ' + nm + ' (' + str(r['skill'].get('trigger') or r.get('trigger')) + ')'
            seen.add(tag)
        if nm == '_fall_path' and r['skill'].get('status') == 'failed':
            m = re.search(r'descent ([^:]*): path (\w+)', r['skill'].get('detail') or '')
            fallpath[m.group(2) if m else '?'] += 1
    for s in seen:
        actors[s] += 1
    if not seen:
        actors['(nothing logged)'] += 1
print('death minus first hurt row (s):', sorted(first_hurt_gap))
print('actors logging in the 4 s before first damage:')
for k, v in actors.most_common(30):
    print(f'  {v:3} {k}')
print('lava-fall _fall_path verdicts (path at descent):', fallpath)
