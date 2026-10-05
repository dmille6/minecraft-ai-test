// THE BLUEPRINT BUILDER'S PURE CORE: a town structure is a FROZEN list of absolute cells, built cell by cell from what
// the server says is there, by one leaseholder at a time, with every other bot's paths kept off it.
//
// Design: docs/reports/blueprint-builder-design-2026-10-05.md (Claude + an independent Codex design, synthesized; prior
// art: Baritone's builder, mineflayer-builder, Mindcraft construction tasks, Voyager placeItem -- ideas borrowed, no
// code: none of them verifies a placement against the server, and the fleet's structures must).
//
// THE SHAPE, borrowed from Baritone (BuilderProcess): progress is the RE-OBSERVED WORLD, never a saved index. A visit
// reads every cell, keeps the ones that are not yet what the blueprint wants, and places whatever is placeable now
// (support present, nobody standing in it, reachable). So an interrupted visit, a disconnect, a restart or a second
// bot all resume from the same truth, and the record cannot disagree with the structure.
//
// WHAT IS SHARED (house pattern, composter.mjs resolveTownSite): one record per town, a GENERATION file created with
// link() so exactly one writer wins each generation. Unlike the composter's, the record carries the RESOLVED cells (the
// blueprint fitted to the terrain once, at acceptance), so every bot and the canary read agree on what "the structure"
// is, and a later change in the terrain cannot move it.
//
// ONE BUILDER AT A TIME: a lease, also generation files (take = create N+1 when N is free or expired). The lease is
// for EFFICIENCY, not safety, for every blueprint whose mutations are idempotent placements into their own designated
// cells (the tree farm's): two overlapping builders place into the same empty cell at most once between them -- the
// server refuses the second -- and nothing else changes. A blueprint that DIGS (the safe mineshaft) needs the lease
// to be a real mutex (fenced before every dig); that blueprint is designed, not built (see the design doc).

import fs from 'node:fs'
import path from 'node:path'

// ---- cells ---------------------------------------------------------------------------------------------------------

export const cellKey = (x, y, z) => `${x},${y},${z}`
export const keyOf = c => cellKey(c.x, c.y, c.z)
const int = v => Number.isInteger(v)
export const validCell = c => !!c && int(c.x) && int(c.y) && int(c.z)

/** Rotate a relative offset a quarter turn `rot` times about the anchor (0..3, +x toward +z). Pure. */
export function rotateOffset ({ dx = 0, dy = 0, dz = 0 } = {}, rot = 0) {
  const r = ((rot % 4) + 4) % 4
  if (r === 0) return { dx, dy, dz }
  if (r === 1) return { dx: -dz, dy, dz: dx }
  if (r === 2) return { dx: -dx, dy, dz: -dz }
  return { dx: dz, dy, dz: -dx }
}

/** Relative entries -> absolute cells at `anchor` (rotated). Every other field of an entry is kept. Pure. */
export function placeAt (entries = [], anchor, rot = 0) {
  return (Array.isArray(entries) ? entries : []).map(e => {
    const o = rotateOffset(e, rot)
    const { dx, dy, dz, ...rest } = e
    return { ...rest, x: anchor.x + o.dx, y: anchor.y + o.dy, z: anchor.z + o.dz }
  })
}

// ---- what a cell is now --------------------------------------------------------------------------------------------

const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/
/** Cells a block may be placed INTO (vanilla replaceable ground cover; never liquid: a structure is not built wet). */
export const REPLACEABLE = new Set(['air', 'cave_air', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush'])
export const isLiquid = b => !!b && LIQUID.test(b.name ?? '')
export const solid = b => !!b && b.boundingBox === 'block'
export const passable = b => !!b && b.boundingBox === 'empty' && !isLiquid(b)

/**
 * WHAT IS A CELL NOW, against what the blueprint wants -> 'done' | 'open' | 'blocked' | 'unknown'. Pure.
 *   want   a block name, or a predicate (name -> boolean) for a cell that accepts several (any of the farm's saplings)
 * unknown = not loaded (never a guess); open = replaceable now; blocked = something else is there.
 */
export function cellStatus (read, cell, want) {
  const b = read(cell.x, cell.y, cell.z)
  if (!b) return 'unknown'
  const ok = typeof want === 'function' ? want(b.name) : b.name === want
  if (ok) return 'done'
  if (REPLACEABLE.has(b.name)) return 'open'
  return 'blocked'
}

const FACES = [[0, -1, 0, 'up'], [1, 0, 0, 'west'], [-1, 0, 0, 'east'], [0, 0, 1, 'north'], [0, 0, -1, 'south'], [0, 1, 0, 'down']]
/**
 * THE BLOCK TO CLICK TO PUT SOMETHING INTO `cell` -> { ref: {x,y,z}, face: {x,y,z} } | null. Pure. A full solid
 * neighbour that is not a container/station (clicking those opens them) -- the one BELOW first (a top face: what
 * saplings, torches and most blocks want), then the sides, then above. `face` is the vector from ref to cell
 * (mineflayer placeBlock's faceVector). `needsBelow` (saplings, torches on the ground): only the block below counts.
 */
const INTERACTIVE = /(chest|barrel|furnace|smoker|crafting_table|composter|_door$|_trapdoor$|_gate$|_bed$|shulker_box$|^lever$|_button$|hopper|dropper|dispenser|anvil|enchanting_table|brewing_stand|loom|stonecutter|grindstone|smithing_table|cartography_table|fletching_table|lectern|bell|note_block|jukebox)/
export function refFaceFor (read, cell, { needsBelow = false } = {}) {
  for (const [dx, dy, dz] of FACES) {
    if (needsBelow && dy !== -1) continue
    const r = { x: cell.x + dx, y: cell.y + dy, z: cell.z + dz }
    const b = read(r.x, r.y, r.z)
    if (!solid(b) || INTERACTIVE.test(b.name ?? '')) continue
    return { ref: r, face: { x: -dx, y: -dy, z: -dz } }
  }
  return null
}

/** Does a body ({ x, y, z, w, h }: feet centre, width, height) overlap block cell c? Pure (composter.mjs bodyInCell's rule). */
export function bodyInCell (b, c) {
  const hw = (Number(b?.w) || 0.6) / 2, h = Number(b?.h) || 1.8
  return b?.x + hw > c.x && b.x - hw < c.x + 1 && b.z + hw > c.z && b.z - hw < c.z + 1 && b.y + h > c.y && b.y < c.y + 1
}

/**
 * WOULD PUTTING A SOLID BLOCK IN `cell` SEAL A BODY IN? -> true | false. Pure. A body standing at `feet` (block cell)
 * keeps a way out if, after the placement, some cardinal neighbour has its feet and head cells passable. Non-solid
 * placements (saplings, torches) never seal anything and are not asked.
 */
export function wouldEnclose (read, feet, cell) {
  const filled = (x, y, z) => (x === cell.x && y === cell.y && z === cell.z) ? { name: 'placed', boundingBox: 'block' } : read(x, y, z)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const f = filled(feet.x + dx, feet.y, feet.z + dz), h = filled(feet.x + dx, feet.y + 1, feet.z + dz)
    if (passable(f) && passable(h)) return false
  }
  const up = filled(feet.x, feet.y + 2, feet.z)
  return !passable(up)
}

/** Eye height of a standing player, and the reach the builder uses (block centre; vanilla 4.5 to the face + Paper's buffer). */
export const EYE = 1.62
export const REACH = 4.5
/** A dig's reach, to the block centre: Paper accepts a dig within interaction range 4.5 + 1.0 of the block's NEAREST point
 *  (ServerPlayer.canInteractWithBlock(pos, 1.0)); 5.0 to the centre stays inside that with half a block to spare. A log
 *  six above the plot cell is in reach from the cell itself (4.88), seven is not. */
export const DIG_REACH = 5.0
export const reachOf = (feet, c) => Math.hypot(c.x + 0.5 - (feet.x + 0.5), c.y + 0.5 - (feet.y + EYE), c.z + 0.5 - (feet.z + 0.5))

/**
 * WHERE TO STAND TO WORK ON `target` -> [{ x, y, z }] best first. Pure. A feet cell within `radius` horizontally and
 * one level either way of the target's ground, whose feet and head cells are passable over a solid floor; never the
 * target itself (unless `allowTarget`: digging a column from inside it), never a `forbidden` cell (the blueprint's own
 * plot cells and stands kept free), never a cell a body other than this bot's own occupies; within REACH of the
 * target's centre -- or of `reachTo` (a log high in the column of the plot the stand is chosen around). Sorted by
 * distance from `from` (the bot), then from the target, then x, z: deterministic.
 */
export function standsFor (read, target, { from = null, radius = 3, forbidden = null, bodies = [], allowTarget = false, reach = REACH, levels = [0, -1, 1], reachTo = null } = {}) {
  const goal = reachTo ?? target
  const out = []
  for (const dy of levels) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const c = { x: target.x + dx, y: target.y + dy, z: target.z + dz }
        const isTarget = !dx && !dz && !dy
        if (isTarget && !allowTarget) continue
        if (!isTarget && !dx && !dz && dy > 0) continue   // never stand on top of the target column
        if (forbidden && forbidden(c) && !(isTarget && allowTarget)) continue
        if (reachOf(c, goal) > reach) continue
        const feet = read(c.x, c.y, c.z), head = read(c.x, c.y + 1, c.z), floor = read(c.x, c.y - 1, c.z)
        if (!passable(feet) || !passable(head) || !solid(floor)) continue
        if ((bodies ?? []).some(b => bodyInCell(b, c) || bodyInCell(b, { x: c.x, y: c.y + 1, z: c.z }))) continue
        out.push(c)
      }
    }
  }
  const d = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0)
  out.sort((a, b) => d(a, from) - d(b, from) || d(a, target) - d(b, target) || a.x - b.x || a.z - b.z || a.y - b.y)
  return out
}

// ---- the shared record ----------------------------------------------------------------------------------------------

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const GEN = (key, kind) => new RegExp(`^${esc(key)}\\.${kind}(\\d+)\\.json$`)
const genFile = (dir, key, kind, n) => path.join(dir, `${key}.${kind}${n}.json`)
/** Two world ids are the same world unless both are known and differ (composter.mjs sameWorld). */
export const sameWorld = (a, b) => !a || !b || String(a) === String(b)

function highest (dir, key, kind) {
  let gen = 0
  try {
    const re = GEN(key, kind)
    for (const f of fs.readdirSync(dir)) { const m = re.exec(f); if (m) gen = Math.max(gen, Number(m[1])) }
  } catch { return -1 }
  return gen
}

function readGen (dir, key, kind, gen) {
  try { return JSON.parse(fs.readFileSync(genFile(dir, key, kind, gen), 'utf8')) } catch { return null }
}

/**
 * Create generation `gen` of `kind` atomically -> true when THIS call created it. `prune` keeps only the newest KEEP_GENS
 * of that kind -- which lets a slow writer RE-CREATE a pruned number (Codex review), so it is used only for the lease,
 * whose taker verifies after creating that its generation is the current one; a record generation is never pruned.
 */
const KEEP_GENS = 3
function createGen (dir, key, kind, gen, body, { prune = false } = {}) {
  const file = genFile(dir, key, kind, gen)
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(body))
    fs.linkSync(tmp, file)
    if (prune) try {
      const re = GEN(key, kind)
      for (const f of fs.readdirSync(dir)) { const m = re.exec(f); if (m && Number(m[1]) <= gen - KEEP_GENS) { try { fs.unlinkSync(path.join(dir, f)) } catch { /* pruned by another */ } } }
    } catch { /* best effort */ }
    return true
  } catch {
    return false
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* never written */ }
  }
}

/** A record is usable when it names a blueprint and carries a non-empty list of valid cells. */
export const validRecord = r => !!r && typeof r.blueprint === 'string' && Array.isArray(r.cells) && r.cells.length > 0 && r.cells.every(validCell) && validCell(r.anchor)

/** The current record -> { gen, record, malformed }. gen 0 = none, -1 = the directory cannot be read. */
export function readRecord (dir, key) {
  const gen = highest(dir, key, 'g')
  if (gen <= 0) return { gen: Math.max(0, gen), record: null, malformed: false, unreadable: gen < 0 }
  const r = readGen(dir, key, 'g', gen)
  if (!validRecord(r)) return { gen, record: null, malformed: true }
  return { gen, record: r, malformed: false }
}

/** Create generation `gen` of the record -> true when this call created it (compare-and-swap without a lock). */
export function createRecordGen (dir, key, gen, record) {
  if (!validRecord(record)) return false
  return createGen(dir, key, 'g', gen, { ...record, at: record.at ?? new Date().toISOString() })
}

/**
 * THE TOWN'S STRUCTURE -> { record, gen, why, defer, replaced, created }. The composter's rule, generalized: the current record
 * if this bot's view accepts it; a NEW generation from this bot's own `compute` when its view refuses it; the winner's
 * record when another bot created that generation first (validated in this view: refused or unknown waits). `refuse`
 * returning 'unknown' (an unloaded cell) is a deferral, never a reason to replace. Fails closed.
 *   compute () -> { record, why }      refuse (record) -> reason | 'unknown' | null
 */
export function resolveRecord ({ dir, key, world = null, compute, refuse }) {
  const cur = readRecord(dir, key)
  if (cur.unreadable) return { record: null, gen: 0, why: 'the shared record directory cannot be read', defer: true, replaced: null }
  if (cur.record && sameWorld(cur.record.world, world)) {
    const why = refuse(cur.record)
    if (!why) return { record: cur.record, gen: cur.gen, why: null, defer: false, replaced: null }
    if (why === 'unknown') return { record: null, gen: cur.gen, why: 'a cell of the recorded structure is not loaded here', defer: true, replaced: null }
  }
  const next = compute()
  if (!next?.record) return { record: null, gen: cur.gen, why: next?.why ?? 'no site', defer: true, replaced: null }
  const rec = { ...next.record, world: world || null }
  // A MATCHED PAIR (Codex review): the record this call wrote and the generation it wrote it as -- never a later read,
  // which could be another writer's generation. A later generation is caught by the caller's fence.
  if (createRecordGen(dir, key, cur.gen + 1, rec)) return { record: rec, gen: cur.gen + 1, why: null, defer: false, replaced: cur.record, created: true }
  const won = readRecord(dir, key)
  if (won.gen > cur.gen && won.record && sameWorld(won.record.world, world)) {
    const why = refuse(won.record)
    if (!why) return { record: won.record, gen: won.gen, why: null, defer: false, replaced: cur.record }
    return { record: null, gen: won.gen, why: `the structure another bot just recorded is ${why === 'unknown' ? 'not loaded here' : `refused here (${why})`}`, defer: true, replaced: null }
  }
  return { record: null, gen: cur.gen, why: 'the shared record could not be written or read', defer: true, replaced: null }
}

// ---- the lease (one builder at a time) -------------------------------------------------------------------------------

/** A lease lasts this long unless renewed; a holder renews before every mutation. */
export const LEASE_MS = 90_000

/** The current lease -> { gen, lease } (lease null = none ever, or unreadable). Pure but for the read. */
export function readLease (dir, key) {
  const gen = highest(dir, key, 'lease')
  if (gen <= 0) return { gen: Math.max(0, gen), lease: null }
  return { gen, lease: readGen(dir, key, 'lease', gen) }
}

/**
 * MAY `me` TAKE (OR KEEP) THE LEASE NOW? -> { ok, holder, until }. Pure. Free when there is none, it is mine, it was
 * released, or it expired (until <= now). An unreadable lease file is treated as held until LEASE_MS after its gen was
 * seen -- the caller passes `seenAt` -- so a torn write never lets two builders in.
 */
export function leaseDecision ({ lease = null, me = '', now = 0 } = {}) {
  if (!lease) return { ok: true, holder: null, until: 0 }
  if (lease.holder === me) return { ok: true, holder: me, until: lease.until ?? 0 }
  if (lease.released || !(Number(lease.until) > now)) return { ok: true, holder: lease.holder ?? null, until: lease.until ?? 0 }
  return { ok: false, holder: lease.holder ?? '?', until: lease.until }
}

/**
 * TAKE OR RENEW THE LEASE -> { ok, gen, holder, until }. Creates generation N+1 (link: one winner) when the current one
 * is free for `me`. Renewal is also a new generation, so the generation number is a FENCING TOKEN: a holder that finds
 * the current generation is no longer its own has lost the lease and must stop before its next mutation.
 */
export function takeLease (dir, key, me, now = Date.now(), ms = LEASE_MS) {
  const cur = readLease(dir, key)
  const d = leaseDecision({ lease: cur.lease, me, now })
  if (!d.ok) return { ok: false, gen: cur.gen, holder: d.holder, until: d.until }
  if (cur.gen > 0 && !cur.lease) return { ok: false, gen: cur.gen, holder: '?', until: now + ms }   // torn/unreadable: wait
  const until = now + ms
  if (createGen(dir, key, 'lease', cur.gen + 1, { holder: me, until, at: new Date(now).toISOString() }, { prune: true })) {
    // VERIFIED: the generation created must be the current one (a pruned number re-created by a slow writer is not).
    if (holdsLease(dir, key, me, cur.gen + 1)) return { ok: true, gen: cur.gen + 1, holder: me, until }
  }
  const won = readLease(dir, key)
  return { ok: false, gen: won.gen, holder: won.lease?.holder ?? '?', until: won.lease?.until ?? until }
}

/** Is `gen` still the current lease and mine? -> boolean (the fence before a mutation). */
export function holdsLease (dir, key, me, gen) {
  const cur = readLease(dir, key)
  return cur.gen === gen && cur.lease?.holder === me && !cur.lease?.released
}

/** Release a lease this bot holds at `gen` (a new generation marked released). Best effort -> boolean. */
export function releaseLease (dir, key, me, gen, now = Date.now()) {
  if (!holdsLease(dir, key, me, gen)) return false
  return createGen(dir, key, 'lease', gen + 1, { holder: me, until: now, released: true, at: new Date(now).toISOString() }, { prune: true })
}

// ---- server witness (pure part) -------------------------------------------------------------------------------------

/**
 * Decode a multi_block_change record the way mineflayer 4.37 does (blocks.js, usesMultiblockSingleLong): state << 12 |
 * x << 8 | z << 4 | y, relative to the section at chunkCoordinates. -> { x, y, z, stateId }. Pure.
 */
export function decodeMultiRecord (chunk, record) {
  const r = typeof record === 'bigint' ? record : BigInt(Math.trunc(Number(record)))
  const y = Number(r & 0xfn), z = Number((r >> 4n) & 0xfn), x = Number((r >> 8n) & 0xfn)
  return { x: chunk.x * 16 + x, y: chunk.y * 16 + y, z: chunk.z * 16 + z, stateId: Number(r >> 12n) }
}

/**
 * DID THE SERVER CONFIRM IT? -> 'confirmed' | 'refused' | 'silent'. Pure.
 *   seen   the names the SERVER sent for the cell after the attempt, in order (block_change / multi_block_change)
 *   want   name or predicate
 * The last word wins: a later correction (the server put the old block back) is a refusal even after a confirmation.
 * Nothing sent is 'silent' -- never a success, whatever the client's own world model says.
 */
export function witnessVerdict (seen = [], want) {
  if (!Array.isArray(seen) || !seen.length) return 'silent'
  const last = seen[seen.length - 1]
  const ok = typeof want === 'function' ? want(last) : last === want
  return ok ? 'confirmed' : 'refused'
}

// ---- materials ------------------------------------------------------------------------------------------------------

/**
 * WHAT THE REMAINING WORK NEEDS AGAINST WHAT IS HELD -> { need: {item: n}, have: {item: n}, short: {item: n} }. Pure.
 *   todo   [{ item }] or [{ items: [alternatives] }] (any one of them, e.g. any allowed sapling)
 *   held   name -> count in the bag
 * Alternatives draw from the most-held first, so one species does not starve while another sits unused.
 */
export function materialPlan (todo = [], held = {}) {
  const left = { ...held }, need = {}, have = {}, short = {}
  for (const t of (Array.isArray(todo) ? todo : [])) {
    const alts = Array.isArray(t?.items) ? t.items : (t?.item ? [t.item] : [])
    if (!alts.length) continue
    const pick = [...alts].sort((a, b) => (left[b] ?? 0) - (left[a] ?? 0) || (a < b ? -1 : 1))[0]
    const label = alts.length > 1 ? alts.join('|') : alts[0]
    need[label] = (need[label] ?? 0) + 1
    if ((left[pick] ?? 0) > 0) { left[pick]--; have[pick] = (have[pick] ?? 0) + 1 } else short[label] = (short[label] ?? 0) + 1
  }
  return { need, have, short }
}

// ---- server witness (the listener) ----------------------------------------------------------------------------------

/**
 * LISTEN TO WHAT THE SERVER SAYS ABOUT WATCHED CELLS. The raw block_change / multi_block_change packets, read beside
 * mineflayer's own handlers (blocks.js), so a verdict never rests on the client's world model: mineflayer writes air
 * for its own digs before the server answers (digging.js:158 -- ghost-blocks-are-rejected-digs), and a placement is
 * only ever confirmed by a server packet naming the wanted block at that cell.
 *   watch(cell)                 start recording (clears what was seen)
 *   until(cell, want, ms)       -> 'confirmed' | 'refused' | 'silent'  (a confirmation is re-read after `settleMs`:
 *                                  a correction right behind it wins)
 *   stop()                      remove the listeners
 */
export function installBlockWitness (bot, { settleMs = 150 } = {}) {
  const watched = new Map()
  const nameOf = id => bot?.registry?.blocksByStateId?.[id]?.name ?? null
  const note = (x, y, z, id) => {
    const w = watched.get(cellKey(x, y, z))
    if (!w) return
    w.seen.push(nameOf(id))
    for (const f of w.waiters.splice(0)) f()
  }
  const onOne = p => { try { note(p.location.x, p.location.y, p.location.z, p.type) } catch { /* malformed: ignored */ } }
  const onMulti = p => {
    try { for (const r of p.records ?? []) { const d = decodeMultiRecord(p.chunkCoordinates, r); note(d.x, d.y, d.z, d.stateId) } } catch { /* malformed: ignored */ }
  }
  const client = bot?._client
  try { client?.on?.('block_change', onOne); client?.on?.('multi_block_change', onMulti) } catch { /* no client: every verdict is silent */ }
  const sleepMs = ms => new Promise(r => setTimeout(r, ms))
  return {
    watch (c) { watched.set(keyOf(c), { seen: [], waiters: [] }) },
    seen (c) { return [...(watched.get(keyOf(c))?.seen ?? [])] },
    async until (c, want, ms = 2000) {
      const w = watched.get(keyOf(c))
      if (!w) return 'silent'
      const end = Date.now() + ms
      while (witnessVerdict(w.seen, want) !== 'confirmed' && Date.now() < end) {
        await new Promise(resolve => { const t = setTimeout(resolve, Math.max(1, end - Date.now())); w.waiters.push(() => { clearTimeout(t); resolve() }) })
      }
      if (witnessVerdict(w.seen, want) === 'confirmed') await sleepMs(settleMs)
      return witnessVerdict(w.seen, want)
    },
    stop () {
      try { client?.removeListener?.('block_change', onOne); client?.removeListener?.('multi_block_change', onMulti) } catch { /* gone */ }
      for (const w of watched.values()) for (const f of w.waiters.splice(0)) f()
      watched.clear()
    },
  }
}
