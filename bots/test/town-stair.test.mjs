// SHAFT-02, THE TOWN STAIR (shaftgeom.mjs, shaftvisit.mjs): the geometry walked by the REAL mineflayer-pathfinder 2.4.5 A* (the
// library code the fleet runs, canDig off, no parkour, no towers), the safety order of every mutation, whole visits on a fake
// world from bare rock to a finished stair, liquid stops, repairs, the use's landing choice and verification, the keep-out
// part, siting, and the design reviews' two blockers (a no-site never holds the town's build order; a stopped stair is never
// damaged forever).
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import * as G from '../src/shaftgeom.mjs'
import { runStairVisit } from '../src/shaftvisit.mjs'
import { activeProject } from '../src/shop.mjs'
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

// ---- a fake world: stone at and below ground g, air above; overrides in a Map ------------------------------------------
function world (g, { over = new Map(), unknownBelow = -999 } = {}) {
  const at = new Map(over)
  const base = (x, y, z) => (y <= g ? 'stone' : 'air')
  const name = (x, y, z) => at.get(k3(x, y, z)) ?? base(x, y, z)
  const BB = n => (/^(air|cave_air|water|lava|torch|wall_torch|short_grass)$/.test(n) ? 'empty' : 'block')
  const read = (x, y, z) => { if (y < unknownBelow) return null; const n = name(x, y, z); return { name: n, boundingBox: BB(n) } }
  return { at, read, name, set: (c, n) => at.set(k3(...c), n) }
}
/** Build the plan's finished state into a world (air open, treads and lining stone). */
function finished (plan, w) { for (const c of plan.cells) w.set(c.at, c.role === 'air' ? 'air' : 'stone'); return w }

const SITE = (g = 70, away = 's') => ({ origin: G.originFor(100, 100, away), away, g, center: [100, 100] })

console.log('GEOMETRY')
await t('every ground level 40..100: every landing sits on cell (1,2) at feet 48/32/16, the bottom feet is 16', () => {
  for (let g = 40; g <= 100; g++) {
    const sh = G.stairShape(g)
    assert.strictEqual(G.stairShape(g).K, g - 15)
    for (const l of sh.landings) {
      assert.strictEqual((sh.s0 + l.k) % 8, G.LANDING_CELL, `g=${g} landing ${l.feet}`)
      assert.strictEqual(g - l.k + 1, l.feet)
    }
    assert.deepStrictEqual(sh.landings.map(l => l.feet), G.LANDING_FEET.filter(f => f <= g - G.LANDING_MIN_DEPTH))
  }
})
await t('roles are disjoint; 3 air cells a step over each tread; stub end faces are not cells; nothing above ground is lining', () => {
  for (const away of ['n', 's', 'e', 'w']) {
    const p = G.planStair(SITE(70, away))
    const seen = new Map()
    for (const c of p.cells) { const k = k3(...c.at); assert.ok(!seen.has(k), `dup ${k} ${seen.get(k)}/${c.role}`); seen.set(k, c.role) }
    for (const s of p.steps) {
      assert.strictEqual(seen.get(k3(...s.tread)), 'tread')
      for (const a of s.air) assert.strictEqual(seen.get(k3(...a)), 'air')
      assert.deepStrictEqual(s.air.map(a => a[1]), [s.tread[1] + 1, s.tread[1] + 2, s.tread[1] + 3])
    }
    for (const l of p.landings) for (const c of l.end) assert.ok(!seen.has(k3(...c)), 'the end face is not reserved')
    for (const c of p.cells) if (c.role === 'lining') assert.ok(c.at[1] <= 70)
    const pil = G.toWorld(p.origin, away, 1, 1)
    assert.strictEqual(seen.get(k3(pil.x, 40, pil.z)), 'lining', 'the pillar is lining where a step passes it')
  }
})
await t('consecutive steps are face neighbours, one block apart in height (the walk never drops more than 1 inside)', () => {
  const p = G.planStair(SITE(70, 'e'))
  for (let k = 1; k <= p.K; k++) {
    const a = p.steps[k - 1].tread, b = p.steps[k].tread
    assert.strictEqual(Math.abs(a[0] - b[0]) + Math.abs(a[2] - b[2]), 1)
    assert.strictEqual(a[1] - b[1], 1)
  }
})

console.log('THE REAL PATHFINDER WALKS IT (mineflayer-pathfinder 2.4.5 A*, canDig off)')
const pathfinderWorld = (plan) => {
  const w = finished(plan, world(plan.g))
  return p => { const b = Block.fromStateId(registry.blocksByName[w.name(p.x, p.y, p.z) === 'air' ? 'air' : 'stone'].defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b }
}
const movesFor = blockAt => {
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: new Vec3(0.5, 64, 0.5), effects: {} }, entities: {},
    inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot); m.canDig = false; m.allowParkour = false; m.allow1by1towers = false; m.scafoldingBlocks = []
  return m
}
const astar = (m, from, goal) => {
  const a = new AStar(new Move(from[0], from[1], from[2], 0, 0), m, goal, 20_000, 40, -1)
  let r = a.compute()
  while (r.status === 'partial') r = a.compute()
  return r
}
await t('collar exit -> every landing\'s stub end, and back, for 4 orientations and 3 ground levels: success, inside the stair', () => {
  for (const away of ['n', 's', 'e', 'w']) for (const g of [63, 70, 77]) {
    const plan = G.planStair(SITE(g, away))
    const blockAt = pathfinderWorld(plan)
    const m = movesFor(blockAt)
    const exit = G.collarExit((x, y, z) => { const b = blockAt(new Vec3(x, y, z)); return { name: b.name, boundingBox: b.boundingBox } }, plan)
    assert.ok(exit, 'a collar exit')
    for (const l of plan.landings) {
      const end = G.stubEnd(l)
      const down = astar(m, exit, new goals.GoalBlock(end[0], end[1], end[2]))
      assert.strictEqual(down.status, 'success', `${away} g=${g} down to ${l.feet}: ${down.status}`)
      for (const n of down.path) if (n.y <= g) assert.ok(plan.air.has(k3(n.x, n.y, n.z)), `off the stair at ${n.x},${n.y},${n.z}`)
      assert.strictEqual(down.path.filter(n => n.toBreak?.length || n.toPlace?.length).length, 0, 'no digs, no placements')
      const up = astar(m, end, new goals.GoalBlock(exit[0], exit[1], exit[2]))
      assert.strictEqual(up.status, 'success', `${away} g=${g} up from ${l.feet}: ${up.status}`)
    }
  }
})
await t('POSITIVE CONTROL: one tread removed, the walk up past it fails (the test can see a broken stair)', () => {
  const plan = G.planStair(SITE(70, 's'))
  const w = finished(plan, world(70))
  w.set(plan.steps[10].tread, 'air'); w.set([plan.steps[10].tread[0], plan.steps[10].tread[1] - 1, plan.steps[10].tread[2]], 'air')
  w.set([plan.steps[10].tread[0], plan.steps[10].tread[1] - 2, plan.steps[10].tread[2]], 'air')
  const blockAt = p => { const b = Block.fromStateId(registry.blocksByName[w.name(p.x, p.y, p.z) === 'air' ? 'air' : 'stone'].defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b }
  const end = G.stubEnd(plan.landings.find(l => l.feet === 48))
  const exit = G.collarExit(w.read, plan)
  const up = astar(movesFor(blockAt), end, new goals.GoalBlock(exit[0], exit[1], exit[2]))
  assert.notStrictEqual(up.status, 'success')
})

console.log('THE SAFETY ORDER (nextOp)')
const unit0 = (plan, k) => G.unitCells(plan, { kind: 'step', k })
await t('water in a lining cell is sealed BEFORE any dig of the step', () => {
  const plan = G.planStair(SITE(70, 's'))
  const w = finished(plan, world(70))
  const k = 20, s = plan.steps[k]
  for (const a of s.air) w.set(a, 'stone')
  w.set(s.lining[0], 'water')
  const op = G.nextOp(w.read, plan, unit0(plan, k))
  assert.deepStrictEqual([op.op, op.why, op.at], ['place', 'seal', s.lining[0]])
})
await t('water or lava in an air or tread cell STOPS (never dug into)', () => {
  const plan = G.planStair(SITE(70, 's'))
  for (const [cell, liq] of [[plan.steps[20].air[0], 'water'], [plan.steps[20].tread, 'lava']]) {
    const w = finished(plan, world(70)); for (const a of plan.steps[20].air) w.set(a, 'stone'); w.set(cell, liq)
    const op = G.nextOp(w.read, plan, unit0(plan, 20))
    assert.deepStrictEqual([op.op, op.why], ['stop', liq])
  }
})
await t('a gravel ceiling over a step is dug and replaced before the step opens; gravel on rock is kept', () => {
  const plan = G.planStair(SITE(70, 's'))
  const w = finished(plan, world(70)); const s = plan.steps[30]
  for (const a of s.air) w.set(a, 'stone')
  const top = s.air[2], ceil = [top[0], top[1] + 1, top[2]]
  assert.ok(s.lining.some(c => k3(...c) === k3(...ceil)), 'the ceiling is the step\'s lining')
  w.set(ceil, 'gravel')
  assert.deepStrictEqual([G.nextOp(w.read, plan, unit0(plan, 30)).op, G.nextOp(w.read, plan, unit0(plan, 30)).at], ['dig', ceil])
  const side = s.lining.find(c => c[1] === s.air[0][1] && !plan.air.has(k3(c[0], c[1] - 1, c[2])))
  w.set(ceil, 'stone'); w.set(side, 'gravel')
  assert.strictEqual(G.nextOp(w.read, plan, unit0(plan, 30)).op, 'dig', 'then the air cells (the side gravel stands on rock)')
  assert.notDeepStrictEqual(G.nextOp(w.read, plan, unit0(plan, 30)).at, side)
})
await t('an unknown read waits; air cells go top down', () => {
  const plan = G.planStair(SITE(70, 's'))
  const w = world(70, { unknownBelow: 40 })
  assert.strictEqual(G.nextOp(w.read, plan, unit0(plan, 40)).op, 'wait')
  const w2 = finished(plan, world(70)); for (const a of plan.steps[12].air) w2.set(a, 'stone')
  assert.deepStrictEqual(G.nextOp(w2.read, plan, unit0(plan, 12)).at, plan.steps[12].air[2])
})

console.log('WHOLE VISITS ON A FAKE WORLD')
/** Effects over a fake world: a walk arrives when the target is a stand; a dig opens; a place fills when a face is solid. */
function fx (w, { feet0, log = [], deny = new Set(), material = Infinity } = {}) {
  let feet = feet0, mat = material
  const full = c => { const b = w.read(...c); return !!b && b.boundingBox === 'block' && !/water|lava/.test(b.name) }
  return {
    read: w.read, log,
    feet: () => feet,
    walkTo: async c => { const f = w.read(...c), h = w.read(c[0], c[1] + 1, c[2]), fl = w.read(c[0], c[1] - 1, c[2]); if (f?.boundingBox === 'empty' && h?.boundingBox === 'empty' && fl?.boundingBox === 'block') feet = c; return true },
    dig: async c => { if (deny.has(k3(...c))) return 'refused'; log.push(['dig', c]); w.set(c, 'air'); return 'confirmed' },
    place: async c => {
      if (mat <= 0) return 'no_material'
      if (![[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, d]) => full([c[0] + a, c[1] + b, c[2] + d]))) return 'no_support'
      mat--; log.push(['place', c]); w.set(c, 'cobblestone'); return 'confirmed'
    },
    toolOk: () => true, fence: () => true, log2: [],
    torch: async (cell) => { log.push(['torch', cell]); w.set(cell, 'wall_torch'); return true },
    now: () => 0, aborted: () => false,
  }
}
const visitAll = async (rec, w, opts = {}) => {
  const exit = G.collarExit(w.read, rec.site)
  const e = fx(w, { feet0: exit, ...opts })
  e.log = (op, d) => (opts.rows ?? []).push([op, d])
  const pubs = [], stops = []
  let r, visits = 0
  const built = new Set()
  do {
    r = await runStairVisit({ rec, exit, built, onLanding: async f => (pubs.push(f), true), onStop: async (k, why) => stops.push([k, why]), onDropLanding: async (f, why) => stops.push(['drop', f, why]) }, e, { unitsMax: 30 })
    visits++
  } while (r.stop === 'units' && visits < 40)
  return { r, pubs, stops, visits, exit, e }
}
await t('bare rock -> a finished stair: every step done, landings published 48 then 32 then 16, the stair walkable', async () => {
  const site = SITE(70, 'w')
  const w = world(70)
  const sv = G.surveySite(w.read, { x: 100 - 22, y: 70, z: 100 }, { x: 100, z: 100, away: G.awayFrom({ x: 78, z: 100 }, 100, 100) })
  assert.ok(sv.ok, sv.why)
  const rec = G.stairRecord(sv, { home: { x: 78, y: 71, z: 100 } })
  const { r, pubs } = await visitAll(rec, w)
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why}`)
  assert.deepStrictEqual(pubs, [48, 32, 16])
  assert.strictEqual(G.firstUndone(w.read, G.planOf(rec)), null)
  for (const f of [48, 32, 16]) assert.ok(G.landingUsable(w.read, { ...rec, landings_built: pubs }, f).ok, `landing ${f} usable`)
})
await t('NEVER OPEN BESIDE BAD LINING: a cave wall of water and air holes; every air dig happens with its step\'s lining already good', async () => {
  const site = SITE(70, 's')
  const plan = G.planStair(site)
  const w = world(70)
  // holes in the lining at random-ish places: air and water
  plan.steps.forEach((s, i) => { if (i % 5 === 2 && s.lining.length) w.set(s.lining[i % s.lining.length], i % 10 === 2 ? 'water' : 'air') })
  const rec = { ...G.stairRecord({ site, K: plan.K, landings: plan.landings.map(l => l.feet), lining: 0, digs: 0, stopK: null, exit: G.collarExit(w.read, site) }, { home: { x: 100, y: 71, z: 78 } }) }
  // the check rides inside the dig effect: before an air cell is dug, every lining cell of its step reads good
  const wr = w
  const owner = new Map(plan.steps.flatMap(s => s.air.map(a => [k3(...a), s])))
  const exit = G.collarExit(w.read, site)
  const e = fx(w, { feet0: exit })
  const dig0 = e.dig
  e.dig = async c => {
    const s = owner.get(k3(...c))
    if (s) for (const l of s.lining) { const b = wr.read(...l); assert.ok(G.goodSolid(b, wr.read(l[0], l[1] - 1, l[2]), plan.air.has(k3(l[0], l[1] - 1, l[2]))), `dug ${c} beside ${l} = ${b.name}`) }
    return dig0(c)
  }
  e.log = () => {}
  let r, n = 0
  do { r = await runStairVisit({ rec, exit, built: new Set(), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} }, e, { unitsMax: 30 }) } while (r.stop === 'units' && ++n < 40)
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why}`)
})
await t('MUTANT KILLED: with the air cells before the lining, the same visit digs beside water', async () => {
  const path = new URL('../src/shaftgeom.mjs', import.meta.url)
  const src = readFileSync(path, 'utf8')
  const old = '  // 1b. EVERY FACE NEIGHBOUR of a cell about to open: a liquid there is sealed first, whatever its role -- a LATER step\'s air\n'
  const neu = '  { const sorted0 = [...air].sort((a, b) => b[1] - a[1]); for (const c of sorted0) { const b = read(...c); if (b.boundingBox !== \'empty\') return { op: \'dig\', at: c, why: \'air\' } } }\n' + old
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try {
    const M = await import(out.href)
    const plan = M.planStair(SITE(70, 's'))
    const w = finished(plan, world(70)); const s = plan.steps[20]
    for (const a of s.air) w.set(a, 'stone')
    w.set(s.lining[0], 'water')
    assert.strictEqual(M.nextOp(w.read, plan, M.unitCells(plan, { kind: 'step', k: 20 })).op, 'dig', 'the mutant digs first')
    assert.strictEqual(G.nextOp(w.read, plan, G.unitCells(plan, { kind: 'step', k: 20 })).op, 'place', 'the real code seals first')
  } finally { try { unlinkSync(out) } catch {} }
})
await t('water in a LATER step\'s air cell beside this step is sealed first; the stair goes on to the bottom', async () => {
  const site = SITE(70, 's')
  const plan = G.planStair(site)
  const w = world(70)
  w.set(plan.steps[30].air[1], 'water')   // beside step 29's air: not step 29's lining
  const rec = G.stairRecord({ site, K: plan.K, landings: plan.landings.map(l => l.feet), lining: 0, digs: 0, stopK: null, exit: G.collarExit(w.read, site) }, { home: { x: 100, y: 71, z: 78 } })
  const exit = rec.exit
  const e = fx(w, { feet0: exit }); const rows = []; e.log = (op, d) => rows.push([op, d])
  const dig0 = e.dig
  e.dig = async c => { for (const [a, b, d] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) assert.ok(!/water/.test(w.name(c[0] + a, c[1] + b, c[2] + d)), `dug ${c} beside water`); return dig0(c) }
  let r, n = 0
  do { r = await runStairVisit({ rec, exit, built: new Set(), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} }, e, { unitsMax: 30 }) } while (r.stop === 'units' && ++n < 40)
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why}`)
  assert.ok(rows.some(([op, d]) => op === 'place' && d.why === 'seal' && d.k === 29), 'sealed while building step 29')
})
await t('a liquid at step 30 ends the stair above it; the truncated record reads complete and NOT damaged (design B2)', async () => {
  const site = SITE(70, 's')
  const plan = G.planStair(site)
  const w = world(70)
  w.set(plan.steps[30].air[0], 'water')   // the step's own cell, beside no earlier step's air: the survey's stop
  const rec = G.stairRecord({ site, K: plan.K, landings: plan.landings.map(l => l.feet), lining: 0, digs: 0, stopK: null, exit: G.collarExit(w.read, site) }, { home: { x: 100, y: 71, z: 78 } })
  const { r, stops, pubs } = await visitAll(rec, w)
  assert.strictEqual(r.stop, 'stopped')
  assert.deepStrictEqual(stops, [[30, 'water']])
  assert.deepStrictEqual(pubs, [48])
  const t2 = { ...G.truncatedRecord({ ...rec, landings_built: pubs }, 30), structure_complete: true }
  assert.strictEqual(t2.K, 29); assert.deepStrictEqual(t2.landings, [48]); assert.deepStrictEqual(t2.landings_built, [48])
  assert.strictEqual(G.stairDamaged(w.read, t2), false, 'the planned rock below the stop is no damage')
  assert.strictEqual(G.stairDamaged(w.read, { ...rec, structure_complete: true }), true, 'POSITIVE CONTROL: the untruncated record would read damaged')
})
await t('water in a stub cell is sealed from the column before it; the landing is built', async () => {
  const site = SITE(70, 's')
  const plan = G.planStair(site)
  const w = world(70)
  const l48 = plan.landings.find(l => l.feet === 48)
  w.set(l48.cols[2].air[0], 'water')
  const rec = G.stairRecord({ site, K: plan.K, landings: plan.landings.map(l => l.feet), lining: 0, digs: 0, stopK: null, exit: G.collarExit(w.read, site) }, { home: { x: 100, y: 71, z: 78 } })
  const { r, pubs } = await visitAll(rec, w)
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why}`)
  assert.deepStrictEqual(pubs, [48, 32, 16])
})
await t('a dropped landing (a stub that met a liquid): the stair plans without it and completes', async () => {
  const site = SITE(70, 's')
  const plan = G.planStair(site)
  const w = world(70)
  const rec = G.stairRecord({ site, K: plan.K, landings: plan.landings.map(l => l.feet), lining: 0, digs: 0, stopK: null, exit: G.collarExit(w.read, site) }, { home: { x: 100, y: 71, z: 78 } })
  const d = G.droppedLandingRecord(rec, 48)
  assert.deepStrictEqual(d.landings, [32, 16])
  const again = await visitAll(d, w)
  assert.strictEqual(again.r.stop, 'complete', `${again.r.stop} ${again.r.why}`)
  assert.deepStrictEqual(again.pubs, [32, 16])
})
await t('REPAIR: a finished stair with a tread dug out reads damaged; the next visit puts it back', async () => {
  const site = SITE(70, 'n')
  const plan = G.planStair(site)
  const w = finished(plan, world(70))
  const rec = { ...G.stairRecord({ site, K: plan.K, landings: [48, 32, 16], lining: 0, digs: 0, stopK: null, exit: G.collarExit(w.read, site) }, { home: { x: 100, y: 71, z: 122 } }), structure_complete: true, landings_built: [48, 32, 16] }
  assert.strictEqual(G.stairDamaged(w.read, rec), false)
  w.set(plan.steps[12].tread, 'air')
  assert.strictEqual(G.stairDamaged(w.read, rec), true)
  assert.strictEqual(G.landingUsable(w.read, rec, 32).ok, false, 'a broken route is not admitted')
  const { r } = await visitAll(rec, w)
  assert.strictEqual(r.stop, 'complete')
  assert.strictEqual(G.stairDamaged(w.read, rec), false)
})
await t('bounds: a refused dig twice ends the visit; no material ends it; the lease lost ends it', async () => {
  const site = SITE(70, 's'); const plan = G.planStair(site); const w = world(70)
  const rec = G.stairRecord({ site, K: plan.K, landings: [48, 32, 16], lining: 0, digs: 0, stopK: null, exit: G.collarExit(w.read, site) }, { home: { x: 100, y: 71, z: 78 } })
  const exit = rec.exit
  const run = async e => runStairVisit({ rec, exit, built: new Set(), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} }, e, {})
  const e1 = fx(w, { feet0: exit, deny: new Set([k3(...plan.steps[1].air[0])]) }); e1.log = () => {}
  assert.strictEqual((await run(e1)).stop, 'dig_refused')
  const w2 = world(70); w2.set(plan.steps[3].lining[0], 'air')
  const e2 = fx(w2, { feet0: exit, material: 0 }); e2.log = () => {}
  assert.strictEqual((await run(e2)).stop, 'no_material')
  const e3 = fx(world(70), { feet0: exit }); e3.log = () => {}; e3.fence = () => false
  assert.strictEqual((await run(e3)).stop, 'lease')
})

console.log('USE')
await t('chooseLanding: a real descent only; the deepest landing at or above the goal, else the deepest', () => {
  assert.strictEqual(G.chooseLanding([48, 32, 16], 70, 65), null, 'a step-sized call is not routed')
  assert.strictEqual(G.chooseLanding([48, 32, 16], 70, 16), 16)
  assert.strictEqual(G.chooseLanding([48, 32, 16], 70, 40), 48)
  assert.strictEqual(G.chooseLanding([48, 32, 16], 70, 0), 16)
  assert.strictEqual(G.chooseLanding([48], 70, 16), 48)
  assert.strictEqual(G.chooseLanding([48, 32, 16], 40, 16), 16, 'from y 40: the 32 and the 16 are below')
  assert.strictEqual(G.chooseLanding([48, 32, 16], 50, 30), 32, '48 is only 2 below the bot')
  assert.strictEqual(G.chooseLanding([], 70, 16), null)
})
await t('roofed: under rock yes, in the open no', () => {
  const w = world(70)
  assert.strictEqual(G.roofed(w.read, [0, 40, 0], 72), true)
  assert.strictEqual(G.roofed(w.read, [0, 71, 0], 72), false)
})
await t('the keep-out part: every record cell forbidden as "stair", nothing else; the bottom is the stair\'s', () => {
  const site = SITE(70, 'e'); const plan = G.planStair(site)
  const rec = { blueprint: G.SHAFT_BLUEPRINT, state: 'open', site, K: plan.K, cells: plan.cells.map(c => ({ at: c.at, role: c.role })) }
  const ko = G.stairKeepOut(rec)
  for (const c of plan.cells) assert.strictEqual(ko.forbid({ x: c.at[0], y: c.at[1], z: c.at[2] }), 'stair')
  for (const l of plan.landings) for (const c of l.end) assert.strictEqual(ko.forbid({ x: c[0], y: c[1], z: c[2] }), null, 'the stub end is free')
  assert.strictEqual(ko.forbid({ x: 0, y: 0, z: 0 }), null)
  assert.strictEqual(ko.bottom, 15)
  assert.deepStrictEqual(G.stairKeepOut({ ...rec, state: 'no_site' }), { forbid: null, bottom: null })
})

console.log('SITING')
await t('a dry site sites; water under the 32 landing keeps only the 48; a wet surface and the town square are refused', () => {
  const home = { x: 78, y: 71, z: 100 }
  const cand = { x: 100, z: 100, away: 'e' }
  const w = world(70)
  const ok = G.surveySite(w.read, home, cand)
  assert.ok(ok.ok, ok.why); assert.deepStrictEqual(ok.landings, [48, 32, 16]); assert.ok(ok.exit)
  const plan = G.planStair(ok.site)
  const w2 = world(70); w2.set(plan.steps[35].air[0], 'water')
  const s2 = G.surveySite(w2.read, home, cand)
  assert.ok(s2.ok); assert.deepStrictEqual(s2.landings, [48]); assert.strictEqual(s2.K, 34)
  // water in a cell beside an EARLIER step's air is sealed by that step's build: no stop (the Paper scene's case, 10-30)
  const w4 = world(70); w4.set(plan.steps[30].air[1], 'water')
  const s4 = G.surveySite(w4.read, home, cand)
  assert.ok(s4.ok); assert.deepStrictEqual(s4.landings, [48, 32, 16]); assert.strictEqual(s4.stopK, null)
  const w3 = world(70); w3.set([cand.x, 70, cand.z + 2], 'water')
  assert.strictEqual(G.surveySite(w3.read, home, cand).why, 'wet')
  assert.strictEqual(G.surveySite(w.read, { x: 90, y: 71, z: 100 }, cand).why, 'town')
  assert.strictEqual(G.surveySite(w.read, home, cand, { forbid: (x) => x === 101 }).why, 'reserved')
})
await t('candidates: the ring 19..26, in the sector asked, nearest first', () => {
  const c = G.siteCandidates({ x: 0, z: 0 }, { sectorOf: (h, x, z) => (x > 0 ? 'E' : 'W'), sector: 'E' })
  assert.ok(c.length > 0 && c.every(q => q.x > 0 && Math.max(Math.abs(q.x), Math.abs(q.z)) >= 19 && Math.max(Math.abs(q.x), Math.abs(q.z)) <= 26))
  assert.ok(c[0].d <= c[c.length - 1].d)
})

console.log('THE PROJECT ORDER (design review B1)')
await t('a no-site stair record is complete: the order moves straight on to the next project; it is due only after retryAt', () => {
  const list = [{ plot: 'shop' }, { plot: 'shaft', after: 'shop', builders: 1 }, { plot: 'house1', after: 'shop' }]
  const ns = G.noSiteRecord({ home: { x: 0, y: 70, z: 0 }, now: 1000 })
  const states = [{ plot: 'shop', exists: true, complete: true }, { plot: 'shaft', exists: true, complete: ns.structure_complete, damaged: false, due: G.stairDue(ns, 2000) }, { plot: 'house1', exists: false, complete: false }]
  assert.strictEqual(activeProject(states, list).plot, 'house1')
  assert.strictEqual(G.stairDue(ns, 1000 + G.NO_SITE_RETRY_MS + 1), true)
  assert.strictEqual(G.stairDue(ns, 2000), false)
  assert.strictEqual(G.stairKeepOut(ns).forbid, null, 'no cells, no keep-out')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
