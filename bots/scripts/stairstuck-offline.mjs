#!/usr/bin/env node
// STUCKCELLS-01, THE STAIR OFFLINE: the bots' own stair visit (shaftvisit.mjs runStairVisit) run by a fake builder on a COPY of a
// town's blocks and a COPY of its stair record, before (--off) and after the support chain. The fake's click is
// stairBotEffects' own rule: the nearest full, non-interactable neighbour face within 4.5 of the eye, else no_support / no_reach.
//
//   node scripts/stairstuck-offline.mjs <dump.json> <pool-state-dir> [--off] [--visits 6]
import fs from 'node:fs'
import { dumpReader } from './buildsite-offline.mjs'
import * as PJ from '../src/buildproj.mjs'
import * as G from '../src/shaftgeom.mjs'
import { runStairVisit } from '../src/shaftvisit.mjs'

const argv = process.argv.slice(2)
const flag = k => argv.includes(`--${k}`)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir] = argv
if (flag('off')) process.env.STUCKCELLS = 'off'
const base = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const pf = fs.readdirSync(poolDir).find(f => /^project-(-?\d+)_(-?\d+)_(-?\d+)\./.test(f))
const hm = /^project-(-?\d+)_(-?\d+)_(-?\d+)\./.exec(pf)
const home = { x: +hm[1], y: +hm[2], z: +hm[3] }
const rec = PJ.recordHead(poolDir, PJ.projKey(home, 'shaft')).head.rec
const over = new Map()
const read = (x, y, z) => over.get(`${x},${y},${z}`) ?? base(x, y, z)
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const INTERACTABLE = /chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|_bed$|_door$|_trapdoor$|_sign$|^composter$|_fence_gate$/
let feet = null
const rows = []
const plan = G.planOf(rec)
const e = {
  get read () { return read },
  feet: () => feet.slice(),
  walkTo: async c => { feet = c.slice(); return true },
  dig: async c => { over.set(c.join(','), { name: 'air', boundingBox: 'empty' }); return 'confirmed' },
  place: async c => {
    const refs = N6.map(([a, b, d]) => [c[0] + a, c[1] + b, c[2] + d]).filter(r => { const b = read(...r); return G.isFull(b) && !INTERACTABLE.test(b.name) })
    if (!refs.length) return 'no_support'
    const eye = [feet[0] + 0.5, feet[1] + 1.62, feet[2] + 0.5]
    const ok = refs.some(r => { const f = [c[0] - r[0], c[1] - r[1], c[2] - r[2]]; return Math.hypot(r[0] + 0.5 + f[0] * 0.5 - eye[0], r[1] + 0.5 + f[1] * 0.5 - eye[1], r[2] + 0.5 + f[2] * 0.5 - eye[2]) <= 4.5 })
    if (!ok) return 'no_reach'
    over.set(c.join(','), { name: 'cobblestone', boundingBox: 'block' })
    return 'confirmed'
  },
  toolOk: () => true, fence: () => true, log: (op, d) => rows.push({ op, ...d }), now: () => 0, aborted: () => false,
}
const k0 = G.firstUndone(read, plan)
const stops = []
for (let v = 0; v < Number(opt('visits', 6)); v++) {
  feet = rec.exit ?? G.collarExit(read, rec.site) ?? [home.x, home.y, home.z]
  const r = await runStairVisit({ rec, exit: feet, built: new Set(), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} }, e, { unitsMax: 400 })
  stops.push(`${r.stop}@${r.k}:+${r.placed}p/${r.dug}d`)
  if (r.stop === 'complete') break
}
const k1 = G.firstUndone(read, plan)
console.log(JSON.stringify({ mode: flag('off') ? 'off' : 'on', K: rec.K, before: k0, after: k1, stops: stops.join(' '), supports: rows.filter(q => /support/.test(String(q.why))).length, refused: rows.filter(q => q.op === 'refused').slice(-3).map(q => `${q.at}:${q.why}`) }))
