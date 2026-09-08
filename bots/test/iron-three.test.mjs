// THE LADDER TERMINATED TWO INGOTS SHORT OF ITS OWN TOP RUNG.
//
// gather asked for 1 raw_iron, smelt asked for 1 iron_ingot, and the
// iron_pickaxe rung above them requires THREE -- so its means were false, that
// rung was skipped, and nothing on the ladder ever asked for the other two.
// This is the same defect as the rung below it, one tier further up.
//
// Measured over 12h on 80 bots: 30 hold iron_ingot and 27 of them hold EXACTLY
// ONE. Only three bots have ever held three at once, and two of those are the
// fleet's only two iron pickaxes. 70 of 80 bots are at the furnace tier or
// above -- the fleet was not short of capability, it was short of an
// instruction.
import assert from 'node:assert'
import test from 'node:test'
import { SUSTAINING } from '../src/milestones.mjs'

const bot = ({ inv = {}, ore = false, role = 'gatherer' } = {}) => ({
  role,
  registry: { blocksByName: { iron_ore: { id: 1 }, deepslate_iron_ore: { id: 2 } } },
  findBlock: () => (ore ? { position: { x: 0, y: 0, z: 0 } } : null),
  inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) },
})
const rung = id => SUSTAINING.find(m => m.id === id)
const EQUIPPED = { stone_pickaxe: 1, furnace: 1, crafting_table: 1, cobblestone: 20,
                   oak_log: 8, stick: 6, coal: 8 }

test('POSITIVE CONTROL: both iron rungs exist and are found by id', () => {
  assert.ok(rung('gather_iron_ore_3'), 'ids: ' + SUSTAINING.map(m => m.id).join(','))
  assert.ok(rung('smelt_iron_ingot_3'), 'the smelt rung must ask for three')
})

test('ONE raw iron no longer completes the gather rung', () => {
  const r = rung('gather_iron_ore_3')
  assert.equal(r.done(bot({ inv: { ...EQUIPPED, raw_iron: 1 }, ore: true })), false)
})

test('THE 27-BOT CASE: one ingot does not complete it either', () => {
  const r = rung('gather_iron_ore_3')
  assert.equal(r.done(bot({ inv: { ...EQUIPPED, iron_ingot: 1 }, ore: true })), false,
    'this is exactly where 27 of 30 ingot-holders sit')
})

test('raw and smelted COUNT TOGETHER, so smelting cannot un-complete the rung', () => {
  const r = rung('gather_iron_ore_3')
  const b = bot({ inv: { ...EQUIPPED, raw_iron: 2, iron_ingot: 1 }, ore: true })
  assert.equal(r.done(b), true, '3 iron total is 3 iron, whatever state it is in')
  // and the same bot after smelting the rest
  assert.equal(r.done(bot({ inv: { ...EQUIPPED, iron_ingot: 3 }, ore: true })), true)
})

test('three of anything less is not enough', () => {
  const r = rung('gather_iron_ore_3')
  assert.equal(r.done(bot({ inv: { ...EQUIPPED, raw_iron: 2 }, ore: true })), false)
  assert.equal(r.done(bot({ inv: { ...EQUIPPED, raw_iron: 1, iron_ingot: 1 }, ore: true })), false)
})

test('the smelt rung now wants three ingots', () => {
  // It needs raw_iron in hand, or rungOf reads the rung as done for lack of
  // means -- which is the ladder's rule, not an accident.
  const r = rung('smelt_iron_ingot_3')
  assert.equal(r.done(bot({ inv: { ...EQUIPPED, iron_ingot: 1, raw_iron: 2 } })), false)
  assert.equal(r.done(bot({ inv: { ...EQUIPPED, iron_ingot: 3, raw_iron: 1 } })), true)
})

test('THE LOOP CLOSES: two ingots and no raw iron is not a dead end', () => {
  // smelt has no means, so it reads as done; the pickaxe rung needs 3 and is
  // skipped; the gather rung is unsatisfied at 2/3 and takes over. The bot goes
  // back for ore instead of parking, which is the whole point.
  const b = bot({ inv: { ...EQUIPPED, iron_ingot: 2 }, ore: true })
  assert.equal(rung('smelt_iron_ingot_3').done(b), true, 'no raw iron: no means, reads done')
  assert.equal(rung('gather_iron_ore_3').done(b), false, 'so THIS is the live rung')
})

test('its progress line names both halves, so the model can see the gap', () => {
  const r = rung('gather_iron_ore_3')
  const p = r.progress(bot({ inv: { ...EQUIPPED, raw_iron: 1, iron_ingot: 1 }, ore: true }))
  assert.match(p, /2\/3/, p)
  assert.match(p, /raw/, p)
  assert.match(p, /smelted/, p)
})

test('NO ORE IN REACH: the rung still costs nothing, which is the ladder rule', () => {
  // rungOf treats a rung whose means are absent as already done, so a bot that
  // cannot see iron is never handed an errand it would fail every lap.
  const r = rung('gather_iron_ore_3')
  assert.equal(r.done(bot({ inv: EQUIPPED, ore: false })), true,
    'no ore in reach must read as done, not as work')
})
