#!/usr/bin/env node
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
const seed = LP.landSeed(pool, home)
const L = await LP.planLand(read0, { home, plan, seed, avoid: roadAvoid, reserved, limOf: n => T.gradeLim(read0, n, T.tidyWater(), { waterOk: (() => { let f = null; return (x, z) => { if (roadAvoid(x, z) || reserved(x, z)) return false; f ??= TR.farmGuardOf(read0, [home.x - 82, home.z - 82, home.x + 82, home.z + 82], home); return !f(x, z) } })() }), caps, composter })
const land = L.plan
// WHAT THE TOWN CAN GET: each container's newest observation in the town chest index
const have = {}
if (argv.includes('--all-items')) {
  for (const n of ['poppy', 'dandelion', 'cornflower', 'rose_bush', 'lilac', 'azalea', 'flowering_azalea', 'oak_sapling', 'birch_sapling', 'bamboo', 'wheat_seeds', 'carrot', 'potato', 'beetroot_seeds', 'sugar_cane', 'oak_leaves', 'bone_meal', 'wooden_hoe']) have[n] = 64
} else {
  const idx = files.filter(f => new RegExp(`^town-index-${hk}\\.g\\d+\\.jsonl$`).test(f)).sort((a, b) => gen(b) - gen(a))[0]
  const last = new Map()
  if (idx) {
    for (const line of fs.readFileSync(path.join(poolDir, idx), 'utf8').split('\n')) {
      let d; try { d = JSON.parse(line) } catch { continue }
      if (d.t === 'ckpt') for (const w of Object.values(d.worlds ?? {})) for (const [k, e] of Object.entries(w ?? {})) { if (e?.obs?.names) last.set(k, e.obs) }
      if (d.t === 'obs' && d.names && Array.isArray(d.h)) last.set(d.h[0], d)
    }
  }
  for (const o of last.values()) for (const [n, v] of Object.entries(o.names ?? {})) have[n] = (have[n] ?? 0) + (Array.isArray(v) ? Number(v[0]) || 0 : Number(v) || 0)
}
const wall = recs.find(r => r.plot === 'wall') ?? null
const box = TR.wallInterior(wall, home)
const from = T.townEdge(plan, home)
// STAGE 0 first (tidy-01), on the ground it leaves the terrace stage is sited
const s0 = T.siteStage(read0, { home, land, stage: 0, avoid: avoidT, cells, plan, pin, now: 0 })
const read1 = s0.record ? T.tidyOverlay(read0, s0.record) : read0
const t0 = Date.now()
const st = await T.siteStage(read1, { home, land, stage: 1, avoid: avoidT, cells, plan, now: 0, walkFrom: from, terrace: { records: recs, wall, caps, have } })
const ms = Date.now() - t0
const rec = st.record
// THE GROUND AFTER: cuts and felled logs air, fills and seals dirt, the park's solid plantings (hedge, bamboo, azalea) solid
const parkSolid = new Set((rec?.cells ?? []).filter(c => /^(hedge|bamboo|shrub)$/.test(c.role)).map(c => c.at.join(',')))
const earth = rec ? { ...rec, cells: rec.cells.filter(c => !PARK_ROLES.has(c.role)) } : null
const read2 = earth ? T.tidyOverlay(read1, earth) : read1
const before = TR.terraceWalk(read0, box, home, from)
const mid = TR.terraceWalk(read1, box, home, from)
const after = TR.terraceWalk(read2, box, home, from, { solid: parkSolid })
// THE INDEPENDENT PROTECTED CHECK (raw sources, not the stage's own `avoid`)
const inB6 = (b, x, z) => x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]
const k2 = (x, z) => `${x},${z}`
const prot = { zone: [], well: [], farm: [], plan: [], project_cell: [], reservation: [], hall: [], marker: [], road: [] }
const wellCols = new Set([...(R.wells ?? []).map(c => k2(c[0], c[2])), ...caps.flatMap(c => { const o = []; for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) o.push(k2(c[0] + dx, c[2] + dz)); return o })])
const farmCols = new Set()
for (let x = box[0] - 4; x <= box[2] + 4; x++) for (let z = box[1] - 4; z <= box[3] + 4; z++) for (let y = home.y - 14; y <= home.y + 14; y++) { const b = read0(x, y, z); if (b && String(b.name) === 'farmland') { for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) farmCols.add(k2(x + dx, z + dz)); break } }
for (const [x, z] of R.farm ?? []) farmCols.add(k2(x, z))
const planCols = new Set()
for (const p of plan.plots ?? []) { for (const c of [...(p.cells ?? []), ...(p.stations ?? [])]) if (Array.isArray(c?.at)) planCols.add(k2(c.at[0], c.at[2])); if (p.keepout && Array.isArray(p.box)) for (let x = p.box[0]; x <= p.box[2]; x++) for (let z = p.box[1]; z <= p.box[3]; z++) planCols.add(k2(x, z)) }
const projCells = new Set(recs.flatMap(r => (r.cells ?? []).map(c => c.at.join(','))))
const resZ = recordZones(recs)
const hallZ = hz.filter(z => !/marker/.test(String(z.why)))
const markZ = markerZones(markers)
const roadZ = [...(land.corridors ?? []), ...recordZones(recs.filter(r => r.blueprint === P.PATHS_BLUEPRINT))]
const touched = rec ? [...rec.cut.map(c => ['cut', c.at]), ...rec.cells.map(c => [c.role, c.at]), ...rec.clear.map(c => ['clear', c.at]), ...(rec.replant ?? []).map(c => ['replant', c.cell])] : []
for (const [what, at] of touched) {
  const [x, , z] = at, tag = `${what}@${at.join(',')}`
  const isReplant = what === 'replant'
  if ((R.zones ?? []).some(zb => Array.isArray(zb.box) && inB6(zb.box, x, z))) prot.zone.push(tag)
  if (wellCols.has(k2(x, z))) prot.well.push(tag)
  if (farmCols.has(k2(x, z)) && !isReplant) prot.farm.push(tag)
  if (planCols.has(k2(x, z))) prot.plan.push(tag)
  if (projCells.has(at.join(','))) prot.project_cell.push(tag)
  if (resZ.some(zb => inB6(zb.box, x, z))) prot.reservation.push(tag)
  if (hallZ.some(zb => inB6(zb.box, x, z))) prot.hall.push(tag)
  if (markZ.some(zb => inB6(zb.box, x, z))) prot.marker.push(tag)
  if (roadZ.some(zb => inB6(zb.box, x, z))) prot.road.push(tag)
}
// the finished ground's steps between worked columns and their neighbours (the 1-Lipschitz claim)
const gr = st.grade
let steps = 0, stepsOver = 0, stepsOverWorse = 0
if (gr) for (const k of gr.worked) {
  const [x, z] = k.split(',').map(Number)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = k2(x + dx, z + dz)
    const c = T.tidyColumn(read2, x + dx, z + dz, { yHi: home.y + 14, yLo: home.y - 14 })
    if (c.why || c.y == null) continue
    const h = gr.H.get(k), hn = gr.H.get(n) ?? c.y
    steps++
    if (Math.abs(h - hn) > 1) { stepsOver++; const g0 = gr.g.get(k), c0 = T.tidyColumn(read1, x + dx, z + dz, { yHi: home.y + 14, yLo: home.y - 14 }), gn = gr.g.get(n) ?? c0.y; if (Math.abs(h - hn) > Math.abs(g0 - gn)) { stepsOverWorse++; if (process.env.STEPDBG && stepsOverWorse < 6) console.error('worse', k, h, g0, n, hn, gn, gr.worked.has(n), gr.free.has(n)) } }
  }
}
const parkCells = (rec?.cells ?? []).filter(c => PARK_ROLES.has(c.role))
const byRole = {}
for (const c of parkCells) byRole[c.role.replace(/\d$/, '')] = (byRole[c.role.replace(/\d$/, '')] ?? 0) + 1
const out = {
  pool, home, box, ms, wall: !!wall, levels: st.levels, floors: rec?.terrace?.floors ?? null, alpha: rec?.terrace?.alpha ?? null, tried: rec?.terrace?.tried ?? st.tried ?? null,
  stage0: s0.record ? { cut: s0.record.cut.length, fill: s0.record.cells.length, pits: s0.record.pits, skipped: s0.record.skipped ?? null } : null, water: T.tidyWater(),
  walk: { before, stage0: mid, after },
  volumes: rec ? { cut: rec.terrace.cut, fill: rec.terrace.fill, seal: rec.terrace.seal, dam: rec.terrace.dam ?? 0, net: rec.terrace.net, columns: rec.terrace.columns, worked: rec.terrace.worked, kept: rec.terrace.kept } : null,
  trees: rec ? { felled: rec.terrace.trees, logs: rec.terrace.logs, replant: rec.terrace.replant } : null,
  steps: { checked: steps, over1: stepsOver, over1Worse: stepsOverWorse },
  protected: Object.fromEntries(Object.entries(prot).map(([k, v]) => [k, v.length])), protectedSample: Object.fromEntries(Object.entries(prot).filter(([, v]) => v.length).map(([k, v]) => [k, v.slice(0, 4)])),
  park: rec?.park ? { box: rec.park.box, kinds: rec.park.kinds, placed: rec.park.placed, skipped: rec.park.skipped, cells: parkCells.length, byRole, trees: rec.park.trees.length } : null,
  skipped: rec?.terrace?.skipped ?? st.skipped ?? null, segments: rec?.segments.length ?? 0, why: st.why,
  have: Object.fromEntries(Object.entries(have).filter(([n]) => /flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|lily|rose|lilac|peony|sunflower|azalea|sapling|bamboo|seeds|carrot|potato|sugar_cane|leaves|bone_meal|_hoe$/.test(n))),
}
// --record: the stage's record and stage 0's (the tripwire replay's input)
if (opt('record')) fs.writeFileSync(opt('record'), JSON.stringify({ pool, stage0: s0.record ?? null, record: rec ?? null }))
// --grid: a top-down picture's data (before / after heights, classes) for the render
if (opt('grid')) {
  const W = []
  const parkAt = new Map(parkCells.map(c => [k2(c.at[0], c.at[2]), c.role]))
  const cutCols = new Set((rec?.cut ?? []).map(c => k2(c.at[0], c.at[2]))), fillCols = new Set((rec?.cells ?? []).filter(c => !PARK_ROLES.has(c.role)).map(c => k2(c.at[0], c.at[2])))
  const treeCols = new Set((rec?.clear ?? []).filter(c => c.kind === 'tree').map(c => k2(c.at[0], c.at[2])))
  for (let z = box[1] - 2; z <= box[3] + 2; z++) {
    const row = []
    for (let x = box[0] - 2; x <= box[2] + 2; x++) {
      const c0 = T.tidyColumn(read0, x, z, { yHi: home.y + 14, yLo: home.y - 14 }), c2 = T.tidyColumn(read2, x, z, { yHi: home.y + 14, yLo: home.y - 14 })
      const k = k2(x, z)
      row.push({ y0: c0.y, y1: c2.y, w0: c0.why, g: avoidT(x, z) ? String(avoidT(x, z)).slice(0, 12) : null, p: parkAt.get(k) ?? null, cut: cutCols.has(k), fill: fillCols.has(k), tree: treeCols.has(k), n: String(c2.name ?? '') })
    }
    W.push(row)
  }
  fs.writeFileSync(opt('grid'), JSON.stringify({ pool, box, x0: box[0] - 2, z0: box[1] - 2, park: rec?.park?.box ?? null, rows: W }))
}
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify(out, null, 1))
