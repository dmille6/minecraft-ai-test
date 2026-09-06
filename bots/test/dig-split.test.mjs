// REFUSE ON HARDNESS, BUDGET ON REALITY.
//
// `planDig` answers two questions with one input, and they want different ones:
//   "is this breakable at all by this hand?"  -> a property of BLOCK + TOOL
//   "how long will this dig take HERE?"       -> a property of the SITUATION
//
// Feeding the situation-aware prediction to both turns deepslate from a block
// the escape ramp BREAKS (15,000ms grounded) into one it DECLINES (75,000ms
// airborne, past the 30s ceiling), and a bot that cannot break its own ceiling
// is trapped with no remedy. Feeding the grounded prediction to both gives a
// real airborne dig a deadline sized for a dig that is 5x faster.
//
// Measured 2026-09-06: of 342 `escapeStairUp` attempts by the five permanently
// entombed bots, 23.9% ended `dig exceeded`. Not refused, not impossible —
// deadlined wrong.
import assert from 'node:assert'
import fsmod from 'node:fs'
import test from 'node:test'
import { planDig, planDigSplit, MAX_DIG_MS, MIN_DIG_MS } from '../src/digbudget.mjs'

const STONE = { hardnessMs: 7500, actualMs: 37500 }        // 5x airborne penalty
const DEEPSLATE = { hardnessMs: 15000, actualMs: 75000 }
const OBSIDIAN = { hardnessMs: 250000, actualMs: 1250000 }

test('POSITIVE CONTROL: it refuses some things and allows others', () => {
  assert.equal(planDigSplit(STONE).refuse, false)
  assert.equal(planDigSplit(OBSIDIAN).refuse, true)
})

test('THE TRAP IT AVOIDS: hardness decides the refusal, not the situation', () => {
  // If `actualMs` drove the refusal, both of these would be declined — and a bot
  // that cannot break its own ceiling has no remedy from where it is.
  for (const [name, c] of [['stone', STONE], ['deepslate', DEEPSLATE]]) {
    assert.equal(planDigSplit(c).refuse, false, `${name} must still be attempted`)
    assert.equal(planDig(c.actualMs).refuse, true,
      `POSITIVE CONTROL: ${name}'s airborne prediction really would refuse`)
  }
})

test('THE TIMEOUT IT FIXES: the deadline covers the dig that will happen', () => {
  for (const [name, c] of [['stone', STONE], ['deepslate', DEEPSLATE]]) {
    const split = planDigSplit(c)
    assert.ok(split.budgetMs > c.actualMs,
      `${name}: budget ${split.budgetMs}ms must cover the real ${c.actualMs}ms dig`)
    assert.ok(planDig(c.hardnessMs).budgetMs < c.actualMs,
      `POSITIVE CONTROL: ${name}'s old grounded budget really was too short`)
  }
})

test('it can only ever LENGTHEN a deadline, never shorten one', () => {
  // A shorter budget would introduce a timeout that did not exist before, which
  // is the failure this is meant to remove.
  for (let h = 100; h <= 25_000; h += 500) {
    for (const mult of [0.2, 1, 5]) {
      const split = planDigSplit({ hardnessMs: h, actualMs: h * mult })
      if (split.refuse) continue
      assert.ok(split.budgetMs >= planDig(h).budgetMs,
        `hardness=${h} actual=${h * mult}: ${split.budgetMs} < ${planDig(h).budgetMs}`)
    }
  }
})

test('an unknown situation falls back to the grounded budget, not to zero', () => {
  // Test fakes, modded blocks and registry gaps land here. Zero would be a
  // deadline no dig can meet — a confident refusal dressed as a budget.
  for (const actualMs of [null, undefined, NaN, 0, -1]) {
    const split = planDigSplit({ hardnessMs: 7500, actualMs })
    assert.equal(split.refuse, false)
    assert.equal(split.budgetMs, planDig(7500).budgetMs, `actualMs=${actualMs}`)
  }
  // And an unknown HARDNESS still means try-it, inheriting planDig's rule.
  assert.equal(planDigSplit({ hardnessMs: null, actualMs: 40_000 }).refuse, false)
  assert.ok(planDigSplit({}).budgetMs >= MIN_DIG_MS)
})

test('a refused block reports no budget at all', () => {
  const r = planDigSplit(OBSIDIAN)
  assert.equal(r.refuse, true)
  assert.equal(r.budgetMs, 0)
  assert.ok(OBSIDIAN.hardnessMs > MAX_DIG_MS, 'POSITIVE CONTROL: it is past the ceiling')
})

test('WIRED IN: the ramp uses the split, and its refuse path stays grounded', () => {
  const raw = fsmod.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
  assert.match(code, /planDigSplit\(\{/, 'the ramp must price with the split')
  assert.match(code, /hardnessMs: predictedDigMs\(b, null\)/,
    'the refusal must stay on the GROUNDED prediction or deepslate becomes untouchable')
  assert.match(code, /actualMs: predictedDigMs\(b, null, digEnv\(bot\)\)/,
    'and the deadline must use the real situation')
  // canBreak — the ramp's own reachability test — must NOT take the env, for
  // the same reason: it decides refusals.
  const i = code.indexOf('const canBreak')
  assert.ok(i > 0, 'POSITIVE CONTROL: canBreak is still there')
  assert.doesNotMatch(code.slice(i, i + 400), /digEnv/,
    'canBreak decides refusals and must stay on the grounded prediction')
})
