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
import { MILESTONES_BY_ROLE, SUSTAINING, MilestoneController } from '../src/milestones.mjs'
import { config } from '../src/config.mjs'

let pass = 0, fail = 0
const t = (n, got, want) => { const ok = got === want; ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  (got ${got}, want ${want})`}`) }

// Place deposits at known distances from home. Read home from config rather
// than hardcoding it: two assertions here quietly measured the wrong distance
// because the fixture assumed 28,0 and the deployed config says otherwise -- a
// test that computes its own expected value from a constant the code no longer
// uses will pass or fail for reasons that have nothing to do with the change.
const wf = (rows) => ({ read: () => ({ resources: rows }) })
const dep = (dist, by) =>
  ({ kind: 'coal_ore', x: config.world.homeX + dist, y: 40, z: config.world.homeZ, by })
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
for (const lvl of [0, 1, 5, 40]) {
  t(`level ${lvl} describes cleanly`, /NaN|undefined/.test(sus.describe(0, lvl)), false)
}

// The frontier is keyed on the survey's OWN completions, not the chain cycle.
// Under the cycle it got harder whether or not the scout ever met it -- a bot
// that gave up on surveying still had the bar raised on it every pass, which is
// the "capability without its inverse" shape again: difficulty could only rise.
console.log('\nthe frontier moves out per COMPLETION, not per chain cycle')
t('cycle alone changes nothing', sus.describe(0, 0) === sus.describe(9, 0), true)
t('a completion moves it out', sus.describe(0, 0) !== sus.describe(0, 1), true)

const distOf = lvl => Number(sus.describe(0, lvl).match(/least (\d+) blocks/)[1])
const countOf = lvl => Number(sus.describe(0, lvl).match(/Find (\d+)/)[1])
// Assert the SHAPE, not the constants. Two assertions here already failed
// because the fixture hardcoded a home coordinate the config had moved; a test
// that restates the implementation's numbers only re-fails when they are tuned.
const step = distOf(1) - distOf(0)
t('starts at the near frontier', distOf(0) === 60 && countOf(0) === 4, true)
t('the step is a genuine stretch, not a leap past the record',
  step >= 5 && step <= 15, true)
t('three completions move it out three steps',
  distOf(3) === distOf(0) + 3 * step && countOf(3) === countOf(0) + 3, true)
let monotone = true
for (let l = 1; l <= 50; l++) if (distOf(l) < distOf(l - 1) || countOf(l) <= countOf(l - 1)) monotone = false
t('never goes backwards', monotone, true)

// A goal nobody can reach is the same defect as a goal of NaN, and an escalator
// with no ceiling reaches that state on its own given enough completions.
console.log('\nthe escalation has a ceiling, well inside the world border')
t('distance caps', distOf(1000) === distOf(500), true)
t('cap is inside the border', distOf(1000) < 1950, true)
t('cap is walkable, not theoretical', distOf(1000) <= 250, true)

// Escalating only helps if what it measures is what the scout did. Deposits
// found beyond the NEW radius must satisfy the new goal; the old radius must not.
console.log('\nthe harder goal is measured at the harder radius')
const at90 = Array.from({ length: 9 }, (_, i) => dep(90 + i, [ME]))
const firstUnmet = [...Array(40).keys()].find(l => !sus.done({}, 0, wf(at90), l))
t('nine deposits at 90m meet the opening level', sus.done({}, 0, wf(at90), 0), true)
t('the ladder eventually outruns them', firstUnmet !== undefined, true)
t('every level below that one is met',
  [...Array(firstUnmet).keys()].every(l => sus.done({}, 0, wf(at90), l)), true)
t('the first unmet level asks for more than they are, or further than they lie',
  distOf(firstUnmet) > 98 || countOf(firstUnmet) > 9, true)

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

// End to end through the controller: the count has to survive the walk, the
// re-entry, and the round trip through persisted progress -- `this.cycle` was
// created, read, and never assigned, and shipped `Stockpile NaN cobblestone`.
console.log('\nthe controller counts completions and hands them to the goal')
let dist = 90
const bot = {
  entity: { position: { x: 28, y: 70, z: 0, distanceTo: () => dist } },
  // Carries a crafting_table and a furnace so the TECH LADDER in SUSTAINING is
  // already satisfied for this bot. This file's subject is survey_wider
  // escalation, and without them the controller correctly parks on
  // craft_crafting_table_1 -- a bot holding 64 planks SHOULD be asked to make
  // one -- which a static fixture can never satisfy because it never crafts.
  // That is the fixture's limit, not the chain's: in flight the bot crafts and
  // moves on, and a bot with no materials skips the rung vacuously.
  inventory: { items: () => [{ name: 'oak_log', count: 64 }, { name: 'oak_planks', count: 64 },
                             { name: 'stick', count: 64 }, { name: 'cobblestone', count: 64 },
                             { name: 'crafting_table', count: 1 }, { name: 'furnace', count: 1 },
                             { name: 'stone_pickaxe', count: 1 }] },
}
const store = { attempts: {}, skipped: [], skippedAt: {}, skipCount: {}, cycle: 0, completions: {} }
const lessons = {
  getProgress: () => store,
  setProgress: (a, sk, sa, sc, cy, comp) => {
    store.attempts = a; store.skipped = sk; store.skippedAt = sa
    store.skipCount = sc; store.cycle = cy; if (comp) store.completions = comp
  },
  save() {},
}
const deposits = Array.from({ length: 8 }, (_, i) => dep(105 + i, [ME]))
const ctl = new MilestoneController(bot, 'scout', lessons, wf(deposits))
for (let i = 0; i < 60; i++) { dist = i % 2 ? 5 : 90; ctl.refresh() }

const lvl = store.completions.survey_wider ?? 0
console.log(`    survey_wider completed ${lvl}x -> now asks for ${sus.describe(0, lvl)}`)
t('completions were counted', lvl > 0, true)
t('and persisted, not just held in memory', store.completions === ctl.completions, true)
t('the goal got harder than it started', distOf(lvl) > 60, true)
// Escalation must STOP where the fixture stops satisfying it rather than run on
// under its own momentum. Derive the expected stopping point from the fixture so
// this keeps testing the behaviour after the ladder is retuned.
let earned = 0
while (sus.done({}, 0, wf(deposits), earned)) earned++
t('escalation stops exactly where the scout stops earning it', lvl === earned, true)
t('the standing goal is now genuinely unmet', sus.done(bot, 0, wf(deposits), lvl), false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
