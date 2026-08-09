// THE WATCHDOG WAS MEASURING THE DECISION CADENCE, NOT STAGNATION.
//
// At a 70s LLM cooldown a bot acts for a few seconds and then stands still for
// the rest of the minute BY DESIGN. Any 180s window therefore shows almost no
// movement. Measured across 913 stagnation events on a real run:
//
//     blocks moved in the window:  min 0.0   MEDIAN 0.0   p90 1.8   max 8.0
//     fired with the bot having moved > 2 blocks:  85 of 913  (9%)
//
// The watchdog was right that nothing had moved and wrong about what it meant.
// It then cancelled whichever skill happened to be running when the window
// matured -- 97 goto and 52 home failures attributed to the wrong cause.
//
// Separately, its "no progress for 165s" was never a measurement: check()
// refuses to judge until span >= windowMs * 0.9 = 162s, so that number is a
// constant of the design. `frozen` is the quantity that was actually wanted.
//
// Same defect shape this repo keeps finding: a guard testing a PROXY (nothing
// moved) instead of the condition that matters (nothing moved WHILE TRYING).
import assert from 'node:assert'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

// logEvent() writes JSONL to config.log.dir, which is read at import time.
// Point it somewhere disposable BEFORE the modules under test are loaded.
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-test-'))
process.env.LOG_LEVEL ??= 'error'
const { StagnationWatchdog } = await import('../src/watchdog.mjs')
const { config } = await import('../src/config.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const W = config.watchdog.windowMs
const STEP = config.watchdog.sampleMs
const N = Math.floor(W / STEP) + 2      // enough that a full window survives pruning

/**
 * Replay a scripted history into a real watchdog and take one verdict.
 * `busy` is both the flag on the scripted samples and the runner's live state,
 * since check() takes a fresh sample of its own before judging.
 */
async function verdict({ busy, moves = false }) {
  const cancels = []
  const pos = { x: 0, y: 64, z: 0 }
  const bot = {
    entity: { position: pos },
    health: 20, food: 20,
    inventory: { items: () => [] },
    time: { age: 1, day: 1 }, game: { dimension: 'overworld' },
    pathfinder: { getPathTo: () => null, movements: {} },
    quit() {},
  }
  const runner = {
    isBusy: () => busy,
    cancel: r => cancels.push(r),
    resume() {},
    run: async () => {},          // escalation level 1 relocates; harmless here
  }
  const wd = new StagnationWatchdog(bot, runner, { running: true, milestones: { allDone: false } })

  const now = Date.now()
  wd.samples = Array.from({ length: N }, (_, i) => ({
    t: now - (N - 1 - i) * STEP,
    x: moves ? i * 5 : 0, y: 64, z: 0,
    items: 0, busy,
  }))
  wd.lastActionAt = now
  await wd.check()
  return { cancels, fired: cancels.length > 0 }
}

// --- the 913 events that should never have fired --------------------------
await t('a bot idle between decisions is NOT stagnant, however long it sits', async () => {
  const { fired } = await verdict({ busy: false })
  assert.equal(fired, false,
    'motionless while no skill is running is idle-by-design, not stuck — this is the 913')
})

// --- the case the watchdog exists for -------------------------------------
await t('a bot motionless while a skill runs IS stagnant', async () => {
  const { cancels } = await verdict({ busy: true })
  assert.deepEqual(cancels, ['stagnation'],
    'the watchdog must still catch a genuinely wedged bot — entombed at y=49 for 20 minutes')
})

await t('a bot making distance while busy is not stagnant', async () => {
  const { fired } = await verdict({ busy: true, moves: true })
  assert.equal(fired, false)
})

// --- the reported numbers must be observations, not thresholds ------------
await t('the event reports ACTIVE time and frozen duration, not the 162s constant', async () => {
  const dir = process.env.LOG_DIR
  await verdict({ busy: true })
  // logEvent writes to a buffered createWriteStream; give it a tick to flush.
  await new Promise(r => setTimeout(r, 50))
  const lines = fs.readdirSync(dir).flatMap(f =>
    fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean))
  const ev = lines.map(JSON.parse).find(r => r.skill?.name === '_stagnation')
  assert.ok(ev, 'a stagnation event should have been written')
  const d = ev.skill.detail
  assert.match(d, /ACTIVE skill time/, 'must say the time was active, not wall-clock')
  assert.match(d, /frozen \d+s/, 'must report how long the bot actually had not moved')
  assert.match(d, /window \d+s/, 'must name the design constant AS a constant')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
