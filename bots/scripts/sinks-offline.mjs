#!/usr/bin/env node
// THE TOWN SINKS, OFFLINE (picker-01): the bot's own siting (sinks.mjs siteSink: the seeded designs, the screen, the build proof)
// on COPIES of a town's region files and pool state, with the reservations skills.mjs buildSink passes (sinkGuardFor): the plan,
// the protected zones, wells, the farm, every record's zone (the land plan's road corridors among them), an unsited copper hall's
// pad and the expedition markers; the ziggurat's +8 apron for every kind but the shrine.
//
//   node scripts/sinks-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--kinds tower,shrine,road] [--count N] [--avail JSON]
//                                  [--torch] [--json] [--out FILE]
//
// <dump.json> is scripts/host/townplan_blockdump.py over COPIES of the region files; the pool dir a COPY of /var/lib/mcai/_pool-<pool>.
// --count N sites N instances of each kind in turn, each one's cells reserved for the next (the record growing as the bots grow it).
// Nothing is written but --out (the instances, for a picture).
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords, readJson } from './buildsite-offline.mjs'
import { reservations, loadBlueprint } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import * as S from '../src/sinks.mjs'
import * as CH from '../src/copperhall.mjs'
import * as EX from '../src/expedition.mjs'
const LP = await import('../src/landplan.mjs').catch(() => null)

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: sinks-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--kinds ...] [--count N] [--avail JSON] [--torch] [--json] [--out FILE]'); process.exit(2) }
const pool = opt('pool', path.basename(poolDir).replace(/^_pool-/, ''))
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } }).filter(p => p.rec)
const recOf = plot => all.find(p => p.plot === plot)?.rec ?? null
const land = recOf('land')
const others = all.filter(p => p.plot !== 'land' && !S.isSinkPlot(p.plot)).map(p => p.rec)
const hall = recOf(CH.HALL_PLOT) ? [] : [CH.hallPadZone?.(plan, loadBlueprint(CH.HALL_BLUEPRINT))].filter(Boolean)
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const zig = others.find(r => r.plot === 'monument' && Array.isArray(r.box)) ?? null
const wall = others.find(r => r.plot === 'wall') ?? null
const avail = opt('avail') ? JSON.parse(opt('avail')) : {}
const torch = argv.includes('--torch')
const kinds = (opt('kinds') ?? 'road,tower,shrine').split(',')
const count = Number(opt('count') ?? 1)
// the growing records (one per kind), as the bots would publish them
const recs = Object.fromEntries(S.SINK_KINDS.map(k => [k, null]))
const guardFor = (withZ0) => {
  const sinkZones = S.SINK_KINDS.flatMap(k => recs[k]?.zones ?? [])
  const zones = [...R.zones, ...recordZones([...others, ...(land && LP ? [LP.landReservation(land)] : [])]), ...hall, ...(EX.markerZones?.(markers) ?? []), ...sinkZones]
  const res = reservations(plan, { zones, wells: R.wells, farm: R.farm, z0: withZ0 && zig ? { box: zig.box } : null })
  return (x, z, y0, y1) => res.column(x, z, y0, y1) ?? (zones.find(zb => { const b = zb.box; return x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] && y1 >= b[1] && y0 <= b[4] })?.why ?? null)
}
const out = { pool, home, reservations: { protected: R.zones.length, records: others.length, land: !!land, hallPad: hall.length, markers: markers.length }, avail, torch, sited: [], failed: [] }
for (let round = 1; round <= count; round++) {
  for (const kind of kinds) {
    const n = S.instancesOf(recs[kind]).length + 1
    const id = `${S.SINK_LETTER[kind]}${n}`
    const t0 = Date.now()
    const r = S.siteSink(read, { kind, n, id, home, pool, avail, torch, guard: guardFor(true), guardShrine: guardFor(false), wall, zig, land, rec: recs[kind], stood: [] })
    const ms = Date.now() - t0
    if (!r.ok) { out.failed.push({ kind, n, why: r.why, tried: r.tried, proofs: r.proofs, ms }); continue }
    recs[kind] = S.appendInstance(recs[kind], { kind, home, inst: r.inst, meta: { ...r.meta, sitedAt: Date.now() } })
    const cheb = r.inst.cells.map(c => Math.max(Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z)))
    const counts = {}
    for (const c of r.inst.cells) { const nm = (r.inst.palette[c.role] ?? ['?']).find(x => x !== '*solid'); counts[nm] = (counts[nm] ?? 0) + 1 }
    out.sited.push({ kind, id, where: r.meta.where ?? r.meta.spoke, summary: r.meta.summary, box: r.meta.box, cells: r.inst.cells.length, blocks: counts, cheb: [Math.min(...cheb), Math.max(...cheb)],
      segments: r.inst.segments.length, proofs: r.proofs, tried: r.tried, ms })
  }
}
if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify({ home, recs }))
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify(out, null, 1))
