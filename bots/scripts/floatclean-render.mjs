#!/usr/bin/env node
// floatclean-render.mjs -- floatclean-01show: BEFORE / AFTER PICTURES of the floating blocks the bots left, from READ-ONLY region
// copies (the stepwell-render.mjs approach: each column's top block in a y window, shaded by height, the cells marked). SVG out; the
// caller rasterises (macOS: qlmanage -t -s <px> -o <dir> <svg>).
//
//   node scripts/floatclean-render.mjs --region <dir> --list <floatclean.json> --out <file.svg> [--box x0,z0,x1,z1] [--ymax 78]
//        [--before <dir>] [--title "..."] [--sub "..."]
//
// Marks: a listed cell still standing (magenta), a listed cell gone (green; with --before: gone since the before copy), a listed
// cell standing but held now (orange: a torch on it, water beside it, a record's cell...). The top line counts the listed cells in
// the box: standing / gone.
import fs from 'node:fs'
import path from 'node:path'
import { loadRegion, reader } from './wellsite-replay.mjs'
import { floatVerdict, k3, sameBlock } from '../src/floatclean.mjs'

const args = process.argv.slice(2)
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const regionOf = dir => { const m = new Map(); for (const f of fs.readdirSync(dir).filter(n => /^r\.-?\d+\.-?\d+\.mca$/.test(n))) for (const [k, v] of loadRegion(path.join(dir, f))) m.set(k, v); return reader(m) }
const read = regionOf(opt('--region'))
const readB = opt('--before') ? regionOf(opt('--before')) : null
const list = JSON.parse(fs.readFileSync(opt('--list'), 'utf8'))
const [X0, Z0, X1, Z1] = (opt('--box') ?? '-110,-100,-30,-50').split(',').map(Number)
const YMAX = Number(opt('--ymax', 78))
const TITLE = opt('--title', 'Floating blocks the bots left')
const SUB = opt('--sub', '')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const nm = b => String(b?.name ?? 'air')
const PAL = [
  [/^water$|bubble_column/, '#3f76e4'], [/lava/, '#e05a00'], [/_leaves$/, '#3f8a2e'], [/_(log|wood)$/, '#6b4a2b'], [/^grass_block$/, '#6fa64a'],
  [/^(dirt|coarse_dirt|rooted_dirt|podzol|dirt_path|farmland|mud)$/, '#8a5d3b'], [/^(sand|red_sand)$/, '#e2d59a'], [/sandstone/, '#d6c58a'],
  [/^gravel$/, '#8f8a86'], [/stone_bricks/, '#9d9d9d'], [/^(cobblestone|mossy_cobblestone|cobbled_deepslate)$/, '#7c7c7c'], [/_wall$/, '#5f5f5f'],
  [/torch|lantern/, '#ffd23f'], [/^(stone|andesite|diorite|granite|tuff|deepslate|calcite)$/, '#a3a3a8'], [/_planks$|_slab$|_stairs$|_fence/, '#a5814f'],
]
const colOf = b => { const n = nm(b); for (const [re, c] of PAL) if (re.test(n)) return c; return '#b8a07a' }
const shade = (hex, f) => { const v = parseInt(hex.slice(1), 16); const ch = s => Math.round(((v >> s) & 255) * f); return `rgb(${ch(16)},${ch(8)},${ch(0)})` }
const solid = b => !!b && (b.boundingBox === 'block' || /water|lava/.test(nm(b)))
const inBox = j => j.at[0] >= X0 && j.at[0] <= X1 && j.at[2] >= Z0 && j.at[2] <= Z1 && j.at[1] <= YMAX
const jobs = (list.jobs ?? []).filter(inBox)
const listedK = new Set(jobs.map(j => k3(j.at)))
const stand = (rd, j) => { const b = rd(...j.at); return !!b && sameBlock(nm(b), j.name) }
const state = new Map()
let nStand = 0, nGone = 0, nHeld = 0
for (const j of jobs) {
  const k = k3(j.at)
  if (readB && !stand(readB, j)) continue   // gone before the before copy: not this run's
  if (!stand(read, j)) { state.set(k, 'gone'); nGone++; continue }
  const v = floatVerdict(j, read, { listed: q => listedK.has(q) && stand(read, { at: q.split(',').map(Number), name: jobs.find(x => k3(x.at) === q)?.name ?? '' }) })
  if (v === 'take' || v === 'above') { state.set(k, 'stand'); nStand++ } else { state.set(k, 'held'); nHeld++ }
}
// each column's top block at or below YMAX, and the column's marks (the highest listed cell decides)
const T = 14, pad = 30, top = 120, legendH = 120
const nx = X1 - X0 + 1, nz = Z1 - Z0 + 1
const W = nx * T + 2 * pad, H = nz * T + top + legendH
const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="100%" height="100%" fill="#dfe9f2"/>`]
out.push(`<text x="20" y="30" font-family="Helvetica,Arial" font-size="18" fill="#222">${esc(TITLE)}</text>`)
out.push(`<text x="20" y="54" font-family="Helvetica,Arial" font-size="13" fill="#333">${esc(SUB)}</text>`)
out.push(`<text x="20" y="76" font-family="Helvetica,Arial" font-size="13" fill="#333">${esc(`listed in this box: ${state.size}${readB ? ' (standing in the before copy)' : ''} -- still standing ${nStand}, held ${nHeld}, gone ${nGone}; north up, x ${X0}..${X1}, z ${Z0}..${Z1}; darker = lower; number = the top block's y`)}</text>`)
const sx = x => pad + (x - X0) * T, sz = z => top + (z - Z0) * T
const marks = new Map()
for (const [k, s] of state) { const [x, y, z] = k.split(',').map(Number); const c = `${x},${z}`; const m = marks.get(c); if (!m || y > m.y) marks.set(c, { y, s }) }
for (let x = X0; x <= X1; x++) for (let z = Z0; z <= Z1; z++) {
  let b = null, y = YMAX
  for (; y > YMAX - 40; y--) { b = read(x, y, z); if (solid(b)) break }
  const f = 0.45 + 0.55 * Math.max(0, Math.min(1, (y - (YMAX - 24)) / 24))
  out.push(`<rect x="${sx(x)}" y="${sz(z)}" width="${T}" height="${T}" fill="${b ? shade(colOf(b), f) : '#ccc'}" stroke="rgba(0,0,0,0.1)" stroke-width="0.5"/>`)
  if (b && T >= 14 && (x - X0) % 2 === 0 && (z - Z0) % 2 === 0) out.push(`<text x="${sx(x) + 1}" y="${sz(z) + 10}" font-family="Helvetica,Arial" font-size="7" fill="rgba(255,255,255,0.75)">${y}</text>`)
  const m = marks.get(`${x},${z}`)
  if (m) out.push(`<rect x="${sx(x) + 1.5}" y="${sz(z) + 1.5}" width="${T - 3}" height="${T - 3}" fill="none" stroke="${m.s === 'stand' ? '#ff00d4' : m.s === 'gone' ? '#00c853' : '#ff9900'}" stroke-width="2"/>`)
}
for (const a of list.areas ?? []) if (a.box) { const [a0, b0, a1, b1] = a.box; const x0 = Math.max(a0, X0), z0 = Math.max(b0, Z0), x1 = Math.min(a1, X1), z1 = Math.min(b1, Z1); if (x0 <= x1 && z0 <= z1) out.push(`<rect x="${sx(x0)}" y="${sz(z0)}" width="${(x1 - x0 + 1) * T}" height="${(z1 - z0 + 1) * T}" fill="none" stroke="#0050c8" stroke-width="2" stroke-dasharray="8,5"/><text x="${sx(x0) + 4}" y="${sz(z0) + 14}" font-family="Helvetica,Arial" font-size="12" fill="#0050c8">${esc(a.name)}</text>`) }
const ly = top + nz * T + 30
const leg = [['#ff00d4', 'a listed bot block, still floating'], ['#00c853', 'a listed bot block, gone (taken down)'], ['#ff9900', 'a listed bot block now held (something on it, water beside it, a record cell)']]
leg.forEach(([c, s], i) => out.push(`<rect x="20" y="${ly + i * 22}" width="13" height="13" fill="none" stroke="${c}" stroke-width="2.5"/><text x="40" y="${ly + i * 22 + 11}" font-family="Helvetica,Arial" font-size="12" fill="#222">${esc(s)}</text>`))
out.push(`<text x="20" y="${ly + 3 * 22 + 11}" font-family="Helvetica,Arial" font-size="12" fill="#222">dashed: the list's areas (worked first, in order)</text>`)
out.push('</svg>')
fs.writeFileSync(opt('--out'), out.join('\n'))
console.log(`_floatclean op=render box=${X0},${Z0},${X1},${Z1} listed=${state.size} standing=${nStand} held=${nHeld} gone=${nGone} out=${opt('--out')}`)
