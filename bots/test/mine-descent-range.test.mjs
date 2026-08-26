// A CONSTANT UPPER BOUND COST A BOT SIX HOURS.
//
// board-c-Bravo pillared itself to y=320, the overworld build limit, and sat
// there. The reflex diagnosed `stranded_high` 59 times in two hours. Once the
// observation was fixed to actually say so, the model did exactly the right
// thing on its next decision -- it proposed a descent:
//
//     03:39:46  proposed  mine {"y": 173}
//               outcome:  aborted — "mine target y=173 outside -59..120"
//
// y=173 is 147 blocks down and 27 blocks below the climb ceiling. It is a
// good answer. The gate refused it because of `y > 120`, a constant written
// when every bot was already near the surface, where it reads as "do not ask
// to mine into the sky."
//
// The proxy was never needed. The downward precondition immediately below it
// already refuses any target at or above the bot, and that rule is correct at
// y=72 and at y=320 alike. A bound that encodes an assumption about WHERE the
// agent is cannot survive the agent going somewhere new -- and a stranded bot
// is by definition somewhere new.
import assert from 'node:assert'
import { AdmissionControl } from '../src/admission.mjs'
import { makeBot, V, AIR, DIRT } from './helpers/microworld.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// Carrying a pickaxe and blocks, because both stranded bots were: the point
// under test is the RANGE, and an empty inventory would refuse for an
// unrelated and perfectly correct reason.
const at = y => makeBot({ pos: new V(318, y, 127),
  blocks: (x, by) => (by < y ? DIRT : AIR),
  inventory: { wooden_pickaxe: 1, dirt: 64, oak_log: 226 } })
const check = (bot, y) =>
  new AdmissionControl().check({ skill: 'mine', args: { y } }, bot)

t('THE SIX-HOUR BUG: a stranded bot may descend to a y above 120', () => {
  const r = check(at(320), 173)
  assert.notStrictEqual(r.reason, 'bad_args',
    `the exact proposal that was refused is still refused: ${r.detail}`)
})

t('descending from the build limit is admitted at several depths', () => {
  for (const y of [199, 173, 121, 100, 64]) {
    const r = check(at(320), y)
    assert.notStrictEqual(r.reason, 'bad_args',
      `mine y=${y} from y=320 refused as bad_args: ${r.detail}`)
  }
})

t('mine still refuses to go UP — the rule the constant was standing in for', () => {
  // This is what `y > 120` was really trying to prevent, and it is enforced
  // by a rule that reads the bot's own elevation instead of guessing it.
  for (const [from, to] of [[68, 71], [320, 320], [320, 400], [64, 120]]) {
    const r = check(at(from), to)
    assert.strictEqual(r.ok, false,
      `mine from y=${from} to y=${to} is not a descent and was admitted`)
  }
})

t('bedrock is still a floor', () => {
  const r = check(at(64), -80)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'bad_args')
})

t('a normal surface bot is unaffected', () => {
  const r = check(at(72), 12)
  assert.notStrictEqual(r.reason, 'bad_args', `ordinary descent refused: ${r.detail}`)
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
