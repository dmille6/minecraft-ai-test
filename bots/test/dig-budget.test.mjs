// A TOOLLESS BOT MAY CLIMB OUT OF STONE AND MAY NOT CLIMB OUT OF DEEPSLATE.
//
// That was the rule, and nobody wrote it. It fell out of one constant:
// `shaftAscend` allowed every dig 15,000ms, and Minecraft's bare-handed break
// time for a block that requires a tool is hardness x 5 seconds --
//
//     stone              7,500ms   fits
//     deepslate         15,000ms   EXACTLY the budget, never fits
//     iron_ore          15,000ms   EXACTLY the budget, never fits
//     cobbled_deepslate 17,500ms   over the budget, never fits
//
// Deepslate replaces stone below y=0. So a bot with blocks in hand and no
// pickaxe could pillar out of a shallow cave and never out of a deep one; the
// timeout was recorded as `dig failed on <block>`, `climbPrerequisite` turned
// that into "get a pickaxe", and the bot was sent to fetch wood that only grows
// on the surface it could not reach. 155 decisions per bot, 0% success.
//
// Breaking stone bare-handed drops nothing, and that is fine. A climb wants the
// hole, not the cobble.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import {
  planDig, predictedDigMs, MIN_DIG_MS, MAX_DIG_MS,
} from '../src/digbudget.mjs'
const require_ = createRequire(import.meta.url)

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// --- the registry's own numbers, not mine -----------------------------------
//
// The whole defect was a constant nobody had ever compared against the game, so
// the test compares against the game.
const VERSION = '1.21.8'
const registry = require_('prismarine-registry')(VERSION)
const Block = require_('prismarine-block')(registry)
const block = name => {
  const b = registry.blocksByName[name]
  assert.ok(b, `${name} missing from the ${VERSION} registry`)
  return Block.fromStateId(b.defaultState, 0)
}
const byHand = name => predictedDigMs(block(name), null)

t('the registry still says what the diagnosis said it did', () => {
  // If any of these move, the budget arithmetic below is about a different
  // game and every conclusion in this file needs re-deriving.
  assert.equal(byHand('stone'), 7_500)
  assert.equal(byHand('deepslate'), 15_000)
  assert.equal(byHand('cobbled_deepslate'), 17_500)
  assert.equal(byHand('iron_ore'), 15_000)
  assert.equal(byHand('obsidian'), 250_000)
})

t('THE OLD BUDGET WAS EXACTLY THE DEEPSLATE BREAK TIME', () => {
  // Not "a bit tight" -- identical. This is the bug in one line, and it is why
  // the failure looked like terrain rather than arithmetic.
  assert.equal(byHand('deepslate'), MIN_DIG_MS,
    'the old flat budget and the bare-handed deepslate dig were the same number')
})

// --- what the fix has to guarantee ------------------------------------------

t('a bare hand is given time to break deepslate', () => {
  const p = planDig(byHand('deepslate'))
  assert.equal(p.refuse, false, 'deepslate must not be refused: it is ordinary deep terrain')
  assert.ok(p.budgetMs > byHand('deepslate'),
    `budget ${p.budgetMs}ms must exceed the ${byHand('deepslate')}ms the dig actually takes`)
})

t('and cobbled_deepslate, which is worse and is what a bot digs into', () => {
  const p = planDig(byHand('cobbled_deepslate'))
  assert.equal(p.refuse, false)
  assert.ok(p.budgetMs > byHand('cobbled_deepslate'), `${p.budgetMs} <= ${byHand('cobbled_deepslate')}`)
})

t('every block a frozen bot was found under is now escapable bare-handed', () => {
  // The ceiling blocks named in the fleet's own `_prereq_adopted` records:
  // "the open shaft is capped by <X> N blocks overhead".
  for (const name of ['stone', 'deepslate', 'cobbled_deepslate', 'granite', 'diorite',
                      'andesite', 'tuff', 'cobblestone', 'iron_ore', 'copper_ore',
                      'coal_ore', 'lapis_ore', 'dripstone_block', 'dirt']) {
    const p = planDig(byHand(name))
    assert.equal(p.refuse, false, `${name} would still be refused`)
    assert.ok(p.budgetMs > byHand(name),
      `${name}: budget ${p.budgetMs}ms does not cover a ${byHand(name)}ms dig`)
  }
})

t('obsidian is still refused, and refused FAST', () => {
  // The cap is the point: a climb that spends its whole 120s deadline on one
  // hopeless block has not been careful, it has been useless.
  const p = planDig(byHand('obsidian'))
  assert.equal(p.refuse, true, 'bare-handed obsidian is 250s and must not be attempted')
  assert.ok(MAX_DIG_MS < byHand('obsidian'))
})

t('a pickaxe makes the budget smaller, not larger', () => {
  const tool = { type: registry.itemsByName.wooden_pickaxe.id }
  const withTool = planDig(predictedDigMs(block('deepslate'), tool))
  const without  = planDig(byHand('deepslate'))
  assert.ok(withTool.budgetMs <= without.budgetMs,
    'holding a tool must never cost the climb more time than not holding one')
})

// --- degenerate inputs must not invent a trap -------------------------------

t('an unknown dig time is attempted, never refused', () => {
  // Test fakes, modded blocks and registry gaps all land here. Refusing on a
  // missing lookup would rebuild the trap out of a different mistake.
  for (const v of [null, undefined, NaN, 0, -1, 'nonsense']) {
    const p = planDig(v)
    assert.equal(p.refuse, false, `planDig(${String(v)}) refused`)
    assert.equal(p.budgetMs, MIN_DIG_MS, `planDig(${String(v)}) lost the floor`)
    assert.equal(p.predictedMs, null)
  }
})

t('predictedDigMs survives a block that cannot answer', () => {
  assert.equal(predictedDigMs(null, null), null)
  assert.equal(predictedDigMs({ name: 'stone' }, null), null, 'no digTime method')
  assert.equal(predictedDigMs({ digTime: () => { throw new Error('nope') } }, null), null)
  assert.equal(predictedDigMs({ digTime: () => Infinity }, null), null)
})

t('the old flat budget survives as a FLOOR, so fast blocks are unaffected', () => {
  assert.equal(planDig(750).budgetMs, MIN_DIG_MS, 'dirt must not get a shorter budget than before')
  assert.equal(planDig(byHand('stone')).budgetMs, MIN_DIG_MS,
    'stone already fit in the old budget and must not change')
})

// --- THE MUTANT -------------------------------------------------------------
//
// Every fix here has to kill a mutant that reproduces the original bug. The
// original bug IS the constant, so the mutant is the constant: pin the budget
// flat at 15,000ms and check that the suite above notices.
t('MUTANT: a flat 15,000ms budget is caught', () => {
  const flat = () => ({ budgetMs: 15_000, refuse: false, predictedMs: null })
  let caught = 0

  // The deepslate assertion is the one that must fail under the mutant.
  const p = flat()
  if (!(p.budgetMs > byHand('deepslate'))) caught++
  if (!(p.budgetMs > byHand('cobbled_deepslate'))) caught++
  assert.equal(caught, 2,
    'a flat 15,000ms budget must fail the deepslate and cobbled_deepslate assertions')

  // And the real implementation must pass exactly where the mutant fails.
  assert.ok(planDig(byHand('deepslate')).budgetMs > byHand('deepslate'))
  assert.ok(planDig(byHand('cobbled_deepslate')).budgetMs > byHand('cobbled_deepslate'))
})

t('MUTANT: dropping the cap lets obsidian eat the whole ascent', () => {
  const uncapped = ms => planDig(ms, { cap: Infinity })
  assert.equal(uncapped(byHand('obsidian')).refuse, false,
    'anchor: with no cap the mutant would attempt obsidian')
  assert.equal(planDig(byHand('obsidian')).refuse, true,
    'the real implementation must refuse it')
})

t('MUTANT: refusing on an unknown dig time rebuilds the trap', () => {
  const strict = ms =>
    (typeof ms === 'number' && Number.isFinite(ms) && ms > 0
      ? planDig(ms)
      : { refuse: true, budgetMs: 0 })
  assert.equal(strict(null).refuse, true, 'anchor: the mutant refuses unknowns')
  assert.equal(planDig(null).refuse, false, 'the real implementation must attempt them')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
