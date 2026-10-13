#!/usr/bin/env python3
"""recountcheck.py <census.json> <pool state dir>... -- READ-ONLY (runs on 10.0.0.31 as any user that can read the pool
dirs; it opens journals for reading only and never folds through cobblecap.mjs, whose readTown may write a checkpoint).

After the clear: did every town journal get its `reset`, and have the bots RECOUNTED the town since? Per pool dir:
  reset_at          the latest reset record (none -> FAIL)
  counts_after      distinct containers with a cnt/obs captured strictly after the reset
  agree / differ    for each such container, the bots' latest per-name count (field m; group `cobble` =
                    cobblestone + cobbled_deepslate) against the census of that world at that position
Pass the census taken closest to the read (bots move items, so a few honest differences are expected right after a
deposit; a container whose every count differs, or zero counts_after an hour after the restart, is the failure).
Before the clear it is the instrument's positive control: with no reset it reports the latest counts against the census.
World of a pool dir: _pool-<world> or _pool-self-<world>-<Bot>."""
import glob, json, os, re, sys
from collections import Counter

census = json.load(open(sys.argv[1]))['worlds']
GROUP = {'cobble': ('cobblestone', 'cobbled_deepslate')}
TOOLS = ('_pickaxe', '_axe', '_shovel', '_hoe', '_sword')
MAXDUR = {'wooden': 59, 'stone': 131, 'iron': 250, 'golden': 32, 'diamond': 1561, 'netherite': 2031}
tot = Counter(); worst = []
for d in sys.argv[2:]:
    base = os.path.basename(d.rstrip('/'))
    m = re.match(r'^_pool-(?:self-)?((?:board|hive|placebo|isolated)-[a-d])(?:-[A-Za-z]+)?$', base)
    w = m.group(1) if m else None
    recs = []
    for f in sorted(glob.glob(os.path.join(d, '*.cobble*.jsonl'))):
        for ln in open(f, errors='replace'):
            try: recs.append(json.loads(ln))
            except Exception: pass
    resets = [r['at'] for r in recs if r.get('t') == 'reset' and isinstance(r.get('at'), (int, float))]
    reset_at = max(resets) if resets else None
    last = {}
    for r in recs:
        if r.get('t') in ('cnt', 'obs') and r.get('k') and isinstance(r.get('cap'), (int, float)) and isinstance(r.get('m'), dict):
            if reset_at is not None and not r['cap'] > reset_at: continue
            if r['k'] not in last or r['cap'] >= last[r['k']]['cap']: last[r['k']] = r
    cont = {','.join(map(str, c['pos'])): c for c in (census.get(w) or {}).get('containers', [])}
    agree = differ = notincensus = 0
    for k, r in last.items():
        c = cont.get(k)
        if c is None: notincensus += 1; continue
        x, y, z = c['pos']
        # a DOUBLE chest is one window over two block entities: the bot's count covers both halves, keyed by one of them.
        # The census does not see the chest's type=left/right state, so a count may match the half alone or the half
        # plus one horizontally adjacent chest.
        views = [[c]] + [[c, cont[a]] for a in ('%d,%d,%d' % (x + 1, y, z), '%d,%d,%d' % (x - 1, y, z), '%d,%d,%d' % (x, y, z + 1),
                                                   '%d,%d,%d' % (x, y, z - 1)) if a in cont and cont[a]['kind'] == c['kind'] == 'chest']
        haves = []
        for cs in views:
            have = Counter()
            for cc in cs:
                for it in cc['items']:
                    tool = it['id'].endswith(TOOLS) and it['id'].split('_')[0] in MAXDUR
                    if tool and (it.get('damage') is None or (it.get('max_damage') or MAXDUR[it['id'].split('_')[0]]) - it['damage'] <= 10):
                        continue                         # the bots count USABLE tool copies (> 10 uses left)
                    have[it['id']] += it['count']
            haves.append(have)
        for name, n in r['m'].items():
            reals = [sum(h[x] for x in GROUP.get(name, (name,))) for h in haves]
            if n in reals: agree += 1
            else: differ += 1; worst.append((base, k, name, n, reals))
    tot.update({'dirs': 1, 'with_reset': reset_at is not None, 'counts_after': len(last), 'agree': agree, 'differ': differ})
    print('%-38s world %-10s reset_at %s counts_after %3d (census containers %3d, not in census %d) agree %4d differ %3d' % (
        base, w, reset_at and __import__('time').strftime('%Y-%m-%dT%H:%M:%SZ', __import__('time').gmtime(reset_at / 1000)),
        len(last), len(cont), notincensus, agree, differ))
print('TOTAL', dict(tot))
print('differences (first 15: dir, container, name, bots say, census says):', worst[:15])
