// dirtrung-01: the gatherer chain's dirt rung is met by building material, not by the name `dirt`.
//
// Behaviour only: the pure verdict (dirtRungVerdict), the REAL rung object from MILESTONES_BY_ROLE, the REAL
// MilestoneController over a fake bag (which rung is current, what the model is told, the own-line telemetry), the REAL
// town deposit plan (a deposit never re-opens the rung), and anchored mutants of milestones.mjs (each anchor present and
// unique; each mutant imported under a unique URL).
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-dirtrung'
process.env.BOT_NAME = process.env.BOT_NAME || 'DirtBot'
process.env.LOG_LEVEL = 'error'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
delete process.env.DIRTRUNG_EARTH

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const MS_PATH = new URL('../src/milestones.mjs', import.meta.url)
const MS = await import('../src/milestones.mjs')
const { dirtRungVerdict, dirtRungEarthOn, DIRT_RUNG_EARTH, DIRT_RUNG_N, MILESTONES_BY_ROLE, MilestoneController, servesRung,
        COBBLE, STOCKPILE_MAX } = MS
const { tapRecords } = await import('../src/logger.mjs')

const bot = (bag) => {
  const items = Object.entries(bag).map(([name, count], i) => ({ name, count, slot: 9 + i }))
  return { inventory: { items: () => items }, health: 20, food: 20,
    entity: { position: { x: 400, y: 70, z: 400, distanceTo: () => 400 } } }
}
const withEnv = async (v, fn) => {
  const was = process.env.DIRTRUNG_EARTH
  if (v == null) delete process.env.DIRTRUNG_EARTH; else process.env.DIRTRUNG_EARTH = v
  try { return await fn() } finally { if (was == null) delete process.env.DIRTRUNG_EARTH; else process.env.DIRTRUNG_EARTH = was }
}
const events = async (fn) => {
  const rows = []
  const untap = tapRecords(r => { if (/^_dirtrung_/.test(r?.skill?.name ?? '')) rows.push(r.skill) })
  try { await fn() } finally { untap() }
  return rows
}

/** An anchored mutant: the anchor must be present exactly once; the copy is imported under a unique URL. */
async function withMutant (pairs, fn) {
  let src = readFileSync(MS_PATH, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 70))}`)
    assert.equal(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-dirtrung-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`)) } finally { try { unlinkSync(out) } catch {} }
}

test('VERDICT: 16 dirt meets it by dirt; otherwise a STACK (64) of dirt + the stone family meets it by earth', () => {
  assert.equal(DIRT_RUNG_N, 16); assert.equal(DIRT_RUNG_EARTH, 64)
  assert.deepEqual(dirtRungVerdict({ dirt: 16 }), { met: true, by: 'dirt', dirt: 16, stone: 0 })
  assert.equal(dirtRungVerdict({ dirt: 15 }).met, false)
  assert.deepEqual(dirtRungVerdict({ cobblestone: 357 }), { met: true, by: 'earth', dirt: 0, stone: 357 })
  assert.equal(dirtRungVerdict({ cobblestone: 64 }).met, true, 'one stack')
  assert.equal(dirtRungVerdict({ cobblestone: 63 }).met, false, 'one short of a stack')
  assert.equal(dirtRungVerdict({ dirt: 4, cobblestone: 60 }).by, 'earth', '4 dirt + 60 stone')
  assert.equal(dirtRungVerdict({ dirt: 4, cobblestone: 59 }).met, false)
  assert.equal(dirtRungVerdict({ cobbled_deepslate: 30, andesite: 20, tuff: 14 }).met, true, 'the family counts across names')
})

test('VERDICT: falling blocks, wood, earth the deposit does not keep, and junk never count', () => {
  for (const n of ['sand', 'red_sand', 'gravel', 'oak_log', 'oak_planks', 'stone_bricks', 'smooth_stone', 'coarse_dirt', 'netherrack', 'iron_pickaxe'])
    assert.equal(dirtRungVerdict({ [n]: 500 }).met, false, n)
  for (const n of COBBLE) assert.equal(dirtRungVerdict({ [n]: 64 }).met, true, n)
  assert.equal(dirtRungVerdict({ dirt: NaN, cobblestone: -40 }).met, false)
  assert.equal(dirtRungVerdict(undefined).met, false)
  assert.equal(dirtRungVerdict({ cobblestone: '200' }).met, true, 'a numeric string is a count')
})

test('KILL SWITCH: DIRTRUNG_EARTH=0 is the dirt-only rule; anything else (or unset) is on', async () => {
  assert.equal(dirtRungEarthOn({}), true); assert.equal(dirtRungEarthOn({ DIRTRUNG_EARTH: '1' }), true)
  assert.equal(dirtRungEarthOn({ DIRTRUNG_EARTH: ' 0 ' }), false)
  assert.equal(dirtRungVerdict({ cobblestone: 500 }, { earth: false }).met, false)
  assert.equal(dirtRungVerdict({ dirt: 16 }, { earth: false }).by, 'dirt', 'off still meets by dirt')
  const rung = MILESTONES_BY_ROLE.gatherer[0]
  await withEnv('0', () => assert.equal(rung.done(bot({ cobblestone: 500 })), false, 'switch off: cobble does not meet it'))
  await withEnv(null, () => assert.equal(rung.done(bot({ cobblestone: 500 })), true, 'switch on: it does'))
})

test('THE REAL RUNG: same id (a persistence key), wants, describe, progress and hint; done by earth', () => {
  const rung = MILESTONES_BY_ROLE.gatherer[0]
  assert.equal(rung.id, 'gather_dirt_16'); assert.equal(rung.wants, 'dirt')
  assert.equal(rung.describe, 'Collect 16 dirt. Hand-mineable building material.')
  assert.equal(rung.hint, 'gather with block=dirt.')
  assert.equal(rung.done(bot({ cobblestone: 236, cobbled_deepslate: 64, dirt: 1 })), true, 'hive-a-Alpha 11-04 00:00Z bag')
  assert.equal(rung.done(bot({ cobblestone: 20 })), false)
  assert.equal(rung.done(bot({ dirt: 16 })), true)
  assert.equal(rung.progress(bot({ dirt: 3, cobblestone: 20 })), '3/16 dirt')
})

test('CONTROLLER: a stack of stone steps over the rung (pass, open=0, by earth); the lap goes on to wood', async () => {
  const rows = await events(() => {
    const mc = new MilestoneController(bot({ cobblestone: 300 }), 'gatherer', null, null)
    mc.refresh()
    assert.equal(mc.status().id, 'gather_oak_log_12', 'the next rung is current, not dirt')
  })
  const pass = rows.filter(r => r.name === '_dirtrung_pass')
  assert.equal(pass.length, 1, JSON.stringify(rows))
  assert.equal(pass[0].args.by, 'earth'); assert.equal(pass[0].args.open, 0); assert.equal(pass[0].args.stone, 300)
  assert.equal(rows.filter(r => r.name === '_dirtrung_open').length, 0)
})

test('CONTROLLER (positive control): a bot short of a stack is still asked for dirt -- the remedy it can do by hand', async () => {
  let mc
  const rows = await events(() => {
    mc = new MilestoneController(bot({ cobblestone: 50, dirt: 2 }), 'gatherer', null, null)
    mc.refresh()
  })
  const s = mc.status()
  assert.equal(s.id, 'gather_dirt_16'); assert.equal(s.hint, 'gather with block=dirt.')
  assert.ok(servesRung('gather', { block: 'dirt' }, { id: s.id, wants: s.wants }, new Set(['dirt'])), 'gathering dirt serves it')
  const open = rows.filter(r => r.name === '_dirtrung_open')
  assert.equal(open.length, 1); assert.equal(open[0].args.dirt, 2); assert.equal(open[0].args.stone, 50)
})

test('CONTROLLER TELEMETRY: open -> decisions by class -> pass with held_ms; refresh while current does not re-open', async () => {
  const b = bot({ cobblestone: 20 })
  const rows = await events(() => {
    const mc = new MilestoneController(b, 'gatherer', null, null)
    mc.refresh(); mc.refresh()
    mc.noteAttempt({ failed: true, executed: true, serving: true, taskId: 'gather_dirt_16' })
    mc.noteAttempt({ failed: true, executed: true, serving: false, taskId: 'gather_dirt_16' })
    mc.noteAttempt({ failed: false, executed: true, serving: true, taskId: 'gather_dirt_16' })
    mc.noteAttempt({ failed: true, executed: false, serving: false, taskId: 'gather_dirt_16' })
    b.inventory.items().push({ name: 'dirt', count: 16, slot: 30 })
    mc.refresh()
    assert.equal(mc.status().id, 'gather_oak_log_12')
  })
  assert.deepEqual(rows.map(r => r.name), ['_dirtrung_open', '_dirtrung_pass'])
  const p = rows[1].args
  assert.equal(p.by, 'dirt'); assert.equal(p.open, 1); assert.ok(p.held_ms >= 0)
  assert.deepEqual([p.n_ok, p.n_failed, p.n_unserved, p.n_not_run], [1, 1, 1, 1])
})

test('CONTROLLER TELEMETRY: a give-up logs a skip with its reason and the counts', async () => {
  const rows = await events(() => {
    const mc = new MilestoneController(bot({}), 'gatherer', null, null)
    mc.refresh()
    for (let i = 0; i < 25; i++) mc.noteAttempt({ failed: true, executed: true, serving: true, taskId: 'gather_dirt_16' })
  })
  const skip = rows.find(r => r.name === '_dirtrung_skip')
  assert.ok(skip, JSON.stringify(rows.map(r => r.name)))
  assert.equal(skip.args.reason, 'attempts'); assert.equal(skip.args.n_failed, 25); assert.equal(skip.status, 'failed')
})

test('COMPOSITION: the stack is what the town deposit keeps of the same family, so a real deposit cannot re-open the rung', async () => {
  const TD = await import('../src/towndeposit.mjs')
  assert.equal(DIRT_RUNG_EARTH, TD.STOCKPILE_KEEP); assert.equal(DIRT_RUNG_EARTH, STOCKPILE_MAX)
  assert.deepEqual([...TD.COBBLE], COBBLE)
  const rung = MILESTONES_BY_ROLE.gatherer[0]
  let banked = 0
  for (const [stone, dirt] of [[300, 3], [130, 0], [64, 0], [70, 15]]) {
    const items = []
    let left = stone, slot = 9
    while (left > 0) { const k = Math.min(64, left); items.push({ name: 'cobblestone', count: k, slot: slot++ }); left -= k }
    if (dirt) items.push({ name: 'dirt', count: dirt, slot: slot++ })
    for (let i = 0; i < 26; i++) items.push({ name: 'andesite', count: 64, slot: slot++ })   // a full bag, so the plan banks
    const plan = TD.townDepositPlan(items, {})
    const moved = {}; for (const st of plan.steps) moved[st.slot] = (moved[st.slot] ?? 0) + st.count
    banked += plan.steps.length
    const bag = { inventory: { items: () => items.map(i => ({ ...i, count: i.count - (moved[i.slot] ?? 0) })).filter(i => i.count > 0) } }
    assert.equal(rung.done({ inventory: { items: () => items } }), true, `before: ${stone} stone`)
    assert.equal(rung.done(bag), true, `after the deposit of ${stone} stone + ${dirt} dirt`)
  }
  assert.ok(banked > 0, 'positive control: the plans banked something')
})

test('MUTANT KILLED: without the earth branch the 300-cobble bag is sent for dirt again', async () => {
  await withMutant([['  if (earth && dirt + stone >= stack) return', '  if (false && dirt + stone >= stack) return']], M => {
    assert.equal(M.MILESTONES_BY_ROLE.gatherer[0].done(bot({ cobblestone: 300 })), false)
  })
})

test('MUTANT KILLED: a threshold of 16 instead of a stack lets a 20-cobble bag skip the rung', async () => {
  await withMutant([['  if (earth && dirt + stone >= stack) return', '  if (earth && dirt + stone >= n) return']], M => {
    assert.equal(M.MILESTONES_BY_ROLE.gatherer[0].done(bot({ cobblestone: 20 })), true)
  })
})

test('MUTANT KILLED: the rung not wired to the verdict is the old dirt-only rung', async () => {
  await withMutant([['      done: b => dirtRungVerdict(bagCounts(b), { earth: dirtRungEarthOn() }).met,\n', '']], M => {
    assert.equal(M.MILESTONES_BY_ROLE.gatherer[0].done(bot({ cobblestone: 300 })), false)
  })
})

test('MUTANT KILLED: a kill switch that does not read the env cannot turn the rule off', async () => {
  await withMutant([[".trim() !== '0'", ".trim() !== 'never'"]], async M => {
    await withEnv('0', () => assert.equal(M.MILESTONES_BY_ROLE.gatherer[0].done(bot({ cobblestone: 300 })), true))
  })
})

test('MUTANT KILLED: with the open hook unwired no _dirtrung_open is written', async () => {
  await withMutant([['{ this.#trackBegin(m); break }', '{ break }']], async M => {
    const rows = await events(() => { new M.MilestoneController(bot({ cobblestone: 20 }), 'gatherer', null, null).refresh() })
    assert.equal(rows.filter(r => r.name === '_dirtrung_open').length, 0)
  })
})
