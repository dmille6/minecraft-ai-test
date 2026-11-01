// WOOD IS SCAFFOLD, AND LEAVING IT OUT TOLD 16 BOTS THEY HAD NOTHING.
//
// The exit contract listed stone and dirt and no wood; the pillar rung listed
// oak_log and oak_planks and no other species. Measured across 80 bots:
//
//     wood held (logs + planks)          11,295
//     of that, counted as placeable        2,629   (oak only)
//     INVISIBLE                            8,666   -- 8,422 of them birch logs
//     bots with <25 scaffold but >=25 wood    16
//     climb refusals citing scaffold          92, across 21 bots
//
// The fleet stands in a birch forest holding the blocks to build the climb, and
// was told it had none. Third occurrence of the same hardcoded-oak assumption
// this week, after the craft resolver and the iron ladder rung.
import assert from 'node:assert'
import test from 'node:test'
import { scaffoldCount } from '../src/exit-contract.mjs'
import { readFileSync } from 'node:fs'

const items = o => Object.entries(o).map(([name, count]) => ({ name, count }))

test('THE LIVE CASE: birch logs count', () => {
  assert.equal(scaffoldCount(items({ birch_log: 8422 })), 8422)
})

test('every wood species counts, not just oak', () => {
  for (const w of ['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak',
                   'mangrove', 'cherry', 'pale_oak']) {
    assert.equal(scaffoldCount(items({ [`${w}_log`]: 5 })), 5, `${w}_log`)
    assert.equal(scaffoldCount(items({ [`${w}_planks`]: 5 })), 5, `${w}_planks`)
    assert.equal(scaffoldCount(items({ [`${w}_wood`]: 5 })), 5, `${w}_wood`)
    assert.equal(scaffoldCount(items({ [`stripped_${w}_log`]: 5 })), 5, `stripped_${w}_log`)
  }
})

test('nether wood counts, and it is stems not logs', () => {
  for (const n of ['crimson_stem', 'warped_stem', 'crimson_hyphae', 'warped_hyphae',
                   'stripped_crimson_stem', 'stripped_warped_stem']) {
    assert.equal(scaffoldCount(items({ [n]: 3 })), 3, n)
  }
})

test('PLANT STEMS DO NOT -- they end in _stem and are not blocks', () => {
  // pumpkin_stem, melon_stem, attached_*_stem and big_dripleaf_stem all end in
  // `_stem`. A pattern of /_stem$/ would have counted them and priced a climb
  // on scaffold that cannot be stood on.
  for (const n of ['pumpkin_stem', 'melon_stem', 'attached_pumpkin_stem',
                   'attached_melon_stem', 'big_dripleaf_stem']) {
    assert.equal(scaffoldCount(items({ [n]: 64 })), 0, n)
  }
})

test('and nor does anything else the fleet hoards but cannot stand on', () => {
  for (const n of ['leaf_litter', 'oak_sapling', 'oak_leaves', 'bamboo', 'kelp',
                   'stick', 'wheat_seeds', 'brown_egg', 'crafting_table', 'ladder']) {
    assert.equal(scaffoldCount(items({ [n]: 99 })), 0, n)
  }
})

test('stone-class blocks still count -- nothing was traded away', () => {
  for (const n of ['dirt', 'cobblestone', 'cobbled_deepslate', 'stone', 'andesite',
                   'diorite', 'granite', 'gravel', 'sand', 'netherrack', 'tuff', 'deepslate']) {
    assert.equal(scaffoldCount(items({ [n]: 7 })), 7, n)
  }
})

test('a real mixed inventory adds up', () => {
  const inv = { birch_log: 200, oak_planks: 30, cobblestone: 12,
                pumpkin_stem: 9, leaf_litter: 99, oak_sapling: 40 }
  assert.equal(scaffoldCount(items(inv)), 242)
})

test('THE PILLAR RUNG AGREES WITH THE EXIT CONTRACT', () => {
  // Two lists disagreeing is how a bot gets refused a climb it can afford, or
  // starts one it cannot. Both must see every species.
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const m = /const PLACEABLE = (\/[^\n]*\/)\n/.exec(src)
  assert.ok(m, 'PLACEABLE not found; re-read this test')
  const RE = eval(m[1])
  for (const n of ['birch_log', 'spruce_planks', 'cherry_log', 'crimson_stem']) {
    assert.equal(RE.test(n), true, `PLACEABLE must accept ${n}`)
  }
  for (const n of ['pumpkin_stem', 'leaf_litter', 'oak_leaves', 'bamboo']) {
    assert.equal(RE.test(n), false, `PLACEABLE must refuse ${n}`)
  }
})

test('malformed items never throw or inflate the count', () => {
  assert.equal(scaffoldCount([]), 0)
  assert.equal(scaffoldCount(null), 0)
  assert.equal(scaffoldCount([{ name: 'birch_log' }, null, {}, { count: 5 }]), 0)
})
