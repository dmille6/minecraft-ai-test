// TEMPSTAND-01: A CELL NO STAND REACHES GETS A TEMPORARY STAND (owner 11-12: "a stuck cell must not freeze a building (temporary
// stand, or carry on)" -- "yes, this makes sense"; and, in force the same day: anything a bot places to get somewhere is taken back).
//
// THE CASE (LIVE showcase and the 80-bot fleet, 11-12): a handful of cells no stand reaches freeze whole buildings for days. A build
// visit (buildrun.mjs runVisit) clicks a cell only from a node of the town walk; a cell with none is DEFERRED, after STUCK_VISITS
// deferrals the visit ends `stuck_on_cell`, the project backs off 6 hours, and every cell that waits on that segment waits with it:
// the wall extension at 803 of 886 with 13 cells stuck near 36,75,-37; the monument on 2 core cells; a cottage corner post whose only
// click is the post's top face from a ledge two above the ground; a fleet town cleanup stuck 53 hours on one cell.
//
// THE REMEDY (pure here; the actuator is runVisit's `p.tempStand`): a PILLAR of one to three cheap blocks the bag holds (dirt, else
// cobblestone) raised under the builder's own feet at a node of the town walk the visit already made -- the pillar step VOIDFILL-01
// proved on the live ziggurat (jump, place the cell under the feet, land) -- from whose top the cell's click passes the visit's own
// stand rule (buildsite.mjs stepFor: reach, the face's side, a clear sight line). The cell is clicked from there by the visit's own
// click (re-proved from the feet the bot has), then the builder digs the pillar out from under itself, top first, and stands on the
// node it started from: the world is as it was, plus the cell.
//   PROVEN BEFORE ANYTHING IS PLACED (planTempStand): the base is a walk node (the builder walks there and back as it walks anywhere:
//   the visit's walk already treats this segment's open cells as obstacles, so nothing placed from the stand closes the way home); every
//   stand cell reads AIR, is no cell, clear, tidy cut or replant of this record (`taken`), no cell of another record and in no
//   protected zone (`mayPlace`, the caller's); the floor is a full block that does not fall; the two cells over the top are empty; the
//   click is proven AGAIN with the pillar standing (a pillar hides what lies steeply under its own top) and never against the
//   pillar's own blocks (a cell clicked onto a block that is about to go: never).
//   A RECEIPT ON DISK BEFORE THE FIRST BLOCK (buildproj.mjs standWrite): the cells and the block. It is removed only when the world
//   reads every cell gone. A visit that is interrupted leaves it: the next visit to that project -- the same bot's at once, any other
//   bot's once the receipt is STALE (no visit can still be on it) -- takes the stand down before anything else. While a receipt is
//   fresh the tidy's survey never lists its cells (skills.mjs tidyInputs); a stale one's blocks are ordinary litter to it.
//   NEVER ON A FIRST MISS (standDue): only a cell the stuck files show deferred in an EARLIER visit too.
//   BOUNDED: one stand a visit, TEMPSTAND.max blocks, TEMPSTAND.minMs of the visit left before it starts, TEMPSTAND.workMs on it,
//   TEMPSTAND.tries attempts a cell inside TEMPSTAND.retryMs (voidfill.mjs accessAllowed). Anything refused: the stand comes down and
//   the cell is deferred exactly as before.
//   THE BLOCK: dirt, else cobblestone. A block the segment's own open cells place comes from the bag's SPARE only, one left for the
//   cell; any other may come from the bag's KEPT blocks too (buildbot.mjs countAll / holdKept: the scaffold reserve is kept to pillar
//   with, and the stand is dug back before the visit ends) -- so `no_material` is not a dead end for a builder that holds its reserve.
//   PROGRESS IS NOT STUCK: a visit that laid a cell from a stand never stamps the project stalled and never stops stuck_on_cell; the
//   cells still without a stand stay counted and get the next visit's stand (one a visit).
// NOT THE WALK'S MESS: the stand is placed by the visit's own send (buildbot.mjs: block_place written to the connection, never
// mineflayer's placeBlock), so placeaudit.mjs never sees it and takeback.mjs holds no receipt for it -- one owner, this file's.
// ROWS (`_build`, op=tempstand): the decision result=plan | refused; the outcome result=done | failed; the stand itself
// result=removed | left (why=done | failed | leftover). The cell's own place row carries kind=tempstand.
// SWITCH: TEMPSTAND=off|0|false|no -> no stand, no receipt read: the visit exactly as before.
import { stepFor, overlay, fullCube } from './buildsite.mjs'
import { isLiquid } from './townplan.mjs'
import { GRAVITY } from './voidfill.mjs'

const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => k3(a[0], a[1], a[2])
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')

export const TEMPSTAND = Object.freeze({
  max: 3,                    // blocks in one stand
  after: 1,                  // earlier visits that deferred the cell (the stuck files) before a stand is built for it
  minMs: 45_000,             // the visit's time left before a stand is started
  workMs: 60_000,            // the longest a builder works from a stand before it comes down
  tailMs: 15_000,            // the visit's time kept for taking it down
  cells: 8,                  // record cells clicked from one stand
  plans: 4,                  // cells a visit plans a stand for before it gives up (each refusal is a row)
  tries: 2,                  // attempts a cell a bot ...
  retryMs: 2 * 60 * 60_000,  // ... inside this window
  downTries: 3,              // visits that try to take a leftover stand down before it is left to the grounds crew
  staleMs: 10 * 60_000,      // a receipt this old is no running visit's: any bot's visit takes the stand down; the tidy may list it
  blocks: Object.freeze(['dirt', 'cobblestone', 'cobbled_deepslate']),
})
/** THE SWITCH. Pure. */
export const tempStandOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.TEMPSTAND ?? '').trim())

/**
 * THE CELLS A STAND MAY BE BUILT FOR -> [key]. Pure. `counts` the stuck files' map BEFORE this visit is counted ({ key: { visits } },
 * buildproj.mjs stuckRead): a cell deferred in at least `after` EARLIER visits. Never a cell on its first miss.
 */
export function standDue (counts = {}, keys = [], after = TEMPSTAND.after) {
  return keys.filter(k => (Number(counts?.[k]?.visits) || 0) >= after)
}
/**
 * THE BLOCK A STAND IS MADE OF -> name | null. Pure. The first of `blocks` the bag holds `h` of, beyond `need(name)` (what the cells
 * the stand is built for take of that same block: a stand never spends the block its own cell needs).
 */
export function standBlock (count = () => 0, h = 1, need = () => 0, blocks = TEMPSTAND.blocks) {
  return blocks.find(b => (Number(count(b)) || 0) >= h + (Number(need(b)) || 0)) ?? null
}
/**
 * MAY A PILLAR OF `h` BLOCKS STAND ON THIS WALK NODE? -> { ok, why }. Pure. `base` the node's feet cell. The floor a full block that
 * does not fall and is no liquid; the `h` stand cells AIR, known, not `taken` (this record's), `mayPlace` (the caller's veto: another
 * record's cell, a protected zone); the two cells over the top (the builder's feet and head up there) known, empty and dry.
 */
export function standColumn (read, base, h, { mayPlace = () => true, taken = () => false } = {}) {
  const [x, y, z] = base
  const floor = read(x, y - 1, z)
  if (!floor) return { ok: false, why: `unknown ${k3(x, y - 1, z)}` }
  if (!fullCube(floor) || isLiquid(floor) || GRAVITY.test(nm(floor))) return { ok: false, why: `floor ${nm(floor)}` }
  for (let i = 0; i < h; i++) {
    const at = [x, y + i, z], b = read(...at)
    if (!b) return { ok: false, why: `unknown ${kOf(at)}` }
    if (nm(b) !== 'air') return { ok: false, why: `not_air ${nm(b)} ${kOf(at)}` }
    if (taken(at)) return { ok: false, why: `record_cell ${kOf(at)}` }
    let may = false
    try { may = !!mayPlace(at) } catch { may = false }
    if (!may) return { ok: false, why: `vetoed ${kOf(at)}` }
  }
  for (const yy of [y + h, y + h + 1]) {
    const b = read(x, yy, z)
    if (!b) return { ok: false, why: `unknown ${k3(x, yy, z)}` }
    if (b.boundingBox !== 'empty' || isLiquid(b)) return { ok: false, why: `headroom ${k3(x, yy, z)}` }
  }
  return { ok: true, why: 'ok' }
}
/**
 * THE STAND FOR ONE CELL -> { ok: true, h, base, top, cells: [[x, y, z]] bottom-up, block, step, why: 'ok' } | { ok: false, why }.
 * Pure: it reads the world and the walk it is given, it walks nothing (never one walkFrom a candidate).
 *   read      the visit's read (null = unknown)
 *   cell      the record cell no stand reaches;  want  its state for the step (buildrun.mjs wantOf) | null
 *   nodes     the visit's walk (Map "x,z" -> [feet y]): a stand's base is one of its nodes
 *   domain    the stands' domain (stepFor)
 *   block     the block the pillar is made of
 *   min, max  the pillar's heights tried, lowest first
 *   mayPlace  the caller's veto;  taken  this record's own cells, clears, cuts and replants
 * The LOWEST pillar wins, then the nearest top (stepFor's own order). A top whose click only works against the pillar's own block,
 * or only with the pillar thought away, is passed over for the next nearest (at most `tries` a height).
 */
export function planTempStand ({ read, home = { x: 0, y: 0, z: 0 }, cell, want = null, nodes = new Map(), domain = null, min = 1, max = TEMPSTAND.max, block = 'dirt', mayPlace = () => true, taken = () => false, tries = 8 } = {}) {
  const [cx, , cz] = cell
  let why = 'no_node'
  const solid = Object.freeze({ name: block, boundingBox: 'block' })
  for (let h = min; h <= max; h++) {
    const raised = new Map()
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const col = `${cx + dx},${cz + dz}`
      for (const y of nodes.get(col) ?? []) {
        const c = standColumn(read, [cx + dx, y, cz + dz], h, { mayPlace, taken })
        if (!c.ok) { if (why === 'no_node' || why === 'no_step') why = c.why; continue }
        if (!raised.has(col)) raised.set(col, [])
        raised.get(col).push(y + h)
      }
    }
    for (let t = 0; t < tries && raised.size; t++) {
      const s = stepFor(read, home, cell, raised, domain, want)
      if (!s) { why = 'no_step'; break }
      const [sx, sy, sz] = s.stand
      const cells = Array.from({ length: h }, (_, i) => [sx, sy - h + i, sz])
      const keys = new Set(cells.map(kOf))
      // AGAIN WITH THE PILLAR STANDING, from its top alone: the builder's own pillar is in the world when it clicks
      const s2 = stepFor(overlay(read, new Map([...keys].map(k => [k, solid]))), home, cell, new Map([[`${sx},${sz}`, [sy]]]), domain, want)
      if (s2 && !keys.has(kOf(s2.support))) return { ok: true, h, base: [sx, sy - h, sz], top: [sx, sy, sz], cells, block, step: s2, why: 'ok' }
      why = s2 ? 'support_is_stand' : 'pillar_in_sight'
      const col = `${sx},${sz}`, left = raised.get(col).filter(y => y !== sy)
      if (left.length) raised.set(col, left); else raised.delete(col)
    }
  }
  return { ok: false, why }
}
/** The receipt's cells still standing -> [[x, y, z]] highest first. Pure over `read` (an unread cell counts as standing: never cleared
 *  on a guess). */
export function standStanding (receipt, read) {
  return (receipt?.cells ?? []).filter(c => { const b = read(...c); return !b || nm(b) === receipt.block }).sort((a, b) => b[1] - a[1])
}
/** IS A RECEIPT ANOTHER HOLDER'S RUNNING VISIT'S? -> bool. Pure: younger than `staleMs` and not this holder's own. */
export const standLive = (receipt, me, now, staleMs = TEMPSTAND.staleMs) => !!receipt && receipt.holder !== me && now - (Number(receipt.at) || 0) < staleMs
