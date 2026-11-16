// FELLCANOPY-01 (showcase, 11-08): A LISTED LOG NO STAND SEES GETS ITS CANOPY LISTED, SO THE FELLING CAN FINISH.
//
// THE CASE (LIVE showcase ef40871b, 11-08): the stepwell (0_70_0, sited 11-05 20:58Z) read "felling: complete; 17 log(s) left" on
// 221 of 240 visits in 72 h and nothing moved for 63 h. The world (region read 11-08 ~14:20Z): 17 spruce logs of trees 0, 2, 6 and 7
// stand (50 listed, 33 down); every replant is settled (7 skipped, tree 5's sapling planted); the 5 stands are built. Replayed offline
// with the live code (walkFrom + digStand on a region dump): 0 of the 17 logs has a dig stand -- the spruces' own NATURAL leaves
// (rings round each trunk, a full block to the sight line) stand between every walk node and the log, and the record lists only the
// 15 leaves over the stands. runVisit's clears() skips a clear no stand reaches without counting it (buildrun.mjs `if (!digStand(...))
// continue`), so the visit ends `complete` (every stand cell done) with logs left, and the tank never starts (fellPending > 0).
//
// THE REMEDY (the actuator is skills.mjs buildStepwellRun): a felling visit that ended `complete` with logs left proves no stand saw
// them. The next generation of the record LISTS the natural leaves (persistent=false: grown, never placed) round every standing listed
// log -- kind=leaves clears, inside the stepwell's own reservation, never a record cell -- and the felling's clears() digs them like
// every listed clear (low before high, each from a dig stand; leaves never wait for a sapling). Listed, they are on the record for the
// showcase tripwire (SW1 stepwell_clear_ok: any dig on a clear entry of any generation of the chain): no new tripwire rule.
// Bounded: FELLCANOPY_MAX entries a generation, FELLCANOPY_ROUNDS generations; FELLCANOPY=off is the rollback (every visit as before).

const kOf = a => `${a[0]},${a[1]},${a[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')

export const fellCanopyOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.FELLCANOPY ?? '').trim().toLowerCase())
export const FELLCANOPY_R = 2        // horizontal (Chebyshev) reach round a log: a spruce's rings are radius 2 at most
export const FELLCANOPY_DOWN = 1     // ...from one below the log
export const FELLCANOPY_UP = 2       // ...to two above it (the ring over the log and the sight line down to it)
export const FELLCANOPY_MAX = 96     // entries listed a generation (the live case lists ~70)
export const FELLCANOPY_ROUNDS = 6   // generations that may list a canopy (each one only after a visit proved the logs unseen)

const LEAVES = /^[a-z_]+_leaves$/

/** Natural leaves by a reader's block -> bool: a *_leaves block whose `persistent` property reads false (grown; a placed leaf reads
 *  true). A block whose properties are unread is NOT natural (never listed). Pure. */
export function naturalLeaves (b) {
  if (!b || !LEAVES.test(nm(b))) return false
  const p = b.props ?? (typeof b.getProperties === 'function' ? (() => { try { return b.getProperties() } catch { return null } })() : null)
  return p?.persistent === false || p?.persistent === 'false'
}

/** The record's standing listed logs -> [{ at, tree }] (kind tree whose cell still reads a log or wood). Unread cells: skipped. Pure. */
export function standingLogs (rec, read) {
  const out = []
  for (const c of rec?.clear ?? []) {
    if (c?.kind !== 'tree' || !Array.isArray(c.at)) continue
    const b = read(...c.at)
    if (b && /_(log|wood)$/.test(nm(b))) out.push({ at: c.at, tree: c.tree ?? null })
  }
  return out
}

/** IS A CANOPY LISTING DUE after a felling visit? -> bool. Only a visit that ended `complete` (every stand done, so the clears were
 *  all it had) with listed logs still standing and nothing cleared: proof that no stand saw them. Under the round bound. Pure. */
export function fellCanopyDue (rec, { stop, left, cleared = 0 } = {}, { rounds = FELLCANOPY_ROUNDS } = {}) {
  if (stop !== 'complete' || !(Number(left) > 0) || Number(cleared) > 0) return false
  return (Number(rec?.fellCanopy?.rounds) || 0) < rounds
}

/**
 * THE CANOPY TO LIST -> [{ at, kind: 'leaves', name, tree, canopy: 1 }], nearest a log first, at most `max`. Pure.
 *   rec   the stepwell record (its `clear` list: tree logs, leaves, cuts; its `cells`; its `zones` reservation)
 *   read  (x, y, z) -> { name, props } | null
 * Natural leaves within `r` (Chebyshev, x/z) and `down`..`up` (y) of every STANDING listed log; never a record cell, never a cell the
 * felling already lists (kind tree or leaves: its clears dig it anyway), never outside the record's own reservation (`zones`: nothing
 * else is sited there), never unread. A cell the tank lists as a CUT may be listed again as leaves (the cut waits for the felling).
 */
export function fellCanopy (rec, read, { r = FELLCANOPY_R, down = FELLCANOPY_DOWN, up = FELLCANOPY_UP, max = FELLCANOPY_MAX, logs = null } = {}) {
  if (!rec || typeof read !== 'function') return []
  const cellKeys = new Set((rec.cells ?? []).filter(c => Array.isArray(c?.at)).map(c => kOf(c.at)))
  const felled = new Set((rec.clear ?? []).filter(c => (c?.kind === 'tree' || c?.kind === 'leaves') && Array.isArray(c.at)).map(c => kOf(c.at)))
  const boxes = (rec.zones ?? []).map(z => z?.box).filter(b => Array.isArray(b) && b.length === 6)
  const inZone = ([x, y, z]) => boxes.some(b => x >= b[0] && y >= b[1] && z >= b[2] && x <= b[3] && y <= b[4] && z <= b[5])
  const best = new Map()
  for (const L of logs ?? standingLogs(rec, read)) {
    const [lx, ly, lz] = L.at
    for (let dy = -down; dy <= up; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const at = [lx + dx, ly + dy, lz + dz], k = kOf(at)
      if (felled.has(k) || cellKeys.has(k) || !inZone(at)) continue
      const b = read(...at)
      if (!naturalLeaves(b)) continue
      const d = Math.max(Math.abs(dx), Math.abs(dz)) + Math.abs(dy)
      const was = best.get(k)
      if (!was || d < was.d) best.set(k, { at, name: nm(b), tree: L.tree, d })
    }
  }
  return [...best.values()].sort((a, b) => a.d - b.d || a.at[1] - b.at[1] || kOf(a.at).localeCompare(kOf(b.at))).slice(0, max)
    .map(({ at, name, tree }) => ({ at, kind: 'leaves', name, ...(tree != null ? { tree } : {}), canopy: 1 }))
}

/** THE NEXT GENERATION with the canopy listed -> a record | null (nothing new to list). Its `fellCanopy` counts the rounds. Pure. */
export function withFellCanopy (cur, entries, { now = Date.now(), left = null } = {}) {
  if (!cur || !Array.isArray(entries) || !entries.length) return null
  const have = new Set((cur.clear ?? []).filter(c => c?.kind === 'tree' || c?.kind === 'leaves').map(c => kOf(c.at)))
  const add = entries.filter(e => !have.has(kOf(e.at)))
  if (!add.length) return null
  const rounds = (Number(cur.fellCanopy?.rounds) || 0) + 1
  return { ...cur, clear: [...(cur.clear ?? []), ...add], fellCanopy: { rounds, n: (Number(cur.fellCanopy?.n) || 0) + add.length, at: now, left } }
}
