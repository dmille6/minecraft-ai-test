#!/usr/bin/env node
// THE GROUNDS CREW, OFFLINE (gkhelpers-01): on COPIES of a town's region files and pool state (nothing is written), what the crew's
// pure rules would do with that town today --
//   1. CREW: the tidy head's open fill segments, and how many of them two or three bots could hold at once under the crew's rule
//      (groundskeeper.mjs segsConflict, GK.segGap): a greedy set of mutually non-conflicting open segments whose deps are done
//   2. FLOOR: the storehouse's floor holes (storeFloorHoles) -- the chests' standing cells, the door, the approach
//   3. PARK: what the park still wants (parkWant), the gather targets round home (gatherTargets over the dump's plant blocks, with
//      a reservation of every project record's cells and box, the protected zones and the park), and the top-up those plants would
//      buy (parkTopUp with the town's stock plus everything gathered)
//
//   node scripts/gkhelpers-offline.mjs <dump.json> <pool-state-dir> [--json]
import fs from 'node:fs'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { cellDone } from '../src/buildrun.mjs'
import * as GK from '../src/groundskeeper.mjs'
import * as PK from '../src/park.mjs'
import * as TR from '../src/terrace.mjs'
import * as T from '../src/tidy.mjs'
import { recordZones } from '../src/shop.mjs'

const argv = process.argv.slice(2)
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: gkhelpers-offline.mjs <dump.json> <pool-state-dir> [--json]'); process.exit(2) }
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
const read = dumpReader(dump)
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const home = R.head.plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const head = plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return h.ok ? h.head?.rec ?? null : null }
const tidy = head('tidy'), store = head('storehouse'), land = head('land')
const out = { home, tidyGen: tidy?.gen ?? null, stage: tidy?.stageId ?? null }
// 1. the crew
if (tidy) {
  const done = c => cellDone(read(...c.at), T.TIDY_PALETTE, c.role)
  const segDone = s => tidy.cells.filter(c => c.seg === s && !c.prev).every(done)
  const cols = GK.segColumns(tidy)
  const open = (tidy.segments ?? []).filter(s => !segDone(s.seg))
  const ready = open.filter(s => (s.deps ?? []).every(segDone))
  const pick = []
  for (const s of ready) if (pick.every(p => !GK.segsConflict(cols, p, s.seg))) pick.push(s.seg)
  out.crew = { segments: (tidy.segments ?? []).length, open: open.length, ready: ready.length, apart: pick.length, cellsOpen: tidy.cells.filter(c => !c.prev && !done(c)).length, cutsLeft: (tidy.cut ?? []).filter(c => String(read(...c.at)?.name ?? '') === c.name).length }
}
// 2. the storehouse floor
if (store) {
  const h = GK.storeFloorHoles(store, read)
  out.floor = { complete: !!store.structure_complete, stands: (store.inside ?? []).filter(s => s[1] === store.baseY).length, holes: h.cells.map(c => c.at.join(',')), segments: h.segments.map(s => s.seg) }
}
// 3. the park
const park = land?.park?.placed ? land.park : (tidy?.park?.box ? { ...tidy.park, seed: tidy.park.seed ?? land?.park?.seed } : null)
if (park) {
  // the town's stock: every container's newest observation in the town chest index (terrace-offline's reading)
  const stock = {}
  const gen = f => Number(/\.g(\d+)\./.exec(f)?.[1] ?? 0)
  const idx = fs.readdirSync(poolDir).filter(f => new RegExp(`^town-index-${hk}\\.g\\d+\\.jsonl$`).test(f)).sort((a, b) => gen(b) - gen(a))[0]
  const last = new Map()
  if (idx) {
    for (const line of fs.readFileSync(`${poolDir}/${idx}`, 'utf8').split('\n')) {
      let d; try { d = JSON.parse(line) } catch { continue }
      if (d.t === 'ckpt') for (const w of Object.values(d.worlds ?? {})) for (const [k, e] of Object.entries(w ?? {})) { if (e?.obs?.names) last.set(k, e.obs) }
      if (d.t === 'obs' && d.names && Array.isArray(d.h)) last.set(d.h[0], d)
    }
  }
  for (const o of last.values()) for (const [n, v] of Object.entries(o.names ?? {})) stock[n] = (stock[n] ?? 0) + (Array.isArray(v) ? Number(v[0]) || 0 : Number(v) || 0)
  const want = PK.parkWant(park, stock)
  const recs = fs.readdirSync(poolDir).map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean)
  const others = [...new Set(recs)].filter(p => p !== 'tidy' && p !== 'land').map(head).filter(Boolean)
  const cellsK = new Set(others.flatMap(r => (r.cells ?? []).map(c => c.at.join(','))))
  const zones = [...recordZones(others), ...(R.zones ?? []).map(z => ({ box: z.box, why: z.id }))]
  const pb = park.box
  const reserved = (x, y, z) => {
    if (x >= pb[0] - 1 && x <= pb[2] + 1 && z >= pb[1] - 1 && z <= pb[3] + 1) return 'park'
    if (cellsK.has(`${x},${y},${z}`)) return 'project'
    for (const zb of zones) { const b = zb.box; if (b.length === 6 ? (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) : false) return zb.why ?? 'zone' }
    return null
  }
  const names = new Set(PK.GATHER_NAMES)
  const [x0, z0, x1, z1] = dump.box, [y0, y1] = dump.y
  const cands = []
  for (let x = Math.max(x0, home.x - GK.GK.gatherR); x <= Math.min(x1, home.x + GK.GK.gatherR); x++) for (let z = Math.max(z0, home.z - GK.GK.gatherR); z <= Math.min(z1, home.z + GK.GK.gatherR); z++) for (let y = y0; y <= y1; y++) { const n = String(read(x, y, z)?.name ?? '').replace(/\[.*\]$/, ''); if (names.has(n)) cands.push({ at: [x, y, z], name: n }) }
  const byKind = {}
  for (const c of cands) byKind[c.name] = (byKind[c.name] ?? 0) + 1
  const targets = PK.gatherTargets(cands, { read, reserved, home, r: GK.GK.gatherR, want, max: 500 })
  const gotten = {}
  for (const t of targets) gotten[t.item] = (gotten[t.item] ?? 0) + t.n
  const taken = new Set([...(tidy?.cells ?? []), ...(tidy?.cut ?? [])].map(q => `${q.at[0]},${q.at[2]}`))
  const have = { ...stock }; for (const [n, v] of Object.entries(gotten)) have[n] = (have[n] ?? 0) + v
  const top = TR.parkTopUp(read, { park, have, taken: (x, z) => taken.has(`${x},${z}`), segN: 0, y0: home.y - 16, y1: home.y + 16 })
  out.park = { box: park.box, placed: park.placed, want, plantBlocks: cands.length, byKind, targets: targets.length, unreserved: targets.filter(t => !reserved(...t.at)).length, gotten, standless: targets.filter(t => !PK.gatherStand(read, t)).length,
    topup: top ? { cells: top.cells.length, byEl: top.cells.reduce((m, c) => ((m[c.el] = (m[c.el] ?? 0) + 1), m), {}), skipped: top.park.skipped } : null }
}
if (argv.includes('--json')) console.log(JSON.stringify(out))
else console.log(JSON.stringify(out, null, 1))
