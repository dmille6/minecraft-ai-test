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
import { readFileSync } from 'node:fs'
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

// --- AND IT HAS TO REACH THE CLIMB ------------------------------------------
//
// A budget nothing consults is a comment. These drive the real `surface` skill
// with a real registry block overhead, and check the one thing that changed:
// whether the climb TRIES.
import { SKILLS, shaftAscend } from '../src/skills.mjs'

const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z), clone: () => V(x, y, z) })

/** A bot sealed at y=2 under `ceiling`, carrying blocks and no tool. */
function sealedBot (ceiling, digCalls) {
  const head = block(ceiling)
  const bot = {
    entity: { position: V(634, 2, 276) },
    health: 20, food: 20,
    registry,
    inventory: { items: () => [{ name: 'cobbled_deepslate', count: 24, slot: 0,
                                 type: registry.itemsByName.cobbled_deepslate.id }] },
    blockAt: () => head,
    async equip () {}, async lookAt () {},
    setControlState () {}, stopDigging () {},
    async dig (b) { digCalls.push(b.name) },
    async placeBlock () {},
    ascentMovements: { kind: 'ascent' },
    pathfinder: {
      movements: { kind: 'travel' },
      setMovements (m) { this.movements = m },
      // Both searches finish and find nothing: the sealed pocket the shaft is for.
      getPathTo: () => ({ status: 'noPath', path: [1] }),
      async goto () {},
    },
    async withAscentMovements (fn) { return fn() },
    chat () {},
  }
  return bot
}
const climb = bot => SKILLS.surface.run({ bot }, {}, new AbortController().signal)

await ta('a toolless bot under DEEPSLATE now swings at it', async () => {
  // The whole freeze in one case. Bare-handed deepslate is 15,000ms and the old
  // budget was 15,000ms, so this dig could only ever time out -- and the timeout
  // was reported as "this stone needs a pickaxe" to a bot 61 blocks below the
  // nearest tree.
  const digs = []
  const r = await climb(sealedBot('deepslate', digs))
  assert.ok(digs.length > 0, 'the climb never attempted the block over its head')
  assert.deepEqual([...new Set(digs)], ['deepslate'])
  assert.doesNotMatch(r.detail ?? '', /needs a pickaxe/,
    `a bot that can break its own ceiling must not be sent for a pickaxe: ${r.detail}`)
})

await ta('and under cobbled_deepslate, which is slower still', async () => {
  const digs = []
  await climb(sealedBot('cobbled_deepslate', digs))
  assert.ok(digs.length > 0, '17,500ms of rock must still be attempted')
})

// --- A LONGER DIG NEEDS A CLOCK ---------------------------------------------
//
// Paying real time for deepslate is only safe if the climb stops on the
// caller's schedule. A bare-handed deepslate dig is now ~25s, and shaftAscend
// takes up to 96 steps -- 40 minutes against `surface`'s 120s deadline. Left
// alone it would be cut off by the runner's abort, which throws away BOTH the
// height already gained and the stopping reason the model needs. Ending cleanly
// turns the same climb into `travel_incomplete` -- "call again to continue" --
// which is progress, not a failed attempt. That distinction is the ladder rule.

await ta('a climb that is out of time stops itself, and keeps its progress', async () => {
  const digs = []
  const bot = sealedBot('deepslate', digs)
  const r = await shaftAscend(bot, 26, new AbortController().signal,
                              { deadline: Date.now() - 1 })
  assert.equal(r.stopped, 'out of time this call')
  assert.deepEqual(digs, [], 'an expired budget must not start another 25s dig')
  assert.equal(r.gained, 0, 'and it must still report the height, not throw it away')
})

await ta('a climb with time left is not stopped by the clock', async () => {
  const digs = []
  const r = await shaftAscend(sealedBot('deepslate', digs), 26,
                              new AbortController().signal, { deadline: Date.now() + 60_000 })
  assert.notEqual(r.stopped, 'out of time this call', 'the deadline fired early')
  assert.ok(digs.length > 0)
})

await ta('an absent deadline is unlimited, not zero', async () => {
  // The default must never read as "already expired" -- that would silently
  // disable the shaft for every caller that does not pass one.
  const digs = []
  const r = await shaftAscend(sealedBot('deepslate', digs), 26, new AbortController().signal)
  assert.notEqual(r.stopped, 'out of time this call')
  assert.ok(digs.length > 0, 'the default deadline stopped the climb before it began')
})

t('`surface` hands the shaft its own deadline', () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const calls = code.match(/shaftAscend\(bot, stageY, signal[^)]*\)/g) ?? []
  assert.equal(calls.length, 2, `expected surface's two shaft calls, found ${calls.length}`)
  for (const c of calls) {
    assert.match(c, /deadline: DEADLINE/,
      `a shaft call runs on no clock and can outlive the skill budget: ${c}`)
  }
})

t('the climb SPENDS the planned budget, and no literal survives beside it', () => {
  // A budget nothing passes to withTimeout is a comment. The behavioural tests
  // above cannot see this: their fake `bot.dig` resolves at once, so a reverted
  // constant would still let every one of them pass. Same pattern, and same
  // reason, as climb-escape.test.mjs asserting extendScaffolding is called.
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const call = /withTimeout\(bot\.dig\(head\),\s*([^,]+),/.exec(code)
  assert.ok(call, 'the climb no longer digs through withTimeout; re-read this test')
  assert.equal(call[1].trim(), 'plan.budgetMs',
    `the head dig is budgeted with ${call[1].trim()} instead of the planned time`)
  assert.ok(/planDig\(predictedDigMs\(head, tool\)\)/.test(code),
    'the budget is not derived from the block the climb is about to break')
  assert.ok(/plan\.refuse/.test(code), 'nothing acts on the refusal, so the cap is inert')
})

await ta('OBSIDIAN is refused without swinging, and asks for a better tool', async () => {
  // The cap earning its keep: 250s of bare-handed obsidian must not eat the
  // 120s ascent. This is the one case where "get a pickaxe" is the truth.
  const digs = []
  const r = await climb(sealedBot('obsidian', digs))
  assert.deepEqual(digs, [], 'obsidian must not be attempted bare-handed')
  assert.match(r.detail ?? '', /cannot break obsidian/, r.detail)
  assert.ok(SKILLS.surface, 'sanity: the skill under test exists')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
