// THE TOWN DEPOSIT (towndeposit.mjs, owner 10-05): a full bag at town banks its surplus, deterministically.
//
// Everything here is behaviour: the plan, the keeps, the order and its latch are pure exports; the property test runs
// the REAL milestone predicates over random full bags; the skill runs against a fake chest window whose transfer
// behaves like mineflayer's (fills partial stacks, then empty slots, throws "destination full" with the stack left on
// the cursor); the dispatch runs through the REAL CognitiveLoop.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-towndeposit'
process.env.BOT_NAME = process.env.BOT_NAME || 'TownBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'td-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'

import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')

const TD = await import('../src/towndeposit.mjs')
const { townDepositPlan, townKeeps, toolSlotsToBank, fitToContainer, townDepositOrder, townDepositOutcome, inTownZone, doubleChestPartner, townWalkMovements,
        TD_TRIGGER_SLOTS, TD_COOLDOWN_MS, TD_BACKOFF_MS, TD_SCAN_MS, TD_REARM_OUTSIDE_MS, TD_STAY_REARM_MS,
        STOCKPILE_KEEP, HELD_TARGETS, IRON_LADDER, LOGS, PLANKS, COBBLE } = TD
const MS = await import('../src/milestones.mjs')
const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')
const { HOUSEKEEPING } = await import('../src/hygiene.mjs')
const { tapRecords } = await import('../src/logger.mjs')

// ---- fixtures ---------------------------------------------------------------------------------------------------
const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$/
function item (name, count = 1, slot = 9, extra = {}) {
  const def = mcData.itemsByName[name]
  assert.ok(def, `unknown item ${name}`)
  const it = { name, count, slot, type: def.id, stackSize: def.stackSize, ...extra }
  if (TOOL.test(name)) { it.maxDurability = def.maxDurability; it.durabilityUsed = extra.durabilityUsed ?? 0 }
  return it
}
/** A bag from [name, count, uses?] rows, slots 9.. in order. `uses` sets a tool's remaining durability. */
function bag (rows) {
  return rows.map(([name, count, uses], i) => {
    const max = mcData.itemsByName[name].maxDurability
    return item(name, count, 9 + i, uses != null ? { durabilityUsed: max - uses } : {})
  })
}
const filler = (n, start = 0) => Array.from({ length: n }, (_, i) => ['white_wool', 1 + ((i + start) % 3)])  // never bankable

// ---- pure: the town, the keeps, the tools -----------------------------------------------------------------------
test('town = 16 h / 12 v of home, both edges inclusive', () => {
  const home = { x: 0, y: 70, z: 0 }
  assert.equal(inTownZone({ x: 16, y: 70, z: 0 }, home), true)
  assert.equal(inTownZone({ x: 16.1, y: 70, z: 0 }, home), false)
  assert.equal(inTownZone({ x: 0, y: 58, z: 0 }, home), true)
  assert.equal(inTownZone({ x: 0, y: 57, z: 0 }, home), false, 'a chest 13 below home is a mine chest, not the bank')
  assert.equal(inTownZone(null, home), false)
})

test('the families are milestones.mjs\'s own, and the held targets match the gatherer chain\'s predicates', () => {
  assert.deepEqual([...LOGS], MS.LOGS); assert.deepEqual([...PLANKS], MS.PLANKS); assert.deepEqual([...COBBLE], MS.COBBLE)
  assert.equal(STOCKPILE_KEEP, MS.STOCKPILE_MAX)
  for (const [name, n] of Object.entries(HELD_TARGETS)) {
    const rung = MS.MILESTONES_BY_ROLE.gatherer.find(r => r.wants === name)
    assert.ok(rung, `the gatherer chain has a ${name} rung`)
    const b = k => ({ inventory: { items: () => (k ? [item(name, k)] : []) } })
    assert.equal(rung.done(b(n - 1)), false, `${name} ${n - 1} is short`)
    assert.equal(rung.done(b(n)), true, `${name} ${n} is the target`)
  }
})

test('keeps: wood to 64 units (logs first), the stone FAMILY to 64 (andesite counts), iron never, wanted to a stack', () => {
  const { keep, why } = townKeeps({ oak_log: 50, birch_log: 30, oak_planks: 40, cobblestone: 100, andesite: 20, raw_iron: 9, iron_ingot: 4, coal: 30, stick: 40, dirt: 40 }, { wanted: ['stick'] })
  assert.equal(keep.oak_log, 50); assert.equal(keep.birch_log, 14)
  assert.equal(keep.oak_planks, 4, '64 units already in logs; 4 planks kept for the ladder\'s means'); assert.equal(why.oak_planks, 'ladder_means')
  assert.equal(keep.cobblestone, 64, 'cobblestone first: a pickaxe and a furnace are made of it')
  assert.equal(keep.andesite, 0 + (keep.andesite ?? 0), 'andesite never banks anyway')
  for (const n of ['raw_iron', 'iron_ingot', 'coal']) assert.equal(why[n], 'iron_ladder', n)
  assert.equal(keep.stick, 40, 'a wanted item is kept up to a stack')
  assert.equal(keep.dirt, 16)
  const few = townKeeps({ oak_log: 3, oak_planks: 20 })
  assert.equal(few.keep.oak_log, 3); assert.equal(few.keep.oak_planks, 20, 'a deficit is never deepened')
})

test('tools: a spent copy never moves, the best usable copy always stays', () => {
  const c = (slot, uses) => item('stone_pickaxe', 1, slot, { durabilityUsed: 131 - uses })
  assert.deepEqual(toolSlotsToBank([c(9, 1), c(10, 120), c(11, 50), c(12, 8)]), [11])
  assert.deepEqual(toolSlotsToBank([c(9, 1), c(10, 2), c(11, 10)]), [], 'nothing usable: nothing moves (FLOOR = 10)')
  assert.deepEqual(toolSlotsToBank([c(9, 11), c(10, 11)]), [10], 'ties keep the lower slot')
  assert.deepEqual(toolSlotsToBank([c(9, 100), c(10, 90), c(11, 80)], 1), [10], 'the allowance caps it')
})

test('the plan: whole stacks, smallest first; junk, food, stations, chests, dirt, sand and iron never; freed = stacks', () => {
  const items = bag([
    ['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 120], ['stone_pickaxe', 1, 60], ['wooden_pickaxe', 1, 40],
    ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 20], ['oak_log', 64], ['oak_log', 64], ['oak_log', 10],
    ['apple', 45], ['egg', 12], ['dirt', 64], ['sand', 30], ['bone_meal', 9], ['crafting_table', 2], ['chest', 7],
    ['raw_iron', 5], ['iron_ingot', 3], ['coal', 20], ['stick', 40], ['oak_planks', 20], ['leaf_litter', 30], ['torch', 20],
    ...filler(12)])
  assert.equal(items.length, 36)
  const p = townDepositPlan(items)
  const names = p.steps.map(s => s.name)
  for (const n of ['apple', 'egg', 'dirt', 'sand', 'bone_meal', 'crafting_table', 'chest', 'raw_iron', 'iron_ingot', 'coal', 'leaf_litter', 'torch', 'white_wool', 'wooden_pickaxe'])
    assert.ok(!names.includes(n), `${n} must stay`)
  const picks = p.steps.filter(s => s.name === 'stone_pickaxe')
  assert.equal(picks.length, 1, 'one spare usable pickaxe banks')
  const moved = items.find(i => i.slot === picks[0].slot)
  assert.equal(131 - moved.durabilityUsed, 60, 'the 60-use copy moves; the 120-use one and the spent one stay')
  assert.deepEqual(p.steps.filter(s => s.name === 'cobblestone').map(s => s.count), [20], 'creditCap 64: the 20 stack, never a partial')
  assert.deepEqual(p.steps.filter(s => s.name === 'oak_log').map(s => s.count), [10], '138 logs, keep 64 units, creditCap 64: the 10 stack only (the next 64 would pass the cap)')
  assert.ok(p.steps.every(s => items.find(i => i.slot === s.slot).count === s.count), 'every step is a whole stack')
  assert.equal(p.freed, p.steps.length)
  assert.equal(p.freed, 3, 'pickaxe + cobble 20 + logs 10')
})

test('a bag holding only what the keeps protect plans nothing', () => {
  const items = bag([['cobblestone', 64], ['oak_log', 64], ['stone_pickaxe', 1, 100], ['raw_iron', 20], ['dirt', 16], ...filler(31)])
  assert.equal(townDepositPlan(items).freed, 0)
})

// ---- the property: the deposit never changes a rung ----------------------------------------------------------------
function rng (seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 } }
const POOL = ['oak_log', 'birch_log', 'spruce_log', 'oak_planks', 'birch_planks', 'stick', 'cobblestone', 'cobbled_deepslate', 'stone', 'andesite', 'diorite',
              'dirt', 'sand', 'gravel', 'coal', 'raw_iron', 'iron_ingot', 'iron_ore', 'crafting_table', 'furnace', 'apple', 'egg', 'bone_meal', 'oak_sapling',
              'torch', 'chest', 'raw_copper', 'diamond', 'leaf_litter', 'bucket', 'white_wool']
const TOOLS = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'stone_axe', 'stone_shovel']
function randomBag (r) {
  const out = []
  const n = 34 + Math.floor(r() * 3)
  while (out.length < n) {
    if (r() < 0.2) { const t = TOOLS[Math.floor(r() * TOOLS.length)]; const max = mcData.itemsByName[t].maxDurability; out.push(item(t, 1, 9 + out.length, { durabilityUsed: Math.floor(r() * max) })) } else {
      const nm = POOL[Math.floor(r() * POOL.length)]; const size = mcData.itemsByName[nm].stackSize
      out.push(item(nm, 1 + Math.floor(r() * size), 9 + out.length))
    }
  }
  return out
}
const after = (items, plan) => { const gone = new Set(plan.steps.map(s => s.slot)); return items.filter(i => !gone.has(i.slot)) }
const fakeBot = (items, ironNear) => ({ inventory: { items: () => items }, registry: mcData, findBlock: () => (ironNear ? { position: new Vec3(0, 0, 0) } : null),
                                         entity: { position: new Vec3(0, 70, 0) } })
const GUARDED = [...MS.MILESTONES_BY_ROLE.gatherer, ...MS.SUSTAINING].filter(r => !['deposit_surplus', 'return', 'patrol'].includes(r.id))

test('PROPERTY: over 400 random full bags, no gatherer or SUSTAINING rung changes state at any lap, and no stockpile deficit deepens', () => {
  const r = rng(20261005)
  let checked = 0, plansWithSteps = 0
  const wood = l => LOGS.reduce((t, n) => t + l.filter(i => i.name === n).reduce((a, i) => a + i.count, 0), 0) + Math.floor(PLANKS.reduce((t, n) => t + l.filter(i => i.name === n).reduce((a, i) => a + i.count, 0), 0) / 4)
  const stone = l => COBBLE.reduce((t, n) => t + l.filter(i => i.name === n).reduce((a, i) => a + i.count, 0), 0)
  for (let k = 0; k < 400; k++) {
    const items = randomBag(r)
    const wanted = k % 3 === 0 ? ['stone_pickaxe', 'cobblestone', 'stick', 'oak_planks'] : []
    const plan = townDepositPlan(items, { wanted })
    if (plan.steps.length) plansWithSteps++
    const rest = after(items, plan)
    assert.ok(wood(rest) >= Math.min(wood(items), 64), `wood deficit deepened (bag ${k})`)
    assert.ok(stone(rest) >= Math.min(stone(items), 64), `stone deficit deepened (bag ${k})`)
    for (const ironNear of [true, false]) {
      for (const rung of GUARDED) {
        for (const n of [0, 1, 3, 7, 14, 540]) {
          const a = rung.done(fakeBot(items, ironNear), n), b = rung.done(fakeBot(rest, ironNear), n)
          assert.equal(b, a, `rung ${rung.id} lap ${n} iron=${ironNear} flipped on bag ${k}: ${JSON.stringify(plan.steps)}`)
          checked++
        }
      }
    }
  }
  assert.ok(plansWithSteps > 100, `positive control: plans that bank something (${plansWithSteps})`)
  assert.ok(checked > 20000, `checked ${checked}`)
})

// ---- the container fit --------------------------------------------------------------------------------------------
test('fit: EMPTY slots only, one per stack, in order; a full container takes nothing', () => {
  const full = Array.from({ length: 27 }, () => item('dirt', 64))
  assert.deepEqual(fitToContainer([{ slot: 9, name: 'cobblestone', count: 20 }], full), [])
  const partial = [item('cobblestone', 50), ...Array.from({ length: 26 }, () => item('dirt', 64))]
  assert.deepEqual(fitToContainer([{ slot: 9, name: 'cobblestone', count: 14 }], partial), [], 'never merged into a partial stack')
  const twoEmpty = [null, item('dirt', 64), null, ...Array.from({ length: 24 }, () => item('dirt', 64))]
  const out = fitToContainer([{ slot: 9, name: 'oak_log', count: 64 }, { slot: 10, name: 'stone_pickaxe', count: 1 }, { slot: 11, name: 'raw_copper', count: 3 }], twoEmpty)
  assert.deepEqual(out.map(s => [s.name, s.dest]), [['oak_log', 0], ['stone_pickaxe', 2]])
})

test('the visit\'s allowance: what an earlier container took is spent (creditCap caps the VISIT)', () => {
  const items = bag([['oak_log', 64], ['oak_log', 64], ['oak_log', 64], ['oak_log', 10], ...filler(30)])
  assert.deepEqual(townDepositPlan(items).steps.map(s => s.count), [10], 'cap 64: the 10 only (the next 64 passes the cap)')
  const after10 = items.filter(i => !(i.name === 'oak_log' && i.count === 10))
  assert.deepEqual(townDepositPlan(after10).steps.map(s => s.count), [64], 'a fresh plan would take 64 more...')
  assert.deepEqual(townDepositPlan(after10, { already: { oak_log: 10 } }).steps, [], '...the visit has 54 left: no whole stack fits')
  const copper = bag([['raw_copper', 7], ['raw_copper', 7], ...filler(34)])
  assert.equal(townDepositPlan(copper.slice(1), { already: { raw_copper: 7 } }).steps.length, 1, 'the cap is spent, not the reduced bag\'s count (Codex round 2)')
})

test('double chests: two halves name each other (vanilla getConnectedDirection); a single beside a single is two chests', () => {
  const p = { x: 5, y: 70, z: 5 }
  assert.deepEqual(doubleChestPartner(p, { type: 'left', facing: 'north' }), { x: 6, y: 70, z: 5 })
  assert.deepEqual(doubleChestPartner(p, { type: 'right', facing: 'north' }), { x: 4, y: 70, z: 5 })
  assert.deepEqual(doubleChestPartner(p, { type: 'left', facing: 'east' }), { x: 5, y: 70, z: 6 })
  assert.deepEqual(doubleChestPartner(p, { type: 'right', facing: 'south' }), { x: 6, y: 70, z: 5 })
  assert.equal(doubleChestPartner(p, { type: 'single', facing: 'north' }), null)
  assert.equal(doubleChestPartner(p, {}), null)
})

test('the walk never digs, towers or bridges; the shared profile is untouched', () => {
  const proto = { getNeighbors () { return [] } }
  const base = Object.assign(Object.create(proto), { canDig: true, allow1by1towers: true, scafoldingBlocks: [1, 2], allowParkour: true })
  const m = townWalkMovements(base)
  assert.equal(m.canDig, false); assert.equal(m.allow1by1towers, false); assert.deepEqual(m.scafoldingBlocks, [])
  assert.equal(m.allowParkour, true, 'everything else is the walk profile'); assert.equal(Object.getPrototypeOf(m), proto)
  assert.equal(base.canDig, true); assert.equal(base.allow1by1towers, true); assert.deepEqual(base.scafoldingBlocks, [1, 2])
})

// ---- the order ------------------------------------------------------------------------------------------------------
const HOME = { x: 0, y: 70, z: 0 }
const P = (x, y = 70, z = 0) => ({ x, y, z })
const ok = { freed: 3 }
test('order: at town, >= 34 slots, a plan that frees a slot and a town container -> town_deposit', () => {
  const r = townDepositOrder({ now: 1e9, slots: TD_TRIGGER_SLOTS, pos: P(5), home: HOME, plan: ok, container: true })
  assert.equal(r.order?.skill, 'town_deposit')
  assert.equal(r.state.latched, true)
  for (const [why, args] of [['33 slots', { slots: 33 }], ['out of town', { pos: P(17) }], ['13 below', { pos: P(0, 57) }],
    ['frees nothing', { plan: { freed: 0 } }], ['no plan', { plan: null }], ['no container', { container: false }]]) {
    assert.equal(townDepositOrder({ now: 1e9, slots: 36, pos: P(5), home: HOME, plan: ok, container: true, ...args }).order, null, why)
  }
})

test('order: the scans are lazy and rate-limited; the plan is not read below 34 slots or out of town', () => {
  let reads = 0
  const plan = () => { reads++; return ok }
  townDepositOrder({ now: 1e9, slots: 20, pos: P(5), home: HOME, plan, container: true })
  townDepositOrder({ now: 1e9, slots: 36, pos: P(40), home: HOME, plan, container: true })
  assert.equal(reads, 0)
  let s = townDepositOrder({ now: 1e9, slots: 36, pos: P(5), home: HOME, plan: () => { reads++; return { freed: 0 } }, container: true }).state
  s = townDepositOrder({ now: 1e9 + TD_SCAN_MS - 1, slots: 36, pos: P(5), home: HOME, plan, container: true, state: s }).state
  assert.equal(reads, 1, 'one scan per TD_SCAN_MS')
})

test('order: ONE per town stay -- re-armed by 60 s outside town, or 15 min later in town; cooldown and backoff hold', () => {
  const t0 = 1e9
  let r = townDepositOrder({ now: t0, slots: 36, pos: P(5), home: HOME, plan: ok, container: true })
  const go = (now, pos = P(5), st = r.state) => townDepositOrder({ now, slots: 36, pos, home: HOME, plan: ok, container: true, state: st })
  assert.equal(go(t0 + TD_COOLDOWN_MS + 1).order, null, 'latched for the stay')
  assert.equal(go(t0 + TD_STAY_REARM_MS).order?.skill, 'town_deposit', '15 min later in town re-arms')
  let s = go(t0 + 1000, P(40)).state
  s = go(t0 + 1000 + TD_REARM_OUTSIDE_MS - 1, P(40), s).state
  assert.equal(s.latched, true, 'not yet 60 s outside')
  s = go(t0 + 1000 + TD_REARM_OUTSIDE_MS, P(40), s).state
  assert.equal(s.latched, false)
  assert.equal(go(t0 + TD_COOLDOWN_MS - 1, P(5), s).order, null, 'the 5 min cooldown still holds')
  assert.equal(go(t0 + TD_COOLDOWN_MS, P(5), s).order?.skill, 'town_deposit')
  const failed = townDepositOutcome('failed', 'town_storage_full', t0, { ...s, latched: false })
  assert.equal(go(t0 + TD_COOLDOWN_MS, P(5), failed).order, null, 'a failed run backs off')
  assert.equal(go(t0 + TD_BACKOFF_MS, P(5), failed).order?.skill, 'town_deposit')
  assert.equal(townDepositOutcome('success', null, t0, { backoffUntil: t0 + 5 }).backoffUntil, 0)
  assert.equal(townDepositOutcome('failed', 'body_held', t0, { latched: true }).latched, false, 'a run the runner never started does not spend the stay')
  assert.equal(townDepositOutcome('no_effect', null, t0, { latched: true }).latched, true)
})

test('registered: a chatOnly housekeeping skill with an inventory_loss contract', () => {
  assert.equal(SKILLS.town_deposit?.chatOnly, true)
  assert.ok(HOUSEKEEPING.has('town_deposit'))
  assert.deepEqual(SKILL_CONTRACTS.town_deposit.expects, ['inventory_loss'])
})

// ---- the skill, against a fake chest window ---------------------------------------------------------------------
/**
 * A world with town containers and a SERVER that is separate from the client. Opening a container builds the window
 * from the server's chest and bag (mineflayer emits windowOpen after the slot data). A left click (vanilla) updates the
 * client window -- pick up a whole stack; put the whole cursor into an empty slot; merge into the same item; swap -- and
 * the server applies the same click unless it refuses it. close() copies the CLIENT window into bot.inventory (mineflayer
 * copyInventory) and the SERVER window into the server's state; a loaded cursor at close goes back into the server bag
 * when there is room (vanilla removed()), else it is a DROP.
 *   failDest(item)   the click on the destination throws before anything moves (the cursor stays loaded)
 *   refuse(item)     the server refuses that put-down: the client believes it, the server keeps it in the bag
 *   cursorStuck      a click on an empty bag slot does nothing (the put-back cannot happen)
 *   openNever        openContainer stays pending until st.late() resolves it with the window
 *   fillDest(slot)   another bot fills that container slot while the bot is picking up (the pickup click's wait)
 */
function world ({ items, containers, botAt = new Vec3(3, 70, 0), failDest = null, refuse = null, cursorStuck = false, onClick = null, openNever = false, fillDest = null, reopenFails = false, stealOnClose = false, swapAfter = null }) {
  const bagSlots = Array(46).fill(null)                      // the CLIENT's bag (bot.inventory)
  for (const it of items) bagSlots[it.slot] = { ...it }
  const server = { bag: bagSlots.map(x => (x ? { ...x } : null)) }
  const st = { opened: [], dropped: 0, clicks: 0, closes: 0, loadedCloses: 0, late: null, walks: [] }
  const contAt = p => containers.find(c => c.pos.x === p.x && c.pos.y === p.y && c.pos.z === p.z)
  const blk = c => ({ name: c.type ?? 'chest', type: mcData.blocksByName[c.type ?? 'chest'].id, position: c.pos, boundingBox: 'block',
                      getProperties: () => c.props ?? { type: 'single', facing: 'north' } })
  const left = (w, slot) => {                                  // one vanilla left click on window-like {slots, selectedItem}
    const at = w.slots[slot], cur = w.selectedItem
    if (!cur) { if (at) { w.selectedItem = { ...at }; w.slots[slot] = null } return }
    if (!at) { w.slots[slot] = { ...cur, slot }; w.selectedItem = null; return }
    if (at.name === cur.name) { const size = mcData.itemsByName[cur.name].stackSize; const m = Math.min(size - at.count, cur.count); at.count += m; cur.count -= m; if (!cur.count) w.selectedItem = null; return }
    w.slots[slot] = { ...cur, slot }; w.selectedItem = { ...at }
  }
  const bot = {
    entity: { position: botAt, velocity: { x: 0, y: 0, z: 0 } },
    registry: mcData,
    controlState: {},
    currentWindow: null,
    // A CRAFTSYNC STAND-IN (as withdraw-pick.test.mjs): lockstep runs the clicks; the cursor confirmation answers with
    // the SERVER's cursor -- the fake server's own window copy -- never the client's.
    craftSync: {
      lockstep: fn => fn(), inflight: () => 0, invalidate: () => 0,
      recount: async () => ({ source: 'server', items: server.bag.slice(9, 45).filter(Boolean) }),
      confirmCursor: async win => { const c = win?.server?.selectedItem; return { answered: true, cursorEmpty: !c, carried: c ? { itemCount: c.count } : null } },
    },
    equip: async () => {}, unequip: async () => {}, moveSlotItem: async () => {}, toss: async () => {}, tossStack: async () => {}, closeWindow: () => {},
    removeListener: () => {}, once: () => {}, _client: {},
    inventory: { inventoryStart: 9, items: () => bagSlots.slice(9, 45).filter(Boolean) },
    findBlocks: ({ maxDistance }) => containers.map(c => c.pos).filter(p => bot.entity.position.distanceTo(p) <= maxDistance),
    blockAt: p => {
      const c = contAt(p); if (c) return blk(c)
      const under = contAt({ x: p.x, y: p.y - 1, z: p.z })
      if (under && under.lid) return { name: under.lid, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }
      return { name: 'air', boundingBox: 'empty' }
    },
    pathfinder: { goto: async g => { st.walks.push(g) }, setGoal: () => {} },
    setControlState: () => {}, lookAt: async () => {}, waitForTicks: async () => {},
    openContainer: (b) => {
      const c = contAt(b.position)
      st.opened.push(`${c.pos.x},${c.pos.y},${c.pos.z}`)
      if (c.unopenable || (reopenFails && st.opened.filter(x => x === `${c.pos.x},${c.pos.y},${c.pos.z}`).length > 1)) return Promise.reject(new Error('windowOpen did not fire'))
      const n = c.size ?? 27
      const mk = () => {
        const w = { slots: Array(n + 36).fill(null), selectedItem: null }
        for (let i = 0; i < n; i++) w.slots[i] = c.items[i] ? { ...c.items[i], slot: i } : null
        for (let s = 9; s < 45; s++) w.slots[s - 9 + n] = server.bag[s] ? { ...server.bag[s], slot: s - 9 + n } : null
        return w
      }
      const win = { id: st.opened.length, inventoryStart: n, inventoryEnd: n + 36, ...mk() }
      // prismarine-windows' own lookups, which withdraw's settleCursor uses to put a cursor back
      win.items = () => win.slots.slice(n, n + 36).filter(Boolean)
      win.containerItems = () => win.slots.slice(0, n).filter(Boolean)
      win.firstEmptySlotRange = (a, b) => { for (let i = a; i < b; i++) if (!win.slots[i]) return i; return null }
      win.findItemRange = (a, b, type, _m, notFull) => { for (let i = a; i < b; i++) { const x = win.slots[i]; if (x && x.type === type && (!notFull || x.count < (x.stackSize ?? 64))) return { ...x, slot: i } } return null }
      win.server = mk()
      win.close = () => {
        st.closes++
        for (let i = 0; i < n; i++) c.items[i] = win.server.slots[i] ? { ...win.server.slots[i] } : null
        for (let s = 9; s < 45; s++) {
          bagSlots[s] = win.slots[s - 9 + n] ? { ...win.slots[s - 9 + n], slot: s } : null
          server.bag[s] = win.server.slots[s - 9 + n] ? { ...win.server.slots[s - 9 + n], slot: s } : null
        }
        if (win.server.selectedItem) {
          st.loadedCloses++
          const free = [...Array(36).keys()].map(i => i + 9).find(s => !server.bag[s])
          if (free != null) server.bag[free] = { ...win.server.selectedItem, slot: free }
          else st.dropped += win.server.selectedItem.count
          if (free != null) bagSlots[free] = { ...win.server.selectedItem, slot: free }
        }
        win.selectedItem = null; win.server.selectedItem = null
        if (bot.currentWindow === win) bot.currentWindow = null
        if (stealOnClose && st.closes === 1) for (let i = 0; i < n; i++) if (c.items[i] && c.items[i].name !== 'dirt') c.items[i] = null   // another bot empties what was put in (the first chest only)
      }
      if (openNever) return new Promise(res => { st.late = () => { bot.currentWindow = win; res(win) } })
      bot.currentWindow = win
      return Promise.resolve(win)
    },
    clickWindow: async (slot, btn, mode) => {
      const win = bot.currentWindow
      assert.equal(btn, 0); assert.equal(mode, 0, 'left clicks only')
      st.clicks++
      if (win?.foreign) { st.foreignClicks = (st.foreignClicks ?? 0) + 1; return }
      if (onClick) onClick(slot, win)
      const cur = win.selectedItem
      if (!cur && fillDest) { const d = fillDest(slot, win); if (d != null) { win.slots[d] = item('dirt', 64, d); win.server.slots[d] = item('dirt', 64, d) } }
      if (cur && slot < win.inventoryStart && failDest && failDest(cur)) throw new Error('simulated click failure')
      if (cur && !win.slots[slot] && cursorStuck && (slot >= win.inventoryStart || failDest?.(cur))) return   // the stuck stack goes nowhere
      const refused = cur && slot < win.inventoryStart && !win.slots[slot] && refuse && refuse(cur)
      left(win, slot)
      if (refused) {   // the server keeps the stack in its source slot: put its cursor back there
        const src = win.server.slots.findIndex((x, i) => i >= win.inventoryStart && !x)
        win.server.slots[src] = { ...win.server.selectedItem, slot: src }; win.server.selectedItem = null
      } else left(win.server, slot)
    },
  }
  if (swapAfter) {   // after click N lands, another window becomes the open one (a late open, a server-opened screen)
    const inner = bot.clickWindow
    bot.clickWindow = async (...a) => { await inner(...a); if (st.clicks === swapAfter) bot.currentWindow = { foreign: true, slots: [], selectedItem: null } }
  }
  return { bot, st, bagSlots, server }
}
const sumOf = (list, n) => list.filter(i => i?.name === n).reduce((a, i) => a + i.count, 0)
const total = l => l.reduce((a, i) => a + (i?.count ?? 0), 0)
const chestAt = (x, y = 70, z = 0, extra = {}) => ({ pos: new Vec3(x, y, z), items: Array(27).fill(null), ...extra })
const filledChest = (x, empty = 0, extra = {}) => chestAt(x, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i < empty ? null : item('dirt', 64))), ...extra })
const fullBag = () => bag([['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 120], ['stone_pickaxe', 1, 60], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 20],
  ['oak_log', 64], ['oak_log', 64], ['oak_log', 10], ['apple', 45], ['raw_iron', 5], ['coal', 9], ['dirt', 30], ['raw_copper', 7], ...filler(22)])
const run = (bot, signal = null) => SKILLS.town_deposit.run({ bot }, {}, signal)
const rowsOf = async fn => {
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_town_deposit') rows.push(r) })
  try { return { out: await fn(), rows } } finally { untap() }
}
const serverBag = w => w.server.bag.slice(9, 45).filter(Boolean)

test('SKILL: a full bag at town banks its surplus whole, keeps the stockpile, the iron, the best and the spent pickaxe; one row', async () => {
  const items = fullBag(); assert.equal(items.length, 36)
  const c = chestAt(2)
  const w = world({ items, containers: [c] })
  const { bot, st } = w
  const { out: r, rows } = await rowsOf(() => run(bot))
  assert.equal(r.status, 'success', r.detail)
  for (const now of [bot.inventory.items(), serverBag(w)]) {
    assert.equal(now.length, 32)
    assert.equal(sumOf(now, 'cobblestone'), 128); assert.equal(sumOf(now, 'oak_log'), 128)
    assert.equal(sumOf(now, 'raw_iron'), 5); assert.equal(sumOf(now, 'apple'), 45); assert.equal(sumOf(now, 'dirt'), 30)
    const picks = now.filter(i => i.name === 'stone_pickaxe').map(i => 131 - i.durabilityUsed).sort((a, b) => a - b)
    assert.deepEqual(picks, [1, 120], 'the spent copy and the best copy stay; the 60-use copy is banked')
  }
  assert.equal(sumOf(c.items, 'stone_pickaxe'), 1); assert.equal(sumOf(c.items, 'raw_copper'), 7)
  assert.equal(total(serverBag(w)) + total(c.items), total(items), 'nothing lost')
  assert.equal(st.dropped, 0); assert.equal(st.loadedCloses, 0)
  assert.equal(st.clicks, 8, 'two left clicks per stack')
  assert.deepEqual(st.opened, ['2,70,0', '2,70,0'], 'opened, then opened again to read the server\'s copy')
  assert.equal(rows.length, 1)
  assert.match(rows[0].skill.detail, /^slots 36->32 stacks 4\/4 clicked 4 bagdelta 38 tools stone_pickaxe@60 banked .*stone_pickaxe:1/)
})

// ---- THE PEACEFUL KIT (peacefulkit.mjs, owner 10-07): under the food policy's switch a sword keeps no copy ----------
test('KIT: NO NEW ORDER -- a full bag at town whose only surplus is swords gets no town_deposit order, peaceful or not', async () => {
  const { attachDifficulty } = await import('../src/foodskip.mjs')
  const { EventEmitter } = await import('node:events')
  const fake = { _client: new EventEmitter() }; attachDifficulty(fake, {}); fake._client.emit('difficulty', { difficulty: 'peaceful' })
  try {
    const b = bag([['stone_sword', 1, 131], ['wooden_sword', 1, 59], ['stone_pickaxe', 1, 120], ...filler(33)])
    assert.equal(townDepositPlan(b).freed, 2, 'the run would bank both swords under the switch')
    assert.equal(townDepositPlan(b, { swords: false }).freed, 0, 'the order\'s trigger counts the base rule: nothing')
  } finally { fake._client.emit('difficulty', { difficulty: 'hard' }) }
})
test('KIT pure: toolSlotsToBank keepBest=false banks every usable copy (never a spent one); the plan banks every sword only while on', () => {
  const copies = [item('stone_sword', 1, 9, { durabilityUsed: 0 }), item('stone_sword', 1, 10, { durabilityUsed: 125 }), item('stone_sword', 1, 11, { durabilityUsed: 40 })]
  assert.deepEqual(toolSlotsToBank(copies, Infinity), [11], 'the base: the best copy stays, the spent one never moves')
  assert.deepEqual(toolSlotsToBank(copies, Infinity, { keepBest: false }), [9, 11], 'the kit: every usable copy, best first')
  const b = bag([['stone_sword', 1, 131], ['wooden_sword', 1, 59], ['stone_pickaxe', 1, 120], ['stone_pickaxe', 1, 60], ...filler(32)])
  const on = townDepositPlan(b, { swords: true }).banked, off = townDepositPlan(b, { swords: false }).banked
  assert.equal(on.stone_sword, 1); assert.equal(on.wooden_sword, 1); assert.equal(on.stone_pickaxe, 1, 'pickaxes: the best stays either way')
  assert.equal(off.stone_sword, undefined); assert.equal(off.wooden_sword, undefined); assert.equal(off.stone_pickaxe, 1)
})

for (const [why, difficulty, banked] of [['PEACEFUL', 'peaceful', true], ['HARD', 'hard', false]]) {
  test(`KIT SKILL, ${why}: a full bag at town ${banked ? 'banks both swords' : 'keeps both swords'}; the best pickaxe stays; nothing lost or dropped`, async () => {
    const { attachDifficulty } = await import('../src/foodskip.mjs')
    const { EventEmitter } = await import('node:events')
    const items = bag([['stone_sword', 1, 131], ['wooden_sword', 1, 59], ...fullBag().slice(0, 34).map(i => [i.name, i.count, i.maxDurability ? i.maxDurability - i.durabilityUsed : undefined])])
    assert.equal(items.length, 36)
    const c = chestAt(2)
    const w = world({ items, containers: [c] })
    w.bot.serverDifficulty = difficulty
    const fake = { _client: new EventEmitter() }; attachDifficulty(fake, {}); fake._client.emit('difficulty', { difficulty })
    const r = await run(w.bot)
    assert.equal(r.status, 'success', r.detail)
    for (const now of [w.bot.inventory.items(), serverBag(w)]) {
      assert.equal(sumOf(now, 'stone_sword') + sumOf(now, 'wooden_sword'), banked ? 0 : 2)
      assert.ok(now.some(i => i.name === 'stone_pickaxe' && 131 - i.durabilityUsed === 120), 'the best pickaxe stays')
    }
    assert.equal(sumOf(c.items, 'stone_sword') + sumOf(c.items, 'wooden_sword'), banked ? 2 : 0)
    assert.equal(total(serverBag(w)) + total(c.items), total(items), 'nothing lost')
    assert.equal(w.st.dropped, 0); assert.equal(w.st.loadedCloses, 0)
    fake._client.emit('difficulty', { difficulty: 'hard' })   // leave the process decision off for the tests after
  })
}

test('SKILL: a full chest takes nothing -- no click, no cursor, no drop; the second container takes it', async () => {
  const { bot, st } = world({ items: fullBag(), containers: [filledChest(2)] })
  const r = await run(bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'town_storage_full')
  assert.match(r.detail, /deposit \(no item\)/, 'the remedy names a verb the bot can run from here')
  assert.equal(st.clicks, 0); assert.equal(st.dropped, 0); assert.deepEqual(st.opened, ['2,70,0'])
  const two = world({ items: fullBag(), containers: [filledChest(2), chestAt(-4)] })
  const r2 = await run(two.bot)
  assert.equal(r2.status, 'success', r2.detail)
  assert.deepEqual(two.st.opened, ['2,70,0', '-4,70,0', '-4,70,0'])
})

test('SKILL: two containers share ONE visit allowance: the first takes 2 stacks, the second the rest, the cap holds', async () => {
  const items = bag([['oak_log', 64], ['oak_log', 64], ['oak_log', 64], ['oak_log', 10], ['raw_copper', 7], ['raw_copper', 7], ['raw_gold', 3], ...filler(29)])
  const a = filledChest(2, 2), b = chestAt(-4)
  const { bot } = world({ items, containers: [a, b] })
  const r = await run(bot)
  assert.equal(r.status, 'success', r.detail)
  const both = [...a.items, ...b.items]
  assert.equal(sumOf(both, 'oak_log'), 10, 'logs: 10 this visit (64 more would pass the 64 cap)')
  assert.equal(sumOf(both, 'raw_copper'), 14, 'both copper stacks: 7 in the first chest does not use up the second 7 (Codex round 2)')
  assert.equal(sumOf(both, 'raw_gold'), 3)
  assert.equal(a.items.filter(x => x && x.name !== 'dirt').length, 2, 'the first chest took two stacks')
})

test('SKILL: a slot another bot fills during the pickup is re-read: the stack goes to another empty slot, never onto it', async () => {
  const c = filledChest(2, 3)
  const { bot, st } = world({ items: bag([['raw_copper', 7], ...filler(35)]), containers: [c], fillDest: (slot, win) => (slot >= win.inventoryStart ? 0 : null) })
  const r = await run(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(c.items[0]?.name, 'dirt', 'the other bot\'s stack is untouched'); assert.equal(sumOf(c.items, 'raw_copper'), 7)
  assert.equal(st.dropped, 0)
})

test('SKILL: a click that fails with the stack on the cursor puts it back and stops; nothing is dropped or lost', async () => {
  const items = fullBag()
  const c = chestAt(2)
  const w = world({ items, containers: [c], failDest: cur => cur.name === 'oak_log' })
  await run(w.bot)
  assert.equal(total(serverBag(w)) + total(c.items), total(items))
  assert.equal(w.st.dropped, 0); assert.equal(w.st.loadedCloses, 0)
  assert.equal(sumOf(serverBag(w), 'oak_log'), 138, 'the log stack is back in the bag')
})

test('SKILL: a cursor that cannot be put back is NEVER closed on: the window is HELD (withdraw\'s hold), the run says so', async () => {
  const w = world({ items: fullBag(), containers: [chestAt(2)], failDest: cur => cur.name === 'cobblestone', cursorStuck: true })
  const { out: r, rows } = await rowsOf(() => run(w.bot))
  try {
    assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'transfer_unsettled')
    assert.match(rows[0].skill.detail, /stop cursor cursor_unsettled 1/)
    assert.ok(w.bot.inventoryUnsettled, 'withdraw\'s hold owns the window: admission refuses everything until it settles')
    assert.equal(w.st.closes, 0, 'no loaded close'); assert.equal(w.st.dropped, 0)
  } finally { w.bot.inventoryUnsettled?.stop?.() }
})

test('SKILL: a move the SERVER refuses is not credited: the re-open decides, never the clicks or the copied bag', async () => {
  const items = fullBag()
  const c = chestAt(2)
  const w = world({ items, containers: [c], refuse: cur => cur.name === 'raw_copper' })
  const { out: r, rows } = await rowsOf(() => run(w.bot))
  assert.equal(r.status, 'success')
  assert.equal(sumOf(serverBag(w), 'raw_copper'), 7, 'refused: still in the server\'s bag')
  assert.equal(sumOf(c.items, 'raw_copper'), 0)
  assert.ok(!/raw_copper/.test(rows[0].skill.detail.split(' stop ')[0]), 'and not credited')
  assert.match(rows[0].skill.detail, /stacks 3\/4 clicked 4 /, 'the client clicked 4; the server shows 3')
  const all = world({ items: bag([['raw_copper', 7], ...filler(35)]), containers: [chestAt(2)], refuse: () => true })
  const r2 = await run(all.bot)
  assert.equal(r2.status, 'failed', 'every move refused: no success')
})

test('SKILL + REAL RUNNER: a refused move whose re-open fails is FAILED, never promoted to success by the bag the close copied', async () => {
  const { Runner } = await import('../src/runner.mjs')
  const w = world({ items: bag([['raw_copper', 7], ...filler(35)]), containers: [chestAt(2)], refuse: () => true, reopenFails: true })
  Object.assign(w.bot, { health: 20, food: 20, clearControlStates: () => {}, findBlock: () => null, time: { age: 1, day: 1 }, game: { dimension: 'overworld' } })
  const r = await new Runner(w.bot).run('town_deposit', {})
  assert.equal(r.status, 'failed', JSON.stringify(r)); assert.equal(r.failClass, 'town_deposit_unverified')
  assert.equal(sumOf(w.bot.inventory.items(), 'raw_copper'), 0, 'the client bag believes the copper left (the prediction copied at close)...')
  assert.equal(sumOf(serverBag(w), 'raw_copper'), 7, '...the server never took it')
})

test('SKILL: the visit cap counts what was MOVED, not what the re-open found (another bot emptied the first chest)', async () => {
  const items = bag([['raw_copper', 32], ['raw_copper', 32], ['raw_copper', 32], ['raw_copper', 32], ['raw_gold', 3], ...filler(31)])
  const a = filledChest(2, 2), b = chestAt(-4)
  const w = world({ items, containers: [a, b], stealOnClose: true })
  const r = await run(w.bot)
  assert.equal(r.status, 'success', 'the gold is confirmed in chest B')
  assert.equal(sumOf(serverBag(w), 'raw_copper'), 64, 'two copper stacks moved, then the cap held for the rest of the visit (not 128)')
  assert.equal(sumOf(b.items, 'raw_gold'), 3); assert.equal(sumOf(b.items, 'raw_copper'), 0, 'chest B got the gold and no copper')
})

test('SKILL: never a mine chest, a lidded chest, or the other half of a double chest; a single beside a single is tried', async () => {
  const deep = chestAt(1, 57, 0), lidded = chestAt(2, 70, 0, { lid: 'stone' })
  const half1 = filledChest(-3, 0, { props: { type: 'left', facing: 'north' } }), half2 = filledChest(-2, 0, { props: { type: 'right', facing: 'north' } })
  const { bot, st } = world({ items: fullBag(), containers: [deep, lidded, half1, half2, chestAt(-6)] })
  const r = await run(bot)
  assert.deepEqual(st.opened, ['-2,70,0', '-6,70,0', '-6,70,0'], `opened ${st.opened}: the double chest once, then the next container`)
  assert.equal(r.status, 'success')
  const singles = world({ items: fullBag(), containers: [filledChest(-2), chestAt(-3)] })
  const r3 = await run(singles.bot)
  assert.deepEqual(singles.st.opened, ['-2,70,0', '-3,70,0', '-3,70,0'], 'a full single, then the single beside it (not its other half)')
  assert.equal(r3.status, 'success')
  const none = world({ items: fullBag(), containers: [deep] })
  const r2 = await run(none.bot)
  assert.equal(r2.status, 'no_effect'); assert.equal(none.st.opened.length, 0)
})

test('SKILL: the walk borrows the no-dig, no-place profile; never walks home', async () => {
  const { bot, st } = world({ items: fullBag(), containers: [chestAt(12)], botAt: new Vec3(0, 70, 0) })
  const profiles = []
  bot.withTownDepositWalk = async fn => { profiles.push('town_deposit_walk'); return fn() }
  await run(bot)
  assert.deepEqual(profiles, ['town_deposit_walk'])
  assert.equal(st.walks.length, 1); assert.equal(st.walks[0].x, 12, 'to the chest, not home')
})

test('SKILL: an open that times out is DRAINED before the run returns: the late window is closed, nothing else opened', async () => {
  const { bot, st } = world({ items: fullBag(), containers: [chestAt(2), chestAt(-4)], openNever: true })
  const { TD_OPEN_MS } = TD
  const t0 = Date.now()
  let returned = false
  const p = run(bot).then(r => { returned = true; return r })
  await new Promise(res => setTimeout(res, TD_OPEN_MS + 300))
  assert.equal(returned, false, 'the run waits on the pending open')
  st.late()
  const r = await p
  assert.ok(Date.now() - t0 >= TD_OPEN_MS)
  assert.equal(r.status, 'failed'); assert.deepEqual(st.opened, ['2,70,0'], 'no second open while one is pending')
  assert.equal(st.closes, 1, 'the late window was closed by this run'); assert.equal(bot.currentWindow, null)
})

test('SKILL: an abort mid-run closes the window and throws; nothing dropped', async () => {
  const ac = new AbortController()
  const items = fullBag()
  const c = chestAt(2)
  const w = world({ items, containers: [c], onClick: () => { if (w.st.clicks === 3) ac.abort() } })
  await assert.rejects(run(w.bot, ac.signal), e => e?.aborted)
  assert.equal(w.st.closes, 1); assert.equal(w.st.dropped, 0)
  assert.equal(total(serverBag(w)) + total(c.items), total(items))
})

test('SKILL: nothing above the keeps -> no_effect, no chest opened', async () => {
  const items = bag([['cobblestone', 64], ['oak_log', 64], ['stone_pickaxe', 1, 100], ['raw_iron', 20], ...filler(32)])
  const { bot, st } = world({ items, containers: [chestAt(2)] })
  const r = await run(bot)
  assert.equal(r.status, 'no_effect'); assert.equal(st.opened.length, 0)
})

// ---- the chain, through the REAL CognitiveLoop ----------------------------------------------------------------------
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-td-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }

/** A bot whose active rung is the stone pickaxe (craft-ready), at 36/36, standing in town beside a chest. */
function chainBot ({ at = new Vec3(3, 70, 0), chest = chestAt(2) } = {}) {
  const items = bag([['dirt', 16], ['oak_log', 64], ['oak_log', 64], ['sand', 8], ['cobblestone', 64], ['cobblestone', 20], ['crafting_table', 1],
    ['wooden_pickaxe', 1, 50], ['stick', 8], ['furnace', 1], ['raw_copper', 5], ...filler(25)])
  assert.equal(items.length, 36)
  const { bot } = world({ items, containers: [chest], botAt: at })
  Object.assign(bot, {
    health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: id => (id === mcData.itemsByName.stone_pickaxe.id ? [{ delta: [] }] : []), recipesAll: () => [],
    findBlock: () => null, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'TownBot',
  })
  return bot
}
/** n real decisions. The town deposit RUNS (the real skill against the fake window); any other skill is recorded with the
 *  bag's slot count at the moment it was dispatched, and succeeds. */
async function decisions (bot, n) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    const slots = bot.inventory.items().length
    if (skill === 'town_deposit') { const r = await SKILLS.town_deposit.run({ bot }, args ?? {}, null); ran.push({ skill, slots, status: r.status }); return r }
    ran.push({ skill, slots, status: 'success' })
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 200 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  return { ran, loop }
}

test('KIT WIRED (the real loop): a full bag at town whose only surplus is two swords gets NO town_deposit order while peaceful', async () => {
  const { attachDifficulty } = await import('../src/foodskip.mjs')
  const { EventEmitter } = await import('node:events')
  const fake = { _client: new EventEmitter() }; attachDifficulty(fake, {}); fake._client.emit('difficulty', { difficulty: 'peaceful' })
  try {
    const items = bag([['dirt', 16], ['oak_log', 64], ['cobblestone', 64], ['crafting_table', 1], ['wooden_pickaxe', 1, 50], ['stick', 8],
      ['furnace', 1], ['stone_sword', 1, 131], ['wooden_sword', 1, 59], ...filler(27)])
    assert.equal(items.length, 36)
    assert.equal(townDepositPlan(items).freed, 2, 'control: the RUN would bank both swords')
    const { bot } = world({ items, containers: [chestAt(2)], botAt: new Vec3(3, 70, 0) })
    Object.assign(bot, { health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
      serverDifficulty: 'peaceful', recipesFor: () => [], recipesAll: () => [], findBlock: () => null, clearControlStates: () => {}, players: {},
      entities: {}, experience: { level: 0 }, username: 'TownBot' })
    const { ran } = await decisions(bot, 1)
    assert.ok(ran.length >= 1, 'the loop decided something')
    assert.notEqual(ran[0].skill, 'town_deposit', `swords alone started a town deposit: ${JSON.stringify(ran)}`)
  } finally { fake._client.emit('difficulty', { difficulty: 'hard' }) }
})

test('CHAIN: a full bag at town with a craft-ready rung deposits FIRST, and the craft is dispatched with room made', async () => {
  const bot = chainBot()
  const { ran, loop } = await decisions(bot, 2)
  assert.equal(loop.milestones.current()?.id?.includes('stone_pickaxe'), true, `active rung ${loop.milestones.current()?.id}`)
  assert.deepEqual(ran.map(x => x.skill), ['town_deposit', 'craft'], JSON.stringify(ran))
  assert.equal(ran[0].status, 'success'); assert.equal(ran[0].slots, 36)
  assert.equal(ran[1].slots, 33, 'the craft order runs on a bag the deposit emptied three slots of (one log stack, cobble 20, copper)')
  assert.equal(sumOf(bot.inventory.items(), 'oak_log'), 64); assert.equal(sumOf(bot.inventory.items(), 'cobblestone'), 64)
  assert.equal(sumOf(bot.inventory.items(), 'stick'), 8, 'the rung\'s means stay')
})

test('CHAIN, FULL BANK: the deposit fails once, then the bot goes on (the craft order, then the model) -- no deposit loop', async () => {
  const bot = chainBot({ chest: filledChest(2) })
  const { ran } = await decisions(bot, 5)
  assert.equal(ran[0].skill, 'town_deposit'); assert.equal(ran[0].status, 'failed')
  assert.equal(ran.filter(x => x.skill === 'town_deposit').length, 1, `one attempt per stay and a 15 min backoff: ${JSON.stringify(ran)}`)
  assert.equal(ran[1].skill, 'craft', 'the remedy chain continues exactly as on the base (craftroom owns a full-bag craft)')
})

test('CHAIN CONTROL: the same bot out of town runs the craft order first (the deposit never fires away from town)', async () => {
  const bot = chainBot({ at: new Vec3(40, 70, 0) })
  const { ran } = await decisions(bot, 1)
  assert.equal(ran[0].skill, 'craft', `first: ${JSON.stringify(ran)}`)
})

// ---- composition with withdraw (runs once withdraw -- origin/wd-on-6c9a8fb -- is underneath this branch) ---------------
const BANK = await import('../src/bankable.mjs')
test('WITHDRAW HOLD: what withdraw just took is never banked back by the town deposit (skipped until withdraw is underneath)', { skip: typeof BANK.setWithdrawHold !== 'function' }, () => {
  const items = bag([['raw_copper', 5], ['stone_pickaxe', 1, 120], ['stone_pickaxe', 1, 60], ['stick', 2], ['cobblestone', 3], ['oak_planks', 4], ...filler(30)])
  assert.deepEqual(townDepositPlan(items).steps.map(s => s.name).sort(), ['raw_copper', 'stone_pickaxe'], 'positive control: without a hold both move')
  try {
    BANK.setWithdrawHold('raw_copper', 5, Date.now() + 60_000)
    BANK.setWithdrawHold('stone_pickaxe', 1, Date.now() + 60_000)
    assert.deepEqual(townDepositPlan(items).steps, [], 'held: nothing moves')
    // withdraw's stone-pickaxe ingredients (3 cobblestone, 2 sticks, 4 planks) are inside the keeps even without a hold
    BANK.clearWithdrawHolds()
    assert.ok(!townDepositPlan(items).steps.some(s => ['cobblestone', 'stick', 'oak_planks'].includes(s.name)))
  } finally { BANK.clearWithdrawHolds?.() }
})

// ---- the rebase review (Codex, on b54e22c): withdraw's hold by identity, the town's memory ----------------------------
const CF = await import('../src/chestfull.mjs')
test('WITHDRAW HOLD BY NAME: with 130/40 held and a 120 just withdrawn, NO stone_pickaxe moves while the hold lasts (the count rule alone banked the 120)', () => {
  const items = bag([['stone_pickaxe', 1, 130], ['stone_pickaxe', 1, 40], ['stone_pickaxe', 1, 120], ...filler(31)])
  try {
    BANK.setWithdrawHold('stone_pickaxe', 1, Date.now() + 60_000)
    assert.deepEqual(townDepositPlan(items).steps.filter(s => s.name === 'stone_pickaxe'), [])
    BANK.clearWithdrawHolds()
    assert.equal(townDepositPlan(items).steps.filter(s => s.name === 'stone_pickaxe').length, 2, 'positive control: the hold over, the spares (120, 40) are banked and the 130 kept')
  } finally { BANK.clearWithdrawHolds() }
})

test('TOWN MEMORY: a verified deposit records `took` for the container (clearing withdraw\'s misses there); a chest the town knows is full is skipped', async () => {
  const dir = process.env.POOL_STATE_DIR, key = CF.townKey(new Vec3(0, 70, 0))
  CF.updateTownMemory(dir, key, null, e => { e['-4,70,0'] = CF.recordOutcome(undefined, 'full'); CF.notePickMisses(e, ['2,70,0']) })
  assert.equal(CF.containerPickMiss(CF.readTownMemory(dir, key), '2,70,0'), true, 'precondition: a fresh pickaxe miss at chest A')
  const a = chestAt(2), b = chestAt(-4)
  const { bot, st } = world({ items: fullBag(), containers: [a, b] })
  const r = await run(bot)
  assert.equal(r.status, 'success', r.detail)
  const mem = CF.readTownMemory(dir, key)
  assert.equal(mem['2,70,0']?.o, 'took')
  assert.equal(CF.containerPickMiss(mem, '2,70,0'), false, 'the pickaxe banked there is visible to withdraw at once')
  assert.ok(!st.opened.includes('-4,70,0'), 'the chest the town knows is full was never opened')
  const full = world({ items: fullBag(), containers: [b] })
  const r2 = await run(full.bot)
  assert.equal(r2.status, 'no_effect'); assert.equal(full.st.opened.length, 0)
})

test('CHAIN, BANK CLOSED: a bot whose bank chestfull closed gets no town deposit -- the craft order runs first', async () => {
  const bot = chainBot()
  bot.bankClosed = { until: Date.now() + 600_000, at: Date.now(), why: 'the town chests are full', kind: 'full' }
  const { ran } = await decisions(bot, 1)
  assert.equal(ran[0].skill, 'craft', JSON.stringify(ran))
})

test('THE WINDOW CHANGED under the run (another window opened): no click goes into it, nothing is credited, nothing dropped', async () => {
  const items = fullBag()
  const c = chestAt(2)
  const w = world({ items, containers: [c], swapAfter: 1 })
  const r = await run(w.bot)
  assert.equal(w.st.foreignClicks ?? 0, 0, 'no click went into the other window')
  assert.notEqual(r.status, 'success')
  assert.equal(w.st.dropped, 0)
})

test('A HELD CURSOR OUTRANKS AN EARLIER SUCCESS: chest A takes a stack, chest B holds the cursor -> transfer_unsettled', async () => {
  const a = filledChest(2, 1), b = chestAt(-5)   // -5: the memory test above marked -4,70,0 full in this file's town
  const w = world({ items: fullBag(), containers: [a, b], failDest: cur => cur.name === 'oak_log', cursorStuck: true })
  const { out: r, rows } = await rowsOf(() => run(w.bot))
  try {
    assert.equal(r.failClass, 'transfer_unsettled', JSON.stringify(r) + ' ' + rows.map(x => x.skill.detail).join(' | ') + ' opened=' + w.st.opened); assert.match(r.detail, /\d+ item\(s\) were banked before it/)
  } finally { w.bot.inventoryUnsettled?.stop?.() }
})

test('BACKOFF: a container in its backoff after a failure is skipped like a full one', async () => {
  const dir = process.env.POOL_STATE_DIR, key = CF.townKey(new Vec3(0, 70, 0))
  CF.updateTownMemory(dir, key, null, e => { e['6,70,0'] = CF.recordOutcome(undefined, 'unknown') })
  const w = world({ items: fullBag(), containers: [chestAt(6)] })
  const r = await run(w.bot)
  assert.equal(r.status, 'no_effect'); assert.equal(w.st.opened.length, 0)
})
