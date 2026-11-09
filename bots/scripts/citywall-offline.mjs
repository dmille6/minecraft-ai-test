#!/usr/bin/env node
// CITYWALL-01, OFFLINE: the bots' own design (citywall.mjs citywallDesign) on COPIES of a town's region files and pool state -- what the
// upgraded wall is, what it costs, that it cuts nothing off and traps nobody (wall.mjs wallEscape over every cell built) -- then,
// with --build, every phase LAID BY THE BOTS' OWN VISIT (buildrun.mjs runVisit with the wall's options and `swap`) by fake builders,
// with the never-a-gap check after every step (no two open cells stacked in one O column, no O column with a passage through it),
// and pictures before/after.
//
//   node scripts/citywall-offline.mjs <dump.json> <pool-state-dir> [--plot wall|wallext] [--gate WHY|-] [--style grey|dark] [--seed N]
//        [--build] [--builders 4] [--rounds 120] [--png <prefix>] [--views x0,y0,z0,x1,y1,z1[:from][;...]] [--out design.json]
// <dump.json>: scripts/host/townplan_blockdump.py over region COPIES. Nothing is written but --out and the pictures.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { dumpReader } from './buildsite-offline.mjs'
import * as PJ from '../src/buildproj.mjs'
import { runVisit, cellDone, digStand as digStandOf } from '../src/buildrun.mjs'
import { installAckTracker } from '../src/buildack.mjs'
import { buildRowDetail, buildSegDetail } from '../src/shop.mjs'
import * as W from '../src/wall.mjs'
import * as CW from '../src/citywall.mjs'
import { isoWorld, topMap, sheet, png } from './civic-render.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const flag = k => argv.includes(`--${k}`)
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: citywall-offline.mjs <dump.json> <pool-dir> [--plot wall|wallext] [--gate WHY] [--build] [--png prefix]'); process.exit(2) }
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
const base = dumpReader(dump)
const files = fs.readdirSync(poolDir)
const hk = files.map(f => /^project-([-\d_]+)\./.exec(f)?.[1]).find(Boolean)
const [hx, hy, hz] = hk.split('_').map(Number)
const home = { x: hx, y: hy, z: hz }
const head = plot => PJ.recordHead(poolDir, `project-${hk}.${plot}`).head?.rec ?? null
const PLOT = opt('plot', 'wallext')
const rec0 = head(PLOT)
if (!rec0) { console.error('no record', PLOT); process.exit(1) }
// every OTHER record's cells (a dress torch, a path, a building) are taken
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))]
const takenSet = new Set()
for (const p of plots) { if (p === PLOT) continue; const r = head(p); for (const c of r?.cells ?? []) if (Array.isArray(c?.at)) takenSet.add(c.at.join(',')) }
const taken = (x, y, z) => takenSet.has(`${x},${y},${z}`)
const gatePick = opt('gate') === '-' ? null : opt('gate')
// the land plan's road corridors (land:road reservations) and the protected zones: no NEW cell in them
const land = head('land')
const zoneBoxes = [...(land?.corridors ?? []).map(c => c.box), ...(() => { try { return (JSON.parse(fs.readFileSync(path.join(poolDir, 'protected-zones.json'), 'utf8')).zones ?? []).map(z => z.box) } catch { return [] } })()].filter(b => Array.isArray(b) && b.length === 6)
// the land plan's roads by their own columns (a corridor box is the planner's search room, wider than the road)
const roadCols = new Set((land?.roads ?? []).flatMap(r => (r.cols ?? []).map(c => `${c[0]},${c[1]}`)))
const zone = flag('nozones') ? () => false : (x, z) => roadCols.has(`${x},${z}`) || (flag('corridors') && zoneBoxes.some(b => x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5])) || zoneBoxes.slice((land?.corridors ?? []).length).some(b => x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5])
// the underpinning's reach: the town walk now (buildsite.mjs walkFrom) and the visit's stepFor, as skills.mjs buildCitywall asks
const BS = await import('../src/buildsite.mjs')
const walkNodes = new Map()
// the walk from where the bots have stood (the pool's stood file: a home in the town's chest room walks nowhere by itself)
const SHOPM = await import('../src/shop.mjs')
const stood = SHOPM.stoodRead(poolDir, `project-${hk}.shop`, home)
for (const k of BS.walkFrom(base, home, new Set(), W.wallWalkR(rec0, home), { stood })) { const [x, y, z] = k.split(',').map(Number); const ck = `${x},${z}`; if (!walkNodes.has(ck)) walkNodes.set(ck, []); walkNodes.get(ck).push(y) }
const design = CW.citywallDesign(base, rec0, { style: opt('style', 'grey'), seed: Number(opt('seed', 1)), gatePick, taken, zone, flat: flag('flat'), reachUnder: at => !!BS.stepFor(base, home, at, walkNodes, () => true, null), reachSwap: at => !!digStandOf(base, at, walkNodes) })
if (!design.ok) { console.error('no design', design.why); process.exit(1) }
const roles = design.cells.reduce((m, c) => (m[c.role] = (m[c.role] ?? 0) + 1, m), {})
const bill = CW.citywallBill(design.cells, design.style)
// THE ESCAPE PROOF: the old record's cells and every design cell built
const allCells = [...rec0.cells, ...design.cells]
const R = W.wallWalkR(rec0, home) + 8
const esc = W.wallEscape(base, home, allCells, { r: R })
const esc0 = W.wallEscape(base, home, rec0.cells, { r: R })
console.log(JSON.stringify({ plot: PLOT, counts: design.counts, skipped: design.skipped, towers: design.towers, gate: design.gate, roles, bill,
  phases: design.phases.map(p => `${p.ph}:${p.kind}:${p.n}:${Object.entries(p.bill).map(([k, v]) => `${k}=${v}`).join('/')}`),
  escape_before: { cut: esc0.cut, trapped: esc0.trapped, reach0: esc0.reach0, reach1: esc0.reach1 }, escape_after: { cut: esc.cut, trapped: esc.trapped, reach1: esc.reach1, pits: esc.pits, cutAt: esc.cutAt.slice(0, 6), trapAt: esc.trapAt.slice(0, 6) } }, null, 1))
if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(design))

// ---- THE BUILD (--build): fake builders run the wall's visit, phase by phase -----------------------------------------------------
const over = new Map()
const read = (x, y, z) => over.get(`${x},${y},${z}`) ?? base(x, y, z)
const stOf = new Map()
const setB = (a, n, st = null) => { over.set(a.join(','), n === 'air' ? { name: 'air', boundingBox: 'empty' } : { name: n, boundingBox: /torch|lantern|iron_bars|_wall$/.test(n) ? (/torch/.test(n) ? 'empty' : 'block') : 'block', ...(st ? { props: st } : {}) }); if (st) stOf.set(a.join(','), st); else stOf.delete(a.join(',')) }
let built = null
if (flag('build')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citywall-'))
  const key = PJ.projKey(home, PLOT)
  PJ.publishRecord(dir, key, () => ({ ...rec0 }))
  let t = Date.parse('2026-11-09T06:00:00Z')
  const rows = []
  const gapViolations = []
  const oCols = new Map()
  for (const c of design.cells) if (c.sw) { const k = `${c.at[0]},${c.at[2]}`; if (!oCols.has(k)) oCols.set(k, []); oCols.get(k).push(c.at[1]) }
  // NEVER A GAP: after every dig, in every swapped column, the open (air) cells among its old cells: never two stacked, never two in one
  // column at once, and never more than one per segment
  const checkGap = (why) => {
    const holesBySeg = {}
    for (const [k, ys] of oCols) {
      const [x, z] = k.split(',').map(Number)
      const open = ys.filter(y => read(x, y, z)?.name === 'air')
      if (open.length > 1) gapViolations.push(`${why} col ${k} open ${open.join('/')}`)
    }
    for (const c of design.cells) if (c.sw && read(...c.at)?.name === 'air') holesBySeg[c.seg] = (holesBySeg[c.seg] ?? 0) + 1
    for (const [s, n] of Object.entries(holesBySeg)) if (n > 1) gapViolations.push(`${why} seg ${s} holes ${n}`)
  }
  const desAt = new Map(design.cells.map(c => [c.at.join(','), c]))
  const KIT = { stone_bricks: 4000, deepslate_bricks: 4000, mossy_stone_bricks: 400, cobblestone: 2000, stone_brick_wall: 400, chiseled_stone_bricks: 50, stone_brick_stairs: 100, iron_bars: 50, lantern: 200, torch: 100, deepslate_brick_stairs: 100, deepslate_brick_wall: 400, chiseled_deepslate: 50 }
  function builder (name, feet) {
    const client = new EventEmitter(); client.write = () => {}
    const fb = new EventEmitter(); fb._client = client; fb.players = {}
    const acks = installAckTracker(fb)
    let at = feet.slice(), held = 'cobblestone', look = null
    const inv = { ...KIT }
    const has = n => (inv[n] ?? 0) > 0
    has.planks = () => null
    const e = {
      read, feet: () => at.slice(), bodies: () => [], self: () => ({ x: at[0] + 0.5, y: at[1], z: at[2] + 0.5, w: 0.6, h: 1.8 }),
      walkTo: async s => { at = s.slice(); return true },
      hold: async n => { if (!has(n)) return false; held = n; return true },
      has, count: n => inv[n] ?? 0, look: async (p, w) => { look = w ?? null },
      nextSeq: () => acks.tracker.next(),
      send: (support, face, seq, aim) => {
        const tg = support.map((v, i) => v + face[i]), tb = read(...tg)
        if (tb && tb.boundingBox === 'empty' && has(held)) {
          let st = null
          // the fake server sets a stair's state from the design (the aim is the Paper proof's: sandbox/citywall)
          if (/_stairs$/.test(held)) st = desAt.get(tg.join(','))?.ws ?? null
          if (/lantern/.test(held)) st = { hanging: face[1] === -1 ? 'true' : 'false' }
          setB(tg, held === 'torch' && face[1] !== 1 ? 'wall_torch' : held, st); inv[held]--
        }
        setImmediate(() => acks.tracker.ack(seq))
      },
      waitAck: (seq, ms) => acks.tracker.wait(seq, ms),
      track: (id, seq) => acks.track(id, seq), untrack: id => acks.untrack(id),
      conn: () => `${name}-c1`, acked: () => acks.tracker.acked, seen: () => ({ online: true, offlineSince: null, leftAt: null }),
      dig: async (c, expect) => { const b = read(...c); if (expect && b?.name !== expect) return 'refused'; setB(c, 'air'); inv[b?.name] = (inv[b?.name] ?? 0) + 1; checkGap(`${name} dig ${c.join(',')}`); return 'confirmed' },
      probe: async () => null, aborted: () => false,
      log: (k, d) => { rows.push({ bot: name, name: k, d }); if (process.env.ROWSEG && d?.seg === process.env.ROWSEG) console.error('ROW', name, k, JSON.stringify(d)) },
      now: () => t, sleep: async ms => { t += ms }, spawnedAt: () => 0,
    }
    return { name, e, inv, stands: { pending: null, bans: {} }, unknown: new Set(), blocked: new Map() }
  }
  const nB = Number(opt('builders', 4)), rounds = Number(opt('rounds', 120))
  const bs = Array.from({ length: nB }, (_, i) => builder(`B${i}`, [home.x + i, home.y, home.z]))
  const stops = {}
  const perPhase = []
  for (const ph of design.phases.slice(0, Number(opt('phases', 999)))) {
    const h = PJ.recordHead(dir, key).head
    const recN = CW.citywallGeneration(h.rec, design, ph.ph, { now: t })
    PJ.publishRecord(dir, key, () => recN)
    const hh = PJ.recordHead(dir, key)
    const pal = recN.palette
    const isDone = c => cellDone(read(...c.at), pal, c.role, c.ws) || (c.ws && cellDone(read(...c.at), pal, c.role) && stOk(c))
    const stOk = c => { const s = stOf.get(c.at.join(',')); return !!s && Object.entries(c.ws).every(([k, v]) => String(s[k]) === String(v)) }
    const mine = recN.cells.filter(c => c.ph === ph.ph)
    let r = 0
    for (; r < rounds && mine.some(c => !isDone(c)); r++) {
      for (const b of bs) {
        const slot = PJ.takeSlot(dir, key, b.name, W.WALL_BUILDERS, { now: t })
        if (!slot.ok) continue
        const v = await runVisit({ dir, key, me: b.name, home, stood, record: W.wallVisitRecord(W.wallLightsLast(recN), b.blocked, t), recordGen: hh.head.gen, palette: pal, res: null, resFailed: false, slot: slot.slot, slotGen: slot.gen, stands: b.stands, unknown: b.unknown,
          domain: () => true, walkR: W.wallWalkR(recN, home), foreign: W.WALL_FOREIGN, blockLayer: false, clearMax: W.WALL_CLEAR_MAX, swap: true, skipOpenDeps: true }, b.e, { maxSteps: 400 })
        PJ.releaseLease(dir, key, `slot${slot.slot}`, b.name, slot.gen)
        stops[v.stop] = (stops[v.stop] ?? 0) + 1
        { const s = W.blockedSeg(v.stop, v.why); if (s) b.blocked.set(s, t) }
        if (process.env.VERBOSE && v.stop !== 'complete') console.error(ph.ph, b.name, r, v.stop, v.why)
        t += 60_000
      }
      t += 10 * 60_000
    }
    const open = mine.filter(c => !isDone(c))
    perPhase.push({ ph: ph.ph, kind: ph.kind, cells: mine.length, open: open.length, rounds: r, openSample: open.slice(0, 6).map(c => `${c.at.join(',')}:${c.role}:${c.seg}:${read(...c.at)?.name}`) })
    if (open.length && !flag('force')) break
  }
  const ops = rows.filter(q => q.name === '_build').reduce((m, q) => { const kk = `${q.d.op}${q.d.kind ? ':' + q.d.kind : ''}`; m[kk] = (m[kk] ?? 0) + 1; return m }, {})
  // the walk after: nothing cut, nobody trapped on the world as the fake builders left it
  const escB = W.wallEscape(base, home, [], { r: R, seed: seedC })
  const after = W.wallEscape(read, home, [], { r: R, seed: seedC })
  built = { perPhase, stops, ops, gapViolations: gapViolations.length, gapSample: gapViolations.slice(0, 8), reachBefore: escB.reach0, reachAfter: after.reach0 }
  console.log(JSON.stringify({ build: built }, null, 1))
}

// ---- PICTURES (--png prefix) ---------------------------------------------------------------------------------------------------
if (opt('png')) {
  const des = new Map(design.cells.map(c => [c.at.join(','), c]))
  const pal = CW.citywallPalette(design.style)
  // the trees are left out of the views (TREES=1 keeps them): a spruce in front of the gate hides it
  const TREE = process.env.TREES === '1' ? /^$/ : /_leaves$|_log$/
  const before = (x, y, z) => { const b = base(x, y, z); return b && !TREE.test(b.name) ? { name: b.name } : null }
  // AFTER: the fake builders' world when built, else the design laid on the world (each cell its role's first block, its state)
  const after = built ? (x, y, z) => { const b = read(x, y, z); return b ? { name: b.name, st: stOf.get(`${x},${y},${z}`) ?? null } : null }
    : (x, y, z) => { const c = des.get(`${x},${y},${z}`); if (c) { const n = pal[c.role][0]; return { name: n, st: c.ws ?? (c.role === CW.CW.hang ? { hanging: 'true' } : null) } } const b = base(x, y, z); return b && !TREE.test(b.name) ? { name: b.name } : null }
  const NEW = [255, 220, 120]
  const mark = (x, y, z) => null
  const views = (opt('views') ?? '').split(';').filter(Boolean).map(v => { const [bx, from] = v.split(':'); return { box: bx.split(',').map(Number), from: from ?? 'se' } })
  const pics = []
  for (const [i, v] of views.entries()) {
    const b = isoWorld(before, v.box, { a: Number(opt('a', 5)), title: `BEFORE ${i + 1}`, from: v.from })
    const a = isoWorld(after, v.box, { a: Number(opt('a', 5)), title: `AFTER ${i + 1}`, from: v.from, mark })
    fs.writeFileSync(`${opt('png')}-view${i + 1}-before.png`, png(b.w, b.h, b.px))
    fs.writeFileSync(`${opt('png')}-view${i + 1}-after.png`, png(a.w, a.h, a.px))
    pics.push([b, a])
  }
  const [rx0, rz0, rx1, rz1] = rec0.ring
  const mbox = [rx0 - 6, 58, rz0 - 6, rx1 + 6, 84, rz1 + 6]
  const ovr = (x, z) => { for (let y = 84; y >= 58; y--) { const c = des.get(`${x},${y},${z}`); if (c) return c.role === CW.CW.lamp || c.role === CW.CW.hang ? [255, 200, 40, 255] : /tower|quoin|tcore|tmerlon|slit/.test(c.role) ? [200, 60, 60, 200] : /deck|dedge|key|parapet|haunch/.test(c.role) ? [200, 60, 220, 200] : null } return null }
  const m0 = topMap(before, mbox, { s: 4, title: `${PLOT} BEFORE (TOP)` })
  const m1 = topMap(after, mbox, { s: 4, title: `${PLOT} AFTER: RED TOWERS, MAGENTA GATE, YELLOW LAMPS`, over: ovr })
  fs.writeFileSync(`${opt('png')}-top-before.png`, png(m0.w, m0.h, m0.px))
  fs.writeFileSync(`${opt('png')}-top-after.png`, png(m1.w, m1.h, m1.px))
  const sh = sheet([[m0, m1], ...pics], `CITYWALL-01 ${PLOT}: ${design.style} style, ${design.counts.swapped} swapped, ${design.counts.added} added, ${design.counts.towers} towers, gate ${design.gate ? design.gate.P + ' wide' : 'none'}`)
  fs.writeFileSync(`${opt('png')}-sheet.png`, png(sh.w, sh.h, sh.px))
  console.log('wrote', `${opt('png')}-sheet.png`, sh.w, sh.h)
}
