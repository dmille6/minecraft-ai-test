"""Entombment episodes (7 d, ES): causes, durations, outcomes, cost."""
import json, gzip, collections, os, math, bisect, datetime as dt, sys
D = os.path.dirname(os.path.abspath(__file__)) + '/'
X = json.load(gzip.open(D + 'entomb7d.json.gz', 'rt'))
deaths = json.load(open(D + 'deaths7d.json'))
C = collections.Counter
GAP = float(os.environ.get('GAP', 600)); RAD = float(os.environ.get('RAD', 4))


def P(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp()


def dist(a, b):
    return math.sqrt((a['x'] - b['x']) ** 2 + (a['y'] - b['y']) ** 2 + (a['z'] - b['z']) ** 2)


by = collections.defaultdict(list)
for r in X['_entombed']:
    by[r['bot']['name']].append((P(r['@timestamp']), r))
eps = []
for b, rs in by.items():
    rs.sort(key=lambda x: x[0]); cur = None
    for t, r in rs:
        p = r['bot']['pos']
        if cur and t - cur['last'] <= GAP and dist(p, cur['pos']) <= RAD:
            cur['last'] = t; cur['n'] += 1; continue
        cur = {'bot': b, 'pool': r['exp']['pool'], 'first': t, 'last': t, 'n': 1, 'pos': p, 'held': r['bot'].get('held')}
        eps.append(cur)
# index of other rows per bot
def index(rows):
    m = collections.defaultdict(list)
    for r in rows:
        m[r['bot']['name']].append((P(r['@timestamp']), r))
    for v in m.values():
        v.sort(key=lambda x: x[0])
    return m
INT = index(X['interrupt:entombed']); UNR = index(X['_entombed_unrecoverable']); LLM = index(X['llm:entombed'])
RAMP = index(X['_entombed_ramp_cut']); NEED = index(X['_entombed_needs_blocks']); WR = index(X['_watchdog_rescue'])
DE = collections.defaultdict(list)
for d in deaths:
    DE[d['bot']['name']].append((P(d['@timestamp']), d))


def within(m, b, lo, hi):
    v = m.get(b, []); ts = [x[0] for x in v]
    i = bisect.bisect_left(ts, lo); out = []
    while i < len(v) and v[i][0] <= hi:
        out.append(v[i][1]); i += 1
    return out


tab = collections.defaultdict(C); dur_by = collections.defaultdict(float); n_by = C()
for e in eps:
    b = e['bot']
    # the skill interrupted by the FIRST firing: interrupted rows are stamped at START; end = start + duration
    cause = 'idle (no skill running)'
    for r in within(INT, b, e['first'] - 900, e['first'] + 3):
        end = P(r['@timestamp']) + (r['skill'].get('duration_ms') or 0) / 1000
        if abs(end - e['first']) <= 3:
            s = r['skill']['name']; a = r['skill'].get('args') or {}
            cause = s + (':' + str(a.get('block')) if s == 'gather' else '')
    y = e['pos']['y']
    depth = 'y>=60' if y >= 60 else ('0..59' if y >= 0 else '<0')
    dur = e['last'] - e['first']
    unr = len(within(UNR, b, e['first'], e['last'] + 60))
    died = [d for t, d in DE.get(b, []) if e['first'] <= t <= e['last'] + 600]
    resc = len(within(WR, b, e['first'], e['last'] + 60))
    out = ('died ' + died[0]['skill']['fail_class']) if died else ('gave up (unrecoverable)' if unr else 'no death or give-up recorded')
    dbin = '1 firing' if e['n'] == 1 else ('<=2 min' if dur <= 120 else ('2-10 min' if dur <= 600 else ('10-60 min' if dur <= 3600 else '>1 h')))
    e.update(cause=cause, depth=depth, dur=dur, out=out, dbin=dbin)
    cgrp = cause.split(':')[0]
    tab['cause'][cause if cgrp == 'gather' else cgrp] += 1
    tab['cause_group'][cgrp] += 1
    tab['depth'][depth] += 1
    tab['dur'][dbin] += 1
    tab['outcome'][out] += 1
    tab['dur x depth'][(depth, dbin)] += 1
    tab['cause x depth'][(cgrp, depth)] += 1
    tab['outcome x dur'][(dbin, out)] += 1
    dur_by[cgrp] += dur; n_by[cgrp] += 1
print('episodes', len(eps), 'rows', len(X['_entombed']), 'bots', len(by))
for k, v in tab.items():
    print('\n' + k)
    for kk, vv in sorted(v.items(), key=lambda kv: -kv[1])[:30]:
        print(f'  {vv:6} {kk}')
tot = sum(e['dur'] for e in eps)
print('\nsum of episode spans (NOT a lower bound on time entombed: spans can include intervening activity): %.1f bot-h of 13440 (%.2f%%)' % (tot / 3600, 100 * tot / 3600 / 13440))
for k in sorted(dur_by, key=lambda k: -dur_by[k]):
    print(f'  {k:28} {n_by[k]:6} eps  {dur_by[k]/3600:7.1f} h')
long = sorted(eps, key=lambda e: -e['dur'])[:15]
for e in long:
    print('LONG', e['bot'], round(e['dur'] / 3600, 2), 'h', e['n'], 'rows', e['pos'], e['cause'], e['out'], dt.datetime.utcfromtimestamp(e['first']).isoformat())
json.dump([{k: v for k, v in e.items()} for e in eps], open(D + 'episodes.json', 'w'))
