"""r2 re-measures (Codex r1 P2-12/14): cell-matched warnings, execution-interval dig overlap, first damage after a
full-health row, danger episodes censored at episode end, and deaths binned by the bot's y 30-60 s BEFORE death."""
import json, collections, os, sys, re, datetime as dt
D = os.path.dirname(os.path.abspath(__file__)) + '/'
sys.path.insert(0, D)
from d1 import cls
X = json.load(open(D + 'deathctx.json'))
DG = json.load(open(D + 'danger7d.json'))
deaths = json.load(open(D + 'deaths7d.json'))
C = collections.Counter


def P(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp()


EVENT = lambda r: (r.get('trigger') == 'reflex' and (r.get('skill', {}).get('name') or '').startswith('_'))
LAVA = lambda d: cls(d) in ('lava', 'lava-fall', 'magma')
SEEN = ('_lava_corridor', '_explore_blind_step_refused', '_lava_adjacent_no_retreat')   # danger_block rows mean IN or OVER lava already: excluded
tab = collections.defaultdict(C)
for x in X:
    d = x['death']
    if not LAVA(d):
        continue
    t = P(d['@timestamp']); dp = d['bot']['pos']
    near_warn = None; any_warn = None; dig = False; full_seen = False; first_hurt = None
    rows = sorted(x['ctx'], key=lambda r: r['@timestamp'])
    for r in rows:
        tr = P(r['@timestamp']); dtt = t - tr
        if dtt < 0:
            continue
        s = r.get('skill', {}); nm = s.get('name') or ''; det = s.get('detail') or ''
        if nm in SEEN and 'lava' in det and dtt > 3:
            any_warn = max(any_warn or 0, dtt)
            m = re.search(r'at (-?\d+),(-?\d+),(-?\d+)', det)
            if m:
                cx, cy, cz = map(int, m.groups())
                if abs(cx - dp['x']) <= 3 and abs(cz - dp['z']) <= 3 and abs(cy - dp['y']) <= 4:
                    near_warn = max(near_warn or 0, dtt)
        if nm in ('mine', 'gather'):
            st = tr; en = tr + (s.get('duration_ms') or 0) / 1000
            if en >= t - 30 and st <= t:
                dig = True
        if nm in ('_mine_dig', '_dig_approach', '_mine_stair_step_failed') and dtt <= 30:
            dig = True
        h = (r.get('bot') or {}).get('health') if EVENT(r) else None   # r3: event rows only (a skill row's snapshot is its END)
        if h is not None and dtt <= 15:
            if h >= 20:
                full_seen = True; first_hurt = None
            elif full_seen and first_hurt is None:
                first_hurt = tr
    if re.search(r'was running (mine|gather)', d['skill']['detail']):
        dig = True
    tab['warning (any lava cell) >3 s before'][any_warn is not None] += 1
    tab['cell-matched warning age'][('>=10 s' if near_warn >= 10 else '3-10 s') if near_warn else 'none'] += 1
    tab['any-cell warning age'][('>=10 s' if any_warn >= 10 else '3-10 s') if any_warn else 'none'] += 1
    tab['warning naming a cell within 3 (xz) / 4 (y) of the death >3 s before'][near_warn is not None] += 1
    tab['mine/gather executing in last 30 s (interval overlap) or running at death'][dig] += 1
    tab['first damage after a full-health row seen'][first_hurt is not None] += 1
for k, v in tab.items():
    print(k, dict(v))

# danger episodes censored at episode END: death within [first, last + 20 s]
fire = collections.defaultdict(list)
for d in deaths:
    if LAVA(d):
        fire[d['bot']['name']].append(P(d['@timestamp']))
eps = []; cur = None
for r in sorted(DG['_reflex_danger_block'], key=lambda r: (r['bot']['name'], r['@timestamp'])):
    b = r['bot']['name']; t = P(r['@timestamp'])
    if cur and cur['bot'] == b and t - cur['last'] <= 30 and not any(cur['last'] < ft <= t for ft in fire[b]):
        cur['last'] = t; continue
    cur = {'bot': b, 'first': t, 'last': t, 'd0': r['skill'].get('detail')}
    eps.append(cur)
t2 = C()
for e in eps:
    k = 'feet in a DANGER block' if e['d0'] in ('lava', 'magma_block', 'fire', 'soul_fire', 'campfire') else (
        'feet bubble_column (DANGER block below)' if e['d0'] == 'bubble_column' else ('feet air/cave_air (DANGER block below)' if e['d0'] in ('air', 'cave_air') else 'UNRECOGNISED detail ' + str(e['d0'])))
    died = any(e['first'] <= ft <= e['last'] + 20 for ft in fire[e['bot']])
    t2[(k, died)] += 1
print('danger episodes (death within first..last+20 s):', dict(t2))
print('distinct lava deaths inside an episode window:', sum(1 for b, fts in fire.items() for ft in fts if any(e['bot'] == b and e['first'] <= ft <= e['last'] + 20 for e in eps)))

# deaths binned by the bot's y 30-60 s BEFORE death (pre-death position), against the same exposure as d6
E = json.load(open(D + 'es3.json'))
bands = [('>=64', 64, 999), ('48..63', 48, 63.99), ('32..47', 32, 47.99), ('16..31', 16, 31.99), ('0..15', 0, 15.99),
         ('-32..-1', -32, -0.01), ('-64..-33', -99, -32.01)]
def band(y):
    for n, lo, hi in bands:
        if lo <= y <= hi:
            return n
exp = C()
for k, n in E['depth_avg_y_by8'].items():
    exp[band(int(k) + 4)] += n / 6
pre = collections.defaultdict(C)
for x in X:
    d = x['death']; t = P(d['@timestamp'])
    ys = [(t - P(r['@timestamp']), r['bot']['pos']['y']) for r in x['ctx'] if EVENT(r) and (r.get('bot') or {}).get('pos') and 30 <= t - P(r['@timestamp']) <= 60]
    yb = band(ys[-1][1]) if ys else 'no position 30-60 s before'
    g = 'lava' if LAVA(d) else cls(d)
    pre[yb][g] += 1; pre[yb]['ALL'] += 1
print('band  bot-h  deaths(by pre-death y)  lava  all/100bh  lava/100bh')
for n, lo, hi in bands:
    h = exp[n]
    print(f'{n:9} {h:6.0f} {pre[n]["ALL"]:5} {pre[n]["lava"]:5} {100*pre[n]["ALL"]/h:8.2f} {100*pre[n]["lava"]/h:8.2f}')
print('no position 30-60 s before:', dict(pre['no position 30-60 s before']))
