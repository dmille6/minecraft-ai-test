#!/usr/bin/env python3
"""plan3.py <census.json> <caps.json> <plan-out.json> -- plan2.py with the stock targets as caps (READ-ONLY: it writes a
plan, it removes nothing). The caps file is docs/reports/stocktarget-clear-caps-2026-10-10.json:
  KEEP_PER_TOWN     name -> items kept per town (largest stacks kept first)
  KEEP_GROUPS       group -> {names, cap}: one cap shared by several names (cobblestone + cobbled_deepslate = 256)
  USABLE_TOOL_KEEP  tool name -> usable copies (> 10 uses left) kept per town; spent copies are always removed
  names in neither map are NOT capped (iron, ores, raw_*, ingots, coal, gems, food, books, iron/diamond tools)
The one-time clear (owner 10-10) runs only after stocktarget-01 ships; then scripts/host/stockreset.py fences the bots'
journals (every count captured before the clear is dropped; no prune until the hold ends)."""
import json, sys
from collections import Counter, defaultdict
d = json.load(open(sys.argv[1])); caps = json.load(open(sys.argv[2]))
KEEP = caps['KEEP_PER_TOWN']; TK = caps['USABLE_TOOL_KEEP']
GROUP_OF, GCAP = {}, {}
for g, e in caps.get('KEEP_GROUPS', {}).items():
    GCAP[g] = e['cap']
    for n in e['names']: GROUP_OF[n] = g
MAXDUR = {'wooden': 59, 'stone': 131, 'iron': 250, 'golden': 32, 'diamond': 1561, 'netherite': 2031}
TOOLS = ('_pickaxe', '_axe', '_shovel', '_hoe', '_sword')
JUNK = set(caps.get('JUNK', ['egg', 'brown_egg', 'blue_egg', 'armadillo_scute', 'ink_sac', 'glow_ink_sac', 'flint', 'clay_ball',
                             'pointed_dripstone', 'rail', 'andesite', 'diorite', 'granite', 'glass', 'lead', 'stone_bricks',
                             'mossy_cobblestone', 'smooth_basalt', 'dead_bush', 'white_wool', 'oak_button', 'brick']))
rem = Counter(); remslots = Counter(); keep = Counter(); byname = Counter(); fullafter = 0; ncont = 0; fullbefore = 0
plan = []
for w, v in d['worlds'].items():
    tally = Counter(); usable = Counter(); freed = defaultdict(int)
    slots = [(c, it) for c in v['containers'] for it in c['items']]
    slots.sort(key=lambda ci: -ci[1]['count'])
    for c, it in slots:
        i = it['id']; why = None
        if i.endswith(TOOLS) and i.split('_')[0] in MAXDUR:
            left = MAXDUR[i.split('_')[0]] - (it['damage'] or 0)
            if left <= 10: why = 'spent_tool'
            elif i in TK:
                usable[i] += 1
                if usable[i] > TK[i]: why = 'surplus_tool'
        elif i in JUNK: why = 'junk'
        elif i in GROUP_OF or i in KEEP:
            # EXACTLY min(total, cap) is kept (Codex r3 3): a stack that would pass the cap is REDUCED to what the cap still
            # allows (an `reduce` entry: the slot's count is set to `keep`), and removed only when the cap is already full
            tk, cap = ('@' + GROUP_OF[i], GCAP[GROUP_OF[i]]) if i in GROUP_OF else (i, KEEP[i])
            room = cap - tally[tk]
            if it['count'] <= room: tally[tk] += it['count']
            elif room > 0:
                tally[tk] += room
                rem['reduce'] += it['count'] - room; byname[i] += it['count'] - room; keep[i] += room
                plan.append({'world': w, 'pos': c['pos'], 'slot': it['slot'], 'id': i, 'count': it['count'], 'keep': room, 'damage': it['damage'], 'why': 'reduce'})
                continue
            else: why = 'surplus'
        if why:
            rem[why] += it['count']; remslots[why] += 1; freed[id(c)] += 1; byname[i] += it['count']
            plan.append({'world': w, 'pos': c['pos'], 'slot': it['slot'], 'id': i, 'count': it['count'], 'damage': it['damage'], 'why': why})
        else:
            keep[i] += it['count']
    for c in v['containers']:
        ncont += 1; n = len(c['items'])
        fullbefore += n >= 27; fullafter += (n - freed[id(c)]) >= 27
json.dump(plan, open(sys.argv[3], 'w'))
print('containers', ncont, 'full before', fullbefore, 'full after', fullafter)
for k in rem: print('REMOVE %-12s slots %5d items %7d' % (k, remslots[k], rem[k]))
print('total slots freed', sum(remslots.values()), 'items', sum(rem.values()), '(reduce entries keep their slot)')
print('removed by name:', byname.most_common(14))
print('kept top:', keep.most_common(14))
