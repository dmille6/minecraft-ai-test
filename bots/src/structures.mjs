// RESERVED STRUCTURE CELLS (structureguard-01; docs/reports/ziggurat-mineshaft-2026-10-15.md 3.6, 4.3; town projects stage 2).
//
// ONE REGISTRY, ONE GUARD. minewell-01 taught `mine` to keep its stair out of a junk well's shell and treefarm-02 added the
// farm's cells to the same plan (minewell.mjs planMineStart `forbid`). This file adds every BUILT STRUCTURE the town keeps
// a record of -- the monument (the ziggurat) now, the shared mineshaft next, town projects later -- as one more `forbid`
// source for the same guards, never a second guard:
//   - mine: the stair plan and the per-dig stop (skills.mjs mine, via the composed keep-out)
//   - gather: candidates at enumeration, and the target refusal (skills.mjs, beside farmNoDig)
//   - the ore tunnel's own profile (oretunnel.mjs breakHazard sits beside it)
// TARGET DIGS ONLY for the monument (design 3.6: transit and survival stay untouched -- a hard veto on a 48 x 48 solid block
// would leave a bot in a cave under it no exit; the monument absorbs that damage instead). The shaft (stage 5) will add
// its own stricter policy here.
//
// RECORDS are read from the pool state dir, fresh (one small file per kind, cached for CACHE_MS): a structure founded since
// the last read is honoured by the next plan or dig. A record this world cannot claim (another world's) is ignored.
import fs from 'node:fs'
import path from 'node:path'
import { profileAt, ZIG, stairRelFor } from './monument.mjs'
import { sameWorld } from './blueprint.mjs'

export const STRUCTURE_KINDS = ['monument']
/** How far below the monument's base its footprint stays reserved: the foundation fill and the ground that holds it. */
export const FOUNDATION_GUARD = 8
export const CACHE_MS = 2_000

/**
 * A STRUCTURE'S RECORD KEY: `<kind>-<homeX>_<homeY>_<homeZ>` -- the treefarm's convention (`treefarm-<home>`), so a record
 * generation is blueprint.mjs's `<key>.g<N>.json` and a lease its `<key>.lease<N>.json` (the builder reuses both).
 */
export const structureKey = (kind, home) => `${kind}-${home.x}_${home.y}_${home.z}`
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The latest generation of `<key>.g<N>.json` in `dir` -> record | null. Never throws. */
export function readStructureRecord (dir, key) {
  try {
    let best = null, bn = -1
    const re = new RegExp(`^${esc(key)}\\.g(\\d+)\\.json$`)
    for (const f of fs.readdirSync(dir)) {
      const m = re.exec(f)
      if (!m) continue
      const n = Number(m[1])
      if (n > bn) { bn = n; best = f }
    }
    if (!best) return null
    const r = JSON.parse(fs.readFileSync(path.join(dir, best), 'utf8'))
    return r && typeof r === 'object' ? { ...r, gen: bn } : null
  } catch { return null }
}

/**
 * THE MONUMENT'S RESERVED VOLUME -> { kind, has(x, y, z), bottom, top, box } | null. Pure over the record: its footprint
 * columns from base-FOUNDATION_GUARD up to the finished profile, plus the grand stair's cells. A record without a site, or
 * abandoned, reserves nothing.
 */
const posInt = (v, max = 256) => Number.isInteger(v) && v > 0 && v <= max
/** A geometry the profile functions can walk (Claude stage-3 r1 P2-5: S <= 0 never ended the tier loop). Pure. */
export const validGeom = g => !!g && posInt(g.B) && posInt(g.S, 64) && posInt(g.H, 64) && posInt(g.STAIR_W, 64) && g.B >= 2 * g.S
export function monumentIndex (rec) {
  const s = rec?.site
  // A MALFORMED RECORD RESERVES NOTHING (Claude stage-3 r1 P2-5: a corner without x made every offset NaN, and NaN passed the
  // bounds test -- a world-long band reserved, mine refused pool-wide)
  if (!s || !s.corner || !Number.isInteger(s.corner.x) || !Number.isInteger(s.corner.z) || !Number.isInteger(s.baseY) || rec.state === 'abandoned') return null
  const g = rec.geom ?? ZIG
  if (!validGeom(g)) return null
  if (s.stairFace != null && !['n', 's', 'e', 'w'].includes(s.stairFace)) return null   // Claude stage-3 r2 P2-C: zigCells threw
  const x0 = s.corner.x, z0 = s.corner.z, y0 = s.baseY
  const stairs = stairRelFor(s.stairFace ?? null, g)
  let top = 0
  for (let t = 0, L = g.B; L >= 2 * g.S && L > 0; L -= 2 * g.S, t++) top = (t + 1) * g.H
  // THE RECORDED FILL (monument-01: foundation, apron, the stair approach, the edge guards) is reserved too, column by
  // column -- a foundation deeper than the guard, the apron the bots walk on, the guard walls. Malformed runs are skipped.
  const fillCols = new Map()
  let bottom = y0 - FOUNDATION_GUARD, bx0 = x0 - 1, bx1 = x0 + g.B, bz0 = z0 - 1, bz1 = z0 + g.B
  for (const r of Array.isArray(rec.fill) ? rec.fill : []) {
    if (!Array.isArray(r) || !r.slice(0, 4).every(Number.isInteger) || r[2] > r[3]) continue
    const k = `${r[0]},${r[1]}`
    if (!fillCols.has(k)) fillCols.set(k, [])
    fillCols.get(k).push([r[2], r[3]])
    bottom = Math.min(bottom, r[2]); bx0 = Math.min(bx0, r[0]); bx1 = Math.max(bx1, r[0]); bz0 = Math.min(bz0, r[1]); bz1 = Math.max(bz1, r[1])
  }
  const has = (x, y, z) => {
    const i = x - x0, j = z - z0
    if (!Number.isFinite(i) || !Number.isFinite(j) || !Number.isFinite(y)) return false
    if (stairs.has(`${i},${j},${y - y0}`)) return true
    const runs = fillCols.get(`${x},${z}`)
    if (runs && runs.some(([a, b]) => y >= a && y <= b)) return true
    if (i < 0 || i >= g.B || j < 0 || j >= g.B) return false
    return y >= y0 - FOUNDATION_GUARD && y < y0 + profileAt(i, j, g)
  }
  const isStair = (x, y, z) => stairs.has(`${x - x0},${z - z0},${y - y0}`)
  return { kind: 'monument', has, isStair, base: y0, bottom, top: y0 + top - 1, box: { x0: bx0, x1: bx1, z0: bz0, z1: bz1 } }
}

/**
 * THE WAY OFF A STRUCTURE for a bot standing over its box -> { x, y, z } | null (null: p is not over it). Pure. The nearest
 * side, two cells beyond the box, at the base level (the apron): the cell a refusal names so the remedy is a `goto` the
 * bot can make from where it is (CLAUDE.md: a refusal names a remedy performable from here).
 */
export function exitCell (idx, p) {
  const b = idx?.box
  if (!b || !p || p.x < b.x0 || p.x > b.x1 || p.z < b.z0 || p.z > b.z1) return null
  const opts = [{ x: b.x0 - 2, z: p.z, d: p.x - b.x0 }, { x: b.x1 + 2, z: p.z, d: b.x1 - p.x }, { x: p.x, z: b.z0 - 2, d: p.z - b.z0 }, { x: p.x, z: b.z1 + 2, d: b.z1 - p.z }]
  opts.sort((u, v) => u.d - v.d)
  return { x: opts[0].x, y: idx.base ?? p.y, z: opts[0].z }
}

/** Every structure's index for a town (`home` = its home cell) -> [index]. Never throws. */
export function structureIndexes (dir, home, world = null) {
  const out = []
  const rec = home ? readStructureRecord(dir, structureKey('monument', home)) : null
  if (rec && sameWorld(rec.world, world)) {
    let idx = null
    try { idx = monumentIndex(rec) } catch { idx = null }   // a record this code cannot read reserves nothing
    if (idx) out.push(idx)
  }
  return out
}

/**
 * THE KEEP-OUT FOR TARGET DIGS -> { forbid(cell) -> kind | null, bottom } (bottom: the lowest reserved y, null when none).
 * Pure over the indexes. `forbid` answers the KIND, so a refusal can name what it protects.
 */
export function structureKeepOut (indexes = []) {
  const list = (indexes ?? []).filter(Boolean)
  if (!list.length) return { forbid: null, bottom: null, exit: () => null, stair: () => false }
  return { forbid: c => { for (const i of list) if (c && i.has(c.x, c.y, c.z)) return i.kind; return null },
           stair: c => !!c && list.some(i => i.isStair?.(c.x, c.y, c.z)),
           bottom: Math.min(...list.map(i => i.bottom)),
           exit: p => { for (const i of list) { const e = exitCell(i, p); if (e) return e } return null } }
}

/**
 * COMPOSE TWO KEEP-OUTS for minewell's planMineStart (`forbid`, `forbidBottom`). Pure. The farm's and the structures'
 * forbids are OR-ed; the bottom is the lower of the two; a missing side is ignored.
 */
export function composeKeepOut (a, b) {
  const fa = typeof a?.forbid === 'function' ? a.forbid : null, fb = typeof b?.forbid === 'function' ? b.forbid : null
  if (!fa && !fb) return { forbid: null, bottom: null }
  const bots = [a?.bottom, b?.bottom].filter(Number.isFinite)
  return { forbid: c => (fa && fa(c)) || (fb && fb(c)) || false, bottom: bots.length ? Math.min(...bots) : null }
}

/**
 * pathfinder exclusionAreasPlace entry (design 3.6): never scaffold onto the monument's grand stair -- a cobble block on a
 * step cell before its layer would be a foreign block in the plan. Hot path: the cached keep-out. Never throws.
 */
export function monumentPlaceCost (keepOut, block) {
  try { const p = block?.position; return p && keepOut?.stair?.(p) ? 100 : 0 } catch { return 0 }
}

/** A cached reader for one bot's town: () -> keep-out. Reads at most once per CACHE_MS (`now` injectable for tests). */
export function structureReader (dir, home, world = () => null, now = () => Date.now()) {
  let at = -Infinity, v = { forbid: null, bottom: null }
  return () => {
    const t = now()
    // the answer is cached for CACHE_MS whatever it is -- a read that throws caches "nothing reserved" (never a retry per call)
    if (t - at >= CACHE_MS) { try { v = structureKeepOut(structureIndexes(dir(), home(), world())) } catch { v = structureKeepOut([]) } at = t }
    return v
  }
}
