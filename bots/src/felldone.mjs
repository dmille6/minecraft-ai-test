// FELLDONE-01 (showcase, obsolete-01show): A FELLING STAIR WHOSE TREE IS GONE IS DONE.
//
// THE CASE (LIVE showcase, the stepwell, 11-14 08:32Z): the felling visit ended `stuck_on_cell ... segs=stand waiting=5 stalled=true`
// -- "4 cell(s) no stand has reached in 3+ visits; nothing else is open". The saved world: 0 of the record's 50 listed logs stand (the
// town's own log gathering took them), and the five `stand` cells of the felling stairs (stepwell.mjs site.stands: plotPrep's
// staircases beside the tall trunks) hang in air 8 above the pit the tank phase had already dug under them: nothing to place against.
// The felling view (stepwell.mjs fellView) has ONE segment, so three deferring visits stamped the whole project stalled for a stair
// to trees that no longer exist; and fellcanopy.mjs's listing (it needs the felling visit to end `complete`) could never fire.
//
// THE RULE (pure here; the actuator is skills.mjs buildStepwellRun, runVisit's `alsoDone`). The felling's three obligations are
// judged each by its own evidence:
//   LOGS      a listed tree is GONE when every one of its listed logs reads as something that is not a log. An UNREAD cell is
//             unknown, never gone.
//   STANDS    a stand cell serves the tree(s) whose staircase it is a step of (standTrees: plotPrep's own geometry over the
//             record's `trees`; a cell that fits no tree serves every tree). A stand whose every tree is gone is OBSOLETE: done for
//             the felling view -- never open, never placed, never deferred, never on the stuck map. One placed earlier comes out as
//             every stand does: the tank's own cut of its layer (stepwell.mjs planTank: `stand` cells dig as `foreign`).
//   REPLANTS  settled by their own states (skipped, or a sapling in the cell): they still hold the felling PHASE (the tank is never
//             cut over an owed sapling: fellfirst-01), never a stand cell.
// The phase test itself (skills.mjs: a listed log stands or is unread, or a replant is owed) is unchanged; fellPhase mirrors it for
// the row and the tests. FELLDONE=off|0|false|no is the rollback: no `alsoDone`, no row, every stamp as before.

const kOf = a => `${a[0]},${a[1]},${a[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const isLog = b => /_(log|wood)$/.test(nm(b))
const SAPLING = /_sapling$|^mangrove_propagule$/

export const fellDoneOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.FELLDONE ?? '').trim().toLowerCase())
/** How far above a ground stand's feet a log is reached without a stair (tidy.mjs PLOTPREP.reachUp: the siting's own bound). */
export const FELL_REACH_UP = 5

/** The record's listed logs by tree -> { by: Map tree -> [at], loose: [at] } (`loose`: a log with no tree index is every tree's). */
function logsOf (rec) {
  const by = new Map(), loose = []
  for (let i = 0; i < (rec?.trees ?? []).length; i++) by.set(i, [])
  for (const c of rec?.clear ?? []) {
    if (c?.kind !== 'tree' || !Array.isArray(c.at)) continue
    if (Number.isInteger(c.tree)) { if (!by.has(c.tree)) by.set(c.tree, []); by.get(c.tree).push(c.at) } else loose.push(c.at)
  }
  return { by, loose }
}
/**
 * THE LISTED TREES NOW -> [{ tree, logs, standing, unread, state }], state 'standing' (a listed log reads a log) | 'unknown' (none
 * read standing, one unread) | 'gone' (every listed log read, none a log). Pure over `read` ((x, y, z) -> { name } | null).
 */
export function fellTrees (rec, read) {
  const { by, loose } = logsOf(rec)
  const out = []
  for (const [tree, own] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
    let standing = 0, unread = 0
    for (const at of [...own, ...loose]) { const b = read(...at); if (!b) unread++; else if (isLog(b)) standing++ }
    out.push({ tree, logs: own.length + loose.length, standing, unread, state: standing ? 'standing' : unread ? 'unknown' : 'gone' })
  }
  return out
}
/**
 * WHICH TREES A STAND CELL SERVES -> Map "x,y,z" -> [tree index] | null (it fits no tree's stair: it serves every tree). Pure. The
 * siting's geometry (tidy.mjs plotPrep): a tree whose top log is `need` = top - (base + reachUp) > 0 above a ground stand's reach has
 * a staircase on one side of its trunk -- step i (1..need) at base + i along that side, its blocks from base.y up to base.y + need - i.
 */
export function standTrees (rec, { reachUp = FELL_REACH_UP } = {}) {
  const out = new Map()
  for (const c of rec?.cells ?? []) {
    if (c?.role !== 'stand' || !Array.isArray(c.at)) continue
    const [x, y, z] = c.at, mine = []
    ;(rec?.trees ?? []).forEach((t, i) => {
      const b = t?.base
      if (!Array.isArray(b) || !Number.isFinite(t.top)) return
      const need = t.top - (b[1] + reachUp), dx = x - b[0], dz = z - b[2], step = Math.abs(dx) + Math.abs(dz)
      if ((dx !== 0 && dz !== 0) || step < 1) return
      if (y >= b[1] && y <= b[1] + need - step) mine.push(i)   // (a step past `need` has no height left: never matched)
    })
    out.set(kOf(c.at), mine.length ? mine : null)
  }
  return out
}
/**
 * THE FELLING VIEW'S `alsoDone` -> (cell, read) -> bool: a `stand` cell whose every tree is gone by THAT read (an unread log: not
 * gone). Never true for another role or a cell the record does not hold as a stand. Pure.
 */
export function fellAlsoDone (rec, opts = {}) {
  const serves = standTrees(rec, opts)
  const { by, loose } = logsOf(rec)
  const all = [...by.keys()]
  const gone = (i, read) => [...(by.get(i) ?? []), ...loose].every(at => { const b = read(...at); return !!b && !isLog(b) })
  return (c, read) => {
    if (c?.role !== 'stand' || !Array.isArray(c.at) || !serves.has(kOf(c.at))) return false
    return (serves.get(kOf(c.at)) ?? all).every(i => gone(i, read))
  }
}
/** THE REPLANTS STILL OWED -> [replant]: not skipped, no sapling in the cell (the phase test's own reading: skills.mjs). Pure. */
export const fellOwed = (rec, read) => (rec?.replant ?? []).filter(q => q.state !== 'skipped' && !SAPLING.test(read(...q.cell)?.name ?? ''))
/**
 * FELLING OR TANK? -> { phase: 'fell' | 'tank', pending, owed }: the mirror of skills.mjs buildStepwellRun's test (a listed log
 * stands, a listed log is unread -- `pending` null --, or a replant is owed: the felling; else the tank). Pure.
 */
export function fellPhase (rec, read) {
  let pending = 0
  for (const c of rec?.clear ?? []) { if (c?.kind !== 'tree') continue; const b = read(...c.at); if (!b) { pending = null; break } if (isLog(b)) pending++ }
  const owed = fellOwed(rec, read).length
  return { phase: pending == null || pending > 0 || owed > 0 ? 'fell' : 'tank', pending, owed }
}
/**
 * THE FELLING'S STATE for the `_stepwell op=fell_done` row -> { trees, gone, standing, unknown, stands, obsolete, placed, keys }:
 * `obsolete` the stand cells done by fellAlsoDone, `placed` those of them still holding a block (the tank's cut takes them down),
 * `keys` the obsolete cells. Pure.
 */
export function fellDone (rec, read, opts = {}) {
  const ts = fellTrees(rec, read)
  const also = fellAlsoDone(rec, opts)
  const stands = (rec?.cells ?? []).filter(c => c?.role === 'stand' && Array.isArray(c.at))
  const obs = stands.filter(c => also(c, read))
  const n = s => ts.filter(t => t.state === s).length
  return { trees: ts.length, gone: n('gone'), standing: n('standing'), unknown: n('unknown'), stands: stands.length, obsolete: obs.length,
    placed: obs.filter(c => read(...c.at)?.boundingBox === 'block').length, keys: obs.map(c => kOf(c.at)) }
}
/** The row's `n`. Pure. */
export const fellDoneRow = d => `trees${d.trees}/gone${d.gone}/standing${d.standing}/unknown${d.unknown}/stands${d.stands}/obsolete${d.obsolete}/placed${d.placed}`
/**
 * IS A STUCK STAMP THE OBSOLETE STAIR'S? -> bool (buildproj.mjs stuckAt `stale`: skills.mjs projStuckLive). True only when the stamp
 * names cells and every one is a stand cell that is obsolete by `read`: a stamp with no cells (the tank's own back-off) and one that
 * names any other cell hold as before. Pure.
 */
export function fellStampStale (keys = [], rec = null, read = () => null) {
  if (!Array.isArray(keys) || !keys.length) return false
  const also = fellAlsoDone(rec)
  const byKey = new Map((rec?.cells ?? []).filter(c => c?.role === 'stand' && Array.isArray(c.at)).map(c => [kOf(c.at), c]))
  return keys.every(k => byKey.has(k) && also(byKey.get(k), read))
}
