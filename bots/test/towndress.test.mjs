// TOWNDRESS-01: LIGHTS AND SIGNS FOR THE TOWN (bots/src/towndress.mjs; the `dress` sink in sinks.mjs; shop.mjs activeProject's sink
// turn; the skills.mjs wiring). Behaviour: the sign's lines, the post rules (never a path, a record column, a door front, a reserved
// column, a step, an occupied or wet cell), the lamp / wall-top / signpost candidates on a fake town, the spacing and the batch caps,
// the proof, the instance (per-fixture zones, never a town-wide box; one segment a fixture; the sign cell its own role), the whole
// siting, the gate (torches, not stone), the REAL visit runner (buildrun.mjs runVisit) building a batch end to end with its sign
// cells left to the label writer, and the picker's sink turn (LIVE showcase 11-03: 131 picks wanted a sink, 0 sited). Anchored
// mutants (each anchor present and unique) for every rule a test leans on; STRUCTURAL source assertions only for the wiring.
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { R, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const D = await import('../src/towndress.mjs')
const S = await import('../src/sinks.mjs')
const SH = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const DRESS_PATH = new URL('../src/towndress.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
/** A mutant of a module, its anchor present and unique (CLAUDE.md), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (file, old, neu, scenario) => {
  await scenario(file === DRESS_PATH ? D : SH)
  let k = false
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
}

// ---- a fake town on the flat server: a path along z = 0 (x -30..30), a storehouse north of it with a door, a short wall ----------
const P = 'cobblestone'
const pathsRec = () => ({ plot: 'paths', blueprint: 'paths@1', structure_complete: true, palette: { path: [P] }, cells: Array.from({ length: 61 }, (_, i) => ({ at: [i - 30, G, 0], role: 'path', seg: 'P-a-0' })) })
const storeRec = () => {
  const cells = []
  for (let x = 3; x <= 7; x++) for (let z = 4; z <= 8; z++) for (let y = G + 1; y <= G + 3; y++) if (x === 3 || x === 7 || z === 4 || z === 8) cells.push({ at: [x, y, z], role: x === 5 && z === 4 && y <= G + 2 ? 'door' : 'wall' })
  return { plot: 'storehouse', blueprint: 'storehouse@1', structure_complete: true, sitedBy: 'showcase-Juno', completeAt: Date.UTC(2026, 10, 1, 12), palette: { wall: ['cobblestone'], door: ['oak_door'] }, box: [3, 4, 7, 8], cells }
}
// a wall along z = -12 (x -20..20): the O course to G+3, a merlon at G+4 on even x, a walk at G+2 on z = -11 (feet G+3)
const wallRec = () => {
  const cells = []
  for (let x = -20; x <= 20; x++) {
    for (let y = G + 1; y <= G + 3; y++) cells.push({ at: [x, y, -12], role: 'wall' })
    if (x % 2 === 0) cells.push({ at: [x, G + 4, -12], role: 'wall' })
    for (let y = G + 1; y <= G + 2; y++) cells.push({ at: [x, y, -11], role: 'step' })
    cells.push({ at: [x, G + 1, -10], role: 'step' })
  }
  return { plot: 'wall', blueprint: 'wall@1', structure_complete: true, palette: { wall: ['cobblestone'], step: ['cobblestone'] }, cells }
}
/** The world with the records standing in it. */
const town = (recs) => {
  const srv = server()
  for (const r of recs) for (const c of r.cells) srv.set(c.at, r.palette[c.role][0] === 'oak_door' ? 'oak_door' : r.palette[c.role][0])
  return srv
}
const RECS = () => [{ plot: 'paths', rec: pathsRec() }, { plot: 'storehouse', rec: storeRec() }, { plot: 'wall', rec: wallRec() }]

console.log('THE SIGN\'S WORDS')
await t('signLines: the building\'s name, who sited it (no pool prefix), the day it stood; every line <= 15; an unnamed plot none', () => {
  assert.deepStrictEqual(D.signLines('storehouse', storeRec()), ['STOREHOUSE', 'built by Juno', 'Nov 1'])
  assert.deepStrictEqual(D.signLines('hall', {}), ['COPPER HALL'], 'a missing field is left out, never guessed')
  assert.strictEqual(D.signLines('tidy', storeRec()), null)
  assert.ok(D.signLines('monument', { sitedBy: 'showcase-Verylongname', completeAt: 1 }).every(l => l.length <= 15))
})

console.log('THE POST RULES (towndress.mjs postAt)')
await t('a post beside a path: never on the path, a record column, a door front, a reserved column, a step over 1, an occupied or wet cell', () => {
  const recs = RECS().map(r => r.rec)
  const srv = town(recs)
  const pathCols = D.pathColumns(pathsRec())
  const guard = D.cellGuard(recs)
  const p = pathCols.get('10,0')
  const ok = D.postAt(srv.read, p, [10, 1], { pathCols, guard })
  assert.deepStrictEqual(ok.post, [[10, G + 1, 1]]); assert.deepStrictEqual(ok.light, [10, G + 2, 1])
  assert.strictEqual(D.postAt(srv.read, p, [11, 0], { pathCols, guard }).why, 'path')
  assert.strictEqual(D.postAt(srv.read, pathCols.get('5,0'), [5, 1], { pathCols, guard }).why, undefined, 'POSITIVE CONTROL: before the door front reaches it')
  assert.strictEqual(D.postAt(srv.read, pathCols.get('5,0'), [5, 2], { pathCols, guard }).why, 'door', 'two in front of the door')
  assert.strictEqual(D.postAt(srv.read, p, [10, 1], { pathCols, guard, reserved: () => 'protected' }).why, 'reserved:protected')
  srv.set([12, G + 1, 1], 'cobblestone'); srv.set([12, G + 2, 1], 'cobblestone')
  assert.strictEqual(D.postAt(srv.read, pathCols.get('12,0'), [12, 1], { pathCols, guard }).why, 'step', 'a ground 2 above the path')
  srv.set([14, G + 3, 1], 'oak_planks')
  assert.strictEqual(D.postAt(srv.read, pathCols.get('14,0'), [14, 1], { pathCols, guard, h: 2 }).why, 'occupied', 'a signpost\'s light cell taken')
  assert.strictEqual(D.postAt(srv.read, pathCols.get('14,0'), [14, 1], { pathCols, guard, h: 1 }).why, undefined, 'POSITIVE CONTROL: a 1-high lamp fits under it')
  srv.set([16, G, 2], 'water')
  assert.strictEqual(D.postAt(srv.read, pathCols.get('16,0'), [16, 1], { pathCols, guard }).why, 'wet')
  const g2 = D.cellGuard([...recs, { cells: [{ at: [18, G - 3, 1], role: 'x' }], palette: {} }])
  assert.strictEqual(D.postAt(srv.read, pathCols.get('18,0'), [18, 1], { pathCols, guard: g2 }).why, 'record', 'a record cell anywhere in the column')
})
await t('MUTANT KILLED: a post rule that forgets the record columns stands a post in another project\'s column', async () => {
  await killed(DRESS_PATH, "  if (guard.cols.has(ks)) return { why: 'record' }\n", '', M => {
    const srv = town([pathsRec()])
    const pathCols = M.pathColumns(pathsRec())
    const g2 = M.cellGuard([pathsRec(), { cells: [{ at: [18, G - 3, 1], role: 'x' }], palette: {} }])
    assert.strictEqual(M.postAt(srv.read, pathCols.get('18,0'), [18, 1], { pathCols, guard: g2 }).why, 'record')
  })
})

console.log('THE CANDIDATES AND THE BATCH')
await t('lamps beside the path (both sides, nearest home first); wall tops only on wall-role column tops (never a step), a cell above air', () => {
  const recs = RECS().map(r => r.rec)
  const srv = town(recs)
  const guard = D.cellGuard(recs)
  const lamps = D.lampCandidates(srv.read, pathsRec(), HOME, { guard })
  assert.ok(lamps.length > 60, `${lamps.length}`)
  assert.ok(lamps.every(f => f.at[2] === 1 || f.at[2] === -1 || (Math.abs(f.at[0]) === 31 && f.at[2] === 0)), 'beside the path (or past its ends)')
  assert.ok(!lamps.some(f => guard.cols.has(`${f.at[0]},${f.at[2]}`)))
  assert.ok(lamps[0].d <= lamps.at(-1).d)
  const tops = D.wallTopCandidates(srv.read, wallRec(), HOME, { guard })
  assert.strictEqual(tops.length, 41)
  assert.ok(tops.every(f => f.at[2] === -12 && f.at[1] === (f.at[0] % 2 === 0 ? G + 5 : G + 4)))
})
await t('a signpost for a finished named building: beside the path column nearest its door, 2-high post, torch on top, the sign on the post\'s face over the path, the writer\'s stand a path column beside it', () => {
  const recs = RECS().map(r => r.rec)
  const srv = town(recs)
  const s = D.signpostCandidates(srv.read, pathsRec(), [{ plot: 'storehouse', rec: storeRec() }], HOME, { guard: D.cellGuard(recs) })
  assert.strictEqual(s.length, 1)
  const f = s[0]
  assert.deepStrictEqual(f.post, [[5, G + 1, 1], [5, G + 2, 1]])
  assert.deepStrictEqual(f.light, [5, G + 3, 1])
  assert.deepStrictEqual(f.sign.at, [5, G + 2, 0]); assert.deepStrictEqual(f.sign.wall, [5, G + 2, 1]); assert.deepStrictEqual(f.sign.face, [0, 0, -1])
  assert.ok(f.sign.stand[2] === 0 && Math.abs(f.sign.stand[0] - 5) === 1 && f.sign.stand[1] === G + 1)
  assert.deepStrictEqual(f.sign.lines, ['STOREHOUSE', 'built by Juno', 'Nov 1'])
  assert.strictEqual(D.signpostCandidates(srv.read, pathsRec(), [{ plot: 'storehouse', rec: { ...storeRec(), structure_complete: false } }], HOME, { guard: D.cellGuard(recs) }).length, 0, 'an unfinished building: none')
  assert.strictEqual(D.signpostCandidates(srv.read, pathsRec(), [{ plot: 'storehouse', rec: storeRec() }], HOME, { guard: D.cellGuard(recs), signed: new Set(['storehouse']) }).length, 0, 'signed already: none')
})
await t('pickBatch: signposts first (at most signsMax), every light DRESS.spacing from every other (lit, planned, the batch), at most the torches and fixturesMax', () => {
  const L = (x, z, kind = 'lamp') => ({ kind, post: [[x, G + 1, z]], light: [x, G + 2, z], at: [x, G + 2, z] })
  const lamps = Array.from({ length: 40 }, (_, i) => L(i - 20, 1))
  const tops = Array.from({ length: 40 }, (_, i) => ({ ...L(i - 20, -12, 'walltop'), post: [] }))
  const sp = [0, 1, 2].map(i => ({ ...L(i * 20, 2, 'signpost'), for: `b${i}` }))
  const b = D.pickBatch({ signposts: sp, lamps, walltops: tops, lit: [[-20, G, 1]], torches: 99 })
  assert.ok(b.length <= D.DRESS.fixturesMax)
  assert.strictEqual(b.filter(f => f.kind === 'signpost').length, D.DRESS.signsMax)
  const nonSign = b.filter(f => f.kind !== 'signpost')
  for (const f of nonSign) for (const g of b) if (f !== g) assert.ok(Math.max(Math.abs(f.at[0] - g.at[0]), Math.abs(f.at[2] - g.at[2])) >= D.DRESS.spacing, `${f.at} ${g.at}`)
  assert.ok(nonSign.every(f => Math.max(Math.abs(f.at[0] + 20), Math.abs(f.at[2] - 1)) >= D.DRESS.spacing), 'an existing light keeps its ground')
  assert.ok(b.some(f => f.kind === 'walltop') && b.some(f => f.kind === 'lamp'), 'both kinds')
  assert.strictEqual(D.pickBatch({ lamps, torches: 3 }).length, 3, 'no more fixtures than torches')
  assert.strictEqual(D.pickBatch({ lamps, torches: 99, ok: f => f.at[0] > 0 }).every(f => f.at[0] > 0), true, 'only proven fixtures')
})
await t('MUTANT KILLED: without the spacing every path column gets a lamp', async () => {
  await killed(DRESS_PATH, '    if (far(f, DRESS.spacing) && ok(f)) take(f)\n', '    if (ok(f)) take(f)\n', M => {
    const lamps = Array.from({ length: 40 }, (_, i) => ({ kind: 'lamp', post: [], light: [i, G + 2, 1], at: [i, G + 2, 1] }))
    const b = M.pickBatch({ lamps, torches: 99 })
    for (const f of b) for (const g of b) if (f !== g) assert.ok(Math.abs(f.at[0] - g.at[0]) >= M.DRESS.spacing)
  })
})

console.log('THE PROOF, THE INSTANCE, THE SITE')
await t('proveFixture: a lamp beside a path is buildable from the town walk; walled in on every side it is not', () => {
  const srv = town([pathsRec()])
  const nodes = D.walkNodes(srv.read, HOME, { walkR: 40 })
  const f = { kind: 'lamp', post: [[10, G + 1, 1]], light: [10, G + 2, 1], at: [10, G + 2, 1] }
  assert.strictEqual(D.proveFixture(srv.read, HOME, f, nodes), true)
  for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) >= 1) for (let y = G + 1; y <= G + 5; y++) srv.set([30 + dx, y, 30 + dz], 'stone')
  const nodes2 = D.walkNodes(srv.read, HOME, { walkR: 50 })
  assert.strictEqual(D.proveFixture(srv.read, HOME, { kind: 'lamp', post: [[30, G + 1, 30]], light: [30, G + 2, 30], at: [30, G + 2, 30] }, nodes2), false)
})
await t('dressInstance: one segment a fixture, posts then the light then the sign (its own role), zones per fixture (never the town-wide box)', () => {
  const f1 = { kind: 'signpost', for: 'storehouse', post: [[5, G + 1, 1], [5, G + 2, 1]], light: [5, G + 3, 1], at: [5, G + 3, 1], sign: { at: [5, G + 2, 0], wall: [5, G + 2, 1], face: [0, 0, -1], stand: [6, G + 1, 0], lines: ['STOREHOUSE'] } }
  const f2 = { kind: 'walltop', post: [], light: [-30, G + 4, -40], at: [-30, G + 4, -40] }
  const inst = D.dressInstance('L1', [f1, f2])
  assert.deepStrictEqual(inst.segments, [{ seg: 'L1-P0', deps: [] }, { seg: 'L1-P1', deps: [] }])
  assert.deepStrictEqual(inst.cells.map(c => c.role), ['L1-post', 'L1-post', 'L1-light', 'L1-sign', 'L1-light'])
  assert.ok(D.dressSignRole('L1-sign') && !D.dressSignRole('L1-light') && D.dressLightRole('L1-light'))
  assert.strictEqual(inst.zones.length, 2)
  assert.ok(inst.zones.every(z => z.box[3] - z.box[0] <= 2 && z.box[5] - z.box[2] <= 2), 'small zones')
  assert.deepStrictEqual(inst.palette['L1-post'].at(-1), 'cobblestone')
  const rec = S.appendInstance(null, { kind: 'dress', home: HOME, inst, meta: { id: 'L1', n: 1, box: inst.box, zones: inst.zones, cols: inst.cols, signs: inst.signs, sitedAt: 1 } })
  assert.strictEqual(rec.zones.length, 2, 'the record carries the fixture zones')
  assert.ok(!SH.recordZones([rec]).some(z => z.box[3] - z.box[0] > 2), 'recordZones reads them: no town-wide zone')
  assert.ok(S.sinkSaplingCols(rec).cols.size <= 2 * 25, 'saplings kept off the fixtures only')
  assert.deepStrictEqual(D.dressSignSpots(rec).map(s => s.chest), ['L1:storehouse'])
})
await t('MUTANT KILLED: appendInstance without the dress zones fences a whole box of the town', async () => {
  const SINKS_PATH = new URL('../src/sinks.mjs', import.meta.url)
  const scen = M => {
    const inst = D.dressInstance('L1', [{ kind: 'walltop', post: [], light: [-30, G + 4, -40], at: [-30, G + 4, -40] }, { kind: 'walltop', post: [], light: [30, G + 4, 40], at: [30, G + 4, 40] }])
    const rec = M.appendInstance(null, { kind: 'dress', home: HOME, inst, meta: { id: 'L1', n: 1, box: inst.box, zones: inst.zones, cols: inst.cols, sitedAt: 1 } })
    assert.ok(rec.zones.every(z => z.box[3] - z.box[0] <= 2))
  }
  scen(S)
  let k = false
  await withMutant(SINKS_PATH, "kind === 'dress' && Array.isArray(meta.zones) ? meta.zones :", 'false ? meta.zones :', async M => { try { scen(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
})
await t('siteDress on the fake town: the storehouse\'s signpost and lamps / wall tops, every one proven, spaced, off every record cell; no torches: no batch', () => {
  const recs = RECS()
  const srv = town(recs.map(r => r.rec))
  const r = S.siteSink(srv.read, { kind: 'dress', n: 1, id: 'L1', home: HOME, records: recs, rec: null, torches: 20, stood: [] })
  assert.ok(r.ok, JSON.stringify(r))
  assert.strictEqual(r.meta.signed.join(), 'storehouse')
  assert.ok(r.meta.design.fixtures.some(f => f.kind === 'lamp') && r.meta.design.fixtures.some(f => f.kind === 'walltop'), r.meta.summary)
  const guard = D.cellGuard(recs.map(x => x.rec))
  assert.ok(!r.inst.cells.some(c => guard.cells.has(c.at.join(','))), 'never in a record cell')
  const fx = r.meta.design.fixtures
  for (const a of fx) for (const b of fx) if (a !== b && a.kind !== 'signpost' && b.kind !== 'signpost') assert.ok(Math.max(Math.abs(a.at[0] - b.at[0]), Math.abs(a.at[2] - b.at[2])) >= D.DRESS.spacing)
  assert.strictEqual(S.siteSink(srv.read, { kind: 'dress', n: 1, id: 'L1', home: HOME, records: recs, torches: 3 }).why, 'no_torch')
  // the next batch keeps clear of the first (its lights planned) and never signs the storehouse twice
  const rec = S.appendInstance(null, { kind: 'dress', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: 1 } })
  const r2 = S.siteSink(srv.read, { kind: 'dress', n: 2, id: 'L2', home: HOME, records: recs, rec, torches: 20 })
  if (r2.ok) {
    assert.ok(!r2.meta.signed.includes('storehouse'))
    for (const a of r2.meta.design.fixtures) for (const b of fx) if (b.kind !== 'signpost') assert.ok(Math.max(Math.abs(a.at[0] - b.at[0]), Math.abs(a.at[2] - b.at[2])) >= D.DRESS.spacing)
  }
})
await t('the gate is torches, not stone: dressPressure counts the town above its reserve (read) and the bag; sinkNextGate opens on it', () => {
  assert.deepStrictEqual(D.dressPressure({ townTorch: 71, coverage: 1, reserve: 32, bagTorch: 0 }), { p: 1, torches: 39, known: true })
  assert.strictEqual(D.dressPressure({ townTorch: 34, coverage: 1, reserve: 32 }).p, -1)
  assert.strictEqual(D.dressPressure({ townTorch: 900, coverage: 0.2, reserve: 32, bagTorch: 2 }).torches, 2, 'an unread town: the bag alone')
  assert.strictEqual(S.sinkNextGate({ kind: 'dress', pressure: D.dressPressure({ townTorch: 71, coverage: 1 }) }).want, true)
  assert.strictEqual(S.sinkNextGate({ kind: 'dress', pressure: D.dressPressure({ townTorch: 30, coverage: 1 }) }).why, 'no_pressure')
  assert.ok(S.SINK_KINDS.includes('dress') && S.SINK_ROTATION[0] === 'dress' && S.SINK_LETTER.dress === 'L')
})

console.log('THE REAL VISIT RUNNER BUILDS A BATCH (buildrun.mjs runVisit on the fake server)')
await t('one builder builds a sited batch end to end: every post and light done, the sign cells left to the label writer, `complete`', async () => {
  const recs = RECS()
  const srv = town(recs.map(r => r.rec))
  const r = S.siteSink(srv.read, { kind: 'dress', n: 1, id: 'L1', home: HOME, records: recs, rec: null, torches: 20, stood: [] })
  assert.ok(r.ok)
  const rec = S.appendInstance(null, { kind: 'dress', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: 1 } })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dress-'))
  const key = PJ.projKey(HOME, rec.plot)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  let last = null
  for (let round = 0; round < 6 && last?.stop !== 'complete'; round++) {
    const sl = PJ.takeSlot(dir, key, 'A', 3)
    const e = bot(srv, 'A', { inv: { cobblestone: 200, stone_bricks: 40, torch: 40 }, feet: [2, HOME.y, 0] })
    last = await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: rec.palette, slot: sl.slot, slotGen: sl.gen, ...S.sinkVisitOpts(rec, HOME), alsoDone: q => D.dressSignRole(q.role) }, e, { maxSteps: 4000 })
    PJ.releaseLease(dir, key, `slot${sl.slot}`, 'A', sl.gen)
  }
  assert.strictEqual(last.stop, 'complete', JSON.stringify(last))
  for (const c of rec.cells) {
    const b = srv.read(...c.at)
    if (D.dressSignRole(c.role)) assert.strictEqual(b.name, 'air', 'the sign cell is the writer\'s')
    else assert.ok(R.cellDone(b, rec.palette, c.role), `${c.role} ${c.at} ${b.name}`)
  }
})

console.log('THE PICKER\'S SINK TURN (shop.mjs activeProject)')
const LIST = SH.PROJECTS.filter(p => ['shop', 'shaft', 'storehouse', 'hall', 'dress', 'tidy'].includes(p.plot))
const st0 = () => [{ plot: 'shop', exists: true, complete: true, damaged: false }, { plot: 'storehouse', exists: true, complete: true, damaged: false }, { plot: 'shaft', exists: true, complete: true, damaged: false }, { plot: 'hall', exists: true, complete: false, damaged: false },
  { plot: 'dress', exists: false, complete: false, damaged: false, sink: true, sinkNext: true }, { plot: 'tidy', exists: true, complete: false, damaged: false }]
await t('a finite project with a free slot comes first; on the sink turn the sink does; a repair still comes before both', () => {
  assert.strictEqual(SH.activeProject(st0(), LIST).plot, 'hall', 'POSITIVE CONTROL: the waiting hall, as LIVE 11-03')
  assert.strictEqual(SH.activeProject(st0(), LIST, { sinkTurn: true }).plot, 'dress')
  const rep = st0().map(s => (s.plot === 'shaft' ? { ...s, damaged: true } : s))
  assert.strictEqual(SH.activeProject(rep, LIST, { sinkTurn: true }).plot, 'shaft', 'the repair first')
  const none = st0().map(s => (s.plot === 'dress' ? { ...s, sinkNext: false } : s))
  assert.strictEqual(SH.activeProject(none, LIST, { sinkTurn: true }).plot, 'hall', 'no sink offered: as before')
})
await t('Codex r1 BLOCKER: a standing batch with signs DUE and no next batch funded is still offered on the sink turn (never starved by the hall)', () => {
  const st = st0().map(s => (s.plot === 'dress' ? { ...s, exists: true, complete: true, sinkNext: false, due: true } : s))
  assert.strictEqual(SH.activeProject(st, LIST, { sinkTurn: true }).plot, 'dress')
  assert.strictEqual(SH.activeProject(st.map(s => (s.plot === 'dress' ? { ...s, due: false } : s)), LIST, { sinkTurn: true }).plot, 'hall', 'POSITIVE CONTROL: nothing due, no batch: the hall')
})
await t('MUTANT KILLED: a sink offer that ignores a standing sink\'s due upkeep leaves its signs unwritten', async () => {
  await killed(SHOP_PATH, ' || (st(p).exists && st(p).complete && st(p).due))', ')', M => {
    const st = st0().map(s => (s.plot === 'dress' ? { ...s, exists: true, complete: true, sinkNext: false, due: true } : s))
    assert.strictEqual(M.activeProject(st, LIST, { sinkTurn: true }).plot, 'dress')
  })
})
await t('MUTANT KILLED: without the sink turn the sink never wins over an open finite project', async () => {
  await killed(SHOP_PATH, '  if (sink && sinkTurn) return sink\n', '', M => {
    assert.strictEqual(M.activeProject(st0(), LIST, { sinkTurn: true }).plot, 'dress')
  })
})

console.log('THE WIRING (skills.mjs, structural)')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const W = [
  /if \(dressSignRole\(c\.role\)\) continue/,
  /if \(tidy && r\.plot === SINK_PLOTS\.dress && dressSignWork\(bot, r\)\.length\) return true/,
  /pressure: kind === 'dress' \? dressPressureNow\(bot\) : pr, openCount/,
  /const pr = kind === 'dress' \? dressPressureNow\(bot\) : sinkPressureNow\(bot\)/,
  /if \(kind === 'dress' && rec0\) \{/,
  /const sg = await dressSignsVisit\(ctx, rec0, signal, t0 \+ budget - ZIG_VISIT_TAIL_MS\)/,
  /done: \(b, pal, role\) => dressSignRole\(role\) \|\| buildCellDone\(b, pal, role\)/,
  /kind === 'dress' \? \{ alsoDone: q => dressSignRole\(q\.role\) \} : \{\}/,
  /bot\.finiteStreak = isSinkPlot\(proj\.plot\) \? 0 : \(bot\.finiteStreak \?\? 0\) \+ 1/,
  /const r = await sortLabelOne\(ctx, sp, signal, deadline, \{ kind: 'town_sign' \}\)/,
  /if \(!item\) \{ const tr = \(bot\.sortSignTries \?\?= new Map\(\)\); for \(const sp of work\) tr\.set\(sp\.at\.join\(','\), \(tr\.get\(sp\.at\.join\(','\)\) \?\? 0\) \+ 1\) \}/,
  /buildRowDetail\(\{ project: SINK_PLOTS\.dress, op: 'place', seg: sp\.seg, cell: sp\.at,/,
]
await t('the dress sink is wired: sign cells are upkeep not damage, the gate reads torches, the visit writes signs first and logs each placement, the runner skips sign cells, the sink turn counts finite visits', () => {
  for (const re of W) assert.ok(re.test(SK), String(re))
})
await t('mutants: each wiring line, once broken, fails its assertion', () => {
  const breaks = ['if (dressSignRole(c.role)) continue', "kind === 'dress' ? { alsoDone: q => dressSignRole(q.role) } : {}", 'bot.finiteStreak = isSinkPlot(proj.plot) ? 0 : (bot.finiteStreak ?? 0) + 1']
  for (const b of breaks) {
    assert.strictEqual(SK.split(b).length, 2, `anchor unique: ${b}`)
    const m = SK.replace(b, 'BROKEN')
    assert.ok(W.some(re => !re.test(m)), b)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
