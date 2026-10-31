// COAL AS A FIRST-CLASS RESOURCE (coalfirst-01; OWNER 2026-10-29: "Add Coal to the list of things that can be picked up, mined
// and deposited").
//
// MEASURED on the showcase 10-29 (24 h, 10 bots): no mine or gather targeted coal; ~39 coal a day arrived only as incidental
// pickups while mining stone at y 50-54. Bots holding raw iron kept ALL their coal (towndeposit.mjs ironKeeps kept the fuel
// stack WHOLE: the deposit moves whole stacks) and burned it in their own smelts (net -38 a day), so the town held 0 coal and
// smelt_town ended "no coal" 42 of 46 times -- the toolkits then had no ingots. The owner decided 10-19 that coal and iron get
// banked in town (cobblekeep-01).
//
// THE THREE DECISIONS, each a pure function here or beside its caller, each with behaviour tests (test/coalrun.test.mjs):
//   1. PICKUP: coal was never on a skip list; the test pins that (hygiene NEVER_KEEP, bankable NEVER_BANKABLE, the well's list
//      and its NEVER_DISPOSE guard, the rows' allowance, notForChest).
//   2. MINE: coal_ore / deepslate_coal_ore tunnel like iron (oretunnel.mjs tunnelKindsFor: the same planner, break veto, lava
//      guard, pickaxe budget, home rule), and THE COAL RUN below is a deterministic order -- gather the coal ore in reach when
//      the town index shows the town short of coal -- not a hope the model picks it.
//   3. DEPOSIT: a bot with its own smelt keeps COAL_KEEP coal, not the whole stack (towndeposit.mjs ironKeeps via coalKeepOf),
//      and the stack above the keep is SPLIT (the log half-split, logbank-01) so the spare reaches a town chest; the not-full
//      visit's tail banks coal above the keep too.
//
// KILL SWITCH: COALFIRST=off restores every rule exactly (no coal run, coal kept whole, no coal tunnel, no coal in the tail).
// Leaf module: imports nothing of ours (towndeposit.mjs and oretunnel.mjs import it).

const v = String((typeof process !== 'undefined' ? process.env?.COALFIRST : '') ?? '').trim().toLowerCase()
export const COALFIRST = Object.freeze({ on: !['off', '0', 'false', 'no'].includes(v) })

/** The blocks that drop coal (vanilla 1.21: both drop 1 coal, more with fortune). */
export const COAL_KINDS = Object.freeze(['coal_ore', 'deepslate_coal_ore'])
/** The town is SHORT of coal below this many in its indexed containers: four smelt_town jobs' worth is 4, a day of the town's
 *  furnaces (owner 10-19 "smelt with coal": every job burns one coal per 8 items) is ~20-30. 32 is half a stack. */
export const COAL_FLOOR = 32
/** What a bot keeps of its own coal while it has something of its own to smelt: 8 coal smelts 64 items, and the bag's own
 *  smelts are the iron keep (towndeposit.mjs IRON_KEEP: 3 units per iron craft not yet made, at most 9 -> 2 coal). The
 *  not-full visit's tail moves coal only from a bag holding more than this (no churn of a handful). */
export const COAL_KEEP = 8
/** The run's ask: gather's `count`. A coal vein is 1-17 blocks (vanilla ore_coal size 17); the tunnel takes one cluster. */
export const COAL_RUN_COUNT = 16
/** No run while the bag already carries this much coal: that coal goes to town first (the town deposit banks it). */
export const COAL_RUN_CARRY = 16
/** Free slots a run needs: the coal, and the cobble a tunnel yields (~2.4 a block of depth: oretunnel's ROOM FIRST is 2). */
export const COAL_RUN_MIN_FREE = 3
/** Charged at ISSUE: at most one coal run per bot per 10 min, whatever happens to it. */
export const COAL_RUN_COOLDOWN_MS = 10 * 60 * 1000
/** A run that failed or brought no coal backs off this long (the same ore is probably still out of reach). */
export const COAL_RUN_BACKOFF_MS = 30 * 60 * 1000
/** The world scan for coal ore at most this often per bot (the index read is a cached fold; the scan is findBlocks). */
export const COAL_RUN_SCAN_MS = 60 * 1000
/** The ore must be this close (3D) -- oretunnel.mjs CANDIDATE_RADIUS, the tunnel's own search (a test asserts equality). */
export const COAL_ORE_RADIUS = 24

const lazy = x => (typeof x === 'function' ? x() : x)

/**
 * THE TOWN'S COAL IN ITS INDEX -> { total, containers, withCoal }. Pure over townindex.mjs readIndex's `entries`. Every
 * container's LATEST observation counts, whatever its age or state: the total is what the town's chests last showed, a
 * lower bound while a container is unknown. Only `coal` (charcoal is not the town job's fuel: smeltjob.mjs JOB_FUELS).
 */
export function townCoalTotal (entries = null) {
  let total = 0, containers = 0, withCoal = 0
  for (const e of Object.values(entries && typeof entries === 'object' ? entries : {})) {
    if (!e?.obs) continue
    containers++
    const n = Math.max(0, Number(e.obs.names?.coal?.[0]) || 0)
    total += n
    if (n > 0) withCoal++
  }
  return { total, containers, withCoal }
}

/**
 * THE BAG'S COAL KEEP -> n. Pure. With something of its own to smelt (`toSmelt` > 0: the raw iron or ore the iron keep keeps,
 * or the active rung's wanted smelt) the bot keeps COAL_KEEP of its coal -- never more than it holds (OWNER 10-29: "a small
 * allowance for its own tool/smelt needs"); with nothing to smelt it keeps none (cobblekeep-01's rule, unchanged: the
 * showcase's coal is a few incidental pieces per bot, and every one of them is the town's). COALFIRST off: the whole stack
 * while it smelts (the base).
 */
export function coalKeepOf (held = 0, toSmelt = 0, { on = COALFIRST.on } = {}) {
  const h = Math.max(0, Math.floor(Number(held) || 0))
  if (!(Number(toSmelt) > 0)) return 0
  return on ? Math.min(h, COAL_KEEP) : h
}

/**
 * THE COAL RUN -> { order, state, skip }. Pure; cognitive.mjs supplies the readings and keeps `state`.
 *   on, shared   COALFIRST and the town smelt job's own switch (smeltjob.mjs smeltJobEnabled: off in an isolated pool and by
 *                SMELT_JOB=0) -- the run exists to feed the town's smelt jobs and toolkits
 *   holds        a milestone step is ready (smeltjob.mjs milestoneHolds): it always wins
 *   heldCoal     the bag's coal
 *   freeSlots    36 - occupied slots
 *   tripPick     a stone-or-better pickaxe that can pay a trip (oretunnel.mjs hasTripPickaxe)
 *   townCoal     lazy -> { ok, total, containers, site } (skills.mjs townCoalStock: the town index; `site` { ok, hit } is where
 *                the bot stands against the projects' records, coalsite-01: not ok -> refused, a hit -> refused)
 *   ore          lazy -> { block, dist } | null: the nearest coal ore within COAL_ORE_RADIUS, off the home floor
 *   state        { lastIssuedAt, backoffUntil, lastScanAt }
 * Cheap tests first; the two readings are taken only when everything else would issue, and at most once per
 * COAL_RUN_SCAN_MS. `skip` names why nothing was issued (the read's denominator; never a refusal: every other move stays).
 * The order is `gather` of the ore kind in reach: gather's own guards (town ground, keep-out, the break veto, the lava
 * guard, the six-face check, the tunnel's pickaxe budget and home rule) decide every block, exactly as for the model's gather.
 */
export function coalRunOrder ({ now = 0, on = COALFIRST.on, shared = true, holds = false, heldCoal = 0, freeSlots = 0, tripPick = false,
                                townCoal = null, ore = null, state = {} } = {}) {
  const s = { ...state }
  const skip = why => ({ order: null, state: s, skip: why })
  if (!on) return skip('off')
  if (!shared) return skip('isolated')
  if (holds) return skip('milestone')
  if (now - (s.lastIssuedAt ?? -Infinity) < COAL_RUN_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return skip('cooldown')
  if ((Number(heldCoal) || 0) >= COAL_RUN_CARRY) return skip('carrying')
  if ((Number(freeSlots) || 0) < COAL_RUN_MIN_FREE) return skip('room')
  if (!tripPick) return skip('pickaxe')
  if (now - (s.lastScanAt ?? -Infinity) < COAL_RUN_SCAN_MS) return skip('scan')
  s.lastScanAt = now
  const t = lazy(townCoal)
  // FAIL CLOSED: an unreadable or empty index says nothing about the town's coal, and a town with no indexed container has
  // nowhere to bank it -- the model may still choose coal itself
  if (!t?.ok) return skip('index')
  if (!((Number(t.containers) || 0) > 0)) return skip('index_empty')
  if ((Number(t.total) || 0) >= COAL_FLOOR) return skip('stocked')
  // coalsite-01: NEVER FROM A TOWN PROJECT'S SITE (LIVE showcase 10-30 10:15Z: a run issued from inside the ziggurat's foundation
  // walked into its hollow, walled the bot in, and the escape dug two foundation cells; the repair then stalled on cells no stand
  // reached). FAIL CLOSED: a site that could not be read says nothing about where the bot stands
  if (t.site?.ok !== true) return skip('site_unknown')
  if (t.site.hit) return skip('on_site')
  const o = lazy(ore)
  if (!o?.block || !COAL_KINDS.includes(o.block)) return skip('no_ore')
  s.lastIssuedAt = now
  s.issuedHeld = Math.max(0, Number(heldCoal) || 0)
  return { order: { skill: 'gather', args: { block: o.block, count: COAL_RUN_COUNT, coalrun: true },
                    why: `the town's chests hold ${t.total} coal (< ${COAL_FLOOR}) and its smelt jobs burn coal only; ` +
                         `${o.block} ${Math.round(Number(o.dist) || 0)} blocks away -- mining it for the town` },
           state: s, skip: null }
}

/** coalsite-01: how far round a project's record box the run is refused (shop.mjs recordZones' margin; the paths' and the wall's
 *  own column zones are already their columns + 1). */
export const COAL_SITE_MARGIN = 2
/**
 * IS THIS SPOT ON A TOWN PROJECT'S SITE? -> the zone's `why` (e.g. 'project:monument') | null. Pure.
 *   pos    { x, y, z } (the bot's position; fractional is fine: a block's cell is its floor)
 *   zones  [{ box: [x0, y0, z0, x1, y1, z1], why }] inclusive -- shop.mjs recordZones(every project record, COAL_SITE_MARGIN),
 *          the zones the projects' siting reads
 * A malformed zone is skipped; a missing position is null (the caller's site reading is then not ok: refused).
 */
export function projectSiteHit (pos, zones = []) {
  const x = Math.floor(Number(pos?.x)), y = Math.floor(Number(pos?.y)), z = Math.floor(Number(pos?.z))
  if (![x, y, z].every(Number.isFinite)) return null
  for (const zn of zones ?? []) {
    const b = zn?.box
    if (!Array.isArray(b) || b.length !== 6 || !b.every(Number.isFinite)) continue
    if (x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5]) return String(zn.why ?? 'project')
  }
  return null
}

/**
 * AFTER THE RUN -> the new state. Pure. A run the runner DECLINED never ran: its cooldown is refunded. A run that brought coal
 * clears the backoff; one that failed, or ended with no more coal than it started with, backs off COAL_RUN_BACKOFF_MS.
 */
export function coalRunOutcome (status, heldAfter = 0, now = 0, state = {}, { declined = false } = {}) {
  const s = { ...state }
  if (declined) { s.lastIssuedAt = -Infinity; return s }
  const gained = (Number(heldAfter) || 0) - (Number(s.issuedHeld) || 0)
  if (status === 'success' && gained > 0) s.backoffUntil = 0
  else s.backoffUntil = now + COAL_RUN_BACKOFF_MS
  s.lastGained = gained
  return s
}

/** The run's row detail: why it was or was not issued, with the town total and the bag's coal. Under 300 chars. */
export const coalRunDetail = ({ skip = null, issued = null, town = null, held = 0, free = 0 } = {}) =>
  `${issued ? `issued block=${issued}` : `skip=${skip ?? '-'}`} town_coal=${town?.ok ? town.total : '?'} containers=${town?.ok ? town.containers : '?'} ` +
  `held=${held} free=${free} floor=${COAL_FLOOR} keep=${COAL_KEEP}`
