// INVENTORY HYGIENE, PHASE 2: the town composter. The measurement and the design are in src/composter.mjs.
//
// Behaviour only. Pure decisions through their exported functions (the scheduler included -- no source text), then
// the real skills through a fake bot whose inventory follows mineflayer's rules (equip SWAPS into the hotbar, crafted
// output that has no slot is DROPPED, as inventory.js putAway does), a fake crafting system built on the same
// prismarine-recipe tables mineflayer uses, and a fake composter that follows the vanilla rules (consume at 0-6,
// ripen 7->8 after 20 ticks, a use at 8 pops one bone meal on top with a 10-tick pickup delay).
import assert from 'node:assert/strict'
import fsMod, { readFileSync, writeFileSync, unlinkSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
const { SKILLS, SKILL_CONTRACTS, HOUSEKEEPING_BOUNDS } = await import('../src/skills.mjs')
// The per-await bounds scale with SKILL_TIMEOUT_MS; deadlines below are derived from them, so a direct run passes too.
const BOUNDS = HOUSEKEEPING_BOUNDS ?? { awaitMs: 200, settleMs: 500 }
const HUNG_MS = BOUNDS.awaitMs + 2 * BOUNDS.settleMs + 1500
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
                    dropFar = false, pickup = true, storeDir = null, blocks = {}, unloaded = [], worldId = undefined } = {}) {
  // Each town its own pool state dir unless two bots are meant to share one.
  process.env.POOL_STATE_DIR = storeDir ?? mkdtempSync(path.join(tmpdir(), 'composter-store-'))
  const world = new Map(Object.entries(blocks))
  const key = p => `${p.x},${p.y},${p.z}`
  const state = { level, ripenAt: null, tick: 0, levels: [level], extracted: 0, pending: [], tossed: 0, dropped: [], clicksAt7: 0,
                  crafted: [], sneakWrites: 0, activations: 0, path: [], halts: 0, gotos: 0, tableUses: [], events: [], selects: [], equips: [] }
  const VANILLA = { leaf_litter: 0.3, wheat_seeds: 0.3, poppy: 0.65, short_grass: 0.3, apple: 0.65, oak_sapling: 0.3 }
  const nameAt = v => world.get(key(v)) ?? (v.y <= FLOOR ? 'grass_block' : 'air')
  const gone = new Set(unloaded)   // cells in a chunk this bot has not loaded: blockAt answers null
  const blockAt = p => {
    const v = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    if (gone.has(key(v))) return null
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
    worldId,
    setQuickBarSlot (n) { state.selects.push({ n, t: Date.now() }); bot.quickBarSlot = n },
    setControlState (n, v) { if (n === 'sneak') { state.sneakWrites++; bot.controlState.sneak = v } },
    clearControlStates () {}, lookAt: async () => {},
    toss: async () => { state.tossed++ }, tossStack: async () => { state.tossed++ }, unequip: async () => { state.tossed++ },
    equip: async (item, dest) => {
      state.equips.push({ name: item?.name, t: Date.now() })
      const wait = state.equipDelay?.(item) ?? 0
      if (wait) await new Promise(r => setTimeout(r, wait))
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
      if (point) state.events.push('scan')
      const from = point ?? bot.entity.position
      return [...world.keys()].map(k => new Vec3(...k.split(',').map(Number)))
        .filter(v => v.distanceTo(from) <= maxDistance && matching(blockAt(v)))
        .sort((a, b) => a.distanceTo(from) - b.distanceTo(from)).slice(0, n)
    },
    nearestEntity: f => Object.values(bot.entities).find(f) ?? null,
    // A GoalNear of range >= 2 ends beside its target, not on it (as the pathfinder stops once inside the range).
    // A goal already satisfied does not move the bot; otherwise it lands on the goal cell, or BESIDE it for a
    // GoalNear of range >= 2 (the pathfinder stops once inside the range). Every position is recorded.
    pathfinder: {
      setGoal (g) { if (g === null) state.halts++ }, stop () {},
      goto: async goal => {
        state.gotos++; state.events.push('goto')
        const here = bot.entity.position.floored()
        if (!goal.isEnd?.(here)) {
          const off = (goal.rangeSq ?? 0) >= 4 ? 2 : 0
          bot.entity.position = new Vec3(Math.floor(goal.x) + off + 0.5, goal.y ?? bot.entity.position.y, Math.floor(goal.z) + 0.5)
        }
        state.path.push(bot.entity.position.clone())
        await state.onGoto?.(goal)
      },
    },
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
      world.set(key(at), h.name); state.events.push(`place:${h.name}`)
    },
    recipesFor: (id, meta, min = 1, table) => Recipe.find(id, meta).filter(r => (!r.requiresTable || table) &&
      r.delta.every(d => bot.inventory.count(d.id) + d.count * Math.ceil(min / r.result.count) >= 0)),
    recipesAll: (id, meta, table) => Recipe.find(id, meta).filter(r => !r.requiresTable || table),
    craft: async (recipe, n = 1, table) => {
      if (recipe.requiresTable) {
        assert.ok(table, 'a table recipe crafted without a table')
        assert.equal(nameAt(table.position), 'crafting_table', 'crafted at a block that is not a table')
        assert.ok(bot.entity.position.distanceTo(table.position.offset(0.5, 0.5, 0.5)) <= 4.5, 'crafted at a table out of reach')
        state.tableUses.push(table.position.clone())
      }
      const once = () => {
        for (const d of recipe.delta) if (d.count < 0) take(REG.items[d.id].name, -d.count)
        add(REG.items[recipe.result.id].name, recipe.result.count)
        state.crafted.push(REG.items[recipe.result.id].name)
      }
      // THE SERVER'S SLOT UPDATES CAN ARRIVE AFTER bot.craft RESOLVES (sandbox, Paper 1.21.8): with invDelay set,
      // the inventory changes land 100-500 ms later, as they did there.
      if (state.invDelay) {
        const ms = state.invDelay()
        setTimeout(() => { try { for (let i = 0; i < n; i++) once() } catch (e) { state.craftErrors = [...(state.craftErrors ?? []), e.message] } }, ms)
        return
      }
      for (let i = 0; i < n; i++) {
        once()
        await state.onCraft?.(REG.items[recipe.result.id].name)
      }
    },
  }
  // Falls back to a fixed cell only so the composting tests can run against a build that has no canonical site.
  const site = C.canonicalComposterSite?.({ home: HOME, read: (x, y, z) => { const b = blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox } : null } })?.site ??
    { x: HOME.x + 5, y: HOME.y, z: HOME.z + 5 }
  if (composterAt === 'canonical' && site) world.set(key(site), 'composter')
  else if (composterAt && composterAt !== 'canonical') world.set(key(composterAt), 'composter')
  return { bot, state, world, site, count, slots, key, add }
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
  assert.deepEqual(SKILL_CONTRACTS.compost.expects, ['compost_effect'])
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

await t('#9 a hung equip cannot stall the visit; the hand it never took is untouched', async () => {
  const { bot } = fakeTown({ hand: PICK, items: [S('leaf_litter', 20), ...filler(33)] })   // one slot free: a fill can start
  const real = bot.equip
  let hung = 0
  bot.equip = (item, d) => (item.name === 'leaf_litter' && !hung++ ? new Promise(() => {}) : real(item, d))
  const t0 = Date.now()
  const r = await within(SKILLS.compost.run({ bot }, {}, { aborted: false }), HUNG_MS, 'compost with a hung equip')
  assert.ok(Date.now() - t0 < HUNG_MS); assert.equal(hung, 1, 'the hung equip was never reached'); assert.ok(r.status)
  assert.equal(bot.heldItem?.name, 'stone_pickaxe')
})

await t('#9 an abort while a use is in flight ends the visit with Aborted; once the use settles the hand is restored', async () => {
  const { bot } = fakeTown({ hand: PICK, items: [S('leaf_litter', 20), ...filler(33)] })
  bot.activateBlock = () => new Promise(res => setTimeout(res, 300))   // lands inside the settle window
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 100)
  const err = await within(SKILLS.compost.run({ bot }, {}, ac.signal).then(r => r, e => e), HUNG_MS, 'aborted compost')
  assert.ok(err?.aborted, `not aborted: ${JSON.stringify(err)}`)
  assert.equal(bot.heldItem?.name, 'stone_pickaxe')
})

await t('#9 an abort while a use NEVER settles: Aborted, logged unsettled, and the hand is left alone', async () => {
  const { bot, state } = fakeTown({ hand: PICK, items: [S('leaf_litter', 20), ...filler(33)] })
  bot.activateBlock = () => new Promise(() => {})
  const ac = new AbortController()
  const t0 = Date.now()
  setTimeout(() => ac.abort(), 100)
  const err = await within(SKILLS.compost.run({ bot }, {}, ac.signal).then(r => r, e => e), HUNG_MS, 'aborted compost')
  assert.ok(err?.aborted, `not aborted: ${JSON.stringify(err)}`)
  assert.deepEqual(state.selects.filter(x => x.t >= t0 + 100), [], 'restored while the use was still in flight')
  assert.match((await rows('_housekeeping_unsettled')).at(-1)?.skill?.detail ?? '', /^compost: 1 operation/)
})

await t('#1 WIRED build: 3 logs, no table, room for the chain -> exactly one composter at the CANONICAL site, nothing dropped', async () => {
  const { bot, state, world, site, count } = fakeTown({ hand: PICK, composterAt: null, items: [S('oak_log', 3), ...filler(10)] })
  assert.ok(site)
  const r = await run('build_composter', bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(r.placed, 1)
  assert.deepEqual(composters(world), [`${site.x},${site.y},${site.z}`])
  assert.deepEqual(state.dropped, [], 'crafted output overflowed the bag')
  assert.equal(count('composter'), 0)
  assert.equal(bot.heldItem?.name, 'stone_pickaxe', 'the hand is restored around the WHOLE build')
  // P2#2: the town is re-scanned AFTER the last movement and before the composter goes down.
  const ev = state.events, placeAt = ev.indexOf('place:composter')
  assert.ok(placeAt > 0 && ev.lastIndexOf('scan', placeAt) > ev.lastIndexOf('goto', placeAt), `order: ${ev.join(',')}`)
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

// ===================================================================================================================
// SECOND REVIEW PASS (9a859c5)
// ===================================================================================================================
const STONE_B = { name: 'stone', boundingBox: 'block' }
const firstSite = () => C.canonicalComposterSite({ home: HOME0, read: flat() }).site

await t('P2#1 a ONE-WIDE COLUMN top is never the site: a pillar standing on the first spiral cell is passed over', () => {
  const s0 = firstSite()
  const pillar = {}
  for (let y = 64; y <= 66; y++) pillar[`${s0.x},${y},${s0.z}`] = STONE_B
  const read = flat(pillar)
  const top = { x: s0.x, y: 67, z: s0.z }
  assert.ok(C.siteRefusal(read, top, HOME0), 'the pillar top is accepted')
  const r = C.canonicalComposterSite({ home: HOME0, read })
  assert.ok(r.site, r.why); assert.notDeepEqual(r.site, top); assert.equal(r.site.y, 64)
})

await t('P2#1 a WALL TOP (one wide along one axis) is never the site', () => {
  const s0 = firstSite()
  const wall = {}
  for (let dx = -6; dx <= 6; dx++) for (let y = 64; y <= 66; y++) wall[`${s0.x + dx},${y},${s0.z}`] = STONE_B
  const read = flat(wall)
  assert.ok(C.siteRefusal(read, { x: s0.x, y: 67, z: s0.z }, HOME0), 'a cell on top of a one-wide wall is accepted')
})

await t('P2#1 the one-wide floor rule stands on its own: a one-wide strip between two drops is refused even with a cell to stand beside it', () => {
  // The site's floor has air on BOTH x sides (two one-block drops), so it is one wide along x; the +z neighbour is
  // ordinary ground, so the standing-cell rule alone would accept it.
  const s0 = { x: 6, y: 64, z: 0 }
  const b = { '5,63,0': AIR, '7,63,0': AIR, '5,62,0': AIR, '7,62,0': AIR }
  const read = flat(b)
  assert.ok(C.standableBeside(read, s0), 'test setup: there must be a standing cell')
  assert.equal(C.siteRefusal(read, s0, HOME0), 'one-wide column top')
})

await t('P2#1 the site needs a STANDABLE cell beside it at its own level (air at feet and head over a solid floor)', () => {
  const s = { x: 5, y: 64, z: 0 }
  const roofed = {}
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) roofed[`${5 + dx},65,${dz}`] = STONE_B   // no headroom anywhere beside it
  assert.ok(C.siteRefusal(flat(roofed), s, HOME0), 'no headroom beside it: nobody can stand there to use it')
  assert.equal(C.siteRefusal(flat(), s, HOME0), null)
  const stand = C.standableBeside(flat(), s)
  assert.ok(stand && stand.y === 64 && Math.abs(stand.x - 5) + Math.abs(stand.z) === 1)
})

const storeKey = () => `composter-site-${config.world.homeX}_${config.world.homeY}_${config.world.homeZ}`
await t('P2#2 first writer wins a generation: a second writer of the SAME generation loses and the record does not move', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'composter-claim-'))
  assert.deepEqual(C.readTownSite(dir, 'k'), { gen: 0, site: null, world: null, malformed: false })
  assert.equal(C.createSiteGen(dir, 'k', 1, { x: 1, y: 64, z: 1 }, 'w'), true)
  assert.equal(C.createSiteGen(dir, 'k', 1, { x: 2, y: 64, z: 2 }, 'w'), false, 'the second writer also won')
  assert.deepEqual(C.readTownSite(dir, 'k').site, { x: 1, y: 64, z: 1 }, 'the second writer moved the site')
  assert.equal(C.createSiteGen(dir, 'k', 2, { x: 3, y: 64, z: 3 }, 'w'), true)
  assert.deepEqual(C.readTownSite(dir, 'k'), { gen: 2, site: { x: 3, y: 64, z: 3 }, world: 'w', malformed: false })
})

await t('P2#2 an earlier spiral cell that becomes valid later does NOT move the town\'s site', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'composter-shared-'))
  const c0 = C.canonicalComposterSite({ home: HOME, read: (x, y, z) => (y <= FLOOR ? GRASS : AIR) }).site
  // Bot A sees the first spiral cell blocked (a sapling, say), so it records the NEXT one.
  const a = fakeTown({ hand: PICK, composterAt: null, storeDir, items: [S('oak_log', 3)], blocks: { [`${c0.x},${c0.y},${c0.z}`]: 'oak_sapling' } })
  const ra = SKILLS && (await import('../src/skills.mjs')).townComposterSite(a.bot)
  assert.ok(ra.site && !(ra.site.x === c0.x && ra.site.z === c0.z), JSON.stringify(ra))
  // Bot B arrives after the sapling is gone: its own spiral says c0, the town's record says A's cell.
  const b = fakeTown({ hand: PICK, composterAt: null, storeDir, items: [S('oak_log', 3)] })
  const rb = await run('build_composter', b.bot)
  assert.equal(rb.status, 'success', rb.detail)
  assert.deepEqual(composters(b.world), [`${ra.site.x},${ra.site.y},${ra.site.z}`], 'B built on its own spiral answer')
})

await t('P2#2 a composter that appears elsewhere in town DURING the approach wins: nothing is placed', async () => {
  const town = fakeTown({ hand: PICK, composterAt: null, botAt: new Vec3(HOME.x - 20.5, HOME.y, HOME.z + 0.5), items: [S('composter', 1)] })
  town.state.onGoto = () => { town.world.set(town.key(new Vec3(HOME.x - 4, HOME.y, HOME.z - 5)), 'composter') }
  const r = await run('build_composter', town.bot)
  assert.equal(composters(town.world).length, 1, `placed a second composter: ${composters(town.world)}`)
  assert.equal(r.status, 'no_effect')
})

await t('P2#3 an equip that completes AFTER the abort cannot overwrite the restored hand (outstanding ops settle first)', async () => {
  const { bot, slots } = fakeTown({ hand: PICK, items: [S('leaf_litter', 20), ...filler(33)] })
  const real = bot.equip
  bot.equip = (item, d) => (item.name === 'leaf_litter' ? new Promise(res => setTimeout(() => res(real(item, d)), 300)) : real(item, d))
  const ac = new AbortController(); setTimeout(() => ac.abort(), 100)
  const err = await within(SKILLS.compost.run({ bot }, {}, ac.signal).then(r => r, e => e), 4000, 'aborted compost')
  assert.ok(err?.aborted, JSON.stringify(err))
  await new Promise(r => setTimeout(r, 400))   // anything still outstanding has had time to land
  assert.equal(bot.heldItem?.name, 'stone_pickaxe', `the late equip left ${bot.heldItem?.name} in hand`)
  assert.ok(slots.some(s => s?.name === 'leaf_litter'))
})

await t('P2#3 an equip that completes after its TIMEOUT is waited for before the hand is restored', async () => {
  const { bot } = fakeTown({ hand: PICK, items: [S('leaf_litter', 20), ...filler(33)] })
  const real = bot.equip
  let late = 0
  bot.equip = (item, d) => (item.name === 'leaf_litter' && !late++ ? new Promise(res => setTimeout(() => res(real(item, d)), BOUNDS.awaitMs + 150)) : real(item, d))
  await within(SKILLS.compost.run({ bot }, {}, { aborted: false }), 8000, 'compost')
  await new Promise(r => setTimeout(r, BOUNDS.awaitMs + 300))
  assert.equal(bot.heldItem?.name, 'stone_pickaxe', `the late equip left ${bot.heldItem?.name} in hand`)
})

await t('P2#3 an abort during a walk STOPS the pathfinder', async () => {
  const { bot, state } = fakeTown({ hand: PICK, botAt: new Vec3(HOME.x + 30.5, HOME.y, HOME.z + 30.5), items: [S('leaf_litter', 20), ...filler(33)] })
  bot.pathfinder.goto = () => new Promise(() => {})
  const ac = new AbortController(); setTimeout(() => ac.abort(), 100)
  const err = await within(SKILLS.compost.run({ bot }, {}, ac.signal).then(r => r, e => e), HUNG_MS, 'aborted walk')
  assert.ok(err?.aborted); assert.ok(state.halts >= 1, 'the pathfinder was left walking')
})

await t('P2#4 the table is resolved AT the site: a table 20 blocks off is never walked to; one is made beside the site', async () => {
  const town = fakeTown({ hand: PICK, composterAt: null, items: [S('oak_log', 3)],
                          blocks: { [`${HOME.x + 20},${HOME.y},${HOME.z + 20}`]: 'crafting_table' } })
  const r = await run('build_composter', town.bot)
  assert.equal(r.status, 'success', r.detail)
  const far = new Vec3(HOME.x + 20, HOME.y, HOME.z + 20)
  assert.ok(town.state.tableUses.length > 0)
  assert.ok(town.state.tableUses.every(p => !p.equals(far)), 'crafted at the far table')
  assert.ok(town.state.path.every(p => p.distanceTo(far) > 6), 'walked to the far table')
  const tables = [...town.world].filter(([, n]) => n === 'crafting_table').map(([k]) => new Vec3(...k.split(',').map(Number)))
  const mine = tables.find(p => !p.equals(far))
  assert.ok(mine, 'no table was made')
  assert.ok(Math.max(Math.abs(mine.x - town.site.x), Math.abs(mine.z - town.site.z)) >= 2, `table at ${mine} is on or beside the site ${JSON.stringify(town.site)}`)
  assert.deepEqual(town.state.dropped, [])
})

await t('P2#4 ingredients and free slots are re-validated AT the site: a bag that filled on the walk crafts nothing', async () => {
  const town = fakeTown({ hand: PICK, composterAt: null, botAt: new Vec3(HOME.x - 20.5, HOME.y, HOME.z + 0.5), items: [S('oak_log', 3), ...filler(28)] })
  town.state.onGoto = () => { for (let i = 0; i < 4; i++) town.add(`dirt`, 64) }   // auto-pickup on the way: 32 -> 36 used
  const r = await run('build_composter', town.bot)
  assert.deepEqual(town.state.crafted, [], 'crafted into a bag with no room for the chain')
  assert.deepEqual(town.state.dropped, []); assert.equal(r.status, 'no_effect')
})

await t('P2#4 the plan budgets a table unless one is CARRIED (a placed table may not be reachable from the site)', () => {
  assert.equal(C.composterBuildPlan({ oak_log: 2 }), null)
  assert.equal(C.composterBuildPlan({ oak_log: 3 }).needTable, true)
  slotN = 9
  assert.equal(C.townPlanTableAvailable([it('crafting_table', 1)]), true)
  assert.equal(C.townPlanTableAvailable([it('oak_log', 3)]), false)
})

await t('P2#5 a composter beyond 16 of home (a village\'s) is not adopted', async () => {
  const { bot, state } = fakeTown({ hand: PICK, composterAt: new Vec3(HOME.x + 30, HOME.y, HOME.z), botAt: new Vec3(HOME.x + 28.5, HOME.y, HOME.z + 0.5), items: [S('leaf_litter', 20), ...filler(33)] })
  const r = await run('compost', bot)
  assert.equal(state.activations, 0, 'used a composter 30 blocks from home'); assert.equal(r.status, 'no_effect')
})

await t('P2#5 place()\'s make-room dig never takes a composter', async () => {
  const dug = []
  const STN = REG.blocksByName
  const at = new Map([['1,64,0', 'composter'], ['-1,64,0', 'bedrock'], ['0,64,1', 'bedrock'], ['0,64,-1', 'bedrock']])
  const bot = {
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true }, registry: REG,
    inventory: { items: () => [{ name: 'crafting_table', count: 1, type: REG.itemsByName.crafting_table.id, slot: 36 }] },
    blockAt: p => { const n = at.get(`${p.x},${p.y},${p.z}`) ?? (p.y === 64 && p.x === 0 && p.z === 0 ? 'air' : p.y === 65 && p.x === 0 && p.z === 0 ? 'air' : 'stone')
      return { name: n, type: STN[n].id, boundingBox: STN[n].boundingBox, diggable: STN[n].diggable, position: p } },
    dig: async b => { dug.push(b.name) }, stopDigging () {}, equip: async () => {}, lookAt: async () => {}, placeBlock: async () => {},
    pathfinder: { setGoal () {} },
  }
  await within(SKILLS.place.run({ bot }, { item: 'crafting_table' }, { aborted: false }), 4000, 'place')
  assert.ok(!dug.includes('composter'), `dug: ${dug}`)
})

await t('P2#5 any bot at town with ROOM empties a ripe composter, not only a 34-slot one', async () => {
  const o = C.townOrder({ ...base, slots: 10, freeSlots: 26, junk: 0, room: true, composterRipe: true })
  assert.equal(o.order?.skill, 'compost')
  assert.equal(C.townOrder({ ...base, slots: 10, freeSlots: 26, junk: 0, room: true, composterRipe: false }).order, null)
  assert.equal(C.townOrder({ ...base, slots: 36, freeSlots: 0, junk: 0, room: false, composterRipe: true }).order, null)
  const { bot, state, count } = fakeTown({ hand: PICK, level: 8, items: [S('cobblestone', 10)] })
  const r = await run('compost', bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(state.extracted, 1); assert.equal(count('bone_meal'), 1)
})

await t('P2#5 a crafting table is never put on the composter site or beside it', () => {
  const s = { x: 5, y: 64, z: 0 }
  const stand = { x: 4, y: 64, z: 0 }
  const cell = C.tableCellFor({ site: s, stand, read: flat() })
  assert.ok(cell); assert.ok(Math.max(Math.abs(cell.x - 5), Math.abs(cell.z)) >= 2, JSON.stringify(cell))
  assert.ok(!(cell.x === 4 && cell.z === 0), 'on the standing cell')
})

// ===================================================================================================================
// THIRD REVIEW PASS (9a8c1c9)
// ===================================================================================================================
const { townComposterSite } = await import('../src/skills.mjs')
const blockedC0 = () => {
  const c0 = C.canonicalComposterSite({ home: HOME, read: (x, y, z) => (y <= FLOOR ? GRASS : AIR) }).site
  return { c0, blocks: { [`${c0.x},${c0.y},${c0.z}`]: 'oak_sapling' } }
}
const rowsOf = async kind => (await rows(kind))

await t('P3#1 a stored site that later becomes unusable is REPLACED, and the build succeeds on the next cell', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'composter-stuck-'))
  const a = fakeTown({ hand: PICK, composterAt: null, storeDir, items: [S('oak_log', 3)] })
  const x = townComposterSite(a.bot).site
  assert.ok(x)
  // The sapling on the recorded cell grew: the cell is a log now. Every bot would refuse it forever.
  const b = fakeTown({ hand: PICK, composterAt: null, storeDir, items: [S('oak_log', 3)], blocks: { [`${x.x},${x.y},${x.z}`]: 'oak_log' } })
  const r = await run('build_composter', b.bot)
  assert.equal(r.status, 'success', r.detail)
  const placed = composters(b.world)
  assert.equal(placed.length, 1); assert.notEqual(placed[0], `${x.x},${x.y},${x.z}`)
  const cur = C.readTownSite(storeDir, storeKey())
  assert.equal(`${cur.site.x},${cur.site.y},${cur.site.z}`, placed[0], 'the record does not name the new site')
})

await t('P3#1 the replacement is compare-and-swap: two bots refusing the same old site with different answers agree', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'composter-cas-'))
  const X = { x: 4, y: 64, z: 0 }, Y = { x: -4, y: 64, z: 1 }, Z = { x: 0, y: 64, z: 6 }
  assert.equal(C.createSiteGen(dir, 'k', 1, X, 'w'), true)
  const refuse = s => (s.x === X.x && s.z === X.z ? 'cell is oak_log' : null)
  const r1 = C.resolveTownSite({ dir, key: 'k', world: 'w', compute: () => ({ site: Y }), refuse })
  const r2 = C.resolveTownSite({ dir, key: 'k', world: 'w', compute: () => ({ site: Z }), refuse })
  assert.deepEqual(r1.site, Y); assert.deepEqual(r2.site, Y, 'the second refuser installed its own answer')
  assert.equal(C.readTownSite(dir, 'k').gen, 2)
  // The real race: a rival writes generation 3 BETWEEN this bot's read and its write. This bot loses the link and
  // must adopt the rival's cell -- neither defer nor keep its own.
  const W = { x: 7, y: 64, z: 7 }
  const refuseY = s => (s.x === Y.x && s.z === Y.z ? 'chest within 3' : null)
  const r3 = C.resolveTownSite({ dir, key: 'k', world: 'w', refuse: refuseY,
                                 compute: () => { C.createSiteGen(dir, 'k', 3, W, 'w'); return { site: Z } } })
  assert.deepEqual(r3.site, W, `the loser of the race took ${JSON.stringify(r3)}`)
})

await t('P3#1 a record from ANOTHER WORLD (a reseed keeps pool and home) counts as absent', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'composter-reseed-'))
  const { c0, blocks } = blockedC0()
  const a = fakeTown({ hand: PICK, composterAt: null, storeDir, worldId: 'seed-1', items: [S('oak_log', 3)], blocks })
  const x = townComposterSite(a.bot).site
  assert.ok(x && !(x.x === c0.x && x.z === c0.z))
  const b = fakeTown({ hand: PICK, composterAt: null, storeDir, worldId: 'seed-2', items: [S('oak_log', 3)] })
  const r = await run('build_composter', b.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(composters(b.world), [`${c0.x},${c0.y},${c0.z}`], 'the new world built on the old world\'s cell')
  assert.equal(C.worldIdFromLogin({ worldState: { hashedSeed: [12, -7] } }), '12:-7')
  assert.equal(C.worldIdFromLogin({ worldState: { hashedSeed: 99n } }), '99')
  assert.equal(C.worldIdFromLogin({}), '')
  assert.equal(C.sameWorld('', 'seed-2'), true, 'an unknown id never invalidates a record')
})

await t('P3#2 an UNKNOWN (unloaded) cell around the stored site is a free skip, not a backoff failure', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'composter-unknown-'))
  const a = fakeTown({ hand: PICK, composterAt: null, storeDir, items: [S('oak_log', 3)] })
  const x = townComposterSite(a.bot).site
  const b = fakeTown({ hand: PICK, composterAt: null, storeDir, items: [S('oak_log', 3)], unloaded: [`${x.x + 2},${x.y},${x.z}`] })
  const r = await run('build_composter', b.bot)
  assert.equal(r.status, 'no_effect', `${r.status}: ${r.detail}`)
  assert.deepEqual(b.state.crafted, []); assert.deepEqual(composters(b.world), [])
  assert.equal(C.townOrderOutcome('build_composter', r.status, NOW, {}).buildBackoffUntil ?? 0, 0)
})

await t('P3#3 an UNWRITABLE store defers the build: the bot never builds on its private answer', async () => {
  const blocker = path.join(mkdtempSync(path.join(tmpdir(), 'composter-ro-')), 'a-file')
  writeFileSync(blocker, 'not a directory')
  const town = fakeTown({ hand: PICK, composterAt: null, storeDir: path.join(blocker, 'pool'), items: [S('oak_log', 3)] })
  const r = await run('build_composter', town.bot)
  assert.equal(r.status, 'no_effect', r.detail); assert.deepEqual(town.state.crafted, []); assert.deepEqual(composters(town.world), [])
})

await t('P3#3 NO HARD LINKS defers the build too', async () => {
  const town = fakeTown({ hand: PICK, composterAt: null, items: [S('oak_log', 3)] })
  const real = fsMod.linkSync
  fsMod.linkSync = () => { throw Object.assign(new Error('EPERM: operation not permitted, link'), { code: 'EPERM' }) }
  try {
    const r = await run('build_composter', town.bot)
    assert.equal(r.status, 'no_effect', r.detail); assert.deepEqual(town.state.crafted, []); assert.deepEqual(composters(town.world), [])
  } finally { fsMod.linkSync = real }
})

await t('P3#3 a MALFORMED record with two bots whose candidates differ: they still agree on one shared site', () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'composter-torn-'))
  writeFileSync(path.join(storeDir, `${storeKey()}.g1.json`), '{"x":1')
  writeFileSync(path.join(storeDir, `${storeKey()}.json`), '{"x":1')   // the 9a8c1c9 file name, torn the same way
  const { c0, blocks } = blockedC0()
  const a = fakeTown({ hand: PICK, composterAt: null, storeDir, items: [S('oak_log', 3)], blocks })
  const b = fakeTown({ hand: PICK, composterAt: null, storeDir, items: [S('oak_log', 3)] })
  const sa = townComposterSite(a.bot).site, sb = townComposterSite(b.bot).site
  assert.ok(sa && sb); assert.ok(!(sa.x === c0.x && sa.z === c0.z), 'test setup: A\'s candidate must differ')
  assert.deepEqual(sb, sa, `B took ${JSON.stringify(sb)}, A ${JSON.stringify(sa)}`)
})

await t('P3#4 ONE metric: a site is never chosen where discovery (16 from home, 3-D) would not find it', () => {
  // Only the diagonal corners 10..11 out are open, 8 blocks above home: hypot(10, 8, 10) = 16.2 > 16.
  const far = (x, y, z) => (Math.abs(x) >= 10 && Math.abs(z) >= 10 ? (y <= 71 ? STONE_B : AIR) : (y <= 72 ? STONE_B : AIR))
  const r = C.canonicalComposterSite({ home: HOME0, read: far })
  const d3 = p => new Vec3(p.x, p.y, p.z).distanceTo(new Vec3(0, 64, 0))   // findBlocks' own comparison
  assert.ok(!r.site || d3(r.site) <= 16, `chose ${JSON.stringify(r.site)} at ${r.site && d3(r.site).toFixed(2)}`)
  // ...and an elevated diagonal that IS within reach of discovery is still allowed.
  const near = (x, y, z) => (Math.abs(x) >= 8 && Math.abs(x) <= 9 && Math.abs(z) >= 8 && Math.abs(z) <= 9 ? (y <= 71 ? STONE_B : AIR) : (y <= 72 ? STONE_B : AIR))
  const n = C.canonicalComposterSite({ home: HOME0, read: near })
  assert.ok(n.site && C.townDistance(HOME0, n.site) <= C.ADOPT_RADIUS && n.site.y === 72, JSON.stringify(n))
  // The metric is mineflayer's: findBlocks keeps cursor.distanceTo(point) <= maxDistance.
  assert.equal(C.townDistance(HOME0, n.site), new Vec3(n.site.x, n.site.y, n.site.z).distanceTo(new Vec3(0, 64, 0)))
})

await t('P3#5 an equip still in flight past BOTH windows: the order logs unsettled and does NOT restore the hand', async () => {
  const { bot, state } = fakeTown({ hand: PICK, rolls: () => 0.9, items: [S('leaf_litter', 5), S('wheat_seeds', 10), ...filler(31)] })
  let hangAt = null
  state.equipDelay = item => { if (item?.name === 'wheat_seeds' && !hangAt) { hangAt = Date.now(); return BOUNDS.awaitMs + BOUNDS.settleMs + 400 } return 0 }
  await within(SKILLS.compost.run({ bot }, {}, { aborted: false }), HUNG_MS, 'compost')
  assert.ok(hangAt, 'test setup: the wheat equip was never reached')
  const restores = [...state.selects.filter(x => x.t >= hangAt), ...state.equips.filter(x => x.t > hangAt && x.name === 'stone_pickaxe')]
  assert.deepEqual(restores, [], 'restored the hand while an equip was still in flight')
  const un = (await rowsOf('_housekeeping_unsettled')).at(-1)
  assert.match(un?.skill?.detail ?? '', /^compost: 1 operation\(s\) still outstanding/)
  await new Promise(r => setTimeout(r, BOUNDS.settleMs + 500))
})

await t('P3#5 a timed-out place() is told to stop: its late progress never puts the composter down', async () => {
  if (BOUNDS.craftMs > 5000) { console.log('        (skipped under production bounds: the place budget is 60 s; npm test runs it)'); return }
  const town = fakeTown({ hand: PICK, composterAt: null, items: [S('composter', 1)] })
  town.state.equipDelay = item => (item?.name === 'composter' ? BOUNDS.craftMs + 250 : 0)
  const r = await run('build_composter', town.bot)
  await new Promise(res => setTimeout(res, 600))
  assert.deepEqual(composters(town.world), [], `placed after the order gave up (${r.status}: ${r.detail})`)
  assert.notEqual(r.status, 'success')
})

// ===================================================================================================================
// FOURTH REVIEW PASS (7fc336c)
// ===================================================================================================================
await t('P4#1 FENCE: B publishes generation N+1 while A builds on N -> A does not place; exactly one composter', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'composter-fence-'))
  const a = fakeTown({ hand: PICK, composterAt: null, storeDir, items: [S('oak_log', 3)] })
  let x = null, rb = null, b = null
  a.state.onCraft = async name => {
    if (name !== 'composter' || b) return
    // While A holds the composter it just crafted, B arrives with a different view: A's cell is blocked for B, so B
    // replaces the record (N+1) and builds on the next cell. B has not placed in A's view of the world.
    x = C.readTownSite(storeDir, storeKey()).site
    b = fakeTown({ hand: PICK, composterAt: null, storeDir, items: [S('oak_log', 3)], blocks: { [`${x.x},${x.y},${x.z}`]: 'oak_log' } })
    rb = await run('build_composter', b.bot)
  }
  const ra = await run('build_composter', a.bot)
  assert.ok(b && rb?.status === 'success', `test setup: B did not build (${rb?.detail})`)
  assert.equal(C.readTownSite(storeDir, storeKey()).gen, 2)
  assert.deepEqual(composters(a.world), [], `A placed on the superseded site: ${ra.status} ${ra.detail}`)
  assert.equal(composters(a.world).length + composters(b.world).length, 1)
  assert.equal(ra.status, 'no_effect', ra.detail)
})

await t('P4#2 a race loser VALIDATES the adopted site in its own view: unknown or refused -> no site this visit', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'composter-adopt-'))
  const X = { x: 4, y: 64, z: 0 }, W = { x: 7, y: 64, z: 7 }, Z = { x: 0, y: 64, z: 6 }
  for (const [label, verdict] of [['unknown', 'unknown'], ['refused', 'chest within 3']]) {
    const d = path.join(dir, label)
    C.createSiteGen(d, 'k', 1, X, 'w')
    const refuse = s => (s.x === X.x && s.z === X.z ? 'cell is oak_log' : s.x === W.x && s.z === W.z ? verdict : null)
    const r = C.resolveTownSite({ dir: d, key: 'k', world: 'w', refuse, compute: () => { C.createSiteGen(d, 'k', 2, W, 'w'); return { site: Z } } })
    assert.equal(r.site, null, `${label}: adopted a site its own view ${verdict === 'unknown' ? 'cannot see' : 'refuses'}`)
    assert.equal(r.defer, true)
  }
})

await t('P4#3 a RESTORING equip that overruns the settle window is logged unsettled, and the order says so', async () => {
  // A full hotbar: equipping the leaf_litter swaps the pickaxe out into the main bag, so the restore must EQUIP it.
  const { bot, state } = fakeTown({ hand: PICK, rolls: () => 0.9, items: [S('leaf_litter', 5), ...filler(34)] })
  state.equipDelay = item => (item?.name === 'stone_pickaxe' ? BOUNDS.awaitMs + BOUNDS.settleMs + 300 : 0)
  await within(SKILLS.compost.run({ bot }, {}, { aborted: false }), HUNG_MS, 'compost')
  assert.ok(state.equips.some(e => e.name === 'stone_pickaxe'), 'test setup: the restore never equipped the pickaxe')
  const un = (await rows('_housekeeping_unsettled')).at(-1)
  assert.match(un?.skill?.detail ?? '', /^compost: the restoring equip is still outstanding/)
  await new Promise(r => setTimeout(r, BOUNDS.settleMs + 500))
})

await t('P4#4 old generations are pruned: only the current and the two before it are kept', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'composter-prune-'))
  for (let g = 1; g <= 5; g++) assert.equal(C.createSiteGen(dir, 'k', g, { x: g, y: 64, z: 0 }, 'w'), true)
  assert.deepEqual(fsMod.readdirSync(dir).filter(f => f.endsWith('.json')).sort(), ['k.g3.json', 'k.g4.json', 'k.g5.json'])
  assert.deepEqual(C.readTownSite(dir, 'k').site, { x: 5, y: 64, z: 0 })
})

// ===================================================================================================================
// SANDBOX DEFECTS (a5f3856 on Paper 1.21.8, 2026-10-03)
// ===================================================================================================================
await t('S#1 a build from LOGS succeeds when the server\'s inventory updates land 100-500 ms after bot.craft resolves', async () => {
  const town = fakeTown({ hand: PICK, composterAt: null, items: [S('oak_log', 3)] })
  let k = 0
  town.state.invDelay = () => [100, 500, 300, 250, 400][k++ % 5]
  const r = await within(SKILLS.build_composter.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'build')
  assert.equal(r.status, 'success', r.detail)
  assert.equal(composters(town.world).length, 1)
  assert.deepEqual(town.state.craftErrors ?? [], [], 'crafted on a stale view of the bag')
  assert.deepEqual(town.state.dropped, [])
})

await t('S#1 a craft whose result NEVER shows up is still a failure (bounded read-back, not a blind success)', async () => {
  const town = fakeTown({ hand: PICK, composterAt: null, items: [S('oak_log', 3)] })
  town.state.invDelay = () => 60_000   // the server never confirms within the window
  const t0 = Date.now()
  const r = await within(SKILLS.build_composter.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'build')
  assert.equal(r.status, 'failed'); assert.match(r.detail, /oak_planks/)
  assert.ok(Date.now() - t0 < 10_000, 'the read-back is not bounded')
})

await t('S#2 a HARVEST-ONLY visit (bone meal gained, nothing composted) passes the runner\'s evidence contract', async () => {
  const { classifyOutcome } = await import('../src/skills.mjs')
  assert.ok(classifyOutcome('compost', 'success', { inventory: { bone_meal: 1 } }, null).because.length,
    'a harvest-only success is downgraded to unknown by the evidence gate')
  assert.ok(classifyOutcome('compost', 'success', { inventory: { leaf_litter: -20 } }, null).because.length)
  assert.equal(classifyOutcome('compost', 'success', { inventory: {} }, null).because.length, 0, 'a visit that changed nothing is still not evidence')
})

await t('S#2b compost evidence is ONLY bone meal gained or compost inputs lost -- an unrelated pickup or drop is not evidence', async () => {
  const { classifyOutcome } = await import('../src/skills.mjs')
  const ev = inv => classifyOutcome('compost', 'success', { inventory: inv }, null).because
  assert.deepEqual(ev({ cobblestone: 1 }), [], 'an unrelated auto-pickup during the visit counted as composting')
  assert.deepEqual(ev({ cobblestone: 3, oak_log: 1 }), [])
  assert.deepEqual(ev({ cobblestone: -2 }), [], 'losing a non-compostable is not composting')
  assert.deepEqual(ev({ apple: -1 }), [], 'apples are never composted')
  assert.deepEqual(ev({}), [])
  assert.ok(ev({ bone_meal: 2 }).length); assert.ok(ev({ leaf_litter: -20, cobblestone: 1 }).length)
  assert.ok(ev({ oak_sapling: -40 }).length, 'surplus saplings are compost inputs'); assert.ok(ev({ wheat_seeds: -5 }).length)
  assert.match(ev({ bone_meal: 1, cobblestone: 4 }).join(' '), /^inventory_gain: bone_meal \+1$/, 'the unrelated gain leaked into the evidence')
})

await t('S#3 a town order the RUNNER refused (paused, busy, body held) is a free skip, not a backoff', () => {
  for (const fc of ['runner_paused', 'runner_busy', 'body_held']) {
    assert.equal(C.townOrderOutcome('compost', 'failed', NOW, {}, fc).compostBackoffUntil ?? 0, 0, fc)
    assert.equal(C.townOrderOutcome('build_composter', 'failed', NOW, {}, fc).buildBackoffUntil ?? 0, 0, fc)
  }
  assert.ok(C.townOrderOutcome('compost', 'failed', NOW, {}, 'compost_refused').compostBackoffUntil > NOW, 'a real failure still backs off')
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
