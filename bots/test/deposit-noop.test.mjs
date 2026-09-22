// ARRIVING WITH NOTHING TO DEPOSIT IS NOT A FAILURE.
//
// `deposit` returned `failed` whether the bot had nothing eligible or the chest
// refused everything, under one message naming both causes. Measured over 3h:
// 248 runs at 7.3% success, and 47% of the failures were that single string --
// a rate that is partly fiction, because a bot that arrives carrying nothing
// depositable did exactly what was asked of it.
//
// The two cases need different remedies: nothing to hand over needs no action
// at all, a full chest needs a different chest. Counting them together hid both.
import assert from 'node:assert'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
const CODE = SRC.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

test('POSITIVE CONTROL: the deposit tail is where we think it is', () => {
  assert.match(CODE, /let eligible = 0/, 'the eligibility count must exist')
  assert.match(CODE, /if \(moved > 0\) return \{ status: 'success'/)
})

test('NOTHING ELIGIBLE is no_effect -- neither a success nor a failure', () => {
  // It was briefly `success`, and that made the number WORSE: deposit's contract
  // expects inventory_loss and the evidence gate downgrades a success that
  // produces none, so the rate fell 7.3% -> 1.1%. `no_effect` is the status this
  // codebase already carries for exactly this case.
  assert.match(CODE, /if \(eligible === 0\) \{[\s\S]{0,700}?return \{ status: 'no_effect'/,
    'a bot with nothing depositable neither achieved nor failed anything')
  assert.doesNotMatch(CODE, /if \(eligible === 0\) \{[\s\S]{0,700}?return \{ status: 'success'/,
    'claiming success against a contract that expects inventory_loss is downgraded anyway')
})

test('ELIGIBLE BUT NONE MOVED is still a failure, and a DIFFERENT one', () => {
  // A full chest is a real environmental problem whose remedy is another chest,
  // not another attempt. It must not be folded into the no-op.
  assert.match(CODE, /failClass: 'storage_full'/)
  assert.doesNotMatch(CODE, /nothing matching to hand over, or the chest was full/,
    'the conflated message named both causes and distinguished neither')
})

test('the counting happens BEFORE the transfer, or it cannot separate them', () => {
  const i = CODE.indexOf('let eligible = 0')
  const j = CODE.indexOf('eligible += n')   // the loop hands over the depositPlan (2026-09-13)
  const k = CODE.indexOf('chest.deposit(it.type, null, n)')
  assert.ok(i > 0 && j > i, 'eligible must be counted in the loop')
  assert.ok(j < k, 'eligibility must be counted before the deposit attempt on that item')
})

test('and the no-op still says which filter came up empty', () => {
  // "arrived empty" has to stay countable, or the fix just hides the number
  // instead of correcting it.
  //
  // 2026-09-22: the two sentences moved into `depositNoopDetail`, a pure exported
  // function, because a message built inline is one no mutant can kill -- a review pass
  // reverted the whole held-count fix by flipping a ternary and every grep still passed.
  // The wording is now asserted by BEHAVIOUR in deposit-truth.test.mjs; what is checked
  // here is that the skill still routes through that function and did not grow a second
  // copy of the sentence.
  assert.match(CODE, /detail: depositNoopDetail\(item,/)
  assert.doesNotMatch(CODE, /detail: item\s*\n?\s*\?/,
    'the skill must not rebuild the sentence inline alongside the extracted one')
})
