#!/usr/bin/env node
// THE STEPWELL'S SITE, OFFLINE (stepwell-01): skills.mjs buildStepwell's siting -- stepwell.mjs surveyStepwell over every candidate
// centre, off every reservation (the protected zones, every record + its zones, the land plan's corridors, park and plots, the
// expedition markers) and inside the land plan's industry/wild zones -- on COPIES of a town's region files and pool state. Also the
// phase-2 column under the court (a 9 x 9 round the court's centre, down to y -60): caves, water, lava and ores by 8-block band.
// Nothing is written but --out (the best site's record) and --grid (the picture's data).
//
//   node scripts/stepwell-offline.mjs <dump.json> <pool-state-dir> [--W 27] [--tiers 2] [--out rec.json] [--grid grid.json] [--top 8]
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import * as EX from '../src/expedition.mjs'
import * as SWm from '../src/stepwell.mjs'
import { landReservation, zoneAt } from '../src/landplan.mjs'
import { toWorld } from '../src/shaftgeom.mjs'
import { plotPrep, replantCells, PLOTPREP } from '../src/tidy.mjs'

const argv = process.argv.slice(2)
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: stepwell-offline.mjs <dump.json> <pool-state-dir> [--W n] [--tiers n] [--out f] [--grid f]'); process.exit(2) }
const W = Number(opt('--W') ?? SWm.SW.W), tiers = Number(opt('--tiers') ?? SWm.SW.tiers), topN = Number(opt('--top') ?? 8)
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
const read = dumpReader(dump)
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const plots = [...new Set(fs.readdirSync(poolDir).map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } }).filter(p => p.rec && p.plot !== SWm.STEPWELL_PLOT)
const recs = all.map(p => p.rec).filter(r => r.plot !== 'land')
const land = all.find(p => p.plot === 'land')?.rec ?? null
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const zones = [...R.zones, ...recordZones(land ? [...recs, landReservation(land, null)] : recs), ...(EX.markerZones ?? (() => []))(markers)]
const cellsOf = new Set(recs.flatMap(r => (r.cells ?? []).map(c => `${c.at[0]},${c.at[2]}`)))
const blocked = (x, z) => (zones.some(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5]) ? (zones.find(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5]).why ?? 'zone') : cellsOf.has(`${x},${z}`) ? 'record' : null)
const zoneOf = land ? (x, z) => zoneAt(land, x, z) : null
const t0 = Date.now()
const why = {}, ok = []
let tried = 0
for (const cand of SWm.stepwellCandidates(home, { ring: [SWm.SW.ringMin, Number(opt('--ring') ?? SWm.SW.ringMax)] })) {
  const near = opt('--near') ? opt('--near').split(',').map(Number) : null
  if (near && Math.max(Math.abs(cand.x - near[0]), Math.abs(cand.z - near[1])) > near[2]) continue
  tried++
  const sv = SWm.surveyStepwell(read, home, cand, { blocked, zoneOf, W, tiers, treesOk: argv.includes('--trees'), pondMax: Number(opt('--pond') ?? 0) })
  if (!sv.ok) { const k = String(sv.why).replace(/:-?\d+$/, '').replace(/^reserved:(project:[a-z]+|land:[a-z]+|expedition:[a-z]+|[a-z-]+).*$/, 'reserved:$1'); why[k] = (why[k] ?? 0) + 1; continue }
  ok.push(sv)
}
const cost = s => s.counts.soft + s.counts.cave + s.counts.fill + 4 * s.counts.water + 20 * (s.counts.trunks ?? 0) + 40 * (s.turn ?? 0)
ok.sort((a, b) => cost(a) - cost(b) || a.d - b.d)
const cellsAll = new Set(recs.flatMap(r => (r.cells ?? []).map(c => c.at.join(','))))
/** THE FELLING of a surveyed site: plotPrep's trees and stands on the footprint (its levelling unused), replantCells' saplings. */
function fellFor (sv) {
  const P0 = SWm.planTank(sv.site)
  const [bx0, bz0, bx1, bz1] = P0.box
  const pp = plotPrep(read, { plots: [{ id: 'SW', kind: 'stepwell', box: [bx0, bz0, bx1, bz1] }], home, records: recs, avoid: (x, z) => blocked(x, z), cells: cellsAll, T: { ...PLOTPREP, platMax: SWm.SW.standMax } })
  const rp = land ? replantCells(read, land, pp.trees.map(t => ({ col: t.col, name: t.name })), { avoid: (x, z) => blocked(x, z) ?? (x >= bx0 - 2 && x <= bx1 + 2 && z >= bz0 - 2 && z <= bz1 + 2 ? 'stepwell' : null), cells: cellsAll }) : []
  const kept = Object.entries(pp.skipped).filter(([k]) => /^tree/.test(k)).reduce((n, [, v]) => n + v, 0)
  return { trees: pp.trees, platforms: pp.platforms, clear: pp.clear, replant: rp, kept, skipped: pp.skipped }
}
let best = null, bestFell = null
const fellWhy = {}
for (const s of ok) {
  const f = fellFor(s)
  if (f.kept > 0) { fellWhy.trees_kept = (fellWhy.trees_kept ?? 0) + 1; continue }
  if (f.replant.length < f.trees.length) { fellWhy.no_replant = (fellWhy.no_replant ?? 0) + 1; continue }
  const sf = SWm.standsFit(s.site, f.platforms)
  if (sf) { fellWhy[sf] = (fellWhy[sf] ?? 0) + 1; continue }
  s.fell = f
  if (SWm.stepwellBetter(best, s) === s) { best = s; bestFell = f }
}
const out = { home, W, tiers, records: recs.length, zones: zones.length, tried, sites: ok.length, refused: why, fellRefused: fellWhy, ms: Date.now() - t0 }
// distinct sites: the best few whose footprints do not overlap a better one
const pick = []
for (const s of ok) { const [cx, cz] = s.site.centre; if (pick.every(p => Math.max(Math.abs(p.site.centre[0] - cx), Math.abs(p.site.centre[1] - cz)) >= W)) pick.push(s); if (pick.length >= topN) break }
const byD = [...ok].sort((a, b) => a.d - b.d)
const pickD = []
for (const s of byD) { const [cx, cz] = s.site.centre; if (pickD.every(p => Math.max(Math.abs(p.site.centre[0] - cx), Math.abs(p.site.centre[1] - cz)) >= W)) pickD.push(s); if (pickD.length >= topN) break }
out.nearest = pickD.map(s => ({ centre: s.site.centre, away: s.site.away, g: s.g, tiersDry: s.site.tiersDry, d: Math.round(s.d), zone: zoneOf ? zoneOf(...s.site.centre) : '-', counts: s.counts }))
out.top = pick.map(s => ({ centre: s.site.centre, away: s.site.away, g: s.g, tiersDry: s.site.tiersDry, d: Math.round(s.d), zone: zoneOf ? zoneOf(...s.site.centre) : '-', counts: s.counts, byTier: s.byTier }))
if (best) {
  const fell = bestFell
  out.fell = { trees: fell.trees.length, stands: fell.platforms.length, standCells: fell.platforms.reduce((n, q) => n + q.cells.length, 0), logs: fell.clear.filter(c => c.kind === 'tree').length, leaves: fell.clear.filter(c => c.kind === 'leaves').length, replant: fell.replant.length, skipped: fell.skipped }
  // stepwell-02: the descent surveyed for the chosen site (its bottom rises above lava or flooded air)
  const sd = SWm.surveyDescent(read, best.site)
  out.descent = sd
  if (sd.ok) best.site.descent = { bottom: sd.bottom }
  const rec = SWm.stepwellRecord(best, { home, seed: SWm.stepwellSeed('showcase', home), fell, read })
  const P = SWm.planTank(rec.site)
  out.best = { centre: rec.site.centre, away: rec.site.away, g: rec.site.g, T: rec.site.T, box: rec.box, zone: rec.zones[0].box, exit: rec.exit, cells: rec.cells.length, clear: rec.clear.length,
    bill: SWm.stepwellBill(P), palette: rec.palette, solidCuts: rec.clear.filter(c => { const b = read(...c.at); return b && b.boundingBox !== 'empty' }).length,
    cellsInReservations: rec.cells.filter(c => blocked(c.at[0], c.at[2])).length, walk: SWm.walkCheck(P.cols, P.W).ok, d: Math.round(best.d), zone: zoneOf ? zoneOf(...rec.site.centre) : '-', counts: best.counts, byTier: best.byTier, foreign: rec.cells.filter(c => ['floor', 'trim', 'wall'].includes(c.role)).filter(c => { const b = read(...c.at); return b && b.boundingBox !== 'empty' && !SWm.cellGood(c.role, b) }).length, open: rec.cells.filter(c => { const b = read(...c.at); return b && b.boundingBox === 'empty' }).length }
  // THE PHASE-2 COLUMN under the court: a 9 x 9 round the centre, the court's floor - 1 down to y -60, by 8-block band
  const [cx, cz] = rec.site.centre
  const bands = {}
  const kind = b => { const n = String(b?.name ?? '?').replace(/\[.*\]$/, ''); if (!b) return 'unknown'; if (/lava/.test(n)) return 'lava'; if (/water|bubble_column|kelp|seagrass/.test(n)) return 'water'; if (/_ore$/.test(n)) return n.includes('diamond') ? 'diamond' : n.includes('iron') ? 'iron' : n.includes('coal') ? 'coal' : 'ore'; if (b.boundingBox === 'empty') return 'cave'; if (n === 'obsidian') return 'obsidian'; return 'solid' }
  for (let y = P.minY - 1; y >= -60; y--) {
    const band = Math.floor(y / 8) * 8
    const bb = (bands[band] ??= {})
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) { const k = kind(read(cx + dx, y, cz + dz)); bb[k] = (bb[k] ?? 0) + 1 }
  }
  out.phase2 = bands
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(rec, null, 1))
  if (opt('--grid')) {
    // the picture's data: the plan's columns (kind, s, post, light) in world coordinates, the natural ground top and its block, a
    // cross-section through the centre along both axes (block names by y), the town's records' boxes round it
    const cols = [...P.cols.values()].map(c => { const w = toWorld(rec.site.origin, rec.site.away, c.u, c.v); return { x: w.x, z: w.z, u: c.u, v: c.v, kind: c.kind, s: c.s, post: c.post, light: !!c.light, t: c.t } })
    const [x0, z0, x1, z1] = rec.box
    const span = 14
    const nat = []
    for (let x = x0 - span; x <= x1 + span; x++) for (let z = z0 - span; z <= z1 + span; z++) {
      let top = null
      for (let y = home.y + 30; y >= home.y - 30; y--) { const b = read(x, y, z); if (b && b.boundingBox !== 'empty' || (b && /water|lava/.test(b.name))) { top = { y, n: b.name.replace(/\[.*\]$/, '') }; break } }
      nat.push({ x, z, ...(top ?? { y: null, n: '?' }) })
    }
    const section = axis => {
      const rows = []
      for (let y = -64; y <= rec.site.g + 12; y++) {
        const row = []
        for (let i = -span; i < W + span; i++) {
          const w = axis === 'u' ? toWorld(rec.site.origin, rec.site.away, i, (W - 1) / 2) : toWorld(rec.site.origin, rec.site.away, (W - 1) / 2, i)
          row.push(String(read(w.x, y, w.z)?.name ?? '?').replace(/\[.*\]$/, ''))
        }
        rows.push({ y, row })
      }
      return rows
    }
    fs.writeFileSync(opt('--grid'), JSON.stringify({ site: rec.site, box: rec.box, exit: rec.exit, palette: rec.palette, cols, nat, span,
      sectionU: section('u'), sectionV: section('v'), records: recs.filter(r => Array.isArray(r.box)).map(r => ({ plot: r.plot, box: r.box })), shaft: recs.find(r => r.plot === 'shaft')?.box ?? null }))
  }
}
console.log(JSON.stringify(out, null, 1))
