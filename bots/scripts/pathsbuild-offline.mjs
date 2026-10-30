#!/usr/bin/env node
// THE TOWN'S PATHS BUILT OFFLINE (paths-01): a paths record (pathsite-offline.mjs --out) laid END TO END by the bots' own visit
// (buildrun.mjs runVisit with the shovel's use, as skills.mjs buildPaths runs it) on a COPY of the world's blocks, with fake
// builders: walks teleport, digs land, a held block is placed into the clicked face's cell, a shovel's use on a top face turns
// grass or dirt with air above into dirt_path (vanilla's rule). What it proves: every cell has a stand, every clear a dig stand,
// the visit's own stops on the real ground; and the rows it writes (--rows) for the shop read.
//
//   node scripts/pathsbuild-offline.mjs <dump.json> <record.json> [--builders 4] [--rounds 40] [--rows rows.jsonl]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { dumpReader } from './buildsite-offline.mjs'
import { runVisit, cellDone } from '../src/buildrun.mjs'
import * as PJ from '../src/buildproj.mjs'
import { installAckTracker } from '../src/buildack.mjs'
import * as P from '../src/paths.mjs'
import { buildRowDetail, buildSegDetail } from '../src/shop.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, recPath] = argv
const base = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'))
const home = rec.home
const over = new Map()
const AIRB = { name: 'air', boundingBox: 'empty' }
const SOLID = n => ({ name: n, boundingBox: 'block' })
const read = (x, y, z) => over.get(`${x},${y},${z}`) ?? base(x, y, z)
const set = (a, n) => over.set(a.join(','), n === 'air' ? AIRB : SOLID(n))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathsbuild-'))
const key = PJ.projKey(home, P.PATHS_PLOT)
const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
const rows = []
let t = Date.parse('2026-10-30T02:00:00Z')
function builder (name, feet) {
  const client = new EventEmitter(); client.write = () => {}
  const fb = new EventEmitter(); fb._client = client; fb.players = {}
  const acks = installAckTracker(fb)
  let at = feet.slice(), held = 'cobblestone'
  const inv = { cobblestone: 640, iron_shovel: 1 }
  const has = n => (inv[n] ?? 0) > 0
  has.planks = () => null
  const e = {
    read, feet: () => at.slice(), bodies: () => [], self: () => ({ x: at[0] + 0.5, y: at[1], z: at[2] + 0.5, w: 0.6, h: 1.8 }),
    walkTo: async s => { at = s.slice(); return true },
    hold: async n => { if (!has(n)) return false; held = n; return true },
    has, look: async () => {},
    nextSeq: () => acks.tracker.next(),
    send: (support, face, seq) => {
      const b = read(...support), up = read(support[0], support[1] + 1, support[2])
      if (/_shovel$/.test(held)) { if (face[1] === 1 && P.FLATTENABLE.test(b?.name ?? '') && up?.name === 'air') set(support, 'dirt_path') } else {
        const tg = support.map((v, i) => v + face[i]), tb = read(...tg)
        if (tb && (tb.boundingBox === 'empty') && has(held)) { set(tg, held); inv[held]-- }
      }
      setImmediate(() => acks.tracker.ack(seq))
    },
    waitAck: (seq, ms) => acks.tracker.wait(seq, ms),
    track: (id, seq) => acks.track(id, seq), untrack: id => acks.untrack(id),
    conn: () => `${name}-c1`, acked: () => acks.tracker.acked, seen: () => ({ online: true, offlineSince: null, leftAt: null }),
    dig: async (c, expect) => { const b = read(...c); if (expect && b?.name !== expect) return 'refused'; set(c, 'air'); return 'confirmed' },
    probe: async () => null, aborted: () => false,
    log: (k, d) => rows.push({ t: new Date(t).toISOString(), bot: name, name: k, feet: at.slice(), detail: k === '_build_seg' ? buildSegDetail({ project: P.PATHS_PLOT, ...d }) : buildRowDetail({ project: P.PATHS_PLOT, ...d }) }),
    now: () => t, sleep: async ms => { t += ms }, spawnedAt: () => 0,
  }
  const use = { block: 'dirt_path', can: b => P.FLATTENABLE.test(b?.name ?? ''), want: b => b?.name === 'dirt_path', held: () => /_shovel$/.test(held), hold: async () => { held = 'iron_shovel'; return true } }
  return { name, e, use, stands: { pending: null, bans: {} }, unknown: new Set() }
}
const n = Number(opt('builders', 4)), rounds = Number(opt('rounds', 40))
const bs = Array.from({ length: n }, (_, i) => builder(`B${i}`, [home.x + i, home.y, home.z]))
const doneN = () => rec.cells.filter(c => cellDone(read(...c.at), P.PATH_PALETTE, c.role)).length
const stops = {}
let r = 0
for (; r < rounds && doneN() < rec.cells.length; r++) {
  for (const b of bs) {
    const slot = PJ.takeSlot(dir, key, b.name, P.PATHS_BUILDERS, { now: t })
    if (!slot.ok) { stops.slots_full = (stops.slots_full ?? 0) + 1; continue }
    const v = await runVisit({ dir, key, me: b.name, home, stood: [], record: rec, recordGen: pub.gen, palette: P.PATH_PALETTE, res: null, resFailed: false, slot: slot.slot, slotGen: slot.gen, stands: b.stands, unknown: b.unknown,
      domain: () => true, walkR: P.pathWalkR(rec, home), foreign: P.PATH_FOREIGN, blockLayer: false, use: b.use }, b.e, { maxSteps: 400 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, b.name, slot.gen, { now: t })
    stops[v.stop] = (stops[v.stop] ?? 0) + 1
    rows.push({ t: new Date(t).toISOString(), bot: b.name, name: '_build_visit', feet: b.e.feet(), detail: `project=paths outcome=${v.stop} stop=${v.stop} placed=${v.placed + (v.used ?? 0)} cleared=${v.cleared}` })
    if (v.stop !== 'complete' && process.env.VERBOSE) console.error(b.name, r, v.stop, v.why)
    t += 60_000
  }
  t += 10 * 60_000
}
const open = rec.cells.filter(c => !cellDone(read(...c.at), P.PATH_PALETTE, c.role))
const names = {}
for (const c of rec.cells.filter(c => c.role === 'path')) { const nn = read(...c.at)?.name; names[nn] = (names[nn] ?? 0) + 1 }
const aboveBad = rec.cells.filter(c => c.role === 'path' && read(c.at[0], c.at[1] + 1, c.at[2])?.boundingBox !== 'empty').map(c => c.at.join(','))
const builds = rows.filter(q => q.name === '_build')
console.log(JSON.stringify({ cells: rec.cells.length, done: doneN(), rounds: r, stops, pathBlocks: names, open: open.slice(0, 10).map(c => `${c.at.join(',')}:${c.role}:${read(...c.at)?.name}`),
  aboveNotClear: aboveBad.slice(0, 10), aboveNotClearN: aboveBad.length,
  rows: builds.reduce((m, q) => { const op = /op=(\S+)/.exec(q.detail)?.[1]; const kind = /kind=(\S+)/.exec(q.detail)?.[1]; m[`${op}${kind ? ':' + kind : ''}`] = (m[`${op}${kind ? ':' + kind : ''}`] ?? 0) + 1; return m }, {}) }, null, 1))
if (opt('rows')) fs.writeFileSync(opt('rows'), rows.map(q => JSON.stringify(q)).join('\n') + '\n')
