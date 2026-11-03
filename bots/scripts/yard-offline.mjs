#!/usr/bin/env node
// THE STOCK YARD'S SITE, OFFLINE (yardsite-01): the bots' own land plan (landplan.mjs planLand, as landplan-offline.mjs draws it)
// and then the yard's siting exactly as skills.mjs yardSiteFor runs it (yard.mjs yardSitingPlan: 2x first under auto, each band
// nearest first; buildsite.mjs siteBlueprint over the land plan's yard and wild sectors, clear of the protected zones, every record +
// PROJECT_GAP, the land plan's road corridors, an unsited copper hall's pad and the expedition markers) on COPIES of a town's region
// files and pool state. THE CONTROL: the stockyard-01 call (yard@1, the town ring 22..44, the workshop's sectors), which found no site
// on the showcase (11-02: 0 of 31,684).
//
//   node scripts/yard-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--size 1|2|auto] [--no-land] [--no-control] [--json]
//
// <dump.json> is scripts/host/townplan_blockdump.py over COPIES of the region files (home +- 112, y home-16 .. home+20); the pool dir
// a COPY of /var/lib/mcai/_pool-<pool>. Nothing is written.
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords, readJson } from './buildsite-offline.mjs'
import { loadBlueprint, siteBlueprint, siteBlueprintAsync, projectSectors } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import * as P from '../src/paths.mjs'
import * as T from '../src/tidy.mjs'
import * as Y from '../src/yard.mjs'
import { recordZones } from '../src/shop.mjs'
import { HALL_BLUEPRINT, HALL_PLOT } from '../src/copperhall.mjs'
import * as EX from '../src/expedition.mjs'
import * as CH from '../src/copperhall.mjs'
// a tree without groundskeeper-01 (main before it lands) has no land plan module, no hall-pad or marker reservation: run without
const LP = await import('../src/landplan.mjs').catch(() => null)
const hallPadZone = CH.hallPadZone ?? (() => null)
const markerZones = EX.markerZones ?? (() => [])

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: yard-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--size 1|2|auto] [--no-land] [--no-control] [--json]'); process.exit(2) }
const pool = opt('pool', path.basename(poolDir).replace(/^_pool-/, ''))
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } })
  .filter(p => p.rec && p.plot !== 'land' && p.plot !== Y.YARD_PLOT)
const recs = all.map(p => p.rec)
// the reservations the bot adds (skills.mjs hallPadZones, townMarkerZones)
const hall = all.some(p => p.plot === HALL_PLOT) ? [] : [hallPadZone(plan, loadBlueprint(HALL_BLUEPRINT))].filter(Boolean)
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const hz = [...hall, ...markerZones(markers)]
// THE LAND PLAN: the pool's own record when it has one, else drawn here as the keeper would (landplan-offline.mjs's guards)
let land = null, landFrom = 'none', planMs = 0
const lh = recordHead(poolDir, `project-${hk}.land`)
if (!argv.includes('--no-land') && lh.ok && lh.head?.rec?.blueprint === 'land@1') { land = lh.head.rec; landFrom = `record g${lh.head.gen}` }
if (!argv.includes('--no-land') && !land && !LP) landFrom = 'no land plan module (this tree has no groundskeeper)'
if (!argv.includes('--no-land') && !land && LP) {
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
  const noPaths = recs.filter(r => r.blueprint !== P.PATHS_BLUEPRINT && r.plot !== T.TIDY_PLOT)
  const roadAvoid = T.tidyAvoid(P.pathAvoid({ plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, records: noPaths, home }), hz)
  const rz = [...recordZones(noPaths), ...hz]
  const reserved = (x, z) => { for (const zb of rz) { const b = zb.box; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return zb.why } return null }
  const t0 = Date.now()
  const L = await LP.planLand(read, { home, plan, seed: LP.landSeed(pool, home), avoid: roadAvoid, reserved, limOf: n => T.gradeLim(read, n), caps, composter })
  planMs = Date.now() - t0
  land = L.plan ?? null
  landFrom = land ? 'drawn offline' : `not drawn (${L.why ?? '?'})`
}
// skills.mjs yardSiteFor's inputs: every other record's reservation (the land plan's corridors among them), the hall pad, the markers
const others = land && LP ? [...recs, LP.landReservation(land)] : land ? [...recs, { zones: land.corridors ?? [] }] : recs
const zones = [...R.zones, ...recordZones(others), ...hz]
const mon = recs.find(r => r.plot === 'monument' && Array.isArray(r.box))
const z0 = mon ? { box: mon.box } : null
const shopSector = recs.find(r => r.plot === 'shop')?.sector ?? null
const fallback = projectSectors(plan, shopSector)
// experiments (never the bot's): --kinds yard,wild,homes (the zone kinds tried), --earth-col N (the fill depth), --bands 44,58,72,80
const kinds = opt('kinds') ? opt('kinds').split(',') : null
const sectors = kinds && land ? kinds.flatMap(k => Object.entries(land.zones).filter(([, v]) => v === k).map(([sector]) => ({ sector, source: `land:${k}` }))) : Y.yardSectors(land, fallback)
const col = opt('earth-col') ? Number(opt('earth-col')) : null
const bands = opt('bands') ? opt('bands').split(',').map(Number) : null
const ctx = { zones, wells: R.wells, farm: R.farm, z0, stood: [], plot: Y.YARD_PLOT }
if (opt('ctx-out')) fs.writeFileSync(opt('ctx-out'), JSON.stringify({ home, plan, zones, sectors, z0, wells: R.wells, farm: R.farm }))
const sum = s => (s.sectors ?? []).reduce((n, r) => n + (r.screened ?? 0), 0)
const tally = (s, f) => { const m = {}; for (const r of s.sectors ?? []) for (const [k, v] of Object.entries(r[f] ?? {})) m[k] = (m[k] ?? 0) + v; return m }
const out = {
  pool, home, land: land ? { from: landFrom, ringR: land.ringR, zones: land.zones, corridors: (land.corridors ?? []).length, planMs } : { from: landFrom },
  reservations: { protected: R.zones.length, records: recs.length, hallPad: hall.length, markers: markers.length, zones: zones.length },
  sectors, control: null, steps: [], site: null,
}
// THE CONTROL: stockyard-01's call (yard@1 over the town ring, the workshop's sectors)
if (!argv.includes('--no-control')) {
  const t0 = Date.now()
  const s = siteBlueprint(read, plan, loadBlueprint(Y.YARD_BLUEPRINT), { ...ctx, sectors: fallback, earth: Y.YARD_EARTH })
  out.control = { ok: s.ok, why: s.why, screened: sum(s), sectorsTried: (s.sectors ?? []).length, rejects: tally(s, 'rejects'), ms: Date.now() - t0 }
}
const sz = opt('size') ? (opt('size') === 'auto' ? 'auto' : Number(opt('size'))) : Y.yardSize()
let plan0 = Y.yardSitingPlan(home, { size: sz, bpOf: id => loadBlueprint(id) })
if (bands) plan0 = [...new Set(plan0.map(s => s.blueprint))].flatMap(id => bands.map(b => ({ ...plan0.find(s => s.blueprint === id), band: b, domain: Y.yardDomain(home, b), standDomain: Y.yardStandDomain(home, b), walkR: Y.yardWalkR(b), line: b })))
// --async: the bot's own call (siteBlueprintAsync) with the longest event-loop stall measured (the keep-alive question)
let maxGap = 0, lastBeat = Date.now()
const beat = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - lastBeat); lastBeat = n }, 10)
if (col) plan0 = plan0.map(s => ({ ...s, earth: { ...s.earth, col } }))
out.experiment = { kinds, col, bands }
for (const step of plan0) {
  const t0 = Date.now()
  const sctx = { ...ctx, sectors, earth: step.earth, domain: step.domain, standDomain: step.standDomain, walkR: step.walkR, line: step.line, sectorBy: step.sectorBy, rankKey: step.rankKey }
  lastBeat = Date.now()
  const s = argv.includes('--async') ? await siteBlueprintAsync(read, plan, loadBlueprint(step.blueprint), sctx) : siteBlueprint(read, plan, loadBlueprint(step.blueprint), sctx)
  out.steps.push({ blueprint: step.blueprint, band: step.band, ok: s.ok, why: s.why, screened: sum(s), tried: (s.sectors ?? []).reduce((n, r) => n + (r.tried ?? 0), 0), rejects: tally(s, 'rejects'), proofFails: tally(s, 'proofFails'), proofEx: (s.sectors ?? []).flatMap(r => r.proofEx ?? []), ms: Date.now() - t0 })
  if (!s.ok) continue
  const r = s.record
  // positive checks on the chosen site: no record cell on a reservation; how far out it lies
  const inZones = r.cells.filter(c => zones.some(z => c.at[0] >= z.box[0] && c.at[0] <= z.box[3] && c.at[2] >= z.box[2] && c.at[2] <= z.box[5])).length
  const cheb = r.cells.map(c => Math.max(Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z)))
  out.site = {
    blueprint: r.blueprint, band: step.band, sector: r.sector, source: r.sector_source, zone: land && LP ? LP.zoneAt(land, r.anchor[0], r.anchor[1]) : null,
    anchor: r.anchor, orient: r.orient, box: r.box, floor: r.s, earthwork: r.earthwork, trees: r.trees.length, replant: r.replant.length, clear: r.clear.length,
    cells: r.cells.length, interior: r.interior, walkR: r.walkR ?? null, cellsInReservations: inZones, cheb: [Math.min(...cheb), Math.max(...cheb)],
    slots: Y.pileSlots(r, loadBlueprint(r.blueprint)).reduce((n, b) => n + b.slots.length, 0),
  }
  break
}
clearInterval(beat)
out.maxStallMs = argv.includes('--async') ? maxGap : null
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify(out, null, 1))
