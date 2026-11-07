// sandrung-01: the gatherer chain's sand rung is retired by default (sandrung.mjs; docs/reports/wasted-attempts-2026-11-07.md).
//
// Behaviour only: the switch, the REAL MilestoneController over a fake bag (which rung is current and what the model is
// told), the composed chain (a bot that would have hunted sand is handed the next rung, never nothing), the REAL town
// deposit keep (the 8 held sand follow the switch), and anchored mutants (each anchor present and unique; each mutant
// imported under a unique URL).
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-sandrung'
process.env.BOT_NAME = process.env.BOT_NAME || 'SandBot'
process.env.LOG_LEVEL = 'error'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
delete process.env.SANDRUNG

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const SRC = new URL('../src/', import.meta.url)
const MS = await import('../src/milestones.mjs')
const { MILESTONES_BY_ROLE, MilestoneController, gathererChain } = MS
const { sandRungOn } = await import('../src/sandrung.mjs')
const TD = await import('../src/towndeposit.mjs')

const bot = (bag) => {
  const items = Object.entries(bag).map(([name, count], i) => ({ name, count, slot: 9 + i }))
  return { inventory: { items: () => items }, health: 20, food: 20,
    entity: { position: { x: 400, y: 70, z: 400, distanceTo: () => 400 } } }
}
const withEnv = async (v, fn) => {
  const was = process.env.SANDRUNG
  if (v == null) delete process.env.SANDRUNG; else process.env.SANDRUNG = v
  try { return await fn() } finally { if (was == null) delete process.env.SANDRUNG; else process.env.SANDRUNG = was }
}
const ids = ch => ch.map(r => r.id)
const current = (bag) => { const mc = new MilestoneController(bot(bag), 'gatherer', null, null); mc.refresh(); return mc.status() }
// dirt, wood and cobblestone met, no sand: the bag a sand hunt began from
const MET_BUT_SAND = { dirt: 16, oak_log: 12, cobblestone: 8 }

/** An anchored mutant of one src file: every anchor present exactly once; the copy imports its siblings from src/. */
async function withMutant (file, pairs, fn) {
  let src = readFileSync(new URL(file, SRC), 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 70))}`)
    assert.equal(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-sandrung-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`)) } finally { try { unlinkSync(out) } catch {} }
}

test('SWITCH: retired unless SANDRUNG is exactly 1 (whitespace allowed)', () => {
  assert.equal(sandRungOn({}), false)
  assert.equal(sandRungOn({ SANDRUNG: '0' }), false)
  assert.equal(sandRungOn({ SANDRUNG: 'yes' }), false, 'only 1 turns it back on')
  assert.equal(sandRungOn({ SANDRUNG: '1' }), true)
  assert.equal(sandRungOn({ SANDRUNG: ' 1 ' }), true)
})

test('CHAIN: default dirt -> wood -> cobblestone; SANDRUNG=1 puts the old sand rung back between wood and cobblestone', () => {
  assert.deepEqual(ids(gathererChain({ sand: false })), ['gather_dirt_16', 'gather_oak_log_12', 'gather_cobblestone_8'])
  assert.deepEqual(ids(MILESTONES_BY_ROLE.gatherer), ids(gathererChain({ sand: false })), 'module load = default')
  const on = gathererChain({ sand: true })
  assert.deepEqual(ids(on), ['gather_dirt_16', 'gather_oak_log_12', 'gather_sand_8', 'gather_cobblestone_8'])
  const sand = on[2]
  assert.equal(sand.wants, 'sand'); assert.equal(sand.hint, 'gather with block=sand.')
  assert.equal(sand.describe, 'Collect 8 sand. Found near water.', 'the restored rung is the old rung, word for word')
  assert.equal(sand.done(bot({ sand: 7 })), false); assert.equal(sand.done(bot({ sand: 8 })), true)
})

test('CONTROLLER (the decision path): a bot with dirt, wood and cobble is never asked for sand by default', async () => {
  const s = await withEnv(null, () => current(MET_BUT_SAND))
  assert.notEqual(s.id, 'gather_sand_8')
  assert.ok(!/sand/.test(String(s.hint ?? '')), `the model is not told to gather sand: ${s.hint}`)
  assert.ok(!['gather_dirt_16', 'gather_oak_log_12', 'gather_cobblestone_8'].includes(s.id), `the gatherer chain is passed: ${s.id}`)
  // the control: the same bag with the switch on lands on the sand rung (the one the fleet sat on)
  const on = await withEnv('1', () => current(MET_BUT_SAND))
  assert.equal(on.id, 'gather_sand_8'); assert.equal(on.hint, 'gather with block=sand.')
})

test('COMPOSED: the retired rung hands the bot the NEXT rung (cobblestone), not an empty task', async () => {
  const bag = { dirt: 16, oak_log: 12 }
  const off = await withEnv(null, () => current(bag))
  assert.equal(off.id, 'gather_cobblestone_8')
  assert.equal(off.hint, 'gather with block=cobblestone.')
  const on = await withEnv('1', () => current(bag))
  assert.equal(on.id, 'gather_sand_8', 'switch on: sand comes first, as before')
  // and a bot holding sand from the old rung is not stopped by it either way
  assert.equal((await withEnv(null, () => current({ ...bag, sand: 8 }))).id, 'gather_cobblestone_8')
})

test('HELD: the town deposit keeps 8 sand only while the rung is in the chain', async () => {
  assert.deepEqual({ ...TD.HELD_TARGETS }, { dirt: 16 }, 'default: no sand held for a rung that is not there')
  assert.equal(TD.townKeeps({ sand: 8, dirt: 16 }).keep.sand, undefined, 'default: the deposit does not hold the sand back')
  assert.equal(TD.townKeeps({ sand: 8, dirt: 16 }).keep.dirt, 16, 'the dirt rung still holds its 16 (control)')
  await withEnv('1', async () => {
    const T1 = await import(`../src/towndeposit.mjs?sandrung1_${Date.now()}`)
    assert.deepEqual({ ...T1.HELD_TARGETS }, { dirt: 16, sand: 8 })
    assert.equal(T1.townKeeps({ sand: 8, dirt: 16 }).keep.sand, 8, 'switch on: the 8 sand are kept for the rung, as before')
  })
})

test('MUTANT: the chain hard-codes the sand rung -> the default test sees it', async () => {
  await withMutant('milestones.mjs', [["    ...(sandRungOn() ? [SAND_RUNG()] : []),\n", '    SAND_RUNG(),\n']], async (M) => {
    assert.ok(ids(M.MILESTONES_BY_ROLE.gatherer).includes('gather_sand_8'), 'mutant applied')
    const mc = new M.MilestoneController(bot(MET_BUT_SAND), 'gatherer', null, null)
    mc.refresh()
    // gathererChain filters it back out, so the controller is still right: the module-load list is what is wrong
    assert.notDeepEqual(ids(M.MILESTONES_BY_ROLE.gatherer), ids(M.gathererChain({ sand: false })), 'the CHAIN test kills this mutant')
  })
})

test('MUTANT: gathererChain ignores the switch -> the controller asks for sand again', async () => {
  await withMutant('milestones.mjs', [['  if (!sand) return base\n', '']], async (M) => {
    const mc = new M.MilestoneController(bot(MET_BUT_SAND), 'gatherer', null, null)
    mc.refresh()
    assert.equal(mc.status().id, 'gather_sand_8', 'the CONTROLLER test kills this mutant')
  })
})

test('MUTANT: the controller builds from the static list -> SANDRUNG=1 no longer restores the rung', async () => {
  await withMutant('milestones.mjs', [["(role === 'gatherer' ? gathererChain() : (MILESTONES_BY_ROLE[role] ?? MILESTONES_BY_ROLE.scout))",
                                       '(MILESTONES_BY_ROLE[role] ?? MILESTONES_BY_ROLE.scout)']], async (M) => {
    const s = await withEnv('1', () => { const mc = new M.MilestoneController(bot(MET_BUT_SAND), 'gatherer', null, null); mc.refresh(); return mc.status() })
    assert.notEqual(s.id, 'gather_sand_8', 'the CONTROLLER control (switch on) kills this mutant')
  })
})

test('MUTANT: the deposit holds sand regardless -> the HELD test sees it', async () => {
  await withMutant('towndeposit.mjs', [["...(sandRungOn() ? { sand: 8 } : {})", 'sand: 8']], async (T) => {
    assert.equal(T.townKeeps({ sand: 8, dirt: 16 }).keep.sand, 8, 'the HELD default test kills this mutant')
  })
})

test('MUTANT: the switch defaults on -> the SWITCH test sees it', async () => {
  await withMutant('sandrung.mjs', [["env?.SANDRUNG ?? '0'", "env?.SANDRUNG ?? '1'"]], async (S) => {
    assert.equal(S.sandRungOn({}), true, 'the SWITCH test kills this mutant')
  })
})
