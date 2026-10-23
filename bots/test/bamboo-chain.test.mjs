// BAMBOO -> STICKS ON THE STOCK-TARGET FLEET (bamboo-02 rebase onto 8cd0bc62 / 75cfb447): the order through the REAL
// CognitiveLoop on the rebased decide() chain. The pure plan and the fold itself are bamboo.test.mjs's; this asks only
// "which order does a real decision give" AWAY FROM TOWN (no town order can fire there), with the model's fallback
// asserted on every negative. The town precedence (deposit -> recount -> firstOrder -> town/well/prune -> room order) is
// the structural WIRED test in bamboo.test.mjs plus towndeposit/stocktarget's own chains (Codex r1 P3: said, not implied).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-bamboo-chain-logs-'))
process.env.BOT_NAME = 'BambooBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-bamboo-chain-pool-'))

const { fakeWorld, stack } = await import('./fakeworld.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const { HOUSEKEEPING } = await import('../src/hygiene.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-bb-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }

/** A bot far from town (no town order can fire), its bag `bag` (slots 9..). */
function world (bag, at = [200.5, 64, 0.5]) {
  const w = fakeWorld({ bag: bag.map((it, i) => ({ ...it, slot: 9 + i })), at })
  Object.assign(w.bot, {
    oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, username: 'BambooBot', players: {}, experience: { level: 0 },
    recipesFor: () => [], recipesAll: () => [], clearControlStates: () => {},
  })
  const fb = w.bot.findBlock.bind(w.bot), fbs = w.bot.findBlocks.bind(w.bot)
  w.bot.findBlock = o => (typeof o?.matching === 'function' ? fb(o) : null)
  w.bot.findBlocks = o => (typeof o?.matching === 'function' ? fbs(o) : [])
  return w
}
async function decisions (w, n) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    ran.push(skill)
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new CognitiveLoop(w.bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 300 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  // THE LOOP KEPT DECIDING (Codex r1 P3): a stalled loop returns fewer than n, and every negative below would pass on []
  assert.ok(ran.length >= n, `only ${ran.length} of ${n} decisions: ${JSON.stringify(ran)}`)
  return ran
}
const fill = (n, name = 'dirt') => Array.from({ length: n }, () => stack(name, 64))

await t('CHAIN (real loop): a full bag holding bamboo [64] + sticks [32] away from town -> the first order is bamboo_sticks', async () => {
  const ran = await decisions(world([stack('bamboo', 64), stack('stick', 32), ...fill(34)]), 1)
  assert.equal(ran[0], 'bamboo_sticks', JSON.stringify(ran))
  assert.ok(HOUSEKEEPING.has('bamboo_sticks'), 'housekeeping: never the model\'s, never a lesson')
})
await t('CHAIN CONTROL (real loop): bamboo [63] (no batch frees a slot) -> no bamboo order; the model decides', async () => {
  const ran = await decisions(world([stack('bamboo', 63), stack('stick', 32), ...fill(34)]), 2)
  assert.ok(!ran.includes('bamboo_sticks'), JSON.stringify(ran)); assert.ok(ran.includes('status'), 'the model decides')
})
await t('CHAIN CONTROL (real loop): below 34 slots -> no bamboo order (the trigger is the full bag)', async () => {
  const ran = await decisions(world([stack('bamboo', 64), stack('stick', 32), ...fill(30)]), 2)
  assert.ok(!ran.includes('bamboo_sticks'), JSON.stringify(ran)); assert.ok(ran.includes('status'), 'the model decides')
})
await t('CHAIN (real loop): the fold is ONE order per cooldown -- a success that leaves the bag full does not loop', async () => {
  const ran = await decisions(world([stack('bamboo', 64), stack('stick', 32), ...fill(34)]), 4)
  assert.equal(ran.filter(s => s === 'bamboo_sticks').length, 1, JSON.stringify(ran))
  assert.ok(ran.slice(1).every(s => s === 'status'), `after the fold the model decides: ${JSON.stringify(ran)}`)
})

// ---- jit-1023 (bamboo-03 on 6e1afb52 = homefix-02 + poolescape-01): THE DECLINE CHAIN -----------------------------------
// The runner DECLINES a fold it never started (`runner_reserved`: poolescape's or the watchdog's reservation holds it). The
// chain under test: decline -> no 30-min failure backoff (the `!declined` guard) AND the issue-time 2-min cooldown refunded
// (refundDeclined's bamboo case) -> the NEXT decision issues the fold again -> the runner, free now, runs it. Codex rebase
// review P2: before the refund the fold waited out a cooldown for a run that never happened.
const { withMutant } = await import('./helpers/mutant.mjs')
const { refundDeclined } = await import('../src/cognitive.mjs')
const COG = new URL('../src/cognitive.mjs', import.meta.url)
const fullBag = () => [stack('bamboo', 64), stack('stick', 32), ...fill(34)]
/** n real decisions; the runner answers each bamboo_sticks run from `script` in turn (then success), anything else success. */
async function scripted (Loop, w, n, script) {
  const ran = [], left = [...script]
  const runner = { isBusy: () => false, run: async skill => {
    ran.push(skill)
    if (skill === 'bamboo_sticks' && left.length) return { detail: 'probe', delta: {}, ...left.shift() }
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new Loop(w.bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 300 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  assert.ok(ran.length >= n, `only ${ran.length} of ${n} decisions: ${JSON.stringify(ran)}`)
  return { ran, loop }
}
const DECLINED = { status: 'failed', failClass: 'runner_reserved' }
const REAL_FAIL = { status: 'failed', failClass: 'skill_error' }
await t('DECLINE CHAIN (real loop): a fold the runner declined is issued again on the next decision and runs; no backoff, no cooldown spent', async () => {
  const { ran, loop } = await scripted(CognitiveLoop, world(fullBag()), 3, [DECLINED])
  assert.deepEqual(ran.slice(0, 2), ['bamboo_sticks', 'bamboo_sticks'], `declined, then issued again at once: ${JSON.stringify(ran)}`)
  assert.ok(!(loop.bambooBackoffUntil > Date.now()), 'a declined fold never charges the 30-min failure backoff')
  assert.ok(loop.lastBambooAt > 0 && loop.lastBambooAt <= Date.now(), 'the run that DID start charged its cooldown as usual')
})
await t('DECLINE CHAIN CONTROL (real loop): a fold that RAN and failed backs off -- one fold, then the model; the cooldown stays charged', async () => {
  const { ran, loop } = await scripted(CognitiveLoop, world(fullBag()), 3, [REAL_FAIL])
  assert.equal(ran.filter(s => s === 'bamboo_sticks').length, 1, JSON.stringify(ran))
  assert.ok(loop.bambooBackoffUntil > Date.now(), 'a real failure backs off')
  assert.ok(loop.lastBambooAt > 0, 'the cooldown stays charged')
})
await t('DECLINE MUTANT KILLED (refund): without refundDeclined\'s bamboo case the declined fold waits out its cooldown -- no second fold', async () => {
  await withMutant(COG, "  if (skill === 'bamboo_sticks') return st.lastBambooAt != null ? { lastBambooAt: -Infinity } : {}\n", '', async mod => {
    const { ran } = await scripted(mod.CognitiveLoop, world(fullBag()), 3, [DECLINED])
    assert.equal(ran.filter(s => s === 'bamboo_sticks').length, 1, `the mutant spends the cooldown on the decline: ${JSON.stringify(ran)}`)
  })
})
await t('DECLINE MUTANT KILLED (guard): without `!declined` on the bamboo outcome a decline charges the 30-min backoff', async () => {
  await withMutant(COG, "      if (!declined && admitted.skill === 'bamboo_sticks') this.bambooBackoffUntil",
                        "      if (admitted.skill === 'bamboo_sticks') this.bambooBackoffUntil", async mod => {
    const { ran, loop } = await scripted(mod.CognitiveLoop, world(fullBag()), 3, [DECLINED])
    assert.ok(loop.bambooBackoffUntil > Date.now(), 'the mutant backs off on a run that never started')
    assert.equal(ran.filter(s => s === 'bamboo_sticks').length, 1, JSON.stringify(ran))
  })
})
await t('refundDeclined (pure): bamboo_sticks refunds lastBambooAt only when charged; nothing else is touched', () => {
  assert.deepEqual(refundDeclined('bamboo_sticks', { lastBambooAt: 5, bambooBackoffUntil: 9 }), { lastBambooAt: -Infinity })
  assert.deepEqual(refundDeclined('bamboo_sticks', {}), {})
  assert.deepEqual(refundDeclined('wear_out', { lastBambooAt: 5 }), {})
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
