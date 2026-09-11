// THE DIG BUDGET MUST PRICE THE DIG THE BOT WILL ACTUALLY DO.
//
// hive-b-Delta, canary hole-walks-01 (2026-09-11): three dig retries from the
// pocket, each "pathfinding exceeded 25000ms", the stone lid still there. The
// watchdog no longer cancelled the dig at one second; the flat clock cancelled
// it at twenty-five, against a bare-handed stone dig that mineflayer prices at
// 7.5 s x5 (not on ground) x5 (in water). The retry now plans first and sizes
// its clock from the plan under the bot's REAL conditions.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { approachDigCost, digRetryBudgetMs, planDigRetry, floatDigTargets, RETRY_BASE_MS, RETRY_MARGIN_MS, RETRY_CAP_MS } from '../src/digapproach.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// A stone block priced the way mineflayer does: 7.5 s bare-handed, x5 airborne, x5 wet.
const calls = []
const stone = (x, y, z) => ({
  name: 'stone', position: { x, y, z },
  digTime (tool, creative, inWater, notOnGround) { calls.push({ inWater, notOnGround }); return 7500 * (inWater ? 5 : 1) * (notOnGround ? 5 : 1) },
  canHarvest () { return false },
})
const fakeBot = ({ inWater, onGround, path, status = 'success', throws = false }) => ({
  entity: { position: { x: 406.3, y: 62.2, z: 235.3 }, isInWater: inWater, onGround, effects: {} },
  blockAt: p => stone(p.x, p.y, p.z),
  pathfinder: {
    bestHarvestTool: () => null,
    getPathFromTo: function * () { if (throws) throw new Error('boom'); yield { result: { status, path } } },
  },
})
const lidPath = [{ toBreak: [{ x: 406, y: 64, z: 235 }] }, { toBreak: [] }]

t('digRetryBudgetMs: no digs keeps the base; digs add on top; a mispriced plan is capped', () => {
  assert.equal(digRetryBudgetMs(0), RETRY_BASE_MS)
  assert.equal(digRetryBudgetMs(NaN), RETRY_BASE_MS)
  assert.equal(digRetryBudgetMs(37500), RETRY_BASE_MS + 37500 + RETRY_MARGIN_MS)
  assert.equal(digRetryBudgetMs(10 * 60 * 1000), RETRY_CAP_MS)
  assert.equal(digRetryBudgetMs(Infinity), RETRY_CAP_MS, 'undiggable-by-pricing gets the cap, not the base')
})

t('approachDigCost prices with the conditions it is given, and the dig-approach default is unchanged (dry, grounded)', () => {
  calls.length = 0
  const b = fakeBot({ inWater: true, onGround: false })
  assert.equal(approachDigCost(b, lidPath).ms, 7500, 'default pricing must stay the dig-approach admission pricing')
  assert.deepEqual(calls.at(-1), { inWater: false, notOnGround: false })
  assert.equal(approachDigCost(b, lidPath, { inWater: true, notOnGround: true }).ms, 187500)
  assert.deepEqual(calls.at(-1), { inWater: true, notOnGround: true })
})

t('planDigRetry prices the floating bot\'s lid at 187.5 s and budgets 217.5 s; the same lid from dry ground stays near the base', () => {
  const wet = planDigRetry(fakeBot({ inWater: true, onGround: false, path: lidPath }), {}, { isEnd: () => true })
  assert.equal(wet.status, 'success'); assert.equal(wet.digMs, 187500)
  assert.equal(wet.budgetMs, RETRY_BASE_MS + 187500 + RETRY_MARGIN_MS)
  assert.equal(wet.inWater, true); assert.equal(wet.notOnGround, true)
  const dry = planDigRetry(fakeBot({ inWater: false, onGround: true, path: lidPath }), {}, { isEnd: () => true })
  assert.equal(dry.digMs, 7500); assert.equal(dry.budgetMs, RETRY_BASE_MS + 7500 + RETRY_MARGIN_MS)
})

t('planDigRetry never blocks the retry: no planner, a throwing planner, or noPath all return the base budget', () => {
  const none = planDigRetry({ entity: { position: { x: 0, y: 0, z: 0 } } }, {}, {})
  assert.equal(none.status, 'unplanned'); assert.equal(none.budgetMs, RETRY_BASE_MS)
  const threw = planDigRetry(fakeBot({ inWater: true, onGround: false, path: [], throws: true }), {}, {})
  assert.equal(threw.status, 'threw'); assert.equal(threw.budgetMs, RETRY_BASE_MS)
  const nop = planDigRetry(fakeBot({ inWater: true, onGround: false, path: [], status: 'noPath' }), {}, {})
  assert.equal(nop.status, 'noPath'); assert.equal(nop.budgetMs, RETRY_BASE_MS)
})

t('planDigRetry prefers mineflayer\'s own bot.digTime (eye-level water, held item, helmet) over the block formula', () => {
  const b = fakeBot({ inWater: true, onGround: false, path: lidPath })
  b.digTime = () => 37500          // bare-hand stone, airborne, eyes in AIR: x5 once
  const r = planDigRetry(b, {}, { isEnd: () => true })
  assert.equal(r.digMs, 37500); assert.equal(r.budgetMs, RETRY_BASE_MS + 37500 + RETRY_MARGIN_MS)
})

t('floatDigTargets: a grounded bot digs nothing itself; a floating bot gets the first digging move\'s blocks, distinct, reachable, at most max', () => {
  assert.deepEqual(floatDigTargets(fakeBot({ inWater: false, onGround: true }), lidPath), [])
  const b = fakeBot({ inWater: true, onGround: false }); b.digTime = () => 37500; b.canDigBlock = () => true
  const path = [{ toBreak: [] }, { toBreak: [{ x: 406, y: 64, z: 235 }, { x: 406, y: 64, z: 235 }, { x: 406, y: 65, z: 235 }, { x: 406, y: 66, z: 235 }, { x: 406, y: 67, z: 235 }] }, { toBreak: [{ x: 1, y: 1, z: 1 }] }]
  const t3 = floatDigTargets(b, path)
  assert.equal(t3.length, 3, 'distinct blocks of the FIRST digging move, capped at 3')
  assert.deepEqual(t3.map(x => x.block.position.y), [64, 65, 66]); assert.equal(t3[0].digMs, 37500)
  b.canDigBlock = blk => blk.position.y !== 65
  assert.deepEqual(floatDigTargets(b, path).map(x => x.block.position.y), [64, 66, 67], 'out-of-reach blocks are skipped, the cap still fills')
  assert.deepEqual(floatDigTargets(b, [{ toBreak: [] }]), [], 'a plan with no digs has no float targets')
})

const RAW = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
const retryBlock = code => {
  const i = code.indexOf('retrying this leg with digging allowed'), j = code.indexOf('retrying this leg with a larger drop allowed', i)
  assert.ok(i > 0 && j > i, 'retry block not found'); return code.slice(i, j)
}
t('the goto dig retry runs on the planned budget, and the mark names it', () => {
  const b = retryBlock(strip(RAW))
  assert.match(b, /const retryPlan = planDigRetry\(bot, bot\.ascentMovements, goal\)/)
  assert.match(b, /withTimeout\(bot\.pathfinder\.goto\(goal\), retryBudget, bot, \{ needsDrop: false \}\)/)
  assert.match(b, /budget=\$\{retryBudget\}ms plan=\$\{retryPlan\.status\} planned_dig=/)
})
t('a floating bot breaks the plan\'s first blocks itself before goto, and the mark counts them', () => {
  const b = retryBlock(strip(RAW))
  const f = b.indexOf('floatDigTargets(bot, retryPlan.path)'), g = b.indexOf('pathfinder.goto(goal), retryBudget')
  assert.ok(f > 0 && g > f, 'the float dig must run before the goto on the planned budget')
  assert.match(b, /kind: 'goto_float_dig'/); assert.match(b, /float_dug=\$\{floatDug\}/)
})
t('MUTANT: removing the float dig is caught', () => {
  const anchor = 'for (const { block, digMs } of floatDigTargets(bot, retryPlan.path)) {'
  assert.equal(RAW.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const m = strip(RAW.replace(anchor, 'for (const { block, digMs } of []) {'))
  assert.ok(!/floatDigTargets\(bot, retryPlan\.path\)/.test(retryBlock(m)))
})
t('MUTANT: the flat 25 s clock put back on the retry is caught', () => {
  const anchor = 'withTimeout(bot.pathfinder.goto(goal), retryBudget, bot, { needsDrop: false })'
  assert.equal(RAW.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const m = strip(RAW.replace(anchor, 'withTimeout(bot.pathfinder.goto(goal), 25000, bot, { needsDrop: false })'))
  assert.ok(!/goto\(goal\), retryBudget, bot/.test(retryBlock(m)), 'mutant still shows the planned budget')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
