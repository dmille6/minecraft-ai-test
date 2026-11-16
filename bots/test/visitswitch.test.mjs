// VISITSWITCH (one trunk, control session 11-16; docs/reports/trunk-merge-2026-11-16/DECISIONS.md rows 5 and 6): TWO VISIT
// BEHAVIOURS DEFAULT BY POOL. buildretry-01's ledger and default deferral (BUILDRETRY, buildretry.mjs buildRetryOn) and the in-visit
// waiver (VISIT_WAIVER, stuckcells.mjs visitWaiverOn) are OFF by default in the showcase pool -- that line never had them, and its
// tests pin the visit's stops without them -- and ON in every other pool, as the fleet has them; the env name overrides either way.
// Pure functions first (the default by pool, the override both ways, each default killed by a mutant that flips it); then what the
// switch reaches: the engine's ledger (buildrun.mjs retryStart), the visit's options (stuckcells.mjs visitOpts), the option the
// engine reads (runVisit); then the wiring (the spawn row, the suite's default), structural.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const RT = await import('../src/buildretry.mjs')
const SC = await import('../src/stuckcells.mjs')
const R = await import('../src/buildrun.mjs')
const RT_PATH = new URL('../src/buildretry.mjs', import.meta.url)
const SC_PATH = new URL('../src/stuckcells.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
// bots/test/climb-escape.test.mjs's withMutant (it is not exported there): the anchor asserted PRESENT and UNIQUE -- a mutant that
// was never written reads as killed
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${file.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
/** Run `fn` with exactly these of the three names set (the others unset), the process's own restored after. */
const withEnv = async (vars, fn) => {
  const names = ['MEMORY_POOL', 'BUILDRETRY', 'VISIT_WAIVER']
  const was = Object.fromEntries(names.map(k => [k, process.env[k]]))
  for (const k of names) { if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k] }
  try { return await fn() } finally { for (const k of names) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k] } }
}
const DEFAULT_LINE = "  return String(env?.MEMORY_POOL ?? '').trim() !== 'showcase'"
const FLIPPED_LINE = "  return String(env?.MEMORY_POOL ?? '').trim() === 'showcase'"

console.log('THE SWITCHES (pure): the default by pool, the env name either way')
const table = (fn, name) => {
  // the default: the showcase pool off, every other pool on -- a fleet pool, no pool named at all, another spelling
  assert.strictEqual(fn({ MEMORY_POOL: 'showcase' }), false, 'showcase: off')
  assert.strictEqual(fn({ MEMORY_POOL: ' showcase ' }), false, 'showcase, padded: off')
  for (const pool of ['hive', 'hive-a', 'board-c', 'isolated-d', 'placebo-b', 'showcase2', 'Showcase']) assert.strictEqual(fn({ MEMORY_POOL: pool }), true, `${pool}: on`)
  assert.strictEqual(fn({}), true, 'no pool named: on (config.mjs: the pool is then `hive`)')
  // the override, both ways, in either kind of pool
  for (const v of ['on', '1', 'true', 'yes', ' ON ']) assert.strictEqual(fn({ MEMORY_POOL: 'showcase', [name]: v }), true, `showcase + ${name}=${v}: on`)
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(fn({ MEMORY_POOL: 'hive-a', [name]: v }), false, `fleet + ${name}=${v}: off`)
  for (const v of ['off', '0']) assert.strictEqual(fn({ [name]: v }), false, `no pool + ${name}=${v}: off`)
  // anything else is no answer: the pool decides
  for (const v of ['', 'maybe', 'default']) { assert.strictEqual(fn({ MEMORY_POOL: 'showcase', [name]: v }), false, `showcase + ${name}=${JSON.stringify(v)}`); assert.strictEqual(fn({ MEMORY_POOL: 'hive', [name]: v }), true, `fleet + ${name}=${JSON.stringify(v)}`) }
}
await t('buildRetryOn (BUILDRETRY): off by default in the showcase pool, on in every other; on|off overrides either way -- MUTANT (the default flipped) killed',
  () => killedBy(RT_PATH, RT, DEFAULT_LINE, FLIPPED_LINE, M => table(M.buildRetryOn, 'BUILDRETRY')))
await t('visitWaiverOn (VISIT_WAIVER): off by default in the showcase pool, on in every other; on|off overrides either way -- MUTANT (the default flipped) killed',
  () => killedBy(SC_PATH, SC, DEFAULT_LINE, FLIPPED_LINE, M => table(M.visitWaiverOn, 'VISIT_WAIVER')))
await t('the row says where each answer came from (env | pool)', () => {
  assert.strictEqual(RT.buildRetryWhy({ MEMORY_POOL: 'showcase' }), 'pool'); assert.strictEqual(RT.buildRetryWhy({ BUILDRETRY: 'off' }), 'env'); assert.strictEqual(RT.buildRetryWhy({ BUILDRETRY: 'maybe' }), 'pool')
  assert.strictEqual(SC.visitWaiverWhy({}), 'pool'); assert.strictEqual(SC.visitWaiverWhy({ VISIT_WAIVER: 'on' }), 'env')
  assert.strictEqual(SC.visitSwitchDetail({ retry: false, retryWhy: 'pool', waiver: true, waiverWhy: 'env', pool: 'showcase' }), 'buildretry=0 (pool) visit_waiver=1 (env) pool=showcase')
})

console.log('WHAT THE SWITCHES REACH (the process env, restored after)')
const REC = { v: 1, plot: 'shop', blueprint: 'workshop@1', cells: [{ at: [1, 70, 1], role: 'fill', seg: 'earth' }], clear: [], segments: [{ seg: 'earth', deps: [] }] }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visitswitch-'))
const fakeE = { now: () => 1_800_000_000_000, read: () => null, log: () => {} }
await t('the ledger (buildrun.mjs retryStart): none in the showcase pool -- nothing read, held or deferred by it -- one in a fleet pool; BUILDRETRY either way', async () => {
  const p = { dir, key: 'project-0_70_0.shop', me: 'A', record: REC }
  await withEnv({ MEMORY_POOL: 'showcase' }, () => assert.strictEqual(R.retryStart(p, fakeE), null, 'showcase: no ledger'))
  await withEnv({ MEMORY_POOL: 'hive-a' }, () => assert.ok(R.retryStart(p, fakeE)?.held instanceof Set, 'fleet: a ledger'))
  await withEnv({}, () => assert.ok(R.retryStart(p, fakeE), 'no pool named: a ledger'))
  await withEnv({ MEMORY_POOL: 'showcase', BUILDRETRY: 'on' }, () => assert.ok(R.retryStart(p, fakeE), 'showcase forced on'))
  await withEnv({ MEMORY_POOL: 'hive-a', BUILDRETRY: 'off' }, () => assert.strictEqual(R.retryStart(p, fakeE), null, 'fleet forced off'))
})
await t('the visit\'s options (stuckcells.mjs visitOpts): {} in the showcase pool; the waiver, the done rule and the blocked deferral in a fleet pool; VISIT_WAIVER either way', async () => {
  await withEnv({ MEMORY_POOL: 'showcase' }, () => { assert.deepStrictEqual(SC.visitOpts(REC, 'shop'), {}); assert.deepStrictEqual(SC.visitOpts(REC, 'zig', () => false), {}) })
  await withEnv({ MEMORY_POOL: 'board-c' }, () => {
    const o = SC.visitOpts(REC, 'shop')
    assert.deepStrictEqual(Object.keys(o).sort(), ['alsoDone', 'blockedDefers', 'waive']); assert.strictEqual(o.waive.max, SC.WAIVE_MAX_SHOP)
    assert.deepStrictEqual(Object.keys(SC.visitOpts(REC, 'zig', () => false)).sort(), ['alsoDone', 'footing', 'waive'])
  })
  await withEnv({ MEMORY_POOL: 'showcase', VISIT_WAIVER: 'on' }, () => assert.ok(SC.visitOpts(REC, 'shop').waive, 'showcase forced on'))
  await withEnv({ MEMORY_POOL: 'board-c', VISIT_WAIVER: 'off' }, () => assert.deepStrictEqual(SC.visitOpts(REC, 'shop'), {}, 'fleet forced off'))
  await withEnv({ MEMORY_POOL: 'board-c' }, () => assert.deepStrictEqual(SC.visitOpts(REC, 'shop', null, false), {}, 'STUCKCELLS off is still off'))
})

console.log('THE WIRING (structural: comments stripped, each line present once)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const once = (src, line, what) => assert.strictEqual(src.split(line).length, 2, `${what}: ${src.split(line).length - 1} time(s): ${line.slice(0, 70)}`)
await t('runVisit drops `p.waive` where the waiver is off and reads the ledger through buildRetryOn; the spawn row is in features.mjs, not index.mjs; the suite\'s default is off', () => {
  const run = strip(readFileSync(new URL('../src/buildrun.mjs', import.meta.url), 'utf8'))
  once(run, 'if (p?.waive && !visitWaiverOn()) p = { ...p, waive: null }', 'the engine\'s gate')
  once(run, 'if (!RT.buildRetryOn() || p?.retry === false || !p?.dir || !p?.key) return null', 'the ledger\'s gate')
  const feat = strip(readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8'))
  once(feat, "logEvent({ kind: 'visitswitch_mode', status: 'success', snapshot: snapshot(bot), detail: visitSwitchDetail({ retry: buildRetryOn(), retryWhy: buildRetryWhy(), waiver: visitWaiverOn(), waiverWhy: visitWaiverWhy(), pool: process.env.MEMORY_POOL ?? '' }) })", 'the spawn row')
  assert.ok(!/visitswitch|visitWaiverOn|buildRetryOn/.test(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')), 'nothing of it in index.mjs (protected)')
  const runner = readFileSync(new URL('../scripts/run-tests.mjs', import.meta.url), 'utf8')
  once(runner, "BUILDRETRY: process.env.BUILDRETRY ?? 'off',", 'the suite\'s default'); once(runner, "VISIT_WAIVER: process.env.VISIT_WAIVER ?? 'off',", 'the suite\'s default')
})


// ---- THREE MORE DECISIONS THAT DEFAULT BY POOL (DECISIONS.md rows 2, 3 and 4), the same convention: off in the showcase pool, on
// in every other, the env name either way, the suite's default off, and the default killed by the mutant that flips it ----------
console.log('ROW 3: the fleet\'s band dispose (IDLEWORK_WELL, well.mjs wellBandOn) beside bagroom-01\'s well (BAGROOM_WELL)')
const WL = await import('../src/well.mjs')
const WL_PATH = new URL('../src/well.mjs', import.meta.url)
await t('wellBandOn (IDLEWORK_WELL): off by default in the showcase pool, on in every other; on|off overrides either way -- MUTANT (the default flipped) killed',
  () => killedBy(WL_PATH, WL, DEFAULT_LINE, FLIPPED_LINE, M => table(M.wellBandOn, 'IDLEWORK_WELL')))
await t('what it reaches (well.mjs wellOrder at 30 of 36 slots, bagroom\'s own rule off): no order in the showcase pool -- the showcase line exactly -- the dispose in a fleet pool; 34 slots and 28 slots are the same in both', () => {
  const at = (env, x = {}) => WL.wellOrder({ now: 10_000_000, distHome: 5, well: { open: false, attended: false }, slots: 30, freeSlots: 6, junkStacks: 3, bagRoom: false, bandOn: WL.wellBandOn(env), ...x }).order
  assert.strictEqual(at({ MEMORY_POOL: 'showcase' }), null, 'showcase: below 34 nothing')
  assert.strictEqual(at({ MEMORY_POOL: 'hive-a' })?.skill, 'dispose_well', 'fleet: the band')
  assert.strictEqual(at({})?.skill, 'dispose_well', 'no pool named: the band')
  assert.strictEqual(at({ MEMORY_POOL: 'showcase', IDLEWORK_WELL: 'on' })?.skill, 'dispose_well', 'showcase forced on')
  assert.strictEqual(at({ MEMORY_POOL: 'hive-a', IDLEWORK_WELL: 'off' }), null, 'fleet forced off')
  // the two switches are two: bagroom's rule alone gives the order in the showcase pool, and only then is the order's sentence bagroom's
  assert.match(at({ MEMORY_POOL: 'showcase' }, { bagRoom: true }).why, /bagroom: the build needs the room/)
  assert.ok(!/bagroom/.test(at({ MEMORY_POOL: 'hive-a' }).why), 'the band\'s order does not say bagroom')
  // POSITIVE CONTROLS on the same call: the 34-slot order in both pools, and nothing at 28 in both
  for (const env of [{ MEMORY_POOL: 'showcase' }, { MEMORY_POOL: 'hive-a' }]) {
    assert.strictEqual(at(env, { slots: 34, freeSlots: 2 })?.skill, 'dispose_well'); assert.strictEqual(at(env, { slots: 28, freeSlots: 8 }), null)
  }
})
await t('wiring: the order reads the band through its own option beside bagroom\'s; the suite\'s default is off', () => {
  const well = strip(readFileSync(WL_PATH, 'utf8'))
  once(well, 'bagRoom = BAGROOM.well, bandOn = WELL_BAND.on } = {}) {', 'the two options')
  once(well, '(slots >= TRIGGER_SLOTS || wellBandDue({ on: bandOn, slots, junkStacks }))', 'the band\'s rule'); once(well, '(slots >= TRIGGER_SLOTS || wellRoomDue({ on: bagRoom, freeSlots, junkStacks }))', 'bagroom\'s rule')
  once(readFileSync(new URL('../scripts/run-tests.mjs', import.meta.url), 'utf8'), "IDLEWORK_WELL: process.env.IDLEWORK_WELL ?? 'off',", 'the suite\'s default')
  // the VISIT's part (skills.mjs disposeWell; idlework2.test.mjs anchors the fleet's three lines): the same switch, never a hall
  // clerk's throw, and the clerk's entry plan still reads its own keep -- with the band off both lines are the showcase's
  const skills = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  once(skills, '  const band = visit && WELL_BAND.on && slotsBefore >= WELL_BAND_SLOTS && !clerk\n', 'the visit\'s band')
  once(skills, '  const entry = only ? disposePlan(items(), { keep: keepOf(items()) }) : entryPlan\n', 'the clerk\'s entry plan')
})

console.log('ROW 4: escdead-01 (b)\'s craft-room relaxation (CRAFTSPARE, craftroom.mjs craftSpareOn) beside the showcase\'s rebuild rule')
/** Run `fn` with exactly these of `names` set in the process env (the others unset), the process's own restored after. */
const withVars = async (names, vars, fn) => {
  const was = Object.fromEntries(names.map(k => [k, process.env[k]]))
  for (const k of names) { if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k] }
  try { return await fn() } finally { for (const k of names) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k] } }
}
const CR = await import('../src/craftroom.mjs')
const CR_PATH = new URL('../src/craftroom.mjs', import.meta.url)
await t('craftSpareOn (CRAFTSPARE): off by default in the showcase pool, on in every other; on|off overrides either way -- MUTANT (the default flipped) killed',
  () => killedBy(CR_PATH, CR, DEFAULT_LINE, FLIPPED_LINE, M => table(M.craftSpareOn, 'CRAFTSPARE')))
await t('what it reaches (craftRoomRemedy on a full bag whose every pickaxe is on its last use): the showcase pool answers as the showcase line, a fleet pool as the fleet line; CRAFTSPARE either way; ESCDEAD off still rules', async () => {
  const pk = (name, left, max) => ({ name, count: 1, stackSize: 1, maxDurability: max, durabilityUsed: max - left })
  const full = head => [...head, ...Array.from({ length: 36 - head.length }, (_, i) => ({ name: `filler_${i}`, count: 64, stackSize: 64 }))].map((it, i) => ({ ...it, slot: 9 + i }))
  // hive-c-Bravo (the fleet's case): two iron pickaxes at 1 use, no wood, making planks. Frost (the showcase's): three at 1 use and
  // the whole of a stone pickaxe in the bag
  const bravo = full([pk('iron_pickaxe', 1, 250), pk('iron_pickaxe', 1, 250)])
  const frost = full([pk('stone_pickaxe', 1, 131), pk('iron_pickaxe', 1, 250), pk('iron_pickaxe', 1, 250), { name: 'cobblestone', count: 59, stackSize: 64 }, { name: 'spruce_planks', count: 4, stackSize: 64 }])
  const why = (bag, item, o = {}) => CR.craftRoomRemedy(bag, item, o)?.why ?? null
  const names = ['MEMORY_POOL', 'CRAFTSPARE']
  const showcase = () => {
    assert.strictEqual(why(bravo, 'oak_planks'), null, 'planks buy no pickaxe: the last swings stay')
    assert.strictEqual(why(frost, 'stone_pickaxe'), 'rebuild'); assert.strictEqual(why(frost, 'stick', { goal: 'stone_pickaxe' }), 'rebuild')
    assert.strictEqual(why(frost, 'furnace'), null, 'a furnace is not a way out')
  }
  const fleet = () => {
    assert.strictEqual(why(bravo, 'oak_planks'), 'spare', 'any craft may wear one copy while another stays')
    assert.strictEqual(why(frost, 'stone_pickaxe'), 'replaced'); assert.strictEqual(why(frost, 'furnace'), 'spare')
  }
  await withVars(names, { MEMORY_POOL: 'showcase' }, showcase)
  await withVars(names, { MEMORY_POOL: 'hive-c' }, fleet)
  await withVars(names, {}, fleet)
  await withVars(names, { MEMORY_POOL: 'showcase', CRAFTSPARE: 'on' }, fleet)
  await withVars(names, { MEMORY_POOL: 'hive-c', CRAFTSPARE: 'off' }, showcase)
  // the option still overrides the default either way (how each line's own tests ask), and a SOLE last swing is never the price in either
  await withVars(names, { MEMORY_POOL: 'showcase' }, () => assert.strictEqual(why(bravo, 'oak_planks', { escdead: true }), 'spare'))
  await withVars(names, { MEMORY_POOL: 'hive-c' }, () => {
    assert.strictEqual(why(bravo, 'oak_planks', { escdead: false }), null, 'ESCDEAD off: the whole piece, this part with it')
    assert.strictEqual(why(full([pk('iron_pickaxe', 1, 250)]), 'oak_planks'), null)
  })
})
await t('wiring: the remedy\'s default is escdead AND the pool switch, read at the call; the suite\'s default is off and the fleet\'s test sets it on', () => {
  once(strip(readFileSync(CR_PATH, 'utf8')), 'escdead = ESCDEAD_ON && craftSpareOn(), goal = null } = {}) {', 'the default')
  once(readFileSync(new URL('../scripts/run-tests.mjs', import.meta.url), 'utf8'), "CRAFTSPARE: process.env.CRAFTSPARE ?? 'off',", 'the suite\'s default')
  once(readFileSync(new URL('./escdead.test.mjs', import.meta.url), 'utf8'), "\nprocess.env.CRAFTSPARE = 'on'\n", 'the fleet line\'s test')
})

console.log('ROW 2: idlework-01 B\'s project stamp at the build order (UNSITEDWAIT, shop.mjs unsitedWaitOn) beside sinkfix-03\'s own-plot rule')
const SH = await import('../src/shop.mjs')
const SH_PATH = new URL('../src/shop.mjs', import.meta.url)
await t('unsitedWaitOn (UNSITEDWAIT): off by default in the showcase pool, on in every other; on|off overrides either way -- MUTANT (the default flipped) killed',
  () => killedBy(SH_PATH, SH, DEFAULT_LINE, FLIPPED_LINE, M => table(M.unsitedWaitOn, 'UNSITEDWAIT')))
await t('what it reaches (shop.mjs buildOrder, no record): the showcase pool holds on the bot\'s own no_site for the plot that failed (or an unknown one) and reads no stamp; a fleet pool holds on the project\'s stamp and reads no last stop; UNSITEDWAIT either way', async () => {
  const names = ['MEMORY_POOL', 'UNSITEDWAIT']
  const now = 1_800_000_000_000
  const base = { on: true, shared: true, atTown: true, planned: true, record: null, complete: false, freeSlots: 10, groundY: 70, feet: [2, 71, 0], now }
  const own = { lastStop: 'no_site', lastAt: now - 11 * 60_000 }, fresh = { lastAt: now - 11 * 60_000 }
  /** The order's skip (null: an order went out) with this active plot, this failed plot, this stamp on the active plot, this state. */
  const skip = (active, failed, stamp, state) => {
    SH.setActivePlot(() => active); SH.setNoSitePlot(() => failed); SH.setUnsitedOf(plot => (plot === active ? stamp : null))
    try { const r = SH.buildOrder({ ...base, state }); assert.ok(r.order || r.skip, 'an order or a named skip'); return r.order ? null : r.skip } finally { SH.setActivePlot(() => null); SH.setNoSitePlot(() => null); SH.setUnsitedOf(() => null) }
  }
  const showcase = () => {
    assert.strictEqual(skip('tower', null, null, own), 'no_site', 'an unknown failed plot holds (sinkfix3.test.mjs\'s control)')
    assert.strictEqual(skip('road', 'road', null, own), 'no_site', 'the plot that failed waits its day')
    assert.strictEqual(skip('tower', 'road', null, own), null, 'another plot is ordered')
    assert.strictEqual(skip('tower', 'road', now - 1000, fresh), null, 'a stamp is not read: nothing holds a bot with no no_site of its own')
  }
  const fleet = () => {
    assert.strictEqual(skip('tower', null, null, own), null, 'no stamp: the bot\'s own last stop holds nothing (shop.test.mjs S1 idlework-01 B)')
    assert.strictEqual(skip('tower', 'road', now - 1000, fresh), 'no_site', 'any bot\'s stamp holds the project')
    assert.strictEqual(skip('tower', 'road', now - SH.UNSITED_WAIT_MS - 1, own), null, 'the day is over')
  }
  await withVars(names, { MEMORY_POOL: 'showcase' }, showcase)
  await withVars(names, { MEMORY_POOL: 'board-a' }, fleet)
  await withVars(names, {}, fleet)
  await withVars(names, { MEMORY_POOL: 'showcase', UNSITEDWAIT: 'on' }, fleet)
  await withVars(names, { MEMORY_POOL: 'board-a', UNSITEDWAIT: 'off' }, showcase)
})
await t('wiring: the order\'s two rules are one if / else on the switch; the suite\'s default is off; the fleet line\'s tests turn it on', () => {
  const shop = strip(readFileSync(SH_PATH, 'utf8'))
  once(shop, '  if (!record && unsitedWaitOn()) {', 'the stamp rule')
  once(shop, "  } else if (!record && own.lastStop === 'no_site' && now - (own.lastAt ?? -Infinity) < SHOP_SITE_RETRY_MS && !prepClaimed(plot0) && siteRetryHolds(plot0, failedSite)) return { order: null, skip: 'no_site' }", 'the showcase\'s rule, whole')
  once(readFileSync(new URL('../scripts/run-tests.mjs', import.meta.url), 'utf8'), "UNSITEDWAIT: process.env.UNSITEDWAIT ?? 'off',", 'the suite\'s default')
  once(readFileSync(new URL('./idlework-sites.test.mjs', import.meta.url), 'utf8'), "\nprocess.env.UNSITEDWAIT = 'on'\n", 'the fleet line\'s test')
  once(readFileSync(new URL('./shop.test.mjs', import.meta.url), 'utf8'), "\n  process.env.UNSITEDWAIT = 'on'\n", 'the one fleet test in the showcase line\'s file')
})

console.log('ROW 7: snow on a build cell -- kept, never dug (SNOWKEEP, buildrun.mjs snowKeepOn) beside gkunblock-01\'s dig')
const BF = await import('./helpers/buildfake.mjs')
const R_PATH = new URL('../src/buildrun.mjs', import.meta.url)
await t('snowKeepOn (SNOWKEEP): off by default in the showcase pool, on in every other; on|off overrides either way -- MUTANT (the default flipped) killed',
  () => killedBy(R_PATH, R, DEFAULT_LINE, FLIPPED_LINE, M => table(M.snowKeepOn, 'SNOWKEEP')))
await t('what it reaches (buildrun.mjs runVisit, one fill cell holding a snow layer read without its properties): the showcase pool digs the layer and places the cell -- the showcase line exactly -- a fleet pool never digs it (`blocked`, the snow still there); SNOWKEEP either way; dirt in a floor cell and a caller\'s own list are the same in both', async () => {
  const names = ['MEMORY_POOL', 'SNOWKEEP', 'BUILDRETRY', 'VISIT_WAIVER']
  const at = [10, BF.G + 1, 10]
  /** One visit to a one-cell record whose cell holds `block` -> { stop, now: the cell's block after, dug: the names this bot dug }. */
  const visit = async (block, extra = {}, role = 'fill') => {
    const srv = BF.server()
    srv.set(at, block)
    const rec = { v: 1, plot: 'shop', cells: [{ at, role, seg: 'earth' }], clear: [], replant: [], segments: [{ seg: 'earth', deps: [] }] }
    const pdir = fs.mkdtempSync(path.join(dir, 'snow-')), key = BF.PJ.projKey(BF.HOME, 'shop')
    const pub = BF.PJ.publishRecord(pdir, key, () => ({ ...rec })), slot = BF.PJ.takeSlot(pdir, key, 'A', 3)
    const e = BF.bot(srv, 'A', { inv: { cobblestone: 8, stone_bricks: 8 } })
    const dug = [], dig0 = e.dig
    e.dig = async (c, expect) => { dug.push(srv.read(...c)?.name ?? '?'); return dig0(c, expect) }
    const p = { dir: pdir, key, me: 'A', home: BF.HOME, stood: [], record: rec, recordGen: pub.gen, palette: { fill: ['cobblestone'], base: ['stone_bricks'] }, slot: slot.slot, slotGen: slot.gen, stands: { pending: null, bans: {} }, blockLayer: false, domain: () => true, walkR: 40, ...extra }
    const out = await R.runVisit(p, e, { maxSteps: 200 })
    return { stop: out.stop, now: srv.read(...at).name, dug }
  }
  const showcase = async () => {
    const r = await visit('snow')
    assert.deepStrictEqual([r.stop, r.now, r.dug], ['complete', 'cobblestone', ['snow']], 'the layer is dug, the cell placed (gkunblock-01)')
  }
  const fleet = async () => {
    const r = await visit('snow')
    assert.deepStrictEqual([r.stop, r.now, r.dug], ['blocked', 'snow', []], 'the layer is never dug: the fleet\'s live stop (stuckcells.test.mjs\'s control)')
  }
  const off = { BUILDRETRY: 'off', VISIT_WAIVER: 'off' }
  await withVars(names, { ...off, MEMORY_POOL: 'showcase' }, showcase)
  await withVars(names, { ...off, MEMORY_POOL: 'hive-d' }, fleet)
  await withVars(names, { ...off }, fleet)
  await withVars(names, { ...off, MEMORY_POOL: 'showcase', SNOWKEEP: 'on' }, fleet)
  await withVars(names, { ...off, MEMORY_POOL: 'hive-d', SNOWKEEP: 'off' }, showcase)
  // POSITIVE CONTROLS on the same visit: dirt in a floor cell is dug and the cell placed in BOTH pools (the switch moves snow only; a
  // fill cell takes any earth as done, so the control's cell is a `base`), and a caller's own list is the caller's in both
  // (`p.foreign`: the switch is the DEFAULT's)
  for (const pool of ['showcase', 'hive-d']) {
    await withVars(names, { ...off, MEMORY_POOL: pool }, async () => {
      const d = await visit('dirt', {}, 'base')
      assert.deepStrictEqual([d.stop, d.now, d.dug], ['complete', 'stone_bricks', ['dirt']], `${pool}: dirt`)
      assert.strictEqual((await visit('snow', { foreign: R.FOREIGN_CLEAR })).stop, 'complete', `${pool}: the caller's list with snow`)
      assert.strictEqual((await visit('snow', { foreign: R.FOREIGN_KEEP_SNOW })).stop, 'blocked', `${pool}: the caller's list without`)
    })
  }
})
await t('wiring: the visit\'s default list is the one line on the switch; the fleet\'s list is FOREIGN_CLEAR less `snow` and nothing else; the suite\'s default is off and the fleet line\'s test sets it on', () => {
  const run = strip(readFileSync(R_PATH, 'utf8'))
  once(run, 'scaffoldRe = p.foreign ?? (snowKeepOn() ? FOREIGN_KEEP_SNOW : FOREIGN_CLEAR)\n', 'the visit\'s default list')
  assert.strictEqual(run.split('FOREIGN_KEEP_SNOW').length, 3, 'the fleet\'s list is read in one place: its definition and the visit\'s default')
  assert.strictEqual(R.FOREIGN_KEEP_SNOW.source, R.FOREIGN_CLEAR.source.replace('|snow)', ')'))
  assert.ok(R.FOREIGN_CLEAR.test('snow') && !R.FOREIGN_KEEP_SNOW.test('snow') && R.FOREIGN_KEEP_SNOW.test('gravel'), 'the showcase line\'s list still has snow')
  once(readFileSync(new URL('../scripts/run-tests.mjs', import.meta.url), 'utf8'), "SNOWKEEP: process.env.SNOWKEEP ?? 'off',", 'the suite\'s default')
  once(readFileSync(new URL('./stuckcells.test.mjs', import.meta.url), 'utf8'), "\nprocess.env.SNOWKEEP = 'on'\n", 'the fleet line\'s test')
})

console.log('ROWS 2-4 AND 7: the spawn says which way the four are (`_poolswitch_mode`, poolswitch.mjs)')
const PS = await import('../src/poolswitch.mjs')
await t('the row: each switch on or off and where the answer came from (env | pool); written once per spawn from features.mjs, not index.mjs', () => {
  assert.strictEqual(PS.poolSwitchWhy('CRAFTSPARE', { MEMORY_POOL: 'showcase' }), 'pool'); assert.strictEqual(PS.poolSwitchWhy('CRAFTSPARE', { CRAFTSPARE: ' OFF ' }), 'env')
  assert.strictEqual(PS.poolSwitchWhy('UNSITEDWAIT', { UNSITEDWAIT: 'maybe' }), 'pool', 'a value the switch does not read is no answer')
  const row = env => PS.poolSwitchDetail({ unsited: SH.unsitedWaitOn(env), band: WL.wellBandOn(env), spare: CR.craftSpareOn(env), snow: R.snowKeepOn(env), pool: env.MEMORY_POOL }, env)
  assert.strictEqual(row({ MEMORY_POOL: 'showcase' }), 'unsitedwait=0 (pool) idlework_well=0 (pool) craftspare=0 (pool) snowkeep=0 (pool) pool=showcase')
  assert.strictEqual(row({ MEMORY_POOL: 'hive-a' }), 'unsitedwait=1 (pool) idlework_well=1 (pool) craftspare=1 (pool) snowkeep=1 (pool) pool=hive-a')
  assert.strictEqual(row({ MEMORY_POOL: 'showcase', IDLEWORK_WELL: 'on' }), 'unsitedwait=0 (pool) idlework_well=1 (env) craftspare=0 (pool) snowkeep=0 (pool) pool=showcase')
  assert.strictEqual(row({ UNSITEDWAIT: '0', CRAFTSPARE: 'no' }), 'unsitedwait=0 (env) idlework_well=1 (pool) craftspare=0 (env) snowkeep=1 (pool) pool=-')
  assert.strictEqual(row({ MEMORY_POOL: 'showcase', SNOWKEEP: 'on' }), 'unsitedwait=0 (pool) idlework_well=0 (pool) craftspare=0 (pool) snowkeep=1 (env) pool=showcase')
  const feat = strip(readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8'))
  once(feat, "logEvent({ kind: 'poolswitch_mode', status: 'success', snapshot: snapshot(bot), detail: poolSwitchDetail({ unsited: unsitedWaitOn(), band: wellBandOn(), spare: craftSpareOn(), snow: snowKeepOn(), pool: process.env.MEMORY_POOL ?? '' }) })", 'the spawn row')
  assert.ok(!/poolswitch|craftSpareOn|unsitedWaitOn|wellBandOn|snowKeepOn/.test(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')), 'nothing of it in index.mjs (protected)')
})
try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* the runner's TMPDIR goes with it */ }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
