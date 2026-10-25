#!/usr/bin/env node
// THE BUILDING TIER'S SITING PLANNER, OFFLINE (shop-01 step 1; design docs/reports/building-tier-2026-10-23.md section 4.3:
// "the runtime planner's run on frozen plans ... before any actuator code").
//
//   node scripts/buildsite-offline.mjs <dump.json> <pool-state-dir> [--world W] [--z0m0 zig-z0m0.json] [--stood stood.json] [--blueprint workshop@1]
//                                      [--out record.json] [--tries N]
//
// <dump.json> is scripts/host/townplan_blockdump.py's output over COPIES of a world's region files (read-only). <pool-state-dir>
// is a COPY of the pool's state directory (/var/lib/mcai/_pool-<world>): the town plan's generations, protected-zones.json, the
// plinth well record and the tree-farm record. The plan's HEAD is planstore's own walk. Nothing is written but --out.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { planHead, resetPlanWalks } from '../src/planstore.mjs'
import { parseZones } from '../src/townplan.mjs'
import { loadBlueprint, siteBlueprint } from '../src/buildsite.mjs'

const require = createRequire(import.meta.url)
const mcData = require('minecraft-data')('1.21.8')

/** A reader over the dump -> read(x, y, z) -> { name, boundingBox } | null (townplan-offline.mjs's, which runs on import). */
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

/** A JSON file -> its value; null when ABSENT (ENOENT). Anything else (unreadable, malformed) THROWS: a reservation file that
 *  cannot be read is never "no reservations" (Codex siting r1 P2: a malformed zones file read as zero zones). */
export function readJson (f) {
  let buf
  try { buf = fs.readFileSync(f, 'utf8') } catch (e) { if (e?.code === 'ENOENT') return null; throw new Error(`unreadable ${path.basename(f)}: ${e?.code ?? e}`) }
  try { return JSON.parse(buf) } catch { throw new Error(`malformed ${path.basename(f)}`) }
}

/** A plinth record's columns -> [[x, y, z]]: the plan's steps, cap and stair, and every prev[] column {x, y, z, stair} (plinth.mjs carryPrev). */
export function plinthCells (rec) {
  const out = []
  const pl = rec?.plan
  if (pl && typeof pl === 'object') {
    for (const st of pl.steps ?? []) if (Array.isArray(st?.c)) out.push(st.c)
    if (pl.cap) out.push([pl.cap.x, pl.cap.y, pl.cap.z])
    for (const c of pl.stair ?? []) if (Array.isArray(c) && c.length === 3) out.push(c)
  }
  for (const c of Array.isArray(rec?.prev) ? rec.prev : []) {
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) continue
    out.push([c.x, c.y, c.z])
    for (const s of Array.isArray(c.stair) ? c.stair : []) if (Array.isArray(s) && s.length === 3) out.push(s)
  }
  return out
}

/** The pool's records -> { key, world, head, zones, wells, farm } or { why }. Every file is read fail-closed (readJson). */
export function poolRecords (dir) {
  try {
    const files = fs.readdirSync(dir)
    const keys = [...new Set(files.map(f => /^(townplan-[-0-9_]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))]
    if (keys.length !== 1) return { why: `townplan keys ${keys.length}` }
    const key = keys[0]
    const g1 = readJson(path.join(dir, `${key}.g1.json`))
    resetPlanWalks()
    const h = planHead(dir, key, g1?.world ?? null, { fresh: true })
    if (!h.ok || !h.head) return { why: `no head (${h.from}; rejected ${JSON.stringify(h.rejected)})`, key }
    const z = parseZones(readJson(path.join(dir, 'protected-zones.json')), null)
    if (!z.ok) return { why: `zones unreadable: ${z.why}`, key }
    const home = key.replace(/^townplan-/, '')
    const wells = plinthCells(readJson(path.join(dir, `junkwell-plinth-${home}.json`)))
    // the junk-well SITE generations (an unraised well's cap): the newest only, as the well reads it
    const gen = f => Number(/\.g(\d+)\./.exec(f)?.[1] ?? 0)
    const sites = files.filter(f => f.startsWith(`junkwell-site-${home}.g`) && f.endsWith('.json')).sort((a, b) => gen(b) - gen(a))
    const site = sites.length ? readJson(path.join(dir, sites[0])) : null
    if (site && [site.x, site.y, site.z].every(Number.isFinite)) wells.push([site.x, site.y, site.z])
    const tfs = files.filter(f => f.startsWith(`treefarm-${home}.g`) && f.endsWith('.json')).sort((a, b) => gen(b) - gen(a))
    const tf = tfs.length ? readJson(path.join(dir, tfs[0])) : null
    const farm = (tf?.cells ?? []).map(c => [c.x, c.z])
    return { key, world: g1?.world ?? null, head: h.head, gens: h.gens, accepted: h.accepted, rejected: h.rejected, zones: z.zones, zonesWhy: z.why, wells, farm }
  } catch (e) {
    return { why: `records_unreadable: ${e.message}` }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (isMain) {
  const argv = process.argv.slice(2)
  const flag = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1] }
  const [dumpPath, dir] = argv
  if (!dumpPath || !dir) { console.error('usage: buildsite-offline.mjs <dump.json> <pool-state-dir> [--world W] [--z0m0 f] [--blueprint id] [--out f] [--tries N]'); process.exit(2) }
  const world = flag('--world') ?? path.basename(dir).replace(/^_pool-/, '')
  const t0 = Date.now()
  const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
  const recs = poolRecords(dir)
  if (!recs.head) { console.log(JSON.stringify({ world, ok: false, why: recs.why })); process.exit(0) }
  const zz = flag('--z0m0') ? (readJson(flag('--z0m0'))?.worlds?.[world] ?? {}) : {}
  // THE STOOD CELLS (D3): --stood <file> = {world: {cells: [[x, y, z]]}}, the feet cells the pool's bots logged in town
  // (docs/reports/shop-01-siting-2026-10-25/data/stood.py.txt); without it, home's start cell and the plan's stands only
  const stood = flag('--stood') ? (readJson(flag('--stood'))?.[world]?.cells ?? []) : []
  const bp = loadBlueprint(flag('--blueprint') ?? 'workshop@1')
  const r = siteBlueprint(read, recs.head.plan, bp, { zones: recs.zones, wells: recs.wells, farm: recs.farm, stood, z0: zz.ziggurat ?? null, m0: zz.shaft ?? null, tries: flag('--tries') ? Number(flag('--tries')) : undefined })
  const out = flag('--out')
  if (out && r.record) fs.writeFileSync(out, JSON.stringify({ world, planGen: recs.head.gen, planSha: recs.head.sha, ...r.record }, null, 1) + '\n')
  const rec = r.record
  console.log(JSON.stringify({
    world, ok: r.ok, why: r.why, plan: { key: recs.key, gen: recs.head.gen, mode: recs.head.plan.mode, pavilion: (recs.head.plan.plots ?? []).find(p => p.kind === 'pavilion')?.sector ?? null, rejectedGens: recs.rejected.length },
    records: { zones: recs.zones.length, zonesWhy: recs.zonesWhy, wellCells: recs.wells.length, farmCells: recs.farm.length, stoodCells: stood.length, z0: !!zz.ziggurat?.centre, m0: !!zz.shaft?.origin },
    sectors: r.sectors,
    site: rec ? { sector: rec.sector, source: rec.sector_source, anchor: rec.anchor, orient: rec.orient, box: rec.box, s: rec.s, earthwork: rec.earthwork, trees: rec.trees.length, replant: rec.replant.length, clear: rec.clear.length, cells: rec.cells.length, segments: rec.segments.map(s => `${s.seg}:${s.cells}/${s.stands}st`).join(' '), interior: rec.interior, bom: rec.bom } : null,
    ms: Date.now() - t0,
  }))
}
