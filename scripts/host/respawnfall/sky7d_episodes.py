import json, re, datetime as dt, collections
D = json.load(open('/tmp/rf_sky7d.json'))
rows, deaths = D['rows'], D['deaths']
T = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
RB = re.compile(r'^(cobblestone|cobbled_deepslate|dirt|coarse_dirt|rooted_dirt|netherrack|tuff|granite|diorite|andesite|deepslate|stone|sandstone|red_sandstone|.*_planks|.*_log|.*_wood|.*_stem)$')
LOG = re.compile(r'_(log|wood|stem|hyphae)$')
by = collections.defaultdict(list)
for r in rows: by[r['bot']].append(r)
eps = []
for b, rs in by.items():
    rs.sort(key=lambda r: r['t'])
    cur = [rs[0]]
    for r in rs[1:]:
        if (T(r['t']) - T(cur[-1]['t'])).total_seconds() > 300: eps.append((b, cur)); cur = [r]
        else: cur.append(r)
    eps.append((b, cur))
print('bots above y110:', len(by), 'rows', len(rows), 'episodes', len(eps))
ends = collections.Counter()
for b, ep in eps:
    t0, t1 = T(ep[0]['t']), T(ep[-1]['t'])
    inv = next((r['inv'] for r in ep if r.get('inv')), None) or {}
    blocks = sum(v for k, v in inv.items() if RB.match(k)); logs = sum(v for k, v in inv.items() if LOG.search(k))
    dth = [d for d in deaths if d['bot'] == b and t0 - dt.timedelta(seconds=5) <= T(d['t']) <= t1 + dt.timedelta(seconds=90)]
    ys = [r['pos']['y'] for r in ep if r.get('pos')]
    skills = collections.Counter(r['k'] for r in ep if r['k'] and not r['k'].startswith('_'))
    kinds = collections.Counter(r['k'] for r in ep if r['k'])
    end = 'died' if dth else 'left/ended'
    ends[end] += 1
    print(f"{b:20s} {ep[0]['pool']:12s} {ep[0]['t'][5:19]} {(t1 - t0).total_seconds():6.0f}s n={len(ep):4d} y {min(ys):.0f}-{max(ys):.0f} blocks={blocks} logs={logs} {end} {[d['d'][:60] for d in dth]} skills={dict(skills.most_common(4))} top={[k for k, _ in kinds.most_common(5)]}")
print(ends)
