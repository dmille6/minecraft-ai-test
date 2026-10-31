#!/usr/bin/env node
// THE TOWN TREE FARM, OFFLINE (treefarm-04): the bots' own siting (treefarm.mjs siteFarm, with the inputs skills.mjs farmInputs
// composes) run on COPIES of a world's region files and pool state, so where a town's farm goes -- its plots, lights, the trees
// it fells and its front -- is known before any bot sites it.
//
//   node scripts/treefarm-offline.mjs <dump.json> <pool-state-dir> [--torches N] [--species S] [--out record.json] [--map map.txt]
//
// <dump.json>: scripts/host/townplan_blockdump.py over COPIES of the region files (y home-14 .. home+28 at least). <pool-state-dir>:
// a COPY of /var/lib/mcai/_pool-<pool>. Nothing is written but --out and --map.
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { recordZones } from '../src/shop.mjs'
import { farmBlocked, farmBounds, siteFarm, TREEFARM_PLOT, farmPalette } from '../src/treefarm.mjs'
import { lightsFor } from '../src/treefarm.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: treefarm-offline.mjs <dump.json> <pool-state-dir> [--torches N] [--species S] [--out f] [--map f]'); process.exit(2) }
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
const read = dumpReader(dump)
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const gen = f => Number(/\.g(\d+)\./.exec(f)?.[1] ?? 0)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].filter(p => p !== TREEFARM_PLOT).sort()
const records = plots.map(plot => ({ plot, rec: recordHead(poolDir, `project-${hk}.${plot}`).head?.rec ?? null })).filter(r => r.rec)
const plinthRec = readJ(path.join(poolDir, `junkwell-plinth-${hk}.json`))
const caps = []
if (plinthRec?.plan?.cap) caps.push([plinthRec.plan.cap.x, plinthRec.plan.cap.y, plinthRec.plan.cap.z])
for (const w of R.wells) if (!caps.length && Array.isArray(w)) caps.push(w)
const comps = files.filter(f => f.startsWith(`composter-site-${hk}.g`)).sort((a, b) => gen(b) - gen(a))
const cs = comps.length ? readJ(path.join(poolDir, comps[0])) : null
const composter = cs && [cs.x, cs.y, cs.z].every(Number.isFinite) ? [cs.x, cs.y, cs.z] : ((plan.plots ?? []).find(p => p.kind === 'farm')?.composter ?? null)
const inputs = { plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, records: records.map(r => r.rec), pzones: recordZones(records.map(r => r.rec)) }
const species = opt('species', 'spruce_sapling')
const t0 = Date.now()
const s = siteFarm(read, { home, blocked: farmBlocked(inputs), bounds: farmBounds(inputs.records), lights: lightsFor(Number(opt('torches', 0)), 0), species })
const rec = s.record
console.log(JSON.stringify({
  ok: s.ok, why: s.why, tried: s.tried, ms: Date.now() - t0, projects: records.map(r => `${r.plot}:${r.rec.blueprint}`), bounds: farmBounds(inputs.records),
  ...(rec ? { box: rec.box, grid: rec.grid, anchor: rec.anchor, species: rec.species, counts: rec.counts, front: rec.front, bom: rec.bom,
    ys: [Math.min(...rec.cells.map(c => c.at[1])), Math.max(...rec.cells.map(c => c.at[1]))], trees: rec.trees.map(t => `${t.base.join(',')}x${t.logs.length}`),
    palette: farmPalette(rec.species).plot } : {}),
}, null, 1))
if (opt('out') && rec) fs.writeFileSync(opt('out'), JSON.stringify(rec))
if (opt('map') && rec) {
  const [bx0, bz0, bx1, bz1] = rec.box
  const roleAt = new Map(rec.cells.map(c => [`${c.at[0]},${c.at[2]}`, c.role]))
  const trees = new Set(rec.trees.flatMap(t => t.logs.map(p => `${p[0]},${p[2]}`)))
  const lines = []
  for (let z = bz0 - 3; z <= bz1 + 3; z++) {
    let l = ''
    for (let x = bx0 - 3; x <= bx1 + 3; x++) {
      const k = `${x},${z}`, r = roleAt.get(k)
      const inBox = x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1
      l += r === 'plot' || r === 'soil' ? 'P' : r === 'light' ? 'L' : rec.front.some(f => f[0] === x && f[1] === z) ? 'F' : trees.has(k) ? 'T' : inBox ? '.' : ' '
    }
    lines.push(l)
  }
  fs.writeFileSync(opt('map'), lines.join('\n') + '\n')
}
