#!/usr/bin/env node
// pillar-colscan.mjs -- pillars-01show, survey step 1 (HOST SIDE, never on the showcase VM): every column's standing top over a
// READ-ONLY region copy, then the vision render's pillar rule (docs/reports/vision-2026-11-20/src/vision.py 1b): a column whose
// standing top is 3+ over the median of its 5x5 neighbourhood with a bot's material on top. Section-aware (an all-air section is
// skipped whole), so the whole saved world scans in about a minute.
//
//   node scripts/pillar-colscan.mjs --region <dir of r.*.mca> --out cand.json [--box x0,z0,x1,z1]
//
// Out: { cols: n, cand: [{ x, z, top, name, med, base, body: [[y, name], ...] }] } where body is the column from med+1 to top
// (the blocks a removal would take to bring the column to its neighbourhood's level) and base is what the column stands on at
// med (ice / water / land), for the sea guard.
import fs from 'node:fs'
import path from 'node:path'
import { loadRegion, reader } from './wellsite-replay.mjs'
import { standTop, pillarCandidate } from '../src/pillarclean.mjs'

const args = process.argv.slice(2)
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const regionDir = opt('--region'), outPath = opt('--out')
const box = opt('--box') ? opt('--box').split(',').map(Number) : null
if (!regionDir || !outPath) { console.error('usage: pillar-colscan.mjs --region DIR --out cand.json [--box x0,z0,x1,z1]'); process.exit(2) }
const chunks = new Map()
for (const f of fs.readdirSync(regionDir).filter(n => /^r\.-?\d+\.-?\d+\.mca$/.test(n))) for (const [k, v] of loadRegion(path.join(regionDir, f))) chunks.set(k, v)
const read = reader(chunks)
// the highest section index per chunk with anything but air (the scan's start)
const hiOf = new Map()
for (const [k, secs] of chunks) {
  let hi = -5
  for (const [y, s] of secs) if (!(s.palette.length === 1 && /air$/.test(s.palette[0].Name))) hi = Math.max(hi, y)
  hiOf.set(k, hi)
}
const tops = new Map()
const t0 = Date.now()
for (const [k] of chunks) {
  const [cx, cz] = k.split(',').map(Number)
  for (let dx = 0; dx < 16; dx++) for (let dz = 0; dz < 16; dz++) {
    const x = cx * 16 + dx, z = cz * 16 + dz
    if (box && (x < box[0] || x > box[2] || z < box[1] || z > box[3])) continue
    const t = standTop(read, x, z, hiOf.get(k) * 16 + 15)
    if (t) tops.set(`${x},${z}`, t)
  }
}
const cand = []
for (const [k, t] of tops) {
  const [x, z] = k.split(',').map(Number)
  const c = pillarCandidate(x, z, t, (xx, zz) => tops.get(`${xx},${zz}`) ?? null)
  if (!c) continue
  const body = []
  for (let y = c.med + 1; y <= t.y; y++) { const n = read(x, y, z)?.name ?? '?'; if (!/^(air|cave_air|void_air)$/.test(n)) body.push([y, n]) }
  cand.push({ x, z, top: t.y, name: t.name, med: c.med, base: c.base, body })
}
fs.writeFileSync(outPath, JSON.stringify({ cols: tops.size, chunks: chunks.size, cand }))
console.log(`_pillar op=colscan chunks=${chunks.size} cols=${tops.size} cand=${cand.length} ms=${Date.now() - t0}`)
