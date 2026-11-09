// HIVEDROP-02 (PLANKEEP): a yield no longer throws the walk plan away. Fleet .31, 34 h to 11-09 13:30Z, by build: monument visits
// aborted 155/520, 52/358, 20/199 on the three builds before hivedrop-01 (0 `_build op=interrupted kind=start`) -> 467/549,
// 465/550, 108/126 on hivedrop-01 and the two after it (380, 343, 84 at `start`; 426 of the last 12 h's 560 at 30-40 s: the stuck
// reflex's 35 s); monument placements 24 / 427 / 39 -> 7 / 48 / 1. hivedrop-01 re-planned the clears' and the canopy's walk (a
// whole-town flood) after EVERY yield; a yield comes every BREATHE_MS, so once a flood takes BREATHE_MS (a big town) every
// stand-less entry floods again and the builder stands still through the whole list.
// Each scenario runs on the fake server (test/helpers/buildfake.mjs) with a SLOW WORLD: a fake clock that a block read advances,
// so a flood takes longer than BREATHE_MS, as on hive-a. Each fix is killed by an anchored mutant (withMutant asserts the anchor).
import assert from 'node:assert'
import fs from 'node:fs'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const C = await import('../src/canopy.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) } }
const k = a => a.join(',')
const killedBy = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const withEnv = async (name, v, fn) => {
  const prev = process.env[name]
  if (v == null) delete process.env[name]; else process.env[name] = v
  try { return await fn() } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev }
}
/** THE SLOW WORLD: Date.now advances `msPerRead` per block read (the visit's own clock: breathe, planStale), restored after. */
const slowClock = async (msPerRead, fn) => {
  const real = Date.now
  let off = 0
  Date.now = () => real() + Math.floor(off)
  try { return await fn(() => { off += msPerRead }) } finally { Date.now = real }
}

const PAL = Object.freeze({ wall: ['cobblestone'] })
const CELL = [10, G + 1, 10]
function projectOf (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/plankeep-`)
  const key = PJ.projKey(HOME, 'wall')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, 'A', 3)
  return { dir, key, p: extra => ({ dir, key, me: 'A', home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, stands: { pending: null, bans: {} }, blockLayer: false, domain: () => true, walkR: 14, ...extra }) }
}
const rec = (extra = {}) => ({ v: 1, plot: 'wall', cells: [{ at: CELL, role: 'wall', seg: 'W-0' }], clear: [], replant: [], segments: [{ seg: 'W-0', deps: [] }], ...extra })
const MS_PER_READ = Number(process.env.PK_MS ?? 0.05)
const CAN = { canopy: { natural: () => true, mayDig: () => true } }

/** One visit -> what it did and what it cost: reads, the dig attempts in order, the rows. */
async function visit (M, srv, record, extra, msPerRead) {
  const pr = projectOf(record)
  let reads = 0
  const digs = []
  const e = bot(srv, 'A', { inv: { cobblestone: 8 }, dig: async c => { digs.push(k(c)); return 'refused' } })
  const read0 = e.read
  const r = await slowClock(msPerRead, async tick => {
    e.read = (x, y, z) => { reads++; tick(); return read0(x, y, z) }
    return M.runVisit(pr.p(extra), e, { maxSteps: 400 })
  })
  return { r, reads, digs, ops: e.logs.map(([kk, d]) => `${kk}:${d.op}:${d.kind ?? ''}:${d.cell ? k(d.cell) : ''}`) }
}

console.log('HIVEDROP-02: THE WALK PLAN SURVIVES A YIELD (PLANKEEP)')
await t('planStale: the rules (pure)', () => {
  const plan = { at: 1000, feet: [1, 70, 2] }
  assert.strictEqual(R.planStale(plan, [1, 70, 2], 1000 + R.PLAN_KEEP_MS - 1, { on: true }), false, 'same feet, young: kept')
  assert.strictEqual(R.planStale(plan, [1, 70, 2], 1000 + R.PLAN_KEEP_MS, { on: true }), true, 'old: re-planned')
  assert.strictEqual(R.planStale(plan, [1, 71, 2], 1001, { on: true }), true, 'moved: re-planned')
  assert.strictEqual(R.planStale(plan, null, 1001, { on: true }), true, 'feet unknown: re-planned')
  assert.strictEqual(R.planStale(null, [1, 70, 2], 1001, { on: true }), true, 'no plan')
  assert.strictEqual(R.planStale(plan, [1, 70, 2], 999, { on: true }), true, 'a clock that ran backwards: re-planned')
  assert.strictEqual(R.planStale(plan, [1, 70, 2], 1001, { on: false }), true, 'PLANKEEP=off: every yield re-plans (hivedrop-01)')
  for (const v of ['off', 'OFF', ' 0', 'false', 'no']) assert.strictEqual(R.planKeepOn({ PLANKEEP: v }), false, v)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(R.planKeepOn({ PLANKEEP: v }), true, String(v))
  assert.ok(R.PLAN_KEEP_MS >= 10 * R.BREATHE_MS && R.PLAN_KEEP_MS < 35_000, 'kept for many yields, and well inside the stuck reflex\'s 35 s')
})

/** The live shape (hive-a's ziggurat): the open cell buried in a whole canopy of leaves, most no stand's eye reaches. */
function crownScene () {
  const srv = server()
  for (let dx = -C.CANOPY_R; dx <= C.CANOPY_R; dx++) for (let dz = -C.CANOPY_R; dz <= C.CANOPY_R; dz++) for (let dy = -C.CANOPY_DOWN; dy <= C.CANOPY_UP; dy++) {
    const at = [CELL[0] + dx, CELL[1] + dy, CELL[2] + dz]
    if (k(at) !== k(CELL) && at[1] > G) srv.set(at, 'oak_leaves')
  }
  return srv
}
await t('THE CANOPY in a slow world: the same visit (stop, digs in order, rows) for far fewer reads than a re-plan at every yield', async () => {
  const scenario = async M => {
    const off = await withEnv('PLANKEEP', 'off', () => visit(M, crownScene(), rec(), CAN, MS_PER_READ))
    const on = await withEnv('PLANKEEP', null, () => visit(M, crownScene(), rec(), CAN, MS_PER_READ))
    console.log(`        (canopy: reads ${on.reads} kept vs ${off.reads} re-planned at every yield; digs ${on.digs.length}; stop ${on.r.stop})`)
    // POSITIVE CONTROL: the canopy pass ran and tried leaves
    assert.ok(off.ops.some(o => o.startsWith('_build:canopy:')), `the canopy pass never ran: ${off.ops.slice(0, 5)}`)
    assert.ok(off.digs.length > 0, 'no leaf was ever reachable: the scene proves nothing')
    assert.strictEqual(on.r.stop, off.r.stop)
    assert.deepStrictEqual(on.digs, off.digs, 'the same leaves tried, in the same order')
    assert.deepStrictEqual(on.ops, off.ops, 'the same rows')
    assert.ok(on.reads * 2 < off.reads, `reads ${on.reads} kept vs ${off.reads}: the plan was not kept across yields`)
  }
  await killedBy('        if (await breathe() && planStale(plan, feetNow(), Date.now())) nodes = null   // hivedrop-02', '        if (await breathe()) nodes = null   // hivedrop-02', scenario)
})

/** THE CLEARS: a long clear list, every entry sealed in stone (no stand reaches any), and one open log by the builder. */
function clearsScene () {
  const srv = server(), clear = []
  for (let i = 0; i < 60; i++) {
    const at = [-12 + (i % 12) * 2, G + 1 + Math.floor(i / 12), -10]
    srv.set(at, 'oak_log'); clear.push({ at, name: 'oak_log', kind: 'log' })
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) { const s = [at[0] + dx, at[1] + dy, at[2] + dz]; if (!clear.some(c => k(c.at) === k(s))) srv.set(s, 'stone') }
  }
  const open = [3, G + 1, 3]
  srv.set(open, 'oak_log'); clear.push({ at: open, name: 'oak_log', kind: 'log' })
  return { srv, record: rec({ clear }) }
}
await t('THE CLEARS in a slow world: the same visit for far fewer reads (the stand-less entries share one plan)', async () => {
  const scenario = async M => {
    const a = clearsScene(), b = clearsScene()
    const off = await withEnv('PLANKEEP', 'off', () => visit(M, a.srv, a.record, {}, MS_PER_READ))
    const on = await withEnv('PLANKEEP', null, () => visit(M, b.srv, b.record, {}, MS_PER_READ))
    console.log(`        (clears: reads ${on.reads} kept vs ${off.reads} re-planned at every yield; digs ${on.digs.length}; stop ${on.r.stop})`)
    assert.ok(off.digs.length > 0, 'POSITIVE CONTROL: the open log was never tried')
    assert.strictEqual(on.r.stop, off.r.stop)
    assert.deepStrictEqual(on.digs, off.digs)
    assert.deepStrictEqual(on.ops, off.ops)
    assert.ok(on.reads * 2 < off.reads, `reads ${on.reads} kept vs ${off.reads}`)
    // THE LIVE SYMPTOM: on this slow clock the re-planning builder stands still past the stuck reflex's 35 s before its one dig;
    // the kept plan reaches it well inside
    assert.ok(off.reads * MS_PER_READ > 35_000 && on.reads * MS_PER_READ < 35_000, `standing still ${Math.round(on.reads * MS_PER_READ / 1000)} s kept vs ${Math.round(off.reads * MS_PER_READ / 1000)} s re-planned`)
  }
  await killedBy('        if (await breathe() && planStale(plan, feetNow(), Date.now())) nodes = null\n', '        if (await breathe()) nodes = null\n', scenario)
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
