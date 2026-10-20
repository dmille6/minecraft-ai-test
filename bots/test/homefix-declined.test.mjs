// homefix-01, the refusal chain (docs/reports/expansion-plan-2026-10-19.md §2 "The H2 fix" item 2, §5 "Refusal chain"):
// `runner_reserved` is a "not now" to every caller except the reserving watchdog. It is in the ONE exported declined set
// (declined.mjs) that every outcome handler imports, so nothing counts it as a failure, a cooldown, a latch or a lesson.
//
// Driven through the REAL CognitiveLoop: a proposal is admitted, the runner answers `runner_reserved`, and each named
// handler, the admission gate's failure memory, the lessons store and the livelock breaker are read afterwards. Each has
// a positive control (the same decision answered `skill_error` / `no_path` DOES back off, cool down, latch) and the
// guards have mutants seen to fail.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homefix-decl-'))
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homefix-decl-st-'))
process.env.BOT_NAME = 'DeclineBot'
process.env.MEMORY_SCOPE = 'isolated'
process.env.LOG_LEVEL = 'error'

const { withMutant } = await import('./helpers/mutant.mjs')
const { RUNNER_DECLINED, runnerDeclined } = await import('../src/declined.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop, livelockNext } = await import('../src/cognitive.mjs')
const composter = await import('../src/composter.mjs')
const towndeposit = await import('../src/towndeposit.mjs')
const milestones = await import('../src/milestones.mjs')
const { toolkitOutcome } = await import('../src/toolkit.mjs')
const { recountOutcome } = await import('../src/recount.mjs')
const { roomOutcome } = await import('../src/workorder.mjs')
const COG_PATH = new URL('../src/cognitive.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}

// ---- the one set ----------------------------------------------------------------------------------------------------
await t('ONE SET: composter, towndeposit and well read THE shared Set; milestones extends it; runner_reserved is in it', async () => {
  assert.ok(RUNNER_DECLINED.has('runner_reserved'))
  for (const c of ['runner_paused', 'runner_busy', 'body_held', 'reserve_expired']) assert.ok(RUNNER_DECLINED.has(c), c)
  assert.equal(composter.RUNNER_DECLINED, RUNNER_DECLINED, 'composter re-exports the shared object, not a copy')
  assert.equal(towndeposit.TD_RUNNER_DECLINED, RUNNER_DECLINED)
  for (const c of RUNNER_DECLINED) assert.ok(milestones.RUNNER_REFUSALS.has(c), `RUNNER_REFUSALS extends the set: ${c}`)
  for (const c of ['unknown_skill', 'superseded', 'furnace_busy']) assert.ok(milestones.RUNNER_REFUSALS.has(c), c)
  assert.equal(runnerDeclined({ failClass: 'runner_reserved' }), true)
  assert.equal(runnerDeclined({ failClass: 'skill_error' }), false)
  assert.equal(runnerDeclined(null), false)
})

await t('the private sets (toolkit, recount) and the town deposit treat runner_reserved as a decline: refunded, not backed off', async () => {
  assert.equal(toolkitOutcome('failed', 1000, {}, 'runner_reserved').backoffUntil, undefined)
  assert.equal(toolkitOutcome('failed', 1000, {}, 'runner_reserved').lastIssuedAt, -Infinity)
  assert.ok(toolkitOutcome('failed', 1000, {}, 'skill_error').backoffUntil > 1000, 'control')
  assert.equal(recountOutcome('failed', 0, 1000, {}, 'runner_reserved').backoffUntil, undefined)
  assert.equal(towndeposit.townDepositOutcome('failed', 'runner_reserved', 1000, { latched: true }).latched, false)
  assert.equal(towndeposit.townDepositOutcome('failed', 'runner_reserved', 1000, {}).backoffUntil, undefined)
  assert.equal(composter.townOrderOutcome('compost', 'failed', 1000, {}, 'runner_reserved').compostBackoffUntil, undefined)
})

await t('roomOutcome: a declined remedy is `declined`, not backed off; control: a failed one backs off', async () => {
  const state = { pending: { kind: 'home', slots: 36 }, backoff: {} }
  const d = roomOutcome({ status: 'failed', failClass: 'runner_reserved', slotsAfter: 36, now: 1000, state })
  assert.equal(d.verdict, 'declined'); assert.ok(!(d.state.backoff.home > 0))
  const c = roomOutcome({ status: 'failed', failClass: 'skill_error', slotsAfter: 36, now: 1000, state })
  assert.equal(c.verdict, 'backoff'); assert.ok(c.state.backoff.home > 1000)
})

await t('livelockNext: a declined rung is `retry` -- never `dig`, never `latch`; escaped still wins', async () => {
  assert.equal(livelockNext({ rung: 'walk', escaped: false, declined: true }), 'retry')
  assert.equal(livelockNext({ rung: 'dig', escaped: false, declined: true }), 'retry')
  assert.equal(livelockNext({ rung: 'walk', escaped: true, declined: true }), 'done')
  assert.equal(livelockNext({ rung: 'walk', escaped: false }), 'dig')
})

// ---- through the real loop --------------------------------------------------------------------------------------------
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

/** One real decision: the model proposes `skill`, the runner answers `result`. */
async function decide (Loop, skill, result, args = {}) {
  const ran = []
  const runner = { isBusy: () => false, run: async (s, a) => { ran.push(s); return { detail: 'probe', ...result } } }
  const L = freshLessons()
  const loop = new Loop(loopBot(), runner, L, null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill, args, reason: 'probe' } }) }
  loop.start(); await new Promise(r => setTimeout(r, 150)); loop.stop()
  return { loop, ran, L, refuses: !!loop.admission.memoryRefuses(skill, args, Date.now()) }
}
const DECLINED = { status: 'failed', failClass: 'runner_reserved' }
const FAILED = { status: 'failed', failClass: 'skill_error' }

// skill -> how its handler's backoff reads (the handler the plan names; null = only the admission cooldown)
const HANDLERS = {
  wear_out: l => l.wearOutBackoffUntil > 0,
  compost: l => l.townState?.compostBackoffUntil > 0,
  town_deposit: l => l.townDepositState?.backoffUntil > 0,
  build_well: l => l.wellState?.buildBackoffUntil > 0,
  prune_town: l => l.pruneState?.backoffUntil > 0,
  smelt_town: l => l.smeltJobState?.backoffUntil > 0 || !!l.smeltJobState?.streak,
  furnace_drain: l => l.drainState?.backoffUntil > 0 || !!l.drainState?.streak,
  toolkit: l => l.toolkitState?.backoffUntil > 0,
  count_town: l => l.recountState?.backoffUntil > 0,
  build_plinth: l => l.plinthState?.backoffUntil > 0,
  home: null,
}

for (const [skill, backedOff] of Object.entries(HANDLERS)) {
  await t(`REAL LOOP ${skill}: runner_reserved -> no handler backoff, no admission cooldown; control (skill_error) backs off`, async () => {
    const d = await decide(CognitiveLoop, skill, DECLINED)
    assert.deepEqual(d.ran, [skill], 'the proposal was admitted and dispatched')
    if (backedOff) assert.equal(backedOff(d.loop), false, `the ${skill} handler backed off on a decline`)
    assert.equal(d.refuses, false, `the admission gate charged a cooldown for a run that never started (${skill})`)
    const c = await decide(CognitiveLoop, skill, FAILED)
    if (backedOff) assert.equal(backedOff(c.loop), true, `control: the ${skill} handler is reached and backs off on a real failure`)
    assert.equal(c.refuses, true, 'control: a real failure is throttled')
  })
}

await t('REAL LOOP lessons: a declined gather writes no lesson; control: nothing_found does', async () => {
  const OAK = { block: 'oak_log', count: 1 }
  const d = await decide(CognitiveLoop, 'gather', { status: 'failed', failClass: 'runner_reserved' }, OAK)
  assert.equal(d.L.failCount('gather', OAK), 0)
  const c = await decide(CognitiveLoop, 'gather', { status: 'failed', failClass: 'nothing_found' }, OAK)
  assert.equal(c.L.failCount('gather', OAK), 1, 'control: the lesson path is live')
})

// the mutants: each guard removed -> the declined decision backs off again
const MUTANTS = [
  ['wear_out', "if (!declined && admitted.skill === 'wear_out')", "if (admitted.skill === 'wear_out')"],
  ['prune_town', "if (!declined && admitted.skill === 'prune_town')", "if (admitted.skill === 'prune_town')"],
  ['smelt_town', "if (!declined && admitted.skill === 'smelt_town')", "if (admitted.skill === 'smelt_town')"],
  ['furnace_drain', "if (!declined && admitted.skill === 'furnace_drain')", "if (admitted.skill === 'furnace_drain')"],
  ['build_plinth', "if (!declined && admitted.skill === 'build_plinth')", "if (admitted.skill === 'build_plinth')"],
]
for (const [skill, old, neu] of MUTANTS) {
  await t(`MUTANT KILLED: without its declined guard the ${skill} handler backs off on runner_reserved`, async () => {
    await withMutant(COG_PATH, old, neu, async mod => {
      const d = await decide(mod.CognitiveLoop, skill, DECLINED)
      assert.equal(HANDLERS[skill](d.loop), true, 'the mutant reproduces the backoff')
    })
  })
}
await t('MUTANT KILLED: without the declined branch the admission gate throttles a run that never started', async () => {
  await withMutant(COG_PATH, "      if (declined) {\n        log('info', 'the runner declined the skill: not an outcome'",
    "      if (false) {\n        log('info', 'the runner declined the skill: not an outcome'", async mod => {
      const d = await decide(mod.CognitiveLoop, 'home', DECLINED)
      assert.equal(d.refuses, true, 'the mutant charges the cooldown')
    })
})

// ---- the livelock breaker (#escape), through the real loop ---------------------------------------------------------
/** Fixated and arguing: three rejections in a row with stationary fixation samples spanning the window. */
async function escapeOnce (Loop, failClass) {
  const ran = []
  const runner = { isBusy: () => false, run: async (_s, _a, o) => { ran.push(o?.trigger); return { status: 'failed', failClass, detail: 'probe' } } }
  const loop = new Loop(loopBot(), runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: false, latencyMs: 1, error: 'probe: invalid', raw: '' }) }
  const realNow = Date.now
  let offset = 0
  Date.now = () => realNow() + offset
  try {
    const T0 = realNow()
    loop.consecutiveRejections = 2
    loop.start()
    loop.fixationSamples = [0, 60_000, 120_000, 160_000].map(d => ({ t: T0 + d + 5, x: 0, z: 0, items: 0 }))
    offset = 170_000                                       // the samples now span the fixation window
    await new Promise(r => setTimeout(r, 400))
    loop.stop()
    return { ran, latched: loop.livelockLatchedUntil > Date.now(), rejections: loop.consecutiveRejections }
  } finally { Date.now = realNow }
}

await t('REAL LOOP #escape: a relocation answered runner_reserved -> no latch, no dig rung, the rejection streak kept so the next tick retries; control (no_path) latches', async () => {
  const d = await escapeOnce(CognitiveLoop, 'runner_reserved')
  assert.ok(d.ran.includes('livelock_escape'), `the breaker fired: ${d.ran}`)
  assert.ok(!d.ran.includes('livelock_escape_dig'), 'no dig rung after a declined walk')
  assert.equal(d.latched, false, 'a declined rung must not latch the breaker for ten minutes')
  assert.ok(d.rejections >= 3, 'the streak stays, so the breaker retries on the next rejection')
  const c = await escapeOnce(CognitiveLoop, 'no_path')
  assert.equal(c.latched, true, 'control: a walk that really failed latches')
})

await t('MUTANT KILLED: livelockNext ignoring `declined` latches the breaker on a reservation', async () => {
  await withMutant(COG_PATH, "  if (declined) return 'retry'\n", '', async mod => {
    const d = await escapeOnce(mod.CognitiveLoop, 'runner_reserved')
    assert.equal(d.latched, true, 'the mutant latches')
  })
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
