#!/usr/bin/env node
// roadsite-render.mjs -- roadsite-01show: BEFORE / AFTER PICTURES of a road the bots sited and built, from READ-ONLY region copies (the
// stepwell-render.mjs / floatclean-render.mjs approach: each column's top block in a y window, shaded by height, the cells marked). SVG
// out; the caller rasterises (macOS: qlmanage -t -s <px> -o <dir> <svg>).
//
//   node scripts/roadsite-render.mjs --region <dir> --rec <road record .json | roads-offline --out .json> --ids R5,R6 --out <file.svg>
//        [--pool <pool copy dir>] [--traffic <roadtraffic.json>] [--box x0,z0,x1,z1] [--ymax 80] [--title "..."] [--sub "..."]
//
// Marks: a road surface cell (tread, kerb, slab) built -- the region holds its block (buildrun.mjs cellDone) -- (green) or not yet
// (magenta); a lamp's lantern built (yellow disc) or not (yellow ring); a paved column the road SHARES with the paths (blue dot) or a
// grading record (cyan dot) (roads.mjs roadShares over the pool's records); the traffic lines (white dashes); the protected zones and
// other records' zones (red dashes).
import fs from 'node:fs'
import path from 'node:path'
import { loadRegion, reader } from './wellsite-replay.mjs'
import { cellDone } from '../src/buildrun.mjs'
import { roadShares } from '../src/roads.mjs'
import { recordHead } from '../src/buildproj.mjs'

const args = process.argv.slice(2)
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const regionOf = dir => { const m = new Map(); for (const f of fs.readdirSync(dir).filter(n => /^r\.-?\d+\.-?\d+\.mca$/.test(n))) for (const [k, v] of loadRegion(path.join(dir, f))) m.set(k, v); return reader(m) }
const read = regionOf(opt('--region'))
const raw = JSON.parse(fs.readFileSync(opt('--rec'), 'utf8'))
const rec = raw.rec ?? raw
const ids = new Set(String(opt('--ids', '')).split(',').filter(Boolean))
const [X0, Z0, X1, Z1] = (opt('--box') ?? '24,-14,60,64').split(',').map(Number)
const YMAX = Number(opt('--ymax', 80))
const TITLE = opt('--title', 'The road the bots sited and built'), SUB = opt('--sub', '')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const nm = b => String(b?.name ?? 'air')
const PAL = [
  [/^water$|bubble_column/, '#3f76e4'], [/lava/, '#e05a00'], [/_leaves$/, '#3f8a2e'], [/_(log|wood)$/, '#6b4a2b'], [/^grass_block$/, '#6fa64a'],
  [/^(dirt|coarse_dirt|rooted_dirt|podzol|farmland|mud)$/, '#8a5d3b'], [/^dirt_path$/, '#b39b5c'], [/^(sand|red_sand)$/, '#e2d59a'], [/sandstone/, '#d6c58a'],
  [/^gravel$/, '#8f8a86'], [/stone_brick/, '#b4b4b4'], [/deepslate_bricks|cobbled_deepslate|polished_andesite/, '#5d5d66'], [/^(cobblestone|mossy_cobblestone)$|cobblestone_slab/, '#7c7c7c'],
  [/_wall$/, '#5f5f5f'], [/torch|lantern/, '#ffd23f'], [/^(stone|andesite|diorite|granite|tuff|deepslate|calcite)$/, '#a3a3a8'], [/_planks$|_slab$|_stairs$|_fence/, '#a5814f'],
]
const colOf = b => { const n = nm(b); for (const [re, c] of PAL) if (re.test(n)) return c; return '#b8a07a' }
const shade = (hex, f) => { const v = parseInt(hex.slice(1), 16); const ch = s => Math.round(((v >> s) & 255) * f); return `rgb(${ch(16)},${ch(8)},${ch(0)})` }
const solid = b => !!b && (b.boundingBox === 'block' || /water|lava|_slab$|lantern|_fence/.test(nm(b)))
const inBox = (x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1
const segOf = c => String(c.seg ?? c.role ?? '').split('-')[0]
const cells = (rec.cells ?? []).filter(c => Array.isArray(c.at) && (!ids.size || ids.has(segOf(c))))
const surf = cells.filter(c => /-(tr|acc|ed|sl)$/.test(c.role) && inBox(c.at[0], c.at[2]))
const lights = cells.filter(c => /-light$/.test(c.role) && inBox(c.at[0], c.at[2]))
const done = c => { const b = read(...c.at); return !!b && cellDone(b, rec.palette ?? {}, c.role, c.ws ?? null) }
// the shared columns (the pool's records, the road's own and the reservations left out, as skills.mjs roads2Ctx builds them)
let shares = new Map()
const zones = []
if (opt('--pool')) {
  const dir = opt('--pool')
  const files = fs.readdirSync(dir)
  const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))]
  const recs = plots.filter(p => !['road', 'land', 'siteprep'].includes(p)).map(plot => { const h = recordHead(dir, `project-0_70_0.${plot}`); return { plot, rec: h.ok ? h.head?.rec ?? null : null } }).filter(r => r.rec)
  shares = roadShares(recs)
  for (const r of recs) for (const z of r.rec.zones ?? []) if (Array.isArray(z?.box) && z.box.length === 6) zones.push({ box: [z.box[0], z.box[2], z.box[3], z.box[5]], why: z.why ?? r.plot })
  try { for (const z of JSON.parse(fs.readFileSync(path.join(dir, 'protected-zones.json'), 'utf8')).zones ?? []) zones.push({ box: [z.box[0], z.box[2], z.box[3], z.box[5]], why: `protected ${z.id}` }) } catch { /* none */ }
}
const routes = opt('--traffic') ? JSON.parse(fs.readFileSync(opt('--traffic'), 'utf8')).routes ?? [] : []
const T = 14, pad = 30, top = 120, legendH = 170
const nx = X1 - X0 + 1, nz = Z1 - Z0 + 1
const W = Math.max(nx * T + 2 * pad, nz * T + top + legendH, 860), H = W   // square (qlmanage crops a thumbnail to a square)
const sx = x => pad + (x - X0) * T, sz = z => top + (z - Z0) * T
const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="100%" height="100%" fill="#dfe9f2"/>`]
const nBuilt = surf.filter(done).length, nLamp = lights.filter(done).length
const shared = surf.map(c => shares.get(`${c.at[0]},${c.at[2]}`)).filter(o => o && !o.other)
out.push(`<text x="20" y="30" font-family="Helvetica,Arial" font-size="18" fill="#222">${esc(TITLE)}</text>`)
out.push(`<text x="20" y="54" font-family="Helvetica,Arial" font-size="13" fill="#333">${esc(SUB)}</text>`)
out.push(`<text x="20" y="76" font-family="Helvetica,Arial" font-size="13" fill="#333">${esc(`${[...ids].join(', ') || 'every instance'}: surface cells ${surf.length} -- built ${nBuilt}, open ${surf.length - nBuilt}; lanterns ${nLamp} of ${lights.length}; on shared columns ${shared.length} (paths ${shared.filter(o => o.path).length}, grading ${shared.filter(o => !o.path).length}); north up, x ${X0}..${X1}, z ${Z0}..${Z1}; darker = lower`)}</text>`)
for (let x = X0; x <= X1; x++) for (let z = Z0; z <= Z1; z++) {
  let b = null, y = YMAX
  for (; y > YMAX - 40; y--) { b = read(x, y, z); if (solid(b)) break }
  const f = 0.45 + 0.55 * Math.max(0, Math.min(1, (y - (YMAX - 24)) / 24))
  out.push(`<rect x="${sx(x)}" y="${sz(z)}" width="${T}" height="${T}" fill="${b ? shade(colOf(b), f) : '#ccc'}" stroke="rgba(0,0,0,0.1)" stroke-width="0.5"/>`)
  if (b && (x - X0) % 2 === 0 && (z - Z0) % 2 === 0) out.push(`<text x="${sx(x) + 1}" y="${sz(z) + 10}" font-family="Helvetica,Arial" font-size="7" fill="rgba(255,255,255,0.75)">${y}</text>`)
}
for (const z of zones) { const [a0, b0, a1, b1] = z.box; const x0 = Math.max(a0, X0), z0 = Math.max(b0, Z0), x1 = Math.min(a1, X1), z1 = Math.min(b1, Z1); if (x0 <= x1 && z0 <= z1) out.push(`<rect x="${sx(x0)}" y="${sz(z0)}" width="${(x1 - x0 + 1) * T}" height="${(z1 - z0 + 1) * T}" fill="none" stroke="#d01010" stroke-width="1.5" stroke-dasharray="6,5"/><text x="${sx(x0) + 3}" y="${sz(z0) + 12}" font-family="Helvetica,Arial" font-size="10" fill="#d01010">${esc(String(z.why).slice(0, 40))}</text>`) }
for (const r of routes) { const pts = (r.line ?? []).filter(p => inBox(p[0], p[1])).map(p => `${sx(p[0]) + T / 2},${sz(p[1]) + T / 2}`).join(' '); out.push(`<polyline points="${pts}" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="4,4" opacity="0.9"/>`); const [p0] = r.line; if (inBox(p0[0], p0[1])) out.push(`<text x="${sx(p0[0]) + 4}" y="${sz(p0[1]) - 4}" font-family="Helvetica,Arial" font-size="11" fill="#fff" stroke="#000" stroke-width="0.3">${esc(r.id)}</text>`) }
for (const c of surf) { const k = done(c); out.push(`<rect x="${sx(c.at[0]) + 1.5}" y="${sz(c.at[2]) + 1.5}" width="${T - 3}" height="${T - 3}" fill="none" stroke="${k ? '#00c853' : '#ff00d4'}" stroke-width="2"/>`); const o = shares.get(`${c.at[0]},${c.at[2]}`); if (o && !o.other) out.push(`<circle cx="${sx(c.at[0]) + T / 2}" cy="${sz(c.at[2]) + T / 2}" r="2.2" fill="${o.path ? '#1565ff' : '#00e5ff'}"/>`) }
for (const c of lights) out.push(`<circle cx="${sx(c.at[0]) + T / 2}" cy="${sz(c.at[2]) + T / 2}" r="5" fill="${done(c) ? '#ffd23f' : 'none'}" stroke="#ffb300" stroke-width="2"/>`)
const ly = top + nz * T + 30
const leg = [['#00c853', 'rect', 'a road surface cell, built (the region holds its block)'], ['#ff00d4', 'rect', 'a road surface cell, not built (sited, open)'], ['#ffb300', 'disc', 'a lamp post\'s lantern (filled: standing)'],
  ['#1565ff', 'dot', 'a paved column shared with the PATHS (the road is the path there)'], ['#00e5ff', 'dot', 'a paved column shared with the countryside GRADING (the road takes its grade)'], ['#d01010', 'dash', 'a zone (another project\'s, a village\'s): never paved'], ['#ffffff', 'dash', 'the traffic lines (the bots\' most-walked ways)']]
leg.forEach(([c, k, s], i) => out.push(`${k === 'rect' ? `<rect x="20" y="${ly + i * 20}" width="13" height="13" fill="none" stroke="${c}" stroke-width="2.5"/>` : k === 'disc' ? `<circle cx="26" cy="${ly + i * 20 + 6}" r="5" fill="#ffd23f" stroke="${c}" stroke-width="2"/>` : k === 'dot' ? `<circle cx="26" cy="${ly + i * 20 + 6}" r="3" fill="${c}"/>` : `<line x1="18" y1="${ly + i * 20 + 6}" x2="36" y2="${ly + i * 20 + 6}" stroke="${c === '#ffffff' ? '#666' : c}" stroke-width="2" stroke-dasharray="4,3"/>`}<text x="44" y="${ly + i * 20 + 11}" font-family="Helvetica,Arial" font-size="12" fill="#222">${esc(s)}</text>`))
out.push('</svg>')
fs.writeFileSync(opt('--out'), out.join('\n'))
console.log(`_roadsite op=render box=${X0},${Z0},${X1},${Z1} ids=${[...ids].join(',')} surface=${surf.length} built=${nBuilt} lamps=${nLamp}/${lights.length} shared=${shared.length} out=${opt('--out')}`)
