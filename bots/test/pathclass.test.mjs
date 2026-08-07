// Why a walk failed is a fact the pathfinder reports. We were guessing it.
//
// For sixteen hours goto classified its own failures by regexing the error
// PROSE with /no path|took to long|timeout|exceeded/i. That pattern matched our
// OWN wrapper message, "pathfinding exceeded 25000ms", so 393 expired travel
// budgets were reported to the model -- and persisted to the lessons store --
// as "no route toward 28,0". Over the same window the pathfinder said
// "no path to goal" exactly ZERO times.
//
// Worse, the reflex layer's stuck detector calls runner.interrupt() and then
// bot.pathfinder.stop(). stop() is the ONLY emitter of `path_stop` in
// mineflayer-pathfinder 2.4.5, so goto() rejects with PathStopped rather than
// our AbortError -- `e.aborted` was undefined, the branch that re-throws aborts
// never fired, and 596 self-inflicted interruptions were charged to the skill.
// Four of those and the admission gate forbids the action outright.
//
// These assert the contract that replaced the guessing.
import { SKILLS } from '../src/skills.mjs'
import { classifyFailure } from '../src/state.mjs'

let pass = 0, fail = 0
const t = (n, got, want) => { const ok = got === want; ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`) }

const err = (name, msg, extra = {}) => Object.assign(new Error(msg), { name, ...extra })

// A bot that never moves, whose pathfinder rejects however the test says.
function mkBot(rejection) {
  const pos = { x: 0, y: 64, z: 0,
                clone() { return { ...pos, clone: pos.clone, distanceTo: pos.distanceTo } },
                distanceTo() { return 0 } }
  return {
    entity: { position: pos },
    pathfinder: { goto: () => Promise.reject(rejection), stop() {} },
  }
}
const run = (rejection, signal) =>
  SKILLS.goto.run({ bot: mkBot(rejection) }, { x: 100, y: 64, z: 100 }, signal)

console.log('goto reports the cause mineflayer-pathfinder gave, not a guess')
const cases = [
  ['NoPath',      'No path to the goal!',                    'no_path'],
  ['Timeout',     'Took to long to decide path to goal!',    'path_timeout'],
  ['PathStopped', 'Path was stopped before it completed!',   'path_interrupted'],
  ['GoalChanged', 'The goal was changed!',                   'goal_changed'],
]
for (const [name, msg, want] of cases) {
  const r = await run(err(name, msg))
  t(`${name} -> ${want}`, r.failClass, want)
  t(`${name} detail carries no stale verdict`,
    /no route exists/.test(r.detail) === (want === 'no_path'), true)
}

console.log('\nour own 25s travel budget is never reported as "no route exists"')
const budget = await run(err('Error', 'pathfinding exceeded 25000ms',
                             { failClass: 'path_budget', budgetExceeded: true }))
t('classified as our budget', budget.failClass, 'path_budget')
t('does not claim the route is impossible', /no route exists/.test(budget.detail), false)
// The exact string that caused the original defect.
t('the old regex would have called this no_path',
  /no path|took to long|timeout|exceeded/i.test('pathfinding exceeded 25000ms'), true)

console.log('\na path WE stopped is an abort, not a failure of the skill')
const ac = new AbortController()
ac.abort()
let threw = null
try { await run(err('PathStopped', 'Path was stopped!'), ac.signal) } catch (e) { threw = e }
t('it throws rather than returning failed', threw !== null, true)
t('and is marked aborted, so the lessons store ignores it', threw?.aborted, true)

console.log('\nthe fallback classifier agrees with the explicit verdicts')
// Old documents in Elasticsearch must reclassify the same way the live fleet
// does, or the before/after comparison measures wording, not behaviour.
t('no route exists',        classifyFailure('no route exists toward 28,0'), 'no_path')
t('planner gave up',        classifyFailure('planner gave up searching toward 28,0'), 'path_timeout')
t('was stopped',            classifyFailure('path to 28,0 was stopped'), 'path_interrupted')
t('competing goal',         classifyFailure('a competing goal replaced the route'), 'goal_changed')
t('travel budget',          classifyFailure('ran out of the 25s travel budget'), 'path_budget')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
