#!/usr/bin/env node
// STANDCACHE-01, THE MEASUREMENT (11-12; not a test -- run it on the host whose cost you want: `node scripts/standbench.mjs` from bots/).
// A. what ONE walk of the town costs (buildsite.mjs walkFrom) at walkR 48 / 72 / 96 / 136, over a 100-block walled town on rolling
//    ground with trees: through a Map read (the tests' fake) and through a REAL prismarine world read the way the bot reads it
//    (buildbot.mjs botBuildEffects `read` over mineflayer's blockAt); and what the kept walk costs (walkFrom `graph`, walkAgain).
// B. how many walks one tidy visit makes (buildrun.mjs runVisit) on a record of the live tidy's size -- 1,661 segments, ~4,900
//    cells, M open holes, then K cells no stand reaches -- with the kept walk and with STANDCACHE off, and the time between rows.
// NSEG / K / M / WALKR / DIRFILES (lease files already in the project directory) set part B's size.
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const B = await import('../src/buildsite.mjs')
const { bot, PJ, R } = await import('../test/helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const { Vec3 } = require('vec3')

const G = 69, HOME = { x: 0, y: G + 1, z: 0 }, HALF = 150
const roll = (x, z) => Math.round(2.5 * Math.sin(x / 9) + 2 * Math.cos(z / 11) + 1.5 * Math.sin((x + z) / 17))
const hAt = (x, z) => G + (Math.max(Math.abs(x), Math.abs(z)) <= 12 ? 0 : roll(x, z))
const wallAt = (x, z) => Math.max(Math.abs(x), Math.abs(z)) === 50 && !(Math.abs(x) <= 1 || Math.abs(z) <= 1)
const treeAt = (x, z) => ((x * 73856093) ^ (z * 19349663)) % 23 === 0 && Math.max(Math.abs(x), Math.abs(z)) > 14
const nameAt = (x, y, z) => {
  if (Math.abs(x) > HALF || Math.abs(z) > HALF || y < G - 24 || y > G + 40) return null
  const h = hAt(x, z)
  if (y < h) return 'stone'
  if (y === h) return 'grass_block'
  if (wallAt(x, z) && y <= h + 5) return 'cobblestone'
  if (treeAt(x, z) && y <= h + 5) return 'oak_log'
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (treeAt(x + dx, z + dz) && y >= hAt(x + dx, z + dz) + 4 && y <= hAt(x + dx, z + dz) + 6) return 'oak_leaves'
  return 'air'
}
const NAMES = ['stone', 'grass_block', 'cobblestone', 'oak_log', 'oak_leaves', 'air', 'dirt']
const OBJ = Object.fromEntries(NAMES.map(name => [name, Object.freeze({ name, boundingBox: name === 'air' ? 'empty' : 'block' })]))
const cells = new Map()
for (let x = -HALF; x <= HALF; x++) for (let z = -HALF; z <= HALF; z++) for (let y = G - 8; y <= G + 16; y++) cells.set(`${x},${y},${z}`, nameAt(x, y, z))
let reads = 0
const fakeRead = (x, y, z) => { reads++; const n = cells.get(`${x},${y},${z}`); return n ? OBJ[n] : (Math.abs(x) > HALF || Math.abs(z) > HALF ? null : OBJ[y < G ? 'stone' : 'air']) }
// the REAL prismarine world (the bot's own classes), the same terrain
const registry = require('prismarine-registry')('1.21.8')
const Chunk = require('prismarine-chunk')(registry)
const world = new (require('prismarine-world')(registry))(null).sync
const sid = Object.fromEntries(NAMES.map(n => [n, registry.blocksByName[n].defaultState]))
for (let cx = Math.floor(-HALF / 16); cx <= Math.floor(HALF / 16); cx++) for (let cz = Math.floor(-HALF / 16); cz <= Math.floor(HALF / 16); cz++) {
  const ch = new Chunk({ minY: -64, worldHeight: 384 })
  for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) for (let y = G - 24; y <= G + 20; y++) { const n = nameAt(cx * 16 + lx, y, cz * 16 + lz) ?? (y < G ? 'stone' : 'air'); if (n !== 'air') ch.setBlockStateId(new Vec3(lx, y, lz), sid[n]) }
  world.setColumn(cx, cz, ch, false)
}
const paintingsByPos = {}
const blockAt = p => { const block = world.getBlock(p); if (!block) return null; block.painting = paintingsByPos[block.position]; return block }   // mineflayer blocks.js blockAt
const liveRead = (x, y, z) => { reads++; const b = blockAt(new Vec3(x, y, z)); if (!b) return null; return { name: b.name, boundingBox: b.boundingBox, get props () { try { return b.getProperties?.() ?? null } catch { return null } } } }   // buildbot.mjs read
const med = (fn, n = 3) => { const ms = []; let out; for (let i = 0; i < n; i++) { const t0 = performance.now(); out = fn(); ms.push(performance.now() - t0) } ms.sort((a, b) => a - b); return { ms: ms[n >> 1], out } }

console.log('A. ONE WALK OF THE TOWN (median of 3)')
{ const a = B.walkFrom(fakeRead, HOME, new Set(), 72), b = B.walkFrom(liveRead, HOME, new Set(), 72); console.log(`   control: the Map read and the prismarine read walk the same town: ${a.size} nodes, same=${a.size === b.size && [...a].every(k => b.has(k))}`) }
for (const [label, read] of [['Map read       ', fakeRead], ['prismarine read', liveRead]]) for (const r of [48, 72, 96, 136]) {
  reads = 0; const w = med(() => B.walkFrom(read, HOME, new Set(), r)); const n = reads / 3
  console.log(`   ${label} walkR ${String(r).padStart(3)}: ${w.ms.toFixed(0).padStart(5)} ms, ${String(w.out.size).padStart(6)} nodes, ${String(n).padStart(8)} block reads, ${(w.ms * 1000 / n).toFixed(2)} us a read`)
}
for (const r of [72, 96]) {
  const graph = {}
  const kept = med(() => B.walkFrom(liveRead, HOME, new Set(), r, { graph }))
  const far = new Set(['30,40,30']), on = new Set([`30,${hAt(30, 30) + 1},30`, `31,${hAt(31, 30) + 1},30`]), town = new Set([`5,${G + 1},5`])
  reads = 0
  const a = med(() => B.walkAgain(graph, liveRead, HOME, far, r)), b = med(() => B.walkAgain(graph, liveRead, HOME, on, r)), r1 = reads
  const c = med(() => B.walkAgain(graph, liveRead, HOME, town, r)), r2 = reads
  const same = [[far, a], [on, b], [town, c]].every(([blk, m]) => { const w = [...B.walkFrom(liveRead, HOME, blk, r)], g = [...m.out]; return w.length === g.length && w.every((k, i) => k === g[i]) })
  console.log(`   the kept walk, walkR ${r}: ${kept.ms.toFixed(0)} ms with its steps kept; an obstacle set's walk from it: ${a.ms.toFixed(2)} ms (touches nothing), ${b.ms.toFixed(1)} ms (on the walk), ${r1} block reads; ${c.ms.toFixed(1)} ms inside the town circle (${Math.round((r2 - r1) / 3)} block reads: the seeds chosen again); all three equal walkFrom: ${same}`)
}

console.log('B. ONE TIDY VISIT')
const NSEG = Number(process.env.NSEG ?? 1661), K = Number(process.env.K ?? 8), M = Number(process.env.M ?? 4), WALKR = Number(process.env.WALKR ?? 72)
async function visit (standCache) {
  const done = []
  const srv = { read: liveRead, cells: new Map(), placedAt: new Map(), seen: new Map(), set: (a, n) => { done.push(a); world.setBlockStateId(new Vec3(a[0], a[1], a[2]), sid[n]) } }
  // DONE segments sit in the ground; M OPEN ones are 1-deep holes; K SEALED ones are air pockets 6 under the grass, last (grounds2's order)
  const cellsR = [], segs = [], spots = []
  for (let x = -44; x <= 44; x += 2) for (let z = -44; z <= 44; z += 2) if (Math.max(Math.abs(x), Math.abs(z)) > 6) spots.push([x, z])
  let si = 0
  const seg = (name, kind) => {
    segs.push({ seg: name, deps: [] })
    const [x, z] = spots[si++ % spots.length], h = hAt(x, z), top = kind === 'sealed' ? h - 6 : h
    if (kind !== 'done') srv.set([x, top, z], 'air')
    for (let i = 0; i < 3; i++) cellsR.push({ at: [x, top - i, z], role: 'earth', seg: name })
  }
  const every = Math.floor((NSEG - K - M) / Math.max(1, M))
  for (let i = 0, o = 0; i < NSEG - K - M; i++) { if (o < M && i % every === 0) seg(`O${o++}`, 'open'); seg(`D${i}`, 'done') }
  for (let i = 0; i < K; i++) seg(`S${i}`, 'sealed')
  const rec = { v: 1, r: WALKR - 8, cells: cellsR, segments: segs, clear: [], replant: [] }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'standbench-')), key = PJ.projKey(HOME, 'tidy')
  for (let i = 0; i < Number(process.env.DIRFILES ?? 0); i++) fs.writeFileSync(path.join(dir, `${key}.seg-X${i % 1661}.lease.g${Math.floor(i / 1661) + 1}.json.released`), '1')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec })), slot = PJ.takeSlot(dir, key, 'A', 1)
  let walks = 0, walkReads = 0
  const stood = []; stood[Symbol.iterator] = function * () { walks++ }   // walkFrom iterates `stood` once a run
  const e = bot(srv, 'A', { inv: { dirt: 64, cobblestone: 64 }, feet: [0, hAt(0, 0) + 1, 0] })
  const t0 = performance.now(), marks = [], log0 = e.log
  e.log = (k, d) => { if (k === '_build' && (d.op === 'deferred' || d.op === 'place')) marks.push({ op: d.op, ms: performance.now() - t0, walks, walkReads }); log0(k, d) }
  let worst = 0, last = performance.now()
  const iv = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last - 10); last = n }, 10)
  const r = await R.runVisit({ dir, key, me: 'A', home: HOME, stood, record: rec, tidy: [], recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: T.tidyWalkR(rec), blockLayer: false, clearMax: 4, alsoDone: () => false, stuckStalledOnly: true, tidyKeepOrder: true, deferSpent: true, replantGoOn: true, replantPerTree: true, intoWater: true, skipOpenDeps: true,
    segOk: () => true, segYield: () => false, walkRead: rd => (x, y, z) => { walkReads++; return rd(x, y, z) } }, e, { maxSteps: 400, standCache })
  clearInterval(iv)
  const total = performance.now() - t0
  console.log(`   STANDCACHE ${standCache ? 'on ' : 'off'}: ${segs.length} segments, ${cellsR.length} cells, walkR ${T.tidyWalkR(rec)}: stop=${r.stop} placed=${r.placed} deferred=${(r.deferred ?? []).length} in ${total.toFixed(0)} ms; ${walks} walkFrom runs, ${walkReads} block reads by the walks; longest event-loop block ${worst.toFixed(0)} ms`)
  let prev = { ms: 0, walks: 0, walkReads: 0 }
  for (const m of marks) { console.log(`      ${m.op.padEnd(8)} +${(m.ms - prev.ms).toFixed(0).padStart(5)} ms  walkFrom +${m.walks - prev.walks}  block reads +${m.walkReads - prev.walkReads}`); prev = m }
  for (const a of done) world.setBlockStateId(new Vec3(a[0], a[1], a[2]), sid[nameAt(...a) ?? 'air'])   // the world as it was, for the next run
  fs.rmSync(dir, { recursive: true, force: true })
}
await visit(false)
await visit(true)
process.exit(0)
