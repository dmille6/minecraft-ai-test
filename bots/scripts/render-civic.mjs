#!/usr/bin/env node
// CIVIC-01: OFFLINE PICTURES of the landmark catalogue for the owner (no world, no server): every kind in two of its looks, drawn from
// the blueprints the bots build (civic.mjs civicBlueprint), stairs and slabs in their states, lanterns, glass. A CUTAWAY of the belfry
// shows the inside spiral. node bots/scripts/render-civic.mjs <outdir>
import fs from 'node:fs'
import path from 'node:path'
import { civicBlueprint, civicLooks, civicBill, CIVIC_KINDS, CIVIC_ORDER } from '../src/civic.mjs'
import { isoWorld, sheet, png, text, Canvas } from './civic-render.mjs'

const OUT = process.argv[2] ?? '.'
const WORLD = { '+u': 'east', '-u': 'west', '+v': 'south', '-v': 'north' }
function draw (id, { cut = false, title = null } = {}) {
  const bp = civicBlueprint(id)
  const m = new Map()
  for (const c of bp.cells) {
    if (cut && (c.v === bp.footprint.v - 1 || c.u === bp.footprint.u - 1) && c.y >= 1) continue   // the viewer's two walls cut away
    const name = bp.palette[c.role][0]
    const st = c.st ? { ...c.st, ...(c.st.facing ? { facing: WORLD[c.st.facing] } : {}) } : (/hang/.test(c.role) ? { hanging: 'true' } : null)
    m.set(`${c.u},${c.y},${c.v}`, { name, st })
  }
  // a grass apron round the pad
  const W = bp.footprint.u, D = bp.footprint.v
  const get = (x, y, z) => m.get(`${x},${y},${z}`) ?? (y === -1 ? { name: 'grass_block' } : null)
  const H = Math.max(...bp.cells.map(c => c.y))
  return isoWorld(get, [-1, -1, -1, W, H + 1, D], { a: 7, title: title ?? `${CIVIC_KINDS[bp.civic].name} ${bp.look.code}`, from: 'se' })
}
fs.mkdirSync(OUT, { recursive: true })
const rows = []
const bills = []
for (const k of CIVIC_ORDER) {
  const looks = civicLooks(k)
  const pick = looks.length > 2 ? [looks[0], looks[looks.length - 1]] : looks
  const pics = pick.map(id => draw(id))
  if (k === 'B') pics.push(draw(pick[0], { cut: true, title: 'belfry cutaway: the spiral' }))
  if (k === 'L') pics.push(draw(pick[0], { cut: true, title: 'lighthouse cutaway' }))
  rows.push(pics)
  for (const id of pick) bills.push(`${id}: ${Object.entries(civicBill(civicBlueprint(id))).map(([n, v]) => `${n} ${v}`).join(', ')}`)
  for (const [i, p] of pics.entries()) fs.writeFileSync(path.join(OUT, `civic-${CIVIC_KINDS[k].name}-${i + 1}.png`), png(p.w, p.h, p.px))
}
const sh = sheet([rows[0].concat(rows[1]), rows[2].concat(rows[3]), rows[4].concat(rows[5]), rows[6]], 'CIVIC-01 LANDMARKS: PLAZA, MARKET CROSS, BELFRY, WELL HOUSE, PAVILION, STATUE, LIGHTHOUSE (OFFLINE RENDER OF THE BLUEPRINTS)')
fs.writeFileSync(path.join(OUT, 'civic-sheet.png'), png(sh.w, sh.h, sh.px))
fs.writeFileSync(path.join(OUT, 'civic-bills.txt'), bills.join('\n') + '\n')
console.log(`wrote ${path.join(OUT, 'civic-sheet.png')} ${sh.w}x${sh.h}`)
console.log(bills.join('\n'))
