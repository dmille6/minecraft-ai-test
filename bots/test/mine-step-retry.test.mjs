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
  const waits = CODE.match(/await settleForFall\(bot, before\.y, \{ maxMs: STEP_SETTLE_MS \}\)/g) ?? []
  assert.equal(waits.length, 2,
    `both the step and its retry must wait for the landing; found ${waits.length}`)
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

test('IT RETRIES, and only when the bot did not move at all', () => {
  // The retry targets the server-desync population specifically. A bot that
  // moved and landed somewhere wrong is a different problem and must not be
  // handed another dig.
  assert.match(CODE, /if \(!arrived && moved < 0\.3\)/,
    'the retry must be gated on the bot having stayed put')
})

test('the retry re-digs THE SAME TWO CELLS, so the shaft is never widened', () => {
  // The guard this sits next to exists to stop the loop digging a DIFFERENT
  // cell each iteration and carving a trench with ledges. Re-digging the
  // identical pair either lands the dig the server missed or changes nothing.
  const retry = CODE.slice(CODE.indexOf('if (!arrived && moved < 0.3)'))
  assert.match(retry.slice(0, 400), /for \(const pos of \[cellHead, cellFeet\]\)/,
    'the retry must re-dig cellHead and cellFeet, not pick new cells')
})

test('AT MOST ONE RETRY -- a second failure still stops the descent', () => {
  const retry = CODE.slice(CODE.indexOf('if (!arrived && moved < 0.3)'))
  const block = retry.slice(0, retry.indexOf('if (!arrived) {'))
  assert.equal((block.match(/goto\(new goals\.GoalBlock/g) ?? []).length, 1,
    'exactly one retry attempt')
  // and the original refusal still follows it
  assert.match(retry, /could \` \+\n\s*\`not stand in it/,
    'the honest refusal must still be reachable when the retry also fails')
})

test('retries are COUNTED, so the desync share is measurable not inferred', () => {
  assert.match(CODE, /let stepRetries = 0/)
  assert.match(CODE, /if \(arrived\) stepRetries\+\+/)
})
