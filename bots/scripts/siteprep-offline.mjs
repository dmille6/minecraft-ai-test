#!/usr/bin/env node
// SITEPREP-01, OFFLINE: the requester's own siting (sinks.mjs siteSink) on COPIES of a town's region files and pool state, as
// sinks-offline.mjs runs it (the same reservations skills.mjs sinkGuardFor passes) -- then, for every kind that finds NO site, the
// keeper's choice (siteprep.mjs prepCandidates -> prepRank -> prepChoose: the pinned terrace grading, the never-worse walk from the
// town edge, the requester's own pinned acceptance on the after-world). Each prepared plot is applied to the read (an overlay: its
// cuts air, its fills cobblestone) and the requester's pinned siting is run on it, then appended to the record, and the next instance
// is asked for (`--count N` rounds). The POSITIVE CONTROL for every plot: the same pinned siting on the untouched ground refuses.
//
//   node scripts/siteprep-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--kinds tower,shrine] [--count N] [--avail JSON] [--torch] [--json]
//
// The sinks' records are the pool's own (instances so far). Nothing is written. The tidy's own refusals offline are the requester's
// guard projected to columns (the live keeper's avoid adds the paths' columns and the tidy's open work).
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { reservations, loadBlueprint } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import { townEdge, tidyOverlay } from '../src/tidy.mjs'
import * as S from '../src/sinks.mjs'
import * as P from '../src/siteprep.mjs'
import * as CH from '../src/copperhall.mjs'
import * as EX from '../src/expedition.mjs'
const LP = await import('../src/landplan.mjs').catch(() => null)

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: siteprep-offline.mjs <dump.json> <pool-state-dir> [--pool NAME] [--kinds tower,shrine] [--count N] [--avail JSON] [--torch] [--json]'); process.exit(2) }
const pool = opt('pool', path.basename(poolDir).replace(/^_pool-/, ''))
let read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const read0 = read
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } }).filter(p => p.rec)
const recOf = plot => all.find(p => p.plot === plot)?.rec ?? null
const land = recOf('land')
const others = all.filter(p => p.plot !== 'land' && p.plot !== 'tidy' && p.plot !== 'siteprep' && !S.isSinkPlot(p.plot)).map(p => p.rec)
const hall = recOf(CH.HALL_PLOT) ? [] : [CH.hallPadZone?.(plan, loadBlueprint(CH.HALL_BLUEPRINT))].filter(Boolean)
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const zig = others.find(r => r.plot === 'monument' && Array.isArray(r.box)) ?? null
const wall = others.find(r => r.plot === 'wall') ?? null
const avail = opt('avail') ? JSON.parse(opt('avail')) : {}
const torch = argv.includes('--torch')
const kinds = (opt('kinds') ?? 'tower,shrine').split(',')
const count = Number(opt('count') ?? 1)
const PP = { ...P.PREP, ...(opt('blend') ? { blend: Number(opt('blend')) } : {}), ...(opt('fillMax') ? { fillMax: Number(opt('fillMax')) } : {}), ...(opt('colMax') ? { colMax: Number(opt('colMax')) } : {}) }
const recs = Object.fromEntries(S.SINK_KINDS.map(k => [k, recOf(k)]))
const preps = []   // the plots prepared so far: their zones reserve them for every later siting
const guardFor = (withZ0, kind, except = null) => {
  const sinkZones = S.guardRecords(S.SINK_KINDS.map(k => recs[k]).filter(Boolean), kind).flatMap(r => r.zones ?? [])
  const prepZ = preps.filter(p => p.id !== except && !p.handed).map(p => p.zone)
  const zones = [...R.zones, ...recordZones([...others, ...(land && LP ? [LP.landReservation(land)] : [])]), ...hall, ...(EX.markerZones?.(markers) ?? []), ...sinkZones, ...prepZ]
  const res = reservations(plan, { zones, wells: R.wells, farm: R.farm, z0: withZ0 && zig ? { box: zig.box } : null })
  return (x, z, y0, y1) => res.column(x, z, y0, y1) ?? (zones.find(zb => { const b = zb.box; return x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] && y1 >= b[1] && y0 <= b[4] })?.why ?? null)
}
const ctxOf = (kind, n, except = null) => ({ kind, n, id: `${S.SINK_LETTER[kind]}${n}`, home, pool, avail, torch, guard: guardFor(true, kind, except), guardShrine: guardFor(false, kind, except), wall, zig, land, rec: recs[kind], stood: [] })
const from = townEdge(plan, home)
const out = { pool, home, from: from.length, rounds: [] }
let seq = 0
for (let round = 1; round <= count; round++) {
  for (const kind of kinds) {
    const n = S.instancesOf(recs[kind]).length + 1
    const t0 = Date.now()
    const r0 = S.siteSink(read, ctxOf(kind, n))
    const row = { round, kind, n, requester: { ok: r0.ok, why: r0.why, rejects: r0.rejects, ms: Date.now() - t0 } }
    out.rounds.push(row)
    let r = r0
    if (!r0.ok) {
      row.worthy = P.prepWorthy(r0.rejects ?? {})
      if (!row.worthy) continue
      const id = `SP${++seq}`
      const t1 = Date.now()
      const g = guardFor(kind !== 'shrine', kind)
      const cands = P.prepCandidates({ kind, home, pool, n, wall, zig, rec: recs[kind], avail, torch })
      const avoid = (x, z) => g(x, z, home.y - 14, home.y + 30)
      const gmR = P.groundMemo(read, home.y), wmR = P.wetMemo(read, home.y)
      // siteprep-03: the keeper's overlap zones (skills.mjs prepOverlapZones: every other record's, the sinks' included)
      const ovZones = recordZones([...others, ...S.SINK_KINDS.map(k => recs[k]).filter(Boolean)])
      const ranked = P.prepRank(cands, c => P.prepEstimate(c, { ground: gmR, wetCol: wmR, guard: g, hy: home.y, read, avoid, zones: ovZones }))
      const pinOf = c => ({ id, cx: c.cx, cz: c.cz, B: c.B, seed: c.seed, ...(c.slot ? { slot: c.slot, pair: c.pair } : {}) })
      const accept = (rd, c) => { const a = S.siteSink(rd, { ...ctxOf(kind, n, id), prep: pinOf(c) }); return { ok: a.ok, why: a.ok ? 'ok' : Object.keys(a.rejects ?? {})[0] ?? a.why } }
      let ch = { why: 'pending', cursor: 0 }, calls = 0
      const triedAll = {}, skipsAll = {}
      while (ch.why === 'pending' && calls < 40) {
        ch = P.prepChoose(read, ranked, { cursor: ch.cursor, home, from, avoid, accept, water: 'owner-1101', zones: ovZones, P: PP }); calls++
        for (const [k, v] of Object.entries(ch.tried ?? {})) triedAll[k] = (triedAll[k] ?? 0) + v
        for (const [k, v] of Object.entries(ch.skips ?? {})) skipsAll[k] = (skipsAll[k] ?? 0) + v
      }
      const estFail = {}
      for (const c of cands) { const e = P.prepEstimate(c, { ground: P.groundMemo(read, home.y), wetCol: P.wetMemo(read, home.y), guard: g, hy: home.y, read, avoid, zones: ovZones }); if (!e.ok) { const k = e.why.replace(/:.*/, ''); estFail[k] = (estFail[k] ?? 0) + 1 } }
      row.prep = { id, cands: cands.length, ranked: ranked.length, estFail, calls, ok: !!ch.ok, why: ch.why, top: ch.top, tried: triedAll, skips: skipsAll, ms: Date.now() - t1 }
      if (!ch.ok) continue
      const plot = P.plotOf(ch)
      Object.assign(row.prep, { tier: plot.tier, B: plot.B, at: [plot.cx, plot.L, plot.cz], earth: plot.earth, walkBack: ch.walk })
      row.prep.overlap = P.prepOverlapOf(P.plotFootprint(plot), ovZones); row.prep.overlapGradedBox = P.prepOverlapOf(plot.graded, ovZones)   // the keeper's re-check on the chosen plot: null
      const after = P.prepAfter(read, ch.grade.work)
      row.prep.control = S.siteSink(read, { ...ctxOf(kind, n, id), prep: pinOf(ch.cand) }).ok   // the positive control: false
      preps.push({ id, zone: P.prepZoneOf(plot.box, { id, kind }) })
      read = after
      r = S.siteSink(read, { ...ctxOf(kind, n, id), prep: pinOf(ch.cand) })
      row.prep.handed = r.ok
      preps.at(-1).handed = r.ok
      if (!r.ok) continue
    }
    recs[kind] = S.appendInstance(recs[kind], { kind, home, inst: r.inst, meta: { ...r.meta, sitedAt: 0 } })
    const blocks = {}
    for (const c of r.inst.cells) { const nm = (r.inst.palette[c.role] ?? ['?']).find(x => x !== '*solid'); blocks[nm] = (blocks[nm] ?? 0) + 1 }
    row.sited = { id: r.meta.id, prep: r.meta.prep ?? null, summary: r.meta.summary, cells: r.inst.cells.length, blocks }
  }
}
const tot = out.rounds.reduce((m, q) => ({ requests: m.requests + (q.prep ? 1 : 0), prepared: m.prepared + (q.prep?.ok ? 1 : 0), handed: m.handed + (q.prep?.handed ? 1 : 0), fill: m.fill + (q.prep?.ok ? q.prep.earth.fill + q.prep.earth.seal + q.prep.earth.dam : 0), cut: m.cut + (q.prep?.ok ? q.prep.earth.cut : 0), unlockedCells: m.unlockedCells + (q.sited?.prep ? q.sited.cells : 0), controlsRefused: m.controlsRefused + (q.prep?.ok && q.prep.control === false ? 1 : 0) }), { requests: 0, prepared: 0, handed: 0, fill: 0, cut: 0, unlockedCells: 0, controlsRefused: 0 })
out.totals = tot
void read0; void tidyOverlay
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify(out, null, 1))
