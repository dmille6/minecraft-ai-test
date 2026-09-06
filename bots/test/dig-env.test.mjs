// THE BUDGET AND THE DIG WERE COMPUTED WITH DIFFERENT FORMULAS.
//
// `predictedDigMs` called `block.digTime(type, false, false, false)` --
// creative, inWater and notOnGround all hardcoded. Mineflayer's own
// `bot.digTime` (lib/plugins/digging.js:248) passes the REAL
// `!bot.entity.onGround`, and prismarine-block (index.js:350) applies
// `blockBreakingSpeed /= 5.0` when it is true.
//
// The gap is exactly 5x, on exactly the population that matters: an escape
// routine runs precisely when the bot is NOT standing on solid ground.
//
// Measured 2026-09-06: the lattice chose `dig_down` 337 times, succeeded 0, and
// 86% ended `dig exceeded 15000ms`. Those digs were not slow. Bare-handed stone
// while airborne needs 37,500ms and the budget was 15,000ms, so no amount of
// waiting would have finished one -- and `digHand` could not fall back to the
// pickaxe (2,850ms airborne, comfortably inside the budget) because the fiction
// it was fed said bare hands would fit.
import assert from 'node:assert'
import fsmod from 'node:fs'
import test from 'node:test'
import mcDataLoader from 'minecraft-data'
import BlockLoader from 'prismarine-block'
import { predictedDigMs, planDig, digHand, digEnv } from '../src/digbudget.mjs'

const V = '1.21.8'
const mcData = mcDataLoader(V)
const Block = BlockLoader(V)
const blk = n => Block.fromStateId(mcData.blocksByName[n].defaultState, 0)
const PICK = { type: mcData.itemsByName.stone_pickaxe.id }

const GROUNDED = { notOnGround: false }
const AIRBORNE = { notOnGround: true }

test('POSITIVE CONTROL: the registry answers, and the flag changes the answer', () => {
  // Without this the assertions below could pass because everything returned null.
  const on = predictedDigMs(blk('stone'), null, GROUNDED)
  const air = predictedDigMs(blk('stone'), null, AIRBORNE)
  assert.equal(on, 7500)
  assert.equal(air, 37500, 'prismarine-block applies a 5x penalty when not on ground')
  assert.equal(air / on, 5)
})

test('THE REGRESSION: bare-handed escape digs could never have finished', () => {
  // The budget is sized from the prediction, so with the old on-ground fiction
  // it was 15,000ms for a dig that really takes 37,500ms.
  const fiction = planDig(predictedDigMs(blk('stone'), null, GROUNDED))
  const truth = predictedDigMs(blk('stone'), null, AIRBORNE)
  assert.equal(fiction.refuse, false, 'the old code happily accepted this dig')
  assert.ok(truth > fiction.budgetMs * 2,
    `the real dig (${truth}ms) is more than double the budget it was given (${fiction.budgetMs}ms)`)
})

test('THE FIX: honest numbers make digHand reach for the pickaxe by itself', () => {
  // This is the whole repair. `digHand` was never wrong -- it prefers bare hands
  // unless planDig REFUSES the bare swing. Airborne bare-handed stone is
  // 37,500ms, past the 30s ceiling, so it refuses and the tool is chosen.
  for (const name of ['stone', 'andesite', 'cobblestone', 'deepslate']) {
    const b = blk(name)
    const h = digHand({ bareMs: predictedDigMs(b, null, AIRBORNE),
                        toolMs: predictedDigMs(b, PICK, AIRBORNE) })
    assert.equal(h.hand, 'tool', `${name}: airborne bare-handed cannot finish`)
    assert.equal(h.refuse, false, `${name}: and the tool must not be refused`)
    assert.ok(predictedDigMs(b, PICK, AIRBORNE) <= h.budgetMs,
      `${name}: the budget must cover the tooled dig it just chose`)
  }
})

test('...and on the ground bare hands are still preferred, so durability is kept', () => {
  // The 68%-of-pickaxe-losses finding is real and this must not undo it.
  for (const name of ['stone', 'andesite', 'dirt', 'oak_log']) {
    const b = blk(name)
    const h = digHand({ bareMs: predictedDigMs(b, null, GROUNDED),
                        toolMs: predictedDigMs(b, PICK, GROUNDED) })
    assert.equal(h.hand, 'bare', `${name}: grounded bare-handed fits, so spend no durability`)
  }
})

test('inWater is read at EYE level, not at the feet — mirroring mineflayer', () => {
  // mineflayer: `['water','flowing_water'].includes(bot._getBlockAtEyeLevel()?.name)`.
  // Reading the feet cell instead would mis-price every dig done while wading.
  const eyeWater = { ...GROUNDED, inWater: true }
  assert.ok(predictedDigMs(blk('stone'), null, eyeWater) >
            predictedDigMs(blk('stone'), null, GROUNDED),
    'submerged digging is slower and the budget must know it')
  const bot = { entity: { onGround: true }, _getBlockAtEyeLevel: () => ({ name: 'water' }) }
  assert.equal(digEnv(bot).inWater, true)
  const dry = { entity: { onGround: true }, _getBlockAtEyeLevel: () => ({ name: 'air' }) }
  assert.equal(digEnv(dry).inWater, false)
})

test('digEnv fails SAFE: an unreadable onGround predicts the slower dig', () => {
  // Over-predicting makes digHand reach for the tool, which costs durability.
  // Under-predicting produces a dig that cannot finish, which costs the bot.
  // Only the second failure stranded the fleet, so the default leans the other way.
  assert.equal(digEnv({}).notOnGround, true, 'no entity at all')
  assert.equal(digEnv({ entity: {} }).notOnGround, true, 'entity with no onGround field')
  assert.equal(digEnv(undefined).notOnGround, true, 'no bot at all')
  assert.equal(digEnv({ entity: { onGround: true } }).notOnGround, false)
  assert.equal(digEnv({ entity: { onGround: false } }).notOnGround, true)
})

test('an omitted env keeps the OLD behaviour, so nothing changes by accident', () => {
  // The parameter is optional; callers that do not pass it must be unaffected
  // rather than silently switching to the airborne prediction.
  assert.equal(predictedDigMs(blk('stone'), null), 7500)
  assert.equal(predictedDigMs(blk('stone'), null, {}), 7500)
})

test('unknown blocks still read as unknown, never as zero', () => {
  assert.equal(predictedDigMs({}, null, AIRBORNE), null)
  assert.equal(predictedDigMs(null, null, AIRBORNE), null)
  assert.equal(predictedDigMs({ digTime: () => { throw new Error('boom') } }, null, AIRBORNE), null)
})

test('THE BOUNDARY: env goes to the hand-choosers, NOT to the refusers', () => {
  // `planDig` refuses over MAX_DIG_MS, so a 5x airborne prediction converts
  // deepslate from a block the climb BREAKS (15,000ms grounded) into one it
  // DECLINES (75,000ms airborne) -- and a bot that cannot break its own ceiling
  // is trapped with no remedy. The suite caught this: five behaviour tests in
  // dig-budget.test.mjs went red on "the climb never attempted the block over
  // its head". So the boundary is deliberate and is pinned here.
  const deepslate = blk('deepslate')
  const grounded = planDig(predictedDigMs(deepslate, null, GROUNDED))
  const airborne = planDig(predictedDigMs(deepslate, null, AIRBORNE))
  assert.equal(grounded.refuse, false, 'the climb must still attempt deepslate')
  assert.equal(airborne.refuse, true,
    'POSITIVE CONTROL: the airborne prediction really would refuse it')

  // Source assertion, because behaviour cannot reach "which arguments does this
  // call site pass". Comments stripped first: this codebase quotes the code it
  // explains, so a naive grep matches the prose.
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

  const reflex = strip(fsmod.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8'))
  const skills = strip(fsmod.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.match(reflex, /predictedDigMs\(/, 'POSITIVE CONTROL: reflex still calls it')

  // Every digHand call — the hand-choosers — must carry the environment.
  const handCalls = [...reflex.matchAll(/digHand\(\{[^}]*\}\)/g)].map(m => m[0])
  assert.equal(handCalls.length, 2, 'harvestUnderfoot and the pillarOut headroom clear')
  for (const c of handCalls) {
    assert.equal((c.match(/predictedDigMs\([^)]*, env\)/g) || []).length, 2,
      `a digHand site prices without the real environment: ${c.replace(/\s+/g, ' ')}`)
  }

  // And the refuse-path budgets must NOT, or they rebuild the ceiling trap.
  for (const [name, src] of [['reflex', reflex], ['skills', skills]]) {
    for (const m of src.matchAll(/planDig\(predictedDigMs\(([^)]*)\)\)/g)) {
      assert.ok(!/digEnv|, env/.test(m[1]),
        `${name}: a planDig budget takes the airborne prediction (${m[1]}) — ` +
        `that refuses deepslate and traps the bot under its own ceiling`)
    }
  }
})
