#!/usr/bin/env node
// THE TOWN'S PATHS, OFFLINE (paths-01): the bots' own siting (paths.mjs sitePaths) run on COPIES of a world's region files and pool
// state, so where a town's paths go -- and what they cost -- is known before any bot sites them. The same function a bot runs at its
// first paths visit (skills.mjs buildPaths).
//
//   node scripts/pathsite-offline.mjs <dump.json> <pool-state-dir> [--out record.json] [--svg map.svg]
//
// <dump.json> is scripts/host/townplan_blockdump.py's output over COPIES of the region files (read-only; a box covering the town,
// y home-12 .. home+26). <pool-state-dir> is a COPY of /var/lib/mcai/_pool-<pool>: the town plan's generations, protected-zones.json,
// the junk-well records, the composter site and every project-<home>.<plot>.g<N>.json. Nothing is written but --out and --svg.
import fs from 'node:fs'
import path from 'node:path'
import { dumpReader, poolRecords, readJson } from './buildsite-offline.mjs'
import { loadBlueprint, placeBlueprint } from '../src/buildsite.mjs'
import { recordHead } from '../src/buildproj.mjs'
import * as P from '../src/paths.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: pathsite-offline.mjs <dump.json> <pool-state-dir> [--out record.json] [--svg map.svg]'); process.exit(2) }
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
const read = dumpReader(dump)
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
// every project's record HEAD (buildproj's own chain walk), but never the paths' own
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].filter(p => p !== P.PATHS_PLOT).sort()
const projects = plots.map(plot => {
  const h = recordHead(poolDir, `project-${hk}.${plot}`)
  const rec = h.ok ? h.head?.rec ?? null : null
  let bp = null
  try { if (rec?.blueprint && rec.blueprint !== 'ziggurat@1') bp = loadBlueprint(rec.blueprint) } catch { bp = null }
  return { plot, rec, bp }
}).filter(p => p.rec)
const plinthRec = readJson(path.join(poolDir, `junkwell-plinth-${hk}.json`))
const gen = f => Number(/\.g(\d+)\./.exec(f)?.[1] ?? 0)
const sites = files.filter(f => f.startsWith(`junkwell-site-${hk}.g`)).sort((a, b) => gen(b) - gen(a))
const site = sites.length ? readJson(path.join(poolDir, sites[0])) : null
const caps = []
if (plinthRec?.plan?.cap) caps.push([plinthRec.plan.cap.x, plinthRec.plan.cap.y, plinthRec.plan.cap.z])
if (site && [site.x, site.y, site.z].every(Number.isFinite) && !caps.some(c => c[0] === site.x && c[2] === site.z)) caps.push([site.x, site.y, site.z])
const plinth = R.wells
const comps = files.filter(f => f.startsWith(`composter-site-${hk}.g`)).sort((a, b) => gen(b) - gen(a))
const cs = comps.length ? readJson(path.join(poolDir, comps[0])) : null
const composter = cs && [cs.x, cs.y, cs.z].every(Number.isFinite) ? [cs.x, cs.y, cs.z] : ((plan.plots ?? []).find(p => p.kind === 'farm')?.composter ?? null)
const t0 = Date.now()
// --extend <record.json>: the extension a bot runs on a laid network (paths.mjs extendPaths), printed and written to --out
if (opt('extend')) {
  const base = JSON.parse(fs.readFileSync(opt('extend'), 'utf8'))
  const x = P.extendPaths(read, base, { plan, zones: R.zones, caps, plinth, composter, farm: R.farm, projects, place: placeBlueprint })
  const nc = x.record ? x.record.cells.slice(base.cells.length) : []
  console.log(JSON.stringify({ ok: x.ok, why: x.why, added: x.added, newCells: nc.map(c => `${c.at.join(',')}:${c.role}:${c.seg}`), newClear: x.record ? x.record.clear.filter(c => !base.clear.some(q => q.at.join(',') === c.at.join(','))) : [], legs: x.record?.legs?.slice(base.legs.length), maxStep: x.record?.maxStep }, null, 1))
  if (opt('out') && x.record) fs.writeFileSync(opt('out'), JSON.stringify(x.record))
  process.exit(0)
}
const s = P.sitePaths(read, { plan, zones: R.zones, caps, plinth, composter, farm: R.farm, projects, place: placeBlueprint })
const ms = Date.now() - t0
const rec = s.record
const summary = {
  ok: s.ok, why: s.why, ms, plan: { gen: R.head.gen, paths: (plan.paths ?? []).map(p => `${p.id}:${p.seg.join(',')}`) },
  projects: projects.map(p => `${p.plot}:${p.rec.blueprint}:${p.rec.structure_complete ? 'complete' : 'open'}`), caps, composter,
  dests: (s.dests ?? []).map(d => `${d.id}:${d.cols.slice(0, 3).map(c => c.join(',')).join(' ')}${d.cols.length > 3 ? ` +${d.cols.length - 3}` : ''}`),
  legs: (s.net?.legs ?? []).map(l => ({ id: l.id, ok: l.ok, why: l.why, join: l.join, brushes: l.nodes.length, cost: l.cost })),
  ...(rec ? { cells: rec.cells.length, segments: rec.segments.length, clear: rec.clear.length, clearKinds: rec.clear.reduce((m, c) => (m[c.kind] = (m[c.kind] ?? 0) + 1, m), {}), surface: rec.surface, bom: rec.bom, maxStep: rec.maxStep, zones: rec.zones.length,
    ys: [Math.min(...rec.cells.map(c => c.at[1])), Math.max(...rec.cells.map(c => c.at[1]))] } : {}),
}
console.log(JSON.stringify(summary, null, 1))
if (opt('out') && rec) fs.writeFileSync(opt('out'), JSON.stringify(rec))
// THE MAP: the dump's top surface (by block family) with the record's cells over it, the destinations, the other projects and the hub
if (opt('svg')) {
  const [x0, z0, x1, z1] = dump.box, S = 8
  const W = (x1 - x0 + 1) * S, H = (z1 - z0 + 1) * S
  const colour = n => /leaves/.test(n) ? '#2f5d34' : /_log/.test(n) ? '#5b3a1e' : n === 'grass_block' ? '#7fb24f' : /dirt/.test(n) ? '#8a6a45' : /sand/.test(n) ? '#dccf96'
    : /^(stone|andesite|diorite|granite|tuff|gravel)$/.test(n) ? '#8d8d8d' : n === 'cobblestone' ? '#6e6e6e' : /brick|planks|glass|copper/.test(n) ? '#b07a4a' : /chest|table|furnace|composter/.test(n) ? '#d23' : /water/.test(n) ? '#3a6fd8' : '#aaa'
  const PLANT = /^(air|cave_air|short_grass|tall_grass|fern|large_fern|snow.*|.*_sapling|brown_mushroom|sweet_berry_bush|wall_torch|torch|dandelion|poppy)$/
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 40}" viewBox="0 0 ${W} ${H + 40}" font-family="monospace" font-size="11">\n<rect width="100%" height="100%" fill="#222"/>\n`
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    let n = '?'
    for (let y = dump.y[1]; y >= dump.y[0]; y--) { const b = read(x, y, z); if (!b) break; if (PLANT.test(b.name)) continue; n = b.name; break }
    out += `<rect x="${(x - x0) * S}" y="${(z - z0) * S}" width="${S}" height="${S}" fill="${colour(n)}" opacity="0.75"/>`
  }
  out += '\n'
  for (const p of projects) for (const c of p.rec.cells) out += `<rect x="${(c.at[0] - x0) * S}" y="${(c.at[2] - z0) * S}" width="${S}" height="${S}" fill="none" stroke="#ffd34d" stroke-width="0.6"/>`
  if (rec) for (const c of rec.cells) out += `<rect x="${(c.at[0] - x0) * S + 1}" y="${(c.at[2] - z0) * S + 1}" width="${S - 2}" height="${S - 2}" fill="${{ use: '#e9c46a', done: '#cfcfcf', pave: '#ff7f50' }[P.surfaceNeed(read(...c.at)?.name ?? '')]}"/>`
  if (rec) for (const c of rec.clear.filter(q => q.kind === 'tree')) out += `<circle cx="${(c.at[0] - x0) * S + S / 2}" cy="${(c.at[2] - z0) * S + S / 2}" r="2" fill="#5b3a1e"/>`
  for (const d of s.dests ?? []) for (const [x, z] of d.cols) out += `<rect x="${(x - x0) * S}" y="${(z - z0) * S}" width="${S}" height="${S}" fill="none" stroke="#ff2bd6" stroke-width="1.5"/>`
  for (const d of s.dests ?? []) { const [x, z] = d.cols[0]; out += `<text x="${(x - x0) * S + 10}" y="${(z - z0) * S}" fill="#fff" stroke="#000" stroke-width="0.4">${d.id}</text>` }
  const core = (plan.plots ?? []).find(p => p.id === 'core').box
  out += `<rect x="${(core[0] - x0) * S}" y="${(core[1] - z0) * S}" width="${(core[2] - core[0] + 1) * S}" height="${(core[3] - core[1] + 1) * S}" fill="none" stroke="#fff" stroke-dasharray="4 3"/>`
  out += `<text x="${(core[0] - x0) * S + 4}" y="${(core[1] - z0) * S + 14}" fill="#fff">core</text>`
  out += `<text x="6" y="${H + 16}" fill="#ddd">paths-01 record (offline, showcase region copy): ${rec ? `${rec.cells.length} cells, ${rec.segments.length} segments, max step ${rec.maxStep}` : s.why}. north up; x ${x0}..${x1}, z ${z0}..${z1}</text>`
  out += `<text x="6" y="${H + 32}" fill="#ddd">yellow = grass/dirt (shovel to dirt_path), grey = stone kept, orange = paved with cobblestone, brown dot = trunk felled, magenta = destination, outline = project records</text>`
  out += '\n</svg>\n'
  fs.writeFileSync(opt('svg'), out)
}
