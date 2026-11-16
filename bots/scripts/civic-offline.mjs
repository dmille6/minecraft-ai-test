#!/usr/bin/env node
// CIVIC-01, OFFLINE: every landmark look PROVEN BUILDABLE by the bots' own siting proof (buildsite.mjs proveSite: the build in order,
// each cell from a stand the walk reaches, its face in sight or within reach for a blind cell, its state's aim) on a flat field, in
// each of the four orientations. node scripts/civic-offline.mjs [id ...]
import { proveSite, loadBlueprint } from '../src/buildsite.mjs'
import { civicLooks, CIVIC_ORDER } from '../src/civic.mjs'

const ids = process.argv.slice(2).length ? process.argv.slice(2) : CIVIC_ORDER.flatMap(k => civicLooks(k))
const G = 69   // the field's grass top; home's feet 70
const read = (x, y, z) => (y > G ? { name: 'air', boundingBox: 'empty' } : y === G ? { name: 'grass_block', boundingBox: 'block' } : { name: 'dirt', boundingBox: 'block' })
const home = { x: 0, y: G + 1, z: 0 }
let fails = 0
for (const id of ids) {
  const bp = loadBlueprint(id)
  const res = []
  for (const orient of ['N', 'E', 'S', 'W']) {
    // the pad 12 east of home (the field is open all round), its pad level the grass top (cells y 0 = the pad course ON the ground)
    const r = proveSite(read, home, bp, { anchor: { x: 12, z: -2 }, s: G + 1, orient, clear: [], fill: [] }, { stood: [[home.x, home.y, home.z]], domain: () => true, walkR: 48 })
    res.push(`${orient}:${r.ok ? 'ok' : `${r.why} ${r.detail ?? ''}`}`)
    if (!r.ok) fails++
  }
  console.log(id, bp.cells.length, 'cells', res.join(' | '))
}
console.log(fails ? `FAIL ${fails}` : 'PASS')
process.exit(fails ? 1 : 0)
