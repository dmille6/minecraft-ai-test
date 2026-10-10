import json, sys
from collections import Counter, defaultdict
d = json.load(open(sys.argv[1]))
MAXDUR = {'wooden': 59, 'stone': 131, 'iron': 250, 'golden': 32, 'diamond': 1561, 'netherite': 2031}
TOOLS = ('_pickaxe', '_axe', '_shovel', '_hoe', '_sword')
KEEP_PER_TOWN = {'cobblestone': 256, 'cobbled_deepslate': 0, 'stick': 256, 'oak_log': 1024, 'birch_log': 1024,
                 'spruce_log': 1024, 'jungle_log': 512, 'acacia_log': 512, 'dark_oak_log': 512, 'cherry_log': 512,
                 'mangrove_log': 512, 'oak_planks': 512, 'birch_planks': 256, 'spruce_planks': 256, 'oak_sapling': 128,
                 'birch_sapling': 128, 'dirt': 128, 'sand': 256, 'gravel': 64, 'torch': 256, 'ladder': 128,
                 'crafting_table': 8, 'furnace': 8, 'chest': 32, 'bucket': 8, 'bamboo': 0}
USABLE_TOOL_KEEP = {'stone_pickaxe': 32, 'wooden_pickaxe': 0, 'stone_axe': 8, 'stone_shovel': 8, 'wooden_axe': 0,
                    'wooden_shovel': 0, 'stone_sword': 0, 'wooden_sword': 0, 'stone_hoe': 0, 'wooden_hoe': 0}
JUNK = {'egg', 'brown_egg', 'blue_egg', 'armadillo_scute', 'ink_sac', 'glow_ink_sac', 'feather', 'bone', 'string',
        'gunpowder', 'leather', 'flint', 'clay_ball', 'rotten_flesh', 'poisonous_potato', 'spider_eye', 'pufferfish',
        'leaf_litter', 'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'wildflowers', 'poppy',
        'dandelion', 'kelp', 'brown_mushroom', 'red_mushroom', 'pointed_dripstone', 'andesite', 'diorite', 'granite',
        'tuff', 'calcite', 'glass', 'white_wool', 'rail', 'lead', 'oak_button', 'stone_bricks', 'moss_block',
        'mossy_cobblestone', 'smooth_basalt', 'dripstone_block', 'magma_block', 'netherrack', 'mud', 'deepslate'}
rem = Counter(); remslots = Counter(); keep = Counter(); fullafter = 0; ncont = 0; full_before = 0
plan = []
for w, v in d['worlds'].items():
    tally = Counter(); usable = Counter()
    # largest stacks kept first
    slots = []
    for c in v['containers']:
        for it in c['items']: slots.append((c, it))
    slots.sort(key=lambda ci: -ci[1]['count'])
    freed = defaultdict(int)
    for c, it in slots:
        i = it['id']; why = None
        if i.endswith(TOOLS) and i.split('_')[0] in MAXDUR:
            left = MAXDUR[i.split('_')[0]] - (it['damage'] or 0)
            if left <= 10: why = 'spent_tool'
            elif i in USABLE_TOOL_KEEP:
                usable[i] += 1
                if usable[i] > USABLE_TOOL_KEEP[i]: why = 'surplus_tool'
        elif i in JUNK: why = 'junk'
        elif i in KEEP_PER_TOWN:
            if tally[i] + it['count'] > KEEP_PER_TOWN[i]: why = 'surplus_bulk'
            else: tally[i] += it['count']
        if why:
            rem[why] += it['count']; remslots[why] += 1; freed[id(c)] += 1
            plan.append({'world': w, 'pos': c['pos'], 'slot': it['slot'], 'id': i, 'count': it['count'], 'damage': it['damage'], 'why': why})
        else:
            keep[i] += it['count']
    for c in v['containers']:
        ncont += 1; n = len(c['items'])
        if n >= 27: full_before += 1
        if n - freed[id(c)] >= 27: fullafter += 1
json.dump(plan, open(sys.argv[2], 'w'))
print('containers', ncont, 'full before', full_before, 'full after', fullafter)
for k in remslots: print('REMOVE %-14s slots %5d items %7d' % (k, remslots[k], rem[k]))
print('total slots freed', sum(remslots.values()), 'items', sum(rem.values()))
print('top kept:', keep.most_common(14))
