#!/usr/bin/env node
// floatclean-replay.mjs -- floatclean-01show: THE LAP REPLAYED OFFLINE on the real blocks (before any rig): the list's first cells over
// a READ-ONLY region copy, worked by the REAL visit loop (buildrun.mjs runVisit with the lap's own options: the list's order, no
// stand on a listed cell, floatClearOk at the dig), each walk driven by the REAL mineflayer-pathfinder under prismarine-physics
// (wellstand-replay.mjs fakeBot: canDig off, no scaffold, no parkour -- the town walk), digs instant. Prints each lap's dug / set
// aside and where the body went.
//
//   node scripts/floatclean-replay.mjs --region <dir> --list <floatclean.json> --from x,y,z [--laps 6] [--area stepwell]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadRegion, reader } from './wellsite-replay.mjs'
import { worldOf, fakeBot, walkTo } from './wellstand-replay.mjs'
import { runVisit } from '../src/buildrun.mjs'
import * as PJ from '../src/buildproj.mjs'
import * as F from '../src/floatclean.mjs'

const args = process.argv.slice(2)
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const chunks = new Map()
for (const f of fs.readdirSync(opt('--region')).filter(n => /^r\.-?\d+\.-?\d+\.mca$/.test(n))) for (const [k, v] of loadRegion(path.join(opt('--region'), f))) chunks.set(k, v)
const base = reader(chunks)
const overlay = {}
const read = (x, y, z) => { const o = overlay[`${x},${y},${z}`]; return o ? { name: o, boundingBox: 'empty', props: null } : base(x, y, z) }
const doc = JSON.parse(fs.readFileSync(opt('--list'), 'utf8'))
const area = opt('--area')
const list = { ...doc, jobs: doc.jobs.filter(j => !area || j.area === area) }
const home = doc.home
const [fx, fy, fz] = opt('--from').split(',').map(Number)
const world = worldOf(read, overlay)
const body = fakeBot(world, { x: fx + 0.5, y: fy, z: fz + 0.5 })
const feet = () => [Math.floor(body.entity.position.x), Math.floor(body.entity.position.y), Math.floor(body.entity.position.z)]
let walks = 0, arrived = 0
const e = {
  read, feet, bodies: () => [],
  walkTo: async s => { walks++; const r = await walkTo(body, { x: s[0], y: s[1], z: s[2] }, 1200); const f = feet(); if (f[0] === s[0] && f[1] === s[1] && f[2] === s[2]) arrived++; return r.ok },
  hold: async () => true, has: () => true, look: async () => {}, nextSeq: () => 0, send: () => false, waitAck: async () => 'silent', track: () => {}, untrack: () => {},
  conn: () => 'replay', acked: () => 0, seen: () => ({ online: true, offlineSince: null, leftAt: null }),
  dig: async (c, expect) => { if (expect && !F.sameBlock(read(...c)?.name ?? '', expect)) return 'refused'; overlay[c.join(',')] = 'air'; return 'confirmed' },
  probe: async c => read(...c)?.name ?? null, aborted: () => false, log: () => {}, now: () => Date.now(), sleep: async () => {}, spawnedAt: () => 0,
}
let mem = { tries: {}, until: {} }
const T0 = Date.now()
for (let lap = 1; lap <= Number(opt('--laps', 6)); lap++) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcr-'))
  const key = PJ.projKey(home, F.FLOATCLEAN_PLOT)
  const slot = PJ.takeSlot(dir, key, 'R', F.FC.builders)
  const pj = F.floatPassJobs(list, read, { aside: k => F.floatAsideNow(mem, k, T0), max: F.FC.passMax, part: slot.slot - 1, parts: F.FC.builders })
  if (!pj.take.length) { console.log(`lap ${lap}: nothing take-able (${JSON.stringify(pj.census)})`); break }
  const take = new Map(pj.take.map(q => [F.k3(q.at), q]))
  const w0 = walks, a0 = arrived, t = Date.now()
  const r = await runVisit({ dir, key, me: 'R', home, stood: [], record: { v: 1, plot: F.FLOATCLEAN_PLOT, home, cells: [], clear: pj.take, segments: [], zones: [], structure_complete: false }, recordGen: 0, palette: {}, res: null, resFailed: false,
    slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: F.FC.walkR, blockLayer: false, clearMax: Infinity, stuckStalledOnly: true,
    clearKeepOrder: true, clearNoFloor: pj.floor, clearPart: { lease: 'seg-clear-R', has: () => true },
    clearOk: (q, rd) => F.floatClearOk(q, rd ?? read, { listed: k => take.has(k) }) }, e, { maxSteps: 200 })
  const after = F.floatAsideAfter(mem, { offered: [...take.keys()], standing: k => F.sameBlock(read(...k.split(',').map(Number))?.name ?? '', take.get(k).name), complete: r.stop === 'complete', now: T0 })
  mem = after.mem
  console.log(`lap ${lap}: offered ${take.size} dug ${r.cleared} aside ${after.aside.length} stop=${r.stop} walks=${walks - w0} arrived=${arrived - a0} feet=${feet().join(',')} ms=${Date.now() - t} census=${JSON.stringify(pj.census)}`)
  for (const a of after.aside) console.log(`  aside ${a.k}`)
}
const dug = Object.keys(overlay)
console.log(`_floatclean op=replay area=${area ?? 'all'} listed=${list.jobs.length} dug=${dug.length} aside=${Object.keys(mem.until).length}`)
fs.writeFileSync(opt('--out', '/dev/null'), JSON.stringify({ dug, aside: Object.keys(mem.until) }))
