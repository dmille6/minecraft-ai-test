#!/usr/bin/env node
// routereplay.mjs -- THE REAL A* OVER SAVED BLOCKS (routewatch.py's walker; owner 11-14).
//
// WHY. On 11-13 a tidy visit cut the one step of the only walk up to the showcase's junk well and nothing noticed for five
// hours; on 11-14 a fix for it went live and failed because nobody had run the pathfinder over the real ground first. Both
// were answered in milliseconds once the blocks were read from the saved region and mineflayer-pathfinder's own A* was run
// over them. This is that replay as a tool: can a bot WALK from a start to a cell, placing nothing and digging nothing?
//
//   node routereplay.mjs <job.json> [--modules /srv/showcase/harness]      -> one JSON object on stdout
// job: { version, palette: [{name, props}], cells: [[x, y, z, paletteIndex]], floor_y, starts: [[x,y,z]],
//        dests: [{key, cell: [x,y,z], max_cost?, timeout_ms?}], timeout_ms }   (cells: every non-air block of the box; below
//        floor_y is stone). max_cost: the search is BOUNDED to walks costing at most that, so it ENDS (noPath is then "no walk
//        that cheap": definitive, where an unbounded search over open ground only runs out of time). The caller sets it from
//        the kept walk's own cost, so the kept walk itself is always inside the bound (Codex r2: a bound from the straight
//        distance excluded a long U-shaped walk that was still there).
// out: { ok, blocks, rules, starts_ok, results: [{key, cell, status, from, ms, visited, path: [[x,y,z]]}] }
//   status: success   a walk was found, and every step of it is on ground that was READ
//           noPath    the search ran out of places to go: definitive
//           unsure    the search ran out of TIME (partial / timeout), or the walk it found leaves the ground that was read
//                     (the box's invented floor), or no start is standable now -- never a verdict
//           bad_cell  the destination has no room for a body in the save
// The walk profile is index.mjs's WALK profile with an empty bag: canDig false, no parkour, maxDropDown 6, no block to place
// (the pathfinder places only what the bag holds), plus the live release's own corner and shore rules when its src is
// beside the modules (cornermoves.mjs, watermoves.mjs: no imports of their own). NOT MODELLED: doors, gates and trapdoors are
// shut (as for the live bots: canOpenDoors is off), the well column's price and the lid price are not applied (they price a
// walk, they do not forbid one). READ ONLY: it touches no server and no bot.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const mi = args.indexOf('--modules')
const modules = mi >= 0 ? args[mi + 1] : process.cwd()
const jobPath = args.find((a, i) => !a.startsWith('--') && (mi < 0 || i !== mi + 1))
if (!jobPath) { console.error('usage: routereplay.mjs <job.json> [--modules <dir with node_modules>]'); process.exit(2) }
const require_ = createRequire(path.join(path.resolve(modules), 'package.json'))
const job = JSON.parse(readFileSync(jobPath, 'utf8'))
const { Vec3 } = require_('vec3')
const { Movements, goals } = require_('mineflayer-pathfinder')
const AStar = require_('mineflayer-pathfinder/lib/astar.js')
const Move = require_('mineflayer-pathfinder/lib/move.js')
const registry = require_('prismarine-registry')(job.version ?? '1.21.8')
const Block = require_('prismarine-block')(registry)

// ---- the world: the saved blocks, each in its own saved state where the registry knows it ---------------------------------
const unknown = new Set()
const coerce = v => (v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : v)
const stateOf = (job.palette ?? []).map((p) => {
  const def = registry.blocksByName[p.name]
  if (!def) { unknown.add(p.name); return registry.blocksByName.stone.defaultState }
  if (p.props && Object.keys(p.props).length) {
    try {
      const b = Block.fromProperties(def.id, Object.fromEntries(Object.entries(p.props).map(([k, v]) => [k, coerce(v)])), 0)
      if (b && Number.isInteger(b.stateId)) return b.stateId
    } catch { /* an unknown property: the default state */ }
  }
  return def.defaultState
})
const KEY = (x, y, z) => ((x + 1048576) * 2097152 + (z + 1048576)) * 1024 + (y + 512)
const world = new Map()
for (const [x, y, z, i] of job.cells ?? []) world.set(KEY(x, y, z), stateOf[i])
const AIR = registry.blocksByName.air.defaultState
const STONE = registry.blocksByName.stone.defaultState
const floorY = Number.isFinite(job.floor_y) ? job.floor_y : -64
const stateAt = (x, y, z) => world.get(KEY(x, y, z)) ?? (y < floorY ? STONE : AIR)
const blockAt = (p) => { const b = Block.fromStateId(stateAt(p.x, p.y, p.z), 0); b.position = new Vec3(p.x, p.y, p.z); return b }

const bot = { registry, version: job.version ?? '1.21.8', blockAt, entity: { position: new Vec3(0.5, 70, 0.5), effects: {} }, entities: {},
              inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
const m = new Movements(bot)
m.canDig = false; m.allowParkour = false; m.allow1by1towers = true; m.maxDropDown = 6; m.placeCost = 5
// the live release's own rules for a walk (Codex r1: without them the replay certifies a diagonal through a corner the live
// profile refuses, and refuses a way out of water it takes)
const rules = []
for (const [file, fn, name] of [['watermoves.mjs', 'installShoreEgress', 'shore'], ['cornermoves.mjs', 'installCornerRule', 'corner']]) {
  const f = path.join(path.resolve(modules), 'src', file)
  if (!existsSync(f)) continue
  try { (await import(pathToFileURL(f).href))[fn](m); rules.push(name) } catch (e) { rules.push(`${name}:FAILED:${String(e?.message ?? e).slice(0, 60)}`) }
}

// THE PATHFINDER'S OWN IDEA OF ROOM (Codex r1: a carpet has a 'block' bounding box and is walked on -- a hand-made "solid"
// test called a carpeted stand not standable). Movements.getBlock says `safe` for a cell a body may be in and `physical` for
// one it may stand on.
const g = (x, y, z) => m.getBlock({ x, y, z }, 0, 0, 0)
const roomAt = ([x, y, z]) => g(x, y, z).safe && g(x, y + 1, z).safe
const standOn = ([x, y, z]) => roomAt([x, y, z]) && g(x, y - 1, z).physical
const read = (y) => y > floorY + 1            // a step at the box's bottom stands on stone nobody read
const timeout = Number(job.timeout_ms) || 3000
const starts = (job.starts ?? []).filter(standOn)     // a start a body cannot be in now is no start (Codex r1)
const results = []
for (const d of job.dests ?? []) {
  const [x, y, z] = d.cell
  if (!roomAt(d.cell)) { results.push({ key: d.key, cell: d.cell, status: 'bad_cell', from: null, ms: 0, visited: 0, path: [] }); continue }
  if (!starts.length) { results.push({ key: d.key, cell: d.cell, status: 'unsure', why: 'no start is standable in the save', from: null, ms: 0, visited: 0, path: [] }); continue }
  let best = null
  let every = true                               // did EVERY start end definitively (noPath)?
  const budget = Number(d.timeout_ms) || timeout
  const goal = new goals.GoalBlock(x, y, z)
  for (const s of starts) {
    const t0 = Date.now()
    const from = new Move(s[0], s[1], s[2], 0, 0)
    // AStar prunes a node when g + h > h(start) + searchRadius: a total-cost bound of max_cost is that radius
    const radius = Number.isFinite(d.max_cost) && d.max_cost >= 0 ? Math.max(0, d.max_cost - goal.heuristic(from)) : -1
    // one slice, as long as the whole budget: `partial` (the slice ended) and `timeout` (the budget ended) both mean
    // the search did not finish
    const r = new AStar(from, m, goal, budget, budget, radius).compute()
    const pathCells = r.status === 'success' ? r.path.map(n => [n.x, n.y, n.z]) : []
    const onRead = pathCells.every(c => read(c[1])) && read(s[1])
    const status = r.status === 'success' ? (onRead ? 'success' : 'unsure') : r.status === 'noPath' ? 'noPath' : 'unsure'
    const one = { key: d.key, cell: d.cell, status, from: s, ms: Date.now() - t0, visited: r.visitedNodes, path: status === 'success' ? pathCells : [],
                  ...(status === 'success' ? { cost: r.cost } : {}),
                  ...(status === 'unsure' ? { why: r.status === 'success' ? 'the walk found leaves the ground that was read' : `the search ended ${r.status}` } : {}) }
    if (status === 'success') { best = one; break }
    if (status !== 'noPath') every = false
    if (!best || (best.status === 'noPath' && status === 'unsure')) best = one
  }
  if (best.status !== 'success') best = { ...best, status: every ? 'noPath' : 'unsure' }
  results.push(best)
}
process.stdout.write(JSON.stringify({ ok: true, blocks: world.size, unknown: [...unknown].sort(), rules, starts_ok: starts.length, results }) + '\n')
