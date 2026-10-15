// BAMBOO -> STICKS ON THE STOCK-TARGET FLEET (bamboo-02 rebase onto 8cd0bc62 / 75cfb447): the order through the REAL
// CognitiveLoop, composed with what landed since bamboo-01 -- stocktarget's recount and pruning, orderroom's room order,
// digtown, the wellsite well orders. The pure plan and the fold itself are bamboo.test.mjs's; this asks only "which order
// does a real decision give", with a positive control for every negative.
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
  assert.ok(!ran.includes('bamboo_sticks'), JSON.stringify(ran))
})
await t('CHAIN CONTROL (real loop): below 34 slots -> no bamboo order (the trigger is the full bag)', async () => {
  const ran = await decisions(world([stack('bamboo', 64), stack('stick', 32), ...fill(30)]), 2)
  assert.ok(!ran.includes('bamboo_sticks'), JSON.stringify(ran))
})
await t('CHAIN (real loop): the fold is ONE order per cooldown -- a success that leaves the bag full does not loop', async () => {
  const ran = await decisions(world([stack('bamboo', 64), stack('stick', 32), ...fill(34)]), 4)
  assert.equal(ran.filter(s => s === 'bamboo_sticks').length, 1, JSON.stringify(ran))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
