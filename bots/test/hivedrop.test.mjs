// HIVEDROP-01 (fleet 11-06 -> 11-08: hive-a's server logged "lost connection: Timed out" 0 / 124 / 385 / 615 a day, 33-45 an hour;
// board-a-Bravo too; hive-b/c/d about none). TWO CAUSES, each tested by what it DOES.
//   (a) THE KEEPALIVE: a CPU profile of hive-a-Echo (5 min, 11-08 16:22Z) shows 47-54 s busy runs with no yield, 87% of them in
//       runVisit -> cutCanopy / the segment loop -> nodesFor -> walkFrom: a whole-town flood re-planned for every canopy leaf that
//       no stand reaches (an await-free `continue`). Paper drops a client after 30 s without a keepalive answer. 100/112 of
//       hive-a-Bravo's drops 11-08 came during build_shop with a >= 25 s silent journal gap; hive-b ran build_shop 67 times, 0 drops.
//   (b) THE MEMORY: the chunk evictor's 60 s sweep was never stopped on `end` (chunk-evictor.test.mjs).
// The runVisit scenarios run on the fake server (test/helpers/buildfake.mjs); each fix is killed by an anchored mutant.
import assert from 'node:assert'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
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

const PAL = Object.freeze({ wall: ['cobblestone'] })
const CELL = [10, G + 1, 10]
function projectOf (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/hivedrop-`)
  const key = PJ.projKey(HOME, 'wall')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, 'A', 3)
  return { dir, key, p: extra => ({ dir, key, me: 'A', home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, stands: { pending: null, bans: {} }, blockLayer: false, domain: () => true, walkR: 14, ...extra }) }
}
const rec = () => ({ v: 1, plot: 'wall', cells: [{ at: CELL, role: 'wall', seg: 'W-0' }], clear: [], replant: [], segments: [{ seg: 'W-0', deps: [] }] })
/** THE LIVE SHAPE (hive-a's ziggurat): the open cell buried in a whole canopy -- the canopy box solid with leaves, so most of its
 *  leaves are inside the crown, where no stand's eye reaches them; every dig the server refuses (a transient), so the visit
 *  stays in its first canopy pass and every leaf is judged once. */
function crownScene () {
  const srv = server()
  for (let dx = -C.CANOPY_R; dx <= C.CANOPY_R; dx++) for (let dz = -C.CANOPY_R; dz <= C.CANOPY_R; dz++) for (let dy = -C.CANOPY_DOWN; dy <= C.CANOPY_UP; dy++) {
    const at = [CELL[0] + dx, CELL[1] + dy, CELL[2] + dz]
    if (k(at) !== k(CELL) && at[1] > G) srv.set(at, 'oak_leaves')
  }
  return srv
}
const CAN = { canopy: { natural: () => true, mayDig: () => true } }
/** One visit on the crown -> what it did and what it cost: reads, the dig attempts in order, the rows, the event loop's longest gap. */
async function crownVisit (M, { spinEvery = 0 } = {}) {
  const srv = crownScene(), pr = projectOf(rec())
  let reads = 0
  const digs = []
  const e = bot(srv, 'A', { inv: { cobblestone: 8 }, dig: async c => { digs.push(k(c)); return 'refused' } })
  const read0 = e.read
  e.read = (x, y, z) => {
    reads++
    if (spinEvery && reads % spinEvery === 0) { const t0 = performance.now(); while (performance.now() - t0 < 1) { /* a slow world: ~1 ms a read batch */ } }
    return read0(x, y, z)
  }
  let last = performance.now(), gap = 0
  const tick = setInterval(() => { const n = performance.now(); gap = Math.max(gap, n - last); last = n }, 2)
  let r
  try { r = await M.runVisit(pr.p(CAN), e, { maxSteps: 400 }) } finally { clearInterval(tick) }
  gap = Math.max(gap, performance.now() - last)
  console.log(`        (crown visit: ${reads} reads, ${digs.length} digs, longest gap ${Math.round(gap)} ms, stop ${r.stop}, LOOPYIELD=${process.env.LOOPYIELD ?? 'on'})`)
  return { r, reads, digs, ops: e.logs.map(([kk, d]) => `${kk}:${d.op}:${d.kind ?? ''}:${d.cell ? k(d.cell) : ''}`), gap }
}

console.log('HIVEDROP-01 (a): ONE WALK PLAN FOR A RUN OF STAND-LESS LEAVES, AND A YIELD AT EVERY LOOP HEAD')
await t('the switch: LOOPYIELD=off|0|false|no is the rollback; unset is on; BREATHE_MS is well under the 30 s keepalive', () => {
  for (const v of ['off', 'OFF', ' 0', 'false', 'no']) assert.strictEqual(R.loopYieldOn({ LOOPYIELD: v }), false, v)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(R.loopYieldOn({ LOOPYIELD: v }), true, String(v))
  assert.ok(R.BREATHE_MS > 0 && R.BREATHE_MS <= 1000)
})
await t('the crown visit does THE SAME THING with the plan cached (same stop, same digs in the same order, same rows) for far fewer reads', async () => {
  const scenario = async M => {
    const off = await withEnv('LOOPYIELD', 'off', () => crownVisit(M))
    const on = await withEnv('LOOPYIELD', null, () => crownVisit(M))
    // POSITIVE CONTROL: the scene is the live shape -- the canopy pass ran, judged leaves with no stand, and tried some
    assert.ok(off.ops.some(o => o.startsWith('_build:canopy:')), `the canopy pass never ran: ${off.ops.slice(0, 5)}`)
    assert.ok(off.digs.length > 0, 'no leaf was ever reachable: the scene proves nothing about a dig')
    assert.strictEqual(on.r.stop, off.r.stop)
    assert.deepStrictEqual(on.digs, off.digs, 'the same leaves tried, in the same order')
    assert.deepStrictEqual(on.ops, off.ops, 'the same rows')
    assert.ok(on.reads * 2 < off.reads, `reads ${on.reads} cached vs ${off.reads} re-planned per leaf: the plan was not reused`)
  }
  await killedBy('        if (!nodes) { nodes = nodesFor(); plan = { at: Date.now(), feet: feetNow() } }\n        if (!digStand(rd, q.at, nodes)) continue', '        nodes = nodesFor(); plan = { at: Date.now(), feet: feetNow() }\n        if (!digStand(rd, q.at, nodes)) continue', scenario)   // hivedrop-02 reworded the line
})
await t('digs that LAND (the plan re-made after each): the same visit as the rollback, row for row', async () => {
  // EQUIVALENCE, not a kill: in this scene a plan kept across a landed dig gives the same rows too (that mutant survives here),
  // so the re-plan after every dig is the conservative choice -- it re-plans exactly where the old code could see a change
  const run = async () => { const srv = crownScene(), pr = projectOf(rec()), e = bot(srv, 'A', { inv: { cobblestone: 8 } }); const r = await R.runVisit(pr.p(CAN), e, { maxSteps: 400 }); return { r, ops: e.logs.map(([kk, d]) => `${kk}:${d.op}:${d.cell ? k(d.cell) : ''}`) } }
  const off = await withEnv('LOOPYIELD', 'off', run)
  const on = await withEnv('LOOPYIELD', null, run)
  assert.ok(off.ops.filter(o => o.startsWith('_build:clear:')).length > 0, 'POSITIVE CONTROL: no dig landed, the scene shows nothing')
  assert.strictEqual(on.r.stop, off.r.stop)
  assert.deepStrictEqual(on.ops, off.ops)
})
await t('THE KEEPALIVE: the crown visit never holds the event loop past a few BREATHE_MS; the rollback holds it for the visit', async () => {
  const scenario = async M => {
    const off = await withEnv('LOOPYIELD', 'off', () => crownVisit(M))
    const on = await withEnv('LOOPYIELD', null, () => crownVisit(M))
    // POSITIVE CONTROL: without the yields the visit really does hold the loop (or the gap below proves nothing)
    assert.ok(off.gap > 4 * R.BREATHE_MS, `the rollback's longest gap is only ${Math.round(off.gap)} ms: the scene is too light to show a stall`)
    assert.ok(on.gap < 3 * R.BREATHE_MS, `longest event-loop gap ${Math.round(on.gap)} ms with the yields (rollback ${Math.round(off.gap)} ms)`)
    assert.strictEqual(on.r.stop, off.r.stop)
  }
  // no mutant here: most of the crown's win is the cached plan (a yield-less mutant still reads 2.5x fewer blocks and holds the
  // loop ~450 ms); the yield itself is killed by the many-segment visit below
  await scenario(R)
})
await t('a many-segment visit with no stand anywhere yields between segments too (the profile\'s second chain: visitInner -> nodesFor)', async () => {
  // 30 one-cell segments, each cell sealed in stone (no stand, no canopy): every segment plans its walk and defers, awaiting nothing
  const cells = [], segments = []
  const srv = server()
  for (let i = 0; i < 30; i++) {
    const at = [-14 + 2 * (i % 15), G + 1, i < 15 ? 8 : -8]
    cells.push({ at, role: 'wall', seg: `S-${i}` }); segments.push({ seg: `S-${i}`, deps: [] })
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) srv.set([at[0] + dx, at[1] + dy, at[2] + dz], 'stone')
  }
  const record = { v: 1, plot: 'wall', cells, clear: [], replant: [], segments }
  const scenario = async M => {
    const run = async () => {
      const pr = projectOf(record), e = bot(srv, 'A', { inv: { cobblestone: 64 } })
      let reads = 0
      const read0 = e.read
      e.read = (x, y, z) => { if (++reads % 400 === 0) { const t0 = performance.now(); while (performance.now() - t0 < 1) { /* slow */ } } return read0(x, y, z) }
      let last = performance.now(), gap = 0
      const tick = setInterval(() => { const n = performance.now(); gap = Math.max(gap, n - last); last = n }, 2)
      let r
      try { r = await M.runVisit(pr.p({}), e, { maxSteps: 400 }) } finally { clearInterval(tick) }
      console.log(`        (segments visit: ${reads} reads, longest gap ${Math.round(Math.max(gap, performance.now() - last))} ms, stop ${r.stop}, LOOPYIELD=${process.env.LOOPYIELD ?? 'on'})`)
      return { r, gap: Math.max(gap, performance.now() - last), deferred: e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'deferred').length }
    }
    const off = await withEnv('LOOPYIELD', 'off', run)
    const on = await withEnv('LOOPYIELD', null, run)
    assert.ok(off.deferred >= 20, `POSITIVE CONTROL: the segments were not all judged stand-less (${off.deferred} deferred)`)
    assert.ok(off.gap > 4 * R.BREATHE_MS, `the rollback's longest gap is only ${Math.round(off.gap)} ms`)
    assert.ok(on.gap < 2.5 * R.BREATHE_MS, `longest gap ${Math.round(on.gap)} ms with the yields (rollback ${Math.round(off.gap)} ms)`)
    assert.strictEqual(on.r.stop, off.r.stop); assert.strictEqual(on.deferred, off.deferred)
  }
  await killedBy("    if (!loopYieldOn() || Date.now() - breathedAt < BREATHE_MS) return false\n    await new Promise(r => setImmediate(r))", "    if (!loopYieldOn() || Date.now() - breathedAt < BREATHE_MS) return false\n", scenario)
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
