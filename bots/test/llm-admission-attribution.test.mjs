// WHICH DOOR DID THE DECISION COME THROUGH?
//
// admission.mjs has three admit paths -- normal, the every-Nth pressure valve
// ('forced'), and the milestone-critical exemption -- and it labeled the
// forced ones in its return value from the day the valve shipped. Nothing
// downstream ever read the label: cognitive.mjs passed `rejection` and
// `outcome` to logLlm and dropped `admitted` on the floor. Block 1 closed
// with the review explicitly asking for the forced-admit outcome breakdown
// ("was Scout02's escape a forced admission?") and the honest answer was
// "not instrumented" -- the same label-outside-the-data defect this repo has
// now caught six times.
//
// These tests pin the whole chain: admission.mjs types its admits, and
// logLlm writes llm.admission from that type, null when nothing executed.
import assert from 'node:assert'
import { readFileSync, mkdirSync, rmSync } from 'node:fs'

// config.mjs reads env at import time; set the sandbox before anything loads it.
process.env.LOG_DIR = '/tmp/mcbot-test-logs-admission'
process.env.BOT_NAME = 'TestBot'
const { AdmissionControl } = await import('../src/admission.mjs')
const { logLlm } = await import('../src/logger.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// ---- admission.mjs types every ok:true it returns --------------------------

// check() validates proposals against the world's registry; a stub suffices.
const stubBot = { registry: { blocksByName: { oak_log: {} }, itemsByName: {} }, players: {} }

await t('a clean admit carries kind: normal', () => {
  const ac = new AdmissionControl(null)
  const r = ac.check({ skill: 'gather', args: { block: 'oak_log', count: 8 }, reason: 'x' }, stubBot, null)
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'normal')
})

await t('the pressure valve carries kind: forced', () => {
  const ac = new AdmissionControl(null)
  // Fabricate the valve's precondition: a learned block and a maxed streak.
  ac.lessons = {
    failCount: () => 5,            // priorFails >= 4 -> probation territory
    bumpBlocked: () => 1,          // n % 5 !== 0 -> would veto, but...
    cited: () => null,
  }
  ac.vetoStreak = 99               // ...the streak forces it through
  const r = ac.check({ skill: 'gather', args: { block: 'oak_log', count: 8 }, reason: 'x' }, stubBot, null)
  assert.equal(r.ok, true, `expected forced admit, got ${JSON.stringify(r)}`)
  assert.equal(r.kind, 'forced')
  assert.ok(r.forced, 'forced admits must still carry the human-readable reason')
})

// ---- logLlm writes llm.admission from the typed admit ----------------------

const record = (admission) => {
  logLlm({
    startedAt: Date.now(), snapshot: {}, trigger: 'test', model: 'm', endpoint: null,
    res: { schemaValid: true }, promptText: 'p', tokensEstimated: 1, droppedEvents: 0,
    proposal: { skill: 'gather' }, rejection: null,
    outcome: { status: 'success', detail: '' }, milestone: 'm0',
    admission, systemPrompt: 's', perceptionSnapshot: undefined,
  })
}

await t('llm.admission round-trips forced / normal / null', async () => {
  record({ ok: true, skill: 'gather', args: {}, kind: 'forced', forced: '4 consecutive vetoes' })
  record({ ok: true, skill: 'gather', args: {}, kind: 'normal' })
  record(null)
  // The write stream is async; give it a beat before reading back.
  await new Promise(r => setTimeout(r, 300))
  const lines = readFileSync(`${process.env.LOG_DIR}/llm-TestBot.jsonl`, 'utf8')
    .trim().split('\n').slice(-3).map(l => JSON.parse(l))
  assert.equal(lines[0].llm.admission, 'forced')
  assert.equal(lines[1].llm.admission, 'normal')
  assert.equal(lines[2].llm.admission, null)
})

console.log(`\n${pass} passed, ${fail} failed`)
rmSync(process.env.LOG_DIR, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
