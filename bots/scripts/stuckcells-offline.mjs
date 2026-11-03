#!/usr/bin/env node
// STUCKCELLS-01, OFFLINE: the bots' own build visit (buildrun.mjs runVisit, with the options skills.mjs buildShop / buildMonument
// pass) run by fake builders on a COPY of a town's blocks and a COPY of its pool state, before and after the remedies -- so how
// many of a stuck project's cells come unstuck is measured on the real geometry before any bot runs it.
//
//   node scripts/stuckcells-offline.mjs <dump.json> <pool-state-dir> <plot> [--off] [--builders 3] [--rounds 4] [--verbose]
//
// <dump.json>: scripts/host/townplan_blockdump.py over COPIES of the region files. <pool-state-dir>: a COPY of /var/lib/mcai/_pool-<pool>
// (the project's record, its stuck maps). Both are read only: the state is copied again into a temp dir and the visits write there.
// --off: STUCKCELLS=off (the visit as the fleet runs it today; the read drops a snow layer's properties, as buildbot.mjs did).
// --cascade: a dug bamboo / sugar cane block breaks the stalk above it (vanilla); MONUSTUCK=off in the env runs the visit without monustuck-01.
// The fake builder: walks are instant to the planned stand, every click the server would take is taken (an empty target cell,
// the block in the bag), digs land. Bags hold every block. Time moves 10 min a visit.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { dumpReader } from './buildsite-offline.mjs'
import * as PJ from '../src/buildproj.mjs'
import { runVisit, cellDone } from '../src/buildrun.mjs'
import { installAckTracker } from '../src/buildack.mjs'
import { loadBlueprint } from '../src/buildsite.mjs'
import * as Z from '../src/ziggurat.mjs'
import { visitOpts, withWaived } from '../src/stuckcells.mjs'
import { stoodRead } from '../src/shop.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const flag = k => argv.includes(`--${k}`)
const [dumpPath, poolDir0, plot] = argv
if (!dumpPath || !poolDir0 || !plot) { console.error('usage: stuckcells-offline.mjs <dump.json> <pool-state-dir> <plot> [--off]'); process.exit(2) }
const off = flag('off')
if (off) process.env.STUCKCELLS = 'off'
const base0 = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))
// --off: the visit's read as buildbot.mjs had it -- a block's name and collision box, never its properties
const base = off ? (x, y, z) => { const b = base0(x, y, z); return b ? { name: b.name, boundingBox: b.boundingBox } : null } : base0
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stuckcells-'))
const files = fs.readdirSync(poolDir0)
const pf = files.find(f => /^project-(-?\d+)_(-?\d+)_(-?\d+)\./.test(f))
const hm = /^project-(-?\d+)_(-?\d+)_(-?\d+)\./.exec(pf)
const home = { x: +hm[1], y: +hm[2], z: +hm[3] }
const key = PJ.projKey(home, plot)
for (const f of files) if (f.startsWith(`${key}.`) && !/\.(lease|mutate)\./.test(f) && !/\.intents\./.test(f)) fs.copyFileSync(path.join(poolDir0, f), path.join(dir, f))
// the walk's seeds: the cells the town's bots logged standing on (skills.mjs stoodRead over the workshop's stood file)
const stood = (() => { try { return stoodRead(poolDir0, PJ.projKey(home, 'shop'), home) } catch { return [] } })()
const head = PJ.recordHead(dir, key).head
if (!head) { console.error('no record', key); process.exit(1) }
const zig = Z.isZigBlueprint(head.rec.blueprint)
const palette = zig ? Z.zigPaletteOf(head.rec) : loadBlueprint(head.rec.blueprint).palette

const over = new Map()
const AIRB = { name: 'air', boundingBox: 'empty' }
const SOLIDB = n => ({ name: n, boundingBox: /torch|lantern|sign|_door|rail/.test(n) ? 'empty' : 'block' })
const read = (x, y, z) => over.get(`${x},${y},${z}`) ?? base(x, y, z)
const set = (a, n) => over.set(a.join(','), n === 'air' ? AIRB : SOLIDB(n))
let t = Date.parse('2026-11-01T22:00:00Z')
const rows = []
function builder (name, feet) {
  const client = new EventEmitter(); client.write = () => {}
  const fb = new EventEmitter(); fb._client = client; fb.players = {}
  const acks = installAckTracker(fb)
  let at = feet.slice(), held = 'cobblestone'
  const has = () => true
  has.planks = () => 'oak_planks'
  const e = {
    read, feet: () => at.slice(), bodies: () => [], self: () => ({ x: at[0] + 0.5, y: at[1], z: at[2] + 0.5, w: 0.6, h: 1.8 }),
    walkTo: async s => { at = s.slice(); return true },
    hold: async n => { held = n; return true }, has, count: () => 999,
    look: async () => {}, tool: async () => {}, settle: async () => {},
    rise: async () => true, land: async () => { at = [at[0], at[1] + 1, at[2]] },
    nextSeq: () => acks.tracker.next(),
    send: (support, face, seq) => {
      const tg = support.map((v, i) => v + face[i]), tb = read(...tg)
      if (tb && (tb.boundingBox === 'empty' || /^snow$/.test(tb.name))) set(tg, held)
      setImmediate(() => acks.tracker.ack(seq))
    },
    waitAck: (seq, ms) => acks.tracker.wait(seq, ms),
    track: () => {}, untrack: () => {},
    conn: () => `${name}-c1`, acked: () => acks.tracker.acked, seen: () => ({ online: true, offlineSince: null, leftAt: null }),
    // --cascade (monustuck-01): the server breaks a bamboo / sugar cane stalk above a broken stalk block, as vanilla does
    dig: async (c, expect) => { const b = read(...c); if (expect && b?.name !== expect) return 'refused'; set(c, 'air'); if (flag('cascade') && /^(bamboo|sugar_cane)$/.test(b?.name ?? '')) for (let y = c[1] + 1; read(c[0], y, c[2])?.name === b.name; y++) set([c[0], y, c[2]], 'air'); return 'confirmed' },
    probe: async c => read(...c)?.name ?? null, aborted: () => false,
    log: (k, d) => rows.push({ bot: name, k, ...d }),
    now: () => t, sleep: async ms => { t += ms }, spawnedAt: () => 0,
  }
  return { name, e, stands: { pending: null, bans: {} }, unknown: new Set(), access: {} }
}
const nB = Number(opt('builders', 3)), rounds = Number(opt('rounds', 4))
const bs = Array.from({ length: nB }, (_, i) => builder(`S${i}`, [home.x + i, home.y, home.z]))
const recNow = () => { const h = PJ.recordHead(dir, key).head; return { rec: zig ? Z.zigSplitFoundation(h.rec) : h.rec, gen: h.gen } }
const doneOf = (rec, extra) => c => cellDone(read(...c.at), palette, c.role) || (!!extra && extra(c, read))
const count = () => { const { rec } = recNow(); const ex = (visitOpts(rec, zig ? 'zig' : 'shop', zig ? Z.zigHidden : null).alsoDone) ?? (zig ? Z.zigHidden : null); const d = doneOf(rec, ex); const open = rec.cells.filter(c => !d(c)); return { cells: rec.cells.length, open: open.length, waived: Object.keys(rec.waived ?? {}).length } }
const before = count()
const stops = []
for (let r = 0; r < rounds; r++) {
  for (const b of bs) {
    const { rec, gen } = recNow()
    const slot = PJ.takeSlot(dir, key, b.name, 3, { now: t })
    if (!slot.ok) continue
    const p = { dir, key, me: b.name, home, stood, record: rec, recordGen: gen, palette, res: null, resFailed: false, slot: slot.slot, slotGen: slot.gen, stands: b.stands, unknown: b.unknown, placedBy: {} }
    if (zig) Object.assign(p, { domain: Z.zigDomain(rec, home), walkR: Z.zigWalkR(rec, home), foreign: Z.ZIG_FOREIGN_GROWN, blockLayer: false, feetIn: Z.zigFeetIn, alsoDone: Z.zigHidden, clearMax: Z.ZIG_CLEAR_MAX, access: { mem: b.access, mayDig: () => true }, sealed: { mayDig: () => true }, ...visitOpts(rec, 'zig', Z.zigHidden, !off) })
    else Object.assign(p, visitOpts(rec, 'shop', null, !off))
    const v = await runVisit(p, b.e, { maxSteps: 400 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, b.name, slot.gen)
    if (v.waived?.length) PJ.publishRecord(dir, key, cur => withWaived(cur, v.waived, { cells: cur?.cells?.length, now: t, by: b.name }), { by: b.name, now: t })
    if (v.stop === 'complete') PJ.publishRecord(dir, key, cur => (cur && !cur.structure_complete ? { ...cur, structure_complete: true, state: 'complete' } : null), { by: b.name, now: t })
    stops.push(`${v.stop}${v.placed ? `:+${v.placed}` : ''}`)
    if (flag('verbose')) console.error(b.name, r, v.stop, v.placed, v.why)
    t += 10 * 60_000
  }
}
const after = count()
const ops = rows.filter(q => q.k === '_build').reduce((m, q) => (m[q.op] = (m[q.op] ?? 0) + 1, m), {})
console.log(JSON.stringify({ plot, mode: off ? 'off' : 'on', before, after, placed: before.open - after.open, stops: stops.join(' '), ops, waived: rows.filter(q => q.op === 'waived').map(q => `${q.cell.join(',')}:${q.why}`) }))
fs.rmSync(dir, { recursive: true, force: true })
