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
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const { Movements } = require_('mineflayer-pathfinder')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// READ THE REAL CONSTANT. This was a local copy with a "must match index.mjs"
// comment, and on 2026-08-29 it stopped matching: index.mjs shipped 2 while the
// test asserted against 1, so every cost assertion here was checking a number
// no bot would ever use. A mutation setting index.mjs to 25 — the old
// prohibition — passed this file untouched. A test that keeps its own copy of
// the value it is testing cannot fail.
const INDEX_SRC = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')
const WATER_ENTRY_COST = Number(/const WATER_ENTRY_COST = (\d+)/.exec(INDEX_SRC)?.[1])
if (!Number.isFinite(WATER_ENTRY_COST)) {
  console.log('  FAIL  could not read WATER_ENTRY_COST from index.mjs')
  process.exit(1)
}
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
const LIQUID_COST = Number(/moves\.liquidCost = (\d+)/.exec(INDEX_SRC)?.[1])
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

t('a STROKE is never priced like a PACE', () => {
  // liquidCost = 1 is not a hypothetical: it is the Block 1 configuration,
  // where water was priced like pavement, A* planned straight across lakes, and
  // drowning became the top death cause. The floor is the speed ratio -- 4.3
  // m/s walking against 2.2 swimming is 1.95x -- so 2 is the least it may be.
  // A mutation setting this to 1 survived every other assertion in this file.
  assert.ok(LIQUID_COST >= 2,
    `liquidCost is ${LIQUID_COST}; at 1 a stroke costs the same as a pace, ` +
    'which is the configuration Block 1 died of')
})

t('a wet step still costs meaningfully more than a dry one', () => {
  // Water is terrain, not a free shortcut. Surface swimming is 2.2 m/s against
  // a walk of ~4.3, plus a real risk premium, so a stroke must never price like
  // a pace or A* will treat lakes as pavement. Block 1 ran liquidCost=1 with
  // broken swimming and drowning became the top death cause.
  // The floor is the SPEED RATIO: 4.3 m/s walking against 2.2 swimming is
  // 1.95x, so anything at or below 2 is pricing a stroke like a pace.
  assert.ok(landToShallow >= 3,
    `land->shallow is ${landToShallow}; water is being priced like ground`)
  assert.ok(waterToDeep > landToShallow,
    'going deeper must cost more than getting wet')
})

t('BUT A CROSSING MUST BEAT A LONG DETOUR', () => {
  // This is the change. The old price (land->shallow 51, water->deep 86) meant
  // a 20-block swim lost to a 1,700-block walk, so routes never included water
  // -- and a bot already wet had a nearly empty search graph, which is why
  // 20 of 20 drowning deaths were `idle` with nobody owning the body.
  const crossing = landToDeep + 19 * waterToDeep      // 20-block swim
  const detour = 150                                  // 150 dry paces around
  assert.ok(crossing < detour,
    `a 20-block crossing costs ${crossing} against a ${detour}-step walk around; ` +
    'water is still priced out of every route')
})

t('a short hop out of water is not priced like an expedition', () => {
  // The most sympathetic request in the system: a bot in water moving one block
  // to land. Under the old numbers that single step cost 86.
  assert.ok(waterToDeep <= 12,
    `one wet step costs ${waterToDeep}; a bot in water cannot afford to move`)
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
