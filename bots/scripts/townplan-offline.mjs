#!/usr/bin/env node
// THE BOTS' OWN PLANNER, OFFLINE (townplan-01; build spec docs/reports/townplan-found-spec-2026-10-21.md section 4).
//
//   node scripts/townplan-offline.mjs <dump.json> --home X Y Z [--zones protected-zones.json] [--seed town-site.json]
//                                     [--world HI:LO] [--out plan.json] [--map]
//
// <dump.json> is scripts/host/townplan_blockdump.py's output over COPIES of a world's region files (read-only). The same pure
// fit the bots run (townplan.mjs fitTown) is run over a `read(x, y, z)` built from the dump, with block boxes from
// minecraft-data 1.21.8 -- so the plan a fresh town's first bot would write is known before any bot joins. Nothing is written
// anywhere but --out. `?` cells (a chunk absent from the copies) read as UNKNOWN, as an unloaded chunk does to a bot.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fitTown, parseZones, parseSeed, avoidZones, auditPlan, keepouts } from '../src/townplan.mjs'

const require = createRequire(import.meta.url)
const mcData = require('minecraft-data')('1.21.8')

const argv = process.argv.slice(2)
const flag = (name, n = 1) => { const i = argv.indexOf(name); return i < 0 ? null : argv.slice(i + 1, i + 1 + n) }
const dumpPath = argv[0]
const h = flag('--home', 3)
if (!dumpPath || !h) { console.error('usage: townplan-offline.mjs <dump.json> --home X Y Z [--zones f] [--seed f] [--world HI:LO] [--out f] [--map]'); process.exit(2) }
const home = { x: Number(h[0]), y: Number(h[1]), z: Number(h[2]) }
const world = flag('--world')?.[0] ?? null

/** A reader over the dump -> read(x, y, z) -> { name, boundingBox } | null. */
export function dumpReader (dump) {
  const [x0, z0, x1, z1] = dump.box, [y0, y1] = dump.y
  const nx = x1 - x0 + 1, nz = z1 - z0 + 1
  const buf = Buffer.from(dump.cells, 'base64')
  const cells = dump.bits === 8 ? new Uint8Array(buf.buffer, buf.byteOffset, buf.length) : new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2)
  const pal = dump.palette.map(n => {
    if (n === '?') return null
    const snow = /^snow\[layers=(\d+|\?)\]/.exec(n)
    const name = snow ? n.replace(/^snow\[layers=(\d+|\?)\]/, 'snow') : n
    const base = name.replace(/\[waterlogged\]$/, '')
    const b = mcData.blocksByName[base]
    return { name, boundingBox: b?.boundingBox ?? 'block', ...(snow ? { props: { layers: snow[1] === '?' ? null : Number(snow[1]) } } : {}) }
  })
  return (x, y, z) => {
    if (x < x0 || x > x1 || z < z0 || z > z1 || y < y0 || y > y1) return null
    return pal[cells[((y - y0) * nz + (z - z0)) * nx + (x - x0)]]
  }
}

const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
const read = dumpReader(dump)
const zf = flag('--zones')?.[0]
const zones = zf ? parseZones(JSON.parse(fs.readFileSync(zf, 'utf8')), world) : { ok: true, zones: [], why: 'absent' }
if (!zones.ok) { console.error(`zones unreadable: ${zones.why}`); process.exit(3) }
const sf = flag('--seed')?.[0]
const seed = sf ? parseSeed(JSON.parse(fs.readFileSync(sf, 'utf8')), { home, world }) : { ok: true, use: null, why: 'absent' }
const all = [...zones.zones, ...(seed.use?.avoid ?? [])]
// the town's containers and furniture in the fit box (a greenfield site has none)
const containers = [], existing = []
for (let x = home.x - 20; x <= home.x + 20; x++) for (let z = home.z - 20; z <= home.z + 20; z++) for (let y = home.y - 12; y <= home.y + 12; y++) {
  const b = read(x, y, z)
  if (!b) continue
  if (/^(chest|trapped_chest|barrel|crafting_table|furnace)$/.test(b.name)) existing.push([x, y, z])
  if (/^(chest|trapped_chest|barrel)$/.test(b.name) && Math.hypot(x - home.x, z - home.z) <= 16 && Math.abs(y - home.y) <= 12) containers.push({ k: `${x},${y},${z}`, halves: 1, at: [x, y, z], obs: null })
}
const t0 = Date.now()
const r = fitTown(read, home, { containers, existing, zones: all, seed: seed.use, seedInfo: seed.use ? { why: seed.why, avoid: seed.use.avoid ?? [] } : null, zoneInfo: { n: zones.zones.length, avoid: seed.use?.avoid?.length ?? 0, why: zones.why } })
const ms = Date.now() - t0
if (!r.body) { console.error(`NO PLAN: ${r.why}`); process.exit(4) }
const plan = { v: 1, ...r.body, gen: 1, prev: null, prevSha: null, world, at: 0, by: 'offline', code: 'townplan-offline', transitions: [] }
console.log(`mode=${r.mode} why=${r.why} ${Object.entries(r.summary ?? {}).map(([k, v]) => `${k}=${v}`).join(' ')} zones=${zones.zones.length}+${seed.use?.avoid?.length ?? 0} fit_ms=${ms}`)
for (const p of plan.plots) console.log(`  ${p.id.padEnd(9)} ${String(p.kind).padEnd(10)} ${p.sector ? `sector=${p.sector}` : ''} ${p.box ? `box=${p.box.join(',')}` : ''} ${p.cells ? `cells=${p.cells.length} ready=${p.cells.filter(c => c.ready).length}` : ''}${p.stations ? `stations=${p.stations.length} ready=${p.stations.filter(c => c.ready).length}` : ''} ${p.composter ? `composter=${p.composter.join(',')}` : ''} ${p.building ? `building=${p.building}` : ''} ${p.state}`)
for (const pa of plan.paths) console.log(`  path ${pa.id} seg=${pa.seg.join(',')}`)
const a = auditPlan(plan, read)
console.log(`  audit: ${JSON.stringify(a)}`)
if (argv.includes('--map')) {
  const ko = keepouts(plan)
  const cellAt = new Map(plan.plots.flatMap(p => [...(p.cells ?? []), ...(p.stations ?? [])]).map(c => [`${c.at[0]},${c.at[2]}`, c]))
  for (let z = home.z - 20; z <= home.z + 20; z++) {
    let line = ''
    for (let x = home.x - 20; x <= home.x + 20; x++) {
      const c = cellAt.get(`${x},${z}`)
      if (x === home.x && z === home.z) line += 'H'
      else if (c) line += c.kind === 'chest' ? (c.role === 'overflow' ? 'O' : 'C') : c.kind === 'crafting_table' ? 'T' : 'F'
      else if (ko.soft(x, z)) line += ko.segs.some(sg => x >= sg[0] && x <= sg[2] && z >= sg[1] && z <= sg[3]) ? '=' : '+'
      else {
        let top = null
        for (let y = home.y + 12; y >= home.y - 12; y--) { const b = read(x, y, z); if (b && b.boundingBox === 'block') { top = b.name; break } }
        line += !top ? ' ' : /leaves|log/.test(top) ? 't' : /water|ice/.test(top) ? '~' : '.'
      }
    }
    console.log(line)
  }
}
const out = flag('--out')?.[0]
if (out) fs.writeFileSync(out, JSON.stringify(plan, null, 1) + '\n')
