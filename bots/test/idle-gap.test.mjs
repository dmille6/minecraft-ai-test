// THE IDLE GAP: only executed, serving outcomes move a rung toward a give-up; a genuine completion resets skipCount; a
// rung with no serving progress is still given up (the exit), and that give-up is never told to peers.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { MilestoneController, servesRung, NO_PROGRESS_MS, RESTART_GRACE_MS, RUNNER_REFUSALS, RESIDENCE_MAX_MS, SUSTAINING } = await import('../src/milestones.mjs')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// ---- servesRung, pure ----
const W = (...xs) => new Set(xs)
t('item rungs: craft/gather/smelt outputs, recipe inputs, and block drops serve; travel does not', () => {
  const pick = { id: 'craft_stone_pickaxe_1', wants: 'stone_pickaxe' }
  const wanted = W('stone_pickaxe', 'cobblestone', 'stick', 'cobbled_deepslate', 'blackstone')
  assert.equal(servesRung('craft', { item: 'stone_pickaxe' }, pick, wanted), true)
  assert.equal(servesRung('craft', { item: 'stick' }, pick, wanted), true)
  assert.equal(servesRung('gather', { block: 'stone' }, pick, wanted), true, 'stone drops cobblestone')
  assert.equal(servesRung('explore', {}, pick, wanted), false)
  assert.equal(servesRung('gather', { block: 'dirt' }, pick, wanted), false)
  assert.equal(servesRung('smelt', { item: 'raw_iron' }, { id: 'smelt_iron_ingot_3', wants: 'iron_ingot' }, W('iron_ingot', 'raw_iron')), true)
  assert.equal(servesRung('gather', { block: 'iron_ore' }, { id: 'gather_iron_ore_3', wants: 'iron_ore' }, W('iron_ore')), true)
})
t('rungs with no item: patrol/return/deposit/stockpiles/survey map to their verbs', () => {
  assert.equal(servesRung('goto', {}, { id: 'patrol' }, null), true)
  assert.equal(servesRung('gather', { block: 'oak_log' }, { id: 'patrol' }, null), false)
  assert.equal(servesRung('home', {}, { id: 'return#3' }, null), true, 'sustaining ids carry #cycle')
  assert.equal(servesRung('deposit', {}, { id: 'deposit_surplus' }, null), true)
  assert.equal(servesRung('gather', { block: 'birch_log' }, { id: 'stockpile_wood' }, null), true)
  assert.equal(servesRung('mine', {}, { id: 'stockpile_stone' }, null), true)
  assert.equal(servesRung('explore', {}, { id: 'survey_2_at_40' }, null), true)
  assert.equal(servesRung('craft', { item: 'stick' }, { id: 'survey_2_at_40' }, null), false)
})
t('a prereq detour is judged by ITS wants (the id carries +prereq)', () => {
  assert.equal(servesRung('gather', { block: 'dirt' }, { id: 'craft_stone_pickaxe_1+prereq', wants: 'dirt' }, W('dirt')), true)
})

// ---- the controller, on a fake clock ----
let NOW = 1_000_000
const realNow = Date.now
Date.now = () => NOW
const bot = { entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 3 } }, inventory: { items: () => [] } }
function ctl ({ fulfilledNow = false, meansNow = true, progress = { attempts: {}, skipped: [], skippedAt: {}, skipCount: {}, cycle: 0, completions: {}, progressAt: {} } } = {}) {
  const lessons = { getProgress: () => progress, setProgress: (a, s, sa, sc, cy, co, pa) => Object.assign(progress, { attempts: a, skipped: s, skippedAt: sa, skipCount: sc, progressAt: pa }), save () {} }
  const c = new MilestoneController(bot, 'miner', lessons)
  const state = { fulfilled: fulfilledNow, means: meansNow }
  const rung = { id: 'craft_stone_pickaxe_1', wants: 'stone_pickaxe', fulfilled: () => state.fulfilled, done: () => state.fulfilled || !state.means,
                 describe: 'x', progress: () => '-', hint: '' }
  const next = { id: 'stockpile_wood', done: () => false, describe: 'y', progress: () => '-', hint: '' }
  c.chain = [rung, next]; c.index = 0
  return { c, state, progress }
}
const fail1 = { failed: true, executed: true, serving: true }
t('25 executed SERVING failures skip the rung (reason attempts)', () => {
  const { c } = ctl()
  let skipped = false
  for (let i = 0; i < 25 && !skipped; i++) skipped = c.noteAttempt(fail1)
  assert.equal(skipped, true); assert.equal(c.lastSkip.reason, 'attempts')
})
t('REJECTIONS and NON-SERVING failures never count (100 of each, inside the deadline)', () => {
  const { c } = ctl()
  for (let i = 0; i < 100; i++) assert.equal(c.noteAttempt({ failed: true, executed: false, serving: false }), false)
  for (let i = 0; i < 100; i++) assert.equal(c.noteAttempt({ failed: true, executed: true, serving: false }), false)
  assert.equal(c.current().id, 'craft_stone_pickaxe_1')
})
t('non-serving SUCCESSES do not reset the serving count', () => {
  const { c } = ctl()
  for (let i = 0; i < 24; i++) c.noteAttempt(fail1)
  c.noteAttempt({ failed: false, executed: true, serving: false })
  assert.equal(c.noteAttempt(fail1), true, 'the 25th serving failure still skips')
})
t('THE EXIT: a rung nobody serves is still given up after NO_PROGRESS_MS (reason no_progress)', () => {
  const { c } = ctl()
  c.noteAttempt({ failed: true, executed: false, serving: false })          // the rung becomes current at NOW
  NOW += NO_PROGRESS_MS - 1
  assert.equal(c.noteAttempt({ failed: true, executed: false, serving: false }), false)
  NOW += 1
  assert.equal(c.noteAttempt({ failed: true, executed: false, serving: false }), true)
  assert.equal(c.lastSkip.reason, 'no_progress')
})
t('serving progress (a detour\'s success too) moves the deadline', () => {
  const { c } = ctl()
  c.noteAttempt({ failed: true, executed: false, serving: false })
  NOW += NO_PROGRESS_MS - 10
  c.noteAttempt({ failed: false, executed: true, serving: true, overlay: true })
  NOW += NO_PROGRESS_MS - 10
  assert.equal(c.noteAttempt({ failed: true, executed: false, serving: false }), false)
})
t('the deadline is PERSISTED: a restart 20 min in keeps the original clock', () => {
  const first = ctl()
  first.c.noteAttempt({ failed: true, executed: false, serving: false })   // current since NOW
  NOW += 20 * 60_000
  const again = ctl({ progress: first.progress })                            // the reconnect
  NOW += NO_PROGRESS_MS - 20 * 60_000 - 5
  assert.equal(again.c.noteAttempt({ failed: true, executed: false, serving: false }), false)
  NOW += 5
  assert.equal(again.c.noteAttempt({ failed: true, executed: false, serving: false }), true, 'the deadline counted from BEFORE the restart')
})
t('RESTART GRACE: back after an hour offline, the bot gets 10 min before the deadline, not an instant give-up', () => {
  const first = ctl()
  first.c.noteAttempt({ failed: true, executed: false, serving: false })
  NOW += 60 * 60_000
  const again = ctl({ progress: first.progress })
  assert.equal(again.c.noteAttempt({ failed: true, executed: false, serving: false }), false, 'no instant give-up')
  NOW += RESTART_GRACE_MS
  assert.equal(again.c.noteAttempt({ failed: true, executed: false, serving: false }), true)
})
t('a DETOUR on a route rung is judged by its own wants, not the route verbs', () => {
  assert.equal(servesRung('gather', { block: 'dirt' }, { id: 'stockpile_wood#2+prereq', wants: 'dirt' }, W('dirt')), true)
  assert.equal(servesRung('goto', {}, { id: 'patrol+prereq', wants: 'cobblestone' }, W('cobblestone')), false)
})
t('withdraw of a wanted item serves; deepslate ore serves its plain rung', () => {
  assert.equal(servesRung('withdraw', { item: 'stick' }, { id: 'craft_stone_pickaxe_1' }, W('stone_pickaxe', 'stick')), true)
  assert.equal(servesRung('gather', { block: 'deepslate_iron_ore' }, { id: 'gather_iron_ore_3' }, W('iron_ore')), true)
})
t('THE ABSOLUTE BOUND (Codex counterexample): serving successes every 44 min still end at 3 h, reason residence', () => {
  const { c } = ctl()
  c.noteAttempt({ failed: true, executed: false, serving: false })
  let skipped = false, hours = 0
  while (!skipped && hours < 10) {
    NOW += 44 * 60_000; hours += 44 / 60
    skipped = c.noteAttempt({ failed: false, executed: true, serving: true })
  }
  assert.equal(skipped, true); assert.equal(c.lastSkip.reason, 'residence')
  assert.ok(hours * 3600_000 <= RESIDENCE_MAX_MS + 44 * 60_000, `held ${hours.toFixed(1)} h`)
})
t('RUNG IDENTITY: an outcome judged against another rung\'s task neither counts nor resets', () => {
  const { c } = ctl()
  for (let i = 0; i < 30; i++) c.noteAttempt({ failed: true, executed: true, serving: true, taskId: 'stockpile_wood#3' })
  assert.equal(c.current().id, 'craft_stone_pickaxe_1')
  for (let i = 0; i < 24; i++) c.noteAttempt({ failed: true, executed: true, serving: true, taskId: 'craft_stone_pickaxe_1+prereq' })
  assert.equal(c.current().id, 'craft_stone_pickaxe_1', 'a detour of THIS rung is this rung, but overlays do not count')
  let s2 = false
  for (let i = 0; i < 25 && !s2; i++) s2 = c.noteAttempt({ failed: true, executed: true, serving: true, taskId: 'craft_stone_pickaxe_1' })
  assert.equal(s2, true)
})
t('deposit_surplus: "no chest in range" steps over it but is NOT a genuine completion', () => {
  const dep = SUSTAINING.find(m => m.id === 'deposit_surplus')
  const carrying = { inventory: { items: () => [{ name: 'iron_ingot', count: 9 }, { name: 'raw_iron', count: 9 }, { name: 'coal', count: 20 }] }, findBlock: () => null, registry: { blocks: {} } }
  assert.equal(dep.done(carrying), true, 'stepped over (no chest)')
  assert.equal(dep.fulfilled(carrying), false, 'but not fulfilled')
})
t('a GENUINE completion resets skipCount; a no-means BYPASS does not', () => {
  const a = ctl(); a.progress.skipCount['craft_stone_pickaxe_1'] = 9
  a.state.fulfilled = true; a.c.refresh()
  assert.equal(a.progress.skipCount['craft_stone_pickaxe_1'] ?? 0, 0)
  const b = ctl(); b.progress.skipCount['craft_stone_pickaxe_1'] = 9
  b.state.means = false; b.c.refresh()
  assert.equal(b.progress.skipCount['craft_stone_pickaxe_1'], 9)
})
t('the old boolean contract still works (every decision counts)', () => {
  const { c } = ctl()
  let s = false
  for (let i = 0; i < 25 && !s; i++) s = c.noteAttempt(true)
  assert.equal(s, true)
})

// ---- wiring (comments stripped: this codebase's comments quote the code) ----
const cog = readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
t('WIRED: a runner refusal (paused/busy/body held/unknown/superseded) is NOT executed', () => {
  for (const c of ['runner_paused', 'runner_busy', 'body_held', 'unknown_skill', 'superseded']) assert.ok(RUNNER_REFUSALS.has(c), c)
  assert.match(cog, /const executed = !!admitted && outcome\.status !== 'aborted' && !RUNNER_REFUSALS\.has\(runFailClass\)/)
  assert.match(cog, /runFailClass = r\.failClass \?\? null/)
  const run = readFileSync(new URL('../src/runner.mjs', import.meta.url), 'utf8')
  for (const c of RUNNER_REFUSALS) assert.ok(run.includes(`failClass: '${c}'`), `runner.mjs still emits ${c}`)
})
t('WIRED: cognitive passes the verdict object, and only an attempts give-up is reported to peers', () => {
  assert.match(cog, /this\.milestones\.noteAttempt\(\{ failed: outcome\.status !== 'success', executed, serving, overlay, taskId: milestone\?\.id \?\? null \}\)/)
  assert.match(cog, /gaveUp && why\.reason === 'attempts' && this\.worldFacts\?\.reportUnreachable/)
  assert.doesNotMatch(cog, /noteAttempt\(outcome\.status !== 'success'\)/)
})
Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
