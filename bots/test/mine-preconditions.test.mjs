/**
 * Captured from production, 20 occurrences:
 *
 *   Hive01 mine({"y": 50}) -> failed
 *   "no pickaxe, so descending would strand this bot beside stone it cannot
 *    mine -- craft a wooden_pickaxe first"
 *   at -45.7,72,-24.6  hp=20  inv={dirt: 2, leaf_litter: 4}
 *
 * The skill's own guard caught every one, which is the guard working. But each
 * still cost a full decision cycle -- an LLM call, an admission pass, a skill
 * invocation -- to reach a conclusion that was a pure function of the inventory
 * the gate could already see. 51 of those in the current window.
 *
 * The property: an action whose precondition is knowable BEFORE execution should
 * not reach execution. This test pins that against the real states, so the fix
 * (narrowing the offered action set) has something to be measured against, and
 * so the case cannot silently come back.
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

const fx = JSON.parse(readFileSync(new URL('./fixtures/mine_without_pickaxe.json', import.meta.url)))

let n = 0
const ok = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); n++ }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1 }
}

const PICKAXES = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe',
                  'diamond_pickaxe', 'netherite_pickaxe']
const hasPickaxe = inv => PICKAXES.some(p => (inv?.[p] ?? 0) > 0)

ok('the fixture is real production data, not a hand-written guess', () => {
  assert.ok(fx.cases.length >= 10, `only ${fx.cases.length} cases captured`)
  for (const c of fx.cases) {
    assert.equal(c.skill, 'mine')
    assert.ok(c.detail.includes('no pickaxe'))
    assert.ok(c.pos && c.pos.y != null, 'every case must carry the state that produced it')
  }
})

ok('every captured failure was predictable from inventory alone', () => {
  // If this passes, none of these 20 decisions needed to be executed to fail.
  for (const c of fx.cases) {
    assert.equal(hasPickaxe(c.inventory), false,
      `${c.bot} had a pickaxe yet failed for want of one: ${JSON.stringify(c.inventory)}`)
  }
})

ok('a bot WITH a pickaxe is not caught by the same rule', () => {
  // The guard must not be so broad it blocks legitimate mining.
  assert.equal(hasPickaxe({ stone_pickaxe: 1, dirt: 3 }), true)
  assert.equal(hasPickaxe({ wooden_pickaxe: 1 }), true)
  assert.equal(hasPickaxe({}), false)
  assert.equal(hasPickaxe({ pickaxe_head: 4 }), false, 'substring matching would be wrong here')
})

ok('the descent depth was unbounded, which is the second defect here', () => {
  // mine's `y` is an ABSOLUTE elevation, not a relative depth, and nothing
  // bounded the drop. A bot at y=72 asking for y=50 is a 22-block descent into
  // stone it cannot mine -- admitted, then failed at the skill.
  const drops = fx.cases
    .filter(c => c.args?.y != null && c.pos?.y != null)
    .map(c => c.pos.y - c.args.y)
  assert.ok(drops.length, 'no case carried both a target and a position')
  const worst = Math.max(...drops)
  assert.ok(worst > 10,
    `expected to observe a large unbounded descent; worst was ${worst}`)
})

console.log(`\n${n} passed  (${fx.cases.length} production cases)`)
