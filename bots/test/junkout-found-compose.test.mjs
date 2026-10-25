// JUNKOUT-01 x FOUND-01 (JIT 10-24, junkout-on-21dd0ce): junkout-01 was built on 6e1afb52; the fleet gained found-01 (21dd0ce1),
// whose found slot (found_store / found_work) sits between the raised well and the town deposit and charges its visit and its
// 10-min cooldown when it ISSUES. junkout-01's town-visit orders (the well, the composter, the bag allowance's tail) come after
// the recount and replace the order in hand unless it is one they yield to (town_deposit, build_plinth, count_town). The found
// slot was not in that list, so a bot in a founding town whose bag also had a tail to bank got the visit instead of the found
// order -- and the found slot's visit and cooldown were spent on an order that never ran (found's own keep-out refund only
// covers the exit). The recount already yields to the found slot (found-01's JIT line); the visit now does too, and its
// latch is ticked only, so the tail comes on a later decision.
//
// Behaviour through the REAL CognitiveLoop: found-compose.test's greenfield town (the planner tick writes the plan) plus one
// chest beside the bot and a bag carrying the tail's rows (torches, bone meal: allowance 0). Then the pure yield list and a
// mutant that drops the found slot from it.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-jfc-logs-'))
process.env.BOT_NAME = 'FoundBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.MEMORY_SCOPE = 'board'
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.FOUND ??= 'on'
delete process.env.KEEPOUT_TOWN_YIELD
delete process.env.BAG_ALLOWANCE
delete process.env.JUNK_VISIT
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-jfc-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const S = await import('../src/skills.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const COG = await import('../src/cognitive.mjs')
const COG_PATH = new URL('../src/cognitive.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

/** found-compose.test's greenfield town + ONE chest beside the bot (not a plan cell: the tail's container). */
const CHEST = { x: 3, y: 64, z: 2 }
function town (bag, { chest = true } = {}) {
  freshPool(); S.resetPlanZones()
  bag.forEach((it, i) => { it.slot = 9 + i })   // bag slots as mineflayer numbers them (the allowance rows need them)
  const w = fakeWorld({ bag, at: [2.5, 64, 0.5] })
  Object.assign(w.bot, { worldId: 'w', username: 'FoundBot', players: {} })
  const r = S.townPlanTick(w.bot, { now: Date.now() })
  assert.equal(r.op, 'root'); assert.equal(r.result, 'accepted', JSON.stringify(r))
  if (chest) w.set(CHEST.x, CHEST.y, CHEST.z, 'chest')
  // the prompt's nearby-blocks scan asks findBlock by registry id; fakeworld matches by predicate only (the scan is not the question)
  const fb = w.bot.findBlock.bind(w.bot)
  w.bot.findBlock = (o = {}) => (typeof o.matching === 'function' ? fb(o) : null)
  Object.assign(w.bot, { health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: () => [], recipesAll: () => [], clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 } })
  return w
}
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-jfc-l-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
async function decisions (bot, n, { Loop = COG.CognitiveLoop } = {}) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => { ran.push({ skill, args }); return { status: 'success', detail: 'ok', delta: {}, contractEvidence: ['probe'] } } }
  const loop = new Loop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 300 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  return { ran, loop }
}
const isTail = r => r?.skill === 'town_deposit' && r.args?.tail === true
const FOUND_BAG = () => [stack('crafting_table', 2), stack('oak_log', 30), stack('torch', 11), stack('bone_meal', 30)]

console.log('junkout x found: the town-visit orders yield to the found slot')
await t('POSITIVE CONTROL (the tail is live here): the same town with NO found order to give (no table, no wood) -> the tail issues', async () => {
  const w = town([stack('torch', 11), stack('bone_meal', 30)])
  const { ran } = await decisions(w.bot, 1)
  assert.ok(isTail(ran[0]), JSON.stringify(ran))
})
await t('POSITIVE CONTROL (the found order is live here): no chest, so no tail -> found_work (F1)', async () => {
  const w = town(FOUND_BAG(), { chest: false })
  const { ran } = await decisions(w.bot, 1)
  assert.equal(ran[0]?.skill, 'found_work', JSON.stringify(ran))
})
await t('THE CHAIN (real CognitiveLoop): found_work and a tail both due -> found_work runs first, the visit is NOT spent (latch armed), the tail comes after', async () => {
  const w = town(FOUND_BAG())
  const { ran, loop } = await decisions(w.bot, 3)
  assert.equal(ran[0]?.skill, 'found_work', JSON.stringify(ran))
  assert.ok(ran.slice(1).some(isTail), `the tail came on a later decision: ${JSON.stringify(ran.map(r => r.skill))}`)
  assert.equal(ran.filter(isTail).length, 1, 'once per stay')
  assert.equal(loop.tailState?.latched, true, 'spent by the tail that ran')
})
await t('THE YIELD LIST (pure): the visit yields to the town deposit, the plinth, the recount and BOTH found skills; never to the rest', () => {
  for (const s of ['town_deposit', 'build_plinth', 'count_town', 'found_store', 'found_work']) assert.equal(COG.visitYieldsTo({ skill: s }), true, s)
  for (const o of [null, undefined, {}, { skill: 'gather' }, { skill: 'craft' }, { skill: 'keepout_exit' }, { skill: 'compost' }, { skill: 'dispose_well' }]) {
    assert.equal(COG.visitYieldsTo(o), false, JSON.stringify(o))
  }
})
// The mutants assert the REGRESSION itself (Claude JIT 10-24 review P3: a bare "it threw" would also score a timeout as a kill):
// under each mutant the first decision is the tail, not found_work.
const FOUND_IN_LIST = "'count_town', 'found_store', 'found_work'])"
await t('MUTANT KILLED: the found slot dropped from the visit\'s yield list -> the tail replaces found_work (the found visit spent on nothing)', async () => {
  await withMutant(COG_PATH, FOUND_IN_LIST, "'count_town'])", async M => {
    const w = town(FOUND_BAG())
    const { ran } = await decisions(w.bot, 1, { Loop: M.CognitiveLoop })
    assert.ok(isTail(ran[0]), `mutant: the tail took found_work's decision: ${JSON.stringify(ran)}`)
  })
})
await t('MUTANT KILLED: the visit no longer asks the yield list (the blocked line) -> the tail replaces found_work', async () => {
  await withMutant(COG_PATH, 'const blocked = visitYieldsTo(order) || exitFirst()', 'const blocked = exitFirst()', async M => {
    const w = town(FOUND_BAG())
    const { ran } = await decisions(w.bot, 1, { Loop: M.CognitiveLoop })
    assert.ok(isTail(ran[0]), `mutant: the tail took found_work's decision: ${JSON.stringify(ran)}`)
  })
})

// THE FOUND SLOT'S BANK GROUPS (Codex JIT 10-24 P2 / Claude P3): foundBankGroups asks townDepositPlan which groups a deposit
// would bank. Under junkout-01 (BAG_ALLOWANCE on) the default plan APPENDS the allowance rows (torch -> build, bone meal ->
// farm, spare stations), so allowance-only surplus made the found slot assign or found a store chest for them -- a new chest
// for the tail's cleanup, which the tail itself never builds. The found slot reads the plan WITHOUT the rows (tail: false):
// its groups are exactly the base's.
const bagBot = stacks => { stacks.forEach((it, i) => { it.slot = 9 + i }); return fakeWorld({ bag: stacks, at: [2.5, 64, 0.5] }).bot }
const TD = await import('../src/towndeposit.mjs')
const ROWS_BAG = () => [stack('torch', 11), stack('bone_meal', 30)]
await t('FOUND BANK GROUPS: allowance-only surplus (torches, bone meal) gives NO group; POSITIVE CONTROL: the deposit\'s own plan banks both; CONTROL: base surplus (a third log stack) still gives its group', () => {
  const b = bagBot(ROWS_BAG())
  assert.deepEqual(TD.townDepositPlan(b.inventory.items(), {}).steps.map(st => st.name).sort(), ['bone_meal', 'torch'], 'the rows are live in the deposit')
  assert.deepEqual(S.foundBankGroups(b, []), [], 'the found slot does not see them')
  assert.deepEqual(S.foundBankGroups(bagBot([stack('oak_log', 64), stack('oak_log', 64), stack('oak_log', 64)]), []), ['wood'])
})
await t('MUTANT KILLED: foundBankGroups without tail: false -> the rows\' groups (build, farm) reach the found slot', async () => {
  const SK_PATH = new URL('../src/skills.mjs', import.meta.url)
  await withMutant(SK_PATH, 'townDepositPlan(items, { wanted, noSwords: foodSkipNow(bot).active, tail: false })', 'townDepositPlan(items, { wanted, noSwords: foodSkipNow(bot).active })', async M => {
    assert.deepEqual(M.foundBankGroups(bagBot(ROWS_BAG()), []).sort(), ['build', 'farm'], 'mutant: the allowance rows feed the found slot')
  })
})

console.log(`\njunkout-found-compose: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
