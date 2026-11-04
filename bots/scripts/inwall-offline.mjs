#!/usr/bin/env node
// gkstage-01: INSIDE THE WALL, OFFLINE -- tidy.mjs siteStage('inwall') on COPIES of a town's region files and pool state, with the
// tidy's own guard (terrace-offline's avoid and cells). Nothing is written. Reports the stray blocks, the litter on builds, the holes
// and the record's size, plus an INDEPENDENT check that no cut or fill touches a protected zone, a well, a farm or any record cell.
//   node scripts/inwall-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--json]
// (the header below is terrace-offline's input reading)
// THE TERRACE STAGE, OFFLINE (townterrace-01): the bots' own land plan (landplan.mjs planLand), stage 0 (tidy-01) and the terrace
// stage (tidy.mjs siteStage -> terrace.mjs siteTerrace) on COPIES of a town's region files and pool state. Nothing is written.
//
//   node scripts/terrace-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--all-items] [--grid out.json] [--record out.json] [--json]
//
// <dump.json>: scripts/host/townplan_blockdump.py over COPIES of the region files (home +- 112, y home-16 .. +20: landplan-offline's
// inputs); <pool-state-dir>: a COPY of /var/lib/mcai/_pool-<pool>. What the town can get for the park (`have`) is read from the pool's
// town chest index (each container's newest observation); --all-items lays the park as if every element were in stock (its layout
// capacity). Reported per town (inside the wall): walkable-and-back columns from the plaza's edge and stuck-prone columns (reached,
// cannot walk back) before and after, rough pairs (2+), the cut / fill / seal volumes, the trees felled and replanted, the park,
// and the INDEPENDENT protected check: every cell the record touches (cuts, fills, seals, clears, park cells, replants) tested
// against the raw sources -- protected zones, well caps and plinth cells, farmland (+4), plan cells and keep-out plots, every other
// project's record cells and reservation, the copper hall's pad, the expedition markers, the land plan's and the paths' corridors.
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords, readJson } from './buildsite-offline.mjs'
import { loadBlueprint, placeBlueprint } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import * as P from '../src/paths.mjs'
import * as T from '../src/tidy.mjs'
import * as LP from '../src/landplan.mjs'
import * as TR from '../src/terrace.mjs'
import { PARK_ROLES } from '../src/park.mjs'
import { recordZones } from '../src/shop.mjs'
import { hallPadZone, HALL_BLUEPRINT, HALL_PLOT } from '../src/copperhall.mjs'
import { markerZones } from '../src/expedition.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: terrace-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--all-items] [--grid out.json] [--record out.json] [--json]'); process.exit(2) }
const pool = opt('pool', path.basename(poolDir).replace(/^_pool-/, ''))
const read0 = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => {
  const h = recordHead(poolDir, `project-${hk}.${plot}`)
  const rec = h.ok ? h.head?.rec ?? null : null
  let bp = null
  try { if (rec?.blueprint && !/^(ziggurat|paths|wall|shaft|treefarm|tidy|land)@/.test(rec.blueprint)) bp = loadBlueprint(rec.blueprint) } catch { bp = null }
  return { plot, rec: rec ? { ...rec, plot: rec.plot ?? plot } : null, bp }
}).filter(p => p.rec && p.plot !== LP.LAND_PLOT && p.plot !== T.TIDY_PLOT)
const plinthRec = readJson(path.join(poolDir, `junkwell-plinth-${hk}.json`))
const gen = f => Number(/\.g(\d+)\./.exec(f)?.[1] ?? 0)
const sites = files.filter(f => f.startsWith(`junkwell-site-${hk}.g`)).sort((a, b) => gen(b) - gen(a))
const site = sites.length ? readJson(path.join(poolDir, sites[0])) : null
const caps = []
if (plinthRec?.plan?.cap) caps.push([plinthRec.plan.cap.x, plinthRec.plan.cap.y, plinthRec.plan.cap.z])
if (site && [site.x, site.y, site.z].every(Number.isFinite) && !caps.some(c => c[0] === site.x && c[2] === site.z)) caps.push([site.x, site.y, site.z])
const comps = files.filter(f => f.startsWith(`composter-site-${hk}.g`)).sort((a, b) => gen(b) - gen(a))
const cs = comps.length ? readJson(path.join(poolDir, comps[0])) : null
const composter = cs && [cs.x, cs.y, cs.z].every(Number.isFinite) ? [cs.x, cs.y, cs.z] : ((plan.plots ?? []).find(p => p.kind === 'farm')?.composter ?? null)
const recs = all.map(p => p.rec)
const noPaths = recs.filter(r => r.blueprint !== P.PATHS_BLUEPRINT)
const hz = all.some(p => p.plot === HALL_PLOT) ? [] : [hallPadZone(plan, loadBlueprint(HALL_BLUEPRINT))].filter(Boolean)
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
hz.push(...markerZones(markers))
// skills.mjs tidyInputs (the tidy's guard) and landInputs (the land plan's)
const avoidT = T.tidyAvoid(P.pathAvoid({ plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, records: recs, home }), [...recordZones(recs), ...hz])
const cells = new Set(recs.flatMap(q => (q.cells ?? []).map(c => c.at.join(','))))
const projects = all.filter(p => p.plot !== P.PATHS_PLOT)
const pin = { plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, projects, place: placeBlueprint }
const roadAvoid = T.tidyAvoid(P.pathAvoid({ plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, records: noPaths, home }), hz)
const rz = [...recordZones(noPaths), ...hz]
const reserved = (x, z) => { for (const zb of rz) { const b = zb.box; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return zb.why } return null }
const wallRec = recs.find(r => r.plot === 'wall') ?? null
const stage = LP.landStages().find(s => s.id === 'inwall')
const s = T.siteStage(read0, { home, land: { seed: 1 }, stage, avoid: avoidT, cells, plan, terrace: { wall: wallRec, records: recs } })
const rec = s.record
const zoneHit = c => (R.zones ?? []).some(z => { const b = z.box; return c[0] >= b[0] && c[0] <= b[3] && c[2] >= b[2] && c[2] <= b[5] })
const touched = rec ? [...rec.cut.map(c => c.at), ...rec.cells.map(c => c.at)] : []
const capNear = c => caps.some(w => Math.max(Math.abs(w[0] - c[0]), Math.abs(w[2] - c[2])) <= 3) || (R.wells ?? []).some(w => w[0] === c[0] && w[2] === c[2])
const prot = { zone: touched.filter(zoneHit).length, recordCell: touched.filter(c => cells.has(c.join(','))).length, well: touched.filter(capNear).map(c => c.join(',')), avoided: touched.filter(c => { const w = avoidT(c[0], c[2]); return w && !/^(project|plan_cell|plan_box|plan_plot)$|^project:/.test(String(w)) }).length }
const out = { pool, box: rec?.inwall?.box ?? null, why: s.why, inwall: rec?.inwall ?? null, cuts: rec?.cut.length ?? 0, fills: rec?.cells.length ?? 0, segments: rec?.segments.length ?? 0, prot,
  names: rec ? rec.cut.reduce((m, c) => ((m[c.name] = (m[c.name] ?? 0) + 1), m), {}) : {}, onBuild: (s.survey?.pillars ?? []).filter(q => q.onBuild).map(q => `${q.col.join(',')}${q.beside ? ' beside' : ' on'} h${q.h}`) }
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify(out, null, 1))
