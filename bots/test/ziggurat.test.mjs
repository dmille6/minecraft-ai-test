// MONUMENT-01 ON THE TRUNK (bots/src/ziggurat.mjs + the shared builder's new knobs): the geometry, the site, the record, the
// switch. The builds are ziggurat-build.test.mjs (one builder, the layer barrier) and ziggurat-build2.test.mjs (three builders,
// uneven ground), on the fake server of test/helpers/buildfake.mjs.
import assert from 'node:assert'
const { B, R, PJ, G, HOME, k3, server, plan } = await import('./helpers/buildfake.mjs')
const { Z, G12, withZigMutant, colOf, siteOn, zigProject, zigDone, KITZ, zbot } = await import('./helpers/zigfake.mjs')
const SHOPM = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
console.log('THE GEOMETRY')
await t('B=12: tiers 12 and 6, 4 layers, 360 body cells + 2 x 3 stair cells = 366 (the 10-15 Paper scene\'s count)', async () => {
  assert.deepStrictEqual(Z.tierSides(G12), [12, 6])
  const cells = Z.zigCells({ corner: { x: 0, z: 0 }, baseY: 0, face: 's' }, G12)
  assert.strictEqual(cells.length, 366)
  assert.strictEqual(cells.filter(c => c.role === 'stair').length, 6)
  assert.strictEqual(new Set(cells.map(c => k3(c.at))).size, 366, 'no cell twice')
  assert.strictEqual(Z.zigCells({ corner: { x: 0, z: 0 }, baseY: 0 }, Z.ZIG_DEFAULT).length, 14688 + 8 * 3, 'the owner\'s 48-base: 14,688 + the grand stair')
  assert.strictEqual(Z.zigCells({ corner: { x: 0, z: 0 }, baseY: 0 }, Z.ZIG_SHOWCASE).length, 3960 + 5 * 3)
})
await t('SOLID BY LAYERS: every body cell above layer 0 rests on a body cell; the skin is exactly the exposed shell; the core is hidden', async () => {
  const cells = Z.zigCells({ corner: { x: 0, z: 0 }, baseY: 0, face: 's' }, Z.ZIG_SHOWCASE)
  const at = new Map(cells.map(c => [k3(c.at), c]))
  for (const c of cells) if (c.at[1] > 0 && c.role !== 'stair') assert.ok(at.has(k3([c.at[0], c.at[1] - 1, c.at[2]])), `${c.at} floats`)
  for (const c of cells.filter(c => c.role === 'core')) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) assert.ok(at.has(k3([c.at[0] + dx, c.at[1] + dy, c.at[2] + dz])), `core ${c.at} shows`)
  }
  assert.ok(cells.filter(c => c.role === 'skin').length > 0 && cells.filter(c => c.role === 'core').length > 0)
})
await t('THE GRAND STAIR: from the ground to the top every climb is +1 (stair step, then the tier) on the face toward home', async () => {
  for (const face of ['n', 's', 'e', 'w']) {
    const cells = Z.zigCells({ corner: { x: 0, z: 0 }, baseY: 0, face }, Z.ZIG_SHOWCASE)
    const top = new Map()
    for (const c of cells) top.set(`${c.at[0]},${c.at[2]}`, Math.max(top.get(`${c.at[0]},${c.at[2]}`) ?? -1, c.at[1]))
    const stairs = cells.filter(c => c.role === 'stair').sort((a, b) => a.at[1] - b.at[1])
    assert.strictEqual(stairs.length, 15)
    for (const s of stairs) {
      // the step stands one above the terrace it is on (or the ground), and the tier beside it is one above the step
      const under = s.at[1] === 0 ? -1 : top.get(`${s.at[0]},${s.at[2]}`) === s.at[1] ? (cells.find(c => c.at[0] === s.at[0] && c.at[2] === s.at[2] && c.at[1] === s.at[1] - 1)?.at[1] ?? -1) : -1
      assert.strictEqual(s.at[1] - under, 1, `${face} step ${s.at} on ${under}`)
      const inward = { s: [0, -1], n: [0, 1], e: [-1, 0], w: [1, 0] }[face]
      assert.strictEqual(top.get(`${s.at[0] + inward[0]},${s.at[2] + inward[1]}`), s.at[1] + 1, `${face}: the tier beside ${s.at} is +1`)
    }
  }
})
await t('SEGMENTS: four quadrants a layer, each waiting on the whole layer below; F first when there is foundation', async () => {
  const s = Z.zigSegments(G12, { foundation: true })
  assert.strictEqual(s[0].seg, 'F'); assert.strictEqual(s.length, 1 + 4 * 4)
  assert.deepStrictEqual(s.find(x => x.seg === 'L00-E').deps, ['F'])
  assert.deepStrictEqual(s.find(x => x.seg === 'L02-W').deps, ['L01-N', 'L01-E', 'L01-S', 'L01-W'])
  const cells = Z.zigCells({ corner: { x: 0, z: 0 }, baseY: 0 }, G12)
  assert.ok(cells.every(c => s.some(x => x.seg === c.seg)), 'every cell names a segment')
})

console.log('THE SWITCH')
await t('MONUMENT: on in the showcase pool by default, off in a fleet pool; MONUMENT=on|off overrides; MONUMENT_POOLS names pools', async () => {
  assert.strictEqual(Z.monumentOn({}, 'showcase'), true)
  assert.strictEqual(Z.monumentOn({}, 'hive-a'), false)
  assert.strictEqual(Z.monumentOn({ MONUMENT: 'off' }, 'showcase'), false)
  assert.strictEqual(Z.monumentOn({ MONUMENT: 'on' }, 'hive-a'), true)
  assert.strictEqual(Z.monumentOn({ MONUMENT_POOLS: 'hive-a,board-b' }, 'board-b'), true)
  assert.strictEqual(Z.zigFor({}, 'showcase').B, 30); assert.strictEqual(Z.zigFor({}, 'hive-a').B, 48)
  assert.strictEqual(Z.zigFor({ MONUMENT_B: '24' }, 'showcase').B, 24); assert.strictEqual(Z.zigFor({ MONUMENT_B: '25' }, 'showcase').B, 30, 'odd: ignored')
})

console.log('THE SITE')
await t('flat ground: a site inside the reservation, the base on the ground (no fill, no cut), the stair facing home, nearest first', async () => {
  const srv = server()
  const r = siteOn(srv)
  assert.ok(r.ok, JSON.stringify(r.rejects))
  const box = Z.monumentBox(plan())
  assert.deepStrictEqual(box, [-63, -63, -9, -9], 'NW: the plan\'s outer-plot extent')
  const s = r.site
  assert.strictEqual(s.baseY, G + 1); assert.strictEqual(s.fill, 0); assert.strictEqual(s.cut, 0)
  assert.ok(s.corner.x >= box[0] + 2 && s.corner.x + 11 <= box[2] - 2 && s.corner.z >= box[1] + 2 && s.corner.z + 11 <= box[3] - 2, 'inside the box less the margin')
  assert.ok(['e', 's'].includes(s.face), `faces home from NW: ${s.face}`)
  assert.deepStrictEqual([s.corner.x, s.corner.z], [-22, -22], 'the nearest corner to home')
})
await t('REFUSALS by column: water, a chest, an avoided column (plan, zone, another project) refuse; a field crafting table is litter', async () => {
  const one = (cells, avoid) => siteOn(server(cells), { avoid, box: [-30, -30, -7, -7] })
  const corner = c => `${c.x},${c.z}`
  const base = siteOn(server(), { box: [-30, -30, -7, -7] })
  assert.ok(base.ok)
  const at = base.site.corner
  const mid = [at.x + 5, G + 1, at.z + 5]
  // water in the best site moves it (that corner refused 'liquid')
  const w = one({ [k3(mid)]: 'water' })
  assert.ok(!w.ok || corner(w.site.corner) !== corner(at)); assert.ok((w.rejects.liquid ?? 0) > 0)
  const ch = one({ [k3(mid)]: 'chest' })
  assert.ok(!ch.ok || corner(ch.site.corner) !== corner(at)); assert.ok((ch.rejects.furniture ?? 0) > 0)
  const av = one({}, (x, z) => (x === mid[0] && z === mid[2] ? 'plan_box' : null))
  assert.ok(!av.ok || corner(av.site.corner) !== corner(at)); assert.ok((av.rejects['avoid:plan_box'] ?? 0) > 0)
  // a field crafting table is LITTER (one unit of work), never a refusal: with one corner to choose, that corner is the site
  const only = siteOn(server({ [k3(mid)]: 'crafting_table' }), { box: [at.x - 2, at.z - 2, at.x + 13, at.z + 13] })
  assert.ok(only.ok, JSON.stringify(only.rejects)); assert.strictEqual(corner(only.site.corner), corner(at))
  assert.strictEqual(only.site.logs, 1)
  const ct = one({ [k3(mid)]: 'crafting_table' })
  assert.ok(ct.ok); assert.ok(!ct.rejects.furniture, 'never a furniture refusal')
  const rec = Z.zigRecord(only.site, server({ [k3(mid)]: 'crafting_table' }).read, { home: HOME, g: G12 })
  assert.ok(rec.cells.some(c => k3(c.at) === k3(mid)), 'its cell is a record cell (dug as STATION_CLEAR by the visit)')
})
await t('zigAvoid: plan reservations, zones, and another project\'s cells within the pad', async () => {
  const av = Z.zigAvoid({ column: (x, z) => (x === 1 && z === 1 ? 'plan_cell' : null), zones: [{ box: [10, 0, 10, 12, 200, 12] }], cells: new Set(['20,20']), pad: 3 })
  assert.strictEqual(av(1, 1), 'plan_cell'); assert.strictEqual(av(11, 11), 'zone'); assert.strictEqual(av(23, 20), 'project'); assert.strictEqual(av(24, 20), null)
})
await t('UNEVEN GROUND: a low corner is FOUNDATION (core, segment F, from the ground up); a bump above the profile is a CUT clear', async () => {
  const cells = {}
  const s0 = siteOn(server(), { box: [-30, -30, -7, -7] }).site
  const cx = s0.corner.x, cz = s0.corner.z
  // a 3x3 hollow (ground 2 lower) under the base's middle, and a 1-high bump at the base's outer ring
  for (let dx = 4; dx < 7; dx++) for (let dz = 4; dz < 7; dz++) { cells[k3([cx + dx, G, cz + dz])] = 'air'; cells[k3([cx + dx, G - 1, cz + dz])] = 'air' }
  cells[k3([cx, G + 1, cz])] = 'dirt'; cells[k3([cx, G + 2, cz])] = 'dirt'; cells[k3([cx, G + 3, cz])] = 'dirt'
  const srv = server(cells)
  const r = siteOn(srv, { box: [cx - 2, cz - 2, cx + 13, cz + 13] })
  assert.ok(r.ok, JSON.stringify(r.rejects))
  const rec = Z.zigRecord(r.site, srv.read, { home: HOME, g: G12 })
  assert.strictEqual(rec.baseY, G + 1)
  const F = rec.cells.filter(c => c.seg === 'F')
  assert.strictEqual(F.length, 18, 'two cells under each of the nine hollow columns')
  assert.ok(F.every(c => c.role === 'core'), 'the hollow is inside the base: hidden')
  assert.strictEqual(rec.segments[0].seg, 'F'); assert.deepStrictEqual(rec.segments[1].deps, ['F'])
  assert.deepStrictEqual(rec.clear.map(c => [k3(c.at), c.kind, c.name]).sort(), [[k3([cx, G + 1, cz]), 'cut', 'dirt'], [k3([cx, G + 2, cz]), 'cut', 'dirt'], [k3([cx, G + 3, cz]), 'cut', 'dirt']].sort(),
    'the block above the 2-layer outer tier, and the dirt standing in its two SKIN cells (dug low first as its face opens)')
})

console.log('THE SHARED BUILDER\'S NEW KNOBS (the workshop\'s defaults unchanged)')
await t('cellDone: a *solid role is done by any full solid but leaves; the skin wants cobblestone; blockFor never returns *solid', async () => {
  const P = Z.ZIG_PALETTE, b = n => ({ name: n, boundingBox: n === 'air' ? 'empty' : 'block' })
  assert.ok(R.cellDone(b('dirt'), P, 'core')); assert.ok(R.cellDone(b('cobblestone'), P, 'core')); assert.ok(R.cellDone(b('crafting_table'), P, 'core'))
  assert.ok(!R.cellDone(b('spruce_leaves'), P, 'core')); assert.ok(!R.cellDone(b('air'), P, 'core'))
  assert.ok(!R.cellDone(b('dirt'), P, 'skin')); assert.ok(R.cellDone(b('cobblestone'), P, 'skin'))
  const has = n => n === 'dirt'
  assert.strictEqual(R.blockFor(P, 'core', has), 'dirt'); assert.strictEqual(R.blockFor(P, 'skin', has), null)
  assert.ok(!SHOPM.roleNames(P, 'core').includes('*solid'))
})
await t('foreignKind: the default scaffold set is the workshop\'s; the ziggurat\'s widens it to a forest floor', async () => {
  assert.strictEqual(R.foreignKind('podzol'), null); assert.strictEqual(R.foreignKind('podzol', Z.ZIG_FOREIGN), 'scaffold')
  assert.strictEqual(R.foreignKind('dirt'), 'scaffold'); assert.strictEqual(R.foreignKind('spruce_log', Z.ZIG_FOREIGN), 'tree')
  assert.strictEqual(R.foreignKind('chest', Z.ZIG_FOREIGN), null, 'never a container')
})
await t('stepFor: without a domain the workshop ring decides (a stand 10 from home refused); with zigDomain it is the record\'s box + 6', async () => {
  const srv = server()
  const cell = [-12, G + 1, -12]
  const nodes = new Map([['-13,-12', [G + 1]]])
  assert.strictEqual(B.stepFor(srv.read, HOME, cell, nodes), null, 'inside Chebyshev 22: not the workshop\'s domain')
  const rec = { box: [-22, -22, -11, -11] }
  const s = B.stepFor(srv.read, HOME, cell, nodes, Z.zigDomain(rec, HOME))
  assert.ok(s && k3(s.stand) === k3([-13, G + 1, -12]))
  assert.strictEqual(Z.zigDomain(rec, HOME)(-5, -5), false, 'never the town core')
  assert.ok(Z.zigWalkR({ box: [-63, -63, -34, -34] }, HOME) >= 70)
})
await t('reservations: a sited ziggurat\'s BOX + 8 is z0_apron for every other siting; the old centre form is unchanged', async () => {
  const res = B.reservations(plan(), { z0: { box: [-40, -40, -20, -20] } })
  assert.strictEqual(res.column(-12, -30, G, G + 4), 'z0_apron'); assert.strictEqual(res.column(-11, -30, G, G + 4), null)
  assert.strictEqual(B.reservations(plan(), { z0: { centre: { x: -40, z: -40 } } }).column(-8, -40, G, G + 4), 'z0_apron')
})
await t('saplingAllowedAt: one box as before; a LIST refuses inside any of them', async () => {
  const a = { x0: 0, z0: 0, x1: 4, z1: 4 }, b = { x0: 10, z0: 10, x1: 14, z1: 14 }
  assert.strictEqual(SHOPM.saplingAllowedAt(a, 2, 2), false); assert.strictEqual(SHOPM.saplingAllowedAt(a, 12, 12), true)
  assert.strictEqual(SHOPM.saplingAllowedAt([a, b], 12, 12), false); assert.strictEqual(SHOPM.saplingAllowedAt([a, b], 7, 7), true)
  assert.strictEqual(SHOPM.saplingCandidateOk([a, b], { ref: { position: { x: 12, y: 70, z: 11 } }, face: { x: 0, y: 1, z: 0 } }), false)
})
await t('buildOrder: the monument\'s record needs 2 free bag slots, the workshop\'s 8', async () => {
  const o = { on: true, shared: true, atTown: true, now: 1e9, planned: true, freeSlots: 3 }
  assert.strictEqual(SHOPM.buildOrder({ ...o, record: { plot: 'monument' } }).order?.skill, 'build_shop')
  assert.strictEqual(SHOPM.buildOrder({ ...o, record: { plot: 'shop' } }).skip, 'room')
})
await t('zigWant (Codex r1 BLOCK): the bag\'s dirt is credited against the CORE\'s cobblestone only, never the skin\'s', async () => {
  assert.deepStrictEqual(Z.zigWant({ cobblestone: 1 }, {}, { dirt: 48 }), { cobblestone: 1 }, 'one skin cell left, 48 dirt: still wanted')
  assert.deepStrictEqual(Z.zigWant({ cobblestone: 15 }, { cobblestone: 10 }, { dirt: 8 }), { cobblestone: 7 })
  assert.deepStrictEqual(Z.zigWant({ cobblestone: 15 }, { cobblestone: 10 }, { dirt: 64, andesite: 9 }), { cobblestone: 5 }, 'more dirt than core: the skin\'s 5 stay')
  assert.deepStrictEqual(Z.zigWant({ cobblestone: 15 }, { cobblestone: 10 }, { cobblestone: 64 }), { cobblestone: 15 }, 'the bag\'s own cobblestone is needFromTown\'s subtraction, not a credit')
})
await t('zigSplitFoundation (live 10-29: one F segment, one builder): F in four by quadrant, every F dep the four; cells unchanged; idempotent', async () => {
  const s0 = siteOn(server(), { box: [-30, -30, -7, -7] }).site
  const cells = {}
  for (let dx = 1; dx < 11; dx++) for (const dz of [1, 10]) cells[k3([s0.corner.x + dx, G, s0.corner.z + dz])] = 'air'
  const srv = server(cells)
  const rec = Z.zigRecord(siteOn(srv, { box: [s0.corner.x - 2, s0.corner.z - 2, s0.corner.x + 13, s0.corner.z + 13] }).site, srv.read, { home: HOME, g: G12 })
  assert.ok(rec.cells.some(c => c.seg === 'F'))
  const sp = Z.zigSplitFoundation(rec)
  assert.ok(!sp.cells.some(c => c.seg === 'F') && sp.cells.length === rec.cells.length)
  assert.deepStrictEqual(sp.cells.map(c => k3(c.at)), rec.cells.map(c => k3(c.at)), 'the same cells, in order')
  const F = sp.segments.filter(s => s.seg.startsWith('F-')).map(s => s.seg)
  assert.ok(F.length >= 2 && F.every(s => sp.segments.find(x => x.seg === s).deps.length === 0), F)
  for (const q of ['N', 'E', 'S', 'W']) assert.deepStrictEqual(sp.segments.find(s => s.seg === `L00-${q}`).deps, F)
  assert.ok(sp.cells.filter(c => c.seg.startsWith('F-')).every(c => F.includes(c.seg)), 'every F cell names a listed segment')
  assert.strictEqual(Z.zigSplitFoundation(sp), sp, 'already split: as it is')
  assert.strictEqual(Z.zigProgress(sp, () => false).layer, -1)
})
await t('zigFootprint (live 10-29: builders stuck in the hollows): the ziggurat\'s walk price is its BUILT cells only, no halo', async () => {
  const rec = { cells: [{ at: [0, 70, 0], role: 'core' }, { at: [1, 70, 0], role: 'skin' }, { at: [2, 70, 0], role: 'skin' }] }
  const fp = Z.zigFootprint(rec, c => c.at[0] < 2)
  assert.deepStrictEqual([...fp].sort(), ['0,70,0', '1,70,0'])
  assert.ok(!fp.has('0,71,0') && !fp.has('-1,70,0'), 'no +1 halo')
  assert.strictEqual(SHOPM.footprintCells(rec).has('0,71,0'), true, 'positive control: the workshop\'s footprint has the halo')
})
await t('zigProgress: done / open and the lowest open layer', async () => {
  const rec = { cells: [{ seg: 'F' }, { seg: 'L00-N' }, { seg: 'L01-E' }].map((c, i) => ({ ...c, at: [i, 0, 0] })) }
  assert.deepStrictEqual(Z.zigProgress(rec, c => c.at[0] === 0), { done: 1, open: 2, layer: 0 })
  assert.deepStrictEqual(Z.zigProgress(rec, () => true), { done: 3, open: 0, layer: null })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
