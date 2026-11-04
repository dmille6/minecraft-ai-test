#!/usr/bin/env node
// THE SORTED HALL'S SITE, OFFLINE (storehub-01 piece A): skills.mjs storehubSiteFor's call -- storehub.mjs hubSitingPlan (the
// storehouse's side first, then the town ring) over buildsite.mjs siteBlueprint, clear of the protected zones, every record +
// PROJECT_GAP, the land plan's road corridors, an unsited copper hall's pad and the expedition markers -- on COPIES of a town's
// region files and pool state. Nothing is written.
//
//   node scripts/storehub-offline.mjs <dump.json> <pool-state-dir> [--json] [--sync]
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { loadBlueprint, siteBlueprint, siteBlueprintAsync } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import * as CH from '../src/copperhall.mjs'
import * as EX from '../src/expedition.mjs'
import * as SH from '../src/storehub.mjs'
const LP = await import('../src/landplan.mjs').catch(() => null)

const argv = process.argv.slice(2)
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: storehub-offline.mjs <dump.json> <pool-state-dir> [--json] [--sync]'); process.exit(2) }
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } })
  .filter(p => p.rec && p.plot !== SH.HUB_PLOT)
const recs = all.map(p => p.rec).filter(r => r.plot !== 'land')
const land = all.find(p => p.plot === 'land')?.rec ?? null
const hall = all.some(p => p.plot === CH.HALL_PLOT) ? [] : [CH.hallPadZone(plan, loadBlueprint(CH.HALL_BLUEPRINT))].filter(Boolean)
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const others = land && LP ? [...recs, LP.landReservation(land)] : recs
const zones = [...R.zones, ...recordZones(others), ...hall, ...(EX.markerZones ?? (() => []))(markers)]
const store = recs.find(r => r.plot === 'storehouse') ?? null
const ctx = { zones, wells: R.wells, farm: R.farm, z0: null, stood: [], plot: SH.HUB_PLOT }
const bp = loadBlueprint(SH.HUB_BLUEPRINT)
const out = { home, store: store?.box ?? null, records: recs.length, zones: zones.length, steps: [], site: null }
for (const step of SH.hubSitingPlan(home, store)) {
  const t0 = Date.now()
  const sctx = { ...ctx, sectors: [{ sector: null, source: step.source }], earth: step.earth, domain: step.domain, standDomain: step.standDomain, walkR: step.walkR, line: step.line, rankKey: step.rankKey }
  const s = argv.includes('--sync') ? siteBlueprint(read, plan, bp, sctx) : await siteBlueprintAsync(read, plan, bp, sctx)
  const tally = f => { const m = {}; for (const r of s.sectors ?? []) for (const [k, v] of Object.entries(r[f] ?? {})) m[k] = (m[k] ?? 0) + v; return m }
  out.steps.push({ source: step.source, ok: s.ok, why: s.why, screened: (s.sectors ?? []).reduce((n, r) => n + (r.screened ?? 0), 0), tried: (s.sectors ?? []).reduce((n, r) => n + (r.tried ?? 0), 0), rejects: tally('rejects'), proofFails: tally('proofFails'), ms: Date.now() - t0 })
  if (!s.ok) continue
  const r = SH.hubRecordOf(s.record, bp, { band: step.source })
  const inZones = r.cells.filter(c => zones.some(z => c.at[0] >= z.box[0] && c.at[0] <= z.box[3] && c.at[2] >= z.box[2] && c.at[2] <= z.box[5])).length
  out.site = { anchor: r.anchor, orient: r.orient, box: r.box, floor: r.s, earthwork: r.earthwork, trees: r.trees.length, replant: r.replant.length, clear: r.clear.length,
    cells: r.cells.length, interior: r.interior, cellsInReservations: inZones, fromStore: SH.boxGap(r.box, store?.box), fromHome: Math.round(Math.hypot((r.box[0] + r.box[2]) / 2 - home.x, (r.box[1] + r.box[3]) / 2 - home.z)),
    chests: r.chests, bom: r.bom }
  break
}
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify(out, null, 1))
