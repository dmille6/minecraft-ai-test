#!/usr/bin/env node
// CITYWALL STALL (11-10), OFFLINE: the citywall planner's DESIGN visit (skills.mjs buildCitywall, t.kind 'design') timed stage by stage on
// COPIES of the showcase's region files and pool state, with the bots' own functions -- the town walk (buildsite.mjs walkFrom), the
// design (citywall.mjs citywallDesign, its swap walk and reach checks inside), the escape proof (wall.mjs wallEscape) -- and the
// longest stretch the visit runs without giving the event loop a turn: live it was all of them (no await), `ms=15629-20509`.
//
//   node scripts/citywall-stall-offline.mjs <dump.json> <pool-state-dir> [--plot wallext] [--reps 3]
import fs from 'node:fs'
import { dumpReader } from './buildsite-offline.mjs'
import * as PJ from '../src/buildproj.mjs'
import { digStand as digStandOf } from '../src/buildrun.mjs'
import * as W from '../src/wall.mjs'
import * as CW from '../src/citywall.mjs'
import * as BS from '../src/buildsite.mjs'
import * as SHOPM from '../src/shop.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
const base = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const files = fs.readdirSync(poolDir)
const hk = files.map(f => /^project-([-\d_]+)\./.exec(f)?.[1]).find(Boolean)
const [hx, hy, hz] = hk.split('_').map(Number)
const home = { x: hx, y: hy, z: hz }
const head = plot => PJ.recordHead(poolDir, `project-${hk}.${plot}`).head?.rec ?? null
const PLOT = opt('plot', 'wallext')
const rec = head(PLOT)
const stood = SHOPM.stoodRead(poolDir, `project-${hk}.shop`, home)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))]
const takenSet = new Set()
for (const p of plots) { if (p === PLOT) continue; for (const c of head(p)?.cells ?? []) if (Array.isArray(c?.at)) takenSet.add(c.at.join(',')) }
const land = head('land')
const roads = new Set((land?.roads ?? []).flatMap(r => (r.cols ?? []).map(c => `${c[0]},${c[1]}`)))
const ms = f => { const a = performance.now(); const v = f(); return [v, performance.now() - a] }
for (let rep = 0; rep < Number(opt('reps', 3)); rep++) {
  const t = {}
  const walkNodes = new Map()
  let [ks, d1] = ms(() => BS.walkFrom(base, home, new Set(), W.wallWalkR(rec, home), { stood }))
  for (const k of ks) { const [x, y, z] = k.split(',').map(Number); const ck = `${x},${z}`; if (!walkNodes.has(ck)) walkNodes.set(ck, []); walkNodes.get(ck).push(y) }
  t.walk = d1
  let swN = null, swMs = 0, under = 0, underMs = 0, swaps = 0, swapMs = 0
  const swapNodes = () => { if (swN) return swN; const a = performance.now(); swN = new Map(); const oBlock = new Set(rec.cells.filter(q => ['wall', 'post', 'base'].includes(q.role)).map(q => q.at.join(','))); for (const k of BS.walkFrom(base, home, oBlock, W.wallWalkR(rec, home), { stood })) { const [x, y, z] = k.split(',').map(Number); const ck = `${x},${z}`; if (!swN.has(ck)) swN.set(ck, []); swN.get(ck).push(y) } swMs = performance.now() - a; return swN }
  const [design, d2] = ms(() => CW.citywallDesign(base, rec, { style: 'grey', seed: Number(rec.sitedAt ?? 0) >>> 0, gatePick: CW.citywallGatePick(process.env, PLOT),
    taken: (x, y, z) => takenSet.has(`${x},${y},${z}`), zone: (x, z) => roads.has(`${x},${z}`),
    reachUnder: at => { const a = performance.now(); const v = !!BS.stepFor(base, home, at, walkNodes, () => true, null); under++; underMs += performance.now() - a; return v },
    reachSwap: at => { const n = swapNodes(); const a = performance.now(); const v = !!digStandOf(base, at, n); swaps++; swapMs += performance.now() - a; return v } }))
  t.design = d2; t.design_swapwalk = swMs; t.design_reachUnder = `${under}x ${underMs.toFixed(0)}`; t.design_reachSwap = `${swaps}x ${swapMs.toFixed(0)}`
  t.design_rest = d2 - swMs - underMs - swapMs
  let escSlices = []
  if (design.ok) {
    const cells = [...rec.cells, ...design.cells], o = { r: W.wallWalkR(rec, home) + 8, seed: CW.walkSeed(base, stood) }
    const [esc, d3] = ms(() => W.wallEscape(base, home, cells, o))
    t.escape = d3; t.esc = `cut${esc.cut}/trap${esc.trapped}`
    // the breathing proof (wall.mjs wallEscapeAsync): each stretch between its pauses, and the same answer
    let at = performance.now()
    const escA = await W.wallEscapeAsync(base, home, cells, o, { pause: async () => { escSlices.push(performance.now() - at); await new Promise(r => setImmediate(r)); at = performance.now() } })
    escSlices.push(performance.now() - at)
    t.escape_async_same = JSON.stringify(escA) === JSON.stringify(esc)
    t.escape_slices = `${escSlices.length} slices, max ${Math.round(Math.max(...escSlices))}`
  } else t.why = design.why
  t.total = t.walk + t.design + (t.escape ?? 0)
  t.worst_before = t.total   // live: one macrotask (no await in the design visit)
  t.worst_after = Math.max(t.walk, t.design_swapwalk, t.design - t.design_swapwalk, ...escSlices)
  console.log(JSON.stringify(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v]))))
}
