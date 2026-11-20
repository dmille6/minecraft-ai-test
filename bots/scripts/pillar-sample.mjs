#!/usr/bin/env node
// pillar-sample.mjs -- pillars-01show (the wider set, owner 11-20): ONE PICTURE PER SAMPLED COLUMN from a READ-ONLY region copy.
// Two side slices through the column (west-east and north-south, 8 each way, from its median - 4 to its top + 3), every block
// coloured by kind, the column's listed cells outlined magenta (or green: gone in --after), so a reader can see it is a lone column
// and not the edge of a slope. SVG out per sample; the caller rasterises (macOS: qlmanage -t -s <px> -o <dir> <svg>).
//
//   node scripts/pillar-sample.mjs --region <dir> --list <pillarclean-other.json> --outdir <dir> [--n 10] [--seed 7] [--after <dir>]
import fs from 'node:fs'
import path from 'node:path'
import { loadRegion, reader } from './wellsite-replay.mjs'
import { sameBlock } from '../src/pillarclean.mjs'

const args = process.argv.slice(2)
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const regionOf = dir => { const m = new Map(); for (const f of fs.readdirSync(dir).filter(n => /^r\.-?\d+\.-?\d+\.mca$/.test(n))) for (const [k, v] of loadRegion(path.join(dir, f))) m.set(k, v); return reader(m) }
const read = regionOf(opt('--region'))
const readA = opt('--after') ? regionOf(opt('--after')) : null
const list = JSON.parse(fs.readFileSync(opt('--list'), 'utf8'))
const OUT = opt('--outdir'); fs.mkdirSync(OUT, { recursive: true })
const N = Number(opt('--n', 10))
let seed = Number(opt('--seed', 7))
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const PAL = [
  [/^(air|cave_air|void_air)$/, '#e8f1fa'], [/^water$|bubble_column/, '#3f76e4'], [/^(ice|packed_ice|blue_ice)$/, '#9ec3f5'], [/_leaves$/, '#3f8a2e'],
  [/_(log|wood)$/, '#6b4a2b'], [/^grass_block$/, '#6fa64a'], [/^(dirt|coarse_dirt|rooted_dirt|podzol)$/, '#8a5d3b'], [/^(sand|red_sand)$/, '#e2d59a'],
  [/sandstone/, '#d6c58a'], [/^snow/, '#f4f7fb'], [/^gravel$/, '#8f8a86'], [/^(cobblestone|mossy_cobblestone|cobbled_deepslate)$/, '#7c7c7c'],
  [/^(stone|andesite|diorite|granite|tuff|deepslate|calcite)$/, '#a3a3a8'], [/_planks$|_slab$|_stairs$|_fence/, '#a5814f'], [/grass|fern|flower|tulip|poppy|dandelion/, '#b5d98c'],
]
const colOf = n => { for (const [re, c] of PAL) if (re.test(n)) return c; return '#c9a0dc' }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
// the sample: spread over the list (a stratified pick: every k-th after a seeded start), so beach, sea and land all show
const ps = [...list.pillars]
const pick = []
const step = ps.length / N
const start = rnd() * step
for (let i = 0; i < N && i < ps.length; i++) pick.push(ps[Math.floor(start + i * step) % ps.length])
const T = 18, R = 8
const rows = []
pick.forEach((p, i) => {
  const y0 = p.med - 4, y1 = p.top + 3, H = (y1 - y0 + 1) * T, Wd = (2 * R + 1) * T
  const listed = new Set(p.take.map(t => `${t[0]},${t[1]},${t[2]}`))
  const gone = k => { if (!readA) return false; const [x, y, z] = k.split(',').map(Number); const b = readA(x, y, z); const t = p.take.find(q => `${q[0]},${q[1]},${q[2]}` === k); return !!b && !sameBlock(b.name, t[3]) }
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${2 * Wd + 90}" height="${H + 90}">`, `<rect width="100%" height="100%" fill="#fff"/>`]
  out.push(`<text x="10" y="20" font-family="Helvetica,Arial" font-size="14" fill="#222">${esc(`sample ${i + 1}: column ${p.x},${p.z} (${p.where}), ${p.take.length} listed block(s) over the median y${p.med}: ${p.take.map(t => t[3]).join(', ')}`)}</text>`)
  out.push(`<text x="10" y="38" font-family="Helvetica,Arial" font-size="11" fill="#444">left: west-east slice; right: north-south slice; magenta = listed${readA ? ', green = taken down in the rig' : ''}; numbers = y</text>`)
  for (const [panel, dir] of [[0, 'x'], [1, 'z']]) {
    const ox = 10 + panel * (Wd + 60), oy = 50
    for (let d = -R; d <= R; d++) for (let y = y0; y <= y1; y++) {
      const x = dir === 'x' ? p.x + d : p.x, z = dir === 'z' ? p.z + d : p.z
      const b = read(x, y, z)   // the slices show the BEFORE copy; the marks say what the rig took
      const n = b ? b.name : '?'
      const px = ox + (d + R) * T, py = oy + (y1 - y) * T
      out.push(`<rect x="${px}" y="${py}" width="${T}" height="${T}" fill="${colOf(n)}" stroke="rgba(0,0,0,0.12)" stroke-width="0.5"/>`)
      const k = `${x},${y},${z}`
      if (listed.has(k)) out.push(`<rect x="${px + 1.5}" y="${py + 1.5}" width="${T - 3}" height="${T - 3}" fill="none" stroke="${gone(k) ? '#00c853' : '#ff00d4'}" stroke-width="2.5"/>`)
    }
    for (let y = y0; y <= y1; y += 2) out.push(`<text x="${ox + (2 * R + 1) * T + 3}" y="${oy + (y1 - y) * T + 13}" font-family="Helvetica,Arial" font-size="9" fill="#666">${y}</text>`)
  }
  out.push('</svg>')
  const f = path.join(OUT, `sample-${String(i + 1).padStart(2, '0')}.svg`)
  fs.writeFileSync(f, out.join('\n'))
  rows.push({ i: i + 1, x: p.x, z: p.z, where: p.where, med: p.med, top: p.top, blocks: p.take.map(t => t[3]).join(','), gone: readA ? p.take.every(t => gone(`${t[0]},${t[1]},${t[2]}`)) : null, file: path.basename(f) })
})
fs.writeFileSync(path.join(OUT, 'samples.json'), JSON.stringify(rows, null, 1))
console.log(`_pillar op=sample n=${rows.length} out=${OUT}`)
for (const r of rows) console.log(`  ${r.i} ${r.x},${r.z} ${r.where} y${r.med}->${r.top} ${r.blocks}${r.gone == null ? '' : ` gone=${r.gone}`}`)
