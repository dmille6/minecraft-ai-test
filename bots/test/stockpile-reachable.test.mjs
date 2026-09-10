// A STOCKPILE GOAL MUST BE REACHABLE, AND FOR ~1,000 LAPS IT WAS NOT.
//
// sustaining.test.mjs opens with "A milestone must never present an impossible
// goal" and then only checks that no goal renders NaN, at cycles 0/1/5/40. The
// fleet is at cycle 540 (median) and 1,055 (max), and at those laps the two
// stockpile rungs ask for more than the bot can physically carry.
//
// Measured 2026-09-10, 6h, 36,165 decisions over 80 bots:
//
//   7,062 decisions (19.5% of every decision the fleet made), 55 of 80 bots,
//   on a stockpile goal whose target exceeds the 36x64 = 2,304 slots of a
//   Minecraft inventory. Median progress on those goals: 1.3% of target.
//
// And `stockpile_wood` is the goal immediately in front of TECH_LADDER, so the
// grind happens where it blocks the tech tree: 749 decisions across 24 bots
// where the bot could craft a stone_pickaxe it did not own, and the active goal
// was stockpile_wood/gather_oak_log_12/stockpile_stone in 86.6% of them.
//
// This is a BEHAVIOUR test on an exported pure function, not a grep. The thing
// it forbids is a target no bot can hold, so that is what it asserts.
import assert from 'node:assert'
import test from 'node:test'
import { SUSTAINING, stockpileTarget, STOCKPILE_MAX } from '../src/milestones.mjs'

// 27 main slots + 9 hotbar, 64 to a stack. Tools, food and blocks all compete
// for these, so this is a generous ceiling, not a realistic one.
const INVENTORY_SLOTS = 36
const STACK = 64
const INVENTORY_CAP = INVENTORY_SLOTS * STACK      // 2,304

const bot = inv => ({
  entity: { position: { x: 0, y: 70, z: 0, distanceTo: () => 5 } },
  inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) },
})
const wood = SUSTAINING.find(m => m.id === 'stockpile_wood')
const stone = SUSTAINING.find(m => m.id === 'stockpile_stone')

// The laps the fleet is ACTUALLY on, not the 0-40 the old test sampled.
const OBSERVED_LAPS = [0, 1, 5, 40, 524, 540, 638, 763, 924, 1055]

test('POSITIVE CONTROL: both rungs exist and the low laps are unchanged', () => {
  assert.ok(wood && stone, 'both stockpile rungs must be in SUSTAINING')
  assert.equal(stockpileTarget(8, 4, 0), 8, 'lap 0 still asks for 8 logs')
  assert.equal(stockpileTarget(16, 8, 0), 16, 'lap 0 still asks for 16 stone')
  assert.equal(stockpileTarget(8, 4, 3), 20, 'lap 3 still asks for 20 -- it still escalates')
  assert.equal(stockpileTarget(16, 8, 4), 48, 'lap 4 still asks for 48')
})

test('THE BUG: no lap may ask for more than a bot can carry', () => {
  for (const n of OBSERVED_LAPS) {
    for (const [label, target] of [['wood', stockpileTarget(8, 4, n)],
                                   ['stone', stockpileTarget(16, 8, n)]]) {
      assert.ok(target <= INVENTORY_CAP,
        `lap ${n}: ${label} target ${target} exceeds the ${INVENTORY_CAP}-item inventory`)
      assert.ok(target <= STOCKPILE_MAX,
        `lap ${n}: ${label} target ${target} is above the ${STOCKPILE_MAX} ceiling`)
    }
  }
})

test('a bot holding one stack completes both rungs at EVERY observed lap', () => {
  // The operational claim: the goal is finishable from a state bots reach.
  // 32 of 80 bots hold 64+ wood-units and 18 of 80 hold 64+ stone right now.
  const stocked = bot({ birch_log: STACK, cobblestone: STACK })
  for (const n of OBSERVED_LAPS) {
    assert.equal(wood.done(stocked, n), true, `wood unfinishable at lap ${n}`)
    assert.equal(stone.done(stocked, n), true, `stone unfinishable at lap ${n}`)
  }
})

test('POSITIVE CONTROL: an empty bot is still asked, at every lap', () => {
  // If this failed, the "fix" would be "never ask", which is worse than the bug.
  const empty = bot({ dirt: 64 })
  for (const n of OBSERVED_LAPS) {
    assert.equal(wood.done(empty, n), false, `wood vacuously satisfied at lap ${n}`)
    assert.equal(stone.done(empty, n), false, `stone vacuously satisfied at lap ${n}`)
  }
})

test('describe and progress print the capped number, not the raw formula', () => {
  // The model reads these strings; a capped done() with an uncapped describe
  // would tell the bot to fetch 4,228 logs and then call it finished at 64.
  assert.match(wood.describe(1055), /Stockpile 64 logs/, wood.describe(1055))
  assert.match(stone.describe(1055), /Stockpile 64 cobblestone/, stone.describe(1055))
  assert.match(wood.progress(bot({ oak_log: 3 }), 1055), /3\/64/,
    wood.progress(bot({ oak_log: 3 }), 1055))
  assert.match(stone.progress(bot({ cobblestone: 3 }), 1055), /3\/64/,
    stone.progress(bot({ cobblestone: 3 }), 1055))
})

test('a NaN or missing lap degrades to the easy goal, never to NaN', () => {
  // Where the previous bug in this file lived: every comparison against NaN is
  // false, so the goal could neither be completed nor failed.
  for (const bad of [undefined, null, NaN, Infinity]) {
    assert.equal(stockpileTarget(8, 4, bad), 8, `lap ${String(bad)}`)
    assert.equal(stockpileTarget(16, 8, bad), 16, `lap ${String(bad)}`)
  }
})

test('MUTANT: the uncapped formula this replaced really does fail these', () => {
  // A test that has never been seen to fail is not a test. This is the exact
  // expression that was in the file, run against the laps the fleet is on.
  const uncappedWood = n => 8 + n * 4
  const uncappedStone = n => 16 + n * 8
  assert.equal(uncappedWood(1055), 4228)
  assert.equal(uncappedStone(1055), 8456)
  assert.ok(uncappedWood(1055) > INVENTORY_CAP,
    'sanity: the old wood formula really did exceed a whole inventory')
  assert.ok(uncappedStone(1055) > INVENTORY_CAP,
    'sanity: the old stone formula really did exceed a whole inventory')
  // And the observed live goal: board-a-Alpha, lap 638, "Stockpile 5120".
  assert.equal(uncappedStone(638), 5120, 'the number read off the live prompt')
  // The mutant fails the reachability test above; the shipped one passes it.
  const stocked = bot({ birch_log: STACK, cobblestone: STACK })
  const woodUnits = 64, stoneUnits = 64
  assert.ok(!(woodUnits >= uncappedWood(638)),
    'sanity: a full stack does not satisfy the uncapped wood goal at lap 638')
  assert.ok(!(stoneUnits >= uncappedStone(638)),
    'sanity: a full stack does not satisfy the uncapped stone goal at lap 638')
  assert.equal(wood.done(stocked, 638), true, 'and the shipped one is satisfied')
  assert.equal(stone.done(stocked, 638), true, 'and the shipped one is satisfied')
})
