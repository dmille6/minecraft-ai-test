// 741 OF 1,813,691 DECISIONS NAMED A BLOCK THAT DOES NOT EXIST.
//
// That is 0.041% of decisions and 0.68% of `bad_args` -- small, and worth fixing
// only because ~80% of it is not hallucination at all:
//
//   44.5% (329)  a real ITEM handed to `gather`, which takes a BLOCK
//                (coal, flint, raw_iron, raw_copper, stick, tropical_fish)
//   35.8% (265)  a missing trailing "s" (oak_plank, bamboo_plank) -- edit distance 1
//   19.7% (147)  genuinely invented (bamboo_log, wood, oak_木)
//
// The resolver must take the first two and REFUSE the third. A resolver that
// accepted everything would look identical in the veto count and would be
// inventing intent -- so the negative cases below carry as much weight as the
// positive ones.
import assert from 'node:assert'
import test from 'node:test'
import registryLoader from 'prismarine-registry'
import { resolveBlockName } from '../src/drops.mjs'

const registry = registryLoader('1.21.8')

test('POSITIVE CONTROL: the registry under test is real and populated', () => {
  // Every negative below is only meaningful if the registry can say yes to
  // something. An empty registry would refuse all names and read as a pass.
  assert.ok(Object.keys(registry.blocksByName).length > 900,
    `registry looks empty: ${Object.keys(registry.blocksByName).length} blocks`)
  assert.ok(registry.blocksByName.stone, 'stone must exist')
  assert.ok(registry.itemsByName.coal, 'coal must exist as an item')
})

test('a real block resolves to itself', () => {
  assert.deepEqual(resolveBlockName(registry, 'stone'), { block: 'stone', via: 'exact' })
  assert.deepEqual(resolveBlockName(registry, 'oak_log'), { block: 'oak_log', via: 'exact' })
})

test('a missing plural resolves -- 35.8% of the real failures', () => {
  const r = resolveBlockName(registry, 'oak_plank')
  assert.equal(r?.block, 'oak_planks')
  assert.equal(r?.via, 'plural')
  assert.equal(resolveBlockName(registry, 'bamboo_plank')?.block, 'bamboo_planks')
})

test('an item handed to gather resolves to a block that drops it -- 44.5%', () => {
  const coal = resolveBlockName(registry, 'coal')
  assert.ok(coal, 'coal must resolve')
  assert.equal(coal.via, 'drop_source')
  assert.ok(registry.blocksByName[coal.block], `resolved to a non-block: ${coal.block}`)
  assert.ok(/coal_ore$/.test(coal.block), `expected a coal ore, got ${coal.block}`)

  const iron = resolveBlockName(registry, 'raw_iron')
  assert.ok(iron && /iron_ore$/.test(iron.block), `raw_iron -> ${iron?.block}`)
})

test('every resolution names a block that actually exists', () => {
  // sourcesOf falls back to [itemName], so an unchecked resolver would happily
  // return the item it was given and move the failure downstream into the skill.
  for (const n of ['coal', 'flint', 'raw_iron', 'raw_copper', 'oak_plank', 'bamboo_plank', 'stone']) {
    const r = resolveBlockName(registry, n)
    if (r) assert.ok(registry.blocksByName[r.block], `${n} -> ${r.block} is not a block`)
  }
})

test('NEGATIVE: a genuinely invented name is still refused', () => {
  // The 19.7% that should keep failing. If these resolve, the resolver is
  // guessing, and a veto has been traded for a doomed execution.
  for (const junk of ['oak_木', 'wood', 'definitely_not_a_block', 'xyzzy', 'bamboo_log']) {
    assert.equal(resolveBlockName(registry, junk), null, `${junk} must NOT resolve`)
  }
})

test('NEGATIVE: an unrelated drop source is NOT a resolution', () => {
  // `dead_bush` really does drop sticks and `cobweb` really does drop string,
  // but resolving those would send a bot on an errand it never asked for.
  // Sticks come from crafting. The names share no token, and that is the line.
  const stick = resolveBlockName(registry, 'stick')
  assert.equal(stick, null, `stick resolved to ${stick?.block} -- intent invented`)
  const string = resolveBlockName(registry, 'string')
  if (string) assert.ok(/string/.test(string.block), `string -> ${string.block}`)
})

test('the real names the fleet produced resolve as measured', () => {
  // Harvested from the live fleet, with their real frequencies. If this ratio
  // moves, the resolver's reach changed and someone should know why.
  const real = { coal: 6, bamboo_plank: 5, oak_plank: 1, quartz_ore: 1, wooden_s: 1,
                 stick: 1, wildflower: 1, planks: 1, jungle_plank: 1, glue: 1,
                 stone_cobblestone: 1, raw_copper: 1 }
  let recovered = 0, total = 0
  for (const [n, c] of Object.entries(real)) {
    total += c
    if (resolveBlockName(registry, n)) recovered += c
  }
  assert.equal(total, 21)
  assert.ok(recovered >= 14 && recovered <= 17,
    `recovery moved: ${recovered}/${total}`)
  // The specific ones that must work, and the ones that must not.
  assert.equal(resolveBlockName(registry, 'coal')?.block, 'coal_ore')
  assert.equal(resolveBlockName(registry, 'bamboo_plank')?.block, 'bamboo_planks')
  for (const junk of ['glue', 'stone_cobblestone', 'wooden_s']) {
    assert.equal(resolveBlockName(registry, junk), null, `${junk} must not resolve`)
  }
})

test('NEGATIVE: junk input does not resolve or throw', () => {
  assert.equal(resolveBlockName(registry, ''), null)
  assert.equal(resolveBlockName(registry, null), null)
  assert.equal(resolveBlockName(registry, 42), null)
  assert.equal(resolveBlockName(null, 'stone'), null)
  assert.equal(resolveBlockName({}, 'stone'), null)
})

test('NEGATIVE: pluralising never invents a block', () => {
  // "stick" + "s" is not a block, and stick must resolve via drops or not at all.
  const r = resolveBlockName(registry, 'stick')
  if (r) {
    assert.notEqual(r.via, 'plural', 'sticks is not a block; plural must not have fired')
    assert.ok(registry.blocksByName[r.block])
  }
})
