// SCAFTOWN-01 (scaftown.mjs; its wiring in index.mjs and skills.mjs scafTownRecords).
//
// BEHAVIOUR FIRST (CLAUDE.md): the area, the surcharge, the search modes as pure functions; then the REAL mineflayer-pathfinder
// 2.4.5 Movements and its REAL A* (lib/astar.js) over a small block world, with the price installed exactly as index.mjs
// builds it (makeScafTownPrice + installScafTownPrice on a walk-shaped profile that already carries the lid price). The
// refusal CHAIN: a pit inside the town with no other way out still towers out; an escape profile is the base's; the budget,
// the cap and the latch each hand a search back to the base's costs. A PROPERTY: over every node of the scenes the candidate
// offers exactly the base's neighbours, each at >= the base's cost. Source assertions only for the wiring (comments stripped,
// unique anchors, a mutant each).
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const ST = await import('../src/scaftown.mjs')
const LP = await import('../src/lidplace.mjs')
const ST_URL = new URL('../src/scaftown.mjs', import.meta.url)
const INDEX_URL = new URL('../src/index.mjs', import.meta.url)
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const V = (x, y, z) => new Vec3(x, y, z)

// climb-escape.test.mjs's withMutant: the anchor must be present AND unique, or the mutant is never written
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---- the world: REAL prismarine blocks, REAL Movements, REAL A* -------------------------------------------------------
const { Movements, goals } = require_('mineflayer-pathfinder')
const AStar = require_('mineflayer-pathfinder/lib/astar.js')
const Move = require_('mineflayer-pathfinder/lib/move.js')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)

/** cells: { 'x,y,z': name }; y <= 69 is stone, the rest air, unless named. */
function world (cells = {}) {
  const nameAt = (x, y, z) => cells[`${x},${y},${z}`] ?? (y <= 69 ? 'stone' : 'air')
  const blockAt = p => {
    const b = Block.fromStateId(registry.blocksByName[nameAt(p.x, p.y, p.z)].defaultState, 0); b.position = V(p.x, p.y, p.z); return b
  }
  const stateIdAt = (x, y, z) => registry.blocksByName[nameAt(x, y, z)].defaultState
  return { blockAt, stateIdAt, nameAt }
}
const HOME = { x: 0, y: 70, z: 0 }
/** A Movements as index.mjs's WALK profile has it (canDig false, towers on, no parkour, placeCost 5, the lid price), and the
 *  town price when `town` is given ({ home, rings, mod, now }). */
function moves (w, { town = null, canDig = false } = {}) {
  const bot = { registry, version: '1.21.8', blockAt: w.blockAt, entity: { position: V(0.5, 71, 0.5), effects: {} }, entities: {},
                inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot)
  m.canDig = canDig; m.allowParkour = false; m.allowSprinting = false; m.allow1by1towers = true; m.maxDropDown = 6
  m.placeCost = 5
  LP.installLidPrice(m, LP.makeLidPlacePrice({ registry, stateIdAt: w.stateIdAt, guard: () => null }))
  if (town) {
    const mod = town.mod ?? ST
    const area = mod.scafAreaOf({ home: town.home ?? HOME, rings: town.rings ?? [] })
    const price = mod.makeScafTownPrice({ area: () => area, now: town.now ?? (() => 0) })
    mod.installScafTownPrice(m, price)
    m.__scafPrice = price
  }
  return m
}
const clone = (m, patch = {}) => Object.assign(Object.assign(Object.create(Object.getPrototypeOf(m)), m), patch)
/** The REAL A* from a node -> { status, placed: ['x,y,z' of every block the path places], cost }. */
function plan (m, from, goal, { blocks = 64, radius = -1, timeout = 4000 } = {}) {
  const r = new AStar(new Move(from[0], from[1], from[2], blocks, 0), m, goal, timeout, timeout, radius).compute()
  const placed = r.path.flatMap(n => (n.toPlace ?? []).filter(p => !p.useOne).map(p => `${p.x + p.dx},${p.y + p.dy},${p.z + p.dz}`))
  return { status: r.status, path: r.path, placed, cost: r.cost, end: r.path.at(-1) }
}
/** THE LEDGE: a stone shelf x 4..9 across z -20..20, top y 72 (stand y 73); a staircase at z = +14: 71 at x 1, 72 at x 2, 73 at
 *  x 3 (one-high steps). The goal stands on the shelf at 6,73,0, 3 blocks above the bot at 0,70,0. */
function ledgeCells () {
  const c = {}
  for (let x = 4; x <= 9; x++) for (let z = -20; z <= 20; z++) for (let y = 70; y <= 72; y++) c[`${x},${y},${z}`] = 'stone'
  c['1,70,14'] = 'stone'; c['2,70,14'] = 'stone'; c['2,71,14'] = 'stone'; c['3,70,14'] = 'stone'; c['3,71,14'] = 'stone'; c['3,72,14'] = 'stone'
  return c
}
/** A 1x1 pit dug in the town: floor 66 (bot feet 67), walls to 69 (the ground), nothing to climb. */
function pitCells () {
  const c = {}
  for (let y = 67; y <= 69; y++) c[`0,${y},0`] = 'air'
  return c
}

// ---- the pure parts --------------------------------------------------------------------------------------------------
test('AREA: within workR of home, or inside a wall ring grown by ringGrow; never below home.y - dy; no home -> no area', () => {
  const rings = ST.wallRingsOf([{ blueprint: 'wall@1', ring: [-46, -20, 35, 39] }, { blueprint: 'wallext@1', ring: [-40, -89, 35, -20] },
    { blueprint: 'house@1', ring: [0, 0, 500, 500] }, { blueprint: 'wall@1', ring: [1, 2, 3] }])
  assert.deepEqual(rings, [[-46, -20, 35, 39], [-40, -89, 35, -20]], 'only wall and wallext records with a 4-number ring')
  const a = ST.scafAreaOf({ home: HOME, rings })
  assert.equal(ST.inScafArea(a, 80, 70, -80), true, 'Chebyshev 80 is in')
  assert.equal(ST.inScafArea(a, 81, 70, 0), false, 'Chebyshev 81 outside every ring is out')
  assert.equal(ST.inScafArea(a, 0, 70, -89), true, 'the wall extension reaches z -89: in (radius alone would miss it)')
  assert.equal(ST.inScafArea(a, 0, 70, -91), true, 'ringGrow 2: the cells just outside the extension wall')
  assert.equal(ST.inScafArea(a, 0, 70, -92), false)
  assert.equal(ST.inScafArea(a, 0, 66, 0), true, 'home.y - 4 is in')
  assert.equal(ST.inScafArea(a, 0, 65, 0), false, 'a pit, a tunnel or a mine under the town is priced as before')
  assert.equal(ST.inScafArea(a, 0, 300, 0), true, 'no upper cutoff')
  assert.equal(ST.scafAreaOf({ home: null }), null)
  assert.equal(ST.scafAreaOf({ home: { x: 1, y: NaN, z: 2 } }), null, 'a home with a non-finite coordinate is unknown')
  assert.equal(ST.inScafArea(null, 0, 70, 0), false, 'no area: fails open')
})

test('SURCHARGE: cost per placement landing (ref + face, or the ref cell) in the area, each counted once; useOne and outside cost 0', () => {
  const a = ST.scafAreaOf({ home: HOME })
  const C = ST.SCAF_TOWN.cost
  assert.equal(ST.scafTownSurcharge([{ x: 0, y: 69, z: 0, dx: 0, dy: 1, dz: 0 }], a), C, 'a tower block at 0,70,0')
  assert.equal(ST.scafTownSurcharge([{ x: 0, y: 69, z: 0, dx: 0, dy: 1, dz: 0 }, { x: 1, y: 69, z: 0, dx: 0, dy: 1, dz: 0 }], a), 2 * C, 'a two-block step-up pays twice')
  assert.equal(ST.scafTownSurcharge([{ x: 0, y: 65, z: 0, dx: 0, dy: 1, dz: 0 }], a), C, 'lands at 66 (in), the ref at 65 is out: counted once')
  assert.equal(ST.scafTownSurcharge([{ x: 0, y: 64, z: 0, dx: 0, dy: 1, dz: 0 }], a), 0, 'a placement at 65 under the town: 0')
  assert.equal(ST.scafTownSurcharge([{ x: 90, y: 70, z: 0, dx: 0, dy: 1, dz: 0 }], a), 0, 'far: 0')
  assert.equal(ST.scafTownSurcharge([{ x: 80, y: 70, z: 0, dx: 1, dy: 0, dz: 0 }], a), C, 'the ref is in, the landing at 81 is out: an over-price at the edge, never an under-price')
  assert.equal(ST.scafTownSurcharge([{ x: 0, y: 70, z: 1, dx: 0, dy: 0, dz: 0, useOne: true }], a), 0, 'a fence gate opened places nothing')
  assert.equal(ST.scafTownSurcharge([], a), 0)
  assert.equal(ST.scafTownSurcharge([{ x: 0, y: 69, z: 0, dx: 0, dy: 1, dz: 0 }], null), 0, 'no area: 0')
})

test('MODES: off (switch or holder), capped (searchRadius >= 0), latched (its goal failed priced < latchMs ago), else priced; the latch only on a priced, touched, failed search', () => {
  const latch = new Map([['GoalBlock:1,2,3', 500]])
  assert.equal(ST.searchMode({ on: false }), 'off')
  assert.equal(ST.searchMode({ off: 1 }), 'off')
  assert.equal(ST.searchMode({ radius: 400 }), 'capped')
  assert.equal(ST.searchMode({ radius: 0 }), 'capped')
  assert.equal(ST.searchMode({ radius: -1, key: 'GoalBlock:1,2,3', latch, now: 499 }), 'latched')
  assert.equal(ST.searchMode({ radius: -1, key: 'GoalBlock:1,2,3', latch, now: 500 }), 'priced', 'the latch expires')
  assert.equal(ST.searchMode({ radius: undefined }), 'priced')
  assert.equal(ST.goalKey(new goals.GoalBlock(1.5, 2, 3.7)), 'GoalBlock:1,2,3')
  assert.equal(ST.goalKey(new goals.GoalNearXZ(4, 5, 1)), 'GoalNearXZ:4,-,5')
  assert.equal(ST.goalKey({}), null)
  assert.equal(ST.goalKey(new goals.GoalLookAtBlock(V(7, 8, 9), null)), 'GoalLookAtBlock:7,8,9', 'a goal holding `pos` latches too')
  const s = { mode: 'priced', hits: 3 }
  assert.equal(ST.latchesGoal(s, 'timeout'), true); assert.equal(ST.latchesGoal(s, 'noPath'), true)
  assert.equal(ST.latchesGoal(s, 'success'), false); assert.equal(ST.latchesGoal(s, 'partial'), false)
  assert.equal(ST.latchesGoal({ mode: 'priced', hits: 0 }, 'noPath'), false, 'a failure the price never touched is the base\'s own: no latch')
  assert.equal(ST.latchesGoal({ mode: 'capped', hits: 3 }, 'noPath'), false)
  assert.equal(ST.scafTownOn({}), true); assert.equal(ST.scafTownOn({ SCAFTOWN: 'off' }), false); assert.equal(ST.scafTownOn({ SCAFTOWN: '0' }), false)
})

test('STUCK: a goal whose walk resets stuck twice within latchMs is latched to the base\'s costs; once is not; another goal is not; off never latches', () => {
  let t = 0
  const p = ST.makeScafTownPrice({ now: () => t })
  const g = new goals.GoalBlock(1, 2, 3), h = new goals.GoalBlock(4, 5, 6)
  // both goals' routes were shaped by the price (a priced, touched search settled for each)
  for (const q of [g, h]) { const s = p.begin({ goal: q }); s.hits = 1; p.settle(s, { status: 'success' }) }
  assert.equal(p.stuck(g), false)
  assert.equal(p.stuck(h), false)
  t += 1000
  assert.equal(p.stuck(g), true, 'the second stall latches')
  assert.equal(p.begin({ goal: g }).mode, 'latched')
  assert.equal(p.begin({ goal: h }).mode, 'priced')
  assert.equal(p.stuckLatches, 1)
  t += ST.SCAF_TOWN.latchMs + 1
  assert.equal(p.stuck(h), false, 'the first stall expired: this is a new first')
  assert.equal(p.begin({ goal: g }).mode, 'priced', 'the latch expired')
  // LIVE 11-08 (scaftown-02): a goal the price never touched never counts a stall, however often the walk resets 'stuck'
  const u = ST.makeScafTownPrice({ now: () => t })
  const k = new goals.GoalBlock(7, 8, 9)
  const s0 = u.begin({ goal: k }); u.settle(s0, { status: 'success' })   // priced search, hits 0: the base's route
  for (let i = 0; i < 30; i++) assert.equal(u.stuck(k), false)
  assert.equal(u.latches, 0); assert.equal(u.stuckSkipped, 30)
  const s1 = u.begin({ goal: k }); s1.hits = 2; u.settle(s1, { status: 'success' })
  assert.equal(u.stuck(k), false); assert.equal(u.stuck(k), true, 'once the price shaped its route, two stalls latch it')
  t += ST.SCAF_TOWN.latchMs + 1
  assert.equal(u.stuck(new goals.GoalBlock(7, 8, 9)), false, 'the touch expires with the latch window')
  const off = ST.makeScafTownPrice({ on: false })
  assert.equal(off.stuck(g), false); assert.equal(off.stuck(g), false)
  assert.equal(p.stuck(null), false)
})

// ---- the real A* --------------------------------------------------------------------------------------------------------
const GOAL_LEDGE = () => new goals.GoalBlock(6, 73, 0)

test('CHAIN the ledge in town (owner 11-07: "dirt as a cheap way to get over obstacles"): the base towers up the shelf; the candidate walks to the stairs and places NOTHING', () => {
  const w = world(ledgeCells())
  const base = plan(moves(w), [0, 70, 0], GOAL_LEDGE())
  assert.equal(base.status, 'success')
  assert.ok(base.placed.length >= 1, `positive control: the base places scaffold (${base.placed.join(' ')})`)
  const cand = plan(moves(w, { town: {} }), [0, 70, 0], GOAL_LEDGE())
  assert.equal(cand.status, 'success')
  assert.deepEqual(cand.placed, [], `the candidate takes the stairs: placed ${cand.placed.join(' ')}`)
  assert.ok(cand.path.some(n => n.z >= 13), 'its route passes the staircase at z 14')
})

test('CHAIN the same ledge FAR from town (home 500 away): the candidate is the base (scaffold where it is the only cheap way stays legitimate)', () => {
  const w = world(ledgeCells())
  const base = plan(moves(w), [0, 70, 0], GOAL_LEDGE())
  const cand = plan(moves(w, { town: { home: { x: 500, y: 70, z: 500 } } }), [0, 70, 0], GOAL_LEDGE())
  assert.equal(cand.status, 'success')
  assert.deepEqual(cand.placed, base.placed)
})

test('CHAIN a pit inside the town with nothing to climb: the candidate still towers out (no new dead end) -- and from 66 the price does not even apply', () => {
  const w = world(pitCells())
  const goal = new goals.GoalBlock(3, 70, 0)
  const base = plan(moves(w), [0, 67, 0], goal)
  const cand = plan(moves(w, { town: {} }), [0, 67, 0], goal)
  assert.equal(base.status, 'success'); assert.equal(cand.status, 'success', 'the candidate gets out')
  assert.ok(cand.placed.length >= 2, `it towers: ${cand.placed.join(' ')}`)
  // the same pit dug from 70 (floor 69): priced cells, still out
  const w2 = world({ '0,70,0': 'air', '0,71,0': 'air', '0,72,0': 'air', ...Object.fromEntries([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]].flatMap(([x, z]) => [70, 71, 72].map(y => [`${x},${y},${z}`, 'stone']))) })
  const c2 = plan(moves(w2, { town: {} }), [0, 70, 0], new goals.GoalBlock(3, 73, 0))
  assert.equal(c2.status, 'success', 'a priced tower is still a move')
  assert.ok(c2.placed.length >= 3)
})

test('CHAIN an escape profile (scafTown false: ascend, descend, deck, water, gather) plans exactly as the base', () => {
  const w = world(ledgeCells())
  const base = plan(moves(w), [0, 70, 0], GOAL_LEDGE())
  const esc = clone(moves(w, { town: {} }), { scafTown: false })
  const r = plan(esc, [0, 70, 0], GOAL_LEDGE())
  assert.deepEqual(r.placed, base.placed)
  assert.equal(r.cost, base.cost)
})

test('PROPERTY: over every node of the scenes the candidate offers EXACTLY the base\'s neighbours, each at >= the base\'s cost (a move near 100 stays a move)', () => {
  let compared = 0, priced = 0
  for (const cells of [ledgeCells(), pitCells()]) {
    const w = world(cells)
    const a = moves(w), b = moves(w, { town: {} })
    for (let x = -3; x <= 8; x++) for (let z = -3; z <= 3; z++) for (let y = 66; y <= 74; y++) {
      const na = a.getNeighbors({ x, y, z, remainingBlocks: 64 }), nb = b.getNeighbors({ x, y, z, remainingBlocks: 64 })
      assert.equal(nb.length, na.length, `same neighbour count at ${x},${y},${z}`)
      for (let i = 0; i < na.length; i++) {
        assert.equal(`${nb[i].x},${nb[i].y},${nb[i].z}`, `${na[i].x},${na[i].y},${na[i].z}`)
        assert.ok(nb[i].cost >= na[i].cost)
        compared++; if (nb[i].cost > na[i].cost) priced++
      }
    }
  }
  assert.ok(compared > 1000 && priced > 50, `positive control: ${compared} moves compared, ${priced} priced`)
  // a near-100 legal move (a tower under an iron-block ceiling dug by hand: the library prices it 82) is still offered, priced 102
  const w = world({ '0,72,0': 'iron_block' })
  const dig = moves(w, { canDig: true, town: {} }), dig0 = moves(w, { canDig: true })
  const up0 = dig0.getNeighbors({ x: 0, y: 70, z: 0, remainingBlocks: 64 }).find(n => n.x === 0 && n.y === 71 && n.z === 0)
  const up = dig.getNeighbors({ x: 0, y: 70, z: 0, remainingBlocks: 64 }).find(n => n.x === 0 && n.y === 71 && n.z === 0)
  assert.equal(up0?.cost, 82, 'positive control: the base offers the tower at 82')
  assert.ok(up, 'the candidate still offers it'); assert.equal(up.cost, 82 + ST.SCAF_TOWN.cost, 'priced over the library\'s 100 cut, AFTER legality')
})

// ---- the search scope: the cap, the budget, the latch, the continuation -------------------------------------------------
/** A pathfinder whose getPathFromTo is mineflayer-pathfinder 2.4.5's generator protocol over the REAL A* (index.js:70-101). */
function fakePathfinder () {
  return {
    searchRadius: -1,
    getPathFromTo: function * (movements, startPos, goal, options = {}) {
      const ctx = new AStar(new Move(startPos.x, startPos.y, startPos.z, 64, 0), movements, goal, options.timeout ?? 4000, options.tickTimeout ?? 4000, options.searchRadius ?? this.searchRadius)
      let result = ctx.compute()
      yield { result, astarContext: ctx }
      while (result.status === 'partial') { result = ctx.compute(); yield { result, astarContext: ctx } }
    },
  }
}
const placedOf = path => path.flatMap(n => (n.toPlace ?? []).filter(p => !p.useOne).map(p => `${p.x + p.dx},${p.y + p.dy},${p.z + p.dz}`))
const runSearch = (pf, m, goal, options = {}) => { let last = null; for (const v of pf.getPathFromTo(m, V(0, 70, 0), goal, options)) last = v.result; return last }

test('SEARCH capped (searchRadius >= 0: digapproach, reachprobe, the tunnel): unpriced, so the cap is never spent on the price; uncapped: priced', () => {
  const w = world(ledgeCells())
  const m = moves(w, { town: {} }), pf = fakePathfinder()
  ST.installScafTownSearch(pf, m.__scafPrice)
  const capped = runSearch(pf, m, GOAL_LEDGE(), { searchRadius: 400 })
  const base = plan(moves(w), [0, 70, 0], GOAL_LEDGE())
  assert.deepEqual(placedOf(capped.path), base.placed, 'a capped search is the base\'s')
  assert.equal(m.__scafPrice.capped, 1)
  const free = runSearch(pf, m, GOAL_LEDGE())
  assert.deepEqual(placedOf(free.path), [], 'the uncapped search is priced: the stairs')
  assert.equal(m.__scafPrice.pricedSearches, 1)
})

test('SEARCH budget: a search prices only its first budgetMs; past it the same search runs at the base\'s costs (a priced search is never much slower than the base)', () => {
  const w = world(ledgeCells())
  let t = 0
  const m = moves(w, { town: { now: () => (t += 50) } })   // every price call is 50 ms later: the budget is spent within ~20 calls
  const pf = fakePathfinder(); ST.installScafTownSearch(pf, m.__scafPrice)
  const r = runSearch(pf, m, GOAL_LEDGE())
  const base = plan(moves(w), [0, 70, 0], GOAL_LEDGE())
  assert.equal(r.status, 'success')
  assert.ok(placedOf(r.path).length >= 1 && placedOf(r.path).length === base.placed.length, `past the budget the base's tower comes back (${placedOf(r.path).join(' ')})`)
  assert.equal(m.__scafPrice.cuts, 1, 'the cut is counted once per search')
})

/** Drive a search the way goto does: ONE next() (getPathTo), then the context's compute directly, tick by tick (index.js:442). */
function driveLikeGoto (pf, m, goal, { tickTimeout = 2, timeout = 5000, max = 1e6, afterFirst = () => {} } = {}) {
  const gen = pf.getPathFromTo(m, V(0, 70, 0), goal, { tickTimeout, timeout })
  const first = gen.next().value
  afterFirst()
  let r = first.result, n = 0
  while (r.status === 'partial' && n++ < max) r = first.astarContext.compute()
  return r
}
const columnCells = () => { const c = {}; for (let y = 70; y <= 89; y++) c[`6,${y},0`] = 'stone'; return c }

test('SEARCH restart (Codex r1 BLOCKER): a priced search past its budget that has not found the path starts again from its start at the base\'s costs, in the SAME context, and ends where the base ends', () => {
  // deterministic: a fake clock 50 ms per read, so the budget runs out inside the first slices; tiny tick slices (partial)
  const w = world(columnCells())
  const goal = new goals.GoalBlock(6, 90, 0)
  const base = plan(moves(w), [0, 70, 0], goal, { timeout: 60000 })
  assert.equal(base.status, 'success', 'positive control: the base reaches the top of the column')
  let t = 0, step = 0   // the clock runs from the SECOND slice (goto's first slice is 40 ms: the live cut is in a continuation)
  const m = moves(w, { town: { now: () => (t += step) } })
  const pf = fakePathfinder(); ST.installScafTownSearch(pf, m.__scafPrice)
  const r = driveLikeGoto(pf, m, goal, { timeout: 60000, afterFirst: () => { step = 50 } })
  assert.equal(r.status, 'success')
  assert.equal(m.__scafPrice.cuts, 1); assert.equal(m.__scafPrice.restarts, 1, 'restarted once')
  assert.equal(r.cost, base.cost, 'the restarted search IS the base\'s search: the same cost')
  assert.equal(m.__scafPrice.latches, 0, 'a fallback that succeeds latches nothing')
  assert.equal(ST.restartsSearch({ cut: true, mode: 'priced', hits: 0 }, 'partial'), false, 'untouched by the price: already the base\'s search')
  assert.equal(ST.restartsSearch({ cut: true, mode: 'priced', hits: 1, restarted: true }, 'partial'), false, 'once per search')
  assert.equal(ST.restartsSearch({ cut: true, mode: 'priced', hits: 1 }, 'success'), false)
  assert.equal(ST.restartsSearch({ cut: false, mode: 'priced', hits: 1 }, 'timeout'), false)
  assert.equal(ST.restartsSearch({ cut: true, mode: 'priced', hits: 1 }, 'noPath'), false, 'an exhausted heap is the base\'s answer too')
  assert.equal(ST.restartsSearch({ cut: true, mode: 'priced', hits: 1 }, 'timeout'), true)
})

test('SEARCH restart, real clock (Codex r1 repro: a goal on a 20-high column): the base succeeds within thinkTimeout, so the candidate does too', () => {
  const w = world(columnCells())
  const goal = new goals.GoalBlock(6, 90, 0)
  const t0 = Date.now()
  const pfb = fakePathfinder()
  const base = driveLikeGoto(pfb, moves(w), goal)
  const baseMs = Date.now() - t0
  if (base.status !== 'success') return   // a host too slow for the base itself proves nothing here
  const m = moves(w, { town: { now: () => performance.now() } })
  const pf = fakePathfinder(); ST.installScafTownSearch(pf, m.__scafPrice)
  const t1 = Date.now()
  const r = driveLikeGoto(pf, m, goal)
  assert.equal(r.status, 'success', `the candidate reaches it too (base ${baseMs} ms, candidate ${Date.now() - t1} ms, restarts ${m.__scafPrice.restarts})`)
})

test('SEARCH first slice longer than the budget that FAILED (a probe with one long slice): the generator re-runs the whole search unpriced', () => {
  const w = world(columnCells())
  const goal = new goals.GoalBlock(6, 90, 0)
  let t = 0
  const m = moves(w, { town: { now: () => (t += 50) } })
  const pf = fakePathfinder(); ST.installScafTownSearch(pf, m.__scafPrice)
  // one slice, a node budget too small for either: the priced slice times out past its cut -> re-run unpriced (also times out)
  const gen = pf.getPathFromTo(m, V(0, 70, 0), goal, { tickTimeout: 30, timeout: 30 })
  const v = gen.next().value
  assert.ok(v && v.result && v.astarContext, 'the protocol is unchanged: { result, astarContext }')
  assert.equal(m.__scafPrice.restarts, 1, 'the first-slice failure was re-run')
  assert.equal(m.__scafPrice.latches, 0, 'the fallback\'s own failure is the base\'s: no latch')
})

test('SEARCH latch: a priced search the price touched that ends noPath latches its goal; the next search for it runs at the base\'s costs, and the latch expires', () => {
  // the goal is unreachable for both (sealed in bedrock): the base fails too, so this only proves the bookkeeping
  const cells = {}
  for (const [x, y, z] of [[20, 70, 0], [21, 71, 0], [19, 71, 0], [20, 71, 1], [20, 71, -1], [20, 72, 0]]) cells[`${x},${y},${z}`] = 'bedrock'
  cells['20,70,0'] = 'bedrock'; cells['20,71,0'] = 'air'
  const w = world(cells)
  let t = 0
  const m = moves(w, { town: { now: () => t } })
  const pf = fakePathfinder(); ST.installScafTownSearch(pf, m.__scafPrice)
  const goal = new goals.GoalBlock(20, 71, 0)
  const r1 = runSearch(pf, m, goal, { timeout: 300, tickTimeout: 300 })
  assert.ok(r1.status === 'noPath' || r1.status === 'timeout', r1.status)
  assert.equal(m.__scafPrice.latches, 1, 'latched')
  runSearch(pf, m, goal, { timeout: 50, tickTimeout: 50 })
  assert.equal(m.__scafPrice.latched, 1, 'the next search for the goal ran latched (the base\'s costs)')
  t += ST.SCAF_TOWN.latchMs + 1
  runSearch(pf, m, goal, { timeout: 50, tickTimeout: 50 })
  assert.equal(m.__scafPrice.latched, 1, 'expired: priced again')
  assert.equal(m.__scafPrice.pricedSearches, 2)
})

test('SEARCH continuation: the monitor\'s direct astarContext.compute() calls run inside the search\'s own scope (its hits and budget), and the generator yields what it always did', () => {
  const w = world(ledgeCells())
  const m = moves(w, { town: {} })
  const pf = fakePathfinder(); ST.installScafTownSearch(pf, m.__scafPrice)
  // goto's getPathTo: ONE next(), then the context's compute directly, tick by tick (index.js:63-68 and :442-448)
  const gen = pf.getPathFromTo(m, V(0, 70, 0), GOAL_LEDGE(), { tickTimeout: 0.01 })
  const first = gen.next().value
  assert.ok(first.astarContext && first.result)
  let r = first.result, n = 0
  while (r.status === 'partial' && n++ < 100000) r = first.astarContext.compute()
  assert.equal(r.status, 'success')
  assert.deepEqual(placedOf(r.path), [], 'the continuation was priced like the first slice')
  assert.equal(m.__scafPrice.cur, null, 'the scope is released between slices')
  assert.ok(m.__scafPrice.hits > 0)
})

// ---- mutants: each guard fails its test for the intended reason --------------------------------------------------------
test('MUTANTS: the exemption, the post-legality price, the cap, the budget and the latch each fail their test when removed', async () => {
  const w = world(ledgeCells())
  const base = plan(moves(w), [0, 70, 0], GOAL_LEDGE())
  // M1 the exemption ignored: an escape profile is priced -> differs from the base
  await withMutant(ST_URL, 'if (this.scafTown === false) return ns', '', async mod => {
    const esc = clone(moves(w, { town: { mod } }), { scafTown: false })
    assert.notDeepEqual(plan(esc, [0, 70, 0], GOAL_LEDGE()).placed, base.placed, 'M1 killed: without the exemption an escape is priced')
  })
  // M2 the cap ignored: a capped search is priced -> stairs
  await withMutant(ST_URL, "if (fin(radius) && radius >= 0) return 'capped'", '', async mod => {
    const m = moves(w, { town: { mod } }), pf = fakePathfinder(); mod.installScafTownSearch(pf, m.__scafPrice)
    assert.notDeepEqual(placedOf(runSearch(pf, m, GOAL_LEDGE(), { searchRadius: 400 }).path), base.placed, 'M2 killed: a capped search priced')
  })
  // M3 the budget ignored: a slow search stays priced -> stairs
  await withMutant(ST_URL, 'if (now() - s.t0 > T.budgetMs) {', 'if (false) {', async mod => {
    let t = 0
    const m = moves(w, { town: { mod, now: () => (t += 50) } }), pf = fakePathfinder(); mod.installScafTownSearch(pf, m.__scafPrice)
    assert.deepEqual(placedOf(runSearch(pf, m, GOAL_LEDGE()).path), [], 'M3 killed: without the budget the search stays priced')
  })
  // M4 the latch never set
  await withMutant(ST_URL, 'price.latch.set(s.key, now() + T.latchMs); price.latches++', '', async mod => {
    assert.equal(mod.makeScafTownPrice().latches, 0)
    const cells = { '20,70,0': 'bedrock', '21,71,0': 'bedrock', '19,71,0': 'bedrock', '20,71,1': 'bedrock', '20,71,-1': 'bedrock', '20,72,0': 'bedrock' }
    const m = moves(world(cells), { town: { mod } }), pf = fakePathfinder(); mod.installScafTownSearch(pf, m.__scafPrice)
    runSearch(pf, m, new goals.GoalBlock(20, 71, 0), { timeout: 300, tickTimeout: 300 })
    assert.equal(m.__scafPrice.latches, 0, 'M4 killed: no latch')
  })
  // M6 the restart removed: the priced search past its budget keeps its inflated nodes and does not end where the base ends
  await withMutant(ST_URL, "if (restartsSearch(s, r?.status) && restartInPlace(this)) { s.restarted = true; s.mode = 'fallback'; price.restarts++; r = oc.call(this) }", '', async mod => {
    const wc = world(columnCells()), goal = new goals.GoalBlock(6, 90, 0)
    const b = plan(moves(wc), [0, 70, 0], goal, { timeout: 60000 })
    let t = 0, step = 0
    const m = moves(wc, { town: { mod, now: () => (t += step) } }), pf = fakePathfinder(); mod.installScafTownSearch(pf, m.__scafPrice)
    const r = driveLikeGoto(pf, m, goal, { timeout: 60000, afterFirst: () => { step = 50 } })
    assert.equal(m.__scafPrice.restarts, 0, 'M6 killed: no restart')
    assert.ok(r.status === 'success' && r.cost !== b.cost, `M6 killed: without the restart the search does not end at the base's cost (${r.cost} vs ${b.cost})`)
  })
  // M7 (scaftown-02) the touched check removed: a goal the price never shaped latches on routine stalls
  await withMutant(ST_URL, 'if (!(tu > t)) { price.stuckSkipped++; return false }', '', async mod => {
    const u = mod.makeScafTownPrice({ now: () => 0 })
    const k = new goals.GoalBlock(7, 8, 9)
    u.stuck(k); u.stuck(k)
    assert.equal(u.latches, 1, 'M7 killed: an untouched goal latched')
  })
  // M5 the price as a pre-legality exclusion (what lidplace.mjs rejects): the near-100 tower-under-obsidian move disappears
  const wo = world({ '0,72,0': 'iron_block' })
  const m0 = moves(wo, { canDig: true })
  const up0 = m0.getNeighbors({ x: 0, y: 70, z: 0, remainingBlocks: 64 }).find(n => n.x === 0 && n.y === 71 && n.z === 0)
  assert.ok(up0 && up0.cost + ST.SCAF_TOWN.cost > 100, 'positive control: the move is near the cut')
  {
    const mx = moves(wo, { canDig: true })
    mx.exclusionAreasPlace = [...mx.exclusionAreasPlace, () => ST.SCAF_TOWN.cost]
    const upx = mx.getNeighbors({ x: 0, y: 70, z: 0, remainingBlocks: 64 }).find(n => n.x === 0 && n.y === 71 && n.z === 0)
    assert.equal(upx, undefined, 'M5: an exclusionAreasPlace price deletes the move the surcharge keeps')
  }
})

// ---- the wiring (source; comments stripped) ------------------------------------------------------------------------------
/** The wiring's problems in an index.mjs source (comments stripped) -> [string]. */
function wiringProblems (src) {
  const bad = []
  const at = (s, why) => { if (src.split(s).length !== 2) { bad.push(`${why}: ${s} not present once`); return -1 } return src.indexOf(s) }
  const iLid = at('installLidPrice(moves, lidPlacePrice)', 'the lid price')
  const iMine = at('installScafTownPrice(moves, scafPrice)', 'the town price')
  const iSearch = at('installScafTownSearch(bot.pathfinder, scafPrice)', 'the search scope')
  const iClone = at('const gatherMoves = Object.create(Object.getPrototypeOf(moves))', 'the first clone')
  if (!(iLid < iMine && iMine < iClone && iSearch < iClone)) bad.push('order: lid price < town price, search < the first clone')
  for (const p of ['gatherMoves', 'ascendMoves', 'descendMoves', 'deckMoves', 'waterMoves']) at(`${p}.scafTown = false`, `${p} exempt`)
  at("if (r.status === 'success') bot.scafTownPrice.chosen += chosenScafTown(r.path)", 'the chosen counter')
  at("logEvent({ kind: 'scaftown_hits'", 'the positive-control row')
  at("if (reason === 'stuck' && bot.pathfinder?.movements?.scafTown !== false) { try { bot.scafTownPrice?.stuck?.(bot.pathfinder?.goal ?? null) }", 'the stall fallback')
  if (/\bmoves\.scafTown = false/.test(src)) bad.push('the walk itself exempt')
  return bad
}
test('WIRING index.mjs: the price on `moves` after the lid price and BEFORE the clones; the search wrapper; the gather and escape clones exempt; skills exports the records -- and each mutant of it is caught', () => {
  const src = strip(readFileSync(INDEX_URL, 'utf8'))
  assert.deepEqual(wiringProblems(src), [])
  assert.match(strip(readFileSync(SKILLS_URL, 'utf8')), /export function scafTownRecords \(\) \{\s*try \{ return projectHeads\(\)/)
  const mutants = [
    ['ascendMoves.scafTown = false', ''],
    ['gatherMoves.scafTown = false', ''],
    ['installScafTownPrice(moves, scafPrice)', ''],
    ['installScafTownSearch(bot.pathfinder, scafPrice)', ''],
    ['const gatherMoves = Object.create(Object.getPrototypeOf(moves))', 'const gatherMoves = Object.create(Object.getPrototypeOf(moves))\ninstallScafTownPrice(moves, scafPrice)'],
    ['bot.pathfinder.setMovements(moves); bot.movementProfile = \'walk\'', 'moves.scafTown = false; bot.pathfinder.setMovements(moves); bot.movementProfile = \'walk\''],
  ]
  for (const [old, neu] of mutants) {
    assert.ok(src.includes(old), `MUTANT ANCHOR MISSING: ${old}`)
    assert.ok(wiringProblems(src.replace(old, neu)).length > 0, `the wiring check misses the mutant: ${old} -> ${neu || '(gone)'}`)
  }
})
