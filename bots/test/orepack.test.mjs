// ROOM BY CAPACITY + MERGE SPLIT STACKS: the ore tunnel's inventory gate.
//
// oretunnel-03 (10-02): 9 of 12 tunnel attempts were refused `emptySlotCount() < 2 -> deposit first`; the 3 that ran
// all reached the ore. The refused bots had 0 empty slots but 176-252 spare room in stone stacks, and the bank chests
// that "deposit" needs are often full. These tests pin: capacity PER ITEM with the ore's slot reserved; the post-plan
// recheck on what the planned breaks drop; Fortune/Silk Touch; and the merge remedy driven through a window model
// that does what the server does with each click -- including a toss, which every test forbids.
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
const { pathfinder } = require('mineflayer-pathfinder')
const OT = await import('../src/oretunnel.mjs')
const { tunnelRoom, tunnelDrops, dropRisk, sameStack, plainStack, mergePlan, bagOccupants, STONE_DROPS, STONE_ROOM, CLUSTER_CAP,
        tunnelMovements, planTunnel } = OT
const SK = await import('../src/skills.mjs')
const { tunnelToOre, mergeStacks } = SK

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
const withSlots = items => items.map((x, i) => ({ ...x, slot: 9 + i }))
const sizeOf = n => registry.itemsByName[n]?.stackSize
const dropsOf = b => (registry.blocksByName[b]?.drops ?? []).map(d => registry.items[typeof d === 'object' ? (d.drop?.id ?? d.id) : d]?.name).filter(Boolean)
const spareOf = (inv, name) => inv.filter(x => x.name === name).reduce((n, x) => n + x.stackSize - x.count, 0)

// The two measured refusals (oretunnel-03), as the coordinator's read gave them. 0 empty slots each.
const ALPHA = to36([...stacks('leaf_litter', 221), it('oak_sapling', 5), it('birch_sapling', 3), it('egg', 15), it('raw_iron', 1),
                    it('cobblestone', 2), it('cobblestone', 2), it('cobbled_deepslate', 12)])                 // stone spare 176
const DELTA = to36([...stacks('bamboo', 179), it('leaf_litter', 54), it('wheat_seeds', 39), it('cobblestone', 30), it('cobblestone', 10),
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
await t('hive-a-Delta is one slot short before merging: no raw_iron stack and no empty slot for the ore', () => {
  const r = room(DELTA, 0)
  assert.equal(r.ok, false); assert.equal(r.slotsShort, 1); assert.match(r.why, /ore: 9 raw_iron need a slot/)
  assert.equal(room(DELTA, 1).ok, true, 'one free slot (the ore\'s) is enough: dirt/andesite/tuff each have 44 spare')
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
await t('POST-PLAN: a plan longer than the spare is refused with the specific shortfall', () => {
  const inv = [...FILL(35), it('cobblestone', 40)]   // 24 spare
  assert.equal(room(inv, 1, { cluster: 3, need: new Map([['cobblestone', 24]]) }).ok, true)
  const r = room(inv, 1, { cluster: 3, need: new Map([['cobblestone', 25]]) })
  assert.equal(r.ok, false); assert.match(r.why, /cobblestone: need 25, spare 24 -> 1 slot/)
})
await t('the ore needs a COMPATIBLE raw_iron stack: a renamed one (components) does not count, nor one with < cluster spare', () => {
  const named = it('raw_iron', 1, { components: [{ type: 'custom_name', data: 'x' }] })
  assert.equal(room([...FILL(34), it('dirt', 1), named], 0).ok, false)
  assert.equal(room([...FILL(34), it('dirt', 1), it('raw_iron', 64 - CLUSTER_CAP)], 0).ok, true)
  assert.equal(room([...FILL(34), it('dirt', 1), it('raw_iron', 64 - CLUSTER_CAP + 1)], 0).ok, false)
  assert.equal(plainStack(named), false); assert.equal(plainStack(it('raw_iron', 1)), true)
})
await t('pre-plan screen: one stone type needs >= STONE_ROOM spare, or a slot beyond the ore\'s; two empty slots always pass', () => {
  assert.equal(room([...FILL(35), it('cobblestone', 64 - STONE_ROOM)], 1).ok, true)
  assert.equal(room([...FILL(35), it('cobblestone', 64 - STONE_ROOM + 1)], 1).ok, false)
  assert.equal(room(FILL(34), 2).ok, true)
  assert.equal(room([{ name: 'cobblestone', count: 1 }], 1).ok, false, 'no stackSize: never assume 64')
})
await t('tunnelDrops: what each broken block drops, per item; gravel needs room as gravel AND as flint', () => {
  const need = tunnelDrops(['stone', 'stone', 'deepslate', 'grass_block', 'gravel', 'andesite', null, 'air'], dropsOf)
  assert.deepEqual(Object.fromEntries(need), { cobblestone: 2, cobbled_deepslate: 1, dirt: 1, gravel: 1, flint: 1, andesite: 1 })
})
await t('STONE_DROPS is what the tunnel\'s blocks drop (registry ' + VERSION + ')', () => {
  for (const b of ['stone', 'deepslate', 'dirt', 'grass_block', 'gravel', 'andesite', 'diorite', 'granite', 'tuff']) {
    const d = dropsOf(b); assert.ok(d.length > 0, `${b} has no drop`)
    for (const x of d) assert.ok(STONE_DROPS.has(x), `${b} drops ${x}`)
  }
})
await t('dropRisk: Fortune or Silk Touch on any pickaxe (by name or registry id) costs one extra slot; unnamed fails closed', () => {
  const name = id => registry.enchantments[id]?.name
  const pk = e => it('stone_pickaxe', 1, { enchants: e })
  assert.equal(dropRisk([pk([])], name).risky, false)
  assert.equal(dropRisk([pk([{ name: 'efficiency', lvl: 2 }])], name).risky, false)
  assert.equal(dropRisk([pk([{ name: 'fortune', lvl: 3 }])], name).risky, true)
  assert.equal(dropRisk([pk({ enchantments: [{ id: registry.enchantmentsByName.silk_touch.id, level: 1 }] })], name).risky, true)
  assert.equal(dropRisk([pk([{ id: 9999, level: 1 }])], name).risky, true, 'unknown enchantment')
  assert.equal(room(ALPHA, 0, { extraSlots: 1 }).ok, false)
  assert.equal(room(ALPHA, 1, { extraSlots: 1 }).ok, true)
})

// ---- mergePlan ----
await t('sameStack: same item merges; different components or metadata do not', () => {
  assert.equal(sameStack(it('cobblestone', 3), it('cobblestone', 40)), true)
  assert.equal(sameStack(it('cobblestone', 3), it('cobblestone', 3, { components: [{ type: 'custom_name', data: 'x' }] })), false)
  assert.equal(sameStack(it('cobblestone', 3), it('cobbled_deepslate', 3)), false)
})
await t('mergePlan: Delta\'s cobblestone 30+10 frees one slot (10 poured into 30); Alpha\'s 2+2 too', () => {
  const d = mergePlan(withSlots(DELTA))
  assert.ok(d, 'a plan'); assert.equal(d.freed, 1)
  assert.deepEqual(d.moves.map(m => [m.name, m.n]), [['cobblestone', 10]])
  assert.deepEqual(mergePlan(withSlots(ALPHA)).moves.map(m => [m.name, m.n]), [['cobblestone', 2]])
})
await t('mergePlan: null when nothing can be emptied (one stack; 40+40 has only 24 room); full stacks and other items untouched', () => {
  assert.equal(mergePlan(withSlots([it('cobblestone', 60), ...FILL(30)])), null)
  assert.equal(mergePlan(withSlots([it('cobblestone', 40), it('cobblestone', 40)])), null)
  assert.equal(mergePlan(withSlots([it('cobblestone', 3), it('cobblestone', 3, { components: [{ type: 'custom_name', data: 'x' }] })])), null)
  const three = mergePlan(withSlots([it('dirt', 40), it('dirt', 40), it('dirt', 40)]))
  assert.equal(three.freed, 1); assert.equal(three.moves.reduce((n, m) => n + m.n, 0), 40, 'one 40 split across two 24-room stacks')
})
await t('bagOccupants names what fills the bag', () => {
  assert.deepEqual(bagOccupants(ALPHA, 1).map(x => [x.name, x.slots]), [['leaf_litter', 4]])
  assert.deepEqual(bagOccupants(DELTA, 1).map(x => [x.name, x.slots]), [['bamboo', 3]])
})

// ---- a window that does what the server does with a left click ----
// Pick up / put down / merge (same item: as much as fits, the rest stays on the cursor) / swap (different item).
// Slot -999 throws the cursor on the ground: recorded, and every test asserts it never happens.
function windowBot (items, { onClick = null } = {}) {
  const slots = Array(46).fill(null)
  items.forEach((x, i) => { slots[9 + i] = { ...x, slot: 9 + i } })
  const tossed = [], clicks = [], swaps = []
  let cursor = null
  const bot = new EventEmitter()
  Object.assign(bot, { registry, version: VERSION, health: 20, food: 20, currentWindow: null })
  bot.entity = { position: new Vec3(30.5, 64, 0.5), effects: {}, onGround: true, velocity: new Vec3(0, 0, 0) }
  bot.inventory = {
    slots, inventoryStart: 9, inventoryEnd: 45,
    get selectedItem () { return cursor },
    items: () => slots.slice(9, 45).filter(Boolean).map(x => ({ ...x })),
    emptySlotCount: () => slots.slice(9, 45).filter(s => !s).length,
  }
  bot.waitForTicks = async () => { await new Promise(r => setImmediate(r)) }
  bot.clickWindow = async (slot, button, mode) => {
    assert.equal(button, 0); assert.equal(mode, 0)
    clicks.push(slot)
    if (slot === -999) { if (cursor) tossed.push(cursor); cursor = null; return }
    const at = slots[slot]
    if (cursor && at && sameStack(cursor, at)) {
      const k = Math.min(cursor.count, at.stackSize - at.count); at.count += k; cursor.count -= k; if (!cursor.count) cursor = null
    } else if (cursor || at) {
      if (cursor && at) swaps.push([cursor.name, at.name])
      const was = at; slots[slot] = cursor ? { ...cursor, slot } : null; cursor = was ? { ...was } : null
    }
    await onClick?.(clicks.length, { slots, setSlot: (i, x) => { slots[i] = x ? { ...x, slot: i } : null } })
  }
  return { bot, slots, tossed, clicks, swaps, cursor: () => cursor }
}
const totals = slots => { const m = {}; for (const s of slots.slice(9, 45)) if (s) m[s.name] = (m[s.name] ?? 0) + s.count; return m }
const rows = () => { try { return fs.readFileSync(path.join(LOG_DIR, 'skill-PackBot.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } }
const settle = () => new Promise(r => setTimeout(r, 150))
const ok = { aborted: false, addEventListener () {}, removeEventListener () {} }

await t('MERGE, live: a 0-empty bot with split stacks (Delta) gains a slot; nothing tossed, nothing lost, cursor empty, row logged', async () => {
  const w = windowBot(DELTA)
  const before = totals(w.slots)
  const r = await mergeStacks(w.bot, ok, { want: 1, budgetMs: 5000 })
  assert.equal(w.bot.inventory.emptySlotCount(), 1, `empty after: ${w.bot.inventory.emptySlotCount()}`)
  assert.equal(r.merges, 1); assert.deepEqual(w.tossed, []); assert.equal(w.cursor(), null)
  assert.deepEqual(totals(w.slots), before, 'every item still in the bag')
  assert.ok(!w.clicks.includes(-999))
  await settle()
  const row = rows().filter(x => x.skill?.name === '_bag_packed').at(-1)
  assert.ok(row, 'a _bag_packed row'); assert.match(row.skill.detail, /1 merge.*empty slots 0->1/)
})
await t('MERGE, abort mid-move: the move finishes, the cursor is empty, nothing lost or tossed, and the abort propagates', async () => {
  const ac = { aborted: false, addEventListener () {}, removeEventListener () {} }
  const w = windowBot(DELTA, { onClick: n => { if (n === 1) ac.aborted = true } })   // abort with the stack in hand
  const before = totals(w.slots)
  let threw = null
  try { await mergeStacks(w.bot, ac, { want: 1, budgetMs: 5000 }) } catch (e) { threw = e }
  assert.ok(threw?.aborted, `the abort must propagate (got ${threw?.message})`)
  assert.equal(w.cursor(), null, 'an item was left on the cursor'); assert.deepEqual(w.tossed, [])
  assert.deepEqual(totals(w.slots), before)
})
await t('MERGE, pickup race: a different item lands in the emptied source slot mid-pour -> the remainder goes to a same-item stack; no swap, no toss', async () => {
  // dirt 20+50+50: the pour into one 50 leaves 6 on the cursor; its source slot is now taken by a feather.
  const inv = [...FILL(33), it('dirt', 20), it('dirt', 50), it('dirt', 50)]
  const w = windowBot(inv, { onClick: (n, h) => { if (n === 1) h.setSlot(h.slots.findIndex((s, i) => i >= 9 && !s), it('feather', 1)) } })
  const before = totals(w.slots)
  const r = await mergeStacks(w.bot, ok, { want: 1, budgetMs: 5000 })
  assert.deepEqual(w.tossed, []); assert.ok(!w.clicks.includes(-999)); assert.deepEqual(w.swaps, [], 'a click swapped two different items')
  assert.equal(w.cursor(), null); assert.equal(r.stranded, false)
  assert.deepEqual(totals(w.slots), { ...before, feather: before.feather + 1 }, 'all 120 dirt still held, plus the picked-up feather')
})
await t('MERGE respects the budget: no time, no clicks', async () => {
  const w = windowBot(DELTA)
  const r = await mergeStacks(w.bot, ok, { want: 1, budgetMs: 0 })
  assert.equal(w.clicks.length, 0); assert.equal(r.merges, 0)
})
await t('MERGE stays out of an open container window (its slot numbers are not the inventory\'s)', async () => {
  const w = windowBot(DELTA); w.bot.currentWindow = { id: 3 }
  const r = await mergeStacks(w.bot, ok, { want: 1, budgetMs: 5000 })
  assert.equal(w.clicks.length, 0); assert.equal(r.merges, 0)
})

// ---- WIRED through the real tunnelToOre, the real planner and pathfinder on a fake world ----
const ORE = new Vec3(30, 54, 6)
const wornPick = (() => { const d = registry.itemsByName.stone_pickaxe; return { ...it('stone_pickaxe', 1), maxDurability: d.maxDurability, durabilityUsed: d.maxDurability - 12 } })()
const armed = inv => { assert.ok(FILLER.includes(inv.at(-1).name), 'the last slot must be filler'); return [...inv.slice(0, -1), wornPick] }
function tunnelBot (items, opts) {
  const w = windowBot(items, opts)
  const bot = w.bot
  bot.game = { minY: -64 }; bot.entities = {}; bot.world = { raycast: () => null }
  bot.blockAt = p => {
    const f = p.floored(); if (Math.abs(f.x - 30) > 60 || Math.abs(f.z) > 60) return null
    const name = f.equals(ORE) ? 'iron_ore' : (f.y <= 63 ? 'stone' : 'air')
    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = f; return b
  }
  bot.findBlocks = () => [ORE.clone()]
  pathfinder(bot)
  return w
}
// POSITIVE CONTROL for the wired runs: what the real planner digs to this ore, and therefore the cobblestone it yields.
const probe = tunnelBot(armed(FILL(36)))
const plan = await planTunnel(probe.bot, { candidates: [ORE], moves: tunnelMovements(probe.bot, null, { home: { x: 0, z: 0 } }), yieldFn: () => Promise.resolve() })
const N = plan.ok ? plan.breaks.length : -1
await t(`POSITIVE CONTROL: the real planner reaches the ore with N planned breaks (N = ${N}), all stone`, () => {
  assert.equal(plan.ok, true, plan.why); assert.ok(N > 5 && N <= 60)
  assert.deepEqual(Object.fromEntries(tunnelDrops(plan.breaks.map(q => probe.bot.blockAt(q)?.name), dropsOf)), { cobblestone: N })
})
await t(`WIRED Delta: merges a slot for the ore, plans, and is refused AFTER planning: ${N} cobblestone > 24 spare (its 1 free slot is the ore's)`, async () => {
  assert.ok(N > 24, `this world's tunnel is ${N} breaks; the test needs one longer than Delta's 24 cobblestone spare`)
  const w = tunnelBot(armed(DELTA))
  const r = await tunnelToOre({ bot: w.bot, runner: null }, ok, { deadlineMs: 150_000 })
  assert.deepEqual(w.tossed, []); assert.equal(w.cursor(), null)
  assert.equal(w.bot.inventory.emptySlotCount(), 1, 'the cobblestone merge freed the ore\'s slot')
  assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.match(r.detail, new RegExp(`cobblestone: need ${N}, spare 24 -> 1 slot`), r.detail)
  assert.equal(room(w.bot.inventory.items(), 1, { cluster: 1, need: new Map([['cobblestone', 24]]) }).ok, true,
    'and the same merged bag passes a tunnel of 24 cobblestone')
})
await t('WIRED: screen passes but the PLAN does not fit -> refused AFTER planning, naming the item and the bag, no deposit advice', async () => {
  const inv = to36([it('cobblestone', 64 - (N - 1)), it('dirt', 20), it('raw_iron', 1), ...stacks('leaf_litter', 221)])
  assert.equal(room(inv, 0).ok, true, 'positive control: the pre-plan screen passes (dirt 44 spare, ore in raw_iron)')
  const w = tunnelBot(armed(inv))
  const r = await tunnelToOre({ bot: w.bot, runner: null }, ok, { deadlineMs: 150_000 })
  assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.match(r.detail, new RegExp(`cobblestone: need ${N}, spare ${N - 1}`)); assert.match(r.detail, /leaf_litter 221 \(4 slots\)/)
  assert.doesNotMatch(r.detail, /deposit/)
})
await t('WIRED: the same bag with exactly N cobblestone spare proceeds past the room check (to the pickaxe check)', async () => {
  const inv = to36([it('cobblestone', 64 - N), it('dirt', 20), it('raw_iron', 1), ...stacks('leaf_litter', 221)])
  const w = tunnelBot(armed(inv))
  const r = await tunnelToOre({ bot: w.bot, runner: null }, ok, { deadlineMs: 150_000 })
  assert.equal(r.failClass, 'pickaxe_short', `${r.failClass}: ${r.detail}`)
})
await t('WIRED Alpha: passes both checks with 0 empty slots (ore into raw_iron 1, cobblestone 124 spare), no merge needed', async () => {
  const w = tunnelBot(armed(ALPHA))
  const r = await tunnelToOre({ bot: w.bot, runner: null }, ok, { deadlineMs: 150_000 })
  assert.equal(r.failClass, 'pickaxe_short', `${r.failClass}: ${r.detail}`); assert.equal(w.clicks.length, 0)
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
await t('MUTANT KILLED: checking the abort mid-move leaves the stack on the cursor', async () => {
  await withMutant('skills.mjs', '      await mergeClick(src)\n', '      await mergeClick(src); check(signal)\n', async m => {
    const ac = { aborted: false, addEventListener () {}, removeEventListener () {} }
    const w = windowBot(DELTA, { onClick: n => { if (n === 1) ac.aborted = true } })
    await m.mergeStacks(w.bot, ac, { want: 1, budgetMs: 5000 }).catch(() => {})
    assert.notEqual(w.cursor(), null, 'the mutant did not strand the cursor, so the abort test proves nothing')
  })
})
await t('MUTANT KILLED: pouring a stack that cannot be emptied (no room check) plans a merge that frees nothing', async () => {
  await withMutant('oretunnel.mjs', '      if (room < src.count) break', '      if (room < 1) break', async m => {
    assert.notEqual(m.mergePlan(withSlots([it('cobblestone', 40), it('cobblestone', 40)])), null)
  })
})
await t('MUTANT KILLED: homing the cursor without checking the slot swaps it for whatever landed there', async () => {
  await withMutant('skills.mjs', 'const home = homeFor(prefer)', 'const home = prefer', async m => {
    const inv = [...FILL(33), it('dirt', 20), it('dirt', 50), it('dirt', 50)]
    const w = windowBot(inv, { onClick: (n, h) => { if (n === 1) h.setSlot(h.slots.findIndex((s, i) => i >= 9 && !s), it('feather', 1)) } })
    await m.mergeStacks(w.bot, ok, { want: 1, budgetMs: 5000 }).catch(() => {})
    assert.ok(w.swaps.length > 0, 'the mutant never swapped, so the race test proves nothing')
  })
})

try { fs.rmSync(LOG_DIR, { recursive: true, force: true }) } catch {}
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
