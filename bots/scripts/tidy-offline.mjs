#!/usr/bin/env node
// THE TOWN TIDY, OFFLINE (tidy-01): the bots' own survey (tidy.mjs surveyTidy) on COPIES of a town's region files and pool state,
// and the paths siting (paths.mjs sitePaths, the bots' own) on the ground as it is and as the tidy would leave it.
//
//   node scripts/tidy-offline.mjs <dump.json> <pool-state-dir> [--r N] [--json]
//
// <dump.json> is scripts/host/townplan_blockdump.py over COPIES of the region files (a box covering home +- 56, y home-20 ..
// home+30); <pool-state-dir> a COPY of /var/lib/mcai/_pool-<pool> (pathsite-offline.mjs's inputs). Nothing is written.
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords, readJson } from './buildsite-offline.mjs'
import { loadBlueprint, placeBlueprint } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import * as P from '../src/paths.mjs'
import * as T from '../src/tidy.mjs'
import { recordZones } from '../src/shop.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: tidy-offline.mjs <dump.json> <pool-state-dir> [--r N] [--json]'); process.exit(2) }
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
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
  try { if (rec?.blueprint && !/^(ziggurat|paths|wall|shaft|treefarm|tidy)@/.test(rec.blueprint)) bp = loadBlueprint(rec.blueprint) } catch { bp = null }
  return { plot, rec, bp }
}).filter(p => p.rec)
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
const r = Number(opt('r', T.TIDY.r))
// THE TIDY'S GUARD (skills.mjs tidyInputs): every project's record columns and reservation, never the tidy's own
const recs = all.filter(p => p.plot !== T.TIDY_PLOT).map(p => p.rec)
const avoid = T.tidyAvoid(P.pathAvoid({ plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, records: recs, home }), recordZones(recs))
const cells = new Set(recs.flatMap(q => (q.cells ?? []).map(c => c.at.join(','))))
// the paths' siting inputs (their own projects: never the paths' own record, never the tidy's)
const projects = all.filter(p => p.plot !== P.PATHS_PLOT && p.plot !== T.TIDY_PLOT)
const pin = { plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, projects, place: placeBlueprint }
const t0 = Date.now()
const ts = T.siteTidy(read, { home, avoid, cells, pin: argv.includes('--no-grade') ? null : pin, plan, r, ...(opt('grade') ? { grades: opt('grade').split(',').map(Number) } : {}) })
const ms = Date.now() - t0
const rec = ts.record
// the survey alone (pillars and pits), simulated, for the comparison
const surveyRec = T.tidyRecord(ts.survey, { home, plan, r })
const route = rd => P.sitePaths(rd, pin)
const leg = q => (q.net?.legs ?? []).filter(l => !l.ok && !l.optional).map(l => l.id)
const before = route(read)
const sread = surveyRec ? T.tidyOverlay(read, surveyRec) : read
const tread = rec ? T.tidyOverlay(read, rec) : read
const mid = route(sread)
// --rounds N: the tidy re-surveyed on the ground the last one left (skills.mjs: a tidy whose paths still do not route is due again)
const rounds = [{ cut: rec?.cut.length ?? 0, fill: rec?.cells.length ?? 0 }]
let cur = tread
for (let i = 1; i < Number(opt('rounds', 1)); i++) {
  if (route(cur).ok) break
  const t2 = T.siteTidy(cur, { home, avoid, cells, pin, plan, r, ...(opt('grade') ? { grades: opt('grade').split(',').map(Number) } : {}) })
  if (!t2.record) break
  rounds.push({ cut: t2.record.cut.length, fill: t2.record.cells.length })
  cur = T.tidyOverlay(cur, t2.record)
}
const after = route(cur)
const rough = rd => { const q = T.tidyRoughness(rd, home, { r }); return `${q.d2}/${q.pairs} (${(100 * q.d2 / Math.max(1, q.pairs)).toFixed(1)}%) d5 ${q.d5}` }
const cnt = (rc, f) => (rc?.cut ?? []).filter(f).length
const out = {
  pool: path.basename(poolDir).replace(/^_pool-/, ''), home, r, ms,
  survey: { pillars: ts.survey.pillars.length, cut: ts.survey.cut.length, pits: ts.survey.pits.length, fill: ts.survey.fill.length, skipped: ts.survey.skipped,
    hist: ts.survey.pillars.reduce((m, p) => (m[p.h] = (m[p.h] ?? 0) + 1, m), {}) },
  grade: rec?.grade ?? null, tried: ts.tried,
  record: rec ? { cut: rec.cut.length, fill: rec.cells.length, segments: rec.segments.length, pillars: rec.pillars, pits: rec.pits } : null,
  rounds, rough: { before: rough(read), survey: rough(sread), tidy: rough(cur) },
  paths: { before: before.ok ? 'routes' : leg(before).join('+'), survey: mid.ok ? 'routes' : leg(mid).join('+'), tidy: after.ok ? `routes (${after.record.cells.length} cells, cut ${after.record.earthwork.cut} fill ${after.record.earthwork.fill})` : leg(after).join('+') },
}
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify(out, null, 1))
