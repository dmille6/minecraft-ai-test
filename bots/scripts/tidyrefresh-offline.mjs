#!/usr/bin/env node
// TIDYREFRESH-01, OFFLINE: the open inside-the-wall tidy record's refresh (tidyrefresh.mjs) on COPIES of a town's region files and
// pool state. Nothing is written. The head record's open work is read against the dump (busy), the inside is surveyed again with
// that work passed as `planned` (the cap pages), the survey is merged (refreshMerge) and the result reported: what is added (cuts,
// fills, columns), what was skipped and why, the rough cap before (the head's own siting) and now, and an INDEPENDENT check that no
// added cell touches a protected zone, another project's record cell or a well. With --no-planned the survey runs without `busy`
// (the control: the cap fills with the work already planned).
//   node scripts/tidyrefresh-offline.mjs <dump.json> <pool-state-dir> [--now ISO] [--no-planned] [--json]
// <dump.json>: scripts/host/townplan_blockdump.py over COPIES of the region files; <pool-state-dir>: a COPY of /var/lib/mcai/_pool-<pool>.
// The inputs are inwall-offline's (the tidy's avoid, cells, reservations) plus the wall extension and the bots' climbs (7 days).
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords, readJson } from './buildsite-offline.mjs'
import { loadBlueprint } from '../src/buildsite.mjs'
import { recordHead, climbRead } from '../src/buildproj.mjs'
import { cellDone } from '../src/buildrun.mjs'
import * as P from '../src/paths.mjs'
import * as T from '../src/tidy.mjs'
import * as LP from '../src/landplan.mjs'
import * as TR from '../src/tidyrefresh.mjs'
import { recordZones } from '../src/shop.mjs'
import { hallPadZone, HALL_BLUEPRINT, HALL_PLOT } from '../src/copperhall.mjs'
import { markerZones } from '../src/expedition.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: tidyrefresh-offline.mjs <dump.json> <pool-state-dir> [--now ISO] [--no-planned] [--json]'); process.exit(2) }
const now = opt('now') ? Date.parse(opt('now')) : Date.now()
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const heads = plots.map(plot => {
  const h = recordHead(poolDir, `project-${hk}.${plot}`)
  const rec = h.ok ? h.head?.rec ?? null : null
  return { plot, gen: h.head?.gen ?? null, rec: rec ? { ...rec, plot: rec.plot ?? plot } : null }
}).filter(p => p.rec)
const tidy = heads.find(p => p.plot === T.TIDY_PLOT)
if (!tidy) { console.error('no tidy record'); process.exit(1) }
const land = heads.find(p => p.plot === LP.LAND_PLOT)?.rec ?? null
const all = heads.filter(p => p.plot !== LP.LAND_PLOT && p.plot !== T.TIDY_PLOT)
const recs = all.map(p => p.rec)
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
const noPaths = recs.filter(r => r.blueprint !== P.PATHS_BLUEPRINT)
const hz = all.some(p => p.plot === HALL_PLOT) ? [] : [hallPadZone(plan, loadBlueprint(HALL_BLUEPRINT))].filter(Boolean)
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
hz.push(...markerZones(markers))
const avoid = T.tidyAvoid(P.pathAvoid({ plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, records: recs, home }), [...recordZones(recs), ...hz])
const cells = new Set(recs.flatMap(q => (q.cells ?? []).map(c => c.at.join(','))))
const rz = [...recordZones(noPaths.filter(r => r.plot === 'siteprep')), ...hz]
const reserved = (x, z) => rz.some(zb => { const b = zb?.box; return Array.isArray(b) && x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] })
let climbs = []
try { climbs = climbRead(poolDir, { since: now - 7 * 24 * 60 * 60_000 }) } catch { climbs = [] }
const terrace = { records: recs, wall: recs.find(r => r.plot === 'wall') ?? null, wallext: recs.find(r => r.plot === 'wallext') ?? null, caps, climbs, have: {} }
const stage = LP.landStages().find(s => s.id === 'inwall')

const cur = tidy.rec
const done = q => cellDone(read(...q.at), T.TIDY_PALETTE, q.role)
const busy = TR.openColumns(cur, read, { done })
const open = { cut: cur.cut.filter(c => !(cur.waived ?? {})[c.at.join(',')] && T.cutStanding(read, c)).length, fill: cur.cells.filter(c => !c.prev && !(cur.waived ?? {})[c.at.join(',')] && !done(c)).length, cols: busy.size }
const s = T.siteStage(read, { home, land, stage, avoid, cells, plan, lim: T.gradeLim(read, 6), now, walkFrom: T.townEdge(plan, home), terrace, reserved, planned: argv.includes('--no-planned') ? null : busy })
const fresh = s.record ? T.coreFills(s.record) : null
const guard = new Set(recs.flatMap(r => (r.cells ?? []).map(c => c.at.join(','))))
const m = TR.refreshMerge(cur, fresh, { busy, guard, now })
const added = m.rec ? [...m.rec.cut.filter(c => c.added === now).map(c => c.at), ...m.rec.cells.filter(c => c.added === now).map(c => c.at)] : []
const zoneHit = c => (R.zones ?? []).some(z => { const b = z.box; return c[0] >= b[0] && c[0] <= b[3] && c[2] >= b[2] && c[2] <= b[5] })
const capNear = c => caps.some(w => Math.max(Math.abs(w[0] - c[0]), Math.abs(w[2] - c[2])) <= 3) || (R.wells ?? []).some(w => w[0] === c[0] && w[2] === c[2])
const known = new Set([...cur.cells, ...cur.cut].map(c => c.at.join(',')))
const prot = { zone: added.filter(zoneHit).length, otherRecordCell: added.filter(c => guard.has(c.join(','))).length, ownKnownCell: added.filter(c => known.has(c.join(','))).length, wellNear: added.filter(capNear).length }
const dist = a => Math.max(Math.abs(a[0] - home.x), Math.abs(a[2] - home.z))
const band = a => { const d = dist(a); return d < 20 ? '<20' : d < 40 ? '<40' : d < 64 ? '<64' : '64+' }
const out = {
  head: { gen: tidy.gen, sitedAt: new Date(cur.sitedAt).toISOString(), stageId: cur.stageId, cuts: cur.cut.length, fills: cur.cells.length, waived: Object.keys(cur.waived ?? {}).length, capAtSiting: cur.inwall?.rough?.skipped?.cap ?? null },
  open, due: TR.refreshDue(cur, { now }), planned: !argv.includes('--no-planned'),
  survey: { ok: s.ok, why: s.why, cuts: fresh?.cut.length ?? 0, fills: fresh?.cells.length ?? 0, cap: s.survey?.rough?.skipped?.cap ?? 0, census: s.survey?.rough?.census ?? null },
  added: m.added, skipped: m.skipped, addedByBand: added.reduce((o, a) => ((o[band(a)] = (o[band(a)] ?? 0) + 1), o), {}),
  addedNames: m.rec ? m.rec.cut.filter(c => c.added === now).reduce((o, c) => ((o[c.name] = (o[c.name] ?? 0) + 1), o), {}) : {},
  prot,
}
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify(out, null, 1))
