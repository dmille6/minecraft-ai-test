// ONE BUILD VISIT (shop-01 stage B; design sections 4.1, 4.3 clearing B4, 4.4 the placement actuator, 4.6 refusal chains, 5).
// Every effect is injected, so the loop runs on a fake world in the tests and on mineflayer through buildbot.mjs; the code the
// sandbox proves is the code the bots run. Progress is the WORLD: every step re-reads it, nothing is counted.
//
// THE ORDER OF A VISIT (the two orders step 1's reviews asked to be stated, Claude r2/r3 P3):
//   0. OWN LEFTOVERS CLOSED: an open intent of an earlier connection of ours is cancelled, one already acknowledged is settled.
//   1. REPLANT FIRST: every pending replant cell gets its sapling (planted, read back) before any trunk is felled (B4).
//   2. CLEARS, low before high: plants, leaves, scaffold litter and cuts, then tree logs from the BOTTOM UP while the bot stands
//      on the ground; a log a ground stand cannot reach waits until the pad exists and is felled from an eye on the pad (the
//      screen measured dig reach from pad eyes). The named block and the leases are checked again AT the dig, after the walk.
//      A dig the server does not confirm marks the cell UNKNOWN: up to two resync probes, each answered by the SERVER's word on
//      the cell or by nothing; still unanswered, the cell stays unknown -- for the connection, across visits (`p.unknown`) --
//      and reads as unknown to every geometry of the visit (no stand, no support, never placed into) until a probe answers.
//   3. SEGMENTS in the record's order (earth, pad, ring, walls, roof edge, roof inner, fit-out), each under its own lease and
//      only when its dependencies read COMPLETE in the world. Inside a segment the LOWEST placeable cell goes first, the nearest
//      to the bot among those: bottom-up wherever the world allows it, never a cell placed while one below it in the same column
//      is open (a cell above an open one waits). A record cell holding a SCAFFOLD-CLASS foreign block (dirt, cobble, stone...:
//      FOREIGN_CLEAR) is dug first, under the segment's lease; so is a TREE (TREE_CLEAR: a log, with the trunk above it, or
//      leaves); a container or a station in a record cell stalls the segment.
//
// THE SEND PROTOCOL for every click (design 4.1, in this order, nothing awaited from the fence to the send):
//   look -> intent appended + fsynced (cell, block, segment-lease generation, sequence, connection) -> mutex, non-blocking (busy:
//   the intent is cancelled, a free skip) -> fence (slot, segment, record generation, another's barrier) -> send block_place
//   with the sequence -> release the mutex at the ACKNOWLEDGEMENT of that sequence, or after MUTEX_HOLD_MS with the intent still
//   open (and still TRACKED: a later acknowledgement settles it, buildack.mjs) -> the intent settled once acknowledged. A ROOF
//   cell is a CLOSER (it closes over the interior): before its send the builder takes the barrier under the mutex and waits
//   until every other builder's open intent is settled, cancelled, or its sender retired (buildproj.mjs intentRetired); never on
//   a timer. After the wait the block is HELD again and the face looked at again.

import { walkFrom, stepFor, sightClear, overlay, WALK_R, DIG_REACH, EYE, replantAlternative } from './buildsite.mjs'
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
export const REPLANT_MOVES = 4      // a replant moves at most this often (each to a cell never tried before)
export const REPLANT_DEFERS = 3     // visits with no plantable cell anywhere in the walk before the replant is skipped
export const STUCK_VISITS = 3       // visits a record cell may find no stand before the build reports stuck_on_cell (F4)
export const STUCK_FORGET_MS = 24 * 60 * 60_000   // a deferral older than this no longer counts: a changed town gets a fresh count (Claude r22 P3)
/**
 * THE STUCK MAP AFTER A VISIT (F4) -> { cells, stuck: [key] }. Pure. `prev` the file's map, `deferred` the cells this visit found
 * no stand for, `done(k)` whether a cell now reads done. A deferred cell counts one more visit; a cell that now reads done (built
 * from a later stand, or by another builder) leaves the map; the others carry over. `stuck`: the cells at STUCK_VISITS or more.
 */
export function stuckAfter (prev = {}, deferred = [], { done = () => false, now = Date.now(), by = null, limit = STUCK_VISITS } = {}) {
  const cells = {}
  for (const [k, v] of Object.entries(prev ?? {})) if (!done(k)) cells[k] = { ...v }
  for (const k of new Set(deferred)) {
    if (done(k)) continue
    const v = cells[k] ?? { visits: 0, firstAt: now, by }
    cells[k] = { ...v, visits: (Number(v.visits) || 0) + 1, lastAt: now, by }
  }
  return { cells, stuck: Object.keys(cells).filter(k => cells[k].visits >= limit) }
}
const SAPLING = /_sapling$|^mangrove_propagule$/
const AIR = n => n === 'air' || n === 'cave_air'
// a foreign block in a record cell that the builder may dig (design 4.3 B4 "scaffold-class"; Claude r1 P3-9): terrain and the
// fleet's scaffold. Never a container, a station or a part: those stall the segment and say so
export const FOREIGN_CLEAR = /^(cobblestone|dirt|coarse_dirt|grass_block|stone|andesite|diorite|granite|netherrack|cobbled_deepslate|deepslate|gravel)$/
// A TREE IN A RECORD CELL (fell-01, LIVE 10-27 showcase shop: a spruce grew into pad cell 25,72,28 after siting, trunk 72..76;
// FOREIGN_CLEAR has no logs, so the pad read `blocked: 1 open, 0 placeable now` for good at 62/63). Any log species, or leaves.
export const TREE_CLEAR = /_(log|leaves)$/
/** What a foreign block in an open record cell is -> 'scaffold' | 'tree' | null (never dug: a container, a station, a part). Pure. */
export function foreignKind (n) {
  const s = String(n ?? '')
  if (FOREIGN_CLEAR.test(s)) return 'scaffold'
  if (TREE_CLEAR.test(s)) return 'tree'
  return null
}
/** The most logs felled above one cleared cell. */
export const TRUNK_MAX = 12
/**
 * THE TRUNK ABOVE a log cell -> [[x, y, z], ...] lowest first: the contiguous column of logs directly above `at`, at most `max`,
 * stopping at the first non-log, an unread cell, or a cell `keep` says stays (a record cell that reads DONE). Felled with the
 * cell so no trunk is left floating over the pad and the walls above are not left holding it. Pure.
 */
export function trunkAbove (read, at, { max = TRUNK_MAX, keep = () => false } = {}) {
  const out = []
  for (let y = at[1] + 1; out.length < max; y++) {
    const c = [at[0], y, at[2]]
    const b = read(...c)
    if (!b || !/_log$/.test(nm(b)) || keep(c)) break
    out.push(c)
  }
  return out
}

/**
 * A BLOCK'S FAMILY for "is this cell done" (r2, Claude r1 P2-1): a torch clicked onto a side face IS a wall_torch; cut copper
 * weathers (exposed_, weathered_, oxidized_) and may be waxed. Pure.
 */
export function blockFamily (n) {
  const s = String(n ?? '')
  if (s === 'wall_torch') return 'torch'
  if (s === 'soul_wall_torch') return 'soul_torch'
  if (/copper/.test(s)) return s.replace(/^waxed_/, '').replace(/^(exposed|weathered|oxidized)_/, '')
  return s
}
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
/** Does the world show this cell done? The role's palette names BY FAMILY, any planks for '$planks'. Pure. */
export function cellDone (b, palette, role) {
  const n = nm(b)
  if (!n || n === 'air') return false
  if (role === 'fill') return isSolid(b)
  const ok = new Set()
  const add = list => { for (const c of list ?? []) { if (c === '$planks') ok.add('*planks'); else if (c.startsWith('$')) add(palette[c.slice(1)]); else ok.add(blockFamily(c)) } }
  add(palette[role])
  return ok.has(blockFamily(n)) || (ok.has('*planks') && /_planks$/.test(n))
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
/**
 * THE SEGMENT A VISIT WOULD WORK NOW -> seg | null, in runVisit's own order: the first incomplete segment whose deps are complete
 * and whose lease `free(seg)` (none, ours, or lapsed); null where the visit would stop deps_open (an incomplete segment whose deps
 * are open) or find every open segment held. Pure. build_shop draws the planks' LOGS only when this names one (shopwalls-02:
 * LIVE 10-28, builders waiting on another's roof lease drew 9 logs each, 36 planks into bags, and stopped deps_open).
 */
export function workableSeg (record, read, palette, free = () => true) {
  for (const { seg, deps } of segmentsOf(record)) {
    if (segComplete(read, record, palette, seg)) continue
    if (!deps.every(d => segComplete(read, record, palette, d))) return null
    if (free(seg)) return seg
  }
  return null
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
 * ONE VISIT -> { stop, why, placed, refused, silent, cleared, planted, unknown, segs: [{ seg, open, done }], slotGen }.
 *   p   { dir, key, me, home, stood, record, recordGen, palette, slot, slotGen, slotRef?, unknown? }   (the caller holds the
 *       admission slot; `slotRef.gen` follows every renewal, for the caller's release on ANY exit; `unknown` a Set kept for the
 *       connection)
 *   e   effects: read, feet, bodies, walkTo, hold, has, look, nextSeq, send, waitAck, track, untrack, conn, acked, seen, dig,
 *       probe, aborted, log, now, sleep, spawnedAt
 * Stops: complete | no_sapling | no_material | no_step | deps_open | fence:<why> | aborted | max_steps | deadline | blocked |
 *        attempts_spent | unknown.
 */
export async function runVisit (p, e, { maxSteps = 300, deadline = Infinity, barrierWaitMs = BARRIER_WAIT_MS } = {}) {
  // placedBy: every acknowledged placement by the block name HELD (the bag's own unit: a torch that lands as a wall_torch is a torch);
  // the caller's own object when given, so an aborted visit still reports what it placed
  const out = { stop: null, why: null, placed: 0, refused: 0, silent: 0, cleared: 0, planted: 0, unknown: 0, segs: [], slotGen: p.slotGen, placedBy: p.placedBy ?? {} }
  const tally = name => { out.placedBy[name] = (out.placedBy[name] ?? 0) + 1 }
  const { dir, key, me, home, record, palette } = p
  const stood = p.stood ?? []
  const now = () => e.now()
  const slotRef = p.slotRef ?? { gen: p.slotGen }
  let slotGen = p.slotGen, slotAt = now()
  slotRef.gen = slotGen
  const tries = new Map()
  const unknown = p.unknown ?? new Set()
  // THE VISIT'S READ: an UNKNOWN cell (a dig the server never answered) reads as unknown -- no stand, no support, never clear
  const rd = (x, y, z) => (unknown.has(k3(x, y, z)) ? null : e.read(x, y, z))
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
    slotGen = g; slotAt = now(); out.slotGen = g; slotRef.gen = g; return true
  }
  const nodesFor = (block = new Set()) => byColumn(walkFrom(rd, home, block, WALK_R, { stood }))
  const conn = e.conn?.() ?? null
  const isRetired = (i, t) => PJ.intentRetired(i, { presence: PJ.presenceRead(dir, key, i.holder), ...(e.seen?.(i.holder, t) ?? {}), now: t })
  // the mutex's holder RETIRED (offline RETIRE_MS as this bot has seen it): it cannot send (Codex r2 P2: a reused pid kept a dead
  // holder's lock alive for good)
  const gone = rec => (!!rec?.holder && rec.holder !== me && PJ.holderGone(Number(rec.at), { ...(e.seen?.(rec.holder, now()) ?? {}), conn: rec.conn ?? null, presence: PJ.presenceRead(dir, key, rec.holder), now: now() }))
  const mutex = () => PJ.mutexTake(dir, key, me, { now: now(), conn, gone })

  // ---- 0. our own leftovers (an earlier connection's intents; acknowledgements that came after the click stopped waiting) ------
  PJ.closeOwn(dir, key, me, { conn, acked: e.acked?.() ?? 0, now: now() })

  // ---- the click (placements and saplings) -----------------------------------------------------------------------------------
  // -> 'placed' | 'refused' | 'silent' | 'busy' | 'fence:<why>' | 'barrier_wait' | 'body' | 'no_material' | 'stand'
  const click = async (cell, block, step, seg, segGen, { closer = false, want = null } = {}) => {
    await e.walkTo(step.stand)
    if (e.aborted()) return 'aborted'
    // RE-PROVED WHERE THE BOT IS: the same stand rules from the feet it actually has
    const feet = e.feet()
    const here = stepFor(rd, home, cell, new Map([[`${feet[0]},${feet[2]}`, [feet[1]]]]))
    if (!here) return 'stand'
    if ((e.bodies() ?? []).some(b => inCell(b, cell) || inCell(b, [cell[0], cell[1] + 1, cell[2]]))) return 'body'
    // ...AND ITS OWN: a jump or a step-up puts the builder's head into the cell above it for a moment -- wait for it to land
    for (let i = 0; i < 5 && e.self && inCell(e.self(), cell); i++) await e.sleep(100)
    if (e.self && inCell(e.self(), cell)) return 'body'
    if (!(await e.hold(block))) return 'no_material'
    await e.look(here.support, here.face)
    if (e.aborted()) return 'aborted'
    let barGen = null
    if (closer) {
      const m = mutex()
      if (!m.ok) return 'busy'
      const b = PJ.barrierTake(dir, key, me, { why: 'closer', cell, now: now() })
      PJ.mutexRelease(dir, key, me, { gen: m.gen })
      if (!b.ok) return 'busy'
      barGen = b.gen
      const until = now() + barrierWaitMs
      while (!PJ.barrierClear(dir, key, me, { isRetired, now: now() }).clear) {
        if (e.aborted()) { PJ.barrierRelease(dir, key, me, barGen); return 'aborted' }
        if (now() > until) { PJ.barrierRelease(dir, key, me, barGen); return 'barrier_wait' }
        await e.sleep(250)
      }
      // the wait moved time (Claude r1 P3-1: a reflex or a meal may have changed the hand): hold the block again, look again;
      // nothing awaited after this
      if (!(await e.hold(block))) { PJ.barrierRelease(dir, key, me, barGen); return 'no_material' }
      await e.look(here.support, here.face)
      // an abort while the re-hold or the re-look was awaited (lavastep's danger move reserves the body and aborts the skill:
      // Claude re-stack P3) sends nothing
      if (e.aborted()) { PJ.barrierRelease(dir, key, me, barGen); return 'aborted' }
    }
    try {
      const seq = e.nextSeq()
      const id = PJ.intentOpen(dir, key, me, { cell, block, lease: segGen, seq, conn, now: now() })
      const cancel = () => PJ.intentClose(dir, key, me, id, 'cancelled', { now: now() })
      const m = mutex()
      if (!m.ok) { cancel(); return 'busy' }
      let released = false
      const release = () => { if (!released) { released = true; PJ.mutexRelease(dir, key, me, { gen: m.gen }) } }
      try {
        const why = PJ.fenceRefusal(dir, key, me, { slot: p.slot, slotGen, seg, segGen, recordGen: p.recordGen, beatConn: p.beat ? conn : null, now: now() })
        if (why) { cancel(); return `fence:${why}` }
        if (!replaceableCell(rd(...cell)) && nm(rd(...cell)) !== 'air') { cancel(); return 'refused' }
        e.send(here.support, here.face, seq)   // SYNCHRONOUS after the fence: no await between them
        const v = await e.waitAck(seq, PJ.MUTEX_HOLD_MS)
        release()
        // the intent stays OPEN and is TRACKED by the connection: its acknowledgement, however late, settles it (buildack.mjs)
        if (v !== 'acked') { e.track?.(id, seq); return 'silent' }
        const state = nm(e.read(...cell))
        PJ.intentClose(dir, key, me, id, 'settled', { state, now: now() })
        return (want ? want(e.read(...cell)) : state === block) ? 'placed' : 'refused'
      } finally { release() }
    } finally { if (barGen != null) PJ.barrierRelease(dir, key, me, barGen) }
  }

  // ---- a dig of a NAMED block (clears and foreign blocks) ----------------------------------------------------------------------
  // -> 'confirmed' | 'standing' | 'unconfirmed' | 'refused' | 'gone' | 'no_stand' | 'fence' | 'aborted'. The named block and the
  // lease are checked AGAIN after the walk, at the dig (Codex r1 P2: a replacement placed during the walk, or a lease lapsed in it,
  // was dug anyway). An unconfirmed dig asks the server (the probe): air confirms, any other name means it stands, nothing leaves
  // the cell unknown.
  const digNamed = async (at, name, held) => {
    const stand = digStand(rd, at, nodesFor())
    if (!stand) return 'no_stand'
    if (!renewSlot() || !held()) return 'fence'
    await e.walkTo(stand)
    if (e.aborted()) return 'aborted'
    if (nm(rd(...at)) !== name) return 'gone'
    if (!renewSlot() || !held()) return 'fence'
    let v = await e.dig(at, name)
    for (let i = 0; v === 'unconfirmed' && i < PROBES_MAX; i++) { const n = await e.probe(at); if (n != null) v = AIR(n) ? 'confirmed' : 'standing' }
    if (v === 'unconfirmed') { unknown.add(kOf(at)); out.unknown++; e.log('_build', { op: 'unknown', cell: at, block: name }) }
    return v
  }
  /** An unknown cell, asked again from a stand in reach -> its server name | null (still unknown). */
  const resolveUnknown = async at => {
    const stand = digStand(e.read, at, nodesFor())
    if (!stand) return null
    await e.walkTo(stand)
    const n = await e.probe(at)
    if (n != null) { unknown.delete(kOf(at)); e.log('_build', { op: 'known', cell: at, block: n }) }
    return n
  }

  // ---- 1. replant first --------------------------------------------------------------------------------------------------------
  // THE REPLANT REMEDY (F2; Paper 10-25 SHOP-TERRAIN hive-c: `no_step replant` every visit for 40 min, nothing placed): a replant
  // the visit cannot plant never stops the build. One record transition, then the visit ends `replanned` (the next visit builds
  // on the new generation), BOUNDED (r19, both r18 reviews):
  //   MOVE   to the nearest cell replantCellAt accepts from here -- the band, then the whole town walk -- never a cell this
  //          replant was already refused at (`tried`: no A -> B -> A) nor one another replant holds IN THE HEAD being written
  //          (the CAS re-checks it: no two trunks on one sapling), at most REPLANT_MOVES times;
  //   DEFER  with no such cell (the walk may be partial, a chunk unloaded): the obligation stands, counted, REPLANT_DEFERS visits;
  //   SKIP   only after the moves and the deferrals are spent: NAMED DEVIATION from design S2 ("never a felled tree without its
  //          sapling"), the coordinator's 10-26 remedy; the read reports every skip (`replant_skipped`) and G5 counts the rest.
  //   With the town's reservations unreadable (p.resFailed) nothing moves or skips: the visit ends `replant_wait`.
  const replantRemedy = (r, nodes, why) => {
    const at = r.cell.join(',')
    if (p.resFailed) { out.stop = 'replant_wait'; out.why = `replant ${at}: ${why}; the town's reservations could not be read`; return out }
    const tried = (r.tried ?? []).some(c => c.join(',') === at) ? [...r.tried] : [...(r.tried ?? []), r.cell]   // each cell once
    const alt = (r.moves ?? 0) < REPLANT_MOVES ? replantAlternative(rd, home, record, nodes, p.res ?? null, tried) : null
    let kind = null
    const pub = PJ.publishRecord(dir, key, cur => {
      kind = null                                       // per attempt: a lost CAS retried against a newer head re-decides (Codex r19 P3)
      const i = (cur?.replant ?? []).findIndex(x => x.cell.join(',') === at && x.state !== 'skipped')
      if (i < 0) return null
      const x = cur.replant[i]
      if (alt && cur.replant.some((y, j) => j !== i && y.state !== 'skipped' && y.cell.join(',') === alt.join(','))) return null
      if (alt) { cur.replant[i] = { ...x, cell: alt, movedFrom: x.cell, tried, moves: (x.moves ?? 0) + 1 }; kind = 'replant_moved' }
      else if ((x.deferred ?? 0) + 1 >= REPLANT_DEFERS) { cur.replant[i] = { ...x, tried, state: 'skipped', skippedAt: now() }; kind = 'replant_skipped' }
      else { cur.replant[i] = { ...x, tried, deferred: (x.deferred ?? 0) + 1, deferredAt: now() }; kind = 'replant_deferred' }
      return cur
    }, { by: me })
    if (pub.result !== 'accepted') kind = null       // logged only for a transition that was written
    e.log('_build', { op: kind ?? 'replant_unchanged', cell: r.cell, why, ...(alt && kind === 'replant_moved' ? { to: alt.join(',') } : {}), result: pub.result })
    out.stop = 'replanned'; out.why = `replant ${at}: ${why} -> ${kind ?? 'unchanged (another builder moved it first)'}${alt && kind === 'replant_moved' ? ` ${alt.join(',')}` : ''}`
    return out
  }
  for (const r of record.replant ?? []) {
    const g = guard(); if (g) { out.stop = g; return out }
    if (r.state === 'skipped') continue
    if (SAPLING.test(nm(rd(...r.cell)))) continue
    // C1: no sapling in the bag -- the clear waits (its tree stands), the other work goes on; the visit reports it at its end
    if (!e.has(r.sapling)) { needSapling = r.sapling; continue }
    const nodes = nodesFor()
    const step = stepFor(rd, home, r.cell, nodes)
    if (!step || step.support[1] !== r.cell[1] - 1) return replantRemedy(r, nodes, 'no_step')
    if (!renewSlot()) { out.stop = 'fence:slot'; return out }
    const seg = PJ.takeLease(dir, key, 'seg-clear', me, { now: now() })
    if (!seg.ok) { out.stop = 'deps_open'; out.why = 'the clear lease is held'; return out }
    const v = await click(r.cell, r.sapling, step, 'clear', seg.gen, { want: b => SAPLING.test(nm(b)) })
    PJ.releaseLease(dir, key, 'seg-clear', me, seg.gen)
    // a silent replant click is counted (Claude read r3 P3-1: its late acknowledgement may have planted the sapling untallied, so
    // the bag row must not read as a clean exit)
    if (v === 'silent') out.silent++
    if (v === 'placed') { out.planted++; tally(r.sapling); e.log('_build', { op: 'replant', cell: r.cell, block: r.sapling }) } else if (v.startsWith('fence') || v === 'aborted') { out.stop = v; return out } else if (v === 'stand' || v === 'refused') {
      // the walk did not reach the proven stand, or the server refused the sapling: the same remedy as no step (r19, both r18
      // reviews: any other outcome ended the visit no_step, every visit, forever)
      return replantRemedy(r, nodesFor(), v)
    } else { out.stop = v; out.why = `replant ${r.cell.join(',')}: ${v}`; return out }   // busy, body, silent: transient, retried next visit
  }

  // ---- 2. clears, low before high; logs only once every replant reads planted ---------------------------------------------------
  // Re-run after every segment that completes: a log no ground stand reaches comes down once the pad gives it an eye
  const replanted = () => (record.replant ?? []).every(r => r.state === 'skipped' || SAPLING.test(nm(rd(...r.cell))))
  const isClear = at => { const b = rd(...at); return !!b && (nm(b) === 'air' || replaceableCell(b)) }
  const clears = async () => {
    // ONLY THE BLOCK THE RECORD NAMES THERE: a cell already built into (the pad laid over a felled trunk's cell) is never dug;
    // an UNKNOWN cell is asked again first. AND NEVER A RECORD CELL THAT READS DONE (Paper 10-25 SHOP-TERRAIN board-a: a town's
    // oak_planks litter listed for clearing at a WALL cell; the bot cleared it, placed its own oak_planks there -- the same name
    // -- and the next visit cleared its own wall again, then could not re-place it: `no_step` every visit for 35 min)
    const roleAt = new Map(record.cells.map(c => [kOf(c.at), c.role]))
    const builtDone = c => roleAt.has(kOf(c.at)) && cellDone(e.read(...c.at), palette, roleAt.get(kOf(c.at)))
    const todo = (record.clear ?? []).filter(c => unknown.has(kOf(c.at)) || nm(e.read(...c.at)) === c.name).sort((a, b) => a.at[1] - b.at[1])
    if (!todo.length) return null
    const seg = PJ.takeLease(dir, key, 'seg-clear', me, { now: now() })
    if (!seg.ok) return null                                       // another builder is clearing: its segments wait for it
    const held = () => PJ.holdsLease(dir, key, 'seg-clear', me, seg.gen, now())
    try {
      for (const c of todo) {
        const g = guard(); if (g) return g
        if (c.kind === 'tree' && !replanted()) { needSapling ??= 'a sapling'; continue }   // never a tree before its sapling (B4)
        if (unknown.has(kOf(c.at))) { const n = await resolveUnknown(c.at); if (n == null || n !== c.name) continue }
        if (nm(rd(...c.at)) !== c.name) continue
        if (builtDone(c)) continue      // AT the dig (one guard for every path: an UNKNOWN cell resolved to a done one, r15 Codex P2)
        if (now() - (e.spawnedAt?.() ?? 0) < SPAWN_DIG_QUIET_MS) await e.sleep(SPAWN_DIG_QUIET_MS)
        const v = await digNamed(c.at, c.name, held)
        if (v === 'fence') return 'fence:segment'
        if (v === 'aborted') return 'aborted'
        // a felled tree's row carries the replant cells reading a sapling AT the felling, of all of them (the read's G5)
        if (v === 'confirmed') { out.cleared++; e.log('_build', { op: 'clear', cell: c.at, block: c.name, kind: c.kind, ...(c.kind === 'tree' ? { saplings: `${(record.replant ?? []).filter(r => r.state !== 'skipped' && SAPLING.test(nm(rd(...r.cell)))).length}/${(record.replant ?? []).filter(r => r.state !== 'skipped').length}` } : {}) }) }
      }
      return null
    } finally { PJ.releaseLease(dir, key, 'seg-clear', me, seg.gen) }
  }
  { const s = await clears(); if (s) { out.stop = s; return out } }

  // ---- 3. segments ------------------------------------------------------------------------------------------------------------
  // F4 (Paper 10-26 SHOP-TERRAIN hive-c: `no_step earth: 1 open` every visit): a cell no stand reaches is DEFERRED -- the visit
  // goes on with every segment that does not wait on its segment; later visits ask again (the walk grows with every stand the
  // town's bots occupy), and a cell deferred STUCK_VISITS visits ends the visit `stuck_on_cell` (a named row; the order backs off)
  const deferredSegs = new Set(), deferredCells = []
  // THE STUCK MAP, settled on EVERY exit (Codex r21 P2 / Claude P3-1: written only at the loop's end, a visit that deferred a cell
  // and then stopped early -- blocked, no_material, deps_open, a fence, the deadline -- never counted). Counts are per holder
  // file (buildproj stuckRead/stuckWrite: no lost update between two builders), summed for the threshold. An early exit keeps its
  // own stop (it names its own remedy) but logs the named row when the threshold is reached; at the loop's end the visit stops
  // cell_deferred or stuck_on_cell. A map that cannot be written FAILS CLOSED: a `stuck_unwritten` row and stuck_on_cell (Codex
  // r21 P2: an unwritable map counted 1 forever and said cell_deferred every visit).
  const doneAt = k => { const c = record.cells.find(x => kOf(x.at) === k); return !!c && cellDone(rd(...c.at), palette, c.role) }
  let settled = false, reachedEnd = false
  const settleStuck = atEnd => {
    settled = true
    const t = now()
    const since = t - STUCK_FORGET_MS + 1
    const own0 = PJ.stuckRead(dir, key, { holder: me })
    if (!deferredCells.length && !Object.keys(own0).length) return null
    const own = PJ.stuckRead(dir, key, { holder: me, since })
    const st = stuckAfter(own, deferredCells, { done: doneAt, now: t, by: me })
    const others = PJ.stuckRead(dir, key, { exclude: me, since })   // each holder aged out before the sum
    const total = k => (st.cells[k]?.visits ?? 0) + (doneAt(k) ? 0 : (others[k]?.visits ?? 0))
    const mine = [...new Set(deferredCells)].filter(k => !doneAt(k))
    const worst = mine.filter(k => total(k) >= STUCK_VISITS)
    const prevAt = PJ.stuckAt(dir, key, { holder: me })
    // STALLED (Claude r22 P2-2): every open segment is deferred or waits on one -- an EARTH cell (pad waits on earth, everything on
    // pad) stops the whole project; named on the row so the read reports the project stalled, never "no effect". A segment
    // another builder holds is neither deferred nor complete, so it is never stalled.
    const stalled = atEnd && segmentsOf(record).every(s => deferredSegs.has(s.seg) || segComplete(rd, record, palette, s.seg))
    // THE PROJECT BACK-OFF IS STAMPED ONLY AT THE LOOP'S END (Claude r22 P2-1: an early no_material after the threshold stamped
    // it, and the town waited 6 h for a workshop its mats job could finish in minutes) AND ONLY WHEN NOTHING ELSE IS OPEN (Claude
    // r23 P3: another builder still working an independent segment must not be held off); this bot's own stop still backs IT off
    const ok = PJ.stuckWrite(dir, key, me, st.cells, { now: t, stuckAt: worst.length && stalled ? t : (Object.keys(st.cells).length ? prevAt : null) })
    if (!deferredCells.length) return null
    if (!ok) {
      e.log('_build', { op: 'stuck_unwritten', cell: mine[0]?.split(',').map(Number) ?? null, n: mine.length })
      return { stop: 'stuck_on_cell', unwritten: true, why: `the stuck map cannot be written (${mine.length} cell(s) no stand reaches): backing off` }
    }
    // what it costs: the open record cells in the deferred segments (the stuck cells and every cell waiting on them)
    const waiting = record.cells.filter(c => deferredSegs.has(c.seg) && !cellDone(rd(...c.at), palette, c.role)).length
    if (worst.length) {
      e.log('_build', { op: 'stuck_on_cell', cell: worst[0].split(',').map(Number), visits: total(worst[0]), n: worst.length, segs: [...deferredSegs].join('+'), waiting, ...(stalled ? { stalled: true } : {}), ...(atEnd ? {} : { early: true }) })
      return { stop: 'stuck_on_cell', why: `${worst.length} cell(s) no stand has reached in ${STUCK_VISITS}+ visits (first ${worst[0]}; ${waiting} open cell(s) wait on it)${stalled ? '; nothing else is open: the project is STALLED' : ''}` }
    }
    return { stop: 'cell_deferred', why: `${new Set(deferredCells).size} cell(s) no stand reaches now (segments ${[...deferredSegs].join(',')})${stalled ? `, every open segment waits on it (${waiting} cells)` : ''}: asked again next visit` }
  }
  try {
  for (const { seg, deps } of segmentsOf(record)) {
    if (segComplete(rd, record, palette, seg)) continue
    if (deps.some(d => deferredSegs.has(d))) { deferredSegs.add(seg); continue }   // waits on a deferred cell's segment
    if (!deps.every(d => segComplete(rd, record, palette, d))) { out.stop = 'deps_open'; out.why = `${seg} waits for ${deps.filter(d => !segComplete(rd, record, palette, d)).join(',')}`; return out }
    const lease = PJ.takeLease(dir, key, `seg-${seg}`, me, { now: now() })
    if (!lease.ok) continue                                          // another builder holds it: the next segment
    let segGen = lease.gen, segAt = now()
    const row = { seg, open: 0, done: 0 }
    let finished = false
    try {
      for (;;) {
        const g = guard(); if (g) { out.stop = g; return out }
        const mine = record.cells.filter(c => c.seg === seg)
        const open = mine.filter(c => !cellDone(rd(...c.at), palette, c.role))
        row.open = open.length; row.done = mine.length - open.length
        if (!open.length) { finished = true; break }
        if (now() - segAt >= PJ.LEASE_TTL_MS * RENEW_AT) { const ng = PJ.renewLease(dir, key, `seg-${seg}`, me, segGen, { now: now() }); if (!ng) { out.stop = 'fence:segment'; return out } segGen = ng; segAt = now() }
        if (!renewSlot()) { out.stop = 'fence:slot'; return out }
        // AN UNKNOWN RECORD CELL (a dig of a foreign block the server never answered, this visit or an earlier one): asked again
        // from a stand in reach before anything else here (Codex r2 P2: only record.clear cells were ever asked, so a pad cell
        // left unknown blocked its segment for the connection's life); unanswered twice, it waits for the next visit
        const unk = open.filter(c => unknown.has(kOf(c.at)) && (tries.get(kOf(c.at)) ?? 0) < BUILD_ATTEMPTS)
        if (unk.length) { const c = unk[0]; if ((await resolveUnknown(c.at)) == null) bump(c.at); continue }
        // A FOREIGN SCAFFOLD-CLASS BLOCK in an open cell (placed after siting): dug first, lowest first, under this segment's lease
        // A TREE (fell-01) the same way, its trunk above felled after it (trunkAbove)
        // A tree the RECORD lists for clearing is never taken here: clears() fells it, after its sapling (B4, replant first)
        // -- only while the cell still holds THAT block (Codex r1 P2: a listed grass cell now holding a spruce log is ours to dig)
        const listed = new Map((record.clear ?? []).map(c => [kOf(c.at), c.name]))
        const listedNow = at => listed.has(kOf(at)) && listed.get(kOf(at)) === nm(rd(...at))
        const foreign = open.filter(c => { const k = foreignKind(nm(rd(...c.at))); return k && !(k === 'tree' && listedNow(c.at)) && (tries.get(kOf(c.at)) ?? 0) < BUILD_ATTEMPTS }).sort((a, b) => a.at[1] - b.at[1])
        if (foreign.length) {
          const f = foreign[0], name = nm(rd(...f.at)), kind = foreignKind(name)
          const sg = segGen
          const held = () => PJ.holdsLease(dir, key, `seg-${seg}`, me, sg, now())
          const v = await digNamed(f.at, name, held)
          if (v === 'fence') { out.stop = 'fence:segment'; return out }
          if (v === 'aborted') { out.stop = 'aborted'; return out }
          if (v !== 'confirmed') { bump(f.at); continue }
          out.cleared++; e.log('_build', { op: 'clear', seg, cell: f.at, block: name, kind: kind === 'tree' ? 'tree' : 'foreign' })
          if (kind === 'tree' && /_log$/.test(name)) {
            // THE TRUNK ABOVE, lowest first, each log under the same lease; one it cannot reach or dig ends the felling (bounded:
            // TRUNK_MAX logs). A log left in a record cell is dug when its own segment opens; one outside the record stays, named
            // KEPT: a listed tree (clears() owns it), a record cell that reads DONE, and a record cell of ANOTHER segment (Claude r1
            // P3-1: only this segment's lease is held; that segment's own foreign pass digs it)
            const cellAt = new Map(record.cells.map(c => [kOf(c.at), c]))
            const keep = at => { const c = cellAt.get(kOf(at)); return listedNow(at) || (!!c && (c.seg !== seg || cellDone(rd(...at), palette, c.role))) }
            let felled = 0, left = null
            for (const { at: tc, name: tn } of trunkAbove(rd, f.at, { keep }).map(at => ({ at, name: nm(rd(...at)) }))) {
              const g = guard(); if (g) { out.stop = g; return out }
              // RE-CHECKED before each dig (Codex r1 P2): still the log seen at the snapshot and still not kept, else the felling
              // ends; digNamed checks the name again at the dig itself
              if (nm(rd(...tc)) !== tn || keep(tc)) { left = `${tc.join(',')}:changed`; break }
              const tv = await digNamed(tc, tn, held)
              if (tv === 'fence') { out.stop = 'fence:segment'; return out }
              if (tv === 'aborted') { out.stop = 'aborted'; return out }
              if (tv !== 'confirmed') { left = `${tc.join(',')}:${tv}`; break }
              felled++; out.cleared++
            }
            e.log('_build', { op: 'fell', seg, cell: f.at, block: name, n: felled, ...(left ? { why: left } : {}) })
          }
          continue
        }
        const blocking = new Set(open.filter(c => c.role !== 'light').map(c => kOf(c.at)))
        const nodes = nodesFor(blocking)
        const feet = e.feet()
        // BOTTOM-UP: never a cell while one below it in its column is open; never a cell still holding an uncleared block
        const below = c => open.some(o => o !== c && o.at[0] === c.at[0] && o.at[2] === c.at[2] && o.at[1] < c.at[1])
        const cand = open.filter(c => (tries.get(kOf(c.at)) ?? 0) < BUILD_ATTEMPTS && !below(c) && isClear(c.at))
          .sort((a, b) => a.at[1] - b.at[1] || Math.hypot(a.at[0] - feet[0], a.at[2] - feet[2]) - Math.hypot(b.at[0] - feet[0], b.at[2] - feet[2]))
        let picked = null, step = null
        for (const c of cand) { step = stepFor(rd, home, c.at, nodes); if (step) { picked = c; break } }
        if (!picked) {
          if (cand.length && !open.some(c => !isClear(c.at))) {
            // no stand reaches any placeable cell of this segment: DEFER them and go on (F4)
            for (const c of cand) deferredCells.push(kOf(c.at))
            deferredSegs.add(seg)
            e.log('_build', { op: 'deferred', seg, cell: cand[0].at, n: cand.length })
            break
          }
          out.stop = open.some(c => !isClear(c.at)) ? (needSapling ? 'no_sapling' : 'blocked') : 'attempts_spent'
          out.why = `${seg}: ${open.length} open, ${cand.length} placeable now`
          return out
        }
        const block = blockFor(palette, picked.role, e.has)
        if (!block) { out.stop = 'no_material'; out.why = `${picked.role} for ${seg}`; return out }
        const v = await click(picked.at, block, step, seg, segGen, { closer: CLOSER_SEGS.has(seg), want: b => cellDone(b, palette, picked.role) })
        if (v === 'placed') { out.placed++; tally(block); e.log('_build', { op: 'place', seg, cell: picked.at, block }); continue }
        if (v.startsWith('fence:') || v === 'aborted' || v === 'no_material') { out.stop = v; return out }
        if (v === 'busy') { await e.sleep(100); continue }            // a free skip: the mutex or the barrier is another's
        bump(picked.at)                                               // body, stand, barrier_wait, refused, silent: an attempt
        if (v === 'refused') out.refused++
        if (v === 'silent') out.silent++
      }
    } finally { PJ.releaseLease(dir, key, `seg-${seg}`, me, segGen); out.segs.push(row); e.log('_build_seg', { seg, open: row.open, done: row.done }) }
    if (finished) { const s = await clears(); if (s) { out.stop = s; return out } }
  }
    reachedEnd = true
  } finally {
    // an early exit (any `return out` above): count this visit's deferrals; the early stop stands, except a map that cannot be
    // written, which fails closed. Never throws (a finally must not replace the visit's own result).
    if (!settled && !reachedEnd) { try { const r = settleStuck(false); if (r?.unwritten) { out.stop = r.stop; out.why = r.why } else if (r?.stop === 'stuck_on_cell') out.stuck = true } catch { /* the next visit counts */ } }
  }
  // the loop's end: this visit's deferrals counted, built cells dropped (F4)
  { let r = null; try { r = settleStuck(true) } catch { /* the next visit counts (Claude r22 P3) */ } if (r) { out.stop = r.stop; out.why = r.why; return out } }
  out.stop = record.cells.every(c => cellDone(rd(...c.at), palette, c.role)) ? 'complete' : needSapling ? 'no_sapling' : 'unknown'
  if (out.stop === 'no_sapling') out.why = `${needSapling}: withdraw saplings from town (C1)`
  return out
}

/** Does an entity box touch a cell? */
export function inCell (b, [x, y, z]) {
  const w = (b.w ?? 0.6) / 2, h = b.h ?? 1.8
  return b.x + w > x && b.x - w < x + 1 && b.z + w > z && b.z - w < z + 1 && b.y + h > y && b.y < y + 1
}
export { overlay }
