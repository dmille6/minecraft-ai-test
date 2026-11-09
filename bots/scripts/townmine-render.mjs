#!/usr/bin/env node
// TOWNMINE-01 PICTURES: the town mine drawn from the bots' OWN plan (shaftgeom.mjs planStair with the extension, townmine.mjs galleries)
// over a block dump of the real world round the stair (a region-file copy read by a dump script; never the live files).
//   node scripts/townmine-render.mjs <dump.json> <record.json> <outdir> [prefix]
// dump.json  { box: [x0,y0,z0,x1,y1,z1], rows: { y: [ z-row strings of block codes, x0..x1 ] } }  codes: a air, s stone, d deepslate,
//            L lava, W water, i iron ore, c coal ore, D diamond ore, o other ore, b bedrock, g gravel/sand, r dirt, v plants, t torch, x other
// record.json  the town stair record (its site, K, landings); the mine's extension is planned here (G.mineExt) whether or not it is sited.
// Writes <prefix>side-before.png, <prefix>side-after.png, <prefix>iron-before.png, <prefix>iron-after.png, <prefix>hall-before.png,
// <prefix>hall-after.png and <prefix>sheet.png (all of them, labelled by position), plus <prefix>survey.json (what the plan's cells meet).
import fs from 'node:fs'
import zlib from 'node:zlib'
import * as G from '../src/shaftgeom.mjs'
import * as M from '../src/townmine.mjs'

const [DUMP, RECF, OUT, PREFIX = ''] = process.argv.slice(2)
if (!DUMP || !RECF || !OUT) throw new Error('usage: townmine-render.mjs <dump.json> <record.json> <outdir> [prefix]')
const dump = JSON.parse(fs.readFileSync(DUMP, 'utf8'))
const rec0 = JSON.parse(fs.readFileSync(RECF, 'utf8'))
const [X0, Y0, Z0, X1, Y1, Z1] = dump.box
const at = (x, y, z) => { const r = dump.rows[y]; if (!r || x < X0 || x > X1 || z < Z0 || z > Z1) return '?'; return r[z - Z0][x - X0] }
const rec = M.withMine(rec0, G.mineExt(rec0.site.g))
const plan = G.planOf(rec)
const before = G.planOf(rec0)
const gal = { iron: M.galleryOf(plan, 'iron'), diamond: M.galleryOf(plan, 'diamond') }

// ---- colours ----
const C = {
  a: [24, 24, 30], s: [128, 128, 128], d: [80, 80, 88], L: [255, 120, 0], W: [40, 90, 220], i: [216, 175, 147], c: [30, 30, 30], D: [80, 230, 230],
  o: [200, 160, 60], b: [20, 20, 20], g: [170, 160, 130], r: [121, 85, 58], v: [70, 140, 50], t: [255, 220, 80], x: [150, 110, 160], '?': [255, 255, 255],
  sky: [180, 210, 240], stairAir: [235, 215, 160], tread: [150, 100, 60], lining: [110, 110, 120], bay: [250, 235, 120], hall: [255, 245, 190],
  fixture: [160, 82, 45], torch: [255, 60, 40], gallery: [120, 220, 200], galleryBranch: [90, 180, 170], ground: [95, 160, 70],
}
const role = new Map()
const put = (c, r) => role.set(c.join(','), r)
const roomsAir = new Map()
for (const r of plan.rooms) for (const col of r.cols) for (const c of col.air) roomsAir.set(c.join(','), r.kind)
function marks (p, withExtras) {
  role.clear()
  for (const c of p.cells) {
    const k = c.at.join(',')
    if (c.role === 'air') role.set(k, roomsAir.get(k) ?? 'stairAir')
    else if (c.role === 'tread') role.set(k, 'tread')
    else if (c.role === 'fixture') role.set(k, 'fixture')
  }
  if (withExtras) {
    for (const lv of ['iron', 'diamond']) for (const s of gal[lv]?.slots ?? []) for (const c of s.cells) { put(c.feet, s.id === 0 ? 'gallery' : 'galleryBranch'); put(c.head, s.id === 0 ? 'gallery' : 'galleryBranch') }
    for (const t of M.torchPlan(p)) put(t.at, 'torch')
  }
}
// ---- the PNG ----
function png (w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, c = px[y * w + x]; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2] } }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]) }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const S = 5   // pixels per block
function canvas (W, H) { return { W, H, px: Array.from({ length: W * H }, () => [255, 255, 255]) } }
function cell (cv, cx, cy, col, scale = S) { for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const x = cx * scale + dx, y = cy * scale + dy; if (x >= 0 && y >= 0 && x < cv.W && y < cv.H) cv.px[y * cv.W + x] = col } }
const PRI = ['torch', 'fixture', 'hall', 'bay', 'stairAir', 'tread', 'gallery', 'galleryBranch']
// SIDE: looking along the stair's away axis' perpendicular -- x horizontal, y vertical, the z range of the mine collapsed (mine cells
// win over the ground, liquids and ores over rock, cave air over rock)
function side (withExtras, zr) {
  marks(withExtras ? plan : before, withExtras)
  const cv = canvas((X1 - X0 + 1) * S, (Y1 - Y0 + 1) * S)
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    let best = null, bp = 99, ground = null
    for (let z = zr[0]; z <= zr[1]; z++) {
      const r = role.get(`${x},${y},${z}`)
      if (r && PRI.indexOf(r) < bp) { bp = PRI.indexOf(r); best = r }
      const b = at(x, y, z)
      const gp = { L: 0, W: 1, D: 2, i: 3, c: 4, o: 5, a: 6 }[b] ?? 9
      if (ground == null || gp < ({ L: 0, W: 1, D: 2, i: 3, c: 4, o: 5, a: 6 }[ground] ?? 9)) ground = b
    }
    const col = best ? C[best] : (ground === 'a' && y > rec.site.g ? C.sky : C[ground] ?? C['?'])
    cell(cv, x - X0, Y1 - y, col)
  }
  return cv
}
// TOP: one level (feet y), x horizontal, z vertical
function top (y, withExtras) {
  marks(withExtras ? plan : before, withExtras)
  const cv = canvas((X1 - X0 + 1) * S, (Z1 - Z0 + 1) * S)
  for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) {
    let r = null
    for (const yy of [y, y + 1]) { const q = role.get(`${x},${yy},${z}`); if (q && (!r || PRI.indexOf(q) < PRI.indexOf(r))) r = q }
    const b = at(x, y, z), b2 = at(x, y + 1, z)
    const g = ['L', 'W'].includes(b2) ? b2 : b
    cell(cv, x - X0, z - Z0, r ? C[r] : (C[g] ?? C['?']))
  }
  return cv
}
fs.mkdirSync(OUT, { recursive: true })
const zr = [Math.min(...plan.cells.map(c => c.at[2])) - 2, Math.max(...plan.cells.map(c => c.at[2])) + 2]
const views = {
  'side-before': side(false, zr), 'side-after': side(true, zr),
  'iron-before': top(16, false), 'iron-after': top(16, true),
  'hall-before': top(G.MINE_BOTTOM_FEET, false), 'hall-after': top(G.MINE_BOTTOM_FEET, true),
}
for (const [k, cv] of Object.entries(views)) fs.writeFileSync(`${OUT}/${PREFIX}${k}.png`, png(cv.W, cv.H, cv.px))
// the sheet: the two sides, then the four tops in a column pair
{
  const gap = 10
  const sides = [views['side-before'], views['side-after']], tops = [views['iron-before'], views['iron-after'], views['hall-before'], views['hall-after']]
  const W = sides[0].W * 2 + tops[0].W * 2 + gap * 4, H = Math.max(sides[0].H, tops[0].H * 2 + gap)
  const sh = canvas(W, H)
  const blit = (cv, ox, oy) => { for (let y = 0; y < cv.H; y++) for (let x = 0; x < cv.W; x++) sh.px[(oy + y) * W + ox + x] = cv.px[y * cv.W + x] }
  blit(sides[0], 0, 0); blit(sides[1], sides[0].W + gap, 0)
  const tx = sides[0].W * 2 + gap * 2
  blit(tops[0], tx, 0); blit(tops[1], tx + tops[0].W + gap, 0); blit(tops[2], tx, tops[0].H + gap); blit(tops[3], tx + tops[0].W + gap, tops[0].H + gap)
  fs.writeFileSync(`${OUT}/${PREFIX}sheet.png`, png(W, H, sh.px))
}
// ---- the survey: what the plan's NEW cells meet in this world ----
const oldKeys = new Set(before.cells.map(c => c.at.join(',')))
const sv = { newCells: 0, byRole: {}, liquidInAir: 0, liquidBeside: 0, caveAirInAir: 0, ores: {}, galleries: {} }
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
for (const c of plan.cells) {
  const k = c.at.join(',')
  if (oldKeys.has(k)) continue
  sv.newCells++
  const b = at(...c.at)
  sv.byRole[c.role] = (sv.byRole[c.role] ?? 0) + 1
  if (c.role === 'air' && ['L', 'W'].includes(b)) sv.liquidInAir++
  if (c.role === 'air' && b === 'a') sv.caveAirInAir++
  if (c.role === 'air' && N6.some(([dx, dy, dz]) => ['L', 'W'].includes(at(c.at[0] + dx, c.at[1] + dy, c.at[2] + dz)))) sv.liquidBeside++
  if (['i', 'c', 'D', 'o'].includes(b)) sv.ores[b] = (sv.ores[b] ?? 0) + 1
}
for (const lv of ['iron', 'diamond']) {
  const g = gal[lv]; const o = { cells: 0, ores: {}, liquid: 0, cave: 0 }
  for (const s of g?.slots ?? []) for (const c of s.cells) for (const q of [c.feet, c.head]) {
    o.cells++
    const b = at(...q)
    if (['L', 'W'].includes(b)) o.liquid++
    if (b === 'a') o.cave++
    for (const [dx, dy, dz] of [[0, 0, 0], ...N6]) { const n = at(q[0] + dx, q[1] + dy, q[2] + dz); if (['i', 'c', 'D', 'o'].includes(n)) o.ores[n] = (o.ores[n] ?? 0) + 1 }
  }
  sv.galleries[lv] = o
}
sv.K = plan.K; sv.rooms = plan.rooms.map(r => `${r.kind}@${r.feet}`)
fs.writeFileSync(`${OUT}/${PREFIX}survey.json`, JSON.stringify(sv, null, 1))
console.log(JSON.stringify(sv))
