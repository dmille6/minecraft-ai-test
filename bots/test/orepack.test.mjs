// ROOM BY CAPACITY: the ore tunnel's inventory gate (stack merging was taken out of this change, 10-03).
//
// oretunnel-03 (10-02): 9 of 12 tunnel attempts were refused `emptySlotCount() < 2 -> deposit first`; the 3 that ran
// all reached the ore. The refused bots had 0 empty slots but 176-252 spare room in stone stacks, and the bank chests
// that "deposit" needs are often full. These tests pin: capacity PER ITEM with the ore's slot reserved; the post-plan
// recheck on what the planned breaks can drop at most, plus RETURN_RESERVE slack; and the enchanted-tool rule
// (Fortune / Silk Touch / unreadable: use an unenchanted pickaxe that can pay for the trip, or refuse).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const LOG_DIR = `/tmp/mcbot-test-logs-orepack-${process.pid}`
process.env.LOG_DIR = LOG_DIR; process.env.BOT_NAME = 'PackBot'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const VERSION = '1.21.11'   // config.mjs MINECRAFT_VERSION default: the fleet's version
const registry = require('prismarine-registry')(VERSION)
const Block = require('prismarine-block')(registry)
const Item = require('prismarine-item')(registry)
const { pathfinder } = require('mineflayer-pathfinder')
const OT = await import('../src/oretunnel.mjs')
const { tunnelRoom, tunnelDrops, lootFor, toolRisk, plainStack, bagOccupants, STONE_DROPS, STONE_ROOM, CLUSTER_CAP, RETURN_RESERVE,
        tunnelMovements, planTunnel } = OT
const SK = await import('../src/skills.mjs')
const { tunnelToOre } = SK

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// Items as mineflayer gives them: one per slot, with the registry's real stackSize and 1.21's empty components.
const it = (name, count, extra = {}) => {
  const d = registry.itemsByName[name]; assert.ok(d, `no item ${name}`)
  return { name, type: d.id, count, stackSize: d.stackSize, metadata: 0, nbt: null, components: [], ...extra }
}
const stacks = (name, total) => { const s = registry.itemsByName[name].stackSize, out = []; for (let n = total; n > 0; n -= s) out.push(it(name, Math.min(s, n))); return out }
// Filler: one FULL stack each of distinct non-stone junk, so filler neither outranks the measured junk nor adds room.
const FILLER = ['netherrack', 'sand', 'sandstone', 'kelp', 'string', 'bone', 'feather', 'gunpowder', 'clay_ball', 'sugar_cane',
                'cactus', 'wheat', 'beetroot', 'carrot', 'potato', 'apple', 'paper', 'leather', 'rotten_flesh', 'spider_eye', 'slime_ball',
                'glowstone_dust', 'redstone', 'lapis_lazuli', 'quartz', 'prismarine_shard', 'ink_sac', 'cocoa_beans', 'melon_slice',
                'pumpkin_seeds', 'melon_seeds', 'beetroot_seeds', 'dandelion', 'poppy', 'cornflower', 'allium']
const FILL = n => { assert.ok(n <= FILLER.length); return FILLER.slice(0, n).map(name => it(name, registry.itemsByName[name].stackSize)) }
const to36 = items => [...items, ...FILL(36 - items.length)]
const sizeOf = n => registry.itemsByName[n]?.stackSize
const loot = lootFor(registry)
const spareOf = (inv, name) => inv.filter(x => x.name === name).reduce((n, x) => n + x.stackSize - x.count, 0)

// The two measured refusals (oretunnel-03), as the coordinator's read gave them. 0 empty slots each.
const ALPHA = to36([...stacks('leaf_litter', 221), it('oak_sapling', 5), it('birch_sapling', 9), it('egg', 15), it('raw_iron', 1),
                    it('cobblestone', 2), it('cobblestone', 2), it('cobbled_deepslate', 12)])                 // stone spare 176
const DELTA = to36([...stacks('bamboo', 179), it('leaf_litter', 54), it('wheat_seeds', 39), it('oak_sapling', 8), it('cobblestone', 30), it('cobblestone', 10),
                    it('dirt', 20), it('andesite', 20), it('tuff', 20), it('granite', 32)])                     // stone spare 252
const room = (inv, empty, opts = {}) => tunnelRoom(inv, empty, { stackSizeOf: sizeOf, ...opts })   // as the wiring passes it
const stoneSpare = inv => [...STONE_DROPS].reduce((n, d) => n + spareOf(inv, d), 0)


// ---- the fixtures ----
await t('POSITIVE CONTROL: both measured bags are full (36 stacks) and carry the measured stone spare', () => {
  assert.equal(ALPHA.length, 36); assert.equal(DELTA.length, 36)
  assert.equal(stoneSpare(ALPHA), 176); assert.equal(stoneSpare(DELTA), 252)
})

// ---- tunnelRoom: per item, ore slot reserved ----
await t('board-b-Alpha passes the pre-plan screen with 0 empty slots: ore fits its raw_iron stack, cobblestone has 124 spare', () => {
  const r = room(ALPHA, 0)
  assert.equal(r.ok, true, r.why); assert.equal(r.oreSpare, 63)
})
await t('hive-a-Delta is refused before planning: no raw_iron stack and no empty slot for the ore (stone is fine)', () => {
  const r = room(DELTA, 0)
  assert.equal(r.ok, false); assert.equal(r.slotsShort, 1); assert.match(r.why, /ore: 9 raw_iron need a slot/)
  assert.deepEqual(r.short, [], 'the stone screen passes: the ore slot is the only shortfall')
  assert.equal(room(DELTA, 1).ok, true, 'one free slot (the ore\'s) is enough')
})
await t('PER ITEM: andesite spare cannot hold cobblestone -- a mixed-type bag is refused for a cobblestone tunnel', () => {
  const inv = [...FILL(33), it('andesite', 1), it('diorite', 1), it('granite', 1)]   // 189 spare, none of it cobblestone
  const need = new Map([['cobblestone', 20]])
  const r = room(inv, 1, { cluster: 1, need })
  assert.equal(r.ok, false, 'the one empty slot is the ore\'s; cobblestone needs its own')
  assert.deepEqual(r.short.map(s => s.item), ['cobblestone']); assert.match(r.why, /cobblestone: need 20, spare 0/)
  assert.equal(room(inv, 2, { cluster: 1, need }).ok, true, 'a second empty slot holds it')
  assert.equal(room([...inv.slice(1), it('cobblestone', 44)], 1, { cluster: 1, need }).ok, true, 'cobblestone spare holds it')
})
await t(`POST-PLAN SLACK: spare must cover need + ${RETURN_RESERVE} (re-centre digs are not in the plan); exactly-equal now refuses`, () => {
  const inv = n => [...FILL(35), it('cobblestone', 64 - n)]
  const need = new Map([['cobblestone', 24]])
  assert.equal(room(inv(24), 1, { cluster: 3, need }).ok, true, 'control: with no slack, equal fits')
  const r = room(inv(24), 1, { cluster: 3, need, slack: RETURN_RESERVE })
  assert.equal(r.ok, false); assert.match(r.why, new RegExp(`cobblestone: need 24\\+${RETURN_RESERVE}, spare 24 -> 1 slot`))
  assert.equal(room(inv(24 + RETURN_RESERVE), 1, { cluster: 3, need, slack: RETURN_RESERVE }).ok, true)
})
await t('the ore needs a COMPATIBLE raw_iron stack: a renamed one (components) does not count, nor one with < cluster spare', () => {
  const named = it('raw_iron', 1, { components: [{ type: 'custom_name', data: 'x' }] })
  assert.equal(room([...FILL(34), it('dirt', 1), named], 0).ok, false)
  assert.equal(room([...FILL(34), it('dirt', 1), it('raw_iron', 64 - CLUSTER_CAP)], 0).ok, true)
  assert.equal(room([...FILL(34), it('dirt', 1), it('raw_iron', 64 - CLUSTER_CAP + 1)], 0).ok, false)
})
await t('plainStack on REAL prismarine-item Items: added components, removed components or NBT each make a stack incompatible', () => {
  const fresh = () => new Item(registry.itemsByName.raw_iron.id, 3)
  assert.ok(Array.isArray(fresh().components) && Array.isArray(fresh().removedComponents), 'positive control: 1.21 Items carry both lists')
  assert.equal(plainStack(fresh()), true)
  const a = fresh(); a.components = [{ type: 'custom_name', data: 'x' }]; assert.equal(plainStack(a), false)
  const r = fresh(); r.removedComponents = [{ type: 'max_stack_size' }]; assert.equal(plainStack(r), false)
  const n = fresh(); n.nbt = { type: 'compound', name: '', value: {} }; assert.equal(plainStack(n), false)
})
await t('pre-plan screen: one stone type needs >= STONE_ROOM spare, or a slot beyond the ore\'s; two empty slots always pass', () => {
  assert.equal(room([...FILL(35), it('cobblestone', 64 - STONE_ROOM)], 1).ok, true)
  assert.equal(room([...FILL(35), it('cobblestone', 64 - STONE_ROOM + 1)], 1).ok, false)
  assert.equal(room(FILL(34), 2).ok, true)
  assert.equal(tunnelRoom([{ name: 'cobblestone', count: 1 }], 1).ok, false, 'no stackSize: never assume 64')
})

// ---- what the breaks can drop ----
await t('lootFor: the MAX each block can drop without Silk Touch (vanilla maxima where minecraft-data is low)', () => {
  const max = (b, item) => loot(b).find(d => d.item === item)?.max
  assert.deepEqual(loot('stone'), [{ item: 'cobblestone', max: 1 }], 'stone -> cobblestone only (the silk-touch stone entry is not counted)')
  assert.equal(max('copper_ore', 'raw_copper'), 5); assert.equal(max('deepslate_copper_ore', 'raw_copper'), 5)
  assert.equal(max('lapis_ore', 'lapis_lazuli'), 9); assert.equal(max('redstone_ore', 'redstone'), 5)
  assert.ok(max('coal_ore', 'coal') >= 1); assert.ok(max('iron_ore', 'raw_iron') >= 1)
  assert.deepEqual(loot('gravel').map(d => d.item).sort(), ['flint', 'gravel'])
  assert.deepEqual(loot('air'), [])
})
await t('tunnelDrops: per item, at the max: copper ore needs room for 5 raw_copper; gravel for gravel AND flint', () => {
  const need = tunnelDrops(['stone', 'stone', 'deepslate', 'grass_block', 'gravel', 'copper_ore', 'andesite', null, 'air'], loot)
  assert.deepEqual(Object.fromEntries(need), { cobblestone: 2, cobbled_deepslate: 1, dirt: 1, gravel: 1, flint: 1, raw_copper: 5, andesite: 1 })
})
await t('STONE_DROPS is what the tunnel\'s blocks drop (registry ' + VERSION + ')', () => {
  for (const b of ['stone', 'deepslate', 'dirt', 'grass_block', 'gravel', 'andesite', 'diorite', 'granite', 'tuff']) {
    const d = loot(b).map(x => x.item); assert.ok(d.length > 0, `${b} has no drop`)
    for (const x of d) if (x !== 'flint') assert.ok(STONE_DROPS.has(x), `${b} drops ${x}`)
  }
})

// ---- enchanted tools ----
const enchName = id => registry.enchantments[id]?.name
const tool = (name, left, enchants) => {
  const d = registry.itemsByName[name]
  const x = { ...it(name, 1), maxDurability: d.maxDurability, durabilityUsed: d.maxDurability - left }
  if (enchants === 'throws') Object.defineProperty(x, 'enchants', { get () { throw new Error('unreadable') }, enumerable: false })
  else if (enchants !== undefined) x.enchants = enchants
  return x
}
await t('toolRisk: Fortune or Silk Touch on a digging tool (by name or registry id), an unknown id, or an unreadable read', () => {
  assert.equal(toolRisk(tool('stone_pickaxe', 100), enchName), null)
  assert.equal(toolRisk(tool('stone_pickaxe', 100, [{ name: 'efficiency', lvl: 2 }]), enchName), null)
  assert.match(toolRisk(tool('iron_pickaxe', 100, [{ name: 'fortune', lvl: 3 }]), enchName), /fortune/)
  assert.match(toolRisk(tool('iron_shovel', 100, { enchantments: [{ id: registry.enchantmentsByName.silk_touch.id, level: 1 }] }), enchName), /silk_touch/)
  assert.match(toolRisk(tool('iron_pickaxe', 100, [{ id: 9999, level: 1 }]), enchName), /unidentified/)
  assert.match(toolRisk(tool('iron_pickaxe', 100, 'throws'), enchName), /unreadable/)
  assert.equal(toolRisk(it('cobblestone', 3), enchName), null)
})
await t('bagOccupants names what fills the bag', () => {
  assert.deepEqual(bagOccupants(ALPHA, 1).map(x => [x.name, x.slots]), [['leaf_litter', 4]])
  assert.deepEqual(bagOccupants(DELTA, 1).map(x => [x.name, x.slots]), [['bamboo', 3]])
})

// ---- THE NINE MEASURED REFUSALS through the pre-plan screen ----
// Counts from the fleet rows (oretunnel-03); layout unknown, so each item is packed into full stacks then one partial.
// The rows give only the stone-family TOTAL spare; it is split here over as few types as packing allows (63 max each).
const packedStone = total => { const out = [], kinds = ['cobblestone', 'dirt', 'andesite', 'tuff', 'granite']; let k = 0
  for (let left = total; left > 0; k++) { const s = Math.min(63, left); out.push(it(kinds[k], 64 - s)); left -= s } return out }
const MEASURED = [
  ...[[1, 177, 9], [1, 176, 9], [1, 176, 8], [0, 176, 8], [0, 176, 8]].map(([iron, spare, birch], i) => ({ bot: `board-b-Alpha #${i + 1}`, iron, spare,
    junk: [...stacks('leaf_litter', 221), it('oak_sapling', 5), it('birch_sapling', birch), it('wheat_seeds', 1), it('egg', 15)] })),
  ...[[252, 54], [250, 56], [241, 58], [233, 55]].map(([spare, leaf], i) => ({ bot: `hive-a-Delta #${i + 1}`, iron: 0, spare,
    junk: [...stacks('bamboo', 179), it('leaf_litter', leaf), it('oak_sapling', 8), it('wheat_seeds', 39)] })),
]
const verdicts = MEASURED.map(m => {
  const inv = to36([...m.junk, ...(m.iron ? [it('raw_iron', m.iron)] : []), ...packedStone(m.spare)])
  return { ...m, slots: inv.length, r: room(inv, 0) }
})
await t(`MEASURED 9: ${verdicts.filter(v => v.r.ok).length} of 9 now pass the pre-plan screen (the raw_iron-holding Alphas); the rest are one ore slot short`, () => {
  for (const v of verdicts) {
    assert.equal(v.slots, 36, `${v.bot}: 36 slots used`)
    console.log(`        ${v.bot.padEnd(18)} raw_iron ${v.iron}  stone spare ${String(v.spare).padStart(3)} -> ${v.r.ok ? 'PROCEEDS to planning' : `refused: ${v.r.why}`}`)
    assert.equal(v.r.ok, v.iron > 0, v.bot)
    if (!v.r.ok) { assert.equal(v.r.slotsShort, 1); assert.deepEqual(v.r.short, []) }
  }
})

// ---- WIRED through the real tunnelToOre, the real planner and pathfinder on a fake world ----
const ORE = new Vec3(30, 54, 6)
const ARRIVE = new Vec3(31.5, 54, 6.5)       // face-adjacent to the ore: SideOfBlock accepts it
const wornPick = tool('stone_pickaxe', 12)
const armed = inv => { assert.ok(FILLER.includes(inv.at(-1).name), 'the last slot must be filler'); return [...inv.slice(0, -1), wornPick] }
const ok = { aborted: false, addEventListener () {}, removeEventListener () {} }
function tunnelBot (items, { empty = 0 } = {}) {
  const bot = new EventEmitter()
  Object.assign(bot, { registry, version: VERSION, health: 20, food: 20, currentWindow: null, game: { minY: -64 }, entities: {}, world: { raycast: () => null } })
  bot.entity = { position: new Vec3(30.5, 64, 0.5), effects: {}, onGround: true, velocity: new Vec3(0, 0, 0) }
  bot.inventory = { items: () => items.map(x => x), emptySlotCount: () => empty }
  bot.waitForTicks = async () => { await new Promise(r => setImmediate(r)) }
  bot.blockAt = p => {
    const f = p.floored(); if (Math.abs(f.x - 30) > 60 || Math.abs(f.z) > 60) return null
    const name = f.equals(ORE) ? 'iron_ore' : (f.y <= 63 ? 'stone' : 'air')
    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = f; return b
  }
  bot.findBlocks = () => [ORE.clone()]
  pathfinder(bot)
  // THE WALK IS STUBBED: it records which tool the pathfinder would dig stone with, then arrives beside the ore.
  const dugWith = []
  bot.pathfinder.goto = async () => { dugWith.push(bot.pathfinder.bestHarvestTool(bot.blockAt(new Vec3(30, 60, 3)))?.name ?? null); bot.entity.position = ARRIVE.clone() }
  return { bot, dugWith }
}
const run = bot => tunnelToOre({ bot, runner: null }, ok, { deadlineMs: 150_000 })
// POSITIVE CONTROL for the wired runs: what the real planner digs to this ore, and therefore the cobblestone it yields.
const probe = tunnelBot(armed(FILL(36)))
const plan = await planTunnel(probe.bot, { candidates: [ORE], moves: tunnelMovements(probe.bot, null, { home: { x: 0, z: 0 } }), yieldFn: () => Promise.resolve() })
const N = plan.ok ? plan.breaks.length : -1
const NEED = N + RETURN_RESERVE
await t(`POSITIVE CONTROL: the real planner reaches the ore with N planned breaks (N = ${N}), all stone -> ${N} cobblestone`, () => {
  assert.equal(plan.ok, true, plan.why); assert.ok(N > 5 && N <= 58)
  assert.deepEqual(Object.fromEntries(tunnelDrops(plan.breaks.map(q => probe.bot.blockAt(q)?.name), loot)), { cobblestone: N })
})
const bagWithCobbleSpare = spare => to36([it('cobblestone', 64 - spare), it('dirt', 20), it('raw_iron', 1), ...stacks('leaf_litter', 221)])
await t('WIRED Delta: refused BEFORE planning on the ore slot; names the bag; no deposit advice', async () => {
  const { bot } = tunnelBot(armed(DELTA))
  const r = await run(bot)
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.match(r.detail, /before planning/)
  assert.match(r.detail, /ore: 9 raw_iron need a slot/); assert.match(r.detail, /bamboo 179 \(3 slots\)/); assert.doesNotMatch(r.detail, /deposit/)
})
await t(`WIRED: the screen passes but the plan does not -> refused AFTER planning: cobblestone need ${N}+${RETURN_RESERVE}, spare ${NEED - 1}`, async () => {
  const inv = bagWithCobbleSpare(NEED - 1)
  assert.equal(room(inv, 0).ok, true, 'positive control: the pre-plan screen passes')
  const { bot } = tunnelBot(armed(inv))
  const r = await run(bot)
  assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.match(r.detail, new RegExp(`cobblestone: need ${N}\\+${RETURN_RESERVE}, spare ${NEED - 1}`)); assert.match(r.detail, /leaf_litter 221 \(4 slots\)/)
  assert.doesNotMatch(r.detail, /deposit/)
})
await t(`WIRED: EXACTLY N (${N}) cobblestone spare is now refused -- re-centre digs are not in the plan`, async () => {
  const { bot } = tunnelBot(armed(bagWithCobbleSpare(N)))
  const r = await run(bot)
  assert.equal(r.failClass, 'inventory_full', `${r.failClass}: ${r.detail}`)
})
await t(`WIRED: N + ${RETURN_RESERVE} spare proceeds past the room check (to the pickaxe check)`, async () => {
  const { bot } = tunnelBot(armed(bagWithCobbleSpare(NEED)))
  const r = await run(bot)
  assert.equal(r.failClass, 'pickaxe_short', `${r.failClass}: ${r.detail}`)
})
await t('WIRED Alpha: passes both checks with 0 empty slots (ore into raw_iron 1, cobblestone 124 spare)', async () => {
  const { bot } = tunnelBot(armed(ALPHA))
  const r = await run(bot)
  assert.equal(r.failClass, 'pickaxe_short', `${r.failClass}: ${r.detail}`)
})

// ---- WIRED: enchanted tools ----
const roomy = tools => [...FILL(30), it('cobblestone', 1), it('raw_iron', 1), ...tools]   // 4 empty slots, plenty of room
const FORTUNE_IRON = () => tool('iron_pickaxe', 250, [{ name: 'fortune', lvl: 3 }])
await t('WIRED: only a Fortune pickaxe (plenty of uses) -> refused enchanted_tool, remedy names an unenchanted pickaxe; no walk', async () => {
  const { bot, dugWith } = tunnelBot(roomy([FORTUNE_IRON()]), { empty: 4 })
  const r = await run(bot)
  assert.equal(r.failClass, 'enchanted_tool', `${r.failClass}: ${r.detail}`)
  assert.match(r.detail, /fortune/); assert.match(r.detail, /unenchanted/); assert.equal(dugWith.length, 0)
})
await t('WIRED: an unreadable enchantment fails closed -> enchanted_tool', async () => {
  const { bot } = tunnelBot(roomy([tool('iron_pickaxe', 250, 'throws')]), { empty: 4 })
  const r = await run(bot)
  assert.equal(r.failClass, 'enchanted_tool', `${r.failClass}: ${r.detail}`); assert.match(r.detail, /unreadable/)
})
await t('WIRED: Fortune pickaxe + a worn plain one that cannot pay the trip -> enchanted_tool (not pickaxe_short)', async () => {
  const { bot } = tunnelBot(roomy([FORTUNE_IRON(), tool('stone_pickaxe', 12)]), { empty: 4 })
  const r = await run(bot)
  assert.equal(r.failClass, 'enchanted_tool', `${r.failClass}: ${r.detail}`)
})
await t('WIRED: Fortune pickaxe + a fresh plain one -> the tunnel runs, digging with the PLAIN pickaxe; the tool picker is restored', async () => {
  const { bot, dugWith } = tunnelBot(roomy([FORTUNE_IRON(), tool('stone_pickaxe', 131)]), { empty: 4 })
  const picker = bot.pathfinder.bestHarvestTool
  assert.equal(picker(bot.blockAt(new Vec3(30, 60, 3)))?.name, 'iron_pickaxe', 'positive control: left alone, the pathfinder picks the Fortune pickaxe')
  const r = await run(bot)
  assert.equal(r.status, 'success', `${r.failClass}: ${r.detail}`)
  assert.deepEqual(dugWith, ['stone_pickaxe']); assert.equal(bot.pathfinder.bestHarvestTool, picker, 'the original picker is restored')
})

// ---- MUTANTS: each guard must be SEEN to fail for its intended reason (anchor present and unique) ----
async function withMutant (file, old, neu, fn) {
  const url = new URL(`../src/${file}`, import.meta.url)
  const src = fs.readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `ANCHOR MISSING in ${file}: ${JSON.stringify(old.slice(0, 60))} -- a mutant never written reads as killed`)
  assert.equal(src.split(old).length, 2, `anchor not unique in ${file}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
await t('MUTANT KILLED: summing spare across stone types lets andesite hold cobblestone', async () => {
  await withMutant('oretunnel.mjs', '      const spare = spareFor(items, item)\n',
    '      const spare = [...STONE_DROPS].reduce((n, d) => n + spareFor(items, d), 0)\n', async m => {
      const inv = [...FILL(33), it('andesite', 1), it('diorite', 1), it('granite', 1)]
      assert.equal(m.tunnelRoom(inv, 1, { cluster: 1, need: new Map([['cobblestone', 20]]), stackSizeOf: sizeOf }).ok, true, 'mutant did not change the verdict')
    })
})
await t('MUTANT KILLED: dropping the post-plan slack lets an exactly-equal tunnel through', async () => {
  await withMutant('skills.mjs', 'slack: RETURN_RESERVE', 'slack: 0', async m => {
    const { bot } = tunnelBot(armed(bagWithCobbleSpare(N)))
    const r = await m.tunnelToOre({ bot, runner: null }, ok, { deadlineMs: 150_000 })
    assert.equal(r.failClass, 'pickaxe_short', `the mutant should pass the room check: ${r.failClass}`)
  })
})
await t('MUTANT KILLED: counting minecraft-data\'s drop maxima instead of vanilla\'s under-counts lapis', async () => {
  await withMutant('oretunnel.mjs', 'Math.max(hi, VANILLA_MAX[e.item] ?? 0)', 'hi', async m => {
    assert.ok(m.lootFor(registry)('lapis_ore').find(d => d.item === 'lapis_lazuli').max < 9, 'mutant did not lower the count')
  })
})
await t('MUTANT KILLED: not classifying enchanted tools (the reviewer\'s `risky -> 0`) lets the Fortune-only bot tunnel', async () => {
  await withMutant('skills.mjs', 'const safeItems = held().filter(x => !riskyTool(x))', 'const safeItems = held()', async m => {
    const { bot } = tunnelBot(roomy([FORTUNE_IRON()]), { empty: 4 })
    const r = await m.tunnelToOre({ bot, runner: null }, ok, { deadlineMs: 150_000 })
    assert.notEqual(r.failClass, 'enchanted_tool', 'mutant still refused')
  })
})
await t('MUTANT KILLED: without the tool restriction the walk digs with the Fortune pickaxe', async () => {
  await withMutant('skills.mjs', 'const restoreTools = keepToolsOut(bot, riskyTool)', 'const restoreTools = () => {}', async m => {
    const { bot, dugWith } = tunnelBot(roomy([FORTUNE_IRON(), tool('stone_pickaxe', 131)]), { empty: 4 })
    await m.tunnelToOre({ bot, runner: null }, ok, { deadlineMs: 150_000 })
    assert.deepEqual(dugWith, ['iron_pickaxe'], 'mutant still dug with the plain pickaxe')
  })
})

try { fs.rmSync(LOG_DIR, { recursive: true, force: true }) } catch {}
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
