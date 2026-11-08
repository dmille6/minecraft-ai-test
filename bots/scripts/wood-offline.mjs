#!/usr/bin/env node
// WOODWORKS (fences-01), OFFLINE: the wood sink's own siting (woodworks.mjs siteWood: the rings round the forest and the crop farm with
// their openings and gates, the rails beside the paths, the walk proof) on COPIES of a town's region files and pool state, with the
// reservations skills.mjs woodReservedFor passes (the decor's: the protected zones, the wells, the farm, the plan's cells and soft
// keepouts, the land plan's corridors, the markers). Prints the instances and an ASCII map (--map R; --png FILE: a picture).
//
//   node scripts/wood-offline.mjs <dump.json> <pool-state-dir> [--avail LOGS] [--species S] [--count N] [--map R] [--centre X,Z] [--png out.png] [--json]
//
// <dump.json> is scripts/host/townplan_blockdump.py over COPIES of the region files; the pool dir a COPY of /var/lib/mcai/_pool-<pool>.
// Nothing is written but --png.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import { keepouts } from '../src/townplan.mjs'
import * as S from '../src/sinks.mjs'
import * as W from '../src/woodworks.mjs'
import * as EX from '../src/expedition.mjs'
const LP = await import('../src/landplan.mjs').catch(() => null)

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: wood-offline.mjs <dump.json> <pool-state-dir> [--avail LOGS] [--species S] [--count N] [--map R] [--png out.png] [--json]'); process.exit(2) }
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].sort()
const all = plots.map(plot => { const h = recordHead(poolDir, `project-${hk}.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } }).filter(p => p.rec)
const land = all.find(p => p.plot === 'land')?.rec ?? null
const records = all.filter(p => p.plot !== 'land' && p.plot !== 'wood')
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const zs = [...R.zones, ...recordZones(land && LP ? [LP.landReservation(land)] : []), ...(EX.markerZones?.(markers) ?? [])]
const ko = keepouts(plan)
const never = new Set((ko.neverCells ?? []).map(q => `${q[0]},${q[2]}`))
const wells = (R.wells ?? []).map(q => [q[0], q[2]])
const farm = new Set((R.farm ?? []).map(([x, z]) => `${x},${z}`))
const reserved = (x, z) => {
  if (never.has(`${x},${z}`)) return 'plan_cell'
  if (ko.softAt(x, z)) return 'plan_soft'
  if (wells.some(([wx, wz]) => Math.max(Math.abs(wx - x), Math.abs(wz - z)) <= 3)) return 'well'
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (farm.has(`${x + dx},${z + dz}`)) return 'treefarm'
  const zb = zs.find(q => { const b = q?.box; return Array.isArray(b) && x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] })
  return zb ? String(zb.why ?? 'zone') : null
}
let avail = Number(opt('avail') ?? 59)
const species = opt('species') ?? 'spruce'
const count = Number(opt('count') ?? 3)
const out = { home, records: records.map(r => r.plot), avail, sited: [], failed: [] }
let rec = null
for (let n = 1; n <= count; n++) {
  const t0 = Date.now()
  const r = S.siteSink(read, { kind: 'wood', n, id: `W${n}`, home, records, rec, reserved, stood: [], wood: { avail, species } })
  const ms = Date.now() - t0
  if (!r.ok) { out.failed.push({ n, why: r.why, tried: r.tried, ms }); break }
  rec = S.appendInstance(rec, { kind: 'wood', home, inst: r.inst, meta: { ...r.meta, sitedAt: Date.now() } })
  avail -= r.meta.logs
  out.sited.push({ id: r.meta.id, summary: r.meta.summary, logs: r.meta.logs, gaps: r.meta.gaps, openings: r.meta.openings, dropped: r.meta.dropped, tried: r.tried, ms, cells: r.inst.cells.map(c => ({ at: c.at, role: c.role, ...(c.ws ? { ws: c.ws } : {}) })) })
}
const MR = Number(opt('map') ?? 0)
const PNG = opt('png')
if (MR > 0 || PNG) {
  const rad = MR || 40
  const [cx, cz] = (opt('centre') ?? `${home.x},${home.z}`).split(',').map(Number)
  const cellAt = new Map()
  const mark = (at, ch, pri) => { const k = `${at[0]},${at[2]}`; const q = cellAt.get(k); if (!q || q.pri < pri) cellAt.set(k, { ch, pri }) }
  const plotCh = { paths: '=', wall: 'W', wallext: 'W', walldemo: 'W', tidy: null, road: '=', yard: 'Y', cropfarm: 'F', forest: 'T', decor: 'd', dress: 'L' }
  for (const { plot, rec: r } of records) {
    const ch = plot in plotCh ? plotCh[plot] : '#'
    if (!ch) continue
    for (const c of r.cells ?? []) if (Array.isArray(c?.at)) mark(c.at, ch, plot === 'paths' ? 2 : 3)
  }
  for (const s of out.sited) {
    for (const o of s.openings ?? []) for (const [x, z] of o.cols) mark([x, 0, z], o.why === 'path' ? '=' : 'o', 7)
    for (const c of s.cells) mark(c.at, /-g$/.test(c.role) ? 'G' : 'f', 9)
  }
  const grid = []
  for (let z = cz - rad; z <= cz + rad; z++) {
    let line = ''
    for (let x = cx - rad; x <= cx + rad; x++) {
      const q = cellAt.get(`${x},${z}`)
      if (x === home.x && z === home.z) { line += '+'; continue }
      if (q) { line += q.ch; continue }
      let ch = ' '
      for (let y = home.y + 14; y >= home.y - 14; y--) {
        const b = read(x, y, z)
        if (!b || b.name === 'air' || b.name === 'cave_air') continue
        const nmn = b.name.replace(/\[.*\]$/, '')
        ch = nmn === 'grass_block' ? '.' : /leaves|_log$/.test(nmn) ? '^' : /water|ice/.test(nmn) ? '~' : /short_grass|fern|tall_grass/.test(nmn) ? ',' : ' '
        if (/short_grass|fern|tall_grass|snow$/.test(nmn)) continue
        break
      }
      line += ch
    }
    grid.push(line)
  }
  out.map = { box: [cx - rad, cz - rad, cx + rad, cz + rad], north: 'up (-z)', legend: '+ home  # building  = path  W wall  Y yard  T forest  F farm  d decor  f fence  G gate  o opening  . grass  ^ trees  ~ water', rows: grid }
  if (PNG) writePng(PNG, grid)
}
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify({ ...out, map: undefined, sited: out.sited.map(s => ({ ...s, cells: s.cells.length })) }, null, 1))
if (out.map && !argv.includes('--json')) { console.log(out.map.legend); console.log(out.map.rows.join('\n')) }

/** A tiny PNG of the ASCII grid (4 px a column, one colour a character): stdlib zlib only. */
function writePng (file, grid) {
  const C = { '+': [255, 255, 255], '#': [120, 72, 40], '=': [196, 170, 110], W: [90, 90, 96], L: [255, 220, 90], Y: [150, 150, 150], T: [40, 110, 40], F: [170, 140, 60],
    r: [220, 30, 40], y: [250, 220, 30], g: [20, 200, 120], h: [10, 90, 30], P: [255, 160, 0], f: [139, 90, 43], G: [255, 120, 20], o: [250, 250, 160], d: [230, 60, 160], b: [60, 90, 220], w: [240, 240, 240], p: [200, 90, 200], o: [200, 100, 50], '*': [230, 60, 160], N: [255, 0, 255], ':': [200, 120, 230],
    '.': [96, 160, 72], ',': [80, 140, 60], '^': [30, 80, 40], '~': [120, 170, 220], ' ': [60, 60, 60] }
  const S = 6, H = grid.length * S, W = grid[0].length * S
  const raw = Buffer.alloc((W * 3 + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0
    const row = grid[Math.floor(y / S)]
    for (let x = 0; x < W; x++) { const c = C[row[Math.floor(x / S)]] ?? [0, 0, 0]; const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2] }
  }
  const crc = buf => { let c, crcT = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0 } let r = 0xffffffff; for (const b of buf) r = crcT[(r ^ b) & 0xff] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0 }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2; ih[10] = 0; ih[11] = 0; ih[12] = 0
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}
