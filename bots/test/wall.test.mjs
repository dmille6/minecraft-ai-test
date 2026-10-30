// WALL-01: THE TOWN WALL (bots/src/wall.mjs), pure and on the fake server: the switch; the ring and the enclosure (a ziggurat and its
// road stay outside); the cross-section (wall b+3, merlons, the walk b+2, the fire-step b+1) following the ground; Q7's sally ports
// (no solid run past 12, 2 wide); a GATEWAY where a path crosses, flanked by posts with lights; water and a protected zone are gaps;
// a trunk in the line felled whole; the ESCAPE PROOF (a ring with no openings cuts the outside off -- the positive control -- and the
// sited ring cuts nothing); and the record BUILT END TO END by buildrun.mjs runVisit with fake builders, every cell from a stand
// the builders' own rule allows (stepFor: the eye above a top face), the shop read's view of its rows.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { R, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const W = await import('../src/wall.mjs')
const { recordZones } = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const PLAN = (extra = {}) => ({ home: HOME, gen: 4, plots: [{ id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], keepout: true }], paths: [], ...extra })
const site = (srv, o = {}) => W.siteWall(srv.read, { plan: PLAN(o.plan), ...o, plan: PLAN(o.plan ?? {}) })
const colAt = (rec, x, z) => rec.cols.find(c => c.x === x && c.z === z)
const cellsAt = (rec, x, z) => rec.cells.filter(c => c.at[0] === x && c.at[2] === z).sort((a, b) => a.at[1] - b.at[1])

await t('the switch: on in the showcase pool by default, off in a fleet pool, WALL=on|off wins', () => {
  assert.strictEqual(W.wallOn({}, 'showcase'), true)
  assert.strictEqual(W.wallOn({}, 'hive-a'), false)
  assert.strictEqual(W.wallOn({ WALL: 'on' }, 'hive-a'), true)
  assert.strictEqual(W.wallOn({ WALL: 'off' }, 'showcase'), false)
})
await t('the ring: a closed loop of 4-adjacent columns round the box at the margin, corners carrying both normals', () => {
  const L = W.ringLoop([-6, -6, 6, 6], 6)
  assert.strictEqual(L.length, 4 * 24)
  for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; assert.strictEqual(Math.abs(a.x - b.x) + Math.abs(a.z - b.z), 1) }
  assert.deepStrictEqual(L[0].out.length, 2)
  assert.deepStrictEqual(W.terraceAt(L[3], 1), [L[3].x, L[3].z + 1], 'the walk is one in')
  assert.deepStrictEqual(W.terraceAt(L[0], 2), [L[0].x + 2, L[0].z + 2], 'a corner\'s terrace is the inner corner')
})
await t('the enclosure: the plan and every project, but NOT a ziggurat nor the path leg that leads to it', () => {
  const recs = [
    { plot: 'shop', rec: { blueprint: 'workshop@1', cells: [{ at: [20, 70, 20] }] } },
    { plot: 'monument', rec: { blueprint: 'ziggurat@1', cells: [{ at: [-40, 70, -40] }] } },
    { plot: 'paths', rec: { blueprint: 'paths@1', legs: [{ id: 'monument', to: 'monument' }, { id: 'shop', to: 'shop' }], cells: [{ at: [-30, 69, -30], seg: 'P-monument-0' }, { at: [10, 69, 15], seg: 'P-shop-1' }] } },
  ]
  assert.deepStrictEqual(W.wallInside({ plan: PLAN(), records: recs, zig: r => /^ziggurat@/.test(r.blueprint) }), [-6, -6, 20, 20])
})
await t('FLAT GROUND: the cross-section -- wall to b+3 with merlons, walk to b+2, fire-step to b+1; no run past Q7\'s 12; escape clean', () => {
  const s = site(server())
  assert.ok(s.ok, s.why)
  const r = s.record
  assert.strictEqual(r.margin, W.WALL.margin)
  assert.deepStrictEqual(r.ring, [-12, -12, 12, 12])
  // a north-side column mid-run: O at z -12, the walk at -11, the fire-step at -10; b = G (flat)
  const run = r.cols.filter(c => c.s === 'wall' && c.z === -12)
  const solid = x => ['wall', 'post'].includes(colAt(r, x, -12)?.s)
  const mid = run.find(c => [-2, -1, 0, 1, 2].every(d => solid(c.x + d)) && cellsAt(r, c.x, -10).length)
  assert.ok(mid, 'a column with two wall columns either side and its fire-step')
  // the terrace flares at an opening: no fire-step within 2 of an opening, no walk within 1
  for (const c of r.cols.filter(q => q.s === 'open' && q.z === -12 && q.x > -10 && q.x < 10)) {
    assert.strictEqual(cellsAt(r, c.x, -11).length, 0); assert.strictEqual(cellsAt(r, c.x, -10).length, 0)
  }
  const o = cellsAt(r, mid.x, -12)
  assert.strictEqual(o[0].at[1], G + 1)
  assert.ok(o.at(-1).at[1] === G + 3 || o.at(-1).at[1] === G + 4, 'body b+3, a merlon b+4')
  assert.strictEqual(cellsAt(r, mid.x, -11).at(-1).at[1], G + 2, 'the walk b+2')
  assert.strictEqual(cellsAt(r, mid.x, -10).at(-1).at[1], G + 1, 'the fire-step b+1')
  assert.ok(r.cells.every(c => c.role !== 'base'), 'grass needs no foundation')
  // merlons alternate
  const tops = run.map(c => cellsAt(r, c.x, c.z).at(-1).at[1])
  assert.ok(tops.some(y => y === G + 4) && tops.some(y => y === G + 3))
  // Q7: no run of solid columns longer than 12 round the loop; every opening 2 wide
  let cur = 0, worst = 0
  for (const c of [...r.cols, ...r.cols]) { if (c.s === 'wall' || c.s === 'post') { cur++; worst = Math.max(worst, cur) } else cur = 0 }
  assert.ok(worst <= W.WALL.runMax, `a run of ${worst}`)
  assert.ok(r.ports >= 4)
  assert.strictEqual(r.escape.cut, 0)
  assert.ok(r.zones.length && r.zones.every(z => z.why === 'project:wall'))
  assert.deepStrictEqual(Object.keys(r.bom), ['cobblestone'])
})
await t('THE ESCAPE PROOF: the same cells with every opening shut cut the outside off (positive control); the sited ring does not', () => {
  const srv = server()
  const r = site(srv).record
  // shut it: fill every non-wall ring column with the wall's own section (b+3) -- a closed rampart; one way out over it, a drop of 3
  const shut = [...r.cells]
  for (const c of r.cols.filter(q => q.s !== 'wall' && q.s !== 'post')) for (let y = G + 1; y <= G + 3; y++) shut.push({ at: [c.x, y, c.z], role: 'wall', seg: 'x' })
  const closed = W.wallEscape(srv.read, HOME, shut, { r: 20 })
  // over the closed rampart a bot still gets OUT (fire-step, walk, crenel, a drop of 3) -- so nothing is cut off -- but never back:
  // the whole outside is a pen
  assert.ok(closed.trapped > 100, `the closed ring pens the outside (${closed.trapped})`)
  const open = W.wallEscape(srv.read, HOME, r.cells, { r: 20 })
  assert.strictEqual(open.cut, 0); assert.strictEqual(open.trapped, 0)
  // and with no terrace either (a bare closed wall): the outside is CUT off
  const bare = shut.filter(c => c.role !== 'step')
  assert.ok(W.wallEscape(srv.read, HOME, bare, { r: 20 }).cut > 100)
  // and siteWall refuses a ring that would cut: a world where a cliff makes every opening a dead end is not built here; the
  // refusal path is the same number (siteWall skips any margin with cut > 0) -- checked through the tried list
  assert.ok(site(srv).tried.every(q => q.cut === 0 && q.trapped === 0))
})
await t('A GATEWAY where a path crosses: 4 wide (the path + 1 each side), flanked by stone-brick posts with a torch each when spared', () => {
  const srv = server()
  const pathCols = []
  for (let z = -16; z <= -7; z++) for (const x of [0, 1]) pathCols.push([x, G, z])
  const paths = { blueprint: 'paths@1', plot: 'paths', legs: [], cells: pathCols.map(at => ({ at, role: 'path', seg: 'P-g-0' })), zones: [{ box: [-1, -64, -17, 2, 320, -6], why: 'project:paths' }] }
  const s = site(srv, { records: [], pzones: recordZones([paths]), lights: 4 })
  assert.ok(s.ok, s.why)
  const r = s.record
  const g = r.gates.find(q => q.why === 'path')
  assert.ok(g, JSON.stringify(r.gates))
  assert.deepStrictEqual(g.cols.map(c => c[0]).sort((a, b) => a - b), [-1, 0, 1, 2])
  for (const x of [-2, 3]) {
    assert.strictEqual(colAt(r, x, -12).s, 'post')
    const cs = cellsAt(r, x, -12)
    assert.strictEqual(cs.at(-1).at[1], G + 4)
    assert.ok(cs.filter(c => c.at[1] >= G + 1).every(c => c.role === 'post'))
  }
  const lights = r.cells.filter(c => c.role === 'light')
  assert.strictEqual(lights.length, 2)
  assert.ok(lights.every(c => c.at[1] === G + 4 && c.at[2] === -11), 'on the post\'s inner face at the walk\'s head height')
  assert.strictEqual(r.bom.stone_bricks, 8)
  // no torch spared: no lights
  assert.strictEqual(site(srv, { pzones: recordZones([paths]), lights: 0 }).record.cells.filter(c => c.role === 'light').length, 0)
})
await t('WATER is a gap (never a bridge); a PROTECTED ZONE is a gap; a trunk in the line is felled whole; sand gets a foundation', () => {
  const cells = {}
  for (let x = 2; x <= 3; x++) cells[`${x},${G},-12`] = 'water'
  cells[`9,${G},-12`] = 'sand'
  const srv = server(cells)
  const zones = [{ id: 'v', box: [-12, -64, 5, -12, 320, 8] }]
  const r0 = site(srv, { zones }).record
  assert.strictEqual(r0.margin, W.WALL.margin)
  assert.strictEqual(colAt(r0, 2, -12).s, 'gap'); assert.strictEqual(colAt(r0, 2, -12).why, 'water')
  assert.ok(!r0.cells.some(c => c.at[0] >= 2 && c.at[0] <= 3 && c.at[2] === -12), 'nothing over the water')
  assert.ok([5, 6, 7, 8].every(z => colAt(r0, -12, z).s === 'gap' && colAt(r0, -12, z).why === 'zone'))
  if (colAt(r0, 9, -12).s === 'wall' || colAt(r0, 9, -12).s === 'post') assert.ok(r0.cells.some(c => c.role === 'base' && c.at.join(',') === `9,${G},-12`))
  const tcells = {}
  for (let y = G + 1; y <= G + 7; y++) tcells[`-4,${y},12`] = 'spruce_log'
  tcells[`-3,${G + 7},12`] = 'spruce_log'                                    // a branch: connected, felled with it
  const r = site(server(tcells)).record
  assert.strictEqual(colAt(r, -4, 12).s, 'wall')
  const logs = r.clear.filter(c => c.kind === 'tree').map(c => c.at.join(','))
  assert.ok(logs.includes(`-4,${G + 7},12`) && logs.includes(`-3,${G + 7},12`) && logs.includes(`-4,${G + 1},12`), 'the whole trunk and its branch')
  assert.strictEqual(r.felled.trunks, 1)
})
await t('THE GROUND STEPS: on a slope the base follows it (each step at most 1 along a run) and a column never stands taller than TALL_MAX', () => {
  const cells = {}
  // the east side rises 1 per 2 columns of z (a hill under the line)
  for (let z = -12; z <= 12; z++) for (let x = 10; x <= 14; x++) { const h = Math.max(0, Math.floor((z + 12) / 3)); for (let y = G + 1; y <= G + h; y++) cells[`${x},${y},${z}`] = 'dirt'; if (h) cells[`${x},${G + h},${z}`] = 'grass_block' }
  const r = site(server(cells)).record
  const east = r.cols.filter(c => c.x === 12 && (c.s === 'wall' || c.s === 'post')).sort((a, b) => a.z - b.z)
  assert.ok(east.length > 6)
  for (let i = 1; i < east.length; i++) if (east[i].z === east[i - 1].z + 1) assert.ok(Math.abs(east[i].b - east[i - 1].b) <= 1)
  for (const c of east) assert.ok(cellsAt(r, c.x, c.z).length <= W.WALL.tallMax + 1)
})
await t('BUILT END TO END: two fake builders run the bots\' own visit to `complete`; every placement and clear on the record', async () => {
  const cells = {}
  for (let y = G + 1; y <= G + 6; y++) cells[`-4,${y},12`] = 'oak_log'
  for (const [x, z] of [[-5, 12], [-3, 12], [-4, 11], [-4, 13]]) cells[`${x},${G + 5},${z}`] = 'oak_leaves'
  const srv = server(cells)
  const pathCols = []
  for (let z = -16; z <= -7; z++) for (const x of [0, 1]) pathCols.push([x, G, z])
  const paths = { blueprint: 'paths@1', plot: 'paths', cells: pathCols.map(at => ({ at, role: 'path', seg: 'P-g-0' })), zones: [{ box: [-1, -64, -17, 2, 320, -6], why: 'project:paths' }] }
  const rec = site(srv, { pzones: recordZones([paths]), lights: 4 }).record
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-'))
  const key = PJ.projKey(HOME, W.WALL_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const names = ['A', 'B']
  const bots = Object.fromEntries(names.map((n, i) => [n, bot(srv, n, { inv: { cobblestone: 2000, stone_bricks: 16, torch: 4 }, feet: [i, G + 1, 0] })]))
  const stands = Object.fromEntries(names.map(n => [n, { pending: null, bans: {} }]))
  const stops = {}
  const done = () => rec.cells.every(c => R.cellDone(srv.read(...c.at), W.WALL_PALETTE, c.role))
  for (let round = 0; round < 40 && !done(); round++) {
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
  assert.ok(!stops.stuck_on_cell && !stops.blocked, JSON.stringify(stops))
  // the shop read's G1/G2: every placement a record cell, every clear on the record's list (a foreign dig on a record cell)
  const recKeys = new Set(rec.cells.map(c => c.at.join(','))), clearKeys = new Set(rec.clear.map(c => c.at.join(',')))
  const rows = Object.values(bots).flatMap(b => b.logs).filter(([k]) => k === '_build').map(([, d]) => d)
  assert.ok(rows.filter(d => d.op === 'place').length >= rec.cells.length - 1)
  for (const d of rows.filter(d => d.op === 'place')) assert.ok(recKeys.has(d.cell.join(',')), `off_record ${d.cell}`)
  for (const d of rows.filter(d => d.op === 'clear')) assert.ok(d.kind === 'foreign' ? recKeys.has(d.cell.join(',')) : clearKeys.has(d.cell.join(',')), `clear_outside ${d.cell} ${d.kind}`)
  for (const d of rows.filter(d => d.op === 'clear' && d.kind === 'tree')) assert.strictEqual(d.saplings, '0/0', 'G5: no replant owed, judged')
  assert.ok(rows.some(d => d.op === 'clear' && d.kind === 'tree'), 'the oak in the line felled')
  // the finished world: nothing reachable from home is cut off
  const after = W.wallEscape(srv.read, HOME, [], { r: 20 })
  assert.ok(after.reach0 > 1000)
})

await t('THE REACH PROOF: a cell no walked stand reaches (eye above its support) fails its O column; one in reach does not', () => {
  const srv = server()
  const loop = W.ringLoop([-6, -6, 6, 6], 6)
  const i = loop.findIndex(c => c.x === 0 && c.z === -12)
  const B = (y, at = [0, y, -12]) => ({ cells: [{ at, role: 'wall', seg: 'W-00' }], clear: [], runs: [[i]] })
  assert.deepStrictEqual(W.wallReach(srv.read, HOME, B(G + 2), loop), [], 'the second course: a ground eye is above its support')
  assert.deepStrictEqual(W.wallReach(srv.read, HOME, B(G + 3), loop), [i], 'the third course alone: no ground eye is above b+3 (the walk is what reaches it)')
  assert.deepStrictEqual(W.wallReach(srv.read, HOME, B(G + 6, [0, G + 6, -10]), loop), [i], 'a terrace cell fails the O columns of its run near it')
  // with the walk built behind it (b+2 at z -11, a fire-step b+1 at -10): the third course and the merlon are reached
  const withWalk = { cells: [...[1, 2, 3, 4].map(d => ({ at: [0, G + d, -12], role: 'wall', seg: 'W-00' })), ...[1, 2].map(d => ({ at: [0, G + d, -11], role: 'step', seg: 'W-00' })), { at: [0, G + 1, -10], role: 'step', seg: 'W-00' }], clear: [], runs: [[i]] }
  assert.deepStrictEqual(W.wallReach(srv.read, HOME, withWalk, loop), [])
})
await t('A BLOCKED SEGMENT WAITS: a visit stopped `blocked` on W-00 (a chest in a wall cell) works W-01 next time; never all left out', async () => {
  const srv = server({ [`-3,${G + 1},-12`]: 'chest' })
  const cells = [-3, -2, -1].map(x => ({ at: [x, G + 1, -12], role: 'wall', seg: 'W-00' })).concat([5, 6, 7].map(x => ({ at: [x, G + 1, -12], role: 'wall', seg: 'W-01' })))
  const rec = { v: 1, blueprint: W.WALL_BLUEPRINT, plot: 'wall', cells, clear: [], replant: [], segments: [{ seg: 'W-00', deps: [] }, { seg: 'W-01', deps: [] }] }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-b-'))
  const key = PJ.projKey(HOME, W.WALL_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const b = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [0, G + 1, -8] })
  const blocked = new Map()
  const visit = async () => {
    const slot = PJ.takeSlot(dir, key, 'A', 4)
    const v = await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: W.wallVisitRecord(rec, blocked), recordGen: pub.gen, palette: W.WALL_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 30, foreign: W.WALL_FOREIGN, blockLayer: false, stands: { pending: null, bans: {} } }, b, { maxSteps: 200 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, 'A', slot.gen)
    const bs = W.blockedSeg(v.stop, v.why); if (bs) blocked.set(bs, Date.now())
    return v
  }
  const v1 = await visit()
  assert.strictEqual(v1.stop, 'blocked'); assert.strictEqual(W.blockedSeg(v1.stop, v1.why), 'W-00')
  await visit()
  assert.ok([5, 6, 7].every(x => srv.read(x, G + 1, -12).name === 'cobblestone'), 'W-01 built on the next visit')
  assert.strictEqual(W.wallVisitRecord(rec, new Map([['W-00', Date.now()], ['W-01', Date.now()]])), rec, 'never every segment left out')
  assert.strictEqual(W.wallVisitRecord(rec, new Map([['W-00', Date.now() - W.WALL_BLOCK_MS - 1]])), rec, 'the wait lapses')
  assert.strictEqual(W.blockedSeg('deps_open', 'W-00: 1 open, 0 placeable now'), null)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
