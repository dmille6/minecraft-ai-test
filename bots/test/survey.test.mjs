// A scout's product is knowledge, not inventory.
//
// Skill distribution showed scouts and gatherers were the same bot with
// different labels -- gather and goto were the top two for both, in the same
// proportions, and Scout01 crafted MORE than Gather01. The role name carried no
// behavioural difference because both chains were measured in items.
//
// Thresholds come from what the fleet has actually achieved: beyond 60m every
// bot had found at least 5 deposits, beyond 100m almost none existed. A goal
// nobody can reach is the same defect as a goal of NaN.
import { MILESTONES_BY_ROLE, SUSTAINING } from '../src/milestones.mjs'

let pass = 0, fail = 0
const t = (n, got, want) => { const ok = got === want; ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  (got ${got}, want ${want})`}`) }

// home is 28,0 in config; place deposits at known distances from it
const wf = (rows) => ({ read: () => ({ resources: rows }) })
const dep = (dist, by) => ({ kind: 'coal_ore', x: 28 + dist, y: 40, z: 0, by })
const ME = process.env.BOT_NAME || 'Scout01'

const chain = MILESTONES_BY_ROLE.scout
const surveys = chain.filter(m => m.id.startsWith('survey_'))

console.log('the scout chain is differentiated from the gatherer chain')
t('scout has survey goals', surveys.length >= 3, true)
t('gatherer has none', MILESTONES_BY_ROLE.gatherer.some(m => m.id.startsWith('survey_')), false)
t('miner has none', MILESTONES_BY_ROLE.miner.some(m => m.id.startsWith('survey_')), false)

console.log('\nsurvey counts DISTINCT deposits this bot found, beyond a radius')
const m = surveys[0]                                   // survey_6_at_60
const near = Array.from({ length: 20 }, () => dep(10, [ME]))   // 20 close ones
t('deposits inside the radius do not count', m.done({}, 0, wf(near)), false)
const far = Array.from({ length: 6 }, (_, i) => dep(70 + i, [ME]))
t('six beyond 60m completes it', m.done({}, 0, wf(far)), true)
t('five does not', m.done({}, 0, wf(far.slice(0, 5))), false)

console.log('\nanother bot finding them does not count for me')
const theirs = Array.from({ length: 9 }, (_, i) => dep(70 + i, ['Scout02']))
t('peer sightings excluded', m.done({}, 0, wf(theirs)), false)
const shared = Array.from({ length: 6 }, (_, i) => dep(70 + i, ['Scout02', ME]))
t('shared sightings DO count', m.done({}, 0, wf(shared)), true)

console.log('\nprogress never renders NaN, and the sustaining goal escalates')
for (const s of surveys) t(`${s.id} progress is clean`,
  /NaN|undefined/.test(String(s.progress({}, 0, wf(far)))), false)
const sus = chain.find(x => x.id === 'survey_wider')
t('scout has the escalating survey goal', !!sus, true)
for (const n of [0, 1, 5, 40]) {
  const d = typeof sus.describe === 'function' ? sus.describe(n) : sus.describe
  t(`cycle ${n} describes cleanly`, /NaN|undefined/.test(d), false)
}
t('demands more each cycle', sus.describe(2).length > 0 && sus.describe(0) !== sus.describe(2), true)

console.log('\nmissing or broken worldFacts degrades to 0, never throws')
t('null worldFacts', m.done({}, 0, null), false)
t('worldFacts with no read()', m.done({}, 0, {}), false)


// REGRESSION. survey_wider was first added to SUSTAINING, which is appended to
// EVERY role chain -- so a gatherer was handed "find 12 deposits at least 100
// blocks from home" while exactly one such deposit existed fleet-wide. An
// unreachable goal, on the wrong role, which is both halves of what this change
// was supposed to fix.
console.log('\nthe escalating survey goal belongs to scouts ALONE')
t('not in the shared sustaining list', SUSTAINING.some(x => x.id === 'survey_wider'), false)
for (const role of ['gatherer', 'miner']) {
  t(`${role} never gets survey_wider`,
    MILESTONES_BY_ROLE[role].some(x => x.id === 'survey_wider'), false)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
