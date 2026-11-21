#!/usr/bin/env node
// pillar-render.mjs -- pillars-01show: BEFORE / AFTER PICTURES of the lone pillars bots left outside the walls, from READ-ONLY region
// copies (floatclean-render.mjs's approach: each column's top block in a y window, shaded by height, the pillars marked). SVG out; the
// caller rasterises (macOS: qlmanage -t -s <px> -o <dir> <svg>).
//
//   node scripts/pillar-render.mjs --region <dir> --list <pillarclean.json> --out <file.svg> [--box x0,z0,x1,z1] [--ymax 90]
//        [--before <dir>] [--title "..."] [--sub "..."] [--tile 6]
//
// Marks (a listed pillar's column): standing (magenta: any listed block still the listed block), level (green: every listed block
// gone), held (orange: standing, but its top block is not take-able now -- a torch on it, water beside it). With --before only the
// pillars standing in the before copy are counted. The top line counts the box's listed pillars.
import fs from 'node:fs'
import path from 'node:path'
import { loadRegion, reader } from './wellsite-replay.mjs'
import { pillarVerdict, sameBlock } from '../src/pillarclean.mjs'

const args = process.argv.slice(2)
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const regionOf = dir => { const m = new Map(); for (const f of fs.readdirSync(dir).filter(n => /^r\.-?\d+\.-?\d+\.mca$/.test(n))) for (const [k, v] of loadRegion(path.join(dir, f))) m.set(k, v); return reader(m) }
const read = regionOf(opt('--region'))
const readB = opt('--before') ? regionOf(opt('--before')) : null
const list = JSON.parse(fs.readFileSync(opt('--list'), 'utf8'))
const [X0, Z0, X1, Z1] = (opt('--box') ?? '-160,-160,160,160').split(',').map(Number)
const YMAX = Number(opt('--ymax', 90))
const T = Number(opt('--tile', 6))
const TITLE = opt('--title', 'Lone pillars the bots left outside the walls')
const SUB = opt('--sub', '')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const nm = b => String(b?.name ?? 'air')
const PAL = [
  [/^water$|bubble_column/, '#3f76e4'], [/^(ice|packed_ice|blue_ice)$/, '#9ec3f5'], [/lava/, '#e05a00'], [/_leaves$/, '#3f8a2e'], [/_(log|wood)$/, '#6b4a2b'],
  [/^grass_block$/, '#6fa64a'], [/^(dirt|coarse_dirt|rooted_dirt|podzol|dirt_path|farmland|mud)$/, '#8a5d3b'], [/^(sand|red_sand)$/, '#e2d59a'], [/sandstone/, '#d6c58a'],
  [/^snow/, '#f4f7fb'], [/^gravel$/, '#8f8a86'], [/stone_bricks/, '#9d9d9d'], [/^(cobblestone|mossy_cobblestone|cobbled_deepslate)$/, '#7c7c7c'], [/_wall$/, '#5f5f5f'],
  [/^(stone|andesite|diorite|granite|tuff|deepslate|calcite)$/, '#a3a3a8'], [/_planks$|_slab$|_stairs$|_fence/, '#a5814f'],
]
const colOf = b => { const n = nm(b); for (const [re, c] of PAL) if (re.test(n)) return c; return '#b8a07a' }
const shade = (hex, f) => { const v = parseInt(hex.slice(1), 16); const ch = s => Math.round(((v >> s) & 255) * f); return `rgb(${ch(16)},${ch(8)},${ch(0)})` }
const solid = b => !!b && (b.boundingBox === 'block' || /water|lava/.test(nm(b)))
const ps = (list.pillars ?? []).filter(p => p.x >= X0 && p.x <= X1 && p.z >= Z0 && p.z <= Z1)
const standingIn = (rd, p) => p.take.filter(t => { const b = rd(t[0], t[1], t[2]); return !!b && sameBlock(nm(b), t[3]) })
const state = new Map()
let nStand = 0, nLevel = 0, nHeld = 0, nSea = 0
for (const p of ps) {
  if (readB && !standingIn(readB, p).length) continue
  const st = standingIn(read, p)
  if (!st.length) { state.set(`${p.x},${p.z}`, 'level'); nLevel++; if (p.sea) nSea++; continue }
  const top = st.sort((a, b) => b[1] - a[1])[0]
  const v = pillarVerdict({ at: top.slice(0, 3), name: top[3] }, read, { listed: () => false })
  if (v === 'take') { state.set(`${p.x},${p.z}`, 'stand'); nStand++ } else { state.set(`${p.x},${p.z}`, 'held'); nHeld++ }
}
const pad = 30, top = 110, legendH = 100
const nx = X1 - X0 + 1, nz = Z1 - Z0 + 1
const W = Math.max(nx * T + 2 * pad, nz * T + top + legendH, 860), H = W
const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="100%" height="100%" fill="#dfe9f2"/>`]
out.push(`<text x="20" y="30" font-family="Helvetica,Arial" font-size="18" fill="#222">${esc(TITLE)}</text>`)
out.push(`<text x="20" y="54" font-family="Helvetica,Arial" font-size="13" fill="#333">${esc(SUB)}</text>`)
out.push(`<text x="20" y="76" font-family="Helvetica,Arial" font-size="13" fill="#333">${esc(`listed pillars in this box: ${state.size}${readB ? ' (standing in the before copy)' : ''} -- standing ${nStand}, held ${nHeld}, level ${nLevel} (sea ${nSea}); north up, x ${X0}..${X1}, z ${Z0}..${Z1}; darker = lower`)}</text>`)
const sx = x => pad + (x - X0) * T, sz = z => top + (z - Z0) * T
for (let x = X0; x <= X1; x++) for (let z = Z0; z <= Z1; z++) {
  let b = null, y = YMAX
  for (; y > YMAX - 50; y--) { b = read(x, y, z); if (solid(b)) break }
  const f = 0.45 + 0.55 * Math.max(0, Math.min(1, (y - (YMAX - 30)) / 30))
  out.push(`<rect x="${sx(x)}" y="${sz(z)}" width="${T}" height="${T}" fill="${b ? shade(colOf(b), f) : '#ccc'}"/>`)
}
for (const [k, s] of state) { const [x, z] = k.split(',').map(Number); out.push(`<rect x="${sx(x) - 1.5}" y="${sz(z) - 1.5}" width="${T + 3}" height="${T + 3}" fill="none" stroke="${s === 'stand' ? '#ff00d4' : s === 'level' ? '#00c853' : '#ff9900'}" stroke-width="2"/>`) }
const ly = top + nz * T + 26
const leg = [['#ff00d4', 'a listed pillar (CoreProtect: bot-placed), still standing'], ['#00c853', 'a listed pillar taken down to the ground round it'], ['#ff9900', 'a listed pillar held now (something on it, water beside it)']]
leg.forEach(([c, s], i) => out.push(`<rect x="20" y="${ly + i * 22}" width="13" height="13" fill="none" stroke="${c}" stroke-width="2.5"/><text x="40" y="${ly + i * 22 + 11}" font-family="Helvetica,Arial" font-size="12" fill="#222">${esc(s)}</text>`))
out.push('</svg>')
fs.writeFileSync(opt('--out'), out.join('\n'))
console.log(`_pillar op=render box=${X0},${Z0},${X1},${Z1} listed=${state.size} standing=${nStand} held=${nHeld} level=${nLevel} sea_level=${nSea} out=${opt('--out')}`)
