#!/usr/bin/env node
// THE ENCHANTING WORKSHOP'S SITE, OFFLINE (enchantshop-01): skills.mjs enchantSiteFor's call -- enchantshop.mjs enchantOpening (the
// wall extension's hall-size plot) and enchantSitingPlan (the plot + its stand ring; the plot's own land zone the one zone dropped)
// over buildsite.mjs siteBlueprint, clear of the protected zones, every record + PROJECT_GAP, the land plan's corridors and plots,
// an unsited copper hall's pad and the expedition markers -- on COPIES of a town's region files and pool state. Nothing is written
// but --out.
//
//   node scripts/enchantshop-offline.mjs <dump.json> <pool-state-dir> --ext <wallext record.json> [--hub x0,z0,x1,z1] [--fell x0,z0,x1,z1] [--out rec.json]
//
// --ext: the wall extension's record (a pool that has one sited reads it from the pool when --ext is absent). --hub: an UNSITED
// storage hall's box (the offline hall site) taken as its record's reservation.
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { loadBlueprint, siteBlueprintAsync } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import * as CH from '../src/copperhall.mjs'
import * as EX from '../src/expedition.mjs'
import * as EN from '../src/enchantshop.mjs'
import { landReservation } from '../src/landplan.mjs'

const argv = process.argv.slice(2)
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: enchantshop-offline.mjs <dump.json> <pool-state-dir> --ext <rec.json> [--hub x0,z0,x1,z1] [--out f]'); process.exit(2) }
const read0 = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
// --fell x0,z0,x1,z1: read every log and leaves block in that box as air (what the groundskeeper's in-wall felling leaves)
const fell = opt('--fell') ? opt('--fell').split(',').map(Number) : null
const read = fell ? (x, y, z) => { const b = read0(x, y, z); return b && x >= fell[0] && x <= fell[2] && z >= fell[1] && z <= fell[3] && /_(log|leaves)$/.test(b.name) ? { name: 'air', boundingBox: 'empty' } : b } : read0
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } })
  .filter(p => p.rec && p.plot !== EN.ENCHANT_PLOT)
let ext = opt('--ext') ? JSON.parse(fs.readFileSync(opt('--ext'), 'utf8')) : (all.find(p => p.plot === 'wallext')?.rec ?? null)
if (ext?.record) ext = ext.record
const recs = all.map(p => p.rec).filter(r => r.plot !== 'land' && r.plot !== 'wallext')
if (ext) recs.push(ext)
const hubBox = opt('--hub') ? opt('--hub').split(',').map(Number) : null
if (hubBox && !recs.some(r => r.plot === 'storehub')) recs.push({ plot: 'storehub', box: hubBox })
const land = all.find(p => p.plot === 'land')?.rec ?? null
const hall = all.some(p => p.plot === CH.HALL_PLOT) ? [] : [CH.hallPadZone(plan, loadBlueprint(CH.HALL_BLUEPRINT))].filter(Boolean)
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const others = land ? [...recs, landReservation(land, ext)] : recs
const zones0 = [...R.zones, ...recordZones(others), ...hall, ...(EX.markerZones ?? (() => []))(markers)]
if (argv.includes("--zones")) { const b=[-23,-66,-3,-52]; for (const z of zones0) if (z.box[0]<=b[2]&&z.box[3]>=b[0]&&z.box[2]<=b[3]&&z.box[5]>=b[1]&&z.box[4]>=54&&z.box[1]<=90) console.error("ZONE", JSON.stringify(z)) }
const o = EN.enchantOpening(ext)
const out = { home, opening: { open: o.open, why: o.why, plot: o.plot }, records: recs.length, zones: zones0.length, site: null }
if (!o.open) { console.log(JSON.stringify(out, null, 1)); process.exit(0) }
const sp = EN.enchantSitingPlan(home, o.plot, zones0)
out.droppedZones = zones0.length - sp.zones.length
const bp = loadBlueprint(EN.ENCHANT_BLUEPRINT)
const t0 = Date.now()
const s = await siteBlueprintAsync(read, plan, bp, { zones: sp.zones, wells: R.wells, farm: R.farm, z0: null, stood: [], sectors: sp.sectors, plot: EN.ENCHANT_PLOT,
  earth: sp.earth, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line })
const tally = f => { const m = {}; for (const r of s.sectors ?? []) for (const [k, v] of Object.entries(r[f] ?? {})) m[k] = (m[k] ?? 0) + v; return m }
out.search = { ok: s.ok, why: s.why, screened: (s.sectors ?? []).reduce((n, r) => n + (r.screened ?? 0), 0), tried: (s.sectors ?? []).reduce((n, r) => n + (r.tried ?? 0), 0), rejects: tally('rejects'), proofFails: tally('proofFails'), proofEx: (s.sectors ?? []).flatMap(r => r.proofEx ?? []), ms: Date.now() - t0 }
if (s.ok) {
  const r = EN.enchantRecordOf(s.record, bp, { plotId: o.plot.id, walkR: sp.walkR })
  const inZ = (at, zs) => zs.some(z => at[0] >= z.box[0] && at[0] <= z.box[3] && at[1] >= z.box[1] && at[1] <= z.box[4] && at[2] >= z.box[2] && at[2] <= z.box[5])
  const pb = o.plot.box
  out.site = { anchor: r.anchor, orient: r.orient, box: r.box, plotBox: pb, onPlot: r.box[0] >= pb[0] && r.box[1] >= pb[1] && r.box[2] <= pb[2] && r.box[3] <= pb[3], floor: r.s, earthwork: r.earthwork, trees: r.trees.length, replant: r.replant.length, clear: r.clear.length,
    cells: r.cells.length, cellsInReservations: r.cells.filter(c => inZ(c.at, sp.zones)).length, fitInReservations: r.fit.filter(f => inZ(f.at, sp.zones)).length,
    fromHome: Math.round(Math.hypot((r.box[0] + r.box[2]) / 2 - home.x, (r.box[1] + r.box[3]) / 2 - home.z)), door: r.signs.length,
    fit: r.fit.map(f => `${f.slot}@${f.at.join(',')}`), gapNow: [...new Set(r.gap.map(g => read(...g)?.name ?? '?'))], signs: r.signs.map(x => `${x.lines[0]}@${x.at.join(',')}`), bom: r.bom }
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(r, null, 1))
}
console.log(JSON.stringify(out, null, 1))
