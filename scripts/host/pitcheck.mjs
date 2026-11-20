#!/usr/bin/env node
// PIT-01SHOW: THE RIG'S BEFORE / AFTER over two block dumps of the site (read only): what the plan listed and is dug now, the dirt in
// it, the set-aside cells, and THE SEA-BREACH CHECK -- every water / ice cell of the box before and after (a new one, or one gone, is a
// flow), and every dug cell with water within the rim. Prints one JSON line.
//   node scripts/host/pitcheck.mjs <plan.json> <before dump> <after dump>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const P = await import(path.join(here, '../../bots/src/pit.mjs'))
const { readerOf } = await import(path.join(here, 'pitplan.mjs')).catch(() => ({}))
const [planF, beforeF, afterF] = process.argv.slice(2)
const plan = JSON.parse(fs.readFileSync(planF, 'utf8'))
const dump = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const reader = d => {
  const [x0, z0, x1, z1] = d.box, [y0, y1] = d.y, nx = x1 - x0 + 1, nz = z1 - z0 + 1
  const cells = typeof d.cells === 'string' ? Buffer.from(d.cells, 'base64') : d.cells
  return (x, y, z) => (x < x0 || x > x1 || z < z0 || z > z1 || y < y0 || y > y1 ? null : String(d.palette[cells[(x - x0) + nx * ((z - z0) + nz * (y - y0))]]).replace(/^minecraft:/, '').replace(/\[.*$/, ''))
}
const B = dump(beforeF), A = dump(afterF), rb = reader(B), ra = reader(A)
const WET = /^(water|ice|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass|packed_ice|blue_ice|frosted_ice)$/
const [x0, z0, x1, z1] = B.box, [y0, y1] = B.y
let wetB = 0, wetA = 0
const newWet = [], goneWet = []
for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
  const b = WET.test(rb(x, y, z) ?? ''), a = WET.test(ra(x, y, z) ?? '')
  if (b) wetB++; if (a) wetA++
  if (a && !b) newWet.push([x, y, z].join(',')); if (b && !a) goneWet.push([x, y, z].join(','))
}
const dug = plan.cells.filter(c => /^(air|cave_air)$/.test(ra(...c.at) ?? '') && !/^(air|cave_air)$/.test(rb(...c.at) ?? ''))
const breach = dug.filter(c => { const [x, y, z] = c.at; for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -1; dy <= 1; dy++) if (WET.test(ra(x + dx, y + dy, z + dz) ?? '')) return true; return false })
const byY = {}; for (const c of dug) byY[c.at[1]] = (byY[c.at[1]] ?? 0) + 1
console.log(JSON.stringify({ listed: plan.cells.length, dug: dug.length, dirtDug: dug.filter(c => c.e).length, dugByLayer: byY, wetBefore: wetB, wetAfter: wetA, newWet: newWet.slice(0, 20), newWetN: newWet.length, goneWetN: goneWet.length, goneWet: goneWet.slice(0, 10), breach: breach.map(c => c.at.join(',')) }))
