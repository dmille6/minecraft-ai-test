// DECORATOR-01: ONE BOT A TOWN MAKES IT BEAUTIFUL (bots/src/decorator.mjs; the `decor` sink in sinks.mjs; the decorator's order in
// shop.mjs activeProject via decorOrderPure; the kept flowers in cropkeep.mjs / hygiene.mjs / composter.mjs; a filled pot's family in
// buildrun.mjs; the skills.mjs wiring). Behaviour: the switch (and its restatement in cropkeep agreeing), the border rules (never a path,
// a record column, a door front, a reservation, a step over 1, an occupied or wet cell), the seeded pattern and runs, the walls first,
// the pots beside a REAL workshop record's doorway (buildsite.mjs siteBlueprint on the flat fake world), the proof, the instance, the
// whole siting, the NURSERY (its column classes, the window, the prefix-sum search equal to a brute-force search, the digs), the gate,
// the decorator's ORDER through the real activeProject (the holder works the decor first behind repairs; no other bot ever sees it),
// the lease's term, the REAL visit runner building a batch end to end, and the kept flowers. Anchored mutants (each anchor present and
// unique) for every rule a test leans on; STRUCTURAL source assertions only for the wiring.
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { R, PJ, G, HOME, server, bot, SITE, BP } = await import('./helpers/buildfake.mjs')
const D = await import('../src/decorator.mjs')
const S = await import('../src/sinks.mjs')
const SH = await import('../src/shop.mjs')
const TD = await import('../src/towndress.mjs')
const PK = await import('../src/park.mjs')
const CK = await import('../src/cropkeep.mjs')
const CM = await import('../src/composter.mjs')
const GKM = await import('../src/groundskeeper.mjs')
const HUB = await import('../src/storehub.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const DEC_PATH = new URL('../src/decorator.mjs', import.meta.url)
const SINKS_PATH = new URL('../src/sinks.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const RUN_PATH = new URL('../src/buildrun.mjs', import.meta.url)
const CM_PATH = new URL('../src/composter.mjs', import.meta.url)
const CK_PATH = new URL('../src/cropkeep.mjs', import.meta.url)
/** A mutant of a module, its anchor present and unique (CLAUDE.md), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const MODS = new Map([[DEC_PATH.href, D], [SINKS_PATH.href, S], [SHOP_PATH.href, SH], [RUN_PATH.href, R], [CM_PATH.href, CM], [CK_PATH.href, CK]])
/** BOTH WAYS: the scenario passes on the real module and throws on the mutant. */
const killed = async (file, old, neu, scenario) => {
  await scenario(MODS.get(file.href))
  let k = false
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
}

// ---- a fake town on the flat server: a path along z = 0 (x -30..30) on the grass, a finished house north of it -----------------------
const P = 'cobblestone'
const pathsRec = () => ({ plot: 'paths', blueprint: 'paths@1', structure_complete: true, palette: { path: [P] }, cells: Array.from({ length: 61 }, (_, i) => ({ at: [i - 30, G, 0], role: 'path', seg: 'P-a-0' })) })
/** A house x 3..7, z 4..8, walls G+1..G+3 with a doorway at (5, G+1..G+2, 4) facing -z (the path). */
const houseRec = (done = true) => {
  const cells = []
  for (let x = 3; x <= 7; x++) for (let z = 4; z <= 8; z++) for (let y = G + 1; y <= G + 3; y++) if ((x === 3 || x === 7 || z === 4 || z === 8) && !(x === 5 && z === 4 && y <= G + 2)) cells.push({ at: [x, y, z], role: 'wall', seg: 'w' })
  return { plot: 'house1', blueprint: 'house@1', structure_complete: done, palette: { wall: ['cobblestone'] }, box: [3, 4, 7, 8], cells }
}
const HOUSE_DOOR = { cells: [[5, G + 1, 4]], out: [0, -1], t: [1, 0] }
const doorOf = r => (r.plot === 'house1' ? HOUSE_DOOR : null)
const town = (recs) => {
  const srv = server()
  for (const r of recs) for (const c of r.cells) srv.set(c.at, r.palette[c.role][0])
  return srv
}
const RECS = (done = true) => [{ plot: 'paths', rec: pathsRec() }, { plot: 'house1', rec: houseRec(done) }]

console.log('THE SWITCH AND ITS RESTATEMENTS')
await t('decorOn: on in the showcase by default, off elsewhere, DECORATOR=on|off wins; cropkeep.mjs decorKeepOn agrees on every case', () => {
  const cases = [[{}, 'showcase', true], [{}, 'hive-a', false], [{ DECORATOR: 'off' }, 'showcase', false], [{ DECORATOR: 'on' }, 'hive-a', true], [{ DECORATOR_POOLS: 'hive-a,showcase' }, 'hive-a', true], [{ DECORATOR_POOLS: '*' }, 'x', true], [{}, '', false]]
  for (const [env, pool, want] of cases) { assert.strictEqual(D.decorOn(env, pool), want, JSON.stringify([env, pool])); assert.strictEqual(CK.decorKeepOn(env, pool), want, `cropkeep ${JSON.stringify([env, pool])}`) }
  assert.deepStrictEqual([...CK.DECOR_KEPT].sort(), [...PK.SMALL_FLOWERS, 'fern'].sort(), 'the kept flowers are the small flowers and the fern (decorator-02)')
  assert.strictEqual(D.DECOR_FLOWER_CAP, HUB.PLANT_CAPS.flower, 'the harvest cap is the storage hall\'s per-type flower cap')
})
await t('the projects list: the decor plot only with SINKS and the decorator both on (rollback: DECORATOR=off or SINK_KINDS without decor)', () => {
  const plots = (...a) => SH.projectsOn(true, true, true, true, true, true, true, true, true, true, true, ...a).map(p => p.plot)
  assert.ok(plots(true, S.SINK_KINDS, true, true, true, true, true, true, true).includes('decor'))
  assert.ok(!plots(true, S.SINK_KINDS, true, true, true, true, true, true, false).includes('decor'), 'DECORATOR=off')
  assert.ok(plots(true, S.SINK_KINDS, true, true, true, true, true, true, false).includes('dress'), 'POSITIVE CONTROL: the dress stays')
  assert.ok(!plots(true, ['road', 'dress'], true, true, true, true, true, true, true).includes('decor'), 'SINK_KINDS without decor')
  assert.ok(SH.projectsGuarded([]).some(p => p.plot === 'decor'), 'a sited batch stays guarded whatever the switch')
})

console.log('THE BORDER RULES (decorator.mjs borderAt)')
await t('a flower beside a path: never on the path, a record column, a door front, a reserved column, a step over 1, an occupied, snowed or wet cell', () => {
  const recs = RECS().map(r => r.rec)
  const srv = town(recs)
  const pathCols = TD.pathColumns(pathsRec())
  const guard = TD.cellGuard(recs)
  const ok = D.borderAt(srv.read, pathCols.get('10,0'), [10, 1], { pathCols, guard })
  assert.deepStrictEqual(ok.at, [10, G + 1, 1], 'POSITIVE CONTROL: on the grass beside the path'); assert.deepStrictEqual(ok.ground, [10, G, 1])
  assert.strictEqual(D.borderAt(srv.read, pathCols.get('10,0'), [11, 0], { pathCols, guard }).why, 'path')
  assert.strictEqual(D.borderAt(srv.read, pathCols.get('10,0'), [10, 1], { pathCols, guard, reserved: () => 'protected' }).why, 'reserved:protected')
  const g2 = TD.cellGuard([...recs, { cells: [{ at: [18, G - 3, 1], role: 'x' }], palette: {} }])
  assert.strictEqual(D.borderAt(srv.read, pathCols.get('18,0'), [18, 1], { pathCols, guard: g2 }).why, 'record', 'a record cell anywhere in the column')
  const g3 = TD.cellGuard([...recs, { cells: [{ at: [20, G + 1, 3], role: 'd' }], palette: { d: ['oak_door'] } }])
  assert.strictEqual(D.borderAt(srv.read, pathCols.get('20,0'), [20, 1], { pathCols, guard: g3 }).why, 'door', 'two in front of a door')
  srv.set([12, G + 1, 1], 'dirt'); srv.set([12, G + 2, 1], 'grass_block')
  assert.strictEqual(D.borderAt(srv.read, pathCols.get('12,0'), [12, 1], { pathCols, guard }).why, 'occupied', 'a ground 2 above the path: its cell over the path\'s step is no open cell')
  srv.set([13, G + 1, 1], 'grass_block')
  assert.deepStrictEqual(D.borderAt(srv.read, pathCols.get('13,0'), [13, 1], { pathCols, guard }).at, [13, G + 2, 1], 'a ground 1 up: the step rule allows it')
  srv.set([14, G + 1, 1], 'snow'); assert.strictEqual(D.borderAt(srv.read, pathCols.get('14,0'), [14, 1], { pathCols, guard }).why, 'occupied', 'a snow layer')
  srv.set([15, G + 1, 1], 'poppy'); assert.strictEqual(D.borderAt(srv.read, pathCols.get('15,0'), [15, 1], { pathCols, guard }).why, 'occupied', 'a flower already there')
  srv.set([16, G + 1, 1], 'short_grass'); assert.ok(D.borderAt(srv.read, pathCols.get('16,0'), [16, 1], { pathCols, guard }).at, 'short grass is replaced')
  srv.set([17, G, 2], 'water'); assert.strictEqual(D.borderAt(srv.read, pathCols.get('17,0'), [17, 1], { pathCols, guard }).why, 'wet')
  srv.set([19, G, 1], 'stone'); assert.strictEqual(D.borderAt(srv.read, pathCols.get('19,0'), [19, 1], { pathCols, guard }).why, 'no_soil', 'stone is no soil')
})
await t('MUTANT KILLED: a border rule that forgets the record columns plants a flower in another project\'s column', async () => {
  await killed(DEC_PATH, "  if (guard.cols.has(ks)) return { why: 'record' }\n", '', M => {
    const srv = town([pathsRec()])
    const pathCols = TD.pathColumns(pathsRec())
    const g2 = TD.cellGuard([pathsRec(), { cells: [{ at: [18, G - 3, 1], role: 'x' }], palette: {} }])
    assert.strictEqual(M.borderAt(srv.read, pathCols.get('18,0'), [18, 1], { pathCols, guard: g2 }).why, 'record')
  })
})
await t('MUTANT KILLED: a border rule with no step limit plants on ground 2 above the path', async () => {
  await killed(DEC_PATH, '  for (let g = p.y + DECOR.stepMax; g >= p.y - DECOR.stepMax; g--) {', '  for (let g = p.y + 3; g >= p.y - DECOR.stepMax; g--) {', M => {
    const srv = town([pathsRec()])
    srv.set([12, G + 1, 1], 'dirt'); srv.set([12, G + 2, 1], 'grass_block')
    const pathCols = TD.pathColumns(pathsRec())
    assert.ok(!M.borderAt(srv.read, pathCols.get('12,0'), [12, 1], { pathCols, guard: TD.cellGuard([pathsRec()]) }).at)
  })
})

console.log('THE SEEDED DESIGN, THE RUNS, THE WALLS FIRST')
await t('decorDesign: deterministic by seed and varied over seeds (patterns, schemes, runs); patternKeeps steps along a straight path', () => {
  assert.deepStrictEqual(D.decorDesign(1234), D.decorDesign(1234))
  const ds = Array.from({ length: 40 }, (_, i) => D.decorDesign(D.decorSeed('showcase', HOME, i + 1)))
  assert.ok(new Set(ds.map(d => `${d.pattern}:${d.scheme}`)).size >= 6, 'never the same everywhere')
  assert.ok(ds.every(d => d.run >= 4 && d.run <= D.DECOR.runMax))
  const alt = { pattern: 'alt', n: 2, phase: 0 }
  const keep = Array.from({ length: 6 }, (_, i) => D.patternKeeps(alt, i, 1))
  assert.deepStrictEqual(keep, [false, true, false, true, false, true])
})
await t('borderCandidates: inside the walls first, then by ring; pickBorder: the pattern only, runs of neighbours, at most max', () => {
  const recs = RECS().map(r => r.rec)
  const srv = town(recs)
  const guard = TD.cellGuard(recs)
  const inside = (x, z) => x >= 20 && x <= 30
  const cands = D.borderCandidates(srv.read, pathsRec(), HOME, { guard, inside })
  assert.ok(cands.length > 100, `${cands.length}`)
  assert.ok(cands.slice(0, 22).every(c => c.inside) && !cands.at(-1).inside, 'the walls first')
  const solid = { pattern: 'solid', n: 1, phase: 0, run: 5 }
  const b = D.pickBorder(cands, { design: solid, max: 10 })
  assert.strictEqual(b.length, 10)
  assert.ok(b.slice(0, 5).every(c => c.inside), 'the first run inside')
  for (let i = 1; i < 5; i++) assert.ok(Math.max(Math.abs(b[i].at[0] - b[i - 1].at[0]), Math.abs(b[i].at[2] - b[i - 1].at[2])) <= 2, 'a run of neighbours')
  const alt = { pattern: 'alt', n: 2, phase: 1, run: 6 }
  assert.ok(D.pickBorder(cands, { design: alt, max: 16 }).every(c => D.patternKeeps(alt, c.at[0], c.at[2])))
})
await t('MUTANT KILLED: a pick that ignores the pattern plants every column (no rhythm)', async () => {
  await killed(DEC_PATH, '  const left = cands.filter(c => patternKeeps(design, c.at[0], c.at[2]))', '  const left = cands.slice()', M => {
    const recs = RECS().map(r => r.rec)
    const cands = M.borderCandidates(town(recs).read, pathsRec(), HOME, { guard: TD.cellGuard(recs) })
    const alt = { pattern: 'alt', n: 2, phase: 1, run: 6 }
    assert.ok(M.pickBorder(cands, { design: alt, max: 16 }).every(c => M.patternKeeps(alt, c.at[0], c.at[2])))
  })
})

console.log('THE POTS BY THE DOORWAYS')
await t('potSpots: two columns past each end of the doorway, one out from the facade, the wall behind -- never the front, never unfinished', () => {
  const recs = RECS().map(r => r.rec)
  const srv = town(recs)
  const guard = TD.cellGuard(recs)
  const pathCols = TD.pathColumns(pathsRec())
  const s = D.potSpots(srv.read, 'house1', houseRec(), HOUSE_DOOR, { pathCols, guard })
  assert.deepStrictEqual(s.map(q => q.at).sort(), [[3, G + 1, 3], [7, G + 1, 3]])
  assert.ok(s.every(q => q.front[0] === 5 && q.front[2] === 3), 'the front is the doorway\'s own, kept clear')
  assert.strictEqual(D.potSpots(srv.read, 'house1', houseRec(false), HOUSE_DOOR, { pathCols, guard }).length, 0, 'an unfinished building: none')
  assert.strictEqual(D.potSpots(srv.read, 'paths', pathsRec(), HOUSE_DOOR, { pathCols, guard }).length, 0, 'not a building')
  assert.strictEqual(D.potSpots(srv.read, 'house1', houseRec(), HOUSE_DOOR, { pathCols, guard, reserved: (x) => (x === 3 ? 'zone' : null) }).length, 1, 'a reservation')
  srv.set([7, G + 1, 3], 'oak_planks')
  assert.strictEqual(D.potSpots(srv.read, 'house1', houseRec(), HOUSE_DOOR, { pathCols, guard }).length, 1, 'an occupied spot')
})
await t('MUTANT KILLED: a pot spot that forgets the wall behind stands a pot loose in the yard', async () => {
  await killed(DEC_PATH, '      if (!ownCells.has(kOf(wall))) continue\n', '', M => {
    const rec = houseRec()
    rec.cells = rec.cells.filter(c => !(c.at[0] === 3 && c.at[2] === 4))   // no wall behind the west spot
    const srv = town([pathsRec(), rec])
    assert.deepStrictEqual(M.potSpots(srv.read, 'house1', rec, HOUSE_DOOR, { pathCols: TD.pathColumns(pathsRec()), guard: TD.cellGuard([pathsRec(), rec]) }).map(q => q.at), [[7, G + 1, 3]])
  })
})
await t('doorwayOf on a REAL workshop record (buildsite.mjs siteBlueprint on the flat world): the blueprint doorway placed, outward toward v < 0', () => {
  const dw = D.doorwayOf(SITE.record, BP)
  assert.ok(dw && dw.cells.length === 1, JSON.stringify(dw))
  const own = new Set(SITE.record.cells.map(c => `${c.at[0]},${c.at[2]}`))
  const [x, y, z] = dw.cells[0]
  assert.ok(own.has(`${x},${z}`) && !SITE.record.cells.some(c => c.at.join(',') === `${x},${y},${z}`), 'the doorway is an open cell of the building\'s footprint')
  assert.strictEqual(y, SITE.record.s + 1, 'the feet height')
  // step outward until the footprint ends: within 2 columns (the doorway in the wall, the step row)
  let k = 1
  while (own.has(`${x + k * dw.out[0]},${z + k * dw.out[1]}`) && k < 5) k++
  assert.ok(k <= 2, 'outward leaves the footprint at once')
  assert.strictEqual(D.doorwayOf({ door: [-10, 71, 3], front: [[-10, 4]] }).out.join(), '0,1', 'the storehouse: its door and front')
  // the workshop on the world: its pots stand by the doorway on the step row's ledge or the ground, each against the wall
  const srv = server()
  for (const c of SITE.record.cells) srv.set(c.at, c.role === 'window' ? 'glass_pane' : 'stone_bricks')
  const s = D.potSpots(srv.read, 'shop', { ...SITE.record, structure_complete: true }, dw, { pathCols: new Map(), guard: TD.cellGuard([SITE.record]) })
  assert.ok(s.length >= 1, 'the workshop gets pots')
  for (const q of s) { assert.ok(Math.abs((q.at[0] - x) * dw.t[0] + (q.at[2] - z) * dw.t[1]) === 2); assert.strictEqual(srv.read(...q.at).name, 'air') }
})

console.log('THE PROOF, THE INSTANCE, THE SITING')
await t('proveDecor: an ornament with no stand in reach is dropped; the pots go in first and never shut the doorway\'s front', () => {
  const recs = RECS().map(r => r.rec)
  const srv = town(recs)
  // a border cell boxed in by walls 2 high, nothing reaches it
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) for (let y = G + 1; y <= G + 4; y++) srv.set([25 + dx, y, 20 + dz], 'stone')
  for (let x = 24; x <= 26; x++) for (let z = 19; z <= 21; z++) srv.set([x, G + 5, z], 'stone')
  const pr = D.proveDecor(srv.read, HOME, { border: [{ at: [10, G + 1, 1] }, { at: [25, G + 1, 20] }], pots: D.potSpots(srv.read, 'house1', houseRec(), HOUSE_DOOR, { pathCols: TD.pathColumns(pathsRec()), guard: TD.cellGuard(recs) }) })
  assert.deepStrictEqual(pr.border.map(c => c.at), [[10, G + 1, 1]])
  assert.strictEqual(pr.pots.length, 2)
})
await t('decorInstance: one segment a run, the pots their own; roles rotate (neighbours differ); zones each ornament\'s own column', () => {
  const border = [[0, 1], [1, 1], [2, 1], [10, 1], [11, 1]].map(([x, z]) => ({ at: [x, G + 1, z] }))
  const inst = D.decorInstance('D3', { border, pots: [{ at: [3, G + 1, 3], door: [5, G + 1, 4], plot: 'house1' }], design: { pattern: 'solid', n: 1, scheme: 'warm' } })
  assert.deepStrictEqual(inst.segments.map(s => s.seg), ['D3-B0', 'D3-B1', 'D3-P'])
  assert.deepStrictEqual(inst.cells.map(c => c.role), ['D3-f0', 'D3-f1', 'D3-f2', 'D3-f3', 'D3-f0', 'D3-pot'])
  assert.notStrictEqual(inst.palette['D3-f0'][0], inst.palette['D3-f1'][0])
  assert.ok(inst.palette['D3-f0'].every(n => D.BORDER_PLANTS.includes(n)))
  assert.deepStrictEqual(inst.palette['D3-pot'], ['flower_pot'])
  assert.ok(inst.zones.every(z => z.box[0] === z.box[3] && z.box[2] === z.box[5]))
  assert.ok(D.decorPotRole('D3-pot') && D.decorFlowerRole('D3-f2') && !D.decorFlowerRole('L3-light'))
  const rec = S.appendInstance(null, { kind: 'decor', home: HOME, inst, meta: { id: 'D3', n: 3, box: inst.box, zones: inst.zones, cols: inst.cols, sitedAt: 1 } })
  assert.ok(rec.zones.every(z => z.box[3] - z.box[0] === 0), 'appendInstance keeps the decor zones (never a box over the batch)')
  assert.strictEqual(rec.plot, 'decor'); assert.strictEqual(rec.blueprint, 'decor@1')
})
await t('MUTANT KILLED: appendInstance without the decor zones fences the box over the batch', async () => {
  await killed(SINKS_PATH, "(kind === 'dress' || kind === 'decor') && Array.isArray(meta.zones) ? meta.zones :", "kind === 'dress' && Array.isArray(meta.zones) ? meta.zones :", M => {
    const inst = D.decorInstance('D1', { border: [{ at: [-30, G + 1, 1] }, { at: [30, G + 1, -1] }], pots: [], design: { pattern: 'solid', n: 1, scheme: 'mixed' } })
    const rec = M.appendInstance(null, { kind: 'decor', home: HOME, inst, meta: { id: 'D1', n: 1, box: inst.box, zones: inst.zones, cols: inst.cols, sitedAt: 1 } })
    assert.ok(rec.zones.every(z => z.box[3] - z.box[0] <= 2))
  })
})
await t('siteSink(decor) on the fake town: a proven batch off every record and path, sized by the bag\'s plants, pots only with pots; none below plantsMin', () => {
  const recs = RECS()
  const srv = town(recs.map(r => r.rec))
  const r = S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, seed: 77, records: recs, rec: null, plants: 9, pots: 2, doorOf, stood: [] })
  assert.ok(r.ok, JSON.stringify(r))
  const guard = TD.cellGuard(recs.map(x => x.rec))
  const pathCols = TD.pathColumns(pathsRec())
  assert.ok(!r.inst.cells.some(c => guard.cells.has(c.at.join(',')) || pathCols.has(`${c.at[0]},${c.at[2]}`)))
  assert.ok(r.meta.plants <= 9 && r.meta.plants > 0)
  assert.strictEqual(r.meta.pots.length, 2)
  assert.strictEqual(S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, seed: 77, records: recs, plants: 9, pots: 0, doorOf }).meta.pots.length, 0, 'no pot in hand: none')
  assert.strictEqual(S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, seed: 77, records: recs, plants: 3, pots: 0, doorOf }).why, 'no_plants')
  assert.strictEqual(S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, records: [{ plot: 'house1', rec: houseRec() }], plants: 9 }).why, 'no_paths')
  // the next batch keeps off the first and never pots the same spot twice
  const rec = S.appendInstance(null, { kind: 'decor', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: 1 } })
  const r2 = S.siteSink(srv.read, { kind: 'decor', n: 2, id: 'D2', home: HOME, seed: 78, records: recs, rec, plants: 9, pots: 2, doorOf })
  assert.ok(r2.ok)
  const first = new Set(r.inst.cells.map(c => c.at.join(',')))
  assert.ok(!r2.inst.cells.some(c => first.has(c.at.join(','))))
  assert.strictEqual(r2.meta.pots.length, 0, 'both pots stand already')
})

console.log('THE NURSERY')
await t('nurseryColumn: no grass is no refusal; a reserved, record-column or record-cell landing is', () => {
  const srv = server()
  const guard = TD.cellGuard([pathsRec()])
  assert.strictEqual(D.nurseryColumn(srv.read, 20, 20, G, { guard }), 'land')
  assert.strictEqual(D.nurseryColumn(srv.read, 5, 0, G, { guard }), 'record', 'a path column (grass under the fake path: the guard reads its column)')
  srv.set([21, G, 20], 'stone'); assert.strictEqual(D.nurseryColumn(srv.read, 21, 20, G, { guard }), 'none')
  assert.strictEqual(D.nurseryColumn(srv.read, 22, 20, G, { guard, reserved: () => 'park' }), 'reserved:park')
  srv.set([23, G + 1, 20], 'oak_planks'); assert.strictEqual(D.nurseryColumn(srv.read, 23, 20, G, { guard }), 'none', 'covered grass seeds nothing')
})
await t('nurseryOk / siteNursery: the nearest centre whose spread window holds no refusal; the prefix-sum search agrees with a brute force', () => {
  const srv = server()
  // a reservation strip and a record round home: the nursery must sit its whole spread (7) clear of them
  const recs = [pathsRec(), houseRec()]
  for (const r of recs) for (const c of r.cells) srv.set(c.at, r.palette[c.role][0])
  for (let x = -40; x <= 40; x++) for (let z = 12; z <= 14; z++) srv.set([x, G, z], 'stone')   // a stone band: no grass, no refusal
  const guard = TD.cellGuard(recs)
  const reserved = (x, z) => (z <= -15 && z >= -18 ? 'corridor' : null)
  const n = D.siteNursery(srv.read, HOME, { guard, reserved, searchR: 40 })
  assert.ok(n.ok, JSON.stringify(n))
  const v = D.nurseryOk(srv.read, n.nursery.at, { guard, reserved })
  assert.ok(v.ok && v.landing >= D.NURSERY.coreMin)
  const R7 = D.NURSERY.spread
  for (let dx = -R7; dx <= R7; dx++) for (let dz = -R7; dz <= R7; dz++) {
    const x = n.nursery.at[0] + dx, z = n.nursery.at[2] + dz
    assert.ok(!reserved(x, z) || D.nurseryColumn(srv.read, x, z, G, { guard }) === 'none')
    assert.ok(!guard.cols.has(`${x},${z}`) || D.nurseryColumn(srv.read, x, z, G, { guard }) === 'none')
  }
  // brute force: no centre on a nearer ring is a nursery
  const ring = Math.max(Math.abs(n.nursery.at[0]), Math.abs(n.nursery.at[2]))
  for (let r = D.NURSERY.minR; r < ring; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
    assert.ok(!D.nurseryOk(srv.read, [dx, G, dz], { guard, reserved }).ok, `a nearer nursery at ${dx},${dz}`)
  }
  assert.strictEqual(D.siteNursery(srv.read, HOME, { guard, reserved: () => 'all', searchR: 20 }).ok, false, 'everything reserved: none')
})
await t('MUTANT KILLED: a nursery check that ignores a refused landing column in its window lets a meal seed a reservation', async () => {
  // (siteNursery's prefix-sum window is the search's SPEED -- every candidate is confirmed by nurseryOk; the brute-force agreement
  // above is its test. The SAFETY is nurseryOk's.)
  await killed(DEC_PATH, "    if (v !== 'land') return { ok: false, why: v }\n", '', M => {
    const srv = server()
    assert.strictEqual(M.nurseryOk(srv.read, [20, G, 20], { guard: TD.cellGuard([]), reserved: x => (x === 26 ? 'corridor' : null) }).ok, false)
  })
})
await t('MUTANT KILLED: a step ledge that takes any block seats a pot on what someone left by the door', async () => {
  await killed(DEC_PATH, "      if (dy === 1 && !ownCells.has(kOf([at[0], at[1] - 1, at[2]]))) continue\n", '', M => {
    const srv = town(RECS().map(r => r.rec))
    srv.set([7, G + 1, 3], 'oak_planks')
    assert.deepStrictEqual(M.potSpots(srv.read, 'house1', houseRec(), HOUSE_DOOR, { pathCols: TD.pathColumns(pathsRec()), guard: TD.cellGuard(RECS().map(r => r.rec)) }).map(q => q.at), [[3, G + 1, 3]])
  })
})
await t('Codex r1 BLOCKER 1: grass UNDER an overhang is a landing cell too -- a protected column with one refuses the nursery; unread is a refusal', () => {
  const srv = server()
  // a protected column beside the centre whose grass has air above and STONE 3 above it (the old top-only scan read it 'none')
  srv.set([24, G + 3, 20], 'stone')
  const reserved = (x, z) => (x === 24 && z === 20 ? 'protected' : null)
  assert.strictEqual(D.nurseryColumn(srv.read, 24, 20, G, { guard: TD.cellGuard([]), reserved }), 'reserved:protected')
  assert.strictEqual(D.nurseryOk(srv.read, [20, G, 20], { guard: TD.cellGuard([]), reserved }).ok, false)
  srv.set([24, G + 1, 20], 'stone')
  assert.strictEqual(D.nurseryColumn(srv.read, 24, 20, G, { guard: TD.cellGuard([]), reserved }), 'none', 'POSITIVE CONTROL: covered grass seeds nothing')
  // grass 6 below the centre's height (a meal's walk can drop one a step) is in reach
  const s2 = server()
  s2.set([30, G, 30], 'air'); for (let y = G - 6; y < G; y++) s2.set([30, y, 30], 'air'); s2.set([30, G - 6, 30], 'grass_block')
  assert.strictEqual(D.nurseryColumn(s2.read, 30, 30, G, { guard: TD.cellGuard([]), reserved: () => 'zone' }), 'reserved:zone')
  assert.strictEqual(D.nurseryColumn(srv.read, 59, 59, G, { guard: TD.cellGuard([]) }), 'land', 'POSITIVE CONTROL: read')
  assert.strictEqual(D.nurseryColumn(srv.read, 70, 70, G, { guard: TD.cellGuard([]) }), 'unread', 'an unread column is never nothing')
})
await t('MUTANT KILLED: a top-only scan misses the grass under an overhang (Codex r1 BLOCKER 1)', async () => {
  await killed(DEC_PATH, '  for (let g = y - NURSERY.spread; g <= y + NURSERY.spread; g++) {', '  for (let g = y + 1; g <= y + 1; g++) {', M => {
    const srv = server()
    srv.set([24, G + 3, 20], 'stone')
    assert.strictEqual(M.nurseryColumn(srv.read, 24, 20, G, { guard: TD.cellGuard([]), reserved: (x, z) => (x === 24 && z === 20 ? 'protected' : null) }), 'reserved:protected')
  })
})
await t('Codex r1 BLOCKER 2: the flowers an open border owes are never a pot\'s; a visit that changed nothing is a stall', () => {
  assert.strictEqual(D.potPlantFor({ poppy: 3, spruce_sapling: 20 }, 0, 3), 'spruce_sapling', 'the three poppies are the border\'s')
  assert.strictEqual(D.potPlantFor({ poppy: 3 }, 0, 3), null)
  assert.strictEqual(D.potPlantFor({ poppy: 4 }, 0, 3), 'poppy', 'one spare')
  assert.strictEqual(D.potPlantFor({ fern: 1 }, 0, 1), null, 'Codex r2: an owed fern is the border\'s too')
  assert.strictEqual(D.potPlantFor({ fern: 1, azalea: 1 }, 0, 1), 'azalea')
  const rec = { cells: [{ at: [1, 1, 1], role: 'D1-f0' }, { at: [2, 1, 1], role: 'D1-f1' }, { at: [3, 1, 3], role: 'D1-pot' }] }
  assert.strictEqual(D.flowersOwed(rec, c => c.at[0] === 1), 1)
  assert.strictEqual(D.decorStalled({}), true)
  for (const k of ['placed', 'pots', 'meals', 'blooms', 'cleared']) assert.strictEqual(D.decorStalled({ [k]: 1 }), false, k)
})
await t('MUTANT KILLED: a pot that takes the border\'s flowers starves the open batch', async () => {
  await killed(DEC_PATH, '  const fl = spare ? SMALL_FLOWERS.filter(have) : []', '  const fl = SMALL_FLOWERS.filter(have)', M => {
    assert.strictEqual(M.potPlantFor({ poppy: 3, spruce_sapling: 20 }, 0, 3), 'spruce_sapling')
  })
})
await t('nurseryDigs: every flower in reach on grass (nearest first), the grass only round the centre, never a record cell', () => {
  const srv = server()
  const nursery = { at: [20, G, 20] }
  srv.set([21, G + 1, 20], 'poppy'); srv.set([26, G + 1, 25], 'dandelion'); srv.set([28, G + 1, 20], 'poppy')
  srv.set([21, G + 1, 21], 'short_grass'); srv.set([24, G + 1, 20], 'short_grass')
  const guard = { cells: new Set([`26,${G + 1},25`]) }
  const d = D.nurseryDigs(srv.read, nursery, { guard })
  assert.deepStrictEqual(d.blooms.map(q => q.at), [[21, G + 1, 20]], 'within spread 7; the record\'s flower stays; the one at 8 is out of reach')
  assert.deepStrictEqual(d.grass.map(q => q.at), [[21, G + 1, 21]], 'grass within clearR only')
})
await t('decorBase: a nothing-to-build base naming home (published before the first fern: the read\'s DC4 needs a generation in force)', () => {
  const b = D.decorBase(null, { home: HOME })
  assert.deepStrictEqual(b.home, HOME); assert.strictEqual(b.structure_complete, true); assert.strictEqual(S.sinkOpen(b), false); assert.strictEqual(b.blueprint, 'decor@1')
  const r = { x: 1 }; assert.strictEqual(D.decorBase(r, { home: HOME }), r, 'an existing record unchanged')
})
await t('withNursery: a nursery-only record (no instance, nothing to build); a new nursery moves the old to `nurseries`; appendInstance keeps them', () => {
  const r1 = D.withNursery(null, { at: [1, G, 1], box: [-6, -6, 8, 8] }, { home: HOME, now: 5 })
  assert.strictEqual(r1.structure_complete, true); assert.strictEqual(S.sinkOpen(r1), false); assert.strictEqual(r1.nursery.sitedAt, 5)
  const r2 = D.withNursery(r1, { at: [30, G, 30], box: [23, 23, 37, 37] }, { home: HOME, now: 6 })
  assert.deepStrictEqual(r2.nurseries.map(n => n.at), [[1, G, 1]])
  const inst = D.decorInstance('D1', { border: [{ at: [0, G + 1, 1] }], pots: [], design: { pattern: 'solid', n: 1, scheme: 'mixed' } })
  const r3 = S.appendInstance(r2, { kind: 'decor', home: HOME, inst, meta: { id: 'D1', n: 1, box: inst.box, zones: inst.zones, cols: inst.cols, sitedAt: 7 } })
  assert.deepStrictEqual(r3.nursery.at, [30, G, 30]); assert.strictEqual(r3.nurseries.length, 1); assert.strictEqual(S.sinkOpen(r3), true)
})

console.log('THE GATE, THE PLANTS, THE ORDER, THE LEASE')
await t('decorPressure: the bag\'s plants + what the bone meal grows (the town\'s above the park\'s four, read); pots with a plant; sinkNextGate opens on it', () => {
  assert.strictEqual(D.decorPressure({ held: { poppy: 4 } }).p, 1)
  assert.strictEqual(D.decorPressure({ held: { poppy: 1 } }).p, -1)
  const m = D.decorPressure({ held: {}, townMeal: 8, coverage: 1 })
  assert.strictEqual(m.meal, 4, 'the park keeps four'); assert.strictEqual(m.p, 1)
  assert.strictEqual(D.decorPressure({ held: {}, townMeal: 5, coverage: 1 }).p, -1, 'one meal grows ~2.8 flowers: under plantsMin')
  assert.strictEqual(D.decorPressure({ held: {}, townMeal: 90, coverage: 0.3 }).meal, 0, 'an unread town: the bag alone')
  assert.strictEqual(D.decorPressure({ held: { flower_pot: 1, spruce_sapling: 20 }, potsOn: true }).p, 1, 'a pot and a spare sapling')
  assert.strictEqual(D.decorPressure({ held: { flower_pot: 1, spruce_sapling: 20 } }).p, -1, 'decorator-02: pots skipped by default (owner 11-05)')
  assert.strictEqual(D.decorPressure({ held: { flower_pot: 1, spruce_sapling: 16 }, potsOn: true }).p, -1, 'the planters\' reserve stays whole')
  assert.strictEqual(D.decorPressure({ held: {}, wildFerns: 30 }).p, 1, 'decorator-02: wild ferns a gather reaches fund a batch')
  assert.strictEqual(S.sinkNextGate({ kind: 'decor', pressure: { p: 1 }, openCount: 9 }).want, true, 'no stone sink holds the decor back')
  assert.strictEqual(S.sinkNextGate({ kind: 'tower', pressure: { p: 1 }, openCount: 9 }).why, 'max_open', 'POSITIVE CONTROL')
  assert.strictEqual(S.stoneOpenCount({ decor: { instances: [{}], structure_complete: false } }), 0)
})
await t('MUTANT KILLED: a gate that counts the stone sinks holds the decorator back', async () => {
  await killed(SINKS_PATH, "  if (kind !== 'dress' && kind !== 'decor' && openCount >= SINK.maxOpen) return { want: false, why: 'max_open' }", "  if (kind !== 'dress' && openCount >= SINK.maxOpen) return { want: false, why: 'max_open' }", M => {
    assert.strictEqual(M.sinkNextGate({ kind: 'decor', pressure: { p: 1 }, openCount: 9 }).want, true)
  })
})
await t('potPlantFor: a flower first (the seed picks), then a fern or an azalea, a sapling only above its reserve', () => {
  assert.ok(['poppy', 'dandelion'].includes(D.potPlantFor({ poppy: 1, dandelion: 2, spruce_sapling: 40 }, 3)))
  assert.notStrictEqual(D.potPlantFor({ poppy: 1, dandelion: 2 }, 0), D.potPlantFor({ poppy: 1, dandelion: 2 }, 1), 'neighbouring pots differ')
  assert.strictEqual(D.potPlantFor({ fern: 1, spruce_sapling: 40 }), 'fern')
  assert.strictEqual(D.potPlantFor({ spruce_sapling: 17 }), 'spruce_sapling')
  assert.strictEqual(D.potPlantFor({ spruce_sapling: 16 }), null)
  assert.strictEqual(D.pottedOf('azalea'), 'potted_azalea_bush'); assert.strictEqual(D.pottedOf('poppy'), 'potted_poppy')
})
// the order through the REAL activeProject: an open finite project with a free slot, a sink, the decor wanted
const LIST = SH.PROJECTS.filter(p => ['shop', 'shaft', 'house1', 'dress', 'decor', 'tidy'].includes(p.plot))
const st0 = () => [{ plot: 'shop', exists: true, complete: true, damaged: false }, { plot: 'shaft', exists: true, complete: true, damaged: false }, { plot: 'house1', exists: true, complete: false, damaged: false },
  { plot: 'dress', exists: true, complete: true, damaged: false, sink: true, sinkNext: true }, { plot: 'decor', exists: false, complete: false, damaged: false, sink: true, sinkNext: true }, { plot: 'tidy', exists: true, complete: false, damaged: false }]
await t('decorOrderPure + activeProject: the HOLDER works the decor first (over a free finite project, the dress and the tidy), a repair still first', () => {
  assert.strictEqual(SH.activeProject(st0(), LIST).plot, 'house1', 'POSITIVE CONTROL: without the order, the house')
  const r = D.decorOrderPure(st0(), LIST, { d: 'mine' })
  assert.strictEqual(SH.activeProject(r.states, r.order).plot, 'decor')
  const rep = st0().map(s => (s.plot === 'shaft' ? { ...s, damaged: true } : s))
  const r2 = D.decorOrderPure(rep, LIST, { d: 'mine' })
  assert.strictEqual(SH.activeProject(r2.states, r2.order).plot, 'shaft', 'the repair first')
  const due = st0().map(s => (s.plot === 'dress' ? { ...s, sinkNext: false, due: true, dueFirst: true } : s))
  const r3 = D.decorOrderPure(due, LIST, { d: 'mine' })
  assert.strictEqual(SH.activeProject(r3.states, r3.order).plot, 'decor', 'another\'s upkeep waits')
})
await t('decorOrderPure: EVERY OTHER bot never sees the decor -- not as a sink, an upkeep or a repair; nothing wanted: the holder is as before', () => {
  for (const d of ['other', 'none', 'take']) {
    const only = st0().map(s => (s.plot === 'house1' || s.plot === 'tidy' ? { ...s, complete: true, exists: true } : s.plot === 'dress' ? { ...s, sinkNext: false } : s))
    const r = D.decorOrderPure(only, LIST, { d })
    assert.notStrictEqual(SH.activeProject(r.states, r.order).plot, 'decor', d)
    const rep = st0().map(s => (s.plot === 'decor' ? { ...s, exists: true, complete: true, damaged: true } : s))
    const r2 = D.decorOrderPure(rep, LIST, { d })
    assert.notStrictEqual(SH.activeProject(r2.states, r2.order).plot, 'decor', `${d}: never its repair`)
  }
  const idle = st0().map(s => (s.plot === 'decor' ? { ...s, sinkNext: false } : s))
  assert.strictEqual(D.decorWanted(idle.find(s => s.plot === 'decor')), false)
  const r = D.decorOrderPure(idle, LIST, { d: 'mine' })
  assert.strictEqual(SH.activeProject(r.states, r.order).plot, 'house1', 'no decor work: the holder\'s order as before')
})
await t('MUTANT KILLED: an order that leaves the decor visible to other bots sends them to the decorator\'s work', async () => {
  await killed(DEC_PATH, "  out[i] = { ...out[i], free: false, damaged: false, due: false, dueFirst: false, sinkOpen: false, sinkNext: false }\n", '', M => {
    const only = st0().map(s => (s.plot === 'house1' || s.plot === 'tidy' ? { ...s, complete: true, exists: true } : s.plot === 'dress' ? { ...s, sinkNext: false } : s))
    const r = M.decorOrderPure(only, LIST, { d: 'other' })
    assert.notStrictEqual(SH.activeProject(r.states, r.order).plot, 'decor')
  })
})
await t('MUTANT KILLED: an order that only moves the decor first never passes the finite tier (Codex design)', async () => {
  await killed(DEC_PATH, '      out[k] = { ...s, free: false, due: false, dueFirst: false }\n', '', M => {
    const r = M.decorOrderPure(st0(), LIST, { d: 'mine' })
    assert.strictEqual(SH.activeProject(r.states, r.order).plot, 'decor')
  })
})
await t('the lease (groundskeeper.mjs keeperDecision with DECOR): take when free and wanted, mine while held, release after the term or with no work, rest after a term', () => {
  const now = 1_000_000_000
  const held = (holder, at) => ({ rec: { holder, at, meta: { term0: at } }, holdsUntil: at + D.DECOR.leaseTtlMs, blocksUntil: at + D.DECOR.leaseTtlMs + 60_000 })
  assert.strictEqual(GKM.keeperDecision({ lease: null, me: 'A', now, work: true, G: D.DECOR }), 'take')
  assert.strictEqual(GKM.keeperDecision({ lease: null, me: 'A', now, work: false, G: D.DECOR }), 'none')
  assert.strictEqual(GKM.keeperDecision({ lease: held('A', now - 1000), me: 'A', now, work: true, G: D.DECOR }), 'mine')
  assert.strictEqual(GKM.keeperDecision({ lease: held('B', now - 1000), me: 'A', now, work: true, G: D.DECOR }), 'other')
  assert.strictEqual(GKM.keeperDecision({ lease: held('A', now - 1000), me: 'A', now, work: false, G: D.DECOR }), 'release')
  const long = { ...held('A', now - 1000), rec: { holder: 'A', at: now - 1000, meta: { term0: now - D.DECOR.termMs - 1 } } }
  assert.strictEqual(GKM.keeperDecision({ lease: long, me: 'A', now, work: true, G: D.DECOR }), 'release')
  assert.strictEqual(GKM.keeperDecision({ lease: null, me: 'A', now, work: true, restUntil: now + 5, G: D.DECOR }), 'none')
})

console.log('THE REAL VISIT RUNNER BUILDS A BATCH (buildrun.mjs runVisit on the fake server)')
await t('the decorator builds a sited batch end to end: every flower on its grass, both pots placed, `complete`; a filled pot reads done', async () => {
  const recs = RECS()
  const srv = town(recs.map(r => r.rec))
  const r = S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, seed: 77, records: recs, rec: null, plants: 8, pots: 2, doorOf, stood: [] })
  assert.ok(r.ok)
  const rec = S.appendInstance(null, { kind: 'decor', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: 1 } })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decor-'))
  const key = PJ.projKey(HOME, rec.plot)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  let last = null
  const inv = { poppy: 5, dandelion: 5, flower_pot: 2 }
  for (let round = 0; round < 6 && last?.stop !== 'complete'; round++) {
    const sl = PJ.takeSlot(dir, key, 'A', 3)
    const e = bot(srv, 'A', { inv, feet: [2, HOME.y, 0] })
    last = await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: rec.palette, slot: sl.slot, slotGen: sl.gen, ...S.sinkVisitOpts(rec, HOME) }, e, { maxSteps: 4000 })
    PJ.releaseLease(dir, key, `slot${sl.slot}`, 'A', sl.gen)
  }
  assert.strictEqual(last.stop, 'complete', JSON.stringify(last))
  for (const c of rec.cells) {
    const b = srv.read(...c.at)
    assert.ok(R.cellDone(b, rec.palette, c.role), `${c.role} ${c.at} ${b.name}`)
    if (D.decorFlowerRole(c.role)) { assert.ok(['poppy', 'dandelion'].includes(b.name)); assert.strictEqual(srv.read(c.at[0], c.at[1] - 1, c.at[2]).name, 'grass_block') }
  }
  const pot = rec.cells.find(c => D.decorPotRole(c.role))
  srv.set(pot.at, 'potted_poppy')
  assert.ok(R.cellDone(srv.read(...pot.at), rec.palette, pot.role), 'a filled pot is still the pot')
  assert.deepStrictEqual(D.emptyPots(rec, srv.read).length, 1, 'the other pot is empty: the fill\'s work')
  assert.ok(S.sinkOpenRole('D1-f2') && !S.sinkOpenRole('D1-pot'), 'a flower is walked through, a pot is not')
})
await t('MUTANT KILLED: without the pot family a filled pot reads as damage (the decorator would dig it up as foreign)', async () => {
  await killed(RUN_PATH, "  if (/^potted_/.test(s)) return 'flower_pot'\n", '', M => {
    assert.ok(M.cellDone({ name: 'potted_spruce_sapling', boundingBox: 'block' }, { 'D1-pot': ['flower_pot'] }, 'D1-pot'))
  })
})

console.log('THE KEPT FLOWERS (cropkeep.mjs, hygiene.mjs, composter.mjs)')
await t('with the decorator on, the flowers leave NEVER_KEEP and the composter never takes one (the peaceful kit\'s either); off: as before', () => {
  const base = new Set(['poppy', 'dandelion', 'fern', 'wheat_seeds'])
  assert.ok(!CK.neverKeepFor(base, { CROPFARM: 'off' }, 'showcase').has('poppy'))
  assert.ok(CK.neverKeepFor(base, { CROPFARM: 'off', DECORATOR: 'off' }, 'showcase').has('poppy'), 'POSITIVE CONTROL: off')
  assert.ok(!CK.neverKeepFor(base, { CROPFARM: 'off' }, 'showcase').has('fern'), 'decorator-02: a fern is decor stock now')
  const items = [{ name: 'poppy', count: 3 }, { name: 'allium', count: 2 }, { name: 'fern', count: 2 }]
  const on = CM.compostAllowance(items, { plants: true, decorKeeps: CK.decorKeeps({}, 'showcase') })
  assert.ok(!on.poppy && !on.allium, JSON.stringify(on))
  const off = CM.compostAllowance(items, { plants: true, decorKeeps: CK.decorKeeps({ DECORATOR: 'off' }, 'showcase') })
  assert.ok(off.allium === 2, `POSITIVE CONTROL: the peaceful kit composts flowers with the decorator off ${JSON.stringify(off)}`)
})
await t('MUTANT KILLED: a composter that forgets the decorator\'s keep eats the nursery\'s harvest', async () => {
  await killed(CM_PATH, '    if (decorKeeps?.has?.(it?.name)) continue   // decorator-01: the decorator\'s flowers\n', '', M => {
    const on = M.compostAllowance([{ name: 'allium', count: 2 }], { plants: true, decorKeeps: CK.decorKeeps({}, 'showcase') })
    assert.ok(!on.allium)
  })
})

await t('decorAllow: the town draw takes bone meal up to the decorator\'s cap (mats.mjs takeAllowed alone takes none)', async () => {
  const M = await import('../src/mats.mjs')
  assert.strictEqual(M.takeAllowed('bone_meal', 4, { here: { bone_meal: 8 } }), 0, 'POSITIVE CONTROL: the default allowance refuses bone meal')
  const SKM = await import('../src/skills.mjs')
  const a = SKM.decorAllow({ bone_meal: 3 })
  assert.strictEqual(a('bone_meal', 4, { here: { bone_meal: 8 } }), 3); assert.strictEqual(a('bone_meal', 4, { here: { bone_meal: 1 } }), 1); assert.strictEqual(a('iron_ingot', 2, { here: { iron_ingot: 9 } }), 0)
})
console.log('DECORATOR-02: FERN CLUSTERS, THE COMPOST DRIVE, POTS OFF (owner 11-05)')
await t('decorPotsOn: pots are OFF unless DECOR_POTS=on; siteDecor with pots 0 sites none', () => {
  assert.strictEqual(D.decorPotsOn({}), false); assert.strictEqual(D.decorPotsOn({ DECOR_POTS: 'on' }), true); assert.strictEqual(D.decorPotsOn({ DECOR_POTS: 'off' }), false)
})
await t('fernTargets: ferns on soil near home, a large fern at its lower half counted 2, never reserved, a record column or cell, never past fernR; nearest first, at most max and want', () => {
  const srv = server()
  srv.set([10, G + 1, 10], 'fern'); srv.set([12, G + 1, 10], 'large_fern'); srv.set([12, G + 2, 10], 'large_fern')
  srv.set([14, G + 1, 10], 'fern'); srv.set([16, G + 1, 10], 'fern'); srv.set([55, G + 1, 0], 'fern'); srv.set([18, G + 1, 10], 'fern'); srv.set([18, G, 10], 'stone')
  const cands = [[10, G + 1, 10, 'fern'], [12, G + 2, 10, 'large_fern'], [14, G + 1, 10, 'fern'], [16, G + 1, 10, 'fern'], [55, G + 1, 0, 'fern'], [18, G + 1, 10, 'fern']].map(([x, y, z, name]) => ({ at: [x, y, z], name }))
  const guard = TD.cellGuard([{ cells: [{ at: [16, G - 2, 10], role: 'x' }], palette: {} }])
  const t1 = D.fernTargets(cands, { read: srv.read, guard, reserved: x => (x === 14 ? 'zone' : null), home: HOME, from: [10, G + 1, 10] })
  assert.deepStrictEqual(t1.map(q => [q.at, q.n]), [[[10, G + 1, 10], 1], [[12, G + 1, 10], 2]], JSON.stringify(t1))
  assert.strictEqual(D.fernTargets(cands, { read: srv.read, guard, home: HOME, from: [10, G + 1, 10], want: 1 }).length, 1, 'want')
  assert.strictEqual(D.fernTargets(cands, { read: srv.read, guard, home: HOME, from: [10, G + 1, 10], max: 1 }).length, 1, 'max')
})
await t('MUTANT KILLED: a fern gather that forgets the record columns cuts a planted fern out of another project', async () => {
  await killed(DEC_PATH, '    if (reserved(x, z) || guard.cols.has(k2(x, z)) || guard.cells.has(k) || guard.cells.has(kOf([x, y + 1, z]))) continue\n', '    if (reserved(x, z)) continue\n', M => {
    const srv = server(); srv.set([16, G + 1, 10], 'fern')
    const guard = TD.cellGuard([{ cells: [{ at: [16, G - 2, 10], role: 'x' }], palette: {} }])
    assert.strictEqual(M.fernTargets([{ at: [16, G + 1, 10], name: 'fern' }], { read: srv.read, guard, home: HOME }).length, 0)
  })
})
await t('assignKinds + decorInstance: with the design\'s ferns every other run is a fern cluster (when the bag covers it), the rest flowers, a cell nothing covers dropped', () => {
  const border = [[0, 1], [1, 1], [2, 1], [3, 1], [10, 1], [11, 1], [12, 1], [20, 1], [21, 1], [22, 1]].map(([x, z]) => ({ at: [x, G + 1, z] }))
  const design = { pattern: 'solid', n: 1, scheme: 'mixed', fern: true }
  assert.deepStrictEqual(D.borderRuns(border, design).map(r => r.length), [4, 3, 3])
  const a = D.assignKinds(border, design, { flowers: 7, ferns: 3 })
  assert.deepStrictEqual(a.kinds, ['f', 'f', 'f', 'f', 'g', 'g', 'g', 'f', 'f', 'f'])
  const b = D.assignKinds(border, design, { flowers: 2, ferns: 0 })
  assert.deepStrictEqual(b.kinds.filter(Boolean).length, 2, 'two plants, two cells')
  assert.deepStrictEqual(D.assignKinds(border, { ...design, fern: false }, { flowers: 10, ferns: 10 }).kinds.every(k => k === 'f'), true, 'no fern design: flowers first')
  const inst = D.decorInstance('D2', { border, design, kinds: a.kinds })
  assert.deepStrictEqual(inst.palette['D2-g'], ['fern'])
  assert.strictEqual(inst.cells.filter(c => c.role === 'D2-g').length, 3)
  assert.ok(D.decorFlowerRole('D2-g') && D.decorFernRole('D2-g') && !D.decorFernRole('D2-f1') && S.sinkOpenRole('D2-g'))
})
await t('siteSink(decor) with ferns: a fern cluster sited from the bag\'s ferns, the summary names it; flowers alone or ferns alone fund a batch', () => {
  const recs = RECS()
  const srv = town(recs.map(r => r.rec))
  let seed = 1
  while (!D.decorDesign(seed).fern || D.decorDesign(seed).pattern !== 'solid') seed++
  const r = S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, seed, records: recs, flowers: 6, ferns: 8, doorOf, stood: [] })
  assert.ok(r.ok, JSON.stringify(r))
  assert.ok(r.meta.ferns > 0 && r.inst.cells.some(c => c.role === 'D1-g'), r.meta.summary)
  assert.ok(r.meta.flowers <= 6 && r.meta.ferns <= 8)
  assert.ok(S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, seed, records: recs, flowers: 0, ferns: 6, doorOf }).ok, 'ferns alone')
})
await t('the REAL visit runner plants a fern cluster on grass', async () => {
  const recs = RECS()
  const srv = town(recs.map(r => r.rec))
  let seed = 1
  while (!D.decorDesign(seed).fern || D.decorDesign(seed).pattern !== 'solid') seed++
  const r = S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, seed, records: recs, flowers: 4, ferns: 4, doorOf, stood: [] })
  const rec = S.appendInstance(null, { kind: 'decor', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: 1 } })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decor2-'))
  const key = PJ.projKey(HOME, rec.plot)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const inv = { poppy: 4, fern: 4 }
  let last = null
  for (let round = 0; round < 6 && last?.stop !== 'complete'; round++) {
    const sl = PJ.takeSlot(dir, key, 'A', 3)
    last = await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: rec.palette, slot: sl.slot, slotGen: sl.gen, ...S.sinkVisitOpts(rec, HOME) }, bot(srv, 'A', { inv, feet: [2, HOME.y, 0] }), { maxSteps: 4000 })
    PJ.releaseLease(dir, key, `slot${sl.slot}`, 'A', sl.gen)
  }
  assert.strictEqual(last.stop, 'complete', JSON.stringify(last))
  assert.ok(rec.cells.filter(c => D.decorFernRole(c.role)).every(c => srv.read(...c.at).name === 'fern'))
})
await t('the compost drive: driveWants only with DRIVE.feedMin junk and the town (read) under DRIVE.target; townOrder composts below the full-bag trigger only while its hook asks', () => {
  assert.strictEqual(D.driveWants({ junk: 8, townMeal: 3, coverage: 1 }), true)
  assert.strictEqual(D.driveWants({ junk: 7, townMeal: 3, coverage: 1 }), false)
  assert.strictEqual(D.driveWants({ junk: 9, townMeal: 16, coverage: 1 }), false, 'the town has enough')
  assert.strictEqual(D.driveWants({ junk: 9, townMeal: 3, coverage: 0.2 }), false, 'an unread town never drives')
  const args = { now: 10_000_000, slots: 20, junk: 9, distHome: 2, storageNear: true, composterAtTown: true, state: {} }
  try {
    CM.setCompostDrive(() => false)
    assert.strictEqual(CM.townOrder(args).order, null, 'POSITIVE CONTROL: below the trigger, no drive: as before')
    assert.strictEqual(CM.townOrder({ ...args, slots: 34 }).order?.skill, 'compost', 'the full-bag trigger as before')
    CM.setCompostDrive(junk => junk >= 8)
    const o = CM.townOrder(args).order
    assert.strictEqual(o?.skill, 'compost'); assert.strictEqual(o.args.drive, true)
  } finally { CM.setCompostDrive(null) }
  assert.strictEqual(CM.townOrder(args).order, null, 'the hook unset: never')
})
await t('MUTANT KILLED: a townOrder that ignores the drive never composts the nursery\'s grass below a full bag', async () => {
  await killed(CM_PATH, "  const compostReady = cooled && (slots >= TRIGGER_SLOTS || drive) && junk > 0", "  const compostReady = cooled && slots >= TRIGGER_SLOTS && junk > 0", M => {
    try { M.setCompostDrive(() => true); assert.strictEqual(M.townOrder({ now: 10_000_000, slots: 20, junk: 9, distHome: 2, storageNear: true, composterAtTown: true, state: {} }).order?.skill, 'compost') } finally { M.setCompostDrive(null) }
  })
})
await t('the drive never takes decor stock: a fern and a flower stay with the decorator on; short grass goes', () => {
  const k = CK.decorKeeps({}, 'showcase')
  const a = CM.compostAllowance([{ name: 'fern', count: 5 }, { name: 'poppy', count: 3 }, { name: 'short_grass', count: 9 }], { decorKeeps: k })
  assert.ok(!a.fern && !a.poppy && a.short_grass === 9, JSON.stringify(a))
  assert.ok(!CK.neverKeepFor(new Set(['fern', 'short_grass']), { CROPFARM: 'off' }, 'showcase').has('fern'))
})

console.log('DECORATOR-03: LEAF HEDGES AND LANTERN POSTS')
await t('hedgeCells: one column further out behind a flower run, under the border rules; proveHedges keeps only hedges the town walk loses nothing to', () => {
  const recs = RECS().map(r => r.rec)
  const srv = town(recs)
  const guard = TD.cellGuard(recs)
  const pathCols = TD.pathColumns(pathsRec())
  const chosen = D.borderCandidates(srv.read, pathsRec(), HOME, { guard }).filter(c => c.at[2] === -1 && c.at[0] >= 10 && c.at[0] <= 13)
  const hs = D.hedgeCells(srv.read, chosen, { pathCols, guard })
  assert.deepStrictEqual(hs.map(h => h.at), chosen.map(c => [c.at[0], G + 1, -2]))
  assert.deepStrictEqual(D.proveHedges(srv.read, HOME, hs).length, hs.length, 'an open field: every hedge kept')
  // a one-wide gap two high between two walls: a hedge there would shut it (stepped onto, its head is the lintel)
  const s2 = server()
  for (let x = -10; x <= 10; x++) for (let y = G + 1; y <= G + 3; y++) { if (x !== 0) s2.set([x, y, 5], 'stone') }
  for (let z = -10; z <= 10; z++) for (let y = G + 1; y <= G + 3; y++) { s2.set([-10, y, z], 'stone'); s2.set([10, y, z], 'stone') }
  for (let x = -10; x <= 10; x++) for (let y = G + 1; y <= G + 3; y++) s2.set([x, y, 10], 'stone'); s2.set([0, G + 3, 5], 'stone')
  const kept = D.proveHedges(s2.read, HOME, [{ at: [0, G + 1, 5] }, { at: [3, G + 1, -3] }], { walkR: 20 })
  assert.deepStrictEqual(kept.map(h => h.at), [[3, G + 1, -3]], 'the gap\'s hedge dropped, the open one kept')
})
await t('MUTANT KILLED: a hedge proof that never checks the walk shuts a way off', async () => {
  await killed(DEC_PATH, '  if (!lost(hedges)) return hedges\n', '  return hedges\n', M => {
    const s2 = server()
    for (let x = -10; x <= 10; x++) for (let y = G + 1; y <= G + 3; y++) { if (x !== 0) s2.set([x, y, 5], 'stone') }
    for (let z = -10; z <= 10; z++) for (let y = G + 1; y <= G + 3; y++) { s2.set([-10, y, z], 'stone'); s2.set([10, y, z], 'stone') }
    for (let x = -10; x <= 10; x++) for (let y = G + 1; y <= G + 3; y++) s2.set([x, y, 10], 'stone'); s2.set([0, G + 3, 5], 'stone')
    assert.strictEqual(M.proveHedges(s2.read, HOME, [{ at: [0, G + 1, 5] }], { walkR: 20 }).length, 0)
  })
})
await t('siteSink(decor) with leaves and lantern kits: hedges behind the flowers (a hedge design), posts on the doorway spots (pots off), a lantern on each fence', () => {
  const recs = RECS()
  const srv = town(recs.map(r => r.rec))
  let seed = 1
  while (!D.decorDesign(seed).hedge || D.decorDesign(seed).pattern !== 'solid' || D.decorDesign(seed).fern) seed++
  const r = S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, seed, records: recs, flowers: 8, ferns: 0, leaves: 8, posts: 2, pots: 0, doorOf, stood: [] })
  assert.ok(r.ok, JSON.stringify(r))
  const hedge = r.inst.cells.filter(c => c.role === 'D1-h'), post = r.inst.cells.filter(c => c.role === 'D1-post'), lamp = r.inst.cells.filter(c => c.role === 'D1-lamp')
  assert.ok(hedge.length > 0, r.meta.summary)
  assert.strictEqual(post.length, 2); assert.strictEqual(lamp.length, 2)
  for (const p of post) assert.ok(lamp.some(l => l.at[0] === p.at[0] && l.at[2] === p.at[2] && l.at[1] === p.at[1] + 1))
  assert.deepStrictEqual(post.map(q => q.at).sort(), [[3, G + 1, 3], [7, G + 1, 3]], 'the doorway\'s spots')
  assert.ok(r.inst.segments.find(q => q.seg === 'D1-H').deps.length > 0, 'the hedge after the flowers')
  assert.ok(D.decorBagRole('D1-h') && D.decorBagRole('D1-post') && D.decorBagRole('D1-lamp') && !D.decorBagRole('D1-pot'))
  const r2 = S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, seed, records: recs, flowers: 8, leaves: 0, posts: 0, doorOf })
  assert.ok(!r2.inst.cells.some(c => /-(h|post|lamp)$/.test(c.role)), 'no leaves, no kit: neither')
})
await t('Codex r1 BLOCKER 1: the hedges are proven over the batch\'s posts -- a hedge that, with a post, shuts a doorway front is dropped', () => {
  // the house's doorway front (5, G+1, 3): its posts stand at x 3 and 7; a hedge at (4, G+1, 2) and (6, G+1, 2) with walls round the
  // front's other side (z 2 row) would leave the front reachable alone, but not with the posts' fences
  const recs = RECS()
  const srv = town(recs.map(r => r.rec))
  for (let x = 2; x <= 8; x++) if (x !== 4 && x !== 5 && x !== 6) for (let y = G + 1; y <= G + 3; y++) srv.set([x, y, 2], 'stone')
  for (let y = G + 1; y <= G + 3; y++) { srv.set([2, y, 3], 'stone'); srv.set([8, y, 3], 'stone') }
  for (let x = 4; x <= 6; x++) srv.set([x, G + 3, 2], 'stone')   // a 2-high gap in the z 2 row (a hedge stepped onto is shut)
  const posts = [{ at: [3, G + 1, 3] }, { at: [7, G + 1, 3] }]
  const solids = new Map(posts.flatMap(q => [[q.at.join(','), { name: 'spruce_fence', boundingBox: 'block' }], [[q.at[0], q.at[1] + 1, q.at[2]].join(','), { name: 'lantern', boundingBox: 'block' }]]))
  const B = (x, y, z) => solids.get(`${x},${y},${z}`) ?? srv.read(x, y, z)
  const hs = [{ at: [4, G + 1, 2] }, { at: [5, G + 1, 2] }, { at: [6, G + 1, 2] }]
  const kept = D.proveHedges(B, HOME, hs, { walkR: 20 })
  assert.ok(kept.length < hs.length, `with the posts standing a full hedge row shuts the front: ${JSON.stringify(kept)}`)
})
await t('the REAL visit runner builds a hedge and a lantern post (fence, then the lantern on its top)', async () => {
  const recs = RECS()
  const srv = town(recs.map(r => r.rec))
  let seed = 1
  while (!D.decorDesign(seed).hedge || D.decorDesign(seed).pattern !== 'solid' || D.decorDesign(seed).fern) seed++
  const r = S.siteSink(srv.read, { kind: 'decor', n: 1, id: 'D1', home: HOME, seed, records: recs, flowers: 6, leaves: 6, posts: 2, doorOf, stood: [] })
  const rec = S.appendInstance(null, { kind: 'decor', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: 1 } })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decor3-'))
  const key = PJ.projKey(HOME, rec.plot)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const inv = { poppy: 6, spruce_leaves: 6, spruce_fence: 2, lantern: 2 }
  let last = null
  for (let round = 0; round < 6 && last?.stop !== 'complete'; round++) {
    const sl = PJ.takeSlot(dir, key, 'A', 3)
    last = await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: rec.palette, slot: sl.slot, slotGen: sl.gen, ...S.sinkVisitOpts(rec, HOME) }, bot(srv, 'A', { inv, feet: [2, HOME.y, 0] }), { maxSteps: 4000 })
    PJ.releaseLease(dir, key, `slot${sl.slot}`, 'A', sl.gen)
  }
  assert.strictEqual(last.stop, 'complete', JSON.stringify(last))
  for (const c of rec.cells) assert.ok(R.cellDone(srv.read(...c.at), rec.palette, c.role), `${c.role} ${c.at} ${srv.read(...c.at).name}`)
})

console.log('THE WIRING (skills.mjs, structural)')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const W = [
  /const order0 = b \? decorOrder\(b, marked, order00, now\) : order00/,
  /if \(!decorLeaseNow\(bot\)\) return out\('no_effect', 'not_decorator',/,
  /const pf = await decorPotFill\(ctx, rec0, signal, t0 \+ budget - ZIG_VISIT_TAIL_MS, owed\)/,
  /const owed = rec0 \? flowersOwed\(rec0, q => buildCellDone\(rd0\(\.\.\.q\.at\), rec0\.palette \?\? \{\}, q\.role\)\) : 0/,
  /if \(kind === 'decor' && decorStalled\(\{ \.\.\.f, placed: r\.placed, cleared: r\.cleared \}\)\) decorStall\(bot, `visit:\$\{r\.stop\}`\)/,
  /const work = decorWanted\(states\[i\]\) && !stalled/,
  /await matsWithdraw\(ctx, \{ iron_ingot: k \}, signal, 20_000, matsReserve\(\)\.table, decorAllow\(\{ iron_ingot: k \}\)\)/,
  /await matsWithdraw\(ctx, \{ bone_meal: want - bagMeal \}, signal, 30_000, matsReserve\(\)\.table, decorAllow\(\{ bone_meal: want - bagMeal \}\)\)/,
  /if \(rec0 && DECOR_POTS_ON\) \{ const pf = await decorPotFill\(/,
  /if \(leafNeed > 0 && based\) \{ const lg = await decorLeaves\(ctx, signal, t0 \+ budget - ZIG_VISIT_TAIL_MS, leafNeed\)/,
  /if \(postNeed > 0\) \{ const pk = await decorPostKit\(ctx, signal, postNeed, rec0, postOwed\)/,
  /const want = Math\.max\(owed, Math\.min\(need, owed \+ Math\.max\(0, DECOR_POSTS_TOWN - posts\)\)\)/,
  /done: \(b, pal, role\) => dressSignRole\(role\) \|\| decorBagRole\(role\) \|\| buildCellDone\(b, pal, role\)/,
  /buildRowDetail\(\{ project: SINK_PLOTS\.decor, op: 'clear', cell: t\.at, block: t\.name, kind: 'leaves', gen: decorGen\(\) \}\)/,
  /if \(fernNeed > 0 && based\) \{ const fg = await decorFerns\(ctx, signal, t0 \+ budget - ZIG_VISIT_TAIL_MS, fernNeed\)/,
  /if \(fernNeed > 0 && !based\) \{ const pb = publishRecord\(dir, key, cur => \(cur \? null : decorBase\(null,/,
  /const cr = await compost\(ctx, \{ drive: true \}, signal\)/,
  /buildRowDetail\(\{ project: SINK_PLOTS\.decor, op: 'clear', cell: t\.at, block: t\.name, kind: 'fern', n: t\.n, gen: decorGen\(\) \}\)/,
  /setCompostDrive\(junk => \{\n\s*if \(!DECORATE\.on\) return false/,
  /if \(!DECOR_POTS_ON \|\| !decorLeaseNow\(bot\) \|\| !potPlantFor\(heldMap\(bot\)\)\) return false/,
  /if \(g0\?\.want \|\| owed > borderPlantsOf\(heldMap\(bot\)\)\) \{ const nu = await decorNursery\(ctx, rec0, signal, t0 \+ budget - ZIG_VISIT_TAIL_MS, g0\?\.want \? DECOR\.batchMax : owed\)/,
  /if \(tidy && r\.plot === SINK_PLOTS\.decor && decorPotWork\(bot, r\)\) return true/,
  /pressure: kind === 'dress' \? dressPressureNow\(bot\) : kind === 'decor' \? decorPressureNow\(bot\) : pr, openCount/,
  /if \(r\.ok && kind !== 'dress' && kind !== 'decor' && !sinkFundable\(/,
  /if \(SITEPREP\.on && r\.why !== 'unfunded' && kind !== 'decor'\) \{/,
  /if \(d === 'take' && !decorHeld && now - \(bot\.gkTakeAt \?\? -Infinity\) >= GK\.takeEveryMs\)/,
  /if \(d === 'take' && now - \(bot\.decorTakeAt \?\? -Infinity\) >= DECOR\.takeEveryMs && !keeperNow\(bot, now\)\)/,
  /buildRowDetail\(\{ project: SINK_PLOTS\.decor, op: 'meal', cell: ctr, block: 'bone_meal', kind: 'use', gen: decorGen\(\) \}\)/,
  /buildRowDetail\(\{ project: SINK_PLOTS\.decor, op: 'clear', cell: q\.at, block: q\.name, kind: 'bloom', gen: decorGen\(\) \}\)/,
  /buildRowDetail\(\{ project: SINK_PLOTS\.decor, op: 'place', seg: c\.seg, cell: c\.at, block: now, kind: 'pot_fill', gen: decorGen\(\) \}\)/,
  /const pub = publishRecord\(dir, key, cur => withNursery\(cur, s\.nursery,/,
  /if \(kind === 'decor'\) return DECORATE\.on && !!recordHead\(townDir\(\), projKeyOf\(PATHS_PLOT\)\)\.head\?\.rec\?\.structure_complete/,
]
await t('the decor is wired: the holder\'s order, the visit\'s lease check, the pot fill and the nursery first, the upkeep, the gate, no stone bill, no site request, every mutation a record row', () => {
  for (const re of W) assert.ok(re.test(SK), String(re))
})
await t('mutants: each wiring line, once broken, fails its assertion', () => {
  const breaks = ['const work = decorWanted(states[i]) && !stalled', "if (!decorLeaseNow(bot)) return out('no_effect', 'not_decorator',", 'const order0 = b ? decorOrder(b, marked, order00, now) : order00', "if (tidy && r.plot === SINK_PLOTS.decor && decorPotWork(bot, r)) return true"]
  for (const b of breaks) {
    assert.strictEqual(SK.split(b).length, 2, `anchor unique: ${b}`)
    const m = SK.replace(b, 'BROKEN')
    assert.ok(W.some(re => !re.test(m)), b)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
