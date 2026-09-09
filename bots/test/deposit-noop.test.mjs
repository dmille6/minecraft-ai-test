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

test('NOTHING ELIGIBLE is a success, not a failure', () => {
  assert.match(CODE, /if \(eligible === 0\) \{\s*\n\s*return \{ status: 'success'/,
    'a bot with nothing depositable completed its task')
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
  const j = CODE.indexOf('eligible += it.count')
  const k = CODE.indexOf('chest.deposit(it.type')
  assert.ok(i > 0 && j > i, 'eligible must be counted in the loop')
  assert.ok(j < k, 'eligibility must be counted before the deposit attempt on that item')
})

test('and the no-op still says which filter came up empty', () => {
  // "arrived empty" has to stay countable, or the fix just hides the number
  // instead of correcting it.
  assert.match(CODE, /nothing matching \$\{item\} to hand over/)
  assert.match(CODE, /nothing worth banking/)
})
