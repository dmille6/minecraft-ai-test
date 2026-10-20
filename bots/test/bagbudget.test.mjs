// THE BAG ALLOWANCE (bagbudget-01; docs/reports/bagbudget-01-design-2026-10-20.md): one table every keep layer reads, and
// a full bag at town banks the chest rows' surplus. Behaviour first: the plan, the order's deletion wait, the wear-out's
// last-swing row and the no_effect classes are pure exports run over fixtures and seeded random full bags. Structural
// checks only for what behaviour cannot reach (a constant shared with reflex.mjs). Anchored mutants at the end.
// The skill and the real-loop chain are in towndeposit.test.mjs (its fake chest world).
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-bagbudget'
process.env.BOT_NAME = process.env.BOT_NAME || 'BagBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'bb-pool-'))

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

const BA = await import('../src/bagallowance.mjs')
const TD = await import('../src/towndeposit.mjs')
const BK = await import('../src/bankable.mjs')
const ST = await import('../src/stocktarget.mjs')
const WL = await import('../src/well.mjs')
const HY = await import('../src/hygiene.mjs')
const CP = await import('../src/composter.mjs')
const LD = await import('../src/ladder.mjs')
const TD_TOOLFOR = await import('../src/toolfor.mjs')
const { townDepositPlan, townDepositOrder, fullBagLeft, notForChest, bankOwned, townKeeps, TD_TRIGGER_SLOTS, TD_DELETION_WAIT_MS, TD_SCAN_MS } = TD
const { ALLOWANCE, rowKeep, allowanceRow, LADDER_ESCAPE_MIN } = BA

// ---- fixtures ---------------------------------------------------------------------------------------------------
const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$/
function item (name, count = 1, slot = 9, extra = {}) {
  const def = mcData.itemsByName[name]
  assert.ok(def, `unknown item ${name}`)
  const it = { name, count, slot, type: def.id, stackSize: def.stackSize, ...extra }
  if (TOOL.test(name)) { it.maxDurability = def.maxDurability; it.durabilityUsed = extra.durabilityUsed ?? 0 }
  return it
}
function bag (rows) {
  return rows.map(([name, count, uses], i) => {
    const max = mcData.itemsByName[name].maxDurability
    return item(name, count, 9 + i, uses != null ? { durabilityUsed: max - uses } : {})
  })
}
// kept whole by row R, never junk, never compost, never a chest's: the neutral filler
const filler = n => Array.from({ length: n }, (_, i) => ['oak_slab', 1 + (i % 3)])
const names = p => p.steps.filter(s => s.allowance).map(s => s.name).sort()
const countsOf = l => { const c = {}; for (const i of l) c[i.name] = (c[i.name] ?? 0) + i.count; return c }
function stripComments (s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') }

// ---- ONE TABLE: every layer's constant is the table's ------------------------------------------------------------
test('every keep layer reads its number from the table (values unchanged from the deployed constants)', () => {
  assert.equal(BK.COBBLE_RESERVE, ALLOWANCE.cobble); assert.equal(BK.COBBLE_RESERVE, 64)
  assert.equal(BK.RESERVE_RECIPE, ALLOWANCE.recipeSticks); assert.equal(BK.RESERVE_RECIPE, 2)
  assert.deepEqual([...BK.KEEP_ONE].sort(), ['blast_furnace', 'bucket', 'crafting_table', 'furnace', 'lava_bucket', 'smoker', 'water_bucket'])
  assert.equal(TD.STOCKPILE_KEEP, ALLOWANCE.stockpile); assert.equal(TD.WANTED_KEEP, ALLOWANCE.wanted); assert.equal(TD.PLANKS_MEANS, ALLOWANCE.planksMeans)
  assert.deepEqual({ ...TD.HELD_TARGETS }, { dirt: 16, sand: 8 }); assert.equal(TD.HELD_TARGETS.dirt, ALLOWANCE.dirt)
  assert.equal(ST.STOCK_RESERVE, ALLOWANCE.stack); assert.equal(ST.STOCK_RESERVE, 64)
  assert.equal(WL.STONE_GUARD, ALLOWANCE.cobble); assert.equal(WL.COBBLE_WELL_RESERVE, ALLOWANCE.cobble)
  assert.equal(HY.SPENT_PICKAXES_KEPT, ALLOWANCE.spentPickaxes); assert.equal(HY.SPENT_PICKAXES_KEPT, 3)
  assert.equal(CP.SAPLING_RESERVE, ALLOWANCE.saplingReserve); assert.equal(CP.SAPLING_RESERVE, 16)
  assert.equal(CP.APPLE_RESERVE, ALLOWANCE.appleReserve); assert.equal(CP.APPLE_RESERVE, 4)
})

test('the ladder row asks ladderPlan: 26 ladders for the 25-block climb reflex.mjs ladderReady asks (structural, comments stripped)', () => {
  assert.equal(LADDER_ESCAPE_MIN, 26)
  assert.equal(LD.ladderPlan({ need: BA.LADDER_CLIMB_NEED, have: LADDER_ESCAPE_MIN - 1, reach: BA.LADDER_CLIMB_NEED }).ok, false)
  assert.equal(LD.ladderPlan({ need: BA.LADDER_CLIMB_NEED, have: LADDER_ESCAPE_MIN, reach: BA.LADDER_CLIMB_NEED }).ok, true)
  const src = stripComments(readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8'))
  assert.equal((src.match(/^const PILLAR_MAX_BLOCKS = (\d+)$/m) ?? [])[1], String(BA.LADDER_CLIMB_NEED - 1), 'PILLAR_MAX_BLOCKS + 1 is the climb')
  assert.ok(/const need = PILLAR_MAX_BLOCKS \+ 1\n\s*const wall = bestLadderWall/.test(src), 'ladderReady still asks PILLAR_MAX_BLOCKS + 1')
})

test('row F is reflex.mjs FOOD_PRIORITY exactly, and row M is well.mjs BUILDING_STONES exactly', () => {
  const src = stripComments(readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8'))
  const lit = src.match(/^const FOOD_PRIORITY = \[([\s\S]*?)\]/m)
  assert.ok(lit, 'reflex.mjs FOOD_PRIORITY found')
  const reflexFoods = [...lit[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
  assert.deepEqual([...BA.FOOD_PRIORITY], reflexFoods)
  assert.deepEqual([...BA.BUILDING_CHEST], [...WL.BUILDING_STONES])
  for (const n of BA.FOOD_PRIORITY) assert.ok(mcData.foodsByName[n], `${n} is food`)
})

test('BAG_ALLOWANCE: on|off, default on, anything else on with a note', () => {
  assert.deepEqual(BA.bagAllowanceMode({}), { on: true, mode: 'on', note: null })
  assert.deepEqual(BA.bagAllowanceMode({ BAG_ALLOWANCE: 'OFF' }), { on: false, mode: 'off', note: null })
  assert.equal(BA.bagAllowanceMode({ BAG_ALLOWANCE: 'maybe' }).on, true)
  assert.match(BA.bagAllowanceMode({ BAG_ALLOWANCE: 'maybe' }).note, /unreadable/)
  assert.match(BA.bagBudgetModeDetail(), /^phase=mode on=1 mode=on rows=station:1,torch:0,ladder:0<26,bone_meal:0,food:1kind,building:0 cobble=64/)
})

// ---- the rows -----------------------------------------------------------------------------------------------------
test('rows: which kind keeps what (a whole kind or nothing)', () => {
  const c = { torch: 20, ladder: 5, bone_meal: 9, crafting_table: 3, chest: 12, composter: 1, cooked_beef: 4, apple: 8, carrot: 3, stone_bricks: 7, white_bed: 1, oak_slab: 30, amethyst_block: 4 }
  assert.equal(rowKeep('torch', c), 0); assert.equal(rowKeep('bone_meal', c), 0); assert.equal(rowKeep('ladder', c), 0)
  assert.equal(rowKeep('ladder', { ladder: 26 }), Infinity, '26+ ladders are the escape rung\'s: all stay')
  for (const n of ['crafting_table', 'chest', 'composter', 'furnace', 'bucket']) assert.equal(rowKeep(n, c), 1, n)
  assert.equal(rowKeep('cooked_beef', c), Infinity, 'the best eaten food stays whole'); assert.equal(rowKeep('apple', c), 0); assert.equal(rowKeep('carrot', c), 0)
  assert.equal(rowKeep('stone_bricks', c), 0, 'building stone goes to the town')
  assert.equal(rowKeep('white_bed', c), Infinity); assert.equal(rowKeep('oak_slab', c), Infinity)
  assert.equal(allowanceRow('amethyst_block'), 'unlisted'); assert.equal(rowKeep('amethyst_block', c), Infinity, 'UNLISTED STAYS (allowlist polarity)')
  assert.equal(rowKeep('salmon', { salmon: 5 }), Infinity, 'a food the reflex never eats is on no row')
})

test('junk, compost inputs and saplings are never a chest\'s; the peaceful switch adds its plants and apples', () => {
  for (const n of ['egg', 'flint', 'white_wool', 'glass', 'leaf_litter', 'wheat_seeds', 'oak_sapling', 'birch_sapling', 'cherry_sapling', 'bamboo', 'rail', 'pointed_dripstone', 'short_grass', 'poppy'])
    assert.equal(notForChest(n, { peaceful: false }), true, n)
  for (const n of ['blue_orchid', 'melon_slice', 'sweet_berries', 'apple']) {
    assert.equal(notForChest(n, { peaceful: true }), true, `${n} in a peaceful world is the composter's`)
  }
  assert.equal(notForChest('apple', { peaceful: false }), false, 'an apple outside a peaceful world is food')
  for (const n of ['torch', 'ladder', 'bone_meal', 'stone_bricks', 'cooked_beef', 'crafting_table']) assert.equal(notForChest(n, { peaceful: true }), false, n)
  for (const n of ['stone_pickaxe', 'cobblestone', 'oak_log', 'stick', 'dirt', 'raw_iron', 'coal', 'iron_ingot', 'diamond', 'raw_copper']) assert.equal(bankOwned(n), true, `${n} is another layer's`)
})

// THE MEASURED MIX (10-20 W3, a median full bag): cobble 9 slots, kit 6, pickaxes 3, logs 2, saplings 2, bamboo 3, misc
const measuredBag = () => bag([
  ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 50],
  ['bucket', 1], ['furnace', 1], ['crafting_table', 2], ['chest', 12], ['torch', 11], ['ladder', 4],
  ['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 8], ['stone_pickaxe', 1, 96],
  ['oak_log', 64], ['oak_log', 28], ['oak_sapling', 9], ['birch_sapling', 7], ['bone_meal', 32],
  ['bamboo', 64], ['bamboo', 64], ['bamboo', 30], ['apple', 7], ['cooked_beef', 5], ['dirt', 12], ['egg', 6], ['flint', 4],
  ['stone_bricks', 3], ['amethyst_block', 4], ['iron_axe', 1, 200], ['stick', 6]])

test('THE MEASURED MIX: the chest rows plan torch, bone meal, ladders and the second food; nothing else of theirs', () => {
  const items = measuredBag(); assert.equal(items.length, 36)
  const p = townDepositPlan(items, { noSwords: false })
  // the 3 stone bricks stay: the scaffold reserve (bankable scaffoldKeep, 8 of the cheapest pathfinder blocks) keeps them
  assert.deepEqual(names(p), ['apple', 'bone_meal', 'ladder', 'torch'])
  for (const s of p.steps.filter(x => x.allowance)) assert.equal(items.find(i => i.slot === s.slot).count, s.count, 'whole stacks')
  const left = new Set(items.filter(i => !p.steps.some(s => s.slot === i.slot)).map(i => i.name))
  for (const n of ['bucket', 'furnace', 'crafting_table', 'chest', 'cooked_beef', 'oak_sapling', 'birch_sapling', 'bamboo', 'egg', 'flint', 'amethyst_block', 'iron_axe', 'stone_bricks'])
    assert.ok(left.has(n), `${n} stays`)
  assert.ok(items.length - p.freed < 34, `the bag leaves town under 34: ${items.length} - ${p.freed}`)
  // PEACEFUL: the apple is the composter's (above 4), never the chest's
  assert.ok(!names(townDepositPlan(items, { noSwords: true })).includes('apple'), 'peaceful: apples are not banked')
})

test('row F in a peaceful world: the composter\'s apples are never the kept food (Claude code r1 P3-5)', () => {
  const items = bag([['apple', 30], ['carrot', 6], ...filler(34)])
  assert.ok(!names(townDepositPlan(items, { noSwords: true })).includes('carrot'), 'peaceful: the carrot is the kept food, the apples the composter\'s')
  assert.ok(names(townDepositPlan(items, { noSwords: false })).includes('carrot'), 'positive control: outside peaceful the apple is the best food and the carrot goes')
})

test('the goal wins: a wanted name keeps a stack; a withdraw hold keeps the name; below 34 nothing; the latch', () => {
  const items = bag([['torch', 20], ['bone_meal', 9], ...filler(34)])
  assert.deepEqual(names(townDepositPlan(items)), ['bone_meal', 'torch'])
  assert.deepEqual(names(townDepositPlan(items, { wanted: ['torch'] })), ['bone_meal'], 'the active rung wants torches: they stay')
  BK.setWithdrawHold('bone_meal', 9, Date.now() + 60_000)
  try { assert.deepEqual(names(townDepositPlan(items)), ['torch'], 'just withdrawn: held') } finally { BK.clearWithdrawHolds() }
  const small = items.slice(0, 33)
  assert.deepEqual(names(townDepositPlan(small)), [], 'a bag under 34 keeps everything')
  assert.deepEqual(names(townDepositPlan(small, { fullBag: true })), ['bone_meal', 'torch'], 'a visit that BEGAN full keeps planning them (the latch)')
  assert.deepEqual(names(townDepositPlan(items, { rows: false })), [], 'deletion first: rows off plans none')
  assert.deepEqual(names(townDepositPlan(items, { bagAllowance: false })), [], 'BAG_ALLOWANCE=off: today\'s plan')
})

test('row M: building stone above the scaffold reserve goes, whole stacks; the reserve keeps 8 of the cheapest scaffold', () => {
  const items = bag([['stone_bricks', 64], ['stone_bricks', 20], ['smooth_stone', 5], ['cobblestone', 64], ...filler(32)])
  const p = townDepositPlan(items)
  const left = countsOf(items.filter(i => !p.steps.some(s => s.slot === i.slot)))
  assert.ok((left.stone_bricks ?? 0) + (left.smooth_stone ?? 0) >= 5, 'the scaffold reserve stays')
  assert.ok(p.steps.some(s => s.name === 'stone_bricks' && s.allowance), 'a building-stone stack beyond the reserve goes to the town')
})

test('the base plan goes first in the container; the visit\'s credit cap binds the chest rows too', () => {
  const items = bag([['torch', 20], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 20], ['raw_copper', 9], ...filler(31)])
  const p = townDepositPlan(items)
  const firstAllow = p.steps.findIndex(s => s.allowance)
  assert.ok(firstAllow > 0 && p.steps.slice(0, firstAllow).every(s => !s.allowance) && p.steps.slice(firstAllow).every(s => s.allowance), JSON.stringify(p.steps))
  const fit = TD.fitToContainer(p.steps, [null, item('dirt', 64), item('dirt', 64)])
  assert.ok(fit.every(s => !s.allowance), 'one free slot: a base stack, never the torch')
  assert.deepEqual(names(townDepositPlan(items, { already: { torch: 50 } })), [], '64 per name per visit: 50 already moved, the 20 stack does not fit')
})

// ---- the property: random full bags ------------------------------------------------------------------------------
function rng (seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 } }
const POOL = ['cobblestone', 'oak_log', 'stick', 'dirt', 'coal', 'raw_iron', 'iron_ingot', 'crafting_table', 'furnace', 'chest', 'bucket', 'torch', 'ladder',
  'bone_meal', 'apple', 'cooked_beef', 'carrot', 'bread', 'salmon', 'oak_sapling', 'birch_sapling', 'egg', 'flint', 'white_wool', 'leaf_litter', 'bamboo',
  'stone_bricks', 'smooth_stone', 'amethyst_block', 'oak_slab', 'white_bed', 'blue_orchid', 'melon_slice', 'granite', 'composter', 'raw_copper']
const TOOLS = ['stone_pickaxe', 'iron_pickaxe', 'wooden_pickaxe', 'stone_axe']
function randomBag (r) {
  const out = []; const n = 34 + Math.floor(r() * 3)
  while (out.length < n) {
    if (r() < 0.15) { const t = TOOLS[Math.floor(r() * TOOLS.length)]; const max = mcData.itemsByName[t].maxDurability; out.push(item(t, 1, 9 + out.length, { durabilityUsed: Math.floor(r() * max) })) } else {
      const nm = POOL[Math.floor(r() * POOL.length)]; const size = mcData.itemsByName[nm].stackSize
      out.push(item(nm, 1 + Math.floor(r() * size), 9 + out.length))
    }
  }
  return out
}

test('PROPERTY (600 random full bags x peaceful on/off): never junk; never below a row or a keep; off = on less the chest rows; the guarantee', () => {
  const r = rng(20261020)
  for (let k = 0; k < 600; k++) {
    const items = randomBag(r); const peaceful = k % 2 === 0
    const on = townDepositPlan(items, { noSwords: peaceful })
    const off = townDepositPlan(items, { noSwords: peaceful, bagAllowance: false })
    const allow = on.steps.filter(s => s.allowance)
    for (const s of allow) assert.equal(notForChest(s.name, { peaceful }), false, `bag ${k}: junk planned: ${s.name}`)
    assert.deepEqual(on.steps.filter(s => !s.allowance).map(s => s.slot).sort(), off.steps.map(s => s.slot).sort(), `bag ${k}: the base plan is unchanged`)
    const before = countsOf(items), keep = townKeeps(before, { wanted: [] }).keep
    const after = countsOf(items.filter(i => !on.steps.some(s => s.slot === i.slot)))
    for (const s of allow) {
      const need = Math.max(rowKeep(s.name, before), keep[s.name] ?? 0)
      assert.ok((after[s.name] ?? 0) >= need, `bag ${k}: ${s.name} left ${after[s.name] ?? 0} < ${need}`)
    }
    // THE GUARANTEE: the plan lists every chest-row stack it can, so an empty plan never leaves a `chest` class behind
    if (!allow.length) assert.ok(!fullBagLeft(items, { noSwords: peaceful }).includes('chest'), `bag ${k}`)
  }
})

// ---- the order: deletion first, bounded --------------------------------------------------------------------------
test('ORDER: deletion pending -> the chest rows wait, at most TD_DELETION_WAIT_MS of time FULL AT TOWN (summed over visits); then they go', () => {
  const home = { x: 0, y: 70, z: 0 }, pos = { x: 2, y: 70, z: 0 }, away = { x: 100, y: 70, z: 0 }
  const items = bag([['torch', 20], ...filler(35)])
  const seen = []
  const plan = ({ rows }) => { seen.push(rows); return townDepositPlan(items, { rows }) }
  const at = (now, where, deletion, state) => townDepositOrder({ now, slots: 36, pos: where, home, plan, container: true, deletion, state })
  const T0 = 1_000_000, half = TD_DELETION_WAIT_MS / 2
  let r = at(T0, pos, true, {})
  assert.equal(r.order, null, 'the well can still free a slot: no chest rows, nothing else to bank'); assert.equal(seen[0], false)
  assert.equal(r.state.latched, undefined, 'nothing issued')
  r = at(T0 + half, pos, true, r.state)                 // half the wait in town
  assert.equal(r.order, null)
  r = at(T0 + half + 1000, away, true, r.state)         // leaves: the wait so far is kept, the clock stops
  r = at(T0 + 10 * TD_DELETION_WAIT_MS, pos, true, r.state)   // back much later: the time away does not count
  assert.equal(r.order, null, 'away time is not wait time')
  r = at(T0 + 10 * TD_DELETION_WAIT_MS + half, pos, true, r.state)  // the second half, in town
  assert.equal(r.order?.skill, 'town_deposit', 'the summed wait is bounded'); assert.equal(r.order.args.rows, true)
  // nothing left to delete: the chest rows go at once, and a bag under 34 clears the wait
  let t = at(T0, pos, false, {})
  assert.equal(t.order?.args.rows, true)
  t = townDepositOrder({ now: T0, slots: 30, pos, home, plan, container: true, deletion: true, state: { deletionWaited: 5e5, deletionAt: T0 - 1 } })
  assert.equal(t.state.deletionWaited, 0)
})

test('ORDER: an exit that exists but whose order never ISSUES holds the chest rows for the grace only (two scans), not the wait', () => {
  const home = { x: 0, y: 70, z: 0 }, pos = { x: 2, y: 70, z: 0 }
  const plan = ({ rows }) => townDepositPlan(bag([['torch', 20], ...filler(35)]), { rows })
  const at = (now, deletion, state) => townDepositOrder({ now, slots: 36, pos, home, plan, container: true, deletion, state })
  const T0 = 2_000_000
  let r = at(T0, { pending: true, recent: false }, {})
  assert.equal(r.order, null, 'first scan: waits')
  r = at(T0 + TD.TD_DELETION_GRACE_MS, { pending: true, recent: false }, r.state)
  assert.equal(r.order?.args.rows, true, 'no deletion order issued: the grace is enough')
  let q = at(T0, { pending: true, recent: true }, {})
  q = at(T0 + TD.TD_DELETION_GRACE_MS, { pending: true, recent: true }, q.state)
  assert.equal(q.order, null, 'positive control: a deletion that IS issuing keeps the chest rows waiting')
})

test('ORDER (Codex design r3 P2-1): thirty-two 10-second visits add up -- the clock runs on every call full at town, not on scans', () => {
  const home = { x: 0, y: 70, z: 0 }, away = { x: 100, y: 70, z: 0 }
  const plan = ({ rows }) => ({ freed: rows ? 1 : 0, steps: rows ? [{ name: 'torch', allowance: 'torch', slot: 9, count: 1 }] : [] })
  let state = {}, issued = 0
  const call = (now, pos) => { const r = townDepositOrder({ now, pos, home, slots: 36, plan, container: true, deletion: { pending: true, recent: true }, state }); state = r.state; issued += !!r.order }
  for (let i = 0; i < 32; i++) { const t = 1e6 + i * 60_000; call(t, home); call(t + 10_000, home); call(t + 20_000, away) }
  assert.equal(state.deletionWaited, 32 * 10_000, 'every in-town second counted, the away time not')
  assert.ok(issued >= 1, 'the 5-min cap was reached across short visits')
})

test('ORDER: a visit made while the chest rows are WITHHELD does not latch the stay (the bounded wait is not held behind it)', () => {
  const home = { x: 0, y: 70, z: 0 }, pos = { x: 2, y: 70, z: 0 }
  const items = bag([['torch', 20], ['raw_copper', 9], ...filler(34)])
  const plan = ({ rows }) => townDepositPlan(items, { rows })
  const r = townDepositOrder({ now: 1e6, slots: 36, pos, home, plan, container: true, deletion: true, state: {} })
  assert.equal(r.order?.skill, 'town_deposit', 'the base plan (raw copper) goes'); assert.equal(r.order.args.rows, false)
  assert.equal(r.state.latched, false, 'not latched: the torch is withheld')
  const r2 = townDepositOrder({ now: 1e6, slots: 36, pos, home, plan, container: true, deletion: false, state: {} })
  assert.equal(r2.state.latched, true, 'positive control: nothing withheld -> the stay latches as before')
})

test('ORDER: an allowance-only plan still takes the count step (recount in the same run); a base plan does not', () => {
  const home = { x: 0, y: 70, z: 0 }, pos = { x: 2, y: 70, z: 0 }
  const only = bag([['torch', 20], ...filler(35)])
  let r = townDepositOrder({ now: 1e6, slots: 36, pos, home, plan: () => townDepositPlan(only), container: true, count: true })
  assert.deepEqual(r.order.args, { rows: true, recount: true, count: 'allowance_only' })
  const mixed = bag([['torch', 20], ['raw_copper', 9], ...filler(34)])
  r = townDepositOrder({ now: 1e6, slots: 36, pos, home, plan: () => townDepositPlan(mixed), container: true, count: true })
  assert.deepEqual(r.order.args, { rows: true })
})

// ---- row P: last-swing's spent pickaxes --------------------------------------------------------------------------
test('ROW P: last-swing keeps no spent pickaxe while the bag holds a stone pickaxe\'s stone; 3 without it or with the switch off', () => {
  const picks = [['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 1], ['iron_pickaxe', 1, 1], ['stone_pickaxe', 1, 100]]
  const withCobble = bag([...picks, ['cobblestone', 64], ...filler(30)])
  const planOn = HY.wearOutPlan(withCobble, { toolkit: false })
  assert.equal(planOn.tools.filter(t => t.name.endsWith('_pickaxe')).length, 4, 'every spent copy listed (MAX_PER_ORDER 4)')
  assert.equal(planOn.bagbudget, 3, 'three of the four are listed only because of the allowance (the deployed rule lists the fourth)')
  assert.equal(HY.wearOutPlan(withCobble, { toolkit: false, allowance: false }).tools.length, 1, 'off: the deployed three kept')
  const noStone = bag([...picks, ...filler(31)])
  assert.equal(HY.wearOutPlan(noStone, { toolkit: false }).tools.length, 1, 'no stone held: last-swing keeps three')
  assert.equal(HY.wearOutPlan(bag([...picks, ['blackstone', 3], ...filler(30)]), { toolkit: false }).tools.length, 4, 'blackstone is a stone pickaxe\'s stone')
  assert.equal(HY.wearOutPlan(bag([...picks, ['cobblestone', 2], ...filler(30)]), { toolkit: false }).tools.length, 1, '2 stone is not a pickaxe')
  // THE ESCAPE RESERVE IS UNTOUCHED: 1-use copies never count toward it
  const { depositSurvivors } = TD_TOOLFOR
  const rest = withCobble.filter(i => !planOn.tools.includes(i))
  assert.equal(depositSurvivors(rest), depositSurvivors(withCobble))
})

// ---- the honest no_effect classes --------------------------------------------------------------------------------
test('fullBagLeft names what is over the keeps and where it goes', () => {
  const items = bag([['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 6], ['stone_pickaxe', 1, 90], ['egg', 5], ['bamboo', 40], ['oak_sapling', 30], ...filler(30)])
  assert.deepEqual(fullBagLeft(items, { noSwords: false }), ['bamboo', 'junk', 'saplings', 'spent_tools', 'worn_pickaxes'])
  assert.ok(fullBagLeft(bag([['torch', 5], ...filler(35)])).includes('chest'), 'positive control: a chest row is named when it is there')
})

// ---- ANCHORED MUTANTS (withMutant: the anchor present AND unique, or the mutant reads as killed while nothing ran) ----
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const TD_URL = new URL('../src/towndeposit.mjs', import.meta.url)
const HY_URL = new URL('../src/hygiene.mjs', import.meta.url)

test('MUTANT KILLED: without notForChest in `owned`, the peaceful composter\'s apples are planned into a chest', async () => {
  // (an unlisted junk name already stays by allowlist polarity; the guard binds where a chest ROW meets the composter)
  const items = bag([['cooked_beef', 4], ['apple', 9], ['melon_slice', 5], ...filler(33)])
  assert.ok(!names(townDepositPlan(items, { noSwords: true })).some(n => n === 'apple' || n === 'melon_slice'), 'positive control: the real plan keeps them')
  await withMutant(TD_URL, 'planned.has(n) || bankOwned(n) || notForChest(n, { peaceful }) ||', 'planned.has(n) || bankOwned(n) ||', async m => {
    const p = m.townDepositPlan(items, { noSwords: true })
    assert.ok(p.steps.some(s => s.name === 'apple' || s.name === 'melon_slice'), 'the mutant plans the composter\'s input: the guard is what stops it')
  })
})
test('MUTANT KILLED: an unbounded deletion wait holds the chest rows forever', async () => {
  const st = { deletionWaited: TD_DELETION_WAIT_MS, deletionAt: 5e9 - 1000 }
  const args = m => ({ now: 5e9, slots: 36, pos: { x: 2, y: 70, z: 0 }, home: { x: 0, y: 70, z: 0 }, plan: ({ rows }) => m.townDepositPlan(bag([['torch', 20], ...filler(35)]), { rows }), container: true, deletion: true, state: st })
  assert.equal(townDepositOrder(args(TD)).order?.skill, 'town_deposit', 'positive control: the real order lets them go')
  await withMutant(TD_URL, 'const rows = !del || waited >= TD_DELETION_WAIT_MS || (!progressing && waited >= TD_DELETION_GRACE_MS)', 'const rows = !del', async m => {
    assert.equal(m.townDepositOrder(args(m)).order, null, 'the mutant never lets them go')
  })
})
test('MUTANT KILLED: sorting by slot alone lets a torch take the last free chest slot ahead of the base plan', async () => {
  await withMutant(TD_URL, 'steps.sort((a, b) => (a.allowance ? 1 : 0) - (b.allowance ? 1 : 0) || a.slot - b.slot)', 'steps.sort((a, b) => a.slot - b.slot)', async m => {
    const p = m.townDepositPlan(bag([['torch', 20], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 20], ...filler(32)]))
    assert.equal(m.fitToContainer(p.steps, [null])[0].name, 'torch')
  })
})
test('MUTANT KILLED: keeping no spent pickaxe without the stone check spends last-swing\'s copies in a stoneless bag', async () => {
  await withMutant(HY_URL, 'const keepSpent = allowance && cobble >= ALLOWANCE.lastSwingCobble ? 0 : SPENT_PICKAXES_KEPT', 'const keepSpent = allowance ? 0 : SPENT_PICKAXES_KEPT', async m => {
    const picks = bag([['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 100], ...filler(32)])
    assert.equal(m.wearOutPlan(picks, { toolkit: false }).tools.length, 3)
  })
})
