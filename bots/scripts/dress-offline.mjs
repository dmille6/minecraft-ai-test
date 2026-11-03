#!/usr/bin/env node
// TOWNDRESS-01, OFFLINE: the bot's own dress siting (towndress.mjs siteDress: the candidates, the spacing, the proof) on COPIES of a
// town's region files and pool state, with the reservations skills.mjs dressReservedFor passes (the protected zones, the wells, the
// farm, the plan's cells and soft keepouts, the land plan's corridors, the markers).
//
//   node scripts/dress-offline.mjs <dump.json> <pool-state-dir> [--torches N] [--count N] [--json]
//
// <dump.json> is scripts/host/townplan_blockdump.py over COPIES of the region files; the pool dir a COPY of /var/lib/mcai/_pool-<pool>.
// --count N sites N batches in turn, each one's cells reserved for the next. Nothing is written.
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import { keepouts } from '../src/townplan.mjs'
import * as S from '../src/sinks.mjs'
import * as EX from '../src/expedition.mjs'
const LP = await import('../src/landplan.mjs').catch(() => null)

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: dress-offline.mjs <dump.json> <pool-state-dir> [--torches N] [--count N] [--json]'); process.exit(2) }
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } }).filter(p => p.rec)
const land = all.find(p => p.plot === 'land')?.rec ?? null
const records = all.filter(p => p.plot !== 'land' && p.plot !== 'dress')
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const zs = [...R.zones, ...recordZones(land && LP ? [LP.landReservation(land)] : []), ...(EX.markerZones?.(markers) ?? [])]
const ko = keepouts(plan)
const never = new Set((ko.neverCells ?? []).map(q => `${q[0]},${q[2]}`))
const wells = (R.wells ?? []).map(q => [q[0], q[2]])
const farm = new Set((R.farm ?? []).map(([x, z]) => `${x},${z}`))
const reserved = (x, z) => {
  if (never.has(`${x},${z}`)) return 'plan_cell'
  if (ko.softAt(x, z)) return 'plan_soft'
  if (wells.some(([wx, wz]) => Math.max(Math.abs(wx - x), Math.abs(wz - z)) <= 3)) return 'well'
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (farm.has(`${x + dx},${z + dz}`)) return 'treefarm'
  const zb = zs.find(q => { const b = q?.box; return Array.isArray(b) && x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] })
  return zb ? String(zb.why ?? 'zone') : null
}
let torches = Number(opt('torches') ?? 39)
const count = Number(opt('count') ?? 1)
let rec = null
const out = { home, records: records.map(r => r.plot), markers: markers.length, sited: [], failed: [] }
for (let n = 1; n <= count; n++) {
  const t0 = Date.now()
  const r = S.siteSink(read, { kind: 'dress', n, id: `L${n}`, home, records, rec, torches, reserved, stood: [] })
  const ms = Date.now() - t0
  if (!r.ok) { out.failed.push({ n, why: r.why, tried: r.tried, ms }); break }
  rec = S.appendInstance(rec, { kind: 'dress', home, inst: r.inst, meta: { ...r.meta, sitedAt: Date.now() } })
  torches -= r.meta.torches
  out.sited.push({ id: r.meta.id, summary: r.meta.summary, cells: r.inst.cells.length, fixtures: r.meta.design.fixtures, signs: r.meta.signs.map(s => ({ for: s.for, at: s.at, lines: s.lines })), tried: r.tried, ms })
}
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify(out, null, 1))
