#!/usr/bin/env node
// DECORATOR-01, OFFLINE: the decorator's own nursery siting and border/pot batches (decorator.mjs siteNursery, siteDecor: the
// candidates, the seeded pattern, the proof) on COPIES of a town's region files and pool state, with the reservations skills.mjs
// decorReservedFor passes (the protected zones, the wells, the farm, the plan's cells and soft keepouts, the land plan's corridors and
// park, the markers). Prints the batches and an ASCII map of the town (--map R: the box home +- R; --png FILE: the same as a picture).
//
//   node scripts/decor-offline.mjs <dump.json> <pool-state-dir> [--plants N] [--pots N] [--count N] [--map R] [--png out.png] [--json]
//
// <dump.json> is scripts/host/townplan_blockdump.py over COPIES of the region files; the pool dir a COPY of /var/lib/mcai/_pool-<pool>.
// --count N sites N batches in turn, each one's cells reserved for the next (and its plants spent). Nothing is written but --png.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import { keepouts } from '../src/townplan.mjs'
import { cellGuard } from '../src/towndress.mjs'
import * as S from '../src/sinks.mjs'
import * as D from '../src/decorator.mjs'
import * as EX from '../src/expedition.mjs'
import { wallInteriors } from '../src/wall.mjs'
import { loadBlueprint } from '../src/buildsite.mjs'
const LP = await import('../src/landplan.mjs').catch(() => null)

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: decor-offline.mjs <dump.json> <pool-state-dir> [--plants N] [--pots N] [--count N] [--map R] [--png out.png] [--json]'); process.exit(2) }
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
const records = all.filter(p => p.plot !== 'land' && p.plot !== 'decor')
const mFile = path.join(poolDir, `expedition-${hk}.markers.jsonl`)
const markers = fs.existsSync(mFile) ? fs.readFileSync(mFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(m => m && !m.gone) : []
const zs = [...R.zones, ...recordZones(land && LP ? [LP.landReservation(land)] : []), ...(EX.markerZones?.(markers) ?? [])]
const ko = keepouts(plan)
const never = new Set((ko.neverCells ?? []).map(q => `${q[0]},${q[2]}`))
const wells = (R.wells ?? []).map(q => [q[0], q[2]])
const farm = new Set((R.farm ?? []).map(([x, z]) => `${x},${z}`))
const park = land?.park?.box ?? null
const reserved = (x, z) => {
  if (never.has(`${x},${z}`)) return 'plan_cell'
  if (ko.softAt(x, z)) return 'plan_soft'
  if (wells.some(([wx, wz]) => Math.max(Math.abs(wx - x), Math.abs(wz - z)) <= 3)) return 'well'
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (farm.has(`${x + dx},${z + dz}`)) return 'treefarm'
  if (park && x >= park[0] - 1 && x <= park[2] + 1 && z >= park[1] - 1 && z <= park[3] + 1) return 'park'
  const zb = zs.find(q => { const b = q?.box; return Array.isArray(b) && x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] })
  return zb ? String(zb.why ?? 'zone') : null
}
const wall = all.find(p => p.plot === 'wall')?.rec ?? null, ext = all.find(p => p.plot === 'wallext')?.rec ?? null
const boxes = wallInteriors(wall, ext)
const inside = (x, z) => boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])
let plants = Number(opt('plants') ?? 11)
let pots = Number(opt('pots') ?? 0)
const count = Number(opt('count') ?? 1)
const out = { home, records: records.map(r => r.plot), wallBoxes: boxes, nursery: null, sited: [], failed: [] }
// THE NURSERY (the reservations and every record's cells; the decor's own batches are sited after it, so their cells are in its guard later)
{
  const t0 = Date.now()
  const g = cellGuard(records.map(r => r.rec))
  const n = D.siteNursery(read, home, { guard: g, reserved })
  out.nursery = { ...n, ms: Date.now() - t0 }
}
let rec = out.nursery.ok ? D.withNursery(null, out.nursery.nursery, { home }) : null
for (let n = 1; n <= count; n++) {
  const t0 = Date.now()
  const seed = D.decorSeed('showcase', home, n)
  const doorOf = r => { let bp = null; try { bp = r.rec.blueprint ? loadBlueprint(r.rec.blueprint) : null } catch { bp = null } return D.doorwayOf(r.rec, bp) }
  const r = S.siteSink(read, { kind: 'decor', n, id: `D${n}`, home, seed, records, rec, plants, pots, reserved, inside, doorOf, stood: [] })
  const ms = Date.now() - t0
  if (!r.ok) { out.failed.push({ n, why: r.why, tried: r.tried, ms }); break }
  rec = S.appendInstance(rec, { kind: 'decor', home, inst: r.inst, meta: { ...r.meta, sitedAt: Date.now() } })
  plants -= r.meta.plants
  pots -= r.meta.pots.length
  out.sited.push({ id: r.meta.id, summary: r.meta.summary, inside: r.meta.inside, cells: r.inst.cells.map(c => ({ at: c.at, role: c.role })), pots: r.meta.pots, tried: r.tried, ms })
}
// ---- the map --------------------------------------------------------------------------------------------------------------------------------
const MR = Number(opt('map') ?? 0)
const PNG = opt('png')
if (MR > 0 || PNG) {
  const rad = MR || 40
  const cellAt = new Map()
  const mark = (at, ch, pri) => { const k = `${at[0]},${at[2]}`; const q = cellAt.get(k); if (!q || q.pri < pri) cellAt.set(k, { ch, pri }) }
  const plotCh = { paths: '=', wall: 'W', wallext: 'W', walldemo: 'W', dress: 'L', tidy: null, road: '=', yard: 'Y', treefarm: 'T', cropfarm: 'F', canefarm: 'F' }
  for (const { plot, rec: r } of records) {
    const ch = plot in plotCh ? plotCh[plot] : '#'
    if (!ch) continue
    for (const c of r.cells ?? []) if (Array.isArray(c?.at)) mark(c.at, plot === 'dress' && /light/.test(c.role) ? 'L' : ch, plot === 'paths' ? 2 : 3)
  }
  if (out.nursery.ok) {
    const nb = out.nursery.nursery.box
    for (let x = nb[0]; x <= nb[2]; x++) for (let z = nb[1]; z <= nb[3]; z++) if (x === nb[0] || x === nb[2] || z === nb[1] || z === nb[3]) mark([x, 0, z], ':', 1)
    mark(out.nursery.nursery.at, 'N', 9)
  }
  const FL = { poppy: 'r', dandelion: 'y', cornflower: 'b', azure_bluet: 'w', oxeye_daisy: 'w', allium: 'p', blue_orchid: 'b', lily_of_the_valley: 'w', red_tulip: 'r', orange_tulip: 'o', white_tulip: 'w', pink_tulip: 'p' }
  const held = ['poppy', 'dandelion']   // the taiga meal's flowers: the border alternates what the bag holds
  for (const s of out.sited) {
    let i = 0
    for (const c of s.cells) {
      if (/-pot$/.test(c.role)) { mark(c.at, 'o', 8); continue }
      const pal = rec.palette[c.role] ?? []
      const f = pal.find(n => held.includes(n)) ?? 'poppy'
      mark(c.at, FL[f] ?? '*', 8); i++
    }
  }
  const grid = []
  for (let z = home.z - rad; z <= home.z + rad; z++) {
    let line = ''
    for (let x = home.x - rad; x <= home.x + rad; x++) {
      const q = cellAt.get(`${x},${z}`)
      if (x === home.x && z === home.z) { line += '+'; continue }
      if (q) { line += q.ch; continue }
      // the ground: grass '.', leaves/trees '^', water '~', else ' '
      let ch = ' '
      for (let y = home.y + 12; y >= home.y - 12; y--) {
        const b = read(x, y, z)
        if (!b || b.name === 'air' || b.name === 'cave_air') continue
        const n = b.name.replace(/\[.*\]$/, '')
        ch = n === 'grass_block' ? '.' : /leaves|_log$/.test(n) ? '^' : /water|ice/.test(n) ? '~' : /flower|poppy|dandelion|tulip/.test(n) ? '*' : /short_grass|fern|tall_grass/.test(n) ? ',' : ' '
        if (/short_grass|fern|tall_grass|snow$/.test(n)) continue
        break
      }
      line += ch
    }
    grid.push(line)
  }
  out.map = { box: [home.x - rad, home.z - rad, home.x + rad, home.z + rad], north: 'up (-z)', legend: "+ home  # building  = path  W wall  L dress light  Y yard  T tree farm  F farm  r/y flowers (poppy/dandelion)  o pot  N nursery centre  : nursery reach  . grass  , short grass/fern  ^ trees  ~ water/ice", rows: grid }
  if (PNG) writePng(PNG, grid)
}
console.log(argv.includes('--json') ? JSON.stringify(out) : JSON.stringify({ ...out, map: undefined }, null, 1))
if (out.map && !argv.includes('--json')) { console.log(out.map.legend); console.log(out.map.rows.join('\n')) }

/** A tiny PNG of the ASCII grid (4 px a column, one colour a character): stdlib zlib only. */
function writePng (file, grid) {
  const C = { '+': [255, 255, 255], '#': [120, 72, 40], '=': [196, 170, 110], W: [90, 90, 96], L: [255, 220, 90], Y: [150, 150, 150], T: [40, 110, 40], F: [170, 140, 60],
    r: [220, 30, 40], y: [250, 220, 30], b: [60, 90, 220], w: [240, 240, 240], p: [200, 90, 200], o: [200, 100, 50], '*': [230, 60, 160], N: [255, 0, 255], ':': [200, 120, 230],
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
