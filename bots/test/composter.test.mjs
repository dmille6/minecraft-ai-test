// INVENTORY HYGIENE, PHASE 2: the town composter. The measurement and the design are in src/composter.mjs.
// Behaviour through exported pure functions, then the real skill through a fake bot and a fake composter that
// follows the vanilla rules (levels 0..8, consume at 0-6, ripen 7->8 after 20 ticks, bone meal on a use at 8).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
import {
  COMPOST_CHANCE, isCompostJunk, compostPlan, nextStack, compostDue, composterLevel, composterBuildPlan,
  builderDecision, chooseComposterSite, compostDetail, MAX_ITEMS_PER_VISIT, TOWN_RADIUS, MIN_CONTAINER_DISTANCE,
  BUILDER_MAX_DEFERRALS, SLABS_PER_COMPOSTER,
} from '../src/composter.mjs'
import { NEVER_KEEP, TRIGGER_SLOTS, isHousekeeping } from '../src/hygiene.mjs'

const require = createRequire(import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }

let slotN = 9
const it = (name, count = 1, extra = {}) => ({ name, count, slot: slotN++, ...extra })
const filler = n => Array.from({ length: n }, (_, i) => it('cobblestone', 64, { slot: 100 + i }))

// ---- the facts the code rests on, read from the registry the fleet runs --------------------------------------
await t('REGISTRY 1.21.11: composter state is `level` 0..8, read back as a number (prismarine-block gives a string)', () => {
  const mcd = require('minecraft-data')('1.21.11')
  const B = require('prismarine-block')('1.21.11')
  const c = mcd.blocksByName.composter
  assert.deepEqual(c.states.map(s => s.name), ['level'])
  for (let i = 0; i <= 8; i++) assert.equal(composterLevel(B.fromStateId(c.minStateId + i, 0)), i)
  assert.equal(composterLevel({ name: 'chest', getProperties: () => ({ level: '3' }) }), null)
  assert.equal(composterLevel({ name: 'composter', getProperties: () => ({}) }), null)
})

await t('REGISTRY 1.21.11: the recipe is 7 slabs of ONE wood in a U (12 variants), a slab craft is 3 planks -> 6', () => {
  const mcd = require('minecraft-data')('1.21.11')
  const rs = mcd.recipes[mcd.itemsByName.composter.id]
  assert.equal(rs.length, 12)
  for (const r of rs) {
    const names = r.inShape.flat().filter(x => x != null).map(x => mcd.items[x].name)
    assert.equal(names.length, SLABS_PER_COMPOSTER)
    assert.equal(new Set(names).size, 1, 'one wood per recipe'); assert.match(names[0], /_slab$/)
    assert.deepEqual(r.inShape.map(row => row.map(x => x == null ? 0 : 1)), [[1, 0, 1], [1, 0, 1], [1, 1, 1]])
  }
  const slab = mcd.recipes[mcd.itemsByName.oak_slab.id][0]
  assert.equal(slab.result.count, 6); assert.deepEqual(slab.inShape.map(r => r.length), [3])
})

await t('every listed compostable is a real 1.21.11 item AND fleet ballast; bone meal is never ballast', () => {
  const mcd = require('minecraft-data')('1.21.11')
  for (const [name, p] of Object.entries(COMPOST_CHANCE)) {
    assert.ok(mcd.itemsByName[name], `${name} is not an item`)
    assert.ok(NEVER_KEEP.has(name), `${name} is not NEVER_KEEP ballast`)
    assert.ok([0.3, 0.5, 0.65].includes(p), `${name} chance ${p}`)
    assert.ok(!mcd.foodsByName[name], `${name} is food`)
  }
  assert.ok(mcd.itemsByName.bone_meal); assert.equal(NEVER_KEEP.has('bone_meal'), false)
})

// ---- the item filter -------------------------------------------------------------------------------------------
const KEEPERS = ['apple', 'sweet_berries', 'bread', 'oak_sapling', 'birch_sapling', 'mangrove_propagule', 'stone_pickaxe',
  'wooden_axe', 'oak_log', 'birch_planks', 'iron_ore', 'raw_iron', 'coal', 'cobblestone', 'bone_meal', 'stick', 'torch']
const NOT_COMPOSTABLE = ['egg', 'brown_egg', 'blue_egg', 'flint', 'ink_sac', 'glow_ink_sac', 'pointed_dripstone', 'dead_bush', 'rail', 'bamboo']

await t('the filter: never saplings, food, tools, logs, ores or bone meal; never ballast vanilla will not compost', () => {
  for (const n of [...KEEPERS, ...NOT_COMPOSTABLE]) assert.equal(isCompostJunk(n), false, n)
  for (const n of ['leaf_litter', 'wheat_seeds', 'poppy', 'dandelion', 'short_grass', 'tall_grass', 'fern', 'vine', 'seagrass']) assert.equal(isCompostJunk(n), true, n)
})

await t('the plan: only junk, leaf_litter first, then seeds, flowers, grass; capped per visit', () => {
  slotN = 9
  const inv = [...KEEPERS.map(n => it(n, 5)), ...NOT_COMPOSTABLE.map(n => it(n, 5)),
    it('short_grass', 7), it('poppy', 3), it('wheat_seeds', 39), it('leaf_litter', 64), it('leaf_litter', 22), it('vine', 2)]
  const plan = compostPlan(inv)
  assert.deepEqual(plan.take.map(x => x.name), ['leaf_litter', 'wheat_seeds', 'poppy', 'short_grass', 'vine'])
  assert.deepEqual(plan.take.map(x => x.count), [86, 39, 3, 7, 2])
  assert.equal(plan.junk, 137); assert.equal(plan.slots, inv.length)
  const capped = compostPlan(inv, { maxItems: 100 })
  assert.equal(capped.take.reduce((a, x) => a + x.count, 0), 100)
  assert.deepEqual(capped.take.map(x => x.name), ['leaf_litter', 'wheat_seeds'])
  assert.ok(MAX_ITEMS_PER_VISIT > 0 && MAX_ITEMS_PER_VISIT <= 256)
})

await t('the hand takes the SMALLEST stack first, so slots empty', () => {
  slotN = 9
  const inv = [it('leaf_litter', 64), it('leaf_litter', 7), it('leaf_litter', 64)]
  assert.equal(nextStack(inv, 'leaf_litter').count, 7)
  assert.equal(nextStack(inv, 'poppy'), null)
})

// ---- the trigger -----------------------------------------------------------------------------------------------
await t(`the trigger: only at town, only at ${TRIGGER_SLOTS}+ slots, only with junk, storage scanned last`, () => {
  const at = { slots: TRIGGER_SLOTS, junk: 10, distHome: 10, storageNear: true }
  assert.equal(compostDue(at), true)
  assert.equal(compostDue({ ...at, slots: TRIGGER_SLOTS - 1 }), false)
  assert.equal(compostDue({ ...at, slots: 36 }), true)
  assert.equal(compostDue({ ...at, distHome: TOWN_RADIUS + 1 }), false, 'never a trip')
  assert.equal(compostDue({ ...at, distHome: undefined }), false, 'no position is not at town')
  assert.equal(compostDue({ ...at, junk: 0 }), false)
  assert.equal(compostDue({ ...at, storageNear: false }), false)
  let scans = 0
  compostDue({ ...at, slots: 20, storageNear: () => { scans++; return true } })
  compostDue({ ...at, distHome: 900, storageNear: () => { scans++; return true } })
  assert.equal(scans, 0, 'the world scan ran for a bot that could never be due')
  assert.equal(compostDue({ ...at, storageNear: () => { scans++; return true } }), true); assert.equal(scans, 1)
})

await t('compost is housekeeping, like wear_out; nothing else is', () => {
  assert.equal(isHousekeeping('compost'), true); assert.equal(isHousekeeping('wear_out'), true)
  assert.equal(isHousekeeping('craft'), false); assert.equal(isHousekeeping(undefined), false)
})

// ---- one builder per town ----------------------------------------------------------------------------------------
await t('one builder: the lowest name at town builds; others defer a bounded number of visits, then build', () => {
  assert.deepEqual(builderDecision({ myName: 'b-Alpha', peers: ['b-Bravo', 'b-Delta'] }), { build: true, defer: false, to: null })
  const d = builderDecision({ myName: 'b-Delta', peers: ['b-Bravo', 'b-Alpha'] })
  assert.equal(d.build, false); assert.equal(d.to, 'b-Alpha')
  assert.equal(builderDecision({ myName: 'b-Delta', peers: ['b-Alpha'], deferrals: BUILDER_MAX_DEFERRALS }).build, true, 'starvation')
  assert.equal(builderDecision({ myName: 'b-Delta', peers: ['b-Delta'] }).build, true, 'itself is not a peer')
})

await t('build plan: from wood held only; 3 logs without a table, 2 with one; slabs/planks count; carried wins', () => {
  assert.equal(composterBuildPlan({ oak_log: 2 }), null)
  assert.deepEqual(composterBuildPlan({ oak_log: 3 }), { wood: 'oak', log: 'oak_log', logCrafts: 3, slabCrafts: 2, needTable: true })
  assert.deepEqual(composterBuildPlan({ birch_log: 2 }, { tableAvailable: true }), { wood: 'birch', log: 'birch_log', logCrafts: 2, slabCrafts: 2, needTable: false })
  assert.equal(composterBuildPlan({ oak_slab: 7 }, { tableAvailable: true }).slabCrafts, 0)
  assert.equal(composterBuildPlan({ oak_slab: 4, birch_slab: 4 }, { tableAvailable: true }), null, 'slabs of two woods are not one recipe')
  assert.equal(composterBuildPlan({ oak_planks: 6 }, { tableAvailable: true }).logCrafts, 0)
  assert.deepEqual(composterBuildPlan({ composter: 1 }), { carried: true })
  assert.equal(composterBuildPlan({ crimson_stem: 3 }).wood, 'crimson')
})

// ---- where it goes -----------------------------------------------------------------------------------------------
const AIR = { name: 'air', boundingBox: 'empty' }, GRASS = { name: 'grass_block', boundingBox: 'block' }
function flatWorld (extra = {}) {   // grass floor at y=63, air above; extra: "x,y,z" -> block
  return (x, y, z) => extra[`${x},${y},${z}`] ?? (y <= 63 ? GRASS : AIR)
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

await t(`the site is >= ${MIN_CONTAINER_DISTANCE} from every container, never the bot's column, never the home point`, () => {
  const chest = { x: 2, y: 64, z: 0 }
  const read = flatWorld({ '2,64,0': { name: 'chest', boundingBox: 'block' } })
  const site = chooseComposterSite({ origin: { x: 0, y: 64, z: 0 }, read, containers: [chest], home: { x: 100, z: 100 } })
  assert.ok(site); assert.ok(dist(site, chest) >= MIN_CONTAINER_DISTANCE, JSON.stringify(site))
  assert.ok(!(site.x === 0 && site.z === 0))
  assert.equal(read(site.x, site.y - 1, site.z).boundingBox, 'block')
  // Every candidate cell, not only the winner: brute-force over the area.
  const many = [{ x: 2, y: 64, z: 0 }, { x: -2, y: 64, z: 1 }, { x: 0, y: 64, z: 3 }]
  const s2 = chooseComposterSite({ origin: { x: 0, y: 64, z: 0 }, read, containers: many })
  assert.ok(s2 && many.every(c => dist(s2, c) >= MIN_CONTAINER_DISTANCE), JSON.stringify(s2))
  const h = chooseComposterSite({ origin: { x: 0, y: 64, z: 0 }, read: flatWorld(), home: { x: 1, z: 0 } })
  assert.ok(Math.hypot(h.x - 1, h.z) >= 3, `on the home point: ${JSON.stringify(h)}`)
})

await t('the site is never a corridor/doorway, beside a door, beside water, on a chest or a path, or an unknown cell', () => {
  // A 1-wide east-west corridor: walls on both z sides everywhere, so no cell qualifies.
  const walls = {}
  for (let x = -6; x <= 6; x++) for (const y of [64, 65]) { walls[`${x},${y},1`] = GRASS; walls[`${x},${y},-1`] = GRASS }
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (Math.abs(z) > 1) for (const y of [64, 65]) walls[`${x},${y},${z}`] = GRASS
  assert.equal(chooseComposterSite({ origin: { x: 0, y: 64, z: 0 }, read: flatWorld(walls) }), null)
  const door = chooseComposterSite({ origin: { x: 0, y: 64, z: 0 }, read: flatWorld({ '0,64,0': { name: 'oak_door', boundingBox: 'block' } }) })
  assert.ok(door === null || Math.max(Math.abs(door.x), Math.abs(door.z)) > 2, `beside a door: ${JSON.stringify(door)}`)
  const wet = {}
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) if ((x + z) % 2 === 0) wet[`${x},64,${z}`] = { name: 'water', boundingBox: 'empty' }
  const w = chooseComposterSite({ origin: { x: 0, y: 64, z: 0 }, read: flatWorld(wet) })
  assert.equal(w, null, `beside water: ${JSON.stringify(w)}`)
  const path = {}
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) path[`${x},63,${z}`] = { name: 'dirt_path', boundingBox: 'block' }
  assert.equal(chooseComposterSite({ origin: { x: 0, y: 64, z: 0 }, read: flatWorld(path) }), null)
  assert.equal(chooseComposterSite({ origin: { x: 0, y: 64, z: 0 }, read: () => null }), null)
  const occ = chooseComposterSite({ origin: { x: 0, y: 64, z: 0 }, read: flatWorld(), occupied: [{ x: 1, y: 64, z: 0 }] })
  assert.ok(!(occ.x === 1 && occ.z === 0 && occ.y === 64))
})

await t('the row: key=value, verified n, stop before items so truncation cannot cut the reason', () => {
  const d = compostDetail({ slotsBefore: 36, slotsAfter: 33, levelBefore: 0, levelAfter: 4, bonemeal: 1, items: { leaf_litter: 64, wheat_seeds: 3 }, stop: 'done' })
  assert.equal(d, 'slots=36->33 level=0->4 bonemeal=1 n=67 stop=done items=leaf_litter:64,wheat_seeds:3')
  const long = compostDetail({ items: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`item_${i}_long_name`, 1])), stop: 'budget' })
  assert.ok(long.length <= 300 && /stop=budget/.test(long))
})

// ---- the skill, through the real registry, a fake bot and a fake composter ----------------------------------------
const LOG_DIR = `/tmp/mcbot-test-logs-composter-${process.pid}`
process.env.LOG_DIR = LOG_DIR; process.env.BOT_NAME = 'TestBot'
const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')
const { config } = await import('../src/config.mjs')
const HOME = { x: config.world.homeX, z: config.world.homeZ }

/** A composter that follows the vanilla rules, driven by a scripted chance stream (deterministic). */
function fakeTown ({ inv, held = null, level = 0, composterAt = new Vec3(HOME.x + 8, 64, HOME.z), chest = new Vec3(HOME.x + 8, 64, HOME.z + 4),
                    rolls = () => 0.1, botAt = new Vec3(HOME.x + 6.5, 64, HOME.z + 0.5), dropFar = false } = {}) {
  const world = new Map()   // "x,y,z" -> name (default: grass at y<=63, air above)
  const key = p => `${p.x},${p.y},${p.z}`
  if (composterAt) world.set(key(composterAt), 'composter')
  if (chest) world.set(key(chest), 'chest')
  const state = { level, ripenAt: null, tick: 0, levels: [level], extracted: 0, pending: [], tossed: 0, clicksAt7: 0 }
  const VANILLA = { leaf_litter: 0.3, wheat_seeds: 0.3, poppy: 0.65, short_grass: 0.3, apple: 0.65, oak_sapling: 0.3 }
  const blockAt = p => {
    const v = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    const name = world.get(key(v)) ?? (v.y <= 63 ? 'grass_block' : 'air')
    const b = { name, position: v, boundingBox: name === 'air' ? 'empty' : 'block', type: 0 }
    if (name === 'composter') b.getProperties = () => ({ level: String(state.level) })
    return b
  }
  const bot = {
    username: 'b-Alpha', players: {}, entities: {}, quickBarSlot: 0, health: 20, food: 20,
    entity: { position: botAt },
    heldItem: held,
    registry: require('minecraft-data')('1.21.11'),
    inventory: { items: () => inv.filter(i => i.count > 0) },
    setQuickBarSlot (n) { bot.quickBarSlot = n },
    setControlState () {}, lookAt: async () => {},
    toss: async () => { state.tossed++ }, tossStack: async () => { state.tossed++ },
    equip: async (item) => { if (!inv.includes(item)) throw new Error('not in inventory'); bot.heldItem = item },
    blockAt,
    findBlock: ({ matching, maxDistance }) => {
      for (const [k, name] of world) {
        const [x, y, z] = k.split(',').map(Number); const b = blockAt(new Vec3(x, y, z))
        if (b.position.distanceTo(bot.entity.position) <= maxDistance && matching({ ...b, name })) return b
      }
      return null
    },
    findBlocks: ({ matching, maxDistance }) => [...world.keys()].map(k => new Vec3(...k.split(',').map(Number)))
      .filter(v => v.distanceTo(bot.entity.position) <= maxDistance && matching(blockAt(v))),
    nearestEntity: f => Object.values(bot.entities).find(f) ?? null,
    pathfinder: { setGoal () {}, stop () {}, goto: async goal => { bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5) } },
    waitForTicks: async n => {
      for (let i = 0; i < n; i++) {
        state.tick++
        if (state.level === 7 && state.ripenAt != null && state.tick >= state.ripenAt) { state.level = 8; state.levels.push(8); state.ripenAt = null }
        for (const d of [...state.pending]) {   // the server's pickup: delay 10 ticks, then within ~1.3 blocks
          if (state.tick < d.at) continue
          if (d.entity.position.distanceTo(bot.entity.position) <= 1.3 && bot.inventory.items().length < 36) {
            const bm = inv.find(x => x.name === 'bone_meal' && x.count > 0)
            if (bm) bm.count++; else inv.push({ name: 'bone_meal', count: 1, slot: 200 + state.extracted })
            state.pending.splice(state.pending.indexOf(d), 1); delete bot.entities[d.entity.id]
          }
        }
      }
    },
    activateBlock: async b => {
      assert.equal(b.name, 'composter')
      assert.ok(bot.entity.position.distanceTo(b.position.offset(0.5, 0.5, 0.5)) <= 4.5, 'used from out of reach')
      const h = bot.heldItem
      // 1.21 ComposterBlock.useItemOn: a compostable at level < 8 is handled (consumed only below 7); otherwise use.
      if (h && h.count > 0 && VANILLA[h.name] != null && state.level < 8) {
        if (state.level === 7) { state.clicksAt7++; return }
        h.count--; if (h.count === 0) bot.heldItem = null
        if (state.level === 0 || rolls() < VANILLA[h.name]) { state.level++; state.levels.push(state.level); if (state.level === 7) state.ripenAt = state.tick + 20 }
        return
      }
      if (state.level === 8) {
        state.level = 0; state.levels.push(0); state.extracted++
        const pos = dropFar ? b.position.offset(0.5, 1.01, 2.4) : b.position.offset(0.5, 1.01, 0.5)
        const entity = { id: 1000 + state.extracted, name: 'item', position: pos, getDroppedItem: () => ({ name: 'bone_meal' }) }
        bot.entities[entity.id] = entity; state.pending.push({ entity, at: state.tick + 10 })
      }
    },
    placeBlock: async (ref, face) => {
      const at = ref.position.plus(face)
      const c = inv.find(x => x.name === 'composter' && x.count > 0)
      assert.ok(c && bot.heldItem === c, 'placing without the composter in hand')
      c.count--; world.set(key(at), 'composter'); bot.heldItem = null
    },
  }
  return { bot, state, world }
}
const pick = (max = 131, used = 30) => ({ name: 'stone_pickaxe', count: 1, slot: 36, maxDurability: max, durabilityUsed: used })
const fullBag = (junk, held) => { const inv = [held, ...junk].filter(Boolean); let i = 0; while (inv.length < 36) inv.push({ name: 'cobblestone', count: 64, slot: 120 + i++ }); return inv }
const rows = async kind => {
  await new Promise(r => setTimeout(r, 150))
  try {
    return readFileSync(`${LOG_DIR}/skill-TestBot.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind)
  } catch { return [] }
}

await t('compost is registered, chatOnly, with a loss contract', () => {
  assert.ok(SKILLS.compost?.run); assert.equal(SKILLS.compost.chatOnly, true)
  assert.deepEqual(SKILL_CONTRACTS.compost.expects, ['inventory_loss'])
})

await t('WIRED: levels 0..8 cycle, every insert verified, bone meal collected, hand restored, keepers untouched, nothing tossed', async () => {
  const held = pick()
  const apple = { name: 'apple', count: 5, slot: 10 }, sap = { name: 'oak_sapling', count: 12, slot: 11 }
  const inv = fullBag([{ name: 'leaf_litter', count: 64, slot: 12 }, { name: 'leaf_litter', count: 6, slot: 13 },
    { name: 'wheat_seeds', count: 10, slot: 14 }, apple, sap, { name: 'egg', count: 3, slot: 15 }], held)
  let n = 0
  const { bot, state } = fakeTown({ inv, held, rolls: () => (n++ % 3 === 0 ? 0.1 : 0.9) })   // one success in three
  const r = await SKILLS.compost.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(inv.filter(x => x.name === 'leaf_litter').reduce((a, x) => a + x.count, 0), 0, 'leaf_litter left')
  assert.equal(inv.find(x => x.name === 'wheat_seeds').count, 0)
  assert.equal(apple.count, 5); assert.equal(sap.count, 12); assert.equal(inv.find(x => x.name === 'egg').count, 3)
  assert.ok(state.levels.includes(7) && state.levels.includes(8), `levels ${state.levels.join(',')}`)
  assert.ok(state.extracted >= 1); assert.equal(state.clicksAt7, 0, 'clicked a ripening composter')
  assert.equal(inv.find(x => x.name === 'bone_meal')?.count ?? 0, state.extracted, 'every bone meal popped was collected')
  assert.equal(bot.heldItem, held, 'the pickaxe is back in hand')
  assert.equal(state.tossed, 0)
  assert.ok(inv.filter(x => x.count > 0).length < 36, 'slots were freed')
  const row = (await rows('_compost')).at(-1)
  assert.ok(row, 'no _compost row'); assert.equal(row.skill.status, 'success')
  assert.match(row.skill.detail, /^slots=36->3[0-5] level=0->\d bonemeal=\d+ n=80 stop=done items=leaf_litter:70,wheat_seeds:10$/)
})

await t('WIRED: a bone meal that lands out of pickup range is walked to and collected', async () => {
  const held = pick()
  const inv = fullBag([{ name: 'leaf_litter', count: 30, slot: 12 }], held).slice(0, 35)   // one slot free for the bone meal
  const { bot, state } = fakeTown({ inv, held, level: 6, rolls: () => 0.1, dropFar: true })
  const r = await SKILLS.compost.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'success', r.detail)
  assert.ok(state.extracted >= 1, `${r.detail} levels ${state.levels}`)
  assert.equal(inv.find(x => x.name === 'bone_meal')?.count ?? 0, state.extracted)
})

await t('WIRED: a ripe composter with NO room for the bone meal is left at 8 -- never a pile on the ground', async () => {
  const held = pick()
  const inv = fullBag([{ name: 'leaf_litter', count: 64, slot: 12 }], held)
  const { bot, state } = fakeTown({ inv, held, level: 8 })
  const r = await SKILLS.compost.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'failed'); assert.match(r.detail, /bone meal would be left/)
  assert.equal(state.extracted, 0); assert.equal(bot.heldItem, held)
})

await t('WIRED: a composter that takes nothing is reported, not claimed', async () => {
  const held = pick()
  const inv = fullBag([{ name: 'leaf_litter', count: 64, slot: 12 }], held)
  const { bot } = fakeTown({ inv, held })
  bot.activateBlock = async () => {}   // the server ignores the use
  const r = await SKILLS.compost.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'failed'); assert.match(r.detail, /took no leaf_litter/)
  assert.equal(inv.find(x => x.name === 'leaf_litter').count, 64); assert.equal(bot.heldItem, held)
})

await t('WIRED: no composter and a carried one -> placed >= 3 from the chest, _composter_built, then used', async () => {
  const held = pick()
  const inv = fullBag([{ name: 'leaf_litter', count: 20, slot: 12 }, { name: 'composter', count: 1, slot: 13 }], held)
  const chest = new Vec3(HOME.x + 8, 64, HOME.z + 2)
  const { bot, world } = fakeTown({ inv, held, composterAt: null, chest, botAt: new Vec3(HOME.x + 8.5, 64, HOME.z + 0.5) })
  const r = await SKILLS.compost.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'success', r.detail); assert.match(r.detail, /built the town composter/)
  const placed = [...world].filter(([, n]) => n === 'composter').map(([k]) => new Vec3(...k.split(',').map(Number)))
  assert.equal(placed.length, 1)
  assert.ok(placed[0].distanceTo(chest) >= MIN_CONTAINER_DISTANCE, `${placed[0]} is ${placed[0].distanceTo(chest)} from the chest`)
  const built = (await rows('_composter_built')).at(-1)
  assert.ok(built); assert.match(built.skill.detail, new RegExp(`^at=${placed[0].x},${placed[0].y},${placed[0].z} wood=carried`))
})

await t('WIRED: no composter, no wood -> nothing crafted or placed, and the refusal names a gather the bot can do', async () => {
  const held = pick()
  const inv = fullBag([{ name: 'leaf_litter', count: 20, slot: 12 }], held)
  const { bot, world } = fakeTown({ inv, held, composterAt: null })
  const r = await SKILLS.compost.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /gather 3 logs/)
  assert.equal([...world.values()].filter(n => n === 'composter').length, 0)
  assert.equal(inv.find(x => x.name === 'leaf_litter').count, 20)
})

await t('WIRED: a lower-named bot at town builds first; this one defers and spends nothing', async () => {
  const held = pick()
  const inv = fullBag([{ name: 'leaf_litter', count: 20, slot: 12 }, { name: 'oak_log', count: 8, slot: 13 }], held)
  const { bot } = fakeTown({ inv, held, composterAt: null })
  bot.username = 'b-Delta'
  bot.players = { 'b-Alpha': { username: 'b-Alpha', entity: { position: new Vec3(HOME.x + 3, 64, HOME.z) } } }
  const r = await SKILLS.compost.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /b-Alpha is at town and builds first/)
  assert.equal(inv.find(x => x.name === 'oak_log').count, 8)
})

await t('WIRING (source, comments stripped): the compost order is gated by compostDue + cooldown, precedes planting, backs off', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const cog = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  const order = cog.indexOf("order = { skill: 'compost'"), plant = cog.indexOf('plantingOrder({'), wear = cog.indexOf("order = { skill: 'wear_out'")
  assert.ok(order > 0 && plant > order && order > wear, 'wear-out, then compost, then planting')
  const gate = cog.slice(order - 900, order)
  assert.match(gate, /COMPOST_COOLDOWN_MS/); assert.match(gate, /if \(compostDue\(\{/)
  assert.match(cog, /admitted\.skill === 'compost'\) this\.compostBackoffUntil = r\.status === 'success' \? 0 :/)
})

// ---- mutants: each must apply exactly once and must turn a test above red --------------------------------------
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const COMPOSTER_PATH = new URL('../src/composter.mjs', import.meta.url)

await t('MUTANT KILLED: dropping the compostability allowlist feeds eggs and flint to the composter', async () => {
  await withMutant(COMPOSTER_PATH, '&& Object.hasOwn(COMPOST_CHANCE, name) &&', '&&', async m => {
    assert.ok(['egg', 'flint', 'rail'].some(n => m.isCompostJunk(n)), 'the mutant still refuses non-compostables, so the filter test proves nothing')
  })
})
await t('MUTANT KILLED: dropping the slot threshold composts from a half-empty bag', async () => {
  await withMutant(COMPOSTER_PATH, 'if (!(slots >= TRIGGER_SLOTS)) return false', 'if (false) return false', async m => {
    assert.equal(m.compostDue({ slots: 10, junk: 5, distHome: 5, storageNear: true }), true, 'the mutant did not change the trigger')
  })
})
await t('MUTANT KILLED: dropping the town radius makes it a trip', async () => {
  await withMutant(COMPOSTER_PATH, 'if (!(distHome <= TOWN_RADIUS)) return false', 'if (false) return false', async m => {
    assert.equal(m.compostDue({ slots: 36, junk: 5, distHome: 900, storageNear: true }), true, 'the mutant did not change the trigger')
  })
})
await t('MUTANT KILLED: dropping the container distance puts the composter against the chest', async () => {
  await withMutant(COMPOSTER_PATH, 'if (nearest < MIN_CONTAINER_DISTANCE) continue', 'if (false) continue', async m => {
    const chest = { x: 1, y: 64, z: 0 }
    const site = m.chooseComposterSite({ origin: { x: 0, y: 64, z: 0 }, read: flatWorld({ '1,64,0': { name: 'chest', boundingBox: 'block' } }), containers: [chest] })
    assert.ok(dist(site, chest) < MIN_CONTAINER_DISTANCE, 'the mutant still kept its distance')
  })
})

await t('MUTANT KILLED: without the finally-restore, a visit that stops early leaves junk in the hand', async () => {
  await withMutant(new URL('../src/skills.mjs', import.meta.url), '  } finally {\n    await restoreHand()\n  }', '  } finally {\n  }', async m => {
    const held = pick()
    const inv = fullBag([{ name: 'leaf_litter', count: 64, slot: 12 }], held)
    const { bot } = fakeTown({ inv, held })
    bot.activateBlock = async () => {}
    await m.SKILLS.compost.run({ bot }, {}, { aborted: false })
    assert.notEqual(bot.heldItem, held, 'the mutant still restored the hand, so the hand test proves nothing')
  })
})

try { rmSync(LOG_DIR, { recursive: true, force: true }) } catch {}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
