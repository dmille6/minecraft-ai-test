// TOWNMINE-01, THE TOWN MINE (shaftgeom.mjs mineRooms + planStair's extension, townmine.mjs, shaftvisit.mjs sealDeep, deepmine.mjs
// 'build'): the extended stair keeps every built cell, its rest bays and hall, the REAL mineflayer-pathfinder A* walking the town
// down to the hall and back, the stair's upkeep never reaching the deep part, a whole build on a fake world (a water pocket and a
// lava pocket sealed, never a stop), the galleries starting OUTSIDE the stair (the live iron-branch failure), the trip target.
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'townmine-pool-'))
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import * as G from '../src/shaftgeom.mjs'
import * as M from '../src/townmine.mjs'
import * as D from '../src/deepmine.mjs'
import { runStairVisit } from '../src/shaftvisit.mjs'
const require_ = createRequire(import.meta.url)
const { Movements, goals } = require_('mineflayer-pathfinder')
const AStar = require_('mineflayer-pathfinder/lib/astar')
const Move = require_('mineflayer-pathfinder/lib/move')
const { Vec3 } = require_('vec3')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const k3 = (x, y, z) => `${x},${y},${z}`
const SG = new URL('../src/shaftgeom.mjs', import.meta.url), TM = new URL('../src/townmine.mjs', import.meta.url)
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${old.slice(0, 70)}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

function world (g, { over = new Map() } = {}) {
  const at = new Map(over)
  const name = (x, y, z) => at.get(k3(x, y, z)) ?? (y <= g ? 'stone' : 'air')
  const BB = n => (/^(air|cave_air|water|lava|torch|wall_torch)$/.test(n) ? 'empty' : 'block')
  const read = (x, y, z) => { const n = name(x, y, z); return { name: n, boundingBox: BB(n) } }
  return { at, read, name, set: (c, n) => at.set(k3(...c), n) }
}
const SITE = (g = 70, away = 's') => ({ origin: G.originFor(100, 100, away), away, g, center: [100, 100] })
/** A finished town stair record (to the 16 landing) at ground g. */
const REC = (g = 70, away = 's') => {
  const site = SITE(g, away)
  const p = G.planStair(site)
  return { v: 1, blueprint: G.SHAFT_BLUEPRINT, plot: G.SHAFT_PLOT, site, K: p.K, landings: p.landings.map(l => l.feet), landings_built: p.landings.map(l => l.feet),
    exit: [0, 0, 0], state: 'complete', structure_complete: true, cells: p.cells.map(c => ({ at: c.at, role: c.role })) }
}
const MINED = (g = 70, away = 's') => M.withMine(REC(g, away), G.mineExt(g))
/** Build a plan's finished state into a world (air open, everything else stone); `upto` the last step (rooms with it). */
function finished (plan, w, { upto = Infinity } = {}) {
  for (const c of plan.cells) {
    if (c.role === 'fixture') continue
    if (c.role === 'air' && c.k > upto) continue
    w.set(c.at, c.role === 'air' ? 'air' : 'stone')
  }
  return w
}
const astar = (m, from, goal) => {
  const a = new AStar(new Move(from[0], from[1], from[2], 0, 0), m, goal, 40_000, 60, -1)
  let r = a.compute()
  while (r.status === 'partial') r = a.compute()
  return r
}
const movesFor = blockAt => {
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: new Vec3(0.5, 64, 0.5), effects: {} }, entities: {},
    inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot); m.canDig = false; m.allowParkour = false; m.allow1by1towers = false; m.scafoldingBlocks = []
  return m
}
const blockAtOf = w => p => { const b = Block.fromStateId(registry.blocksByName[w.name(p.x, p.y, p.z) === 'air' ? 'air' : 'stone'].defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b }

console.log('GEOMETRY: THE EXTENSION')
await t('the extension keeps every built cell where it was (air and tread), 4 orientations x 4 ground levels; the deep part reaches feet -53', () => {
  for (const away of ['n', 's', 'e', 'w']) for (const g of [63, 70, 77, 90]) {
    const p0 = G.planOf(REC(g, away)), p1 = G.planOf(MINED(g, away))
    assert.strictEqual(p1.s0, p0.s0)
    assert.strictEqual(p1.K, g + 54)
    assert.strictEqual(G.standOf(p1, p1.K)[1], G.MINE_BOTTOM_FEET, 'the bottom step\'s feet')
    for (const c of p0.cells) if (c.role !== 'lining') assert.strictEqual(p1.byKey.get(k3(...c.at))?.role, c.role, `${away} g=${g} ${c.role} ${c.at} moved`)
    // the only old lining that changes role is the deep stair's first step and the upper bays (they open beside the stair)
    const turned = p0.cells.filter(c => c.role === 'lining' && p1.byKey.get(k3(...c.at))?.role !== 'lining')
    const ok = new Set([...p1.steps[p0.K + 1].air.map(c => k3(...c)), ...p1.rooms.filter(r => r.k <= p0.K).flatMap(r => r.cols.flatMap(c => c.air.map(a => k3(...a))))])
    for (const c of turned) assert.ok(ok.has(k3(...c.at)), `${away} g=${g}: lining ${c.at} turned ${p1.byKey.get(k3(...c.at))?.role}`)
  }
})
await t('MUTANT KILLED: a phase taken from the extended step count moves the built stair', async () => {
  await withMutant(SG, '  const s0 = shape.s0\n  const keepFeet', '  const s0 = ext ? (((LANDING_CELL - K) % 8) + 8) % 8 : shape.s0\n  const keepFeet', async G2 => {
    const r = MINED(70, 's'), p0 = G.planOf(REC(70, 's')), p1 = G2.planOf(r)
    assert.ok(p0.cells.some(c => c.role !== 'lining' && p1.byKey.get(k3(...c.at))?.role !== c.role), 'the mutant moves cells')
  })
})
await t('roles are disjoint; rests (landings, bays, the hall) are at most 12 steps apart below the first; every bay sits on a side cell', () => {
  for (const away of ['n', 's', 'e', 'w']) for (const g of [63, 70, 77, 90]) {
    const p = G.planOf(MINED(g, away))
    const seen = new Map()
    for (const c of p.cells) { const k = k3(...c.at); assert.ok(!seen.has(k), `dup ${k} ${seen.get(k)}/${c.role}`); seen.set(k, c.role) }
    const rests = [...p.landings.map(l => l.k), ...p.rooms.map(r => r.k)].sort((a, b) => a - b)
    for (let i = 1; i < rests.length; i++) assert.ok(rests[i] - rests[i - 1] <= 12, `${away} g=${g}: ${rests[i - 1]} -> ${rests[i]}`)
    assert.strictEqual(rests.at(-1), p.K, 'the hall is the last rest')
    for (const r of p.rooms.filter(q => q.kind === 'bay')) assert.strictEqual((p.s0 + r.k) % 2, 1, 'a side cell')
  }
})
await t('the hall: 25 columns 3 high off the bottom step, outside the 3x3, its floor lined, its fixtures neither air nor lining, the portal unlined', () => {
  for (const away of ['n', 's', 'e', 'w']) {
    const p = G.planOf(MINED(70, away))
    const hall = p.rooms.find(r => r.kind === 'hall')
    assert.strictEqual(hall.cols.length, 25)
    const sq = new Set(); for (let u = 0; u <= 2; u++) for (let v = 0; v <= 2; v++) { const w = G.toWorld(p.origin, away, u, v); sq.add(`${w.x},${w.z}`) }
    const keys = new Set(hall.cols.map(c => k3(...c.air[0])))
    for (const c of hall.cols) {
      assert.strictEqual(c.air.length, 3)
      assert.ok(!sq.has(`${c.air[0][0]},${c.air[0][2]}`), 'outside the stair column')
      assert.strictEqual(p.byKey.get(k3(c.air[0][0], c.air[0][1] - 1, c.air[0][2]))?.role, 'lining', 'a lined floor')
      const s = c.stand
      const stepStand = G.standOf(p, hall.k)
      assert.ok(k3(...s) === k3(...stepStand) || keys.has(k3(...s)), 'the stand is the bottom step or another column')
      assert.strictEqual(Math.abs(s[0] - c.air[0][0]) + Math.abs(s[2] - c.air[0][2]), 1, 'the stand is a face neighbour')
    }
    for (const f of hall.fixtures) assert.strictEqual(p.byKey.get(k3(...f.at))?.role, 'fixture', f.item)
    assert.deepStrictEqual(hall.fixtures.map(f => f.item), ['crafting_table', 'chest', 'furnace'])
    assert.strictEqual(p.byKey.get(k3(...hall.portal.at)), undefined, 'the portal is not reserved')
  }
})

console.log('THE REAL PATHFINDER WALKS IT (mineflayer-pathfinder A*, canDig off, no towers, no parkour)')
await t('the collar -> the hall\'s far wall and back, and into every bay, for 4 orientations: success, no digs, inside the mine', () => {
  for (const away of ['n', 's', 'e', 'w']) {
    const rec = MINED(70, away), p = G.planOf(rec)
    const w = finished(p, world(70))
    const m = movesFor(blockAtOf(w))
    const exit = G.collarExit(w.read, p)
    const route = M.hallRoute(p)
    const end = route.at(-1)
    const down = astar(m, exit, new goals.GoalBlock(end[0], end[1], end[2]))
    assert.strictEqual(down.status, 'success', `${away} down: ${down.status}`)
    for (const n of down.path) if (n.y <= 70) assert.ok(p.air.has(k3(n.x, n.y, n.z)), `off the mine at ${n.x},${n.y},${n.z}`)
    assert.strictEqual(down.path.filter(n => n.toBreak?.length || n.toPlace?.length).length, 0)
    const up = astar(m, end, new goals.GoalBlock(exit[0], exit[1], exit[2]))
    assert.strictEqual(up.status, 'success', `${away} up: ${up.status}`)
    for (const r of p.rooms.filter(q => q.kind === 'bay')) {
      const b = r.cols.at(-1).air[0]
      assert.strictEqual(astar(m, G.standOf(p, r.k), new goals.GoalBlock(b[0], b[1], b[2])).status, 'success', `bay ${r.feet}`)
    }
  }
})
await t('POSITIVE CONTROL: one deep tread removed, the walk to the hall fails', () => {
  const p = G.planOf(MINED(70, 's'))
  const w = finished(p, world(70))
  const tr = p.steps[100].tread
  for (let d = 0; d < 4; d++) w.set([tr[0], tr[1] - d, tr[2]], 'air')
  const exit = G.collarExit(w.read, p), end = M.hallRoute(p).at(-1)
  assert.notStrictEqual(astar(movesFor(blockAtOf(w)), exit, new goals.GoalBlock(end[0], end[1], end[2])).status, 'success')
  assert.strictEqual(M.hallUsable(w.read, p).ok, false)
  assert.strictEqual(M.hallUsable(finished(p, world(70)).read, p).ok, true)
})

console.log('THE STAIR\'S UPKEEP STAYS ABOVE THE 16 LANDING')
await t('a mined record whose deep part is still rock is NOT damaged; an upper bay not cut is (the stair builder cuts the upper bays)', () => {
  const rec = MINED(70, 's'), p = G.planOf(rec)
  const w = finished(p, world(70), { upto: rec.K })
  assert.strictEqual(G.stairDamaged(w.read, rec), false)
  const bay = p.rooms.find(r => r.kind === 'bay' && r.k <= rec.K)
  w.set(bay.cols[1].air[0], 'stone')
  assert.strictEqual(G.stairDamaged(w.read, rec), true)
})
await t('MUTANT KILLED: without the bound the deep extension reads as damage (the town builder would be sent 100 steps down)', async () => {
  await withMutant(SG, "firstUndone(read, planOf(rec), { maxK: rec.K })", 'firstUndone(read, planOf(rec))', async G2 => {
    const rec = MINED(70, 's'), p = G.planOf(rec)
    assert.strictEqual(G2.stairDamaged(finished(p, world(70), { upto: rec.K }).read, rec), true)
  })
})

console.log('A WHOLE BUILD ON A FAKE WORLD')
function fx (w, feet0, { log = [] } = {}) {
  let feet = feet0
  const full = c => { const b = w.read(...c); return !!b && b.boundingBox === 'block' && !/water|lava/.test(b.name) }
  return {
    get read () { return w.read }, log: () => {},
    feet: () => feet,
    walkTo: async c => { const f = w.read(...c), h = w.read(c[0], c[1] + 1, c[2]), fl = w.read(c[0], c[1] - 1, c[2]); if (f?.boundingBox === 'empty' && h?.boundingBox === 'empty' && fl?.boundingBox === 'block' && !/water|lava/.test(f.name + h.name)) feet = c; return true },
    dig: async c => { log.push(['dig', c]); w.set(c, 'air'); return 'confirmed' },
    place: async c => { if (![[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, d]) => full([c[0] + a, c[1] + b, c[2] + d]))) return 'no_support'; log.push(['place', c]); w.set(c, 'cobblestone'); return 'confirmed' },
    placeItem: async (c, item) => { log.push(['item', item, c]); w.set(c, item); return 'confirmed' },
    toolOk: () => true, fence: () => true,
    torch: async (cell) => { log.push(['torch', cell]); w.set(cell, 'wall_torch'); return true },
    now: () => 0, aborted: () => false,
  }
}
const buildAll = async (rec, w, { sealDeep = true } = {}) => {
  const p = G.planOf(rec)
  const e = fx(w, G.standOf(p, rec.K))
  const stops = []
  let r, n = 0
  do { r = await runStairVisit({ rec, plan: p, exit: [0, 0, 0], built: new Set(rec.landings_built), onLanding: async () => true, onStop: async (k, why) => stops.push([k, why]), onDropLanding: async () => {} }, e, { unitsMax: 40, sealDeep }); n++ } while (r.stop === 'units' && n < 80)
  return { r, stops, e }
}
await t('from the 16 landing to a finished mine: every deep step, bay and the hall; a WATER pocket in a deep step and LAVA in the hall sealed, never a stop; torches two a turn', async () => {
  const rec = MINED(70, 's'), p = G.planOf(rec)
  const w = finished(p, world(70), { upto: rec.K })
  // air[0]: not beside the step above's air (nextOp 1b would seal that one anyway)
  const wet = p.steps[90].air[0], hot = p.rooms.find(r => r.kind === 'hall').cols[7].air[2]
  w.set(wet, 'water'); w.set(hot, 'lava')
  const log = []
  const e0 = fx(w, G.standOf(p, rec.K), { log })
  let r, n = 0
  do { r = await runStairVisit({ rec, plan: p, exit: [0, 0, 0], built: new Set(rec.landings_built), onLanding: async () => true, onStop: async () => { throw new Error('stopped') }, onDropLanding: async () => {} }, e0, { unitsMax: 40, sealDeep: true }); n++ } while (r.stop === 'units' && n < 80)
  assert.strictEqual(r.stop, 'complete', r.why)
  assert.strictEqual(G.firstUndone(w.read, p), null)
  assert.ok(log.some(([op, c]) => op === 'place' && k3(...c) === k3(...wet)), 'the water cell was sealed')
  assert.ok(log.some(([op, c]) => op === 'place' && k3(...c) === k3(...hot)), 'the lava cell was sealed')
  assert.strictEqual(w.name(...wet), 'air'); assert.strictEqual(w.name(...hot), 'air')
  const deepTorches = log.filter(([op, c]) => op === 'torch' && c[1] < 16).length
  assert.ok(deepTorches >= 14, `two a turn below the landing (${deepTorches})`)
  assert.strictEqual(M.hallUsable(w.read, p).ok, true)
})
await t('POSITIVE CONTROL: without sealDeep the same water pocket stops the stair there (the town stair\'s own rule above the landing)', async () => {
  const rec = MINED(70, 's'), p = G.planOf(rec)
  const w = finished(p, world(70), { upto: rec.K })
  w.set(p.steps[90].air[0], 'water')
  const { stops } = await buildAll(rec, w, { sealDeep: false })
  assert.deepStrictEqual(stops[0], [90, 'water'])
})
await t('above the 16 landing sealDeep changes nothing: a liquid in a step of the stair proper still stops it', async () => {
  const rec = MINED(70, 's'), p = G.planOf(rec)
  const w = finished(p, world(70), { upto: rec.K })
  for (const c of p.steps[30].air) w.set(c, 'stone')
  w.set(p.steps[30].tread, 'water')
  const { stops } = await buildAll(rec, w, { sealDeep: true })
  assert.deepStrictEqual(stops[0], [30, 'water'])
})
await t('the hall\'s fixtures: missing until placed; torches wanted, then none missing', () => {
  const rec = MINED(70, 's'), p = G.planOf(rec)
  const w = finished(p, world(70))
  assert.deepStrictEqual(M.fixturesMissing(w.read, p).map(f => [f.item, f.cleared]), [['crafting_table', false], ['chest', false], ['furnace', false]])
  for (const f of p.rooms.find(r => r.kind === 'hall').fixtures) w.set(f.at, f.item)
  assert.strictEqual(M.fixturesMissing(w.read, p).length, 0)
  const want = M.torchesMissing(w.read, p)
  assert.ok(want.length >= 30, `torches wanted (${want.length})`)
  for (const tc of want) w.set(tc.at, 'wall_torch')
  assert.strictEqual(M.torchesMissing(w.read, p).length, 0)
})
await t('a stopped extension moves the hall up to the last dry step; a stop at the landing ends the mine (state stopped)', () => {
  const rec = MINED(70, 's')
  const s1 = M.mineStopped(rec, 100, { now: 1 })
  const p1 = G.planOf(s1)
  assert.strictEqual(p1.K, 99)
  assert.strictEqual(p1.rooms.find(r => r.kind === 'hall').k, 99)
  assert.strictEqual(M.mineState(s1).sited, true)
  const s2 = M.mineStopped(rec, rec.K + 1, { now: 1 })
  assert.strictEqual(M.mineState(s2).stopped, true)
  assert.strictEqual(G.planOf(s2).K, rec.K, 'nothing below the landing is planned')
})

console.log('THE GALLERIES (the live iron-branch failure: 2,030 branches in 3 d started inside the stub and dug nothing)')
await t('no gallery cell is a cell of the mine (air, tread, lining, fixture); the iron spine starts at the 16 stub\'s end face', () => {
  for (const away of ['n', 's', 'e', 'w']) for (const g of [63, 70, 90]) {
    const p = G.planOf(MINED(g, away))
    for (const level of ['iron', 'diamond']) {
      const gal = M.galleryOf(p, level)
      assert.ok(gal, level)
      for (const s of gal.slots) for (const c of s.cells) for (const q of [c.feet, c.head]) assert.strictEqual(p.byKey.get(k3(...q)), undefined, `${away} g=${g} ${level} slot ${s.id} ${q} is ${p.byKey.get(k3(...q))?.role}`)
      assert.strictEqual(p.air.has(k3(...gal.stand)), true, 'the gallery is entered from the mine')
    }
    const l = p.landings.find(q => q.feet === 16)
    assert.deepStrictEqual(M.galleryOf(p, 'iron').slots[0].cells[0].feet, l.end[0])
  }
})
await t('MUTANT KILLED: a gallery that starts where the miner stands (inside the stub) opens the stair\'s own cells', async () => {
  await withMutant(TM, '    first = l.end[0]\n', '    first = l.cols[l.cols.length - 2].air[0]\n', async M2 => {
    const p = G.planOf(MINED(70, 's'))
    const gal = M2.galleryOf(p, 'iron')
    assert.ok(gal.slots.some(s => s.cells.some(c => p.byKey.has(k3(...c.feet)))), 'the mutant gallery hits the stair')
  })
})
await t('galleryNext: the spine first, then each side branch as the spine opens past it; a skipped or kept slot is passed over', () => {
  const p = G.planOf(MINED(70, 's'))
  const w = finished(p, world(70))
  const gal = M.galleryOf(p, 'iron')
  let n = M.galleryNext(w.read, gal)
  assert.deepStrictEqual([n.slot.id, n.i, k3(...n.stand)], [0, 0, k3(...gal.stand)])
  for (let i = 0; i < 4; i++) { w.set(gal.slots[0].cells[i].feet, 'air'); w.set(gal.slots[0].cells[i].head, 'air') }
  n = M.galleryNext(w.read, gal)
  assert.deepStrictEqual([n.slot.junction, n.slot.side, n.i, k3(...n.stand)], [2, 1, 0, k3(...gal.slots[0].cells[2].feet)])
  n = M.galleryNext(w.read, gal, { skip: id => id === 1 })
  assert.deepStrictEqual([n.slot.junction, n.slot.side], [2, -1])
  const kept = new Set(gal.slots[1].cells.concat(gal.slots[2].cells).map(c => k3(...c.feet)))
  n = M.galleryNext(w.read, gal, { forbid: c => (kept.has(k3(...c)) ? 'zone' : null) })
  assert.deepStrictEqual([n.slot.id, n.i], [0, 4], 'both branches kept: the spine goes on')
})
await t('the extension\'s siting refuses a protected cell; the old stair\'s cells are not asked', () => {
  const rec = REC(70, 's'), sited = MINED(70, 's')
  const p = G.planOf(sited)
  const oldKeys = new Set(rec.cells.map(c => c.at.join(',')))
  const deep = p.steps[110].air[0]
  assert.deepStrictEqual(M.mineSiteCheck(p, (x, y, z) => (k3(x, y, z) === k3(...deep) ? 'zone' : null), { oldKeys }).ok, false)
  const old = p.steps[5].air[0]
  assert.strictEqual(M.mineSiteCheck(p, (x, y, z) => (k3(x, y, z) === k3(...old) ? 'zone' : null), { oldKeys }).ok, true)
  assert.strictEqual(M.mineSiteRefusal(rec), null)
  assert.strictEqual(M.mineSiteRefusal(sited), 'sited')
  assert.strictEqual(M.mineSiteRefusal({ ...rec, structure_complete: false }), 'stair_unfinished')
  const ns = { ...rec, ext: { blueprint: G.MINE_BLUEPRINT, state: 'no_site', why: 'zone' } }
  assert.strictEqual(M.mineSiteRefusal(ns), 'sited', 'a refused site is not asked again')
  assert.strictEqual(M.mineState(ns).sited, false, 'and never builds')
  assert.strictEqual(G.planOf(ns).K, rec.K, 'nor plans anything below the landing')
})

console.log('THE DEEP MINER')
const kit = (o = {}) => ({ uses: 200, lowUses: 120, ironUses: 0, seal: 64, free: 20, diamonds: 0, rawIron: 0, torches: 16, ...o })
await t('tripTarget: an open mine is built first; finished, stopped, unsited or a thin bag: the trips as before', () => {
  assert.strictEqual(D.tripTarget(kit(), { sited: true, complete: false, stopped: false }), 'build')
  assert.strictEqual(D.tripTarget(kit(), { sited: true, complete: true, stopped: false }), 'iron')
  assert.strictEqual(D.tripTarget(kit(), { sited: true, complete: false, stopped: true }), 'iron')
  assert.strictEqual(D.tripTarget(kit(), null), 'iron', 'POSITIVE CONTROL: no mine, the trip as before')
  assert.strictEqual(D.tripTarget(kit({ uses: M.BUILD_USES - 1 }), { sited: true, complete: false, stopped: false }), 'iron')
  assert.strictEqual(D.tripTarget(kit({ seal: D.SEAL_MIN - 1 }), { sited: true, complete: false, stopped: false }), 'iron')
  assert.strictEqual(D.tripTarget(kit({ ironUses: 200, lowUses: 300 }), { sited: true, complete: true }), 'diamond')
})
await t('returnWhy for a build trip: home when built, on a full bag or no blocks; never on the ore clocks', () => {
  const now = 1_000_000
  const trip = { target: 'build', startedAt: now - 1000, calls: 2, misses: 9, branches: 9, arrivedAt: now - 1000 }
  assert.strictEqual(D.returnWhy(trip, { now, kit: kit() }), null)
  assert.strictEqual(D.returnWhy({ ...trip, built: true }, { now, kit: kit() }), 'built')
  assert.strictEqual(D.returnWhy(trip, { now, kit: kit({ free: 1 }) }), 'bag_full')
  assert.strictEqual(D.returnWhy(trip, { now, kit: kit({ seal: 2 }) }), 'seal_blocks')
  assert.strictEqual(D.returnWhy({ ...trip, target: 'iron' }, { now, kit: kit() }), 'no_ore', 'POSITIVE CONTROL: an iron trip with 9 misses goes home')
})
await t('a build trip holds the body between its calls; coal joins the work kinds only on a town-mine trip', () => {
  assert.strictEqual(D.tripHoldsBody({ phase: 'build', startedAt: Date.now() }), true)
  assert.deepStrictEqual(D.workKinds({ target: 'iron' }, 16), ['iron_ore', 'deepslate_iron_ore'])
  assert.deepStrictEqual(D.workKinds({ target: 'iron', coal: true }, 16), ['iron_ore', 'deepslate_iron_ore', 'coal_ore', 'deepslate_coal_ore'])
})
await t('the switch: on in the showcase pool by default, off in a fleet pool, TOWNMINE decides', () => {
  assert.strictEqual(M.townMineOn({}, 'showcase'), true)
  assert.strictEqual(M.townMineOn({}, 'hive-a'), false)
  assert.strictEqual(M.townMineOn({ TOWNMINE: 'off' }, 'showcase'), false)
  assert.strictEqual(M.townMineOn({ TOWNMINE_POOLS: '*' }, 'hive-a'), true)
})
await t('WIRED: the work phase digs the gallery when the trip has a level; the build phase runs deepMineBuild; sealDeep only there', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  for (const a of ['const b = level ? await deepGallery(ctx, trip, level, signal, deadline) : await deepBranch(ctx, trip, signal, deadline)',
    'const r = await deepMineBuild(ctx, trip, signal, deadline)', "fx.e, { deadline, unitsMax: MINE_BUILD_UNITS, sealDeep: true }))"]) assert.strictEqual(src.split(a).length, 2, a)
  assert.strictEqual(src.split('sealDeep: true').length, 2, 'sealDeep in the build only')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
