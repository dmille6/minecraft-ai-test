// The shared in-flight click tracker (src/inflight.mjs): withdraw and the grid fix both rely on it, so its contract is
// tested here on its own -- a click counts until it SETTLES (resolve or reject), never until someone stops waiting.
import assert from 'node:assert/strict'
import { inflightTracker } from '../src/inflight.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b }); return { p, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))

await t('a tracked click counts until it resolves; track returns the same promise', async () => {
  const tr = inflightTracker(), d = deferred()
  assert.equal(tr.track(d.p), d.p)
  assert.equal(tr.size, 1)
  d.resolve('ok'); await tick()
  assert.equal(tr.size, 0)
})

await t('a REJECTED click leaves too (and the tracker does not swallow the caller\'s rejection)', async () => {
  const tr = inflightTracker(), d = deferred()
  const p = tr.track(d.p)
  d.reject(new Error('boom'))
  await assert.rejects(p, /boom/)
  await tick()
  assert.equal(tr.size, 0)
})

await t('waitSettled: false at the bound while a click is pending, true once it settles; cancellation ends it early', async () => {
  const tr = inflightTracker(), d = deferred()
  tr.track(d.p)
  const t0 = Date.now()
  assert.equal(await tr.waitSettled(80, () => false, 10), false)
  assert.ok(Date.now() - t0 >= 75, 'it waited out the bound')
  assert.equal(await tr.waitSettled(5_000, () => true, 10), false, 'cancelled')
  setTimeout(() => d.resolve(), 50)
  assert.equal(await tr.waitSettled(2_000, () => false, 10), true)
  assert.equal(await inflightTracker().waitSettled(0), true, 'nothing in flight: true at once')
})

await t('settled() waits for every click registered so far, rejections included', async () => {
  const tr = inflightTracker(), a = deferred(), b = deferred()
  tr.track(a.p); tr.track(b.p).catch(() => {})
  let done = false
  const s = tr.settled().then(() => { done = true })
  a.resolve(); await tick()
  assert.equal(done, false)
  b.reject(new Error('x')); await s
  assert.equal(done, true)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
