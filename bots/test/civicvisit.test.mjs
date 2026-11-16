// CIVICVISIT-01SHOW (LIVE showcase 11-15: civicH and civicM stuck for days, 55 cells "no stand reaches"; 47 of them have a stand at
// once when the workshop ring is not asked for). The siting proved each landmark with its stands within R + 8 of its anchor and its
// own walk radius; the build visit was handed neither. Behaviour: (1) civic.mjs civicVisitOpts / civicStandDomain -- a new record's
// kept spec rebuilds the siting's predicate, a record without one (the two live ones) stands within its box + 8, never anywhere;
// (2) a landmark SITED by the bots' own siting (buildsite.mjs siteBlueprint) beside home: every stand the proof wrote is in the
// visit's domain and none is in the workshop ring; stepFor has no step for its cells under the ring and one under the options;
// (3) the REAL visit (buildrun.mjs runVisit) places nothing under the ring (`deferred class=out_of_domain`) and builds the landmark
// with the options. Anchored mutants for each rule; STRUCTURAL source assertions only for the skills.mjs wiring (comments stripped).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { B, R, PJ, G, HOME, server, bot, plan, project } = await import('./helpers/buildfake.mjs')
const C = await import('../src/civic.mjs')
const SRC = f => new URL(`../src/${f}`, import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
/** A mutant of one src file (its anchor present and unique), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(SRC(file), 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-civicvisit-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** BOTH WAYS: the scenario passes on the real module and fails ITS OWN ASSERTION on the mutant (never a crash). */
const kills = async (old, neu, scenario) => {
  await scenario(C)
  let why = null
  await withMutant('civic.mjs', old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const cheb = (x, z, c) => Math.max(Math.abs(x - c[0]), Math.abs(z - c[1]))
const byCol = keys => { const m = new Map(); for (const key of keys) { const [x, y, z] = key.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) } return m }

// THE TWO LIVE RECORDS, as the showcase holds them (box, walkR, no stand spec) and stands the siting's proof wrote on their cells
const LIVE = {
  civicH: { rec: { blueprint: 'civic@1-Hl', box: [8, 14, 12, 18], walkR: 64, civic: { kind: 'H', look: 'l' } }, stands: [[12, 66, 18], [10, 67, 19], [7, 67, 18], [11, 68, 13]] },
  civicM: { rec: { blueprint: 'civic@1-M04', box: [-20, 9, -14, 15], walkR: 64, civic: { kind: 'M', look: '04' } }, stands: [[-18, 66, 8], [-21, 66, 9]] },
}
const LIVE_HOME = { x: 0, y: 70, z: 0 }

console.log('THE OPTIONS (civic.mjs civicVisitOpts, civicStandDomain)')
const switchOff = M => {
  for (const v of ['off', '0', 'false', 'no', 'OFF', ' No ']) { assert.strictEqual(M.civicVisitOn({ CIVICVISIT: v }), false, v); assert.deepStrictEqual(M.civicVisitOpts(LIVE.civicH.rec, { CIVICVISIT: v }), {}, `off (${v}): the visit's options as before -- none`) }
  for (const v of [undefined, '', 'on', '1', 'yes']) { assert.strictEqual(M.civicVisitOn({ CIVICVISIT: v }), true, String(v)); assert.strictEqual(typeof M.civicVisitOpts(LIVE.civicH.rec, { CIVICVISIT: v }).domain, 'function', 'POSITIVE CONTROL: on, the same record has a domain') }
}
await t('the switch: CIVICVISIT=off|0|false|no gives no options at all (the visit as before); unset or anything else is on', () => switchOff(C))
await t('MUTANT the switch ignored: off still hands the visit a domain', () => kills('(civicVisitOn(env) && isCivicBlueprint(rec?.blueprint) ?', '(isCivicBlueprint(rec?.blueprint) ?', switchOff))
const newStyle = M => {
  const near = [37, -12], spec = M.civicStandSpec(near)
  assert.deepStrictEqual(spec, { near: [37, -12], r: C.CIVIC_SITE.r + 8 }, 'the spec: the anchor and R + 8 (30)')
  const o = M.civicVisitOpts({ blueprint: 'civic@1-Sds', box: [40, -20, 44, -16], walkR: 71, standDom: spec }, {})
  const siting = M.civicStandDomain(spec)   // what skills.mjs civicSiteFor hands the proof
  let inside = 0, outside = 0
  for (let x = -20; x <= 90; x++) for (let z = -70; z <= 50; z++) {
    const was = cheb(x, z, near) <= C.CIVIC_SITE.r + 8                          // the siting's predicate as it was written before this piece
    assert.strictEqual(o.domain(x, z), was, `the visit's domain at ${x},${z}`); assert.strictEqual(siting(x, z), was, `the siting's at ${x},${z}`)
    if (was) inside++; else outside++
  }
  assert.strictEqual(inside, 61 * 61, 'the square of side 61 round the anchor'); assert.ok(outside > 5000, 'POSITIVE CONTROL: most of the grid is outside')
  assert.strictEqual(o.domain(60, -12), true, 'a column 16 beyond the box (x 60) but within 30 of the anchor: the spec, not the box, decides')
  assert.strictEqual(o.walkR, 71, 'the record\'s own walk radius')
}
await t('a NEW record (its siting\'s spec kept as `standDom`): the visit\'s domain IS the siting\'s predicate, column for column; its walk radius the record\'s', () => newStyle(C))
await t('MUTANT the kept spec ignored (the box rule for every record): the visit\'s domain is no longer the siting\'s', () => kills('  if (specOk(s)) { const [nx, nz] = s.near', '  if (false) { const [nx, nz] = s.near', newStyle))
await t('MUTANT the record\'s walk radius dropped for the floor', () => kills('walkR: Number.isFinite(rec.walkR) ? rec.walkR : CIVIC_WALK_R } : {})', 'walkR: CIVIC_WALK_R } : {})', newStyle))
const liveShaped = M => {
  for (const [plot, { rec, stands }] of Object.entries(LIVE)) {
    const o = M.civicVisitOpts(rec, {})
    assert.strictEqual(o.walkR, 64, `${plot}: the record's walk radius`)
    for (const s of stands) {
      assert.strictEqual(o.domain(s[0], s[2]), true, `${plot}: the recorded stand ${s} is a legal stand`)
      // THE HOLE (the positive control of the diagnosis): the same stand is refused by the ring the visit asked for until now
      assert.strictEqual(B.inDomain(LIVE_HOME, s[0], s[2]), false, `${plot}: ${s} is inside the workshop ring's inner edge`)
    }
    const [x0, z0, x1, z1] = rec.box
    // never "anywhere": exactly the box + 8
    for (const [x, z, want] of [[x0 - 8, z0 - 8, true], [x1 + 8, z1 + 8, true], [x0 - 9, z0, false], [x1 + 9, z1, false], [x0, z0 - 9, false], [x1, z1 + 9, false], [x0 + 40, z0, false], [x0, z0 - 40, false]]) assert.strictEqual(o.domain(x, z), want, `${plot}: ${x},${z}`)
  }
  assert.strictEqual(M.civicVisitOpts({ blueprint: 'civic@1-Hl', box: [8, 14, 12, 18] }, {}).walkR, C.CIVIC_WALK_R, 'no walk radius on the record: the landmarks\' floor (64)')
}
await t('THE TWO LIVE RECORDS (no spec): every stand the siting recorded is legal, the ring refuses each of them, and the domain is the box + 8 and no more', () => liveShaped(C))
await t('MUTANT no margin round the box: the recorded stands just outside it are refused again', () => kills('  const p = CIVIC_STAND_PAD\n', '  const p = 0\n', liveShaped))
const subset = M => {
  // every anchor the record allows: the screen kept the pad AND its 1-cell ring within CIVIC_SITE.r of it (buildsite.mjs screenSite)
  const Rr = C.CIVIC_SITE.r
  let anchors = 0, cols = 0
  for (const box of [LIVE.civicH.rec.box, LIVE.civicM.rec.box, [0, 0, 8, 8]]) {
    const dom = M.civicStandDomain({ box })
    const [x0, z0, x1, z1] = box
    for (let nx = x1 + 1 - Rr; nx <= x0 - 1 + Rr; nx++) for (let nz = z1 + 1 - Rr; nz <= z0 - 1 + Rr; nz++) {
      anchors++
      const siting = C.civicStandDomain(C.civicStandSpec([nx, nz]))
      for (let x = x0 - 14; x <= x1 + 14; x++) for (let z = z0 - 14; z <= z1 + 14; z++) if (dom(x, z)) { cols++; assert.ok(siting(x, z), `box ${box}: ${x},${z} is a stand the siting round ${nx},${nz} would have refused`) }
    }
  }
  assert.ok(anchors > 1000 && cols > 100000, `POSITIVE CONTROL: ${anchors} anchors, ${cols} columns checked`)
}
await t('the box + 8 never admits a stand the siting\'s proof would have refused, whatever the anchor was (every anchor the screen allows, three boxes)', () => subset(C))
await t('MUTANT a wider margin (box + 10): a stand beyond the siting\'s own domain is admitted', () => kills('  const p = CIVIC_STAND_PAD\n', '  const p = CIVIC_STAND_PAD + 2\n', subset))
const others = M => {
  for (const rec of [{}, { blueprint: 'cottage@2-Csg0c', box: [0, 0, 8, 8], walkR: 90 }, { blueprint: 'workshop@1', box: [0, 0, 8, 8] }, { blueprint: 'civic@1-', box: [0, 0, 8, 8] }, { civic: { kind: 'H' }, box: [0, 0, 8, 8] }, null, undefined]) assert.deepStrictEqual(M.civicVisitOpts(rec, {}), {}, JSON.stringify(rec))
  assert.strictEqual(typeof M.civicVisitOpts({ blueprint: 'civic@1-Hl', box: [0, 0, 4, 4] }, {}).domain, 'function', 'POSITIVE CONTROL: a landmark\'s record has options')
  // a landmark's record with neither a spec nor a box: no stand at all (fails closed), never the ring and never everywhere
  for (const rec of [{ blueprint: 'civic@1-Hl' }, { blueprint: 'civic@1-Hl', box: [1, 2, 3] }, { blueprint: 'civic@1-Hl', box: [1, 2, 3, null] }, { blueprint: 'civic@1-Hl', standDom: { near: [1], r: 30 } }]) {
    const d = M.civicVisitOpts(rec, {}).domain
    for (const [x, z] of [[0, 0], [2, 2], [30, 0], [-400, 9]]) assert.strictEqual(d(x, z), false, `${JSON.stringify(rec)} at ${x},${z}`)
  }
}
await t('another building\'s record gets no options; a landmark\'s record with neither a spec nor a box has no stand at all', () => others(C))
await t('MUTANT the blueprint test dropped: a cottage\'s record is handed the landmarks\' domain', () => kills('(civicVisitOn(env) && isCivicBlueprint(rec?.blueprint) ?', '(civicVisitOn(env) ?', others))

console.log('A LANDMARK SITED BY THE BOTS\' OWN SITING BESIDE HOME (buildsite.mjs siteBlueprint; the plaza with a block rim: no state-bearing cell)')
// the anchor 12 east of home; the screen's domain here is one pad and its ring (x 7..17, z -5..5: all of it inside the workshop
// ring's inner edge even 5 columns out), the stands' domain and the walk radius are the landmarks' own (skills.mjs civicSiteFor)
const BP = B.loadBlueprint('civic@1-Fcb')
const NEAR = [12, 0], SPEC = C.civicStandSpec(NEAR)
const LINE = cheb(HOME.x, HOME.z, NEAR) + C.CIVIC_SITE.r + 2, WALK = Math.max(C.CIVIC_WALK_R, LINE + 12)
const SITE = B.siteBlueprint(server().read, plan(), BP, { sectors: [{ sector: null, source: 'civic' }], plot: 'civicF', tries: C.CIVIC_SITE.tries, line: LINE, walkR: WALK,
  domain: (x, z) => x >= 7 && x <= 17 && z >= -5 && z <= 5, standDomain: C.civicStandDomain(SPEC) })
assert.ok(SITE.ok, `the plaza sites beside home (${SITE.why} ${JSON.stringify(SITE.sectors)})`)
const REC_NEW = { ...SITE.record, palette: BP.palette, civic: { kind: 'F', look: BP.look.code }, walkR: WALK, standDom: SPEC }
const REC_OLD = (({ standDom, ...r }) => r)(REC_NEW)
const KIT = () => Object.fromEntries(Object.entries(C.civicBill(BP)).map(([n, c]) => [n, c + 8]))

await t('the sited record: every stand its proof wrote is in the visit\'s domain (with the spec, and without it: the box + 8) and NONE is in the workshop ring', () => {
  assert.deepStrictEqual(REC_NEW.box, [8, -4, 16, 4]); assert.strictEqual(REC_NEW.walkR, 64); assert.ok(REC_NEW.cells.length > 100, `${REC_NEW.cells.length} cells`)
  const dn = C.civicVisitOpts(REC_NEW, {}).domain, dold = C.civicVisitOpts(REC_OLD, {}).domain
  let ring = 0
  for (const c of REC_NEW.cells) {
    assert.ok(dn(c.stand[0], c.stand[2]), `spec: ${c.stand}`); assert.ok(dold(c.stand[0], c.stand[2]), `box + 8: ${c.stand}`)
    if (B.inDomain(HOME, c.stand[0], c.stand[2])) ring++
  }
  assert.strictEqual(ring, 0, `of ${REC_NEW.cells.length} recorded stands, none is in the ring the visit asked for`)
})
const stepScene = M => {
  const srv = server()
  const first = REC_OLD.cells[0]
  const nodes = byCol(B.walkFrom(srv.read, HOME, new Set(REC_OLD.cells.filter(c => c.seg === first.seg).map(c => c.at.join(','))), 64))
  const o = M.civicVisitOpts(REC_OLD, {})
  assert.strictEqual(B.stepFor(srv.read, HOME, first.at, nodes, null), null, 'the ring (the visit before): no step for the first cell')
  assert.strictEqual(B.stepRefusal(srv.read, HOME, first.at, nodes, null).class, 'out_of_domain', '...because every stand near it is outside the ring')
  const s = B.stepFor(srv.read, HOME, first.at, nodes, o.domain)
  assert.ok(s, 'POSITIVE CONTROL: the same cell, the same walk, the landmark\'s options: a step')
  assert.ok(o.domain(s.stand[0], s.stand[2]) && !B.inDomain(HOME, s.stand[0], s.stand[2]))
  // and a cell that IS in the ring still has its step under the ring (the ring rule itself works)
  assert.ok(B.stepFor(srv.read, HOME, [30, G + 1, 0], nodes, null), 'POSITIVE CONTROL: a ground cell 30 east has a step under the ring')
  assert.strictEqual(B.stepFor(srv.read, HOME, [30, G + 1, 0], nodes, o.domain), null, 'the landmark\'s domain is not "anywhere": no stand for a cell 30 east')
}
await t('stepFor: a cell of the landmark has no step under the workshop ring and a step under the landmark\'s options; a far cell the other way round', () => stepScene(C))
await t('MUTANT the options answer "no stand anywhere" for a record without a spec: the cell has no step again', () => kills('  return (x, z) => x >= b[0] - p && x <= b[2] + p && z >= b[1] - p && z <= b[3] + p\n', '  return () => false\n', stepScene))

console.log('THE VISIT (buildrun.mjs runVisit on the fake server)')
const visit = async (rec, extra, opts = {}) => {
  const srv = server(), pr = project(rec)
  const e = bot(srv, 'A', { inv: KIT(), feet: [2, G + 1, 0] })
  const r = await R.runVisit({ ...pr.p('A'), record: rec, palette: rec.palette, ...extra }, e, { maxSteps: 4000, tempStand: false, deadline: Date.now() + 240_000, ...opts })
  const rows = e.logs.filter(([k]) => k === '_build').map(([, d]) => d)
  return { srv, r, rows, done: rec.cells.filter(c => R.cellDone(srv.read(...c.at), rec.palette, c.role)).length }
}
await t('AS IT WAS (no options: the ring, radius 48): nothing is placed, the first segment is deferred `class=out_of_domain`', async () => {
  const v = await visit(REC_OLD, {})
  assert.strictEqual(v.r.placed, 0); assert.strictEqual(v.done, 0); assert.strictEqual(v.r.stop, 'cell_deferred', `${v.r.stop} ${v.r.why}`)
  const d = v.rows.filter(x => x.op === 'deferred')
  assert.ok(d.length >= 1, 'a deferral row'); assert.deepStrictEqual([...new Set(d.map(x => x.class))], ['out_of_domain'], 'the row says why')
})
await t('WITH THE OPTIONS, the live-shaped record (no spec): the same visit builds the whole landmark', async () => {
  const v = await visit(REC_OLD, C.civicVisitOpts(REC_OLD, {}))
  assert.strictEqual(v.r.stop, 'complete', `${v.r.stop} ${v.r.why}`)
  assert.strictEqual(v.done, REC_OLD.cells.length, `${v.done} of ${REC_OLD.cells.length} cells`); assert.strictEqual(v.r.placed, REC_OLD.cells.length)
  assert.deepStrictEqual(v.rows.filter(x => x.op === 'deferred'), [], 'nothing deferred')
})
await t('WITH THE OPTIONS, a new record (the spec): the visit places from its first pass (30 steps of it)', async () => {
  const v = await visit(REC_NEW, C.civicVisitOpts(REC_NEW, {}), { maxSteps: 30 })
  assert.ok(v.r.placed >= 10 && v.done === v.r.placed, `${v.r.placed} placed, ${v.done} done (${v.r.stop})`)
  assert.deepStrictEqual(v.rows.filter(x => x.op === 'deferred'), [])
})
await t('CIVICVISIT=off: the options are none, and the visit is the one before (nothing placed)', async () => {
  const o = C.civicVisitOpts(REC_OLD, { CIVICVISIT: 'off' })
  assert.deepStrictEqual(o, {})
  const v = await visit(REC_OLD, o)
  assert.strictEqual(v.r.placed, 0); assert.strictEqual(v.r.stop, 'cell_deferred')
})

console.log('THE WIRING (skills.mjs; structural, comments stripped)')
const SK = strip(readFileSync(SRC('skills.mjs'), 'utf8'))
const VISIT_LINE = '    Object.assign(storeOpts, civicVisitOpts(rec))'
const SPEC_LINE = '    const standDom = civicStandSpec(near)'
const PROOF_ARG = 'domain, standDomain: civicStandDomain(standDom), line, walkR: Math.max(CIVIC_WALK_R, line + 12), tries: CIVIC_SITE.tries,'
const RECORD_ARG = "civic: { kind, look: bp.look.code }, walkR: Math.max(CIVIC_WALK_R, line + 12), ...(civicVisitOn() ? { standDom } : {}) } }"
const wired = src => {
  // the generic visit: the landmark's options join storeOpts after its `const` and before the visit they are spread into
  const a = src.indexOf('    const storeOpts = rec.blueprint === ENCHANT_BLUEPRINT ?'), b = src.indexOf(VISIT_LINE), c = src.indexOf('placedBy, ...storeOpts }, effects, { deadline: t0 + SHOP_VISIT_MS - 15_000 })')
  assert.ok(a > 0 && c > a, 'POSITIVE CONTROL: the generic visit\'s storeOpts and its runVisit are found')
  assert.ok(b > a && b < c, 'civicVisitOpts(rec) is assigned into storeOpts before the visit runs')
  assert.strictEqual(src.split(VISIT_LINE).length, 2, 'once')
  // the siting: ONE spec, proven with and kept on the record (only with the switch on)
  const f0 = src.indexOf('async function civicSiteFor ('), f1 = src.indexOf('\nconst enchantRead = ', f0)
  assert.ok(f0 > 0 && f1 > f0, 'POSITIVE CONTROL: civicSiteFor is found')
  const fn = src.slice(f0, f1)
  for (const [what, line] of [['the spec', SPEC_LINE], ['the proof\'s stand domain', PROOF_ARG], ['the record\'s spec', RECORD_ARG]]) assert.ok(fn.includes(line), `civicSiteFor: ${what}`)
  assert.ok(!/standDomain: \(x, z\) =>/.test(fn), 'no second, hand-written stand predicate in the siting')
}
await t('the generic visit takes the landmark\'s options; the siting proves with the spec it keeps on the record', () => wired(SK))
for (const [what, old, neu] of [
  ['the visit\'s line removed', VISIT_LINE, ''],
  ['the siting proves with a predicate of its own again', PROOF_ARG, PROOF_ARG.replace('civicStandDomain(standDom)', '(x, z) => Math.max(Math.abs(x - near[0]), Math.abs(z - near[1])) <= R + 8')],
  ['the spec never kept on the record', RECORD_ARG, RECORD_ARG.replace(', ...(civicVisitOn() ? { standDom } : {})', '')],
  ['the spec kept with the switch off too', RECORD_ARG, RECORD_ARG.replace('...(civicVisitOn() ? { standDom } : {})', 'standDom')],
]) {
  await t(`MUTANT ${what}: the structural check fails`, () => {
    assert.strictEqual(SK.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
    assert.throws(() => wired(SK.replace(old, neu)), assert.AssertionError)
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
