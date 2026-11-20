#!/usr/bin/env node
// stepwell-render.mjs -- PICTURES OF THE STEP WELL AS A SAVED REGION HOLDS IT (stepwell-03show, owner's ask 11-20): two isometric views
// and a top-down of the tank's footprint and surroundings, from a READ-ONLY region copy and the record. SVG out (one file a view); the
// caller rasterises (macOS: qlmanage -t -s <px> -o <dir> <svg>). Marked: the record's box, the bridge cut that held the tank
// (--mark x,y,z), the other blocks floating over the pit, the felling's trees (record `trees`), its stand cells, the exit.
//
//   node scripts/stepwell-render.mjs <record.json> <region.mca> <out dir> [--mark x,y,z] [--title "..."] [--sub "..."]
import fs from 'node:fs'
import path from 'node:path'
import { loadRegion, reader } from './wellsite-replay.mjs'
import * as S from '../src/stepwell.mjs'

const args = process.argv.slice(2)
const [recPath, regionPath, outDir] = args
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'))
const read = reader(loadRegion(regionPath))
const plan = S.planOfRecord(rec)
const MARK = (opt('--mark') ?? '-58,70,-74').split(',').map(Number)
const TITLE = opt('--title') ?? 'The step well as saved'
const SUB = opt('--sub') ?? ''
fs.mkdirSync(outDir, { recursive: true })

const [bx0, bz0, bx1, bz1] = plan.box
const M = 8
const X0 = bx0 - M, X1 = bx1 + M, Z0 = bz0 - M, Z1 = bz1 + M
const Y0 = Number(opt('--ymin') ?? 54), Y1 = Number(opt('--ymax') ?? 78)
const k3 = (x, y, z) => `${x},${y},${z}`

// ---- the blocks: name families -> colour ------------------------------------------------------------------------------------
const nm = b => String(b?.name ?? 'air')
const PAL = [
  [/^water$|bubble_column/, '#3f76e4', 'water'],
  [/lava/, '#e05a00', 'lava'],
  [/_leaves$/, '#3f8a2e', 'leaves'],
  [/_(log|wood)$/, '#6b4a2b', 'logs'],
  [/^grass_block$/, '#6fa64a', 'grass'],
  [/^(dirt|coarse_dirt|rooted_dirt|podzol|dirt_path|farmland|mud)$/, '#8a5d3b', 'dirt'],
  [/^(sand|red_sand)$/, '#e2d59a', 'sand'],
  [/sandstone/, '#d6c58a', 'sandstone'],
  [/^gravel$/, '#8f8a86', 'gravel'],
  [/^(stone_bricks|mossy_stone_bricks|cracked_stone_bricks|chiseled_stone_bricks)$/, '#9d9d9d', 'stone bricks (built)'],
  [/^(cobblestone|mossy_cobblestone|cobbled_deepslate)$/, '#7c7c7c', 'cobblestone'],
  [/_wall$/, '#5f5f5f', 'wall posts'],
  [/torch|lantern/, '#ffd23f', 'torches'],
  [/_ore$/, '#b08a5a', 'ore'],
  [/^(stone|andesite|diorite|granite|tuff|deepslate|calcite)$/, '#a3a3a8', 'natural stone'],
  [/_planks$|_slab$|_stairs$|_fence/, '#a5814f', 'wood (placed)'],
  [/clay|terracotta/, '#9aa3b5', 'clay'],
]
const famOf = b => { const n = nm(b); for (const [re, c, f] of PAL) if (re.test(n)) return { c, f }; return { c: '#b8a07a', f: 'other' } }
const solid = b => !!b && (b.boundingBox === 'block' || /water|lava/.test(nm(b)))
const plantish = b => !!b && b.boundingBox === 'empty' && !/air|water|lava/.test(nm(b))

// the cells to draw (y window) and the marks
const cell = new Map()
for (let x = X0; x <= X1; x++) for (let z = Z0; z <= Z1; z++) for (let y = Y0; y <= Y1; y++) {
  const b = read(x, y, z)
  if (solid(b) || /torch|lantern/.test(nm(b))) cell.set(k3(x, y, z), b)
}
const isSolidAt = (x, y, z) => { if (y < Y0) return true; const b = cell.get(k3(x, y, z)); return !!b && b.boundingBox === 'block' }
// FLOATING over the pit: a solid above the court inside the box + 2 with air under it
const floating = new Set()
for (const [k, b] of cell) {
  const [x, y, z] = k.split(',').map(Number)
  if (y <= plan.g || b.boundingBox !== 'block' || /_(leaves|log|wood)$/.test(nm(b))) continue   // the trees' own overhangs are no mess
  if (x < bx0 - 2 || x > bx1 + 2 || z < bz0 - 2 || z > bz1 + 2) continue
  const u = read(x, y - 1, z)
  if (u && u.boundingBox === 'empty' && !/water|lava/.test(nm(u))) floating.add(k)
}
const markK = k3(...MARK)
const trees = (rec.trees ?? []).map(t => ({ col: t.col ?? t.at ?? null, name: t.name ?? '' })).filter(t => Array.isArray(t.col))
const treeCols = new Set(trees.map(t => `${t.col[0]},${t.col[t.col.length - 1]}`))
const stands = (rec.cells ?? []).filter(c => c.role === 'stand').map(c => c.at)
const exit = rec.exit
const logsListed = (rec.clear ?? []).filter(c => c.kind === 'tree').map(c => c.at)

const used = new Map()   // family -> colour, for the legend
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), bb = Math.round((n & 255) * f); return `rgb(${r},${g},${bb})` }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

// ---- an isometric view: rotation r (0: from the south-east, 2: from the north-west) ---------------------------------------------
function iso (r, file, viewName) {
  const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2
  const rot = (x, z) => { const a = x - cx, b = z - cz; return r === 0 ? [a, b] : r === 1 ? [b, -a] : r === 2 ? [-a, -b] : [-b, a] }
  const T = 13, C = Math.cos(Math.PI / 6), Sn = Math.sin(Math.PI / 6)
  const P = (u, v, y) => [(u - v) * C * T, (u + v) * Sn * T - (y - Y0) * T]
  // the neighbour in the screen's +u / +v directions, back in world terms
  const inv = (du, dv) => r === 0 ? [du, dv] : r === 1 ? [-dv, du] : r === 2 ? [-du, -dv] : [dv, -du]
  const [ux, uz] = inv(1, 0), [vx, vz] = inv(0, 1)
  const items = []
  for (const [k, b] of cell) {
    const [x, y, z] = k.split(',').map(Number)
    const [u, v] = rot(x, z)
    items.push({ x, y, z, u, v, b, k })
  }
  items.sort((a, b) => (a.u + a.v) - (b.u + b.v) || a.y - b.y || a.u - b.u)
  const polys = []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const poly = (pts, fill, stroke = 'rgba(0,0,0,0.18)', sw = 0.5) => {
    for (const [px, py] of pts) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py) }
    polys.push({ pts, fill, stroke, sw })
  }
  for (const it of items) {
    const { x, y, z, u, v, b, k } = it
    const torch = /torch|lantern/.test(nm(b))
    const fam = famOf(b); used.set(fam.f, fam.c)
    const wet = /water/.test(nm(b))
    const top = !isSolidAt(x, y + 1, z) || wet
    const sideU = !isSolidAt(x + ux, y, z + uz)
    const sideV = !isSolidAt(x + vx, y, z + vz)
    if (!top && !sideU && !sideV) continue
    const mark = k === markK, fl = floating.has(k)
    const stroke = mark ? '#ff0000' : fl ? '#ff00d4' : 'rgba(0,0,0,0.18)'
    const sw = mark ? 2.6 : fl ? 1.6 : 0.5
    const h = torch ? 0.6 : wet ? 0.88 : 1
    const A = P(u, v, y + h), B = P(u + 1, v, y + h), Cc = P(u + 1, v + 1, y + h), D = P(u, v + 1, y + h)
    const B0 = P(u + 1, v, y), C0 = P(u + 1, v + 1, y), D0 = P(u, v + 1, y)
    const base = mark ? '#ff3030' : fam.c
    if (torch) { const m = P(u + 0.5, v + 0.5, y + 0.7); poly([[m[0] - 2.5, m[1] - 6], [m[0] + 2.5, m[1] - 6], [m[0] + 2.5, m[1] + 4], [m[0] - 2.5, m[1] + 4]], '#ffd23f', '#7a5a00', 0.6); continue }
    if (sideU) poly([B, Cc, C0, B0], shade(base, 0.74), stroke, sw)
    if (sideV) poly([D, Cc, C0, D0], shade(base, 0.58), stroke, sw)
    if (top) poly([A, B, Cc, D], wet ? 'rgba(63,118,228,0.75)' : shade(base, 1), stroke, sw)
  }
  // overlays: the record's box at the court level, the mark's label, the exit
  const g = plan.g
  const boxPts = [[bx0, bz0], [bx1 + 1, bz0], [bx1 + 1, bz1 + 1], [bx0, bz1 + 1]].map(([x, z]) => { const [u, v] = rot(x, z); return P(u, v, g + 1) })
  const [mu, mv] = rot(MARK[0], MARK[2])
  const mp = P(mu + 0.5, mv + 0.5, MARK[1] + 1)
  const [eu, ev] = rot(exit[0], exit[2]); const ep = P(eu + 0.5, ev + 0.5, exit[1] + 1)
  const pad = 30, top = 110, legendH = 230
  const W0 = Math.ceil(maxX - minX + 2 * pad), H0 = Math.ceil(maxY - minY + top + legendH)
  const W = Math.max(W0, H0), H = W   // square: the rasteriser (qlmanage) makes square pictures
  const ox = pad - minX + (W - W0) / 2, oy = top - minY
  const tp = pts => pts.map(([a, b]) => `${(a + ox).toFixed(1)},${(b + oy).toFixed(1)}`).join(' ')
  const out = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
  out.push(`<rect width="100%" height="100%" fill="#dfe9f2"/>`)
  out.push(`<text x="20" y="30" font-family="Helvetica,Arial" font-size="18" fill="#222">${esc(TITLE)}</text>`)
  out.push(`<text x="20" y="54" font-family="Helvetica,Arial" font-size="12" fill="#444">${esc(SUB)}</text>`)
  out.push(`<text x="20" y="74" font-family="Helvetica,Arial" font-size="12" fill="#444">${esc(viewName)}; blocks y ${Y0}..${Y1} (terrain below y ${Y0} cut away), x ${X0}..${X1}, z ${Z0}..${Z1}</text>`)
  for (const p of polys) out.push(`<polygon points="${tp(p.pts)}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.sw}"/>`)
  out.push(`<polygon points="${tp(boxPts)}" fill="none" stroke="#0050c8" stroke-width="2" stroke-dasharray="7,5"/>`)
  out.push(`<line x1="${mp[0] + ox}" y1="${mp[1] + oy}" x2="${mp[0] + ox + 70}" y2="${mp[1] + oy - 60}" stroke="#ff0000" stroke-width="2"/>`)
  out.push(`<text x="${mp[0] + ox + 74}" y="${mp[1] + oy - 64}" font-family="Helvetica,Arial" font-size="14" font-weight="bold" fill="#c00000" stroke="#ffffff" stroke-width="3" paint-order="stroke">${MARK.join(',')}: the bridge dirt that held the tank</text>`)
  out.push(`<circle cx="${ep[0] + ox}" cy="${ep[1] + oy}" r="6" fill="none" stroke="#0050c8" stroke-width="2.5"/>`)
  out.push(`<text x="${ep[0] + ox + 9}" y="${ep[1] + oy + 4}" font-family="Helvetica,Arial" font-size="13" font-weight="bold" fill="#0050c8" stroke="#ffffff" stroke-width="3" paint-order="stroke">exit ${exit.join(',')}</text>`)
  legend(out, Math.ceil(maxY + oy) + 24, W)
  out.push('</svg>')
  fs.writeFileSync(path.join(outDir, file), out.join('\n'))
}

function legend (out, y0, W) {
  const items = [...used].sort((a, b) => a[0].localeCompare(b[0]))
  const special = [['#ff3030', 'the bridge dirt (red edge): the cut that held the tank'], ['#ffffff', 'magenta edge: other solid blocks with air under them above the rim, inside the box + 2 (bridge leftovers, hill blocks left over dug cells; trees not counted)'], ['none', 'blue dashes: the record\'s box, drawn at the rim (ground y 62)']]
  const colW = 230, perRow = Math.max(1, Math.floor((W - 40) / colW))
  items.forEach(([f, c], i) => {
    const x = 20 + (i % perRow) * colW, y = y0 + Math.floor(i / perRow) * 20
    out.push(`<rect x="${x}" y="${y}" width="13" height="13" fill="${c}" stroke="#333" stroke-width="0.5"/><text x="${x + 19}" y="${y + 11}" font-family="Helvetica,Arial" font-size="12" fill="#222">${esc(f)}</text>`)
  })
  const ys = y0 + (Math.ceil(items.length / perRow)) * 20 + 6
  special.forEach(([c, t], i) => {
    const x = 20, y = ys + i * 19
    if (i === 0) out.push(`<rect x="${x}" y="${y}" width="13" height="13" fill="${c}" stroke="#ff0000" stroke-width="2"/>`)
    else if (i === 1) out.push(`<rect x="${x}" y="${y}" width="13" height="13" fill="#8a5d3b" stroke="#ff00d4" stroke-width="2"/>`)
    else out.push(`<rect x="${x}" y="${y}" width="13" height="13" fill="none" stroke="#0050c8" stroke-width="2" stroke-dasharray="4,3"/>`)
    out.push(`<text x="${x + 19}" y="${y + 11}" font-family="Helvetica,Arial" font-size="12" fill="#222">${esc(t)}</text>`)
  })
}

// ---- the top-down: each column's top block (y window), shaded by height; the marks over it -------------------------------------
function topDown (file) {
  const T = 18, pad = 30, top = 110, legendH = 210
  const nx = X1 - X0 + 1, nz = Z1 - Z0 + 1
  const W0 = nx * T + 2 * pad + 60, H0 = nz * T + top + legendH
  const W = Math.max(W0, H0), H = W
  const out = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
  out.push(`<rect width="100%" height="100%" fill="#dfe9f2"/>`)
  out.push(`<text x="20" y="30" font-family="Helvetica,Arial" font-size="18" fill="#222">${esc(TITLE)} -- top-down</text>`)
  out.push(`<text x="20" y="54" font-family="Helvetica,Arial" font-size="12" fill="#444">${esc(SUB)}</text>`)
  out.push(`<text x="20" y="74" font-family="Helvetica,Arial" font-size="12" fill="#444">north up; each square = the highest block of its column at or below y ${Y1}, darker = lower (number = its y); the rim (ground) is y ${plan.g}; the tank is dug down in tiers inside the box</text>`)
  const sx = x => pad + (x - X0) * T, sz = z => top + (z - Z0) * T
  for (let x = X0; x <= X1; x++) for (let z = Z0; z <= Z1; z++) {
    let b = null, y = null
    for (let yy = Y1; yy >= 0; yy--) { const c = read(x, yy, z); if (solid(c)) { b = c; y = yy; break } }
    if (!b) continue
    const fam = famOf(b); used.set(fam.f, fam.c)
    const f = Math.max(0.35, Math.min(1.15, 1 - (plan.g + 1 - y) * 0.06))
    out.push(`<rect x="${sx(x)}" y="${sz(z)}" width="${T}" height="${T}" fill="${shade(fam.c, Math.min(1, f))}" stroke="rgba(0,0,0,0.12)" stroke-width="0.5"/>`)
    if ((x - X0) % 1 === 0) out.push(`<text x="${sx(x) + T / 2}" y="${sz(z) + T / 2 + 3}" text-anchor="middle" font-family="Helvetica,Arial" font-size="7" fill="${f < 0.7 ? '#eee' : '#222'}">${y}</text>`)
    const k = [...floating].find(q => { const [fx, , fz] = q.split(',').map(Number); return fx === x && fz === z })
    if (k) out.push(`<rect x="${sx(x) + 1.5}" y="${sz(z) + 1.5}" width="${T - 3}" height="${T - 3}" fill="none" stroke="${k === markK ? '#ff0000' : '#ff00d4'}" stroke-width="${k === markK ? 3 : 2}"/>`)
  }
  // the felling: listed logs' columns (all gone), its trees' columns, its stand cells
  const logCols = new Set(logsListed.map(a => `${a[0]},${a[2]}`))
  for (const c of logCols) { const [x, z] = c.split(',').map(Number); out.push(`<circle cx="${sx(x) + T / 2}" cy="${sz(z) + T / 2}" r="${T / 2 - 2}" fill="none" stroke="#1b7a1b" stroke-width="2"/>`) }
  for (const a of stands) out.push(`<rect x="${sx(a[0]) + 4}" y="${sz(a[2]) + 4}" width="${T - 8}" height="${T - 8}" fill="none" stroke="#ff9900" stroke-width="2"/>`)
  out.push(`<rect x="${sx(bx0)}" y="${sz(bz0)}" width="${(bx1 - bx0 + 1) * T}" height="${(bz1 - bz0 + 1) * T}" fill="none" stroke="#0050c8" stroke-width="2.5" stroke-dasharray="8,5"/>`)
  out.push(`<circle cx="${sx(exit[0]) + T / 2}" cy="${sz(exit[2]) + T / 2}" r="${T / 2 + 1}" fill="none" stroke="#0050c8" stroke-width="3"/>`)
  out.push(`<text x="${sx(exit[0]) + T + 3}" y="${sz(exit[2]) + T / 2 + 4}" font-family="Helvetica,Arial" font-size="11" fill="#0050c8">exit</text>`)
  // axes
  for (let x = X0; x <= X1; x += 5) out.push(`<text x="${sx(x) + T / 2}" y="${top - 6}" text-anchor="middle" font-family="Helvetica,Arial" font-size="10" fill="#333">${x}</text>`)
  for (let z = Z0; z <= Z1; z += 5) out.push(`<text x="${sx(X1 + 1) + 6}" y="${sz(z) + T / 2 + 4}" font-family="Helvetica,Arial" font-size="10" fill="#333">z ${z}</text>`)
  // legend
  const y0 = top + nz * T + 18
  const items = [...used].sort((a, b) => a[0].localeCompare(b[0]))
  const colW = 200, perRow = Math.max(1, Math.floor((W - 40) / colW))
  items.forEach(([f, c], i) => { const x = 20 + (i % perRow) * colW, y = y0 + Math.floor(i / perRow) * 20; out.push(`<rect x="${x}" y="${y}" width="13" height="13" fill="${c}" stroke="#333" stroke-width="0.5"/><text x="${x + 19}" y="${y + 11}" font-family="Helvetica,Arial" font-size="12" fill="#222">${esc(f)}</text>`) })
  const ys = y0 + Math.ceil(items.length / perRow) * 20 + 8
  const marks = [
    [`<rect x="20" y="${ys}" width="13" height="13" fill="none" stroke="#ff0000" stroke-width="3"/>`, `${MARK.join(',')}: the bridge dirt over the pit that held the tank (a listed cut of layer y ${MARK[1]})`],
    [`<rect x="20" y="${ys + 20}" width="13" height="13" fill="none" stroke="#ff00d4" stroke-width="2"/>`, `other solid blocks with air under them above the rim, inside the box + 2 (${floating.size - (floating.has(markK) ? 1 : 0)}: bridge leftovers, hill blocks left over dug cells)`],
    [`<circle cx="26.5" cy="${ys + 46.5}" r="6.5" fill="none" stroke="#1b7a1b" stroke-width="2"/>`, `the felling: columns of the record's ${logsListed.length} listed logs (${trees.length || (rec.trees ?? []).length} trees) -- all gone`],
    [`<rect x="22" y="${ys + 62}" width="10" height="10" fill="none" stroke="#ff9900" stroke-width="2"/>`, `the felling's ${stands.length} stand cells (obsolete: their trees are gone)`],
    [`<rect x="20" y="${ys + 80}" width="13" height="13" fill="none" stroke="#0050c8" stroke-width="2" stroke-dasharray="4,3"/>`, `the record's box ${bx0}..${bx1}, ${bz0}..${bz1} (W ${plan.W}, ${plan.T} tiers, rim y ${plan.g}); the circle is the exit`],
  ]
  marks.forEach(([shape, t], i) => { out.push(shape); out.push(`<text x="39" y="${ys + i * 20 + 11}" font-family="Helvetica,Arial" font-size="12" fill="#222">${esc(t)}</text>`) })
  out.push('</svg>')
  fs.writeFileSync(path.join(outDir, file), out.join('\n'))
}

iso(0, 'stepwell-iso-se.svg', 'view from the south-east (from town)')
iso(2, 'stepwell-iso-nw.svg', 'view from the north-west')
topDown('stepwell-top.svg')
console.log(JSON.stringify({ cells: cell.size, floating: floating.size, mark: nm(read(...MARK)), trees: (rec.trees ?? []).length, logs: logsListed.length, stands: stands.length }))
