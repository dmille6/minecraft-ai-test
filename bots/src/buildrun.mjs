// ONE BUILD VISIT (shop-01 stage B; design sections 4.1, 4.3 clearing B4, 4.4 the placement actuator, 4.6 refusal chains, 5).
// Every effect is injected, so the loop runs on a fake world in the tests and on mineflayer through buildbot.mjs; the code the
// sandbox proves is the code the bots run. Progress is the WORLD: every step re-reads it, nothing is counted.
//
// THE ORDER OF A VISIT (the two orders step 1's reviews asked to be stated, Claude r2/r3 P3):
//   1. REPLANT FIRST: every pending replant cell gets its sapling (planted, read back) before any trunk is felled (B4).
//   2. CLEARS, low before high: plants, leaves, scaffold litter and cuts, then tree logs from the BOTTOM UP while the bot stands
//      on the ground; a log a ground stand cannot reach waits until the pad exists and is felled from an eye on the pad (the
//      screen measured dig reach from pad eyes). A dig the server does not confirm marks the cell UNKNOWN: two resync probes, else
//      it is left and the segment that needs it yields.
//   3. SEGMENTS in the record's order (earth, pad, ring, walls, roof edge, roof inner, fit-out), each under its own lease and
//      only when its dependencies read COMPLETE in the world. Inside a segment the LOWEST placeable cell goes first, the nearest
//      to the bot among those: bottom-up wherever the world allows it, never a cell placed while one below it in the same column
//      is open (a cell above an open one waits).
//
// THE SEND PROTOCOL for every click (design 4.1, in this order, nothing awaited from the fence to the send):
//   look -> intent appended + fsynced (cell, block, segment-lease generation, sequence) -> mutex, non-blocking (busy: the intent
//   is cancelled, a free skip) -> fence (slot, segment, record generation, another's barrier) -> send block_place with the
//   sequence -> release the mutex at the ACKNOWLEDGEMENT of that sequence, or after MUTEX_HOLD_MS with the intent still open ->
//   the intent settled with the cell's state once acknowledged. A ROOF cell is a CLOSER (it closes over the interior): before its
//   send the builder takes the barrier under the mutex and waits until every other builder's open intent is settled, cancelled,
//   or its sender retired; never on a timer.

import { walkFrom, stepFor, sightClear, overlay, WALK_R, DIG_REACH, EYE } from './buildsite.mjs'
import { isSolid, replaceableCell } from './townplan.mjs'
import * as PJ from './buildproj.mjs'

const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => k3(a[0], a[1], a[2])
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')

export const BUILD_ATTEMPTS = 2
export const BARRIER_WAIT_MS = 60_000
export const DIG_CONFIRM_MS = 3_000
export const SPAWN_DIG_QUIET_MS = 3_000
export const PROBES_MAX = 2
export const RENEW_AT = 0.5
export const CLOSER_SEGS = new Set(['roof-edge', 'roof-inner'])
const SAPLING = /_sapling$|^mangrove_propagule$/

/** The block a cell's role wants, from what the bag holds -> a name | null. '$planks' is any planks species carried. */
export function blockFor (palette, role, has) {
  if (role === 'fill') return has('cobblestone') ? 'cobblestone' : null
  const seen = new Set()
  const pick = list => {
    for (const choice of list ?? []) {
      if (choice === '$planks') { const p = has.planks?.(); if (p) return p; continue }
      if (choice.startsWith('$')) { const r = choice.slice(1); if (seen.has(r)) continue; seen.add(r); const got = pick(palette[r]); if (got) return got; continue }
      if (has(choice)) return choice
    }
    return null
  }
  return pick(palette[role])
}
/** Does the world show this cell done? The role's palette names, any planks for '$planks'. Pure. */
export function cellDone (b, palette, role) {
  const n = nm(b)
  if (!n || n === 'air') return false
  if (role === 'fill') return isSolid(b)
  const ok = new Set()
  const add = list => { for (const c of list ?? []) { if (c === '$planks') ok.add('*planks'); else if (c.startsWith('$')) add(palette[c.slice(1)]); else ok.add(c) } }
  add(palette[role])
  return ok.has(n) || (ok.has('*planks') && /_planks$/.test(n))
}
/** Can two segments run at once? No cell, stand or support of one lies in the other's cells (design 4.1). Pure. */
export function concurrentOk (record, segA, segB) {
  if (segA === segB) return false
  const cells = s => record.cells.filter(c => c.seg === s)
  const A = cells(segA), Bc = cells(segB)
  const aCells = new Set(A.map(c => kOf(c.at))), bCells = new Set(Bc.map(c => kOf(c.at)))
  const touches = (xs, set) => xs.some(c => set.has(kOf(c.at)) || set.has(kOf(c.stand)) || set.has(kOf(c.support)))
  return !touches(A, bCells) && !touches(Bc, aCells)
}
/** The segments in the record's order with their dependencies (earth first when there is fill). Pure. */
export function segmentsOf (record) {
  return (record.segments ?? []).map(s => ({ seg: s.seg, deps: s.deps ?? [] }))
}
/** Is a segment COMPLETE in the world? Every one of its cells done. Pure. */
export function segComplete (read, record, palette, seg) {
  return record.cells.filter(c => c.seg === seg).every(c => cellDone(read(...c.at), palette, c.role))
}
/** A dig stand for a cell -> [x, y, z] | null: a walked-to node whose eye is within DIG_REACH of the cell centre, never on or under
 *  the cell, with a clear sight line to the cell's centre. Nearest wins. Pure. */
export function digStand (read, cell, nodes) {
  const [cx, cy, cz] = cell
  let best = null, bd = Infinity
  for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
    for (const sy of nodes.get(`${cx + dx},${cz + dz}`) ?? []) {
      const sx = cx + dx, sz = cz + dz
      if (sx === cx && sz === cz && sy - 1 <= cy && cy <= sy + 1) continue
      if (sx === cx && sz === cz && sy - 1 === cy) continue
      const eye = [sx + 0.5, sy + EYE, sz + 0.5], c = [cx + 0.5, cy + 0.5, cz + 0.5]
      const d = Math.hypot(eye[0] - c[0], eye[1] - c[1], eye[2] - c[2])
      if (d > DIG_REACH || d >= bd) continue
      if (!sightClear(read, eye, c, new Set([k3(cx, cy, cz)]))) continue
      best = [sx, sy, sz]; bd = d
    }
  }
  return best
}
const byColumn = keys => {
  const m = new Map()
  for (const key of keys) { const [x, y, z] = key.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) }
  return m
}

/**
 * ONE VISIT -> { stop, why, placed, refused, silent, cleared, planted, unknown, segs: [{ seg, open, done }] }.
 *   p   { dir, key, me, home, stood, record, recordGen, palette, slot, slotGen }   (the caller holds the admission slot)
 *   e   effects: read, feet, bodies, walkTo, hold, has, look, nextSeq, send, waitAck, dig, probe, retired, aborted, log,
 *       now, spawnedAt
 * Stops: complete | no_sapling | no_material | no_step | deps_open | fence:<why> | aborted | max_steps | deadline | unknown.
 */
export async function runVisit (p, e, { maxSteps = 300, deadline = Infinity, barrierWaitMs = BARRIER_WAIT_MS } = {}) {
  const out = { stop: null, why: null, placed: 0, refused: 0, silent: 0, cleared: 0, planted: 0, unknown: 0, segs: [], slotGen: p.slotGen }
  const { dir, key, me, home, record, palette } = p
  const stood = p.stood ?? []
  const now = () => e.now()
  let slotGen = p.slotGen, slotAt = now()
  const tries = new Map(), unknown = new Set()
  let needSapling = null
  const bump = c => { const n = (tries.get(kOf(c)) ?? 0) + 1; tries.set(kOf(c), n); return n }
  let steps = 0
  const guard = () => {
    if (e.aborted()) return 'aborted'
    if (++steps > maxSteps) return 'max_steps'
    if (now() > deadline) return 'deadline'
    return null
  }
  const renewSlot = () => {
    if (now() - slotAt < PJ.LEASE_TTL_MS * RENEW_AT) return true
    const g = PJ.renewLease(dir, key, `slot${p.slot}`, me, slotGen, { now: now() })
    if (!g) return false
    slotGen = g; slotAt = now(); out.slotGen = g; return true
  }
  const nodesFor = (block = new Set()) => byColumn(walkFrom(e.read, home, block, WALK_R, { stood }))

  // ---- the click (placements and saplings) -----------------------------------------------------------------------------------
  // -> 'placed' | 'refused' | 'silent' | 'busy' | 'fence:<why>' | 'barrier_wait' | 'body' | 'no_material' | 'stand'
  const click = async (cell, block, step, seg, segGen, { closer = false, want = null } = {}) => {
    await e.walkTo(step.stand)
    if (e.aborted()) return 'aborted'
    // RE-PROVED WHERE THE BOT IS: the same stand rules from the feet it actually has
    const feet = e.feet()
    const here = stepFor(e.read, home, cell, new Map([[`${feet[0]},${feet[2]}`, [feet[1]]]]))
    if (!here) return 'stand'
    if ((e.bodies() ?? []).some(b => inCell(b, cell) || inCell(b, [cell[0], cell[1] + 1, cell[2]]))) return 'body'
    if (!(await e.hold(block))) return 'no_material'
    await e.look(here.support, here.face)
    if (e.aborted()) return 'aborted'
    let barGen = null
    if (closer) {
      const m = PJ.mutexTake(dir, key, me, { now: now() })
      if (!m.ok) return 'busy'
      const b = PJ.barrierTake(dir, key, me, { why: 'closer', cell, now: now() })
      PJ.mutexRelease(dir, key, me)
      if (!b.ok) return 'busy'
      barGen = b.gen
      const until = now() + barrierWaitMs
      while (!PJ.barrierClear(dir, key, me, { retired: e.retired(), now: now() }).clear) {
        if (e.aborted()) { PJ.barrierRelease(dir, key, me, barGen); return 'aborted' }
        if (now() > until) { PJ.barrierRelease(dir, key, me, barGen); return 'barrier_wait' }
        await e.sleep(250)
      }
      // the wait moved time: look again (a fresh face), nothing awaited after this
      await e.look(here.support, here.face)
    }
    try {
      const seq = e.nextSeq()
      const id = PJ.intentOpen(dir, key, me, { cell, block, lease: segGen, seq, now: now() })
      const m = PJ.mutexTake(dir, key, me, { now: now() })
      if (!m.ok) { PJ.intentClose(dir, key, me, id, 'cancelled', { now: now() }); return 'busy' }
      let released = false
      const release = () => { if (!released) { released = true; PJ.mutexRelease(dir, key, me) } }
      try {
        const why = PJ.fenceRefusal(dir, key, me, { slot: p.slot, slotGen, seg, segGen, recordGen: p.recordGen, now: now() })
        if (why) { PJ.intentClose(dir, key, me, id, 'cancelled', { now: now() }); return `fence:${why}` }
        if (!replaceableCell(e.read(...cell)) && nm(e.read(...cell)) !== 'air') { PJ.intentClose(dir, key, me, id, 'cancelled', { now: now() }); return 'refused' }
        e.send(here.support, here.face, seq)   // SYNCHRONOUS after the fence: no await between them
        const v = await e.waitAck(seq, PJ.MUTEX_HOLD_MS)
        release()
        if (v !== 'acked') return 'silent'   // the intent stays OPEN: a barrier waits for it until its ack or our retirement
        const state = nm(e.read(...cell))
        PJ.intentClose(dir, key, me, id, 'settled', { state, now: now() })
        return (want ? want(e.read(...cell)) : state === block) ? 'placed' : 'refused'
      } finally { release() }
    } finally { if (barGen != null) PJ.barrierRelease(dir, key, me, barGen) }
  }

  // ---- 1. replant first --------------------------------------------------------------------------------------------------------
  for (const r of record.replant ?? []) {
    const g = guard(); if (g) { out.stop = g; return out }
    if (SAPLING.test(nm(e.read(...r.cell)))) continue
    // C1: no sapling in the bag -- the clear waits (its tree stands), the other work goes on; the visit reports it at its end
    if (!e.has(r.sapling)) { needSapling = r.sapling; continue }
    const nodes = nodesFor()
    const step = stepFor(e.read, home, r.cell, nodes)
    if (!step || step.support[1] !== r.cell[1] - 1) { out.stop = 'no_step'; out.why = `replant ${r.cell.join(',')}`; return out }
    if (!renewSlot()) { out.stop = 'fence:slot'; return out }
    const seg = PJ.takeLease(dir, key, 'seg-clear', me, { now: now() })
    if (!seg.ok) { out.stop = 'deps_open'; out.why = 'the clear lease is held'; return out }
    const v = await click(r.cell, r.sapling, step, 'clear', seg.gen, { want: b => SAPLING.test(nm(b)) })
    PJ.releaseLease(dir, key, 'seg-clear', me, seg.gen)
    if (v === 'placed') { out.planted++; e.log('_build', { op: 'replant', cell: r.cell, block: r.sapling }) } else if (v.startsWith('fence') || v === 'aborted') { out.stop = v; return out } else { out.stop = 'no_step'; out.why = `replant ${r.cell.join(',')}: ${v}`; return out }
  }

  // ---- 2. clears, low before high; logs only once every replant reads planted ---------------------------------------------------
  // Re-run after every segment that completes: a log no ground stand reaches comes down once the pad gives it an eye
  const replanted = () => (record.replant ?? []).every(r => SAPLING.test(nm(e.read(...r.cell))))
  const isClear = at => { const b = e.read(...at); return !!b && (nm(b) === 'air' || replaceableCell(b)) }
  const clears = async () => {
    // ONLY THE BLOCK THE RECORD NAMES THERE: a cell already built into (the pad laid over a felled trunk's cell) is never dug
    const todo = (record.clear ?? []).filter(c => nm(e.read(...c.at)) === c.name && !unknown.has(kOf(c.at))).sort((a, b) => a.at[1] - b.at[1])
    if (!todo.length) return null
    const seg = PJ.takeLease(dir, key, 'seg-clear', me, { now: now() })
    if (!seg.ok) return null                                       // another builder is clearing: its segments wait for it
    try {
      for (const c of todo) {
        const g = guard(); if (g) return g
        if (c.kind === 'tree' && !replanted()) { needSapling ??= 'a sapling'; continue }   // never a tree before its sapling (B4)
        if (now() - (e.spawnedAt?.() ?? 0) < SPAWN_DIG_QUIET_MS) await e.sleep(SPAWN_DIG_QUIET_MS)
        const stand = digStand(e.read, c.at, nodesFor())
        if (!stand) continue                                       // not from here yet: after the next segment, or the next visit
        if (!renewSlot() || !PJ.holdsLease(dir, key, 'seg-clear', me, seg.gen, now())) return 'fence:segment'
        await e.walkTo(stand)
        let v = await e.dig(c.at)
        for (let i = 0; v === 'unconfirmed' && i < PROBES_MAX; i++) { await e.probe(c.at); v = isClear(c.at) ? 'confirmed' : 'unconfirmed' }
        if (v === 'confirmed') { out.cleared++; e.log('_build', { op: 'clear', cell: c.at, block: c.name, kind: c.kind }) } else if (v === 'unconfirmed') { unknown.add(kOf(c.at)); out.unknown++ }
      }
      return null
    } finally { PJ.releaseLease(dir, key, 'seg-clear', me, seg.gen) }
  }
  { const s = await clears(); if (s) { out.stop = s; return out } }

  // ---- 3. segments ------------------------------------------------------------------------------------------------------------
  for (const { seg, deps } of segmentsOf(record)) {
    if (segComplete(e.read, record, palette, seg)) continue
    if (!deps.every(d => segComplete(e.read, record, palette, d))) { out.stop = 'deps_open'; out.why = `${seg} waits for ${deps.filter(d => !segComplete(e.read, record, palette, d)).join(',')}`; return out }
    const lease = PJ.takeLease(dir, key, `seg-${seg}`, me, { now: now() })
    if (!lease.ok) continue                                          // another builder holds it: the next segment
    let segGen = lease.gen, segAt = now()
    const row = { seg, open: 0, done: 0 }
    let finished = false
    try {
      for (;;) {
        const g = guard(); if (g) { out.stop = g; return out }
        const mine = record.cells.filter(c => c.seg === seg)
        const open = mine.filter(c => !cellDone(e.read(...c.at), palette, c.role))
        row.open = open.length; row.done = mine.length - open.length
        if (!open.length) { finished = true; break }
        if (now() - segAt >= PJ.LEASE_TTL_MS * RENEW_AT) { const ng = PJ.renewLease(dir, key, `seg-${seg}`, me, segGen, { now: now() }); if (!ng) { out.stop = 'fence:segment'; return out } segGen = ng; segAt = now() }
        if (!renewSlot()) { out.stop = 'fence:slot'; return out }
        const blocking = new Set(open.filter(c => c.role !== 'light').map(c => kOf(c.at)))
        const nodes = nodesFor(blocking)
        const feet = e.feet()
        // BOTTOM-UP: never a cell while one below it in its column is open; never a cell still holding an uncleared block
        const below = c => open.some(o => o !== c && o.at[0] === c.at[0] && o.at[2] === c.at[2] && o.at[1] < c.at[1])
        const cand = open.filter(c => (tries.get(kOf(c.at)) ?? 0) < BUILD_ATTEMPTS && !below(c) && isClear(c.at))
          .sort((a, b) => a.at[1] - b.at[1] || Math.hypot(a.at[0] - feet[0], a.at[2] - feet[2]) - Math.hypot(b.at[0] - feet[0], b.at[2] - feet[2]))
        let picked = null, step = null
        for (const c of cand) { step = stepFor(e.read, home, c.at, nodes); if (step) { picked = c; break } }
        if (!picked) {
          out.stop = open.some(c => !isClear(c.at)) ? (needSapling ? 'no_sapling' : 'blocked') : cand.length ? 'no_step' : 'attempts_spent'
          out.why = `${seg}: ${open.length} open, ${cand.length} placeable now`
          return out
        }
        const block = blockFor(palette, picked.role, e.has)
        if (!block) { out.stop = 'no_material'; out.why = `${picked.role} for ${seg}`; return out }
        const v = await click(picked.at, block, step, seg, segGen, { closer: CLOSER_SEGS.has(seg), want: b => cellDone(b, palette, picked.role) })
        if (v === 'placed') { out.placed++; e.log('_build', { op: 'place', seg, cell: picked.at, block }); continue }
        if (v.startsWith('fence:') || v === 'aborted' || v === 'no_material') { out.stop = v; return out }
        if (v === 'busy') { await e.sleep(100); continue }            // a free skip: the mutex or the barrier is another's
        bump(picked.at)                                               // body, stand, barrier_wait, refused, silent: an attempt
        if (v === 'refused') out.refused++
        if (v === 'silent') out.silent++
      }
    } finally { PJ.releaseLease(dir, key, `seg-${seg}`, me, segGen); out.segs.push(row); e.log('_build_seg', { seg, open: row.open, done: row.done }) }
    if (finished) { const s = await clears(); if (s) { out.stop = s; return out } }
  }
  out.stop = record.cells.every(c => cellDone(e.read(...c.at), palette, c.role)) ? 'complete' : needSapling ? 'no_sapling' : 'unknown'
  if (out.stop === 'no_sapling') out.why = `${needSapling}: withdraw saplings from town (C1)`
  return out
}

/** Does an entity box touch a cell? */
export function inCell (b, [x, y, z]) {
  const w = (b.w ?? 0.6) / 2, h = b.h ?? 1.8
  return b.x + w > x && b.x - w < x + 1 && b.z + w > z && b.z - w < z + 1 && b.y + h > y && b.y < y + 1
}
export { overlay }
