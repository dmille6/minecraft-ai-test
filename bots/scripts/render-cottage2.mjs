// cottage2-01: OFFLINE PICTURES of the furnished cottage family for the owner (no world, no server), drawn by render-townstyle.mjs's
// isometric renderer at half-block resolution. node bots/scripts/render-cottage2.mjs <outdir>
// Writes <outdir>/cottage2-sheet.png: BEFORE (the flat house@1, the first cottage@1f) -> AFTER (the three showcase cottages the 11-08
// replay sited, each with a CUTAWAY of its room: beds, chests, the inside torch), then a row of other looks of the family.
import fs from 'node:fs'
import path from 'node:path'
import { png, Canvas, iso, text } from './render-townstyle.mjs'
import { cottageBlueprint, stylePalette } from '../src/townstyle.mjs'
import { cottage2Blueprint, lookCode } from '../src/cottage2.mjs'

const OUT = process.argv[2] ?? '.'
const load = id => JSON.parse(fs.readFileSync(new URL(`../src/blueprints/${id}.json`, import.meta.url), 'utf8'))
const furnished = pal => ({ ...pal, bed: ['red_bed'], bedhead: ['red_bed'], flower: ['poppy'], lamp: ['lantern'], planter: ['moss_block'], wall: (pal.wall ?? []).map(n => (n === '$planks' ? 'spruce_planks' : n)), gable: (pal.gable ?? []).map(n => (n === '$planks' ? 'spruce_planks' : n)) })
const designs = []
designs.push({ title: 'BEFORE: HOUSE@1 (FLAT)', cells: load('house@1').cells, palette: { ...load('house@1').palette, wall: ['spruce_planks'], roof: ['spruce_planks'], trim: ['spruce_planks'] } })
designs.push({ title: 'NOW: COTTAGE1 @1F SPRUCE', cells: cottageBlueprint('f').cells, palette: stylePalette(cottageBlueprint('f').palette, { wood: 'spruce', roof: 'spruce', stone: 'stone_bricks' }) })
// the replay on the 11-08 dump: cottage2 on X4, cottage3 on X5 (docs/reports/cottage2-design-2026-11-08.md section 4)
const SITED = [['COTTAGE2 X4', 'Lsl1c', { wood: 'oak', roof: 'spruce', stone: 'stone_bricks' }], ['COTTAGE3 X5', 'Csl0-', { wood: 'oak', roof: 'spruce', stone: 'stone_bricks' }]]
for (const [t, code, style] of SITED) {
  const bp = cottage2Blueprint(code)
  const pal = furnished(stylePalette(bp.palette, style))
  designs.push({ title: `${t}: ${code} ${style.wood}`, cells: bp.cells, palette: pal })
  designs.push({ title: `${t} ROOM (CUTAWAY)`, cells: bp.cells.filter(c => c.y <= 1 || (c.y === 2 && !['wall', 'window', 'post', 'course'].includes(c.role))), palette: pal })
}
const OTHERS = [['Cfg0-', { wood: 'oak', roof: 'spruce', stone: 'cobblestone' }], ['Csg0c', { wood: 'spruce', roof: 'dark_oak', stone: 'stone_bricks' }], ['Lfl1-', { wood: 'birch', roof: 'spruce', stone: 'cobblestone' }], ['Lsg0-', { wood: 'spruce', roof: 'spruce', stone: 'cobblestone' }]]
for (const [code, style] of OTHERS) { const bp = cottage2Blueprint(code); designs.push({ title: `${lookCode(bp.look)} ${style.wood}`, cells: bp.cells, palette: furnished(stylePalette(bp.palette, style)) }) }
fs.mkdirSync(OUT, { recursive: true })
const pics = designs.map(d => iso(d.cells, d.palette, { title: d.title, a: 9 }))
const rows = [pics.slice(0, 2), pics.slice(2, 4), pics.slice(4, 6), pics.slice(6)]
const W = Math.max(...rows.map(r => r.reduce((s, p) => s + p.w + 10, 10)))
const H = rows.reduce((s, r) => s + Math.max(...r.map(p => p.h)) + 10, 40)
const sheet = new Canvas(W, H, [255, 255, 255])
text(sheet, 10, 10, 'COTTAGE2-01: CHARM, VARIETY, BEDS AND CHESTS (OFFLINE RENDER OF THE BLUEPRINTS)')
let y = 40
for (const r of rows) { let x = 10; for (const p of r) { sheet.blit(p, x, y); x += p.w + 10 } y += Math.max(...r.map(p => p.h)) + 10 }
fs.writeFileSync(path.join(OUT, 'cottage2-sheet.png'), png(sheet.w, sheet.h, sheet.px))
console.log(`wrote ${path.join(OUT, 'cottage2-sheet.png')} ${sheet.w}x${sheet.h}`)
