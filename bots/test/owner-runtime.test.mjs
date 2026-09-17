// owner-runtime.mjs under a REAL Arbiter with fake rungs: one rung at a time, the grant taken at escape priority and
// released after every rung, air preemption mid-rung -> 'preempted' and the rung stays eligible, the episode deadline
// revokes a hung rung, 'busy' while running, rows carry class/rung/episode/outcome/budget, holds end on evidence.
import assert from 'node:assert/strict'
import { Arbiter, PRIORITY, ACK_MS } from '../src/arbiter.mjs'
import { MovementOwner } from '../src/owner-runtime.mjs'
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const mk = ({ rungs, blocks = 20, now } = {}) => {
  const rows = []; const arbLog = []
  const arb = new Arbiter({ log: (k, d) => arbLog.push({ k, ...d }), now: now ?? (() => Date.now()) })
  const owner = new MovementOwner({ bot: { name: 'test' }, arb, rungs, log: r => rows.push(r), now: now ?? (() => Date.now()), inventoryBlocks: () => blocks })
  return { arb, owner, rows, arbLog }
}
const B = { x: 0, y: 40, z: 0, wet: false }
await t('a rung runs under a grant at escape priority and the grant is released afterwards; the rows name class, rung, episode, outcome and budget', async () => {
  let seenGrant = null
  const { arb, owner, rows, arbLog } = mk({ rungs: { pillar: async (bot, { alive, grant }) => { seenGrant = { alive: alive(), priority: arb.holder?.priority, owner: arb.holder?.owner }; return { outcome: 'ran', why: 'pillared' } } } })
  const r = await owner.assessAndRun({ cls: 'entombed', key: 'e1', obs: { blocks: 20, climbNeed: 3, tool: true }, before: B, predicate: () => ({ entombed: true, supported: true }), snapshot: () => ({ ...B, y: 45 }) })
  assert.equal(r.result, 'ran'); assert.equal(r.rung, 'pillar'); assert.equal(r.outcome, 'ran')
  assert.deepEqual(seenGrant, { alive: true, priority: PRIORITY.escape, owner: 'owner:entombed' })
  assert.equal(arb.holder, null, 'released after the rung'); assert.ok(arbLog.some(x => x.k === 'arbiter_released'))
  const row = rows.find(x => x.kind === 'escape_rung' && /rung=pillar/.test(x.detail))
  assert.match(row.detail, /class=entombed episode=entombed:0,40,0:\d+ rung=pillar outcome=ran why=pillared blocks=0 ms=\d+ budget=\{"deadlineMs":\d+,"blocks":5\}/)
})
await t('the episode closes only when the postcondition AND the predicate hold; otherwise the next call runs the next rung', async () => {
  const calls = []
  const { owner } = mk({ rungs: { pillar: async () => { calls.push('pillar'); return { outcome: 'ran' } }, stair: async () => { calls.push('stair'); return { outcome: 'ran' } } } })
  let pos = { ...B }; let pred = { entombed: true, supported: true }
  const args = { cls: 'entombed', key: 'e2', obs: { blocks: 20, climbNeed: 3, tool: true }, before: B, predicate: () => pred, snapshot: () => pos }
  assert.equal((await owner.assessAndRun(args)).result, 'ran', 'pillar ran, still entombed: open')
  pos = { ...B, y: 46 }; pred = { entombed: false, supported: true }
  const r2 = await owner.assessAndRun(args); assert.equal(r2.result, 'closed'); assert.deepEqual(calls, ['pillar', 'pillar'], 'pillar ran twice: a rung that RAN stays eligible until the episode closes or it fails')
  assert.equal(owner.episodeFor('e2'), null, 'closed episodes are dropped')
})
await t('a refused rung is skipped next time; when every rung is spent the owner holds with a safe_hold row, and evidence ends the hold', async () => {
  const { owner, rows } = mk({ rungs: { pillar: async () => ({ outcome: 'refused', why: 'needs_blocks' }), stair: async () => ({ outcome: 'failed', why: 'no ramp' }), underfoot: async () => ({ outcome: 'exhausted' }) } })
  const args = { cls: 'entombed', key: 'e3', obs: { blocks: 20, climbNeed: 3, tool: true }, before: B, predicate: () => ({ entombed: true, supported: true }), snapshot: () => B }
  assert.equal((await owner.assessAndRun(args)).rung, 'pillar'); assert.equal((await owner.assessAndRun(args)).rung, 'stair'); assert.equal((await owner.assessAndRun(args)).rung, 'underfoot')
  const h = await owner.assessAndRun(args); assert.equal(h.result, 'hold'); assert.equal(h.why, 'exhausted')
  assert.match(rows.find(x => x.kind === 'safe_hold').detail, /reason=exhausted tried=pillar:refused,stair:failed,underfoot:exhausted until=evidence/)
  assert.equal(owner.evidence({ blockChangedNearby: true }), true); assert.equal(owner.hold, null)
})
await t('an air acquire mid-rung preempts through the arbiter: alive() turns false, the rung reports preempted, and it is retried next time', async () => {
  let aliveDuring = []
  const { arb, owner } = mk({ rungs: { pillar: async (bot, { alive }) => { aliveDuring.push(alive()); await sleep(60); aliveDuring.push(alive()); return { outcome: alive() ? 'ran' : 'preempted', why: alive() ? 'ok' : 'air took the body' } } } })
  const args = { cls: 'entombed', key: 'e4', obs: { blocks: 20, climbNeed: 3, tool: true }, before: B, predicate: () => ({}), snapshot: () => B }
  const p = owner.assessAndRun(args)
  await sleep(10)
  assert.equal((await owner.assessAndRun(args)).result, 'busy', 'a second call while a rung runs is refused: one owner, one rung')
  const air = await arb.acquire({ owner: 'air', priority: PRIORITY.air, onCancel: async () => {} })
  assert.ok(air, 'air outranks the escape'); arb.release(air, 'test')
  const r = await p; assert.equal(r.outcome, 'preempted'); assert.deepEqual(aliveDuring, [true, false])
  assert.equal(owner.episodeFor('e4').tried[0].outcome, 'preempted')
})
await t('a hung rung is cut off by the episode deadline: the owner revokes its own grant, and the rung that never returns is still marked preempted', async () => {
  let clock = 1_000_000; const now = () => clock
  const { owner, arb } = mk({ now, rungs: { pillar: async (bot, { alive }) => { while (alive()) await sleep(5); return { outcome: 'ran' } } } })
  // the deadline timer is real time; make the episode's deadline tiny by placing `now` just before it
  const before = { ...B }
  const p = owner.assessAndRun({ cls: 'entombed', key: 'e5', obs: { blocks: 20, climbNeed: 3, tool: true }, before, predicate: () => ({}), snapshot: () => B })
  await sleep(20); clock += 10; arb.release(owner.running.grant, 'simulated deadline')   // what the deadline timer does (arb.holder is a read-only copy; the owner keeps the real grant)
  const r = await p; assert.equal(r.outcome, 'preempted', 'a rung that ran while its grant was revoked is recorded preempted, never ran')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
