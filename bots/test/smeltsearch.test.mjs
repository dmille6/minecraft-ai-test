// TOOLKIT-03, THE SMELT JOB'S PART: the town smelt job's draw (skills.mjs jobWithdraw) is the TOWN SEARCH -- copper first
// (its own 2 h miss), then, with copper in hand, COAL AS ITS OWN NEED (its own 60 min miss; never skipped for lacking
// copper), each pass its own budget; the order's copper gate is the same rule (townCopperMiss = townSearchEmpty).
// Driven through the REAL smelt_town skill over the fake world (real withdraw clicks, real holds, real deposits); the fake
// has no furnace and the bag too little cobble to craft one, so a job that FOUND its coal ends `no_furnace` -- one step past
// the fuel check -- while one that did not ends `no_fuel` (the full smelt is the Paper scene `smeltcoal`).
//
// MEASURED 10-19 (the analysis agent, ES 24 h): 516 jobs stopped no_fuel, 489 of them after taking 8 raw copper and finding
// no coal; the coal look ran on the COPPER miss's container list, so coal in a container marked "no copper" was never found.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-smeltsearch-logs-'))
process.env.BOT_NAME = 'SmeltSearchBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'shared'; process.env.MEMORY_POOL = 'hive-test'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-smeltsearch-pool-')) }
freshPool()

const SJ = await import('../src/smeltjob.mjs')
const S0 = await import('../src/skills.mjs')
const CF = await import('../src/chestfull.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const sig = () => new AbortController().signal
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const SJ_PATH = new URL('../src/smeltjob.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset
const later = ms => { offset += ms }

const HOME = { x: 0, y: 64, z: 0 }
const memDir = () => process.env.POOL_STATE_DIR
const count = (slots, name) => slots.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const kOf = ([x, y, z]) => `${x},${y},${z}`
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
/** A town of 9 single chests (the bot at 6.5,64,0.5): COPPER (8 raw copper) is the nearest; the others hold dirt unless set. */
const CHESTS = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2], [-2, 64, 2], [4, 64, 9], [-5, 64, -4]]
const COPPER = CHESTS[0]
function town ({ coalAt = null, coal = 4, copperMissAt = [], bag = [stack('cobblestone', 3)] } = {}) {
  freshPool(); clearWithdrawHolds(); offset += 3 * 60 * 60_000           // a fresh town; every earlier miss and cache stale
  const w = withServer(fakeWorld({ bag: bag.map((s, i) => ({ ...s, slot: 9 + i })) }))
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  w.stock(...COPPER, [stack('raw_copper', 8)])
  if (coalAt) w.stock(...coalAt, [stack('coal', coal)])
  if (copperMissAt.length) CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.noteItemMisses(e, SJ.COPPER_MISS_KEY, SJ.COPPER_MISS_TTL_MS, copperMissAt.map(kOf)))
  ironDone(w)
  return w
}
// IRONSMELT-01: the job searches the town's RAW IRON first. These scenes are the COPPER flow's (toolkit-03), so their towns
// are towns whose iron is all looked at -- every container a live iron miss -- and the job then runs the base's copper flow
// exactly (the iron-first scenes are test/ironsmelt.test.mjs's)
function ironDone (w) {
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.noteItemMisses(e, SJ.IRON_MISS_KEY, SJ.IRON_MISS_TTL_MS, [...w.containers.keys()]))
}
const chest = (w, c) => w.containers.get(kOf(c)).slots
const job = (S, w) => S.SKILLS.smelt_town.run({ bot: w.bot }, {}, sig())
const lastRow = () => RECS.filter(x => x?.skill?.name === '_smelt_town').at(-1)?.skill?.detail ?? ''

// ---- the coordinator's scene: coal only in a container the copper search has marked "no copper" ----------------------
const coalInCopperMiss = async S => {
  const coalAt = CHESTS[1]
  const w = town({ coalAt, copperMissAt: [coalAt] })                         // "no copper" there for 2 h (it has none)
  const r = await job(S, w)
  assert.equal(r.stop, 'no_furnace', `the coal was found and the job went on to the furnace: ${r.status} ${r.stop} ${r.detail}`)
  assert.ok(w.spy.opened.includes(kOf(coalAt)), `the coal pass looked in the copper-missed container: ${w.spy.opened}`)
  assert.match(lastRow(), /stop=no_furnace .*withdrawn=8 coal=1 /, lastRow())
  // the exit gives back what the town lent (no furnace): the copper and the coal both back, nothing dropped
  assert.equal(count(chest(w, COPPER), 'raw_copper'), 8)
  assert.equal(CHESTS.reduce((n, c) => n + count(chest(w, c), 'coal'), 0), 4, 'the town coal back in town (the return banks it where the job banks)')
  assert.equal(count(w.bag, 'coal'), 0)
  assert.equal(w.dropped.length, 0)
}
await t('COAL IN A "NO COPPER" CONTAINER (coordinator 10-19): the coal is its own need -- the job finds it and goes on to the furnace (base: no_fuel)', async () => {
  await coalInCopperMiss(S0)
})
// THE CAP: coal only in the container 7th nearest the bot (no marks); the base's 3 containers never reached it
const coalFar = async S => {
  const coalAt = CHESTS[8]
  const w = town({ coalAt })
  const r = await job(S, w)
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  const looked = Number((lastRow().match(/ looked=(\d+)/) || [])[1])
  assert.ok(looked > 3, `the search looked in more than the base's 3: ${lastRow()}`)
  assert.ok(w.spy.opened.includes(kOf(coalAt)), 'the far coal container was opened')
}
await t('THE CAP: coal only in a far container -- the coal pass reaches it (more than the base\'s 3 containers)', async () => {
  await coalFar(S0)
})
// NO COAL ANYWHERE: job 1 takes the copper, looks everywhere for coal, says no_fuel and puts the copper back; job 2 looks only
// where something changed -- the copper chest, whose coal miss the copper's own deposit ended (no re-note: it could hide a
// coal another bot put there meanwhile, Codex r2 P2) -- and a coal deposit anywhere re-opens the search
const noCoalAnywhere = async S => {
  const w = town()
  const r1 = await job(S, w)
  assert.equal(r1.stop, 'no_fuel', `${r1.status} ${r1.stop} ${r1.detail}`)
  assert.equal(count(chest(w, COPPER), 'raw_copper'), 8, 'the copper went back')
  assert.equal(new Set(w.spy.opened).size, CHESTS.length, 'every container looked in for coal')
  later(SJ.SMELT_JOB_COOLDOWN_MS)
  const n0 = w.spy.opened.length, row0 = RECS.length
  const r2 = await job(S, w)
  assert.equal(r2.stop, 'no_fuel', `${r2.status} ${r2.stop} ${r2.detail}`)
  assert.ok(w.spy.opened.slice(n0).every(k => k === kOf(COPPER)), `the next job looks only in the chest that took items: ${w.spy.opened.slice(n0)}`)
  assert.match(RECS.slice(row0).filter(x => x?.skill?.name === '_smelt_town').at(-1)?.skill?.detail ?? '', /stop=no_fuel /)
  // a deposit of coal into any container ends its miss: the job runs again and finds it
  w.stock(...CHESTS[5], [stack('coal', 3)])
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => { e[kOf(CHESTS[5])] = { o: 'took', at: Date.now() } })
  later(SJ.SMELT_JOB_COOLDOWN_MS)
  const r3 = await job(S, w)
  assert.equal(r3.stop, 'no_furnace', `${r3.status} ${r3.stop} ${r3.detail}`)
}
await t('NO COAL ANYWHERE: no_fuel and the copper back; the next job looks only in the chest the copper went back into; a coal deposit re-opens the search', async () => {
  await noCoalAnywhere(S0)
})
// THE PRECHECK: every town container is a live coal miss -> no_fuel at once: the town's copper is NOT taken only to be put back
// (489 of 516 no_fuel jobs did that, 10-19), nothing is opened
const precheck = async S => {
  const w = town()
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.noteItemMisses(e, SJ.COAL_MISS_KEY, SJ.COAL_MISS_TTL_MS, CHESTS.map(kOf)))
  const r = await job(S, w)
  assert.equal(r.stop, 'no_fuel', `${r.status} ${r.stop} ${r.detail}`)
  assert.match(lastRow(), /withdrawn=0 coal=0 .* looked=0 /, 'no copper taken, nothing looked in: ' + lastRow())
  assert.equal(w.spy.opened.length, 0); assert.equal(count(chest(w, COPPER), 'raw_copper'), 8)
  // CONTROL: one container not a coal miss -> it is looked in
  const w2 = town({ bag: [stack('raw_copper', 5), stack('cobblestone', 3)], coalAt: CHESTS[7] })
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.noteItemMisses(e, SJ.COAL_MISS_KEY, SJ.COAL_MISS_TTL_MS, CHESTS.filter(c => c !== CHESTS[7]).map(kOf)))
  const r2 = await job(S, w2)
  assert.equal(r2.stop, 'no_furnace', `${r2.status} ${r2.stop} ${r2.detail}`)
}
await t('THE PRECHECK: every container a live COAL miss (its own 2 h key) -> no_fuel, no copper taken, nothing opened; CONTROL: one coal holder unmarked -> found', async () => {
  await precheck(S0)
})
// A PASS THAT LEARNED NOTHING is search_stalled (a strike), not search_more: 130 s left on the clock -- the copper pass keeps
// 120 s for the smelt, so no visit starts
const stalled = async S => {
  const w = town()
  const r = await S.SKILLS.smelt_town.run({ bot: w.bot, runner: { current: { startedAt: Date.now() - 50_000 } } }, {}, sig())
  assert.equal(r.stop, SJ.SMELT_SEARCH_STALLED, `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(w.spy.opened.length, 0)
}
await t('NO PROGRESS: a copper pass that could start no visit (the smelt\'s reserve) is search_stalled -- a strike -- never search_more', async () => {
  await stalled(S0)
})
await t('THE SMELT KEEPS INSIDE THE JOB\'S CLOCK (WIRING, structural, comments stripped: the fake world has no working furnace, so the deadline cannot reach a real batch here -- the guard before it is behaviour-tested below and the Paper scene smelts): smelt_town hands smelt the skill\'s deadline less the bank reserve, and smeltInner takes the earlier of its own cap and that', () => {
  const src = readFileSync(SKILLS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
  assert.match(src, /const smeltDeadline = withdrawClock\(ctx\)\.deadline - SMELT_BANK_RESERVE_MS\n/)
  assert.match(src, /by: 'smelt_town', deadline: smeltDeadline \}\)/)
  assert.match(src, /const deadline = Math\.min\(Date\.now\(\) \+ SMELT_DEADLINE_MS, Number\.isFinite\(session\.opts\?\.deadline\) \? session\.opts\.deadline : Infinity\)/)
  assert.equal((src.match(/budgetMs: Math\.max\(0, deadline - Date\.now\(\)\)/g) ?? []).length, 2, 'both plans sized to what is left')
})
// THE SMELT'S CLOCK BACKSTOP (Codex r3 P2): the search found the coal but the clock moved 70 s during it -> the smelt is NOT
// started with < SMELT_MIN_SMELT_MS; the copper and coal go back, stop=smelt_late (accounted as search_more). CONTROL: no jump -> past the guard.
const lateSmelt = async (S, jump) => {
  const coalAt = CHESTS[3]
  const w = town({ coalAt })
  w.set(1, 64, -1, 'furnace')                                               // a furnace in reach: past the furnace check
  const goto = w.bot.pathfinder.goto
  let jumped = false
  w.bot.pathfinder.goto = async g => { if (jump && !jumped && g.x === coalAt[0] && g.z === coalAt[2]) { jumped = true; later(70_000) } return goto(g) }
  const n0 = RECS.length
  let r
  // the RUNNER's clock (runner.current.startedAt): without it every withdrawClock call starts a fresh 180 s
  try { r = await S.SKILLS.smelt_town.run({ bot: w.bot, runner: { current: { startedAt: Date.now() } } }, {}, sig()) } catch (e) { r = { stop: `threw:${e?.message}` } }
  const row = RECS.slice(n0).filter(x => x?.skill?.name === '_smelt_town').at(-1)?.skill?.detail ?? ''
  return { r, row, w, coalAt }
}
await t('THE SMELT\'S CLOCK BACKSTOP (Codex r3 P2): the search took the clock -> no smelt started, the copper and coal go back, smelt_late; CONTROL: on time -> the guard passes', async () => {
  const { r, row, w, coalAt } = await lateSmelt(S0, true)
  assert.equal(r.stop, SJ.SMELT_LATE, `${r.status} ${r.stop} ${r.detail}`)
  assert.match(row, /withdrawn=8 coal=1 /, row)
  assert.equal(count(chest(w, COPPER), 'raw_copper'), 8); assert.equal(CHESTS.reduce((n, c) => n + count(chest(w, c), 'coal'), 0), 4)
  void coalAt
  const ctl = await lateSmelt(S0, false)
  assert.notEqual(ctl.r.stop, SJ.SMELT_LATE, `CONTROL: ${ctl.r.stop} ${ctl.row}`)
  assert.equal(SJ.smeltTownOutcome('no_effect', SJ.SMELT_LATE, 1e12, {}).streak ?? null, null, 'smelt_late strikes no streak (as search_more)')
})
// THE DRY-JOB BOUND through the REAL order and outcome (Codex r4 P2's sequence): jobs 10 min apart, the order deciding
// admission, the outcome its state -- the capped churn AND the mixed one pause within SMELT_DRY_MAX admitted dry jobs
const dryRun = (SJm, reasons, n = 40) => {
  let s = {}, t = 1e12, admitted = 0, pausedAt = null
  for (let i = 0; i < n && pausedAt == null; i++, t += 600_001) {
    const o = SJm.smeltTownOrder({ now: t, atTown: true, freeSlots: 5, held: {}, townMiss: false, state: s })
    s = o.state
    if (!o.order) { if (o.skip === 'paused') pausedAt = admitted; continue }
    admitted++
    const why = reasons[(admitted - 1) % reasons.length]
    s = SJm.smeltTownOutcome(why === 'done' ? 'success' : 'no_effect', why, t, s)
  }
  return { admitted, pausedAt }
}
const dryBound = SJm => {
  const capped = dryRun(SJm, ['search_more'])
  assert.ok(capped.pausedAt != null && capped.pausedAt <= SJm.SMELT_DRY_MAX, `capped churn: ${JSON.stringify(capped)}`)
  const mixed = dryRun(SJm, ['search_more', 'search_more', 'search_more', 'no_fuel', 'search_more', 'search_more', 'search_more', 'search_stalled'])
  assert.ok(mixed.pausedAt != null && mixed.pausedAt <= SJm.SMELT_DRY_MAX, `mixed reasons (Codex r4 P2): ${JSON.stringify(mixed)}`)
}
await t(`THE DRY-JOB BOUND: through the real smeltTownOrder/smeltTownOutcome, the capped search_more churn AND a mixed sequence (search_more x3, no_fuel, search_more x3, search_stalled) pause within ${SJ.SMELT_DRY_MAX} admitted jobs; a success resets the count`, () => {
  dryBound(SJ)
  const ok = dryRun(SJ, [...Array.from({ length: SJ.SMELT_DRY_MAX - 1 }, () => 'search_more'), 'done'], SJ.SMELT_DRY_MAX * 2)
  assert.equal(ok.pausedAt, null, `a success every ${SJ.SMELT_DRY_MAX} jobs never pauses: ${JSON.stringify(ok)}`)
})
await t('smeltTownOutcome: a success resets the `more` streak (the cap counts CONSECUTIVE search_more; Codex r3 P3)', () => {
  let s = {}
  for (let i = 0; i < SJ.SMELT_MORE_MAX; i++) s = SJ.smeltTownOutcome('no_effect', SJ.SMELT_SEARCH_MORE, 1e12, s)
  s = SJ.smeltTownOutcome('success', 'done', 1e12, s)
  s = SJ.smeltTownOutcome('no_effect', SJ.SMELT_SEARCH_MORE, 1e12, s)
  assert.equal(s.backoffUntil ?? 0, 0)
})
/** A world whose lid digs work (toolkit.test.mjs's lidReady): a pickaxe harvests stone-like lids, the hand digs dirt. */
const lidReady = w => {
  const PICKS = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe'].map(n => w.bot.registry.itemsByName[n]?.id).filter(x => x != null)
  const blockAt0 = w.bot.blockAt
  w.bot.blockAt = p => { const b = blockAt0(p); if (b?.name === 'cobblestone') b.canHarvest = id => PICKS.includes(id); if (b?.name === 'dirt' || b?.name === 'grass_block') b.canHarvest = () => true; if (b?.name === 'chest') b.shapes = [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]]; return b }
  w.bot.digTime = () => 750
  w.bot.canDigBlock = () => true
  w.digs = []
  w.bot.dig = async b => { w.digs.push(w.key(b.position.x, b.position.y, b.position.z)); w.set(b.position.x, b.position.y, b.position.z, 'air') }
  return w
}
// TOOLKIT-03 x COBBLEKEEP-01 (lids): the COAL pass goes through the same lid code -- the only coal under a dirt lid is dug out
// and found; under an oak_planks lid the container is blocked, the pass moves on, and with no other coal the job says no_fuel
await t('LIDS x COBBLEKEEP: coal under a dirt lid -> dug, found (past the fuel check); under oak_planks -> blocked, the pass moves on, no_fuel; nothing dropped', async () => {
  const coalAt = CHESTS[3]
  const scene = async lid => {
    const w = lidReady(town({ coalAt }))
    w.set(coalAt[0], coalAt[1] + 1, coalAt[2], lid)
    const r = await job(S0, w)
    return { w, r }
  }
  const d = await scene('dirt')
  assert.equal(d.r.stop, 'no_furnace', `${d.r.status} ${d.r.stop} ${d.r.detail}`); assert.deepEqual(d.w.digs, [kOf([coalAt[0], coalAt[1] + 1, coalAt[2]])])
  const p = await scene('stone')   // lidplank-01: unrecorded planks may be dug now; stone never
  assert.equal(p.r.stop, 'no_fuel', `${p.r.status} ${p.r.stop} ${p.r.detail}`); assert.deepEqual(p.w.digs, [])
  assert.equal(count(chest(p.w, coalAt), 'coal'), 4, 'the blocked chest kept its coal'); assert.equal(count(chest(p.w, COPPER), 'raw_copper'), 8)
  assert.equal(p.w.dropped.length, 0)
})
await t('CARRIED COPPER: the bag\'s own copper skips the copper pass; the coal pass alone finds the coal (in a copper-missed container)', async () => {
  const coalAt = CHESTS[3]
  const w = town({ coalAt, copperMissAt: CHESTS.map(c => c), bag: [stack('raw_copper', 5), stack('cobblestone', 3)] })
  const r = await job(S0, w)
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  assert.ok(!w.spy.opened.includes(kOf(COPPER)) || w.spy.opened.indexOf(kOf(coalAt)) >= 0, 'the coal found')
  assert.match(lastRow(), /withdrawn=0 coal=1 /, lastRow())
})

// ---- the gate is the search ----------------------------------------------------------------------------------------
const gateAgrees = async S => {
  const w = town()
  for (const c of CHESTS) w.stock(...c, [stack('dirt', 5)])                  // no copper anywhere
  const keys = CHESTS.map(kOf)
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.noteItemMisses(e, SJ.COPPER_MISS_KEY, SJ.COPPER_MISS_TTL_MS, keys.slice(1)))
  assert.equal(S.townCopperMiss(w.bot), false, 'one container not yet looked in')
  // ...and the town shut that one (an unusable container: the search never opens it)
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => { e[keys[0]] = { o: 'unknown', at: Date.now(), unusableUntil: Date.now() + 3_600_000 } })
  assert.equal(S.townCopperMiss(w.bot), true, 'the search has no candidate: the gate agrees (no order that opens nothing)')
  const r = await job(S, w)
  assert.equal(r.stop, 'town_has_none', `${r.status} ${r.stop} ${r.detail}`); assert.equal(w.spy.opened.length, 0)
}
await t('THE GATE IS THE SEARCH: every container a copper miss but one the town shut -> townCopperMiss true (no order that opens nothing); CONTROL: one still searchable -> false', async () => {
  await gateAgrees(S0)
})
await t('A COPPER SEARCH CUT BY ITS BUDGET with candidates left: stop=search_more (never town_has_none), no strike toward the 6-in-a-row pause', async () => {
  const w = town()
  for (const c of CHESTS) w.stock(...c, [stack('dirt', 5)])
  for (let x = -12; x <= 12; x += 3) for (let z = -12; z <= 12; z += 3) {
    if (Math.hypot(x, z) > 13 || CHESTS.some(c => c[0] === x && c[2] === z) || (x === 6 && z === 0)) continue
    w.set(x, 64, z, 'chest'); w.stock(x, 64, z, [stack('dirt', 5)])
  }
  ironDone(w)
  const r = await job(S0, w)
  assert.equal(r.stop, SJ.SMELT_SEARCH_MORE, `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(w.spy.opened.length, SJ.SMELT_COPPER_VISITS)
  assert.match(lastRow(), / looked=12 more=cu( |$)/, lastRow())
  const streak = SJm => {
    let s = {}
    for (let i = 0; i < SJm.SMELT_MORE_MAX; i++) { s = SJm.smeltTownOutcome('no_effect', SJm.SMELT_SEARCH_MORE, 1e12, s); assert.equal(s.backoffUntil ?? 0, 0, `more #${i + 1}`) }
    s = SJm.smeltTownOutcome('no_effect', SJm.SMELT_SEARCH_MORE, 1e12, s)
    assert.equal(s.backoffUntil, 1e12 + SJm.SMELT_JOB_BACKOFF_MS, `the ${SJm.SMELT_MORE_MAX + 1}th in a row backs off (Codex r2 P2)`)
    assert.equal(s.pausedUntil ?? 0, 0, 'and never pauses the job')
  }
  streak(SJ)
  globalThis.__smeltStreak = streak
  let s2 = {}
  for (let i = 0; i < SJ.SMELT_JOB_PAUSE_AFTER; i++) s2 = SJ.smeltTownOutcome('no_effect', 'town_has_none', Date.now(), s2)
  assert.ok(s2.pausedUntil > 0, 'CONTROL: six town_has_none in a row still pause it')
})
await t('missTtlOf: a number is every need\'s TTL; a map names a need\'s own, SEARCH_MISS_TTL_MS for the rest', async () => {
  const W = await import('../src/withdrawpick.mjs')
  assert.equal(W.missTtlOf(5, 'coal'), 5)
  assert.equal(W.missTtlOf({ raw_copper: 7 }, 'raw_copper'), 7)
  assert.equal(W.missTtlOf({ raw_copper: 7 }, 'coal'), W.SEARCH_MISS_TTL_MS)
  // the order honours it: a 90-min-old copper miss is live at a 2 h TTL, dead at the default
  const now = 1e12, C = [{ k: 'a', d: 1 }]
  assert.deepEqual(W.townSearchOrder(C, ['raw_copper'], { now, misses: { raw_copper: { a: now - 90 * 60_000 } }, missTtl: { raw_copper: 2 * 3_600_000 } }), [])
  assert.equal(W.townSearchOrder(C, ['raw_copper'], { now, misses: { raw_copper: { a: now - 90 * 60_000 } } }).length, 1)
})

// ---- mutants --------------------------------------------------------------------------------------------------------
await t('MUTANTS: each removes one part of the job\'s search and a behaviour test above fails for it', async () => {
  const kills = {}
  // the coordinator's cause (2): the coal looked for over the copper's container list
  kills.coalOnCopperList = await withMutant(SKILLS_PATH, 'out.coalMore = !!(await pass(SMELT_JOB_FUEL, SMELT_COAL_VISITS, SMELT_COAL_RESERVE_MS, () => needCoal > 0))',
    'out.coalMore = !!(await pass(SMELT_JOB_INPUT, SMELT_COAL_VISITS, SMELT_COAL_RESERVE_MS, () => needCoal > 0))', S => killedBy(() => coalInCopperMiss(S)))
  // cause (1): three containers
  kills.coalCap3 = await withMutant(SKILLS_PATH, 'pass(SMELT_JOB_FUEL, SMELT_COAL_VISITS,', 'pass(SMELT_JOB_FUEL, 2,', S => killedBy(() => coalFar(S)))
  kills.noPrecheck = await withMutant(SKILLS_PATH, 'if (needCoal > 0 && townCoalMiss(bot)) { out.noCoal = true; return out }', '', S => killedBy(() => precheck(S)))
  kills.noStalled = await withMutant(SKILLS_PATH, "f.stop = w.progressed ? SMELT_SEARCH_MORE : SMELT_SEARCH_STALLED\n        return (result = { status: 'no_effect', detail: `no raw copper",
    "f.stop = SMELT_SEARCH_MORE\n        return (result = { status: 'no_effect', detail: `no raw copper", S => killedBy(() => stalled(S)))
  kills.noStreakCap = await withMutant(SJ_PATH, '    if (s.moreStreak <= SMELT_MORE_MAX) return s', '    return s', SJm => killedBy(() => globalThis.__smeltStreak(SJm)))
  kills.oldGate = await withMutant(SKILLS_PATH, 'try { return townSearchEmpty(bot, [SMELT_JOB_INPUT], { missTtl: { [SMELT_JOB_INPUT]: COPPER_MISS_TTL_MS }, tried: jobRuledOut(bot, SMELT_JOB_INPUT).keys }) } catch { return false }',
    `try {
    const home = homeVec()
    const found = bot.findBlocks?.({ point: home, maxDistance: TOWN_SCAN_RADIUS, count: 256,
      matching: b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name) && (!b.position || inTown(home, b.position)) }) ?? []
    return townItemMissComplete(readTownMemory(townDir(), homeTownKey(), bot.worldId ?? null), COPPER_MISS_KEY, COPPER_MISS_TTL_MS, found.map(posKey))
  } catch { return false }`, S => killedBy(() => gateAgrees(S)))
  kills.noSmeltGuard = await withMutant(SKILLS_PATH, 'if (smeltDeadline - Date.now() < SMELT_MIN_SMELT_MS) {', 'if (false) {', S => killedBy(async () => {
    const { r } = await lateSmelt(S, true)
    assert.equal(r.stop, SJ.SMELT_LATE)
  }))
  kills.noDryBound = await withMutant(SJ_PATH, '    if (s.dry >= SMELT_DRY_MAX) {', '    if (false) {', SJm => killedBy(() => dryBound(SJm)))
  kills.moreStrikes = await withMutant(SJ_PATH, '  if (why === SMELT_SEARCH_MORE || why === SMELT_LATE) {', '  if (false) {', SJm => killedBy(() => globalThis.__smeltStreak(SJm)))
  const alive = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(alive, [], `mutants that survived: ${alive}`)
  console.log(`        mutants killed: ${Object.keys(kills).join(', ')}`)
})

Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
