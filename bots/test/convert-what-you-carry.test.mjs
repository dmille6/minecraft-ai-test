// THE LADDER JUDGED A RUNG ONCE AND NEVER LOOKED BACK.
//
// rungOf marks a rung done when the bot lacks the means AT THAT INSTANT, and
// MilestoneController.refresh only scans forward from its index. A bot that
// crafted a stone pickaxe with two cobblestone left advanced past `furnace`,
// then gathered 61 cobblestone, and no furnace order ever fired. Measured
// 2026-09-11, 3 h, full walk: 18 bots held >= 8 cobblestone and no furnace and
// chose gather 43%, goto 17%, explore 11%, craft furnace 9.8%; work orders
// fired 77 times fleet-wide and were followed 87% of the time. The channel
// works. It was only ever asked about the active rung.
//
// Two independent analyses (Claude, Codex) of "collecting but not crafting"
// converged on this look-back and on iron_pickaxe before bucket (both cost
// three ingots; 29 bucket crafts, 1 success, 6 of 80 bots on iron).
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { TECH_LADDER, conversionAvailable, conversionsAvailable } = await import('../src/milestones.mjs')
const { carryGate, carrySuppressed, carryOrderFor, CARRY_LIMIT, CARRY_COOL_MS } = await import('../src/workorder.mjs')

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const COG = strip(fs.readFileSync(path.join(SRC, 'cognitive.mjs'), 'utf8'))

// A bot is an inventory here: countItem/countAny read bot.inventory.items().
const botWith = inv => ({
  inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) },
})

test('the first rung the bot has the means for and has not met is offered, however far back it is', () => {
  // isolated-b-Comet's shape: stone pickaxe done, 61 cobblestone, no furnace.
  const r = conversionAvailable(botWith({ crafting_table: 1, stone_pickaxe: 1, cobblestone: 61, birch_log: 192 }))
  assert.equal(r?.wants, 'furnace')
  assert.equal(r.id, 'craft_furnace_1')
  assert.equal(r.carry, true)
})

test('nothing is offered when every rung with means is already met', () => {
  assert.equal(conversionAvailable(botWith({ crafting_table: 1, stone_pickaxe: 1, furnace: 1, cobblestone: 61 })), null)
  assert.equal(conversionAvailable(botWith({})), null, 'no means, no order')
})

test('a rung the bot has the means for but already satisfied by a better tool is skipped', () => {
  // wooden_pickaxe is satisfied by a stone pickaxe (equivalentTools); with logs
  // and a table the means are there, and it must NOT be ordered.
  const r = conversionAvailable(botWith({ crafting_table: 1, stone_pickaxe: 1, oak_log: 10, cobblestone: 2 }))
  assert.notEqual(r?.wants, 'wooden_pickaxe')
})

test('three ingots go to an iron pickaxe before a bucket', () => {
  const ids = TECH_LADDER.map(r => r.id)
  assert.ok(ids.indexOf('craft_iron_pickaxe_1') < ids.indexOf('craft_bucket_1'), ids.join(' '))
  const r = conversionAvailable(botWith({ crafting_table: 1, stone_pickaxe: 1, furnace: 1, iron_ingot: 3, stick: 2 }))
  assert.equal(r?.wants, 'iron_pickaxe')
})

test('every ladder rung exposes base and hasMeans, or the look-back cannot see it', () => {
  for (const r of TECH_LADDER) {
    assert.equal(typeof r.base?.done, 'function', r.id)
    assert.equal(typeof r.hasMeans, 'function', r.id)
  }
})

test('carryGate allows two consecutive orders for one item, then suppresses it for 30 minutes', () => {
  let st = null; const t0 = 1_000_000
  for (let i = 0; i < CARRY_LIMIT; i++) {
    const g = carryGate(st, 'bucket', t0 + i * 30_000); st = g.state
    assert.equal(g.allow, true, `order ${i + 1} allowed`); assert.equal(g.tripped, false)
  }
  const next = carryGate(st, 'bucket', t0 + 2 * 30_000); st = next.state
  assert.equal(next.allow, false); assert.equal(next.tripped, true, 'the trip is reported once')
  assert.equal(carrySuppressed(st, 'bucket', t0 + 3 * 30_000), true)
  const again = carryGate(st, 'bucket', t0 + 3 * 30_000); st = again.state
  assert.equal(again.allow, false); assert.equal(again.tripped, false, 'and only once')
  assert.equal(carrySuppressed(st, 'bucket', t0 + 3 * 30_000 + CARRY_COOL_MS), false)
  const later = carryGate(st, 'bucket', t0 + 3 * 30_000 + CARRY_COOL_MS)
  assert.equal(later.allow, true, 'after the cooldown the item may be ordered again')
})

test('the gate is per item: suppressing the furnace leaves the pickaxe alone, and alternation does not launder a loop', () => {
  let st = null
  st = carryGate(st, 'furnace', 1).state; st = carryGate(st, 'iron_pickaxe', 2).state
  st = carryGate(st, 'furnace', 3).state
  const f = carryGate(st, 'furnace', 4); st = f.state
  assert.equal(f.tripped, true, 'two furnace orders with a pickaxe between them still count as two')
  assert.equal(carrySuppressed(st, 'iron_pickaxe', 5), false)
  assert.equal(carryGate(st, 'iron_pickaxe', 6).allow, true)
})

test('every candidate is returned in ladder order, and only conversions', () => {
  // A bot with two logs, a table, 61 cobblestone and NO pickaxe: wooden_pickaxe
  // has means (2 logs) but its recipe wants planks and sticks; the furnace
  // behind it must still be offered so a refused first candidate cannot
  // shadow it.
  const list = conversionsAvailable(botWith({ crafting_table: 1, oak_log: 2, cobblestone: 61 }))
  const wants = list.map(r => r.wants)
  assert.ok(wants.includes('wooden_pickaxe') && wants.includes('furnace'), wants.join(','))
  assert.ok(wants.indexOf('wooden_pickaxe') < wants.indexOf('furnace'))
  assert.ok(!list.some(r => /^gather_/.test(r.id)), 'gather_iron_ore is on the ladder and no order can perform it')
})

test('a placed station is not a missing one', () => {
  // craft put the carried table down and never picked it up: inventory says 0.
  const bot = botWith({ oak_log: 8, cobblestone: 61 })
  assert.equal(conversionAvailable(bot)?.wants, 'crafting_table', 'with no station near, a table is the first rung')
  const near = (b, name) => name === 'crafting_table'
  assert.notEqual(conversionAvailable(bot, { stationNear: near })?.wants, 'crafting_table',
    'a table standing in reach satisfies the rung; ordering another is the 4-logs-per-lap cycle')
  const throwing = () => { throw new Error('unreadable world') }
  assert.equal(conversionAvailable(bot, { stationNear: throwing })?.wants, 'crafting_table', 'an unreadable world is not a placed station')
})

test('carryOrderFor keeps the skill predicates and marks the order', () => {
  // readyFor needs a registry + recipesFor; give it a bot that says yes.
  const bot = {
    ...botWith({ crafting_table: 1, cobblestone: 8 }),
    registry: { itemsByName: { furnace: { id: 1 } } },
    recipesFor: () => [{}],
    findBlock: () => null,
    entity: { position: { distanceTo: () => 99 } },
  }
  const o = carryOrderFor(bot, { id: 'craft_furnace_1', wants: 'furnace' })
  assert.equal(o?.skill, 'craft'); assert.equal(o.args.item, 'furnace')
  assert.equal(o.carry, true); assert.match(o.why, /^convert what you carry: /)
  bot.recipesFor = () => []
  assert.equal(carryOrderFor(bot, { id: 'craft_furnace_1', wants: 'furnace' }), null, 'no recipe, no order')
})

// ---------------------------------------------------------------- wiring ---

const WIRING = [
  /if \(!order\) \{[\s\S]{0,120}conversionsAvailable\(this\.bot, \{ stationNear: stationInReach \}\)/,
  /if \(carrySuppressed\(this\.carry, rung\.wants, now\)\) continue/,
  /const o = carryOrderFor\(this\.bot, rung\)[\s\S]{0,80}if \(!o\) continue[\s\S]{0,120}carryGate\(this\.carry, rung\.wants, now\)/,
  /kind: 'work_order_loop'/,
]
const wiringRegion = code => {
  const at = code.indexOf('let order = orderFor(readyFor(this.bot, milestone))')
  assert.ok(at > 0, 'the work-order line moved')
  return code.slice(at, at + 1600)
}

test('cognitive tries every candidate in order, skips a suppressed or unorderable one, and gates only issued orders', () => {
  const region = wiringRegion(COG)
  for (const re of WIRING) assert.match(region, re)
  const gateAt = region.search(/carryGate\(this\.carry, rung\.wants, now\)/)
  const orderAt = region.indexOf('const o = carryOrderFor(this.bot, rung)')
  assert.ok(orderAt > 0 && gateAt > orderAt, 'the gate must run AFTER readyFor said yes, or it counts orders never issued')
})

test('a carry order is judged as the rung it serves, and never charges the active rung', () => {
  assert.match(COG, /const judged = carryRung \?\? milestone[\s\S]{0,200}this\.#wantedItems\(judged\)/)
  assert.match(COG, /if \(!carryRung && this\.milestones\.noteAttempt\(outcome\.status !== 'success'\)\)/)
  assert.match(COG, /classifyOutcome\([\s\S]{0,120}this\.#wantedItems\(carryRung \?\? milestone\)\)/)
})

test('MUTANT: each wiring regex fails against the mutant that removes its line', () => {
  const raw = fs.readFileSync(path.join(SRC, 'cognitive.mjs'), 'utf8')
  const cuts = [
    ['conversionsAvailable(this.bot, { stationNear: stationInReach })', '[]'],
    ['if (carrySuppressed(this.carry, rung.wants, now)) continue', ''],
    ["if (!carryRung && this.milestones.noteAttempt(outcome.status !== 'success'))", "if (this.milestones.noteAttempt(outcome.status !== 'success'))"],
  ]
  for (const [anchor, repl] of cuts) {
    assert.equal(raw.split(anchor).length - 1, 1, `ANCHOR MISSING or not unique: ${anchor}`)
    const m = strip(raw.replace(anchor, repl))
    const survived = WIRING.every(re => re.test(wiringRegion(m))) &&
      /if \(!carryRung && this\.milestones\.noteAttempt/.test(m)
    assert.equal(survived, false, `the mutant '${anchor.slice(0, 40)}' was not detected`)
  }
})
