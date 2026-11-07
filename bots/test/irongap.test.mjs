// irongap-01: on an iron task the observation says what the iron pickaxe still needs, before the decision.
// Behaviour over the REAL rungs (SUSTAINING's gather_iron_ore_3 / smelt_iron_ingot_3 / craft_iron_pickaxe_1, and the
// idle-work iron lap's own describe), a fake bag, the switch, and one anchored mutant.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-irongap'
process.env.BOT_NAME = process.env.BOT_NAME || 'IronBot'
process.env.LOG_LEVEL = 'error'
delete process.env.IRONGAP

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const P = await import('../src/prompt.mjs')
const MS = await import('../src/milestones.mjs')
const rung = id => MS.SUSTAINING.find(m => m.id === id)
const bag = c => ({ inventory: { items: () => Object.entries(c).map(([name, count], i) => ({ name, count, slot: 9 + i })) } })
const LAP = { id: 'idle_work#3', wants: null, describe: 'Mine 6 iron ore for tools (raw_iron; an iron pickaxe costs 3, and the fleet wears them out)' }

test('ON AN IRON TASK: the gap and the next step are named, from what the bag holds', () => {
  for (const m of [rung('gather_iron_ore_3'), rung('smelt_iron_ingot_3'), rung('craft_iron_pickaxe_1'), LAP]) {
    assert.ok(m, 'positive control: the rung exists')
    assert.match(P.ironGapLine(bag({}), m), /^IRON PICKAXE NOT YET: .*you have 0 iron_ingot .*get 3 raw_iron \(mine or gather iron ore\), then smelt it$/, m.id)
  }
  assert.match(P.ironGapLine(bag({ iron_ingot: 1, raw_iron: 5 }), LAP), /you have 1 iron_ingot .*smelt 2 raw_iron first \(you carry 5\)/)
  assert.match(P.ironGapLine(bag({ iron_ingot: 1, raw_iron: 5 }), LAP), /smelting needs fuel \(coal, charcoal, logs or planks\) and a furnace/, 'no fuel, no furnace: named')
  assert.doesNotMatch(P.ironGapLine(bag({ iron_ingot: 1, raw_iron: 5, coal: 4, furnace: 1 }), LAP), /smelting needs/, 'fuel and furnace carried: nothing missing')
  assert.match(P.ironGapLine(bag({ raw_iron: 5, coal: 4 }), LAP), /smelting needs a furnace/)
  assert.match(P.ironGapLine(bag({ raw_iron: 1 }), LAP), /smelt your 1 raw_iron and get 2 more/)
})
test('SILENT: with 3 ingots (CAN CRAFT NOW speaks), off an iron task, and with IRONGAP=0', () => {
  assert.equal(P.ironGapLine(bag({ iron_ingot: 3 }), LAP), '')
  assert.equal(P.ironGapLine(bag({}), MS.MILESTONES_BY_ROLE.gatherer[0]), '', 'the dirt rung')
  assert.equal(P.ironGapLine(bag({}), null), '')
  assert.equal(P.ironGapOn({ IRONGAP: '0' }), false); assert.equal(P.ironGapOn({}), true)
  const was = process.env.IRONGAP; process.env.IRONGAP = '0'
  try { assert.equal(P.ironGapLine(bag({}), LAP), '') } finally { if (was == null) delete process.env.IRONGAP; else process.env.IRONGAP = was }
})
test('MUTANT: the ingot test removed -> the SILENT test sees a line with 3 ingots', async () => {
  const url = new URL('../src/prompt.mjs', import.meta.url)
  const src = readFileSync(url, 'utf8'), old = "    if (ingots >= 3) return ''\n"
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-irongap-${process.pid}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, '').replace(/from '\.\//g, "from '../src/"))
  try { const M = await import(out.href); assert.notEqual(M.ironGapLine(bag({ iron_ingot: 3 }), LAP), '', 'the SILENT test kills this mutant') } finally { unlinkSync(out) }
})
