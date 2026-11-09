#!/usr/bin/env node
// COUNTRY-01 + UPKEEP-01, OFFLINE PICTURES: the countryside BEFORE and AFTER its bands are worked, and the upkeep's jobs, drawn from the
// bots' own code (country.mjs countryStages / countryPlantings / countryRecord over tidy.mjs siteStage `classic: false`; upkeep.mjs
// upkeepSurvey) over a READ-ONLY block dump of region-file copies (scripts' townplan_blockdump.py format: { box: [x0, z0, x1, z1],
// y: [y0, y1], palette, bits, cells: base64, x fastest, then z, then y }) and the town's record heads (a directory of
// project-<home>.<plot>.g<N>.json). Writes PNGs; nothing else is written.
//
//   node scripts/country-render.mjs <dump.json> <recsdir> <out-prefix> [--home X,Y,Z] [--zones JSON] [--zoom X0,Z0,X1,Z1]
//
// The AFTER world: every band's cuts and clears read air; its fills (earth, core, topsoil) read dirt -- a top fill grass (dirt beside
// grass greens in minutes: roughground-2's Paper, median 1.1 min); its stands (`access`, torn down after use) as before; its plantings
// placed (a sapling, a flower). The view is the GROUND's (leaves and trunks see-through). Shading is a hillshade from the north-west (a pillar casts light and shadow, a hole a dark pit), so
// rough ground reads rough and smoothed ground flat.
import fs from 'node:fs'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, recsDir, outPrefix] = argv
if (!dumpPath || !recsDir || !outPrefix) { console.error('usage: country-render.mjs <dump.json> <recsdir> <out-prefix> [--home X,Y,Z] [--zones JSON] [--zoom X0,Z0,X1,Z1]'); process.exit(2) }
const here = new URL('..', import.meta.url).pathname
const md = createRequire(here + 'package.json')('minecraft-data')('1.21.11')
const [TI, LP, SH, CO, UK] = await Promise.all(['tidy', 'landplan', 'shop', 'country', 'upkeep'].map(m => import(new URL(`../src/${m}.mjs`, import.meta.url).href)))

// ---- the dump as a read(x, y, z)
const j = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
const [x0, z0, x1, z1] = j.box, [y0, y1] = j.y, nx = x1 - x0 + 1, nz = z1 - z0 + 1
const buf = Buffer.from(j.cells, 'base64')
const idx = j.bits === 16 ? i => buf.readUInt16LE(i * 2) : i => buf[i]
const pal = j.palette.map(n => {
  const base = n.replace(/\[.*$/, '')
  if (base === '?') return undefined
  const b = md.blocksByName[base], lm = n.match(/layers=(\d+)/)
  return { name: n.includes('waterlogged') ? `${base}[waterlogged]` : base, boundingBox: b ? b.boundingBox : 'block', ...(lm ? { props: { layers: lm[1] } } : {}) }
})
const read0 = (x, y, z) => (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) ? null : (pal[idx(((y - y0) * nz + (z - z0)) * nx + (x - x0))] ?? null)

// ---- the records
const recs = {}
for (const f of fs.readdirSync(recsDir)) { const m = f.match(/^project-[-\d_]+\.([a-z0-9]+)\.g\d+\.json$/); if (m) recs[m[1]] = JSON.parse(fs.readFileSync(`${recsDir}/${f}`, 'utf8')) }
const home = opt('home') ? Object.fromEntries(opt('home').split(',').map(Number).map((v, i) => [['x', 'y', 'z'][i], v])) : { x: 0, y: 70, z: 0 }
const land = recs.land, wall = recs.wall, wallext = recs.wallext
const others = Object.entries(recs).filter(([k]) => !/^(tidy|land|siteprep|country|upkeep)$/.test(k)).map(([k, r]) => ({ ...r, plot: r.plot ?? k }))
const zonesR = SH.recordZones(others)
const avoid = (x, z) => { for (const zz of zonesR) { const b = zz.box; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return zz.why ?? 'project' } return null }
const ZB = opt('zones') ? JSON.parse(opt('zones')) : []
const zone = (x, y, z) => ZB.some(b => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5])
const zoneCol = (x, z) => ZB.some(b => x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5])
const avoidZ = (x, z) => avoid(x, z) ?? (zoneCol(x, z) ? 'zone' : null)
const cells = new Set(Object.values(recs).flatMap(r => [...(r.cells ?? []), ...(r.cut ?? []), ...(r.clear ?? [])].map(c => c.at.join(','))))
const boxes = TI.inwallBoxes(wall, home, wallext)
const inWall = (x, z) => boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])
const pathCols = new Set((recs.paths?.cells ?? []).map(c => `${c.at[0]},${c.at[2]}`))
const corridor = land ? LP.corridorAt(land) : () => null

// ---- the bands, as the keeper would site them one after another (each band's work joins the plan the next one keeps off)
const over = new Map()   // 'x,y,z' -> block (the after world)
const marks = new Map()  // 'x,z' -> 'cut' | 'fill' | 'sapling' | 'flower'
const census = []
const plan = new Set(cells)
for (const st of CO.countryStages()) {
  const s = await TI.siteStage(read0, { home, land, stage: st, avoid: avoidZ, cells: plan, terrace: { wall, wallext, records: others, climbs: [] }, lights: 0, classic: false })
  const earth = s.record ? TI.coreFills(s.record) : null
  const busy = new Set([...(earth?.cells ?? []), ...(earth?.cut ?? []), ...(earth?.clear ?? [])].map(q => `${q.at[0]},${q.at[2]}`))
  const p = CO.countryPlantings(read0, { home, band: st, inWall, busy, avoid: avoidZ, corridor, pathCols, cells: plan, seed: Number(land?.seed ?? 0) >>> 0 })
  const rec = CO.countryRecord(earth, p, { stage: st, home })
  for (const q of [...(rec?.cells ?? []), ...(rec?.cut ?? []), ...(rec?.clear ?? [])]) plan.add(q.at.join(','))
  for (const c of rec?.cut ?? []) { over.set(c.at.join(','), { name: 'air', boundingBox: 'empty' }); marks.set(`${c.at[0]},${c.at[2]}`, 'cut') }
  for (const c of rec?.clear ?? []) over.set(c.at.join(','), { name: 'air', boundingBox: 'empty' })
  for (const c of rec?.cells ?? []) {
    if (c.role === 'access') continue   // a stand: torn down after use
    if (c.plant) { over.set(c.at.join(','), { name: c.plant === 'grove' ? 'spruce_sapling' : 'poppy', boundingBox: 'empty' }); marks.set(`${c.at[0]},${c.at[2]}`, c.plant === 'grove' ? 'sapling' : 'flower'); continue }
    over.set(c.at.join(','), { name: 'dirt', boundingBox: 'block' })
    if (!marks.has(`${c.at[0]},${c.at[2]}`)) marks.set(`${c.at[0]},${c.at[2]}`, 'fill')
  }
  census.push({ id: st.id, fills: (rec?.cells ?? []).filter(c => !c.plant && c.role !== 'access').length, cuts: rec?.cut?.length ?? 0, clears: rec?.clear?.length ?? 0, stands: (rec?.cells ?? []).filter(c => c.role === 'access').length, ...p.census })
}
const read1 = (x, y, z) => over.get(`${x},${y},${z}`) ?? read0(x, y, z)
// a fill at the top of its column greens (dirt beside grass: roughground-2's Paper, median 1.1 min); a cut that leaves dirt open, too
for (const [k, b] of [...over]) {
  if (b.name !== 'dirt') continue
  const [x, y, z] = k.split(',').map(Number), up = read1(x, y + 1, z)
  if (up && /^(air|cave_air)$/.test(up.name)) over.set(k, { name: 'grass_block', boundingBox: 'block' })
}

// ---- the upkeep's jobs over the whole reach
const sv = UK.upkeepSurvey(read0, { home, cells, avoid: avoidZ, zone, U: { ...UK.UPKEEP, jobMax: 1e9 } })

// ---- drawing
const AIR = /^(air|cave_air|void_air)$/
const top = (rd, x, z) => {
  // the GROUND view: the canopy (leaves, and the logs of standing trees) is see-through, so the ground's pillars, holes and spoil show
  for (let y = Math.min(y1, home.y + 30); y >= y0; y--) { const b = rd(x, y, z); if (!b) continue; const n = b.name.replace(/\[.*$/, ''); if (AIR.test(n)) continue; if (/^(short_grass|fern|tall_grass|large_fern|snow)$|_leaves$|_log$|_wood$/.test(n)) continue; return { y, n } }
  return { y: y0, n: 'void' }
}
const BASE = n => (/water/.test(n) ? [64, 110, 200] : /ice/.test(n) ? [160, 200, 235] : n === 'grass_block' ? [96, 150, 70] : /^(dirt|coarse_dirt|rooted_dirt|dirt_path|farmland)$/.test(n) ? [140, 104, 70] : n === 'podzol' ? [110, 80, 50]
  : /sand/.test(n) ? [214, 200, 140] : n === 'snow' || n === 'snow_block' ? [235, 240, 245] : /_leaves$/.test(n) ? [50, 100, 50] : /_log$|_wood$/.test(n) ? [92, 66, 40] : /_sapling$/.test(n) ? [20, 170, 40]
  : /poppy|tulip|dandelion|cornflower|orchid|allium|bluet|daisy|lily|rose|lilac|peony/.test(n) ? [230, 60, 120] : /cobble|stone|andesite|diorite|granite|gravel|tuff|ore/.test(n) ? [128, 128, 128]
  : /planks|stairs|slab|fence|door|log/.test(n) ? [170, 130, 80] : /brick/.test(n) ? [160, 150, 140] : n === 'void' ? [0, 0, 0] : [180, 170, 160])
function shade (rd, X0, Z0, X1, Z1) {
  const W = X1 - X0 + 1, H = Z1 - Z0 + 1, T = new Array(W * H)
  for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) T[(z - Z0) * W + (x - X0)] = top(rd, x, z)
  const px = new Uint8Array(W * H * 3)
  for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) {
    const i = (z - Z0) * W + (x - X0), t = T[i]
    const nw = T[Math.max(0, z - Z0 - 1) * W + Math.max(0, x - X0 - 1)]
    const d = Math.max(-3, Math.min(3, t.y - nw.y))
    const k = 1 + d * 0.16 + (t.y - home.y) * 0.012
    const c = BASE(t.n)
    for (let q = 0; q < 3; q++) px[i * 3 + q] = Math.max(0, Math.min(255, Math.round(c[q] * k)))
  }
  return { W, H, px }
}
function overlay (img, X0, Z0, pts) {
  for (const [x, z, col] of pts) { if (x < X0 || z < Z0 || x - X0 >= img.W || z - Z0 >= img.H) continue; const i = (z - Z0) * img.W + (x - X0); for (let q = 0; q < 3; q++) img.px[i * 3 + q] = col[q] }
  return img
}
function scale (img, s) {
  const W = img.W * s, H = img.H * s, px = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = (Math.floor(y / s) * img.W + Math.floor(x / s)) * 3, b = (y * W + x) * 3; px[b] = img.px[a]; px[b + 1] = img.px[a + 1]; px[b + 2] = img.px[a + 2] }
  return { W, H, px }
}
function rings (img, X0, Z0, rs, col = [255, 255, 255]) {
  const pts = []
  for (const r of rs) for (let d = -r; d <= r; d += 2) pts.push([home.x + d, home.z - r, col], [home.x + d, home.z + r, col], [home.x - r, home.z + d, col], [home.x + r, home.z + d, col])
  return overlay(img, X0, Z0, pts)
}
function png (img, file) {
  const raw = Buffer.alloc((img.W * 3 + 1) * img.H)
  for (let y = 0; y < img.H; y++) { raw[y * (img.W * 3 + 1)] = 0; Buffer.from(img.px.buffer, img.px.byteOffset + y * img.W * 3, img.W * 3).copy(raw, y * (img.W * 3 + 1) + 1) }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(img.W, 0); ih.writeUInt32BE(img.H, 4); ih[8] = 8; ih[9] = 2
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}
function sheet (imgs, cols, gap = 6) {
  const W = imgs[0].W, H = imgs[0].H, rows = Math.ceil(imgs.length / cols)
  const out = { W: cols * W + (cols - 1) * gap, H: rows * H + (rows - 1) * gap }
  out.px = new Uint8Array(out.W * out.H * 3).fill(255)
  imgs.forEach((im, k) => { const ox = (k % cols) * (W + gap), oy = Math.floor(k / cols) * (H + gap); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let q = 0; q < 3; q++) out.px[((oy + y) * out.W + ox + x) * 3 + q] = im.px[(y * W + x) * 3 + q] })
  return out
}
const R = CO.COUNTRY.r
const X0 = home.x - R, Z0 = home.z - R, X1 = home.x + R, Z1 = home.z + R
const RINGS = CO.countryStages().map(s => s.rMax)
const before = rings(shade(read0, X0, Z0, X1, Z1), X0, Z0, RINGS)
const after = rings(shade(read1, X0, Z0, X1, Z1), X0, Z0, RINGS)
const COL = { cut: [230, 40, 40], fill: [40, 90, 230], sapling: [20, 200, 40], flower: [240, 60, 200] }
const diffBase = shade(read0, X0, Z0, X1, Z1)
for (let i = 0; i < diffBase.px.length; i += 3) { const g = Math.round((diffBase.px[i] + diffBase.px[i + 1] + diffBase.px[i + 2]) / 3 * 0.6 + 90); diffBase.px[i] = diffBase.px[i + 1] = diffBase.px[i + 2] = g }
const diff = rings(overlay(diffBase, X0, Z0, [...marks].map(([k, m]) => { const [x, z] = k.split(',').map(Number); return [x, z, COL[m]] })), X0, Z0, RINGS, [60, 60, 60])
const upBase = shade(read0, X0, Z0, X1, Z1)
for (let i = 0; i < upBase.px.length; i += 3) { const g = Math.round((upBase.px[i] + upBase.px[i + 1] + upBase.px[i + 2]) / 3 * 0.6 + 90); upBase.px[i] = upBase.px[i + 1] = upBase.px[i + 2] = g }
const upPts = []
for (const c of sv.clear) { const col = c.kind === 'stray' ? [230, 40, 40] : [240, 150, 20]; for (let d = -1; d <= 1; d++) upPts.push([c.at[0] + d, c.at[2], col], [c.at[0], c.at[2] + d, col]) }
for (const c of sv.cells) upPts.push([c.at[0], c.at[2], [20, 200, 40]])
const upk = rings(overlay(upBase, X0, Z0, upPts), X0, Z0, [UK.UPKEEP.r], [60, 60, 60])
const S = 3
png(scale(before, S), `${outPrefix}-before.png`)
png(scale(after, S), `${outPrefix}-after.png`)
png(scale(diff, S), `${outPrefix}-work.png`)
png(scale(upk, S), `${outPrefix}-upkeep.png`)
png(sheet([scale(before, 2), scale(after, 2), scale(diff, 2), scale(upk, 2)], 2), `${outPrefix}-sheet.png`)
if (opt('zoom')) {
  const [a, b, c, d] = opt('zoom').split(',').map(Number)
  const zb = rings(shade(read0, a, b, c, d), a, b, RINGS), za = rings(shade(read1, a, b, c, d), a, b, RINGS)
  png(sheet([scale(zb, 8), scale(za, 8)], 2, 12), `${outPrefix}-zoom.png`)
}
console.log(JSON.stringify({ bands: census, upkeep: sv.census, marks: Object.fromEntries(['cut', 'fill', 'sapling', 'flower'].map(m => [m, [...marks.values()].filter(v => v === m).length])) }, null, 1))
