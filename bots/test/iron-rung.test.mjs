// THE LADDER TOLD BOTS TO SMELT IRON THEY HAD NO WAY OF GETTING.
//
// The iron_ingot rung requires `raw_iron >= 1`, and nothing on the ladder ever
// told a bot to go and mine some. So both iron rungs were permanently
// unsatisfiable and the ladder fell through to gather_dirt and gather_oak_log.
//
// Measured 2026-09-08: 49 of 80 bots parked at furnace; iron_ore requested in
// 25 of 3,588 gathers (0.7%) while visible in 11,574 perception scans; 17.5%
// have ever held raw iron; one bot has an iron pickaxe; and none of those
// numbers moved in a day.
//
// The original note's objection stands and this rung obeys it: an unconditional
// `gather iron_ore` would fail 25 times a lap for a bot with no ore, every lap,
// taxing the endpoint. So the rung does not EXIST unless ore is in reach --
// rungOf treats a rung whose means are absent as already done.
import assert from 'node:assert'
import test from 'node:test'
import { SUSTAINING } from '../src/milestones.mjs'

const bot = ({ inv = {}, ore = false, role = 'gatherer' } = {}) => ({
  role,
  registry: { blocksByName: { iron_ore: { id: 1 }, deepslate_iron_ore: { id: 2 } } },
  findBlock: () => (ore ? { position: { x: 0, y: 0, z: 0 } } : null),
  inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) },
})
const ids = () => SUSTAINING.map(m => m.id)
const ironRung = () => SUSTAINING.find(m => m.id === 'gather_iron_ore_3')

const EQUIPPED = { stone_pickaxe: 1, furnace: 1, crafting_table: 1, cobblestone: 20, oak_log: 8 }

test('POSITIVE CONTROL: the ladder produces milestones at all', () => {
  const l = ids()
  assert.ok(l.length > 0, 'no milestones at all means every assertion below is vacuous')
})

test('with ore in reach and a pickaxe, the iron rung is OFFERED and not done', () => {
  const b = bot({ inv: EQUIPPED, ore: true })
  const r = ironRung()
  assert.ok(r, 'the rung must exist: ' + ids().join(','))
  assert.equal(r.done(b), false, 'it must be actionable, not vacuously satisfied')
  assert.equal(r.wants, 'iron_ore')
  assert.match(r.hint, /block=iron_ore/)
})

test('with NO ore in reach it is treated as done — this is the original objection', () => {
  // A bot with no ore must never be asked, or it fails 25 times a lap forever.
  const b = bot({ inv: EQUIPPED, ore: false })
  const r = ironRung()
  if (r) assert.equal(r.done(b), true, 'no ore in reach means the rung cannot cost an attempt')
})

test('without a pickaxe it is treated as done — iron needs stone tier', () => {
  const b = bot({ inv: { ...EQUIPPED, stone_pickaxe: 0 }, ore: true })
  const r = ironRung()
  if (r) assert.equal(r.done(b), true)
})

test('it completes on raw_iron, NOT on iron_ore', () => {
  // Mining the ore drops raw_iron. A rung waiting for `iron_ore` in the
  // inventory would never complete -- the recorded trap that produced
  // "0 iron in 23 days" while 33 bots were holding raw_iron.
  // Five ore is more than the rung's three and still must not count; three raw
  // is the drop and must. (The rung asks for THREE now -- an iron_pickaxe costs
  // three ingots, and asking for one is what left 27 bots holding exactly one.)
  const withOre = bot({ inv: { ...EQUIPPED, iron_ore: 5 }, ore: true })
  const withRaw = bot({ inv: { ...EQUIPPED, raw_iron: 3 }, ore: true })
  const r1 = ironRung(), r2 = ironRung()
  assert.ok(r1 && r2)
  assert.equal(r1.done(withOre), false, 'holding the BLOCK is not progress')
  assert.equal(r2.done(withRaw), true, 'holding the DROP is')
})

test('progress reports raw_iron so the model can see it move', () => {
  const b = bot({ inv: EQUIPPED, ore: true })
  assert.match(ironRung().progress(b), /0\/3 iron/)
})

test('it sits BELOW the smelt rung, so the chain is walkable in order', () => {
  const l = ids()
  const g = l.indexOf('gather_iron_ore_3')
  const smelt = l.findIndex(x => /iron_ingot/.test(x))
  if (g >= 0 && smelt >= 0) {
    assert.ok(g < smelt, `gather must precede smelt, got ${l.join(',')}`)
  }
})

test('deepslate iron counts — below y=0 it is the only kind', () => {
  const b = {
    ...bot({ inv: EQUIPPED }),
    registry: { blocksByName: { deepslate_iron_ore: { id: 2 } } },
    findBlock: ({ matching }) => (matching === 2 ? { position: {} } : null),
  }
  const r = ironRung()
  assert.ok(r && r.done(b) === false, 'deepslate iron must open the rung too')
})

test('a bot that cannot look does not get the rung — fails CLOSED', () => {
  const blind = { ...bot({ inv: EQUIPPED }), findBlock: undefined, registry: undefined }
  const r = ironRung()
  if (r) assert.equal(r.done(blind), true, 'no world means no rung, never an unguarded ask')
})
