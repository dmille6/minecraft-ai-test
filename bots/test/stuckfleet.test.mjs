// STUCKFLEET-01 (fleet 11-08, goalwatch 13:30Z: 11 projects stuck >= 3 h). Three dead ends, each measured live (stuckfleet.mjs):
//   1. a road LIGHT no stand reaches: neither tidy waiver takes a light -> stuck_on_cell for good (hive-a 33 h, hive-c 31 h, ...)
//   2. a HELD monument cell is never a waiver candidate (isolated-d F-S: 6 held core cells, 0 of 12 waivers used, 7,271 waiting)
//   3. an air cell capped by its upper layer's open cell holding dirt: no face seen (placebo-c 327,72,106, 3,277 waiting)
// Pure on the live shapes, chained on the fake server, each wiring killed by a mutant whose anchor is asserted present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const SF = await import('../src/stuckfleet.mjs')
const RT = await import('../src/buildretry.mjs')
const W = await import('../src/wall.mjs')
const T = await import('../src/tidy.mjs')
const GW = await import('../src/gkwork.mjs')
const Z = await import('../src/ziggurat.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const k = a => a.join(',')
const killedBy = async (old, neu, scenario, mut = withMutant) => {
  await scenario(R, SF)
  let why = null
  await mut(old, neu, async M => { try { await scenario(M.R ?? M, M.SF ?? SF) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
/** A mutant of stuckfleet.mjs (anchor present and unique). */
const SF_PATH = new URL('../src/stuckfleet.mjs', import.meta.url)
async function withSfMutant (old, neu, fn) {
  const src = readFileSync(SF_PATH, 'utf8')
  assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_sfmutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn({ R, SF: await import(out.href) }) } finally { try { unlinkSync(out) } catch {} }
}

// ---- 1. the road light (hive-a tidy, stage 3, record g79: 4 cells, 13 cuts, 0 waived) ------------------------------------------
const HIVEA = { cells: [{ at: [295, 66, 153], role: 'core', seg: 'T-00-0' }, { at: [295, 67, 153], role: 'earth', seg: 'T-00-1' }, { at: [363, 70, 223], role: 'light', seg: 'T-L' }, { at: [355, 68, 225], role: 'light', seg: 'T-L' }], cut: [], clear: [], waived: {} }
// the live stuck map summed over Alpha/Comet/Bravo/Delta: 4 visits; the visit stopped stuck_on_cell, nothing else open
const DEF = [{ k: '355,68,225', why: 'no_stand', visits: 4 }]
console.log('1. THE ROAD LIGHT')
await t('CONTROL (the live dead end): wallWaiveDue (gkWaiveOpts) and stallWaive both refuse the light -- nothing is ever waived', () => {
  assert.deepStrictEqual(W.wallWaiveDue(HIVEA, DEF, T.gkWaiveOpts(HIVEA, W.WALL_WAIVE_MAX)), [])
  assert.deepStrictEqual(GW.stallWaive(HIVEA, DEF, { stalled: true }), [])
  // positive control: the same deferral on an EARTH cell is waived by the ordinary waiver
  assert.deepStrictEqual(W.wallWaiveDue(HIVEA, [{ k: '295,67,153', why: 'no_stand', visits: 4 }], T.gkWaiveOpts(HIVEA, W.WALL_WAIVE_MAX)).map(d => d.k), ['295,67,153'])
})
await t('lightWaiveDue waives the live light; the visit then ends cell_waived (no keeper release, no 6-h back-off) and the stage reads done', () => {
  const due = SF.lightWaiveDue(HIVEA, DEF)
  assert.deepStrictEqual(due, [{ k: '355,68,225', why: 'light no_stand' }])
  assert.strictEqual(T.gkStopAfterWaive('stuck_on_cell', due.length), 'cell_waived')
  const rw = { ...HIVEA, waived: { '355,68,225': { why: due[0].why } }, cut: [] }
  const read = (x, y, z) => ({ name: k([x, y, z]) === '363,70,223' ? 'torch' : k([x, y, z]).startsWith('295') ? 'dirt' : 'air', boundingBox: 'block' })
  const prog = T.tidyProgress(rw, read, { fillDone: q => Object.prototype.hasOwnProperty.call(rw.waived, k(q.at)) || q.role !== 'light' || read(...q.at).name === 'torch' })
  assert.strictEqual(prog.fillLeft, 0)
})
await t('lightWaiveDue refuses: a non-light cell, a light under LIGHT_WAIVE_AFTER visits, a light already waived; at most max a visit', () => {
  assert.deepStrictEqual(SF.lightWaiveDue(HIVEA, [{ k: '295,67,153', visits: 9 }]), [], 'an earth cell is the ordinary waiver\'s')
  assert.deepStrictEqual(SF.lightWaiveDue(HIVEA, [{ k: '355,68,225', visits: 1 }]), [], 'one visit: asked again')
  assert.deepStrictEqual(SF.lightWaiveDue({ ...HIVEA, waived: { '355,68,225': {} } }, DEF), [])
  const many = { cells: Array.from({ length: 9 }, (_, i) => ({ at: [i, 70, 0], role: 'light' })) }
  assert.strictEqual(SF.lightWaiveDue(many, many.cells.map(c => ({ k: k(c.at), visits: 3 }))).length, SF.LIGHT_WAIVE_MAX)
})
await t('the threshold is LIGHT_WAIVE_AFTER visits -- killed with the visits test cut', async () => {
  await killedBy("    if ((Number(d?.visits) || 0) < after) continue\n", '', async (_R, M) => {
    assert.deepStrictEqual(M.lightWaiveDue(HIVEA, [{ k: '355,68,225', visits: 1 }]), [])
  }, withSfMutant)
})
await t('buildTidy composes the light waiver with its waivers, behind STUCKFLEET (source, comments stripped)', () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.strictEqual(src.split("const waive2 = stuckFleetOn() ? [...waive1, ...lightWaiveDue(rec, r.deferred ?? []).filter(l => !waive1.some(w => w.k === l.k))] : waive1").length, 2)
  assert.ok(/if \(waive\.length\) \{\s*const pub = publishRecord\(dir, key, cur => \{\s*if \(!cur \|\| cur\.structure_complete/.test(src), 'the composed list is what is published')
  assert.strictEqual(SF.stuckFleetOn({ STUCKFLEET: 'off' }), false)
  assert.strictEqual(SF.stuckFleetOn({}), true)
})

// ---- 2. the held cell (isolated-d monument F-S) -----------------------------------------------------------------------------
console.log('2. THE HELD CELL')
await t('heldWaiveCand adds the held clear cells that wait on nothing below; never an unheld, unclear or waiting one', () => {
  const open = [{ at: [1, 70, 1] }, { at: [2, 70, 1] }, { at: [3, 70, 1] }, { at: [4, 70, 1] }, { at: [4, 71, 1] }]
  const held = new Set(['1,70,1', '3,70,1', '4,71,1'])
  const got = SF.heldWaiveCand(open, [{ at: [2, 70, 1] }], { held: x => held.has(x), clear: at => at[0] !== 3, below: c => c.at[1] === 71 })
  assert.deepStrictEqual(got.map(c => k(c.at)), ['2,70,1', '1,70,1'])
})
// the fake server: one foundation segment F of three cells at G+1, the middle one HELD (its clicks failed RETRY_VISITS visits) and
// deferred 3 visits in the stuck map; the visit's waiver is the monument's (zigMayWaive: F)
const heldScene = () => {
  const srv = server(), cells = [[10, G + 1, 10], [11, G + 1, 10], [12, G + 1, 10]].map(at => ({ at, role: 'core', seg: 'F' }))
  const rec = { v: 1, plot: 'monument', blueprint: 'ziggurat@1', cells, clear: [], replant: [], segments: [{ seg: 'F', deps: [] }] }
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/stuckfleet-`)
  const key = PJ.projKey(HOME, 'monument')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 2)
  const now = Date.now(), HK = k([11, G + 1, 10])
  RT.retryWrite(dir, key, 'X', { cells: { [HK]: { visits: RT.RETRY_VISITS, firstAt: now - 60_000, lastAt: now - 1000, why: 'click refused' } }, resets: {} }, now)
  PJ.stuckWrite(dir, key, 'X', { [HK]: { visits: 3, firstAt: now - 60_000, lastAt: now - 1000, by: 'X' } }, { now })
  const p = { dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: Z.ZIG_PALETTE, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: 40, foreign: Z.ZIG_FOREIGN, blockLayer: false, stands: { pending: null, bans: {} },
    waive: { mayWaive: c => /^F(-|$)/.test(c.seg), max: 12, have: {} } }
  return { srv, rec, p, HK }
}
await t('CONTROL (STUCKFLEET=off, the live code): the held cell is deferred `retry`, never waived', async () => {
  const prev = process.env.STUCKFLEET; process.env.STUCKFLEET = 'off'
  try {
    const { srv, p, HK } = heldScene(), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
    const r = await R.runVisit(p, e, { maxSteps: 400 })
    assert.ok(!(r.waived ?? []).some(d => d.k === HK), JSON.stringify(r.waived))
    assert.ok((r.deferred ?? []).some(d => d.k === HK && /^retry/.test(d.why)), JSON.stringify(r.deferred))
  } finally { if (prev == null) delete process.env.STUCKFLEET; else process.env.STUCKFLEET = prev }
})
await t('the held foundation cell is WAIVED (named, counted done) and the segment completes -- killed with the held candidates cut', async () => {
  await killedBy('const wcand = stuckFleetOn() && rt ? heldWaiveCand(', 'const wcand = false && rt ? heldWaiveCand(', async M => {
    const { srv, p, HK } = heldScene(), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
    const r = await M.runVisit(p, e, { maxSteps: 400 })
    assert.ok((r.waived ?? []).some(d => d.k === HK), JSON.stringify(r.waived))
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'waived' && k(d.cell) === HK))
    assert.strictEqual(r.stop, 'complete', r.why)
  })
})
await t('the waiver\'s mayWaive still decides: a held SKIN cell is not waived (deferred as before)', async () => {
  const { srv, p, HK } = heldScene(), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
  const r = await R.runVisit({ ...p, waive: { ...p.waive, mayWaive: () => false } }, e, { maxSteps: 400 })
  assert.ok(!(r.waived ?? []).some(d => d.k === HK))
  assert.ok((r.deferred ?? []).some(d => d.k === HK))
})

// ---- 3. the capped cell (placebo-c monument L02-E 327,72,106 under L03-E's stair cell holding dirt) ---------------------------
console.log('3. THE CAPPED CELL')
await t('capDigs on the live column: the dirt in the dependent open cell; the column above it is open', () => {
  const W0 = { '327,73,106': 'dirt', '327,74,106': 'air' }
  const read = (x, y, z) => { const n = W0[k([x, y, z])]; return n ? { name: n, boundingBox: n === 'air' ? 'empty' : 'block' } : null }
  const open = q => k(q) === '327,73,106'
  assert.deepStrictEqual(SF.capDigs([327, 72, 106], { read, isOpenAbove: open, scaffold: R.FOREIGN_CLEAR }), [{ at: [327, 73, 106], name: 'dirt' }])
})
await t('capDigs refuses: a non-record block over the cell, an unread cell, a vetoed one, a non-scaffold block, a column past CAP_MAX', () => {
  const col = names => (x, y, z) => { const n = names[y - 71]; return n === null ? null : { name: n ?? 'air', boundingBox: (n ?? 'air') === 'air' ? 'empty' : 'block' } }
  const at = [0, 71, 0]
  assert.deepStrictEqual(SF.capDigs(at, { read: col([null, 'dirt']), isOpenAbove: () => false, scaffold: R.FOREIGN_CLEAR }), [], 'not a record cell')
  assert.deepStrictEqual(SF.capDigs(at, { read: col([null, null]), isOpenAbove: () => true, scaffold: R.FOREIGN_CLEAR }), [], 'unread')
  assert.deepStrictEqual(SF.capDigs(at, { read: col([null, 'dirt']), isOpenAbove: () => true, mayDig: () => false, scaffold: R.FOREIGN_CLEAR }), [], 'vetoed')
  assert.deepStrictEqual(SF.capDigs(at, { read: col([null, 'chest']), isOpenAbove: () => true, scaffold: R.FOREIGN_CLEAR }), [], 'not scaffold')
  assert.deepStrictEqual(SF.capDigs(at, { read: col([null, 'dirt', 'dirt', 'dirt', 'dirt', 'air']), isOpenAbove: () => true, scaffold: R.FOREIGN_CLEAR }), [], 'too tall')
  assert.deepStrictEqual(SF.capDigs(at, { read: col([null, 'dirt', 'dirt', 'air']), isOpenAbove: () => true, scaffold: R.FOREIGN_CLEAR }).map(d => d.at[1]), [73, 72], 'highest first')
})
// the fake server: segment A a 3x3 at G+1, all cobblestone but the middle (air); segment B (waits on A) one cell over the middle
// holding DIRT -- the middle's four sides and its top are solid, its bottom the ground: no face any stand sees
const capScene = () => {
  const srv = server(), cells = []
  for (let x = 10; x <= 12; x++) for (let z = 9; z <= 11; z++) {
    cells.push({ at: [x, G + 1, z], role: 'skin', seg: 'A' })
    srv.set([x, G + 1, z], x === 11 && z === 10 ? 'air' : 'cobblestone')
  }
  cells.push({ at: [11, G + 2, 10], role: 'skin', seg: 'B' }); srv.set([11, G + 2, 10], 'dirt')
  const rec = { v: 1, plot: 'monument', blueprint: 'ziggurat@1', cells, clear: [], replant: [], segments: [{ seg: 'A', deps: [] }, { seg: 'B', deps: ['A'] }] }
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/stuckfleet-`)
  const key = PJ.projKey(HOME, 'monument')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 2)
  const p = { dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: Z.ZIG_PALETTE, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: 40, foreign: Z.ZIG_FOREIGN, blockLayer: false, stands: { pending: null, bans: {} }, sealed: { mayDig: () => true } }
  return { srv, rec, p }
}
const built = (srv, rec) => rec.cells.every(c => R.cellDone(srv.read(...c.at), Z.ZIG_PALETTE, c.role))
await t('CONTROL (STUCKFLEET=off, the live code): the middle is deferred (no stand), the record never completes', async () => {
  const prev = process.env.STUCKFLEET; process.env.STUCKFLEET = 'off'
  try {
    const { srv, rec, p } = capScene(), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
    const r = await R.runVisit(p, e, { maxSteps: 400 })
    assert.ok(!built(srv, rec))
    assert.ok((r.deferred ?? []).some(d => d.k === k([11, G + 1, 10])), `${r.stop} ${JSON.stringify(r.deferred)}`)
  } finally { if (prev == null) delete process.env.STUCKFLEET; else process.env.STUCKFLEET = prev }
})
await t('the cap is dug (`kind=cap`), the middle placed, then B placed: the record completes -- killed with the cap branch cut', async () => {
  await killedBy('if (p.sealed && stuckFleetOn() && cand.length) {', 'if (false) {', async M => {
    const { srv, rec, p } = capScene(), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
    const r = await M.runVisit(p, e, { maxSteps: 400 })
    assert.ok(built(srv, rec), `${r.stop} ${r.why}`)
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear' && d.kind === 'cap' && k(d.cell) === k([11, G + 2, 10])))
  })
})
await t('only a segment that WAITS on this one: an independent upper segment\'s cell is never dug -- killed with the dependency test cut', async () => {
  await killedBy('return !!x && x.seg !== seg && dependsOn(record, x.seg, seg) && !isDone(x)', 'return !!x && x.seg !== seg && !isDone(x)', async M => {
    const { srv, rec, p } = capScene()
    const rec2 = { ...rec, segments: [{ seg: 'A', deps: [] }, { seg: 'B', deps: [] }] }
    const e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
    await M.runVisit({ ...p, record: rec2 }, e, { maxSteps: 400 })
    assert.ok(!e.logs.some(([kk, d]) => kk === '_build' && d.kind === 'cap'), 'no cap dug')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
