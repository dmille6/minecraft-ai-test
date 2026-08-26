// FIVE GUARDS, EACH CORRECT ALONE, THAT TOGETHER TRAPPED THREE BOTS.
//
// board-c-Bravo, isolated-b-Comet and board-b-Echo pillared to the build limit
// and stayed there for eight hours. The story everyone reaches for is that the
// model would not comply. Measured over six hours, it is the opposite:
//
//     1,257 decisions by stranded bots
//       164 of them DESCENT ATTEMPTS  (13%)
//         0 permitted
//
// The refusals, in their own words:
//
//     37  goto  "y=73 is 247 blocks from your y=320"     <- symmetric dy guard
//     13  goto  "y=73 is 141 blocks from your y=214"
//      7  mine  "stopped at y=320: open space ... under" <- void-below guard
//      1  mine  "0 scaffold against a 0-block climb out" <- exit contract floor
//     17  explore "explored 0 blocks in 14 legs"         <- it is on a pillar
//
// Every one of those guards was written for a bot near the ground, and each is
// right in the situation it was written for. None had been asked what it does
// to a bot 250 blocks up. That is the recurring shape here: a rule that
// encodes an assumption about WHERE the agent is cannot survive the agent
// going somewhere new.
import assert from 'node:assert'
import { canContinueDescent } from '../src/exit-contract.mjs'
import { AdmissionControl } from '../src/admission.mjs'
import { makeBot, V, AIR, DIRT } from './helpers/microworld.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const SEA = 63

// --- guard 1: the exit contract's reserve floor ------------------------------

// What the stranded bots were actually carrying. The point under test is the
// SCAFFOLD FLOOR; an empty-handed fixture would refuse for the pickaxe instead
// and prove nothing about the change.
const PICK = [{ name: 'wooden_pickaxe', count: 1,
                maxDurability: 59, durabilityUsed: 0 }]

t('a reserve is not demanded against a climb of zero', () => {
  // The exact refusal: "0 scaffold blocks against a 0-block climb out".
  const r = canContinueDescent({ y: 320, health: 20, items: PICK, seaLevel: SEA })
  assert.ok(r.ok, `still refused with nothing to climb: ${r.detail}`)
})

t('a bot above sea level still needs a tool to dig with', () => {
  // Zero debt removes the CLIMB reserve. It does not conjure a pickaxe, and a
  // descent by mining without one is not a descent.
  const r = canContinueDescent({ y: 320, health: 20, items: [], seaLevel: SEA })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'pickaxe')
})

t('the floor still holds for a bot that is genuinely deep', () => {
  // y=40 owes 23 blocks of climb. An empty-handed bot there is the case the
  // floors exist for and must still be refused.
  const deep = canContinueDescent({ y: 40, health: 20, items: PICK, seaLevel: SEA })
  assert.strictEqual(deep.ok, false, 'a deep empty-handed bot was allowed to go deeper')
  assert.strictEqual(deep.reason, 'scaffold')
  // And one block below sea level still owes something.
  const shallow = canContinueDescent({ y: SEA - 1, health: 20, items: PICK, seaLevel: SEA })
  assert.strictEqual(shallow.ok, false, 'the reserve vanished the moment debt appeared')
})

t('low health still refuses, above sea level as below', () => {
  const r = canContinueDescent({ y: 320, health: 4, items: PICK, seaLevel: SEA })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'health')
})

// --- guard 2: the goto elevation guard --------------------------------------

const at = y => makeBot({ pos: new V(318, y, 127), blocks: (x, by) => (by < y ? DIRT : AIR),
                          inventory: { wooden_pickaxe: 1 } })
const goto = (bot, y) => new AdmissionControl().check({ skill: 'goto', args: { x: 355, y, z: 147 } }, bot)

t('THE 78 REFUSALS: a stranded bot may aim at the ground', () => {
  for (const from of [320, 221, 214, 207]) {
    const r = goto(at(from), 73)
    assert.notStrictEqual(r.reason, 'unreachable_elevation',
      `goto ground from y=${from} still refused: ${r.detail}`)
  }
})

t('but it still may not aim at the sky — the case the guard was built for', () => {
  // The comment on that guard names its origin: "y=140 while standing at y=70".
  const r = goto(at(70), 140)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'unreachable_elevation')
})

t('the guard is ASYMMETRIC, not merely loosened', () => {
  // Symmetric-and-wider would let the sky case back in. Down is unbounded
  // because a bot can fall, dig or walk down; up is not, because it cannot fly.
  const down = goto(at(320), 62)
  const up = goto(at(62), 320)
  assert.notStrictEqual(down.reason, 'unreachable_elevation', 'down is still capped')
  assert.strictEqual(up.reason, 'unreachable_elevation', 'up is no longer capped')
})

t('a normal bot is unaffected in either direction', () => {
  assert.notStrictEqual(goto(at(72), 64).reason, 'unreachable_elevation')
  assert.notStrictEqual(goto(at(72), 90).reason, 'unreachable_elevation')
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
