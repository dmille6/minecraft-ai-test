#!/usr/bin/env node
// BRIDGES-01, OFFLINE PICTURES: a designed bridge at a measured crossing, BEFORE and AFTER, from the top and from the side, drawn from
// the bots' own design code (bridgedesign.mjs designSpan / chooseDesign / designPlan: the very cells the bot would place) over a
// surface survey of the world (the bridges-01 survey's column grid: each column's top y, block, water depth). Writes four PNGs and a
// 2 x 2 sheet. Nothing else is written.
//
//   node scripts/bridges-render.mjs <survey.json> <out-prefix> (--stand X,Y,Z --axis 1,0 | --mid X,Z --dir DX,DZ) [--style S] [--wood]
//        [--id SEED] [--species spruce]
// The survey JSON: { home: [hx, hz], R, W, names, y64 (base64 uint8: y + 64), id16 (base64 uint16 LE name index), depth (uint8) }.
import fs from 'node:fs'
import zlib from 'node:zlib'
import * as BD from '../src/bridgedesign.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const flag = k => argv.includes(`--${k}`)
const [surveyPath, outPrefix] = argv
if (!surveyPath || !outPrefix || !(opt('stand') || opt('mid'))) { console.error('usage: bridges-render.mjs <survey.json> <out-prefix> --stand X,Y,Z --axis AX,AZ [--style S] [--wood] [--id SEED]'); process.exit(2) }
const S = JSON.parse(fs.readFileSync(surveyPath, 'utf8'))
const [HX, HZ] = S.home, R = S.R, W = S.W
const ys = Buffer.from(S.y64, 'base64'), ids = Buffer.from(S.id16, 'base64'), dep = Buffer.from(S.depth, 'base64')
const col = (x, z) => {
  if (Math.abs(x - HX) > R || Math.abs(z - HZ) > R) return null
  const i = (z - (HZ - R)) * W + (x - (HX - R))
  const n = S.names[ids.readUInt16LE(2 * i)]
  return n === '?' ? null : { top: ys[i] - 64, name: n, depth: dep[i] }
}
const SOLIDLESS = /^(air)$/
/** A block reader over the surface survey: air above the top, the top block (water down to its depth), then ground. */
const read = (x, y, z) => {
  const c = col(x, z)
  if (!c) return null
  if (y > c.top) return { name: 'air', boundingBox: 'empty' }
  if (c.name === 'water') {
    if (y > c.top - c.depth) return { name: 'water', boundingBox: 'empty' }
    return { name: y === c.top - c.depth ? 'dirt' : 'stone', boundingBox: 'block' }
  }
  if (y === c.top) return { name: c.name, boundingBox: SOLIDLESS.test(c.name) ? 'empty' : 'block' }
  return { name: y >= c.top - 2 ? 'dirt' : 'stone', boundingBox: 'block' }
}

// the site: a stand and an axis, or (--mid X,Z --dir DX,DZ) a crossing cluster sited by the bots' own traffic siting (trafficSpan)
let span
if (opt('mid')) {
  const t = BD.trafficSpan(read, { mid: opt('mid').split(',').map(Number), dir: (opt('dir') ?? '1,0').split(',').map(Number) }, { r: Number(opt('r') ?? 12) })
  if (!t.ok) { console.error('no traffic span:', JSON.stringify(t)); process.exit(1) }
  // the first candidate a design fits (as the bot's siting does)
  span = t.spans.find(sp => BD.chooseDesign(sp, { id: `${sp.near.join(',')}:${sp.axis.join(',')}`, read, species: opt('species') ?? 'spruce', woodAvail: flag('wood') ? 1e9 : 0, avail: { stone_bricks: 1e9, deepslate_bricks: 1e9, cobbled_deepslate: 1e9, iron_ingot: 1e9, torch: 1e9, glass_pane: 1e9 } }).ok) ?? t.span
} else span = BD.designSpan(read, opt('stand').split(',').map(Number), (opt('axis') ?? '1,0').split(',').map(Number))
if (!span.ok) { console.error('no span:', JSON.stringify(span)); process.exit(1) }
const stand = span.near, axis = span.axis
const id = opt('id') ?? `${stand.join(',')}:${axis.join(',')}`
const species = opt('species') ?? 'spruce'
let design, plan
if (opt('style')) {
  design = { style: opt('style'), v: BD.variantOf(opt('style'), id, { species, woodOk: flag('wood') }), dv: BD.DESIGN_V }
  plan = BD.designPlan(span, design)
  // a forced style says whether it fits the ground (the bot would not build one that does not)
  if (plan.ok) console.log('fit', JSON.stringify(BD.designFits(read, plan.steps)))
} else {
  const c = BD.chooseDesign(span, { id, species, read, woodAvail: flag('wood') ? 1e9 : 0, avail: { stone_bricks: 1e9, deepslate_bricks: 1e9, cobbled_deepslate: 1e9, iron_ingot: 1e9, torch: 1e9, glass_pane: 1e9 } })
  if (!c.ok) { console.error('no design:', JSON.stringify(c)); process.exit(1) }
  design = c.design; plan = c.plan; console.log('tried', JSON.stringify(c.tried))
}
if (!plan.ok) { console.error('no plan:', JSON.stringify(plan).slice(0, 300)); process.exit(1) }
const steps = plan.steps
const bill = BD.designBill(steps)
console.log(JSON.stringify({ span: { near: span.near, far: span.far, w: span.w, wy: span.wy, nb: span.nb, fb: span.fb, islets: span.islets }, design: BD.designDetail(design), D: plan.D, blocks: steps.length, dropped: plan.dropped.length, bill, base: BD.designBase(bill) }))

// ---- colours and shapes ---------------------------------------------------------------------------------------------------------
const C = {
  stone_bricks: [128, 128, 126], deepslate_bricks: [74, 74, 80], cobbled_deepslate: [82, 82, 88], polished_deepslate: [66, 66, 72],
  water: [52, 92, 196], grass_block: [98, 152, 70], dirt: [128, 92, 62], sand: [216, 204, 150], stone: [120, 120, 120], gravel: [140, 134, 130],
  snow_block: [238, 240, 244], ice: [170, 205, 240], packed_ice: [150, 190, 235], podzol: [104, 74, 44], lantern: [255, 196, 70], glass_pane: [200, 226, 238],
  dirt_path: [178, 156, 100], clay: [160, 166, 178], mud: [70, 60, 55], coarse_dirt: [118, 86, 58], moss_block: [90, 120, 50],
}
const WOODC = { spruce: [[112, 82, 48], [74, 54, 34]], oak: [[166, 134, 82], [108, 84, 52]], birch: [[196, 178, 122], [214, 212, 200]], dark_oak: [[70, 46, 24], [58, 42, 28]] }
function colourOf (name) {
  const n = String(name).replace(/\[.*\]$/, '')
  if (C[n]) return C[n]
  const m = /^(spruce|oak|birch|dark_oak|jungle|acacia|mangrove|cherry)_(log|planks|stairs|slab|fence)$/.exec(n)
  if (m) { const wc = WOODC[m[1]] ?? WOODC.oak; return m[2] === 'log' ? wc[1] : wc[0] }
  if (/^stone_brick/.test(n)) return C.stone_bricks
  if (/^deepslate_brick/.test(n)) return C.deepslate_bricks
  if (/^cobbled_deepslate/.test(n)) return C.cobbled_deepslate
  if (/grass|fern|flower|leaves/.test(n)) return C.grass_block
  if (/ice/.test(n)) return C.ice
  return [130, 125, 115]
}
const shade = (c, f) => c.map(v => Math.max(0, Math.min(255, Math.round(v * f))))
// a canvas
function canvas (w, h, bg) { const px = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) { px[3 * i] = bg[0]; px[3 * i + 1] = bg[1]; px[3 * i + 2] = bg[2] } return { w, h, px } }
const set = (cv, x, y, c) => { if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return; const i = 3 * (y * cv.w + x); cv.px[i] = c[0]; cv.px[i + 1] = c[1]; cv.px[i + 2] = c[2] }
const rect = (cv, x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(cv, x, y, c) }
function png (cv, path) {
  const raw = Buffer.alloc((cv.w * 3 + 1) * cv.h)
  for (let y = 0; y < cv.h; y++) { raw[y * (cv.w * 3 + 1)] = 0; cv.px.copy(raw, y * (cv.w * 3 + 1) + 1, y * cv.w * 3, (y + 1) * cv.w * 3) }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : crc32(td)); return Buffer.concat([len, td, crc]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(cv.w, 0); ihdr.writeUInt32BE(cv.h, 4); ihdr[8] = 8; ihdr[9] = 2
  fs.writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}
function crc32 (b) { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c } return (crc ^ 0xffffffff) >>> 0 }
/** One block drawn into a B x B tile at (px, py) as seen from the side: full, stairs (by facing toward the viewer's right or left and
 *  half), slabs, walls/fences (posts), logs (bark lines), lanterns, glass. `right`: the facing that points to the picture's right. */
function tile (cv, px, py, B, name, st, right, mortar = true) {
  const n = String(name)
  const c = colourOf(n)
  const dark = shade(c, 0.78), lite = shade(c, 1.12)
  if (n === 'lantern') { rect(cv, px + B * 0.3 | 0, py + B * (st?.hanging ? 0.15 : 0.35) | 0, B * 0.4 | 0, B * 0.5 | 0, [255, 214, 90]); rect(cv, px + B * 0.4 | 0, py + (st?.hanging ? 0 : B * 0.25) | 0, B * 0.2 | 0, B * 0.15 | 0, [40, 40, 40]); return }
  if (n === 'glass_pane') { rect(cv, px + B * 0.4 | 0, py, B * 0.2 | 0, B, [205, 230, 240]); return }
  if (/_(wall|fence)$/.test(n)) {
    rect(cv, px + B * 0.3 | 0, py, B * 0.4 | 0, B, c)
    if (/_fence$/.test(n)) { rect(cv, px, py + B * 0.25 | 0, B, B * 0.15 | 0, c); rect(cv, px, py + B * 0.6 | 0, B, B * 0.15 | 0, c) } else rect(cv, px, py + B * 0.2 | 0, B, B * 0.65 | 0, dark)
    return
  }
  const full = () => {
    rect(cv, px, py, B, B, c)
    if (/_log$/.test(n)) { for (let k = 2; k < B; k += 4) rect(cv, px, py + k, B, 1, dark) }
    else if (/brick/.test(n) && mortar) { rect(cv, px, py + (B >> 1), B, 1, dark); rect(cv, px + (B >> 1), py, 1, B >> 1, dark); rect(cv, px + (B >> 2), py + (B >> 1), 1, B >> 1, dark) }
    else if (/_planks$/.test(n)) { rect(cv, px, py + (B >> 1), B, 1, dark) }
    rect(cv, px, py, B, 1, lite)
  }
  if (/_slab$/.test(n)) { const top = st?.type === 'top'; rect(cv, px, py + (top ? 0 : B >> 1), B, B >> 1, c); rect(cv, px, py + (top ? (B >> 1) - 1 : B - 1), B, 1, dark); return }
  if (/_stairs$/.test(n)) {
    const top = st?.half === 'top'
    const toRight = st?.facing === right
    const sideways = st?.facing && st.facing !== right && st.facing !== opposite(right)
    // the half slab part
    rect(cv, px, py + (top ? 0 : B >> 1), B, B >> 1, c)
    // the quarter: on the facing side (seen side on), or a full half when the stair faces toward or away from the viewer
    if (sideways) rect(cv, px, py + (top ? B >> 1 : 0), B, B >> 1, dark)
    else rect(cv, px + (toRight ? B >> 1 : 0), py + (top ? B >> 1 : 0), B >> 1, B >> 1, c)
    return
  }
  full()
}
const opposite = f => ({ north: 'south', south: 'north', east: 'west', west: 'east' })[f]

// ---- the views ---------------------------------------------------------------------------------------------------------------------
const F = BD.frameOf(span)
const byCell = new Map(steps.map(s => [s.cell.join(','), s]))
const u0 = -8, u1 = span.w + 7, v0 = -9, v1 = 9
const B = 14
const yLo = span.wy - 6, yHi = (plan.D ?? span.wy) + 8
// TOP: u to the right, v up
function top (after) {
  const cv = canvas((u1 - u0 + 1) * B, (v1 - v0 + 1) * B, [30, 30, 30])
  for (let u = u0; u <= u1; u++) for (let v = v0; v <= v1; v++) {
    const [x, , z] = F.at(u, v, 0)
    const px = (u - u0) * B, py = (v1 - v) * B
    let drawn = false
    if (after) {
      for (let y = yHi; y >= yLo; y--) {
        const s = byCell.get(`${x},${y},${z}`)
        if (!s) continue
        const c = colourOf(s.item)
        const f = 0.8 + 0.06 * (y - span.wy)
        if (s.item === 'lantern') { rect(cv, px, py, B, B, shade(colourOf(read(x, span.wy, z)?.name ?? 'water'), 0.9)); rect(cv, px + 4, py + 4, B - 8, B - 8, [255, 210, 90]) }
        else if (/_(wall|fence)$/.test(s.item)) { rect(cv, px, py, B, B, shade(c, f * 0.9)); rect(cv, px + 4, py + 4, B - 8, B - 8, shade(c, f * 1.2)) }
        else if (/_stairs$/.test(s.item) && s.st?.half !== 'top') {
          rect(cv, px, py, B, B, shade(c, f * 0.85))
          const d = s.st.facing, [ax, az] = span.axis, lx = -az, lz = ax
          const fv = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] }[d]
          const du = fv[0] * ax + fv[1] * az, dv = fv[0] * lx + fv[1] * lz
          if (du) rect(cv, px + (du > 0 ? B >> 1 : 0), py, B >> 1, B, shade(c, f * 1.1)); else rect(cv, px, py + (dv > 0 ? 0 : B >> 1), B, B >> 1, shade(c, f * 1.1))
        } else { rect(cv, px, py, B, B, shade(c, f)); if (/brick/.test(s.item)) { rect(cv, px, py + (B >> 1), B, 1, shade(c, f * 0.75)) } if (/_planks|_slab/.test(s.item)) rect(cv, px + (B >> 1), py, 1, B, shade(c, f * 0.8)) }
        drawn = true
        break
      }
    }
    if (!drawn) {
      const k = col(x, z)
      const c = k ? colourOf(k.name) : [0, 0, 0]
      const f = k ? (k.name === 'water' ? Math.max(0.55, 1 - 0.05 * k.depth) : 0.85 + 0.04 * (k.top - span.wy)) : 1
      rect(cv, px, py, B, B, shade(c, f))
    }
  }
  return cv
}
// SIDE: u to the right, y up, seen from the -v side (the nearest designed cell in each u, y; the centre line's ground and water)
function side (after) {
  const cv = canvas((u1 - u0 + 1) * B, (yHi - yLo + 1) * B, [176, 210, 236])
  for (let y = yLo; y <= yHi; y++) for (let u = u0; u <= u1; u++) {
    const px = (u - u0) * B, py = (yHi - y) * B
    for (let k = 0; k < B; k++) rect(cv, px, py + k, B, 1, [176 - (yHi - y) * 2, 210 - (yHi - y), 236])
    const [x, , z] = F.at(u, 0, y)
    const b = read(x, y, z)
    if (b && b.name !== 'air') {
      const c = colourOf(b.name)
      rect(cv, px, py, B, B, b.name === 'water' ? [60, 100, 200] : shade(c, 0.9))
    }
    if (!after) continue
    for (let v = v0; v <= v1; v++) {
      const s = byCell.get(F.at(u, v, y).join(','))
      if (!s) continue
      tile(cv, px, py, B, s.item, s.st, F.facing('+u'))
      break
    }
  }
  return cv
}
// END: v to the right, y up, seen from the near shore (looking along +u): the nearest designed cell in each v, y
function end () {
  const ev0 = -6, ev1 = 6
  const cv = canvas((ev1 - ev0 + 1) * B, (yHi - yLo + 1) * B, [176, 210, 236])
  for (let y = yLo; y <= yHi; y++) for (let v = ev0; v <= ev1; v++) {
    const px = (ev1 - v) * B, py = (yHi - y) * B
    for (let k = 0; k < B; k++) rect(cv, px, py + k, B, 1, [176 - (yHi - y) * 2, 210 - (yHi - y), 236])
    if (y <= span.wy) rect(cv, px, py, B, B, [60, 100, 200])
    for (let u = 0; u < span.w; u++) {
      const s = byCell.get(F.at(u, v, y).join(','))
      if (!s) continue
      // seen end on: the stair's facing across the line points left or right in this picture
      tile(cv, px, py, B, s.item, s.st, F.facing('-v'))
      break
    }
  }
  return cv
}
const sheet = (a, b, c, d) => {
  const w = Math.max(a.w + b.w, c.w + d.w) + 6, h = Math.max(a.h, b.h) + Math.max(c.h, d.h) + 6
  const cv = canvas(w, h, [250, 250, 250])
  const blit = (src, ox, oy) => { for (let y = 0; y < src.h; y++) src.px.copy(cv.px, 3 * ((oy + y) * cv.w + ox), 3 * y * src.w, 3 * (y + 1) * src.w) }
  blit(a, 0, 0); blit(b, a.w + 6, 0); blit(c, 0, Math.max(a.h, b.h) + 6); blit(d, c.w + 6, Math.max(a.h, b.h) + 6)
  return cv
}
const tb = top(false), ta = top(true), sb = side(false), sa = side(true)
png(tb, `${outPrefix}-top-before.png`); png(ta, `${outPrefix}-top-after.png`); png(sb, `${outPrefix}-side-before.png`); png(sa, `${outPrefix}-side-after.png`)
const ea = end()
png(ea, `${outPrefix}-end-after.png`)
const sh = sheet(tb, ta, sb, sa)
// the end view beside the sheet
const full = canvas(sh.w + ea.w + 6, Math.max(sh.h, ea.h), [250, 250, 250])
for (let y = 0; y < sh.h; y++) sh.px.copy(full.px, 3 * y * full.w, 3 * y * sh.w, 3 * (y + 1) * sh.w)
for (let y = 0; y < ea.h; y++) ea.px.copy(full.px, 3 * ((full.h - ea.h + y) * full.w + sh.w + 6), 3 * y * ea.w, 3 * (y + 1) * ea.w)
png(full, `${outPrefix}-sheet.png`)
