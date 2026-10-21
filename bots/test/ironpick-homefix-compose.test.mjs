// ironpick-01 x homefix-02 (JIT 10-21b, ironpick-on-d014ec2): the composition of the two changes on the toolkit's outcome.
//
// homefix-01/02 made the runner's declines ONE shared set (declined.mjs) and widened it: runner_reserved, reserve_expired,
// air_rescue. toolkitOutcome refunds every class in it. ironpick-01 added the narrow prefix run (KIT_NARROW, a `more` for the
// backoff, capped by KIT_MORE_MAX) and withdraw_pick's step-aside, which reads the kit's dry-run order.
//
// Composed, behaviour only:
//   - a decline of ANY class in the shared set neither counts toward the narrow streak nor resets it, and backs nothing off;
//   - after a decline the kit's order -- the n=1 pickaxe prefix included -- is issued again at once (the issue-time cooldown
//     is refunded), so withdraw_pick keeps stepping aside for it instead of making the second trip;
//   - through the REAL CognitiveLoop: the toolkit answered air_rescue / reserve_expired keeps its streak; KIT_NARROW counts.
// Each has a positive control, and the streak rule has an anchored mutant seen to fail.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iphf-'))
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iphf-st-'))
process.env.BOT_NAME = 'IpHfBot'
process.env.MEMORY_SCOPE = 'isolated'
process.env.LOG_LEVEL = 'error'
delete process.env.TOOLKIT_IRONPICK       // the default (on) is what ships

const { withMutant } = await import('./helpers/mutant.mjs')
const { RUNNER_DECLINED } = await import('../src/declined.mjs')
const K = await import('../src/toolkit.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const { roomPlan, roomKeep } = await import('../src/withdrawpick.mjs')
const { stack, tool } = await import('./fakeworld.mjs')
const TOOLKIT_PATH = new URL('../src/toolkit.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }
const NOW = 1e9
const HOMEFIX_CLASSES = ['runner_reserved', 'reserve_expired', 'air_rescue']

await t('the shared set carries homefix\'s classes (the precondition of every case below)', () => {
  for (const c of HOMEFIX_CLASSES) assert.ok(RUNNER_DECLINED.has(c), c)
})

await t('EVERY declined class mid-streak: refunded, no backoff, the narrow streak KEPT (neither counted nor reset)', () => {
  for (const c of RUNNER_DECLINED) {
    const s = K.toolkitOutcome('failed', NOW, { lastIssuedAt: NOW, moreStreak: 2 }, c)
    assert.equal(s.lastIssuedAt, -Infinity, `${c}: the issue-time cooldown is refunded`)
    assert.equal(s.backoffUntil, undefined, `${c}: no backoff`)
    assert.equal(s.moreStreak, 2, `${c}: the streak is neither counted nor reset`)
  }
  // CONTROL: the same state answered KIT_NARROW counts, and past KIT_MORE_MAX backs off
  const n = K.toolkitOutcome('failed', NOW, { lastIssuedAt: NOW, moreStreak: 2 }, K.KIT_NARROW)
  assert.equal(n.moreStreak, 3); assert.equal(n.backoffUntil, undefined)
  assert.ok(K.toolkitOutcome('failed', NOW, n, K.KIT_NARROW).backoffUntil > NOW, 'control: the 4th narrow in a row backs off')
})

/** narrow, narrow, air_rescue, narrow, reserve_expired, runner_reserved -> the state; then one more narrow. */
function chain (outcome) {
  let s = { lastIssuedAt: NOW }
  for (const fc of [K.KIT_NARROW, K.KIT_NARROW, 'air_rescue', K.KIT_NARROW, 'reserve_expired', 'runner_reserved']) s = outcome('failed', NOW, s, fc)
  return { before: s, after: outcome('failed', NOW, s, K.KIT_NARROW) }
}
await t('THE CHAIN: three narrows with homefix declines between them -> streak 3, no backoff; the 4th narrow backs off (the cap counts only real runs)', () => {
  const { before, after } = chain(K.toolkitOutcome)
  assert.equal(before.moreStreak, K.KIT_MORE_MAX); assert.equal(before.backoffUntil, undefined)
  assert.ok(after.backoffUntil > NOW, 'the cap is reached on the 4th REAL narrow run')
})
await t('MUTANT KILLED: a decline that resets the streak lets narrow runs go on past the cap', async () => {
  await withMutant(TOOLKIT_PATH, '  if (DECLINED.has(failClass)) { s.lastIssuedAt = -Infinity; return s }',
    '  if (DECLINED.has(failClass)) { s.lastIssuedAt = -Infinity; s.moreStreak = 0; return s }', async mod => {
      const { after } = chain(mod.toolkitOutcome)
      assert.equal(after.backoffUntil, undefined, 'the mutant never reaches the cap')
    })
})

// the prefix scene of ironpick.test.mjs: a stone pickaxe, sticks, a town short of the whole kit's 7 but not of the pickaxe's 3
const items = [T('stone_pickaxe', 100), stack('stick', 9)]
const prefix = { now: NOW, on: true, atTown: true, items, credit: 0, container: true, townMiss: d => d.ingots > 3,
                 room: d => roomPlan(items, K.kitRoomTakes(d), { keep: [...roomKeep([]), 'iron_ingot'] }).ok, tableNear: () => true, state: {} }
await t('AFTER A DECLINE the n=1 prefix order is issued again at once and withdraw_pick keeps stepping aside; control: undeclined, the cooldown holds it', () => {
  const first = K.toolkitOrder(prefix)
  assert.deepEqual(first.order?.args, { credit: 0, n: 1 }, 'the pickaxe prefix is the order')
  const later = NOW + 1000
  // CONTROL: the order was issued and never answered -> its cooldown holds it, and withdraw_pick would take its own turn
  const held = K.toolkitOrder({ ...prefix, now: later, state: first.state })
  assert.equal(held.order, null, 'control: the issue-time cooldown holds the kit')
  assert.equal(K.withdrawDefersToKit('pick', held.order, items), false, 'control: withdraw_pick is not held back by a kit that cannot issue')
  for (const c of HOMEFIX_CLASSES) {
    const refunded = K.toolkitOutcome('failed', later, first.state, c)
    const again = K.toolkitOrder({ ...prefix, now: later, state: refunded })
    assert.deepEqual(again.order?.args, { credit: 0, n: 1 }, `${c}: the same prefix order, at once`)
    assert.equal(K.withdrawDefersToKit('pick', again.order, items), true, `${c}: withdraw_pick still steps aside -- no second trip`)
  }
})

// ---- through the real loop (as homefix-declined.test.mjs) ----------------------------------------------------------------
const loopBot = () => ({
  entity: { position: { x: 0, y: 70, z: 0, distanceTo: () => 0, offset: () => ({}), clone () { return this } }, velocity: { x: 0, y: 0, z: 0 } },
  health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
  inventory: { items: () => [] },
  registry: { blocksByName: { oak_log: { id: 17 } }, itemsByName: {}, blocks: {}, items: {}, biomesArray: [], biomes: {} },
  recipesFor: () => [], recipesAll: () => [], findBlock: () => null, findBlocks: () => [],
  blockAt: () => ({ name: 'air', boundingBox: 'empty' }), setControlState: () => {}, clearControlStates: () => {},
  players: {}, entities: {}, experience: { level: 0 },
})
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(process.env.STATE_DIR, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
async function decideToolkit (result, seed) {
  const ran = []
  const runner = { isBusy: () => false, run: async (s, a) => { ran.push({ s, a }); return { detail: 'probe', ...result } } }
  const loop = new CognitiveLoop(loopBot(), runner, freshLessons(), null)
  loop.toolkitState = { ...seed }
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'toolkit', args: { credit: 0, n: 1 }, reason: 'probe' } }) }
  loop.start(); await new Promise(r => setTimeout(r, 150)); loop.stop()
  return { loop, ran }
}
for (const c of ['air_rescue', 'reserve_expired']) {
  await t(`REAL LOOP toolkit (n=1 prefix) answered ${c}: the narrow streak kept, no backoff; control: KIT_NARROW counts, past the cap backs off`, async () => {
    const d = await decideToolkit({ status: 'failed', failClass: c }, { moreStreak: 2 })
    assert.ok(d.ran.some(r => r.s === 'toolkit'), 'the proposal was admitted and dispatched')
    assert.equal(d.loop.toolkitState.moreStreak, 2, `${c}: the streak kept`)
    assert.ok(!(d.loop.toolkitState.backoffUntil > 0), `${c}: no backoff`)
    const n = await decideToolkit({ status: 'failed', failClass: K.KIT_NARROW }, { moreStreak: 2 })
    assert.equal(n.loop.toolkitState.moreStreak, 3, 'control: the narrow run is counted through the loop')
    const cap = await decideToolkit({ status: 'failed', failClass: K.KIT_NARROW }, { moreStreak: K.KIT_MORE_MAX })
    assert.ok(cap.loop.toolkitState.backoffUntil > 0, 'control: past the cap the loop backs the kit off')
  })
}

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
