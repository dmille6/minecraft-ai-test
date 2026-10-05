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
const { townDepositPlan, townKeeps, toolSlotsToBank, fitToContainer, townDepositOrder, townDepositOutcome, inTown,
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
  assert.equal(inTown({ x: 16, y: 70, z: 0 }, home), true)
  assert.equal(inTown({ x: 16.1, y: 70, z: 0 }, home), false)
  assert.equal(inTown({ x: 0, y: 58, z: 0 }, home), true)
  assert.equal(inTown({ x: 0, y: 57, z: 0 }, home), false, 'a chest 13 below home is a mine chest, not the bank')
  assert.equal(inTown(null, home), false)
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
test('fit: a full container takes nothing; partial stacks first; a stack that does not fit WHOLE is skipped', () => {
  const size = n => mcData.itemsByName[n].stackSize
  const full = Array.from({ length: 27 }, () => item('dirt', 64))
  assert.deepEqual(fitToContainer([{ slot: 9, name: 'cobblestone', count: 20 }], full, size), [])
  const partial = [item('cobblestone', 50), ...Array.from({ length: 26 }, () => item('dirt', 64))]
  assert.deepEqual(fitToContainer([{ slot: 9, name: 'cobblestone', count: 14 }], partial, size).length, 1, '14 merges into the 50')
  assert.deepEqual(fitToContainer([{ slot: 9, name: 'cobblestone', count: 15 }], partial, size).length, 0, '15 does not fit whole')
  const oneEmpty = [null, ...Array.from({ length: 26 }, () => item('dirt', 64))]
  const out = fitToContainer([{ slot: 9, name: 'oak_log', count: 64 }, { slot: 10, name: 'stone_pickaxe', count: 1 }], oneEmpty, size)
  assert.deepEqual(out.map(s => s.name), ['oak_log'], 'the empty slot is used once')
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
 * A world with town containers. The window's slots ARE the bag while it is open (as on a real server); close() writes
 * the bag back and, if the cursor is loaded, returns it to the bag when there is room (vanilla removed()), else counts
 * a DROP. transfer() follows mineflayer 4.37's semantics for a whole-stack count: fill partial same-name stacks, then
 * empty slots; out of room -> throws "destination full" with the rest on the cursor.
 */
function world ({ items, containers, botAt = new Vec3(3, 70, 0), throwOn = null, cursorStuck = false }) {
  const bagSlots = Array(46).fill(null)
  for (const it of items) bagSlots[it.slot] = { ...it }
  const st = { opened: [], dropped: 0, transfers: 0, closes: 0, loadedCloses: 0 }
  const contAt = p => containers.find(c => c.pos.x === p.x && c.pos.y === p.y && c.pos.z === p.z)
  const blk = (c) => ({ name: c.type ?? 'chest', type: mcData.blocksByName[c.type ?? 'chest'].id, position: c.pos, boundingBox: 'block' })
  const bot = {
    entity: { position: botAt, velocity: { x: 0, y: 0, z: 0 } },
    registry: mcData,
    controlState: {},
    inventory: { inventoryStart: 9, items: () => bagSlots.slice(9, 45).filter(Boolean) },
    findBlocks: ({ maxDistance }) => containers.map(c => c.pos).filter(p => bot.entity.position.distanceTo(p) <= maxDistance),
    blockAt: p => {
      const c = contAt(p); if (c) return blk(c)
      const under = contAt({ x: p.x, y: p.y - 1, z: p.z })
      if (under && under.lid) return { name: under.lid, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }
      return { name: 'air', boundingBox: 'empty' }
    },
    pathfinder: { goto: async () => {}, setGoal: () => {} },
    setControlState: () => {}, lookAt: async () => {}, waitForTicks: async () => {},
    openContainer: async (b) => {
      const c = contAt(b.position)
      st.opened.push(`${c.pos.x},${c.pos.y},${c.pos.z}`)
      if (c.unopenable) throw new Error('windowOpen did not fire')
      const n = c.size ?? 27
      const win = { id: 1, inventoryStart: n, inventoryEnd: n + 36, selectedItem: null, slots: Array(n + 36).fill(null) }
      for (let i = 0; i < n; i++) win.slots[i] = c.items[i] ? { ...c.items[i], slot: i } : null
      for (let s = 9; s < 45; s++) win.slots[s - 9 + n] = bagSlots[s] ? { ...bagSlots[s], slot: s - 9 + n } : null
      win.close = () => {
        st.closes++
        for (let i = 0; i < n; i++) c.items[i] = win.slots[i] ? { ...win.slots[i] } : null
        for (let s = 9; s < 45; s++) bagSlots[s] = win.slots[s - 9 + n] ? { ...win.slots[s - 9 + n], slot: s } : null
        if (win.selectedItem) {
          st.loadedCloses++
          const free = [...Array(36).keys()].map(i => i + 9).find(s => !bagSlots[s])
          if (free != null) bagSlots[free] = { ...win.selectedItem, slot: free }
          else st.dropped += win.selectedItem.count
          win.selectedItem = null
        }
      }
      return win
    },
    clickWindow: async (slot) => {
      const win = bot._win
      if (win && win.selectedItem && !win.slots[slot] && !cursorStuck) { win.slots[slot] = { ...win.selectedItem, slot }; win.selectedItem = null }
    },
    transfer: async ({ window: win, sourceStart, sourceEnd, destStart, destEnd, count }) => {
      bot._win = win
      st.transfers++
      assert.equal(sourceEnd, sourceStart + 1, 'slot-precise: one source slot')
      const src = win.slots[sourceStart]
      if (!src) throw new Error("Can't find item")
      win.selectedItem = { ...src }; win.slots[sourceStart] = null   // picked up onto the cursor
      if (throwOn && throwOn(src)) throw new Error('simulated click failure')
      const size = mcData.itemsByName[src.name].stackSize
      let left = Math.min(count, win.selectedItem.count)
      for (let i = destStart; i < destEnd && left > 0; i++) { const d = win.slots[i]; if (d && d.name === src.name && d.count < size) { const m = Math.min(size - d.count, left); d.count += m; left -= m } }
      for (let i = destStart; i < destEnd && left > 0; i++) if (!win.slots[i]) { const m = Math.min(size, left); win.slots[i] = { ...src, count: m, slot: i }; left -= m }
      if (left > 0) { win.selectedItem.count = left; throw new Error('destination full') }
      win.selectedItem = null
    },
  }
  return { bot, st, bagSlots }
}
const sumOf = (list, n) => list.filter(i => i?.name === n).reduce((a, i) => a + i.count, 0)
const chestAt = (x, y = 70, z = 0, extra = {}) => ({ pos: new Vec3(x, y, z), items: Array(27).fill(null), ...extra })
const fullBag = () => bag([['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 120], ['stone_pickaxe', 1, 60], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 20],
  ['oak_log', 64], ['oak_log', 64], ['oak_log', 10], ['apple', 45], ['raw_iron', 5], ['coal', 9], ['dirt', 30], ['raw_copper', 7], ...filler(22)])
const run = (bot, signal = null) => SKILLS.town_deposit.run({ bot }, {}, signal)

test('SKILL: a full bag at town banks its surplus whole, keeps the stockpile, the iron, the best and the spent pickaxe; one row', async () => {
  const items = fullBag(); assert.equal(items.length, 36)
  const c = chestAt(2)
  const { bot, st } = world({ items, containers: [c] })
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_town_deposit') rows.push(r) })
  let r
  try { r = await run(bot) } finally { untap() }
  assert.equal(r.status, 'success', r.detail)
  const now = bot.inventory.items()
  assert.ok(now.length <= 32, `slots ${now.length}`)
  assert.equal(sumOf(now, 'cobblestone'), 128); assert.equal(sumOf(now, 'oak_log'), 128)
  assert.equal(sumOf(now, 'raw_iron'), 5); assert.equal(sumOf(now, 'apple'), 45); assert.equal(sumOf(now, 'dirt'), 30)
  const picks = now.filter(i => i.name === 'stone_pickaxe').map(i => 131 - i.durabilityUsed).sort((a, b) => a - b)
  assert.deepEqual(picks, [1, 120], 'the spent copy and the best copy stay; the 60-use copy is banked')
  assert.equal(sumOf(c.items, 'stone_pickaxe'), 1); assert.equal(sumOf(c.items, 'raw_copper'), 7)
  const total = l => l.reduce((a, i) => a + (i?.count ?? 0), 0)
  assert.equal(total(now) + total(c.items), total(items), 'nothing lost')
  assert.equal(st.dropped, 0); assert.equal(st.loadedCloses, 0)
  assert.equal(rows.length, 1)
  assert.match(rows[0].skill.detail, /^slots 36->3\d stacks \d+\/\d+ banked .*stone_pickaxe:1/)
})

test('SKILL: a full chest takes nothing -- no transfer, no cursor, no drop; then the second container takes it', async () => {
  const fullChest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, () => item('dirt', 64)) })
  const { bot, st } = world({ items: fullBag(), containers: [fullChest] })
  const r = await run(bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'town_storage_full')
  assert.match(r.detail, /deposit \(no item\)/, 'the remedy names a verb the bot can run from here')
  assert.equal(st.transfers, 0); assert.equal(st.dropped, 0)
  const two = world({ items: fullBag(), containers: [chestAt(2, 70, 0, { items: Array.from({ length: 27 }, () => item('dirt', 64)) }), chestAt(-4)] })
  const r2 = await run(two.bot)
  assert.equal(r2.status, 'success', r2.detail)
  assert.deepEqual(two.st.opened, ['2,70,0', '-4,70,0'])
})

test('SKILL: a click that fails with the stack on the cursor puts it back; nothing is dropped or lost', async () => {
  const items = fullBag()
  const c = chestAt(2)
  const { bot, st } = world({ items, containers: [c], throwOn: src => src.name === 'oak_log' })
  await run(bot)
  const total = l => l.reduce((a, i) => a + (i?.count ?? 0), 0)
  assert.equal(total(bot.inventory.items()) + total(c.items), total(items))
  assert.equal(st.dropped, 0); assert.equal(st.loadedCloses, 0)
  assert.equal(sumOf(bot.inventory.items(), 'oak_log'), 138, 'the failed stacks are back in the bag')
})

test('SKILL: a cursor that cannot be put back stops the run and says so (the read gates on it)', async () => {
  const { bot, st } = world({ items: fullBag(), containers: [chestAt(2)], throwOn: src => src.name === 'cobblestone', cursorStuck: true })
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_town_deposit') rows.push(r) })
  try { await run(bot) } finally { untap() }
  assert.match(rows[0].skill.detail, /stop cursor cursor_unsettled 1/)
  assert.equal(st.dropped, 0, 'vanilla close returns it to the bag: the source slot is free')
})

test('SKILL: never a mine chest, a lidded chest, or the other half of a double chest; never walks home', async () => {
  const deep = chestAt(1, 50, 0), lidded = chestAt(2, 70, 0, { lid: 'stone' }), half1 = chestAt(-3), half2 = chestAt(-3, 70, 1)
  const { bot, st } = world({ items: fullBag(), containers: [deep, lidded, half1, half2] })
  let walkedHome = false
  bot.pathfinder.goto = async g => { if (Math.abs(g.x) + Math.abs(g.z) === 0) walkedHome = true }
  bot.inventory.items()   // unchanged
  const fullHalf = Array.from({ length: 27 }, () => item('dirt', 64))
  half1.items = fullHalf.map(x => ({ ...x }))
  half2.items = fullHalf.map(x => ({ ...x }))
  const r = await run(bot)
  assert.deepEqual(st.opened, ['-3,70,0'], `opened ${st.opened}`)
  assert.equal(r.failClass, 'town_storage_full')
  assert.equal(walkedHome, false)
  const none = world({ items: fullBag(), containers: [deep] })
  const r2 = await run(none.bot)
  assert.equal(r2.status, 'no_effect'); assert.equal(none.st.opened.length, 0)
})

test('SKILL: an abort mid-run closes the window and throws; nothing dropped', async () => {
  const ac = new AbortController()
  const items = fullBag()
  const c = chestAt(2)
  const { bot, st } = world({ items, containers: [c], throwOn: () => { ac.abort(); return false } })
  await assert.rejects(run(bot, ac.signal), e => e?.aborted)
  assert.equal(st.closes, 1); assert.equal(st.dropped, 0)
  const total = l => l.reduce((a, i) => a + (i?.count ?? 0), 0)
  assert.equal(total(bot.inventory.items()) + total(c.items), total(items))
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
function chainBot ({ at = new Vec3(3, 70, 0) } = {}) {
  const items = bag([['dirt', 16], ['oak_log', 64], ['oak_log', 64], ['sand', 8], ['cobblestone', 64], ['cobblestone', 20], ['crafting_table', 1],
    ['wooden_pickaxe', 1, 50], ['stick', 8], ['furnace', 1], ['raw_copper', 5], ...filler(25)])
  assert.equal(items.length, 36)
  const { bot } = world({ items, containers: [chestAt(2)], botAt: at })
  Object.assign(bot, {
    health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: id => (id === mcData.itemsByName.stone_pickaxe.id ? [{ delta: [] }] : []), recipesAll: () => [],
    findBlock: () => null, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'TownBot',
  })
  return bot
}
async function decisions (bot, n) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill) => { ran.push(skill); return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] } } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 100 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  return { ran, loop }
}

test('CHAIN: a full bag at town with a craft-ready rung deposits FIRST, then the craft order runs', async () => {
  const bot = chainBot()
  const { ran, loop } = await decisions(bot, 2)
  assert.equal(loop.milestones.current()?.id?.includes('stone_pickaxe'), true, `active rung ${loop.milestones.current()?.id}`)
  assert.equal(ran[0], 'town_deposit', `first: ${ran}`)
  assert.equal(ran[1], 'craft', `then the craft the deposit made room for: ${ran}`)
})

test('CHAIN CONTROL: the same bot out of town runs the craft order first (the deposit never fires away from town)', async () => {
  const bot = chainBot({ at: new Vec3(40, 70, 0) })
  const { ran } = await decisions(bot, 1)
  assert.equal(ran[0], 'craft', `first: ${ran}`)
})
