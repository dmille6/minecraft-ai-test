// IRONSMELT-01, THE REFUSAL CHAIN THROUGH THE REAL DECISION LOOP: a town the town index knows holds no raw iron and no raw
// copper gets no smelt_town (the bot keeps its other moves, no strike); one deposit of raw iron (its mutation mark) and the
// cooldown later the job runs, opens only that container and takes the iron. CONTROL: no index -> the base churn.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
delete process.env.IRONSMELT; delete process.env.SMELT_RULEOUT
const FX = await import('./ironsmelt-fixture.mjs')
const { CF, CHESTS, FAR, FW, HK, HOME, NEAR, RECS, S0, SJ, SJ_PATH, SKILLS_PATH, TI, chest, clearWithdrawHolds, count, depositByIndex, dirtyByIndex, fakeWorld, field, freshPool, job, kOf, killedBy, lastRow, later, memDir, offset, realNow, seenByIndex, sig, stack, t, tapRecords, town, townTotal, withMutant, withServer } = FX

// ---- THE REFUSAL CHAIN, through the REAL decision loop ----------------------------------------------------------------
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-is-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
const T = (name, used) => ({ ...stack(name, 1), maxDurability: { stone_pickaxe: 131, iron_pickaxe: 250 }[name], durabilityUsed: used })
function chainWorld (opts = {}) {
  // kitsearch's chain bag (no ready rung), with an iron pickaxe so the toolkit has nothing to make
  const w = town({ bag: [stack('dirt', 16), stack('oak_log', 64), stack('oak_log', 64), stack('sand', 8), stack('cobblestone', 64), stack('cobblestone', 20),
    stack('crafting_table', 1), T('iron_pickaxe', 10), stack('iron_axe', 1), stack('iron_shovel', 1), stack('stick', 8)], ...opts })
  Object.assign(w.bot, {
    oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, username: 'IronSmeltBot', players: {}, experience: { level: 0 },
    recipesFor: () => [], recipesAll: () => [], clearControlStates: () => {},
  })
  const fb = w.bot.findBlock.bind(w.bot), fbs = w.bot.findBlocks.bind(w.bot)
  w.bot.findBlock = o => (typeof o?.matching === 'function' ? fb(o) : null)
  w.bot.findBlocks = o => (typeof o?.matching === 'function' ? fbs(o) : [])
  return w
}
/** The REAL loop over the chain world; `phases` [{ until(ran) -> bool, then?() }]: each waited for in turn, `then` run at once
 *  after it (the world changed mid-run, as a deposit would change it), one loop throughout. */
async function runLoop (w, phases) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    if (skill === 'smelt_town') {
      const r = await S0.SKILLS.smelt_town.run({ bot: w.bot }, args ?? {}, null)
      ran.push({ skill, status: r.status, stop: r.stop })
      return { ...r, delta: { smelted: r.smelted ?? 0 }, contractEvidence: r.status === 'success' ? ['smelt_effect: probe'] : [] }
    }
    ran.push({ skill, status: 'no_effect' })
    return { status: 'no_effect', detail: 'probe', delta: {}, contractEvidence: [] }
  } }
  const L = new CognitiveLoop(w.bot, runner, freshLessons(), null)
  L.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  L.milestones.cycle = 540
  L.start()
  const marks = []
  try {
    for (const ph of phases) {
      let ok = false
      for (let i = 0; i < 1500 && !(ok = ph.until(ran)); i++) await new Promise(r => setTimeout(r, 30))
      assert.ok(ok, `the loop never reached its phase (a stalled loop would pass every negative): ${JSON.stringify(ran)}`)
      marks.push(ran.length)
      if (ph.then) ph.then(L, ran)
    }
  } finally { L.stop() }
  return { ran, loop: L, marks }
}
const chainScene = async S => {
  // a town the index knows holds no raw iron and no raw copper, whose FAR chest later takes a deposit of raw iron
  const w = chainWorld()
  for (const c of CHESTS) seenByIndex(c)
  let before = null
  const { ran, marks } = await runLoop(w, [
    { until: r => r.length >= 6, then: (L, r) => {
      before = { ran: r.slice(), streak: L.smeltJobState?.streak ?? null }
      // the town changes: raw iron and coal deposited into the FAR chest (its mutation mark), and the cooldown passes
      w.stock(...FAR, [stack('raw_iron', 8), stack('coal', 4)])
      // smeltgate-01: the deposit verb's own records (its move of raw iron, then the closing mark): the gate's evidence
      depositByIndex(FAR, 'raw_iron', 8)
      later(SJ.SMELT_JOB_COOLDOWN_MS + 1000)
    } },
    { until: r => r.some(x => x.skill === 'smelt_town') },
  ])
  assert.ok(!before.ran.some(x => x.skill === 'smelt_town'), `no smelt_town into a town the index knows is empty: ${JSON.stringify(before.ran)}`)
  assert.ok(before.ran.some(x => x.skill === 'status'), 'the bot keeps its other moves (the model\'s turns)')
  assert.equal(before.streak, null, 'a skip is no strike (no outcome was recorded)')
  assert.ok(ran.slice(marks[0]).some(x => x.skill === 'smelt_town'), 'the job runs once the town shows a change')
  assert.equal(field(lastRow(), 'withdrawn'), '8', lastRow()); assert.equal(field(lastRow(), 'in'), 'fe', lastRow())
  assert.equal(w.spy.opened.filter(k => k !== kOf(FAR)).length, 0, `it opened only the changed container: ${w.spy.opened}`)
}
await t('THE REFUSAL CHAIN (real loop): a town the index knows empty -> no smelt_town, the bot keeps its other moves, no strike; a deposit of raw iron (a dirty mark) + the cooldown -> the job runs, opens only that container, takes the iron', async () => {
  await chainScene(S0)
})
const chainControl = async () => {
  // CONTROL (the base churn): the same town with no index -> smelt_town IS dispatched, and finds nothing
  const w = chainWorld()
  const a = await runLoop(w, [{ until: r => r.length >= 6 }])
  const j = a.ran.find(x => x.skill === 'smelt_town')
  assert.ok(j, `CONTROL: with no index the job is dispatched: ${JSON.stringify(a.ran)}`)
  assert.equal(j.stop, 'town_has_none')
}
await t('CHAIN CONTROL: no index -> the job is dispatched into the same town and ends town_has_none (the churn the rule-out removes)', async () => {
  await chainControl()
})


FX.done()
