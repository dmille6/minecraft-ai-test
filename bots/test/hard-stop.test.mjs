// THE BOT THAT LOOKED PERFECTLY HEALTHY WHILE BEING PERMANENTLY DEAD.
//
// board-d-Alpha, 2026-08-25:
//   10:41:04  LLM -> gather {"block":"oak_log", ... "player":"<corrupt>"}
//   10:44:04  watchdog fired  skill=gather  ms=180000
//   12:04     still emitting path_reset:"stuck" 17x/min, 83 minutes later
//
// The abort fired exactly on time. The skill never returned. `this.current`
// never cleared, so isBusy() stayed true and the cognitive loop issued ZERO
// decisions for the rest of the bot's life -- while systemd said active,
// telemetry flowed at 1,026 events/hour, and the liveness check was satisfied.
import assert from 'node:assert'
import {
  shouldHardStop, watchdogMayOverrideBusy, hardStopResult, HARD_STOP_GRACE_MS,
} from '../src/hard-stop.mjs'
import { pathfinderWedged } from '../src/path-watchdog.mjs'
import { Runner } from '../src/runner.mjs'
import { SKILLS } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// --- the rule ---------------------------------------------------------------

t('a co-operative skill is never hard-stopped', () => {
  // Abort first. A skill that unwinds cleanly releases its own resources, and
  // racing it would throw that away.
  assert.equal(shouldHardStop({ elapsedMs: 180_000, timeoutMs: 180_000 }), false)
  assert.equal(shouldHardStop({ elapsedMs: 180_000 + HARD_STOP_GRACE_MS - 1,
                                timeoutMs: 180_000 }), false)
})

t('a skill that ignores its abort IS hard-stopped', () => {
  assert.equal(shouldHardStop({ elapsedMs: 180_000 + HARD_STOP_GRACE_MS,
                                timeoutMs: 180_000 }), true)
  // board-d-Alpha's actual number.
  assert.equal(shouldHardStop({ elapsedMs: 83 * 60_000, timeoutMs: 180_000 }), true)
})

t('no timeout configured means no hard stop', () => {
  assert.equal(shouldHardStop({ elapsedMs: 9e9, timeoutMs: 0 }), false)
})

t('the failure class is DISTINCT from an ordinary timeout', () => {
  // An ordinary timeout is a skill that gave up when asked. This is one that
  // would not, and they have to be countable apart or the fix is unmeasurable.
  const r = hardStopResult('gather', 83 * 60_000)
  assert.equal(r.failClass, 'abort_ignored')
  assert.notEqual(r.failClass, 'timeout')
  assert.equal(r.hardStopped, true)
  assert.match(r.detail, /did not return/)
})

// --- the second net ---------------------------------------------------------

t('THE WATCHDOG STILL DEFERS to a skill inside its timeout', () => {
  // Removing this guard dropped goto success from 47.2% to 41.8% over 328
  // firings. It stays.
  assert.equal(watchdogMayOverrideBusy({ busy: true, skillElapsedMs: 10_000,
                                         timeoutMs: 180_000 }), false)
  assert.equal(pathfinderWedged({ hasGoal: true, moving: false, mining: false,
                                  building: false, busy: true, stillFor: 60_000,
                                  skillElapsedMs: 10_000, skillTimeoutMs: 180_000 }), false)
})

t('BUT NOT PAST IT — the exemption ends where its justification does', () => {
  assert.equal(watchdogMayOverrideBusy({ busy: true, skillElapsedMs: 180_000,
                                         timeoutMs: 180_000 }), true)
  assert.equal(pathfinderWedged({ hasGoal: true, moving: false, mining: false,
                                  building: false, busy: true, stillFor: 60_000,
                                  skillElapsedMs: 200_000, skillTimeoutMs: 180_000 }), true,
    'the watchdog still declined for a skill 20s past its own failed timeout')
})

t('a moving bot is never wedged, busy or not', () => {
  assert.equal(pathfinderWedged({ hasGoal: true, moving: true, mining: false,
                                  building: false, busy: true, stillFor: 60_000,
                                  skillElapsedMs: 900_000, skillTimeoutMs: 180_000 }), false)
})

// --- the runner actually releases the bot -----------------------------------

await ta('THE RUNNER RELEASES A BOT FROM A SKILL THAT WILL NOT RETURN', async () => {
  const cleared = { goal: 0, controls: 0 }
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0, clone: () => ({ distanceTo: () => 0 }) } },
    health: 20, food: 20,
    inventory: { items: () => [] },
    pathfinder: { setGoal: () => { cleared.goal++ } },
    clearControlStates: () => { cleared.controls++ },
    blockAt: () => null, findBlock: () => null, entities: {}, players: {},
    registry: { blocksByName: {}, itemsByName: {} },
    time: { day: 1, age: 1 },
  }
  const r = new Runner(bot)
  // A skill that never resolves and never looks at its signal -- gather, in the
  // pathfinder reset loop.
  SKILLS.__wedged = { run: () => new Promise(() => {}) }
  try {
    const started = Date.now()
    const res = await r.run('__wedged', {}, { trigger: 'test' })
    const took = Date.now() - started
    assert.equal(res.failClass, 'abort_ignored', `got ${res.failClass}: ${res.detail}`)
    assert.ok(r.current === null || r.current === undefined,
      'the runner is still holding the bot; isBusy() would stay true forever')
    assert.ok(cleared.goal > 0, 'the pathfinder goal was left set under a zombie skill')
    assert.ok(cleared.controls > 0, 'the control states were left held')
    assert.ok(took < 400_000, `waited ${took}ms`)
  } finally {
    delete SKILLS.__wedged
  }
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
