#!/usr/bin/env node
// PLANAHEAD-01, OFFLINE: the plan-time reach check (planahead.mjs planReach, the bots' own walk) over COPIES of a town's region files
// and pool state -- what the keeper's stage publish would tag, and the stand claims a building's record makes.
//
//   node scripts/planahead-offline.mjs <dump.json> <pool-state-dir> [--plots tidy,tower] [--home 0,70,0] [--json out.json]
//
// <dump.json> is scripts/host/townplan_blockdump.py over COPIES of the region files; <pool-state-dir> a COPY of /var/lib/mcai/_pool-<pool>
// (its project records and `<shop key>.stood.jsonl[.old]`). Nothing is written but --json.
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader } from './buildsite-offline.mjs'
import { replaceableCell, isLiquid } from '../src/townplan.mjs'
import { planReach, reachTag, plannedWorld, standClaims, standRetire, PA } from '../src/planahead.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: planahead-offline.mjs <dump.json> <pool-state-dir> [--plots tidy] [--home x,y,z] [--json out]'); process.exit(2) }
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const [hx, hy, hz] = (opt('home', '0,70,0')).split(',').map(Number)
const home = { x: hx, y: hy, z: hz }
const hk = `${hx}_${hy}_${hz}`
const files = fs.readdirSync(poolDir)
const stood = []
for (const f of [`project-${hk}.shop.stood.jsonl.old`, `project-${hk}.shop.stood.jsonl`]) {
  let text = ''
  try { text = fs.readFileSync(path.join(poolDir, f), 'utf8') } catch { continue }
  for (const l of text.split('\n')) { try { const r = JSON.parse(l); if (Array.isArray(r?.c) && r.c.length === 3) stood.push(r.c) } catch { /* torn */ } }
}
const gen = f => Number(/\.g(\d+)\.json$/.exec(f)?.[1] ?? 0)
const heads = new Map()
for (const f of files) {
  const m = new RegExp(`^project-${hk}\\.([A-Za-z0-9]+)\\.g\\d+\\.json$`).exec(f)
  if (m && (!heads.has(m[1]) || gen(f) > gen(heads.get(m[1])))) heads.set(m[1], f)
}
const recs = [...heads.entries()].map(([plot, f]) => { const j = JSON.parse(fs.readFileSync(path.join(poolDir, f), 'utf8')); return { ...(j.rec ?? j), plot: (j.rec ?? j).plot ?? plot } })
const openFill = at => { const b = read(...at); return !!b && (replaceableCell(b) || b.name === 'air' || b.name === 'cave_air' || isLiquid(b)) }
const standing = at => { const b = read(...at); return !!b && b.boundingBox !== 'empty' }
const done = (r, c) => (c.role === 'clear' ? !standing(c.at) : !openFill(c.at))
const out = { stood: stood.length, records: recs.length, plots: {} }
const claims = standClaims(recs)
out.claims = { feet: claims.feet.size, floor: claims.floor.size }
for (const plot of (opt('plots', 'tidy')).split(',')) {
  const rec = recs.find(r => r.plot === plot)
  if (!rec) { out.plots[plot] = { why: 'no record' }; continue }
  const waived = rec.waived ?? {}
  const fills = (rec.cells ?? []).filter(c => Array.isArray(c.at) && !Object.prototype.hasOwnProperty.call(waived, c.at.join(',')) && openFill(c.at))
  const cuts = [...(rec.cut ?? []), ...(rec.clear ?? [])].map(c => c.at ?? c).filter(at => Array.isArray(at) && !Object.prototype.hasOwnProperty.call(waived, at.join(',')) && standing(at))
  const planned = plannedWorld(recs, { self: plot, done })
  const t0 = Date.now()
  const r = planReach(read, fills, cuts, { home, stood, walkR: PA.walkR, planned })
  const tag = reachTag({ ...r, ms: Date.now() - t0 })
  const sr = standRetire(rec, claims)
  const role = {}; for (const k of tag.pu) { const c = (rec.cells ?? []).find(q => q.at.join(',') === k); const n = c ? c.role : 'cut'; role[n] = (role[n] ?? 0) + 1 }
  out.plots[plot] = { state: tag.state, open: r.open, pu: tag.n, puRoles: role, passes: tag.passes, checked: tag.checked, ms: tag.ms, planned: { block: planned.block.size, noFloor: planned.noFloor.size }, standRetired: sr?.standClaimed ?? null, puKeys: tag.pu }
  console.log(plot, JSON.stringify({ ...out.plots[plot], puKeys: undefined }))
}
console.log('stood', stood.length, 'claims', JSON.stringify(out.claims))
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(out))
