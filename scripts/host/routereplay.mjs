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
//        dests: [{key, cell: [x,y,z]}], timeout_ms, hold: n }    (cells: every non-air block of the box; below floor_y is stone)
// out: { ok, nodes, results: [{key, cell, status: success|noPath|timeout|bad_cell, from, ms, visited, path: [[x,y,z]]}] }
// The walk profile is index.mjs's WALK profile with an empty bag: canDig false, no parkour, maxDropDown 6, and no block to
// place (the pathfinder places only what the bag holds). READ ONLY: it touches no server and no bot.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const args = process.argv.slice(2)
const mi = args.indexOf('--modules')
const modules = mi >= 0 ? args[mi + 1] : process.cwd()
const jobPath = args.find((a, i) => !a.startsWith('--') && i !== mi + 1)
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

const solid = (x, y, z) => blockAt({ x, y, z }).boundingBox === 'block'
const standable = ([x, y, z]) => !solid(x, y, z) && !solid(x, y + 1, z)
const timeout = Number(job.timeout_ms) || 3000
const results = []
for (const d of job.dests ?? []) {
  const [x, y, z] = d.cell
  if (!standable(d.cell)) { results.push({ key: d.key, cell: d.cell, status: 'bad_cell', from: null, ms: 0, visited: 0, path: [] }); continue }
  let best = null
  for (const s of job.starts ?? []) {
    const t0 = Date.now()
    const r = new AStar(new Move(s[0], s[1], s[2], 0, 0), m, new goals.GoalBlock(x, y, z), timeout, timeout, -1).compute()
    const one = { key: d.key, cell: d.cell, status: r.status, from: s, ms: Date.now() - t0, visited: r.visitedNodes,
                  path: r.status === 'success' ? r.path.map(n => [n.x, n.y, n.z]) : [] }
    if (r.status === 'success') { best = one; break }
    if (!best || (best.status === 'timeout' && r.status === 'noPath')) best = one
  }
  results.push(best ?? { key: d.key, cell: d.cell, status: 'noPath', from: null, ms: 0, visited: 0, path: [] })
}
process.stdout.write(JSON.stringify({ ok: true, blocks: world.size, unknown: [...unknown].sort(), results }) + '\n')
