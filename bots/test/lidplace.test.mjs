// LIDPLACE-01 (lidplace.mjs; its wiring in index.mjs and skills.mjs townPlanHead).
//
// BEHAVIOUR FIRST (CLAUDE.md): the guard set and the price as pure functions, then the REAL mineflayer-pathfinder 2.4.5
// Movements and its REAL A* (lib/astar.js) over a small block world, the price installed exactly as index.mjs builds it
// (makeLidPlacePrice + installLidPrice). The refusal CHAIN: a bot on a chest, in a pit whose floor is a chest (with a hand-dug
// ceiling inside a death disc: Codex r1 P1), boxed in a storehouse -- each still has a legal move, and where the base builds on
// a lid or a plan cell the candidate goes round. A PROPERTY: over many nodes the candidate offers exactly the base's moves. Source assertions only for the
// wiring (comments stripped, unique anchors, a mutant each).
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const LP = await import('../src/lidplace.mjs')
const { placeGuardCells, placeGuarded, lidPlaceSurcharge, makeLidPlacePrice, installLidPrice, liddedStateIds, lidPlaceOn, LID_PLACE_COST } = LP
const C = await import('../src/composter.mjs')
const LP_URL = new URL('../src/lidplace.mjs', import.meta.url)
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

/** cells: { 'x,y,z': name }; below y=70 is stone, the rest air, unless named. */
function world (cells = {}) {
  const nameAt = (x, y, z) => cells[`${x},${y},${z}`] ?? (y <= 69 ? 'stone' : 'air')
  const blockAt = p => {
    const b = Block.fromStateId(registry.blocksByName[nameAt(p.x, p.y, p.z)].defaultState, 0); b.position = V(p.x, p.y, p.z); return b
  }
  const stateIdAt = (x, y, z) => registry.blocksByName[nameAt(x, y, z)].defaultState
  return { blockAt, stateIdAt, nameAt }
}
/** A Movements as index.mjs's gather profile has it (towers on, no parkour, placeCost 5), with or without the lid price.
 *  `inv` false: no tool (every dig is by hand). */
function moves (w, { price = true, guard = null, step = null, canDig = false, mod = LP } = {}) {
  const bot = { registry, version: '1.21.8', blockAt: w.blockAt, entity: { position: V(0.5, 71, 0.5), effects: {} }, entities: {},
                inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot)
  m.canDig = canDig; m.allowParkour = false; m.allowSprinting = false; m.allow1by1towers = true; m.maxDropDown = 6
  m.placeCost = 5   // index.mjs: a pillar step is not as cheap as a walk step
  if (step) m.exclusionAreasStep = [...m.exclusionAreasStep, step]
  if (price) { const fn = mod.makeLidPlacePrice({ registry, stateIdAt: w.stateIdAt, guard: () => guard }); mod.installLidPrice(m, fn); m.__lidPriceFn = fn }
  return m
}
/** The REAL A* from a node -> { status, path, placed: ['x,y,z' of every block the path places] }. */
function plan (m, from, goal, blocks = 64, radius = -1) {
  const r = new AStar(new Move(from[0], from[1], from[2], blocks, 0), m, goal, 4000, 4000, radius).compute()
  const placed = r.path.flatMap(n => (n.toPlace ?? []).filter(p => !p.useOne).map(p => `${p.x + p.dx},${p.y + p.dy},${p.z + p.dz}`))
  return { status: r.status, path: r.path, placed, end: r.path.at(-1) }
}
const RING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
/** The chest-floored bedrock pit: a chest at 0,69,0, the bot on it at 0,70,0, bedrock walls 69..73. */
const pitCells = (extra = {}) => { const c = { '0,69,0': 'chest', ...extra }; for (let y = 69; y <= 73; y++) for (const [x, z] of RING) c[`${x},${y},${z}`] = 'bedrock'; return c }

// ---- the pure parts --------------------------------------------------------------------------------------------------
const PLAN = { plots: [
  { id: 'store', cells: [{ at: [10, 70, 10], kind: 'chest', stand: [10, 70, 12], state: 'placed' },
                         { at: [12, 70, 10], kind: 'chest', stand: [12, 70, 12], state: 'reserved' },
                         { at: [14, 70, 10], kind: 'chest', stand: [14, 70, 12], state: 'free' }] },
  { id: 'work', stations: [{ at: [20, 70, 20], kind: 'crafting_table', stand: [20, 70, 22], state: 'placed' }] },
] }
test('GUARD: placed and reserved plan cells, their stands (feet and head), and a chest cell\'s lid; a free cell is not guarded', () => {
  const g = placeGuardCells(PLAN)
  for (const k of ['10,70,10', '10,71,10', '10,70,12', '10,71,12', '12,70,10', '12,71,10', '12,70,12', '20,70,20', '20,70,22', '20,71,22']) assert.ok(g.has(k), k)
  for (const k of ['14,70,10', '14,71,10', '14,70,12', '20,71,20', '11,71,10']) assert.ok(!g.has(k), `${k} is not guarded`)
  assert.equal(placeGuardCells(null).size, 0); assert.equal(placeGuardCells({ plots: [{ cells: [{ state: 'placed' }] }] }).size, 0, 'a cell with no `at`')
})
test('PRICE: a block landing on a lid or in a guarded cell costs LID_PLACE_COST each; beside a chest, two above it, or a fence gate opened costs 0', () => {
  const lidded = (x, y, z) => x === 0 && y === 70 && z === 0
  assert.equal(placeGuarded(null, lidded, 0, 71, 0), true, 'the lid')
  for (const [x, y, z, w] of [[0, 72, 0, 'above the lid'], [1, 71, 0, 'beside it'], [0, 70, 0, 'the chest\'s own cell'], [NaN, 1, 1, 'NaN']]) assert.equal(placeGuarded(null, lidded, x, y, z), false, w)
  const tp = (x, y, z, dx, dy, dz, extra = {}) => ({ x, y, z, dx, dy, dz, ...extra })
  assert.equal(lidPlaceSurcharge([tp(0, 70, 0, 0, 1, 0)], null, lidded), LID_PLACE_COST, 'a tower block placed on the chest top (ref 0,70,0 + up)')
  assert.equal(lidPlaceSurcharge([tp(1, 71, 0, -1, 0, 0)], null, lidded), LID_PLACE_COST, 'a bridge block against the side, landing on the lid')
  assert.equal(lidPlaceSurcharge([tp(0, 71, 0, 0, 1, 0)], null, lidded), 0, 'the next tower block, above the lid')
  assert.equal(lidPlaceSurcharge([tp(1, 70, 0, -1, 1, 0, { useOne: true })], null, lidded), 0, 'useOne opens a gate: nothing placed')
  assert.equal(lidPlaceSurcharge([tp(1, 70, 0, -1, 1, 0), tp(0, 70, 0, 0, 1, 0)], null, lidded), 2 * LID_PLACE_COST, 'one price per guarded placement')
  const g = placeGuardCells(PLAN)
  assert.equal(lidPlaceSurcharge([tp(12, 69, 10, 0, 1, 0)], g, null), LID_PLACE_COST, 'a reserved chest site')
  assert.equal(lidPlaceSurcharge([tp(20, 70, 22, 0, 1, 0)], g, null), LID_PLACE_COST, 'a station\'s stand head')
  assert.equal(lidPlaceSurcharge([tp(14, 69, 10, 0, 1, 0)], g, null), 0, 'a free cell')
  assert.equal(lidPlaceSurcharge(null, g, lidded), 0); assert.equal(lidPlaceSurcharge([], g, lidded), 0)
})
test('LANDING: a block lands at ref + face; with an EMPTY reference it may land in either cell (the server\'s replace-clicked rule, or a ref the path fills first)', () => {
  const { landingCells, emptyStateIds } = LP
  const p = { x: 0, y: 71, z: 0, dx: 0, dy: 1, dz: 0 }
  assert.deepEqual(landingCells(p, () => false), [{ x: 0, y: 72, z: 0 }]); assert.deepEqual(landingCells(p, null), [{ x: 0, y: 72, z: 0 }])
  assert.deepEqual(landingCells(p, (x, y, z) => x === 0 && y === 71 && z === 0), [{ x: 0, y: 71, z: 0 }, { x: 0, y: 72, z: 0 }])
  const lidded = (x, y, z) => x === 0 && y === 70 && z === 0
  assert.equal(lidPlaceSurcharge([p], null, lidded, () => true), LID_PLACE_COST, 'a click on the air lid lands on the lid')
  assert.equal(lidPlaceSurcharge([p], null, lidded, () => false), 0, 'a click on a real block at the lid lands above it')
  const q = { x: 2, y: 71, z: 0, dx: 1, dy: 0, dz: 0 }, lid3 = (x, y, z) => x === 3 && y === 70 && z === 0
  assert.equal(lidPlaceSurcharge([q], null, lid3, () => true), LID_PLACE_COST, 'an empty ref whose ref + face is the lid: priced (Claude r2 P1)')
  assert.equal(lidPlaceSurcharge([{ x: 0, y: 70, z: 0, dx: 0, dy: 1, dz: 0 }], null, (x, y, z) => y === 69 || y === 70, () => true), LID_PLACE_COST, 'both cells guarded: counted once')
  const e = emptyStateIds(registry)
  for (const n of ['air', 'cave_air', 'water', 'short_grass']) assert.ok(e.has(registry.blocksByName[n].defaultState), n)
  for (const n of ['stone', 'dirt', 'chest', 'bedrock']) assert.ok(!e.has(registry.blocksByName[n].defaultState), n)
})
test('LIDDED: every chest state (facings, doubles, waterlogged), trapped and ender chests, the eight copper chests (1.21.11); never barrel, furnace, table, shulker', () => {
  for (const ver of ['1.21.8', '1.21.11']) {
    const reg = require_('prismarine-registry')(ver)
    const ids = liddedStateIds(reg)
    const names = ['chest', 'trapped_chest', 'ender_chest', ...(ver === '1.21.11' ? ['copper_chest', 'exposed_copper_chest', 'weathered_copper_chest', 'oxidized_copper_chest', 'waxed_copper_chest', 'waxed_exposed_copper_chest', 'waxed_weathered_copper_chest', 'waxed_oxidized_copper_chest'] : [])]
    for (const n of names) {
      const b = reg.blocksByName[n]; assert.ok(b, `${ver} has ${n}`)
      for (let s = b.minStateId; s <= b.maxStateId; s++) assert.ok(ids.has(s), `${ver} ${n} state ${s}`)
    }
    for (const n of ['barrel', 'furnace', 'crafting_table', 'stone', 'air', 'shulker_box', 'red_shulker_box']) assert.ok(!ids.has(reg.blocksByName[n].defaultState), `${ver} ${n}`)
    assert.ok(ids.size > 0)
  }
})
test('LIDPLACE=0: the switch makes the price 0 everywhere; unset or anything else is on', () => {
  assert.equal(lidPlaceOn({ LIDPLACE: '0' }), false); assert.equal(lidPlaceOn({}), true); assert.equal(lidPlaceOn({ LIDPLACE: '1' }), true)
  const w = world({ '0,70,0': 'chest' })
  const lid = [{ x: 0, y: 70, z: 0, dx: 0, dy: 1, dz: 0 }]
  assert.equal(makeLidPlacePrice({ registry, stateIdAt: w.stateIdAt, on: false })(lid), 0)
  assert.equal(makeLidPlacePrice({ registry, stateIdAt: w.stateIdAt })(lid), LID_PLACE_COST)
})

// ---- the pathfinder: single moves ------------------------------------------------------------------------------------
const nb = (m, node, to) => m.getNeighbors({ ...node, remainingBlocks: 64 }).find(n => n.x === to[0] && n.y === to[1] && n.z === to[2])
test('MOVES: the tower on a chest, a bridge onto a lid (2.4.5 hands exclusionAreasPlace the cell ABOVE it), a jump-up whose D is the lid -- each priced, each still a move', () => {
  const w = world({ '0,70,0': 'chest' })
  const up = nb(moves(w), { x: 0, y: 71, z: 0 }, [0, 72, 0]), up0 = nb(moves(w, { price: false }), { x: 0, y: 71, z: 0 }, [0, 72, 0])
  assert.ok(up && up0, 'the tower on the chest exists with and without the price')
  assert.equal(up.cost, up0.cost + LID_PLACE_COST)
  // A BODY IN MID-JUMP over the air lid (node 0,72,0): getMoveUp clicks the top of the AIR lid cell, and the server places
  // into the clicked cell -- the lid (Paper 10-26). Priced; and once the lid is really filled, the next block up is not.
  const up2 = nb(moves(w), { x: 0, y: 72, z: 0 }, [0, 73, 0]), up20 = nb(moves(w, { price: false }), { x: 0, y: 72, z: 0 }, [0, 73, 0])
  assert.ok(up2 && up20); assert.equal(up20.toPlace[0].y, 71, 'positive control: its reference is the (air) lid cell')
  assert.equal(up2.cost, up20.cost + LID_PLACE_COST, 'the mid-air tower lands on the lid: priced')
  const wf = world({ '0,70,0': 'chest', '0,71,0': 'dirt' })
  const up3 = nb(moves(wf), { x: 0, y: 72, z: 0 }, [0, 73, 0]), up30 = nb(moves(wf, { price: false }), { x: 0, y: 72, z: 0 }, [0, 73, 0])
  assert.equal(up3.cost, up30.cost, 'over a lid ALREADY covered, the next block up lands above it: unpriced')
  // a bridge: the bot on a stone pillar at y=70 steps east over the air above a chest at 1,69,0 -- D (1,70,0) is the lid
  const wb = world({ '1,69,0': 'chest', '0,70,0': 'stone' })
  const fw = nb(moves(wb), { x: 0, y: 71, z: 0 }, [1, 71, 0]), fw0 = nb(moves(wb, { price: false }), { x: 0, y: 71, z: 0 }, [1, 71, 0])
  assert.ok(fw0 && fw0.toPlace.length === 1 && fw0.toPlace[0].y + fw0.toPlace[0].dy === 70 && fw0.toPlace[0].x + fw0.toPlace[0].dx === 1, `positive control: the base bridges onto the lid ${JSON.stringify(fw0?.toPlace)}`)
  assert.ok(fw, 'the bridge is still a move'); assert.equal(fw.cost, fw0.cost + LID_PLACE_COST, 'priced on the cell the block lands in')
  // a jump-up that places D (the lid) and C on top of it, inside a death disc (step price 16 on every cell): D is priced, C is not
  const wj = world({ '1,68,0': 'chest', '1,69,0': 'air' })
  const death = () => 16
  const j = nb(moves(wj, { step: death }), { x: 0, y: 70, z: 0 }, [1, 71, 0]), j0 = nb(moves(wj, { step: death, price: false }), { x: 0, y: 70, z: 0 }, [1, 71, 0])
  assert.ok(j0 && j0.toPlace.length === 2, `positive control: the base jump-up places two ${JSON.stringify(j0?.toPlace)}`)
  // C's reference is D, still air when the move is planned: landingCells counts D (the lid) for C too, so
  // the move pays twice. An over-price on a move that DOES cover a lid; never an under-price, never a deletion.
  assert.ok(j, 'the jump-up survives'); assert.equal(j.cost, j0.cost + 2 * LID_PLACE_COST)
})
test('PROPERTY: over every node of three scenes (lids, a pit, a storehouse; with and without a death disc) the candidate offers EXACTLY the base\'s neighbours, each at >= the base\'s cost', () => {
  const scenes = [world({ '0,70,0': 'chest', '1,69,0': 'chest', '3,68,1': 'chest' }), world(pitCells({ '0,72,0': 'iron_block' })), world(Object.fromEntries(RING.map(([x, z]) => [`${x},70,${z}`, 'chest'])))]
  let compared = 0, priced = 0
  for (const w of scenes) for (const step of [null, () => 16]) for (const canDig of [false, true]) {
    const a = moves(w, { price: false, step, canDig }), b = moves(w, { step, canDig })
    for (let x = -3; x <= 4; x++) for (let z = -3; z <= 3; z++) for (let y = 69; y <= 74; y++) {
      const key = n => `${n.x},${n.y},${n.z}`
      const na = a.getNeighbors({ x, y, z, remainingBlocks: 64 }), nb2 = b.getNeighbors({ x, y, z, remainingBlocks: 64 })
      assert.deepEqual(nb2.map(key), na.map(key), `same moves from ${x},${y},${z}`)
      na.forEach((n, i) => { assert.ok(nb2[i].cost >= n.cost); if (nb2[i].cost > n.cost) priced++ }); compared += na.length
    }
  }
  assert.ok(compared > 1000 && priced > 10, `positive control: the property saw ${compared} moves, ${priced} of them priced`)
})

// ---- the refusal CHAIN: the REAL A* ----------------------------------------------------------------------------------
test('CHAIN on a chest (Gale, showcase 10-25): the base towers on the lid, the candidate steps off and towers beside it; both reach', () => {
  const w = world({ '0,70,0': 'chest' })
  const base = plan(moves(w, { price: false }), [0, 71, 0], new goals.GoalY(74))
  assert.equal(base.status, 'success'); assert.ok(base.placed.includes('0,71,0'), `positive control: the base places on the lid ${base.placed}`)
  const cand = plan(moves(w), [0, 71, 0], new goals.GoalY(74))
  assert.equal(cand.status, 'success', 'the candidate reaches the goal')
  assert.ok(!cand.placed.includes('0,71,0'), `no block on the lid: ${cand.placed}`)
})
test('CHAIN beside a chest (a log over the chest column): the base jumps on the chest and towers on the lid; the candidate towers beside it', () => {
  const w = world({ '0,70,0': 'chest' })
  const goal = new goals.GoalNear(0, 74, 0, 1)
  const base = plan(moves(w, { price: false }), [1, 70, 0], goal)
  assert.equal(base.status, 'success'); assert.ok(base.placed.includes('0,71,0'), `positive control: the base jumps onto the chest and towers on its lid ${base.placed}`)
  const cand = plan(moves(w), [1, 70, 0], goal)
  assert.equal(cand.status, 'success'); assert.ok(!cand.placed.includes('0,71,0'), `${cand.placed}`)
  const exact = plan(moves(w), [1, 70, 0], new goals.GoalBlock(0, 74, 0))
  assert.equal(exact.status, 'success', 'a goal standing straight over the chest is still reached'); assert.ok(!exact.placed.includes('0,71,0'), `by a bridge from the tower beside it, the lid left open: ${exact.placed}`)
})
test('CHAIN in a pit whose floor IS a chest, walls unbreakable: the lid tower is the one way out -- still taken (a price, never a veto)', () => {
  const w = world(pitCells())
  const r = plan(moves(w, { canDig: true }), [0, 70, 0], new goals.GoalY(74))
  assert.equal(r.status, 'success', 'a legal way out exists'); assert.ok(r.placed.includes('0,70,0'), `it is the lid tower: ${r.placed}`)
  const d = plan(moves(w, { canDig: true, step: () => 16 }), [0, 70, 0], new goals.GoalY(74))
  assert.equal(d.status, 'success', 'and inside a death disc too')
})
test('CHAIN Codex r1 P1: the same pit with an iron-block ceiling to dig by hand, inside a death disc -- the base\'s ONE move costs ~98; the candidate still gets out', () => {
  const w = world(pitCells({ '0,72,0': 'iron_block' }))
  const base = moves(w, { price: false, canDig: true, step: () => 16 })
  const n0 = base.getNeighbors({ x: 0, y: 70, z: 0, remainingBlocks: 64 })
  assert.equal(n0.length, 1, `positive control: one move out of the pit (${n0.map(n => `${n.x},${n.y},${n.z}@${n.cost.toFixed(1)}`)})`)
  assert.ok(n0[0].cost > 100 - LID_PLACE_COST, `and it costs ${n0[0].cost.toFixed(1)}: an exclusionAreasPlace price of ${LID_PLACE_COST} would have deleted it`)
  assert.equal(plan(base, [0, 70, 0], new goals.GoalY(74)).status, 'success', 'positive control: the base gets out')
  const cand = plan(moves(w, { canDig: true, step: () => 16 }), [0, 70, 0], new goals.GoalY(74))
  assert.equal(cand.status, 'success', 'the candidate gets out'); assert.ok(cand.placed.includes('0,70,0'), `by the lid tower: ${cand.placed}`)
})
// Codex r2 P1: a COST-CAPPED search (digapproach.mjs: searchRadius 400 = slack over the start's heuristic). The pit is 7 deep
// with three iron ceilings to dig by hand inside a death disc: the base gets out under the cap; the surcharge spends it.
const deepPit = () => { const c = { '0,69,0': 'chest', '0,72,0': 'iron_block', '0,74,0': 'iron_block', '0,76,0': 'iron_block' }; for (let y = 69; y <= 76; y++) for (const [x, z] of RING) c[`${x},${y},${z}`] = 'bedrock'; return c }
test('CHAIN Codex r2 P1 (capped A*): the surcharge can spend a search\'s cost cap -- withoutLidPriceSync gives the base\'s search back', () => {
  const w = world(deepPit())
  const base = plan(moves(w, { price: false, canDig: true, step: () => 16 }), [0, 70, 0], new goals.GoalY(77), 64, 400)
  assert.equal(base.status, 'success', `positive control: the base gets out under the cap (${base.path.reduce((a, n) => a + n.cost, 0).toFixed(0)})`)
  const m = moves(w, { canDig: true, step: () => 16 })
  const priced = plan(m, [0, 70, 0], new goals.GoalY(77), 64, 400)
  assert.notEqual(priced.status, 'success', 'the priced search alone loses it (the reason for the fallback)')
  const price = m.__lidPriceFn
  const back = LP.withoutLidPriceSync(price, () => plan(m, [0, 70, 0], new goals.GoalY(77), 64, 400))
  assert.equal(back.status, 'success', 'the fallback search gets out'); assert.equal(price.off, 0, 'and the price is back on after it')
})
test('planDigApproach (the REAL capped caller): a priced search that failed after the price touched it is re-run at base costs and says lidFallback', async () => {
  const { planDigApproach } = await import('../src/digapproach.mjs')
  const w = world(deepPit())
  const m = moves(w, { canDig: true, step: () => 16 })
  const runs = []
  const bot = { entity: { position: V(0.5, 70, 0.5) }, gatherMovements: m, lidPrice: m.__lidPriceFn, inventory: { items: () => [] }, heldItem: null,
    blockAt: w.blockAt,
    pathfinder: { getPathFromTo: function * (mv, at, goal, o) { runs.push(mv.__lidPriceFn.off); yield { result: new AStar(new Move(0, 70, 0, 64, 0), mv, goal, o.timeout, o.timeout, o.searchRadius).compute() } } } }
  const r = planDigApproach(bot, { x: 0, y: 77, z: 0 }, { goals, reachGoalFor: () => new goals.GoalY(77), endsInReach: () => true })
  assert.ok(r, 'a verdict'); assert.equal(r.status, 'success'); assert.equal(r.lidFallback, true)
  assert.deepEqual(runs, [0, 1], 'priced first, then the base costs')
  // positive control: where the priced search succeeds, no second search and no fallback
  const w2 = world({ '0,70,0': 'chest' }), m2 = moves(w2, { canDig: true }), runs2 = []
  const bot2 = { ...bot, gatherMovements: m2, lidPrice: m2.__lidPriceFn, blockAt: w2.blockAt, entity: { position: V(0.5, 71, 0.5) },
    pathfinder: { getPathFromTo: function * (mv, at, goal, o) { runs2.push(mv.__lidPriceFn.off); yield { result: new AStar(new Move(0, 71, 0, 64, 0), mv, goal, o.timeout, o.timeout, o.searchRadius).compute() } } } }
  const r2 = planDigApproach(bot2, { x: 0, y: 74, z: 0 }, { goals, reachGoalFor: () => new goals.GoalY(74), endsInReach: () => true })
  assert.equal(r2.lidFallback, false); assert.deepEqual(runs2, [0])
})
test('CHAIN boxed in a storehouse (chests on all eight sides, a wall 3 high beyond, no digging): the base builds on a lid; the candidate towers in place and gets out, every lid open', () => {
  const cells = {}
  for (const [x, z] of RING) cells[`${x},70,${z}`] = 'chest'
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.max(Math.abs(x), Math.abs(z)) === 2) for (let y = 70; y <= 72; y++) cells[`${x},${y},${z}`] = 'stone'
  const w = world(cells)
  const goal = new goals.GoalXZ(6, 0)
  const base = plan(moves(w, { price: false }), [0, 70, 0], goal)
  const cand = plan(moves(w), [0, 70, 0], goal)
  const lids = new Set(Object.keys(cells).filter(k => cells[k] === 'chest').map(k => { const [x, y, z] = k.split(',').map(Number); return `${x},${y + 1},${z}` }))
  assert.equal(base.status, 'success', `positive control: the base gets out (${base.placed})`)
  assert.ok(base.placed.some(k => lids.has(k)), `positive control: the base builds on a chest lid ${base.placed}`)
  assert.equal(cand.status, 'success', `the candidate gets out (${cand.placed})`)
  assert.ok(!cand.placed.some(k => lids.has(k)), `and leaves every lid open: ${cand.placed}`)
})
test('CHAIN the plan guard (Claude r1 P3): a tower whose cheapest cell is a RESERVED chest site goes one cell over; the site stays empty', () => {
  const w = world({})
  const guard = placeGuardCells({ plots: [{ cells: [{ at: [0, 70, 0], kind: 'chest', stand: [0, 70, 2], state: 'reserved' }] }] })
  const base = plan(moves(w, { price: false }), [0, 70, 0], new goals.GoalY(73))
  assert.equal(base.status, 'success'); assert.ok(base.placed.includes('0,70,0'), `positive control: the base towers in the reserved cell ${base.placed}`)
  const cand = plan(moves(w, { guard }), [0, 70, 0], new goals.GoalY(73))
  assert.equal(cand.status, 'success'); assert.ok(!cand.placed.some(k => guard.has(k)), `no block in a guarded cell: ${cand.placed}`)
})
test('COMPOSTER (composter.mjs composterSafeMovements): its clone keeps the base\'s surcharge, and still drops the composter neighbours', () => {
  const w = world({ '0,70,0': 'chest' })
  const base = moves(w)
  const keep = n => !(n.x === 1 && n.y === 71 && n.z === 0)
  const m = C.composterSafeMovements(base, keep)
  const up = nb(m, { x: 0, y: 71, z: 0 }, [0, 72, 0]), up0 = nb(moves(w, { price: false }), { x: 0, y: 71, z: 0 }, [0, 72, 0])
  assert.equal(up.cost, up0.cost + LID_PLACE_COST, 'the clone is priced')
  assert.equal(m.getNeighbors({ x: 0, y: 71, z: 0, remainingBlocks: 64 }).some(n => !keep(n)), false, 'and filtered')
})

// ---- mutants (lidplace.mjs, composter.mjs) ---------------------------------------------------------------------------
const COMP_URL = new URL('../src/composter.mjs', import.meta.url)
test('MUTANT KILLED: the surcharge never added -> Gale towers on the chest again', async () => {
  await withMutant(LP_URL, '      if (add > 0) n.cost += add\n', '      void add\n', async mod => {
    const r = plan(moves(world({ '0,70,0': 'chest' }), { mod }), [0, 71, 0], new goals.GoalY(74))
    assert.ok(r.placed.includes('0,71,0'), `${r.placed}`)
  })
})
test('MUTANT KILLED: the price made a veto (priced neighbours dropped) -> the bot in the chest-floored pit has no way out', async () => {
  await withMutant(LP_URL, '    return ns\n  }\n  movements.__lidPrice = true', '    return ns.filter(n => !(n?.toPlace?.length && price(n.toPlace)))\n  }\n  movements.__lidPrice = true', async mod => {
    const r = plan(moves(world(pitCells()), { canDig: true, mod }), [0, 70, 0], new goals.GoalY(74))
    assert.notEqual(r.status, 'success', 'the veto traps the bot (the composition the surcharge exists to avoid)')
  })
})
test('MUTANT KILLED: the lid read one cell too high (the cell itself, not the one below) -> Gale towers on the chest again', async () => {
  await withMutant(LP_URL, ' || !!(lidded && lidded(x, y - 1, z))', ' || !!(lidded && lidded(x, y, z))', async mod => {
    const r = plan(moves(world({ '0,70,0': 'chest' }), { mod }), [0, 71, 0], new goals.GoalY(74))
    assert.ok(r.placed.includes('0,71,0'), `${r.placed}`)
  })
})
test('MUTANT KILLED: the empty-reference rule dropped -> the mid-air tower over the air lid goes unpriced', async () => {
  await withMutant(LP_URL, '  if (emptyAt && emptyAt(p.x, p.y, p.z)) return [{ x: p.x, y: p.y, z: p.z }, out]\n', '', async mod => {
    const w = world({ '0,70,0': 'chest' })
    const up = nb(moves(w, { mod }), { x: 0, y: 72, z: 0 }, [0, 73, 0]), up0 = nb(moves(w, { price: false }), { x: 0, y: 72, z: 0 }, [0, 73, 0])
    assert.equal(up.cost, up0.cost, 'the mutant does not price it')
  })
})
test('MUTANT KILLED (Claude r2 P1): an empty reference read as the ref cell ONLY -> a bridge\'s next block onto a lid goes unpriced', async () => {
  await withMutant(LP_URL, '  if (emptyAt && emptyAt(p.x, p.y, p.z)) return [{ x: p.x, y: p.y, z: p.z }, out]\n', '  if (emptyAt && emptyAt(p.x, p.y, p.z)) return [{ x: p.x, y: p.y, z: p.z }]\n', async mod => {
    const cells = { '3,70,0': 'chest' }
    for (let x = -2; x <= 5; x++) for (let z = -2; z <= 2; z++) for (let y = 61; y <= 69; y++) cells[`${x},${y},${z}`] = 'air'
    cells['0,71,0'] = 'stone'; cells['3,70,0'] = 'chest'; for (let y = 61; y <= 69; y++) cells[`3,${y},0`] = 'stone'
    const w = world(cells)
    const real = nb(moves(w), { x: 2, y: 72, z: 0 }, [3, 72, 0]), mut = nb(moves(w, { mod }), { x: 2, y: 72, z: 0 }, [3, 72, 0]), b0 = nb(moves(w, { price: false }), { x: 2, y: 72, z: 0 }, [3, 72, 0])
    assert.ok(b0 && b0.toPlace.length === 1 && b0.toPlace[0].x === 2 && b0.toPlace[0].y === 71, `positive control: the bridge's ref is the (air) previous bridge cell ${JSON.stringify(b0?.toPlace)}`)
    assert.equal(real.cost, b0.cost + LID_PLACE_COST, 'the real rule prices the block landing on the lid')
    assert.equal(mut.cost, b0.cost, 'the mutant does not')
  })
})
test('MUTANT KILLED: the stand cells dropped from the guard', async () => {
  await withMutant(LP_URL, "      if (Array.isArray(c.stand)) { out.add(k3(c.stand[0], c.stand[1], c.stand[2])); out.add(k3(c.stand[0], c.stand[1] + 1, c.stand[2])) }\n", '', async mod => {
    assert.ok(!mod.placeGuardCells(PLAN).has('10,70,12')); assert.ok(placeGuardCells(PLAN).has('10,70,12'))
  })
})
test('MUTANT KILLED: composterSafeMovements back on the prototype\'s getNeighbors -> the composter walk loses the surcharge', async () => {
  await withMutant(COMP_URL, '  const inner = base.getNeighbors ?? proto.getNeighbors\n', '  const inner = proto.getNeighbors\n', async mod => {
    const w = world({ '0,70,0': 'chest' })
    const m = mod.composterSafeMovements(moves(w), () => true)
    const up = nb(m, { x: 0, y: 71, z: 0 }, [0, 72, 0]), up0 = nb(moves(w, { price: false }), { x: 0, y: 71, z: 0 }, [0, 72, 0])
    assert.equal(up.cost, up0.cost, 'the mutant clone is unpriced')
  })
})

// ---- the wiring (structural; comments stripped; a mutant each) -------------------------------------------------------
const once = (s, needle) => { const n = s.split(needle).length - 1; assert.equal(n, 1, `expected exactly one ${JSON.stringify(needle)}, found ${n}`); return s.indexOf(needle) }
const IDX = strip(readFileSync(INDEX_URL, 'utf8'))
const SKS = strip(readFileSync(SKILLS_URL, 'utf8'))
const idxWired = s => {
  const mk = once(s, 'const lidPlacePrice = makeLidPlacePrice({ registry: bot.registry, on: lidPlaceOn(process.env), guard: () => bot.townPlan?.guard ?? null,')
  once(s, 'return bot.world.getBlockStateId(lidScratch) } })')
  const add = once(s, 'installLidPrice(moves, lidPlacePrice)')
  const clone = once(s, 'Object.assign(gatherMoves, moves)')
  const comp = once(s, 'const composterWalkMoves = composterSafeMovements(moves,')
  assert.ok(mk < add && add < clone && add < comp, 'installed on the walk profile before any clone copies it')
  assert.ok(s.indexOf('bot.pathfinder.setMovements(moves)') > add, 'before the walk profile is installed')
}
test('WIRING index.mjs: the price built as tested, installed on `moves` before every clone and before setMovements', () => idxWired(IDX))
test('WIRING skills.mjs: every head read keeps bot.townPlan.guard', () => {
  once(SKS, "cells: planFurnitureCells(h.head.plan), guard: placeGuardCells(h.head.plan), at: Date.now() } : null")
  once(SKS, "import { placeGuardCells, withoutLidPrice } from './lidplace.mjs'")
})
test('WIRING the capped fallback: index.mjs exposes the price; gather walks a lidFallback plan at the base\'s costs', () => {
  const add = once(IDX, 'installLidPrice(moves, lidPlacePrice)'), exp = once(IDX, 'bot.lidPrice = lidPlacePrice')
  assert.ok(exp > add)
  once(SKS, 'await (plan.lidFallback ? withoutLidPrice(bot.lidPrice ?? null, approachWalk) : approachWalk())')
})
test('MUTANT KILLED: planDigApproach without the base-cost retry -> the deep pit\'s approach is lost', async () => {
  await withMutant(new URL('../src/digapproach.mjs', import.meta.url), "      if (r2?.status === 'success') { result = r2; lidFallback = true }\n", '', async mod => {
    const w = world(deepPit())
    const m = moves(w, { canDig: true, step: () => 16 })
    const bot = { entity: { position: V(0.5, 70, 0.5) }, gatherMovements: m, lidPrice: m.__lidPriceFn, inventory: { items: () => [] }, heldItem: null, blockAt: w.blockAt,
      pathfinder: { getPathFromTo: function * (mv, at, goal, o) { yield { result: new AStar(new Move(0, 70, 0, 64, 0), mv, goal, o.timeout, o.timeout, o.searchRadius).compute() } } } }
    const r = mod.planDigApproach(bot, { x: 0, y: 77, z: 0 }, { goals, reachGoalFor: () => new goals.GoalY(77), endsInReach: () => true })
    assert.notEqual(r?.status, 'success', 'the mutant keeps the priced failure')
  })
})
test('MUTANT (index): the install moved after the clones is detected', () => {
  const line = 'installLidPrice(moves, lidPlacePrice)'
  const m1 = IDX.replace(line, '').replace('Object.assign(gatherMoves, moves)', 'Object.assign(gatherMoves, moves)\n' + line)
  assert.notEqual(m1, IDX, 'MUTATION DID NOT APPLY'); assert.throws(() => idxWired(m1), /before any clone/)
})
