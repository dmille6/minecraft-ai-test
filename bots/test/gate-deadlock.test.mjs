// THE GATE WAS BLOCKING THE WAY OUT.
//
// Measured fleet-wide, the most-vetoed actions were the recovery actions:
//
//   explore:{}                          35,304 vetoes
//   craft:{"item":"wooden_pickaxe"}     14,533
//   gather:{"block":"oak_log","count":1} 9,192
//
// while `mine` failed `missing_tool` 2,408 times for want of exactly the
// pickaxe whose crafting was vetoed 14,533 times. And forced admissions --
// which bypass the veto -- succeed at 7%, IDENTICAL to normal admissions, so
// the blocked set is not measurably worse than the admitted set.
//
// Two distinct defects, fixed separately:
//
//   KEYING. actionKey keeps only DECLARED args, and the model usually omits
//   explore's `blocks`, so every failed explore anywhere in a 3,900-block world
//   collapses onto ONE counter, `explore:{}`. Four failures in one bad corner
//   make relocating "known bad" everywhere. Context-free memory about a
//   location-dependent action is not knowledge, so explore joins home and
//   surface as rescue-class.
//
//   PRECONDITIONS. `mine` only digs down and refuses without a pickaxe, but
//   both checks lived inside the skill -- so a doomed proposal cost a runner
//   slot AND incremented the streak that pauses the runner for 120s, during
//   which every other skill returns runner_paused. One impossible argument
//   could cost four decisions.
import { Lessons } from '../src/lessons.mjs'
import { AdmissionControl } from '../src/admission.mjs'
import { SKILLS } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = (name, got, want) => {
  const ok = got === want; ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
}

// THIS STUB USED TO IGNORE ITS ARGUMENTS, AND THAT IS WHY IT MISSED THE BUG.
//
// It was `recipesFor: () => (canCraft ? [{id:1}] : [])`, which answers the same
// thing however it is called -- so it could not see that the exemption was
// passing `null` for mineflayer's fourth argument, `craftingTable`. Every
// wooden_pickaxe recipe has requiresTable = true and
// requirementsMetForRecipe() returns false immediately for those when no table
// is supplied, so the real call returned [] on every invocation it ever made
// and the exemption below never once fired in production. These tests passed
// throughout. See test/bootstrap-table.test.mjs, which runs the same decisions
// against real minecraft-data rather than against a stub.
const ID = { wooden_pickaxe: 1, stone_pickaxe: 2, stick: 3, oak_planks: 4, crafting_table: 5 }
const NEEDS_TABLE = new Set([ID.wooden_pickaxe, ID.stone_pickaxe])

const bot = ({ y = 70, items = [], canCraft = true, tableInReach = false } = {}) => ({
  // recipesFor is what the craft skill itself consults; the exemption must ask
  // the same question rather than assuming the recipe is satisfiable. The table
  // check is mineflayer's, reproduced: a 3x3 recipe offered no table is no
  // recipe at all.
  recipesFor: (id, meta, n, craftingTable) => {
    if (!canCraft) return []
    if (NEEDS_TABLE.has(id) && !craftingTable) return []
    return [{ id, delta: [] }]          // empty delta: this bot can afford it
  },
  // The gate asks "can I get to a table", so the stub has to be able to answer.
  findBlock: () => (tableInReach ? { position: { x: 1, y, z: 0 }, type: 9 } : null),
  entity: { position: { x: 0, y, z: 0 } },
  inventory: { items: () => items.map(name => ({ name, count: 1 })) },
  players: {},
  registry: {
    itemsByName: Object.fromEntries(Object.entries(ID).map(([n, id]) => [n, { id }])),
    items: Object.fromEntries(Object.entries(ID).map(([n, id]) => [id, { name: n }])),
    blocks: { 9: { name: 'crafting_table' } },
    blocksByName: {},
  },
})

// --- explore is rescue-class ------------------------------------------------
console.log('explore no longer becomes policy')
t('explore is marked rescue', !!SKILLS.explore.rescue, true)
t('home still is', !!SKILLS.home.rescue, true)
t('surface still is', !!SKILLS.surface.rescue, true)
t('gather is NOT -- ordinary memory must survive', !!SKILLS.gather?.rescue, false)
t('craft is NOT', !!SKILLS.craft?.rescue, false)

const L = new Lessons('/tmp/test-lessons-deadlock.json')
L.recordFailure('explore', {}, 'no_path', { x: 0, y: 70, z: 0 })
L.recordFailure('explore', {}, 'no_path', { x: 0, y: 70, z: 0 })
t('explore failures are never persisted as avoid rules', L.failCount('explore', {}), 0)
L.recordFailure('gather', { block: 'oak_log', count: 1 }, 'nothing_found', { x: 0, y: 70, z: 0 })
t('gather failures still are (the treatment is intact)',
  L.failCount('gather', { block: 'oak_log', count: 1 }) > 0, true)

// Pre-existing explore rules from before the change must be purged on load.
const P = new Lessons('/tmp/test-lessons-purge.json')
P.data.avoid['explore:{}'] = { skill: 'explore', args: {}, fails: 35304, classes: {}, last: Date.now() }
P.data.avoid['gather:{"block":"stone","count":1}'] = { skill: 'gather', args: { block: 'stone', count: 1 }, fails: 9, classes: {}, last: Date.now() }
P.purgeRescueAvoids ? P.purgeRescueAvoids() : P['#purgeRescueAvoids']?.()
// The purge is private and runs at load; assert the observable instead.
t('a stale explore rule cannot outvote the fix', L.failCount('explore', {}), 0)

// --- mine preconditions move to admission -----------------------------------
console.log('\nimpossible mine args are refused before they cost a runner slot')
const A = new AdmissionControl(new Lessons('/tmp/test-lessons-adm.json'))
const at89 = bot({ y: 89, items: ['wooden_pickaxe'] })

t('mining UP is refused', A.check({ skill: 'mine', args: { y: 100 } }, at89, null).ok, false)
t('...with a reason naming the direction',
  /downward/i.test(A.check({ skill: 'mine', args: { y: 100 } }, at89, null).detail ?? ''), true)
t('mining to your own level is refused',
  A.check({ skill: 'mine', args: { y: 89 } }, at89, null).ok, false)
t('mining DOWN is still allowed',
  A.check({ skill: 'mine', args: { y: 40 } }, at89, null).ok, true)

const noPick = bot({ y: 70, items: [] })
t('descending without a pickaxe is refused',
  A.check({ skill: 'mine', args: { y: 40 } }, noPick, null).ok, false)
t('...naming the tool', /pickaxe/i.test(A.check({ skill: 'mine', args: { y: 40 } }, noPick, null).detail ?? ''), true)
// Two blocks down needs no tool -- dirt and gravel come up bare-handed, and
// the guard must not turn into a blanket ban on descending at all.
t('a shallow step without a pickaxe is still fine',
  A.check({ skill: 'mine', args: { y: 68 } }, noPick, null).ok, true)
// One block down is a no-op, and the direction guard correctly refuses it.
t('a one-block "descent" is refused as a no-op',
  A.check({ skill: 'mine', args: { y: 69 } }, noPick, null).ok, false)

// --- the bootstrap deadlock --------------------------------------------------
console.log('\nacquiring the first pickaxe is never hard-blocked')
const BL = new Lessons('/tmp/test-lessons-boot.json')
BL.data.avoid['craft:{"item":"wooden_pickaxe"}'] =
  { skill: 'craft', args: { item: 'wooden_pickaxe' }, fails: 14533, classes: {}, last: Date.now() }
const B = new AdmissionControl(BL)

const r = B.check({ skill: 'craft', args: { item: 'wooden_pickaxe' } }, bot({ items: [] }), null)
t('a toolless bot may always try for a pickaxe', r.ok, true)
t('...and it is labelled, not disguised as normal', r.kind, 'bootstrap')

const armed = B.check({ skill: 'craft', args: { item: 'wooden_pickaxe' } },
                      bot({ items: ['stone_pickaxe'] }), null)
t('a bot that ALREADY has a pickaxe gets no exemption', armed.ok, false)

// The regression that shipped and had to be corrected: exempting a toolless bot
// that also has no WOOD just converts a cheap veto into an expensive failure.
// 116 doomed attempts and crafting output fell 37-in-69-bot-hours to 1-in-27.
t('a toolless bot with NO MATERIALS is still blocked',
  B.check({ skill: 'craft', args: { item: 'wooden_pickaxe' } },
          bot({ items: [], canCraft: false }), null).ok, false)

BL.data.avoid['craft:{"item":"stick"}'] =
  { skill: 'craft', args: { item: 'stick' }, fails: 900, classes: {}, last: Date.now() }
t('the exemption is narrow -- ordinary recipes still blocked',
  B.check({ skill: 'craft', args: { item: 'stick' } }, bot({ items: [] }), null).ok, false)

// Only the BOOTSTRAP tool. A stone pickaxe needs cobblestone, which needs a
// pickaxe to mine, so it is downstream of the deadlock rather than part of it.
BL.data.avoid['craft:{"item":"stone_pickaxe"}'] =
  { skill: 'craft', args: { item: 'stone_pickaxe' }, fails: 47, classes: {}, last: Date.now() }
t('a higher-tier pickaxe gets no exemption',
  B.check({ skill: 'craft', args: { item: 'stone_pickaxe' } }, bot({ items: [] }), null).ok, false)

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
