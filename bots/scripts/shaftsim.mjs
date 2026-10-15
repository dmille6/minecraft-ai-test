// shaftsim.mjs <regionsDir> -- OFFLINE (stage-1 snapshot copies, read-only): drive the REAL pure planner (shaftjob.mjs
// shaftNextOp / landingNextOp / descentPlan) through a whole build on each world's M0 site, applying every op to an overlay
// of the snapshot, and report where it ends (done / close / wait) and what it took. Claude shaft plan r2 P2-4: the true
// closure level per world, so the canary pool is one whose shaft gets past 20 levels.
import fs from 'node:fs'
import path from 'node:path'
import { loadRegion, reader } from './regionread.mjs'
import { SHAFT_SITES, plannedLandings, newShaftRecord, worldOf, shaftNextOp, landingNextOp, descentPlan, advance } from '../src/shaftjob.mjs'
import { envelopeLevels } from '../src/shaftplan.mjs'
const dir = process.argv[2]
const rows = {}
for (const [pool, site] of Object.entries(SHAFT_SITES)) {
  const chunks = new Map(); for (const f of fs.readdirSync(dir).filter(f => f.startsWith(pool + '.'))) for (const [k, v] of loadRegion(path.join(dir, f))) chunks.set(k, v)
  const base = reader(chunks), over = new Map(), K = (x, y, z) => `${x},${y},${z}`
  const wread = (x, y, z) => over.get(K(x, y, z)) ?? base(x, y, z)
  const lread = (u, y, v) => { const w = worldOf(site, u, y, v); const b = wread(w.x, y, w.z); return b ? { ...b, full: b.boundingBox === 'block' && (b.shapes?.length === 1 && b.shapes[0].join() === '0,0,0,1,1,1'), props: b.props } : null }
  const set = (c, b) => { const w = worldOf(site, c[0], c[1], c[2]); over.set(K(w.x, c[1], w.z), b) }
  let rec = newShaftRecord({ site, bottom: 16, landings: plannedLandings(site.c), home: { x: 0, y: site.c, z: 0 } })
  const digSet = new Set(envelopeLevels(site.c, 16, rec.landings).dig.map(([u, y, v]) => `${u},${y},${v}`))
  let feet = { u: 0, y: site.c, v: -1 }
  const n = {}
  let end = null
  for (let i = 0; i < 30000 && !end; i++) {
    let op = shaftNextOp({ rec, read: lread, feet, digSet })
    if (op.op === 'landing') op = landingNextOp({ yL: op.y, read: lread, feet, digSet })
    n[op.op] = (n[op.op] ?? 0) + 1
    switch (op.op) {
      case 'done': case 'close': case 'wait': end = op; break
      case 'collar_dig': case 'dig': set(op.cell, { name: 'air', boundingBox: 'empty' }); break
      case 'line': case 'fill_floor': if (op.falling) set(op.cell, { name: 'air', boundingBox: 'empty' }); set(op.cell, { name: 'cobblestone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }); if (op.chain) n.chain = (n.chain ?? 0) + 1; break
      case 'ladder': set([op.u, op.y, 0], { name: 'ladder', boundingBox: 'block' }); break
      case 'move_down': feet = { u: op.u, y: op.y, v: 0 }; break
      case 'walk': feet = { u: op.to[0], y: op.to[1], v: op.to[2] }; break
      case 'descend': { const d = descentPlan({ rec, read: lread }); if (d.blocked) end = { op: 'close', why: d.blocked }; else feet = d.land; break }
      case 'advance': rec = advance(rec, op.y); if (op.y === site.c) feet = { u: 1, y: site.c, v: 0 }; break
      case 'landing_done': rec = { ...rec, landings_done: [...(rec.landings_done ?? []), op.y] }; break
    }
  }
  rows[pool] = { end: end?.op, why: end?.why ?? null, frontier: rec.frontier, levels: site.c - rec.frontier, landings: (rec.landings_done ?? []).length, digs: (n.dig ?? 0) + (n.collar_dig ?? 0), lined: n.line ?? 0, floors: n.fill_floor ?? 0, chains: n.chain ?? 0, ladders: n.ladder ?? 0 }
}
console.log(JSON.stringify(rows, null, 1))
