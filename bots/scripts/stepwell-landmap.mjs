#!/usr/bin/env node
// stepwell-01's land map (offline, read-only): every column round home classed by what holds it -- a reservation (by kind), the land
// plan's zone, water at the ground, a tree -- for the design's siting picture. node scripts/stepwell-landmap.mjs <dump> <pool> [--r 100] [--out f]
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import * as EX from '../src/expedition.mjs'
import { landReservation, zoneAt } from '../src/landplan.mjs'
import { groundTop } from '../src/shaftgeom.mjs'
const argv = process.argv.slice(2)
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const [dumpPath, poolDir] = argv
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const R = poolRecords(poolDir)
const home = R.head.plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const plots = [...new Set(fs.readdirSync(poolDir).map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } }).filter(p => p.rec)
const recs = all.map(p => p.rec).filter(r => r.plot !== 'land')
const land = all.find(p => p.plot === 'land')?.rec ?? null
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const zones = [...R.zones.map(z => ({ ...z, why: z.why ?? `protected:${z.id ?? '?'}` })), ...recordZones(land ? [...recs, landReservation(land, null)] : recs), ...(EX.markerZones ?? (() => []))(markers)]
const cellsOf = new Set(recs.flatMap(r => (r.cells ?? []).map(c => `${c.at[0]},${c.at[2]}`)))
const r = Number(opt('--r') ?? 100)
const rows = []
for (let z = home.z - r; z <= home.z + r; z++) {
  const row = []
  for (let x = home.x - r; x <= home.x + r; x++) {
    const zq = zones.find(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5])
    const res = zq ? String(zq.why ?? 'zone') : cellsOf.has(`${x},${z}`) ? 'record' : null
    const gt = groundTop(read, x, z, home.y + 30, home.y - 30)
    let tree = false
    if (gt && !gt.wet) for (let y = gt.y + 1; y <= gt.y + 14; y++) { const b = read(x, y, z); if (b && /_(log|leaves)$/.test(b.name.replace(/\[.*\]$/, ''))) { tree = true; break } }
    row.push({ res, zone: land ? zoneAt(land, x, z) : '-', wet: !!gt?.wet, y: gt?.y ?? null, tree })
  }
  rows.push(row)
}
fs.writeFileSync(opt('--out') ?? 'landmap.json', JSON.stringify({ home, r, rows }))
console.log('ok', rows.length)
