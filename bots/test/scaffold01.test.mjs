// SCAFFOLD-01show (scaftown.mjs's wild price and gather's priced capped searches; takeback.mjs's carried receipts, clock prune,
// restart file and own-tower descent; features.mjs scafLeftIo). Owner 11-20: "yes, fix it, fix the movement code and remove all the
// pillars natural and unnatural".
//
// BEHAVIOUR FIRST (CLAUDE.md): the decisions as pure functions; then the REFUSAL CHAINS on mineflayer-pathfinder 2.4.5's REAL
// Movements and A* -- a pit far from town still towers out under the wild price, a gather approach whose only way is a tower still
// finds it when the price spends its cost cap (the restart), an escape profile is the base's -- and the take-back's chain on a fake
// bot whose goto behaves as the library's (the harness of takeback.test.mjs). Every guard has a mutant whose anchor is present and
// unique, and every scenario passes on the real module first (the positive control).
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'

import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
import * as ST from '../src/scaftown.mjs'
import * as TB from '../src/takeback.mjs'
import { withDigScope } from '../src/digtown.mjs'
const { withTimeout } = await import('../src/skills.mjs')

const require_ = createRequire(import.meta.url)
const ST_URL = new URL('../src/scaftown.mjs', import.meta.url)
const TB_URL = new URL('../src/takeback.mjs', import.meta.url)
const FEAT_URL = new URL('../src/features.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 8).join('\n        ')}`) }
}
/** climb-escape.test.mjs's withMutant: every anchor present AND unique, or the mutant is never written (a silent no-op reads as killed). */
async function withMutant (url, pairs, fn) {
  let src = readFileSync(url, 'utf8')
  for (const [o, n] of pairs) {
    assert.ok(src.includes(o), `MUTATION DID NOT APPLY: ${JSON.stringify(o.slice(0, 70))} is not in ${url.pathname}`)
    assert.ok(src.split(o).length === 2, `the mutation target is not unique: ${JSON.stringify(o.slice(0, 70))}`)
    src = src.replace(o, n)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await sleep(3) } }

// ================================================================================================================================
console.log('THE PURE RULES (scaftown)')
await t('the wild price: a placement outside the town\'s area costs wildCost, inside it the town\'s cost (never both); no area is all wild; wild 0 is the base', () => {
  const a = ST.scafAreaOf({ home: { x: 0, y: 70, z: 0 } })
  const C = ST.SCAF_TOWN.cost, W = ST.SCAF_TOWN.wildCost
  assert.ok(W > 0 && W < C, 'the wild price is real and below the town\'s')
  const up = (x, y, z) => ({ x, y, z, dx: 0, dy: 1, dz: 0 })
  assert.strictEqual(ST.scafTownSurcharge([up(0, 69, 0)], a, C, W), C, 'in the town: the town\'s price only')
  assert.strictEqual(ST.scafTownSurcharge([up(300, 69, 0)], a, C, W), W, 'far from town: the wild price')
  assert.strictEqual(ST.scafTownSurcharge([up(0, 40, 0)], a, C, W), W, 'under the town (below home.y - dy): wild, not free')
  assert.strictEqual(ST.scafTownSurcharge([up(0, 69, 0), up(300, 69, 0)], a, C, W), C + W)
  assert.strictEqual(ST.scafTownSurcharge([up(300, 69, 0)], null, C, W), W, 'no home: every placement is wild')
  assert.strictEqual(ST.scafTownSurcharge([up(300, 69, 0)], a, C, 0), 0, 'wild 0: the base\'s far price')
  assert.strictEqual(ST.scafTownSurcharge([{ x: 300, y: 70, z: 0, dx: 0, dy: 0, dz: 0, useOne: true }], a, C, W), 0, 'a gate opened places nothing')
  assert.strictEqual(ST.scafWildOn({}), true); assert.strictEqual(ST.scafWildOn({ SCAFWILD: 'off' }), false)
  assert.strictEqual(ST.makeScafTownPrice({ wild: false }).wildCost, 0); assert.strictEqual(ST.makeScafTownPrice({}).wildCost, W)
  assert.ok(/ wild=10 /.test(ST.scafTownModeDetail({}, a)), ST.scafTownModeDetail({}, a))
})
await t('scafProfileFlags: the walk and gather priced (gather\'s capped searches too); every escape and the tunnel never', () => {
  assert.deepStrictEqual(ST.scafProfileFlags('walk'), { scafTown: true, scafCapped: false })
  assert.deepStrictEqual(ST.scafProfileFlags('gather'), { scafTown: true, scafCapped: true })
  for (const p of ['ascend', 'descend', 'deck', 'water', 'tunnel', 'nonsense']) assert.strictEqual(ST.scafProfileFlags(p).scafTown, false, p)
})
await t('searchMode / restartsSearch: a scafCapped profile\'s capped search is priced; within a cap a priced noPath restarts (it may be the price\'s), an uncapped one does not', () => {
  assert.strictEqual(ST.searchMode({ radius: 400 }), 'capped')
  assert.strictEqual(ST.searchMode({ radius: 400, cappedPriced: true }), 'priced')
  assert.strictEqual(ST.searchMode({ radius: 400, cappedPriced: true, off: 1 }), 'off')
  assert.strictEqual(ST.restartsSearch({ mode: 'priced', hits: 2, capped: true }, 'noPath'), true)
  assert.strictEqual(ST.restartsSearch({ mode: 'priced', hits: 0, capped: true }, 'noPath'), false, 'the price never touched it: the base\'s answer')
  assert.strictEqual(ST.restartsSearch({ mode: 'priced', hits: 2, capped: false }, 'noPath'), false, 'uncapped: an exhausted heap is the base\'s answer too')
  assert.strictEqual(ST.restartsSearch({ mode: 'priced', hits: 2, capped: true, restarted: true }, 'noPath'), false, 'once')
  assert.strictEqual(ST.restartsSearch({ mode: 'priced', hits: 2, cut: true }, 'timeout'), true, 'the budget restart as before')
  const p = ST.makeScafTownPrice({ now: () => 0 })
  const s = p.begin({ goal: null, radius: 400, movements: { scafCapped: true, scafTown: true } })
  assert.strictEqual(s.mode, 'priced'); assert.strictEqual(s.capped, true); assert.strictEqual(s.radius, 400); assert.strictEqual(p.cappedPriced, 1)
  assert.strictEqual(p.begin({ radius: 400, movements: { scafCapped: true, scafTown: false } }).mode, 'capped', 'an exempt profile is never priced')
  assert.strictEqual(p.begin({ radius: 400, movements: { scafCapped: false } }).mode, 'capped', 'the walk\'s capped probes as before')
})

// ---- the REAL A* ---------------------------------------------------------------------------------------------------------------
const { Movements, goals } = require_('mineflayer-pathfinder')
const AStar = require_('mineflayer-pathfinder/lib/astar.js')
const Move = require_('mineflayer-pathfinder/lib/move.js')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)
const V = (x, y, z) => new Vec3(x, y, z)
/** cells: { 'x,y,z': name }; y <= 69 is stone, the rest air. */
function world (cells = {}) {
  const nameAt = (x, y, z) => cells[`${x},${y},${z}`] ?? (y <= 69 ? 'stone' : 'air')
  return { blockAt: p => { const b = Block.fromStateId(registry.blocksByName[nameAt(p.x, p.y, p.z)].defaultState, 0); b.position = V(p.x, p.y, p.z); return b }, nameAt }
}
/** index.mjs's walk-shaped profile (canDig per arg, towers, no parkour, placeCost 5) with the price installed as index.mjs does. */
function moves (w, { home = { x: 0, y: 70, z: 0 }, wild = true, canDig = false, flags = 'walk', mod = ST, price = true } = {}) {
  const bot = { registry, version: '1.21.8', blockAt: w.blockAt, entity: { position: V(0.5, 71, 0.5), effects: {} }, entities: {},
                inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot)
  m.canDig = canDig; m.allowParkour = false; m.allowSprinting = false; m.allow1by1towers = true; m.maxDropDown = 6; m.placeCost = 5
  if (price) {
    const area = home ? mod.scafAreaOf({ home }) : null
    const p = mod.makeScafTownPrice({ area: () => area, wild, now: () => 0 })
    mod.installScafTownPrice(m, p)
    Object.assign(m, mod.scafProfileFlags(flags))
    m.__price = p
  }
  return m
}
const placedOf = path => path.flatMap(n => (n.toPlace ?? []).filter(p => !p.useOne).map(p => `${p.x + p.dx},${p.y + p.dy},${p.z + p.dz}`))
/** mineflayer-pathfinder 2.4.5's generator protocol over the REAL A* (index.js:70-101), the scope installed as index.mjs does. */
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
const search = (mod, m, from, goal, options = {}) => { const pf = fakePathfinder(); mod.installScafTownSearch(pf, m.__price); let last = null; for (const v of pf.getPathFromTo(m, V(...from), goal, options)) last = v.result; return last }
/** A 1x1 pit 3 deep far from town (x 300): floor top 66, nothing to climb. */
const PIT = { '300,67,0': 'air', '300,68,0': 'air', '300,69,0': 'air' }
/** A shelf 3 high (x 4..9, top 72) with a one-high staircase 14 along at z 14, far from town (home 500 away). */
function ledge () {
  const c = {}
  for (let x = 4; x <= 9; x++) for (let z = -20; z <= 20; z++) for (let y = 70; y <= 72; y++) c[`${x},${y},${z}`] = 'stone'
  c['1,70,14'] = 'stone'; c['2,70,14'] = 'stone'; c['2,71,14'] = 'stone'; c['3,70,14'] = 'stone'; c['3,71,14'] = 'stone'; c['3,72,14'] = 'stone'
  return c
}
const FAR = { x: 500, y: 70, z: 500 }

console.log('THE REFUSAL CHAINS (real Movements, real A*)')
await t('a pit FAR from town under the wild price: the walk still towers out (no new dead end), through the search scope too', () => {
  const w = world(PIT), goal = new goals.GoalBlock(303, 70, 0)
  const base = search(ST, moves(w, { price: false }), [300, 67, 0], goal)
  assert.strictEqual(base.status, 'success'); assert.ok(placedOf(base.path).length >= 3, 'positive control: the base towers out')
  const m = moves(w, { home: FAR })
  const cand = search(ST, m, [300, 67, 0], goal)
  assert.strictEqual(cand.status, 'success', 'the priced walk gets out')
  assert.ok(placedOf(cand.path).length >= 3, `it towers: ${placedOf(cand.path).join(' ')}`)
  assert.ok(m.__price.hits > 0, 'and the price did touch the search (not a vacuous pass)')
})
await t('the wild price takes the stairs where they are (FAR from town): fewer placements than the base, and the base towers', () => {
  const w = world(ledge()), goal = new goals.GoalBlock(6, 73, 0)
  const base = search(ST, moves(w, { price: false }), [0, 70, 0], goal)
  const off = search(ST, moves(w, { home: FAR, wild: false }), [0, 70, 0], goal)
  const cand = search(ST, moves(w, { home: FAR }), [0, 70, 0], goal)
  assert.ok(placedOf(base.path).length >= 1); assert.deepStrictEqual(placedOf(off.path), placedOf(base.path), 'SCAFWILD off is the base')
  assert.strictEqual(cand.status, 'success'); assert.deepStrictEqual(placedOf(cand.path), [], 'the stairs')
})
await t('an escape profile (scafTown false) under the wild price is the base\'s, placement for placement', () => {
  const w = world(PIT), goal = new goals.GoalBlock(303, 70, 0)
  const base = search(ST, moves(w, { price: false }), [300, 67, 0], goal)
  const esc = search(ST, moves(w, { home: FAR, flags: 'ascend' }), [300, 67, 0], goal)
  assert.deepStrictEqual(placedOf(esc.path), placedOf(base.path)); assert.strictEqual(esc.cost, base.cost)
})
/** GATHER'S CAP: the only way to the stand is a 3-high tower (a 1x1 shaft whose walls rise to 73); the cap fits the base's tower and not
 *  the priced one, so the priced capped search runs out of its cap: noPath. */
const SHAFT = (() => { const c = {}; for (let y = 70; y <= 72; y++) for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) c[`${x + 300},${y},${z}`] = 'stone'; return c })()
await t('GATHER priced within its cap: the tower that is its only way is still found (the restart at the base\'s costs, with the cap)', () => {
  const w = world(SHAFT), goal = new goals.GoalBlock(300, 73, 0)
  const base = search(ST, moves(w, { price: false, canDig: true }), [300, 70, 0], goal, { searchRadius: 40 })
  assert.strictEqual(base.status, 'success'); assert.ok(placedOf(base.path).length === 3, `positive control: the base towers 3 within the cap (${placedOf(base.path)})`)
  // the cap alone, priced and with no restart, fails: the price spends it (the reason capped searches were unpriced)
  const raw = new AStar(new Move(300, 70, 0, 64, 0), moves(w, { home: FAR, canDig: true, flags: 'gather' }), goal, 4000, 4000, 40).compute()
  assert.strictEqual(raw.status, 'noPath', `positive control: priced within the cap, no restart: ${raw.status}`)
  const m = moves(w, { home: FAR, canDig: true, flags: 'gather' })
  const cand = search(ST, m, [300, 70, 0], goal, { searchRadius: 40 })
  assert.strictEqual(cand.status, 'success', 'gather still gets there'); assert.deepStrictEqual(placedOf(cand.path), placedOf(base.path))
  assert.strictEqual(m.__price.restarts, 1); assert.strictEqual(m.__price.cappedPriced, 1)
})
await t('GATHER priced within its cap where a way round exists: it takes the stairs (the price bites gather now)', () => {
  const w = world(ledge()), goal = new goals.GoalBlock(6, 73, 0)
  const base = search(ST, moves(w, { price: false, canDig: false }), [0, 70, 0], goal, { searchRadius: 400 })
  const cand = search(ST, moves(w, { home: FAR, flags: 'gather' }), [0, 70, 0], goal, { searchRadius: 400 })
  assert.ok(placedOf(base.path).length >= 1); assert.strictEqual(cand.status, 'success'); assert.deepStrictEqual(placedOf(cand.path), [])
  const walk = search(ST, moves(w, { home: FAR, flags: 'walk' }), [0, 70, 0], goal, { searchRadius: 400 })
  assert.deepStrictEqual(placedOf(walk.path), placedOf(base.path), 'the walk\'s capped probes stay the base\'s')
})
await t('MUTANTS (scaftown): the capped restart, the cap kept on restart, the wild price, gather\'s capped pricing -- each fails its chain', async () => {
  const w = world(SHAFT), goal = new goals.GoalBlock(300, 73, 0)
  await withMutant(ST_URL, [["((s.cut === true && status !== 'noPath') || (s.capped === true && status === 'noPath'))", "(s.cut === true && status !== 'noPath')"]], async mod => {
    const r = search(mod, moves(w, { home: FAR, canDig: true, flags: 'gather', mod }), [300, 70, 0], goal, { searchRadius: 40 })
    assert.strictEqual(r.status, 'noPath', 'killed: without the capped restart gather loses its only way')
  })
  await withMutant(ST_URL, [['const fresh = new ctx.constructor(start, ctx.movements, ctx.goal, ctx.timeout, ctx.tickTimeout, fin(radius) && radius >= 0 ? radius : -1)', 'const fresh = new ctx.constructor(start, ctx.movements, ctx.goal, ctx.timeout, ctx.tickTimeout, -1)']], async mod => {
    // a restart in place that drops the cap: the restarted search is unbounded (its maxCost -1)
    const m = moves(w, { home: FAR, canDig: true, flags: 'gather', mod })
    const ctx = new AStar(new Move(300, 70, 0, 64, 0), m, goal, 4000, 4000, 40)
    ctx.compute()
    assert.strictEqual(mod.restartInPlace(ctx, 40), true)
    assert.strictEqual(ctx.maxCost, -1, 'killed: the cap is gone after the restart')
  })
  {
    const m = moves(w, { home: FAR, canDig: true, flags: 'gather' })
    const ctx = new AStar(new Move(300, 70, 0, 64, 0), m, goal, 4000, 4000, 40); ctx.compute()
    assert.strictEqual(ST.restartInPlace(ctx, 40), true); assert.ok(ctx.maxCost > 0, 'positive control: the real module keeps the cap')
  }
  await withMutant(ST_URL, [['    else w++   // scaffold-01show', '    else void 0   // scaffold-01show']], async mod => {
    const r = search(mod, moves(world(ledge()), { home: FAR, mod }), [0, 70, 0], new goals.GoalBlock(6, 73, 0))
    assert.ok(placedOf(r.path).length >= 1, 'killed: without the wild price the far ledge is towered')
  })
  await withMutant(ST_URL, [["const mode = searchMode({ on, off: price.off, radius, key, latch: price.latch, now: t, cappedPriced: movements?.scafCapped === true && movements?.scafTown !== false })", 'const mode = searchMode({ on, off: price.off, radius, key, latch: price.latch, now: t })']], async mod => {
    const r = search(mod, moves(world(ledge()), { home: FAR, flags: 'gather', mod }), [0, 70, 0], new goals.GoalBlock(6, 73, 0), { searchRadius: 400 })
    assert.ok(placedOf(r.path).length >= 1, 'killed: gather\'s capped search unpriced again')
  })
})

// ================================================================================================================================
console.log('THE PURE RULES (takeback)')
const FREE = c => false
await t('ownTowerUnder: a free-standing tower of its own blocks comes down; a hole\'s rim, a cliff, a bridge, a hanging run, a wet floor, a short or a tall run never', () => {
  // own: the column x 0, y 64..67 (feet at 68); solid: own blocks + the floor at 63 and below
  const tower = new Set(['0,64,0', '0,65,0', '0,66,0', '0,67,0'])
  const own = c => tower.has(c.join(','))
  const solid = extra => c => own(c) || c[1] <= 63 || extra.has(c.join(','))
  assert.deepStrictEqual(TB.ownTowerUnder([0, 68, 0], { own, solid: solid(new Set()) }).cells, [[0, 67, 0], [0, 66, 0], [0, 65, 0], [0, 64, 0]])
  assert.strictEqual(TB.ownTowerUnder([0, 68, 0], { own, solid: solid(new Set(['1,67,0'])) }).why, 'ledge', 'a rim or a cliff beside the top: stepped off, never dug from under')
  assert.strictEqual(TB.ownTowerUnder([0, 68, 0], { own, solid: solid(new Set(['0,67,-1'])) }).why, 'ledge')
  assert.strictEqual(TB.ownTowerUnder([0, 68, 0], { own: c => c.join(',') === '0,67,0' || c.join(',') === '0,67,1', solid: c => c.join(',') === '0,67,1' || c.join(',') === '0,67,0' }).why, 'ledge', 'a bridge: its next block')
  assert.strictEqual(TB.ownTowerUnder([0, 68, 0], { own: c => c[1] >= 66 && c[0] === 0 && c[2] === 0 && c[1] <= 67, solid: c => own(c) && c[1] >= 66 }).why, 'no_floor', 'a hanging run: air under it')
  assert.strictEqual(TB.ownTowerUnder([0, 68, 0], { own, solid: solid(new Set()), liquid: c => c[1] === 63 }).why, 'no_floor', 'water under it')
  assert.strictEqual(TB.ownTowerUnder([0, 65, 0], { own: c => c.join(',') === '0,64,0', solid: c => c[1] <= 64 && c.join(',') !== '0,64,1' && c.join(',') !== '0,64,-1' && c.join(',') !== '1,64,0' && c.join(',') !== '-1,64,0' }).why, 'short')
  assert.strictEqual(TB.ownTowerUnder([0, 68, 0], { own: FREE, solid: solid(new Set()) }).why, 'not_own')
  const T2 = { ...TB.TAKEBACK, descendMax: 3 }
  assert.strictEqual(TB.ownTowerUnder([0, 68, 0], { own, solid: solid(new Set()) }, T2).why, 'tall')
})
await t('descentWanted: a goal away from the tower, or below it; never one up here beside it, nor an unknown one', () => {
  const feet = [0, 68, 0]
  assert.strictEqual(TB.descentWanted({ x: 40, y: 64, z: 0 }, feet), true)
  assert.strictEqual(TB.descentWanted({ x: 2, y: 64, z: 1 }, feet), true, 'beside it, but on the ground')
  assert.strictEqual(TB.descentWanted({ x: 1, y: 69, z: 0 }, feet), false, 'the next log of the same tree')
  assert.strictEqual(TB.descentWanted({ x: 1, z: 0 }, feet), false, 'beside it with no height')
  assert.strictEqual(TB.descentWanted({ pos: { x: 30, y: 70, z: 0 } }, feet), true, 'GoalLookAtBlock / GoalPlaceBlock hold pos')
  assert.strictEqual(TB.descentWanted(null, feet), false); assert.strictEqual(TB.descentWanted({ entity: {} }, feet), false)
})
await t('carriedFrom / carryEntry: a carried receipt\'s file entry round-trips; malformed or older than carryMs is dropped', () => {
  const r = { cell: [1, 2, 3], block: 'dirt', t: 1000, shape: 'pillar', zone: 'out' }
  const e = TB.carryEntry(r)
  assert.deepStrictEqual(e, { at: [1, 2, 3], block: 'dirt', t: 1000, shape: 'pillar', zone: 'out' })
  const back = TB.carriedFrom(e, 2000)
  assert.deepStrictEqual(back.cell, [1, 2, 3]); assert.strictEqual(back.carried, true); assert.strictEqual(back.used, true)
  assert.strictEqual(TB.carriedFrom(e, 1000 + TB.TAKEBACK.carryMs + 1), null)
  assert.strictEqual(TB.carriedFrom({ ...e, at: [1, 2] }, 2000), null); assert.strictEqual(TB.carriedFrom({ ...e, block: '?' }, 2000), null)
  assert.ok(/^placed=2 taken=1 later=0 descend=0 left=1 halts=1 capped=0 pre=0 fenced=1 profile=walk ms=5 end=ok$/.test(TB.walkDetail({ placed: 2, taken: 1 }, { left: 1, halts: 1, fenced: true, profile: 'walk', ms: 5 })))
})

// ---- the fake bot: takeback.test.mjs's harness (a goto as the library's), plus a body that falls when the block under it is dug ----
const T = Object.freeze({ ...TB.TAKEBACK, tickMs: 4, unusedMs: 60, budgetMs: 400, reuseMs: 400, ttlMs: 300, carryMs: 5_000, pruneMs: 20, saveMs: 20, landMs: 300 })
const REC = (cell, o = {}) => ({ cell, block: 'dirt', reason: 'pathfinder', shape: 'pillar', zone: 'out', profile: 'walk', ...o })
function fake ({ env = {}, M = TB, digMs = 5, profile = 'walk', io = null, timers = false, Tx = T } = {}) {
  const bot = new EventEmitter()
  const cells = new Map()
  const rows = [], gotos = []
  bot.entity = { position: { x: 0.5, y: 64, z: 0.5 }, onGround: true, isInWater: false }
  bot.entities = { 1: bot.entity }
  bot.health = 20
  bot.movementProfile = profile
  const name = (x, y, z) => cells.get(`${x},${y},${z}`) ?? (y <= 63 ? 'stone' : 'air')
  bot.blockAt = v => { const n = name(v.x, v.y, v.z); return { name: n, position: { x: v.x, y: v.y, z: v.z }, boundingBox: /air$/.test(n) ? 'empty' : 'block', props: null } }
  bot.canSeeBlock = () => true
  bot.equip = async () => {}
  bot.digTime = () => 750
  bot.dug = []
  bot.dig = b => new Promise(resolve => {
    setTimeout(() => {
      const k = `${b.position.x},${b.position.y},${b.position.z}`
      cells.set(k, 'air'); bot.dug.push(k)
      // the body over it falls onto the block below (the real one does, under Paper's physics)
      const p = bot.entity.position
      if (Math.floor(p.x) === b.position.x && Math.floor(p.z) === b.position.z && Math.floor(p.y) === b.position.y + 1) setTimeout(() => { bot.entity.position = { ...p, y: p.y - 1 } }, 5)
      resolve()
    }, digMs)
  })
  bot.stopDigging = () => {}
  let goal = null
  const setGoalFake = g => { goal = g; bot.emit('goal_updated', g, false) }
  bot.pathfinder = {
    movements: { exclusionAreasBreak: [] },
    isBuilding: () => false, isMining: () => false, isMoving: () => false, bestHarvestTool: () => null,
    get goal () { return goal },
    setGoal: setGoalFake,
    goto: g => new Promise((resolve, reject) => {
      const entry = { goal: g, settled: null }
      gotos.push(entry)
      const done = (err, val) => {
        bot.removeListener('goal_updated', onGoal); bot.removeListener('path_stop', onStop); bot.removeListener('goal_reached', onReach)
        setTimeout(() => { entry.settled = err ? err.name : 'ok'; err ? reject(err) : resolve(val) }, 0)
      }
      const onGoal = ng => { if (ng !== g) done(Object.assign(new Error('The goal was changed before it could be completed!'), { name: 'GoalChanged' })) }
      const onStop = () => done(Object.assign(new Error('Path was stopped'), { name: 'PathStopped' }))
      const onReach = () => done(null, undefined)
      bot.on('path_stop', onStop); bot.on('goal_reached', onReach); bot.on('goal_updated', onGoal)
      setGoalFake(g)
    }),
  }
  const tb = M.installTakeback(bot, { emit: (kind, status, detail) => rows.push({ kind, status, detail }), env, T: Tx, timers, io })
  const place = (cell, o = {}) => { cells.set(cell.join(','), o.block ?? 'dirt'); tb?.note(REC(cell, o)) }
  const stand = (x, y, z) => { bot.entity.position = { x: x + 0.5, y, z: z + 0.5 } }
  const out = () => rows.filter(r => r.kind === 'takeback').map(r => /outcome=(\S+) why=(\S+)/.exec(r.detail).slice(1, 3).join(':'))
  const arrive = () => { bot.emit('goal_reached', goal); goal = null }
  const walk = (g, ms = 3_000) => { const p = withTimeout(bot.pathfinder.goto(g), ms, bot, { needsDrop: false }); p.catch(() => {}); return p }
  const walkRow = () => rows.filter(r => r.kind === 'takeback_walk').map(r => r.detail)
  return { bot, cells, rows, gotos, tb, place, stand, name, out, arrive, walk, walkRow }
}
/** A walk that towers 4 at x 0 (64..67), stands on top, and ARRIVES there (gather's stand beside a trunk). */
async function towerUp (f) {
  const p = f.walk({ id: 'up', x: 0, y: 68, z: 0 })
  for (let y = 64; y <= 67; y++) { f.place([0, y, 0]); f.stand(0, y + 1, 0) }
  await sleep(2 * T.tickMs)
  f.arrive(); await p
}

console.log('THE CHAIN (fake bot)')
await t('CARRIED: a block the walk left out of reach is no longer given up at ttl -- carried, and the bot\'s next walk past it takes it back (`dug why=later`)', async () => {
  const f = fake()
  const p = f.walk({ id: 'a', x: 40, y: 64, z: 0 })
  f.place([1, 64, 0], { shape: 'step' }); f.stand(1, 65, 0); await sleep(3 * T.tickMs)
  f.stand(30, 64, 0)                                    // walked on out of reach
  f.arrive(); await p
  await sleep(T.ttlMs + 20); f.tb.prune()
  assert.deepStrictEqual(f.out(), ['carried:expired'], 'carried, not left')
  assert.strictEqual(f.tb.state.open.length, 1)
  const q = f.walk({ id: 'b', x: -40, y: 64, z: 0 })
  f.stand(3, 64, 0)                                     // its way back passes the block
  await until(() => f.name(1, 64, 0) === 'air')
  await until(() => f.gotos.length === 3)
  f.arrive(); await q
  assert.deepStrictEqual(f.out(), ['carried:expired', 'dug:later'])
  assert.ok(f.walkRow().some(d => /placed=0 taken=1 later=1 /.test(d)), f.walkRow().join(' | '))
})
await t('POSITIVE CONTROL + MUTANT: with expiry as before (left at ttl) the block is never taken on the way back (killed)', async () => {
  await withMutant(TB_URL, [["      else if (!r.carried && t - r.t > T.ttlMs) carry(r, 'expired')", "      else if (!r.carried && t - r.t > T.ttlMs) row(r, 'left', 'expired')"]], async M => {
    const f = fake({ M })
    const p = f.walk({ id: 'a', x: 40, y: 64, z: 0 })
    f.place([1, 64, 0], { shape: 'step' }); f.stand(1, 65, 0); await sleep(3 * T.tickMs); f.stand(30, 64, 0); f.arrive(); await p
    await sleep(T.ttlMs + 20); f.tb.prune()
    const q = f.walk({ id: 'b', x: -40, y: 64, z: 0 }); f.stand(3, 64, 0)
    await sleep(20 * T.tickMs)
    assert.strictEqual(f.name(1, 64, 0), 'dirt', 'the mutant left it standing'); assert.deepStrictEqual(f.out(), ['left:expired'])
    f.arrive(); await q
  })
})
await t('THE CLOCK: expiry is judged on time (pruneMs), not only at the next placement; the carried list is written to the bot\'s file', async () => {
  const saved = []
  const f = fake({ timers: true, io: { load: () => [], save: e => saved.push(e) } })
  const p = f.walk({ id: 'a', x: 40, y: 64, z: 0 })
  f.place([1, 64, 0]); f.stand(1, 65, 0); await sleep(3 * T.tickMs); f.stand(30, 64, 0); f.arrive(); await p
  await until(() => f.out().includes('carried:expired'), T.ttlMs + 400)
  await until(() => saved.length > 0, 400)
  assert.deepStrictEqual(saved.at(-1).map(e => e.at), [[1, 64, 0]])
  f.tb.final()
})
await t('MUTANT: the clock prune removed -- nothing is carried until another block is placed (killed)', async () => {
  await withMutant(TB_URL, [['try { if (!st.busy) prune(); if (now() - lastSave', 'try { if (false) prune(); if (now() - lastSave']], async M => {
    const f = fake({ M, timers: true })
    const p = f.walk({ id: 'a', x: 40, y: 64, z: 0 })
    f.place([1, 64, 0]); f.stand(1, 65, 0); await sleep(3 * T.tickMs); f.stand(30, 64, 0); f.arrive(); await p
    await sleep(T.ttlMs + 150)
    assert.deepStrictEqual(f.out(), [], 'the mutant never judged it')
    f.tb.final()
  })
})
await t('A RESTART: final() carries what is open (`carried why=ended`) onto the hand-off file; the next install keeps it ON THE FILE but never digs it (review r1: unseen, it may be a replacement)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'scafleft-'))
  try {
    const { scafLeftIo } = await import('../src/features.mjs')
    const io = scafLeftIo(dir, 'showcase-Kite')
    const f = fake({ io })
    const p = f.walk({ id: 'a', x: 40, y: 64, z: 0 })
    f.place([1, 64, 0]); f.stand(1, 65, 0); await sleep(3 * T.tickMs); f.stand(30, 64, 0); f.arrive(); await p
    f.tb.final()
    assert.deepStrictEqual(f.out(), ['carried:ended'])
    assert.deepStrictEqual(JSON.parse(readFileSync(io.file, 'utf8')).entries.map(e => e.at), [[1, 64, 0]], 'written at once (sync)')
    const g = fake({ io: scafLeftIo(dir, 'showcase-Kite') })
    g.cells.set('1,64,0', 'dirt')                          // a dirt block stands there: the bot's, or someone's since
    assert.strictEqual(g.tb.state.open.length, 0, 'no receipt: the file is a list, not a permission')
    assert.strictEqual(g.tb.state.handed.size, 1, 'kept on the file')
    g.stand(30, 64, 0)
    const q = g.walk({ id: 'b', x: -40, y: 64, z: 0 }); g.stand(3, 64, 0)
    await sleep(20 * T.tickMs)
    assert.strictEqual(g.name(1, 64, 0), 'dirt', 'never dug'); assert.strictEqual(g.gotos.length, 1)
    g.arrive(); await q
    g.tb.final()
    assert.deepStrictEqual(JSON.parse(readFileSync(io.file, 'utf8')).entries.map(e => e.at), [[1, 64, 0]], 'still on the file for the survey')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
await t('MUTANT: final() without the carry -- the open receipt is lost at a restart (killed)', async () => {
  await withMutant(TB_URL, [["try { for (const r of st.open) if (!r.closed && !r.carried) carry(r, 'ended'); prune(); persist(true) }", 'try { prune(); persist(true) }']], async M => {
    const saved = []
    const f = fake({ M, io: { load: () => [], save: e => saved.push(e) } })
    const p = f.walk({ id: 'a', x: 40, y: 64, z: 0 })
    f.place([1, 64, 0]); f.stand(1, 65, 0); await sleep(3 * T.tickMs); f.stand(30, 64, 0); f.arrive(); await p
    f.tb.final()
    assert.deepStrictEqual(saved, [], 'the mutant wrote nothing')
  })
})
/** A carried receipt at 1,64,0 (placed, walked out of reach, ttl passed). */
async function carried (o = {}) {
  const f = fake(o)
  const p = f.walk({ id: 'a', x: 40, y: 64, z: 0 })
  f.place([1, 64, 0], o.rec ?? {}); f.stand(1, 65, 0); await sleep(3 * T.tickMs); f.stand(30, 64, 0); f.arrive(); await p
  await sleep(T.ttlMs + 20); f.tb.prune()
  return f
}
const update = (f, cell, name) => { f.cells.set(cell.join(','), name); f.bot.emit('blockUpdate', { name: 'dirt' }, { name, position: { x: cell[0], y: cell[1], z: cell[2] } }) }
await t('WATCHED WITHOUT A BREAK (review r1): the cell dug and dirt put back while the bot looked on -- the receipt is closed `adopted changed`, the new dirt never dug', async () => {
  const f = await carried()
  assert.deepStrictEqual(f.out(), ['carried:expired'])
  update(f, [1, 64, 0], 'air'); update(f, [1, 64, 0], 'dirt')    // someone took it and laid their own
  const q = f.walk({ id: 'b', x: -40, y: 64, z: 0 }); f.stand(3, 64, 0)
  await sleep(20 * T.tickMs)
  assert.strictEqual(f.name(1, 64, 0), 'dirt', 'the replacement stands'); assert.deepStrictEqual(f.bot.dug, [])
  f.arrive(); await q
  f.tb.prune()
  assert.deepStrictEqual(f.out(), ['carried:expired', 'adopted:changed'])
  assert.strictEqual(f.tb.state.handed.size, 0, 'and off the hand-off file')
})
await t('MUTANT: the block-update watch cut -- the replacement is dug (killed)', async () => {
  await withMutant(TB_URL, [['n.name !== r.block) r.changed = true', 'n.name !== r.block) void 0']], async M => {
    const f = await carried({ M })
    update(f, [1, 64, 0], 'air'); update(f, [1, 64, 0], 'dirt')
    const q = f.walk({ id: 'b', x: -40, y: 64, z: 0 }); f.stand(3, 64, 0)
    await until(() => f.bot.dug.length === 1)
    f.arrive(); await q.catch(() => {})
  })
})
await t('REVIEW r2 (Codex, reproduced): the cell replaced DURING the equip\'s await -- judged again at the dig, never dug', async () => {
  const f = await carried()
  f.bot.pathfinder.bestHarvestTool = () => ({ name: 'stone_shovel' })   // the take-back equips: the await
  f.bot.equip = async () => { update(f, [1, 64, 0], 'air'); update(f, [1, 64, 0], 'dirt'); await sleep(2) }
  const q = f.walk({ id: 'b', x: -40, y: 64, z: 0 }); f.stand(3, 64, 0)
  await sleep(20 * T.tickMs)
  assert.deepStrictEqual(f.bot.dug, [], 'the replacement stands')
  f.arrive(); await q.catch(() => {})
})
await t('MUTANT: without the second judgement the replacement is dug (killed)', async () => {
  await withMutant(TB_URL, [["    if (r.changed || r.unwatched || blockAt(r.cell)?.name !== r.block) { row(r, r.unwatched ? 'left' : 'adopted', r.unwatched ? 'unwatched' : 'changed'); return true }\n", '']], async M => {
    const f = await carried({ M })
    f.bot.pathfinder.bestHarvestTool = () => ({ name: 'stone_shovel' })   // the take-back equips: the await
    f.bot.equip = async () => { update(f, [1, 64, 0], 'air'); update(f, [1, 64, 0], 'dirt'); await sleep(2) }
    const q = f.walk({ id: 'b', x: -40, y: 64, z: 0 }); f.stand(3, 64, 0)
    await until(() => f.bot.dug.length === 1)
    f.arrive(); await q.catch(() => {})
  })
})
await t('ITS CHUNK UNLOADS: the claim ends (`left why=unwatched`), the block goes on the hand-off file, and it is never dug from memory', async () => {
  const f = await carried()
  f.bot.emit('chunkColumnUnload', { x: 0, z: 0 })
  const q = f.walk({ id: 'b', x: -40, y: 64, z: 0 }); f.stand(3, 64, 0)
  await sleep(20 * T.tickMs)
  assert.deepStrictEqual(f.bot.dug, []); f.arrive(); await q
  f.tb.prune()
  assert.deepStrictEqual(f.out(), ['carried:expired', 'left:unwatched'])
  assert.deepStrictEqual([...f.tb.state.handed.values()].map(e => e.at), [[1, 64, 0]])
  const g = await carried()
  g.bot.emit('chunkColumnUnload', { x: 16, z: 0 })               // another chunk: the claim stands
  g.tb.prune(); assert.deepStrictEqual(g.out(), ['carried:expired'])
})
await t('ONE OWNER A CELL (review r1): a town receipt that runs out is litter\'s -- closed `left expired` and handed on, never carried', async () => {
  const left = []
  const f = await carried({ rec: { zone: 'margin' } })
  assert.deepStrictEqual(f.out(), ['left:expired'])
  assert.strictEqual(f.tb.state.open.length, 0); assert.strictEqual(f.tb.state.handed.size, 0)
  const g = fake({}); g.tb.state // no-op: the onLeft hand-off itself is litter.test.mjs's chain
  void left
})
await t('THE DEFERRAL YIELDS (review r1, Codex\'s reproduction): goto A then goto B in one turn with a block near -- A rejects GoalChanged, B is the goal walked', async () => {
  const f = fake()
  f.place([1, 64, 0])                                         // a fresh receipt near: both gotos would defer
  const a = f.walk({ id: 'A', x: 40, y: 64, z: 0 }), b = f.walk({ id: 'B', x: -40, y: 64, z: 0 })
  await assert.rejects(a, e => e.name === 'GoalChanged')
  await until(() => f.gotos.length >= 1)
  assert.strictEqual(f.bot.pathfinder.goal?.id, 'B'); assert.ok(f.gotos.every(g => g.goal.id === 'B'), f.gotos.map(g => g.goal.id).join(','))
  f.arrive(); await b
})
await t('MUTANT: the deferred owner not ended by the newer goto -- A walks and B is rejected (killed)', async () => {
  await withMutant(TB_URL, [["try { if (st.owner && st.owner !== call && st.owner.deferring) st.owner.giveUp('GoalChanged') }", 'try { void 0 }'],
                            ['        if (st.owner !== call || held()) throw gotoError(\'GoalChanged\')\n', '']], async M => {
    const f = fake({ M })
    f.place([1, 64, 0])
    const a = f.walk({ id: 'A', x: 40, y: 64, z: 0 }), b = f.walk({ id: 'B', x: -40, y: 64, z: 0 })
    await assert.rejects(b, e => e.name === 'GoalChanged')
    assert.strictEqual(f.bot.pathfinder.goal?.id, 'A', 'the mutant walks the stale goal and rejects the newer one')
    f.arrive(); await Promise.allSettled([a, b])
  })
})
await t('a reflex that takes the body during the deferral wins: the walk rejects GoalChanged and the library is never asked', async () => {
  const f = fake()
  f.place([1, 64, 0])
  let reflex = null
  f.bot.__digContext = () => ({ reflex, holder: null, skill: 'goto' })
  const a = f.walk({ id: 'A', x: 40, y: 64, z: 0 })
  reflex = 'air'                                              // the air reflex starts before the next turn
  await assert.rejects(a, e => e.name === 'GoalChanged')
  assert.strictEqual(f.gotos.length, 0)
  reflex = null
  const b = f.walk({ id: 'B', x: 40, y: 64, z: 0 })
  await until(() => f.gotos.length === 1); f.arrive(); await b
})
await t('THE DESCENT: a walk that starts on its own free-standing tower digs it from under its feet, top first, then walks; its row says so', async () => {
  const f = fake()
  await towerUp(f)
  assert.strictEqual(f.bot.dug.length, 0, 'standing on it: nothing dug')
  const q = f.walk({ id: 'far', x: 40, y: 64, z: 0 })
  await until(() => f.gotos.length === 2, 3000)
  assert.deepStrictEqual(f.bot.dug, ['0,67,0', '0,66,0', '0,65,0', '0,64,0'], 'top first, the whole tower')
  assert.strictEqual(Math.floor(f.bot.entity.position.y), 64, 'on the ground')
  assert.strictEqual(f.gotos[1].goal.id, 'far', 'then the walk the caller asked for')
  f.arrive(); await q
  assert.deepStrictEqual(f.out(), ['dug:descend', 'dug:descend', 'dug:descend', 'dug:descend'])
  assert.ok(f.walkRow().some(d => /placed=4 taken=0 .* left=4 /.test(d)), 'the tower walk: placed 4, left 4 standing at its end')
  assert.ok(f.walkRow().some(d => /placed=0 taken=4 later=4 descend=4 left=0 .* pre=1 fenced=1/.test(d)), f.walkRow().join(' | '))
})
await t('NEVER FROM UNDER THE BOT where it could step off: a tower out of a hole (the rim beside its top) stays for the take-back after it steps off', async () => {
  const f = fake()
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = 64; y <= 67; y++) f.cells.set(`${x},${y},${z}`, 'stone')   // the pit's walls to 67
  await towerUp(f)
  const q = f.walk({ id: 'far', x: 40, y: 68, z: 0 })
  await until(() => f.gotos.length === 2)
  await sleep(10 * T.tickMs)
  assert.deepStrictEqual(f.bot.dug, [], 'nothing dug from under it')
  f.stand(1, 68, 0)                                     // off onto the rim: now the take-back judges it from there
  await until(() => f.bot.dug.length >= 1)
  assert.strictEqual(f.bot.dug[0], '0,67,0', 'from the top, standing on the rim')
  f.arrive(); await q.catch(() => {})
})
await t('MUTANT: the ledge rule cut -- the hole\'s tower is dug from under the bot (killed)', async () => {
  await withMutant(TB_URL, [["  for (const [dx, dz] of SIDES) if (solid([top[0] + dx, top[1], top[2] + dz])) return { cells: [], why: 'ledge' }\n", '']], async M => {
    const f = fake({ M })
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = 64; y <= 67; y++) f.cells.set(`${x},${y},${z}`, 'stone')
    await towerUp(f)
    const q = f.walk({ id: 'far', x: 40, y: 68, z: 0 })
    await until(() => f.bot.dug.length === 4, 3000)
    f.arrive(); await q.catch(() => {})
  })
})
await t('NO DESCENT for a goal up here beside it (the next log), nor in a survival scope, nor with TAKEBACK off', async () => {
  const f = fake()
  await towerUp(f)
  const q = f.walk({ id: 'log', x: 1, y: 69, z: 0 })
  await until(() => f.gotos.length === 2); await sleep(10 * T.tickMs)
  assert.deepStrictEqual(f.bot.dug, []); f.arrive(); await q
  const g = fake()
  await towerUp(g)
  const r = withDigScope(g.bot, { purpose: 'survival', by: 'reflex:escape' }, () => g.walk({ id: 'out', x: 40, y: 64, z: 0 }))
  await until(() => g.gotos.length === 2); await sleep(10 * T.tickMs)
  assert.deepStrictEqual(g.bot.dug, [], 'an escape keeps its blocks'); g.arrive(); await r
  const h = fake({ env: { TAKEBACK: 'off' } })
  assert.strictEqual(h.tb, null)
})
await t('MUTANT: descentWanted\'s near rule cut -- the tower is dug from under a bot whose next goal is the log beside it (killed)', async () => {
  await withMutant(TB_URL, [['  if (near && (g.y == null || Math.floor(g.y) >= feet[1] - 1)) return false\n', '']], async M => {
    const f = fake({ M })
    await towerUp(f)
    const q = f.walk({ id: 'log', x: 1, y: 69, z: 0 })
    await until(() => f.bot.dug.length === 4, 3000)
    f.arrive(); await q.catch(() => {})
  })
})
await t('an unfenced goto (the library\'s own, no withTimeout) is never deferred or descended: the goal is set at once', async () => {
  const f = fake()
  await towerUp(f)
  const p = f.bot.pathfinder.goto({ id: 'raw', x: 40, y: 64, z: 0 })
  assert.strictEqual(f.bot.pathfinder.goal?.id === 'raw' || f.gotos.length === 1, true)
  await sleep(10 * T.tickMs)
  assert.deepStrictEqual(f.bot.dug, [], 'unfenced: not ours to delay')
  f.arrive(); await p
})

await t('IN SIGHT IS ANY FACE IN SIGHT (rig, sandbox2 11-21): a pit tower\'s stub flush under the ground, its centre behind the rim and its top face in view, is taken back; positive control: with no face in view it is not', async () => {
  assert.deepStrictEqual(TB.faceTargets([0, 0, 0])[0], [0.5, 0.98, 0.5], 'the top face first')
  /** a fake world whose ray reaches the block only when it is aimed at its top face (y > cell + 0.9): the rim blocks the centre */
  const pitWorld = (f, cell, open = true) => ({ raycast: (from, dir, range) => {
    const to = { x: from.x + dir.x * range, y: from.y + dir.y * range, z: from.z + dir.z * range }
    return open && to.y > cell[1] + 0.9 && Math.floor(to.x) === cell[0] && Math.floor(to.z) === cell[2] ? { position: { x: cell[0], y: cell[1], z: cell[2] } } : { position: { x: cell[0] + 1, y: cell[1] + 1, z: cell[2] } }
  } })
  for (const open of [true, false]) {
    const f = fake()
    f.bot.canSeeBlock = () => false                          // the centre ray: the rim is in the way
    f.bot.world = pitWorld(f, [0, 63, 0], open)
    const p = f.walk({ id: 'out', x: 40, y: 64, z: 0 })
    f.place([0, 63, 0]); f.stand(0, 64, 0); await sleep(3 * T.tickMs)   // the stub at the pit's top, the bot on it
    f.stand(2, 64, 0)                                        // out on the floor beside the pit
    if (open) { await until(() => f.name(0, 63, 0) === 'air'); await until(() => f.gotos.length === 2) } else await sleep(20 * T.tickMs)
    assert.strictEqual(f.name(0, 63, 0), open ? 'air' : 'dirt', open ? 'taken back' : 'positive control: unseen, never dug')
    f.arrive(); await p.catch(() => {})
  }
})
await t('MUTANT: the face rays cut (the centre only, as before) -- the stub stays (killed)', async () => {
  await withMutant(TB_URL, [['      for (const f of faceTargets([b.position.x, b.position.y, b.position.z])) {', '      for (const f of []) {']], async M => {
    const f = fake({ M })
    f.bot.canSeeBlock = () => false
    f.bot.world = { raycast: (from, dir, range) => ({ position: { x: 0, y: 63, z: 0 } }) }
    const p = f.walk({ id: 'out', x: 40, y: 64, z: 0 })
    f.place([0, 63, 0]); f.stand(0, 64, 0); await sleep(3 * T.tickMs); f.stand(2, 64, 0)
    await sleep(20 * T.tickMs)
    assert.strictEqual(f.name(0, 63, 0), 'dirt', 'the mutant never sees it')
    f.arrive(); await p.catch(() => {})
  })
})
// ---- the wiring (source, comments stripped) -------------------------------------------------------------------------------
await t('WIRING features.mjs: the take-back gets the scafleft file (io) -- and the mutant without it is caught', () => {
  const src = strip(readFileSync(FEAT_URL, 'utf8'))
  const ok = s => /io = scafLeftIo\(poolStateDir\(config\.memory\.pool\), bot\.username \?\? null\)/.test(s) && /installTakeback\(bot, \{ emit, onLeft: [^\n]*, io \}\)/.test(s)
  assert.ok(ok(src))
  const old = ', io })'
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.strictEqual(ok(src.replace(old, ' })')), false)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
