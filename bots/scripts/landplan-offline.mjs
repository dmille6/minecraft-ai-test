#!/usr/bin/env node
// THE LAND PLAN AND THE GROUNDSKEEPER, OFFLINE (groundskeeper-01): the bots' own land plan (landplan.mjs planLand) and every stage
// of the groundskeeper's ring order (tidy.mjs siteStage) on COPIES of a town's region files and pool state, with the walking
// connectivity before and after.
//
//   node scripts/landplan-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--json] [--stages N]
//
// <dump.json> is scripts/host/townplan_blockdump.py over COPIES of the region files (home +- 112, y home-16 .. home+20 covers the
// plan's workR 80); <pool-state-dir> a COPY of /var/lib/mcai/_pool-<pool> (tidy-offline.mjs's inputs). Nothing is written.
// Measures (landplan.mjs walkReach, the same BFS before and after): the share of read ground columns within 80 a walker reaches
// from the plaza's edge (step up 1, down 3, two cells of head room, no liquid), how many of the ring's waypoints and the spokes'
// ends it reaches, and how far each road routes under the paths' STRICT router (fill and cut 2, natural cuts only) -- the network
// the paths could lay on it without any earthwork.
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords, readJson } from './buildsite-offline.mjs'
import { loadBlueprint, placeBlueprint } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import * as P from '../src/paths.mjs'
import * as T from '../src/tidy.mjs'
import * as LP from '../src/landplan.mjs'
import { recordZones } from '../src/shop.mjs'
import { hallPadZone, HALL_BLUEPRINT, HALL_PLOT } from '../src/copperhall.mjs'
import { markerZones } from '../src/expedition.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: landplan-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--json] [--stages N]'); process.exit(2) }
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
  return { plot, rec, bp }
}).filter(p => p.rec && p.plot !== LP.LAND_PLOT)
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
// THE GUARDS (skills.mjs tidyInputs / landInputs): every other project's record columns and reservation; the land plan's roads may
// cross a laid path (a junction), never another project
const recs = all.filter(p => p.plot !== T.TIDY_PLOT).map(p => p.rec)
const noPaths = recs.filter(r => r.blueprint !== P.PATHS_BLUEPRINT)
// an UNSITED copper hall's pad (skills.mjs hallPadZones; the showcase's hall waits for copper with no record) is reserved too
const hz = all.some(p => p.plot === HALL_PLOT) || argv.includes('--no-hall') ? [] : [hallPadZone(plan, loadBlueprint(HALL_BLUEPRINT))].filter(Boolean)
// ...and the town's expedition markers (skills.mjs townMarkerZones; --no-markers is the control)
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
if (!argv.includes('--no-markers') && fs.existsSync(mFile)) hz.push(...markerZones(fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone)))
const avoidT = T.tidyAvoid(P.pathAvoid({ plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, records: recs, home }), [...recordZones(recs), ...hz])
const cells = new Set(recs.flatMap(q => (q.cells ?? []).map(c => c.at.join(','))))
const projects = all.filter(p => p.plot !== P.PATHS_PLOT && p.plot !== T.TIDY_PLOT)
const pin = { plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, projects, place: placeBlueprint }
const roadAvoid = T.tidyAvoid(P.pathAvoid({ plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, records: noPaths, home }), hz)
const rz = [...recordZones(noPaths), ...hz]
const reserved = (x, z) => { for (const zb of rz) { const b = zb.box; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return zb.why } return null }
const seed = LP.landSeed(pool, home)
let t0 = Date.now()
const L = await LP.planLand(read0, { home, plan, seed, avoid: roadAvoid, reserved, limOf: n => T.gradeLim(read0, n), caps, composter })
const planMs = Date.now() - t0
const land = L.plan
// THE MEASURE: from the plaza's edge (the core box's outer ring), over home +- 80
const core = (plan.plots ?? []).find(p => p.id === 'core' && Array.isArray(p.box))?.box ?? [home.x - 6, home.z - 6, home.x + 6, home.z + 6]
const from = []
for (let x = core[0] - 1; x <= core[2] + 1; x++) for (let z = core[1] - 1; z <= core[3] + 1; z++) if (x < core[0] || x > core[2] || z < core[1] || z > core[3]) from.push([x, z])
const ringPts = LP.ringWaypoints(home, land.ringR, land.chamfer)
const spokeEnds = land.roads.filter(r => r.kind === 'spoke').map(r => LP.spokeWaypoints(home, r.deg, land.ringR, LP.LAND.workR).at(-1))
// the plan's road columns: a walk ALONG them only (plus the plaza's edge it starts from), how many it reaches
const roadCols = new Set(land.roads.flatMap(r => r.cols.map(([x, z]) => `${x},${z}`)))
for (const [x, z] of from) roadCols.add(`${x},${z}`)
const roadPts = land.roads.flatMap(r => r.cols.map(([x, z]) => [x, z]))
// (the plaza's own square, out to where the spokes start + their snap, is walked freely: a road starts at the plaza's edge)
const coreR = Math.max(Math.abs(core[0] - home.x), Math.abs(core[2] - home.x), Math.abs(core[1] - home.z), Math.abs(core[3] - home.z))
// the town inside the roads (the plaza, the store, the workshop: tidy-01's square) is walked freely; the roads start at its edge
const freeR = Math.max(coreR + 8, (land.inner ?? 0) + 2)
const measure = async rd => {
  const w = LP.walkReach(rd, home, { r: LP.LAND.workR, from, pts: [...ringPts, ...spokeEnds], column: T.tidyColumn })
  const ringW = LP.walkReach(rd, home, { r: LP.LAND.workR, from, pts: ringPts, column: T.tidyColumn })
  const along = LP.walkReach(rd, home, { r: LP.LAND.workR, from, pts: roadPts, column: T.tidyColumn, allow: (x, z) => roadCols.has(`${x},${z}`) || Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) <= freeR })
  return { walk: `${w.reach}/${w.cols} (${(100 * w.share).toFixed(1)}%)`, share: Math.round(1000 * w.share) / 10, ringReached: `${ringW.reached}/${ringW.pts}`, spokeEndsReached: `${w.reached - ringW.reached}/${spokeEnds.length}`, roadReached: `${along.reached}/${along.pts}`, roadShare: along.pts ? Math.round(1000 * along.reached / along.pts) / 10 : 0 }
}
const before = await measure(read0)
// THE STAGES, each on the ground the last one left (tidyOverlay: cuts and clears read air, fills dirt; lights are not ground)
let cur = read0
const stages = []
const lastK = LP.landStages().at(-1).k
for (let k = 0; k <= Math.min(lastK, Number(opt('stages', lastK))); k++) {
  t0 = Date.now()
  const s = T.siteStage(cur, { home, land, stage: k, avoid: avoidT, cells, plan, pin: k === 0 ? pin : null, lim: T.gradeLim(cur, 6), lights: 8, now: 0, walkFrom: argv.includes('--no-guard') ? null : T.townEdge(plan, home) })
  const ms = Date.now() - t0
  const rec = s.record
  stages.push({ k, id: LP.stageOf(k).id, ms, why: s.why, cut: rec?.cut.length ?? 0, fill: rec ? rec.cells.filter(c => c.role !== 'light').length : 0, clear: rec?.clear.length ?? 0, replant: rec?.replant?.length ?? 0, lights: rec ? rec.cells.filter(c => c.role === 'light').length : 0, road: rec?.road ?? null, pillars: rec?.pillars ?? 0, pits: rec?.pits ?? 0 })
  if (rec) cur = T.tidyOverlay(cur, { ...rec, cells: rec.cells.filter(c => c.role !== 'light') })
  if (argv.includes('--per-stage')) stages.at(-1).after = (await measure(cur)).roadReached
}
const after = await measure(cur)
const out = {
  pool, home, seed, planMs,
  land: { ringR: land.ringR, chamfer: land.chamfer, inner: land.inner, zones: land.zones, corridors: land.corridors.length,
    roads: land.roads.map(r => ({ id: r.id, deg: r.deg ?? null, why: r.why, ok: r.ok, reached: `${r.reached}/${r.of}`, grade: r.grade, cols: r.cols.length })) },
  stages, before, after,
}
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify(out, null, 1))
