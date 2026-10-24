// LAVASIGHT-01 (mineshaft-safety F5b; docs/reports/lavasight-01-design-2026-10-24.md r2). Lava that any bot has seen is
// remembered per world -- from the per-seed hazard map (OWNER 2026-10-24: fed from the map from day one) and this bot's own
// refusals -- and the pathfinder learns, BEFORE it plans, which moves the corridor guard would refuse.
//
// A PRICE ON A MOVE THE BASE ALREADY MADE, NEVER A WALL: the base move generator decides which moves exist; wrapNeighbors
// only raises the cost of those whose 0.5-block samples the guard would refuse for a remembered lava cell. The neighbour
// set is the base's by construction (no `cost > 100` deletion is reachable from here), so the move graph is identical, an
// uncapped search reaches exactly the goals the base reaches, and no goal becomes unreachable because of memory.
//
// THE FILE: `<poolStateDir(memory.pool)>/lava-map.json`, written by scripts/host/lavasight/lavamap_publish.py (mcbot,
// atomic rename) from ~/hazardmap/out/hazardmap.json. No file, a stale one, one for another world or pool, or a malformed
// one -> no map cells and the bot routes as the base (FAIL OPEN), with the state named in `_lavasight_mode`.
//   { "schema": "mcai.lavamap", "schema_version": 1, "world": "board-a", "seed": "1239381899",
//     "generated_at": ISO, "stale_after": ISO, "cells": [[x, y, z], ...] }
//
// EVERYTHING HERE IS PURE except lavaMapReader (fs) and hashedSeedOf (node:crypto, deterministic).
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { LAVA_LIKE } from './lavaguard.mjs'

export const LAVAMAP_FILE = 'lava-map.json'
export const LAVAMAP_SCHEMA = 'mcai.lavamap'
export const LAVAMAP_VERSION = 1
export const MAX_CELLS = 4096
/** The index's price for a footprint cell (a marker: the move surcharge is CORE_MOVE). */
export const CORE_PRICE = 16
export const OVER_DY = 3           // cellLavaSafe's "lava below" scan
export const DROP_DY = 12          // dropLavaSafe's reach
export const RING_MAX = 512        // the own-sighting ring
export const LIVE_R = 192          // memory cells farther than this (xz) from the bot are not re-read
export const INDEX_MAX = 250_000   // a bound on the index (measured: 1,862 board-a cells, no occlusion, 130k entries, ~11 MB)
export const RELOAD_MS = 60_000
export const LIVE_MS = 20_000

export const lavasightOn = (env = process.env) => String(env?.LAVASIGHT ?? '1') !== '0'
export const lavaMapFileIn = dir => path.join(dir, LAVAMAP_FILE)

/**
 * THE LOGIN PACKET'S hashedSeed FOR A SEED -> 'hi:lo' (signed int32s, as composter.mjs worldIdFromLogin renders it) | null.
 * Minecraft sends sha256(seed as a little-endian int64)[0..8] read as a little-endian int64; protodef splits an i64 into
 * [hi, lo]. Checked against live _plinth_mode rows on three worlds (design 2.3). The seed is a STRING: 64-bit seeds exceed a
 * JS number (the hazard map keeps them as strings for this). A number, or anything that is not a decimal int64, -> null.
 */
export function hashedSeedOf (seed) {
  if (typeof seed !== 'string' || !/^-?\d{1,20}$/.test(seed)) return null
  let v
  try { v = BigInt(seed) } catch { return null }
  if (v < -(2n ** 63n) || v > 2n ** 63n - 1n) return null
  const b = Buffer.alloc(8); b.writeBigInt64LE(v)
  const h = createHash('sha256').update(b).digest()
  return `${h.readInt32LE(4)}:${h.readInt32LE(0)}`
}

const isInt = v => Number.isInteger(v)
const cellOk = c => Array.isArray(c) && c.length >= 3 && isInt(c[0]) && isInt(c[1]) && isInt(c[2]) &&
  Math.abs(c[0]) < 2 ** 21 && Math.abs(c[2]) < 2 ** 21 && c[1] >= -64 && c[1] < 448

/**
 * THE FILE -> { state, cells, bad, meta }. Pure. `worldId` is this bot's login hashedSeed rendering ('' or null:
 * unknown). States: ok | absent | bad_schema | world_mismatch | world_unknown | stale. Only `ok` carries cells.
 * A reseeded world never inherits the old seed's lava: an unknown login seed refuses the file (world_unknown).
 */
export function parseLavaMap (raw, { worldId = null, now = Date.now(), pool = null } = {}) {
  const none = (state, extra = {}) => ({ state, cells: [], bad: [], meta: {}, ...extra })
  if (raw == null) return none('absent')
  if (typeof raw !== 'object' || Array.isArray(raw)) return none('bad_schema', { why: 'not_an_object' })
  if (raw.schema !== LAVAMAP_SCHEMA) return none('bad_schema', { why: `schema:${String(raw.schema).slice(0, 24)}` })
  if (raw.schema_version !== LAVAMAP_VERSION) return none('bad_schema', { why: `version:${raw.schema_version}` })
  const want = hashedSeedOf(raw.seed)
  if (!want) return none('bad_schema', { why: 'seed' })
  const meta = { world: typeof raw.world === 'string' ? raw.world.slice(0, 32) : null, seed: raw.seed,
                 generated_at: raw.generated_at ?? null, stale_after: raw.stale_after ?? null }
  if (worldId == null || worldId === '') return none('world_unknown', { meta })
  if (String(worldId) !== want) return none('world_mismatch', { meta })
  // THE LABEL TOO (Codex design r1 P2): ten worlds share one seed, so the seed alone cannot tell board-a's file from
  // board-d's -- and the publisher's per-world view differs between them (a lava hazard can be absent in one). One pool
  // directory is one world; the file must name this bot's pool.
  if (pool != null && pool !== '' && meta.world !== pool) return none('world_label', { meta })
  const staleMs = Date.parse(raw.stale_after)
  if (!Number.isFinite(staleMs)) return none('bad_schema', { why: 'stale_after', meta })
  if (now > staleMs) return none('stale', { meta })
  if (!Array.isArray(raw.cells)) return none('bad_schema', { why: 'cells', meta })
  const bad = []
  const seen = new Set(), cells = []
  for (const [i, c] of raw.cells.entries()) {
    if (cells.length >= MAX_CELLS) { bad.push(`over_${MAX_CELLS}`); break }
    if (!cellOk(c)) { if (bad.length < 8) bad.push(`cell${i}`); continue }
    const k = packKey(c[0], c[1], c[2])
    if (seen.has(k)) continue
    seen.add(k); cells.push({ x: c[0], y: c[1], z: c[2] })
  }
  return { state: 'ok', cells, bad, meta: { ...meta, stale_ms: staleMs } }
}

/** One number per cell for the A* hot path: no string, no allocation. |x|, |z| < 2^21, -64 <= y < 448. */
export function packKey (x, y, z) {
  return ((x + 2097152) * 4194304 + (z + 2097152)) * 512 + (y + 64)
}

/**
 * THE GUARD'S FOOTPRINT OF ONE LAVA CELL, as feet cells -> calls emit(x, y, z, price). Pure. `solidAt(x, y, z)` -> true |
 * false | null (unknown); unknown counts as open, which can only add price. Mirrors lavaguard.mjs exactly (the test
 * checks it against corridorSafe on synthetic worlds):
 *   BESIDE  F.y = L.y, |dx| <= 2, |dz| <= 2 except the (±2, ±2) corners: corridorSafe's 3x3 sample of cellLavaSafe's
 *           five-cell "lava beside".
 *   OVER    F within Chebyshev 1 of L's column, F.y = L.y+1..L.y+3, L's column open strictly between: cellLavaSafe's
 *           "lava below" under the 3x3.
 *   DROP    F in L's column or a cardinal of it, F.y = L.y+1..L.y+12, F's OWN column open from F.y-1 down to L.y+1:
 *           dropLavaSafe's straight-down and "lava beside the drop".
 */
export function footprintOf (L, solidAt, emit) {
  const { x, y, z } = L
  const open = (cx, cz, yTop, yBot) => { for (let yy = yTop; yy >= yBot; yy--) if (solidAt(cx, yy, cz) === true) return false; return true }
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue
      emit(x + dx, y, z + dz, CORE_PRICE)
    }
  }
  for (let k = 1; k <= OVER_DY; k++) {
    if (!open(x, z, y + k - 1, y + 1)) break
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) emit(x + dx, y + k, z + dz, CORE_PRICE)
  }
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let k = 1; k <= DROP_DY; k++) {
      if (!open(x + dx, z + dz, y + k - 1, y + 1)) break
      emit(x + dx, y + k, z + dz, CORE_PRICE)
    }
  }
}

/** THE INDEX over the ACTIVE lava cells -> Set(packKey) of footprint feet cells, at most INDEX_MAX (`full` says it hit). */
export function buildPriceIndex (active, solidAt = () => null, { max = INDEX_MAX } = {}) {
  const idx = new Set()
  const emit = (x, y, z) => {
    if (idx.size >= max) { idx.full = true; return }
    if (Math.abs(x) >= 2 ** 21 || Math.abs(z) >= 2 ** 21 || y < -64 || y >= 448) return
    idx.add(packKey(x, y, z))
  }
  for (const L of active) footprintOf(L, solidAt, emit)
  return idx
}

/** Is this feet cell in the footprint? Pure, allocation-free (the A* hot path). */
export function inFootprint (idx, x, y, z) {
  if (!idx || idx.size === 0) return false
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z)
  if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) return false
  if (Math.abs(fx) >= 2 ** 21 || Math.abs(fz) >= 2 ** 21 || fy < -64 || fy >= 448) return false
  return idx.has(packKey(fx, fy, fz))
}

/** A move's surcharge (r2: MOVE level, after the base generated it): a move the guard would refuse costs this much more. */
export const CORE_MOVE = 50

/** One segment's samples, as corridorSafe takes them (k = 1..n at 0.5 steps, floored), against the footprint. */
function segmentHits (idx, ax, ay, az, bx, by, bz) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 0.5))
  for (let k = 1; k <= n; k++) {
    const t = k / n
    if (inFootprint(idx, ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t)) return true
  }
  return false
}

/**
 * ONE MOVE'S LAVA SURCHARGE -> 0 | CORE_MOVE. Pure, allocation-free. The guard samples the path it is handed, and a path's
 * nodes reach it in two forms: block centres (postProcessPath puts walk nodes on top of their block, +0.5) and bare
 * integer cells (every node after the first dig or place, and the bot's own floored start; index.mjs path_update). A
 * mixed-sign diagonal samples a side cell in the integer form only (Claude design r1 P1-1). So the move is judged in BOTH
 * forms, and priced if either would put a sample on the footprint.
 */
export function moveSurcharge (idx, node, m) {
  if (!idx || idx.size === 0 || !node || !m) return 0
  if (segmentHits(idx, node.x + 0.5, node.y, node.z + 0.5, m.x + 0.5, m.y, m.z + 0.5)) return CORE_MOVE
  if (segmentHits(idx, node.x, node.y, node.z, m.x, m.y, m.z)) return CORE_MOVE
  return 0
}

/**
 * THE WRAPPER (index.mjs installs it on the walk profile BEFORE every clone copies it): the base generator decides which
 * moves exist; this only raises their costs. It never removes, adds or reorders a neighbour -- the neighbour set is the
 * base's by construction, and `counters.set_changed` would say otherwise (gate G3). `ctx()` -> { idx, live, reflex }.
 */
export function wrapNeighbors (baseGetNeighbors, ctx, counters = {}) {
  return function (node) {
    const ns = baseGetNeighbors.call(this, node)
    let c
    try { c = ctx() } catch { return ns }
    if (!c || !c.idx || c.idx.size === 0) return ns
    const n0 = ns.length
    for (let i = 0; i < ns.length; i++) {
      const s = moveSurcharge(c.idx, node, ns[i])
      if (!s) continue
      // THE EFFECT, observed independently of the decision (G2): a surcharge computed while a body-moving reflex is active
      if (c.reflex && !/^eat/.test(String(c.reflex))) counters.held_seen = (counters.held_seen ?? 0) + 1
      if (!c.live) continue
      ns[i].cost += s
      counters.priced_moves = (counters.priced_moves ?? 0) + 1
      if (c.reflex && !/^eat/.test(String(c.reflex))) counters.held_priced = (counters.held_priced ?? 0) + 1
    }
    if (ns.length !== n0) counters.set_changed = (counters.set_changed ?? 0) + 1
    return ns
  }
}

/**
 * IS THE PRICE ON? -> boolean. Pure. Off while a reflex that moves the body holds it (keepout.mjs scopeHolds' rule: eating
 * does not take the body), and off when LAVASIGHT=0.
 */
export function priceLive ({ on = true, reflex = null } = {}) {
  if (!on) return false
  return !(reflex && !/^eat/.test(String(reflex)))
}

/**
 * THE LIVE RE-READ -> { active, unloaded, removed }. Pure over `read(x, y, z)` -> block | null (unloaded). Memory cells
 * farther than LIVE_R (xz) from `at` are neither read nor active. A loaded cell that is not lava-like is REMOVED (a sealed
 * pool or a changed world stops costing at once); an unloaded one is kept, inactive.
 */
export function liveConfirm (cells, read, at, { liveR = LIVE_R } = {}) {
  const active = [], unloaded = [], removed = []
  for (const c of cells) {
    if (at && (Math.abs(c.x - at.x) > liveR || Math.abs(c.z - at.z) > liveR)) { unloaded.push(c); continue }
    let b = null
    try { b = read(c.x, c.y, c.z) } catch { b = null }
    if (b == null) unloaded.push(c)
    else if (LAVA_LIKE.has(b.name)) active.push(c)
    else removed.push(c)
  }
  return { active, unloaded, removed }
}

/** THE OWN-SIGHTING RING: cells this bot's own guards named, newest kept. Not pure (a small class), no I/O. */
export class SightRing {
  constructor (max = RING_MAX) { this.max = max; this.map = new Map() }
  add (c) {
    if (!c || !isInt(c.x) || !isInt(c.y) || !isInt(c.z)) return false
    if (Math.abs(c.x) >= 2 ** 21 || Math.abs(c.z) >= 2 ** 21 || c.y < -64 || c.y >= 448) return false
    const k = packKey(c.x, c.y, c.z)
    const fresh = !this.map.has(k)
    this.map.delete(k); this.map.set(k, { x: c.x, y: c.y, z: c.z })
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value)
    return fresh
  }
  drop (c) { this.map.delete(packKey(c.x, c.y, c.z)) }
  cells () { return [...this.map.values()] }
  get size () { return this.map.size }
}

/** A guard row's named cell -> { x, y, z } | null. Pure: "... at X,Y,Z ..." (corridor and blind-step details). */
export function cellFromDetail (detail) {
  const m = /\bat (-?\d+),(-?\d+),(-?\d+)\b/.exec(String(detail ?? ''))
  return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null
}

/** THE MEMORY: the file's cells and the ring's, deduplicated. Pure. */
export function memoryCells (fileCells, ringCells) {
  const seen = new Set(), out = []
  for (const list of [fileCells ?? [], ringCells ?? []]) {
    for (const c of list) { const k = packKey(c.x, c.y, c.z); if (!seen.has(k)) { seen.add(k); out.push(c) } }
  }
  return out
}

/** A PLANNED ROUTE AGAINST THE INDEX -> { core_nodes, min_d }. Pure (the `_lavasight_route` row's args). */
export function routeSummary (idx, nodes, active) {
  let core = 0, minD = null
  for (const n of nodes ?? []) {
    if (inFootprint(idx, n.x, n.y, n.z)) core++
    for (const c of active ?? []) {
      const d = Math.max(Math.abs(c.x - Math.floor(n.x)), Math.abs(c.y - Math.floor(n.y)), Math.abs(c.z - Math.floor(n.z)))
      if (minD === null || d < minD) minD = d
    }
  }
  return { core_nodes: core, min_d: minD }
}

/**
 * HOMEFIX'S RELOCATION TARGET (relocate.mjs dryTarget `forbid`): a target whose feet are within 3 (xz), -1..+3 (y) of an
 * active lava cell is refused. Pure. Composed with keepout's fire-column forbid by OR in watchdog.mjs; with no target the
 * watchdog's existing fallback (home) runs.
 */
export function relocationLavaForbidden (active, x, y, z) {
  if (!active?.length) return false
  for (const c of active) {
    if (Math.abs(c.x - x) <= 3 && Math.abs(c.z - z) <= 3 && y - c.y >= -1 && y - c.y <= 3) return true
  }
  return false
}

/**
 * THE READER -> { map(), state(), refresh() }. fs at the edge, the decision in parseLavaMap. FAIL OPEN on everything: a
 * missing, unreadable, malformed, foreign or stale file means no map cells (Codex design r1 P2: no retain-last-good). The
 * bytes are re-parsed when mtime, size, the login world or the pool change; the clock is re-judged on EVERY refresh, so a
 * file goes stale at its stale_after without being touched.
 */
export function lavaMapReader ({ file, worldId = () => null, pool = () => null, now = () => Date.now(), fsx = fs, onChange = () => {} } = {}) {
  let sig = null, parsed = null, cur = { state: 'unread', cells: [], bad: [], meta: {} }
  const empty = (state, why = null, meta = {}) => ({ state, why, cells: [], bad: [], meta })
  const set = next => {
    const key = s => `${s.state}|${s.why ?? ''}|${s.cells.length}|${s.meta?.generated_at ?? ''}`
    const was = key(cur)
    cur = next
    if (key(cur) !== was) { try { onChange(cur) } catch { /* telemetry */ } }
  }
  const refresh = () => {
    let f = null
    try { f = file() } catch { f = null }
    if (!f) { sig = null; parsed = null; return set(empty('absent')) }
    let s
    try { s = fsx.statSync(f) } catch (e) {
      sig = null; parsed = null
      return set(e?.code === 'ENOENT' ? empty('absent') : empty('unreadable', `stat:${String(e?.message ?? e).slice(0, 40)}`))
    }
    const m = `${s.mtimeMs}:${s.size}:${worldId() ?? ''}:${pool() ?? ''}`
    if (m !== sig) {
      let raw
      try { raw = JSON.parse(fsx.readFileSync(f, 'utf8')) } catch (e) {
        sig = null; parsed = null
        return set(empty('unreadable', `read:${String(e?.message ?? e).slice(0, 40)}`))
      }
      sig = m
      parsed = { raw }
    }
    // the decision on every refresh (the clock moves even when the bytes do not)
    return set(parseLavaMap(parsed.raw, { worldId: worldId(), pool: pool(), now: now() }))
  }
  return { map: () => cur, state: () => cur.state, refresh }
}

/** The licence row's args (`_lavasight_mode`). Pure. */
export function lavasightModeArgs (st, { on = true, worldId = null } = {}) {
  return { on: on ? 1 : 0, state: on ? (st?.state ?? 'unread') : 'off', why: st?.why ?? st?.kept ?? null,
           world: st?.meta?.world ?? null, world_id: worldId ?? null, cells: st?.cells?.length ?? 0,
           generated_at: st?.meta?.generated_at ?? null, stale_after: st?.meta?.stale_after ?? null, v: 1 }
}
export const lavasightModeDetail = (a) =>
  `phase=mode v=1 on=${a.on} state=${a.state}${a.why ? ` why=${a.why}` : ''} cells=${a.cells} world=${a.world ?? '-'} gen=${a.generated_at ?? '-'}`
