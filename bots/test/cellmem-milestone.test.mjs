// A CELL REFUSAL IS NOT AN ATTEMPT AT THE RUNG (both reviews of fa1016f, P1).
//
// gatherCell refuses where this bot keeps failing and walks elsewhere; the gather never ran. Counted as an executed,
// serving failure it burned the rung's give-up budget (25 attempts, 8 with peer evidence) -- a refusal designed to
// save the rung would have skipped it. Driven through the REAL CognitiveLoop and the REAL MilestoneController, with a
// control showing the same instrument counting an ordinary hard failure.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-cellmem-ms'
process.env.BOT_NAME = process.env.BOT_NAME || 'CellBot'
process.env.BOT_ROLE = 'gatherer'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-cellms-'))
let seq = 0
const fresh = () => { const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
const bot = () => ({
  entity: { position: { x: 8, y: 70, z: 8 }, velocity: { x: 0, y: 0, z: 0 } },
  health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
  inventory: { items: () => [] },
  registry: { blocksByName: { dirt: { id: 10 } }, itemsByName: {}, blocks: {}, items: {}, biomesArray: [], biomes: {} },
  recipesFor: () => [], recipesAll: () => [], findBlock: () => null, findBlocks: () => [],
  blockAt: () => ({ name: 'air', boundingBox: 'empty' }), setControlState: () => {}, clearControlStates: () => {},
  players: {}, entities: {}, experience: { level: 0 },
})
/** n real decisions, each proposing `gather dirt`, each answered by `result`. Returns the rung and its attempt count. */
async function decide (result, n = 3) {
  const L = fresh()
  const runner = { isBusy: () => false, run: async () => ({ ...result }) }
  let rung = null, decisions = 0, loop = null
  for (let i = 0; i < n; i++) {   // one loop per decision, as learned-avoid-scope does; progress persists in the store
    loop = new CognitiveLoop(bot(), runner, L, null)
    rung ??= loop.milestones.current()?.id
    loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'gather', args: { block: 'dirt', count: 16 }, reason: 'probe' } }) }
    loop.start(); await new Promise(r => setTimeout(r, 120)); loop.stop()
    decisions += loop.decisions
  }
  return { rung, attempts: loop.milestones.attempts[rung] ?? 0, decisions }
}

await t('CONTROL: an ordinary hard gather failure counts toward the rung give-up (the instrument can see an attempt)', async () => {
  const r = await decide({ status: 'failed', failClass: 'no_path', detail: 'dirt found but unreachable' })
  assert.equal(r.rung, 'gather_dirt_16')
  assert.equal(r.decisions, 3, 'three real decisions ran')
  assert.equal(r.attempts, 3)
})
await t('a cell refusal (no_effect / cell_refused) is NOT an attempt: the give-up budget is untouched', async () => {
  const r = await decide({ status: 'no_effect', failClass: 'cell_refused', detail: 'refused gather dirt here; walked toward column 2,0' })
  assert.equal(r.decisions, 3, 'three real decisions ran')
  assert.equal(r.attempts, 0, `${r.attempts} refusals were charged to ${r.rung}`)
})
await t('and a no_effect of another class still counts (the exemption is the class, not the status)', async () => {
  const r = await decide({ status: 'no_effect', failClass: 'stuck', detail: 'barely moved' })
  assert.equal(r.attempts, 3)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
