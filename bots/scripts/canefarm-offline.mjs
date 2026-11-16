#!/usr/bin/env node
// THE CANE BED'S SITE, OFFLINE (canefarm-01): skills.mjs buildCaneFarm's siting -- canefarm.mjs siteCaneFarm over the town's water
// edges, off every reservation (the protected zones, every record + PROJECT_GAP, the land plan's corridors, park and plots, an
// unsited copper hall's pad, the expedition markers) -- on COPIES of a town's region files and pool state. Nothing is written but --out.
//
//   node scripts/canefarm-offline.mjs <dump.json> <pool-state-dir> [--ext <wallext record.json>] [--out rec.json]
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { loadBlueprint } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import * as CH from '../src/copperhall.mjs'
import * as EX from '../src/expedition.mjs'
import * as CF from '../src/canefarm.mjs'
import { landReservation } from '../src/landplan.mjs'

const argv = process.argv.slice(2)
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: canefarm-offline.mjs <dump.json> <pool-state-dir> [--ext rec.json] [--out f]'); process.exit(2) }
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const plots = [...new Set(fs.readdirSync(poolDir).map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } }).filter(p => p.rec && p.plot !== CF.CANEFARM_PLOT)
let ext = opt('--ext') ? JSON.parse(fs.readFileSync(opt('--ext'), 'utf8')) : null
if (ext?.record) ext = ext.record
const recs = all.map(p => p.rec).filter(r => r.plot !== 'land')
if (ext && !recs.some(r => r.plot === 'wallext')) recs.push(ext)
const land = all.find(p => p.plot === 'land')?.rec ?? null
const hall = all.some(p => p.plot === CH.HALL_PLOT) ? [] : [CH.hallPadZone(plan, loadBlueprint(CH.HALL_BLUEPRINT))].filter(Boolean)
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const zones = [...R.zones, ...recordZones(land ? [...recs, landReservation(land, ext)] : recs), ...hall, ...(EX.markerZones ?? (() => []))(markers)]
const cellsOf = new Set(recs.flatMap(r => (r.cells ?? []).map(c => `${c.at[0]},${c.at[2]}`)))
const blocked = (x, z) => (zones.some(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5]) ? 'zone' : cellsOf.has(`${x},${z}`) ? 'record' : null)
const t0 = Date.now()
const s = CF.siteCaneFarm(read, { home, blocked })
const out = { home, records: recs.length, zones: zones.length, ok: s.ok, why: s.why, edgeCells: s.tried, ms: Date.now() - t0 }
if (s.ok) {
  const r = s.record
  out.site = { box: r.box, cells: r.cells.length, fromHome: Math.round(Math.hypot((r.box[0] + r.box[2]) / 2 - home.x, (r.box[1] + r.box[3]) / 2 - home.z)),
    clears: r.clear.length, cellsInReservations: r.cells.filter(c => blocked(c.at[0], c.at[2])).length, standsInReservations: r.stands.filter(q => blocked(q.stand[0], q.stand[2])).length,
    cells_at: r.cells.map(c => c.at.join(',')), census: CF.caneCensus(read, r) }
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(r, null, 1))
}
console.log(JSON.stringify(out, null, 1))
