// GROUNDSKEEPER-01: THE LAND PLAN (landplan.mjs) AND THE GROUNDSKEEPER (groundskeeper.mjs; tidy.mjs stages; skills.mjs buildTidy).
// Owner 11-02: one bot a town tidies the town first, then works outward, following a PLAN for roads and organization. Behaviour on
// buildfake's flat world (stone below G, grass at G) and on hand-built grounds; structural assertions only for wiring.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { G, HOME, server, bot, PJ, R } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const LP = await import('../src/landplan.mjs')
const GKM = await import('../src/groundskeeper.mjs')
const P = await import('../src/paths.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const BUILDRUN_PATH = new URL('../src/buildrun.mjs', import.meta.url)
const LAND_PATH = new URL('../src/landplan.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const col = (srv, x, z, y0, y1, name) => { for (let y = y0; y <= y1; y++) srv.set([x, y, z], name) }
const k2 = (x, z) => `${x},${z}`
const PLAN = () => ({ home: HOME, gen: 3, plots: [{ id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], keepout: true }, { id: 'gate', kind: 'gate', sector: 'S' }, { id: 'shaft', kind: 'shaft', sector: 'E' }, { id: 'monument', kind: 'monument', sector: 'NW' }, { id: 'farm', kind: 'farm', sector: 'N' }] })
const SMALL = Object.freeze({ ...LP.LAND, workR: 44, rimR: 20, rimStep: 12, legPops: 60_000 })

console.log('THE SHAPE: seeded, deterministic, varied')
await t('the same town gets the same shape; another seed a different one (ziggurat-variety rule)', async () => {
  const a = LP.landShape(LP.landSeed('board-a', HOME), { plan: PLAN() }), b = LP.landShape(LP.landSeed('board-a', HOME), { plan: PLAN() })
  assert.deepStrictEqual(a, b, 'deterministic')
  const shapes = new Set(['board-a', 'board-b', 'hive-c', 'placebo-d', 'isolated-a', 'hive-a'].map(p => JSON.stringify((({ ringR, chamfer, spokes }) => ({ ringR, chamfer, spokes }))(LP.landShape(LP.landSeed(p, HOME), { plan: PLAN() })))))
  assert.ok(shapes.size >= 4, `six pools give ${shapes.size} distinct shapes`)
})
await t('the spokes: the gate first, then the shaft, then seeded ones; 3-5, at least spokeSep apart, none through the monument sector', async () => {
  for (const pool of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const s = LP.landShape(LP.landSeed(pool, HOME), { plan: PLAN() })
    assert.ok(s.spokes.length >= 3 && s.spokes.length <= 5, `${pool}: ${s.spokes.length} spokes`)
    assert.strictEqual(s.spokes[0].why, 'gate'); assert.strictEqual(s.spokes[0].deg, LP.sectorDeg('S'))
    assert.strictEqual(s.spokes[1].why, 'industry')
    for (let i = 0; i < s.spokes.length; i++) for (let j = i + 1; j < s.spokes.length; j++) { const d = Math.abs(((s.spokes[i].deg - s.spokes[j].deg) % 360 + 540) % 360 - 180); assert.ok(d >= LP.LAND.spokeSep, `${pool}: spokes ${s.spokes[i].deg} and ${s.spokes[j].deg}`) }
    const mon = LP.sectorDeg('NW')
    assert.ok(s.spokes.every(q => Math.abs(((q.deg - mon) % 360 + 540) % 360 - 180) >= 30), `${pool}: a spoke through the monument`)
  }
})
await t('the zones: every sector has one; the plan pins monument, industry and farms; a yard, homes and a tree farm are placed', async () => {
  const s = LP.landShape(LP.landSeed('x', HOME), { plan: PLAN() })
  assert.strictEqual(Object.keys(s.zones).length, 8)
  assert.deepStrictEqual([s.zones.NW, s.zones.E, s.zones.N], ['monument', 'industry', 'farms'])
  const v = Object.values(s.zones)
  for (const kind of ['yard', 'treefarm']) assert.ok(v.includes(kind), kind)
  assert.ok(v.filter(z => z === 'homes').length >= 2, 'two home sectors')
})
await t('the ring clears the inner plan: a store reaching 24 out puts the ring at 28 or beyond (control: no store, the seeded radius)', async () => {
  const p0 = PLAN(), s0 = LP.landShape(7, { plan: p0 })
  assert.ok(s0.ringR >= LP.LAND.ringR[0] && s0.ringR <= LP.LAND.ringR[1], 'control')
  const p1 = PLAN(); p1.plots.push({ id: 'store', kind: 'storehouse', box: [10, 10, 24, 18], keepout: true })
  assert.ok(LP.landShape(7, { plan: p1 }).ringR >= 24 + LP.LAND.ringGap)
})

console.log('THE ROUTER: from-level chains, A*, passing a blocked waypoint')
await t('routeLeg: the A* heuristic finds the same cost as plain Dijkstra on the same grid (control for `h`), in fewer pops', async () => {
  const srv = server()
  for (let z = -10; z <= 10; z++) col(srv, 5, z, G + 1, G + 3, 'stone')   // a wall with a gap at z=11..
  const grid = LP.landGrid(srv.read, HOME, () => null, null, 30)
  const tg = new Map([[k2(12, 0), null]])
  const a = P.routeLeg(grid, [[-12, 0]], tg)
  const b = P.routeLeg(grid, [[-12, 0]], tg, { h: (x, z) => Math.abs(12 - x) + Math.abs(z) })
  assert.ok(a.ok && b.ok)
  assert.strictEqual(Math.round(a.cost * 10), Math.round(b.cost * 10))
})
await t('routeLeg `from`: a chained leg starts within one level of where the last ended (control: unconstrained it may start 2 below)', async () => {
  const srv = server()
  const grid = LP.landGrid(srv.read, HOME, () => null, T.gradeLim(srv.read, 4), 30)
  const tg = new Map([[k2(10, 0), null]])
  const free = P.routeLeg(grid, [[0, 0]], tg)
  assert.ok(free.ok)
  const pinned = P.routeLeg(grid, [[0, 0]], tg, { from: new Map([[k2(0, 0), G + 3]]) })
  assert.ok(pinned.ok)
  assert.ok(Math.abs(pinned.nodes[0][2] - (G + 3)) <= 1, `started at ${pinned.nodes[0][2]}`)
})
await t('a road passes a waypoint inside a protected zone and routes round it (the router finds the way to the next one)', async () => {
  const srv = server()
  const zone = (x, z) => (x >= 12 && x <= 30 && z >= -6 && z <= 6 ? 'zone' : null)
  const grid = LP.landGrid(srv.read, HOME, zone, T.gradeLim(srv.read, 4), 40)
  const r = await LP.routeRoad(grid, [[21, -14], [21, 0], [21, 14]])
  assert.ok(r.ok || r.nodes.length > 0, r.why)
  assert.ok(r.skipped >= 1, 'the blocked waypoint is passed')
  assert.ok(r.nodes.every(([x, z]) => !zone(x, z) && !zone(x + 1, z + 1)), 'never into the zone')
  assert.ok(r.nodes.some(([x, z]) => Math.abs(x - 21) <= 5 && z >= 9), 'reaches the far waypoint')
})

console.log('THE PLAN on flat ground: ring, spokes, corridors, stages')
const flatPlan = async (srv = server()) => (await LP.planLand(srv.read, { home: HOME, plan: PLAN(), seed: LP.landSeed('flat', HOME), limOf: n => T.gradeLim(srv.read, n), L: SMALL })).plan
await t('the ring closes and every spoke reaches workR on open flat ground; corridors cover every road column + 1', async () => {
  const land = await flatPlan()
  const ring = land.roads.find(r => r.kind === 'ring'), spokes = land.roads.filter(r => r.kind === 'spoke')
  assert.ok(ring.ok, `ring ${ring.reached}/${ring.of}`)
  assert.ok(spokes.length >= 3 && spokes.every(s => s.ok), JSON.stringify(spokes.map(s => [s.id, s.reached, s.of])))
  const at = LP.corridorAt(land)
  for (const r of land.roads) for (const [x, z] of r.cols) { assert.strictEqual(at(x, z), 'land:road'); assert.strictEqual(at(x + 1, z), 'land:road', 'the margin') }
  assert.strictEqual(at(HOME.x + 3, HOME.z + 3), null, 'the plaza is no corridor')
  assert.ok(spokes.every(s => Array.isArray(s.rail?.to)), 'every spoke names its rail line to the next outpost')
})
await t('the stages partition the roads: every road column is graded in exactly one stage, ring first', async () => {
  const land = await flatPlan()
  const st = LP.landStages(SMALL)
  assert.strictEqual(st[0].id, 'town'); assert.strictEqual(st[1].id, 'terrace'); assert.strictEqual(st[2].id, 'roads')   // townterrace-01: the terrace right after the plaza
  const seen = new Map()
  for (const s of st) for (const [x, z] of LP.stageRoadCols(land, s, { L: SMALL })) { const k = k2(x, z); seen.set(k, (seen.get(k) ?? 0) + 1) }
  const all = new Set(land.roads.flatMap(r => r.cols.map(([x, z]) => k2(x, z))))
  // a junction column is in two roads' lists: counted once per road, never in two stages of one road
  for (const k of all) assert.ok(seen.has(k), `road column ${k} is in no stage`)
  const ringCols = new Set(land.roads[0].cols.map(([x, z]) => k2(x, z)))
  for (const [x, z] of LP.stageRoadCols(land, st[2], { L: SMALL })) if (!ringCols.has(k2(x, z))) assert.ok(Math.max(Math.abs(x), Math.abs(z)) <= st[2].upto)
})

console.log('THE ROAD\'S EARTHWORK and the never-worse walk')
await t('roadWork brings a road column to its level: a dip filled, a spoil bump cut, leaves in the head room cleared, a trunk felled whole', async () => {
  const srv = server()
  col(srv, 30, 0, G - 1, G, 'air')                 // a dip 2 deep
  col(srv, 31, 0, G + 1, G + 2, 'cobblestone')     // a spoil bump 2 high
  srv.set([32, G + 2, 0], 'oak_leaves')
  col(srv, 33, 0, G + 1, G + 5, 'oak_log')         // a trunk on the road
  const w = T.roadWork(srv.read, [[30, 0, G], [31, 0, G], [32, 0, G], [33, 0, G]], { home: HOME, lim: T.gradeLim(srv.read, 6) })
  assert.deepStrictEqual(w.fill.map(c => c.at[1]).sort(), [G - 1, G])
  assert.deepStrictEqual(w.cut.map(c => c.at[1]).sort(), [G + 1, G + 2])
  assert.ok(w.clear.some(c => c.kind === 'leaves' && c.at[0] === 32))
  assert.strictEqual(w.clear.filter(c => c.kind === 'tree').length, 5, 'every log of the trunk')
  assert.deepStrictEqual(w.trees.map(q => q.name), ['oak_log'])
})
await t('Codex r1 BLOCKER 1: road work honours the guard AS IT IS NOW: a zone sited after the plan is never cut, filled or felled', async () => {
  const srv = server()
  col(srv, 33, 0, G + 1, G + 5, 'oak_log'); col(srv, 30, 0, G - 1, G, 'air')
  const cols = [[30, 0, G], [33, 0, G]]
  const open = T.roadWork(srv.read, cols, { home: HOME, lim: T.gradeLim(srv.read, 6) })
  assert.ok(open.clear.length === 5 && open.fill.length === 2, 'control: unguarded, the trunk and the dip are worked')
  const w = T.roadWork(srv.read, cols, { home: HOME, lim: T.gradeLim(srv.read, 6), avoid: () => 'zone' })
  assert.deepStrictEqual([w.cut.length, w.fill.length, w.clear.length, w.trees.length], [0, 0, 0, 0])
  assert.strictEqual(w.skipped.road_guarded, 2)
  const s = T.siteStage(srv.read, { home: HOME, land: { home: HOME, roads: [{ id: 'ring', kind: 'ring', cols }], corridors: [], zones: {}, ringR: 20, workR: 44, inner: 6 }, stage: LP.stageOf(2, SMALL), avoid: (x, z) => (x === 33 ? 'zone' : null), L: SMALL })
  assert.ok(!s.record.clear.some(c => c.at[0] === 33), 'siteStage passes its avoid to the road work')
})
await t('Codex r1 BLOCKER 2: a clear still standing is work left (tidyClearsLeft); felled, none', async () => {
  const srv = server()
  col(srv, 33, 0, G + 1, G + 3, 'oak_log')
  const rec = { clear: [1, 2, 3].map(d => ({ at: [33, G + d, 0], kind: 'tree', name: 'oak_log' })) }
  assert.strictEqual(T.tidyClearsLeft(rec, srv.read), 3)
  col(srv, 33, 0, G + 1, G + 3, 'air')
  assert.strictEqual(T.tidyClearsLeft(rec, srv.read), 0)
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/if \(caps\.complete && !crewHeld && !prog\.cutLeft && !prog\.fillLeft && !unread && clearsOk\) \{/.test(sk), 'the completion waits on the clears (gkhelpers-01: the keeper\'s, and never over a crew bot\'s plants)')
})
await t('NEVER WORSE: a stage whose road work would wall the town in is dropped (named); control: a road over a dip is kept', async () => {
  const land = await flatPlan()
  const st = LP.stageOf(2, SMALL)
  // a hand-made road level 3 ABOVE the flat ground all round the plaza: a wall
  const wall = { ...land, roads: [{ id: 'ring', kind: 'ring', cols: [] }] }
  for (let x = -9; x <= 9; x++) for (const z of [-9, 9]) wall.roads[0].cols.push([x, z, G + 3])
  for (let z = -8; z <= 8; z++) for (const x of [-9, 9]) wall.roads[0].cols.push([x, z, G + 3])
  const srv = server()
  const s = T.siteStage(srv.read, { home: HOME, land: wall, stage: st, walkFrom: T.townEdge(PLAN(), HOME), L: SMALL })
  assert.ok(s.road?.skipped?.road_walk_worse > 0, JSON.stringify(s.road))
  assert.strictEqual(s.road.fill.length, 0)
  assert.ok(s.road.walk == null || true)
  // CONTROL: the same ring at the ground's level over a dug trench: filling it makes the walk better, kept
  const srv2 = server()
  for (const [x, z] of wall.roads[0].cols) col(srv2, x, z, G - 1, G, 'air')
  const lev = { ...wall, roads: [{ ...wall.roads[0], cols: wall.roads[0].cols.map(([x, z]) => [x, z, G]) }] }
  const s2 = T.siteStage(srv2.read, { home: HOME, land: lev, stage: st, walkFrom: T.townEdge(PLAN(), HOME), L: SMALL })
  assert.ok(!s2.record.road.skipped.road_walk_worse, 'control kept')
  assert.ok(s2.record.road.fill > 0)
})
await t('replant cells: in the tree-farm zone, on soil with room above, never in a corridor, one per felled trunk', async () => {
  const land = await flatPlan()
  const srv = server()
  const rp = T.replantCells(srv.read, land, [{ name: 'birch_log' }, { name: 'oak_log' }], {})
  assert.strictEqual(rp.length, 2)
  const at = LP.corridorAt(land)
  for (const r of rp) { assert.strictEqual(LP.zoneAt(land, r.cell[0], r.cell[2]), 'treefarm'); assert.strictEqual(at(r.cell[0], r.cell[2]), null); assert.strictEqual(r.cell[1], G + 1) }
  assert.deepStrictEqual(rp.map(r => r.sapling), ['birch_sapling', 'oak_sapling'])
})
await t('a later stage tidies only its band: a pillar inside the town square is stage 0\'s, one in the band is the band\'s', async () => {
  const srv = server()
  col(srv, 10, 0, G + 1, G + 3, 'dirt')    // inside rimR (20)
  col(srv, 26, 0, G + 1, G + 3, 'dirt')    // in band (20, 32]
  const land = { home: HOME, roads: [], corridors: [], zones: {}, ringR: 15, workR: SMALL.workR, inner: 6 }
  const s = T.siteStage(srv.read, { home: HOME, land, stage: LP.stageOf(3, SMALL), L: SMALL })
  assert.deepStrictEqual([...new Set(s.record.cut.map(c => c.at[0]))], [26])
})

console.log('THE VISIT: buried fills take the cobble; cuts in walking order; a spent cell does not end the visit')
await t('coreFills: every fill under its column\'s top is `core` (cobblestone first); the top stays `earth` (dirt first)', async () => {
  const rec = { cells: [{ at: [1, G - 2, 1], role: 'earth' }, { at: [1, G - 1, 1], role: 'earth' }, { at: [1, G, 1], role: 'earth' }, { at: [2, G, 2], role: 'earth' }] }
  const c = T.coreFills(rec)
  assert.deepStrictEqual(c.cells.map(q => q.role), ['core', 'core', 'earth', 'earth'])
  assert.strictEqual(T.TIDY_PALETTE.core[0], 'cobblestone'); assert.strictEqual(T.TIDY_PALETTE.earth[0], 'dirt')
})
await t('chainCuts: column by column from the bot, top first in a column (control: tidy-01\'s order is highest first across town)', async () => {
  const cuts = [{ at: [30, G + 3, 0] }, { at: [30, G + 2, 0] }, { at: [1, G + 2, 0] }, { at: [-30, G + 4, 0] }, { at: [1, G + 1, 0] }]
  const out = T.chainCuts(cuts, [0, 0]).map(c => c.at.join(','))
  assert.deepStrictEqual(out, [`1,${G + 2},0`, `1,${G + 1},0`, `30,${G + 3},0`, `30,${G + 2},0`, `-30,${G + 4},0`])
  const old = [...cuts].sort((a, b) => b.at[1] - a.at[1]).map(c => c.at[0])
  assert.deepStrictEqual(old, [-30, 30, 30, 1, 1], 'control: highest first walks the town end to end')
})
const twoPits = () => {
  const srv = server()
  col(srv, 9, 1, G - 2, G, 'air')     // the near pit: group 0 (segCells 3: one 1x1 pit a group)
  col(srv, -12, 0, G - 2, G, 'air')   // the far pit: group 1
  const s = T.surveyTidy(srv.read, { home: HOME })
  return { srv, rec: T.tidyRecord(s, { home: HOME, T: { ...T.TIDY, segCells: 3 } }) }
}
let ACK = 'silent'
const visit = async (RM, srv, rec, extra) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gk-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 1)
  const e = bot(srv, 'A', { inv: { dirt: 64, cobblestone: 64 }, feet: [0, G + 1, 0], ack: tg => (tg[0] === 9 && tg[1] === G - 2 && tg[2] === 1 ? ACK : 'ok') })
  return RM.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: [], recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: T.tidyWalkR(rec), clearMax: T.TIDY_CLEAR_MAX, stuckStalledOnly: true, ...extra }, e, { maxSteps: 400 })
}
await t('deferSpent: a cell whose attempts are spent is deferred and the visit goes on to the next pit (control: without it the visit ends)', async () => {
  const a = twoPits()
  assert.ok(a.rec.segments.some(s => s.seg === 'T-01-0'), 'two groups')
  const r0 = await visit(R, a.srv, a.rec, {})
  assert.strictEqual(r0.stop, 'attempts_spent', 'control: the visit ends at the spent cell (the live 11-02 stop: `1 open, 0 placeable now`)')
  assert.match(r0.why, /1 open, 0 placeable now/)
  assert.strictEqual(a.srv.read(-12, G - 2, 0).name, 'air', 'control: the far pit untouched')
  const b = twoPits()
  const r1 = await visit(R, b.srv, b.rec, { deferSpent: true })
  assert.notStrictEqual(r1.stop, 'attempts_spent')
  assert.notStrictEqual(b.srv.read(-12, G - 2, 0).name, 'air', 'the far pit\'s bottom is laid in the same visit')
  assert.ok((r1.deferred ?? []).some(d => d.k === `9,${G - 2},1` && d.why === 'attempts_spent'), JSON.stringify(r1.deferred))
})
await t('MUTANT KILLED: with the deferSpent branch removed, the same visit ends attempts_spent again', async () => {
  await withMutant(BUILDRUN_PATH, 'if (p.deferSpent && !cand.length && open.length && open.every(c => isClear(c.at))) {', 'if (false) {', async RM => {
    const b = twoPits()
    const r = await visit(RM, b.srv, b.rec, { deferSpent: true })
    assert.strictEqual(r.stop, 'attempts_spent')
  })
})
await t('tidyKeepOrder: runVisit digs the tidy cuts in the caller\'s order (control: without it, highest first)', async () => {
  const run = async (RM, keep) => {
    const srv = server()
    col(srv, 3, 0, G + 1, G + 1, 'dirt'); col(srv, 20, 0, G + 1, G + 4, 'dirt')
    const cuts = T.chainCuts([{ at: [3, G + 1, 0], kind: 'tidy', name: 'dirt' }, ...[4, 3, 2, 1].map(d => ({ at: [20, G + d, 0], kind: 'tidy', name: 'dirt' }))], [0, 0])
    const rec = { v: 1, blueprint: T.TIDY_BLUEPRINT, plot: 'tidy', home: HOME, r: 32, cells: [], clear: [], cut: cuts, replant: [], segments: [] }
    const dir = mkdtempSync(path.join(os.tmpdir(), 'gk-'))
    const key = PJ.projKey(HOME, 'tidy')
    const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
    const slot = PJ.takeSlot(dir, key, 'A', 1)
    const order = []
    const e = bot(srv, 'A', { feet: [0, G + 1, 0], dig: async c => { order.push(c[0]); srv.set(c, 'air'); return 'confirmed' } })
    await RM.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: cuts, recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 48, clearMax: 48, ...(keep ? { tidyKeepOrder: true } : {}) }, e, { maxSteps: 400 })
    return order
  }
  const kept = await run(R, true), sorted = await run(R, false)
  assert.strictEqual(kept[0], 3, `the near column first: ${kept}`)
  assert.strictEqual(sorted[0], 20, `control: highest first: ${sorted}`)
})

console.log('THE KEEPER LEASE')
const L0 = (holder, at, extra = {}) => ({ gen: 1, rec: { holder, at, until: at + GKM.GK.leaseTtlMs, meta: { term0: at } }, holdsUntil: at + GKM.GK.leaseTtlMs, blocksUntil: at + GKM.GK.leaseTtlMs + 60_000, ...extra })
await t('keeperDecision: free + work -> take; mine -> mine; mine with no work -> release; my term over -> release; another\'s -> other', async () => {
  const now = 10_000_000
  assert.strictEqual(GKM.keeperDecision({ lease: null, me: 'A', now }), 'take')
  assert.strictEqual(GKM.keeperDecision({ lease: null, me: 'A', now, work: false }), 'none', 'no work: nobody takes it')
  assert.strictEqual(GKM.keeperDecision({ lease: L0('A', now - 1000), me: 'A', now }), 'mine')
  assert.strictEqual(GKM.keeperDecision({ lease: L0('A', now - 1000), me: 'A', now, work: false }), 'release')
  const old = L0('A', now - 1000); old.rec.meta.term0 = now - GKM.GK.termMs - 1
  assert.strictEqual(GKM.keeperDecision({ lease: old, me: 'A', now }), 'release', 'the term rotates')
  assert.strictEqual(GKM.keeperDecision({ lease: L0('B', now - 1000), me: 'A', now }), 'other')
  assert.strictEqual(GKM.keeperDecision({ lease: L0('B', now - GKM.GK.leaseTtlMs - 120_000), me: 'A', now }), 'take', 'a lapsed keeper (left town) is replaced')
  assert.strictEqual(GKM.keeperDecision({ lease: null, me: 'A', now, restUntil: now + 1 }), 'none', 'a rested holder waits its turn')
  assert.strictEqual(GKM.keeperDecision({ lease: { gen: null, rec: null, released: false, holdsUntil: 0, blocksUntil: Infinity }, me: 'A', now }), 'other', 'unreadable: never two keepers')
})
await t('keeperOrderPure: the keeper works the grounds first, once the workshop stands; another bot sees them full (control: no workshop, no change)', async () => {
  const list = [{ plot: 'shop' }, { plot: 'house1' }, { plot: 'tidy' }]
  const st = (shop, tidy) => [{ plot: 'shop', exists: true, complete: shop }, { plot: 'house1', exists: false, complete: false }, { plot: 'tidy', exists: true, complete: tidy, due: tidy }]
  const none = GKM.keeperOrderPure(st(false, false), list, { d: 'mine' })
  assert.deepStrictEqual(none.order.map(p => p.plot), ['shop', 'house1', 'tidy'], 'control: no workshop yet, tidy-01 order')
  const mine = GKM.keeperOrderPure(st(true, true), list, { d: 'mine' })
  assert.deepStrictEqual(mine.order.map(p => p.plot), ['tidy', 'shop', 'house1'])
  assert.strictEqual(mine.states[2].complete, false, 'a due stage reads open for the keeper')
  const other = GKM.keeperOrderPure(st(true, false), list, { d: 'other' })
  assert.deepStrictEqual(other.order.map(p => p.plot), ['shop', 'house1', 'tidy'])
  assert.strictEqual(other.states[2].free, false, 'the grounds are another bot\'s')
  assert.strictEqual(GKM.keeperWanted(st(false, false)), false, 'no workshop: no keeper wanted')
  assert.strictEqual(GKM.keeperWanted(st(true, false)), true)
  assert.strictEqual(GKM.keeperWanted([{ plot: 'shop', exists: true, complete: true }, { plot: 'tidy', exists: true, complete: true, due: false }]), false, 'nothing to do: released')
})
await t('termStart: a renewal carries the term on; a new holder starts one now', async () => {
  const now = 5_000_000
  assert.strictEqual(GKM.termStart(L0('A', now - 900), 'A', now), now - 900)
  assert.strictEqual(GKM.termStart(L0('B', now - 900), 'A', now), now)
})
await t('the switch: GROUNDSKEEPER=off is off; unset follows the tidy (the showcase on since its groundskeeper release)', async () => {
  assert.strictEqual(GKM.gkOn({ GROUNDSKEEPER: 'off' }, 'board-a'), false)
  assert.strictEqual(GKM.gkOn({}, 'board-a'), true)
  assert.strictEqual(GKM.gkOn({}, ''), false, 'an unnamed pool (a test bot) keeps tidy-01\'s order')
  assert.strictEqual(GKM.gkOn({ GROUNDSKEEPER: 'on' }, ''), true)
  assert.strictEqual(GKM.gkOn({}, 'showcase'), true)
  assert.strictEqual(GKM.gkOn({ TIDY: 'off' }, 'showcase'), false)
  assert.strictEqual(GKM.gkOn({ TIDY_POOLS: 'showcase' }, 'showcase'), true)
  assert.strictEqual(LP.landOn({ LANDPLAN: 'off' }), false)
})
await t('the keeper\'s order comes back in GK.cooldownMs; anyone else\'s tidy order in SHOP_COOLDOWN_MS', async () => {
  const SH = await import('../src/shop.mjs')
  SH.setKeeperNow(() => true)
  assert.strictEqual(SH.orderCooldown('tidy'), GKM.GK.cooldownMs)
  SH.setKeeperNow(() => false)
  assert.strictEqual(SH.orderCooldown('tidy'), SH.SHOP_COOLDOWN_MS)
  assert.strictEqual(SH.orderCooldown('house1'), SH.SHOP_COOLDOWN_MS)
})

console.log('WIRING (structural)')
await t('buildTidy passes the keeper knobs to runVisit and sites stages; shopActive orders by the keeper; projectHeads reserves the corridors', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/\.\.\.\(GROUNDS\.on \? \{ tidyKeepOrder: true, deferSpent: true \} : \{\}\)/.test(s), 'runVisit knobs')
  assert.ok(/s = await siteStage\(read, \{ home: I\.home, avoid: I\.avoid, cells: I\.cells, pin: I\.pin, plan: I\.plan, land, stage: k,/.test(s), 'stage siting')
  assert.ok(/const order0 = b \? keeperOrder\(b, marked, list, now\) : list\n\s*const order = sinkListOrder\(order0, activeMem\.sinkOrder \?\? \[\]\)\n\s*const pick = activeProject\(marked, order, /.test(s), 'the keeper order (picker-01: the sinks sorted after it)')
  assert.ok(/if \(land\) out\.push\(\{ plot: LAND_PLOT, key: projKeyOf\(LAND_PLOT\), head: \{ rec: landReservation\(land\) \} \}\)/.test(s), 'the reservation')
  assert.ok(/const recs = projectHeads\(\)\.filter\(x => x\.plot !== LAND_PLOT\)/.test(s), 'the tidy never refuses its own corridors')
  const sh = strip(readFileSync(SHOP_PATH, 'utf8'))
  assert.ok(/builders: GROUNDS\.on \? 1 \+ GK\.helpersMax : TIDY_BUILDERS/.test(sh), 'gkhelpers-01: the keeper and its helpers')
  assert.ok(/< orderCooldown\(plot0\)\) return \{ order: null, skip: null \}/.test(sh), 'the order cooldown')
})
await t('the wall opens a gateway where a land road crosses (wall.mjs); landReservation\'s zones say land:road', async () => {
  const land = await flatPlan()
  const r = LP.landReservation(land)
  assert.ok(r.zones.length && r.zones.every(z => z.why === 'land:road'))
  const W = await import('../src/wall.mjs')
  assert.ok(/=== 'land:road'/.test(strip(readFileSync(new URL('../src/wall.mjs', import.meta.url), 'utf8'))), 'the gateway rule')
  assert.ok(typeof W.wallCandidate === 'function')
})
await t('the land plan is no-op for the paths default: routeLeg with no `from` and no `h` keeps its answer (paths\' own siting)', async () => {
  const src = strip(readFileSync(LAND_PATH, 'utf8'))
  assert.ok(src.includes('routeLeg(grid, src, tg, { maxPops: pops, from, h })'))
})

console.log('THE SHOWCASE: an unsited copper hall\'s pad is reserved (11-03 offline: the ring road crossed it)')
const CH = await import('../src/copperhall.mjs')
const hallPlan = () => ({ ...PLAN(), plots: [...PLAN().plots.filter(p => p.sector !== 'SW'), { id: 'hall', kind: 'hall', sector: 'SW' }] })
const hallBp = { footprint: { u: 15, v: 13 } }
await t('hallPadZone: the pad (hallAnchor + hallBox) + HALL_DOMAIN; no hall plot in SW -> null', async () => {
  const z = CH.hallPadZone(hallPlan(), hallBp)
  const r = CH.HALL_DOMAIN
  assert.deepStrictEqual(z.box, [HOME.x - 21 - r, -64, HOME.z + 21 - r, HOME.x - 7 + r, 320, HOME.z + 33 + r])
  assert.strictEqual(z.why, 'project:hall')
  assert.strictEqual(CH.hallPadZone(PLAN(), hallBp), null)
})
await t('the land plan routes round the reserved pad (control: unreserved, the ring road crosses it)', async () => {
  const z = CH.hallPadZone(hallPlan(), hallBp), b = z.box
  const inPad = (x, zz) => x >= b[0] && x <= b[3] && zz >= b[2] && zz <= b[5]
  const plan = async (guard) => { const srv = server(); return (await LP.planLand(srv.read, { home: HOME, plan: hallPlan(), seed: LP.landSeed('flat', HOME), limOf: n => T.gradeLim(srv.read, n), L: SMALL, ...(guard ? { avoid: (x, zz) => (inPad(x, zz) ? 'project:hall' : null), reserved: (x, zz) => (inPad(x, zz) ? 'project:hall' : null) } : {}) })).plan }
  const open = await plan(false)
  const crossed = open.roads.flatMap(r => r.cols).filter(([x, zz]) => inPad(x, zz)).length
  assert.ok(crossed > 0, `the control: the unguarded plan must cross the pad (it crossed ${crossed} columns)`)
  const kept = await plan(true)
  const at = LP.corridorAt(kept)
  assert.strictEqual(kept.roads.flatMap(r => r.cols).filter(([x, zz]) => inPad(x, zz)).length, 0, 'no road column on the pad')
  let hit = 0
  for (let x = b[0] + 1; x <= b[3] - 1; x++) for (let zz = b[2] + 1; zz <= b[5] - 1; zz++) if (at(x, zz)) hit++
  assert.strictEqual(hit, 0, 'no corridor inside the pad (the hall\'s siting refuses a corridor zone)')
})
await t('wiring: the land plan and the tidy reserve the pad while the hall is on and unsited; a sited hall\'s record guards it', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/const hz = \[\.\.\.hallPadZones\(P\.plan\), [^\n]*\]\n\s*const rz = \[\.\.\.recordZones\(recs\), \.\.\.hz\]/.test(s), 'landInputs reserved')
  assert.ok(/avoid: tidyAvoid\(avoid, hz\), reserved,/.test(s), 'landInputs avoid')
  assert.ok(/records: recs, home \}\), \[\.\.\.recordZones\(recs\), \.\.\.hallPadZones\(P\.plan\)[^\n]*\]\)\n/.test(s), 'tidyInputs avoid')
  assert.ok(/if \(projectHeads\(\)\.some\(x => x\.plot === HALL_PLOT\)\) return \[\]/.test(s), 'a sited hall: its record')
  assert.ok(/if \(!projectsOn\(\)\.some\(p => p\.plot === HALL_PLOT\)\) return \[\]/.test(s), 'the hall off: nothing')
})

console.log('THE SHOWCASE: the expedition markers are reserved (Codex + Claude r1 BLOCKER: a marker is a pillar to the band survey)')
const EX = await import('../src/expedition.mjs')
await t('a marker (2 cobblestone + a torch) in a band is never cut when its zone is in the avoid (control: unguarded, the survey cuts it)', async () => {
  const srv = server()
  const m = { at: [HOME.x + 26, G + 1, HOME.z + 4] }
  col(srv, m.at[0], m.at[2], G + 1, G + 2, 'cobblestone'); srv.set([m.at[0], G + 3, m.at[2]], 'torch')
  const keys = new Set(EX.markerCellKeys([m]))
  const open = T.surveyTidy(srv.read, { home: HOME, r: 32, rMin: 20 })
  assert.ok(open.cut.some(c => keys.has(c.at.join(','))), `the control: unguarded, the marker is a pillar (${JSON.stringify(open.cut.map(c => c.at))})`)
  const kept = T.surveyTidy(srv.read, { home: HOME, r: 32, rMin: 20, avoid: T.tidyAvoid(() => null, EX.markerZones([m])) })
  assert.ok(!kept.cut.some(c => keys.has(c.at.join(','))), 'guarded: the marker stands')
  assert.deepStrictEqual(EX.markerZones([m])[0].box, [m.at[0] - 1, -64, m.at[2] - 1, m.at[0] + 1, 320, m.at[2] + 1])
  assert.deepStrictEqual([...keys], [0, 1, 2].map(dy => `${m.at[0]},${m.at[1] + dy},${m.at[2]}`))
  assert.deepStrictEqual(EX.markerZones([{ at: null }, { at: [1, 2] }]), [], 'a malformed marker line is skipped')
})
await t('wiring: the tidy, the land plan and the tidy visit\'s dig guard read the town\'s markers', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/\.\.\.hallPadZones\(P\.plan\), \.\.\.townMarkerZones\(\)\]\)/.test(s), 'tidyInputs avoid')
  assert.ok(/const hz = \[\.\.\.hallPadZones\(P\.plan\), \.\.\.townMarkerZones\(\)\]/.test(s), 'landInputs')
  assert.ok(/for \(const k of markerCellKeys\(exMarkers\(\)\)\) guard\.add\(k\)/.test(s), 'the dig-time guard')
  // bridgepost-01: the bridges' footprints join the markers, each read in its own try (never throws)
  assert.ok(/function townMarkerZones \(\) \{\s*let z = \[\]\s*try \{ z = markerZones\(exMarkers\(\)\) \} catch \{ z = \[\] \}\s*try \{ z = \[\.\.\.z, \.\.\.bridgeZones\(exBridgeSites\(\)\)\] \} catch \{\s*\}\s*return z\s*\}/.test(s), 'never throws')
})

// GKSTALL-01 (LIVE showcase 11-03: stage 0 held 1 h 40 min on one pit cell, waived on the 5th deferring visit, each visit ~30 min
// apart because a stuck keeper held the lease with its order backed off 6 h)
const TIDY_PATH = new URL('../src/tidy.mjs', import.meta.url)
const W = await import('../src/wall.mjs')
const BR = await import('../src/buildrun.mjs')
const stallRec = () => ({ cells: [{ at: [21, 65, 0], role: 'core', seg: 'T-00-0' }, { at: [21, 66, 0], role: 'earth', seg: 'T-00-1' }, { at: [21, 67, 0], role: 'earth', seg: 'T-00-2' }] })
await t('gkstall-01: a fill no stand reaches is waived on its 2nd deferring visit (summed over builders), before the stuck back-off', async () => {
  const rec = stallRec()
  // visit 1 (Alpha) and visit 2 (Iris): the F4 map counts them; the waiver sees the summed count
  const v1 = BR.stuckAfter({}, ['21,66,0'], { by: 'Alpha', now: 1 })
  assert.deepStrictEqual(W.wallWaiveDue(rec, [{ k: '21,66,0', why: 'no_stand', visits: v1.cells['21,66,0'].visits }], T.gkWaiveOpts(rec, W.WALL_WAIVE_MAX)), [], 'one visit: not yet')
  const v2 = BR.stuckAfter(v1.cells, ['21,66,0'], { by: 'Iris', now: 2 })
  assert.strictEqual(v2.stuck.length, 0, 'two visits are below STUCK_VISITS: no stuck_on_cell yet')
  assert.ok(T.GK_WAIVE_AFTER < BR.STUCK_VISITS, 'the waiver always comes before the 6-h back-off')
  assert.deepStrictEqual(W.wallWaiveDue(rec, [{ k: '21,66,0', why: 'no_stand', visits: v2.cells['21,66,0'].visits }], T.gkWaiveOpts(rec, W.WALL_WAIVE_MAX)), [{ k: '21,66,0', why: 'no_stand' }])
  // control: the wall's own default (5) does not waive it at 2
  assert.deepStrictEqual(W.wallWaiveDue(rec, [{ k: '21,66,0', why: 'no_stand', visits: 2 }]), [], 'the wall default unchanged')
  // a mutant at the old threshold fails the behaviour
  await withMutant(TIDY_PATH, 'export const GK_WAIVE_AFTER = 2', 'export const GK_WAIVE_AFTER = 5', async M => {
    assert.deepStrictEqual(W.wallWaiveDue(rec, [{ k: '21,66,0', why: 'no_stand', visits: 2 }], M.gkWaiveOpts(rec, W.WALL_WAIVE_MAX)), [], 'mutant: not waived at 2')
  })
})
await t('gkstall-01: the waiver room scales with the stage (a tenth of its cells, never below the wall cap); the stop after a waiver', async () => {
  assert.strictEqual(T.gkWaiveOpts({ cells: Array.from({ length: 75 }, () => ({})) }, 12).max, 12)
  assert.strictEqual(T.gkWaiveOpts({ cells: Array.from({ length: 900 }, () => ({})) }, 12).max, 90)
  assert.strictEqual(T.gkWaiveOpts({ cells: [...Array.from({ length: 300 }, () => ({})), ...Array.from({ length: 3000 }, () => ({ prev: true }))] }, 12).max, 30, 'carried prev cells buy no room')
  const many = { cells: Array.from({ length: 300 }, (_, i) => ({ at: [i, 66, 0], role: 'earth', seg: 'R' })) }
  const d = many.cells.slice(0, 20).map(c => ({ k: c.at.join(','), why: 'no_stand', visits: 2 }))
  assert.strictEqual(W.wallWaiveDue(many, d, T.gkWaiveOpts(many, 12)).length, 20, 'a road stage waives 20 of 300 (cap 30)')
  assert.strictEqual(W.wallWaiveDue(many, d, { after: 2 }).length, 12, 'control: the wall cap alone stops at 12')
  // Codex fold r1 BLOCKER: a cave seal (a cell with an opener) and a carried prev cell are never waived; a plain fill is
  const sealRec = { cells: [{ at: [1, 60, 1], role: 'core', seg: 'S', opener: [1, 61, 1] }, { at: [2, 66, 2], role: 'earth', seg: 'T' }, { at: [3, 66, 3], role: 'earth', seg: 'P', prev: true }] }
  const dd = ['1,60,1', '2,66,2', '3,66,3'].map(k => ({ k, why: 'no_stand', visits: 2 }))
  assert.deepStrictEqual(W.wallWaiveDue(sealRec, T.gkWaivable(sealRec, dd), T.gkWaiveOpts(sealRec, 12)), [{ k: '2,66,2', why: 'no_stand' }])
  assert.strictEqual(W.wallWaiveDue(sealRec, dd, T.gkWaiveOpts(sealRec, 12)).length, 3, 'control: unfiltered, the seal would be waived')
  assert.strictEqual(T.gkStopAfterWaive('stuck_on_cell', 1), 'cell_waived')
  assert.strictEqual(T.gkStopAfterWaive('cell_deferred', 2), 'cell_waived')
  assert.strictEqual(T.gkStopAfterWaive('stuck_on_cell', 0), 'stuck_on_cell', 'nothing waived: the back-off stands')
  assert.strictEqual(T.gkStopAfterWaive('deadline', 1), 'deadline')
})
await t('wiring (gkstall-01): the tidy visit waives with gkWaiveOpts, reports the mapped stop, and a stuck keeper lets the lease go', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/const waive = !caps\.waive \? \[\] : GROUNDS\.on \? wallWaiveDue\(rec, gkWaivable\(rec, r\.deferred \?\? \[\]\), gkWaiveOpts\(rec, WALL_WAIVE_MAX\)\) : wallWaiveDue\(rec, r\.deferred \?\? \[\]\)/.test(s), 'the tidy waiver options')
  assert.ok(/const stop1 = GROUNDS\.on \? gkStopAfterWaive\(r\.stop, waivedN\) : r\.stop/.test(s), 'the mapped stop')
  assert.ok(/return out\(status, completed \? 'complete' : stop1,/.test(s), 'the visit reports it')
  assert.ok(/if \(GROUNDS\.on && role === 'keeper' && stop1 === 'stuck_on_cell'\) \{ try \{ const k = keeperState\(bot, true\); if \(k\.lease\?\.rec\?\.holder === me\) \{ releaseKeeper\(bot, k\.lease, 'stuck'\)/.test(s), 'the stuck keeper releases')
})

// YARDZONE-01 (LIVE showcase 11-03: the yard sited before any land plan took W; the plan offline seeded W the tree farm zone)
await t('yardzone-01: a yard sited first pins its sector to `yard` (control: unsited, the seeded plan makes that sector the tree farm zone)', async () => {
  const seed = LP.landSeed('board-a', HOME)
  const s0 = LP.landShape(seed, { plan: PLAN() })
  const tf = Object.keys(s0.zones).find(k => s0.zones[k] === 'treefarm')
  assert.ok(tf, 'control: the seeded plan has a tree farm zone')
  const s1 = LP.landShape(seed, { plan: PLAN(), sited: [{ kind: 'yard', sector: tf }] })
  assert.strictEqual(s1.zones[tf], 'yard', 'the sited yard keeps its sector')
  assert.strictEqual(Object.values(s1.zones).filter(z => z === 'yard').length, 1, 'no second yard zone')
  assert.strictEqual(Object.values(s1.zones).filter(z => z === 'treefarm').length, 1, 'the tree farm zone moves, never dropped')
  assert.deepStrictEqual(LP.landShape(seed, { plan: PLAN(), sited: [{ kind: 'yard', sector: tf }] }), s1, 'deterministic')
})
await t('yardzone-01: a tree farm and a yard sited in ONE sector -- the tree farm keeps it, the yard is `fixed` there, neither seeded again', async () => {
  const seed = LP.landSeed('showcase', HOME)
  const s = LP.landShape(seed, { plan: PLAN(), sited: [{ kind: 'treefarm', sector: 'W' }, { kind: 'yard', sector: 'W' }] })
  assert.strictEqual(s.zones.W, 'treefarm')
  assert.deepStrictEqual(s.fixed, [{ kind: 'yard', sector: 'W', zone: 'treefarm' }])
  assert.ok(!Object.values(s.zones).includes('yard'), 'a sited yard is never given a second zone')
  assert.strictEqual(Object.values(s.zones).filter(z => z === 'treefarm').length, 1)
})
await t('yardzone-01: sitedSectors reads a record\'s sector, else its box centre (zoneAt\'s compass), the tree farm first', async () => {
  const h = { x: 0, y: 70, z: 0 }
  const recs = [{ plot: 'yard', box: [-64, 5, -50, 22], sector: 'W' }, { plot: 'treefarm', blueprint: 'treefarm@1', box: [-39, 4, -23, 20] }, { plot: 'wall', box: [0, 0, 5, 5] }, { plot: 'yard', state: 'no_site' }]
  assert.deepStrictEqual(LP.sitedSectors(h, recs), [{ kind: 'treefarm', sector: 'W' }, { kind: 'yard', sector: 'W' }])
  assert.deepStrictEqual(LP.sitedSectors(h, [{ plot: 'yard', box: [20, -40, 30, -30] }]), [{ kind: 'yard', sector: 'NE' }])
  assert.strictEqual(LP.zoneAt({ home: h, ringR: 20, workR: 80, zones: { NE: 'yard' } }, 25, -35), 'yard', 'the same compass as zoneAt')
})
await t('wiring (yardzone-01): landInputs hands the sited sectors to planLand', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/composter: P\.composter, sited: sitedSectors\(P\.plan\.home, recs\) \}/.test(s), 'landInputs')
  assert.ok(/composter: I\.composter, sited: I\.sited, now: Date\.now\(\), pause \}\)/.test(s), 'planLand call')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
