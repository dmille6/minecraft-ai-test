// KEEPOUT-01 THROUGH THE REAL COGNITIVE LOOP (Codex r2/r3 P2-7): a body inside a fire column is given `_keepout_exit` before
// anything else; three exits that do not get out (interrupted) start the back-off, the exit is NOT re-issued, and the
// next decision is the escape ladder's / the model's (here the model's `surface`, a rescue-class verb) -- the exit can never
// loop on a bot it cannot move. And a body OUTSIDE every column is never given the exit (positive control).
// Separate file: the loop needs its own env (log dir, role, home, cadence).
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-keepout-loop'
process.env.BOT_NAME = process.env.BOT_NAME || 'KoLoopBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const COG_URL = new URL('../src/cognitive.mjs', import.meta.url)
async function withMutant (url, old, neu, fn) {
  const src = fs.readFileSync(url, 'utf8')
  assert.ok(src.includes(old), 'ANCHOR MISSING'); assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-koloop-'))
const SITE = { kind: 'death:fire', x: 500, y: 62, z: 500, count: 4, deaths: 1, last: Date.now(), by: ['x'] }
let seq = 0
function wildBot (at) {
  return {
    entity: { position: new Vec3(...at), velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: 'peaceful',
    inventory: { items: () => [] }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: () => null, findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    setControlState: () => {}, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'KoLoopBot',
    fireSitesNow: () => [SITE], keepoutYields: () => false,
  }
}
async function decisions (bot, n, exitStatus, Loop = CognitiveLoop) {
  const ran = []
  const runner = { isBusy: () => false, run: async skill => { ran.push(skill); return skill === 'keepout_exit' ? { status: exitStatus, detail: 'interrupted: drowning' } : { status: 'no_effect', detail: 'probe' } } }
  const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
  const loop = new Loop(bot, runner, L, null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'surface', args: {}, reason: 'probe' } }) }
  loop.start()
  for (let i = 0; i < 300 && ran.length < n; i++) await new Promise(r => setTimeout(r, 20))
  loop.stop()
  return { ran: ran.slice(0, n), loop }
}

test('INSIDE: exit x3 (interrupted) -> the back-off -> the exit is not re-issued and the model / ladder gets the body', async () => {
  const { ran, loop } = await decisions(wildBot([501, 66, 500]), 5, 'aborted')
  assert.deepEqual(ran.slice(0, 3), ['keepout_exit', 'keepout_exit', 'keepout_exit'], `before anything else: ${ran}`)
  assert.ok(ran.slice(3).length >= 1 && ran.slice(3).every(s => s !== 'keepout_exit'), `then never the exit while backing off: ${ran}`)
  assert.ok(ran.slice(3).includes('surface'), `the ladder action ran: ${ran}`)
  assert.ok(loop.keepoutExitBackoffUntil > Date.now(), 'the back-off is persisted on the loop')
})
test('INSIDE: a failed exit backs off at once (the next decision is not the exit)', async () => {
  const { ran } = await decisions(wildBot([501, 66, 500]), 3, 'failed')
  assert.equal(ran[0], 'keepout_exit')
  assert.ok(ran.slice(1).every(s => s !== 'keepout_exit'), String(ran))
})
test('OUTSIDE every column (positive control): never the exit', async () => {
  const { ran } = await decisions(wildBot([540, 66, 500]), 3, 'aborted')
  assert.ok(ran.length >= 1 && !ran.includes('keepout_exit'), String(ran))
})
test('MUTANT KILLED: without the loop applying exitOutcome, interrupted exits are re-issued for ever', async () => {
  await withMutant(COG_URL, '        this.keepoutExitTries = o.tries; this.keepoutExitBackoffUntil = o.backoffUntil\n', '', async mod => {
    const { ran } = await decisions(wildBot([501, 66, 500]), 5, 'aborted', mod.CognitiveLoop)
    assert.deepEqual(ran, ['keepout_exit', 'keepout_exit', 'keepout_exit', 'keepout_exit', 'keepout_exit'])
  })
})
