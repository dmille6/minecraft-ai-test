// PATHS-01: the town's paths (paths.mjs) -- the switch, the ground scan, the router (levels, gentle steps, water, zones, trees),
// the record (cells, fill, cut, clears, segments, zones), the destinations, and the project list / order / sapling wiring in
// shop.mjs. Pure; buildfake's flat world (stone below G, grass at G) with cells set per scene.
import assert from 'node:assert'
const { G, HOME, server, plan } = await import('./helpers/buildfake.mjs')
const P = await import('../src/paths.mjs')
const SHOPM = await import('../src/shop.mjs')
const { placeBlueprint, loadBlueprint } = await import('../src/buildsite.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const CORE = [-6, -6, 6, 6]
const BOX = [-40, -40, 40, 40]
const gridOn = (srv, avoid = () => null) => P.pathGrid((x, z) => P.pathColumn(srv.read, x, z, { yHi: G + 12, yLo: G - 12 }), avoid, BOX, srv.read)
const net1 = (srv, cols, o = {}) => P.pathNetwork(gridOn(srv, o.avoid), { hub: CORE, dests: [{ id: 'd', cols }], ...o })
const recOf = (srv, net, o = {}) => P.pathRecord(net, gridOn(srv, o.avoid), srv.read, { home: HOME })
const colsOf = rec => new Set(rec.cells.filter(c => c.role === 'path').map(c => `${c.at[0]},${c.at[2]}`))
const levelAt = rec => new Map(rec.cells.filter(c => c.role === 'path').map(c => [`${c.at[0]},${c.at[2]}`, c.at[1]]))
/** Every 4-adjacent pair of path columns differs by at most 1 (measured here, not read from the record). */
const gentle = rec => { const L = levelAt(rec); for (const [k, y] of L) { const [x, z] = k.split(',').map(Number); for (const [dx, dz] of [[1, 0], [0, 1]]) { const o = L.get(`${x + dx},${z + dz}`); if (o != null && Math.abs(o - y) > 1) return `${k}:${y} vs ${x + dx},${z + dz}:${o}` } } return null }

console.log('THE SWITCH')
await t('PATHS=on|off wins; unset: on only in the PATHS_POOLS pools (default showcase)', async () => {
  assert.strictEqual(P.pathsOn({}, 'showcase'), true)
  assert.strictEqual(P.pathsOn({}, 'hive-a'), false)
  assert.strictEqual(P.pathsOn({ PATHS: 'off' }, 'showcase'), false)
  assert.strictEqual(P.pathsOn({ PATHS: 'on' }, 'hive-a'), true)
  assert.strictEqual(P.pathsOn({ PATHS_POOLS: 'hive-a,board-b' }, 'board-b'), true)
})

console.log('THE GROUND SCAN')
await t('pathColumn: the top full solid under plants, leaves and a trunk; water and furniture refuse; a crafting table is litter', async () => {
  const srv = server()
  srv.set([3, G + 1, 3], 'short_grass'); srv.set([3, G + 4, 3], 'spruce_leaves')
  let c = P.pathColumn(srv.read, 3, 3, { yHi: G + 12, yLo: G - 12 })
  assert.deepStrictEqual([c.y, c.name, c.why], [G, 'grass_block', null])
  assert.deepStrictEqual(c.above.map(a => a.kind).sort(), ['leaves', 'plant'])
  srv.set([4, G + 1, 4], 'spruce_log'); srv.set([4, G + 2, 4], 'spruce_log')
  c = P.pathColumn(srv.read, 4, 4, { yHi: G + 12, yLo: G - 12 })
  assert.strictEqual(c.y, G); assert.strictEqual(c.above.filter(a => a.kind === 'tree').length, 2)
  srv.set([5, G + 1, 5], 'water')
  assert.strictEqual(P.pathColumn(srv.read, 5, 5, { yHi: G + 12, yLo: G - 12 }).why, 'water')
  srv.set([6, G + 1, 6], 'chest')
  assert.strictEqual(P.pathColumn(srv.read, 6, 6, { yHi: G + 12, yLo: G - 12 }).why, 'furniture')
  srv.set([7, G + 1, 7], 'crafting_table')
  c = P.pathColumn(srv.read, 7, 7, { yHi: G + 12, yLo: G - 12 })
  assert.strictEqual(c.why, null); assert.strictEqual(c.above[0].kind, 'cut')
  srv.set([8, G + 1, 8], 'oak_planks')
  assert.strictEqual(P.pathColumn(srv.read, 8, 8, { yHi: G + 12, yLo: G - 12 }).why, 'built')
})
await t('surfaceNeed: grass and dirt are the shovel\'s, stone and gravel stay, sand is paved', async () => {
  assert.strictEqual(P.surfaceNeed('grass_block'), 'use'); assert.strictEqual(P.surfaceNeed('rooted_dirt'), 'use')
  assert.strictEqual(P.surfaceNeed('stone'), 'done'); assert.strictEqual(P.surfaceNeed('gravel'), 'done'); assert.strictEqual(P.surfaceNeed('dirt_path'), 'done')
  assert.strictEqual(P.surfaceNeed('sand'), 'pave'); assert.ok(P.PATH_FOREIGN.test('sand') && P.PATH_FOREIGN.test('coal_ore') && !P.PATH_FOREIGN.test('grass_block') && !P.PATH_FOREIGN.test('dirt'))
})

console.log('THE ROUTER')
await t('FLAT: a 2-wide leg from the destination to the core\'s edge, every cell at the ground, deterministic', async () => {
  const srv = server()
  const net = net1(srv, [[1, 25]])
  assert.ok(net.legs[0].ok, net.legs[0].why)
  const rec = recOf(srv, net)
  assert.ok(rec.cells.every(c => c.role === 'path' && c.at[1] === G), 'flat: no fill, every cell at the ground')
  const cols = colsOf(rec)
  assert.ok(cols.has('1,25'), 'it reaches the destination column')
  // 2 wide: every column has a path neighbour beside it across the leg (x +- 1 for a north-south leg)
  for (const k of cols) { const [x, z] = k.split(',').map(Number); assert.ok(cols.has(`${x + 1},${z}`) || cols.has(`${x - 1},${z}`), `${k} is one wide`) }
  // never inside the core, and it touches its edge
  assert.ok([...cols].every(k => { const [x, z] = k.split(',').map(Number); return !(x >= -6 && x <= 6 && z >= -6 && z <= 6) }))
  assert.ok([...cols].some(k => k.split(',')[1] === '7'), 'it starts at the core\'s edge')
  assert.deepStrictEqual(recOf(srv, net1(server(), [[1, 25]])).cells, rec.cells, 'the same ground gives the same record')
  assert.strictEqual(rec.maxStep, 0)
})
await t('A TRENCH ACROSS THE WAY is filled (fill cells under raised path cells), every step +-1', async () => {
  const srv = server()
  for (let x = -40; x <= 40; x++) { srv.set([x, G, 18], 'air'); srv.set([x, G - 1, 18], 'air') }
  const rec = recOf(srv, net1(srv, [[1, 30]]))
  assert.ok(rec.cells.some(c => c.role === 'fill'), 'the trench is filled')
  assert.strictEqual(gentle(rec), null)
  assert.strictEqual(rec.maxStep <= 1, true)
  // each raised column: fill from the trench floor up, the path cell on top at the ground's level
  const raised = rec.cells.filter(c => c.role === 'path' && c.at[2] === 18)
  assert.ok(raised.length >= 2 && raised.every(c => c.at[1] === G), JSON.stringify(raised.map(c => c.at)))
  assert.ok(rec.cells.filter(c => c.role === 'fill').every(c => c.at[2] === 18 && c.at[1] === G - 1))
})
await t('A CLIFF of 6 across the whole box: no leg (FILL_MAX + CUT_MAX = 4 is the most earthwork a step may hide); a ramp in it is taken', async () => {
  const srv = server()
  for (let x = -40; x <= 40; x++) for (let z = 15; z <= 40; z++) for (let y = G + 1; y <= G + 6; y++) srv.set([x, y, z], 'stone')
  for (let x = -40; x <= 40; x++) for (let z = 15; z <= 40; z++) srv.set([x, G + 6, z], 'grass_block')
  const n0 = net1(srv, [[1, 30]])
  assert.strictEqual(n0.legs[0].ok, false)
  // a ramp at x 20..21: ground G+1 at z 10, ..., G+5 at 14 (the cliff's top is G+6 from z 15)
  for (const x of [20, 21]) for (const [z, h] of [[10, 1], [11, 2], [12, 3], [13, 4], [14, 5]]) { for (let y = G + 1; y <= G + h; y++) srv.set([x, y, z], 'stone'); srv.set([x, G + h, z], 'grass_block') }
  const rec = recOf(srv, net1(srv, [[1, 30]]))
  assert.ok(rec.cells.length > 0)
  assert.strictEqual(gentle(rec), null)
  assert.ok([...colsOf(rec)].some(k => k === '20,13' || k === '21,13'), 'it climbs by the ramp')
})
await t('WATER is never a path column (owner 10-27: no water bridging); a gap in a river is taken', async () => {
  const srv = server()
  for (let x = -40; x <= 40; x++) { if (x === -10 || x === -9) continue; srv.set([x, G, 18], 'water'); srv.set([x, G, 19], 'water') }
  const rec = recOf(srv, net1(srv, [[1, 30]]))
  assert.ok(rec.cells.length > 0)
  assert.ok(rec.cells.every(c => srv.read(...c.at).name !== 'water' && srv.read(c.at[0], c.at[1] + 1, c.at[2]).name !== 'water'), 'no cell in or under water')
  assert.ok(colsOf(rec).has('-10,18') && colsOf(rec).has('-9,19'), 'through the gap')
  // the river whole: unrouted
  for (const x of [-10, -9]) { srv.set([x, G, 18], 'water'); srv.set([x, G, 19], 'water') }
  assert.strictEqual(net1(srv, [[1, 30]]).legs[0].ok, false)
})
await t('A TREE on the straight line is routed round (felling is dear); a row of them is felled -- every log of the trunk listed', async () => {
  const srv = server()
  for (let y = G + 1; y <= G + 6; y++) srv.set([1, y, 15], 'spruce_log')
  const rec = recOf(srv, net1(srv, [[1, 25]]))
  assert.ok(!colsOf(rec).has('1,15'), 'round the lone trunk')
  const srv2 = server()
  for (let x = -40; x <= 40; x++) for (let y = G + 1; y <= G + 3; y++) srv2.set([x, y, 15], 'spruce_log')
  const rec2 = recOf(srv2, net1(srv2, [[1, 25]]))
  const trees = rec2.clear.filter(c => c.kind === 'tree')
  assert.ok(trees.length >= 6 && trees.every(c => c.at[2] === 15), `the row is felled (${trees.length} logs listed)`)
  for (const k of colsOf(rec2)) if (k.endsWith(',15')) for (let y = G + 1; y <= G + 3; y++) assert.ok(trees.some(c => `${c.at[0]},${c.at[2]}` === k && c.at[1] === y), `log ${k},${y} listed`)
})
await t('AVOID: a zone across the straight line is never entered (the leg goes round)', async () => {
  const srv = server()
  const zone = [-5, -64, 12, 8, 320, 16]
  const avoid = P.pathAvoid({ zones: [zone] })
  const rec = recOf(srv, net1(srv, [[1, 25]], { avoid }), { avoid })
  assert.ok(rec.cells.length > 0)
  assert.ok([...colsOf(rec)].every(k => { const [x, z] = k.split(',').map(Number); return !(x >= -5 && x <= 8 && z >= 12 && z <= 16) }))
})
await t('pathAvoid: plan cells and stands, committed boxes + 1, keep-out plots, well cap Chebyshev 3, plinth + 1, the composter, project columns', async () => {
  const pl = plan()
  pl.plots.push({ id: 'store', kind: 'storehouse', box: [-15, -4, -9, 4], keepout: true, cells: [{ at: [-12, G + 1, 0], kind: 'chest', state: 'placed', stand: [-12, G + 1, 1] }] })
  const av = P.pathAvoid({ plan: pl, caps: [[20, G + 1, 20]], plinth: [[30, G, 30]], composter: [-1, G + 1, 9], records: [{ cells: [{ at: [25, G, -25] }] }], home: HOME })
  assert.strictEqual(av(-12, 0), 'plan_cell')
  assert.strictEqual(av(-16, 0), 'plan_box')
  assert.strictEqual(av(0, 0), null, 'the core of the fake plan is not a keep-out plot (keepout false)')
  assert.strictEqual(av(23, 23), 'well'); assert.strictEqual(av(24, 20), null)
  assert.strictEqual(av(31, 31), 'well'); assert.strictEqual(av(-1, 9), 'farm'); assert.strictEqual(av(25, -25), 'project')
  pl.plots[0].keepout = true
  assert.strictEqual(P.pathAvoid({ plan: pl, home: HOME })(0, 0), 'plan_plot')
})

console.log('THE RECORD')
await t('cells, segments (lease-name safe, <= PATH_SEG_CELLS columns), clears (plants, leaves at head height, a cut bump), zones', async () => {
  const srv = server()
  srv.set([1, G + 1, 12], 'fern'); srv.set([1, G + 2, 13], 'spruce_leaves'); srv.set([1, G + 6, 13], 'spruce_leaves')
  // a bump of 1 on the line: cut, its ground listed
  srv.set([1, G + 1, 20], 'grass_block'); srv.set([1, G, 20], 'dirt')
  const rec = recOf(srv, net1(srv, [[1, 25]]))
  assert.ok(rec.segments.every(s => /^[A-Za-z0-9-]+$/.test(s.seg) && s.deps.length === 0))
  for (const s of rec.segments) assert.ok(new Set(rec.cells.filter(c => c.seg === s.seg && c.role === 'path').map(c => `${c.at[0]},${c.at[2]}`)).size <= P.PATH_SEG_CELLS)
  const has = (at, kind) => rec.clear.some(c => c.at.join(',') === at.join(',') && c.kind === kind)
  if (colsOf(rec).has('1,12')) assert.ok(has([1, G + 1, 12], 'plant'), 'the fern on a path column')
  if (colsOf(rec).has('1,13')) { assert.ok(has([1, G + 2, 13], 'leaves'), 'leaves at head height'); assert.ok(!has([1, G + 6, 13], 'leaves'), 'not the canopy above') }
  if (colsOf(rec).has('1,20')) assert.ok(levelAt(rec).get('1,20') === G ? has([1, G + 1, 20], 'cut') : true, 'a cut bump lists its ground')
  assert.strictEqual(gentle(rec), null)
  assert.strictEqual(rec.box, undefined, 'no box: it would cover the town')
  const zs = SHOPM.recordZones([rec])
  assert.ok(zs.length > 0 && zs.every(z => z.box.length === 6))
  for (const k of colsOf(rec)) { const [x, z] = k.split(',').map(Number); assert.ok(zs.some(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5]), `${k} in a zone`) }
  assert.ok(SHOPM.recordZones([{ box: [0, 0, 4, 4], plot: 'house1' }]).length === 1, 'a boxed record is unchanged')
})
await t('sapling keep-out: the path columns + 1, never the whole box (saplingAllowedAt reads cols)', async () => {
  const srv = server()
  const rec = recOf(srv, net1(srv, [[1, 25]]))
  const sb = P.pathSaplingCols(rec)
  const [x, , z] = rec.cells[0].at
  assert.strictEqual(SHOPM.saplingAllowedAt([sb], x, z), false)
  assert.strictEqual(SHOPM.saplingAllowedAt([sb], x + 2, z) || SHOPM.saplingAllowedAt([sb], x - 2, z), true)
  assert.strictEqual(SHOPM.saplingAllowedAt([sb], 30, -30), true, 'far from the path')
  assert.strictEqual(SHOPM.saplingAllowedAt(SHOPM.saplingBox({ cells: [{ at: [0, 0, 0] }] }), 1, 1), false, 'a box still a box')
})

console.log('THE DESTINATIONS AND THE SITING')
await t('frontApproach: the column one outside a blueprint project\'s doorway step, for each orientation', async () => {
  const bp = loadBlueprint('house@1')
  for (const orient of ['N', 'E', 'S', 'W']) {
    const cells = placeBlueprint(bp, { x: 10, z: 10 }, G, orient)
    const rec = { anchor: [10, 10], s: G, orient, cells }
    const a = P.frontApproach(rec, bp, placeBlueprint)
    const cols = new Set(cells.map(c => `${c.at[0]},${c.at[2]}`))
    assert.ok(!cols.has(a.join(',')), `${orient}: outside the record`)
    const door = bp.doorway.map(([u, v, y]) => placeBlueprint({ cells: [{ u, v, y }] }, { x: 10, z: 10 }, G, orient)[0].at)
    const d = Math.min(...door.map(c => Math.abs(c[0] - a[0]) + Math.abs(c[2] - a[1])))
    assert.strictEqual(d, 2, `${orient}: two steps from the doorway (the front step between)`)
  }
})
await t('stairFoot: the first columns out from a ziggurat\'s grand stair, the outermost row only', async () => {
  const rec = { face: 'e', cells: [{ at: [0, 0, 0], role: 'skin' }, { at: [1, 0, 0], role: 'stair' }, { at: [1, 0, 1], role: 'stair' }, { at: [2, 0, 0], role: 'stair' }] }
  assert.deepStrictEqual(P.stairFoot(rec).sort(), [[3, 0]])
  // a v2 ziggurat with stairs on all four faces (zig2-01, geometry.FACES 4): one foot per face, from the box edge each stair is on
  const r4 = { face: 'e', box: [0, 0, 4, 4], geometry: { FACES: 4 }, cells: [] }
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) r4.cells.push({ at: [x, 0, z], role: 'skin' })
  for (const at of [[5, 0, 2], [-1, 0, 2], [2, 0, 5], [2, 0, -1]]) r4.cells.push({ at, role: 'stair' })
  assert.deepStrictEqual(P.stairFoot(r4).map(c => c.join(',')).sort(), ['-2,2', '2,-2', '2,6', '6,2'])
})
await t('sitePaths: farm, well and a complete ziggurat reached, nearest first; an open project is no destination; unrouted -> no record', async () => {
  const srv = server()
  const zrec = { blueprint: 'ziggurat@1', structure_complete: true, face: 'e', cells: [] }
  for (let x = -30; x <= -24; x++) for (let z = -30; z <= -24; z++) zrec.cells.push({ at: [x, G + 1, z], role: x === -24 && z >= -28 && z <= -26 ? 'stair' : 'skin' })
  const s = P.sitePaths(srv.read, { plan: { ...plan(), plots: [{ id: 'core', kind: 'plaza', box: CORE, keepout: false }] }, caps: [[5, G + 1, 20]], composter: [-1, G + 1, 9], projects: [{ plot: 'monument', rec: zrec }, { plot: 'house1', rec: { blueprint: 'house@1', structure_complete: false, cells: [] } }], place: placeBlueprint })
  assert.ok(s.ok, s.why)
  assert.deepStrictEqual(s.dests.map(d => d.id), ['farm', 'well', 'monument'])
  assert.ok(s.net.legs.every(l => l.ok))
  const cols = colsOf(s.record)
  assert.ok(s.dests.every(d => d.cols.some(([x, z]) => cols.has(`${x},${z}`))), 'every destination column set is touched')
  assert.ok(s.record.cells.every(c => Math.max(Math.abs(c.at[0] - 5), Math.abs(c.at[2] - 20)) > 3), 'never inside the well\'s footprint + 1')
  // a moat round the farm: unrouted, no record
  const srv2 = server()
  for (let x = 14; x <= 26; x++) for (let z = 14; z <= 26; z++) if (Math.max(Math.abs(x - 20), Math.abs(z - 20)) >= 4) srv2.set([x, G, z], 'water')
  const s2 = P.sitePaths(srv2.read, { plan: { ...plan(), plots: [{ id: 'core', kind: 'plaza', box: CORE, keepout: false }] }, composter: [20, G + 1, 20], place: placeBlueprint })
  assert.strictEqual(s2.ok, false); assert.match(s2.why, /unrouted:farm/); assert.strictEqual(s2.record, null)
})

console.log('THE TOWN\'S CONTAINERS AND THE EXTENSION (r2, coordinator 10-30: the store row\'s chests unreachable under leaves)')
// the showcase's shape: chests at -7,71,8 and -5,71,8 (stands -8,71,8 and -6,71,8: the second between the two chests), leaves at
// both stands' head height, a spruce trunk at -8,9
const chestPlan = () => ({ ...plan(), plots: [{ id: 'core', kind: 'plaza', box: CORE, keepout: false },
  // the showcase's store plot has a box (-15,-4..-7,4): its south row of chests lies OUTSIDE it, so only the cells themselves refuse
  { id: 'store', kind: 'storehouse', keepout: true, box: [-24, -4, -16, 4], cells: [{ at: [-7, G + 1, 8], kind: 'chest', state: 'placed', stand: [-8, G + 1, 8] }, { at: [-5, G + 1, 8], kind: 'chest', state: 'placed', stand: [-6, G + 1, 8] }, { at: [-11, G + 1, 20], kind: 'chest', state: 'free', stand: [-12, G + 1, 20] }] }] })
const chestWorld = () => {
  const srv = server()
  for (const at of [[-7, G + 1, 8], [-5, G + 1, 8]]) srv.set(at, 'chest')
  for (let x = -11; x <= -3; x++) for (let z = 6; z <= 11; z++) srv.set([x, G + 2, z], 'spruce_leaves')
  for (let y = G + 1; y <= G + 6; y++) srv.set([-8, y, 9], 'spruce_log')
  return srv
}
await t('chestDests: every PLACED container with a stand -- its stand column and the stand\'s free neighbours; never a free cell\'s', async () => {
  const pl = chestPlan()
  const d = P.chestDests(pl, P.pathAvoid({ plan: pl, home: HOME }))
  assert.deepStrictEqual(d.map(q => q.to), ['chest:-7,70,8', 'chest:-5,70,8'])
  assert.ok(d.every(q => q.optional))
  const second = d.find(q => q.to === 'chest:-5,70,8')
  assert.ok(second.cols.some(c => c.join(',') === '-6,8') && !second.cols.some(c => c.join(',') === '-7,8' || c.join(',') === '-5,8'), 'never a chest column')
})
await t('pathAvoid: a plan CELL is refused at every height; its STAND is a FLAT column (never filled into, never cut): columnCost', async () => {
  const pl = chestPlan()
  const av = P.pathAvoid({ plan: pl, home: HOME })
  assert.strictEqual(av(-7, 8), 'plan_cell'); assert.strictEqual(av(-6, 8), null); assert.ok(av.flat.has('-6,8'))
  const c = { y: G, name: 'grass_block', why: null, above: [] }
  assert.ok(Number.isFinite(P.columnCost(c, G, () => null, -6, 8, true)))
  assert.strictEqual(P.columnCost(c, G + 1, () => null, -6, 8, true), Infinity, 'no fill at a stand')
  assert.ok(Number.isFinite(P.columnCost(c, G + 1, () => null, 0, 0, false)), 'POSITIVE CONTROL: elsewhere a fill is priced')
})
await t('sitePaths: the chests reached (optional legs), each stand\'s head room listed; a STAND IN A DIP stays at its ground', async () => {
  const srv = chestWorld()
  srv.set([-8, G, 8], 'air')          // a dip at the first stand: a fill there would put a block in the chest's feet cell
  const s = P.sitePaths(srv.read, { plan: chestPlan(), place: placeBlueprint })
  assert.ok(s.ok, s.why)
  assert.ok(s.net.legs.filter(l => l.optional).every(l => l.ok), JSON.stringify(s.net.legs.map(l => [l.id, l.why])))
  const has = at => s.record.clear.some(c => c.at.join(',') === at.join(','))
  assert.ok(has([-6, G + 2, 8]) && has([-8, G + 2, 8]), 'the stands\' head room (leaves) is cleared')
  assert.ok(!s.record.cells.some(c => c.at[0] === -8 && c.at[2] === 8 && c.at[1] !== G - 1), 'the dipped stand is never raised')
  assert.ok(!s.record.cells.some(c => (c.at[0] === -7 || c.at[0] === -5) && c.at[2] === 8), 'never a chest column')
  assert.strictEqual(gentle(s.record), null)
})
await t('extendPaths: a record laid before the chests gains their legs -- old cells unchanged, new segments, reopened; nothing new -> refused', async () => {
  const srv = chestWorld()
  const pl0 = { ...plan(), plots: [{ id: 'core', kind: 'plaza', box: CORE, keepout: false }] }
  const s0 = P.sitePaths(srv.read, { plan: pl0, composter: [20, G + 1, 0], place: placeBlueprint })
  assert.ok(s0.ok, s0.why)
  const base = { ...s0.record, structure_complete: true, state: 'complete' }
  const x = P.extendPaths(srv.read, base, { plan: chestPlan(), composter: [20, G + 1, 0], place: placeBlueprint })
  assert.ok(x.ok, x.why)
  assert.ok(x.added.length >= 1)
  assert.deepStrictEqual(x.record.cells.slice(0, base.cells.length), base.cells, 'the laid cells unchanged')
  const fresh = x.record.cells.slice(base.cells.length)
  assert.ok(fresh.length > 0 && fresh.every(c => /^P-[A-Za-z0-9-]+$/.test(c.seg) && x.record.segments.some(sg => sg.seg === c.seg)))
  assert.ok(!fresh.some(c => base.cells.some(b => b.at[0] === c.at[0] && b.at[2] === c.at[2])), 'no column laid twice')
  assert.strictEqual(x.record.structure_complete, false); assert.ok(x.record.maxStep <= 1)
  assert.strictEqual(P.newDests(x.record, P.pathDests({ plan: chestPlan(), composter: [20, G + 1, 0], place: placeBlueprint }).dests).length, 0, 'served now')
  assert.strictEqual(P.extendPaths(srv.read, x.record, { plan: chestPlan(), composter: [20, G + 1, 0], place: placeBlueprint }).why, 'nothing_new')
  // A RENAMED ID (Codex r5 BLOCK): a record whose legs already hold `chest1` (another chest, indexed before the plan gained one)
  // -- the new leg is renamed and its stand's head room is still listed
  const taken = { ...base, legs: [...base.legs, { id: 'chest1', to: 'chest:elsewhere', ok: true }, { id: 'chest2', to: 'chest:elsewhere2', ok: true }] }
  const xr = P.extendPaths(srv.read, taken, { plan: chestPlan(), composter: [20, G + 1, 0], place: placeBlueprint })
  assert.ok(xr.ok, xr.why)
  assert.ok(xr.added.every(id => !['chest1', 'chest2'].includes(id)), `renamed: ${xr.added}`)
  assert.ok(xr.record.clear.some(c => c.at.join(',') === [-6, G + 2, 8].join(',')) && xr.record.clear.some(c => c.at.join(',') === [-8, G + 2, 8].join(',')), 'the stands\' head room listed under the renamed ids')
  // a chest walled in by water: reported failed, the record untouched
  const srv2 = chestWorld()
  for (let x2 = -12; x2 <= -1; x2++) for (let z = 5; z <= 12; z++) if (!(x2 >= -9 && x2 <= -4 && z >= 7 && z <= 10)) srv2.set([x2, G, z], 'water')
  const y = P.extendPaths(srv2.read, base, { plan: chestPlan(), composter: [20, G + 1, 0], place: placeBlueprint })
  assert.strictEqual(y.ok, false); assert.ok(y.failed.length >= 1 && y.record === null)
})

console.log('THE PROJECT LIST AND THE ORDER (shop.mjs)')
await t('PROJECTS: paths fourth, after the house; projectsOn takes it only with its switch (and the house\'s)', async () => {
  const p = SHOPM.PROJECTS.find(q => q.plot === 'paths')
  assert.ok(p && p.after === 'house1' && p.builders === P.PATHS_BUILDERS && p.blueprint === P.PATHS_BLUEPRINT)
  assert.ok(SHOPM.projectsOn(true, true, true).some(q => q.plot === 'paths'))
  assert.ok(!SHOPM.projectsOn(true, true, false).some(q => q.plot === 'paths'))
  assert.ok(!SHOPM.projectsOn(false, true, true).some(q => q.plot === 'paths'), 'never without the house it follows')
})
await t('activeProject: the paths once the house stands (and the monument with it); before that the house', async () => {
  const list = SHOPM.projectsOn(true, true, true)
  const st = (house, mon) => [{ plot: 'shop', exists: true, complete: true }, { plot: 'house1', exists: true, complete: house }, { plot: 'monument', exists: true, complete: mon }]
  assert.strictEqual(SHOPM.activeProject(st(true, true), list).plot, 'paths')
  assert.strictEqual(SHOPM.activeProject(st(false, true), list).plot, 'house1')
})
await t('buildOrder: an UNSITED paths project needs 2 free bag slots, not 8 (the active plot hook); the workshop still 8', async () => {
  const base = { on: true, shared: true, atTown: true, planned: true, now: 1e9, state: {}, freeSlots: 3 }
  SHOPM.setActivePlot(() => 'paths')
  assert.ok(SHOPM.buildOrder({ ...base, record: null }).order, 'unsited paths: ordered with 3 free slots')
  assert.ok(SHOPM.buildOrder({ ...base, record: { plot: 'paths' } }).order)
  SHOPM.setActivePlot(() => 'shop')
  assert.strictEqual(SHOPM.buildOrder({ ...base, record: null }).skip, 'room')
  SHOPM.setActivePlot(() => { throw new Error('unreadable') })
  assert.strictEqual(SHOPM.buildOrder({ ...base, record: null }).skip, 'room', 'an unreadable active plot keeps the workshop\'s rule')
  SHOPM.setActivePlot(() => null)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
