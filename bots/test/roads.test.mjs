// ROADS-01 (bots/src/roads.mjs; sinks.mjs siteSink's road2 hand-off, appendInstance's zones and front, sinkNextGate's max, proveBuild's
// floors; towndress.mjs LAMPS2 lantern posts; skills.mjs wiring). Behaviour over a fake world: the traffic file's routes, the switch,
// the router and the cells on flat ground, on a slope (slab half steps: no walking step over half a block), at a lake (the road stops
// short and ends), beside another record's cells (never on them), the lamps, the kit's count, the dress's lantern posts. Anchored
// mutants (each anchor present and unique) for the rules the tests lean on; STRUCTURAL source assertions only for the skills.mjs
// wiring (comments stripped, executable lines).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const RD = await import('../src/roads.mjs')
const S = await import('../src/sinks.mjs')
const TD = await import('../src/towndress.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const ROADS_PATH = new URL('../src/roads.mjs', import.meta.url)
const DRESS_PATH = new URL('../src/towndress.mjs', import.meta.url)
/** A mutant of a module, its anchor present and unique (CLAUDE.md), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---- the fake world ------------------------------------------------------------------------------------------------------------------
const AIR = Object.freeze({ name: 'air', boundingBox: 'empty' })
const WATER = Object.freeze({ name: 'water', boundingBox: 'empty' })
/** A world of columns: ground(x, z) -> y (grass on dirt), `lake(x, z)` -> a water column (water from ground+1 to `wl`), `extra` a Map
 *  "x,y,z" -> block (placed cells win). */
function world ({ ground = () => 64, lake = () => false, wl = 64, extra = new Map() } = {}) {
  return (x, y, z) => {
    const e = extra.get(`${x},${y},${z}`)
    if (e) return e
    if (Math.abs(x) > 200 || Math.abs(z) > 200) return null
    const g = lake(x, z) ? wl - 2 : ground(x, z)
    if (y < g) return { name: 'dirt', boundingBox: 'block' }
    if (y === g) return { name: lake(x, z) ? 'dirt' : 'grass_block', boundingBox: 'block' }
    if (lake(x, z) && y <= wl) return WATER
    return AIR
  }
}
const HOME = { x: 0, y: 64, z: 0 }
const RING = [-12, -12, 12, 12]
const route = (over = {}) => ({ id: 'east', to: 'village', kind: 'village', trips: 900, median_s: 20, start: [13, 0], line: [[13, 0], [30, 0], [50, 0], [70, 0]], box: [70, -8, 86, 8], ...over })
/** Site instances of one route in rounds, each laid into the world before the next (the road behind is built). */
function siteAll (read0, { routes = [route()], own = () => false, guard = () => null, max = 10 } = {}) {
  const extra = new Map()
  const read = (x, y, z) => extra.get(`${x},${y},${z}`) ?? read0(x, y, z)
  let rec = null
  const out = []
  for (let i = 0; i < max; i++) {
    const n = S.instancesOf(rec).length + 1
    const r = S.siteSink(read, { kind: 'road', n, id: `R${n}`, home: HOME, pool: 'test', avail: { stone_bricks: 2000, cobbled_deepslate: 2000 }, guard, rec, stood: [], roads2: { routes, ring: RING, townBoxes: [RING], landOk: () => true, own, lamp: true } })
    if (!r.ok) { out.push({ fail: r }); break }
    rec = S.completeInstance(S.appendInstance(rec, { kind: 'road', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: Date.now() } }))
    for (const c of r.inst.clear) extra.set(c.at.join(','), AIR)
    for (const c of r.inst.cells) { const name = r.inst.palette[c.role].find(q => q !== '*solid'); extra.set(c.at.join(','), { name, boundingBox: /lantern|torch/.test(name) ? 'empty' : 'block', ...(c.ws ? { props: c.ws } : {}) }) }
    out.push(r)
  }
  return { rec, out, read }
}
/** The walking height (half blocks) of every paved surface column of a record -> Map "x,z" -> h. */
function walkHeights (rec) {
  const m = new Map()
  for (const c of rec.cells) {
    if (!/-(tr|acc|ed|sl)$/.test(c.role)) continue
    m.set(`${c.at[0]},${c.at[2]}`, 2 * c.at[1] + (/-sl$/.test(c.role) ? 1 : 2))
  }
  return m
}
/** The largest walking step between two 4-neighbouring paved columns, in half blocks. */
function maxStep (rec) {
  const m = walkHeights(rec)
  let worst = 0
  for (const [k, h] of m) { const [x, z] = k.split(',').map(Number); for (const [dx, dz] of [[1, 0], [0, 1]]) { const o = m.get(`${x + dx},${z + dz}`); if (o != null) worst = Math.max(worst, Math.abs(o - h)) } }
  return worst
}

console.log('roads-01: traffic routes, the router, the cells, the lamps, the dress lantern posts')

await t('trafficRoutes: v1 only, fresh only (ROADS.staleMs), most trips first, malformed routes dropped', () => {
  const now = Date.parse('2026-11-09T12:00:00Z')
  const f = { v: 1, at: '2026-11-09T06:00:00Z', ring: RING, routes: [route({ id: 'b', trips: 10 }), route({ id: 'a', trips: 50 }), { id: 'bad', start: [1], line: [] }] }
  const r = RD.trafficRoutes(f, now)
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.routes.map(q => q.id), ['a', 'b'])
  assert.strictEqual(RD.trafficRoutes({ ...f, at: '2026-10-20T00:00:00Z' }, now).why, 'stale')
  assert.strictEqual(RD.trafficRoutes({ ...f, v: 2 }, now).why, 'no_file')
  assert.strictEqual(RD.trafficRoutes({ ...f, routes: [] }, now).why, 'no_routes')
})

await t('the switches: ROADS2 / LAMPS2 on in the showcase pool by default, off elsewhere, forced either way', () => {
  assert.strictEqual(RD.roadsOn({}, 'showcase'), true)
  assert.strictEqual(RD.roadsOn({}, 'hive-a'), false)
  assert.strictEqual(RD.roadsOn({ ROADS2: 'off' }, 'showcase'), false)
  assert.strictEqual(RD.roadsOn({ ROADS2_POOLS: 'hive-a,hive-b' }, 'hive-b'), true)
  assert.strictEqual(RD.lampsOn({}, 'showcase'), true)
  assert.strictEqual(RD.lampsOn({ LAMPS2: '0' }, 'showcase'), false)
})

await t('flat ground: the road runs out of the ring to the destination, 5 paved columns, kerbs, lamps every 12 rows (proven placeable), chained segments, node zones', () => {
  const { rec, out } = siteAll(world())
  const ok = out.filter(r => r.ok)
  assert.ok(ok.length >= 3, `instances ${ok.length}: ${JSON.stringify(out.at(-1)?.fail ?? {})}`)
  assert.strictEqual(ok.at(-1).meta.ended, 'arrived')
  // flat: every surface cell at the ground's level (a flush road, never raised), no slab
  const surf = rec.cells.filter(c => /-(tr|acc|ed|sl)$/.test(c.role))
  assert.ok(surf.every(c => c.at[1] === 64), 'flat road at the ground level')
  assert.ok(!surf.some(c => /-sl$/.test(c.role)), 'no slab on flat ground')
  // never inside the town ring
  assert.ok(rec.cells.every(c => !(c.at[0] >= RING[0] && c.at[0] <= RING[2] && c.at[2] >= RING[1] && c.at[2] <= RING[3])), 'a road cell inside the ring')
  // 5 paved columns a row along z for a straight x road at x = 30
  const row = surf.filter(c => c.at[0] === 30).map(c => c.at[2]).sort((a, b) => a - b)
  assert.deepStrictEqual(row, [-2, -1, 0, 1, 2])
  const kerb = surf.filter(c => c.at[0] === 30 && Math.abs(c.at[2]) === 2)
  assert.ok(kerb.every(c => /-ed$/.test(c.role)), 'the outer columns are the kerb')
  // lamps: log (axis y) + fence + lantern on a verge column (|w| = 3), sides alternating
  const lights = rec.cells.filter(c => /-light$/.test(c.role))
  assert.ok(lights.length >= 3, `lamps ${lights.length}`)
  for (const l of lights) {
    const post = rec.cells.filter(c => c.at[0] === l.at[0] && c.at[2] === l.at[2] && c.at[1] < l.at[1])
    assert.strictEqual(post.length, 1, 'a one-block post (its top below a road walker\'s eye)')
    assert.ok(post.every(c => (/-log$/.test(c.role) && c.ws?.axis === 'y') || /-fence$/.test(c.role)), 'a fence or a log (axis y) under the lantern')
    assert.strictEqual(l.at[1], post[0].at[1] + 1)
    assert.strictEqual(Math.abs(l.at[2]), 3, 'on the verge')
    assert.deepStrictEqual(rec.palette[l.role], ['lantern', 'torch'])
  }
  assert.ok(new Set(lights.map(l => Math.sign(l.at[2]))).size === 2, 'sides alternate')
  // the segments chain (each after the one before) and the lamps come last
  const segs = ok[0].inst.segments
  for (let i = 1; i < segs.length; i++) if (!/-PL$/.test(segs[i].seg)) assert.deepStrictEqual(segs[i].deps, [segs[i - 1].seg])
  // zones: each node's square, never the whole box; the front (the paths' destination) is the landing
  assert.strictEqual(ok[0].meta.zones.length, ok[0].meta.len)
  assert.ok(rec.zones.every(z => z.box[3] - z.box[0] === 2 * (RD.ROADS.verge + 1)))
  assert.deepStrictEqual(rec.front, [[12, 0]])
})

await t('a slope rising 1 block every 2 columns: graded in slab half steps -- no walking step over half a block anywhere', () => {
  const ground = (x) => (x <= 20 ? 64 : 64 + Math.floor((x - 20) / 2))
  const { rec, out } = siteAll(world({ ground: (x) => Math.min(ground(x), 80) }))
  assert.ok(out.filter(r => r.ok).length >= 2, JSON.stringify(out.at(-1)?.fail ?? {}))
  const slabs = rec.cells.filter(c => /-sl$/.test(c.role))
  assert.ok(slabs.length > 10, `slabs ${slabs.length}`)
  assert.ok(slabs.every(c => c.ws?.type === 'bottom'), 'every riser a BOTTOM slab (a top-face click)')
  assert.ok(maxStep(rec) <= 1, `a walking step of ${maxStep(rec)} half blocks`)
})

await t('MUTANT KILLED: without the slab rule (risers as full blocks) the slope has 1-block jumps', async () => {
  await withMutant(ROADS_PATH, '      if (o && o.L === c.L - 1) { slab.add(k); break }', '      if (o && o.L === c.L - 99) { slab.add(k); break }', async M => {
    const ground = (x) => Math.min(80, x <= 20 ? 64 : 64 + Math.floor((x - 20) / 2))
    const r = M.roadInstance('R9', [{ x: 21, z: 0, L: 64, d: 0 }, { x: 22, z: 0, L: 65, d: 0 }, { x: 23, z: 0, L: 65, d: 0 }].map(n => ({ ...n, s: 3, t: 3 })), { col: (x, z) => M.roadColumn(world({ ground }), x, z, 90, 50), style: M.roadStyle2(1, {}), lamp: false, read: world({ ground }) })
    assert.strictEqual(r.ok, false, 'the mutant laid a road with a 1-block jump')
  })
  // the real rule passes the same three rows
  const ground = (x) => Math.min(80, x <= 20 ? 64 : 64 + Math.floor((x - 20) / 2))
  const r = RD.roadInstance('R9', [{ x: 21, z: 0, L: 64, d: 0 }, { x: 22, z: 0, L: 65, d: 0 }, { x: 23, z: 0, L: 65, d: 0 }].map(n => ({ ...n, s: 3, t: 3 })), { col: (x, z) => RD.roadColumn(world({ ground }), x, z, 90, 50), style: RD.roadStyle2(1, {}), lamp: false, read: world({ ground }) })
  assert.strictEqual(r.ok, true)
})

await t('MUTANT KILLED: without the run rule (a level change every row) the router climbs a staircase of jumps', async () => {
  const ground = (x) => Math.min(80, x <= 20 ? 64 : 64 + (x - 20))  // 1:1: too steep for a road
  const real = siteAll(world({ ground }))
  assert.ok(real.rec == null || maxStep(real.rec) <= 1, 'the real road never jumps')
  await withMutant(ROADS_PATH, "        if (dL && (s.s < ROADS.runMin || s.t < ROADS.turnFlat || turn)) continue", "        if (dL && turn) continue", async M => {
    const r = M.routeRoad(world({ ground }), { line: [[13, 0], [60, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64 })
    const ls = r.nodes.map(n => n.L)
    assert.ok(ls.some((L, i) => i >= 2 && L - ls[i - 2] >= 2), `the mutant should climb 1:1: ${ls.join(',')}`)
  })
})

await t('a lake across the line: the road stops short of the water and the route ends blocked (a bridge is bridges-01\'s)', () => {
  const lake = (x, z) => x >= 40 && x <= 52 && Math.abs(z) <= 30
  const { rec, out } = siteAll(world({ lake, wl: 64 }))
  assert.ok(rec, JSON.stringify(out[0]?.fail ?? {}))
  const xs = rec.cells.map(c => c.at[0])
  assert.ok(Math.max(...xs) <= 38, `a cell at x ${Math.max(...xs)}: within a column of the water`)
  const last = S.instancesOf(rec).at(-1)
  assert.match(String(last.ended), /^blocked_/)
  assert.strictEqual(RD.routeEnded(rec, 'east', Date.now()), true)
  assert.strictEqual(RD.routeEnded(rec, 'east', Date.now() + RD.ROADS.blockedMs + 1), false, 'a blocked route is tried again later')
})

await t('MUTANT KILLED: without the liquid test the road is laid over water under the turf (a buried spring at y 63)', async () => {
  const extra = new Map(); for (let z = -6; z <= 6; z++) for (const x of [30, 31]) extra.set(`${x},63,${z}`, WATER)
  const real = RD.routeRoad(world({ extra }), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64 })
  const over = r => r.nodes.some(n => (n.x === 30 || n.x === 31) && Math.abs(n.z) <= 8)
  assert.ok(real.nodes.length && !over(real), 'the real router goes round the spring')
  await withMutant(ROADS_PATH, "      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = Math.min(g, L) - 1; y <= L + 3; y++) if (wet(read(cx + dx, y, cz + dz))) return { ok: false, why: 'liquid' }", '', async M => {
    const r = M.routeRoad(world({ extra }), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64 })
    assert.ok(over(r), 'the mutant should route over the spring')
  })
})

await t('another record\'s cells (`own`: the paths, the yard): no road cell on one of their columns -- the road goes round', () => {
  const block = new Set(); for (let z = -6; z <= 6; z++) block.add(`30,${z}`)   // a record's line of cells across the road at x 30
  const own = (x, z) => block.has(`${x},${z}`)
  const { rec, out } = siteAll(world(), { own })
  assert.ok(rec, JSON.stringify(out[0]?.fail ?? {}))
  assert.ok(rec.cells.every(c => !own(c.at[0], c.at[2])), 'a road cell on the record\'s column')
  assert.ok(Math.max(...rec.cells.map(c => c.at[0])) > 32, 'the road went round and on')
})

await t('MUTANT KILLED: without the own-column refusal the road is laid over the other record', async () => {
  await withMutant(ROADS_PATH, "    if (own(cx, cz)) return { ok: false, why: 'path' }", '', async M => {
    const block = new Set(); for (let z = -6; z <= 6; z++) block.add(`30,${z}`)
    const r = M.routeRoad(world(), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64, own: (x, z) => block.has(`${x},${z}`) })
    assert.ok(r.nodes.some(n => n.x === 30 && Math.abs(n.z) <= 6), 'the mutant should cross the record')
  })
})

await t('a reservation (the guard) is never paved; the router stays out of the town (`forbid`)', () => {
  const guard = (x, z) => (x >= 25 && x <= 27 && z >= -20 && z <= 2 ? 'project:tower' : null)
  const { rec } = siteAll(world(), { guard })
  assert.ok(rec.cells.every(c => !guard(c.at[0], c.at[2])))
})

await t('gradeOf: a column beside one a level lower is a slab; a step of a whole block is refused', () => {
  const m = new Map([['0,0', { x: 0, z: 0, L: 64 }], ['1,0', { x: 1, z: 0, L: 65 }], ['2,0', { x: 2, z: 0, L: 65 }]])
  const g = RD.gradeOf(m)
  assert.strictEqual(g.ok, true); assert.ok(g.slab.has('1,0')); assert.ok(!g.slab.has('2,0'))
  const bad = RD.gradeOf(new Map([['0,0', { x: 0, z: 0, L: 64 }], ['1,0', { x: 1, z: 0, L: 65 }], ['2,0', { x: 2, z: 0, L: 66 }]]))
  assert.strictEqual(bad.ok, false, 'two risers in a row is a 1-block step')
})

await t('roadKitNeed: the open slab, fence and lantern cells less the bag\'s (a torch serves a lantern cell)', () => {
  const rec = { cells: [{ role: 'R2-sl', at: [0, 0, 0] }, { role: 'R2-sl', at: [1, 0, 0] }, { role: 'R2-fence', at: [2, 0, 0] }, { role: 'R2-light', at: [3, 0, 0] }, { role: 'R2-light', at: [4, 0, 0] }, { role: 'R2-tr', at: [5, 0, 0] }] }
  const n = RD.roadKitNeed(rec, () => true, { stone_brick_slab: 1, torch: 1 })
  assert.deepStrictEqual([n.slab, n.fence, n.lantern], [1, 1, 1])
  assert.deepStrictEqual(RD.roadKitNeed(rec, c => c.at[0] > 2, {}).slab, 0)
})

await t('sinks: appendInstance keeps a road2 instance\'s own zones and its front; sinkNextGate honours `max`', () => {
  const meta = { id: 'R1', n: 1, design: { kind: 'road2' }, box: [13, -3, 40, 3], zones: [{ box: [10, -64, -4, 18, 320, 4], why: 'project:road:R1' }], front: [[12, 0]] }
  const r = S.appendInstance(null, { kind: 'road', home: HOME, inst: { cells: [{ at: [13, 64, 0], role: 'R1-tr', seg: 'R1-P0' }], segments: [], palette: {} }, meta })
  assert.deepStrictEqual(r.zones, meta.zones)
  assert.deepStrictEqual(r.front, [[12, 0]])
  const rec6 = { instances: Array.from({ length: 6 }, (_, i) => ({ id: `R${i}` })), structure_complete: true }
  assert.strictEqual(S.sinkNextGate({ kind: 'road', rec: rec6, pressure: { p: 1 } }).why, 'max_instances')
  assert.strictEqual(S.sinkNextGate({ kind: 'road', rec: rec6, pressure: { p: 1 }, max: 60 }).want, true)
  // an old (road@1) instance keeps its box zone
  const r1 = S.appendInstance(null, { kind: 'road', home: HOME, inst: { cells: [], segments: [], palette: {} }, meta: { id: 'R1', n: 1, design: { kind: 'road' }, box: [0, 0, 2, 2] } })
  assert.deepStrictEqual(r1.zones[0].box, [-1, -64, -1, 3, 320, 3])
})

await t('proveBuild: a bottom-slab row is a floor of the walk with `floors` (and is not without it)', () => {
  // a 1-wide causeway at y 64 from home to x 20, a step up to 65 at x 21..30 with a SLAB at x 21 (65): the approach at x 30
  const extra = new Map()
  const ground = () => 60
  for (let x = -2; x <= 30; x++) { const L = x <= 20 ? 64 : 65; for (let y = 61; y <= L; y++) extra.set(`${x},${y},0`, x === 21 && y === 65 ? { name: 'stone_brick_slab', boundingBox: 'block', props: { type: 'bottom' } } : { name: 'stone', boundingBox: 'block' }) }
  const read = world({ ground, extra })
  const inst = { cells: [{ at: [31, 65, 0], role: 'R1-tr', seg: 'R1-P0' }, { at: [31, 64, 0], role: 'R1-core', seg: 'R1-P0' }, { at: [31, 63, 0], role: 'R1-core', seg: 'R1-P0' }, { at: [31, 62, 0], role: 'R1-core', seg: 'R1-P0' }, { at: [31, 61, 0], role: 'R1-core', seg: 'R1-P0' }], segments: [{ seg: 'R1-P0', deps: [] }], palette: { 'R1-tr': ['stone_bricks'], 'R1-core': ['cobblestone'] }, clear: [] }
  const home = { x: 0, y: 65, z: 0 }
  const without = S.proveBuild(read, home, inst, { approach: [[30, 66, 0]], walkR: 48, localR: 10 })
  assert.strictEqual(without.why, 'unreachable', 'without floors the slab row ends the walk')
  const withF = S.proveBuild(read, home, inst, { approach: [[30, 66, 0]], walkR: 48, localR: 10, floors: new Set(['21,65,0']) })
  assert.notStrictEqual(withF.why, 'unreachable', JSON.stringify(withF))
})

await t('LAMPS2 dress: a lamp is a fence post with a lantern (`-fpost`, `-lamp`), a wall top a lantern; a signpost keeps stone and torch', () => {
  const fx = [{ kind: 'lamp', post: [[1, 65, 1]], light: [1, 66, 1], at: [1, 66, 1] }, { kind: 'walltop', post: [], light: [5, 70, 5], at: [5, 70, 5] },
    { kind: 'signpost', for: 'shop', post: [[9, 65, 9], [9, 66, 9]], light: [9, 67, 9], at: [9, 67, 9], sign: { at: [9, 66, 8] } }]
  const on = TD.dressInstance('L7', fx, { lamps2: true })
  const roleAt = (i, a) => i.cells.find(c => c.at.join(',') === a.join(','))?.role
  assert.strictEqual(roleAt(on, [1, 65, 1]), 'L7-fpost'); assert.strictEqual(roleAt(on, [1, 66, 1]), 'L7-lamp'); assert.strictEqual(roleAt(on, [5, 70, 5]), 'L7-lamp')
  assert.strictEqual(roleAt(on, [9, 65, 9]), 'L7-post'); assert.strictEqual(roleAt(on, [9, 67, 9]), 'L7-light')
  assert.deepStrictEqual(on.palette['L7-lamp'], ['lantern', 'torch'])
  assert.ok(on.palette['L7-fpost'].every(n => /_fence$/.test(n)))
  assert.ok(TD.dressLightRole('L7-lamp'), 'a lantern cell is a dress light (the host-gone waiver, the planned lights)')
  const off = TD.dressInstance('L7', fx)
  assert.strictEqual(roleAt(off, [1, 66, 1]), 'L7-light', 'LAMPS2 off: exactly as before')
})

await t('MUTANT KILLED: a dress lamp without the lamps2 roles keeps its torch', async () => {
  await withMutant(DRESS_PATH, "    const lantern = lamps2 && (f.kind === 'lamp' || f.kind === 'walltop')", '    const lantern = false', async M => {
    const on = M.dressInstance('L7', [{ kind: 'lamp', post: [[1, 65, 1]], light: [1, 66, 1], at: [1, 66, 1] }], { lamps2: true })
    assert.notStrictEqual(on.cells.find(c => c.at[1] === 66).role, 'L7-lamp')
  })
})

await t('STRUCTURE: skills.mjs hands the road siting its routes, kits a road visit, gives runVisit the slab floors, and lets the road take the land plan\'s corridors', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/\.\.\.\(kind === 'road' && roads2On\(\) \? \{ roads2: roads2Sited\(\) \} : \{\}\)/.test(src), 'the siting ctx carries roads2')
  assert.ok(/if \(kind === 'road' \|\| \(kind === 'dress' && lampsOn\(process\.env, config\.memory\.pool\)\)\) \{/.test(src), 'the kit runs on a road visit')
  assert.ok(/\.\.\.\(kind === 'road' \? \{ floors: roadFloors\(rec\) \} : \{\}\)/.test(src), 'runVisit gets the road\'s slab floors')
  assert.ok(/roadOwn && \/\^\(land:road\|project:paths\)\//.test(src), 'the road guard opens the land plan\'s road corridors')
  assert.ok(/max: kind === 'road' && roads2On\(\) \? ROADS\.instancesMax : null/.test(src), 'the gate gets the road2 instance cap')
})

console.log(`\nroads: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
