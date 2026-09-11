// DEPOSIT OPENED A CHEST FROM WHEREVER IT STOOD.
//
// Measured 2026-09-11, 3 h, full walk of /var/log/mcai: 285 deposit runs, 29
// `Event windowOpen did not fire within timeout of 20000ms` on 7 bots (one at
// y=-25 hit it five times running), 34 "No path to the goal!", 21 "goal was
// changed", 9 think timeouts. 97 of 285 runs lost in the walk or the open. The
// walk was a bare goto() -- its rejections surfaced as skill_error -- and
// openContainer() was called with no reach test, so a walk that fell short
// asked the server for a window it never opens. craft fixed this shape on its
// own line (STATION_REACH); withdraw had the timeout but not the reach test.
import assert from 'node:assert'
import { Vec3 } from 'vec3'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { SKILLS, STATION_REACH } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const V = (x, y, z) => new Vec3(x, y, z)

// A chest 12 blocks away and a walk that never moves: the fleet's stall shape.
function bot ({ arrives, items = [{ type: 5, name: 'oak_log', count: 12 }], openNever = false, openLateMs = 0 }) {
  const chest = { position: V(12, 64, 0), type: 1 }
  const seen = { opened: 0, gotos: 0 }
  const b = {
    entity: { position: V(0, 64, 0), onGround: true, velocity: V(0, 0, 0) },
    health: 20, food: 20, version: '1.21.8',
    registry: { blocks: { 1: { name: 'chest' } }, blocksByName: {}, itemsByName: {} },
    inventory: { items: () => items },
    findBlock: () => chest,
    blockAt: () => ({ name: 'grass_block', boundingBox: 'block' }),
    lookAt: async () => {},
    pathfinder: {
      movements: {}, setMovements () {}, setGoal () {}, stop () {},
      goto: async () => { seen.gotos++; if (arrives) b.entity.position = V(11, 64, 0) },
    },
    openContainer: async () => {
      seen.opened++
      if (openNever) { b.currentWindow = { id: 7 }; return new Promise(() => {}) }   // the server never answers; a half-open window is left behind
      if (openLateMs) {
        // The server answers AFTER the budget: the window arrives behind the
        // next skill's back. It must be closed as it arrives.
        return new Promise(res => setTimeout(() => {
          const w = { id: 9, close: () => { seen.lateClosed = true; b.currentWindow = null } }
          b.currentWindow = w; res(w)
        }, openLateMs))
      }
      return { deposit: async () => {}, withdraw: async () => {}, containerItems: () => [{ type: 5, name: 'oak_log', count: 4 }], close: () => {} }
    },
    closeWindow: () => { seen.closed = true },
    on () {}, off () {}, once () {}, removeListener () {}, waitForTicks: async () => {}, chat () {},
  }
  return { b, seen }
}
const sig = () => new AbortController().signal

await t('deposit: a walk that falls short does NOT open the chest, and says where the chest is', async () => {
  const { b, seen } = bot({ arrives: false })
  const r = await SKILLS.deposit.run({ bot: b }, {}, sig())
  assert.equal(seen.opened, 0, 'openContainer from out of reach is the 20 s stall')
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'no_path')
  assert.match(r.detail, /1[23] blocks away/); assert.match(r.detail, /move to 12,0 first/)
  assert.ok(seen.gotos >= 1, 'the walk was attempted; a walk that resolves without arriving is caught by the reach test, not retried forever')
})

await t('deposit: in reach, the chest is opened exactly once', async () => {
  const { b, seen } = bot({ arrives: true })
  const r = await SKILLS.deposit.run({ bot: b }, {}, sig())
  assert.equal(seen.opened, 1); assert.equal(r.status, 'success', r.detail)
})

await t('withdraw: the same reach test, the same remedy', async () => {
  const { b, seen } = bot({ arrives: false })
  const r = await SKILLS.withdraw.run({ bot: b }, {}, sig())
  assert.equal(seen.opened, 0); assert.equal(r.failClass, 'no_path'); assert.match(r.detail, /move to 12,0 first/)
  const ok = bot({ arrives: true })
  const r2 = await SKILLS.withdraw.run({ bot: ok.b }, {}, sig())
  assert.equal(ok.seen.opened, 1); assert.notEqual(r2.failClass, 'no_path')
})

await t('a window that never opens is bounded, named, and closed -- not a 20 s stall', async () => {
  const { b, seen } = bot({ arrives: true, openNever: true })
  const t0 = Date.now()
  // OPEN_CONTAINER_MS is 8 s in production; the suite budget is short, so the
  // proof here is that the bound EXISTS and is ours, not mineflayer's 20 s.
  const r = await SKILLS.deposit.run({ bot: b }, {}, sig())
  const ms = Date.now() - t0
  assert.ok(ms < 15000, `took ${ms} ms: mineflayer's 20 s timeout was the bound, not ours`)
  assert.equal(r.status, 'failed', JSON.stringify(r))
  assert.equal(r.failClass, 'container_open_budget', 'a budget expiry keeps its own class: no_path teaches learned_avoid')
  assert.match(r.detail, /could not open the chest at 12,0 — container_open exceeded/, r.detail)
  assert.equal(seen.closed, true, 'the half-open window is closed on timeout')
})

await t('a window that arrives AFTER the budget is closed as it arrives', async () => {
  const { OPEN_CONTAINER_MS } = await import('../src/skills.mjs')
  const { b, seen } = bot({ arrives: true, openLateMs: OPEN_CONTAINER_MS + 400 })
  const r = await SKILLS.deposit.run({ bot: b }, {}, sig())
  assert.equal(r.failClass, 'container_open_budget')
  await new Promise(res => setTimeout(res, 900))
  assert.equal(seen.lateClosed, true, 'the late window must be closed, or the next skill clicks into it')
  assert.equal(b.currentWindow, null)
})

await t('the reach test is the server\'s own number', () => {
  assert.equal(STATION_REACH, 4.5)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
