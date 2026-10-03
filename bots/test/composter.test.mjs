// INVENTORY HYGIENE, PHASE 2: the town composter. The measurement and the design are in src/composter.mjs.
//
// Behaviour only. Pure decisions through their exported functions (the scheduler included -- no source text), then
// the real skills through a fake bot whose inventory follows mineflayer's rules (equip SWAPS into the hotbar, crafted
// output that has no slot is DROPPED, as inventory.js putAway does), a fake crafting system built on the same
// prismarine-recipe tables mineflayer uses, and a fake composter that follows the vanilla rules (consume at 0-6,
// ripen 7->8 after 20 ticks, a use at 8 pops one bone meal on top with a 10-tick pickup delay).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
import { NEVER_KEEP, TRIGGER_SLOTS, isHousekeeping } from '../src/hygiene.mjs'

const LOG_DIR = `/tmp/mcbot-test-logs-composter-${process.pid}`
process.env.LOG_DIR = LOG_DIR; process.env.BOT_NAME = 'TestBot'   // before anything imports config.mjs
const C = await import('../src/composter.mjs')   // a namespace, so a missing export fails ITS test, not the file
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.11')
const Recipe = require('prismarine-recipe')(REG).Recipe

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 3).join('\n        ')}`)
  }
}
const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not finish within ${ms}ms`)), ms))])

// ---- the facts the code rests on, read from the registry the fleet runs --------------------------------------
await t('REGISTRY 1.21.11: composter state is `level` 0..8, read back as a number (prismarine-block gives a string)', () => {
  const B = require('prismarine-block')('1.21.11')
  const c = REG.blocksByName.composter
  assert.deepEqual(c.states.map(s => s.name), ['level'])
  for (let i = 0; i <= 8; i++) assert.equal(C.composterLevel(B.fromStateId(c.minStateId + i, 0)), i)
  assert.equal(C.composterLevel({ name: 'chest', getProperties: () => ({ level: '3' }) }), null)
  assert.equal(C.composterLevel({ name: 'composter', getProperties: () => ({}) }), null)
})

await t('REGISTRY 1.21.11: the recipe is 7 slabs of ONE wood in a U (12 variants, table); a slab craft is 3 planks -> 6 (table)', () => {
  const rs = Recipe.find(REG.itemsByName.composter.id)
  assert.equal(rs.length, 12)
  for (const r of rs) {
    assert.equal(r.requiresTable, true)
    const used = r.delta.filter(d => d.count < 0)
    assert.equal(used.length, 1, 'one wood per recipe'); assert.equal(-used[0].count, C.SLABS_PER_COMPOSTER)
    assert.match(REG.items[used[0].id].name, /_slab$/)
  }
  const slab = Recipe.find(REG.itemsByName.oak_slab.id)[0]
  assert.equal(slab.requiresTable, true); assert.equal(slab.result.count, 6)
  assert.deepEqual(slab.delta.filter(d => d.count < 0).map(d => -d.count), [3])
})

await t('every listed compostable is a real 1.21.11 item AND fleet ballast, never food; bone meal is never ballast', () => {
  for (const [name, p] of Object.entries(C.COMPOST_CHANCE)) {
    assert.ok(REG.itemsByName[name], `${name} is not an item`)
    assert.ok(NEVER_KEEP.has(name), `${name} is not NEVER_KEEP ballast`)
    assert.ok([0.3, 0.5, 0.65].includes(p), `${name} chance ${p}`)
    assert.ok(!REG.foodsByName[name], `${name} is food`)
  }
  assert.equal(NEVER_KEEP.has('bone_meal'), false)
})

// ---- the item filter and the order of insertion ------------------------------------------------------------------
const KEEPERS = ['apple', 'sweet_berries', 'bread', 'oak_sapling', 'birch_sapling', 'mangrove_propagule', 'stone_pickaxe',
  'wooden_axe', 'oak_log', 'birch_planks', 'iron_ore', 'raw_iron', 'coal', 'cobblestone', 'bone_meal', 'stick', 'torch']
const NOT_COMPOSTABLE = ['egg', 'brown_egg', 'blue_egg', 'flint', 'ink_sac', 'glow_ink_sac', 'pointed_dripstone', 'dead_bush', 'rail', 'bamboo']

await t('the filter: never saplings, food, tools, logs, ores or bone meal; never ballast vanilla will not compost', () => {
  for (const n of [...KEEPERS, ...NOT_COMPOSTABLE]) assert.equal(C.isCompostJunk(n), false, n)
  for (const n of ['leaf_litter', 'wheat_seeds', 'poppy', 'dandelion', 'short_grass', 'tall_grass', 'fern', 'vine', 'seagrass']) assert.equal(C.isCompostJunk(n), true, n)
})

let slotN = 9
const it = (name, count = 1, extra = {}) => ({ name, count, slot: slotN++, ...extra })
await t('#3 a bag with NO room takes the SMALLEST stack it can empty first, whatever its kind; with room, planner order', () => {
  slotN = 9
  const inv = [it('leaf_litter', 64), it('poppy', 9), it('wheat_seeds', 4), it('leaf_litter', 7), it('apple', 1), it('egg', 1)]
  assert.equal(C.nextInsert(inv, { room: false }).item.name, 'wheat_seeds')
  assert.equal(C.nextInsert(inv.filter(x => x.name !== 'wheat_seeds'), { room: false }).item.count, 7)
  assert.equal(C.nextInsert([it('apple', 1), it('egg', 2)], { room: false }), null)
  const roomy = C.nextInsert(inv, { room: true })
  assert.equal(roomy.item.name, 'leaf_litter'); assert.equal(roomy.item.count, 7, 'the partial leaf_litter stack first')
  const plan = C.compostPlan(inv)
  assert.equal(plan.junk, 84); assert.equal(plan.slots, inv.length)
})

await t('SAPLINGS: composted only above SAPLING_RESERVE per species, after leaf_litter, and planting still has stock', async () => {
  const { plantingOrder, PLANT_RESERVE } = await import('../src/workorder.mjs')
  for (const n of REG.itemsArray.filter(i => /_sapling$/.test(i.name)).map(i => i.name)) assert.equal(C.isCompostJunk(n), false, `${n} is not ballast`)
  slotN = 9
  const inv = [it('oak_sapling', 64), it('oak_sapling', 64), it('oak_sapling', 64), it('oak_sapling', 56), it('birch_sapling', 20),
               it('spruce_sapling', 9), it('leaf_litter', 30), it('wheat_seeds', 5), it('apple', 67), it('bamboo', 64)]
  const allow = C.compostAllowance(inv)
  assert.equal(allow.oak_sapling, 248 - C.SAPLING_RESERVE); assert.equal(allow.birch_sapling, 20 - C.SAPLING_RESERVE)
  assert.equal(allow.spruce_sapling, undefined, 'below the reserve: none'); assert.equal(allow.apple, undefined); assert.equal(allow.bamboo, undefined)
  assert.deepEqual(C.compostPlan(inv, { maxItems: 1000 }).take.map(x => x.name), ['leaf_litter', 'birch_sapling', 'oak_sapling', 'wheat_seeds'])
  // Drain it the way the skill does -- one insert at a time, recomputing -- and it stops AT the reserve, never below.
  const bag = inv.map(x => ({ ...x }))
  for (let i = 0; i < 1000; i++) {
    const nx = C.nextInsert(bag.filter(x => x.count > 0), { room: true }); if (!nx) break
    nx.item.count--; const orig = bag.find(x => x.slot === nx.item.slot); if (orig !== nx.item) orig.count = nx.item.count
  }
  const total = n => bag.filter(x => x.name === n).reduce((a, x) => a + x.count, 0)
  assert.equal(total('oak_sapling'), C.SAPLING_RESERVE); assert.equal(total('birch_sapling'), C.SAPLING_RESERVE)
  assert.equal(total('spruce_sapling'), 9); assert.equal(total('apple'), 67); assert.equal(total('bamboo'), 64)
  assert.ok(C.SAPLING_RESERVE > PLANT_RESERVE, 'composting down to the reserve would switch planting off')
  assert.ok(plantingOrder({ saplings: { oak_sapling: C.SAPLING_RESERVE }, spot: { x: 1, y: 64, z: 1 }, now: 1e12 }), 'planting starved at the reserve')
  // With no room, a sapling stack is a candidate only if the surplus empties it completely.
  assert.equal(C.nextInsert([it('oak_sapling', 20)], { room: false }), null, '20 saplings with a reserve of 16 cannot empty the slot')
  assert.equal(C.nextInsert([it('oak_sapling', 20), it('leaf_litter', 64)], { room: false }).item.name, 'leaf_litter')
})

// ---- #3 the full-composter dead end, as a decision --------------------------------------------------------------
await t('#3 fillDecision: a full bag only STARTS a fill whose stack empties before level 7; a ripe composter needs room', () => {
  const d = C.fillDecision
  assert.equal(d({ level: 0, room: true, smallest: 64 }), 'insert')
  assert.equal(d({ level: 0, room: false, smallest: 7 }), 'insert', 'seven inserts reach 7 at the earliest: the slot is free by then')
  assert.equal(d({ level: 0, room: false, smallest: 8 }), 'skip_no_room')
  assert.equal(d({ level: 5, room: false, smallest: 2 }), 'insert')
  assert.equal(d({ level: 5, room: false, smallest: 3 }), 'skip_no_room')
  assert.equal(d({ level: 7, room: true, smallest: 5 }), 'ripen')
  assert.equal(d({ level: 7, room: false, smallest: 5 }), 'skip_no_room')
  assert.equal(d({ level: 8, room: true, smallest: 5 }), 'harvest')
  assert.equal(d({ level: 8, room: false, smallest: 1 }), 'skip_no_room')
  assert.equal(d({ level: 3, room: true, smallest: 0 }), 'done')
  assert.equal(d({ level: null, room: true, smallest: 4 }), 'gone')
  slotN = 9
  assert.equal(C.boneMealRoom([...Array(36)].map(() => it('cobblestone', 64))), false)
  assert.equal(C.boneMealRoom([...Array(35)].map(() => it('cobblestone', 64))), true)
  assert.equal(C.boneMealRoom([...Array(35)].map(() => it('cobblestone', 64)).concat(it('bone_meal', 12))), true)
  assert.equal(C.boneMealRoom([...Array(35)].map(() => it('cobblestone', 64)).concat(it('bone_meal', 64))), false)
})

// ---- #1 the build plan carries its worst-case slot need ------------------------------------------------------------
await t('#1 build plan: one wood held, 3 logs without a table, 2 with one, and the WORST-CASE free slots of the chain', () => {
  const p = C.composterBuildPlan
  assert.equal(p({ oak_log: 2 }), null)
  assert.deepEqual(p({ oak_log: 3 }), { wood: 'oak', log: 'oak_log', logCrafts: 3, slabCrafts: 2, needTable: true, slotsNeeded: 4 })
  assert.deepEqual(p({ birch_log: 2 }, { tableAvailable: true }), { wood: 'birch', log: 'birch_log', logCrafts: 2, slabCrafts: 2, needTable: false, slotsNeeded: 3 })
  assert.equal(p({ oak_slab: 7 }, { tableAvailable: true }).slotsNeeded, 1, 'only the composter itself')
  assert.equal(p({ oak_planks: 6 }, { tableAvailable: true }).slotsNeeded, 2, 'slabs and the composter')
  assert.equal(p({ oak_slab: 4, birch_slab: 4 }, { tableAvailable: true }), null, 'slabs of two woods are not one recipe')
  assert.deepEqual(p({ composter: 1 }), { carried: true, slotsNeeded: 0 })
  assert.equal(p({ crimson_stem: 3 }).wood, 'crimson')
})

await t('one builder: the lowest name at town builds; others defer a bounded number of visits, then build', () => {
  assert.equal(C.builderDecision({ myName: 'b-Alpha', peers: ['b-Bravo'] }).build, true)
  const d = C.builderDecision({ myName: 'b-Delta', peers: ['b-Bravo', 'b-Alpha'] })
  assert.equal(d.build, false); assert.equal(d.to, 'b-Alpha')
  assert.equal(C.builderDecision({ myName: 'b-Delta', peers: ['b-Alpha'], deferrals: C.BUILDER_MAX_DEFERRALS }).build, true, 'starvation')
})

// ---- #2 / #8 the canonical site and its clearance --------------------------------------------------------------------
const AIR = { name: 'air', boundingBox: 'empty' }, GRASS = { name: 'grass_block', boundingBox: 'block' }
const flat = (extra = {}, floorY = 63) => (x, y, z) => extra[`${x},${y},${z}`] ?? (y <= floorY ? GRASS : AIR)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const HOME0 = { x: 0, y: 64, z: 0 }

await t('#2 canonical site: a function of home and the world only -- same answer for every bot, off the home point', () => {
  const read = flat()
  const a = C.canonicalComposterSite({ home: HOME0, read })
  const b = C.canonicalComposterSite({ home: HOME0, read })
  assert.ok(a?.site, JSON.stringify(a)); assert.deepEqual(a.site, b.site)
  assert.ok(Math.hypot(a.site.x, a.site.z) >= C.HOME_CLEARANCE)
  assert.equal(a.site.y, 64, 'on the surface')
  // terrain one block lower: the same column, on its surface
  assert.equal(C.canonicalComposterSite({ home: HOME0, read: flat({}, 62) }).site.y, 63)
  // an unloaded cell anywhere it had to look: no answer rather than a different one
  assert.equal(C.canonicalComposterSite({ home: HOME0, read: () => null }).site, null)
})

await t('#8 clearance: EVERY container type within 3 of the site moves it, with no cap on how many are read', () => {
  const base = C.canonicalComposterSite({ home: HOME0, read: flat() }).site
  for (const name of ['chest', 'trapped_chest', 'barrel', 'hopper', 'furnace', 'blast_furnace', 'smoker', 'red_shulker_box', 'shulker_box', 'dropper', 'dispenser', 'ender_chest']) {
    const extra = { [`${base.x + 2},${base.y},${base.z}`]: { name, boundingBox: 'block' } }
    // 80 other chests elsewhere in town: a capped scan could stop before the one that matters
    for (let i = 0; i < 80; i++) extra[`${-20 + (i % 10)},64,${20 + Math.floor(i / 10)}`] = { name: 'chest', boundingBox: 'block' }
    const r = C.canonicalComposterSite({ home: HOME0, read: flat(extra) })
    assert.ok(r.site, name)
    assert.ok(dist(r.site, { x: base.x + 2, y: base.y, z: base.z }) >= C.MIN_CONTAINER_DISTANCE, `${name}: ${JSON.stringify(r.site)}`)
    assert.ok(C.siteRefusal(flat(extra), base, HOME0), `${name} beside the old site is not refused`)
  }
  assert.equal(C.siteRefusal(flat(), base, HOME0), null)
})

await t('the site is never a corridor, beside a door, beside water, on a path, or unknown', () => {
  const s = { x: 5, y: 64, z: 0 }
  assert.ok(C.siteRefusal(flat({ '5,64,1': GRASS, '5,64,-1': GRASS }), s, HOME0), 'corridor')
  assert.ok(C.siteRefusal(flat({ '6,64,1': { name: 'oak_door', boundingBox: 'block' } }), s, HOME0), 'door')
  assert.ok(C.siteRefusal(flat({ '6,64,0': { name: 'water', boundingBox: 'empty' } }), s, HOME0), 'water')
  assert.ok(C.siteRefusal(flat({ '5,63,0': { name: 'dirt_path', boundingBox: 'block' } }), s, HOME0), 'path')
  assert.ok(C.siteRefusal((x, y, z) => (x === 7 ? null : flat()(x, y, z)), s, HOME0), 'unknown cell in the clearance volume')
  assert.ok(C.siteRefusal(flat(), { x: 1, y: 64, z: 0 }, HOME0), 'home point')
})

// ---- the scheduler, as a pure decision -------------------------------------------------------------------------------
const NOW = 10_000_000
const base = { now: NOW, slots: 36, freeSlots: 0, junk: 40, distHome: 10, storageNear: true, composterAtTown: true,
  buildPlan: null, myName: 'b-Alpha', peers: [], state: {} }

await t('scheduler: compost only at town, at the threshold, with junk, a composter present, cooldown and backoff clear', () => {
  const o = C.townOrder
  assert.equal(o(base).order?.skill, 'compost')
  assert.equal(o({ ...base, slots: TRIGGER_SLOTS - 1, freeSlots: 3 }).order, null)
  assert.equal(o({ ...base, distHome: C.TOWN_RADIUS + 1 }).order, null, 'never a trip')
  assert.equal(o({ ...base, junk: 0 }).order, null)
  assert.equal(o({ ...base, storageNear: false }).order, null)
  assert.equal(o({ ...base, state: { lastCompostAt: NOW - 1000 } }).order, null, 'cooldown')
  assert.equal(o({ ...base, state: { compostBackoffUntil: NOW + 1 } }).order, null, 'backoff')
  const issued = o(base)
  assert.equal(issued.state.lastCompostAt, NOW, 'the cooldown is charged when the order is ISSUED')
})

await t('#1 scheduler: BUILD is separate from composting -- at town, no composter, wood held, and free slots for the chain', () => {
  const o = C.townOrder
  const plan = { wood: 'oak', logCrafts: 3, slabCrafts: 2, needTable: true, slotsNeeded: 4 }
  const b = { ...base, composterAtTown: false, buildPlan: plan, slots: 20, freeSlots: 16, junk: 0 }
  assert.equal(o(b).order?.skill, 'build_composter', 'a bot with room and wood builds even far below the compost threshold')
  assert.equal(o({ ...b, slots: 33, freeSlots: 3 }).order, null, 'never craft into a bag that cannot hold the chain')
  assert.equal(o({ ...b, buildPlan: null }).order, null)
  assert.equal(o({ ...b, distHome: 200 }).order, null)
  assert.equal(o({ ...b, composterAtTown: true }).order, null, 'one per town')
  const d = o({ ...b, myName: 'b-Delta', peers: ['b-Alpha'] })
  assert.equal(d.order, null); assert.equal(d.state.deferrals, 1)
})

await t('scheduler: world scans are lazy and rate-limited -- nothing scans for a bot that cannot be due', () => {
  let scans = 0
  const spy = v => () => { scans++; return v }
  C.townOrder({ ...base, distHome: 900, storageNear: spy(true), composterAtTown: spy(true), buildPlan: spy(null) })
  assert.equal(scans, 0)
  const s1 = C.townOrder({ ...base, slots: 10, freeSlots: 26, junk: 0, storageNear: spy(true), composterAtTown: spy(false), buildPlan: spy(null) })
  const before = scans
  C.townOrder({ ...base, now: NOW + 1000, slots: 10, freeSlots: 26, junk: 0, storageNear: spy(true), composterAtTown: spy(false), buildPlan: spy(null), state: s1.state })
  assert.equal(scans, before, 'scanned again one second later')
})

await t('scheduler outcome: skips cost nothing, real failures back off, success clears', () => {
  const f = C.townOrderOutcome
  assert.equal(f('compost', 'no_effect', NOW, {}).compostBackoffUntil ?? 0, 0)
  assert.ok(f('compost', 'failed', NOW, {}).compostBackoffUntil > NOW)
  assert.equal(f('compost', 'success', NOW, { compostBackoffUntil: NOW + 5 }).compostBackoffUntil, 0)
  assert.equal(f('build_composter', 'no_effect', NOW, {}).buildBackoffUntil ?? 0, 0)
  assert.ok(f('build_composter', 'failed', NOW, {}).buildBackoffUntil > NOW)
  assert.equal(f('compost', 'aborted', NOW, {}).compostBackoffUntil ?? 0, 0)
  assert.equal(isHousekeeping('compost'), true); assert.equal(isHousekeeping('build_composter'), true); assert.equal(isHousekeeping('craft'), false)
})

// ---- #5 the hand, as a decision ------------------------------------------------------------------------------------------
await t('#5 hand plan: put back the exact tool; an empty hand is never "restored" onto a slot that now holds junk', () => {
  const P = C.handPlan
  const pickA = { name: 'stone_pickaxe', used: 30 }, pickB = { name: 'stone_pickaxe', used: 100 }
  const hb = (...xs) => Array.from({ length: 9 }, (_, i) => xs[i] ?? null)
  assert.deepEqual(P({ was: pickA, held: pickA, hotbar: hb(pickA) }), { action: 'none' })
  assert.deepEqual(P({ was: pickA, held: { name: 'leaf_litter', used: 0 }, hotbar: hb({ name: 'leaf_litter', used: 0 }, pickB, pickA) }), { action: 'select', index: 2 }, 'the same wear, not the first same name')
  const inMain = { name: 'stone_pickaxe', durabilityUsed: 30, slot: 20 }
  assert.deepEqual(P({ was: pickA, held: null, hotbar: hb(), items: [inMain] }), { action: 'equip', item: inMain })
  assert.deepEqual(P({ was: null, held: { name: 'leaf_litter', used: 0 }, hotbar: hb({ name: 'leaf_litter', used: 0 }, null) }), { action: 'select', index: 1 })
  assert.deepEqual(P({ was: null, held: { name: 'leaf_litter', used: 0 }, hotbar: hb(...Array(9).fill({ name: 'dirt', used: 0 })) }), { action: 'leave' })
  // harvest: never a compostable in hand at the ripe composter
  assert.deepEqual(P({ mode: 'harvest', was: null, held: { name: 'poppy', used: 0 }, hotbar: hb({ name: 'poppy', used: 0 }, pickA) }), { action: 'select', index: 2 }, 'an empty hand')
  const full = Array.from({ length: 9 }, (_, i) => (i === 4 ? pickA : { name: 'poppy', used: 0 }))
  assert.deepEqual(P({ mode: 'harvest', was: null, held: { name: 'poppy', used: 0 }, hotbar: full }), { action: 'select', index: 4 }, 'a tool')
  assert.deepEqual(P({ mode: 'harvest', was: pickA, held: { name: 'poppy', used: 0 }, hotbar: full }), { action: 'select', index: 4 }, 'the original tool')
})

// ---- #7 the composter is never dug by a path --------------------------------------------------------------------------
await t('#7 a dig-enabled movement profile refuses to break a composter (base, its clones, and the tunnel profile)', async () => {
  const { Movements } = require('mineflayer-pathfinder')
  const { tunnelMovements } = await import('../src/oretunnel.mjs')
  const STONE = REG.blocksByName.stone
  const fakeBot = { registry: REG, world: { getBlock: () => null }, entities: {}, version: '1.21.11',
                    blockAt: p => ({ name: 'stone', type: STONE.id, boundingBox: 'block', position: p }) }
  const composter = { type: REG.blocksByName.composter.id, position: new Vec3(500, 40, 500), name: 'composter' }
  const stone = { type: REG.blocksByName.stone.id, position: new Vec3(500, 40, 500), name: 'stone' }
  const base0 = C.protectTownBlocks(new Movements(fakeBot), REG)
  const dig = Object.assign(Object.create(Object.getPrototypeOf(base0)), base0)
  dig.canDig = true; dig.dontCreateFlow = false; dig.dontMineUnderFallingBlock = false
  assert.equal(dig.safeToBreak(stone), true, 'positive control: the profile digs stone')
  assert.equal(dig.safeToBreak(composter), false, 'a gather/ascent clone digs the composter')
  for (const m of [tunnelMovements(fakeBot, null), tunnelMovements(fakeBot, dig)]) {
    m.dontCreateFlow = false; m.dontMineUnderFallingBlock = false
    assert.equal(m.safeToBreak(stone), true); assert.equal(m.safeToBreak(composter), false, 'the tunnel profile digs the composter')
  }
})

await t('#7 index.mjs builds its base profile through protectTownBlocks BEFORE it is cloned (structural)', () => {
  const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const base1 = src.indexOf('const moves = protectTownBlocks(new Movements(bot), bot.registry)')
  assert.ok(base1 > 0, 'the base profile is not protected')
  assert.equal(src.split('protectTownBlocks(new Movements(bot)').length, 2, 'ambiguous')
  assert.ok(src.indexOf('Object.assign(gatherMoves, moves)') > base1, 'protected after the gather clone')
})

await t('the row: key=value, verified n, stop before items so truncation cannot cut the reason', () => {
  const d = C.compostDetail({ slotsBefore: 36, slotsAfter: 33, levelBefore: 0, levelAfter: 4, bonemeal: 1, items: { leaf_litter: 64, wheat_seeds: 3 }, stop: 'done' })
  assert.equal(d, 'slots=36->33 level=0->4 bonemeal=1 n=67 stop=done items=leaf_litter:64,wheat_seeds:3')
})

// ===================================================================================================================
// THE SKILLS, through the real registry and a fake bot
// ===================================================================================================================
const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')
const { evidenceScope } = await import('../src/cognitive.mjs')
const { config } = await import('../src/config.mjs')
const HOME = { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }
const FLOOR = HOME.y - 1   // the fake town is flat, its surface at home's y

/**
 * The fake bot. Inventory slots 9..44 like mineflayer's (hotbar 36..44), heldItem = the selected hotbar slot, equip()
 * SWAPS the item into the hotbar (moveSlotItem), crafted/collected output goes to a partial stack or the first empty
 * slot and is DROPPED when there is none (state.dropped) -- the overflow the build path must never cause.
 */
function fakeTown ({ items = [], hand = null, level = 0, composterAt = 'canonical', chests = [], botAt = null, rolls = () => 0.1,
                    dropFar = false, pickup = true } = {}) {
  const world = new Map()
  const key = p => `${p.x},${p.y},${p.z}`
  const state = { level, ripenAt: null, tick: 0, levels: [level], extracted: 0, pending: [], tossed: 0, dropped: [], clicksAt7: 0,
                  crafted: [], sneakWrites: 0, activations: 0 }
  const VANILLA = { leaf_litter: 0.3, wheat_seeds: 0.3, poppy: 0.65, short_grass: 0.3, apple: 0.65, oak_sapling: 0.3 }
  const nameAt = v => world.get(key(v)) ?? (v.y <= FLOOR ? 'grass_block' : 'air')
  const blockAt = p => {
    const v = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    const name = nameAt(v), def = REG.blocksByName[name]
    const b = { name, type: def.id, position: v, boundingBox: def.boundingBox, diggable: def.diggable, shapes: [] }
    if (name === 'composter') b.getProperties = () => ({ level: String(state.level) })
    return b
  }
  for (const c of chests) world.set(key(c), 'chest')
  const slots = new Array(46).fill(null)
  const mk = (name, count, extra = {}) => ({ name, type: REG.itemsByName[name].id, count, ...extra })
  let next = 9
  if (hand) { slots[36] = { ...hand, slot: 36 } }
  // Slot 36 (the selected hotbar slot) is the HAND: it holds `hand` or stays empty, so an empty hand really is empty.
  for (const x of items) { while (slots[next] || next === 36) next++; slots[next] = { ...x, slot: next } }
  const add = (name, n) => {
    while (n > 0) {
      const partial = slots.find((s, i) => i >= 9 && s && s.name === name && s.count < 64)
      if (partial) { const k = Math.min(64 - partial.count, n); partial.count += k; n -= k; continue }
      const order = [36, 37, 38, 39, 40, 41, 42, 43, 44, ...Array.from({ length: 27 }, (_, i) => 9 + i)]
      const empty = order.find(i => !slots[i])
      if (empty == null) { state.dropped.push(`${n}x ${name}`); return }   // mineflayer putAway with no room: tossed
      const k = Math.min(64, n); slots[empty] = mk(name, k, { slot: empty }); n -= k
    }
  }
  const take = (name, n) => {
    for (const s of slots.slice(9)) { if (!s || s.name !== name || n <= 0) continue; const k = Math.min(s.count, n); s.count -= k; n -= k; if (!s.count) slots[s.slot] = null }
    if (n > 0) throw new Error(`missing ${n}x ${name}`)
  }
  const count = name => slots.slice(9).reduce((a, s) => a + (s && s.name === name ? s.count : 0), 0)
  let lru = 0
  const bot = {
    username: 'b-Alpha', players: {}, entities: {}, quickBarSlot: 0, health: 20, food: 20,
    controlState: { sneak: false },
    entity: { position: botAt ?? new Vec3(HOME.x + 0.5, HOME.y, HOME.z + 2.5) },
    get heldItem () { return slots[36 + bot.quickBarSlot] ?? null },
    registry: REG,
    inventory: { slots, items: () => slots.slice(9, 45).filter(s => s && s.count > 0), count: id => slots.slice(9).reduce((a, s) => a + (s && s.type === id ? s.count : 0), 0) },
    setQuickBarSlot (n) { bot.quickBarSlot = n },
    setControlState (n, v) { if (n === 'sneak') { state.sneakWrites++; bot.controlState.sneak = v } },
    clearControlStates () {}, lookAt: async () => {},
    toss: async () => { state.tossed++ }, tossStack: async () => { state.tossed++ }, unequip: async () => { state.tossed++ },
    equip: async (item, dest) => {
      assert.equal(dest, 'hand')
      if (!item || slots[item.slot] !== item) throw new Error('not in inventory')
      if (item.slot >= 36) { bot.quickBarSlot = item.slot - 36; return }
      let d = [36, 37, 38, 39, 40, 41, 42, 43, 44].find(i => !slots[i]); if (d == null) { d = 36 + lru; lru = (lru + 1) % 9 }
      bot.quickBarSlot = d - 36
      const other = slots[d], from = item.slot
      slots[d] = item; item.slot = d; slots[from] = other; if (other) other.slot = from
    },
    blockAt,
    findBlock: ({ matching, maxDistance, point }) => bot.findBlocks({ matching, maxDistance, point, count: 1 })[0] ? blockAt(bot.findBlocks({ matching, maxDistance, point, count: 1 })[0]) : null,
    findBlocks: ({ matching, maxDistance, point, count: n = 1 }) => {
      const from = point ?? bot.entity.position
      return [...world.keys()].map(k => new Vec3(...k.split(',').map(Number)))
        .filter(v => v.distanceTo(from) <= maxDistance && matching(blockAt(v)))
        .sort((a, b) => a.distanceTo(from) - b.distanceTo(from)).slice(0, n)
    },
    nearestEntity: f => Object.values(bot.entities).find(f) ?? null,
    // A GoalNear of range >= 2 ends beside its target, not on it (as the pathfinder stops once inside the range).
    pathfinder: { setGoal () {}, stop () {}, goto: async goal => { const off = (goal.rangeSq ?? 0) >= 4 ? 2 : 0; bot.entity.position = new Vec3(Math.floor(goal.x) + off + 0.5, goal.y ?? bot.entity.position.y, Math.floor(goal.z) + 0.5) } },
    waitForTicks: async n => {
      for (let i = 0; i < n; i++) {
        state.tick++
        if (state.level === 7 && state.ripenAt != null && state.tick >= state.ripenAt) { state.level = 8; state.levels.push(8); state.ripenAt = null }
        for (const d of [...state.pending]) {
          if (!pickup || state.tick < d.at) continue
          if (d.entity.position.distanceTo(bot.entity.position) <= 1.5 && (bot.inventory.items().length < 36 || slots.some(s => s?.name === 'bone_meal' && s.count < 64))) {
            add('bone_meal', 1); state.pending.splice(state.pending.indexOf(d), 1); delete bot.entities[d.entity.id]
          }
        }
      }
    },
    activateBlock: async b => {
      state.activations++
      assert.equal(b.name, 'composter')
      assert.ok(bot.entity.position.distanceTo(b.position.offset(0.5, 0.5, 0.5)) <= 4.5, 'used from out of reach')
      const h = bot.heldItem
      if (h && VANILLA[h.name] != null && state.level < 8) {   // 1.21 ComposterBlock.useItemOn
        if (state.level === 7) { state.clicksAt7++; return }
        h.count--; if (!h.count) slots[h.slot] = null
        if (state.level === 0 || rolls() < VANILLA[h.name]) { state.level++; state.levels.push(state.level); if (state.level === 7) state.ripenAt = state.tick + 20 }
        return
      }
      if (state.level === 8) {
        state.level = 0; state.levels.push(0); state.extracted++
        const pos = dropFar ? b.position.offset(0.5, 1.01, 2.6) : b.position.offset(0.5, 1.01, 0.5)
        const entity = { id: 1000 + state.extracted, name: 'item', position: pos, getDroppedItem: () => ({ name: 'bone_meal' }) }
        bot.entities[entity.id] = entity; state.pending.push({ entity, at: state.tick + 10 })
      }
    },
    placeBlock: async (ref, face) => {
      const at = ref.position.plus(face); const h = bot.heldItem
      assert.ok(h, 'placing with an empty hand')
      h.count--; if (!h.count) slots[h.slot] = null
      world.set(key(at), h.name)
    },
    recipesFor: (id, meta, min = 1, table) => Recipe.find(id, meta).filter(r => (!r.requiresTable || table) &&
      r.delta.every(d => bot.inventory.count(d.id) + d.count * Math.ceil(min / r.result.count) >= 0)),
    recipesAll: (id, meta, table) => Recipe.find(id, meta).filter(r => !r.requiresTable || table),
    craft: async (recipe, n = 1, table) => {
      if (recipe.requiresTable) assert.ok(table, 'a table recipe crafted without a table')
      for (let i = 0; i < n; i++) {
        for (const d of recipe.delta) if (d.count < 0) take(REG.items[d.id].name, -d.count)
        add(REG.items[recipe.result.id].name, recipe.result.count)
        state.crafted.push(REG.items[recipe.result.id].name)
        state.onCraft?.(REG.items[recipe.result.id].name)
      }
    },
  }
  // Falls back to a fixed cell only so the composting tests can run against a build that has no canonical site.
  const site = C.canonicalComposterSite?.({ home: HOME, read: (x, y, z) => { const b = blockAt(new Vec3(x, y, z)); return { name: b.name, boundingBox: b.boundingBox } } })?.site ??
    { x: HOME.x + 5, y: HOME.y, z: HOME.z + 5 }
  if (composterAt === 'canonical' && site) world.set(key(site), 'composter')
  else if (composterAt && composterAt !== 'canonical') world.set(key(composterAt), 'composter')
  return { bot, state, world, site, count, slots, key }
}
const PICK = { name: 'stone_pickaxe', type: REG.itemsByName.stone_pickaxe.id, count: 1, maxDurability: 131, durabilityUsed: 30 }
const S = (name, count) => ({ name, type: REG.itemsByName[name].id, count })
const filler = n => Array.from({ length: n }, () => S('cobblestone', 64))
const composters = world => [...world].filter(([, n]) => n === 'composter').map(([k]) => k)
const rows = async kind => {
  await new Promise(r => setTimeout(r, 150))
  try { return readFileSync(`${LOG_DIR}/skill-TestBot.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] }
}
const run = (name, bot, signal = { aborted: false }) => within(SKILLS[name].run({ bot }, {}, signal), 8000, name)

await t('both skills are registered, chatOnly, with contracts', () => {
  assert.ok(SKILLS.compost?.run); assert.equal(SKILLS.compost.chatOnly, true)
  assert.deepEqual(SKILL_CONTRACTS.compost.expects, ['inventory_loss'])
  assert.ok(SKILLS.build_composter?.run); assert.equal(SKILLS.build_composter.chatOnly, true)
  assert.deepEqual(SKILL_CONTRACTS.build_composter.expects, ['world_change'])
})

await t('WIRED compost: levels cycle 0..8, every insert verified, bone meal confirmed, hand restored, keepers untouched, nothing tossed', async () => {
  let n = 0
  const { bot, state, count } = fakeTown({ hand: PICK, rolls: () => (n++ % 3 === 0 ? 0.1 : 0.9),
    items: [S('leaf_litter', 64), S('leaf_litter', 6), S('wheat_seeds', 10), S('apple', 5), S('oak_sapling', 12), S('egg', 3), ...filler(29)] })
  const r = await run('compost', bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count('leaf_litter'), 0); assert.equal(count('wheat_seeds'), 0)
  assert.equal(count('apple'), 5); assert.equal(count('oak_sapling'), 12); assert.equal(count('egg'), 3)
  assert.ok(state.levels.includes(8)); assert.equal(state.clicksAt7, 0)
  assert.equal(count('bone_meal'), state.extracted); assert.ok(state.extracted >= 1)
  assert.equal(bot.heldItem?.name, 'stone_pickaxe'); assert.equal(bot.heldItem?.durabilityUsed, 30)
  assert.equal(state.tossed, 0); assert.deepEqual(state.dropped, [])
  const row = (await rows('_compost')).at(-1)
  assert.match(row?.skill?.detail ?? '', /^slots=36->3[0-5] level=0->\d bonemeal=\d+ n=80 stop=done items=/)
})

await t('#2 compost uses the composter around HOME, never one that is merely near the bot', async () => {
  const far = new Vec3(HOME.x + 70, HOME.y, HOME.z)
  // One slot free, so a fill WOULD start at any composter the search returned.
  const { bot, state } = fakeTown({ hand: PICK, composterAt: far, botAt: new Vec3(HOME.x + 40.5, HOME.y, HOME.z + 0.5), items: [S('leaf_litter', 20), ...filler(33)] })
  const r = await run('compost', bot)
  assert.equal(state.activations, 0, 'used a composter 70 blocks from home')
  assert.equal(r.status, 'no_effect', r.detail)
})

await t('#3 a FULL bag whose smallest compostable stack cannot empty before level 7 does not start a fill -- no penalty', async () => {
  const { bot, state, count } = fakeTown({ hand: PICK, items: [S('leaf_litter', 64), S('leaf_litter', 64), S('wheat_seeds', 64), ...filler(32)] })
  const r = await run('compost', bot)
  assert.equal(state.activations, 0, 'started a fill it could not finish')
  assert.equal(r.status, 'no_effect', r.detail); assert.equal(count('leaf_litter'), 128)
})

await t('#3 a FULL bag with a small stack starts with THAT stack, frees its slot, and then can harvest', async () => {
  const { bot, state, count } = fakeTown({ hand: PICK, rolls: () => 0.1, items: [S('leaf_litter', 64), S('poppy', 3), ...filler(33)] })
  const r = await run('compost', bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count('poppy'), 0, 'the small stack went first')
  assert.ok(state.extracted >= 1 && count('bone_meal') === state.extracted)
  assert.deepEqual(state.dropped, [])
})

await t('#3 a ripe composter and no room: skipped with no penalty, nothing extracted onto the ground', async () => {
  const { bot, state } = fakeTown({ hand: PICK, level: 8, items: [S('leaf_litter', 64), ...filler(34)] })
  const r = await run('compost', bot)
  assert.equal(r.status, 'no_effect', r.detail); assert.equal(state.extracted, 0)
  assert.equal(bot.heldItem?.name, 'stone_pickaxe')
})

await t('#6 an extraction whose bone meal is never confirmed in the bag stops extracting and says so (non-voting)', async () => {
  const { bot, state } = fakeTown({ hand: PICK, rolls: () => 0.1, pickup: false, items: [S('leaf_litter', 64), S('leaf_litter', 64), ...filler(30)] })
  const r = await run('compost', bot)
  assert.equal(state.extracted, 1, `extracted ${state.extracted} with none collected`)
  assert.match(r.detail, /bone meal/)
  assert.equal(evidenceScope(r.failClass ?? 'none'), null)
})

await t('#4 an unreachable composter is not `no_path` -- the skill the model cannot choose gets no avoid vote', async () => {
  const { bot } = fakeTown({ hand: PICK, botAt: new Vec3(HOME.x + 30.5, HOME.y, HOME.z + 30.5), items: [S('leaf_litter', 20), ...filler(34)] })
  bot.pathfinder.goto = async () => { throw new Error('No path to the goal!') }
  const r = await run('compost', bot)
  assert.equal(r.status, 'failed')
  assert.equal(evidenceScope(r.failClass), null, `failClass ${r.failClass} votes`)
})

await t('#5 an EMPTY hand is not left holding junk: the original empty slot holds leaf_litter now, so another empty slot is chosen', async () => {
  const { bot, state } = fakeTown({ hand: null, rolls: () => 0.9, items: [S('leaf_litter', 64), S('leaf_litter', 64), S('leaf_litter', 64), ...filler(30)] })
  const r = await run('compost', bot)
  assert.ok(state.activations > 0, r.detail)
  assert.equal(bot.heldItem, null, `holding ${bot.heldItem?.name}`)
})

await t('#10 another subsystem\'s sneak is not overridden: the visit is skipped, the control untouched', async () => {
  const { bot, state } = fakeTown({ hand: PICK, items: [S('leaf_litter', 20), ...filler(33)] })   // room: only the sneak stops it
  bot.controlState.sneak = true
  const r = await run('compost', bot)
  assert.equal(state.sneakWrites, 0); assert.equal(bot.controlState.sneak, true)
  assert.equal(r.status, 'no_effect'); assert.equal(state.activations, 0)
})

await t('#9 a hung equip cannot stall the visit; the hand is still restored', async () => {
  const { bot } = fakeTown({ hand: PICK, items: [S('leaf_litter', 20), ...filler(33)] })   // one slot free: a fill can start
  const real = bot.equip
  let hung = 0
  bot.equip = (item, d) => (item.name === 'leaf_litter' && !hung++ ? new Promise(() => {}) : real(item, d))
  const t0 = Date.now()
  const r = await within(SKILLS.compost.run({ bot }, {}, { aborted: false }), 6000, 'compost with a hung equip')
  assert.ok(Date.now() - t0 < 6000); assert.equal(hung, 1, 'the hung equip was never reached'); assert.ok(r.status)
  assert.equal(bot.heldItem?.name, 'stone_pickaxe')
})

await t('#9 an abort while an await hangs ends the visit promptly with Aborted, and the hand is restored', async () => {
  const { bot } = fakeTown({ hand: PICK, items: [S('leaf_litter', 20), ...filler(33)] })
  bot.activateBlock = () => new Promise(() => {})
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 100)
  const err = await within(SKILLS.compost.run({ bot }, {}, ac.signal).then(r => r, e => e), 3000, 'aborted compost')
  assert.ok(err?.aborted, `not aborted: ${JSON.stringify(err)}`)
  assert.equal(bot.heldItem?.name, 'stone_pickaxe')
})

// ---- building -----------------------------------------------------------------------------------------------------------
await t('#1 WIRED build: 3 logs, no table, room for the chain -> exactly one composter at the CANONICAL site, nothing dropped', async () => {
  const { bot, state, world, site, count } = fakeTown({ hand: PICK, composterAt: null, items: [S('oak_log', 3), ...filler(10)] })
  assert.ok(site)
  const r = await run('build_composter', bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(r.placed, 1)
  assert.deepEqual(composters(world), [`${site.x},${site.y},${site.z}`])
  assert.deepEqual(state.dropped, [], 'crafted output overflowed the bag')
  assert.equal(count('composter'), 0)
  assert.equal(bot.heldItem?.name, 'stone_pickaxe', 'the hand is restored around the WHOLE build')
  const built = (await rows('_composter_built')).at(-1)
  assert.match(built?.skill?.detail ?? '', new RegExp(`^at=${site.x},${site.y},${site.z} wood=oak`))
})

await t('#1 WIRED build: a bag without room for the worst case of the chain crafts NOTHING (no penalty)', async () => {
  const { bot, state, world } = fakeTown({ hand: PICK, composterAt: null, items: [S('oak_log', 3), ...filler(32)] })   // 34 used, 2 free < 4
  const r = await run('build_composter', bot)
  assert.equal(r.status, 'no_effect', r.detail)
  assert.deepEqual(state.crafted, []); assert.deepEqual(state.dropped, []); assert.deepEqual(composters(world), [])
})

await t('#2 the same build from a different standing spot lands on the same cell', async () => {
  const a = fakeTown({ hand: PICK, composterAt: null, botAt: new Vec3(HOME.x - 9.5, HOME.y, HOME.z + 6.5), items: [S('oak_log', 3)] })
  await run('build_composter', a.bot)
  assert.deepEqual(composters(a.world), [`${a.site.x},${a.site.y},${a.site.z}`])
})

await t('#2 a bot that loses the race crafts no composter: the re-check runs right before that craft', async () => {
  const town = fakeTown({ hand: PICK, composterAt: null, items: [S('oak_log', 3)] })
  town.state.onCraft = name => { if (name === 'oak_slab') town.world.set(town.key(new Vec3(HOME.x - 6, HOME.y, HOME.z - 6)), 'composter') }
  const r = await run('build_composter', town.bot)
  assert.equal(town.count('composter'), 0, 'kept a composter it can never place')
  assert.ok(!town.state.crafted.includes('composter'))
  assert.equal(composters(town.world).length, 1); assert.equal(r.status, 'no_effect')
})

await t('#8 a container that appears beside the site during the build is seen immediately before placing', async () => {
  const town = fakeTown({ hand: PICK, composterAt: null, items: [S('oak_log', 3)] })
  town.state.onCraft = name => { if (name === 'composter') town.world.set(town.key(new Vec3(town.site.x + 1, town.site.y, town.site.z + 1)), 'barrel') }
  const r = await run('build_composter', town.bot)
  assert.deepEqual(composters(town.world), [], 'placed beside a barrel')
  assert.notEqual(r.status, 'success')
  assert.equal(evidenceScope(r.failClass ?? 'none'), null)
})

await t('#1 build: no composter and too little wood -> nothing crafted, a refusal that names the gather', async () => {
  const { bot, state } = fakeTown({ hand: PICK, composterAt: null, items: [S('oak_log', 2)] })
  const r = await run('build_composter', bot)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /gather 3 logs/); assert.deepEqual(state.crafted, [])
})

// ---- mutants, in-file (withMutant from climb-escape.test.mjs). Suite-level reds are shown in the commit message. ----
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const CP = new URL('../src/composter.mjs', import.meta.url)
await t('MUTANT: dropping the compostability allowlist feeds eggs to the composter', async () => {
  await withMutant(CP, '&& Object.hasOwn(COMPOST_CHANCE, name) &&', '&&', async m => assert.ok(m.isCompostJunk('egg'), 'mutant inert'))
})
await t('MUTANT: dropping the free-slot check crafts into a full bag', async () => {
  await withMutant(CP, 'if (freeSlots < plan.slotsNeeded) return none()', 'if (false) return none()', async m => {
    const plan = { wood: 'oak', slotsNeeded: 4 }
    assert.equal(m.townOrder({ ...base, composterAtTown: false, buildPlan: plan, slots: 34, freeSlots: 2, junk: 0 }).order?.skill, 'build_composter', 'mutant inert')
  })
})

try { rmSync(LOG_DIR, { recursive: true, force: true }) } catch {}
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) console.log(`FAILED: ${failed.join(' | ')}`)
process.exit(fail ? 1 : 0)
