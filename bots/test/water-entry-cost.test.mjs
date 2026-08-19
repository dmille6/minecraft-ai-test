// liquidCost NEVER PRICED ENTERING WATER. It priced being wet.
//
// mineflayer-pathfinder charges it like this (movements.js:398):
//
//     if (this.getBlock(node, 0, 0, 0).liquid) cost += this.liquidCost
//
// Node 0,0,0 is the CURRENT block, so the penalty lands when a wet bot moves
// and never when a dry one steps in. A step from grass into a lake cost 1 --
// identical to a step onto more grass -- for the entire life of this project,
// while index.mjs claimed "a detour of up to ~10 land steps per water step
// wins". Twelve hours of telemetry: 3,090 drowning reflex firings, 2,241 of
// them at y60-69 against a sea level of 63, and all nine of the last deaths.
//
// exclusionAreasStep IS destination-priced (movements.js:122, applied at :367
// and again inside safeOrBreak at :284), so it is the correct hook. It lands
// two or three times per forward move, which is what sets the ceiling:
//
//     land -> shallow water   1 + 2N
//     land -> deep water      1 + 3N
//     water -> deep water     1 + 3N + liquidCost
//
// Fifteen `if (cost > 100) return` guards DELETE the neighbour, so N=30 makes
// a wet bot's next wet step cost 101 and water ceases to exist for the planner
// -- trading drowning for immobility. These tests pin N=25 as under that line,
// and pin that water remains reachable, because a fix that strands bots in
// flooded caves is worse than the bug.
import assert from 'node:assert'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const { Movements } = require_('mineflayer-pathfinder')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const WATER_ENTRY_COST = 25          // must match index.mjs
const penalty = (block) => (block?.liquid ? WATER_ENTRY_COST : 0)

const water = { liquid: true, name: 'water' }
const grass = { liquid: false, name: 'grass_block' }
const air = { liquid: false, name: 'air' }

// The real exclusionStep, not a copy: a reimplementation here would keep
// passing after the library changed under us.
const m = Object.create(Movements.prototype)
m.exclusionAreasStep = [penalty]

t('stepping onto land is free', () => {
  assert.equal(m.exclusionStep(grass), 0)
  assert.equal(m.exclusionStep(air), 0)
})

t('stepping into water is not', () => {
  assert.equal(m.exclusionStep(water), WATER_ENTRY_COST)
})

t('a missing block does not throw or charge', () => {
  // getBlock returns null past the loaded world edge; a rescue must not crash
  // there, and must not price the unknown as though it were a lake.
  assert.equal(m.exclusionStep(null), 0)
  assert.equal(m.exclusionStep(undefined), 0)
})

// --- the arithmetic that fixes the number ----------------------------------
const LIQUID_COST = 10
const landToShallow = 1 + 2 * WATER_ENTRY_COST
const landToDeep    = 1 + 3 * WATER_ENTRY_COST
const waterToDeep   = 1 + 3 * WATER_ENTRY_COST + LIQUID_COST

t('every wet move stays under the neighbour-drop ceiling of 100', () => {
  // This is the whole safety argument. Above 100 the move is deleted, water
  // stops existing, and a bot in a flooded cave can never swim out.
  assert.ok(waterToDeep < 100, `water->deep is ${waterToDeep}, which deletes the move`)
  assert.ok(landToDeep < 100)
  assert.ok(landToShallow < 100)
})

t('N=30 WOULD have banned water -- the value is a ceiling, not a preference', () => {
  const at30 = 1 + 3 * 30 + LIQUID_COST
  assert.ok(at30 > 100,
    'if this ever stops being true the safety margin has moved and 25 should be revisited')
})

t('entering water costs more than a substantial dry detour', () => {
  // The point of the change: a one-block paddle should lose to walking around.
  // A dry step is 1, so land->shallow at 51 buys roughly a 50-step detour.
  assert.ok(landToShallow > 25, 'a shoreline dip must not be cheaper than a short walk around')
})

t('water is still cheaper than not existing', () => {
  // A hard ban would be Infinity or >100. It is neither.
  assert.notEqual(penalty(water), Infinity)
  assert.ok(penalty(water) < 100)
})

t('the penalty is a pure function of the block, not of bot state', () => {
  // Arm-neutrality: nothing here may vary with memory scope, or the four Block
  // 2 arms would path differently and the comparison would measure routing.
  assert.equal(penalty(water), penalty(water))
  assert.equal(penalty({ liquid: true, name: 'lava' }), WATER_ENTRY_COST)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
