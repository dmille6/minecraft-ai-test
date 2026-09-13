// THE ARBITER: one holder, priority preemption with a bounded acknowledgement, stale calls rejected.
import assert from 'node:assert'
import { Arbiter, PRIORITY, ACK_MS, StaleGrant, mayPreempt } from '../src/arbiter.mjs'
let pass = 0, fail = 0
const ta = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

await ta('the body has one holder: a second asker of equal or lower priority is refused, a higher one preempts', async () => {
  const events = []; const arb = new Arbiter({ log: (k, d) => events.push(k) })
  const work = await arb.acquire({ owner: 'gather', priority: PRIORITY.work, context: { kind: 'approach' } })
  assert.ok(work && work.alive); assert.equal(arb.holder.context.kind, 'approach', 'detectors can read the context')
  assert.equal(await arb.acquire({ owner: 'explore', priority: PRIORITY.work }), null, 'equal priority is refused')
  assert.equal(await arb.acquire({ owner: 'idle', priority: PRIORITY.idle }), null)
  let cancelled = false
  work.onCancel = async () => { cancelled = true }
  const air = await arb.acquire({ owner: 'air', priority: PRIORITY.air, context: { kind: 'swim-to-air' } })
  assert.ok(air && air.alive); assert.equal(cancelled, true, 'the holder was asked to cancel'); assert.equal(work.alive, false)
  assert.match(work.revoked, /preempted by air$/, 'acknowledged preemption')
  assert.ok(events.includes('arbiter_preempting') && events.includes('arbiter_revoked') && events.includes('arbiter_granted'))
})
await ta('a holder that never acknowledges is revoked after ACK_MS anyway -- a hung dig cannot hold a drowning bot', async () => {
  const arb = new Arbiter()
  const dig = await arb.acquire({ owner: 'shaft', priority: PRIORITY.escape, onCancel: () => new Promise(() => {}) })   // never settles
  const t0 = Date.now()
  const air = await arb.acquire({ owner: 'air', priority: PRIORITY.air })
  const dt = Date.now() - t0
  assert.ok(air.alive && !dig.alive); assert.ok(dt >= ACK_MS - 20 && dt < ACK_MS + 400, `revoked after ~${ACK_MS} ms, took ${dt}`)
  assert.match(dig.revoked, /without acknowledgement/)
})
await ta('a stale grant cannot act, before or after the call; a released grant is stale; release is idempotent', async () => {
  const arb = new Arbiter()
  const g = await arb.acquire({ owner: 'a', priority: PRIORITY.work })
  assert.equal(await arb.act(g, async () => 42), 42)
  const slow = arb.act(g, async () => { await sleep(120); return 'moved' })     // in flight while preempted
  await sleep(20)
  const h = await arb.acquire({ owner: 'b', priority: PRIORITY.escape, })
  await assert.rejects(slow, e => e instanceof StaleGrant && /in flight/.test(e.message), 'a call that returns after revocation is surfaced, not hidden')
  await assert.rejects(arb.act(g, async () => 'late'), StaleGrant, 'a revoked grant cannot act')
  assert.equal(arb.ok(g), false); assert.equal(arb.ok(h), true)
  arb.release(h); arb.release(h); assert.equal(arb.holder, null); assert.equal(arb.ok(h), false)
  await assert.rejects(arb.act(h, async () => 'after release'), StaleGrant)
})
await ta('the body is free again after release, and mayPreempt is strict', async () => {
  const arb = new Arbiter()
  const a = await arb.acquire({ owner: 'a', priority: PRIORITY.work }); arb.release(a)
  const b = await arb.acquire({ owner: 'b', priority: PRIORITY.idle }); assert.ok(b && b.alive, 'idle may take a free body')
  assert.equal(mayPreempt(PRIORITY.air, PRIORITY.lava), true); assert.equal(mayPreempt(PRIORITY.work, PRIORITY.work), false)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
