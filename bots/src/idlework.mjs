// IDLEWORK-01: A BOT WITH NOTHING TO BUILD DOES A BATCH OF PRODUCTIVE WORK, NOT AN 80-BLOCK WALK (design
// docs/reports/idlework-design-2026-11-06.md). Pure: the needs table, the lap's pick, the batch's gain counter. milestones.mjs
// wires it into SUSTAINING as the `idle_work` rung, in place of `patrol`.
//
// MEASURED (fleet, 11-05 01Z..11-06 01Z, 80/80 bots, 1,906 bot-h of decision time): once dirtrung-01 stopped the dirt rung
// re-opening every lap, every rung before `patrol` was already met for most bots, so the sustaining lap became
// patrol -> deposit_surplus (vacuous 80 blocks out) -> return -> re-enter: patrol 963 bot-h, return 474, deposit_surplus 116,
// idle 57 = 1,610 of 1,906 (84%; 11-04: 1,072 of 1,878, 57%). Explore 138 -> 372 skill-h, gather 255 -> 44; value per bot-h
// 16.14 -> 9.90. A live prompt (board-a-Alpha, patrol#3506): explore 75 -> return home -> Nothing to do -> explore 76 ...
//
// THE RUNG: on each lap it asks for ONE bounded batch -- GAINED since the rung opened, never "hold N" (a bag that already holds
// N would pass at once and the lap would be the walk again) -- of a material the bot can use or the town banks:
//   iron  6 raw_iron/iron_ingot (8.0 in valuescore; iron pickaxes wear out ~440 a day), with a stone-or-better pickaxe that can
//         pay a trip (oretunnel.mjs hasTripPickaxe)
//   logs  16 logs of any kind (the town banks them up to 4,000 a type, stocktarget.mjs TOWN_WOOD_TARGET)
//   coal  8 coal (the bot's and the town's furnace fuel), with any usable pickaxe
//   scout the old patrol (80 blocks out), one lap in eight: the deposit sightings the frontier reads come from walking
// NEVER COBBLE: every town is at its 1,000 cap (38% of new cobble went down the junk well) -- a batch the bank refuses is not work.
//
// A KIND THAT FAILS IS BARRED, NOT THE RUNG (a refusal must name a remedy the bot can perform): the controller's own skip
// (45 min without serving progress, 25 serving failures, 3 h residence) bars that KIND for IDLE_BAR_MS and the next lap picks
// the next kind; the rung's id is never put on the controller's skip list. All kinds barred or without means -> `scout`
// (the old patrol rule, so the lap is never worse than today); scout barred too -> `none`: vacuously done and not re-opening,
// so the chain cannot spin.
//
// IDLEWORK=0 is the rollback: the rung is vacuously done, never re-opens, and `patrol` is exactly as before.

export const idleWorkOn = (env = process.env) => String(env?.IDLEWORK ?? '1').trim() !== '0'

export const LOG_NAMES = Object.freeze(['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'mangrove_log', 'cherry_log', 'pale_oak_log'])
/** The needs, each { kind, count: names counted, n: the batch, wants, wantsAny, label, hint }. */
export const IDLE_NEEDS = Object.freeze({
  iron: Object.freeze({ kind: 'iron', count: ['raw_iron', 'iron_ingot'], n: 6, wants: 'iron_ore',
    wantsAny: ['iron_ore', 'deepslate_iron_ore', 'raw_iron'], label: 'iron ore',
    describe: 'Mine 6 iron ore for tools (raw_iron; an iron pickaxe costs 3, and the fleet wears out hundreds a day).',
    hint: 'gather with block=iron_ore (or deepslate_iron_ore) when you see it; if none is in sight, mine down to y=16 and look again.' }),
  logs: Object.freeze({ kind: 'logs', count: LOG_NAMES, n: 16, wants: 'oak_log', wantsAny: [...LOG_NAMES], label: 'logs',
    describe: 'Cut 16 logs (any kind) for the town store and its builds.',
    hint: 'gather with block=oak_log, or any other _log you can see.' }),
  coal: Object.freeze({ kind: 'coal', count: ['coal'], n: 8, wants: 'coal_ore', wantsAny: ['coal_ore', 'deepslate_coal_ore', 'coal'],
    label: 'coal', describe: 'Mine 8 coal: fuel for smelting iron and stone.',
    hint: 'gather with block=coal_ore; it shows on cliffs and in caves near the surface.' }),
  // GKFOREVER-01 (gkforever.mjs): the town's grounds -- the work is the tidy's build order, handed out at town; the batch counts the
  // bot's visits that changed the ground (`count` is empty: milestones.mjs reads the bot's own counter, never the bag)
  grounds: Object.freeze({ kind: 'grounds', count: [], n: 3, wants: null, wantsAny: [], label: 'grounds visits',
    describe: 'Keep the town grounds: fill holes, level the ground, cut down bot pillars and dirt steps, clear what blocks the paths.',
    hint: 'use skill home if you are away from home and stay at town: the grounds work is handed to you there as an order.' }),
})
export const IDLE_KINDS = Object.freeze(Object.keys(IDLE_NEEDS).filter(k => k !== 'grounds'))
/** One lap in eight is a scouting lap; the rest are work. Rotated by the chain's cycle so the kinds spread across bots. */
export const IDLE_ROTATION = Object.freeze(['iron', 'logs', 'iron', 'coal', 'logs', 'iron', 'coal', 'scout'])
/** GKFOREVER-01 (GKF_IDLE): every other lap a grounds lap while the town's grounds have work and a builder slot (the crew caps it:
 *  gkforever.mjs GKF.crew), the gathers between, the scout lap still one in eight. With no grounds means the walk forward lands on
 *  the next gather, so the bag work is never worse than half. Pure. */
export const IDLE_ROTATION_GK = Object.freeze(['grounds', 'iron', 'grounds', 'logs', 'grounds', 'coal', 'grounds', 'scout'])
/** GKFOREVER=0 or GKF_IDLE=0: the plain rotation (gkforever.mjs gkfOn's rule; this module imports nothing). Pure. */
const offV = v => ['0', 'off', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
export const idleRotation = (env = process.env) => (offV(env?.GKFOREVER) || offV(env?.GKF_IDLE) ? IDLE_ROTATION : IDLE_ROTATION_GK)
/** A grounds batch: this many of the bot's visits that changed the ground, or this long since it opened (Codex: up to 8 min). */
export const GROUNDS_BATCH = Object.freeze({ visits: 3, ms: 8 * 60_000 })
/** The grounds batch's hooks (milestones.mjs installs the open-batch read, skills.mjs the means): a registry, never an import of
 *  skills.mjs from here. */
let groundsOpenOf = () => false
export function setGroundsOpen (fn) { if (typeof fn === 'function') groundsOpenOf = fn }
/** Is this bot's grounds batch open now (shop.mjs: the tidy order's keeper cooldown)? Never throws. */
export const groundsBatchOpen = () => { try { return !!groundsOpenOf() } catch { return false } }
let groundsMeansOf = () => false
export function setGroundsMeans (fn) { if (typeof fn === 'function') groundsMeansOf = fn }
/** May this bot take a grounds lap (skills.mjs: the town's grounds have work and a slot for it)? Never throws. */
export const groundsMeans = b => { try { return !!groundsMeansOf(b) } catch { return false } }
// ---- IDLEWORK-02 (docs/reports/idlework2-design-2026-11-06.md) ---------------------------------------------------------------
// MEASURED 11-06 (fleet, 80 bots): after idlework-01 went fleet-wide (10:30Z) bots at >= 34 estimated slots 9 -> 24 by 13:35Z
// (Grafana "Many bags full": sum(mcai_bots_bag_full{scope="fleet"}) > 15 for 1 h); 22 of the 24 were in the FIELD, mid-batch
// (mine/gather/deep_mine/goto): an iron batch (median 51 min) nets cobble +52, deepslate +13, raw_iron +3 and a granite/andesite/
// diorite/tuff/clay tail, ~100% of it PASSIVE pickups (the server hands a dug block's drop over; nothing chases it). A full bag's
// gather fails (4.8% vs 52.2% with room, hygiene.mjs), so the rest of a batch on a full bag is walking with no pickup.
//
// THE BAG STOP (IDLEWORK_BAGSTOP, =0 the rollback): a bag-filling batch (iron, logs, coal) is MET once the bag reaches
// IDLE_BAG_STOP real slots AND this batch raised it (slots above the count it opened at), so the lap goes on to `return` and
// the town visit sheds the surplus (well.mjs wellBandDue, from 29). A bag batch OPENS only at <= IDLE_BAG_OPEN_MAX (Codex's
// hysteresis: 8 free slots, the build order's room; stop at 30 leaves six for passive pickups and escape stone): above it the
// bag kinds have no means, and the lap is a grounds or scout lap (no bag gain) -- never a batch met the moment it opens, so the
// chain cannot spin. The stop is a completion of THIS lap's batch, never a skip: it bars nothing.
export const IDLE_BAG_OPEN_MAX = 28
export const IDLE_BAG_STOP = 30
export const BAG_KINDS = Object.freeze(['iron', 'logs', 'coal'])
export const idleBagStopOn = (env = process.env) => String(env?.IDLEWORK_BAGSTOP ?? '1').trim() !== '0'
/** The means with the bag kinds taken away when the bag is at the stop. Pure. */
export function idleBagMeans (means = {}, slots = null, { on = idleBagStopOn(), openMax = IDLE_BAG_OPEN_MAX } = {}) {
  if (!on || !Number.isFinite(slots) || slots <= openMax) return means
  const out = { ...means }
  for (const k of BAG_KINDS) out[k] = false
  return out
}
/** Did THIS batch fill the bag to the stop? Pure. Only a bag kind, only above the slots it opened at. */
export function idleBagFull (state, slots, { on = idleBagStopOn(), stop = IDLE_BAG_STOP } = {}) {
  if (!on || !state || !BAG_KINDS.includes(state.kind) || !Number.isFinite(slots)) return false
  return slots >= stop && Number.isFinite(state.slotsAt) && slots > state.slotsAt
}

// THE DEPTH-AWARE HINT (the coordinator's 11-06 item): 10:40-13:40Z the fleet's model sent 2,028 `mine` proposals admission
// refused as bad_args (of 6,936 mine calls; 2,132 bad_args in all) -- 1,993 "mine only digs DOWNWARD": args.y at or ABOVE the
// ceiling (args.y - feet y: -1 620, 0 584, +1..+13 ~600). 1,377 under the iron batch, whose hint said "mine down to y=16", from
// bots already at the town stair's landing at y=16 (mine y=16 walks the stair down, then the hint asks for y=16 again); 161
// under the coal batch. The ELEVATION line already named the ceiling; the hint's literal 16 out-voted it. So the hint names a
// target the gate accepts (mining.mjs mineTargetOk), or a move that is not `mine`. Pure.
export const IRON_DEPTH = 16
/** `mine`'s ceiling from feet y (mining.mjs mineTargetCeiling, restated: this module imports nothing). */
const ceilingOf = y => Math.max(-59, Math.ceil(y - 2)) + 0   // + 0: never print -0
export function idleDepthHint (kind, y) {
  const base = IDLE_NEEDS[kind]?.hint ?? null
  if (!Number.isFinite(y) || (kind !== 'iron' && kind !== 'coal')) return base
  const yr = Math.round(y), cap = ceilingOf(y)
  if (kind === 'iron') {
    if (y > IRON_DEPTH + 2) return base
    if (cap < -50) return `you are near bedrock (y=${yr}): gather with block=iron_ore or deepslate_iron_ore when one is in sight; otherwise use surface (mine only goes DOWN, and there is no rock left below).`
    const to = Math.max(-50, Math.min(cap, Math.floor(y) - 8))
    return `you are at iron depth (y=${yr}): gather with block=iron_ore or deepslate_iron_ore when one is in sight; if none is, mine with y=${to} to open new rock (mine only goes DOWN: from here y=${cap} is the highest it takes).`
  }
  // coal: commonest high up; at iron depth there is little, and mine cannot climb
  if (y > 40) return base
  return `coal is scarce this deep (y=${yr}): gather with block=coal_ore if one is in sight; otherwise use surface and look for coal_ore on cliffs and in caves near the surface (mine only goes DOWN: from here y=${cap} or lower).`
}

export const IDLE_BAR_MS = 3 * 3600_000   // longer than three 45-min deadlines: kinds failing in turn reach the scout lap
export const SCOUT_DIST = 80

/**
 * THE LAP'S KIND -> 'iron' | 'logs' | 'coal' | 'scout' | 'none'. Pure. From the rotation slot `cycle` mod its length, the first
 * kind (walking the rotation forward) that has its means and is not barred at `now`; none of the work kinds -> 'scout' unless
 * scout is barred -> 'none'.
 *   means   { iron, logs, coal } booleans (absent = false)
 *   barred  Map kind -> until ms
 */
export function idlePick (cycle, { means = {}, barred = new Map(), now = Date.now(), rotation = IDLE_ROTATION } = {}) {
  const L = rotation.length
  const c = Number.isFinite(cycle) && cycle >= 0 ? Math.floor(cycle) : 0
  const isBarred = k => { const u = barred?.get?.(k); return Number.isFinite(u) && now < u }
  for (let i = 0; i < L; i++) {
    const k = rotation[(c + i) % L]
    if (k === 'scout') { if (!isBarred('scout') && i === 0) return 'scout'; continue }
    if (means[k] && !isBarred(k)) return k
  }
  return isBarred('scout') ? 'none' : 'scout'
}

/** How many of `names` a { name: n } count map holds. Pure. */
export const countOf = (counts = {}, names = []) => names.reduce((t, n) => t + (Number(counts?.[n]) || 0), 0)

/**
 * THE BATCH COUNTER -> the new state { cycle, kind, last, gained }. Pure. A new `cycle` (or no state) opens a batch at the bag's
 * count now (`gained` 0); after that only RISES count (a deposit, a craft or the pathfinder's scaffold spending the bag never
 * takes back what was gathered). `kind` is fixed when the batch opens.
 */
export function idleStep (state, cycle, kind, count, now = Date.now(), slots = null) {
  const n = Number.isFinite(count) ? count : 0
  // idlework-02: the bag's slots when the batch opened (the bag stop counts only a fill THIS batch made)
  if (!state || state.cycle !== cycle) return { cycle, kind, last: n, gained: 0, at: now, slotsAt: Number.isFinite(slots) ? slots : null }
  return { ...state, last: n, gained: state.gained + Math.max(0, n - state.last) }
}

/** Is the open batch met? Pure. scout: distance from home > SCOUT_DIST; none: always; a work kind: gained >= its n. */
export function idleMet (state, { dist = 0, now = Date.now(), noWorkAt = null, slots = null } = {}) {
  if (!state) return false
  if (state.kind === 'none') return true
  // idlework-02: a bag kind is met when this batch filled the bag to the stop (the town visit sheds it)
  if (idleBagFull(state, slots)) return true
  // gkforever-01: a grounds batch is met by its visits that changed the ground, its time, or a visit that found no grounds work
  if (state.kind === 'grounds') return (Number(state.gained) || 0) >= GROUNDS_BATCH.visits || (Number.isFinite(state.at) && now - state.at >= GROUNDS_BATCH.ms) || (Number.isFinite(noWorkAt) && Number.isFinite(state.at) && noWorkAt >= state.at)
  if (state.kind === 'scout') return dist > SCOUT_DIST
  return state.gained >= (IDLE_NEEDS[state.kind]?.n ?? Infinity)
}

/** A skip of the rung bars its kind (never 'none'): -> the new barred map. Pure. */
export function idleBar (barred = new Map(), kind, now = Date.now(), ms = IDLE_BAR_MS) {
  const out = new Map(barred)
  if (kind && kind !== 'none') out.set(kind, now + ms)
  return out
}

// GKSTAY-01 (coordinator 11-06 ~00:00Z; LIVE fleet e447b65b, 1.18 h, 80 bots: 102 keeper takes, 91 `keeper_release why=underground`; the
// first skill below in those terms `mine y=16` 9 of 22 -- this rung's iron hint): A GROUNDS LEASE HOLDER'S LAP STAYS ON THE SURFACE.
// While the bot holds the keeper lease (setHoldsGrounds: skills.mjs keeperNow), its lap opens no batch that goes below (iron, coal):
// the grounds lap first, else logs, else the scout lap -- never a mine batch. A batch of a mine kind already open when it would take
// the lease keeps it from taking (skills.mjs keeperOrder: `idleKindNow`), and a holder whose open batch is a mine kind hands the lease
// over deliberately (`keeper_release why=handoff`). GKSTAY=0 is the rollback.
export const gkstayOn = (env = process.env) => !['0', 'off', 'false', 'no'].includes(String(env?.GKSTAY ?? '1').trim().toLowerCase())
/** The kinds whose batch goes below the surface. */
export const BELOW_KINDS = Object.freeze(['iron', 'coal'])
/** A holder's means -> the same with every below-surface kind off (not a holder, or the switch off: unchanged). Pure. */
export function holderMeans (means = {}, holds = false, on = gkstayOn()) {
  if (!on || !holds) return means
  const out = { ...means }
  for (const k of BELOW_KINDS) out[k] = false
  return out
}
let holdsOf = () => false
/** skills.mjs installs the lease read (keeperNow). */
export function setHoldsGrounds (fn) { if (typeof fn === 'function') holdsOf = fn }
export const holdsGrounds = b => { try { return !!holdsOf(b) } catch { return false } }
let idleKindOf = () => null
/** milestones.mjs installs the open batch's kind. */
export function setIdleKindNow (fn) { if (typeof fn === 'function') idleKindOf = fn }
export const idleKindNow = () => { try { return idleKindOf() ?? null } catch { return null } }
/** Is the open batch one that goes below? Pure over the kind. */
export const belowKind = kind => BELOW_KINDS.includes(String(kind ?? ''))
