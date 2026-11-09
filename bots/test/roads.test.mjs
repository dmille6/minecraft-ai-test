// ROADS-01, THE FLEET PORT (bots/src/roads.mjs; roadsbase.mjs -- the showcase sinks' proof and growing record, the road's case; shop.mjs
// the road project; buildsite.mjs walkFrom's slab floors; skills.mjs buildRoad wiring). Behaviour over a fake world: the traffic file's routes, the switch,
// the router and the cells on flat ground, on a slope (slab half steps: no walking step over half a block), at a lake (the road stops
// short and ends), beside another record's cells (never on them), the lamps, the kit's count, the dress's lantern posts. Anchored
// mutants (each anchor present and unique) for the rules the tests lean on; STRUCTURAL source assertions only for the skills.mjs
// wiring (comments stripped, executable lines).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const RD = await import('../src/roads.mjs')
const RB = await import('../src/roadsbase.mjs')
const BS = await import('../src/buildsite.mjs')
const SH = await import('../src/shop.mjs')
const S = { instancesOf: RB.instancesOf, proveBuild: RB.proveBuild }

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const ROADS_PATH = new URL('../src/roads.mjs', import.meta.url)
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
    const r = RD.siteRoad2(read, { id: `R${n}`, n, home: HOME, pool: 'test', avail: { stone_bricks: 2000, cobbled_deepslate: 2000 }, guard, rec, stood: [], routes, ring: RING, townBoxes: [RING], landOk: () => true, own, lamp: true })
    if (!r.ok) { out.push({ fail: r }); break }
    rec = RB.completeRoad(RB.appendRoad(rec, { home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: Date.now() } }))
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

console.log('roads-01 (fleet): traffic routes, the router, the cells, the lamps, the road project')

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

await t('the switch: ROADS2 on in every pool on the fleet line by default (the variant is the rollout), forced either way; the road a project', () => {
  assert.strictEqual(RD.roadsOn({}, 'hive-a'), true)
  assert.strictEqual(RD.roadsOn({ ROADS2: 'off' }, 'hive-a'), false)
  assert.strictEqual(RD.roadsOn({ ROADS2_POOLS: 'hive-b' }, 'hive-a'), false)
  assert.ok(SH.projectsOn(true, true, true, true, true, true, true, true).some(p => p.plot === 'road'), 'the road is a project with ROADS2 on')
  assert.ok(!SH.projectsOn(true, true, true, true, true, true, true, false).some(p => p.plot === 'road'), 'and none with it off')
  assert.ok(!SH.projectsOn(true, true, false, true, true, true, true, true).some(p => p.plot === 'road'), 'and none without the paths')
  assert.strictEqual(RD.roadStyle2(7, {}).lamp, 'fence', 'the fleet line has no aimed click: fence posts only')
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
    assert.ok(post.every(c => /-fence$/.test(c.role)), 'a fence under the lantern (the fleet line)')
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

await t('Codex fleet r1 BLOCKER: a laid road stays guarded with ROADS2 off (projectsGuarded keeps the road, as the stair)', () => {
  assert.ok(SH.projectsGuarded(SH.projectsOn(true, true, true, true, true, true, true, false)).some(p => p.plot === 'road'))
  assert.ok(!SH.projectsOn(true, true, true, true, true, true, true, false).some(p => p.plot === 'road'), 'positive control: no road WORK with it off')
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
  await withMutant(ROADS_PATH, "if (LITTER.test(n) && n !== 'dirt' && n !== 'gravel' && n !== 'sand') stack++; else if", "if (false) stack++; else if", async M => {
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

await t('appendRoad keeps a road instance\'s own zones and its front; completeRoad marks the newest standing', () => {
  const meta = { id: 'R1', n: 1, design: { kind: 'road2' }, box: [13, -3, 40, 3], zones: [{ box: [10, -64, -4, 18, 320, 4], why: 'project:road:R1' }], front: [[12, 0]] }
  const r = RB.appendRoad(null, { home: HOME, inst: { cells: [{ at: [13, 64, 0], role: 'R1-tr', seg: 'R1-P0' }], segments: [], palette: {} }, meta })
  assert.deepStrictEqual(r.zones, meta.zones); assert.deepStrictEqual(r.front, [[12, 0]]); assert.strictEqual(r.blueprint, 'road@2'); assert.strictEqual(r.structure_complete, false)
  const c = RB.completeRoad(r); assert.strictEqual(c.structure_complete, true); assert.ok(c.instances[0].completeAt)
  assert.strictEqual(RB.completeRoad(c), null)
})

await t('walkFrom: a road\'s bottom-slab cell is a floor with `floors` (and is not without it)', () => {
  const extra = new Map()
  for (let x = -2; x <= 30; x++) for (let y = 61; y <= (x <= 20 ? 64 : 65); y++) extra.set(`${x},${y},0`, x === 21 && y === 65 ? { name: 'stone_brick_slab', boundingBox: 'block' } : { name: 'stone', boundingBox: 'block' })
  const read = world({ ground: () => 60, extra })
  const home = { x: 0, y: 65, z: 0 }
  assert.ok(!BS.walkFrom(read, home, new Set(), 48).has('30,66,0'), 'without floors the slab row ends the walk')
  assert.ok(BS.walkFrom(read, home, new Set(), 48, { floors: new Set(['21,65,0']) }).has('30,66,0'), 'with floors the walk crosses it')
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

await t('STRUCTURE: skills.mjs dispatches the road visit, kits before the bag accounting, gives runVisit the slab floors, opens the land plan\'s road corridors', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/if \(proj\.plot === ROAD_PLOT\) return buildRoad\(ctx, args, signal\)/.test(src), 'the road visit is dispatched')
  const fnAt = src.indexOf('async function buildRoad'), kitAt = src.indexOf('const kt = await roadKit(ctx, rec, palette, signal)', fnAt), held0At = src.indexOf('const held0 = heldMap(bot)', fnAt)
  assert.ok(fnAt > 0 && kitAt > fnAt && held0At > kitAt, 'the kit comes before the visit takes held0 (a craft inside the accounting is loss)')
  assert.ok(/\.\.\.roadVisitOpts\(rec, home\), \.\.\.leave, floors: roadFloors\(rec\)/.test(src), 'runVisit gets the road\'s slab floors')
  assert.ok(/recordZones\(others\)\.filter\(z => !\/\^\(land:road\|project:paths\)\//.test(src), 'the road guard opens the land plan\'s road corridors and the paths\' zones')
  assert.ok(/if \(p\.plot === ROAD_PLOT && !rec\) return \{ plot: p\.plot, exists: true, complete: true, damaged: false, due: !!b && roadNextDue\(null\) \}/.test(src), 'a town without a road record is never an open project')
})

console.log(`\nroads: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
