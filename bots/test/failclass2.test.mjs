// The taxonomy gap that let purged lessons rebuild themselves.
//
// After 30 corrupted movement rules were purged, `gather oak_log` rules came
// back on four bots within hours. The cause: gather gives up after COLLECT_MS
// and reports "ran out of time reaching oak_log" -- structurally identical to
// the 25s travel budget, which IS excluded from lessons -- but it had no
// class, fell to `other`, and `other` writes lessons.
//
// Fleet-wide `other` was a healthy 5.5%. Inside the lessons store it was 62%,
// because the failures that REPEAT were exactly the unclassified ones. An
// aggregate can look fine while the subset that matters is broken.
import { classifyFailure } from '../src/state.mjs'

let pass = 0, fail = 0
const t = (n, got, want) => { const ok = got === want; ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  (got ${got}, want ${want})`}`) }

console.log('our own budgets are named, not left as "other"')
t('gather collect budget',
  classifyFailure('ran out of time reaching oak_log (3/3 attempts timed out at 40s)'), 'collect_budget')
t('travel budget still classified',
  classifyFailure('ran out of the 25s travel budget toward 28,0'), 'path_budget')

console.log('\na death mid-skill is not the skill failing')
t('death', classifyFailure('death'), 'died')

console.log('\nbut a route that cannot be completed IS evidence')
t('partial progress',
  classifyFailure('got within 34 blocks of 120,-40 after 8 legs'), 'path_incomplete')

console.log('\nthe real strings seen in production all classify')
for (const [detail, want] of [
  ['ran out of time reaching dirt (3/3 attempts timed out at 40s)', 'collect_budget'],
  ['no route exists toward 28,0', 'no_path'],
  ['path to 28,0 was stopped', 'path_interrupted'],
  ['planner gave up searching toward 28,0', 'path_timeout'],
]) t(`${detail.slice(0, 38)}…`, classifyFailure(detail), want)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
