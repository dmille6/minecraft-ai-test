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

// ---- window binding and invalidation (round 5): the write hook's decision, tested on its own
await t('admit: a packet written outside a dispatch is not judged; inside one, its window must be the bound one', () => {
  const tr = inflightTracker()
  assert.deepEqual(tr.admit({ windowId: 7 }), { ok: true }, 'no current ticket: not ours to judge')
  const tk = tr.bind({ windowId: 1, slot: 37, button: 0, mode: 0 })
  assert.equal(tr.dispatch(tk, () => tr.admit({ windowId: 1 }).ok), true, 'same window: sent')
  const v = tr.dispatch(tk, () => tr.admit({ windowId: 0 }))
  assert.equal(v.ok, false); assert.match(v.why, /bound to window 1, written to window 0/)
  assert.equal(tk.dropped, v.why, 'the refusal is recorded on the ticket')
  assert.equal(tr.current, null, 'dispatch restores the current ticket')
})

await t('invalidate: tickets issued before it are dropped at their send; tickets issued after it are not', () => {
  const tr = inflightTracker()
  const old = tr.bind({ windowId: 1 })
  const e0 = tr.epoch
  tr.track(new Promise(() => {}), old)
  assert.equal(tr.invalidate('release'), 1, 'one live ticket touched')
  assert.match(tr.dispatch(old, () => tr.admit({ windowId: 1 })).why, /invalidated \(release\)/)
  const late = tr.bind({ windowId: 1, epoch: e0 })   // decided before the invalidation, bound after it
  assert.equal(tr.dispatch(late, () => tr.admit({ windowId: 1 })).ok, false, 'the epoch at the decision counts')
  const fresh = tr.bind({ windowId: 1 })
  assert.equal(tr.dispatch(fresh, () => tr.admit({ windowId: 1 })).ok, true, 'a click issued after it goes out')
})

await t('a ticket leaves the live set when its tracked click settles; dispatch passes fn\'s result and throw through', async () => {
  const tr = inflightTracker(), d = deferred()
  const tk = tr.bind({ windowId: 0 })
  tr.track(d.p, tk)
  assert.equal(tr.live, 1)
  d.resolve(); await tick()
  assert.equal(tr.live, 0)
  assert.equal(tr.dispatch(tk, () => 42), 42)
  assert.throws(() => tr.dispatch(tk, () => { throw new Error('x') }), /x/)
  assert.equal(tr.current, null, 'restored after a throw')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
