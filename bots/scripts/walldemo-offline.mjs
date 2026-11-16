#!/usr/bin/env node
// WALLEXT-02: THE OLD LINE'S DEMOLITION, OFFLINE -- wall.mjs demoCells / retireWall / demoRecord on COPIES of a town's region files and
// pool state, against an extension record (wall-offline.mjs --ext --out), then DUG by fake builders running the bots' own visit
// (buildrun.mjs runVisit's clears, as skills.mjs buildWallDemo runs it). Nothing is written but --out.
//   node scripts/walldemo-offline.mjs <dump.json> <pool-state-dir> <ext-record.json> [--builders 2] [--rounds 40] [--out demo.json]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { dumpReader } from './buildsite-offline.mjs'
import { recordHead } from '../src/buildproj.mjs'
import * as PJ from '../src/buildproj.mjs'
import { runVisit } from '../src/buildrun.mjs'
import { installAckTracker } from '../src/buildack.mjs'
import { buildRowDetail } from '../src/shop.mjs'
import * as W from '../src/wall.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath, poolDir, extPath] = argv
const base = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
const wall0 = Object.values(Object.fromEntries(fs.readdirSync(poolDir).filter(f => /^project-[-\d_]+\.wall\.g\d+\.json$/.test(f)).map(f => [f, f]))).length
  ? (() => { const f = fs.readdirSync(poolDir).find(q => /^project-[-\d_]+\.wall\.g\d+\.json$/.test(q)); const hk = /^project-([-\d_]+)\.wall/.exec(f)[1]; return { hk, rec: recordHead(poolDir, `project-${hk}.wall`).head.rec } })()
  : null
if (!wall0) { console.error('no wall record'); process.exit(1) }
const [hx, hy, hz] = wall0.hk.split('_').map(Number)
const home = { x: hx, y: hy, z: hz }
const ext = { ...JSON.parse(fs.readFileSync(extPath, 'utf8')), structure_complete: true }
const d = W.demoCells(wall0.rec, ext)
const retired = W.retireWall(wall0.rec, d)
const s = W.demoRecord(base, retired, ext, { home })
const rec = s.record
const roles = d.cells.reduce((m, c) => (m[c.role] = (m[c.role] ?? 0) + 1, m), {})
const out = { cols: d.cols.map(c => c.join(',')), cells: d.cells.length, roles, wall: { cells: [wall0.rec.cells.length, retired?.cells.length], zones: [wall0.rec.zones.length, retired?.zones.length], segments: [wall0.rec.segments.length, retired?.segments.length] },
  ok: s.ok, why: s.why, clear: rec?.clear.length, names: rec ? rec.clear.reduce((m, c) => (m[c.name] = (m[c.name] ?? 0) + 1, m), {}) : null, skipped: s.skipped }
if (!rec) { console.log(JSON.stringify(out, null, 1)); process.exit(0) }
// ---- THE DIG: fake builders on a copy of the blocks ----
const over = new Map()
const AIRB = { name: 'air', boundingBox: 'empty' }
const read = (x, y, z) => over.get(`${x},${y},${z}`) ?? base(x, y, z)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walldemo-'))
const key = PJ.projKey(home, W.WALLDEMO_PLOT)
const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
const rows = []
let t = Date.parse('2026-11-05T06:00:00Z')
function builder (name, feet) {
  const client = new EventEmitter(); client.write = () => {}
  const fb = new EventEmitter(); fb._client = client; fb.players = {}
  const acks = installAckTracker(fb)
  let at = feet.slice()
  const has = () => false
  has.planks = () => null
  const e = {
    read, feet: () => at.slice(), bodies: () => [], self: () => ({ x: at[0] + 0.5, y: at[1], z: at[2] + 0.5, w: 0.6, h: 1.8 }),
    walkTo: async st => { at = st.slice(); return true }, hold: async () => false, has, look: async () => {},
    nextSeq: () => acks.tracker.next(), send: (support, face, seq) => { setImmediate(() => acks.tracker.ack(seq)) },
    waitAck: (seq, ms) => acks.tracker.wait(seq, ms), track: (id, seq) => acks.track(id, seq), untrack: id => acks.untrack(id),
    conn: () => `${name}-c1`, acked: () => acks.tracker.acked, seen: () => ({ online: true, offlineSince: null, leftAt: null }),
    dig: async (c, expect) => { const b = read(...c); if (expect && b?.name !== expect) return 'refused'; over.set(c.join(','), AIRB); return 'confirmed' },
    probe: async () => null, aborted: () => false,
    log: (k, dd) => rows.push({ bot: name, name: k, detail: buildRowDetail({ project: W.WALLDEMO_PLOT, ...dd }), d: dd }),
    now: () => t, sleep: async ms => { t += ms }, spawnedAt: () => 0,
  }
  return { name, e, stands: { pending: null, bans: {} }, unknown: new Set() }
}
const feet0 = W.walkFeet(base, home)
const bs = Array.from({ length: Number(opt('builders', 2)) }, (_, i) => builder(`B${i}`, [feet0[0] + i, feet0[1], feet0[2]]))
const stops = {}
let r = 0
for (; r < Number(opt('rounds', 40)) && W.demoLeft(rec, read).length; r++) {
  for (const b of bs) {
    const slot = PJ.takeSlot(dir, key, b.name, W.WALLDEMO_BUILDERS, { now: t })
    if (!slot.ok) continue
    const v = await runVisit({ dir, key, me: b.name, home, stood: [], record: rec, recordGen: pub.gen, palette: W.WALL_PALETTE, res: null, resFailed: false, slot: slot.slot, slotGen: slot.gen, stands: b.stands, unknown: b.unknown,
      domain: () => true, walkR: W.wallWalkR({ cells: rec.clear }, home), foreign: W.WALL_FOREIGN, blockLayer: false, clearMax: W.WALL_CLEAR_MAX }, b.e, { maxSteps: 400 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, b.name, slot.gen)
    stops[v.stop] = (stops[v.stop] ?? 0) + 1
    t += 60_000
  }
  t += 10 * 60_000
}
const left = W.demoLeft(rec, read)
const listed = new Set(rec.clear.map(c => c.at.join(',')))
const digs = rows.filter(q => q.name === '_build' && q.d.op === 'clear')
// the walk from home on the dug world reaches the old line's ground (positive control: the walk before)
const lineGround = d.cols.map(([x, z]) => [x, z])
const reach = rd => { const w = W.walkSet(rd, home, 40, { seed: feet0, drops: 3 }); const cols = new Set([...w].map(k => { const [x, , z] = k.split(',').map(Number); return `${x},${z}` })); return lineGround.filter(([x, z]) => cols.has(`${x},${z}`)).length }
Object.assign(out, { dig: { rounds: r, stops, left: left.length, leftSample: left.slice(0, 5).map(c => c.at.join(',')), digs: digs.length, offList: digs.filter(q => !listed.has(q.d.cell.join(','))).length, kinds: [...new Set(digs.map(q => q.d.kind))] },
  lineColsWalkedOn: { before: reach(base), after: reach(read), of: lineGround.length } })
console.log(JSON.stringify(out, null, 1))
if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(rec))
