#!/usr/bin/env node
// THE ZIGGURAT'S SITE, OFFLINE (monument-01): the bots' own siting (ziggurat.mjs siteZiggurat + zigRecord) run on COPIES of a world's
// region files and pool state, so where a town's ziggurat goes -- and what it costs -- is known before any bot sites it. The same
// functions a bot runs at its first monument visit (skills.mjs buildMonument).
//
//   node scripts/zigsite-offline.mjs <dump.json> <pool-state-dir> [--pool showcase] [--b 30] [--out record.json]
//        [--design v2 [--seed N] [--stock '{"stone_bricks": 200}'] [--biome desert]]
//
// <dump.json> is scripts/host/townplan_blockdump.py's output over COPIES of the region files (read-only; a box covering the town
// plan's monument reservation, y home-18 .. home+30). <pool-state-dir> is a COPY of /var/lib/mcai/_pool-<pool>: the town plan's
// generations, protected-zones.json, the junk-well records and every project-<home>.<plot>.g<N>.json. Nothing is written but --out.
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { reservations } from '../src/buildsite.mjs'
import * as Z from '../src/ziggurat.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: zigsite-offline.mjs <dump.json> <pool-state-dir> [--pool P] [--b B] [--out record.json]'); process.exit(2) }
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
// the plan's head (planstore's own walk), the zones, the wells and the farm: buildsite-offline's reader, fail-closed
const P = poolRecords(poolDir)
if (!P.head) { console.error('the pool records cannot be read:', P.why); process.exit(1) }
const plan = P.head.plan
const home = plan.home
const { zones, wells, farm } = P
const files = fs.readdirSync(poolDir)
// every other project's newest record generation: its cells are kept SITE.avoidPad away
const cells = new Set()
const newest = new Map()
for (const f of files) { const m = /^project-[-\d_]+\.([A-Za-z0-9-]+)\.g(\d+)\.json$/.exec(f); if (m && m[1] !== Z.MONUMENT_PLOT && Number(m[2]) > (newest.get(m[1])?.g ?? -1)) newest.set(m[1], { g: Number(m[2]), f }) }
for (const { f } of newest.values()) for (const c of JSON.parse(fs.readFileSync(path.join(poolDir, f), 'utf8')).cells ?? []) cells.add(`${c.at[0]},${c.at[2]}`)
const res = reservations(plan, { zones, wells, farm })
const pool = opt('pool', 'showcase')
let g = opt('b') ? Z.zigFor({ MONUMENT_B: opt('b') }, pool) : Z.zigFor({}, pool)
const box = Z.monumentBox(plan)
if (!box) { console.error('the plan holds no monument reservation'); process.exit(1) }
const col = (x, z) => Z.columnOf(read, x, z, { yHi: home.y + 30, yLo: home.y - 18 })
const avoid = Z.zigAvoid({ column: res.column, zones, cells })
// ZIGGURAT V2 (--design v2): the bots' own choice -- the town seed (--seed N, or --pool's seed with this home), the stock
// (--stock '{"name": n}': the town index + bag spare the siting bot would see) and --biome; its fallbacks in order, as
// skills.mjs buildMonument tries them
let s = null, design = null
if (opt('design') === 'v2') {
  const D = await import('../src/zigdesign.mjs')
  const seed = opt('seed') ? Number(opt('seed')) : D.zigSeed(pool, home)
  const stock = opt('stock') ? JSON.parse(opt('stock')) : {}
  const pin = opt('b') ? { B: Number(opt('b')) } : {}
  for (const cand of D.zigCandidates(seed, pin).slice(0, 4)) {
    const d = D.zigDesign(seed, { stock, biome: opt('biome'), pin: cand })
    const r = Z.siteZiggurat(col, avoid, { box, home, g: d.g })
    if (!s || r.ok) { s = r; design = d; g = d.g }
    if (r.ok) break
  }
  console.error('design', D.zigDesignName(design))
} else s = Z.siteZiggurat(col, avoid, { box, home, g })
if (!s.ok) { console.log(JSON.stringify({ ok: false, why: s.why, rejects: s.rejects })); process.exit(1) }
const rec = Z.zigRecord(s.site, read, { home, g, plan, design })
console.log(JSON.stringify({ ok: true, blueprint: rec.blueprint, B: g.B, design: rec.design ?? null, reservation: box, corner: rec.corner, baseY: rec.baseY, face: rec.face, cells: rec.cells.length,
  foundation: rec.cells.filter(c => c.seg === 'F').length, earthwork: rec.earthwork, clear: rec.clear.length, bom: rec.bom, avoided: newest.size, tried: s.tried, rejects: s.rejects }))
if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(rec))
