#!/usr/bin/env python3
"""sandbox_scene.py <setup|mutate|teardown> -- SANDBOX ONLY (world 'sandbox', a test rig, never a fleet world): builds
the fake town used to prove cc_clear3.py end to end. Home (-3000, 200, -3000), three containers floating at y=200 in a
force-loaded chunk. Hold /tmp/mcai-sandbox.lock on 10.0.0.31 while using it. Writes /tmp/chestclear3/sbx-positions.json."""
import json, re, sys
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import rcon3
W = 'sandbox'; assert W == 'sandbox'
ANY = re.compile(r'^(list|forceload (add|remove) -3000 -3000|setblock -?\d+ 200 -3000 minecraft:(chest|barrel|air) replace|'
                 r'item replace block -?\d+ 200 -3000 container\.\d+ with .*|data get block .*)$')
C1, C2, C3 = (-3000, 200, -3000), (-2998, 200, -3000), (-2996, 200, -3000)
SCENE = {
    C1: ['oak_log 64'] * 10 + ['cobblestone 64'] * 5 + ['crafting_table 5', 'egg 16', 'dirt 10', 'raw_iron 30',
         'enchanted_book[minecraft:stored_enchantments={"minecraft:lure":3,"minecraft:unbreaking":3,"minecraft:mending":1}] 1',
         'iron_pickaxe[minecraft:damage=245] 1', 'iron_ingot 12', 'bread 5'],
    C2: ['stone_pickaxe[minecraft:damage=10] 1'] * 20 + ['stone_pickaxe[minecraft:damage=125] 1'] * 3 +
        ['wooden_pickaxe 1'] * 4,
    C3: ['wooden_pickaxe 1'] * 2 + ['bamboo 32', 'stick 64', 'stick 30', 'oak_planks 40', 'oak_planks 40', 'coal 20'] + ['oak_log 64'] * 19,
}
r = rcon3.Rcon(W, ANY)
def c(x):
    rep = r.cmd(x)
    if not re.match(r'(Changed|Replaced|Marked|No chunks|There are|Removed|Could not set)', rep): print('  ', x, '->', rep[:100])
    return rep
mode = sys.argv[1]
if mode == 'setup':
    print(c('list'))
    c('forceload add -3000 -3000')
    for pos, items in SCENE.items():
        kind = 'barrel' if pos == C3 else 'chest'
        c('setblock %d %d %d minecraft:air replace' % pos); c('setblock %d %d %d minecraft:%s replace' % (pos + (kind,)))
        for s, it in enumerate(items): c('item replace block %d %d %d container.%d with minecraft:%s' % (pos + (s, it)))
    json.dump({W: {'home': list(C1), 'pos': [list(C1), list(C2), list(C3), [-2999, 200, -3000], [-3000, 201, -3000]]}},
              open('/tmp/chestclear3/sbx-positions.json', 'w'))
    print('scene built', {p: len(v) for p, v in SCENE.items()})
elif mode == 'mutate':        # the negative control: a planned slot (C1 slot 2, oak_log 64; slot 1 is the trial's) changes after the census
    print(c('item replace block %d %d %d container.2 with minecraft:oak_log 63' % C1))
elif mode == 'teardown':
    for pos in SCENE: c('setblock %d %d %d minecraft:air replace' % pos)
    print(c('forceload remove -3000 -3000'))
r.close()
