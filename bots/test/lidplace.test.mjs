// LIDPLACE-01 (lidplace.mjs; its wiring in index.mjs and skills.mjs townPlanHead).
//
// BEHAVIOUR FIRST (CLAUDE.md): the guard set and the price as pure functions, then the REAL mineflayer-pathfinder 2.4.5
// Movements and its REAL A* (lib/astar.js) over a small block world, the price installed exactly as index.mjs builds it
// (makeLidPlacePrice). The refusal CHAIN: a bot on a chest, in a pit whose floor is a chest, boxed in a storehouse -- each
// still has a legal move, and where the base towers on the lid the candidate goes round. Source assertions only for the
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
const { placeGuardCells, townPlaceCost, makeLidPlacePrice, liddedStateIds, lidPlaceOn, LID_PLACE_COST } = LP
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
/** A Movements as index.mjs's gather profile has it (towers on, no parkour), with or without the lid price. */
function moves (w, { price = true, guard = null, step = null, canDig = false, mod = LP } = {}) {
  const bot = { registry, version: '1.21.8', blockAt: w.blockAt, entity: { position: V(0.5, 71, 0.5), effects: {} }, entities: {},
                inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot)
  m.canDig = canDig; m.allowParkour = false; m.allowSprinting = false; m.allow1by1towers = true; m.maxDropDown = 6
  m.placeCost = 5   // index.mjs: a pillar step is not as cheap as a walk step
  if (step) m.exclusionAreasStep = [...m.exclusionAreasStep, step]
  if (price) m.exclusionAreasPlace = [...m.exclusionAreasPlace, mod.makeLidPlacePrice({ registry, stateIdAt: w.stateIdAt, guard: () => guard })]
  return m
}
/** The REAL A* from a node -> { status, path, placed: ['x,y,z' of every block the path places] }. */
function plan (m, from, goal, blocks = 64) {
  const r = new AStar(new Move(from[0], from[1], from[2], blocks, 0), m, goal, 4000, 4000, -1).compute()
  const placed = r.path.flatMap(n => (n.toPlace ?? []).filter(p => !p.useOne).map(p => `${p.x + p.dx},${p.y + p.dy},${p.z + p.dz}`))
  return { status: r.status, path: r.path, placed, end: r.path.at(-1) }
}

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
test('PRICE: a cell over a chest, and the cell over THAT (getMoveForward 2.4.5 asks about the cell above its placement); 0 elsewhere; never 100', () => {
  const lidded = (x, y, z) => x === 0 && y === 70 && z === 0
  assert.equal(townPlaceCost(null, lidded, V(0, 71, 0)), LID_PLACE_COST, 'the lid')
  assert.equal(townPlaceCost(null, lidded, V(0, 72, 0)), LID_PLACE_COST, 'the cell a forward bridge onto the lid is priced at')
  assert.equal(townPlaceCost(null, lidded, V(0, 73, 0)), 0, 'two above the lid')
  assert.equal(townPlaceCost(null, lidded, V(1, 71, 0)), 0, 'beside the chest')
  assert.equal(townPlaceCost(null, lidded, V(0, 70, 0)), 0, 'the chest\'s own cell is never placed into (not replaceable)')
  const g = placeGuardCells(PLAN)
  assert.equal(townPlaceCost(g, null, V(12, 70, 10)), LID_PLACE_COST, 'a reserved chest site')
  assert.equal(townPlaceCost(g, null, V(20, 71, 22)), LID_PLACE_COST, 'a station\'s stand head')
  assert.equal(townPlaceCost(g, null, V(14, 70, 10)), 0, 'a free cell')
  assert.equal(townPlaceCost(g, lidded, null), 0); assert.equal(townPlaceCost(g, lidded, { x: NaN, y: 1, z: 1 }), 0)
  assert.ok(LID_PLACE_COST > 3 && LID_PLACE_COST <= 20, `a price, not a veto: ${LID_PLACE_COST}`)
})
test('LIDDED: every chest-like state (all facings, doubles, waterlogged), ender chest, shulker boxes; not barrel, furnace, table', () => {
  const ids = liddedStateIds(registry)
  for (const n of ['chest', 'trapped_chest', 'ender_chest', 'shulker_box', 'red_shulker_box']) {
    const b = registry.blocksByName[n]
    for (let s = b.minStateId; s <= b.maxStateId; s++) assert.ok(ids.has(s), `${n} state ${s}`)
  }
  for (const n of ['barrel', 'furnace', 'crafting_table', 'stone', 'air']) assert.ok(!ids.has(registry.blocksByName[n].defaultState), n)
})
test('LIDPLACE=0: the switch makes the entry 0 everywhere; unset or anything else is on', () => {
  assert.equal(lidPlaceOn({ LIDPLACE: '0' }), false); assert.equal(lidPlaceOn({}), true); assert.equal(lidPlaceOn({ LIDPLACE: '1' }), true)
  const w = world({ '0,70,0': 'chest' })
  assert.equal(makeLidPlacePrice({ registry, stateIdAt: w.stateIdAt, on: false })({ position: V(0, 71, 0) }), 0)
  assert.equal(makeLidPlacePrice({ registry, stateIdAt: w.stateIdAt })({ position: V(0, 71, 0) }), LID_PLACE_COST)
})

// ---- the pathfinder: single moves ------------------------------------------------------------------------------------
const nb = (m, node, to) => m.getNeighbors({ ...node, remainingBlocks: 64 }).find(n => n.x === to[0] && n.y === to[1] && n.z === to[2])
test('MOVES: the tower on a chest, a bridge onto a lid (2.4.5 asks about the cell ABOVE it), a jump-up placing two -- each priced, each still a move', () => {
  const w = world({ '0,70,0': 'chest' })
  const up = nb(moves(w), { x: 0, y: 71, z: 0 }, [0, 72, 0]), up0 = nb(moves(w, { price: false }), { x: 0, y: 71, z: 0 }, [0, 72, 0])
  assert.ok(up && up0, 'the tower on the chest exists with and without the price')
  assert.equal(up.cost, up0.cost + LID_PLACE_COST)
  // a bridge: the bot on a stone pillar at y=70 steps east over the air above a chest at 1,69,0 -- D (1,70,0) is the lid
  const wb = world({ '1,69,0': 'chest', '0,70,0': 'stone' })
  const fw = nb(moves(wb), { x: 0, y: 71, z: 0 }, [1, 71, 0]), fw0 = nb(moves(wb, { price: false }), { x: 0, y: 71, z: 0 }, [1, 71, 0])
  assert.ok(fw0 && fw0.toPlace.length === 1 && fw0.toPlace[0].y + fw0.toPlace[0].dy === 70 && fw0.toPlace[0].x + fw0.toPlace[0].dx === 1, `positive control: the base bridges onto the lid ${JSON.stringify(fw0?.toPlace)}`)
  assert.ok(fw, 'the bridge is still a move'); assert.equal(fw.cost, fw0.cost + LID_PLACE_COST, 'and it is priced although 2.4.5 passed blockC')
  // a jump-up that places D (the lid) AND C on top of it, inside a death disc (step price 16 on every cell)
  const wj = world({ '1,68,0': 'chest', '1,69,0': 'air', '1,70,0': 'air' })
  const death = () => 16
  const j = nb(moves(wj, { step: death }), { x: 0, y: 70, z: 0 }, [1, 71, 0]), j0 = nb(moves(wj, { step: death, price: false }), { x: 0, y: 70, z: 0 }, [1, 71, 0])
  assert.ok(j0 && j0.toPlace.length === 2, `positive control: the base jump-up places two ${JSON.stringify(j0?.toPlace)}`)
  assert.ok(j, `the two-placement jump-up inside a death disc survives (${j0.cost} + 2 x ${LID_PLACE_COST} <= 100)`)
  assert.equal(j.cost, j0.cost + 2 * LID_PLACE_COST)
})

// ---- the refusal CHAIN: the REAL A* ----------------------------------------------------------------------------------
test('CHAIN on a chest (Gale, showcase 10-25): the base towers on the lid, the candidate steps off and towers beside it; both reach', () => {
  const w = world({ '0,70,0': 'chest' })
  const base = plan(moves(w, { price: false }), [0, 71, 0], new goals.GoalY(74))
  assert.equal(base.status, 'success'); assert.ok(base.placed.includes('0,71,0'), `positive control: the base places on the lid ${base.placed}`)
  const cand = plan(moves(w), [0, 71, 0], new goals.GoalY(74))
  assert.equal(cand.status, 'success', 'the candidate reaches the goal')
  assert.ok(!cand.placed.some(k => k === '0,71,0' || k === '0,72,0'), `no block on the lid or above it: ${cand.placed}`)
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
  const cells = { '0,69,0': 'chest' }
  for (let y = 69; y <= 73; y++) for (const [x, z] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) cells[`${x},${y},${z}`] = 'bedrock'
  const w = world(cells)
  const r = plan(moves(w, { canDig: true }), [0, 70, 0], new goals.GoalY(74))
  assert.equal(r.status, 'success', 'a legal way out exists'); assert.ok(r.placed.includes('0,70,0'), `it is the lid tower: ${r.placed}`)
  const d = plan(moves(w, { canDig: true, step: () => 16 }), [0, 70, 0], new goals.GoalY(74))
  assert.equal(d.status, 'success', 'and inside a death disc too')
})
test('CHAIN boxed in a storehouse (chests on all eight sides, a wall 3 high beyond, no digging): the base builds on a lid; the candidate towers in place and gets out, every lid open', () => {
  const cells = {}
  for (const [x, z] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) cells[`${x},70,${z}`] = 'chest'
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

// ---- mutants (lidplace.mjs) ------------------------------------------------------------------------------------------
test('MUTANT KILLED: the dy -1 look removed -> a bridge onto a lid goes unpriced on 2.4.5', async () => {
  await withMutant(LP_URL, '  return guarded(guard, lidded, x, y, z) || guarded(guard, lidded, x, y - 1, z) ? LID_PLACE_COST : 0\n',
    '  return guarded(guard, lidded, x, y, z) ? LID_PLACE_COST : 0\n', async mod => {
      const lidded = (x, y, z) => x === 1 && y === 69 && z === 0
      assert.equal(mod.townPlaceCost(null, lidded, V(1, 71, 0)), 0, 'the mutant misses the cell 2.4.5 asks about')
      assert.equal(townPlaceCost(null, lidded, V(1, 71, 0)), LID_PLACE_COST, 'the real one prices it')
    })
})
test('MUTANT KILLED: the price made a veto (100) -> the bot in the chest-floored pit has no way out', async () => {
  await withMutant(LP_URL, 'export const LID_PLACE_COST = 10\n', 'export const LID_PLACE_COST = 100\n', async mod => {
    const cells = { '0,69,0': 'chest' }
    for (let y = 69; y <= 73; y++) for (const [x, z] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) cells[`${x},${y},${z}`] = 'bedrock'
    const r = plan(moves(world(cells), { canDig: true, mod }), [0, 70, 0], new goals.GoalY(74))
    assert.notEqual(r.status, 'success', 'the veto traps the bot (the composition the price exists to avoid)')
  })
})
test('MUTANT KILLED: the lid test removed -> Gale towers on the chest again', async () => {
  await withMutant(LP_URL, ' || !!(lidded && lidded(x, y - 1, z))', '', async mod => {
    const r = plan(moves(world({ '0,70,0': 'chest' }), { mod }), [0, 71, 0], new goals.GoalY(74))
    assert.ok(r.placed.includes('0,71,0'), `${r.placed}`)
  })
})
test('MUTANT KILLED: the stand cells dropped from the guard', async () => {
  await withMutant(LP_URL, "      if (Array.isArray(c.stand)) { out.add(k3(c.stand[0], c.stand[1], c.stand[2])); out.add(k3(c.stand[0], c.stand[1] + 1, c.stand[2])) }\n", '', async mod => {
    assert.ok(!mod.placeGuardCells(PLAN).has('10,70,12')); assert.ok(placeGuardCells(PLAN).has('10,70,12'))
  })
})

// ---- the wiring (structural; comments stripped; a mutant each) -------------------------------------------------------
const once = (s, needle) => { const n = s.split(needle).length - 1; assert.equal(n, 1, `expected exactly one ${JSON.stringify(needle)}, found ${n}`); return s.indexOf(needle) }
const IDX = strip(readFileSync(INDEX_URL, 'utf8'))
const SKS = strip(readFileSync(SKILLS_URL, 'utf8'))
const idxWired = s => {
  const zone = once(s, 'moves.exclusionAreasPlace = [...(moves.exclusionAreasPlace ?? []), zonePlacePrice]')
  const mk = once(s, 'const lidPlacePrice = makeLidPlacePrice({ registry: bot.registry, on: lidPlaceOn(process.env), guard: () => bot.townPlan?.guard ?? null,')
  once(s, 'return bot.world.getBlockStateId(lidScratch) } })')
  const add = once(s, 'moves.exclusionAreasPlace = moves.exclusionAreasPlace.concat(lidPlacePrice)')
  const clone = once(s, 'Object.assign(gatherMoves, moves)')
  assert.ok(zone < add, 'appended after the zone array is made (not overwritten by it)')
  assert.ok(mk < add && add < clone, 'on the shared array before any clone copies its reference')
  assert.ok(s.indexOf('bot.pathfinder.setMovements(moves)') > add, 'before the walk profile is installed')
}
test('WIRING index.mjs: the price built as tested, on the shared place array after the zone price and before every clone', () => idxWired(IDX))
test('WIRING skills.mjs: every head read keeps bot.townPlan.guard', () => {
  once(SKS, "cells: planFurnitureCells(h.head.plan), guard: placeGuardCells(h.head.plan), at: Date.now() } : null")
  once(SKS, "import { placeGuardCells } from './lidplace.mjs'")
})
test('MUTANT (index): the price appended after the clones is detected', () => {
  const line = 'moves.exclusionAreasPlace = moves.exclusionAreasPlace.concat(lidPlacePrice)'
  const m1 = IDX.replace(line, '').replace('Object.assign(gatherMoves, moves)', 'Object.assign(gatherMoves, moves)\n' + line)
  assert.notEqual(m1, IDX, 'MUTATION DID NOT APPLY'); assert.throws(() => idxWired(m1), /before any clone/)
})
