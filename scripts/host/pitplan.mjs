#!/usr/bin/env node
// PIT-01SHOW: THE PIT PLAN OVER A REGION COPY (host-side; read only). Runs bots/src/pit.mjs pitPlan -- the same code the bots run on the
// live world -- over a block dump of the site and writes the plan (JSON) for the pictures (scripts/host/pitpic.py) and the record.
//   node scripts/host/pitplan.mjs <dump.json> <site "cx,cz,w,l/floor"> <out plan.json>
// The dump: tl_region.read_box's shape ({ box: [x0, z0, x1, z1], y: [y0, y1], palette: [names], cells: [index, ...] x fastest, then z,
// then y}), e.g. made on ci2 from ~/world18full/region (the 11-18 showcase copy).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const P = await import(path.join(here, '../../bots/src/pit.mjs'))
const [dumpF, siteS, outF] = process.argv.slice(2)
if (!dumpF || !siteS || !outF) { console.error('usage: pitplan.mjs <dump.json> <cx,cz,w,l/floor> <out.json>'); process.exit(2) }
const site = P.pitSiteOf({ PIT_SITE: siteS })
if (!site) { console.error('unreadable site', siteS); process.exit(2) }
const d = JSON.parse(fs.readFileSync(dumpF, 'utf8'))
export const readerOf = d => {
  const [x0, z0, x1, z1] = d.box, [y0, y1] = d.y, nx = x1 - x0 + 1, nz = z1 - z0 + 1
  const cells = typeof d.cells === 'string' ? Buffer.from(d.cells, 'base64') : d.cells
  const SOLIDLESS = /^(air|cave_air|void_air|water|lava|bubble_column|short_grass|tall_grass|fern|large_fern|snow|dead_bush|.*_sapling|vine|glow_lichen|torch|wall_torch|kelp|kelp_plant|seagrass|tall_seagrass|.*_tulip|dandelion|poppy)$/
  return (x, y, z) => {
    if (x < x0 || x > x1 || z < z0 || z > z1 || y < y0 || y > y1) return null
    const raw = d.palette[cells[(x - x0) + nx * ((z - z0) + nz * (y - y0))]]
    if (raw == null || raw === '?') return null
    const name = raw.replace(/^minecraft:/, '').replace(/\[.*$/, '')
    const props = /waterlogged=true/.test(raw) ? { waterlogged: true } : null
    return { name, boundingBox: SOLIDLESS.test(name) ? 'empty' : 'block', props }
  }
}
const read = readerOf(d)
const plan = P.pitPlan(read, site)
// the picture's ground: every column of the box, its top and what it is
const ground = []
for (let z = d.box[1]; z <= d.box[3]; z++) for (let x = d.box[0]; x <= d.box[2]; x++) { const c = P.columnOf(read, x, z, site.floor); ground.push([x, z, c.unread ? null : c.g, c.unread ? '?' : c.wet != null ? (c.top === 'ice' ? 'ice' : 'water') : c.top]) }
fs.writeFileSync(outF, JSON.stringify({ ...plan, ground, dump: path.basename(dumpF) }))
console.log(JSON.stringify({ ok: plan.ok, why: plan.why ?? null, outline: plan.outline.length, pit: plan.pit?.length, rim: plan.rim?.length, held: plan.held, cells: plan.cells?.length, dirt: plan.dirt, other: plan.other, water: plan.water, steps2: plan.steps2, layers: plan.layers }))
