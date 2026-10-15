// THE TOWN SMELT JOB GIVES BACK WHAT IT TOOK (smeltjob-01; Claude rebase review 10-15 P2 + P3).
//
// raw_copper is DEPOSIT_ALWAYS and a withdraw holds what it took back from every deposit (bankable.mjs). The job's exit
// released only the LEFTOVER of its own hold, so after "take 8, smelt 5" the hold stood at 5 and covered the 3 left: the job
// could not bank its own copper. And the town coal it took went back on no exit where the furnace never burned it.
// Driven here through the REAL skill over the fake world (real withdraw clicks, real deposit plan, real holds), plus the
// pure exit decision (smeltjob.mjs jobReturns).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-sjret-logs-'))
process.env.BOT_NAME = 'SmeltRetBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'shared'; process.env.MEMORY_POOL = 'hive-test'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-sjret-pool-')) }
freshPool()

const { jobReturns } = await import('../src/smeltjob.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const { depositPlan, setWithdrawHold, releaseWithdrawHold, withdrawHolds, clearWithdrawHolds, DEPOSIT_ALWAYS } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const sig = () => new AbortController().signal
const count = (slots, name) => slots.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const withServer = w => {
  w.bot.craftSync = {
    lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => { const c = win.selectedItem; return { answered: true, cursorEmpty: !c, carried: c ? { itemCount: c.count } : null } },
  }
  return w
}
const town = (bag, stacks) => { freshPool(); clearWithdrawHolds(); const w = fakeWorld({ bag }); w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, stacks); return withServer(w) }
const O = { wants: [...DEPOSIT_ALWAYS] }

// ---- the pure exit decision ----------------------------------------------------------------------------------------
await t('jobReturns: the WHOLE withdrawal is released, whatever is left (take 8 smelt 5, take 8 smelt 8, take 8 smelt 0)', () => {
  for (const withdrawn of [8, 5, 1]) assert.equal(jobReturns({ withdrawn }).releaseRaw, withdrawn)
  assert.equal(jobReturns({ withdrawn: 0 }).releaseRaw, 0)
  assert.equal(jobReturns({}).fuel, null, 'no fuel taken: nothing to give back')
})
await t('jobReturns: unburnt TOWN fuel goes back, never the bag\'s own; a burnt one is not returned', () => {
  assert.deepEqual(jobReturns({ fuelName: 'coal', fuelTaken: 1, fuelBag0: 2, fuelNow: 3 }).fuel, { name: 'coal', release: 1, deposit: 1 }, 'never burned')
  assert.equal(jobReturns({ fuelName: 'coal', fuelTaken: 1, fuelBag0: 2, fuelNow: 2 }).fuel.deposit, 0, 'one burned: the bag is back where it began')
  assert.equal(jobReturns({ fuelName: 'coal', fuelTaken: 1, fuelBag0: 0, fuelNow: 0 }).fuel.deposit, 0)
  assert.equal(jobReturns({ fuelName: 'coal', fuelTaken: 1, fuelBag0: 2, fuelNow: 9 }).fuel.deposit, 1, 'at most what was taken (a pickup is not the town\'s)')
})
await t('THE BUG, on the real holds: take 8, smelt 5 -- releasing the leftover (3) leaves the 3 raw undepositable; releasing the withdrawal (8) banks them', () => {
  const bag = [stack('raw_copper', 3)]
  clearWithdrawHolds(); setWithdrawHold('raw_copper', 8, Date.now() + 600_000)
  releaseWithdrawHold('raw_copper', Math.min(3, 8))                       // the old exit
  assert.deepEqual(depositPlan(bag, 'raw_copper', O), [], 'CONTROL: the old exit cannot bank its own leftover')
  clearWithdrawHolds(); setWithdrawHold('raw_copper', 8, Date.now() + 600_000)
  releaseWithdrawHold('raw_copper', jobReturns({ withdrawn: 8 }).releaseRaw)
  assert.deepEqual(depositPlan(bag, 'raw_copper', O), [{ name: 'raw_copper', count: 3 }])
  assert.equal(withdrawHolds().raw_copper, undefined, 'no stale hold left behind')
})

// ---- the real skill: withdraw -> an exit before any smelt -> everything the town lent goes back ----------------------
await t('smelt_town, NO FURNACE (and too little cobble to craft one): the 8 raw copper AND the town coal go back to the chest; the bag\'s own 2 coal stay; no hold left', async () => {
  const w = town([stack('coal', 2), stack('cobblestone', 3)], [stack('raw_copper', 8), stack('coal', 4)])
  const chest = () => w.containers.get(w.key(5, 64, 0)).slots
  const r = await SKILLS.smelt_town.run({ bot: w.bot }, {}, sig())
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(count(chest(), 'raw_copper'), 8, 'every raw copper back in the chest')
  assert.equal(count(chest(), 'coal'), 4, 'the town coal back in the chest')
  assert.equal(count(w.bag, 'coal'), 2, 'the bag keeps exactly its own coal')
  assert.equal(count(w.bag, 'raw_copper'), 0)
  assert.equal(w.dropped.length, 0)
  const h = withdrawHolds()
  assert.equal(h.raw_copper ?? 0, 0, 'no raw copper hold left'); assert.equal(h.coal ?? 0, 0, 'no coal hold left')
  const row = RECS.filter(x => x?.skill?.name === '_smelt_town').at(-1)?.skill?.detail ?? ''
  assert.match(row, /stop=no_furnace .*withdrawn=8 coal=1 .*verdict=ok diff=0 .*fb=1/, row)
})
await t('CONTROL: the same town with copper but NO coal -> no_fuel; the copper goes back; nothing of the bag\'s own fuel moves', async () => {
  const w = town([stack('coal', 2)], [stack('raw_copper', 8)])
  const chest = () => w.containers.get(w.key(5, 64, 0)).slots
  const r = await SKILLS.smelt_town.run({ bot: w.bot }, {}, sig())
  assert.equal(r.stop, 'no_fuel', `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(count(chest(), 'raw_copper'), 8); assert.equal(count(w.bag, 'coal'), 2); assert.equal(count(chest(), 'coal'), 0)
})

await t('A LIVE COAL HOLD from an earlier withdraw (Codex/Claude r2 P3): the return still banks exactly the town coal, and the earlier hold comes back at its count', async () => {
  const w = town([stack('coal', 2), stack('cobblestone', 3)], [stack('raw_copper', 8), stack('coal', 4)])
  setWithdrawHold('coal', 2, Date.now() + 9 * 60_000)                                     // the bag's 2 coal came from an earlier withdraw
  const chest = () => w.containers.get(w.key(5, 64, 0)).slots
  const r = await SKILLS.smelt_town.run({ bot: w.bot }, {}, sig())
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(count(chest(), 'coal'), 4, 'the town coal back in the chest')
  assert.equal(count(w.bag, 'coal'), 2, 'the bag keeps its own 2')
  assert.equal(withdrawHolds().coal, 2, 'the earlier hold is back at its count: 2 (the swap restored it, it did not add to it)')
})
await t('a bag of CHARCOAL and a town with coal, no furnace: the charcoal never moves, the town coal goes back', async () => {
  const w = town([stack('charcoal', 3), stack('cobblestone', 3)], [stack('raw_copper', 8), stack('coal', 4)])
  const chest = () => w.containers.get(w.key(5, 64, 0)).slots
  const r = await SKILLS.smelt_town.run({ bot: w.bot }, {}, sig())
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(count(w.bag, 'charcoal'), 3); assert.equal(count(chest(), 'coal'), 4); assert.equal(count(chest(), 'raw_copper'), 8)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
