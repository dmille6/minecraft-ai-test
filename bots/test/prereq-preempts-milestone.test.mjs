// ADVICE IS NOT A GOAL.
//
// Scout01 sat at y=29 for four days. Every failed climb handed the model the
// sentence "you need blocks to pillar: gather 8+ dirt or cobblestone first",
// and every following decision proposed `gather oak_log` -- an action carrying
// 126 recorded failures -- because TASK: still read "Stockpile oak logs". He
// was standing inside a solid mass of diggable stone the entire time. The
// recipe existed, reached the model, and changed nothing, because the layer
// that picks actions plans against the milestone line and nothing else.
//
// So a prerequisite reported by a skill now PREEMPTS the milestone until it is
// satisfied. Both halves are pinned here: skills emit the need as data, and
// applyPrereq turns it into the task line -- carrying `wants`, so the admission
// gate cannot hard-block the detour and the value classifier scores it as
// progress rather than busywork.
import assert from 'node:assert'

process.env.LOG_DIR = '/tmp/mcbot-test-logs-prereq'
process.env.BOT_NAME = 'TestBot'
const { climbPrerequisite, climbAdvice } = await import('../src/skills.mjs')
const { applyPrereq, PREREQ_TTL_MS } = await import('../src/cognitive.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// ---- half one: the stop reason becomes structured data ---------------------

await t('a scaffold-less climb yields a block shopping list', () => {
  const need = climbPrerequisite('no scaffold blocks in inventory')
  assert.ok(need, 'the exact case that trapped Scout01 must produce a need')
  assert.equal(need.count, 8)
  assert.ok(need.items.includes('dirt') && need.items.includes('cobblestone'))
})

await t('an unbreakable-stone stop yields a pickaxe, not blocks', () => {
  const need = climbPrerequisite('dig failed on stone')
  assert.equal(need.count, 1)
  assert.ok(need.items.some(i => i.endsWith('_pickaxe')))
})

await t('a stop with no acquirable cure yields NO shopping list', () => {
  // "blocked overhead" is cured by moving, not fetching. Inventing a need here
  // would send the bot shopping for something that cannot help.
  assert.equal(climbPrerequisite('no height gained'), null)
  assert.equal(climbPrerequisite(null), null)
  assert.match(climbAdvice('no height gained'), /more open/)   // prose still helps
})

await t('the OR-list covers what is actually underfoot underground', () => {
  const need = climbPrerequisite('no scaffold blocks in inventory')
  // A bot at y=29 is surrounded by these; a list that missed them would make
  // the detour as unreachable as the goal it replaces.
  for (const b of ['stone', 'andesite', 'diorite', 'granite', 'cobblestone', 'dirt']) {
    assert.ok(need.items.includes(b), `${b} must satisfy the scaffold need`)
  }
})

// ---- half two: the need becomes the task the model plans against -----------

const MILESTONE = { id: 'stockpile_logs', describe: 'Stockpile 8 oak logs.',
                    progress: '2/8', hint: '', wants: 'oak_log' }
const NEED = { ...climbPrerequisite('no scaffold blocks in inventory'),
               since: Date.now(), fromSkill: 'surface' }

await t('no prereq held: the milestone is untouched', () => {
  const { task, clear } = applyPrereq(MILESTONE, null, 0)
  assert.equal(task, MILESTONE)
  assert.equal(clear, null)
})

await t('SCOUT01 CASE: an unmet prereq replaces TASK: and takes wants with it', () => {
  const { task, clear } = applyPrereq(MILESTONE, NEED, 0)
  assert.equal(clear, null)
  assert.match(task.describe, /Gather 8/, 'the model must read the detour as its task')
  assert.ok(!task.describe.includes('oak'), 'the old goal must not still be the task line')
  assert.equal(task.progress, '0/8 held')
  assert.equal(task.wants, 'dirt',
    'wants must move, or the gate can veto the detour and the classifier calls it busywork')
  assert.match(task.hint, /surface again/, 'the model must know how the detour ends')
})

await t('partial progress is reported, and the detour still stands', () => {
  const { task, clear } = applyPrereq(MILESTONE, NEED, 5)
  assert.equal(clear, null)
  assert.equal(task.progress, '5/8 held')
})

await t('enough in hand: the prereq clears as satisfied and the goal returns', () => {
  const { task, clear } = applyPrereq(MILESTONE, NEED, 8)
  assert.equal(clear, 'satisfied')
  assert.equal(task, MILESTONE, 'the original milestone resumes, unmodified')
})

await t('over-gathering also satisfies it', () => {
  assert.equal(applyPrereq(MILESTONE, NEED, 64).clear, 'satisfied')
})

await t('an unmeetable prereq is ABANDONED, not held forever', () => {
  // The failure mode this fix could itself become: a sealed pocket with no dirt
  // reachable, and a permanent detour replacing every goal the bot has.
  const old = { ...NEED, since: Date.now() - PREREQ_TTL_MS - 1000 }
  const { task, clear } = applyPrereq(MILESTONE, old, 0)
  assert.equal(clear, 'abandoned')
  assert.equal(task, MILESTONE)
})

await t('satisfaction beats staleness (a late success still counts)', () => {
  const old = { ...NEED, since: Date.now() - PREREQ_TTL_MS - 1000 }
  assert.equal(applyPrereq(MILESTONE, old, 8).clear, 'satisfied')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
