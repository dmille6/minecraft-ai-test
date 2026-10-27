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
// cobblecap-1000: the town cobble cap from the one place it is written; O shifts the 256-era fixtures, every relation unchanged
const CAP = (await import('../src/cobblecap.mjs')).TOWN_COBBLE_CAP, O = CAP - 256

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

test('keeps: wood to WOOD_KEEP (16) units (logs first), the stone FAMILY to 64 (andesite counts), iron never, wanted to a stack', () => {
  const { keep, why } = townKeeps({ oak_log: 50, birch_log: 30, oak_planks: 40, cobblestone: 100, andesite: 20, raw_iron: 9, iron_ingot: 4, coal: 30, stick: 40, dirt: 40, bucket: 1 }, { wanted: ['stick'] })
  assert.equal(keep.oak_log, 16); assert.equal(keep.birch_log, undefined, 'logbank-01: 16 units, the most-held species first')
  assert.equal(keep.oak_planks, 4, '16 units already in logs; 4 planks kept for the ladder\'s means'); assert.equal(why.oak_planks, 'ladder_means')
  assert.equal(keep.cobblestone, 64, 'cobblestone first: a pickaxe and a furnace are made of it')
  assert.equal(keep.andesite, 0 + (keep.andesite ?? 0), 'andesite never banks anyway')
  // cobblekeep-01: a bucket held -> one iron craft left, 3 units, ingots first, each name whole; raw_iron 9 + ingots 4 -> the
  // ingots cover it, so raw iron and coal (no raw kept to smelt) are no longer kept
  assert.equal(why.iron_ingot, 'iron_ladder'); assert.equal(keep.iron_ingot, 4)
  assert.equal(keep.raw_iron, undefined, 'raw iron above three ingots is banked'); assert.equal(keep.coal, undefined, 'coal with nothing of its own to smelt is banked')
  assert.equal(keep.stick, 40, 'a wanted item is kept up to a stack')
  assert.equal(keep.dirt, 16)
  const few = townKeeps({ oak_log: 3, oak_planks: 20 })
  assert.equal(few.keep.oak_log, 3); assert.equal(few.keep.oak_planks, 20, 'a deficit is never deepened')
})

// COBBLEKEEP-01 coal/iron (OWNER 10-19 ~14:10Z "coal and iron must get banked in town"): the keep is the bot's own next rungs
test('IRON KEEP, pure: the ladder\'s 3 units, ingots first, each name WHOLE; coal only while raw iron or ore is kept to smelt', () => {
  const K = TD.ironKeeps
  assert.equal(TD.IRON_KEEP, 3)
  assert.deepEqual(K({ iron_ingot: 3, raw_iron: 5, coal: 7, bucket: 1 }), { iron_ingot: 3 }, 'a bucket held, three ingots: the pickaxe is covered; raw and coal go')
  // Claude r3 P1-1: NEITHER a bucket nor an iron pickaxe -> 6 units, so the 5 raw iron stay (with the coal to smelt them)
  assert.deepEqual(K({ iron_ingot: 3, raw_iron: 5, coal: 7 }), { iron_ingot: 3, raw_iron: 5, coal: 7 }, 'two crafts to go: 6 units')
  assert.deepEqual(K({ iron_ingot: 3, raw_iron: 5, coal: 7, bucket: 1, iron_pickaxe: 1 }), { iron_ingot: 3 }, 'both held: the floor of 3')
  assert.equal(TD.ironUnitsNeeded({}), 6); assert.equal(TD.ironUnitsNeeded({ bucket: 1 }), 3); assert.equal(TD.ironUnitsNeeded({ iron_pickaxe: 1 }), 3)
  assert.equal(TD.ironUnitsNeeded({ bucket: 1, iron_pickaxe: 1 }), 3, 'never below the gather rung\'s 3')
  assert.equal(TD.ironUnitsNeeded({ water_bucket: 1 }), 6, 'a water bucket is not the bucket rung (countItem bucket)')
  assert.deepEqual(K({ iron_ingot: 1, raw_iron: 2, coal: 4 }), { iron_ingot: 1, raw_iron: 2, coal: 4 }, 'short of three: everything, and the coal to smelt it')
  assert.deepEqual(K({ raw_iron: 3, coal: 16, charcoal: 2 }), { raw_iron: 3, coal: 16 }, 'coal first; one fuel name is a batch')
  assert.deepEqual(K({ raw_iron: 3, charcoal: 2 }), { raw_iron: 3, charcoal: 2 })
  assert.deepEqual(K({ iron_ingot: 2, coal: 3 }), { iron_ingot: 2 }, 'nothing raw to smelt: the coal goes')
  assert.deepEqual(K({ iron_ingot: 1, raw_iron: 1, iron_ore: 4, coal: 2 }), { iron_ingot: 1, raw_iron: 1, iron_ore: 4, coal: 2 })
  assert.deepEqual(K({ iron_ingot: 1, raw_iron: 5, iron_ore: 4, bucket: 1 }), { iron_ingot: 1, raw_iron: 5 }, 'raw before ore: the ore goes')
  assert.deepEqual(K({ coal: 11 }), {}, 'no iron at all: the coal goes')
  // FUEL IS FOR THE BOT'S OWN SMELT, WHATEVER IT IS (Codex r3 P2)
  const bk = { bucket: 1 }
  assert.deepEqual(K({ iron_ingot: 3, sand: 8, coal: 7, ...bk }, { wanted: ['glass', 'sand'] }), { iron_ingot: 3, coal: 7 }, 'wanted glass: the 8 sand need the coal')
  assert.deepEqual(K({ iron_ingot: 3, sand: 8, coal: 7, ...bk }, { wanted: ['glass'] }), { iron_ingot: 3, coal: 7 }, 'the output alone names its input')
  assert.deepEqual(K({ iron_ingot: 3, coal: 7, ...bk }, { wanted: ['glass'] }), { iron_ingot: 3 }, 'wanted glass but no sand held: nothing to smelt, the coal goes')
  // Claude r4 P3-1: a wanted INPUT alone is a gather or a craft, not a smelt
  assert.deepEqual(K({ iron_ingot: 2, cobblestone: 300, coal: 20, ...bk }, { wanted: ['cobblestone'] }), { iron_ingot: 2 }, 'the cobble rungs burn no coal')
  assert.deepEqual(K({ iron_ingot: 3, sand: 8, coal: 7, ...bk }, { wanted: ['sand'] }), { iron_ingot: 3 }, 'the gatherer\'s sand rung burns no coal')
  assert.deepEqual(K({ iron_ingot: 3, cobblestone: 64, coal: 5, ...bk }, { wanted: ['stone'] }), { iron_ingot: 3, coal: 5 }, 'positive control: wanted stone smelts the cobble')
  assert.deepEqual(K({ iron_ingot: 3, oak_log: 20, coal: 4, ...bk }, { wanted: ['oak_log', 'charcoal'] }), { iron_ingot: 3 }, 'wood is fuel, never a smelt that needs coal')
  assert.deepEqual(K({ iron_ingot: 3, sand: 8, coal: 7, ...bk }, { wanted: ['stick'] }), { iron_ingot: 3 }, 'a rung that smelts nothing keeps no coal')
  assert.deepEqual(K({}), {})
  // the gather rung counts raw + ingots >= 3: never moved from done to not done by this keep
  for (const c of [{ iron_ingot: 3, raw_iron: 2, bucket: 1 }, { iron_ingot: 3, raw_iron: 2 }, { iron_ingot: 2, raw_iron: 2 }, { iron_ingot: 1, raw_iron: 1, iron_ore: 3 }, { raw_iron: 4 }, { iron_ingot: 5 }]) {
    const k = K(c), before = (c.iron_ingot ?? 0) + (c.raw_iron ?? 0), after = (k.iron_ingot ?? 0) + (k.raw_iron ?? 0)
    assert.ok(before < 3 || after >= 3, `${JSON.stringify(c)}: the rung stays done`)
  }
})
const ironTown = rows => { const c = chestAt(2); return { c, w: world({ items: bag([...rows, ...filler(36 - rows.length)]), containers: [c] }) } }
test('IRON CHAIN (positive), the REAL town deposit: a full bag with a bucket, 3 ingots, 5 raw iron and 7 coal banks the raw iron and the coal; the ingots stay (the pickaxe\'s)', async () => {
  const { c, w } = ironTown([['iron_ingot', 3], ['raw_iron', 5], ['coal', 7], ['bucket', 1]])
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  for (const now of [w.bot.inventory.items(), serverBag(w)]) {
    assert.equal(sumOf(now, 'iron_ingot'), 3, 'the next craft stays'); assert.equal(sumOf(now, 'raw_iron'), 0); assert.equal(sumOf(now, 'coal'), 0)
  }
  assert.equal(sumOf(c.items, 'raw_iron'), 5); assert.equal(sumOf(c.items, 'coal'), 7); assert.equal(sumOf(c.items, 'iron_ingot'), 0)
})
test('IRON CHAIN (negative), the REAL town deposit: 1 ingot, 2 raw iron and 4 coal is the bot\'s own rung -- nothing of it moves', async () => {
  const { c, w } = ironTown([['iron_ingot', 1], ['raw_iron', 2], ['coal', 4], ['oak_log', 64], ['oak_log', 64], ['oak_log', 64]])
  const r = await run(w.bot)
  assert.equal(r.status, 'success', `positive control: the run banks something (the logs above 64): ${r.detail}`)
  assert.ok(sumOf(c.items, 'oak_log') > 0)
  assert.equal(sumOf(c.items, 'iron_ingot') + sumOf(c.items, 'raw_iron') + sumOf(c.items, 'coal'), 0, 'no iron or coal banked')
  assert.equal(sumOf(w.bot.inventory.items(), 'raw_iron'), 2); assert.equal(sumOf(w.bot.inventory.items(), 'coal'), 4)
})
test('FUEL CHAIN (Codex r3 P2), the REAL town deposit: a bot whose rung wants glass keeps its coal for its own 8 sand; the same bag with a rung that smelts nothing banks the coal', async () => {
  const runWith = async wanted => {
    const { c, w } = ironTown([['iron_ingot', 3], ['sand', 8], ['furnace', 1], ['coal', 7], ['bucket', 1], ['oak_log', 64], ['oak_log', 64], ['oak_log', 64]])
    w.bot.townDepositWanted = wanted
    const r = await run(w.bot)
    return { r, c, w }
  }
  const a = await runWith(['glass', 'sand'])
  assert.equal(sumOf(a.c.items, 'coal'), 0, `the coal stays for its own glass: ${a.r.detail}`)
  assert.equal(sumOf(a.w.bot.inventory.items(), 'coal'), 7)
  assert.ok(sumOf(a.c.items, 'oak_log') > 0, 'positive control: the run banked (logs above the 64 units)')
  const b = await runWith(['stick'])
  assert.equal(b.r.status, 'success', b.r.detail)
  assert.equal(sumOf(b.c.items, 'coal'), 7, 'nothing of its own to smelt: the coal banks')
})
// Claude r3 P1-1: THE SEQUENCE, through the real town deposit -- a bot with NEITHER a bucket nor an iron pickaxe deposits,
// crafts the bucket (3 ingots), deposits again: it still holds the pickaxe's iron (raw to smelt, and the coal to smelt it)
const ironRungs = items => {
  const n = name => sumOf(items, name)
  return { gather: n('raw_iron') + n('iron_ingot') >= 3, smeltMeans: n('raw_iron') >= 1 && n('coal') >= 1, pickMeans: n('iron_ingot') + n('raw_iron') >= 3 }
}
test('IRON SEQUENCE (Claude r3 P1-1), the REAL town deposit: no bucket, no iron pickaxe, 3 ingots + 5 raw + 7 coal -> deposit -> craft the bucket -> deposit: the pickaxe\'s iron and its coal are still in the bag', async () => {
  const { c, w } = ironTown([['iron_ingot', 3], ['raw_iron', 5], ['coal', 7], ['oak_log', 64], ['oak_log', 64], ['oak_log', 64]])
  const r1 = await run(w.bot)
  assert.equal(r1.status, 'success', `positive control: the logs bank: ${r1.detail}`)
  assert.equal(sumOf(c.items, 'raw_iron') + sumOf(c.items, 'coal') + sumOf(c.items, 'iron_ingot'), 0, 'two crafts to go: none of the iron or coal banked')
  // the bucket: 3 ingots out, a bucket in -- in the client's bag and the fake server's alike
  for (const arr of [w.bagSlots, w.server.bag]) {
    const k = arr.findIndex(x => x?.name === 'iron_ingot')
    arr[k] = arr[k].count > 3 ? { ...arr[k], count: arr[k].count - 3 } : null
    const free = arr.findIndex((x, j) => j >= 9 && j < 45 && !x)
    arr[free] = item('bucket', 1, free)
  }
  const after1 = w.bot.inventory.items()
  assert.equal(sumOf(after1, 'bucket'), 1); assert.equal(sumOf(after1, 'iron_ingot'), 0)
  await run(w.bot)
  const now = w.bot.inventory.items()
  const rungs = ironRungs(now)
  assert.equal(sumOf(now, 'raw_iron'), 5, 'the pickaxe\'s raw iron stays'); assert.equal(sumOf(now, 'coal'), 7, 'and the coal to smelt it')
  assert.ok(rungs.gather && rungs.smeltMeans && rungs.pickMeans, JSON.stringify(rungs))
  assert.equal(sumOf(c.items, 'raw_iron') + sumOf(c.items, 'coal'), 0)
})
test('IRON SEQUENCE, MUTANT KILLED: a flat keep of 3 banks the pickaxe\'s raw iron before the bucket is even made', async () => {
  const P = new URL('../src/towndeposit.mjs', import.meta.url)
  const src = fs.readFileSync(P, 'utf8')
  const old = "  let need = ironUnitsNeeded(counts), toSmelt = 0\n"
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING or not unique')
  const out = new URL(`./_mutant-iu-${process.pid}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, "  let need = IRON_KEEP, toSmelt = 0\n").replace(/from '\.\//g, "from '../src/"))
  try {
    const M = await import(out.href)
    const items = bag([['iron_ingot', 3], ['raw_iron', 5], ['coal', 7], ...filler(33)])
    assert.ok(M.townDepositPlan(items, { noSwords: false }).steps.some(s => s.name === 'raw_iron'), 'the mutant banks the raw iron')
    assert.ok(!TD.townDepositPlan(items, { noSwords: false }).steps.some(s => s.name === 'raw_iron'), 'positive control: the real keep does not')
  } finally { try { fs.unlinkSync(out) } catch {} }
})
test('IRON CHAIN, MUTANT KILLED: the old keep (every unit, for good) banks no iron or coal from the positive bag', async () => {
  const P = new URL('../src/towndeposit.mjs', import.meta.url)
  const src = fs.readFileSync(P, 'utf8')
  const old = "  for (const [n, k] of Object.entries(ironKeeps(counts, { wanted }))) floor(n, k, 'iron_ladder')\n"
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING or not unique')
  const out = new URL(`./_mutant-ik-${process.pid}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, "  for (const n of IRON_LADDER) floor(n, Infinity, 'iron_ladder')\n").replace(/from '\.\//g, "from '../src/"))
  try {
    const M = await import(out.href)
    const items = bag([['iron_ingot', 3], ['raw_iron', 5], ['coal', 7], ['bucket', 1], ...filler(32)])
    const names = M.townDepositPlan(items, { noSwords: false }).steps.map(s => s.name)
    assert.ok(!names.includes('raw_iron') && !names.includes('coal'), `mutant inert: ${names}`)
    assert.ok(TD.townDepositPlan(items, { noSwords: false }).steps.some(s => s.name === 'coal'), 'positive control: the real keep banks the coal')
  } finally { try { fs.unlinkSync(out) } catch {} }
})

test('tools: a spent copy never moves, the best usable copy always stays', () => {
  const c = (slot, uses) => item('stone_pickaxe', 1, slot, { durabilityUsed: 131 - uses })
  assert.deepEqual(toolSlotsToBank([c(9, 1), c(10, 120), c(11, 50), c(12, 8)]), [11])
  assert.deepEqual(toolSlotsToBank([c(9, 1), c(10, 2), c(11, 10)]), [], 'nothing usable: nothing moves (FLOOR = 10)')
  assert.deepEqual(toolSlotsToBank([c(9, 11), c(10, 11)]), [10], 'ties keep the lower slot')
  assert.deepEqual(toolSlotsToBank([c(9, 100), c(10, 90), c(11, 80)], 1), [10], 'the allowance caps it')
})

test('the plan: whole stacks, smallest first; junk, food, stations, chests, dirt, sand and the bot\'s own iron crafts never; freed = stacks', () => {
  const items = bag([
    ['stone_pickaxe', 1, 1], ['stone_pickaxe', 1, 120], ['stone_pickaxe', 1, 60], ['wooden_pickaxe', 1, 40],
    ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 20], ['oak_log', 64], ['oak_log', 64], ['oak_log', 10],
    ['apple', 45], ['egg', 12], ['dirt', 64], ['sand', 30], ['bone_meal', 9], ['crafting_table', 2], ['chest', 7],
    ['raw_iron', 5], ['iron_ingot', 3], ['coal', 20], ['stick', 40], ['oak_planks', 20], ['leaf_litter', 30], ['torch', 20],
    ...filler(12)])
  assert.equal(items.length, 36)
  const p = townDepositPlan(items, { tail: false })   // the BASE plan; junkout-01's rows (bone meal, torch ...) are junkout.test.mjs's
  const names = p.steps.map(s => s.name)
  for (const n of ['apple', 'egg', 'dirt', 'sand', 'bone_meal', 'crafting_table', 'chest', 'raw_iron', 'iron_ingot', 'coal', 'leaf_litter', 'torch', 'white_wool', 'wooden_pickaxe'])
    assert.ok(!names.includes(n), `${n} must stay`)
  const picks = p.steps.filter(s => s.name === 'stone_pickaxe')
  assert.equal(picks.length, 1, 'one spare usable pickaxe banks')
  const moved = items.find(i => i.slot === picks[0].slot)
  assert.equal(131 - moved.durabilityUsed, 60, 'the 60-use copy moves; the 120-use one and the spent one stay')
  assert.deepEqual(p.steps.filter(s => s.name === 'cobblestone').map(s => s.count), [20], 'creditCap 64: the 20 stack, never a partial')
  assert.deepEqual(p.steps.filter(s => s.name === 'oak_log').map(s => s.count), [10, 32, 16], '138 logs, keep 16 units, creditCap 64: the 10 stack whole, then one 64 halved twice (logbank-01) -- 58 under the cap')
  assert.ok(p.steps.filter(s => !s.half).every(s => items.find(i => i.slot === s.slot).count === s.count), 'every non-half step is a whole stack')
  assert.ok(p.steps.filter(s => s.half).every(s => LOGS.includes(s.name)), 'only logs halve')
  assert.equal(p.freed, p.steps.filter(s => !s.half).length)
  // cobblekeep-01: no bucket and no iron pickaxe -> 6 iron units are the bot's own (3 ingots + 5 raw), and the coal smelts them
  assert.deepEqual(p.steps.filter(s => ['raw_iron', 'coal'].includes(s.name)), [], 'two iron crafts to go: nothing of it banks')
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
// logbank-01: a log HALF leaves part of its slot -- subtract what each step moved, never drop the whole slot
const after = (items, plan) => {
  const moved = {}
  for (const st of plan.steps) moved[st.slot] = (moved[st.slot] ?? 0) + st.count
  return items.map(i => ({ ...i, count: i.count - (moved[i.slot] ?? 0) })).filter(i => i.count > 0)
}
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
    assert.ok(wood(rest) >= Math.min(wood(items), TD.WOOD_KEEP), `wood deficit deepened (bag ${k})`)
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
  // whole stacks only here (halves: false): the cap's arithmetic; the halves' own cap is the LOGBANK tests'
  assert.deepEqual(townDepositPlan(items, { halves: false }).steps.map(s => s.count), [10], 'cap 64: the 10 only (the next 64 passes the cap)')
  const after10 = items.filter(i => !(i.name === 'oak_log' && i.count === 10))
  assert.deepEqual(townDepositPlan(after10, { halves: false }).steps.map(s => s.count), [64], 'a fresh plan would take 64 more...')
  assert.deepEqual(townDepositPlan(after10, { already: { oak_log: 10 }, halves: false }).steps, [], '...the visit has 54 left: no whole stack fits')
  assert.deepEqual(townDepositPlan(after10, { already: { oak_log: 10 } }).steps.map(s => s.count), [32, 16], '...and with halves, 48 of those 54')
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
      // logbank-01: a right click (btn 1) is allowed ONLY as the log half-split's pickup: an empty cursor on a bag stack
      assert.equal(mode, 0, 'mode 0 clicks only'); assert.ok(btn === 0 || btn === 1)
      if (btn === 1) {
        assert.ok(!win.selectedItem && slot >= win.inventoryStart && /_log$/.test(win.slots[slot]?.name ?? ''), 'a right click only lifts half a bag log stack')
        st.rightClicks = (st.rightClicks ?? 0) + 1; st.clicks++
        for (const w of [win, win.server]) { const at = w.slots[slot]; const take = Math.ceil(at.count / 2); w.selectedItem = { ...at, count: take }; at.count -= take; if (!at.count) w.slots[slot] = null }
        return
      }
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
  ['oak_log', 16], ['oak_log', 10], ['white_wool', 2], ['apple', 45], ['raw_iron', 5], ['coal', 9], ['dirt', 30], ['raw_copper', 7], ...filler(22)])
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
    assert.equal(sumOf(now, 'cobblestone'), 128); assert.equal(sumOf(now, 'oak_log'), 16)
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
  assert.match(rows[0].skill.detail, /^slots 36->32 stacks 4\/4 clicked 4 bagdelta 38 tools stone_pickaxe@60 logs banked 10 kept 16 keep 16 banked .*stone_pickaxe:1/)
})

// ---- TOOLKIT-03 x COBBLEKEEP-01: what the town deposit banks, the smelt job's coal search finds ----------------------------
// cobblekeep banks coal a bot has nothing of its own to smelt with; toolkit-03's smelt job looks for coal as its own need,
// skipping containers with a live coal miss. The REAL town deposit marks the chest it banked into 'took', which ends the miss:
// the coal search (townCoalMiss, the job's precheck) re-opens. POSITIVE CONTROL: before the deposit the town is a known miss.
// (A deposit of anything ends the miss -- 'took' is item-blind -- so the search looks once more: the second scene says so.)
test('TOOLKIT-03 x COBBLEKEEP: banked coal re-opens the smelt job\'s coal search (the deposit\'s took ends the coal miss); CONTROL: a known miss before it', async () => {
  const { townCoalMiss } = await import('../src/skills.mjs')
  const CF = await import('../src/chestfull.mjs')
  const SJ = await import('../src/smeltjob.mjs')
  const scene = async withCoal => {
    process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'td-tk3-'))
    const items = bag([['iron_ingot', 3], ...(withCoal ? [['coal', 9]] : []), ['dirt', 30], ['raw_copper', 7], ...filler(withCoal ? 32 : 33)])
    const c = chestAt(2)
    const w = world({ items, containers: [c] })
    CF.updateTownMemory(process.env.POOL_STATE_DIR, CF.townKey({ x: 0, y: 70, z: 0 }), null, e => CF.noteItemMisses(e, SJ.COAL_MISS_KEY, SJ.COAL_MISS_TTL_MS, ['2,70,0'], Date.now() - 60_000))   // looked a minute ago (a deposit in the same ms is not 'since')
    assert.equal(townCoalMiss(w.bot), true, 'before: the only container a live coal miss')
    const r = await run(w.bot)
    assert.equal(r.status, 'success', r.detail)
    return { w, c }
  }
  const a = await scene(true)
  assert.equal(sumOf(a.c.items, 'coal'), 9, 'cobblekeep banked the coal')
  assert.equal(townCoalMiss(a.w.bot), false, 'banked coal: the coal search has its candidate again')
  const b = await scene(false)
  assert.equal(sumOf(b.c.items, 'coal'), 0)
  // A KNOWN COST, not a feature (Claude ck P3-3): 'took' is item-blind, so a deposit of dirt ends the coal miss too and the
  // job looks once more -- the mechanism behind the churn smeltjob.mjs's dry-job bound (SMELT_DRY_MAX) limits. Pinned so a
  // change to it is seen.
  assert.equal(townCoalMiss(b.w.bot), false, 'KNOWN COST: any deposit ends the miss (took is item-blind)')
})

// ---- THE PEACEFUL KIT (peacefulkit.mjs, OWNER 10-07 ~19:50Z): while the switch is on no sword is ever banked ------------
const kitSwitch = async difficulty => {
  const { attachDifficulty } = await import('../src/foodskip.mjs')
  const { EventEmitter } = await import('node:events')
  const fake = { _client: new EventEmitter() }; attachDifficulty(fake, {}); fake._client.emit('difficulty', { difficulty })
  return () => fake._client.emit('difficulty', { difficulty: 'hard' })
}
test('KIT pure: the plan banks NO sword while on (not even a spare), the spare as today while off; pickaxes unchanged', () => {
  const b = bag([['stone_sword', 1, 131], ['stone_sword', 1, 120], ['wooden_sword', 1, 59], ['stone_pickaxe', 1, 120], ['stone_pickaxe', 1, 60], ...filler(31)])
  const on = townDepositPlan(b, { noSwords: true }).banked, off = townDepositPlan(b, { noSwords: false }).banked
  assert.equal((on.stone_sword ?? 0) + (on.wooden_sword ?? 0), 0)
  assert.equal(off.stone_sword, 1, 'off: the spare (worse) stone sword, as today'); assert.equal(off.wooden_sword, undefined)
  assert.equal(on.stone_pickaxe, 1); assert.equal(off.stone_pickaxe, 1)
})
test('KIT pure: townDepositPlan WITHOUT noSwords follows the switch (its default), whichever caller forgets it', async () => {
  const { setPeacefulFood } = await import('../src/foodskip.mjs')
  const b = bag([['stone_sword', 1, 131], ['stone_sword', 1, 120], ['stone_pickaxe', 1, 120], ['stone_pickaxe', 1, 60], ...filler(32)])
  setPeacefulFood(true)
  try { assert.equal(townDepositPlan(b).banked.stone_sword ?? 0, 0, 'peaceful: no sword') } finally { setPeacefulFood(false) }
  assert.equal(townDepositPlan(b).banked.stone_sword, 1, 'off: the spare, as today')
})

for (const [why, difficulty, spare, stale] of [['PEACEFUL', 'peaceful', 0, false], ['HARD', 'hard', 1, false], ['PEACEFUL, a stale decision', 'peaceful', 0, true], ['HARD, a stale decision', 'hard', 1, true]]) {
  test(`KIT SKILL, ${why}: a full bag at town ${spare ? 'banks the spare stone sword (today)' : 'banks NO sword'}; the best pickaxe stays; nothing lost or dropped`, async () => {
    const restore = await kitSwitch(difficulty)
    if (stale) (await import('../src/foodskip.mjs')).setPeacefulFood(difficulty !== 'peaceful')   // the skill must read the switch itself
    try {
      const items = bag([['stone_sword', 1, 131], ['stone_sword', 1, 100], ...fullBag().slice(0, 34).map(i => [i.name, i.count, i.maxDurability ? i.maxDurability - i.durabilityUsed : undefined])])
      assert.equal(items.length, 36)
      const c = chestAt(2)
      const w = world({ items, containers: [c] })
      w.bot.serverDifficulty = difficulty
      const r = await run(w.bot)
      assert.equal(r.status, 'success', r.detail)
      assert.equal(sumOf(c.items, 'stone_sword'), spare)
      for (const now of [w.bot.inventory.items(), serverBag(w)]) {
        assert.equal(sumOf(now, 'stone_sword'), 2 - spare)
        assert.ok(now.some(i => i.name === 'stone_pickaxe' && 131 - i.durabilityUsed === 120), 'the best pickaxe stays')
      }
      assert.equal(total(serverBag(w)) + total(c.items), total(items), 'nothing lost')
      assert.equal(w.st.dropped, 0); assert.equal(w.st.loadedCloses, 0)
    } finally { restore() }
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
  assert.equal(sumOf(both, 'oak_log'), 58, 'logs: 10 whole + one 64 halved to 16 (32+16, logbank-01) = 58 this visit, under the 64 cap')
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
  assert.equal(sumOf(serverBag(w), 'oak_log'), 26, 'the log stack is back in the bag')
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
  const items = bag([['cobblestone', 64], ['oak_log', 16], ['stone_pickaxe', 1, 100], ['raw_iron', 20], ...filler(32)])
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
  const items = bag([['dirt', 16], ['oak_log', 6], ['oak_log', 10], ['sand', 8], ['cobblestone', 64], ['cobblestone', 20], ['crafting_table', 1],
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
async function decisions (bot, n, { propose = 'status', real = [] } = {}) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    const slots = bot.inventory.items().length
    // the town deposit RUNS; so do the skills a test names (`real`), with the runner's measured fields the loop reads
    if (skill === 'town_deposit' || real.includes(skill)) {
      const r = await SKILLS[skill].run({ bot }, args ?? {}, null)
      ran.push({ skill, slots, status: r.status, detail: r.detail })
      return { ...r, delta: { counted: Number(r.counted ?? 0) } }
    }
    ran.push({ skill, slots, status: 'success' })
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: propose, args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 200 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  return { ran, loop }
}

for (const [difficulty, want, stale] of [['peaceful', false, false], ['hard', true, false], ['peaceful', false, true], ['hard', true, true]]) {
  test(`KIT WIRED (the real loop), ${difficulty}${stale ? ', a STALE decision in the module' : ''}: a full bag at town whose only surplus is a spare sword ${want ? 'gets the town_deposit order (today)' : 'gets NO town_deposit order'}`, async () => {
    const restore = await kitSwitch(difficulty)
    if (stale) (await import('../src/foodskip.mjs')).setPeacefulFood(difficulty !== 'peaceful')   // the trigger must read the switch itself (Codex, junkwell merge)
    try {
      const items = bag([['dirt', 16], ['oak_log', 16], ['cobblestone', 64], ['crafting_table', 1], ['wooden_pickaxe', 1, 50], ['stick', 8],
        ['furnace', 1], ['stone_sword', 1, 131], ['stone_sword', 1, 100], ...filler(27)])
      assert.equal(items.length, 36)
      const { bot } = world({ items, containers: [chestAt(2)], botAt: new Vec3(3, 70, 0) })
      Object.assign(bot, { health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
        serverDifficulty: difficulty, recipesFor: () => [], recipesAll: () => [], findBlock: () => null, clearControlStates: () => {}, players: {},
        entities: {}, experience: { level: 0 }, username: 'TownBot' })
      const { ran } = await decisions(bot, 1)
      assert.ok(ran.length >= 1, 'the loop decided something')
      assert.equal(ran[0].skill === 'town_deposit', want, JSON.stringify(ran))
    } finally { restore() }
  })
}

test('CHAIN: a full bag at town with a craft-ready rung deposits FIRST, and the craft is dispatched with room made', async () => {
  const bot = chainBot()
  const { ran, loop } = await decisions(bot, 2)
  assert.equal(loop.milestones.current()?.id?.includes('stone_pickaxe'), true, `active rung ${loop.milestones.current()?.id}`)
  assert.deepEqual(ran.map(x => x.skill), ['town_deposit', 'craft'], JSON.stringify(ran))
  assert.equal(ran[0].status, 'success'); assert.equal(ran[0].slots, 36)
  assert.equal(ran[1].slots, 34, 'the craft order runs on a bag the deposit emptied two slots of (cobble 20, copper; logbank-01: the fixture holds just the 16-log keep)')
  assert.equal(sumOf(bot.inventory.items(), 'oak_log'), 16); assert.equal(sumOf(bot.inventory.items(), 'cobblestone'), 64)
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
  CF.updateTownMemory(dir, key, null, e => { e['-4,70,0'] = CF.recordOutcome(undefined, 'full'); CF.notePickMisses(e, ['2,70,0'], Date.now() - 50) })   // (test-only, as the other 92bc84f variants: the same-millisecond precondition was flaky)
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
  // logbank-01: raw_copper, not oak_log -- fullBag's logs are now 16 + 10, so a stuck 10 merges back into the 16 (a settled
  // cursor); the copper stack is the only one of its name, as the 10 among two full 64s was
  const w = world({ items: fullBag(), containers: [a, b], failDest: cur => cur.name === 'raw_copper', cursorStuck: true })
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

// THE COBBLE RULE x THE TOWN DEPOSIT (stonecap on 92bc84f): the town deposit reads its allowance from depositPlan, which
// now holds cobble to whole stacks above a 64 reserve; its own plan banks whole stacks smallest first and keeps 64 of the
// stone family. The two must agree: never a partial cobble stack, never under 64 cobble + deepslate.
test('COBBLE RULE: the town deposit banks only whole cobble stacks above the 64 reserve', () => {
  const it = (name, count, slot) => ({ name, count, slot })
  const fill = Array.from({ length: 30 }, (_, i) => it('dirt', 64, 12 + i))
  const cobbleSteps = bag => TD.townDepositPlan([...bag, ...fill]).steps.filter(s => /^cobble/.test(s.name)).map(s => `${s.name}:${s.count}`)
  assert.deepEqual(cobbleSteps([it('cobblestone', 64, 9), it('cobblestone', 30, 10)]), ['cobblestone:30'])
  assert.deepEqual(cobbleSteps([it('cobblestone', 64, 9)]), [], 'exactly the reserve: nothing')
  assert.deepEqual(cobbleSteps([it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 20, 11)]), ['cobblestone:20'])
  assert.deepEqual(cobbleSteps([it('cobblestone', 30, 9), it('cobblestone', 40, 11)]), [], '70 held: no whole stack leaves 64')
  for (const bag of [[it('cobblestone', 64, 9), it('cobblestone', 30, 10)], [it('cobblestone', 64, 9), it('cobbled_deepslate', 64, 10), it('cobblestone', 5, 11)]]) {
    const all = [...bag, ...fill]
    const left = all.reduce((n, x) => n + (/^cobble/.test(x.name) ? x.count : 0), 0) -
      TD.townDepositPlan(all).steps.reduce((n, s) => n + (/^cobble/.test(s.name) ? s.count : 0), 0)
    assert.ok(left >= 64, `kept ${left}`)
  }
})

// THE TOWN COBBLE CAP x THE TOWN DEPOSIT (stonecap on 92bc84f): the town deposit's own transfer admits each cobble stack
// under the town's lock (cobblecap.mjs). A chest holding 250 -> its 20-stack would pass 256: refused, the logs still go.
test('COBBLE CAP: at 250 the town deposit banks no cobble (the rest of the plan goes); at 100 it banks the whole 20-stack', async () => {
  const saved = process.env.POOL_STATE_DIR
  const cobbleChest = (x, n) => chestAt(x, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i * 64 < n ? item('cobblestone', Math.min(64, n - i * 64)) : null)) })
  try {
    process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'td-cap-'))
    const c = cobbleChest(2, 250 + O)
    const w = world({ items: fullBag(), containers: [c] })
    const r = await run(w.bot)
    assert.equal(r.status, 'success', r.detail)
    assert.equal(sumOf(c.items, 'cobblestone'), 250 + O, 'no cobble went in: (250 + O) + 20 would pass CAP')
    assert.ok(sumOf(c.items, 'oak_log') > 0, 'positive control: the logs were banked in the same run')
    process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'td-cap-'))
    const c2 = cobbleChest(2, 100 + O)
    const w2 = world({ items: fullBag(), containers: [c2] })
    const r2 = await run(w2.bot)
    assert.equal(r2.status, 'success', r2.detail)
    assert.equal(sumOf(c2.items, 'cobblestone'), 120 + O, 'counted and complete: (100 + O) + 20 <= CAP')
  } finally { process.env.POOL_STATE_DIR = saved }
})

// EVERY LIVE RESERVATION COUNTS, THIS RUN'S OWN TOO (Claude's r1 probe; both reviews P1): a chest at 220 and two surplus
// stacks of 20 and 30 -- either alone fits (240 / 250), both would make 270. Exactly one goes, the row names the refusal.
test('COBBLE CAP: two surplus stacks into a chest at 220 -> only one goes (this run\'s own reservation counts); the row says cobble_cap 1/0/0', async () => {
  const saved = process.env.POOL_STATE_DIR
  try {
    process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'td-cap-'))
    const c = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i * 64 < 220 + O ? item('cobblestone', Math.min(64, 220 + O - i * 64)) : null)) })
    const items = bag([['cobblestone', 64], ['cobblestone', 20], ['cobbled_deepslate', 30], ['oak_log', 64], ['oak_log', 64], ...filler(31)])
    const w = world({ items, containers: [c] })
    const { out, rows } = await rowsOf(() => run(w.bot))
    assert.equal(out.status, 'success', out.detail)
    const town = sumOf(c.items, 'cobblestone') + sumOf(c.items, 'cobbled_deepslate')
    assert.ok(town <= CAP, `the town passed the cap: ${town}`)
    assert.ok(town === 240 + O || town === 250 + O, `exactly one surplus stack went (positive control: one fits): ${town}`)
    assert.ok(sumOf(c.items, 'oak_log') > 0, 'positive control: the logs went in the same run')
    assert.match(rows.at(-1)?.skill?.detail ?? '', / cobble_cap 1\/0\/0 /)
  } finally { process.env.POOL_STATE_DIR = saved }
})

// ==================================================================================================================
// STOCK TARGETS (stocktarget-01, design section 5): the remedy chains through the REAL decision loop and the REAL
// town_deposit skill. The stock readers are the bot's own (installCobbleCap) and the town's journal is a fresh pool dir.
const stockChain = async ({ items, chest, well = true, seed = null }) => {
  const saved = process.env.POOL_STATE_DIR
  process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'td-stock-'))
  const { installCobbleCap } = await import('../src/skills.mjs')
  const B = await import('../src/bankable.mjs')
  const CC = await import('../src/cobblecap.mjs')
  const { bot } = world({ items, containers: [chest], botAt: new Vec3(3, 70, 0) })
  Object.assign(bot, { health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: () => [], recipesAll: () => [], findBlock: () => null, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'TownBot' })
  if (seed) CC.appendJournal(process.env.POOL_STATE_DIR, CF.townKey(new Vec3(0, 70, 0)), bot.worldId ?? null, seed)
  installCobbleCap(bot)
  B.setStockWellProbe(() => well)
  const done = () => { B.setStockReaders({ town: null, well: null }); B.setCobbleTownReader(null); process.env.POOL_STATE_DIR = saved }
  return { bot, done }
}
test('STOCK CHAIN (a): a full bag of at-target logs whose town has never been counted -> the town deposit\'s COUNT step fires (no dead end)', async () => {
  const items = bag([['oak_log', 64], ['oak_log', 64], ['oak_log', 64], ['crafting_table', 1], ['wooden_pickaxe', 1, 50], ...filler(31)])
  const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i < 10 ? item('oak_log', 64) : null)) })
  const { bot, done } = await stockChain({ items, chest })
  const refused = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_stock_refused') refused.push(r.skill.detail) })
  try {
    const { ran } = await decisions(bot, 1)
    assert.equal(ran[0]?.skill, 'town_deposit', JSON.stringify(ran))
    // THE REFUSAL IS A ROW (stonecap-01 INCONCLUSIVE 10-12): the visit names what it keeps out
    assert.ok(refused.some(d => /^via=town_deposit .*oak_log:192:stock_(unknown|target)/.test(d)), `a town-deposit refusal row: ${refused.join(' | ')}`)
    const CC = await import('../src/cobblecap.mjs')
    const st = CC.readTown(process.env.POOL_STATE_DIR, CF.townKey(new Vec3(0, 70, 0)), bot.worldId ?? null)
    assert.ok(Object.values(st?.obs ?? {}).some(o => (o.m?.oak_log ?? 0) === 640), `the chest was counted: ${JSON.stringify(st?.obs)}`)
    assert.equal(sumOf(chest.items, 'oak_log'), 640, 'nothing banked into an at-target town')
  } finally { untap(); done() }
})
test('STOCK CHAIN (b): a full bag at a town at its tool target, nothing else to free -> the VALVE banks ONE spare copy (two copies are enough)', async () => {
  // filler: ladders (never bankable, never junk, never compost, on no bag-allowance row) -- wool would be the well's junk, and the
  // valve rightly waits for the well; torches were the filler until junkout-01 made them a bag-allowance row (they bank now)
  const items = bag([['stone_pickaxe', 1, 131], ['stone_pickaxe', 1, 100], ['crafting_table', 1], ...Array.from({ length: 33 }, (_, i) => ['ladder', 1 + (i % 3)])])
  // the town really holds its 16 usable stone pickaxes (the bot's own count at the open must agree with the seed)
  const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i < 16 ? item('stone_pickaxe', 1) : null)) })
  const now = Date.now()
  const { bot, done } = await stockChain({ items, chest, seed: { t: 'cnt', k: '2,70,0', n: 0, cap: now - 100, v: 2, m: { stone_pickaxe: 16 }, ids: [], scan: { keys: ['2,70,0'], at: now - 100 } } })
  try {
    const { ran } = await decisions(bot, 1)
    assert.equal(ran[0]?.skill, 'town_deposit', JSON.stringify(ran))
    assert.equal(chest.items.filter(x => x?.name === 'stone_pickaxe').length, 17, 'one copy went in, above the target')
    assert.equal(bot.inventory.items().filter(x => x.name === 'stone_pickaxe').length, 1, 'the best copy stays')
    const CC = await import('../src/cobblecap.mjs')
    assert.ok((CC.readJournal(process.env.POOL_STATE_DIR, CF.townKey(new Vec3(0, 70, 0)), bot.worldId ?? null) ?? []).some(r => r.t === 'claim' && r.kind === 'valve' && r.proof === 'nothing_else'), 'under a valve claim with its proof: ' + JSON.stringify(CC.readJournal(process.env.POOL_STATE_DIR, CF.townKey(new Vec3(0, 70, 0)), bot.worldId ?? null)))
  } finally { done() }
})
// COBBLEKEEP-01 (docs/reports/cobblekeep-01-cause-2026-10-19.md): THE DEPOSIT -> WELL CHAIN at the cap, through the REAL
// town_deposit. A full bag of cobble at a town counted COMPLETE at CAP - 16, two hours ago (inside the cap's 6 h, outside
// the floor's hour: how the fleet's towns look). The deposit refuses every stack at the cap and moves nothing; the well's
// switch for that bag must then say at_cap, or the bot has no legal move (stonecap's switch, read from the floor, said
// `below`: measured 10-19, 163 at-cap deposit refusals a day while the well threw cobble on 33 of 232 visits).
const cobbleFullBag = () => bag([['cobblestone', 30], ...Array.from({ length: 35 }, () => ['cobblestone', 64])])
const cobbleTown = async n => stockChain({ items: cobbleFullBag(), chest: chestAt(2), seed: { t: 'obs', k: '2,70,0', n, cap: Date.now() - 2 * 3600e3 } })
test('COBBLEKEEP CHAIN: town counted complete at CAP-16 -> the real town deposit refuses the cobble at the cap (a cobble_cap row, nothing moved) -> the well switch is at_cap and its plan takes the surplus to the 64 reserve', async () => {
  const { bot, done } = await cobbleTown(CAP - 16)
  const SK = await import('../src/skills.mjs')
  const W = await import('../src/well.mjs')
  const refused = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_stock_refused') refused.push(r.skill.detail) })
  try {
    const v = SK.cobbleTownViewFor(bot)
    assert.equal(v.complete, true, 'positive control: complete'); assert.equal(v.lb, CAP - 16); assert.equal(v.avail, 0, 'off the floor')
    const r = await run(bot)
    assert.equal(r.status, 'no_effect', r.detail)
    assert.ok(refused.some(d => /^via=town_deposit .*cobblestone:2270:cobble_cap/.test(d)), `the refusal names the cap: ${refused.join(' | ')}`)
    assert.equal(bot.inventory.items().length, 36, 'nothing moved')
    assert.equal(SK.cobbleWellCap(bot), 'at_cap', 'the well takes what the bank refused')
    const plan = W.disposePlan(bot.inventory.items(), { maxStacks: Infinity, cobbleAtCap: true })
    assert.equal(plan.stacks.reduce((t, x) => t + x.count, 0), 2270 - 64, 'every whole stack above the 64 reserve')
  } finally { untap(); done() }
})
test('COBBLEKEEP CHAIN CONTROL: town counted complete at CAP-64 -> the real town deposit BANKS the 30 (room for it); the well keeps the cobble', async () => {
  const { bot, done } = await cobbleTown(CAP - 64)
  const SK = await import('../src/skills.mjs')
  try {
    assert.equal(SK.cobbleWellCap(bot), 'below', 'room for the 30: the bank, not the well')
    const r = await run(bot)
    assert.equal(r.status, 'success', r.detail)
    assert.equal(bot.inventory.items().length, 35, 'one slot freed by banking')
  } finally { done() }
})
test('COBBLEKEEP CHAIN, MUTANT KILLED: stonecap\'s floor-only well switch leaves the dead end (the bank refuses, the well says below)', async () => {
  const SP = new URL('../src/skills.mjs', import.meta.url)
  const src = fs.readFileSync(SP, 'utf8')
  const old = "    return wellCobbleSwitch(cobbleTownViewFor(bot), stacks[0].count, { cap: TOWN_COBBLE_CAP, held: (h.cobblestone ?? 0) + (h.cobbled_deepslate ?? 0), floorOnly })"
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING or not unique')
  const out = new URL(`./_mutant-ck-${process.pid}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, "    const v = cobbleTownViewFor(bot); void h; return (Number(v?.avail) || 0) >= TOWN_COBBLE_CAP ? 'at_cap' : v?.complete ? 'below' : 'unknown'").replace(/from '\.\//g, "from '../src/"))
  const { bot, done } = await cobbleTown(CAP - 16)
  try {
    const M = await import(out.href)
    assert.equal(M.cobbleWellCap(bot), 'below', 'mutant inert')
  } finally { done(); try { fs.unlinkSync(out) } catch {} }
})
test('STOCK CHAIN (b) CONTROL: the same bag with a junk stack the well can take -> no valve (the well frees the slot)', async () => {
  const items = bag([['stone_pickaxe', 1, 131], ['stone_pickaxe', 1, 100], ['crafting_table', 1], ...filler(33)])
  const chest = chestAt(2)
  const now = Date.now()
  const { bot, done } = await stockChain({ items, chest, seed: { t: 'cnt', k: '2,70,0', n: 0, cap: now - 100, v: 2, m: { stone_pickaxe: 16 }, ids: [], scan: { keys: ['2,70,0'], at: now - 100 } } })
  try {
    const { ran } = await decisions(bot, 1)
    assert.notEqual(ran[0]?.skill, 'town_deposit', JSON.stringify(ran))
    assert.equal(chest.items.filter(x => x?.name === 'stone_pickaxe').length, 0)
  } finally { done() }
})
test('STOCK CHAIN (d) (Codex code r2 P2-6): at-target logs whose only count is 2 h old (a stale floor: the well may not throw) -> the COUNT step fires -> the fresh count makes the surplus stacks ELIGIBLE for the well (the plan), keeping the keep; the throw itself is the Paper stockdispose scene (count step, then the well), not this fake world', async () => {
  const items = bag([['oak_log', 64], ['oak_log', 64], ['oak_log', 64], ['crafting_table', 1], ['wooden_pickaxe', 1, 50], ...filler(31)])
  const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i < 10 ? item('oak_log', 64) : null)) })
  const old = Date.now() - 2 * 3_600_000
  const { bot, done } = await stockChain({ items, chest, seed: { t: 'cnt', k: '2,70,0', n: 0, cap: old, v: 2, m: { oak_log: 640 }, ids: [], scan: { keys: ['2,70,0'], at: old } } })
  try {
    const SK = await import('../src/skills.mjs')
    const W = await import('../src/well.mjs')
    const wellLogs = () => W.disposePlan(bot.inventory.items(), { maxStacks: Infinity, stock: SK.stockWellOpts(bot) }).stacks.filter(x => x.stock === 'oak_log').reduce((t, x) => t + x.count, 0)
    assert.equal(wellLogs(), 0, 'positive control of the gate: a stale floor throws nothing')
    // ONLY A BAG ABOVE ITS KEEP RECOUNTS (Claude code r2 P3): the same stale town, a bag holding just its keep -> no keys
    const TD0 = await import('../src/towndeposit.mjs')
    assert.ok((TD0.townKeeps({ oak_log: 16 }, { wanted: bot.currentWants ?? [] }).keep.oak_log ?? 0) >= 16, 'the fixture: 16 logs are all keep')
    assert.deepEqual(SK.stockCountKeys(bot, bag([['oak_log', 16], ['crafting_table', 1]]), { floor: true }), [], 'a bag at its keep: no recount')
    assert.deepEqual(SK.stockCountKeys(bot, bot.inventory.items(), { floor: true }), ['2,70,0'], 'positive control: 192 logs recount the stale chest')
    const { ran } = await decisions(bot, 1)
    assert.equal(ran[0]?.skill, 'town_deposit', JSON.stringify(ran))
    assert.equal(sumOf(chest.items, 'oak_log'), 640, 'nothing banked into an at-target town')
    const thrown = wellLogs()
    assert.ok(thrown >= 64 && 192 - thrown >= 0, `after the count the well takes the surplus: ${thrown} of 192`)
    const TD = await import('../src/towndeposit.mjs')
    const keep = TD.townKeeps({ oak_log: 192 }, { wanted: bot.currentWants ?? [] }).keep.oak_log ?? 0
    assert.ok(192 - thrown >= keep, `the keep (${keep}) stays: ${192 - thrown}`)
  } finally { done() }
})
// THE RECOUNT CHAIN (stocktarget-02; chest clear #2 10-14: hive-a/placebo-a stayed uncounted for hours because the only
// deterministic count fired at 34+ slots, while every deposit was refused as `*_unknown`). A FENCED town (a count, then the
// operator's reset), a bag of 7 slots holding logs, the model proposing `deposit` every decision, through the REAL loop,
// admission and skills. Expected: the count_town order fires first (whatever the bag's size), counts the chest, and the
// next deposit is judged on the count -- under target it BANKS. CONTROL (the dead end, today's 34-slot rule): with the
// recount held off, the same deposit is refused at admission as not yet counted, and the chest is unchanged.
const fencedTown = async () => {
  const items = bag([['oak_log', 64], ['oak_log', 64], ['crafting_table', 1], ['wooden_pickaxe', 1, 50], ['dirt', 16], ['stick', 4], ['ladder', 8]])
  const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i === 0 ? item('oak_log', 20) : null)) })
  const now = Date.now()
  const { bot, done } = await stockChain({ items, chest, seed: { t: 'cnt', k: '2,70,0', n: 0, cap: now - 5_000, v: 2, m: { oak_log: 20 }, ids: [], scan: { keys: ['2,70,0'], at: now - 5_000 } } })
  const CC = await import('../src/cobblecap.mjs')
  CC.appendJournal(process.env.POOL_STATE_DIR, CF.townKey(new Vec3(0, 70, 0)), bot.worldId ?? null, { t: 'reset', at: now - 1_000 })
  // the deposit finds its chest (stockChain's bot finds nothing: its tests never reach a chest by findBlock)
  bot.findBlock = ({ maxDistance = 64 } = {}) => { const ps = bot.findBlocks({ maxDistance }); return ps.length ? bot.blockAt(ps[0]) : null }
  const refused = []
  const untap = tapRecords(r => { if (/^_(stock_refused|stock_recount|stock_bank|deposit_new_chest)$/.test(r?.skill?.name ?? '')) refused.push(`${r.skill.name} ${r.skill.detail}`) })
  const { ran, loop } = await decisions(bot, 6, { propose: 'deposit', real: ['count_town', 'deposit'] })   // other town orders (the well's build) may come between
  untap()
  void loop
  return { bot, chest, ran, rows: refused, done, items }
}
test('RECOUNT CHAIN (stocktarget-02): a fenced town, a bag of 7 slots, the model proposing deposit -> count_town counts the chest at once, and the next deposit is admitted and judged on the count (a claim of the room under target)', async () => {
  const { chest, ran, rows, done } = await fencedTown()
  try {
    assert.equal(ran[0]?.skill, 'count_town', JSON.stringify(ran) + ' ' + rows.join(' | '))
    assert.equal(ran[0].status, 'success', ran[0].detail)
    assert.ok(ran[0].slots < 34, `below the town deposit's trigger: ${ran[0].slots}`)
    assert.ok(rows.some(r => /^_stock_recount trigger=order refused=2 keys=1 counted=1 tried=1 unknown_after=0 fails=- names=oak_log:stock_unknown,stick:stock_unknown/.test(r)), rows.join(' | '))
    // the deposit is ADMITTED (no admission refusal) and judged on the count: a claim of the room under 64 (64 - 20 = 44)
    // admitted on a COMPLETE count. (This fake world's chest does not take a chest.deposit transfer -- the transfer itself
    // is stocktarget.test's DEPOSIT tests and the Paper `stockrecount` scene.)
    assert.ok(ran.some(x => x.skill === 'deposit'), JSON.stringify(ran))
    // logbank-01 r2: the not-full visit's tail may bank logs above the 16 keep first (town 20 -> 52), so the claim is the room
    // left under 64 whatever came before it: planned + town_before = 64
    assert.ok(rows.some(r => { const m = /^_stock_bank group=oak_log name=oak_log planned=(\d+) .*decision=bank town_before=(\d+) .*complete=1 claims=1 refused=0/.exec(r); return m && Number(m[1]) + Number(m[2]) === 64 }), rows.join(' | '))
    assert.ok(!rows.some(r => /^_stock_refused .*_unknown/.test(r)), `no not-yet-counted refusal after the count: ${rows.join(' | ')}`)
    assert.equal(ran.filter(x => x.skill === 'count_town').length, 1, 'counted once: the town is judged now')
    void chest
  } finally { done() }
})
test('RECOUNT CHAIN CONTROL (the dead end): the same fenced town with the recount held off -> every deposit is refused at admission as not yet counted; the chest is unchanged', async () => {
  const items = bag([['oak_log', 64], ['oak_log', 64], ['crafting_table', 1], ['wooden_pickaxe', 1, 50], ['dirt', 16], ['stick', 4], ['ladder', 8]])
  const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i === 0 ? item('oak_log', 20) : null)) })
  const now = Date.now()
  const { bot, done } = await stockChain({ items, chest, seed: { t: 'cnt', k: '2,70,0', n: 0, cap: now - 5_000, v: 2, m: { oak_log: 20 }, ids: [], scan: { keys: ['2,70,0'], at: now - 5_000 } } })
  const CC = await import('../src/cobblecap.mjs')
  CC.appendJournal(process.env.POOL_STATE_DIR, CF.townKey(new Vec3(0, 70, 0)), bot.worldId ?? null, { t: 'reset', at: now - 1_000 })
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_stock_refused') rows.push(r.skill.detail) })
  try {
    const ran = []
    const runner = { isBusy: () => false, run: async (skill, args) => { ran.push(skill); const r = await SKILLS[skill].run({ bot }, args ?? {}, null); return { ...r, delta: {} } } }
    const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
    loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'deposit', args: {}, reason: 'probe' } }) }
    loop.milestones.cycle = 540
    loop.recountState = { backoffUntil: Infinity }   // today's rule: no recount below 34 slots
    loop.tailState = { backoffUntil: Infinity }      // logbank-01 r2: and no tail (its log count would end the dead end)
    loop.start()
    for (let i = 0; i < 60 && rows.length < 1; i++) await new Promise(r => setTimeout(r, 30))
    loop.stop()
    assert.ok(rows.some(d => /^via=admission .*oak_log:128:stock_unknown/.test(d)), `refused as not yet counted: ${rows.join(' | ')} ran=${ran}`)
    assert.ok(!ran.includes('count_town') && !ran.includes('deposit'), `nothing counts, nothing deposits: ${ran}`)
    assert.equal(sumOf(chest.items, 'oak_log'), 20)
  } finally { untap(); done() }
})
// THE PLINTH x RECOUNT CHAIN (plinth-01 on wellsite-02/stocktarget-02, 8cd0bc62): the same fenced town, but its well search
// found no cell (wellsite's junkwell-nosite record) and the bag is funded for the raised junk well. Order of the town
// orders: build_plinth > town_deposit > count_town. Expected: the plinth's visit first, and the recount on a LATER decision
// (neither starves the other: the plinth goes on its own cooldown after a visit). MUTANT: a recount guard that only
// yields to the town deposit takes the plinth's turn.
// A PLINTH NEEDS ONE TOWN'S RECORDS (plinth-02.1, plinth.mjs townRecordsShared): this file's bots default to the isolated
// memory scope, where each bot's town records are its own and no plinth is planned at all -- so the plinth chains run as a
// shared-town bot (board scope), as every fleet town with a plinth is.
const { config: TDCONFIG } = await import('../src/config.mjs')
async function asSharedTown (fn) {
  // ...and plinth-02's own no-site trigger: plinth-first (plinthfirst-01) is off for these chains
  const was = TDCONFIG.memory.scope, wasPf = process.env.PLINTH_FIRST
  TDCONFIG.memory.scope = 'board'; process.env.PLINTH_FIRST = '0'
  try { return await fn() } finally { TDCONFIG.memory.scope = was; if (wasPf === undefined) delete process.env.PLINTH_FIRST; else process.env.PLINTH_FIRST = wasPf }
}
const plinthFencedTown = (Loop = CognitiveLoop) => asSharedTown(() => plinthFencedTown0(Loop))
const plinthFencedTown0 = async (Loop = CognitiveLoop) => {
  const items = bag([['oak_log', 64], ['oak_log', 64], ['crafting_table', 1], ['wooden_pickaxe', 1, 50], ['dirt', 16], ['stick', 4], ['ladder', 8],
    ['cobblestone', 64], ['cobblestone', 64]])
  const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i === 0 ? item('oak_log', 20) : null)) })
  const now = Date.now()
  const { bot, done } = await stockChain({ items, chest, seed: { t: 'cnt', k: '2,70,0', n: 0, cap: now - 5_000, v: 2, m: { oak_log: 20 }, ids: [], scan: { keys: ['2,70,0'], at: now - 5_000 } } })
  const CC = await import('../src/cobblecap.mjs')
  CC.appendJournal(process.env.POOL_STATE_DIR, CF.townKey(new Vec3(0, 70, 0)), bot.worldId ?? null, { t: 'reset', at: now - 1_000 })
  fs.writeFileSync(path.join(process.env.POOL_STATE_DIR, 'junkwell-nosite-0_70_0.json'), JSON.stringify({ at: now - 60_000, world: bot.worldId ?? null, by: 'peer', tally: 'cols:0' }))
  bot.findBlock = ({ maxDistance = 64 } = {}) => { const ps = bot.findBlocks({ maxDistance }); return ps.length ? bot.blockAt(ps[0]) : null }
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    ran.push(skill)
    if (skill === 'count_town') { const r = await SKILLS[skill].run({ bot }, args ?? {}, null); return { ...r, delta: { counted: Number(r.counted ?? 0) } } }
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }   // the plinth's visit: its own suite
  } }
  const loop = new Loop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 200 && ran.length < 4; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  done()
  return ran
}
test('PLINTH x RECOUNT CHAIN (plinth-01 on 8cd0bc62): a no-site town, a funded bag, a not-yet-counted name -> build_plinth first, count_town on a later decision', async () => {
  const ran = await plinthFencedTown()
  assert.equal(ran[0], 'build_plinth', JSON.stringify(ran))
  assert.ok(ran.slice(1).includes('count_town'), `the recount is not starved: ${JSON.stringify(ran)}`)
  assert.equal(ran.filter(x => x === 'build_plinth').length, 1, `the plinth waits out its cooldown: ${JSON.stringify(ran)}`)
})
test('PLINTH x RECOUNT CHAIN, MUTANT: the recount guard yields only to the town deposit -> count_town takes the plinth\'s turn (the test sees the order)', async () => {
  const src = fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8')
  const old = "if (!order || (order.skill !== 'town_deposit' && order.skill !== 'build_plinth' && order.skill !== 'found_store' && order.skill !== 'found_work')) order = this.#recountOrder() ?? order"   // found-01 re-anchor
  assert.equal(src.split(old).length, 2, 'ANCHOR missing or not unique')
  const out = new URL(`./_mutant-cog-${process.pid}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, "if (!order || (order.skill !== 'town_deposit' && order.skill !== 'found_store' && order.skill !== 'found_work')) order = this.#recountOrder() ?? order").replace(/from '\.\//g, "from '../src/"))
  try {
    const { CognitiveLoop: M } = await import(out.href)
    const ran = await plinthFencedTown(M)
    assert.equal(ran[0], 'count_town', JSON.stringify(ran))
  } finally { fs.rmSync(out, { force: true }) }
})
// THE PLINTH x COBBLECAP-1000 CHAIN (plinth-01 on 623e92b9 = cobblecap-1000 on townzone-01). The town cap is now 1000, so a
// town counted at 800 BANKS a surplus whole stack (at 256 it refused). Order of the town orders: build_plinth > town_deposit.
// A full bag of 158 cobble (64 + 64 + 30) and a dirt cover at a no-site town counted complete at 800 cobble. Expected: the
// plinth's visit first (it is funded from the bag above STONE_GUARD 64, before anything is banked), then the town deposit
// on a later decision, which banks the smallest whole stack (30) and keeps the bag's 64 reserve (the chest 800 -> 830).
// CONTROL: the same town at exactly 1000 -> the plinth still goes first and nothing is banked (the scene sees the cap).
// Neither order starves the other.
const plinthCobbleTown = townCobble => asSharedTown(() => plinthCobbleTown0(townCobble))
const plinthCobbleTown0 = async (townCobble) => {
  const items = bag([['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 30], ['dirt', 16], ...filler(32)])
  const stacks = []
  for (let n = townCobble; n > 0; n -= 64) stacks.push(item('cobblestone', Math.min(64, n)))
  const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, (_, i) => stacks[i] ?? null) })
  const now = Date.now()
  const { bot, done } = await stockChain({ items, chest, well: false, seed: { t: 'cnt', k: '2,70,0', n: townCobble, cap: now - 5_000, v: 2, m: { cobble: townCobble }, ids: [], scan: { keys: ['2,70,0'], at: now - 5_000 } } })
  fs.writeFileSync(path.join(process.env.POOL_STATE_DIR, 'junkwell-nosite-0_70_0.json'), JSON.stringify({ at: now - 60_000, world: bot.worldId ?? null, by: 'peer', tally: 'cols:0' }))
  const P = await import('../src/plinth.mjs')
  const budget0 = P.plinthBudget(bot.inventory.items(), P.PLINTH_STEPS_PER_VISIT)
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    if (skill === 'town_deposit') { const r = await SKILLS[skill].run({ bot }, args ?? {}, null); ran.push({ skill, status: r.status, detail: r.detail }); return { ...r, delta: {} } }
    ran.push({ skill, status: 'success' })
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }   // the plinth's visit: its own suite
  } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 200 && !ran.some(r => r.skill === 'town_deposit') && ran.length < 6; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  const bagCobble = sumOf(bot.inventory.items(), 'cobblestone')
  done()
  return { ran, chestCobble: sumOf(chest.items, 'cobblestone'), bagCobble, budget0 }
}
test('PLINTH x COBBLECAP-1000 CHAIN (623e92b9): a funded no-site town counted at 800 -> build_plinth first, then town_deposit banks one whole 30-stack (800 -> 830); the bag keeps its 64 reserve', async () => {
  const { ran, chestCobble, bagCobble, budget0 } = await plinthCobbleTown(800)
  assert.ok(budget0 >= 8, `the bag funds the plinth above STONE_GUARD: budget ${budget0}`)
  assert.equal(ran[0]?.skill, 'build_plinth', JSON.stringify(ran))
  const dep = ran.find(r => r.skill === 'town_deposit')
  assert.ok(dep, `the deposit is not starved: ${JSON.stringify(ran)}`)
  assert.equal(dep.status, 'success', dep.detail)
  assert.equal(chestCobble, 830, 'the town banks the smallest whole stack under its 1000 cap')
  assert.equal(bagCobble, 128, 'the bag keeps 128 (>= its 64 reserve)')
  assert.equal(ran.filter(r => r.skill === 'build_plinth').length, 1, `the plinth waits out its cooldown: ${JSON.stringify(ran)}`)
})
test('PLINTH x COBBLECAP-1000 CHAIN, CONTROL: the same town at exactly 1000 -> build_plinth first; nothing banked (the scene sees the cap)', async () => {
  const { ran, chestCobble, bagCobble } = await plinthCobbleTown(1000)
  assert.equal(ran[0]?.skill, 'build_plinth', JSON.stringify(ran))
  assert.equal(chestCobble, 1000)
  assert.equal(bagCobble, 158, `nothing left the bag: ${JSON.stringify(ran)}`)
})
test('STOCK CHAIN (c): NO USABLE WELL -> no stop: at-target logs bank as today (a nowell claim), so the well build is never starved', async () => {
  const items = bag([['oak_log', 64], ['oak_log', 64], ['oak_log', 64], ['crafting_table', 1], ['wooden_pickaxe', 1, 50], ...filler(31)])
  const chest = chestAt(2)
  const now = Date.now()
  const { bot, done } = await stockChain({ items, chest, well: false, seed: { t: 'cnt', k: '2,70,0', n: 0, cap: now - 100, v: 2, m: { oak_log: 640 }, ids: [], scan: { keys: ['2,70,0'], at: now - 100 } } })
  try {
    const { ran } = await decisions(bot, 1)
    assert.equal(ran[0]?.skill, 'town_deposit', JSON.stringify(ran))
    assert.ok(sumOf(chest.items, 'oak_log') > 0, 'the logs were banked')
    const CC = await import('../src/cobblecap.mjs')
    assert.ok((CC.readJournal(process.env.POOL_STATE_DIR, CF.townKey(new Vec3(0, 70, 0)), bot.worldId ?? null) ?? []).some(r => r.t === 'claim' && r.kind === 'nowell'), 'under a nowell claim')
  } finally { done() }
})

// ---- IRONPICK-01 x THE TOWN DEPOSIT: the toolkit's fresh iron pickaxe is never banked straight back -------------------------
// A full bag at town holding the kit's NEW iron pickaxe (250 uses) beside the worn one it replaced (30) and a stone spare: the REAL
// town deposit keeps one usable copy per name and banks worst-first, so the fresh copy stays (client and server bags); the worn
// copy is at most a banked spare (keep-one), never dropped. CONTROL: two worn copies (35, 30) -> the BETTER one stays -- the rule
// is "the best stays", which is what keeps the fresh copy.
test('IRONPICK-01 x TOWN DEPOSIT: the fresh iron pickaxe stays in a full bag the real deposit banks from; the worn copy is a spare at most, nothing dropped', async () => {
  const mk = (a, b) => bag([['iron_pickaxe', 1, a], ['iron_pickaxe', 1, b], ['stone_pickaxe', 1, 90], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 20],
    ['oak_log', 64], ['oak_log', 64], ['oak_log', 10], ['apple', 45], ['raw_iron', 5], ['coal', 9], ['dirt', 30], ['raw_copper', 7], ...filler(22)])
  for (const [a, b, best] of [[250, 30, 250], [35, 30, 35]]) {
    const items = mk(a, b); assert.equal(items.length, 36)
    const c = chestAt(2)
    const w = world({ items, containers: [c] })
    const { out: r } = await rowsOf(() => run(w.bot))
    assert.equal(r.status, 'success', r.detail)
    for (const now of [w.bot.inventory.items(), serverBag(w)]) {
      const iron = now.filter(i => i.name === 'iron_pickaxe').map(i => 250 - i.durabilityUsed)
      assert.ok(iron.includes(best), `the best iron copy (${best}) stays: ${iron}`)
    }
    assert.ok(sumOf(c.items, 'iron_pickaxe') <= 1, 'at most the worse copy is banked (keep one usable per name)')
    assert.equal(w.st.dropped, 0); assert.equal(total(serverBag(w)) + total(c.items), total(items), 'nothing lost')
  }
})

// ==================================================================================================================
// junkout-01 (docs/reports/junkout-01-design-2026-10-21.md section 3 C): THE SLIM BAG ALLOWANCE AT A NOT-FULL VISIT, through
// the REAL CognitiveLoop and the REAL town_deposit. A 12-slot bag at town with torches, bone meal, junk and a CRAFT-READY rung
// (the stone pickaxe): the tail order comes AHEAD of the rung, once; the chest gets the torches and the bone meal, never the
// junk; the rung gets the next decisions. A full chest lands in the TAIL's backoff, never the full-bag deposit's.
const tailBot = ({ chest = chestAt(2) } = {}) => {
  // chainBot's bag (the stone pickaxe rung craft-ready), NOT full, plus the rows' names and junk
  const items = bag([['dirt', 16], ['oak_log', 6], ['oak_log', 10], ['sand', 8], ['cobblestone', 64], ['cobblestone', 20], ['crafting_table', 1],
    ['wooden_pickaxe', 1, 50], ['stick', 8], ['furnace', 1], ['raw_copper', 5], ['torch', 11], ['bone_meal', 30], ['egg', 12], ['flint', 9], ['oak_sapling', 20], ['chest', 8]])
  const { bot } = world({ items, containers: [chest], botAt: new Vec3(3, 70, 0) })
  Object.assign(bot, { health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: id => (id === mcData.itemsByName.stone_pickaxe.id ? [{ delta: [] }] : []), recipesAll: () => [],
    findBlock: () => null, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'TownBot' })
  return bot
}
test('junkout-01 TAIL CHAIN (real loop): a not-full bag at town -> town_deposit {tail} ahead of the ready rung, ONCE -> torch + bone meal banked, junk never, the stations stay', async () => {
  const chest = chestAt(2)
  const bot = tailBot({ chest })
  const slots0 = bot.inventory.items().length
  const jrows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_junkout') jrows.push(r.skill.detail) })
  let ran, loop
  try { ({ ran, loop } = await decisions(bot, 5)) } finally { untap() }
  // the bank row the read's J1/J2 parse: complete, mode=tail, the start count : the server-verified banked, the order's dh/dy
  const bank = jrows.filter(d => /^phase=bank /.test(d))
  assert.equal(bank.length, 1, jrows.join(' | '))
  assert.match(bank[0], /^phase=bank v=TownBot\.\w+ mode=tail armed=first dh=3 dy=0 peaceful=\d stacks=2 banked=41 slots=17->15 keep_picks=0 rows=bone_meal:1,torch:1 part=1\/1 allow=bone_meal=30:30 allow=torch=11:11$/)
  const td = ran.filter(x => x.skill === 'town_deposit')
  assert.equal(td.length, 1, `one tail run in the stay: ${JSON.stringify(ran.map(x => x.skill))}`)
  assert.equal(ran[0].skill, 'town_deposit', 'ahead of the craft-ready rung (bounded: once per stay)')
  assert.ok(td[0].slots < 34 && td[0].slots === slots0, `a not-full bag: ${td[0].slots}`)
  assert.equal(td[0].status, 'success', td[0].detail)
  assert.equal(sumOf(chest.items, 'torch'), 11); assert.equal(sumOf(chest.items, 'bone_meal'), 30)
  for (const n of ['egg', 'flint', 'oak_sapling', 'cobblestone', 'chest', 'crafting_table', 'wooden_pickaxe', 'stick', 'dirt', 'oak_log', 'raw_copper', 'furnace']) assert.equal(sumOf(chest.items, n), 0, `${n} never banked by the tail`)
  assert.equal(sumOf(bot.inventory.items(), 'chest'), 8, 'one stack of chests is one station slot: it stays')
  assert.ok(ran.slice(1).some(x => x.skill === 'craft'), `the rung gets its turns after: ${JSON.stringify(ran.map(x => x.skill))}`)
  assert.equal(loop.tailState.latched, true); assert.equal(loop.townDepositState?.lastIssuedAt, undefined, 'the full-bag deposit was never issued')
})
test('junkout-01 TAIL CHAIN (real loop): the chests in reach are FULL -> the tail run fails town_storage_full and backs off ITS state; the full-bag deposit\'s state is untouched', async () => {
  const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, () => item('dirt', 64)) })
  const bot = tailBot({ chest })
  const { ran, loop } = await decisions(bot, 3)
  const td = ran.find(x => x.skill === 'town_deposit')
  assert.equal(td?.status, 'failed', JSON.stringify(ran)); assert.match(td.detail, /waits for a town chest with room -- keep working/)
  assert.ok(loop.tailState.backoffUntil > Date.now(), 'the tail backs off')
  assert.equal(loop.townDepositState?.backoffUntil, undefined, 'the full-bag deposit does not')
})
test('junkout-01 MUTANT (cognitive): the tail outcome routed into the full-bag deposit\'s state -> a full chest backs off the FULL-bag deposit (killed)', async () => {
  const CPU = new URL('../src/cognitive.mjs', import.meta.url)
  const src = fs.readFileSync(CPU, 'utf8')
  const old = "        if (admitted.args?.tail === true) {\n"
  assert.equal(src.split(old).length, 2, 'ANCHOR missing or not unique')
  const out = new URL(`./_mutant-cog-tail-${process.pid}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, '        if (false) {\n').replace(/from '\.\//g, "from '../src/"))
  try {
    const { CognitiveLoop: M } = await import(out.href)
    const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, () => item('dirt', 64)) })
    const bot = tailBot({ chest })
    const ran = []
    const runner = { isBusy: () => false, run: async (skill, args) => {
      if (skill === 'town_deposit') { const r = await SKILLS[skill].run({ bot }, args ?? {}, null); ran.push(skill); return { ...r, delta: {} } }
      ran.push(skill); return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
    } }
    const loop = new M(bot, runner, freshLessons(), null)
    loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
    loop.milestones.cycle = 540
    loop.start()
    for (let i = 0; i < 200 && ran.length < 3; i++) await new Promise(r => setTimeout(r, 30))
    loop.stop()
    assert.ok(loop.townDepositState?.backoffUntil > Date.now(), 'mutant inert')
  } finally { try { fs.unlinkSync(out) } catch {} }
})
test('junkout-01 TAIL CHAIN, BAG_ALLOWANCE off (the order\'s own switch): no tail order; the bag rides on', () => {
  const r = TD.tailOrder({ now: 1e7, slots: 12, pos: { x: 3, y: 70, z: 0 }, home: { x: 0, y: 70, z: 0 }, plan: { freed: 2, steps: [{ allowance: 'torch' }] }, container: true, state: {}, on: false })
  assert.equal(r.order, null)
})
// junkout-01 code r1 (both engines): (1) a visit order that cannot win the decision is never ISSUED -- the recount holds the
// first decision, and the tail still comes in the same stay; (2) a DECLINED tail restores the reason that armed it (J5).
test('junkout-01 CHAIN (code r1): the town recount wins the first decision -> the tail is NOT spent behind it; it comes on a later decision of the same stay', async () => {
  const items = bag([['oak_log', 64], ['oak_log', 64], ['crafting_table', 1], ['wooden_pickaxe', 1, 50], ['dirt', 16], ['stick', 4], ['torch', 8]])
  const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i === 0 ? item('oak_log', 20) : null)) })
  const now = Date.now()
  const { bot, done } = await stockChain({ items, chest, seed: { t: 'cnt', k: '2,70,0', n: 0, cap: now - 5_000, v: 2, m: { oak_log: 20 }, ids: [], scan: { keys: ['2,70,0'], at: now - 5_000 } } })
  const CC = await import('../src/cobblecap.mjs')
  CC.appendJournal(process.env.POOL_STATE_DIR, CF.townKey(new Vec3(0, 70, 0)), bot.worldId ?? null, { t: 'reset', at: now - 1_000 })
  bot.findBlock = ({ maxDistance = 64 } = {}) => { const ps = bot.findBlocks({ maxDistance }); return ps.length ? bot.blockAt(ps[0]) : null }
  try {
    const { ran } = await decisions(bot, 6, { real: ['count_town'] })
    assert.equal(ran[0]?.skill, 'count_town', JSON.stringify(ran.map(x => x.skill)))
    assert.ok(ran.some(x => x.skill === 'town_deposit'), `the tail came after the recount: ${JSON.stringify(ran.map(x => x.skill))}`)
    assert.equal(sumOf(chest.items, 'torch'), 8, 'banked by the tail')
  } finally { done() }
})
test('junkout-01 CHAIN (code r1): a DECLINED tail un-latches and keeps the reason that armed it (out:...), so the retry carries it', async () => {
  const bot = tailBot()
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    ran.push({ skill, args })
    if (skill === 'town_deposit') return { status: 'failed', failClass: 'runner_busy', detail: 'declined', delta: {} }
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.tailState = { armed: 'out:abc-def' }
  loop.start()
  for (let i = 0; i < 200 && !ran.some(x => x.skill === 'town_deposit'); i++) await new Promise(r => setTimeout(r, 30))
  await new Promise(r => setTimeout(r, 100))
  loop.stop()
  const td = ran.find(x => x.skill === 'town_deposit')
  assert.equal(td?.args?.armed, 'out:abc-def', JSON.stringify(td))
  assert.equal(loop.tailState.latched, false, 'declined: the stay is not spent')
  assert.equal(loop.tailState.armed, 'out:abc-def', 'the retry carries the reason that armed the declined order')
})

// the two code-r1 fixes, each killed by its mutant through the same chains
async function withCogMutant (old, neu, fn) {
  const CPU = new URL('../src/cognitive.mjs', import.meta.url)
  const src = fs.readFileSync(CPU, 'utf8')
  assert.equal(src.split(old).length, 2, 'ANCHOR missing or not unique')
  const out = new URL(`./_mutant-cog-jo-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn((await import(out.href)).CognitiveLoop) } finally { try { fs.unlinkSync(out) } catch {} }
}
test('junkout-01 MUTANT (cognitive): a blocked visit order issued and discarded (the r1 code) -> the tail never comes in the stay (killed)', async () => {
  await withCogMutant('      const visit = this.#visitOrder(milestone, { tickOnly: blocked })\n      if (visit) order = visit\n',
    '      const visit = this.#visitOrder(milestone)\n      if (visit && !blocked) order = visit\n', async M => {
      const items = bag([['oak_log', 64], ['oak_log', 64], ['crafting_table', 1], ['wooden_pickaxe', 1, 50], ['dirt', 16], ['stick', 4], ['torch', 8]])
      const chest = chestAt(2, 70, 0, { items: Array.from({ length: 27 }, (_, i) => (i === 0 ? item('oak_log', 20) : null)) })
      const now = Date.now()
      const { bot, done } = await stockChain({ items, chest, seed: { t: 'cnt', k: '2,70,0', n: 0, cap: now - 5_000, v: 2, m: { oak_log: 20 }, ids: [], scan: { keys: ['2,70,0'], at: now - 5_000 } } })
      const CC = await import('../src/cobblecap.mjs')
      CC.appendJournal(process.env.POOL_STATE_DIR, CF.townKey(new Vec3(0, 70, 0)), bot.worldId ?? null, { t: 'reset', at: now - 1_000 })
      bot.findBlock = ({ maxDistance = 64 } = {}) => { const ps = bot.findBlocks({ maxDistance }); return ps.length ? bot.blockAt(ps[0]) : null }
      const ran = []
      const runner = { isBusy: () => false, run: async (skill, args) => {
        const r = ['count_town', 'town_deposit'].includes(skill) ? await SKILLS[skill].run({ bot }, args ?? {}, null) : { status: 'success', detail: 'ok', contractEvidence: [`${skill}: probe 1`] }
        ran.push(skill); return { ...r, delta: { counted: Number(r.counted ?? 0) } }
      } }
      const loop = new M(bot, runner, freshLessons(), null)
      loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
      loop.milestones.cycle = 540
      try {
        loop.start()
        for (let i = 0; i < 200 && ran.length < 6; i++) await new Promise(r => setTimeout(r, 30))
        loop.stop()
        assert.equal(ran[0], 'count_town', JSON.stringify(ran))
        assert.ok(ran.length >= 6, `the six decisions ran (else the poll expired): ${JSON.stringify(ran)}`)
        assert.ok(!ran.includes('town_deposit'), `mutant inert: ${JSON.stringify(ran)}`)
      } finally { done() }
    })
})
test('junkout-01 MUTANT (cognitive): the declined tail\'s restore removed -> the retry would say first (killed)', async () => {
  await withCogMutant('          if (RUNNER_DECLINED.has(r.failClass ?? null)) this.tailState = visitLatchDeclined(this.tailState)\n', '', async M => {
    const bot = tailBot()
    const ran = []
    const runner = { isBusy: () => false, run: async (skill, args) => {
      ran.push(skill)
      if (skill === 'town_deposit') return { status: 'failed', failClass: 'runner_busy', detail: 'declined', delta: {} }
      return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
    } }
    const loop = new M(bot, runner, freshLessons(), null)
    loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
    loop.milestones.cycle = 540
    loop.tailState = { armed: 'out:abc-def' }
    loop.start()
    for (let i = 0; i < 200 && !ran.includes('town_deposit'); i++) await new Promise(r => setTimeout(r, 30))
    await new Promise(r => setTimeout(r, 100))
    loop.stop()
    assert.ok(ran.includes('town_deposit'), 'positive control: the tail was ordered')
    assert.notEqual(loop.tailState.armed, 'out:abc-def', 'mutant inert')
  })
})

// ---- jit-1023: junkout-01 x keepout-01 (Codex rebase review P2) --------------------------------------------------------
// The keep-out exit is LAST in the decision chain and overrides any order. A visit issued on a decision the exit takes would
// spend the visit's latch (and the well's / composter's cooldown) on a run that never happens -- for the rest of the stay.
// THE CHAIN: a not-full bag at town, standing in a NON-yielded fire column -> the exit first, the visit only ticked -> the bot
// is out (still in the town zone) -> the tail visit issues on the next decision and banks the rows. Controls: a YIELDED (C12)
// column lets the tail run inside, no exit; the mutant (no exit check) spends the visit behind the exit.
const KO_SITE = { kind: 'death:fire', x: 3, y: 66, z: 0, count: 4, deaths: 1, last: Date.now(), by: ['x'] }
async function koTailChain (Loop, { yielded = false, pre = null } = {}) {
  const chest = chestAt(2)
  const bot = tailBot({ chest })
  bot.fireSitesNow = () => [KO_SITE]
  bot.keepoutYields = () => yielded
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    ran.push(skill)
    // the exit gets the body out of the column (9 east of the site's centre; still inside the town deposit's zone)
    if (skill === 'keepout_exit') { bot.entity.position = new Vec3(12, 70, 0); return { status: 'success', detail: 'out', delta: {}, contractEvidence: ['keepout_exit: left the column'] } }
    if (skill === 'town_deposit') { const r = await SKILLS[skill].run({ bot }, args ?? {}, null); return { ...r, delta: {} } }
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new Loop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  pre?.(loop)
  loop.start()
  for (let i = 0; i < 200 && ran.length < 4; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  assert.ok(ran.length >= 4, `the four decisions ran (else the poll expired): ${JSON.stringify(ran)}`)
  return { ran, loop, chest, bot }
}
test('junkout-01 x KEEPOUT CHAIN (real loop): in a non-yielded fire column the exit goes first and the visit is NOT spent; out of the column the tail runs and banks the rows', async () => {
  const { ran, loop, chest } = await koTailChain(CognitiveLoop)
  assert.equal(ran[0], 'keepout_exit', JSON.stringify(ran))
  assert.ok(ran.slice(1).includes('town_deposit'), `the tail came once the bot was out: ${JSON.stringify(ran)}`)
  assert.equal(ran.filter(s => s === 'town_deposit').length, 1, `once per stay: ${JSON.stringify(ran)}`)
  assert.equal(sumOf(chest.items, 'torch'), 11); assert.equal(sumOf(chest.items, 'bone_meal'), 30)
  assert.equal(loop.tailState.latched, true, 'the visit is spent by the run that happened')
})
test('junkout-01 x KEEPOUT CONTROL (real loop): a YIELDED column (C12 town job) -> no exit; the tail runs where the bot stands', async () => {
  const { ran, chest, bot } = await koTailChain(CognitiveLoop, { yielded: true })
  assert.equal(ran[0], 'town_deposit', JSON.stringify(ran))
  assert.ok(!ran.includes('keepout_exit'), JSON.stringify(ran))
  assert.equal(sumOf(chest.items, 'torch'), 11)
  // the yield is COUNTED once when it starts (the exit order's own counter; the visit's probe never counts one)
  assert.equal(bot.keepoutStats?.yield_town_job, 1, JSON.stringify(bot.keepoutStats ?? null))
})
// THE BOUNDARY (Codex fix review P2): the probe and the exit's own call can disagree (the exit's back-off runs out between
// them). Simulated by disabling the probe: the visit is issued, the exit displaces it, and the displaced visit is REFUNDED.
const { withMutantsAll } = await import('./helpers/mutant.mjs')
const COG_TD = new URL('../src/cognitive.mjs', import.meta.url)
const PROBE = [' || exitFirst()\n', '\n']
// re-anchored (junkout-01 x found-01, JIT 10-24): the override also carries found-01's refund (refundDeclined) ahead of the
// visit's; the mutant removes the visit's refund only, so the found refund stays as in the real line
const REFUND = [' Object.assign(this, visitDisplacedRefund(order, this)); order = ko } }', ' order = ko } }']
test('junkout-01 x KEEPOUT BOUNDARY (real loop): a visit issued and then DISPLACED by the exit is refunded -- the tail still runs once the bot is out', async () => {
  await withMutantsAll(COG_TD, [PROBE], async mod => {
    const { ran, loop, chest } = await koTailChain(mod.CognitiveLoop)
    assert.equal(ran[0], 'keepout_exit', JSON.stringify(ran))
    assert.equal(ran.filter(s => s === 'town_deposit').length, 1, `the displaced tail came back once: ${JSON.stringify(ran)}`)
    assert.equal(sumOf(chest.items, 'torch'), 11)
    assert.equal(loop.tailState.latched, true)
  })
})
test('junkout-01 x KEEPOUT MUTANT (cognitive): neither the probe nor the refund -> the tail is spent behind the exit: no tail after it (killed)', async () => {
  await withMutantsAll(COG_TD, [PROBE, REFUND], async mod => {
    const { ran, loop, chest } = await koTailChain(mod.CognitiveLoop)
    assert.equal(ran[0], 'keepout_exit', JSON.stringify(ran))
    assert.ok(!ran.includes('town_deposit'), `mutant: the visit was spent behind the exit: ${JSON.stringify(ran)}`)
    assert.equal(sumOf(chest.items, 'torch'), 0)
    assert.equal(loop.tailState.latched, true, 'latched by an order that never ran')
  })
})
test('junkout-01 x KEEPOUT MUTANT (cognitive): the exit order without its own `bot` (the split\'s regression, caught by no-undef) -> the C12 yield is never counted (killed)', async () => {
  await withCogMutant('      const bot = this.bot\n      const d = this.#keepoutExitDecision(order)\n', '      const d = this.#keepoutExitDecision(order)\n', async M => {
    const { ran, bot } = await koTailChain(M, { yielded: true })
    assert.equal(ran[0], 'town_deposit', JSON.stringify(ran))
    assert.equal(bot.keepoutStats?.yield_town_job ?? 0, 0, 'mutant inert')
  })
})
test('visitDisplacedRefund (pure): each visit order un-latches with its armed reason and gets back what its issue charged; nothing else is touched', async () => {
  const { visitDisplacedRefund } = await import('../src/cognitive.mjs')
  const { TOWN_JOB_SKILLS } = await import('../src/keepout.mjs')
  const latched = { latched: true, issuedAt: 5, armedUsed: 'out:a-b', armed: null, lastScanAt: 5 }
  const w = visitDisplacedRefund({ skill: 'dispose_well', args: { visit: true } }, { wellVisitState: latched, wellState: { lastDisposeAt: 5, disposeBackoffUntil: 9 } })
  assert.deepEqual(w, { wellVisitState: { ...latched, latched: false, armed: 'out:a-b', lastScanAt: -Infinity }, wellState: { lastDisposeAt: -Infinity, disposeBackoffUntil: 9 } })
  const c = visitDisplacedRefund({ skill: 'compost', args: { visit: true } }, { compostVisitState: latched, townState: { lastCompostAt: 5, compostBackoffUntil: 9 } })
  assert.deepEqual(c, { compostVisitState: { ...latched, latched: false, armed: 'out:a-b', lastScanAt: -Infinity }, townState: { lastCompostAt: -Infinity, compostBackoffUntil: 9 } })
  const t = visitDisplacedRefund({ skill: 'town_deposit', args: { tail: true } }, { tailState: { ...latched, lastIssuedAt: 5, backoffUntil: 9 } })
  assert.deepEqual(t, { tailState: { ...latched, latched: false, armed: 'out:a-b', lastScanAt: -Infinity, lastIssuedAt: -Infinity, backoffUntil: 9 } })
  // not a visit: the full-bag deposit, the full-bag well order, the town compost order, any other skill -> nothing
  for (const o of [{ skill: 'town_deposit', args: {} }, { skill: 'dispose_well', args: {} }, { skill: 'compost', args: {} }, { skill: 'gather', args: { visit: true } }, null]) {
    assert.deepEqual(visitDisplacedRefund(o, { tailState: latched, wellVisitState: latched, compostVisitState: latched }), {}, JSON.stringify(o))
  }
  // the probe asks ONE visit skill for all three: they must all be town jobs (exitDecision's only use of the skill)
  for (const s of ['dispose_well', 'compost', 'town_deposit']) assert.ok(TOWN_JOB_SKILLS.has(s), s)
})
test('junkout-01 x KEEPOUT CONTROL (real loop): the exit BACKING OFF (a failed exit) -> the probe does not block; the tail runs inside the column', async () => {
  const { ran, chest } = await koTailChain(CognitiveLoop, { pre: loop => { loop.keepoutExitBackoffUntil = Date.now() + 60_000 } })
  assert.equal(ran[0], 'town_deposit', JSON.stringify(ran))
  assert.ok(!ran.includes('keepout_exit'), JSON.stringify(ran))
  assert.equal(sumOf(chest.items, 'torch'), 11)
})

// ---- logbank-01 (OWNER 10-27): bank the logs, keep a small personal amount (16 wood units) -------------------------------
const WK = await import('../src/woodkeep.mjs')
const logsIn = l => LOGS.reduce((t, n) => t + sumOf(l, n), 0)

test('LOGBANK: ONE number -- the deposit keep, the stockpile_wood ceiling and found\'s no-floor wood are WOOD_KEEP (16); stone stays 64', () => {
  assert.equal(WK.LOGBANK.on, true, 'on by default (no env)'); assert.equal(TD.WOOD_KEEP, 16); assert.equal(WK.WOOD_KEEP, 16)
  for (const n of [0, 1, 2, 3, 14, 540]) assert.ok(MS.woodStockpileTarget(n) <= TD.WOOD_KEEP, `lap ${n}`)
  assert.equal(MS.woodStockpileTarget(540), TD.WOOD_KEEP, 'the rung asks for exactly the keep at its ceiling')
  assert.equal(MS.stockpileTarget(16, 8, 540), 64, 'stone still escalates to 64')
  assert.equal(townKeeps({ oak_log: 73 }).keep.oak_log, 16)
  assert.equal(townKeeps({ cobblestone: 100 }).keep.cobblestone, 64, 'cobble unchanged (owner did not ask)')
})

test('LOGBANK half-split, pure: 64 with room 48 -> 32 then 16 (keeps exactly 16); never below the keep; a single log never splits', () => {
  assert.deepEqual(TD.logHalfSteps([{ slot: 9, count: 64 }], 48), [{ slot: 9, count: 32, from: 64, half: true }, { slot: 9, count: 16, from: 32, half: true }])
  assert.deepEqual(TD.logHalfSteps([{ slot: 9, count: 64 }], 31), [], 'no half fits: nothing moves')
  assert.deepEqual(TD.logHalfSteps([{ slot: 9, count: 1 }], 5), [])
  for (let held = 2; held <= 64; held++) for (let room = 0; room < held; room++) {
    const moved = TD.logHalfSteps([{ slot: 9, count: held }], room).reduce((t, x) => t + x.count, 0)
    assert.ok(moved <= room, `held ${held} room ${room}: moved ${moved} past the keep`)
  }
})

test('LOGBANK plan: a bot holding 64+9 logs banks the 9 whole and halves the 64 down to 16; halves never count in freed', () => {
  const items = bag([['oak_log', 64], ['oak_log', 9], ...filler(34)])
  const p = townDepositPlan(items, { tail: false })
  const logs = p.steps.filter(s => s.name === 'oak_log')
  assert.deepEqual(logs.map(s => [s.count, !!s.half]), [[9, false], [32, true], [16, true]])
  assert.equal(p.freed, 1, 'only the whole 9-stack frees a slot')
  assert.equal(logsIn(after(items, p)), 16, 'the bag keeps exactly the personal 16')
  // a single 64 stack: before logbank the whole-stack rule could move nothing (64 > room 48)
  const one = townDepositPlan(bag([['oak_log', 64], ...filler(35)]), { tail: false })
  assert.equal(logsIn(after(bag([['oak_log', 64], ...filler(35)]), one)), 16)
  assert.equal(one.freed, 0, 'a half alone frees nothing, so it never fires a full-bag order by itself')
  // MUTANT: halves off (the kill switch's planner path) -> the 64 stays
  const off = townDepositPlan(items, { tail: false, halves: false })
  assert.equal(logsIn(after(items, off)), 64, 'without halves only the 9 leaves')
})

test('LOGBANK SKILL: a full bag with 64+64+10 logs at town banks down toward 16 through real clicks; the row says logs banked/kept', async () => {
  const items = bag([['oak_log', 64], ['oak_log', 64], ['oak_log', 10], ...filler(33)]); const c = chestAt(2)
  const w = world({ items, containers: [c] })
  const { out: r, rows } = await rowsOf(() => run(w.bot))
  assert.equal(r.status, 'success', r.detail)
  const kept = logsIn(serverBag(w)), banked = sumOf(c.items, 'oak_log')
  assert.equal(kept + banked, 138, 'nothing lost'); assert.equal(w.st.dropped, 0); assert.equal(w.st.loadedCloses, 0)
  assert.ok(w.st.rightClicks >= 1, 'a half-split ran')
  assert.equal(banked, 58, 'the 10 whole + 32 + 16 halved from one 64; the visit\'s creditCap 64 bounds it')
  assert.ok(banked <= TD.CREDIT_CAP && kept >= TD.WOOD_KEEP)
  assert.match(rows[0].skill.detail, new RegExp(`logs banked ${banked} kept ${kept} keep 16`))
})

test('LOGBANK r1 fixes: halves rank LAST (after the rows), never block the valve, and a full bag of logs-only surplus fires the order', () => {
  const items = bag([['oak_log', 64], ['torch', 12], ...filler(34)])
  const p = townDepositPlan(items, {})
  const last = p.steps.findIndex(s => s.half)
  assert.ok(last >= 0, 'positive control: a half is planned')
  assert.ok(p.steps.slice(last).every(s => s.half), `halves after every whole stack: ${JSON.stringify(p.steps)}`)
  assert.equal(fitToContainer(p.steps, [null, ...Array(26).fill(item('dirt', 64))])[0].half, undefined, 'one empty slot takes the slot-freeing stack')
  // the order: freed 0 but a log half -> town_deposit at a full bag; the same plan without halves -> nothing
  const P = { x: 3, y: 70, z: 0 }, HOME = { x: 0, y: 70, z: 0 }
  const half = { freed: 0, steps: [{ slot: 9, name: 'oak_log', count: 32, half: true }] }
  assert.equal(townDepositOrder({ now: 1e9, slots: 36, pos: P, home: HOME, plan: half, container: true }).order?.skill, 'town_deposit')
  assert.equal(townDepositOrder({ now: 1e9, slots: 36, pos: P, home: HOME, plan: { freed: 0, steps: [] }, container: true }).order, null, 'control: nothing to bank, no order')
})

test('LOGBANK SKILL: a right click that lifts the wrong count stops the run and settles the cursor back; nothing dropped or credited wrongly', async () => {
  const items = bag([['oak_log', 64], ...filler(35)]); const c = chestAt(2)
  const w = world({ items, containers: [c] })
  const inner = w.bot.clickWindow
  w.bot.clickWindow = async (slot, btn, mode) => {   // the server splits differently from the plan's prediction: 1 short
    await inner(slot, btn, mode)
    if (btn === 1) { const win = w.bot.currentWindow; win.selectedItem.count -= 1; win.slots[slot].count += 1; win.server.selectedItem.count -= 1; win.server.slots[slot].count += 1 }
  }
  const r = await run(w.bot)
  assert.notEqual(r.status, 'success')
  assert.equal(w.st.dropped, 0); assert.equal(w.st.loadedCloses, 0)
  assert.equal(logsIn(serverBag(w)) + sumOf(c.items, 'oak_log'), 64, 'nothing lost')
  assert.equal(sumOf(c.items, 'oak_log'), 0, 'the wrong-count cursor is never put in the chest')
})

test('LOGBANK r2: the NOT-FULL visit (tail) banks logs above the keep at any bag size -- 64+9 in a half-empty bag -> 16; nothing else of the base plan joins', () => {
  const items = bag([['oak_log', 64], ['oak_log', 9], ['cobblestone', 64], ['cobblestone', 20], ['stone_pickaxe', 1, 100], ['stone_pickaxe', 1, 60], ...filler(10)])
  assert.ok(items.length < TD_TRIGGER_SLOTS)
  const p = townDepositPlan(items, { tail: 'only' })
  assert.ok(p.steps.every(s => s.name === 'oak_log'), `only logs from the base side: ${JSON.stringify(p.steps)}`)
  assert.equal(logsIn(after(items, p)), 16)
  // the order fires on the logs alone (freed 1 from the 9; a halves-only plan too)
  const P = { x: 3, y: 70, z: 0 }, HOME = { x: 0, y: 70, z: 0 }
  assert.equal(TD.tailOrder({ now: 1e9, slots: items.length, pos: P, home: HOME, plan: p, container: true, state: {}, on: true }).order?.skill, 'town_deposit')
  const one = townDepositPlan(bag([['oak_log', 64], ...filler(10)]), { tail: 'only' })
  assert.equal(one.freed, 0)
  assert.equal(TD.tailOrder({ now: 1e9, slots: 11, pos: P, home: HOME, plan: one, container: true, state: {}, on: true }).order?.skill, 'town_deposit', 'a lone 64 stack still gets the order')
  // CONTROLS: the switch off (halves false) -> no log step; a bag at the keep -> nothing
  assert.deepEqual(townDepositPlan(items, { tail: 'only', halves: false }).steps.filter(s => s.name === 'oak_log'), [])
  assert.deepEqual(townDepositPlan(bag([['oak_log', 16], ...filler(10)]), { tail: 'only' }).steps, [])
})

test('LOGBANK r2 SKILL: a tail run (half-empty bag) with 64+9 logs ends with exactly 16 in the SERVER bag and 57 in the chest', async () => {
  const items = bag([['oak_log', 64], ['oak_log', 9], ...filler(10)]); const c = chestAt(2)
  const w = world({ items, containers: [c] })
  const r = await SKILLS.town_deposit.run({ bot: w.bot }, { tail: true }, null)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(logsIn(serverBag(w)), 16); assert.equal(sumOf(c.items, 'oak_log'), 57)
  assert.equal(w.st.dropped, 0)
})

test('LOGBANK r2: a tail with logs the town cannot judge yet (never counted) COUNTS first; a judged town or no logs -> no count', () => {
  const P = { x: 3, y: 70, z: 0 }, HOME = { x: 0, y: 70, z: 0 }, empty = { freed: 0, steps: [] }
  const r = TD.tailOrder({ now: 1e9, slots: 11, pos: P, home: HOME, plan: empty, container: true, state: {}, on: true, logCount: true })
  assert.equal(r.order?.skill, 'town_deposit'); assert.equal(r.order.args.recount, true); assert.equal(r.order.args.logs, true); assert.equal(r.order.args.tail, true)
  assert.equal(TD.tailOrder({ now: 1e9, slots: 11, pos: P, home: HOME, plan: empty, container: true, state: {}, on: true, logCount: false }).order, null, 'control: nothing to count, nothing to bank')
  const withLogs = TD.tailOrder({ now: 1e9, slots: 11, pos: P, home: HOME, plan: { freed: 0, steps: [{ slot: 9, name: 'oak_log', count: 32, half: true }] }, container: true, state: {}, on: true, logCount: true })
  assert.equal(withLogs.order.args.recount, undefined, 'a judged town banks without a count')
})

test('LOGBANK r2 reviews: the log count rides along with a rows order (never skipped for a torch); LOGBANK off -> tailOrder ignores log steps', () => {
  const P = { x: 3, y: 70, z: 0 }, HOME = { x: 0, y: 70, z: 0 }
  const rows = { freed: 1, steps: [{ slot: 12, name: 'torch', count: 4, allowance: 'torch' }] }
  const r = TD.tailOrder({ now: 1e9, slots: 11, pos: P, home: HOME, plan: rows, container: true, state: {}, on: true, logCount: true })
  assert.equal(r.order.args.recount, true, 'the count is in the same run as the torch'); assert.equal(r.order.args.logs, true)
  assert.equal(TD.tailOrder({ now: 1e9, slots: 11, pos: P, home: HOME, plan: rows, container: true, state: {}, on: true, logCount: false }).order.args.recount, undefined, 'control')
})

// ---- logbank-01 r3 (LIVE showcase-e8525ca4, 10-27): the showcase's logs are SPRUCE -----------------------------------------
test('LOGBANK r3: every log species banks (spruce, the showcase\'s only log; was not_wanted: STANDING_TARGETS name oak/birch/jungle); off -> the old rule', () => {
  for (const name of LOGS) {
    const items = bag([[name, 64], [name, 9], ['cobblestone', 64], ...filler(9)])
    for (const tail of ['only', false]) {
      const p = townDepositPlan(items, { tail, halves: true })
      assert.equal(logsIn(after(items, p)), 16, `${name} tail=${tail}: ${JSON.stringify(p.steps)}`)
    }
  }
  // CONTROL (the live dead end, reproduced): the switch off -> spruce is not wanted, nothing; oak still banks its whole 9
  const spruce = bag([['spruce_log', 64], ['spruce_log', 9], ...filler(10)])
  assert.deepEqual(townDepositPlan(spruce, { tail: false, halves: false }).steps, [], 'spruce, switch off: not_wanted (today\'s rule)')
  const oak = bag([['oak_log', 64], ['oak_log', 9], ...filler(10)])
  assert.deepEqual(townDepositPlan(oak, { tail: false, halves: false }).steps.map(s => s.count), [9], 'positive control: oak was always wanted')
})

test('LOGBANK r3 (Paper r3): in a WELL town (the stock cap binds) spruce banks down to 16 -- bankable, never "wanted" (a want keeps a stack)', async () => {
  const B = await import('../src/bankable.mjs')
  const v = { lb: 0, lbLo: 0, complete: true, unknown: [], reserved: 0, mine: 0, taking: 0, floor: 0, avail: 0, held: 0 }
  B.setStockReaders({ town: () => v, well: () => true })
  try {
    const items = bag([['spruce_log', 64], ['spruce_log', 9], ['torch', 4], ...filler(8)])
    const p = townDepositPlan(items, { tail: 'only' })
    assert.equal(logsIn(after(items, p)), 16, JSON.stringify(p.steps))
    // MUTANT (the r3 bug): logs passed as WANTS -> the wanted keep holds a stack, only the 9 leaves
    const wanted = B.depositPlan(items, null, { wants: ['spruce_log'] }).find(e => e.name === 'spruce_log')?.count
    assert.equal(wanted, 9, 'the mutant shape: a want is kept to 64')
  } finally { B.setStockReaders({}) }
})
