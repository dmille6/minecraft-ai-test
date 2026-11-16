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
})
try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* the runner's TMPDIR goes with it */ }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
