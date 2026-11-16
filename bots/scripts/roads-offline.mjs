#!/usr/bin/env node
// ROADS-01, OFFLINE: the bots' own road siting (roads.mjs siteRoad2 through sinks.mjs siteSink: the routes from the traffic file, the
// router, the cells, the proof) on COPIES of a town's region files and pool state, with the reservations skills.mjs sinkGuardFor passes
// (the plan, the protected zones, wells, the farm, every record's zone, the markers). Instances are sited in rounds, each appended to the
// growing road record (as the bots publish it) and its cells laid into the world read before the next (the road behind is built).
//
//   node scripts/roads-offline.mjs <dump.json> <pool-state-dir> <roadtraffic.json> [--pool NAME] [--count N] [--avail JSON] [--out FILE]
//
// <dump.json> is scripts/host/townplan_blockdump.py over COPIES of the region files. Nothing is written but --out (the record).
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { reservations } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones, stoodRead } from '../src/shop.mjs'
import * as S from '../src/sinks.mjs'
import * as RD from '../src/roads.mjs'
const LP = await import('../src/landplan.mjs').catch(() => null)

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir, trafficPath] = argv
if (!dumpPath || !poolDir || !trafficPath) { console.error('usage: roads-offline.mjs <dump.json> <pool-state-dir> <roadtraffic.json> [--pool NAME] [--count N] [--avail JSON] [--out FILE]'); process.exit(2) }
const pool = opt('pool', path.basename(poolDir).replace(/^_?pool-/, ''))
const base = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const placed = new Map()
const read = (x, y, z) => placed.get(`${x},${y},${z}`) ?? base(x, y, z)
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
// a copied pool may hold only each record's newest generation (the chain's head check then fails): that generation, read as it is
const newest = plot => { const gs = files.map(f => new RegExp(`^project-${hk}\\.${plot}\\.g(\\d+)\\.json$`).exec(f)).filter(Boolean).sort((a, b) => Number(b[1]) - Number(a[1])); try { return gs.length ? JSON.parse(fs.readFileSync(path.join(poolDir, gs[0][0]), 'utf8')) : null } catch { return null } }
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: (h.ok ? h.head?.rec ?? null : null) ?? newest(plot) } }).filter(p => p.rec).map(p => ({ plot: p.plot, rec: { plot: p.plot, ...p.rec } }))
const recOf = plot => all.find(p => p.plot === plot)?.rec ?? null
const land = recOf('land')
const others = all.filter(p => p.plot !== 'land' && p.plot !== 'road').map(p => p.rec)
const walls = ['wall', 'wallext'].map(recOf).filter(Boolean)
const pathCols = new Set(all.filter(p => !['road', 'land', 'siteprep'].includes(p.plot)).flatMap(p => (p.rec.cells ?? []).filter(c => Array.isArray(c?.at)).map(c => `${c.at[0]},${c.at[2]}`)))
const wallCols = new Set(walls.flatMap(r => (r.cells ?? []).map(c => `${c.at[0]},${c.at[2]}`)))
const T = RD.trafficRoutes(JSON.parse(fs.readFileSync(trafficPath, 'utf8')), Date.parse(JSON.parse(fs.readFileSync(trafficPath, 'utf8')).at) + 1000)
if (!T.ok) { console.error('traffic:', T.why); process.exit(1) }
const boxes = [...walls.map(r => r.ring), T.ring, T.ext].filter(b => Array.isArray(b) && b.length === 4)
const ringFor = st => boxes.find(b => Math.max(b[0] - st[0], st[0] - b[2], b[1] - st[1], st[1] - b[3]) <= 2) ?? T.ring
const avail = opt('avail') ? JSON.parse(opt('avail')) : { stone_bricks: 518, cobbled_deepslate: 946, deepslate_bricks: 224, stone: 248, cobblestone: 1800 }
let rec = recOf('road')
const zig = others.find(r => r.plot === 'monument' && Array.isArray(r.box)) ?? null
const g0 = () => guard()
const guard = () => {
  const zones = [...R.zones, ...recordZones([...others, ...(land && LP ? [LP.landReservation(land)] : [])]).filter(z => !/^(land:road|project:paths)/.test(String(z?.why ?? '')))]
  const res = reservations(plan, { zones, wells: R.wells, farm: R.farm, z0: zig ? { box: zig.box } : null })
  return (x, z, y0, y1) => res.column(x, z, y0, y1) ?? (zones.find(zb => { const b = zb.box; return x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] && y1 >= b[1] && y0 <= b[4] })?.why ?? null)
}
if (process.env.DBG) { const rt = T.routes[+process.env.DBG]; const st = RD.routeStart(read, rt, { ring: ringFor(rt.start), guard: g0(), hy: home.y, landOk: (x, z) => !wallCols.has(`${x},${z}`) }); console.error("start", JSON.stringify(st)); if (st.ok) { const r = RD.routeRoad(read, { line: rt.line, start: st.start, guard: g0(), hy: home.y, forbid: (x, z) => boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) }); console.error("route", r.ok, r.why, r.pops, JSON.stringify(r.tally), JSON.stringify(r.nodes)) } process.exit(0) }
// the cells the pool's bots stood on in town (the shop's stood file: the town walk's seeds, as the bot's siting reads them)
const stood = (() => { try { return stoodRead(poolDir, `project-${hk}.shop`, home) } catch { return [] } })()
const count = Number(opt('count') ?? 8)
const out = { pool, home, stood: stood.length, routes: T.routes.map(r => ({ id: r.id, trips: r.trips, len: r.line.length })), sited: [], failed: [] }
const g = guard()
for (let i = 0; i < count; i++) {
  const n = S.instancesOf(rec).length + 1
  const id = `R${n}`
  const t0 = Date.now()
  const r = S.siteSink(read, { kind: 'road', n, id, home, pool, avail, guard: g, rec, stood, roads2: { routes: T.routes, ringFor, townBoxes: boxes, own: (x, z) => pathCols.has(`${x},${z}`), landOk: (x, z) => !wallCols.has(`${x},${z}`), lamp: true } })
  const ms = Date.now() - t0
  if (!r.ok) { out.failed.push({ n, why: r.why, tried: r.tried, ms }); break }
  rec = S.completeInstance(S.appendInstance(rec, { kind: 'road', home, inst: r.inst, meta: { ...r.meta, sitedAt: Date.now() } }))
  // the instance stands: its cells in the world, its clears gone
  for (const c of r.inst.clear) placed.set(c.at.join(','), { name: 'air', boundingBox: 'empty' })
  for (const c of r.inst.cells) { const name = (r.inst.palette[c.role] ?? ['cobblestone']).find(x => x !== '*solid'); placed.set(c.at.join(','), { name, boundingBox: /lantern|torch/.test(name) ? 'empty' : 'block', ...(c.ws ? { props: c.ws } : {}) }) }
  const counts = {}
  for (const c of r.inst.cells) { const nm = (r.inst.palette[c.role] ?? ['?']).find(x => x !== '*solid'); counts[nm] = (counts[nm] ?? 0) + 1 }
  out.sited.push({ id, route: r.meta.route, k: r.meta.k, summary: r.meta.summary, len: r.meta.len, cells: r.inst.cells.length, clears: r.inst.clear.length, slabs: r.meta.slabs, lamps: r.meta.lamps, ended: r.meta.ended ?? null, end: r.meta.end, blocks: counts, tried: r.tried, ms })
}
if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify({ home, rec }))
console.log(JSON.stringify(out, null, 1))
