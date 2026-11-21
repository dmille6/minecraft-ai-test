#!/usr/bin/env node
// scaffold-replay.mjs -- scaffold-01show evidence: REAL showcase walks replayed OFFLINE with the REAL A* (CLAUDE.md: "before a release
// that changes how bots walk or place, replay the real route").
//
//   node scripts/scaffold-replay.mjs <region dir> <routes.json> [--air <source json>] [--home x,y,z] [--timeout ms]
//
// The region files are a READ-ONLY copy of the showcase world (the nightly backup copy). `routes.json` holds real walks read from the
// showcase's own skill rows (a goto's start = the bot's position on its previous row, its goal = the goto's args; an explore's goal =
// the column it reported reaching). `--air` names pillars-01show's source join (source1120.json): every CoreProtect-proven bot pillar
// block in it is read as AIR, so each route sees the ground as it was before the walks laid their scaffold.
// For each route, mineflayer-pathfinder 2.4.5's REAL Movements and A* (lib/astar.js), through the search scope exactly as index.mjs
// installs it (scaftown.mjs installScafTownSearch: the 1 s preference budget, the restart, the latch), with the WALK profile's
// settings (canDig off, 1x1 towers on the extended scaffold list, no parkour, maxDropDown 6, placeCost 5, liquidCost 2, nobridge,
// the corner rule):
//   BASE  the town price only (SCAFWILD=off: the live release's walk)
//   HEAD  + the wild price outside the town's area (scaffold-01show)
// It prints, per route and in total: status, blocks the path places, moves, the path's base-cost (the HEAD path priced at the base's
// costs: what it really costs to walk), and the search's ms.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { loadRegion, reader } from './wellsite-replay.mjs'
import { worldOf } from './wellstand-replay.mjs'
import * as ST from '../src/scaftown.mjs'
import { extendScaffolding } from '../src/scaffold.mjs'
import { installNoBridge } from '../src/nobridge.mjs'
import { installCornerRule } from '../src/cornermoves.mjs'

const require = createRequire(import.meta.url)
const { Movements, goals } = require('mineflayer-pathfinder')
const AStar = require('mineflayer-pathfinder/lib/astar.js')
const Move = require('mineflayer-pathfinder/lib/move.js')
const { Vec3 } = require('vec3')
const registry = require('prismarine-registry')('1.21.8')

const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const [REGDIR, ROUTES] = argv
if (!REGDIR || !ROUTES) { console.error('usage: scaffold-replay.mjs <region dir> <routes.json> [--air src.json] [--home x,y,z] [--timeout ms]'); process.exit(2) }
const HOME = (opt('--home', '0,70,0')).split(',').map(Number)
const TIMEOUT = Number(opt('--timeout', 10000))
const routes = JSON.parse(fs.readFileSync(ROUTES, 'utf8'))

// the proven bot pillar blocks, read as air
const air = new Set()
if (opt('--air')) { for (const p of JSON.parse(fs.readFileSync(opt('--air'), 'utf8')).pillars ?? []) for (const k of Object.keys(p.blocks ?? {})) air.add(k) }

// every region file a route touches (+-64 round its ends)
const chunks = new Map()
const regs = new Set()
for (const r of routes) for (const p of [r.start, [r.goal.x, 0, r.goal.z]]) for (const dx of [-64, 0, 64]) for (const dz of [-64, 0, 64]) regs.add(`${Math.floor((p[0] + dx) / 512)}.${Math.floor((p[2] + dz) / 512)}`)
for (const rk of regs) { const f = path.join(REGDIR, `r.${rk}.mca`); if (fs.existsSync(f)) for (const [k, v] of loadRegion(f)) chunks.set(k, v) }
const raw = reader(chunks)
const read = (x, y, z) => (air.has(`${x},${y},${z}`) ? { name: 'air', props: null } : (raw(x, y, z) ?? { name: y < 0 ? 'stone' : 'air', props: null }))
const world = worldOf(read)

function walkProfile (wild) {
  const bot = { registry, version: '1.21.8', blockAt: p => world.blockAt(p), entity: { position: new Vec3(0, 70, 0), effects: {} }, entities: {},
                inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }, { name: 'cobblestone', count: 64, type: registry.itemsByName.cobblestone.id }] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 }, world: { getBlockStateId: v => world.blockAt(v)?.stateId } }
  const m = new Movements(bot)
  m.canDig = false; m.allow1by1towers = true; extendScaffolding(m, registry); m.allowParkour = false; m.maxDropDown = 6; m.placeCost = 5; m.liquidCost = 2
  installNoBridge(m, (x, y, z) => world.blockAt(new Vec3(x, y, z)), () => -64)
  installCornerRule(m)
  const area = ST.scafAreaOf({ home: { x: HOME[0], y: HOME[1], z: HOME[2] } })
  const price = ST.makeScafTownPrice({ area: () => area, wild, now: () => performance.now() })
  ST.installScafTownPrice(m, price)
  Object.assign(m, ST.scafProfileFlags('walk'))
  m.__price = price
  return m
}
function pathfinderOver (price) {
  const pf = {
    searchRadius: -1,
    getPathFromTo: function * (movements, startPos, goal, options = {}) {
      const ctx = new AStar(new Move(startPos.x, startPos.y, startPos.z, 128, 0), movements, goal, options.timeout ?? TIMEOUT, options.tickTimeout ?? 40, -1)
      let result = ctx.compute()
      yield { result, astarContext: ctx }
      while (result.status === 'partial') { result = ctx.compute(); yield { result, astarContext: ctx } }
    },
  }
  ST.installScafTownSearch(pf, price)
  return pf
}
/** the standable cell at or just under a logged position (a body's feet are in air over a solid). */
function feetAt ([x, y, z]) {
  const fx = Math.floor(x), fz = Math.floor(z)
  for (let fy = Math.floor(y + 1e-6) + 1; fy >= Math.floor(y) - 3; fy--) {
    const b = world.blockAt(new Vec3(fx, fy - 1, fz)), a = world.blockAt(new Vec3(fx, fy, fz))
    if (b && b.boundingBox === 'block' && a && a.boundingBox === 'empty') return [fx, fy, fz]
  }
  return [fx, Math.floor(y + 1e-6), fz]
}
const placedOf = p => p.flatMap(n => (n.toPlace ?? []).filter(q => !q.useOne)).length
// the base's step cost of a path (what walking it costs, without any price): its moves' own costs minus their surcharges
const baseCost = p => p.reduce((s, n) => s + (Number(n.cost) || 0) - (n.scafTown ?? 0), 0)   // a path Move's cost is its own step's
function run (m, from, goal) {
  const pf = pathfinderOver(m.__price)
  const t0 = performance.now()
  let last = null
  for (const v of pf.getPathFromTo(m, new Vec3(...from), goal, { timeout: TIMEOUT })) last = v.result
  return { status: last.status, placed: placedOf(last.path), moves: last.path.length, baseCost: Math.round(baseCost(last.path)), ms: Math.round(performance.now() - t0), visited: last.visitedNodes }
}

const out = []
const tot = { base: { placed: 0, moves: 0, cost: 0, ms: 0, ok: 0 }, head: { placed: 0, moves: 0, cost: 0, ms: 0, ok: 0 }, n: 0, live: 0, both: 0 }
for (const r of routes) {
  const from = feetAt(r.start)
  const goal = r.goal.y == null ? new goals.GoalNearXZ(r.goal.x, r.goal.z, 2) : new goals.GoalNear(r.goal.x, r.goal.y, r.goal.z, 2)
  const base = run(walkProfile(false), from, goal)
  const head = run(walkProfile(true), from, goal)
  out.push({ bot: r.bot, skill: r.skill, t: r.t, from, goal: r.goal, placed_live: r.placed_live, base, head })
  tot.n++; tot.live += r.placed_live
  for (const [k, v] of [['base', base], ['head', head]]) { if (v.status === 'success') tot[k].ok++ }
  if (base.status === 'success' && head.status === 'success') {
    tot.both++
    for (const [k, v] of [['base', base], ['head', head]]) { tot[k].placed += v.placed; tot[k].moves += v.moves; tot[k].cost += v.baseCost; tot[k].ms += v.ms }
  }
  console.log(`${r.bot.padEnd(16)} ${r.skill.padEnd(7)} live=${r.placed_live} | base ${base.status} placed=${base.placed} moves=${base.moves} cost=${base.baseCost} ${base.ms}ms | head ${head.status} placed=${head.placed} moves=${head.moves} cost=${head.baseCost} ${head.ms}ms`)
}
console.log(JSON.stringify(tot))
if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify({ tot, routes: out }, null, 1))
