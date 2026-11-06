#!/usr/bin/env node
// THE MANAGED FOREST, OFFLINE (forest-02): the bots' own forest siting (forest.mjs siteForest, with the inputs skills.mjs
// forestInputs composes) run on COPIES of a world's region files and pool state -- where a town's forest goes, or why it does not.
//
//   node scripts/forest-offline.mjs <dump.json> <pool-state-dir> [--species S] [--out record.json] [--map map.txt]
//
// <dump.json>: scripts/host/townplan_blockdump.py over COPIES of the region files (y home-20 .. home+24 at least, the box the scan
// reaches). <pool-state-dir>: a COPY of /var/lib/mcai/_pool-<pool>. Nothing is written but --out and --map.
import fs from 'node:fs'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import { farmBlocked } from '../src/treefarm.mjs'
import { siteForest, wallRings, FOREST_PLOT, FOREST } from '../src/forest.mjs'
import { landReservation, zoneAt } from '../src/landplan.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: forest-offline.mjs <dump.json> <pool-state-dir> [--species S] [--out f] [--map f]'); process.exit(2) }
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const readJ = f => { try { return JSON.parse(fs.readFileSync(`${poolDir}/${f}`, 'utf8')) } catch { return null } }
const gen = f => Number(/\.g(\d+)\./.exec(f)?.[1] ?? 0)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].filter(p => p !== FOREST_PLOT && p !== 'land').sort()
const heads = plots.map(plot => ({ plot, rec: recordHead(poolDir, `project-${hk}.${plot}`).head?.rec ?? null })).filter(r => r.rec)
const land = recordHead(poolDir, `project-${hk}.land`).head?.rec ?? null
const ext = heads.find(h => h.plot === 'wallext')?.rec ?? null
const records = [...heads.map(h => h.rec), ...(land ? [landReservation(land, ext)] : [])]   // (the fleet's landReservation takes the land alone; ext is ignored)
const plinthRec = readJ(`junkwell-plinth-${hk}.json`)
const caps = []
if (plinthRec?.plan?.cap) caps.push([plinthRec.plan.cap.x, plinthRec.plan.cap.y, plinthRec.plan.cap.z])
for (const w of R.wells) if (!caps.length && Array.isArray(w)) caps.push(w)
const comps = files.filter(f => f.startsWith(`composter-site-${hk}.g`)).sort((a, b) => gen(b) - gen(a))
const cs = comps.length ? readJ(comps[0]) : null
const composter = cs && [cs.x, cs.y, cs.z].every(Number.isFinite) ? [cs.x, cs.y, cs.z] : null
const blocked = farmBlocked({ plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, records, pzones: recordZones(records), whys: true })
const rings = wallRings(records)
const t0 = Date.now()
const FF = process.env.FSIZE ? { ...FOREST, strips: [Number(process.env.FSIZE.split("x")[0])], perRow: [Number(process.env.FSIZE.split("x")[1])] } : FOREST
const s = siteForest(read, { F: FF, home, blocked, rings, walls: records.filter(r => /^wall(ext)?@1$/.test(String(r?.blueprint ?? ''))), zone: land ? (x, z) => zoneAt(land, x, z) : null, species: opt('species', 'spruce_sapling'), now: Date.now() })
const rec = s.record
console.log(JSON.stringify({ ok: s.ok, why: s.why, tried: s.tried, ms: Date.now() - t0, home, rings, projects: heads.map(h => h.plot),
  ...(rec ? { box: rec.box, axis: rec.axis, perRow: rec.perRow, strips: rec.nStrips, levels: rec.strips.map(q => q.level), counts: rec.counts, trees: rec.trees.length,
    reach: Math.max(Math.abs(rec.box[0] - home.x), Math.abs(rec.box[2] - home.x), Math.abs(rec.box[1] - home.z), Math.abs(rec.box[3] - home.z)) } : {}) }, null, 1))
if (opt('out') && rec) fs.writeFileSync(opt('out'), JSON.stringify(rec))
if (opt('map') && rec) {
  const [bx0, bz0, bx1, bz1] = rec.box
  const role = new Map(rec.cells.filter(c => c.role === 'plot').map(c => [`${c.at[0]},${c.at[2]}`, 'T']))
  const stands = new Set(rec.cells.filter(c => c.stand).map(c => `${c.stand[0]},${c.stand[2]}`))
  const lines = []
  for (let z = bz0 - 2; z <= bz1 + 2; z++) {
    let l = ''
    for (let x = bx0 - 2; x <= bx1 + 2; x++) l += role.get(`${x},${z}`) ?? (stands.has(`${x},${z}`) ? 's' : (x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1 ? '.' : ' '))
    lines.push(l)
  }
  fs.writeFileSync(opt('map'), lines.join('\n') + '\n')
}
