// The livelock breaker needs PHYSICAL fixation, not just a rejected decision loop (2026-09-13, two Codex passes).
import assert from 'node:assert/strict'
import { livelockFixated, FIXATION } from '../src/cognitive.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const S = (t, x, z, items) => ({ t, x, z, items })
const now = 1_000_000
// six samples over 175 s, 35 s apart: full coverage
const six = (f) => [0, 35, 70, 105, 140, 175].map((sec, i) => { const o = f(i, sec); return S(now - 175_000 + sec * 1000, o.x, o.z, o.items) })
t('stuck and arguing fires (positive control)', () => {
  const r = livelockFixated(six(() => ({ x: 100, z: 100, items: 20 })), { now, rejections: 3 })
  assert.equal(r.fixated, true); assert.equal(r.moved, 0); assert.equal(r.gained, 0); assert.equal(r.coverage, true)
})
t('stuck and silent does not fire (the stagnation watchdog\'s case)', () => {
  assert.equal(livelockFixated(six(() => ({ x: 100, z: 100, items: 20 })), { now, rejections: 1 }).fixated, false)
})
t('a round trip reads as moved, not net zero (path extent)', () => {
  const r = livelockFixated(six(i => ({ x: [100, 120, 140, 140, 120, 100][i], z: 100, items: 20 })), { now, rejections: 3 })
  assert.equal(r.coverage, true); assert.equal(r.moved, 40); assert.equal(r.fixated, false, 'net displacement would have fired')
})
t('gathering then consuming reads as gained (positive deltas only)', () => {
  const r = livelockFixated(six(i => ({ x: 100, z: 100, items: [20, 24, 28, 28, 22, 20][i] })), { now, rejections: 3 })
  assert.equal(r.coverage, true); assert.equal(r.gained, 8); assert.equal(r.fixated, false, 'net inventory would have fired')
})
t('insufficient coverage never fires: few samples, short span, a long gap, or samples before a reconnect', () => {
  const three = six(() => ({ x: 100, z: 100, items: 20 })).slice(0, 3)
  assert.equal(livelockFixated(three, { now: three[2].t, rejections: 3 }).fixated, false)
  const short = [0, 20, 40, 60].map(sec => S(now - 60_000 + sec * 1000, 100, 100, 20))
  assert.equal(livelockFixated(short, { now, rejections: 3 }).reason, 'insufficient coverage')
  const gappy = [S(now - 175_000, 100, 100, 20), S(now - 170_000, 100, 100, 20), S(now - 10_000, 100, 100, 20), S(now, 100, 100, 20)]
  assert.equal(livelockFixated(gappy, { now, rejections: 3 }).coverage, false, 'a 160-s unobserved gap is not coverage')
  const full = six(() => ({ x: 100, z: 100, items: 20 }))
  assert.equal(livelockFixated(full, { now, rejections: 3, reconnectAt: now - 100_000 }).coverage, false, 'samples before the reconnect do not count')
  assert.equal(livelockFixated(full, { now, rejections: 3 }).coverage, true, 'POSITIVE CONTROL: the same samples cover without the reconnect')
})
t('repeat_loop alone is the arguing signal too', () => {
  assert.equal(livelockFixated(six(() => ({ x: 100, z: 100, items: 20 })), { now, rejections: 0, repeatLoop: true }).fixated, true)
})
t('the defaults are the registered ones', () => { assert.deepEqual({ ...FIXATION }, { windowMs: 180_000, minSamples: 4, maxGapMs: 90_000, minSpanMs: 150_000, minMove: 8 }) })
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)

// WIRED (source invariant, comments stripped): the breaker's #escape() is reachable only through livelockFixated.
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
const m = src.match(/const fx = livelockFixated\(this\.fixationSamples, \{[^}]*\}\)\s*if \(!fx\.fixated\) \{[\s\S]{0,700}?\} else if \(!\(this\.livelockLatchedUntil > Date\.now\(\)\)\) await this\.#escape\(\)/g) || []
assert.equal(m.length, 1, `the escape is gated on fixation exactly once: ${m.length}`)
assert.equal((src.match(/await this\.#escape\(\)/g) || []).length, 1, 'no other path calls #escape()')
assert.match(src, /this\.fixationSamples\.push\(\{ t: Date\.now\(\), x: at\.x, z: at\.z, items: /, 'a sample is pushed per tick')
console.log('  PASS  WIRED: #escape() runs only when livelockFixated says fixated, and samples are pushed per tick')
