// WALLEXT-01: THE WALL EXTENSION (bots/src/wall.mjs siteWallExt; owner 11-04 "lets do A then extend the wall around the new building
// leaving room for additional buildings"). Pure and on the fake server: the side the hall is beyond; the rectangles (the shared side ON
// the old line, never past its span); the JOIN (the old line is never built, the old wall's cells never touched); the floating-spoil
// column (the pathfinder's bridges are not ground); the plots (hall size first, clear of every refusal, apart, level by percentile);
// the walk seed (a pillar on home's column); the siting end to end (the hall's reservation and the old wall outside every cell, the
// escape proof clean) and the record BUILT END TO END by buildrun.mjs runVisit; the opening rule; the land plan's plot zones; the
// inside-the-wall stage over both interiors; the project order and guard (shop.mjs); the wiring in skills.mjs (anchored, mutants).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const W = await import('../src/wall.mjs')
const SHOP = await import('../src/shop.mjs')
const LP = await import('../src/landplan.mjs')
const T = await import('../src/tidy.mjs')
const P = await import('../src/paths.mjs')
const { recordZones } = SHOP
const WP = new URL('../src/wall.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const PLAN = () => ({ home: HOME, gen: 4, plots: [{ id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], keepout: true }], paths: [] })
// a small search (the fake server is +-60): the test's own bounds, the module's rule
const WT = { ...W.WALLEXT, grow: [0, 4], growOut: [0, 20], plotsWant: 2, tries: 4 }
const HUB = { plot: 'storehub', blueprint: 'storehub@1', box: [-6, -30, 6, -22], structure_complete: true }
const oldWall = srv => { const s = W.siteWall(srv.read, { plan: PLAN() }); assert.ok(s.ok, s.why); return { ...s.record, structure_complete: true } }
const inBox = (b, x, z) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]
const siteExt = (srv, wall, o = {}) => W.siteWallExt(srv.read, { wall, hub: HUB, plan: PLAN(), pzones: recordZones([HUB, wall, ...(o.records ?? [])]), W: WT, ...o })

await t('the switch: on in the showcase pool by default, off in a fleet pool, WALLEXT=on|off wins', () => {
  assert.strictEqual(W.wallextOn({}, 'showcase'), true)
  assert.strictEqual(W.wallextOn({}, 'hive-a'), false)
  assert.strictEqual(W.wallextOn({ WALLEXT: 'on' }, 'hive-a'), true)
  assert.strictEqual(W.wallextOn({ WALLEXT: 'off' }, 'showcase'), false)
  assert.strictEqual(W.wallextOn({ WALLEXT_POOLS: '*' }, 'hive-a'), true)
})
await t('THE SIDE: the hall beyond exactly one side, within its span; inside, at a corner or past the span -> null', () => {
  const ring = [-46, -20, 35, 39]
  assert.strictEqual(W.extSide(ring, [-21, -49, -3, -39]), 'N', 'the showcase hall')
  assert.strictEqual(W.extSide(ring, [-21, 45, -3, 55]), 'S')
  assert.strictEqual(W.extSide(ring, [-60, 0, -50, 10]), 'W')
  assert.strictEqual(W.extSide(ring, [40, 0, 50, 10]), 'E')
  assert.strictEqual(W.extSide(ring, [-15, -4, -8, 3]), null, 'inside the ring')
  assert.strictEqual(W.extSide(ring, [-21, -25, -3, -18]), null, 'across the line')
  assert.strictEqual(W.extSide(ring, [-60, -40, -50, -30]), null, 'beyond a corner')
  assert.strictEqual(W.extSide(ring, [-50, -49, -30, -39]), null, 'past the span: a side could not meet the old line')
  assert.strictEqual(W.extSide(null, [0, 0, 1, 1]), null)
})
await t('THE RECTANGLES: the shared side ON the old line, the hall + margin inside, never past the old span; the interior up to the line', () => {
  const ring = [-46, -20, 35, 39], box = [-21, -49, -3, -39]
  const rs = W.extRects(ring, box, 'N')
  assert.ok(rs.length > 20)
  for (const { rect } of rs) {
    assert.strictEqual(rect[3], -20, 'the south side is the old north line')
    assert.ok(rect[0] >= -46 - W.WALLEXT.over && rect[2] <= 35 + W.WALLEXT.over, 'within the old span + over (r4)')
    assert.ok(rect[0] <= box[0] - 6 && rect[2] >= box[2] + 6 && rect[1] <= box[1] - 6, 'the hall + margin inside')
  }
  assert.strictEqual(new Set(rs.map(r => r.rect.join(','))).size, rs.length, 'each once')
  assert.deepStrictEqual(W.extInterior([-35, -79, 23, -20], 'N'), [-34, -78, 22, -20], 'up to AND including the shared line')
  assert.deepStrictEqual(W.extInterior([10, 0, 30, 20], 'E'), [10, 1, 29, 19])
  assert.strictEqual(W.extJoin(ring, 'N')(5, -20), 'join'); assert.strictEqual(W.extJoin(ring, 'N')(5, -21), null)
  assert.strictEqual(W.extJoin(ring, 'W')(-46, 3), 'join')
})
await t('PAST THE OLD SPAN (r4, LIVE 11-05: the hall 6 from the old ring\'s east end -- every ring that end allowed trapped or cut the strip between the hall and the terrace): the join is the old line\'s own span only; a rectangle may pass it by `over`', () => {
  const ring = [-46, -20, 35, 39]
  const j = W.extJoin(ring, 'N')
  assert.strictEqual(j(35, -20), 'join'); assert.strictEqual(j(-46, -20), 'join')
  assert.strictEqual(j(36, -20), null, 'beyond the span: built as wall'); assert.strictEqual(j(-47, -20), null)
  const rs = W.extRects(ring, [10, -59, 28, -49], 'N')
  assert.ok(rs.some(q => q.rect[2] > 35) && rs.every(q => q.rect[2] <= 35 + W.WALLEXT.over), 'past the east end, by at most `over`')
  assert.ok(W.extRects(ring, [10, -59, 28, -49], 'N', { ...W.WALLEXT, over: 0 }).every(q => q.rect[2] <= 35), 'positive control: over 0 is the old rule')
})
await t('PAST THE SPAN, THE DEMOLITION KEEPS THE OLD CORNERS (Codex r4 BLOCKER): the recorded join is clamped to the old span; the perpendicular side survives', async () => {
  const srv = server()
  const wall = oldWall(srv)
  const s = await siteExt(srv, wall, { hub: { ...HUB, box: [4, -30, 10, -22] }, W: { ...WT, grow: [0, 8], over: 6 } })
  assert.ok(s.ok, s.why)
  const r = s.record
  assert.ok(r.ring[2] > wall.ring[2] || r.ring[0] < wall.ring[0], `positive control: the ring passes the old span (${r.ring})`)
  assert.ok(r.join.from >= wall.ring[0] && r.join.to <= wall.ring[2], `the join clamped (${r.join.from}..${r.join.to})`)
  const d = W.demoCells(wall, { ...r, structure_complete: true })
  assert.ok(!d.cells.some(c => c.at[0] <= wall.ring[0] || c.at[0] >= wall.ring[2]), 'no cell of an old corner or a perpendicular side')
  // the unclamped join (the bug) reaches the side: the test would catch it
  const bad = W.demoCells(wall, { ...r, join: { ...r.join, from: r.ring[0], to: r.ring[2] }, structure_complete: true })
  const sideBuilt = wall.cols.some(c => c.z === wall.ring[1] && (c.x === wall.ring[0] || c.x === wall.ring[2]) && (c.s === 'wall' || c.s === 'post'))
  if (sideBuilt) assert.ok(bad.cells.some(c => c.at[0] === wall.ring[0] || c.at[0] === wall.ring[2]), 'the unclamped span takes a corner')
})
await t('THE JOIN in wallCandidate: a join column is never built; without `join` the record is the same as before (positive control)', () => {
  const srv = server()
  const plain = W.wallCandidate(srv.read, [-6, -6, 6, 6], 6, { home: HOME })
  const nulled = W.wallCandidate(srv.read, [-6, -6, 6, 6], 6, { home: HOME, join: null })
  assert.deepStrictEqual(nulled.cells, plain.cells, 'join: null changes nothing')
  assert.ok(plain.cells.some(c => c.at[2] === -12), 'the north line is built without a join')
  const j = W.wallCandidate(srv.read, [-6, -6, 6, 6], 6, { home: HOME, join: (x, z) => (z === -12 ? 'join' : null) })
  assert.ok(j.ok, j.why)
  assert.ok(!j.cells.some(c => c.at[2] === -12), 'nothing on the joined line')
  assert.strictEqual(j.counts.join, 25)
  assert.ok(!('join' in plain.counts), 'the old record shape keeps no join count')
})
await t('FLOATING SPOIL is not ground (extColumn): a bridge block over air is passed, a block on a 1-cell gap and a plank are not', () => {
  const srv = server({ [`3,${G + 7},3`]: 'dirt', [`4,${G + 2},4`]: 'dirt', [`5,${G + 7},5`]: 'oak_planks', [`6,${G + 8},6`]: 'cobblestone', [`6,${G + 4},6`]: 'dirt' })
  const q = (x, z) => W.extColumn(srv.read, x, z, { yHi: G + 14, yLo: G - 14 })
  assert.strictEqual(q(3, 3).y, G, 'the bridge block passed'); assert.ok(q(3, 3).above.some(a => a.kind === 'float' && a.y === G + 7))
  assert.strictEqual(q(4, 4).y, G + 2, 'one cell of air under it: ground (a step)')
  assert.strictEqual(q(5, 5).why, 'built', 'a plank is a build, never passed')
  assert.strictEqual(q(6, 6).y, G, 'two stacked floats passed')
  assert.strictEqual(q(7, 7).y, G, 'plain ground unchanged')
  // positive control: pathColumn (the old wall's reader) takes the bridge as the ground
  assert.strictEqual(P.pathColumn(srv.read, 3, 3, { yHi: G + 14, yLo: G - 14 }).y, G + 7)
})
await t('THE PLOTS: hall size first, nearest the hall, apart by plotGap, clear of refusals and the kept box, level by percentile', () => {
  const cells = {}
  for (let x = -20; x <= 20; x++) cells[`${x},${G + 1},-35`] = 'dirt'                 // a 1-high ridge row: not level? (spread 1: level)
  cells[`0,${G + 8},-40`] = 'cobblestone'                                              // a bot pillar's top (the 90th percentile ignores it)
  for (let y = G + 1; y <= G + 7; y++) cells[`0,${y},-40`] = 'cobblestone'
  const srv = server(cells)
  const refuse = (x, z) => (x >= 12 && z <= -45 ? 'zone' : null)
  const p = W.wallExtPlots(srv.read, [-25, -55, 25, -20], { home: HOME, refuse, near: [0, -26], keep: [[-6, -30, 6, -22]], want: 4 })
  assert.ok(p.length >= 3, JSON.stringify(p))
  assert.strictEqual(p[0].kind, 'hall')
  for (const a of p) {
    const w = a.box[2] - a.box[0] + 1, d = a.box[3] - a.box[1] + 1
    assert.ok((a.kind === 'hall' && [19, 13].includes(w) && [19, 13].includes(d)) || (a.kind === 'house' && w === 11 && d === 11))
    for (let x = a.box[0]; x <= a.box[2]; x++) for (let z = a.box[1]; z <= a.box[3]; z++) assert.ok(!refuse(x, z), 'never on a refused column')
    assert.ok(a.box[2] < -6 - 3 || a.box[0] > 6 + 3 || a.box[3] < -30 - 3 || a.box[1] > -22 + 3, 'plotGap off the hall')
  }
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    const a = p[i].box, b = p[j].box
    assert.ok(a[2] + 3 < b[0] || b[2] + 3 < a[0] || a[3] + 3 < b[1] || b[3] + 3 < a[1], 'plots plotGap apart')
  }
  assert.strictEqual(W.wallExtPlots(srv.read, [-25, -55, 25, -20], { home: HOME, refuse: () => 'zone' }).length, 0, 'everything refused: none')
  // a deep pit field (every other column 4 down) is not level
  const pits = {}
  for (let x = -25; x <= 25; x++) for (let z = -55; z <= -20; z++) if ((x + z) % 2 === 0) for (let y = G - 4; y <= G; y++) pits[`${x},${y},${z}`] = 'air'
  assert.strictEqual(W.wallExtPlots(server(pits).read, [-25, -55, 25, -20], { home: HOME, want: 4 }).length, 0, 'half the ground 5 lower: no plot')
})
await t('THE WALK SEED (LIVE showcase 11-04: a dirt pillar on home\'s column to y 75): walkFeet finds the nearest feet cell; walkSet from it walks', () => {
  const cells = {}
  for (let y = G + 1; y <= G + 6; y++) cells[`0,${y},0`] = 'dirt'
  const srv = server(cells)
  assert.strictEqual(W.walkSet(srv.read, HOME, 10).size, 0, 'positive control: from home itself nothing is walked')
  const seed = W.walkFeet(srv.read, HOME)
  assert.ok(seed && Math.max(Math.abs(seed[0]), Math.abs(seed[2])) === 1 && seed[1] === G + 1, JSON.stringify(seed))
  assert.ok(W.walkSet(srv.read, HOME, 10, { seed }).size > 300)
})
await t('THE SITING on the fake server: N; no cell on the old line, on an old wall column or in the hall\'s reservation; plots inside; escape clean', async () => {
  const srv = server()
  const wall = oldWall(srv)
  const s = await siteExt(srv, wall)
  assert.ok(s.ok, s.why)
  const r = s.record
  assert.strictEqual(r.side, 'N'); assert.strictEqual(r.plot, W.WALLEXT_PLOT); assert.strictEqual(r.blueprint, W.WALLEXT_BLUEPRINT)
  assert.strictEqual(r.ring[3], wall.ring[1], 'the shared line')
  const oldCols = new Set(wall.cells.map(c => `${c.at[0]},${c.at[2]}`))
  const hubZone = [HUB.box[0] - 3, HUB.box[1] - 3, HUB.box[2] + 3, HUB.box[3] + 3]
  for (const c of r.cells) {
    const inSpan = c.at[0] >= wall.ring[0] && c.at[0] <= wall.ring[2]
    assert.ok(c.at[2] < wall.ring[1] || (c.at[2] === wall.ring[1] && !inSpan), `a cell on the old line's own span or behind it ${c.at}`)
    assert.ok(!oldCols.has(`${c.at[0]},${c.at[2]}`), 'never an old wall column')
    assert.ok(!inBox(hubZone, c.at[0], c.at[2]), `a cell in the hall's reservation ${c.at}`)
    assert.ok(inBox(r.ring, c.at[0], c.at[2]), 'inside its own rectangle')
  }
  assert.ok(r.cells.filter(c => c.role === 'wall').length > 40, 'a real wall stands')
  assert.ok(r.cols.filter(c => c.z === wall.ring[1] && c.x >= wall.ring[0] && c.x <= wall.ring[2]).every(c => c.s === 'join'), 'the old line\'s own span is all join')
  assert.strictEqual(r.escape.cut, 0); assert.strictEqual(r.escape.trapped, 0)
  assert.ok(r.zones.length && r.zones.every(z => z.why === 'project:wallext'))
  assert.deepStrictEqual(r.interior, W.extInterior(r.ring, 'N'))
  assert.ok(r.plots.length >= 1, 'room for buildings')
  for (const p of r.plots) {
    assert.ok(inBox(r.interior, p.box[0], p.box[1]) && inBox(r.interior, p.box[2], p.box[3]), 'a plot inside the walls')
    assert.ok(!r.cells.some(c => inBox(p.box, c.at[0], c.at[2])), 'no wall cell on a plot')
  }
  assert.deepStrictEqual(Object.keys(r.bom).sort(), ['cobblestone'])
  assert.deepStrictEqual(r.join.ring, wall.ring)
})
await t('THE ZIGGURAT APRON (r3, LIVE 11-04: the hall itself failed on it): no plot within a ziggurat\'s box + 8; positive control without it', async () => {
  const srv = server()
  const wall = oldWall(srv)
  const base = await siteExt(srv, wall)
  const p0 = base.record.plots[0]
  const z0 = { box: [p0.box[0] - 8, p0.box[1] - 8, p0.box[0] - 8, p0.box[1] - 8] }   // a 1x1 'ziggurat' 8 off the plot's corner: its apron covers it
  const s = await siteExt(srv, wall, { z0 })
  const ap = [z0.box[0] - 8, z0.box[1] - 8, z0.box[2] + 8, z0.box[3] + 8]
  const over = p => p.box[0] <= ap[2] && p.box[2] >= ap[0] && p.box[1] <= ap[3] && p.box[3] >= ap[1]
  assert.ok(over(p0), 'positive control: the plot sited without the apron lies in it')
  assert.ok(s.ok && !s.record.plots.some(over), JSON.stringify(s.record?.plots))
})
await t('THE ZIGGURAT WHATEVER ITS SWITCH (Codex r3 BLOCKER): a monument missing from the guarded heads (MONUMENT=off) is added, its box is the apron source', async () => {
  const mon = { plot: 'monument', blueprint: 'ziggurat@1', box: [-30, -45, -16, -36], cells: [{ at: [-20, G + 1, -40] }] }
  const off = W.extWithMonument([{ plot: 'shop', box: [0, 0, 1, 1] }], mon, null)
  assert.ok(off.records.some(r => r.plot === 'monument')); assert.deepStrictEqual(off.z0, { box: mon.box })
  const on = W.extWithMonument([mon], mon, { box: [9, 9, 9, 9] })
  assert.strictEqual(on.records.length, 1, 'never twice'); assert.deepStrictEqual(on.z0, { box: mon.box })
  assert.deepStrictEqual(W.extWithMonument([], null, null), { records: [], z0: null })
  // and it holds the ring and the plots off: the reservation (box + 3) and the apron (box + 8)
  const srv = server()
  const wall = oldWall(srv)
  const s = await siteExt(srv, wall, { records: off.records, pzones: recordZones([HUB, wall, ...off.records]), z0: off.z0 })
  const ap = [mon.box[0] - 8, mon.box[1] - 8, mon.box[2] + 8, mon.box[3] + 8], rz = [mon.box[0] - 3, mon.box[1] - 3, mon.box[2] + 3, mon.box[3] + 3]
  assert.ok(s.ok && !s.record.cells.some(c => inBox(rz, c.at[0], c.at[2])), 'no wall cell in its reservation')
  assert.ok(!s.record.plots.some(p => p.box[0] <= ap[2] && p.box[2] >= ap[0] && p.box[1] <= ap[3] && p.box[3] >= ap[1]), 'no plot in its apron')
})
await t('THE SITING refuses: a hall inside the wall, no wall, no hall', async () => {
  const srv = server()
  const wall = oldWall(srv)
  assert.strictEqual((await W.siteWallExt(srv.read, { wall, hub: { box: [-4, -4, 4, 4] }, plan: PLAN(), W: WT })).why, 'hub_not_beyond_a_side')
  assert.strictEqual((await W.siteWallExt(srv.read, { wall: null, hub: HUB, plan: PLAN(), W: WT })).why, 'no_wall')
  assert.strictEqual((await W.siteWallExt(srv.read, { wall, hub: null, plan: PLAN(), W: WT })).why, 'no_hub')
})
await t('THE OLD WALL\'S ZONES never refuse the extension (its line is the join); another record\'s do (a gap where it meets)', async () => {
  const srv = server()
  const wall = oldWall(srv)
  const other = { plot: 'monument', blueprint: 'ziggurat@1', box: [-24, -45, -10, -36] }
  const s = await siteExt(srv, wall, { records: [other] })
  assert.ok(s.ok, s.why)
  const zone = [other.box[0] - 3, other.box[1] - 3, other.box[2] + 3, other.box[3] + 3]
  assert.ok(!s.record.cells.some(c => inBox(zone, c.at[0], c.at[2])), 'never in the ziggurat\'s reservation')
  assert.ok(s.record.cols.some(c => c.s === 'gap' && c.why === 'project:monument'), 'the ring meets it')
})
await t('ANOTHER RECORD\'S CELLS (Codex code r1 BLOCKER: a tidy stage record has cells and no zones): never an extension cell in their column; its plots may take them', async () => {
  const srv = server()
  const wall = oldWall(srv)
  const base = await siteExt(srv, wall)
  const c0 = base.record.cells.find(c => c.role === 'wall')
  const tidy = { plot: 'tidy', blueprint: 'tidy@1', zones: [], cells: [{ at: [c0.at[0], G, c0.at[2]], role: 'fill', seg: 'T-0' }] }
  assert.ok(base.record.cells.some(c => c.at[0] === c0.at[0] && c.at[2] === c0.at[2]), 'positive control: without the record, a wall column there')
  const s = await siteExt(srv, wall, { records: [tidy] })
  assert.ok(s.ok, s.why)
  assert.ok(!s.record.cells.some(c => c.at[0] === c0.at[0] && c.at[2] === c0.at[2]), 'the tidy\'s column is refused')
  // a house's cell is refused for the plots too; the tidy's is not
  const p0 = base.record.plots[0]
  const fill = { plot: 'tidy', blueprint: 'tidy@1', zones: [], cells: [{ at: [p0.box[0] + 2, G, p0.box[1] + 2], role: 'fill', seg: 'T-0' }] }
  const s2 = await siteExt(srv, wall, { records: [fill] })
  assert.deepStrictEqual(s2.record.plots[0].box, p0.box, 'a tidy fill never moves a plot')
})
await t('BUILT END TO END: two fake builders run the bots\' own visit to `complete`; every placement a record cell, never an old one', async () => {
  const srv = server()
  const wall = oldWall(srv)
  const rec = (await siteExt(srv, wall)).record
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallext-'))
  const key = PJ.projKey(HOME, W.WALLEXT_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const names = ['A', 'B']
  const bots = Object.fromEntries(names.map((n, i) => [n, bot(srv, n, { inv: { cobblestone: 3000, stone_bricks: 16, torch: 4 }, feet: [i, G + 1, 0] })]))
  const stands = Object.fromEntries(names.map(n => [n, { pending: null, bans: {} }]))
  const stops = {}
  const done = () => rec.cells.every(c => R.cellDone(srv.read(...c.at), W.WALL_PALETTE, c.role))
  for (let round = 0; round < 60 && !done(); round++) {
    for (const n of names) {
      const slot = PJ.takeSlot(dir, key, n, W.WALL_BUILDERS)
      const v = await R.runVisit({ dir, key, me: n, home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: W.WALL_PALETTE, slot: slot.slot, slotGen: slot.gen,
        domain: () => true, walkR: W.wallWalkR(rec, HOME), foreign: W.WALL_FOREIGN, blockLayer: false, clearMax: W.WALL_CLEAR_MAX, stands: stands[n] }, bots[n], { maxSteps: 400 })
      PJ.releaseLease(dir, key, `slot${slot.slot}`, n, slot.gen)
      stops[v.stop] = (stops[v.stop] ?? 0) + 1
    }
  }
  const open = rec.cells.filter(c => !R.cellDone(srv.read(...c.at), W.WALL_PALETTE, c.role))
  assert.strictEqual(open.length, 0, `open: ${open.slice(0, 5).map(c => `${c.at}:${c.role}`).join(' ')} stops ${JSON.stringify(stops)}`)
  const recKeys = new Set(rec.cells.map(c => c.at.join(','))), oldKeys = new Set(wall.cells.map(c => c.at.join(',')))
  const rows = Object.values(bots).flatMap(b => b.logs).filter(([k]) => k === '_build').map(([, d]) => d)
  for (const d of rows.filter(d => d.op === 'place')) { assert.ok(recKeys.has(d.cell.join(',')), `off_record ${d.cell}`); assert.ok(!oldKeys.has(d.cell.join(','))) }
  for (const d of rows.filter(d => d.op === 'clear')) assert.ok(!oldKeys.has(d.cell.join(',')), 'never digs the old wall')
})
await t('THE OPENING RULE: a complete wall and the hall beyond one side; else waiting (with its reason)', () => {
  const wall = { ring: [-46, -20, 35, 39], structure_complete: true }
  assert.deepStrictEqual(W.wallextOpening(wall, { box: [-21, -49, -3, -39] }), { open: true, why: 'ok' })
  assert.strictEqual(W.wallextOpening({ ...wall, structure_complete: false }, { box: [-21, -49, -3, -39] }).why, 'wall_open')
  assert.strictEqual(W.wallextOpening(wall, { box: [-15, -4, -8, 3] }).why, 'hub_not_beyond_a_side')
  assert.strictEqual(W.wallextOpening(wall, null).why, 'no_hub')
  assert.strictEqual(W.wallextOpening(null, { box: [-21, -49, -3, -39] }).why, 'no_wall')
})
await t('THE LAND PLAN LEARNS THE PLOTS: landReservation(land, ext) carries them as `land:plot` zones; without an extension, as before', () => {
  const land = { corridors: [{ box: [0, -64, -80, 3, 320, -78], why: 'land:road' }] }
  const ext = { plots: [{ id: 'X1', kind: 'hall', box: [-21, -65, -3, -53] }, { id: 'bad', box: [1, 2] }] }
  assert.deepStrictEqual(LP.landReservation(land).zones, land.corridors)
  const z = LP.landReservation(land, ext).zones
  assert.deepStrictEqual(z.at(-1), { box: [-21, -64, -65, -3, 320, -53], why: 'land:plot', id: 'X1' })
  assert.strictEqual(z.length, 2, 'a malformed plot is no zone')
  // every later siting reads it (recordZones keeps a record's own zones)
  assert.ok(recordZones([LP.landReservation(land, ext)]).some(q => q.why === 'land:plot'))
})
await t('INSIDE THE WALLS: inwallBoxes = the wall\'s box + the extension\'s interior; the inwall stage surveys both (a pillar in the extension found)', () => {
  const wall = { ring: [-12, -12, 12, 12] }, ext = { interior: [-11, -40, 11, -12] }
  assert.deepStrictEqual(T.inwallBoxes(wall, HOME, ext), [[-11, -11, 11, 11], [-11, -40, 11, -12]])
  assert.deepStrictEqual(T.inwallBoxes(wall, HOME, null), [[-11, -11, 11, 11]])
  const cells = {}
  for (let y = G + 1; y <= G + 2; y++) cells[`3,${y},-30`] = 'dirt'                   // a 2-high stray pillar in the extension
  for (let y = G + 1; y <= G + 2; y++) cells[`3,${y},5`] = 'dirt'                     // and one in the old town
  const srv = server(cells)
  const run = e => T.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: LP.landStages().find(s => s.id === LP.INWALL_STAGE), plan: PLAN(), terrace: { wall, wallext: e, records: [] } })
  const has = (s, x, z) => (s.record?.cut ?? []).some(c => c.at[0] === x && c.at[2] === z)
  const a = run(null), b = run(ext)
  assert.ok(has(a, 3, 5) && !has(a, 3, -30), 'without the extension: the old town only (positive control)')
  assert.ok(has(b, 3, 5) && has(b, 3, -30), 'with it: both')
  assert.deepStrictEqual(b.record.inwall.boxes, [[-11, -11, 11, 11], [-11, -40, 11, -12]])
  assert.deepStrictEqual(T.mergeSurveys([{ cut: [{ at: [1, 2, 3] }], fill: [], pillars: [], pits: [], litter: 1, skipped: { a: 1 } }, { cut: [{ at: [1, 2, 3] }, { at: [4, 5, 6] }], fill: [], pillars: [], pits: [], litter: 2, skipped: { a: 2 } }]).cut.length, 2)
})
await t('THE ORDER (shop.mjs): after the hall, waiting until it opens; guarded whatever its switch; a light plot', () => {
  const on = SHOP.projectsOn(true, true, true, true, false, true, false, true, true, true, false, false, [], false, true, true)
  const i = on.findIndex(p => p.plot === 'wallext'), h = on.findIndex(p => p.plot === 'storehub')
  assert.ok(i > h && h >= 0, 'right after the hall')
  assert.strictEqual(on[i].after, 'storehub'); assert.strictEqual(on[i].builders, W.WALL_BUILDERS)
  assert.ok(!SHOP.projectsOn(true, true, true, true, false, true, false, true, true, true, false, false, [], false, true, false).some(p => p.plot === 'wallext'), 'WALLEXT=off')
  assert.ok(!SHOP.projectsOn(true, true, true, false, false, true, false, true, true, true, false, false, [], false, true, true).some(p => p.plot === 'wallext'), 'never without the wall')
  assert.ok(SHOP.projectsGuarded(SHOP.projectsOn(true, true, true, true, false, true, false, true, true, true, false, false, [], false, true, false)).some(p => p.plot === 'wallext'), 'guarded when off')
  assert.ok(SHOP.LIGHT_PLOTS.has('wallext'))
  // activeProject: the hall complete, the extension unsited and WAITING -> not offered (the next project is); not waiting -> offered
  const st = (plot, o = {}) => ({ plot, exists: true, complete: true, damaged: false, ...o })
  const base = on.filter(p => !p.sink && p.plot !== 'wallext' && p.plot !== 'tidy').map(p => st(p.plot))
  assert.notStrictEqual(SHOP.activeProject([...base, { plot: 'wallext', exists: false, complete: false, damaged: false, waiting: true }], on).plot, 'wallext')
  assert.strictEqual(SHOP.activeProject([...base, { plot: 'wallext', exists: false, complete: false, damaged: false }], on).plot, 'wallext')
  assert.notStrictEqual(SHOP.activeProject([...base.filter(s => s.plot !== 'storehub'), st('storehub', { complete: false }), { plot: 'wallext', exists: false, complete: false, damaged: false }], on).plot, 'wallext', 'never before the hall stands')
})

// ---- wallext-01 r2: TWO hall-size plots (owner O2: the enchanting/anvil workshop, then the town hall), then houses ----
await t('PLOT VALUE (r2): a hall-size plot is worth 2, a house-size 1, each kind to its max (2 halls, 3 houses)', () => {
  const P = (kind, n) => Array.from({ length: n }, (_, i) => ({ id: `X${i}`, kind, box: [0, 0, 1, 1] }))
  assert.strictEqual(W.plotValue([...P('hall', 2), ...P('house', 3)]), 7)
  assert.strictEqual(W.plotValue([...P('hall', 3), ...P('house', 5)]), 7, 'capped per kind')
  assert.strictEqual(W.plotValue([...P('hall', 1), ...P('house', 3)]), 5, 'one hall short is worth less than two halls and one house (5)')
  assert.strictEqual(W.plotValue([...P('hall', 2), ...P('house', 1)]), 5)
  const p = W.wallExtPlots(server().read, [-40, -58, 40, -20], { home: HOME, want: 9 })
  assert.strictEqual(p.filter(q => q.kind === 'hall').length, 2, 'never more than 2 hall-size plots')
  assert.strictEqual(p.filter(q => q.kind === 'house').length, 3, 'never more than 3 house-size plots')
})

// ---- wallext-02: the old line comes down (owner O1 "remove left over blocks") ----
const extFor = (wall, o = {}) => ({ side: 'N', join: { axis: 'z', line: wall.ring[1], from: wall.ring[0], to: wall.ring[2] }, structure_complete: true, ...o })
await t('DEMO CELLS: the old wall\'s cells in a built line column strictly inside the span, 0..3 in from the line; never a corner, never deeper, never a base', () => {
  const srv = server()
  const wall = oldWall(srv)
  const ext = extFor(wall, { join: { axis: 'z', line: -12, from: -8, to: 8 } })
  const d = W.demoCells(wall, ext)
  assert.ok(d.cells.length > 10, `${d.cells.length}`)
  const built = wall.cols.filter(c => c.z === -12 && c.x > -8 && c.x < 8 && (c.s === 'wall' || c.s === 'post')).map(c => c.x)
  assert.deepStrictEqual(d.cols.map(c => c[0]), built, 'exactly the built line columns inside the span')
  for (const c of d.cells) {
    assert.ok(built.includes(c.at[0]), 'its column is one of them')
    assert.ok(c.at[2] >= -12 && c.at[2] <= -9, 'at most 3 in (toward the old town: +z for a north extension)')
    assert.notStrictEqual(c.role, 'base')
  }
  assert.ok(!d.cells.some(c => c.at[0] <= -8 || c.at[0] >= 8), 'the span\'s ends stay')
  // positive control: the same wall has cells outside the span and deeper on the other sides
  assert.ok(wall.cells.some(c => c.at[2] === -12 && (c.at[0] <= -8 || c.at[0] >= 8)))
  assert.strictEqual(W.demoCells(wall, { ...ext, side: 'Q' }).cells.length, 0, 'no line: nothing')
})
await t('THE RETIREMENT: the cells leave the wall record (named in `retired`), its zones recomputed, the line columns read retired; idempotent', () => {
  const srv = server()
  const wall = oldWall(srv)
  const ext = extFor(wall, { join: { axis: 'z', line: -12, from: -8, to: 8 } })
  const d = W.demoCells(wall, ext)
  const r = W.retireWall(wall, d, { now: 5 })
  const gone = new Set(d.cells.map(c => c.at.join(',')))
  assert.strictEqual(r.cells.length, wall.cells.length - d.cells.length)
  assert.ok(!r.cells.some(c => gone.has(c.at.join(','))))
  assert.strictEqual(r.retired.length, d.cells.length); assert.ok(r.retired.every(c => c.by === 'walldemo'))
  const inZ = (x, z) => r.zones.some(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5])
  const mid = d.cols[Math.floor(d.cols.length / 2)]
  const zAt = (zs, x, z) => zs.filter(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5]).map(q => q.why)
  assert.ok(zAt(r.zones, mid[0], mid[1]).includes('hold:walldemo'), 'a retired column is HELD by the demolition')
  const rel = W.releaseHold(r, { now: 9 })
  assert.ok(!zAt(rel.zones, mid[0], mid[1]).includes('hold:walldemo'), 'released: no hold')
  assert.strictEqual(W.releaseHold(rel), null, 'nothing held: nothing to release')
  assert.ok(inZ(12, 0), 'the rest of the wall still reserved')
  assert.ok(r.cols.filter(c => c.why === 'retired').length === d.cols.length)
  assert.strictEqual(W.retireWall(r, W.demoCells(r, ext)), null, 'again: nothing to retire')
  assert.deepStrictEqual(W.demoCells(r, ext).cells.map(c => c.at.join(',')).sort(), d.cells.map(c => c.at.join(',')).sort(), 'demoCells reads the retired list')
})
await t('THE DEMOLITION RECORD lists what stands there now (wall palette or a torch); air and other blocks are passed; unread refuses', () => {
  const srv = server()
  const wall = oldWall(srv)
  const ext = extFor(wall, { join: { axis: 'z', line: -12, from: -8, to: 8 } })
  const d = W.demoCells(wall, ext)
  for (const c of wall.cells) srv.set(c.at, c.role === 'light' ? 'wall_torch' : c.role === 'post' ? 'stone_bricks' : 'cobblestone')
  srv.set(d.cells[0].at, 'air'); srv.set(d.cells[1].at, 'oak_planks')
  const s = W.demoRecord(srv.read, W.retireWall(wall, d), ext, { home: HOME })
  assert.ok(s.ok, s.why)
  assert.strictEqual(s.record.clear.length, d.cells.length - 2)
  assert.deepStrictEqual(s.skipped, { air: 1, oak_planks: 1 })
  assert.ok(s.record.clear.every(c => c.kind === 'demolish'))
  assert.deepStrictEqual(s.record.cells, [])
  assert.strictEqual(W.demoRecord(() => null, wall, ext, { home: HOME }).why, 'unknown')
  assert.deepStrictEqual(W.walldemoOpening(wall, { ...ext, structure_complete: false }), { open: false, why: 'ext_open' })
  assert.deepStrictEqual(W.walldemoOpening(wall, ext), { open: true, why: 'ok' })
})
await t('THE HOLD (Codex batch-5 fold BLOCKER): an inwall fill on the old line mid-demolition is refused; after the release it is planned', () => {
  const srv = server()
  const wall = oldWall(srv)
  const ext = extFor(wall, { join: { axis: 'z', line: -12, from: -8, to: 8 } })
  const d = W.demoCells(wall, ext)
  const c0 = d.cells.find(c => c.at[2] === -11)                             // a walk column one in from the line (old town side)
  srv.set([c0.at[0], G, c0.at[2]], 'air')                                    // its wall blocks dug, and a hole under them: a pit
  const box = [-11, -12, 11, -9]
  // as skills.mjs tidyInputs builds them: the zones as `avoid`, the hold as `reserved` (read first by every inwall rule)
  const fillAt = rec => {
    const avoid = T.tidyAvoid(() => null, recordZones([rec]))
    const sv = T.surveyInwall(srv.read, { home: HOME, box, avoid, reserved: W.holdAt(rec), cells: new Set(rec.cells.map(c => c.at.join(','))) })
    return sv.fill.some(f => f.at[0] === c0.at[0] && f.at[2] === c0.at[2])
  }
  const held = W.retireWall(wall, d)
  assert.strictEqual(T.tidyAvoid(() => null, recordZones([held]))(c0.at[0], c0.at[2]), 'hold:walldemo')
  assert.strictEqual(fillAt(held), false, 'mid-demolition: no fill on the held ground')
  assert.strictEqual(fillAt(W.releaseHold(held)), true, 'after the release: the groundskeeper fills the pit (positive control)')
})
await t('THE HOLD WINS (Claude hold r1 BLOCKERS): a held column a kept wall cell\'s zone also covers is `reserved` (skipped by inwall); the hold is live only while the demolition is open', () => {
  const srv = server()
  const wall = oldWall(srv)
  const ext = extFor(wall, { join: { axis: 'z', line: -12, from: -8, to: 8 } })
  const held = W.retireWall(wall, W.demoCells(wall, ext))
  const zonesNoHold = recordZones([held]).filter(z => z.why !== 'hold:walldemo')
  const avoidBuild = T.tidyAvoid(() => null, zonesNoHold)
  const hold = W.holdAt(held)
  // a held column a kept wall cell's `project:wall` zone also covers (a build's box for BUILD_WHY): the leak `reserved` closes
  const cols = [...new Set(held.retired.map(c => `${c.at[0]},${c.at[2]}`))].map(k => k.split(',').map(Number))
  const shared = cols.filter(([x, z]) => hold(x, z) && String(avoidBuild(x, z) ?? '').startsWith('project:'))
  assert.ok(cols.length && shared.length, `held ${cols.length}, under a build's zone too ${shared.length}`)
  const box = [-11, -12, 11, -9]
  const inBoxN = cols.filter(([x, z]) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3]).length
  const skips = reserved => T.surveyInwall(srv.read, { home: HOME, box, avoid: T.tidyAvoid(() => null, recordZones([held])), reserved, cells: new Set(held.cells.map(c => c.at.join(','))) }).skipped.reserved ?? 0
  assert.ok(skips(hold) >= inBoxN && inBoxN > 0, `every held column in the box skipped (${skips(hold)} of ${inBoxN})`)
  assert.strictEqual(skips(() => false), 0, 'positive control: without the hold as reserved, none is')
  assert.strictEqual(W.wallAsHeld(held, { structure_complete: false }), held)
  const seen = W.wallAsHeld(held, { structure_complete: true })
  assert.ok(!seen.zones.some(z => z.why === 'hold:walldemo') && W.holdAt(seen)(cols[0][0], cols[0][1]) === false, 'complete: no hold, released or not')
})
await t('DEMOLISHED END TO END: two fake builders run the bots\' own visit on the demolition record; every listed block dug, nothing else', async () => {
  const srv = server()
  const wall = oldWall(srv)
  for (const c of wall.cells) srv.set(c.at, c.role === 'light' ? 'wall_torch' : c.role === 'post' ? 'stone_bricks' : 'cobblestone')
  const ext = extFor(wall, { join: { axis: 'z', line: -12, from: -8, to: 8 } })
  const rec = W.demoRecord(srv.read, W.retireWall(wall, W.demoCells(wall, ext)), ext, { home: HOME }).record
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walldemo-'))
  const key = PJ.projKey(HOME, W.WALLDEMO_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const names = ['A', 'B']
  const bots = Object.fromEntries(names.map((n, i) => [n, bot(srv, n, { inv: { cobblestone: 0 }, feet: [i, G + 1, 0] })]))
  const stands = Object.fromEntries(names.map(n => [n, { pending: null, bans: {} }]))
  for (let round = 0; round < 30 && W.demoLeft(rec, srv.read).length; round++) {
    for (const n of names) {
      const slot = PJ.takeSlot(dir, key, n, W.WALLDEMO_BUILDERS)
      await R.runVisit({ dir, key, me: n, home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: W.WALL_PALETTE, slot: slot.slot, slotGen: slot.gen,
        domain: () => true, walkR: W.wallWalkR({ cells: rec.clear }, HOME), foreign: W.WALL_FOREIGN, blockLayer: false, clearMax: W.WALL_CLEAR_MAX, stands: stands[n] }, bots[n], { maxSteps: 400 })
      PJ.releaseLease(dir, key, `slot${slot.slot}`, n, slot.gen)
    }
  }
  assert.strictEqual(W.demoLeft(rec, srv.read).length, 0, `left: ${W.demoLeft(rec, srv.read).slice(0, 4).map(c => c.at).join(' ')}`)
  const listed = new Set(rec.clear.map(c => c.at.join(',')))
  const rows = Object.values(bots).flatMap(b => b.logs).filter(([k]) => k === '_build').map(([, d]) => d)
  assert.ok(rows.filter(d => d.op === 'clear').length >= rec.clear.length)
  for (const d of rows.filter(d => d.op === 'clear')) assert.ok(listed.has(d.cell.join(',')) && d.kind === 'demolish', `outside the list ${d.cell}`)
  assert.ok(!rows.some(d => d.op === 'place'), 'nothing placed')
  const kept = wall.cells.filter(c => !listed.has(c.at.join(',')))
  assert.ok(kept.every(c => srv.read(...c.at).name !== 'air'), 'the rest of the old wall stands')
})
await t('A LATE BLOCK (Codex r2 BLOCKER: a repair placement landing after the retirement) is found, listed and must go; done only after the settle', () => {
  const srv = server()
  const wall = oldWall(srv)
  const ext = extFor(wall, { join: { axis: 'z', line: -12, from: -8, to: 8 } })
  const d = W.demoCells(wall, ext)
  for (const c of wall.cells) srv.set(c.at, c.role === 'light' ? 'wall_torch' : c.role === 'post' ? 'stone_bricks' : 'cobblestone')
  const late = d.cells.find(c => c.role === 'wall')
  srv.set(late.at, 'air')                                                   // the repair's placement is still in flight at the siting
  const retired = { ...W.retireWall(wall, d, { now: 1_000 }) }
  const rec = W.demoRecord(srv.read, retired, ext, { home: HOME }).record
  assert.ok(!rec.clear.some(c => c.at.join(',') === late.at.join(',')), 'not listed: it read air')
  srv.set(late.at, 'cobblestone')                                           // ... and lands
  for (const c of rec.clear) srv.set(c.at, 'air')                           // every listed block dug
  assert.strictEqual(W.demoLeft(rec, srv.read).length, 0, 'positive control: the list alone reads done')
  const miss = W.demoMissing(rec, retired, ext, srv.read)
  assert.deepStrictEqual(miss.map(c => c.at.join(',')), [late.at.join(',')], 'the late block is found')
  assert.strictEqual(W.demoDone(rec, retired, ext, srv.read, 1_000 + W.WALLDEMO_SETTLE_MS), false, 'not done while it stands')
  const rec2 = { ...rec, clear: [...rec.clear, ...miss] }
  srv.set(late.at, 'air')
  assert.strictEqual(W.demoDone(rec2, retired, ext, srv.read, 1_000 + W.WALLDEMO_SETTLE_MS - 1), false, 'not before the settle')
  assert.strictEqual(W.demoDone(rec2, retired, ext, srv.read, 1_000 + W.WALLDEMO_SETTLE_MS), true)
  assert.strictEqual(W.demoMissing(rec2, retired, ext, srv.read).length, 0)
  // Codex r2b BLOCKER: an UNREAD in-scope cell (an unloaded chunk) is never "nothing there"
  const blind = (x, y, z) => (x === late.at[0] && y === late.at[1] && z === late.at[2] ? null : srv.read(x, y, z))
  assert.strictEqual(W.demoDone(rec2, retired, ext, blind, 1_000 + W.WALLDEMO_SETTLE_MS), false, 'unread defers completion')
  assert.strictEqual(W.demoDone({ ...rec2, clear: [] }, retired, ext, () => null, 1_000 + W.WALLDEMO_SETTLE_MS), false, 'nothing read: never done')
})
await t('THE ORDER (wallext-02): after the extension, waiting until it stands; WALLDEMO=off drops it; a light plot', () => {
  const on = SHOP.projectsOn(true, true, true, true, false, true, false, true, true, true, false, false, [], false, true, true, true)
  const i = on.findIndex(p => p.plot === 'walldemo'), e = on.findIndex(p => p.plot === 'wallext')
  assert.ok(i === e + 1 && e >= 0); assert.strictEqual(on[i].after, 'wallext')
  assert.ok(!SHOP.projectsOn(true, true, true, true, false, true, false, true, true, true, false, false, [], false, true, true, false).some(p => p.plot === 'walldemo'))
  assert.ok(!SHOP.projectsOn(true, true, true, true, false, true, false, true, true, true, false, false, [], false, true, false, true).some(p => p.plot === 'walldemo'), 'never without the extension')
  assert.ok(SHOP.LIGHT_PLOTS.has('walldemo'))
  // Codex hold r2 BLOCKER: read whatever its switch (a complete demolition always lifts its hold)
  assert.ok(SHOP.projectsGuarded(SHOP.projectsOn(true, true, true, true, false, true, false, true, true, true, false, false, [], false, true, true, false)).some(p => p.plot === 'walldemo'), 'guarded when WALLDEMO=off')
})
await t('MUTANT KILLED: a demolition reaching past the span\'s ends (>= instead of >) takes a corner', async () => {
  const srv = server()
  const wall = oldWall(srv)
  const ext = extFor(wall, { join: { axis: 'z', line: -12, from: -8, to: 8 } })
  // a corner column built on the fake ring's line at x 8 (the span's end) when there is one
  const endBuilt = wall.cols.some(c => c.z === -12 && (c.x === -8 || c.x === 8) && (c.s === 'wall' || c.s === 'post'))
  const ext2 = endBuilt ? ext : extFor(wall, { join: { axis: 'z', line: -12, from: wall.cols.find(c => c.z === -12 && c.s === 'wall').x, to: 11 } })
  await withMutant('a > L.from && a < L.to', 'a >= L.from && a <= L.to', async M => {
    const j = ext2.join
    const real = W.demoCells(wall, ext2).cells, mut = M.demoCells(wall, ext2).cells
    assert.ok(!real.some(c => c.at[0] === j.from || c.at[0] === j.to))
    assert.ok(mut.some(c => c.at[0] === j.from || c.at[0] === j.to), 'the mutant takes an end column')
  })
})
await t('MUTANT KILLED: a retirement without the hold leaves the line\'s ground open mid-demolition', async () => {
  const srv = server()
  const wall = oldWall(srv)
  const ext = extFor(wall, { join: { axis: 'z', line: -12, from: -8, to: 8 } })
  const d = W.demoCells(wall, ext)
  await withMutant('const zones = [...demoHoldZones(retired), ...zoneBoxes(zset)]', 'const zones = [...zoneBoxes(zset)]', async M => {
    const r = M.retireWall(wall, d)
    assert.ok(!r.zones.some(q => q.why === 'hold:walldemo') && !M.holdAt(r)(d.cells[0].at[0], d.cells[0].at[2]), 'the mutant holds nothing')
  })
})
await t('MUTANT KILLED: a demolition deeper than WALLDEMO_DEPTH, and one taking a foundation', async () => {
  const wall = { cols: [{ x: 0, z: -12, s: 'wall' }], cells: [{ at: [0, G, -12], role: 'base', seg: 'W-00' }, { at: [0, G + 1, -12], role: 'wall', seg: 'W-00' }, { at: [0, G + 1, -8], role: 'step', seg: 'W-00' }] }
  const ext = { side: 'N', join: { axis: 'z', line: -12, from: -5, to: 5 }, structure_complete: true }
  assert.deepStrictEqual(W.demoCells(wall, ext).cells.map(c => c.role), ['wall'])
  await withMutant("c.role !== 'base' && lineCols.has(along(c.at))", 'lineCols.has(along(c.at))', async M => { assert.ok(M.demoCells(wall, ext).cells.some(c => c.role === 'base')) })
  await withMutant('return d >= 0 && d <= depth', 'return d >= 0', async M => { assert.ok(M.demoCells(wall, ext).cells.some(c => c.role === 'step')) })
})

// ---- the wiring (structural: a dispatch, an argument, an input -- what behaviour cannot reach from here), comments stripped ----
const SK = new URL('../src/skills.mjs', import.meta.url)
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
const SRC = strip(readFileSync(SK, 'utf8'))
const WIRES = [
  ['the visit dispatches the extension to the wall visit with its kind', "if (proj.plot === WALLEXT_PLOT) return buildWall(ctx, args, signal, WALLEXT_KIND)"],
  ['the extension is sited by siteWallExt with its inputs and a pause', "site: async (bot, c, h, dir, signal) => siteWallExt(planReader(bot), { ...wallextInputs(bot, c, h, dir), pause:"],
  ['the wall visit sites through its kind', "try { s = await K.site(bot, c, h, dir, signal) }"],
  ['the land plan\'s reservation carries the extension\'s plots', "head: { rec: landReservation(land, ext) }"],
  ['the tidy\'s inputs carry the extension', "wallext: others.find(r => r.plot === WALLEXT_PLOT) ?? null, reserved }"],
  ['the stage\'s terrace inputs carry the extension', "const terrace = { records: I.records, wall: I.wall, wallext: I.wallext,"],
  ['the order waits on the opening rule', "if (p.plot === WALLEXT_PLOT && !rec && !wallextOpenNow(dir)) return {"],
  ['the extension\'s sapling keep-out is the wall\'s', "r.blueprint === WALL_BLUEPRINT || r.blueprint === WALLEXT_BLUEPRINT ? wallSaplingCols(r) :"],
  ['r3: the extension reads the ziggurat whatever MONUMENT says (Codex r3)', "const M = extWithMonument(heads.map("],
  ['the old wall never encloses the extension', "x.plot !== WALL_PLOT && x.plot !== WALLEXT_PLOT).map(x => ({ plot: x.plot, rec: x.head.rec }))"],
  ['wallext-02: the visit dispatches the demolition', "if (proj.plot === WALLDEMO_PLOT) return buildWallDemo(ctx, args, signal)"],
  ['wallext-02: the wall is retired BEFORE the demolition is sited', "const pubW = publishRecord(dir, projKeyOf(WALL_PLOT), cur => (cur && cur.structure_complete ? retireWall(cur, demoCells(cur, ext)) : null), { by: me })"],
  ['wallext-02: the demolition is complete only when done (nothing listed or late stands, the retirement settled)', "if (demoDone(rec, wNow.head.rec, xNow.head.rec, read)) {"],
  ['wallext-02: every head reader sees the wall without the hold once the demolition is complete', "if (w && dm?.head?.rec?.structure_complete) w.head = { ...w.head, rec: wallAsHeld(w.head.rec, dm.head.rec) }"],
  ['wallext-02: the hold is the tidy\'s `reserved` (read first)', "const reserved = (x, z) => held(x, z) || rz.some("],
  ['wallext-02: the hold is released only once the demolition is complete', "if (pub.result === 'accepted' || pub.result === 'nothing') release()"],
  ['wallext-02: a visit to a complete demolition tidies up the release (cleanup: the hold is already off in projectHeads)', "if (rec.structure_complete) { release(); return out('no_effect', 'complete', 'the old line is down') }"],
  ['wallext-02: a late block on a retired cell is appended before the visit', "const late = demoMissing(rec, wNow.head.rec, xNow.head.rec, read)"],
  ['wallext-02: the order waits on the demolition\'s opening rule', "if (p.plot === WALLDEMO_PLOT && !rec && !walldemoOpenNow(dir)) return {"],
]
await t('THE WIRING in skills.mjs: each line present once (executable, comments stripped)', () => {
  for (const [what, line] of WIRES) assert.strictEqual(SRC.split(line).length - 1, 1, `${what}: ${line}`)
})
await t('THE WIRING CHECK FAILS for the intended reason: each line, mutated, is no longer found (the anchor itself present and unique)', () => {
  const raw = readFileSync(SK, 'utf8')
  for (const [what, line] of WIRES) {
    assert.strictEqual(raw.split(line).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE: ${what}`)
    const mut = strip(raw.replace(line, line.replace(/WALLEXT|wallext|ext\)|siteWallExt|K\.site|WALLDEMO|retireWall|demoLeft|demoDone|demoMissing|release\(\)|wallAsHeld|held\(x, z\)|extWithMonument/, 'XX')))
    assert.strictEqual(mut.split(line).length - 1, 0, `the mutant of "${what}" still matches`)
  }
})

// ---- mutants of the module's decisions (anchored: present and unique) ----
async function withMutant (old, neu, fn) {
  const src = readFileSync(WP, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
await t('MUTANT KILLED: a join that does not hold (the old line built) is caught', async () => {
  await withMutant("if (jw) { c.s = 'join'; c.why = String(jw); continue }", 'if (jw) { }', async M => {
    const j = M.wallCandidate(server().read, [-6, -6, 6, 6], 6, { home: HOME, join: (x, z) => (z === -12 ? 'join' : null) })
    assert.ok(j.cells.some(c => c.at[2] === -12), 'the mutant builds on the joined line')
  })
})
await t('MUTANT KILLED: the old wall\'s columns not refused -> an extension cell on an old wall column', async () => {
  // a hall right against the old ring: the extension's sides start beside the old wall's own cells
  const srv = server()
  const wall = oldWall(srv)
  // the mutant keeps the old wall's zones in pzones AND drops the column refusal: the real one never lands on an old column
  await withMutant("const avoid = (x, z) => (oldCols.has(k2(x, z)) ? 'old_wall' : avoid0(x, z))", 'const avoid = avoid0', async M => {
    const fake = { ...wall, cells: [...wall.cells, { at: [-12, G + 1, -18], role: 'wall', seg: 'W-99' }, { at: [12, G + 1, -18], role: 'wall', seg: 'W-99' }] }
    const real = await W.siteWallExt(srv.read, { wall: fake, hub: HUB, plan: PLAN(), pzones: recordZones([HUB]), W: WT })
    const mut = await M.siteWallExt(srv.read, { wall: fake, hub: HUB, plan: PLAN(), pzones: recordZones([HUB]), W: WT })
    const on = r => r.record.cells.some(c => (c.at[0] === -12 || c.at[0] === 12) && c.at[2] === -18)
    assert.ok(real.ok && !on(real), 'the real siting never builds on an old wall column')
    assert.ok(mut.ok && on(mut), 'the mutant does')
  })
})
await t('MUTANT KILLED: other records\' cells not refused (records: []) -> an extension cell on a tidy fill\'s column', async () => {
  const srv = server()
  const wall = oldWall(srv)
  const c0 = (await siteExt(srv, wall)).record.cells.find(c => c.role === 'wall')
  const tidy = { plot: 'tidy', blueprint: 'tidy@1', zones: [], cells: [{ at: [c0.at[0], G, c0.at[2]], role: 'fill', seg: 'T-0' }] }
  await withMutant('const avoid0 = pathAvoid({ plan, zones, caps, plinth, composter, farm, records: others, home })', 'const avoid0 = pathAvoid({ plan, zones, caps, plinth, composter, farm, records: [], home })', async M => {
    const m = await M.siteWallExt(srv.read, { wall, hub: HUB, plan: PLAN(), records: [tidy], pzones: recordZones([HUB, wall]), W: WT })
    assert.ok(m.record.cells.some(c => c.at[0] === c0.at[0] && c.at[2] === c0.at[2]), 'the mutant builds on the fill\'s column')
  })
})
await t('MUTANT KILLED: a float read as ground (extColumn returns the first solid) is caught', async () => {
  await withMutant("if (!FLOAT_SPOIL.test(c.name) || !air(b1) || !air(b2)) return", 'if (true) return', async M => {
    const srv = server({ [`3,${G + 7},3`]: 'dirt' })
    assert.strictEqual(M.extColumn(srv.read, 3, 3, { yHi: G + 14, yLo: G - 14 }).y, G + 7)
  })
})
await t('MUTANT KILLED: plots without the gap check overlap', async () => {
  await withMutant('if (clash(b)) continue', '', async M => {
    const p = M.wallExtPlots(server().read, [-25, -55, 25, -20], { home: HOME, want: 4 })
    const ov = p.some((a, i) => p.some((b, j) => j > i && !(a.box[2] + 3 < b.box[0] || b.box[2] + 3 < a.box[0] || a.box[3] + 3 < b.box[1] || b.box[3] + 3 < a.box[1])))
    assert.ok(ov, 'the mutant packs plots closer than plotGap')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
