// A FLOOD GUARD THAT FIRES WHEN THE BOT IS ALREADY FLOODED.
//
// `overheadBreakRisk` refuses to break a ceiling with liquid above or beside it,
// because pillaring into water puts the head under -- the state the air reflex
// exists to end. That is right for a bot whose head is in air.
//
// For a bot ALREADY fully submerged it forbids the only way out, to prevent a
// transition into the state it is already in. Measured 2026-09-07: 23.8% of
// every A* failure on the fleet is a bot in liquid with ZERO legal moves --
// pathfinder refuses all four vertical moves from a liquid node, and
// `canDig = false` makes safeToBreak refuse the horizontals. It gets no path,
// this refusal from the climb, and `surface_swim` from a lattice branch that
// assumes it is floating. Three correct components, no legal move.
//
// The exemption is deliberately the narrowest possible: nothing changes for a
// dry bot, a wading bot, or any bot whose head is in air. The two disasters on
// file -- the kelp widening (7x drownings) and the global reflex demotion
// (7.5x) -- both made bots more willing to BE near water. This does not.
import assert from 'node:assert'
import test from 'node:test'
import { overheadBreakRisk } from '../src/scaffold.mjs'

const LIQUID = new Set(['water', 'lava', 'flowing_water', 'flowing_lava'])
const isLiquid = b => !!b && LIQUID.has(b.name)
const b = (name, boundingBox = 'block') => ({ name, boundingBox })
const water = b('water', 'empty')
const lava = b('lava', 'empty')
const stone = b('stone')
const air = b('air', 'empty')
const DRY = [stone, stone, stone, stone]

test('a DRY bot is refused exactly as before — this is the unchanged case', () => {
  assert.match(overheadBreakRisk({ head: water, sides: DRY, isLiquid }), /liquid overhead/)
  assert.match(overheadBreakRisk({ head: stone, sides: [water, stone, stone, stone], isLiquid }),
    /liquid beside/)
  assert.equal(overheadBreakRisk({ head: stone, sides: DRY, isLiquid }), null)
  assert.equal(overheadBreakRisk({ head: air, sides: [water, stone, stone, stone], isLiquid }), null,
    'nothing will be broken, so nothing can flood')
})

test('a SUBMERGED bot may break upward through water', () => {
  assert.equal(overheadBreakRisk({ head: water, sides: DRY, isLiquid, submerged: true }), null)
  assert.equal(overheadBreakRisk({ head: stone, sides: [water, water, water, water],
                                   isLiquid, submerged: true }), null,
    'water on every side of the ceiling cannot flood a bot already under water')
})

test('LAVA still refuses, submerged or not — it is a NEW harm', () => {
  // Water meeting water changes nothing. Water meeting lava changes a great
  // deal, and the bot is standing where they meet.
  assert.match(overheadBreakRisk({ head: lava, sides: DRY, isLiquid, submerged: true }),
    /liquid overhead \(lava\)/)
  assert.match(overheadBreakRisk({ head: stone, sides: [lava, stone, stone, stone],
                                   isLiquid, submerged: true }), /liquid beside/)
  assert.match(overheadBreakRisk({ head: lava, sides: DRY, isLiquid, submerged: false }),
    /liquid overhead \(lava\)/)
})

test('the exemption is opt-in: absent or falsey means the old behaviour', () => {
  // A caller that cannot answer "is it submerged" must get the guard unchanged.
  for (const arg of [{}, { submerged: false }, { submerged: undefined }, { submerged: null }]) {
    assert.match(overheadBreakRisk({ head: water, sides: DRY, isLiquid, ...arg }),
      /liquid overhead/, JSON.stringify(arg))
  }
})

test('POSITIVE CONTROL: submerged changes the answer on water and ONLY on water', () => {
  // If it changed nothing, every assertion above passes against the old code.
  // If it changed more, the widening is wider than the comment claims.
  const cases = [
    ['water overhead', { head: water, sides: DRY }],
    ['lava overhead', { head: lava, sides: DRY }],
    ['water beside', { head: stone, sides: [water, stone, stone, stone] }],
    ['lava beside', { head: stone, sides: [lava, stone, stone, stone] }],
    ['all dry', { head: stone, sides: DRY }],
    ['nothing to break', { head: air, sides: DRY }],
  ]
  const changed = cases.filter(([, c]) =>
    (overheadBreakRisk({ ...c, isLiquid }) === null) !==
    (overheadBreakRisk({ ...c, isLiquid, submerged: true }) === null)).map(([n]) => n)
  assert.deepEqual(changed, ['water overhead', 'water beside'],
    'exactly the two water cases flip, and nothing else: got ' + JSON.stringify(changed))
})

test('a bot with its head in AIR is never exempted, however wet its feet', () => {
  // The call site reads BOTH of the bot's own cells. This asserts the contract
  // that makes that necessary: feet-only would exempt a bot wading a shoreline,
  // which is exactly the bot the guard is right about.
  assert.match(overheadBreakRisk({ head: water, sides: DRY, isLiquid, submerged: false }),
    /liquid overhead/, 'wading is not submerged')
})
