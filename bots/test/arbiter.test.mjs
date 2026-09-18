// THE ARBITER: one holder, priority preemption with a bounded acknowledgement, stale calls rejected.
import assert from 'node:assert'
import { Arbiter, PRIORITY, ACK_MS, StaleGrant, mayPreempt } from '../src/arbiter.mjs'
const tick = (bot, fn) => { let r; bot._onTick = () => { r = fn() }; bot.emit('physicsTick'); bot._onTick = null; return r }   // what mineflayer-pathfinder's physicsTick listener does: the gate attributes it to the bound grant
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

await ta('two concurrent preemptions of one holder rank against each other: escape cannot overwrite air', async () => {
  const arb = new Arbiter()
  const work = await arb.acquire({ owner: 'gather', priority: PRIORITY.work, onCancel: () => sleep(50) })
  const [air, esc] = await Promise.all([
    arb.acquire({ owner: 'air', priority: PRIORITY.air }),
    arb.acquire({ owner: 'entombed', priority: PRIORITY.escape }),
  ])
  assert.ok(air && air.alive, 'air holds the body'); assert.equal(esc, null, 'escape was refused after re-checking the new holder')
  assert.equal(arb.holder.owner, 'air'); assert.equal(work.alive, false)
})
await ta('a rejected actuator call still surfaces a lost ownership, with the original error as the cause', async () => {
  const arb = new Arbiter()
  const g = await arb.acquire({ owner: 'a', priority: PRIORITY.work })
  const failing = arb.act(g, async () => { await sleep(80); throw new Error('dig aborted') })
  await sleep(10); await arb.acquire({ owner: 'air', priority: PRIORITY.air })
  await assert.rejects(failing, e => e instanceof StaleGrant && e.cause?.message === 'dig aborted')
})
await ta('a forced revocation runs the independent actuator stop without awaiting the hung holder', async () => {
  const stops = []; const arb = new Arbiter({ stopActuators: (h, acked) => stops.push([h.owner, acked]) })
  await arb.acquire({ owner: 'hung', priority: PRIORITY.work, onCancel: () => new Promise(() => {}) })
  await arb.acquire({ owner: 'air', priority: PRIORITY.air })
  assert.deepEqual(stops, [['hung', false]], 'the stop ran once, for the hung holder, marked unacknowledged')
})


await ta('the actuator gate: the holder may act from inside its async context across awaits; a stranger and an unrouted caller may not while the body is held; anyone may while it is free', async () => {
  const refused = []; const arb = new Arbiter()
  const calls = []; const bot = { emit (ev) { if (ev === 'physicsTick') this._onTick?.() }, dig: async b => { calls.push(['dig', b]); return 'dug' }, placeBlock: async () => 'placed', setControlState: (k, v) => calls.push(['ctl', k, v]), look: async () => calls.push(['look']),
    pathfinder: { goto: async g => { calls.push(['goto', g]); return 'went' }, setGoal: g => calls.push(['setGoal', g]) } }
  arb.installActuatorGate(bot, { onRefuse: (n, c, h) => refused.push([n, c?.owner ?? null, h?.owner]) })
  assert.equal(await bot.dig('free'), 'dug', 'a free body: an unrouted call is allowed')
  const g = await arb.acquire({ owner: 'gather', priority: PRIORITY.work })
  await assert.rejects(bot.dig('stranger'), StaleGrant, 'held: an unrouted call is refused')
  bot.setControlState('forward', true); assert.ok(!calls.some(c => c[0] === 'ctl'), 'held, no goto bound: an unrouted control state is dropped silently')
  assert.equal(await bot.look(1, 2), undefined); assert.ok(!calls.some(c => c[0] === 'look'), 'held: an unrouted look resolves to nothing (never rejects: the pathfinder does not await it)')
  const out = await arb.within(g, async () => { await sleep(5); const a = await bot.dig('mine'); await sleep(5); const b = await bot.pathfinder.goto('goal'); return [a, b] })
  assert.deepEqual(out, ['dug', 'went'], 'the holder acts across awaits inside its context')
  assert.equal(arb.bound, g, 'the holder\'s goto bound the pathfinder tick to its grant')
  tick(bot, () => bot.setControlState('forward', true)); assert.ok(calls.some(c => c[0] === 'ctl'), 'the bound tick (from inside a physicsTick emission) may drive control states for the holder')
  await tick(bot, () => bot.look(1, 2)); assert.ok(calls.some(c => c[0] === 'look'), 'and look')
  calls.length = 0; bot.setControlState('forward', true); assert.ok(!calls.some(c => c[0] === 'ctl'), 'a bare contextless call while held and bound is NOT the tick and is refused (owner pass 1 §2)')
  const h = await arb.acquire({ owner: 'air', priority: PRIORITY.air })   // preempts gather
  assert.equal(arb.bound, null, 'revocation unbinds the tick'); assert.deepEqual(calls.at(-1), ['setGoal', null], 'the raw stop cleared the goal')
  calls.length = 0; bot.setControlState('forward', true); assert.deepEqual(calls, [], 'a tick that outlives its grant is refused while the successor holds')
  await assert.rejects(arb.within(g, () => bot.dig('late')), StaleGrant, 'the revoked holder cannot act from its own context')
  assert.equal(await arb.within(h, () => bot.placeBlock()), 'placed')
  assert.ok(refused.length >= 4 && refused.every(r => r[2] === 'gather' || r[2] === 'air'), `refusals name the holder: ${JSON.stringify(refused)}`)
  assert.equal(bot.dig.__arbiterGated, true); assert.equal(bot.pathfinder.goto.__arbiterGated, true); assert.equal(bot.setControlState.__arbiterGated, true); assert.equal(bot.look.__arbiterGated, true)
})
await ta('the gate after Codex passes 1 and 2: a released context never resumes on a free body; every stop is gated; the arbiter stop is the only raw bypass and is scoped', async () => {
  const arb = new Arbiter(); const calls = []
  const bot = { emit (ev) { if (ev === 'physicsTick') this._onTick?.() }, dig: async b => { calls.push(['dig', b]); return 'dug' }, placeBlock: async () => 'placed', setControlState: () => {}, clearControlStates: () => calls.push(['clear']),
    stopDigging: () => calls.push(['stopDigging']), targetDigBlock: { x: 1 }, pathfinder: { goto: async () => 'went', setGoal: g => calls.push(['setGoal', g]), stop: () => calls.push(['pfstop']) } }
  arb.installActuatorGate(bot)
  const g = await arb.acquire({ owner: 'gather' })
  arb.release(g, 'done')
  await assert.rejects(arb.within(g, () => bot.dig('after release')), StaleGrant, 'a released context is refused even though the body is free')
  await assert.rejects(arb.within(g, () => bot.pathfinder.goto('x')), StaleGrant)
  assert.equal(await bot.dig('unrouted'), 'dug', 'an unrouted call on the free body is still allowed')
  const h = await arb.acquire({ owner: 'air', priority: PRIORITY.air })
  calls.length = 0
  bot.pathfinder.setGoal(null); bot.stopDigging(); bot.clearControlStates(); bot.pathfinder.stop()
  assert.deepEqual(calls, [], 'stale or unrouted stops cannot halt the holder (Codex, pass 2)')
  await arb.within(h, async () => { bot.pathfinder.setGoal({ goal: 1 }); assert.equal(arb.bound, h, 'the holder\'s setGoal(goal) binds the tick'); bot.pathfinder.setGoal(null); assert.equal(arb.bound, null, 'and its setGoal(null) unbinds'); bot.clearControlStates() })
  assert.deepEqual(calls, [['setGoal', { goal: 1 }], ['setGoal', null], ['clear']], 'the holder\'s own stops go through')
  // the bound tick may start the next leg or stop its own goal WITHOUT changing the binding (corpus run 4)
  await arb.within(h, () => bot.pathfinder.setGoal({ goal: 2 })); assert.equal(arb.bound, h)
  tick(bot, () => bot.pathfinder.setGoal({ goal: 3 })); assert.equal(arb.bound, h, 'a setGoal(goal) from the bound tick keeps the binding')
  assert.deepEqual(calls.at(-1), ['setGoal', { goal: 3 }], 'and went through')
  tick(bot, () => bot.pathfinder.setGoal(null)); assert.equal(arb.bound, h, 'a setGoal(null) from the bound tick keeps the binding too')
  assert.equal(bot.pathfinder.setGoal.__arbiterGated, true); assert.equal(bot.stopDigging.__arbiterGated, true); assert.equal(bot.clearControlStates.__arbiterGated, true)
  // the scoped stop: stopping a grant that no longer holds the body releases it without touching the successor's actuators
  calls.length = 0
  arb.stop(g, 'hard stop of a stale grant')
  assert.deepEqual(calls, [], 'a stale grant\'s stop does not clear the successor\'s goal or controls')
  assert.equal(arb.holder?.owner, 'air')
  // releasing a grant whose goto is still bound stops the pathfinder through the raw functions (corpus run 6)
  await arb.within(h, () => bot.pathfinder.goto('x')); assert.equal(arb.bound, h); calls.length = 0
  arb.release(h, 'done'); assert.deepEqual(calls, [['setGoal', null], ['stopDigging'], ['clear']], 'a bound grant\'s release stops its path'); assert.equal(arb.bound, null)
  const h2 = await arb.acquire({ owner: 'air', priority: PRIORITY.air }); calls.length = 0
  arb.stop(h2, 'hard stop of the holder')
  assert.deepEqual(calls, [['setGoal', null], ['stopDigging'], ['clear']], 'the holder\'s stop halts goal, dig and controls through the raw functions')
  assert.equal(arb.holder, null)
})
await ta('mayAct is the whole decision', async () => {
  const g = { alive: true }
  assert.equal(Arbiter.mayAct(null, null), true); assert.equal(Arbiter.mayAct(null, g), false)
  assert.equal(Arbiter.mayAct(g, g), true); assert.equal(Arbiter.mayAct({ alive: true }, g), false); assert.equal(Arbiter.mayAct({ ...g, alive: false }, g), false)
  assert.equal(Arbiter.mayAct({ alive: false }, null), false, 'a revoked context does not resume on a free body')
  assert.equal(Arbiter.mayAct({ alive: true }, null), false, 'a live-looking context that is not the holder does not act on a free body either')
  assert.equal(Arbiter.mayAct(null, g, g, true), true, 'the pathfinder tick (attributed by the gate) is admitted as the bound live holder')
  assert.equal(Arbiter.mayAct(null, g, g, false), false, 'any OTHER contextless call while held is refused, even with the pathfinder bound (owner pass 1 §2)')
  assert.equal(Arbiter.mayAct(null, g, { alive: true }), false, 'but not when the tick is bound to someone else')
  assert.equal(Arbiter.mayAct(null, { alive: false }, { alive: false }), false)
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
