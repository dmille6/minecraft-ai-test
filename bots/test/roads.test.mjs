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

/** Several anchored replacements in one mutant (each anchor present and unique). */
async function withMutants (file, pairs, fn) {
  let src = readFileSync(file, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
    assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
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

await t('a turn on a slope: no slab row inside a corner\'s 5x5 (Paper fleet 11-09: a riser row under a corner square stalled `retry`)', () => {
  const ground = (x, z) => Math.min(80, 64 + Math.floor(Math.max(0, x - 18) / 2) + Math.floor(Math.max(0, z - 4) / 2))
  const r = siteAll(world({ ground }), { routes: [route({ line: [[13, 0], [26, 0], [26, 30], [26, 60]], start: [13, 0], box: [20, 56, 32, 66] })] })
  assert.ok(r.rec, JSON.stringify(r.out[0]?.fail ?? {}))
  const path = S.instancesOf(r.rec).flatMap(i => i.path ?? [])
  const turns = path.filter((p, i) => i > 0 && i < path.length - 1 && ((path[i - 1][0] === p[0]) !== (path[i + 1][0] === p[0])))
  assert.ok(turns.length >= 1, `no turn: ${JSON.stringify(path)}`)
  const slabs = r.rec.cells.filter(c => /-sl$/.test(c.role))
  for (const tn of turns) assert.ok(!slabs.some(c => Math.max(Math.abs(c.at[0] - tn[0]), Math.abs(c.at[2] - tn[1])) <= 2), `a slab within a corner square at ${tn}`)
  assert.ok(maxStep(r.rec) <= 1)
})

await t('MUTANT KILLED: a turn allowed at the third row of a level puts the riser row under the corner square', async () => {
  await withMutant(ROADS_PATH, '      if (turn && (s.s <= ROADS.turnFlat || s.t < ROADS.turnFlat)) continue', '      if (turn && (s.s < ROADS.turnFlat || s.t < ROADS.turnFlat)) continue', async M => {
    const ground = (x, z) => Math.min(80, 64 + Math.floor(Math.max(0, x - 18) / 2) + Math.floor(Math.max(0, z - 4) / 2))
    const read = world({ ground })
    let hit = false
    for (const sx of [13, 14, 15, 16]) {
      const r = M.routeRoad(read, { line: [[13, 0], [26, 0], [26, 30], [26, 60]], start: { x: sx, z: 0, L: 64, d: 0, s: 4, t: 3 }, hy: 64, ahead: 40 })
      const p = r.nodes
      for (let i = 1; i < p.length - 1; i++) {
        if (p[i + 1].d === p[i].d) continue
        const pv = p.slice(Math.max(0, i - 2), i)
        if (pv.some(q => q.L !== p[i].L) || (p[i - 2] && p[i - 3] && p[i - 3].L === p[i].L - 1 && p[i - 2].L === p[i].L)) hit = true
      }
    }
    assert.ok(hit, 'the mutant should turn with the level\'s riser row two rows back')
  })
})

await t('Codex fleet r1 BLOCKER: a leaf touching water in the head room is never cleared (a waterlogged leaf breaks into a source)', () => {
  const extra = new Map([['30,65,0', { name: 'oak_leaves', boundingBox: 'block' }], ['30,66,0', WATER]])
  for (let z = -12; z <= 12; z++) { extra.set(`30,65,${z}`, { name: 'oak_leaves', boundingBox: 'block' }); extra.set(`30,66,${z}`, WATER) }
  const { rec } = siteAll(world({ extra }))
  assert.ok(!rec || !rec.clear.some(c => c.at[0] === 30 && c.at[1] === 65), 'a wet leaf in the clear list')
  // the props form too (a read that carries them): waterlogged=true reads wet
  const ex2 = new Map(); for (let z = -12; z <= 12; z++) ex2.set(`30,65,${z}`, { name: 'oak_leaves', boundingBox: 'block', props: { waterlogged: 'true' } })
  const r2 = RD.routeRoad(world({ extra: ex2 }), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 4, t: 3 }, hy: 64 })
  assert.ok(!r2.nodes.some(n => n.x === 30), 'the road crossed under waterlogged leaves')
  // positive control: dry leaves over the line are cleared
  const ex3 = new Map(); for (let z = -12; z <= 12; z++) ex3.set(`30,65,${z}`, { name: 'oak_leaves', boundingBox: 'block' })
  const r3 = siteAll(world({ extra: ex3 }))
  assert.ok(r3.rec.clear.some(c => c.at[0] === 30 && c.at[1] === 65 && c.kind === 'leaves'), 'positive control: a dry leaf is cleared')
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
  await withMutant(ROADS_PATH, "    if (paved) { const sw = shareOk(own(cx, cz), L); if (sw) return { ok: false, why: sw } }", '', async M => {
    const block = new Set(); for (let z = -6; z <= 6; z++) block.add(`30,${z}`)
    const r = M.routeRoad(world(), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64, own: (x, z) => block.has(`${x},${z}`) })
    assert.ok(r.nodes.some(n => n.x === 30 && Math.abs(n.z) <= 6), 'the mutant should cross the record')
  })
})

await t('Codex r1 BLOCKER: a verge column beyond the cross-sections (an end cap, a corner diagonal) on another record is left alone -- no fill, no clear', () => {
  // three nodes ending at (34, 0): the end cap's diagonal verge (35, 3) holds another project's log; guard and own both protect it
  const extra = new Map([['35,65,3', { name: 'oak_log', boundingBox: 'block' }], ['35,66,3', { name: 'oak_log', boundingBox: 'block' }]])
  const read = world({ extra })
  const prot = (x, z) => x === 35 && z === 3
  const nodes = [32, 33, 34].map(x => ({ x, z: 0, L: 64, d: 0, s: 3, t: 3 }))
  const col = (x, z) => RD.roadColumn(read, x, z, 90, 50)
  const r = RD.roadInstance('R9', nodes, { col, style: RD.roadStyle2(1, {}), lamp: false, read, guard: (x, z) => (prot(x, z) ? 'project:x' : null), own: prot })
  assert.strictEqual(r.ok, true)
  assert.ok(!r.clear.some(c => c.at[0] === 35 && c.at[2] === 3), 'the protected log is in the clear list')
  assert.ok(!r.cells.some(c => c.at[0] === 35 && c.at[2] === 3), 'a cell on the protected column')
  // positive control: unprotected, the same verge's log above the road level IS cleared (the verge clears its logs)
  const r2 = RD.roadInstance('R9', nodes, { col, style: RD.roadStyle2(1, {}), lamp: false, read })
  assert.ok(r2.clear.some(c => c.at[0] === 35 && c.at[2] === 3), 'positive control: the verge clears an unprotected log')
})

await t('the fleet\'s litter: a floating cobble beam over the line is passed and cleared (kind=cut, by name), a cobble pillar on it cut', () => {
  const extra = new Map()
  for (let x = 20; x <= 26; x++) for (let z = -2; z <= 2; z++) extra.set(`${x},67,${z}`, { name: 'cobblestone', boundingBox: 'block' })   // a beam, air under it
  for (let y = 65; y <= 69; y++) extra.set(`34,${y},1`, { name: 'cobblestone', boundingBox: 'block' })                                      // a 5-high pillar
  const { rec, out } = siteAll(world({ extra }))
  assert.ok(rec, JSON.stringify(out[0]?.fail ?? {}))
  assert.ok(Math.max(...rec.cells.map(c => c.at[0])) > 40, 'the road went on past the litter')
  const cut = new Set(rec.clear.filter(c => c.kind === 'cut' && c.name === 'cobblestone').map(c => c.at.join(',')))
  assert.ok(cut.has('22,67,0') && cut.has('34,66,1'), 'the beam over the road and the pillar are listed clears')
  assert.ok(rec.cells.every(c => !(c.at[0] === 22 && c.at[2] === 0) || c.at[1] === 64), 'the road at the ground under the beam, not on it')
})

await t('MUTANT KILLED: without the pillar rule a bots\' cobble pillar on the line counts as natural cut (> cutMax): the road goes round it', async () => {
  const extra = new Map(); for (let z = -12; z <= 12; z++) for (let y = 65; y <= 68; y++) extra.set(`30,${y},${z}`, { name: 'cobblestone', boundingBox: 'block' })   // a cobble wall-pillar row
  const real = RD.routeRoad(world({ extra }), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64 })
  assert.ok(real.nodes.some(n => n.x === 30 && n.L === 64), 'the real router cuts the bots\' cobble down to the road')
  await withMutant(ROADS_PATH, "if ((LITTER.test(n) && n !== 'dirt' && n !== 'gravel' && n !== 'sand') || (n !== 'air' && n !== 'cave_air' && pillar(y))) stack++; else if", "if (false) stack++; else if", async M => {
    const r = M.routeRoad(world({ extra }), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64 })
    assert.ok(!r.nodes.some(n => n.x === 30 && n.L === 64), 'the mutant should refuse the 4-deep cut')
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
  assert.ok(/\.\.\.\(kind === 'road' && roads2On\(\) \? \{ roads2: roads2Sited\(why => sinkGuardFor\(c, plan, \{ kind, prepExcept: pe, open: why \}\)\) \} : \{\}\)/.test(src), 'the siting ctx carries roads2 (and the guard that opens a destination\'s zone)')
  const kitAt = src.indexOf("if (kind === 'road' || (kind === 'dress' && lampsOn(process.env, config.memory.pool))) {")
  assert.ok(kitAt > 0, 'the kit runs on a road visit')
  // the kit crafts BEFORE the visit's bag accounting (bag0 = held0): a craft inside it is unexplained loss to shopread G8
  const fnAt = src.lastIndexOf('async function buildSink', kitAt)
  const held0At = src.indexOf('const held0 = heldMap(bot)', fnAt)
  assert.ok(fnAt > 0 && held0At > kitAt, 'the kit comes before the visit takes held0')
  assert.ok(/\.\.\.\(kind === 'road' \? \{ floors: roadFloors\(rec\) \} : \{\}\), \.\.\.sinkVisitOpts\(rec, home\)/.test(src), 'runVisit gets the road\'s slab floors')
  assert.ok(/roadOwn && \/\^\(land:road\|project:paths\)\//.test(src), 'the road guard opens the land plan\'s road corridors')
  assert.ok(/max: kind === 'road' && roads2On\(\) \? ROADS\.instancesMax : null/.test(src), 'the gate gets the road2 instance cap')
})

// ---- roadsite-01show: the columns a road SHARES (the paths', the grading records'), the verges beside built work, pillars, pits,
// the paved start row, a road that never touches itself -------------------------------------------------------------------------------
const { cellDone } = await import('../src/buildrun.mjs')
const { PATH_PALETTE } = await import('../src/paths.mjs')
const { TIDY_PALETTE, cutStanding } = await import('../src/tidy.mjs')
/** A paths record's leg across the line at x (cells at the ground, y), z0..z1. */
const pathsAcross = (x, y, z0 = -8, z1 = 8) => ({ plot: 'paths', rec: { cells: Array.from({ length: z1 - z0 + 1 }, (_, i) => ({ at: [x, y, z0 + i], role: 'path' })) } })
/** Site one route over `read0` with records `recs` (own = roads.mjs roadShares, as skills.mjs roads2Ctx builds it), laid into the world. */
function siteShared (read0, recs, { avail = { stone_bricks: 2000, deepslate_bricks: 2000 }, max = 6, routes = [route()], guard = () => null, M = RD } = {}) {
  const SS = S
  const shares = M.roadShares(recs)
  const own = (x, z) => shares.get(`${x},${z}`) ?? null
  const extra = new Map()
  const read = (x, y, z) => extra.get(`${x},${y},${z}`) ?? read0(x, y, z)
  let rec = null
  const out = []
  for (let i = 0; i < max; i++) {
    const n = SS.instancesOf(rec).length + 1
    // (the module's own siteRoad2, as sinks.mjs siteSink hands it the ctx: a mutant's code is the code under test)
    const r = M.siteRoad2(read, { kind: 'road', n, id: `R${n}`, home: HOME, pool: 'test', avail, guard, rec, stood: [], routes, ring: RING, townBoxes: [RING], landOk: () => true, own, lamp: true })
    if (!r.ok) { out.push({ fail: r }); break }
    rec = SS.completeInstance(SS.appendInstance(rec, { kind: 'road', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: Date.now() } }))
    for (const c of r.inst.clear) extra.set(c.at.join(','), AIR)
    for (const c of r.inst.cells) { const name = r.inst.palette[c.role].find(q => q !== '*solid'); extra.set(c.at.join(','), { name, boundingBox: /lantern|torch|fence/.test(name) ? 'empty' : /_slab$/.test(name) ? 'block' : 'block', ...(c.ws ? { props: c.ws } : {}) }) }
    out.push(r)
  }
  return { rec, out, read, own }
}
const surface = rec => (rec?.cells ?? []).filter(c => /-(tr|acc|ed|sl)$/.test(c.role))

await t('roadsite: roadShares -- a path cell is the road\'s level (eq), a grading fill a floor (lo), a cut or clear a ceiling (hi; at its own y unless listed for a block a road lays), any other role or record refuses', () => {
  const sh = RD.roadShares([
    pathsAcross(30, 64, 0, 0),
    { plot: 'paths', rec: { cells: [{ at: [30, 63, 0], role: 'fill' }] } },
    { plot: 'country', rec: { cells: [{ at: [40, 65, 0], role: 'earth' }, { at: [40, 64, 0], role: 'core' }, { at: [41, 66, 0], role: 'topsoil' }], cut: [{ at: [42, 66, 0], name: 'grass_block' }, { at: [43, 66, 0], name: 'cobblestone' }], clear: [{ at: [44, 67, 0], name: 'oak_leaves' }] } },
    { plot: 'tidy', rec: { cells: [{ at: [45, 64, 0], role: 'core' }] } },
    { plot: 'yard', rec: { cells: [{ at: [50, 65, 0], role: 'pile' }] } },
  ])
  const at = (x, z) => sh.get(`${x},${z}`)
  assert.deepStrictEqual([at(30, 0).eq, at(30, 0).path, at(30, 0).other], [64, true, false])
  assert.strictEqual(at(40, 0).lo, 65); assert.strictEqual(at(41, 0).other, true, 'topsoil is the grading record\'s own (dirt only)')
  assert.strictEqual(at(42, 0).hi, 66); assert.strictEqual(at(43, 0).hi, 65, 'a cut listed for cobblestone: the road lays cobblestone, so never at its y')
  assert.strictEqual(at(44, 0).hi, 67); assert.strictEqual(at(45, 0).lo, 64); assert.strictEqual(at(50, 0).other, true)
  assert.strictEqual(RD.shareOk(at(30, 0), 64), null); assert.strictEqual(RD.shareOk(at(30, 0), 65), 'path_level')
  assert.strictEqual(RD.shareOk(at(40, 0), 64), 'grade_fill'); assert.strictEqual(RD.shareOk(at(40, 0), 65), null)
  assert.strictEqual(RD.shareOk(at(42, 0), 66), null); assert.strictEqual(RD.shareOk(at(42, 0), 67), 'grade_cut'); assert.strictEqual(RD.shareOk(at(43, 0), 66), 'grade_cut')
  assert.strictEqual(RD.shareOk(at(50, 0), 64), 'path'); assert.strictEqual(RD.shareOk(true, 64), 'path'); assert.strictEqual(RD.shareOk(null, 64), null)
  assert.strictEqual(RD.slabOk(at(30, 0), 64), false, 'never a slab on a path cell'); assert.strictEqual(RD.slabOk(at(40, 0), 65), false, 'never a slab on a fill')
  assert.strictEqual(RD.slabOk(at(40, 0), 66), true); assert.strictEqual(RD.slabOk(at(42, 0), 66), true); assert.strictEqual(RD.slabOk(null, 64), true)
})

await t('roadsite: STRUCTURE -- GRADE_SOLID_ROLES are exactly the grading palette\'s roles any full solid finishes (tidy.mjs TIDY_PALETTE)', () => {
  const solid = Object.entries(TIDY_PALETTE).filter(([, v]) => Array.isArray(v) && v.includes('*solid')).map(([k]) => k).sort()
  assert.deepStrictEqual([...RD.GRADE_SOLID_ROLES].sort(), solid)
})

await t('roadsite: a PATHS leg across the line -- the road crosses it at the path\'s level; on its columns the road\'s block is the tread (path palette), never a kerb, an accent or a slab; the path reads done after', () => {
  const recs = [pathsAcross(30, 64)]
  const { rec, out, read, own } = siteShared(world(), recs)
  assert.ok(rec, JSON.stringify(out[0]?.fail ?? {}))
  assert.ok(Math.max(...rec.cells.map(c => c.at[0])) > 40, 'the road crossed the path and went on')
  const on = surface(rec).filter(c => own(c.at[0], c.at[2]))
  assert.ok(on.length >= 5, `the road paves the path's columns (${on.length})`)
  for (const c of on) {
    assert.strictEqual(c.at[1], 64, 'at the path cell itself')
    assert.ok(!c.ws, 'no slab on a path cell')
    for (const n of rec.palette[c.role].filter(q => q !== '*solid')) assert.ok(PATH_PALETTE.path.includes(n), `${c.role} may lay ${n}: the path would dig it out`)
  }
  // COMPOSED: every path cell under the road reads done by the paths' own test (buildrun.mjs cellDone with PATH_PALETTE)
  for (const c of recs[0].rec.cells) if (on.some(q => q.at[0] === c.at[0] && q.at[2] === c.at[2])) assert.ok(cellDone(read(...c.at), PATH_PALETTE, 'path'), `path cell ${c.at} reads open under the road`)
})

await t('roadsite: MUTANT KILLED -- without the tread on a path column the road lays its kerb stone (deepslate bricks) into the path, which the path would dig out', async () => {
  await withMutant(ROADS_PATH, "const tag = own(c.x, c.z)?.path ? rTread : c.w === 2", "const tag = c.w === 2", async M => {
    const recs = [pathsAcross(30, 64)]
    const { rec, own } = siteShared(world(), recs, { M })
    assert.ok(rec, 'the mutant sites')
    const bad = surface(rec).filter(c => own(c.at[0], c.at[2])).filter(c => rec.palette[c.role].some(n => n !== '*solid' && !PATH_PALETTE.path.includes(n)))
    assert.ok(bad.length > 0, 'the mutant should lay a non-path block on a path cell')
  })
})

await t('roadsite: a path cell NOT at the ground (a raised path) is met at ITS level or not at all -- never a road surface over or under it', () => {
  const { rec, out, own } = siteShared(world(), [pathsAcross(30, 65, -30, 30)])
  assert.ok(rec, JSON.stringify(out[0]?.fail ?? {}))
  const on = surface(rec).filter(c => own(c.at[0], c.at[2]))
  assert.ok(on.every(c => c.at[1] === 65), `a road surface on the path's column off its level: ${JSON.stringify(on.filter(c => c.at[1] !== 65).map(c => c.at))}`)
  assert.ok(on.length > 0, 'positive control: the road met the raised path at its level (it rose by a half step)')
})

await t('roadsite: a GRADING record across the line -- fills planned above the ground: the road never runs under them (it rises to the grade or goes round); after it is laid every fill and cut on its columns reads done', () => {
  // the country plans to raise x 28..33 to 65 (fills at 65 on ground 64) and to cut a grass hump at 66 (x 36..38: the ground there 66)
  const extra = new Map()
  for (let x = 36; x <= 38; x++) for (let z = -12; z <= 12; z++) { extra.set(`${x},65,${z}`, { name: 'dirt', boundingBox: 'block' }); extra.set(`${x},66,${z}`, { name: 'grass_block', boundingBox: 'block' }) }
  const cells = [], cut = []
  for (let x = 28; x <= 33; x++) for (let z = -12; z <= 12; z++) cells.push({ at: [x, 65, z], role: 'earth' })
  for (let x = 36; x <= 38; x++) for (let z = -12; z <= 12; z++) cut.push({ at: [x, 66, z], name: 'grass_block' })
  const recs = [{ plot: 'country', rec: { cells, cut } }]
  const { rec, out, read, own } = siteShared(world({ extra }), recs)
  assert.ok(rec, JSON.stringify(out[0]?.fail ?? {}))
  const on = surface(rec).filter(c => own(c.at[0], c.at[2]))
  assert.ok(on.length > 0, 'the road crosses the grading')
  for (const c of on) assert.strictEqual(RD.shareOk(own(c.at[0], c.at[2]), c.at[1]), null, `road cell ${c.at} breaks the grade's terms`)
  for (const c of cells) if (on.some(q => q.at[0] === c.at[0] && q.at[2] === c.at[2])) assert.ok(cellDone(read(...c.at), TIDY_PALETTE, 'earth'), `fill ${c.at} reads open under the road`)
  for (const c of cut) if (on.some(q => q.at[0] === c.at[0] && q.at[2] === c.at[2])) assert.ok(!cutStanding(read, c), `cut ${c.at} still stands on the road's column`)
})

await t('roadsite: MUTANT KILLED -- without the fill term the road is laid UNDER the grading\'s planned fill (the country would bury it)', async () => {
  await withMutant(ROADS_PATH, "  if (L < o.lo) return 'grade_fill'\n", '', async M => {
    const cells = []; for (let x = 26; x <= 36; x++) for (let z = -14; z <= 14; z++) cells.push({ at: [x, 65, z], role: 'earth' })
    const { rec, own } = siteShared(world(), [{ plot: 'country', rec: { cells } }], { M })
    assert.ok(rec && surface(rec).some(c => own(c.at[0], c.at[2]) && c.at[1] < 65), 'the mutant should pave under the fill')
  })
  // positive control: the real code never does
  const cells = []; for (let x = 26; x <= 36; x++) for (let z = -14; z <= 14; z++) cells.push({ at: [x, 65, z], role: 'earth' })
  const { rec, own } = siteShared(world(), [{ plot: 'country', rec: { cells } }])
  assert.ok(!rec || !surface(rec).some(c => own(c.at[0], c.at[2]) && c.at[1] < 65), 'the real road paves under a planned fill')
})

await t('roadsite: Codex r1 BLOCKER -- a TURN\'s 5x5 square keeps the shared terms on every column (the quadrant ahead of the turn too): no tread under a grading fill', async () => {
  // Codex's case: flat ground at 64, the line east then south, the country's earth at 64 everywhere and one fill at 22,65,-1
  const cells = []; for (let x = 10; x <= 40; x++) for (let z = -16; z <= 30; z++) cells.push({ at: [x, 64, z], role: 'earth' })
  cells.push({ at: [22, 65, -1], role: 'earth' })
  const recs = [{ plot: 'country', rec: { cells } }]
  const routes = [route({ line: [[13, 0], [21, 0], [21, 18]], box: [17, 18, 25, 26] })]
  const check = (M, want) => {
    const { rec, own } = siteShared(world(), recs, { routes, M, max: 3 })
    const bad = (rec ? surface(rec).concat(rec.cells.filter(c => /-core$/.test(c.role))) : []).filter(c => RD.shareOk(own(c.at[0], c.at[2]), c.at[1]))
    if (want) assert.ok(bad.length > 0, 'the mutant should pave under the fill at 22,65,-1')
    else assert.deepStrictEqual(bad.map(c => c.at), [], 'a road cell breaks the grading\'s terms')
    return rec
  }
  const rec = check(RD, false)
  assert.ok(rec && rec.instances.some(i => (i.path ?? []).some(p => p[1] > 4)), 'positive control: the road turned south and went on')
  // the corner check alone (the layout's backstop off): the router lays the quadrant ahead under the fill
  await withMutants(ROADS_PATH, [
    ["    for (let sx = -2; sx <= 2; sx++) for (let sz = -2; sz <= 2; sz++) {", "    for (const sx of [-2, 2]) for (const sz of [-2, 2]) {"],
    ["  for (const c of paved.values()) if (shareOk(own(c.x, c.z), c.L)) return { ok: false, why: 'shared', bad: [c.x, c.L, c.z] }\n", ''],
  ], async M => { check(M, true) })
  // ...and the layout's backstop alone catches it (the corner check off, the backstop on): still no cell under the fill
  await withMutant(ROADS_PATH, "    for (let sx = -2; sx <= 2; sx++) for (let sz = -2; sz <= 2; sz++) {", "    for (const sx of [-2, 2]) for (const sz of [-2, 2]) {", async M => { check(M, false) })
})

await t('roadsite: a slab never lands on a shared column -- roadInstance refuses it (shared_slab, the column named for the router to go round)', async () => {
  // three nodes stepping down a level onto a path column: the last row at 64 below the first two at 65 -> the second row a slab
  const read = world({ ground: x => (x <= 31 ? 65 : 64) })
  const col = (x, z) => RD.roadColumn(read, x, z, 90, 50)
  const nodes = [{ x: 30, z: 0, L: 65, d: 0 }, { x: 31, z: 0, L: 65, d: 0 }, { x: 32, z: 0, L: 64, d: 0 }]
  const sh = RD.roadShares([pathsAcross(31, 65)])
  const own = (x, z) => sh.get(`${x},${z}`) ?? null
  const r = RD.roadInstance('R9', nodes, { col, style: RD.roadStyle2(1, {}), lamp: false, read, own })
  assert.strictEqual(r.why, 'shared_slab'); assert.deepStrictEqual([r.bad[0], r.bad[2]], [31, r.bad[2]])
  await withMutant(ROADS_PATH, "  for (const k of gr.slab) { const c = paved.get(k); if (c && !slabOk(own(c.x, c.z), c.L)) return { ok: false, why: 'shared_slab', bad: [c.x, c.L, c.z] } }\n", '', async M => {
    const m = M.roadInstance('R9', nodes, { col, style: M.roadStyle2(1, {}), lamp: false, read, own })
    assert.ok(m.ok && m.cells.some(c => c.at[0] === 31 && c.ws?.type === 'bottom'), 'the mutant lays a slab on the path')
  })
})

await t('roadsite: a VERGE beside built work (a fence line, a torch) is left standing -- the road keeps to its line instead of refusing; a paved column on it still refuses', async () => {
  const extra = new Map(); for (let x = 14; x <= 70; x++) extra.set(`${x},65,3`, { name: 'oak_fence', boundingBox: 'block' })   // a fence along the line, 3 off it
  const { rec, out } = siteAll(world({ extra }))
  assert.ok(rec, JSON.stringify(out[0]?.fail ?? {}))
  assert.ok(rec.cells.every(c => !(c.at[2] === 3 && c.at[1] >= 64)), 'nothing laid on the fence\'s column')
  assert.ok(rec.instances.flatMap(i => i.path ?? []).some(p => p[1] === 0 && p[0] > 20), 'the road kept the traffic line (z 0) beside the fence')
  await withMutant(ROADS_PATH, "    if (!paved && (gr.why === 'built' || gr.why === 'tree')) {", "    if (false) {", async M => {
    const r = M.routeRoad(world({ extra }), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64 })
    assert.ok(!r.nodes.some(n => n.z === 0 && n.x > 20), 'the mutant should leave the line (the fence refused as a verge)')
  })
})

await t('roadsite: a bots\' 1x1 PILLAR of dirt on the line is cut down (counted as their stack, not natural ground)', async () => {
  const extra = new Map(); for (let y = 65; y <= 68; y++) extra.set(`30,${y},0`, { name: 'dirt', boundingBox: 'block' })
  const real = RD.routeRoad(world({ extra }), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64 })
  assert.ok(real.nodes.some(n => n.x === 30 && n.z === 0 && n.L === 64), 'the real router cuts the pillar down to the road')
  await withMutant(ROADS_PATH, " || (n !== 'air' && n !== 'cave_air' && pillar(y))) stack++", ") stack++", async M => {
    const r = M.routeRoad(world({ extra }), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64 })
    assert.ok(!r.nodes.some(n => n.x === 30 && n.z === 0 && n.L === 64), 'the mutant should refuse the 4-high natural cut')
  })
})

await t('roadsite: a trench 4 deep across the line is filled under the road (fillMax 4: the proof decides the stands), every walking step at most half a block', async () => {
  const pit = (x, z) => (x === 30 && Math.abs(z) <= 10 ? 60 : 64)   // a bot's trench, 1 wide, 4 deep, across the line
  const { rec, out } = siteAll(world({ ground: pit }))
  assert.ok(rec, JSON.stringify(out[0]?.fail ?? {}))
  const nodes = rec.instances.flatMap(i => i.path ?? [])
  assert.ok(nodes.some(p => p[0] === 30 && Math.abs(p[1]) <= 4 && p[2] >= 63), `the road crosses the trench 3+ over its floor: ${JSON.stringify(nodes)}`)
  assert.ok(rec.cells.some(c => c.at[0] === 30 && /-core$/.test(c.role)), 'the pit under the road is filled')
  assert.ok(maxStep(rec) <= 1, `a walking step of ${maxStep(rec)} half blocks`)
  await withMutant(ROADS_PATH, '  fillMax: 4,', '  fillMax: 2,', async M => {
    const r = M.routeRoad(world({ ground: pit }), { line: [[13, 0], [70, 0]], start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64 })
    assert.ok(!r.nodes.some(n => n.x === 30 && Math.abs(n.z) <= 8 && n.L >= 63), `the old limit should never fill the trench 3 deep (it digs the road down into it): ${JSON.stringify(r.nodes.map(n => [n.x, n.z, n.L]))}`)
  })
})

await t('roadsite: a route\'s FIRST instance paves its start row (the landing joins the road, flat or by a half step)', async () => {
  const { rec, out } = siteAll(world())
  assert.ok(rec, JSON.stringify(out[0]?.fail ?? {}))
  const first = rec.instances.find(i => i.design?.kind === 'road2')
  const [sx, sz] = first.path[0]
  assert.ok(surface(rec).some(c => c.at[0] === sx && c.at[2] === sz), `no road cell on the start row ${sx},${sz}`)
  assert.strictEqual(first.land.x, sx - 1, 'the landing is the column before the paved start row')
  await withMutant(ROADS_PATH, "last ? r.nodes : [start, ...r.nodes], { prevEnd", "r.nodes, { prevEnd", async M => {
    const r = M.siteRoad2(world(), { id: 'R1', home: HOME, routes: [route()], ring: RING, townBoxes: [RING], avail: { stone_bricks: 2000 } })
    assert.ok(r.ok, JSON.stringify(r.tried))
    assert.ok(!r.inst.cells.some(c => c.at[0] === r.meta.land.x + 1 && /-(tr|acc|ed|sl)$/.test(c.role)), 'the mutant should leave the start row natural')
  })
})

await t('roadsite: a road never touches itself -- routeRoad\'s nodes keep 3 apart from every node more than 4 back (a boxed-in lane: the cheapest way on loops)', async () => {
  // the village case in small: the line east is reserved past x 26 for z <= 1 (a zone), open further south -- a sidestep of 5 lanes
  const guard = (x, z) => (x >= 26 && z <= 1 ? 'zone' : null)
  const line = [[13, 0], [70, 0]]
  const ok = nodes => nodes.every((q, i) => nodes.slice(0, Math.max(0, i - 4)).every(o => Math.max(Math.abs(o.x - q.x), Math.abs(o.z - q.z)) > 2))
  const r = RD.routeRoad(world(), { line, start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64, guard })
  assert.ok(ok(r.nodes), JSON.stringify(r.nodes.map(n => [n.x, n.z])))
  // the invariant over the real replay's shapes: every node list the siting produces on random rough ground
  for (let seed = 1; seed <= 6; seed++) {
    const g = (x, z) => 64 + ((((x * 73856093) ^ (z * 19349663) ^ seed * 83492791) >>> 0) % 7 === 0 ? 2 : 0)
    const q = RD.routeRoad(world({ ground: g }), { line, start: { x: 13, z: 0, L: 64, d: 0, s: 3, t: 3 }, hy: 64, guard })
    assert.ok(ok(q.nodes), `seed ${seed}: ${JSON.stringify(q.nodes.map(n => [n.x, n.z]))}`)
  }
})

await t('roadsite: STRUCTURE -- skills.mjs roads2Ctx hands the siting the shared columns (roadShares over every other record, the country\'s plan included)', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const at = src.indexOf('function roads2Ctx ()')
  const body = src.slice(at, src.indexOf('\nfunction ', at + 10))
  assert.ok(/const shares = roadShares\(recs\)/.test(body), 'roadShares builds the terms')
  assert.ok(/recs\.push\(\{ plot: COUNTRY_PLOT, rec: cr \}\)/.test(body), 'the country head is among them')
  assert.ok(/own: \(x, z\) => shares\.get\(`\$\{x\},\$\{z\}`\) \?\? null/.test(body), 'own answers the terms')
})

// ---- roadsite-01show r3 (OWNER 11-20 "Let roads enter warehouse area"; "paths and lamps") ----------------------------------------
/** The warehouse corner in small: a warehouse growth zone and its box north-east of the ring, a tower's zone hard by, another route
 *  whose line crosses the warehouse's zone. The guard answers zones by why (the opened guard drops exactly one). */
const WH_BOX = [24, -40, 40, -24]
const WH_ZONE = { box: [16, -50, 50, -15], why: 'project:warehouse' }
const T3_ZONE = { box: [17, -8, 30, 0], why: 'project:tower:T3' }
const zoneGuard = (zones, open = null) => (x, z) => zones.find(q => q.why !== open && x >= q.box[0] && x <= q.box[2] && z >= q.box[1] && z <= q.box[3])?.why ?? null
const whRoutes = () => [
  route({ id: 'warehouse', to: 'warehouse', kind: 'project', trips: 900, start: [13, -12], line: [[13, -12], [20, -14], [28, -22], [33, -30], [35, -35]], box: WH_BOX }),
  route({ id: 'work-x', to: 'work', kind: 'work', trips: 500, start: [13, 4], line: [[13, 4], [26, 0], [34, -14], [44, -40]], box: [44, -44, 50, -40] }),
]
const inZone = (c, q) => c.at[0] >= q.box[0] && c.at[0] <= q.box[2] && c.at[2] >= q.box[1] && c.at[2] <= q.box[3]
function siteWh (M = RD, max = 6) {
  const zones = [WH_ZONE, T3_ZONE]
  let rec = null
  const out = []
  for (let i = 0; i < max; i++) {
    const n = S.instancesOf(rec).length + 1
    const r = M.siteRoad2(world(), { id: `R${n}`, n, home: HOME, pool: 'test', avail: { stone_bricks: 2000 }, guard: zoneGuard(zones), guardFor: why => zoneGuard(zones, why), rec, stood: [], routes: whRoutes(), ring: RING, townBoxes: [RING], lamp: true })
    if (!r.ok) { out.push({ fail: r }); break }
    rec = S.completeInstance(S.appendInstance(rec, { kind: 'road', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: Date.now() } }))
    out.push(r)
  }
  const cellsOf = id => (rec?.cells ?? []).filter(c => (rec.instances ?? []).some(i => i.route === id && String(c.seg ?? '').startsWith(`${i.id}-`)))
  return { rec, out, cellsOf }
}

await t('roadsite r3: roadOpenZone -- only a PROJECT route whose destination is the warehouse opens a zone, and only the warehouse\'s', () => {
  assert.strictEqual(RD.roadOpenZone({ id: 'warehouse', to: 'warehouse', kind: 'project' }), 'project:warehouse')
  for (const r of [{ to: 'village', kind: 'village' }, { to: 'work', kind: 'work' }, { to: 'warehouse', kind: 'work' }, { to: 'tower', kind: 'project' }, { to: 'toString', kind: 'project' }, null]) assert.strictEqual(RD.roadOpenZone(r), null, JSON.stringify(r))
})

await t('roadsite r3: COMPOSED -- the warehouse route enters the warehouse\'s own zone and stops at its box; no other route enters that zone; no route enters the tower\'s', () => {
  const { rec, out, cellsOf } = siteWh()
  assert.ok(rec, JSON.stringify(out[0]?.fail ?? {}))
  const wh = cellsOf('warehouse'), other = cellsOf('work-x')
  assert.ok(wh.some(c => inZone(c, WH_ZONE)), `the warehouse road reached into its zone: ${JSON.stringify(out.map(r => r.tried ?? r.fail?.tried))}`)
  assert.ok(!wh.some(c => inZone(c, { box: WH_BOX })), 'a warehouse road cell inside the warehouse\'s box')
  assert.ok(other.length > 0, 'positive control: the other route sited')
  assert.ok(!other.some(c => inZone(c, WH_ZONE)), 'another route entered the warehouse\'s zone')
  assert.ok(!rec.cells.some(c => inZone(c, T3_ZONE)), 'a road cell in the tower\'s zone')
})

await t('roadsite r3: MUTANT KILLED -- a zone opened for every route lets the other route into the warehouse\'s zone', async () => {
  await withMutant(ROADS_PATH, "export const roadOpenZone = route => (route?.kind === 'project' && Object.hasOwn(ROAD_DEST_ZONES, String(route?.to)) ? ROAD_DEST_ZONES[route.to] : null)", "export const roadOpenZone = route => 'project:warehouse'", async M => {
    const { cellsOf } = siteWh(M)
    assert.ok(cellsOf('work-x').some(c => inZone(c, WH_ZONE)), 'the mutant should let work-x into the warehouse zone')
  })
})

await t('roadsite r3: MUTANT KILLED -- without the box refusal the warehouse road is laid into the warehouse\'s own footprint', async () => {
  await withMutant(ROADS_PATH, "(db && x >= db[0] && x <= db[2] && z >= db[1] && z <= db[3] ? `dest:${route.to}` : gOpen(x, z, y0, y1))", "gOpen(x, z, y0, y1)", async M => {
    const { cellsOf } = siteWh(M)
    assert.ok(cellsOf('warehouse').some(c => inZone(c, { box: WH_BOX })), 'the mutant should pave inside the box')
  })
})

await t('roadsite r3: roadLanternDraw -- the town\'s spare lanterns first, never more than owed, none when unread', () => {
  assert.strictEqual(RD.roadLanternDraw(3, 179), 3); assert.strictEqual(RD.roadLanternDraw(5, 2), 2); assert.strictEqual(RD.roadLanternDraw(0, 9), 0)
  assert.strictEqual(RD.roadLanternDraw(4, 0), 0); assert.strictEqual(RD.roadLanternDraw(4, undefined), 0); assert.strictEqual(RD.roadLanternDraw(4, -3), 0)
})

await t('roadsite r3: STRUCTURE -- the road kit draws the town\'s lanterns BEFORE it crafts (its iron and torches only for what the chests cannot give); the siting opens a zone only for a road, record zones only', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const kit = src.slice(src.indexOf('async function roadKit'), src.indexOf('\nfunction ', src.indexOf('async function roadKit')))
  const draw = kit.indexOf("await matsWithdraw(ctx, { lantern: fromTown }, signal, 20_000, R0, decorAllow({ lantern: fromTown }))")
  const lack = kit.indexOf("const lacking = Math.max(0, Math.min(ROAD_KIT_MAX, nd.lantern) - drawn)")
  const craftAt = kit.indexOf("await craft(ctx, { item: 'lantern', count: k }, signal)")
  assert.ok(draw > 0 && lack > draw && craftAt > lack, `draw ${draw} lacking ${lack} craft ${craftAt}`)
  assert.ok(/const fromTown = roadLanternDraw\(Math\.min\(ROAD_KIT_MAX, nd\.lantern\), spareLanterns\)/.test(kit))
  assert.ok(/const opened = z => roadOwn && open != null && String\(z\?\.why \?\? ''\) === open/.test(src), 'the opened zone is a road\'s only')
  assert.ok(/const zs = \[\.\.\.c\.zones, \.\.\.recordZones\(others\)[^\n]*\.filter\(z => !opened\(z\)\)/.test(src), 'only record zones are opened (c.zones -- the protected zones -- never)')
})

console.log(`\nroads: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
