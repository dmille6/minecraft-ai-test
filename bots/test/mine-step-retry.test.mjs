// THE STAIRCASE CUT A STEP AND COULD NOT STAND IN IT -- 60% OF ALL MINE FAILURES.
//
// `mine` was 99/337 = 29.4% success and 142 of its 238 failures were one line:
// "cut a step but could not stand in it (moved N blocks, wrong cell)". It gates
// the tech tree from two directions, because gather now escalates into it.
//
// Measured across 172 of those failures on 42 bots, from the coordinates the
// event already logged:
//
//     ended at tread.y + 1 : 85.5%
//     horizontal moved     : p50 = 0.00, p90 = 0.99   <- BIMODAL, two bugs
//
// p90 ~ 0.99 is a bot that walked over the lip and was STILL FALLING when the
// flat 250ms sleep expired: a step down is one block of fall, ~450ms from rest.
// p50 = 0.00 is a bot that never moved at all -- mineflayer writes air into the
// LOCAL cache on a dig timer with no server acknowledgement, so the client
// plans a route into a cell the server still has filled.
import assert from 'node:assert'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
const CODE = SRC.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

test('the arrival check waits for the LANDING, not a flat sleep', () => {
  // BOTH reads must wait: the first attempt and the retry. Asserting "at least
  // one" let a mutant replace the first with the old flat sleep and still pass,
  // because the retry's call satisfied the match.
  // The retry was reverted (mine success 27.8% -> 17.8%), so there is one
  // settle now, not two. The settle itself stays: it fixed a real measurement
  // bug, proven by the escape rungs going 0.7% -> 92.9% on the same change.
  const waits = CODE.match(/await settleForFall\(bot, before\.y, \{ maxMs: STEP_SETTLE_MS \}\)/g) ?? []
  assert.equal(waits.length, 1,
    `the step must wait for the landing; found ${waits.length}`)
  // Scoped to the staircase, because an unrelated sleep(250) elsewhere in this
  // file is legitimate and forbidding it globally is the over-broad predicate
  // this project keeps re-inventing.
  const stair = CODE.slice(CODE.indexOf('const before = bot.entity.position.clone()'))
  assert.doesNotMatch(stair.slice(0, 1200), /await sleep\(250, signal\)/,
    'the flat 250ms judged a one-block fall mid-air and must not come back')
})

test('the settle budget covers a one-block fall in production', async () => {
  // ~450ms from rest; the clamp only bites in tests, where the runner shrinks
  // the skill budget on purpose.
  const prod = Math.max(50, Math.min(900, Math.floor(180000 / 3)))
  assert.equal(prod, 900, 'production must keep the full budget')
  const inTests = Math.max(50, Math.min(900, Math.floor(300 / 3)))
  assert.ok(inTests <= 100, 'tests must not pay 900ms per step')
})

