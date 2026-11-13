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
// REVIEW r1 (Codex, four blockers; Claude, three notes), all in this file's rules now:
//   ONE OPEN RECEIPT A HOLDER AND PROJECT: while this holder's receipt for the project is on disk (a stand it could not take down),
//   it plans no new stand there -- a new receipt would replace the old one and the old blocks would be nobody's (`refused
//   why=receipt_open`). The dead end is bounded by the receipt's own life (ownMs, below).
//   A CELL SOMEBODY NOW OWNS IS NEVER DUG (standClaims): at every take-down dig -- the visit's own and the leftover pass, under the
//   feet and from the walk, read again after the walk to the dig's stand -- the stand cell must still pass the placement's own test
//   (no cell, clear, cut or replant of this record; the caller's veto: another record's cell, a zone). One that does not is ADOPTED:
//   dropped from the receipt with a row, and so is every stand cell under it and every stand with a block set on top of it
//   (takeback.mjs's `built_on`). A veto that cannot be read adopts nothing and digs nothing: the receipt waits.
//   A RECEIPT ACTS FOR ownMs ONLY (Claude's note c). The world carries no mark of who placed a block: a stand the grounds crew cut,
//   with a later fill of the same block in the same cell that no record lists any more, reads exactly like the stand. It cannot be
//   told apart, so it is bounded: the receipt's `at` is when the stand was placed, and after ownMs (an hour: less than the tidy's
//   own survey -> cut -> survey -> fill, its surveys an hour apart and a stand listed only once its receipt is staleMs old) the
//   cells still standing are adopted (`why=expired`) and never dug by a visit -- litter for the grounds crew, by its own rules.
//   THE DEADLINE BOUNDS EVERY AWAIT ON THE STAND: the take-down starts by deadline - tailMs. The walk to the base and every rise are
//   checked against it, and the click's barrier wait on a stand is capped at what is left (buildrun.mjs click `waitMs`).
//   THE RESERVE COMES BACK OR THE ROW SAYS SO: dirt first; a stone stand only with a pickaxe in the bag (by hand it takes ten
//   seconds a block and drops nothing: `refused why=no_pickaxe`); after the take-down the bag is counted, the base walked to once
//   for a block dug from the walk, and what is still missing is on the outcome row (`unrecovered=N`).
// REVIEW r2 (Codex, four blockers; Claude, one), in this file's rules now:
//   A DIRT STAND THAT GREW IS STILL THE STAND (Claude; standIs / STAND_GROWN). Vanilla spreads grass onto a dirt block with air over
//   it from grass beside it (one block lower too) on random ticks -- inside a minute on a grass node, surely inside the ten an
//   aborted stand waits. A `dirt` stand cell that reads grass_block, mycelium or podzol IS the stand's block wherever a name is
//   compared (standing, the dig under the feet, the dig from the walk, the claims): the three ways dirt changes with NO ACTOR (grass
//   and mycelium spread; a giant spruce's podzol). Not coarse_dirt or rooted_dirt (dirt never becomes them by itself: somebody
//   placed that block), not dirt_path or farmland (a tool in somebody's hand made them: a record's tool cell is `owned`, any other
//   is a block somebody chose there -- read as another block, as before). Stone stands do not change.
//   THE WHOLE COLUMN IS ASKED AGAIN AT EVERY DIG (Codex): standClaims -- the owners AND what stands on the stand -- is computed
//   immediately before every take-down dig, after every await (the tool's equip, the walk to the dig's stand), nothing awaited from
//   there to the dig.
//   THE OTHER RECORDS ARE READ FRESH FOR A TAKE-DOWN (Codex; standVeto): the caller's veto keeps the other projects' cells for
//   VETO_TTL_MS only (one read serves a whole plan's burst of questions), and a take-down starts by dropping what is kept -- one
//   read a take-down, one more only when a walk to a dig's stand outlasts the TTL.
//   THE BUILDER COMES DOWN BEFORE ANYTHING IS GIVEN AWAY (Codex; standExit): with its feet on the stand's column and cells it may
//   not dig (owned, built on, expired), it walks off to a node of the visit's walk beside the column that it can drop to without
//   harm (at most FALL_MAX, the cells it falls through empty); with none, it digs down through the stand's own cells nobody owns
//   (the receipt's age aside: a builder standing on its pillar is not left there for a doubt about who placed it); with neither,
//   the receipt is KEPT and the row says `on_stand`. A receipt is never removed with the builder on its column.
//   AN ABSOLUTE CUTOFF, NOT A DURATION (Codex): a stand's click is given the TIME by which the take-down must start; its hold, its
//   look and its barrier wait end there (buildrun.mjs `by`), and nothing is sent that could not be acknowledged by then.
// REVIEW r3 (Codex, four blockers -- three folded, one accepted; Claude, none), in this file's rules now:
//   THE OTHER RECORDS ARE READ AGAIN AT EVERY ASK OF THE COLUMN (Codex 1; buildrun.mjs standDown `claims`): r2 read them once a
//   take-down and kept that for VETO_TTL_MS, so a cell another project took during a one-second walk to the dig was dug. Every
//   claims -- the one immediately before each dig above all -- now drops what the veto keeps first: one read a dig, a few a
//   take-down (a stand is at most TEMPSTAND.max blocks). The TTL still serves a PLAN's burst of questions, nothing else.
//   A RECEIPT KEEPS ITS ORIGINAL TOP (Codex 2; standTop, the receipt's `topY`): a receipt written back with only the cells that
//   still stand has a lower highest cell; the builder still on the ORIGINAL top was then judged off the pillar and the receipt
//   adopted away from under it. `topY` is written with the stand and never lowered: "is the builder on the stand?" asks it.
//   AN UNREADABLE RECORD IS NOT AN EMPTY ONE (Codex 4; otherCellsStrict): the production veto read the other projects through
//   skills.mjs projectHeads, which SKIPS a head that cannot be read -- a partial list, the unreadable owner's cells free. The veto's
//   reader now THROWS when any guarded project's head is unreadable or its newest generation is rejected: a plan is refused
//   (standColumn: `vetoed`), a take-down digs nothing and gives nothing away (standOwner: `unknown`), the receipt waits. A failed
//   read is kept for the TTL like a good one (standVeto: a plan's burst over an unreadable record is ONE read, not one a column).
//   ACCEPTED, NOT FIXED (Codex 3): grass at a stand's coordinate inside ownMs -- see STAND_GROWN.
// NOT THE WALK'S MESS: the stand is placed by the visit's own send (buildbot.mjs: block_place written to the connection, never
// mineflayer's placeBlock), so placeaudit.mjs never sees it and takeback.mjs holds no receipt for it -- one owner, this file's.
// ROWS (`_build`, op=tempstand): the decision result=plan | refused; the outcome result=done | failed; the stand itself
// result=removed | left (why=done | failed | leftover) and result=adopted (why=owned | built_on | expired). The cell's own place
// row carries kind=tempstand.
// SWITCH: TEMPSTAND=off|0|false|no -> no stand, no receipt read: the visit exactly as before.
import { stepFor, overlay, fullCube } from './buildsite.mjs'
import { isLiquid } from './townplan.mjs'
import { GRAVITY, FALL_MAX } from './voidfill.mjs'

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
  ownMs: 60 * 60_000,        // a receipt older than this digs nothing: what stands in its cells is adopted (see the header)
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
  return (receipt?.cells ?? []).filter(c => { const b = read(...c); return !b || standIs(receipt.block, nm(b)) }).sort((a, b) => b[1] - a[1])
}
/** (r2) What a DIRT stand cell reads as once the world has grown over it with no actor: grass and mycelium spread onto dirt with air
 *  above it, a giant spruce turns it to podzol (see the header for what is NOT here and why). */
// ACCEPTED BOUNDED RISK (r3, Codex 3; the control session's call, told to the owner): the stand removed and terrain restored with GRASS at its exact coordinate, in no record, inside ownMs, reads as the grown stand and is dug.
export const STAND_GROWN = Object.freeze({ dirt: Object.freeze(['grass_block', 'mycelium', 'podzol']) })
/** (r2) IS THE BLOCK A CELL READS THE STAND'S BLOCK? -> bool. Pure. Its own name, or what it grows into (STAND_GROWN). */
export const standIs = (block, name) => !!name && (name === block || (STAND_GROWN[block] ?? []).includes(name))
/**
 * (r2) THE WAY OFF A STAND -> [x, y, z] | null. Pure. `feet` the builder's feet cell on the stand's column, `nodes` the visit's
 * walk ("x,z" -> [feet y]). A node in one of the four columns beside it, at the feet's height or at most `fall` below (no harm:
 * vanilla hurts from the fourth block), every cell from that node up to the builder's head empty and dry (it steps off and drops
 * through them). The smallest drop wins. null: no verified way off by a walk.
 */
export function standExit (read, feet, nodes, fall = FALL_MAX) {
  const [x, y, z] = feet
  let best = null
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const ny of nodes?.get(`${x + dx},${z + dz}`) ?? []) {
      if (ny > y || y - ny > fall || (best && ny <= best[1])) continue
      let clear = true
      for (let yy = ny; yy <= y + 1 && clear; yy++) { const b = read(x + dx, yy, z + dz); clear = !!b && b.boundingBox === 'empty' && !isLiquid(b) }
      if (clear) best = [x + dx, ny, z + dz]
    }
  }
  return best
}
/** (r3) THE STAND'S ORIGINAL TOP CELL'S y -> number. Pure. The receipt's `topY` (written with the stand, kept across every rewrite),
 *  never lower than its highest cell; a receipt without one (hand-written, older): its highest cell. "Is the builder on the stand?"
 *  (buildrun.mjs onStand) asks this, never the cells that happen to stand still. */
export const standTop = rc => Math.max(Number.isInteger(rc?.topY) ? rc.topY : -Infinity, ...(rc?.cells ?? []).map(c => c[1]))
/**
 * (r3) EVERY OTHER PROJECT'S RECORD CELLS, READ STRICTLY -> Set of "x,y,z". Pure over `headOf`. THROWS `record_unread <plot>` when a
 * project's head cannot be read (`ok` false: the directory) or its NEWEST generation is rejected (torn, unparseable, off the chain:
 * the head is then an OLDER generation, without the cells the newest took) -- skills.mjs plotRecordsNow's rule. A project with no
 * record at all is read, and empty.
 *   plots      every guarded project's plot (shop.mjs projectsGuarded);  plot  this visit's own, left out (never read here)
 *   headOf(p)  buildproj.mjs recordHead's answer for that plot's key: { ok, head, gens, rejected }
 */
export function otherCellsStrict (plots = [], plot = null, headOf = () => null) {
  const out = new Set()
  for (const p of plots ?? []) {
    if (p === plot) continue
    const h = headOf(p)
    if (!h?.ok) throw new Error(`record_unread ${p}`)
    if ((h.rejected ?? []).some(r => r.gen === (h.gens ?? []).at(-1))) throw new Error(`record_unread ${p}`)
    for (const q of h.head?.rec?.cells ?? []) if (Array.isArray(q?.at)) out.add(q.at.join(','))
  }
  return out
}
/** (r2) how long the caller's veto keeps the other projects' cells: one read serves a plan's burst, never a visit. */
export const VETO_TTL_MS = 3_000
/**
 * (r2) THE CALLER'S VETO OVER THE OTHER RECORDS, READ FRESH -> { mayPlace(at), refresh() }. skills.mjs tempStandOf's whole rule,
 * here so the test drives the code the bots run. `zones` the protected boxes ([x0, y0, z0, x1, y1, z1] or { box }); `others()` ->
 * a Set of "x,y,z": every OTHER project's record cells, read now (otherCellsStrict; it may throw: mayPlace throws with it).
 * The answer -- the set, or (r3) the FAILURE: a read that threw throws again, never an empty set -- is kept for `ttlMs` on `now()`
 * and dropped by refresh() (every ask of a take-down's column: buildrun.mjs standDown `claims`).
 */
export function standVeto ({ zones = [], others = () => new Set(), now = () => Date.now(), ttlMs = VETO_TTL_MS } = {}) {
  let set = null, err = null, at = -Infinity
  const cells = () => {
    const t = now()
    if ((!set && !err) || !(t - at < ttlMs)) { set = null; err = null; at = t; try { set = others() } catch (e) { err = e ?? new Error('unread') } }
    if (err || !set) throw err ?? new Error('unread')
    return set
  }
  const inZone = ([x, y, z]) => (zones ?? []).some(zb => { const b = zb?.box ?? zb; return Array.isArray(b) && b.length >= 6 && x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5] })
  return { mayPlace: c => !inZone(c) && !cells().has(c.join(',')), refresh: () => { set = null; err = null } }
}
/**
 * WHAT A TAKE-DOWN MAY DIG NOW -> { dig: [[x, y, z]] highest first, adopted: [{ at, why }], held: [[x, y, z]] }. Pure.
 *   standing     the receipt's cells still reading its block, highest first (standStanding)
 *   ownerOf(at)  'mine' (the placement's own test still passes) | 'owned' (a record's cell now, or the caller's veto) | 'unknown'
 *   expired      the receipt is older than TEMPSTAND.ownMs;  covered(at)  a block stands on the cell that is not the stand's
 * Top first: an expired receipt adopts everything (`expired`); a stand with a block set on its top adopts everything (`built_on`);
 * an owned cell is adopted (`owned`) with every cell under it (`built_on`: nothing is dug from under a block that is somebody's);
 * from an unknown cell down nothing is dug and nothing adopted (`held`: asked again next visit).
 */
export function standClaims (standing = [], ownerOf = () => 'mine', { expired = false, covered = () => false } = {}) {
  const out = { dig: [], adopted: [], held: [] }
  if (!standing.length) return out
  if (expired) { out.adopted = standing.map(at => ({ at, why: 'expired' })); return out }
  if (covered(standing[0])) { out.adopted = standing.map(at => ({ at, why: 'built_on' })); return out }
  let mode = 'dig'
  for (const at of standing) {
    if (mode === 'held') { out.held.push(at); continue }
    if (mode === 'adopt') { out.adopted.push({ at, why: 'built_on' }); continue }
    const o = ownerOf(at)
    if (o === 'mine') out.dig.push(at)
    else if (o === 'owned') { out.adopted.push({ at, why: 'owned' }); mode = 'adopt' } else { out.held.push(at); mode = 'held' }
  }
  return out
}
/** IS A RECEIPT ANOTHER HOLDER'S RUNNING VISIT'S? -> bool. Pure: younger than `staleMs` and not this holder's own. */
export const standLive = (receipt, me, now, staleMs = TEMPSTAND.staleMs) => !!receipt && receipt.holder !== me && now - (Number(receipt.at) || 0) < staleMs
