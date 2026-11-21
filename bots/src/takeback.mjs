// TAKEBACK-01: A WALK TAKES BACK THE BLOCKS IT PLACED.
// Design: docs/reports/walking-mess-design-2026-11-12.md on main (Codex + Claude independent designs, reconciled).
//
// WHY (owner 11-12: "Walking must not place dirt or dig ground. Escapes undo what they placed. Even outside the town I want the
// same rules to apply."). Measured on the showcase, 12 h to 11-12 13:20Z (14 bots; `_place_town`): 1,772 blocks placed in the
// town and its margin by movement, 1,321 of them by the pathfinder's own scaffold (664 bursts, median 1 block, 90% four or fewer),
// and 75 of the 1,772 cells ever dug again. scaftown-01's +20 price is live and priced 74,826 of 90,689 walk searches in that
// window; a placing route was still chosen 585 times and the rest ran unpriced (budget cuts, capped searches, latched goals). A
// route preference does not remove what gets placed; this does.
//
// WHAT. Every block the pathfinder places for a walk gets a RECEIPT (placeaudit.mjs `onPlaced`: its cell, its block). Every walk
// (`bot.pathfinder.goto`, the one entry 58 call sites use) runs under a watcher: when a receipt is RIPE -- the bot has stood on the
// block and left its column (or 8 s passed unused), it is on the ground, out of water, and can still reach and see the block -- the
// watcher halts the walk (pathhalt.mjs), the bot digs its own block back, and the SAME goal is issued again. The caller sees one
// goto promise: it resolves or rejects exactly as the library's would, a little later.
//
// NEVER DUG (verdictFor): a cell that no longer holds the block placed (`adopted why=changed`), a cell with anything on top of it
// (`adopted why=built_on`: someone built on it, or a block that would fall), a cell the walk's own break prices protect
// (`adopted why=protected`: movements.exclusionAreasBreak -- the wells, the plan's cells, the zones, the shop's footprint), a cell
// with water or lava against it (`adopted why=liquid`: taken out, the liquid would run into the gap), a cell with a body on it
// (`deferred`), a block the bot cannot dig in 3 s (`left why=slow`). Never the bot's own column.
// NEVER WHILE A REFLEX HOLDS THE BODY (digtown's own context: an active reflex, or an arbiter holder that is not the running
// skill), never a walk a reflex issued (its frame on the stack) or one in a survival dig scope: survival first.
//
// NO NEW REFUSAL. Nothing a walk could do before is taken away: the placement still happens, the route is still walked. The
// bounds: at most 4 halts a goto and 12 a minute; a cell placed AGAIN within 2 minutes of being taken back is kept (`kept
// why=reuse`: the walk needs it); a take-back spends at most 6 s.
//
// A WALK THE CALLER GAVE UP IS NEVER WALKED AGAIN (review r1, both engines: Codex reproduced A -> null -> null -> A with the real
// library, whose goto rejects one timer turn AFTER it stops listening; Claude: chestWalk's timeout leaves the path alone when the
// goal is not its own, so no event ever told the take-back). Three rules:
//   1. THE FENCE. Only a walk handed to skills.mjs withTimeout is ever halted (`call.fenced`): its timer calls `call.giveUp()`
//      whatever the caller's own timeout handler then does. A goto nobody fenced is the library's own, as before.
//   2. EVERY ENDING BY SOMEONE ELSE is heard for the whole call, not from the halt on: a goal_updated for another goal (the
//      caller's haltPath, a new walk, a reflex's goal) and EVERY path_stop. Our own halt is excused exactly ONE goal_updated(null)
//      and nothing else (review r2, Codex, reproduced with the real library: a listener that set a reflex's goal INSIDE our
//      setGoal(null) was swallowed -- A -> null -> REFLEX -> A; and a stop() someone had pending is consumed by that same
//      setGoal's resetPath, which emits path_stop there and then: it is theirs, never ours).
//   3. THE WATCHER HALTS ONLY ITS OWN GOAL: `pathfinder.goal` must still be this call's goal, the call must be the newest goto,
//      and nobody may have ended it.
// After a take-back the goal is issued again only while none of that happened; otherwise the caller gets GoalChanged or
// PathStopped, exactly what the library would have given it.
//
// NOT IN THIS PIECE (the design's pieces 2-5): the escapes' pillars (reflex.mjs pillarOut, digStraightUp; skills surface,
// shaftAscend), walks issued by setGoal, dug ground put back, and a stair where a spot needs a block again and again.
// LEFT BEHIND (litter-01): a receipt that closes `left` is passed to `onLeft` -- litter.mjs hands the town's and the margin's to the
// cleanup crew with their cells. Nothing here changes what is dug.
// ROWS: `_takeback_mode` at install; `_takeback` per receipt closed; `_takeback_sum` every 10 minutes when anything happened.
// SWITCH: TAKEBACK=off|0|false|no -> not installed (the mode row says on=0).
//
// SCAFFOLD-01show (owner 11-20: "yes, fix it, fix the movement code and remove all the pillars natural and unnatural"). Measured on
// the showcase's 11-19 logs (15 bots, the live file to 18:18Z): 5,899 receipts noted, 2,217 dug, 1,943 LEFT `expired` (33%: the
// receipt ran out after 5 minutes with the block standing; at that moment the bot was within 8 blocks of it 253 times and within
// 32 another 479), and ~490 never closed at all (prune ran only when the next block was placed, and nothing closed the receipts a
// bot still held when it disconnected: no row, no hand-off). In pillars-01show's CoreProtect join those are the 481 `expired` and
// the 326 with no row. Four changes, none of them a new refusal:
//   1. CARRIED, NOT GIVEN UP. A receipt OUTSIDE the town and its margin past ttlMs, or past the open bound, is CARRIED
//      (`_takeback outcome=carried`) instead of closed: it stays open for carryMs (3 h), at most maxCarry, and any later walk of
//      this bot that passes it in reach takes it back exactly as a fresh one (`dug why=later`) -- ONLY WHILE THE BOT HAS WATCHED THE
//      CELL WITHOUT A BREAK (review r1, Codex and Claude, both reproduced: a cell unseen can hold a same-named replacement): a block
//      update at the cell to anything else closes it `adopted why=changed`, its chunk unloading closes it `left why=unwatched`.
//      ONE OWNER A CELL (review r1, Claude): a town or margin receipt that runs out is closed `left why=expired` and handed to
//      litter as before -- the keeper digs it with its own record checks -- never carried as well.
//   2. HANDED ON, ACROSS A RESTART. Every out-of-town receipt carried, left unwatched or left old goes on this bot's hand-off
//      file (`io.save`/`io.load`: features.mjs writes scafleft-<bot>.json in the pool's state directory, kept 24 h) for the
//      pillar survey (pillars-01show's pillarclean.json, a host merge that proves each cell by CoreProtect before it is listed).
//      The file is a LIST, never this bot's permission to dig: a reloaded entry is only kept on the file. final() carries every
//      open receipt (`carried why=ended`; in the town: `left why=expired`, litter's) instead of dropping it.
//   3. PRUNED ON A CLOCK (pruneMs): expiry is judged on time, not only when the next block is placed.
//   4. A WALK THAT STARTS ON ITS OWN TOWER COMES DOWN IT (ownTowerUnder, descentWanted): before the library walks, a fenced walk
//      whose bot stands on a FREE-STANDING tower of its own open receipts (no side of the top block a ledge, a wall or a rim: a
//      tower out of a hole or up a cliff is never dug from under the bot) and whose goal is not up there beside it digs the tower
//      from under its feet, one block a fall, onto the dry solid floor under it (`dug why=descend`), then takes back what is ripe
//      in reach (`pre`), then walks. The gather tower beside a felled trunk is the case (pillars-01show: Lumen 11-11 17:35Z).
// ROW PER WALK: `_takeback_walk placed= taken= later= descend= left= halts= capped= pre= fenced= profile= ms= end=` for every goto
// that placed or took back a block (left: this walk's blocks still standing at its end).
// What stays as it was: the escapes' walks and profiles (survival first: ascend, descend, deck, water and every walk a reflex
// issues keep their blocks), the halt bounds, the reuse bound, the verdicts.
import { Vec3 } from 'vec3'
import { haltPath } from './pathhalt.mjs'
import { withDigScope, currentDigScope } from './digtown.mjs'

export const TAKEBACK = Object.freeze({
  reach: 4.5, eye: 1.62, tickMs: 200, unusedMs: 8_000, ttlMs: 5 * 60_000, maxOpen: 64,
  haltsPerGoto: 4, haltsPerMin: 12, budgetMs: 6_000, digMsMax: 3_000, tries: 2, reuseMs: 120_000, minHealth: 10,
  sumMs: 600_000,
  // scaffold-01show: carried receipts (3 h, at most 256), the clock prune, the descent of a walk's own tower
  carryMs: 3 * 60 * 60_000, maxCarry: 256, pruneMs: 10_000, saveMs: 30_000, handKeepMs: 24 * 60 * 60_000, maxHanded: 512,
  descendMin: 2, descendMax: 24, descendMs: 8_000, descendNearR: 4, landMs: 1_500,
  litterZones: ['town', 'margin'],   // litter.mjs LITTER.zones: a receipt there that runs out is the cleanup crew's, never carried
  // the profiles whose scaffold is a WALK's (index.mjs): the escapes' profiles (ascend, descend, deck, water) keep theirs (piece 3)
  profiles: ['walk', 'composter_walk', 'gather', 'town_deposit_walk'],
})
/** THE SWITCH. Pure. */
export const takebackOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.TAKEBACK ?? '').trim())
const K = c => `${c[0]},${c[1]},${c[2]}`
const AIRY = n => n === 'air' || n === 'cave_air' || n === 'void_air'

/** The bot's feet cell from its position. Pure. */
export const feetOf = p => [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)]
/** Half a body's width: a player is 0.6 wide, so it rests on every column within 0.3 of its centre. */
export const HALF_BODY = 0.3
/** Does a body centred at pos overlap the cell's column (review r1, Codex: a bot centred at x 2.1 still stands on the block at x 1)?
 *  Pure. The edges count as clear: a body flush against the column does not rest on it. */
export function overlapsColumn (cell, pos, half = HALF_BODY) {
  return pos.x + half > cell[0] && pos.x - half < cell[0] + 1 && pos.z + half > cell[2] && pos.z - half < cell[2] + 1
}
/** Is the bot on or over the receipt's block (standing on it, or on a tower over it)? Pure. */
export const overCell = (cell, pos) => overlapsColumn(cell, pos) && pos.y >= cell[1] + 0.5
/** Is a world block a liquid, or holding one (a waterlogged stair or slab: review r1, Codex)? Pure over a prismarine block. */
export function holdsLiquid (b) {
  if (!b) return false
  if (/water|lava|bubble_column|kelp|seagrass/.test(String(b.name ?? ''))) return true
  if (b.isWaterlogged === true) return true
  let props = null
  try { props = typeof b.getProperties === 'function' ? b.getProperties() : (b.props ?? b._properties ?? null) } catch { props = null }
  return !!props && (props.waterlogged === true || props.waterlogged === 'true')
}
/** Eye to the block's centre within reach. Pure. */
export function inReach (cell, pos, T = TAKEBACK) {
  return Math.hypot(cell[0] + 0.5 - pos.x, cell[1] + 0.5 - (pos.y + T.eye), cell[2] + 0.5 - pos.z) <= T.reach
}
/** The four sides of a column. */
export const SIDES = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]])
/**
 * scaffold-01show: THE BOT'S OWN TOWER UNDER ITS FEET -> { cells: [[x, y, z], ...] top first, why }. Pure over `own(c)` (an open
 * receipt of this bot holds its block there), `solid(c)` (a block a body stands on) and `liquid(c)`. cells is empty unless:
 *   the block under the feet is the bot's own (why=not_own);
 *   NO side of that top block is solid (why=ledge): nothing to step onto at this height -- a tower out of a hole has the rim beside
 *     its top, one up a cliff has the cliff, a bridge has its next block; those are never dug from under the bot;
 *   the run of own blocks straight down is at least descendMin (why=short: from the ground the take-back reaches it anyway) and at
 *     most descendMax (why=tall: not started);
 *   the cell under the run is solid and dry (why=no_floor): the bot lands on it, one block a fall.
 */
export function ownTowerUnder (feet, { own = () => false, solid = () => false, liquid = () => false } = {}, T = TAKEBACK) {
  if (!Array.isArray(feet) || feet.length !== 3 || !feet.every(Number.isFinite)) return { cells: [], why: 'unread' }
  const top = [feet[0], feet[1] - 1, feet[2]]
  if (!own(top)) return { cells: [], why: 'not_own' }
  for (const [dx, dz] of SIDES) if (solid([top[0] + dx, top[1], top[2] + dz])) return { cells: [], why: 'ledge' }
  const cells = []
  let c = top
  while (own(c) && cells.length <= T.descendMax) { cells.push(c); c = [c[0], c[1] - 1, c[2]] }
  if (cells.length > T.descendMax) return { cells: [], why: 'tall' }
  if (!solid(c) || liquid(c)) return { cells: [], why: 'no_floor' }
  if (cells.length < T.descendMin) return { cells: [], why: 'short' }
  return { cells, why: 'tower' }
}
/** A goal's position -> { x, y, z } | null (y null when the goal names none: GoalNearXZ). Pure. */
export function goalPos (goal) {
  if (!goal || typeof goal !== 'object') return null
  const at = (goal.pos && typeof goal.pos === 'object') ? goal.pos : goal
  const x = Number(at.x), y = Number(at.y), z = Number(at.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return { x, y: Number.isFinite(y) ? y : null, z }
}
/**
 * scaffold-01show: DOES A WALK FROM THE TOP OF ITS OWN TOWER COME DOWN IT FIRST? -> bool. Pure. Not when the goal is unknown, nor
 * when it is up here beside the tower (within descendNearR, and at or above the top block, or with no height): the next log of the
 * same tree, a goal the walk would tower straight back up to (the reuse bound would keep that block anyway).
 */
export function descentWanted (goal, feet, T = TAKEBACK) {
  const g = goalPos(goal)
  if (!g || !Array.isArray(feet)) return false
  const near = Math.max(Math.abs(Math.floor(g.x) - feet[0]), Math.abs(Math.floor(g.z) - feet[2])) <= T.descendNearR
  if (near && (g.y == null || Math.floor(g.y) >= feet[1] - 1)) return false
  return true
}
/** The `_takeback_walk` row's detail. Pure. a: the walk's account; left: its blocks still open at its end. */
export function walkDetail (a, { left = 0, halts = 0, capped = false, pre = false, fenced = false, profile = '-', ms = 0, end = 'ok' } = {}) {
  return `placed=${a?.placed ?? 0} taken=${a?.taken ?? 0} later=${a?.later ?? 0} descend=${a?.descend ?? 0} left=${left} ` +
         `halts=${halts} capped=${capped ? 1 : 0} pre=${pre ? 1 : 0} fenced=${fenced ? 1 : 0} profile=${profile} ms=${Math.round(ms)} end=${end}`
}
/** A carried receipt -> its file entry. Pure. */
export const carryEntry = r => ({ at: r.cell.slice(0, 3), block: r.block, t: r.t, shape: String(r.shape ?? '-'), zone: r.zone ?? null })
/** A file entry -> a carried receipt, or null (malformed, or older than carryMs). Pure. */
export function carriedFrom (e, now, T = TAKEBACK) {
  if (!e || !Array.isArray(e.at) || e.at.length !== 3 || !e.at.every(Number.isInteger) || typeof e.block !== 'string' || !e.block || e.block === '?' || !Number.isFinite(e.t)) return null
  if (!(now - e.t <= T.carryMs)) return null
  return { cell: e.at.slice(0, 3), block: e.block, shape: String(e.shape ?? '-'), zone: e.zone ?? null, t: e.t, used: true, tries: 0, closed: false, carried: true }
}
/** IS A PLACEMENT ONE THIS PIECE TAKES BACK? -> bool. Pure. `rec` placeaudit's record of a placement that LANDED. */
export function receiptFor (rec, T = TAKEBACK) {
  return !!rec && rec.reason === 'pathfinder' && Array.isArray(rec.cell) && rec.cell.every(Number.isFinite) &&
    typeof rec.block === 'string' && rec.block !== '?' && T.profiles.includes(String(rec.profile))
}
/**
 * IS THE RECEIPT RIPE? -> bool. Pure. The bot has used the block (stood on or over it) or let it stand unused for unusedMs; no part
 * of its body is over that column any more (its footing is elsewhere); it is on the ground and out of water; the block is in reach.
 *   here { pos, feet, onGround, inWater }
 */
export function ripe (r, here, now, T = TAKEBACK) {
  if (!r || r.closed || !here?.pos || !here.feet) return false
  if (!(r.used || now - r.t >= T.unusedMs)) return false
  if (overlapsColumn(r.cell, here.pos)) return false
  if (!here.onGround || here.inWater) return false
  return inReach(r.cell, here.pos, T)
}
/**
 * WHAT TO DO WITH A RIPE RECEIPT -> { act: 'dig' | 'adopted' | 'deferred' | 'left', why }. Pure.
 *   name      the block in the cell now (null: unread);  above  the block over it
 *   body      a body stands on it;  priced  the walk's own break prices protect it;  liquid  water or lava touches it
 *   digMs     the dig's time with the tool in hand
 */
export function verdictFor (r, { name = null, above = null, body = false, priced = false, liquid = false, harvest = true, digMs = 0 } = {}, T = TAKEBACK) {
  if (name == null) return { act: 'deferred', why: 'unread' }
  if (name !== r.block) return { act: 'adopted', why: AIRY(name) ? 'gone' : 'changed' }
  if (above != null && !AIRY(above)) return { act: 'adopted', why: 'built_on' }
  if (above == null) return { act: 'deferred', why: 'unread' }
  if (priced) return { act: 'adopted', why: 'protected' }
  if (liquid) return { act: 'adopted', why: 'liquid' }
  if (body) return { act: 'deferred', why: 'body' }
  // a dig the held tool cannot harvest is one skills.mjs's dig watcher stops the WALK for (watchDigging): never started
  if (!harvest) return { act: 'left', why: 'no_tool' }
  if (!(digMs <= T.digMsMax)) return { act: 'left', why: 'slow' }
  return { act: 'dig', why: 'ripe' }
}
/** The order ripe receipts are taken in: the highest first (a tower comes down from its top), then the oldest. Pure. */
export const takeOrder = list => [...list].sort((a, b) => b.cell[1] - a.cell[1] || a.t - b.t)
/** May the watcher halt the walk now? -> bool. Pure. halts: this goto's count; recent: the halt times of the last minute. */
export function mayHalt ({ halts = 0, recent = [], now = 0, building = false, mining = false, survival = false, health = 20 } = {}, T = TAKEBACK) {
  if (building || mining || survival) return false
  if (!(health >= T.minHealth)) return false
  if (halts >= T.haltsPerGoto) return false
  return recent.filter(t => now - t < 60_000).length < T.haltsPerMin
}
/** Was this goto issued by an escape (a reflex's own walk)? -> bool. Pure. frames: the call stack's lines. */
export const issuedByEscape = frames => (frames ?? []).some(f => /\/src\/(reflex|escape|floodpocket|climbflood)\.mjs/.test(String(f)))
/** Does a reflex hold the body now? -> bool. Pure. ctx: digtown's context { reflex, holder, skill } (digtown.mjs digPurpose's rule). */
export const bodyHeld = ctx => !!(ctx && (ctx.reflex || (ctx.holder && ctx.holder !== ctx.skill)))
/** The `_takeback` row's detail. Pure. */
export function takebackDetail ({ outcome, why = '-', cell, block = '-', shape = '-', zone = null, age = 0, ms = null } = {}) {
  return `outcome=${outcome} why=${why} pos=${cell.join(',')} block=${block} shape=${shape} zone=${zone ?? 'out'} age_ms=${Math.round(age)}${ms == null ? '' : ` ms=${Math.round(ms)}`}`
}
export const emptySum = () => ({ noted: 0, halts: 0, ms: 0, by: {} })
/** The `_takeback_sum` row's detail. Pure. */
export function sumDetail (sum, windowS, open) {
  const rest = Object.entries(sum.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('; ')
  return `w=${windowS}s noted=${sum.noted} halts=${sum.halts} ms=${Math.round(sum.ms)} open=${open}${rest ? ` | ${rest}` : ''}`
}
const gotoError = name => Object.assign(new Error(name === 'PathStopped' ? 'Path was stopped before it could be completed! Thus, the desired goal was not reached.' : 'The goal was changed before it could be completed!'), { name })

/**
 * Install on one bot -> { note, state, final } | null (off, no pathfinder, or already installed). Never throws into the caller.
 *   emit(kind, status, detail)   one row;  now()  the clock;  timers  false in tests (no summary timer)
 *   onLeft(receipt, why)         litter-01: called for every receipt that closes `left` (expired, unseen, overflow, slow, no_tool)
 * `note(rec)` is placeaudit's `onPlaced`: a placement that landed.
 */
export function installTakeback (bot, { emit = () => {}, now = () => Date.now(), env = process.env, T = TAKEBACK, timers = true, onLeft = null, io = null } = {}) {
  const on = takebackOn(env)
  try { emit('takeback_mode', 'success', `phase=mode v=1 on=${on ? 1 : 0} reach=${T.reach} unused_ms=${T.unusedMs} halts=${T.haltsPerGoto}/${T.haltsPerMin} budget_ms=${T.budgetMs} reuse_ms=${T.reuseMs}`) } catch { /* telemetry */ }
  const pf = bot?.pathfinder
  if (!on || !pf || typeof pf.goto !== 'function' || pf.goto.__takeback) return null
  const st = { open: [], busy: false, digger: null, owner: null, recent: [], taken: new Map(), sum: emptySum(), winStart: now(), closed: false, dirty: false, handed: new Map() }
  const row = (r, outcome, why, ms = null) => {
    r.closed = true
    // scaffold-01show: a block gone, changed or dug is off the hand-off file
    if ((outcome === 'dug' || outcome === 'adopted') && st.handed.delete(K(r.cell))) st.dirty = true
    // scaffold-01show: the walk that took it (st.digger during a take-back) counts it on its `_takeback_walk` row
    if (outcome === 'dug' && st.digger?.acct) { st.digger.acct.taken++; if (r.carried || r.call !== st.digger) st.digger.acct.later++; if (why === 'descend') st.digger.acct.descend++ }
    st.sum.by[outcome] = (st.sum.by[outcome] ?? 0) + 1
    try { emit('takeback', outcome === 'dug' ? 'success' : outcome === 'failed' ? 'failed' : 'no_effect', takebackDetail({ outcome, why, cell: r.cell, block: r.block, shape: r.shape, zone: r.zone, age: now() - r.t, ms })) } catch { /* telemetry */ }
    // litter-01 (`onLeft`): a receipt that closes `left` is handed on with its cell and its block (litter.mjs: the cleanup crew's)
    if (outcome === 'left') {
      handOff(r, why === 'unwatched' ? 'expired' : why)            // unwatched: still standing where the bot left it, as far as it knows
      if (!T.litterZones.includes(String(r.zone))) hand(r)         // scaffold-01show: outside the town, on the hand-off file
    }
  }
  // ONE hand-off for a receipt closed `left` and for one carried (scaffold-01show): litter takes the town's and the margin's
  const handOff = (r, why) => { if (onLeft) { try { onLeft(r, why) } catch { /* the hand-off never breaks a walk */ } } }
  // scaffold-01show: CARRIED, NOT GIVEN UP (header 1). ONE OWNER A CELL (review r1, both engines): a town or margin receipt that
  // runs out is litter's, closed `left` as before (the keeper digs it with its record checks); one outside them is carried --
  // open, for any later walk in reach, ONLY while this bot has watched its cell without a break (a block update there or its chunk
  // unloading closes it: watch below) -- and it goes on the hand-off file.
  const hand = r => {
    st.handed.set(K(r.cell), carryEntry(r)); st.dirty = true
    if (st.handed.size > T.maxHanded) { const [k] = st.handed.keys(); st.handed.delete(k) }
  }
  const carry = (r, why) => {
    if (r.closed || r.carried) return
    if (T.litterZones.includes(String(r.zone))) { row(r, 'left', why === 'overflow' ? 'overflow' : 'expired'); return }
    r.carried = true; r.used = true
    hand(r)
    st.sum.by.carried = (st.sum.by.carried ?? 0) + 1
    try { emit('takeback', 'no_effect', takebackDetail({ outcome: 'carried', why, cell: r.cell, block: r.block, shape: r.shape, zone: r.zone, age: now() - r.t })) } catch { /* telemetry */ }
  }
  const prune = () => {
    const t = now()
    for (const r of st.open) {
      if (r.closed) continue
      if (r.changed) row(r, 'adopted', 'changed')                   // seen to change since it was placed: never ours again
      else if (r.unwatched) row(r, 'left', 'unwatched')             // its chunk unloaded: what happened there is unseen
      else if (!r.carried && t - r.t > T.ttlMs) carry(r, 'expired')
      else if (r.carried && t - r.t > T.carryMs) row(r, 'left', 'old')
    }
    for (const [k, e] of st.handed) if (!(t - e.t <= T.handKeepMs)) { st.handed.delete(k); st.dirty = true }
    st.open = st.open.filter(r => !r.closed)
    const fresh = st.open.filter(r => !r.carried)
    while (fresh.length > T.maxOpen) carry(fresh.shift(), 'overflow')
    const kept = st.open.filter(r => r.carried)
    while (kept.length > T.maxCarry) row(kept.shift(), 'left', 'overflow')
    st.open = st.open.filter(r => !r.closed)
    for (const [k, at] of st.taken) if (t - at > T.reuseMs) st.taken.delete(k)
  }
  // the hand-off file: what this bot left outside the town (carried, unwatched, old) -- a LIST for the pillar survey, which proves
  // each cell by CoreProtect before it is dug; never this bot's permission to dig (review r1: a cell unseen may hold a replacement)
  const persist = (sync = false) => {
    if (!st.dirty || !io || typeof io.save !== 'function') return
    st.dirty = false
    try { io.save([...st.handed.values()], { sync }) } catch { st.dirty = true }
  }
  // scaffold-01show: the list kept before a restart stays on the file (header 2); nothing in it is dug by this bot
  if (io && typeof io.load === 'function') {
    try { for (const e of io.load() ?? []) { const r = carriedFrom(e, now(), { ...T, carryMs: T.handKeepMs }); if (r) st.handed.set(K(r.cell), carryEntry(r)) } } catch { /* an unreadable file hands nothing */ }
  }
  // WATCHED WITHOUT A BREAK (review r1): any block update at a receipt's cell that is not its block, and its chunk unloading, end
  // the receipt's claim; prune closes it (`adopted why=changed`, `left why=unwatched`). A take-back's own dig sets `changed` after
  // its row is written, which is harmless (closed already).
  const onBlock = (_o, n) => {
    try {
      const p = n?.position
      if (!p) return
      for (const r of st.open) if (!r.closed && r.cell[0] === p.x && r.cell[1] === p.y && r.cell[2] === p.z && n.name !== r.block) r.changed = true
    } catch { /* a watch never breaks a bot */ }
  }
  const onUnload = corner => {
    try {
      const cx = Math.floor(Number(corner?.x) / 16), cz = Math.floor(Number(corner?.z) / 16)
      for (const r of st.open) if (!r.closed && Math.floor(r.cell[0] / 16) === cx && Math.floor(r.cell[2] / 16) === cz) r.unwatched = true
    } catch { /* a watch never breaks a bot */ }
  }
  if (typeof bot.on === 'function') { bot.on('blockUpdate', onBlock); bot.on('chunkColumnUnload', onUnload) }
  const note = rec => {
    try {
      if (st.closed || !receiptFor(rec, T)) return
      const r = { cell: rec.cell.slice(), block: rec.block, shape: rec.shape ?? '-', zone: rec.zone ?? null, t: now(), used: false, tries: 0, closed: false }
      st.sum.noted++
      if (st.owner?.acct) { r.call = st.owner; st.owner.acct.placed++ }   // scaffold-01show: the walk that placed it (its row)
      // placed again where it was just taken back: this walk needs it there (the loop's bound)
      if (st.taken.has(K(r.cell))) { st.taken.delete(K(r.cell)); row(r, 'kept', 'reuse'); return }
      st.open = st.open.filter(o => K(o.cell) !== K(r.cell))
      st.open.push(r)
      prune()
    } catch { /* a receipt never breaks a placement */ }
  }
  const here = () => {
    const e = bot.entity
    if (!e?.position) return null
    return { pos: e.position, feet: feetOf(e.position), onGround: !!e.onGround, inWater: !!e.isInWater }
  }
  const blockAt = c => { try { return bot.blockAt(new Vec3(c[0], c[1], c[2])) } catch { return null } }
  // scaffold-01show: IN SIGHT, OR A BARE TOP IN REACH (measured in the rig, sandbox2 11-21, traced every 200 ms: a tower's stub one
  // block down a 1x1 pit and a tower's top one block under a cliff's edge were RIPE and in reach and never taken -- canSeeBlock aims
  // at the block's centre, and the rim or the cliff's edge is in that ray, and in every ray to its faces, from where the walk
  // passes). The server takes a dig it can reach (vanilla and Paper check the interaction range, never the sight line), and a
  // block with anything on top is refused by the verdict (built_on). So: the centre in sight, as before, or the cell over it air.
  const sees = b => {
    try {
      if (typeof bot.canSeeBlock !== 'function' || bot.canSeeBlock(b)) return true
      if (!b?.position) return false
      const up = blockAt([b.position.x, b.position.y + 1, b.position.z])
      return !!up && AIRY(up.name)
    } catch { return false }
  }
  const bodyOn = c => {
    for (const e of Object.values(bot.entities ?? {})) {
      const p = e?.position
      if (!p || e === bot.entity) continue
      if (overlapsColumn(c, p, Math.max(HALF_BODY, (Number(e.width) || 0) / 2)) && p.y >= c[1] + 0.5 && p.y <= c[1] + 3) return true
    }
    return false
  }
  const priced = b => {
    for (const fn of pf.movements?.exclusionAreasBreak ?? []) { try { if (fn(b) > 0) return true } catch { return true } }
    return false
  }
  const ripeNow = h => takeOrder(st.open.filter(r => ripe(r, h, now(), T)))
  const held = () => { try { return bodyHeld(bot.__digContext?.()) } catch { return false } }
  const wet = c => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]].some(d => holdsLiquid(blockAt([c[0] + d[0], c[1] + d[1], c[2] + d[2]])))
  const mark = h => { for (const r of st.open) if (!r.used && overCell(r.cell, h.pos)) r.used = true }

  /** One ripe receipt: closed with its row, or left open for a later pass. -> true when it took a turn (a dig or a closing). */
  const closeOne = async (r, ext) => {
    if (r.changed || r.unwatched) { row(r, r.changed ? 'adopted' : 'left', r.changed ? 'changed' : 'unwatched'); return true }   // scaffold-01show
    const b = blockAt(r.cell)
    if (b && r.block === b.name && !sees(b)) { r.tries++; if (r.tries > T.tries) row(r, 'left', 'unseen'); return false }
    const up = blockAt([r.cell[0], r.cell[1] + 1, r.cell[2]])
    let digMs = 0, harvest = true
    if (b && b.name === r.block) {
      try { const tool = pf.bestHarvestTool?.(b) ?? null; if (tool) await bot.equip(tool, 'hand') } catch { /* by hand */ }
      try { digMs = Number(bot.digTime?.(b)) || 0 } catch { digMs = 0 }
      try { if (typeof b.canHarvest === 'function') harvest = !!b.canHarvest(bot.heldItem ? bot.heldItem.type : null) } catch { harvest = true }
    }
    const v = verdictFor(r, { name: b?.name ?? null, above: up?.name ?? null, body: bodyOn(r.cell), priced: !!b && priced(b), liquid: wet(r.cell), harvest, digMs }, T)
    if (v.act === 'deferred') { r.tries++; if (r.tries > T.tries) row(r, 'deferred', v.why); return false }
    if (v.act !== 'dig') { row(r, v.act, v.why); return true }
    if (ext()) return false
    // review r2 (Codex, reproduced): the equip above awaited -- the cell may have changed meanwhile; judged again at the dig
    if (r.changed || r.unwatched || blockAt(r.cell)?.name !== r.block) { row(r, r.unwatched ? 'left' : 'adopted', r.unwatched ? 'unwatched' : 'changed'); return true }
    const t0 = now()
    try {
      await withDigScope(bot, { purpose: 'takeback', by: 'takeback' }, () => bot.dig(b))
      const after = blockAt(r.cell)
      if (after && AIRY(after.name)) { st.taken.set(K(r.cell), now()); row(r, 'dug', r.carried ? 'later' : 'ripe', now() - t0) } else { r.tries++; if (r.tries > T.tries) row(r, 'failed', 'still_there', now() - t0) }
    } catch (e) {
      r.tries++
      if (!ext() && r.tries > T.tries) row(r, 'failed', String(e?.message ?? e).replace(/\s+/g, '_').slice(0, 40), now() - t0)
    }
    return true
  }
  /** Take back what is ripe for one call. Ends at once when someone else ends the walk (call.gone) or a newer goto owns the body. */
  const takeBack = async call => {
    const t0 = now()
    st.busy = true; st.digger = call
    try {
      for (let guard = 0; guard < T.maxOpen && !call.gone && st.owner === call && now() - t0 < T.budgetMs; guard++) {
        const h = here()
        if (!h || held() || !((bot.health ?? 20) >= T.minHealth)) break
        const next = ripeNow(h).find(r => !r.skip)
        if (!next) break
        if (!(await closeOne(next, () => !!call.gone || st.owner !== call || held()))) next.skip = true
      }
    } catch { /* a take-back never breaks a walk */ } finally {
      for (const r of st.open) delete r.skip
      st.busy = false; st.digger = null; st.sum.ms += now() - t0
      prune()
    }
  }
  /** scaffold-01show (header 4): dig the bot's own free-standing tower from under its feet, top first, one block a fall. -> blocks dug. */
  const solidAt = c => { const b = blockAt(c); return !!b && b.boundingBox === 'block' && !holdsLiquid(b) }
  const ownAt = c => { const b = blockAt(c); return !!b && st.open.some(r => !r.closed && !r.changed && !r.unwatched && r.cell[0] === c[0] && r.cell[1] === c[1] && r.cell[2] === c[2] && r.block === b.name) }
  const descend = async (call, cells) => {
    const t0 = now()
    let n = 0
    st.busy = true; st.digger = call
    try {
      for (const c of cells) {
        if (call.gone || st.owner !== call || held() || now() - t0 > T.descendMs || !((bot.health ?? 20) >= T.minHealth)) break
        const h = here()
        if (!h || !h.onGround || h.inWater || h.feet[1] !== c[1] + 1 || !overlapsColumn(c, h.pos)) break   // still standing on this one
        const r = st.open.find(o => !o.closed && !o.changed && !o.unwatched && K(o.cell) === K(c))
        const b = blockAt(c)
        if (!r || !b || b.name !== r.block || priced(b) || wet(c) || bodyOn(c)) break
        try { const tool = pf.bestHarvestTool?.(b) ?? null; if (tool) await bot.equip(tool, 'hand') } catch { /* by hand */ }
        let digMs = 0, harvest = true
        try { digMs = Number(bot.digTime?.(b)) || 0 } catch { digMs = 0 }
        try { if (typeof b.canHarvest === 'function') harvest = !!b.canHarvest(bot.heldItem ? bot.heldItem.type : null) } catch { harvest = true }
        if (!harvest || !(digMs <= T.digMsMax)) break
        if (r.changed || r.unwatched || blockAt(c)?.name !== r.block) break   // review r2: judged again after the equip's await
        await withDigScope(bot, { purpose: 'takeback', by: 'takeback' }, () => bot.dig(b))
        const after = blockAt(c)
        if (!after || !AIRY(after.name)) break
        st.taken.set(K(c), now()); row(r, 'dug', 'descend'); n++
        // landed one block lower before the next (a body still falling is never dug under)
        const l0 = now()
        for (;;) {
          const q = here()
          if (q && q.onGround && q.feet[1] === c[1]) break
          if (now() - l0 > T.landMs) return n
          await new Promise(res => setTimeout(res, 25))
        }
      }
    } catch { /* a descent never breaks a walk */ } finally { st.busy = false; st.digger = null; st.sum.ms += now() - t0 }
    return n
  }
  /** scaffold-01show: BEFORE THE LIBRARY WALKS (a fenced walk, nobody else's path under way): come down its own tower, then take back
   *  what is ripe in reach. Same guards as a halt (mayHalt: building, mining, survival, health, the halt bounds count it as one). */
  const preWanted = () => {
    try {
      const p = bot.entity?.position
      if (!p) return false
      for (const r of st.open) if (!r.closed && Math.hypot(r.cell[0] + 0.5 - p.x, r.cell[1] + 0.5 - p.y, r.cell[2] + 0.5 - p.z) <= T.reach + 2) return true
    } catch { /* no pass */ }
    return false
  }
  const preWalk = async (call, goal) => {
    if (!call.fenced || call.gone || st.owner !== call || st.busy || call.escape) return
    if (!T.profiles.includes(String(bot.movementProfile ?? 'walk'))) return
    if (pf.goal != null || pf.isMoving?.()) return
    const survival = currentDigScope()?.purpose === 'survival'
    if (!mayHalt({ halts: call.n, recent: st.recent, now: now(), building: !!pf.isBuilding?.(), mining: !!pf.isMining?.(), survival: held() || survival, health: bot.health ?? 20 }, T)) return
    const h = here()
    if (!h || !h.onGround || h.inWater) return
    let did = false
    if (descentWanted(goal, h.feet, T)) {
      const tw = ownTowerUnder(h.feet, { own: ownAt, solid: solidAt, liquid: c => holdsLiquid(blockAt(c)) }, T)
      if (tw.cells.length) { did = true; await descend(call, tw.cells) }
    }
    const h2 = here()
    if (h2 && !call.gone && st.owner === call && ripeNow(h2).length) { did = true; await takeBack(call) }
    if (did) { call.pre = true; call.n++; st.sum.halts++; st.recent = [...st.recent.filter(t => now() - t < 60_000), now()] }
  }
  const watch = (call, goal) => {
    const survival = call.escape || currentDigScope()?.purpose === 'survival'
    const iv = setInterval(() => {
      try {
        const h = here()
        if (!h) return
        mark(h)
        // only a fenced walk (rule 1), only while it is still the newest goto and nobody ended it (rule 2), only its own goal (rule 3)
        if (call.due || st.busy || !call.fenced || call.gone || st.owner !== call || pf.goal !== goal) return
        if (!T.profiles.includes(String(bot.movementProfile ?? 'walk'))) return
        if (!mayHalt({ halts: call.n, recent: st.recent, now: now(), building: !!pf.isBuilding?.(), mining: !!pf.isMining?.(), survival: survival || held(), health: bot.health ?? 20 }, T)) return
        const due = ripeNow(h).find(r => { const b = blockAt(r.cell); return !b || b.name !== r.block || sees(b) })
        if (!due) return
        call.n++; st.sum.halts++; st.recent = [...st.recent.filter(t => now() - t < 60_000), now()]
        call.due = true
        // our own halt: ONE goal_updated(null), emitted synchronously inside setGoal, is the one ending that is not someone else's
        call.own = 1
        try { haltPath(bot) } finally { call.own = 0 }
      } catch { /* the watcher never breaks a walk */ }
    }, T.tickMs)
    iv.unref?.()
    return () => clearInterval(iv)
  }
  const orig = pf.goto
  const run = async (self, call, goal, rest) => {
    // heard for the WHOLE call (rule 2): the library's own setGoal(goal) at each issue names this goal and is not an ending
    const onGoal = ng => {
      if (call.own > 0 && ng === null) { call.own--; return }       // exactly one: a nested setGoal or haltPath inside it still counts
      if (ng !== goal) call.giveUp('GoalChanged')
    }
    const onStop = () => call.giveUp('PathStopped')                 // never ours: pathhalt never stops, so this is a stop() of someone else's
    bot.on('goal_updated', onGoal); bot.on('path_stop', onStop)
    let end = 'ok'
    try {
      // scaffold-01show: withTimeout fences the promise just after goto returns it; one turn later the pre-walk pass may run. Only
      // when one of this bot's blocks is near (preWanted): every other goto reaches the library synchronously, exactly as before.
      if (!held() && preWanted()) {
        call.deferring = true
        try {
          await null
          try { await preWalk(call, goal) } catch { /* the pass never breaks a walk */ }
        } finally { call.deferring = false }
        // review r1 (both engines): a newer goto, or a reflex that took the body meanwhile, wins -- as the library's own setGoal would
        if (call.gone) throw gotoError(call.gone)
        if (st.owner !== call || held()) throw gotoError('GoalChanged')
      }
      for (;;) {
        call.due = false
        const stop = watch(call, goal)
        let err = null, res
        try { res = await orig.call(self, goal, ...rest) } catch (e) { err = e; end = String(e?.name ?? 'error') } finally { stop() }
        if (!call.due) { if (err) throw err; end = 'ok'; return res }
        call.due = false
        await takeBack(call)
        if (!err) return res                                        // it arrived as the halt landed: nothing to walk on to
        if (call.gone) throw gotoError(call.gone)                   // the caller ended the walk meanwhile: its own error
        if (st.owner !== call) throw gotoError('GoalChanged')       // a newer goto owns the body
      }
    } catch (e) { end = String(e?.name ?? 'error'); throw e } finally {
      bot.removeListener('goal_updated', onGoal); bot.removeListener('path_stop', onStop)
      if (st.owner === call) st.owner = null
      // scaffold-01show: ONE ROW PER WALK that placed or took back a block
      try {
        if (call.acct.placed || call.acct.taken) {
          const left = st.open.filter(r => r.call === call && !r.closed).length
          emit('takeback_walk', 'success', walkDetail(call.acct, { left, halts: call.n, capped: call.n >= T.haltsPerGoto, pre: !!call.pre, fenced: !!call.fenced, profile: String(bot.movementProfile ?? '-'), ms: now() - call.t0, end }))
        }
      } catch { /* telemetry */ }
    }
  }
  const wrapped = function (goal, ...rest) {
    if (st.closed) return orig.call(this, goal, ...rest)
    const call = { n: 0, due: false, own: 0, gone: null, fenced: false, escape: false, pre: false, t0: now(), acct: { placed: 0, taken: 0, later: 0, descend: 0 } }
    // THE CALLER GAVE UP (skills.mjs withTimeout's timer; the listeners above): never walked again, a dig under way is stopped
    call.giveUp = why => { call.gone ??= (why === 'PathStopped' ? 'PathStopped' : 'GoalChanged'); try { if (st.busy && st.digger === call) bot.stopDigging?.() } catch { /* not digging */ } }
    try { call.escape = issuedByEscape(String(new Error().stack ?? '').split('\n').slice(1, 8)) } catch { /* unknown: a walk */ }
    // review r1: a goto still deferred (its pre-walk pass) is ended by a newer one, exactly as the library's setGoal ends a walk
    try { if (st.owner && st.owner !== call && st.owner.deferring) st.owner.giveUp('GoalChanged') } catch { /* never breaks a goto */ }
    st.owner = call                                                 // the newest goto is the one walk that is watched
    const p = run(this, call, goal, rest)
    p.__takeback = call                                             // withTimeout fences it (rule 1)
    return p
  }
  wrapped.__takeback = true
  pf.goto = wrapped
  const flush = () => {
    if (!st.sum.noted && !st.sum.halts && !Object.keys(st.sum.by).length) { st.winStart = now(); return }
    try { emit('takeback_sum', 'success', sumDetail(st.sum, Math.round((now() - st.winStart) / 1000), st.open.length)) } catch { /* telemetry */ }
    st.sum = emptySum(); st.winStart = now()
  }
  let timer = null, pruner = null, lastSave = now()
  if (timers) {
    timer = setInterval(flush, T.sumMs); timer.unref?.()
    // scaffold-01show (header 3): expiry on the clock, and the carried file written at most every saveMs
    pruner = setInterval(() => { try { if (!st.busy) prune(); if (now() - lastSave >= T.saveMs) { lastSave = now(); persist() } } catch { /* a tick never breaks a bot */ } }, T.pruneMs)
    pruner.unref?.()
  }
  // scaffold-01show: a bot that ends carries what it still holds (`carried why=ended`), into its file, instead of dropping it
  const final = () => {
    if (st.closed) return
    try { for (const r of st.open) if (!r.closed && !r.carried) carry(r, 'ended'); prune(); persist(true) } catch { /* telemetry */ }
    flush(); st.closed = true; if (timer) clearInterval(timer); if (pruner) clearInterval(pruner)
    try { bot.removeListener?.('blockUpdate', onBlock); bot.removeListener?.('chunkColumnUnload', onUnload) } catch { /* gone */ }
  }
  return { note, state: st, flush, final, takeBack, prune, persist }
}
