#!/usr/bin/env node
// STANDREPLAY, OFFLINE (stepclass-01 / civicvisit-01show): WHY EACH STUCK CELL HAS NO STAND, by the bots' own stand search
// (buildsite.mjs walkFrom + stepFor + stepRefusal) over a COPY of the world's blocks. The acceptance check to run before and after a
// fix for stuck cells: the same input, the same lines, the counts moved.
//
//   node scripts/standreplay-offline.mjs <dump.json> <standin.json> --home X Y Z [--mc 1.21.8] [--radius 48] [--far 96]
//                                        [--any plot,plot] [--ex 3] [--json out.json]
//
// <dump.json>    scripts/host/townplan_blockdump.py's output over COPIES of the region files (read-only).
// <standin.json> scripts/host/standprep.py's output: { projects: { <plot>: { box, walkR, waived, blueprint?, standDom?, domain?,
//                cells: [{ c: [x, y, z], visits, role?, seg?, blind? }] } }, stood: [[x, y, z]] } -- the cells on the pool's stuck files
//                and the feet cells the bots logged in town (the walk's seeds).
// --radius       the walk radius of a visit that names none (buildsite.mjs WALK_R); --far the counterfactual's wider radius
// --any          plots whose visit takes a stand anywhere (`domain: () => true` in skills.mjs: tidy, the walls, the paths, ...); a
//                project may also say so itself (`domain: "any"` in the input). --ex: example cells a line (0: none).
//
// THE RULE EACH PROJECT IS REPLAYED UNDER is the visit's own where a pure function of the record gives it (civic.mjs civicVisitOpts,
// cottage.mjs cottageVisitOpts, townhall, enchantshop, storehub -- so CIVICVISIT=off replays a landmark as it was visited before),
// `any` for the plots named so, else the workshop ring and --radius. The header line of each project names it. A project visited
// under another rule this tool does not know (the monument's box + 6) reads as `ring`: list it in --any or read its lines with that
// in mind. A state-bearing cell is replayed without its state (only `blind` is carried): a little optimistic.
//
// OUTPUT (stable, one fact a line, cells and projects in sorted order):
//   standreplay v1 home=X,Y,Z mc=V stood=N walk<radius>=N walk<far>=N
//   project <plot> cells=N box=.. waived=N domain=<record|any|ring> walkR=N
//   <plot> class <class> N [e.g. x,y,z | ...]     the visit's own answer: `stale` (the cell already holds a block), `has_step`, or
//                                                  stepRefusal's class (no_support, support_closed, no_node, own_cell, out_of_domain,
//                                                  out_of_reach, wrong_side, no_sight)
//   <plot> fix <key> N [e.g. ...]                  what would give the cell a stand, the first that does:
//       stale            nothing: the stuck file is stale          none_needed   it has a stand under the visit's rule now
//       ring_off         the domain not required                   radius_far    the domain not required and the walk out to --far
//       rests_on_stuck   no block to click yet: a block it would click is another stuck cell of the project
//       no_support       no block to click at all (in air or water)             no_walk  nothing walkable within 5 columns
//       blind            in reach; the sight line or the face's side is in the way (a reach-only click would do)
//       raise_1_3 / raise_4_10   only from that many blocks above a walkable spot (a temporary stand)
//       lower            only from below a walkable spot (a dug-in stand)        enclosed  none of these
//   <plot> stuck N of M                            cells with neither a block nor a stand under the visit's rule
// Nothing is written but --json (the same facts as one object).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { dumpReader } from './buildsite-offline.mjs'
import { walkFrom, stepFor, stepRefusal, refUsable, WALK_R, STEP_CLASSES } from '../src/buildsite.mjs'
import { civicVisitOpts } from '../src/civic.mjs'
import { cottageVisitOpts } from '../src/cottage.mjs'
import { townhallVisitOpts } from '../src/townhall.mjs'
import { enchantVisitOpts } from '../src/enchantshop.mjs'
import { hubVisitOpts } from '../src/storehub.mjs'

const k3 = (x, y, z) => `${x},${y},${z}`, k2 = (x, z) => `${x},${z}`
const byCol = keys => { const m = new Map(); for (const key of keys) { const [x, y, z] = key.split(',').map(Number); const c = k2(x, z); if (!m.has(c)) m.set(c, []); m.get(c).push(y) } return m }
const SUP = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
const ANY = () => true
const raise = (nodes, h) => { const m = new Map(); for (const [c, ys] of nodes) m.set(c, ys.map(y => y + h)); return m }
export const CLASS_ORDER = Object.freeze(['stale', 'has_step', ...STEP_CLASSES])
export const FIX_ORDER = Object.freeze(['stale', 'none_needed', 'ring_off', 'radius_far', 'rests_on_stuck', 'no_support', 'no_walk', 'blind', 'raise_1_3', 'raise_4_10', 'lower', 'enclosed'])

/** THE VISIT'S RULE for a project -> { domain: fn | null (the ring), walkR, name }. Pure. */
export function visitRule (plot, P, { any = [], radius = WALK_R } = {}) {
  const rec = { blueprint: P.blueprint, box: P.box, walkR: P.walkR, standDom: P.standDom, home: P.home }
  for (const f of [civicVisitOpts, cottageVisitOpts, townhallVisitOpts, enchantVisitOpts, hubVisitOpts]) {
    const o = f(rec)
    if (typeof o?.domain === 'function') return { domain: o.domain, walkR: Number.isFinite(o.walkR) ? o.walkR : radius, name: 'record' }
  }
  if (P.domain === 'any' || any.includes(plot)) return { domain: ANY, walkR: Number.isFinite(P.visitWalkR) ? P.visitWalkR : radius, name: 'any' }
  return { domain: null, walkR: Number.isFinite(P.visitWalkR) ? P.visitWalkR : radius, name: 'ring' }
}

/**
 * THE REPLAY -> { home, stood, walks: { near, far }, radius, far, projects: [{ plot, cells, box, waived, rule, walkR, classes: { class:
 * [cell] }, fixes: { key: [cell] }, stuck }] }. Pure over `read`. `inp` = standprep.py's object.
 */
export function replayStands (read, home, inp, { radius = WALK_R, far = 96, any = [], maxRaise = 10 } = {}) {
  const stood = inp.stood ?? []
  const out = { home, stood: stood.length, radius, far, walks: { near: walkFrom(read, home, new Set(), radius, { stood }).size, far: walkFrom(read, home, new Set(), far, { stood }).size }, projects: [] }
  const cmp = (a, b) => a.c[0] - b.c[0] || a.c[1] - b.c[1] || a.c[2] - b.c[2]
  for (const plot of Object.keys(inp.projects ?? {}).sort()) {
    const P = inp.projects[plot]
    const cells = [...(P.cells ?? [])].filter(c => Array.isArray(c?.c) && c.c.length === 3).sort(cmp)
    if (!cells.length) continue
    const rule = visitRule(plot, P, { any, radius })
    // the stuck cells are still to place: obstacles to the walk and never its floor, as in the visit
    const block = new Set(cells.map(c => k3(...c.c)))
    const walkOf = new Map()
    const nodesAt = r => { if (!walkOf.has(r)) walkOf.set(r, byCol(walkFrom(read, home, block, r, { stood }))); return walkOf.get(r) }
    const nNow = nodesAt(rule.walkR), nFar = nodesAt(Math.max(far, rule.walkR))
    const classes = {}, fixes = {}
    const add = (m, k, c) => { (m[k] ??= []).push(c.c) }
    let stuck = 0
    for (const c of cells) {
      const [cx, cy, cz] = c.c, want = c.blind ? { blind: true } : null
      const now = read(cx, cy, cz)
      if (now && now.boundingBox === 'block') { add(classes, 'stale', c); add(fixes, 'stale', c); continue }
      const why = stepRefusal(read, home, c.c, nNow, rule.domain, want)
      add(classes, why ? why.class : 'has_step', c)
      if (!why) { add(fixes, 'none_needed', c); continue }
      stuck++
      if (stepFor(read, home, c.c, nNow, ANY, want)) { add(fixes, 'ring_off', c); continue }
      if (stepFor(read, home, c.c, nFar, ANY, want)) { add(fixes, 'radius_far', c); continue }
      if (!SUP.some(([a, b, d]) => refUsable(read(cx + a, cy + b, cz + d)))) { add(fixes, SUP.some(([a, b, d]) => block.has(k3(cx + a, cy + b, cz + d))) ? 'rests_on_stuck' : 'no_support', c); continue }
      let near = 0
      for (let dx = -5; dx <= 5 && !near; dx++) for (let dz = -5; dz <= 5 && !near; dz++) near += (nFar.get(k2(cx + dx, cz + dz)) ?? []).length
      if (!near) { add(fixes, 'no_walk', c); continue }
      if (stepFor(read, home, c.c, nFar, ANY, { blind: true })) { add(fixes, 'blind', c); continue }
      let h = null
      for (let k = 1; k <= maxRaise && h == null; k++) if (stepFor(read, home, c.c, raise(nFar, k), ANY, want)) h = k
      for (let k = 1; k <= maxRaise && h == null; k++) if (stepFor(read, home, c.c, raise(nFar, -k), ANY, want)) h = -k
      add(fixes, h == null ? 'enclosed' : h < 0 ? 'lower' : h <= 3 ? 'raise_1_3' : 'raise_4_10', c)
    }
    out.projects.push({ plot, cells: cells.length, box: P.box ?? null, waived: Number(P.waived) || 0, rule: rule.name, walkR: rule.walkR, classes, fixes, stuck })
  }
  return out
}

/** THE LINES of a replay (the tool's whole output) -> [string]. Pure. */
export function replayLines (r, { ex = 3, mc = '1.21.8' } = {}) {
  const eg = cells => (ex > 0 && cells.length ? ` e.g. ${cells.slice(0, ex).map(c => c.join(',')).join(' | ')}` : '')
  const lines = [`standreplay v1 home=${r.home.x},${r.home.y},${r.home.z} mc=${mc} stood=${r.stood} walk${r.radius}=${r.walks.near} walk${r.far}=${r.walks.far}`]
  for (const p of r.projects) {
    lines.push(`project ${p.plot} cells=${p.cells} box=${Array.isArray(p.box) ? p.box.join(',') : '-'} waived=${p.waived} domain=${p.rule} walkR=${p.walkR}`)
    for (const k of CLASS_ORDER) if (p.classes[k]) lines.push(`${p.plot} class ${k} ${p.classes[k].length}${eg(p.classes[k])}`)
    for (const k of FIX_ORDER) if (p.fixes[k]) lines.push(`${p.plot} fix ${k} ${p.fixes[k].length}${eg(p.fixes[k])}`)
    lines.push(`${p.plot} stuck ${p.stuck} of ${p.cells}`)
  }
  return lines
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (isMain) {
  const argv = process.argv.slice(2)
  const flag = (name, n = 1) => { const i = argv.indexOf(name); return i < 0 ? null : argv.slice(i + 1, i + 1 + n) }
  const [dumpPath, inPath] = argv
  const h = flag('--home', 3)
  if (!dumpPath || !inPath || dumpPath.startsWith('--') || inPath.startsWith('--') || !h || h.length !== 3 || !h.every(v => Number.isFinite(Number(v)))) {
    console.error('usage: standreplay-offline.mjs <dump.json> <standin.json> --home X Y Z [--mc 1.21.8] [--radius 48] [--far 96] [--any plot,plot] [--ex 3] [--json out.json]')
    process.exit(2)
  }
  const num = (name, d) => { const v = flag(name)?.[0]; return v == null ? d : Number(v) }
  const mc = flag('--mc')?.[0] ?? '1.21.8'
  const data = mc === '1.21.8' ? undefined : createRequire(import.meta.url)('minecraft-data')(mc)
  if (mc !== '1.21.8' && !data) { console.error(`unknown minecraft version ${mc}`); process.exit(2) }
  const home = { x: Number(h[0]), y: Number(h[1]), z: Number(h[2]) }
  const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')), data)
  const inp = JSON.parse(fs.readFileSync(inPath, 'utf8'))
  const r = replayStands(read, home, inp, { radius: num('--radius', WALK_R), far: num('--far', 96), any: (flag('--any')?.[0] ?? '').split(',').filter(Boolean) })
  for (const l of replayLines(r, { ex: num('--ex', 3), mc })) console.log(l)
  const out = flag('--json')?.[0]
  if (out) fs.writeFileSync(out, JSON.stringify({ mc, ...r }, null, 1) + '\n')
}
