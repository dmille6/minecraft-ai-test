// THE TOWN SMELT JOB AND THE FURNACE DRAIN (smeltjob-01; stage 1 of docs/reports/townprojects-design-2026-10-14.md,
// OWNER 10-14 "find real useful uses for [logs and copper] ... put the bots to real work using real resources" -> "yes do
// it"; decisions 10-15 "go with your recommendations").
//
// MEASURED 10-14 (ES, 24 h, 1,400,226 skill docs from 80 bots): the town chests hold 10,504 raw copper and the fleet
// smelted FIVE of it in a day -- smelt 318 successes, 308 of them raw_iron. Copper is gathered, banked, and never
// processed, because nothing turns stock into anything: the model never chooses `smelt raw_copper` and no rung asks for
// it. CLAUDE.md: advice printed is not advice taken. So this is a DETERMINISTIC TOWN ORDER, never the model's choice:
//
//   smelt_town     at town, with room, fuel and copper the town has not shown it lacks: ONE skill takes up to 8 raw
//                  copper (+ 1 coal if the bag holds none) from a town container, smelts it in a leased furnace with the
//                  EXISTING `smelt` (the one the iron rung uses), and deposits the ingots and any unsmelted input --
//                  all inside one runner budget, so no other order can come between the withdraw and the deposit.
//   furnace_drain  at town: an UNLIT, UNLEASED furnace within the town radius that this bot has not seen empty (or has seen
//                  lit since) is opened and emptied into the bag -- output, stranded input, stranded fuel. A smelt that
//                  died between its load and its drain (a disconnect, a hard stop, a full bag at the close) leaves exactly
//                  that, and nothing else in the fleet ever goes back for it. It is also the recovery path every later
//                  stage's rollback relies on (design section 8: the drain ships in the EARLIEST stage). What it takes
//                  stays in the BAG (Claude code r1 P3-6): copper reaches town through the ordinary deposits (raw_copper and
//                  copper_ingot are DEPOSIT_ALWAYS) or the next smelt_town (which banks every ingot it holds); iron and coal
//                  stay with the bot, as the iron ladder keeps them by design.
//
// A READY MILESTONE STEP ALWAYS WINS. Both orders are placed in cognitive.mjs's chain after every existing order and are
// consulted only when no order was chosen -- and they also stand down when the active rung is ready except for room
// (`ready.noRoom`): that rung is waiting on the bag, and a town job is not allowed to take its turn (owner order 10-15).
//
// EVERY DECISION IS HERE AND PURE (CLAUDE.md "extract the decision"): the skills in skills.mjs only walk, open, click,
// wait and measure. Isolated pools are out of v1 (owner D2: their town state is per bot, so five bots would each run
// their own job against one physical town).

/** What the job smelts in stage 1, and what that makes (smelting.mjs SMELTS raw_copper -> copper_ingot). */
export const SMELT_JOB_INPUT = 'raw_copper'
export const SMELT_JOB_OUTPUT = 'copper_ingot'
/** One `smelt` batch: SMELT_BATCH_MAX (8 = one coal, 80 s at the furnace). */
export const SMELT_JOB_BATCH = 8
/** Fuel the job takes from town (owner order: "smelt with coal"). COAL ONLY (Codex rebase review r2 P2/P3, 10-15): with
 *  charcoal admitted, `smeltPlan` preferred the bag's own charcoal and the job then returned the town's coal it never
 *  burned, and a charcoal return is not depositable (neither a target nor DEPOSIT_ALWAYS). The towns hold 1 charcoal in
 *  all 354 containers (census 10-14) and owner D4 defers charcoal, so coal is the whole of the job's fuel. */
export const SMELT_JOB_FUEL = 'coal'
export const JOB_FUELS = Object.freeze(['coal'])
/** Free bag slots the job needs: one for the input (then the ingots, in the same slot count), one for the coal. */
export const SMELT_JOB_MIN_FREE = 2
/** Sandbox pacing only (as PLINTH_COOLDOWN_MS): an env override; the fleet runs the default. */
const envMs = (name, dflt) => { const v = Number(process.env[name]); return process.env[name] != null && process.env[name] !== '' && Number.isFinite(v) && v >= 0 ? v : dflt }
export const SMELT_JOB_COOLDOWN_MS = envMs('SMELT_JOB_COOLDOWN_MS', 10 * 60 * 1000)
export const SMELT_JOB_BACKOFF_MS = 20 * 60 * 1000
/** The standalone job's terminal state (design 3.2): this many consecutive non-successes for ONE reason pause it. */
export const SMELT_JOB_PAUSE_AFTER = 6
export const SMELT_JOB_PAUSE_MS = 6 * 60 * 60 * 1000

// ---- THE JOB'S TOWN SEARCH (toolkit-03; coordinator 10-19: the smelting drop 4,588 -> 681 ingots/day) ------------------
// MEASURED 10-19 (the analysis agent, ES 24 h): 516 jobs stopped no_fuel, 489 of them after taking 8 raw copper from town and
// finding no coal -- the copper went back. Two causes in skills.mjs jobWithdraw: the 3-container cap (WITHDRAW_CONTAINERS),
// and the container list was built with the COPPER miss, so the coal look skipped every container marked "no copper" for
// 2 h -- coal in a copper-less container was never found (46% of no_fuel jobs ended in <= 6 s). And in the copper-less
// pools ~72% of town_has_none rows took < 6 s with nothing opened: the order's gate (every findBlocks key) and the job's
// sweep (shut containers skipped) disagreed, and each such row counted toward the 6-in-a-row pause.
// Now the job searches the way withdraw_pick does (withdrawpick.mjs townSearchOrder over skills.mjs townSearchView): the
// copper first (its own 2 h miss), then -- with copper in hand -- the coal as its OWN need (its own 60 min miss; never
// skipped for lacking copper), each pass its own visit budget and clock, nearest the bot first; the order's gate is the same
// rule (townSearchEmpty). The job still never burns the bag's own fuel (owner design).

/** Visits per job: the copper pass, then the coal pass (each container once per pass). */
export const SMELT_COPPER_VISITS = 12
export const SMELT_COAL_VISITS = 8
/** The passes' clocks, as reserves at the END of the skill's (180 s): the copper pass starts no visit inside the last 120 s,
 *  the coal pass none inside the last 105 s -- the smelt (8 items: 80 s at the furnace, its own 150 s cap) and the bank keep
 *  the rest. (The base's three visits could already spend up to ~114 s: a 30 s walk + recount + 8 s open each.) */
export const SMELT_COPPER_RESERVE_MS = 120_000
export const SMELT_COAL_RESERVE_MS = 105_000
/** The job's stop reason when a pass was cut by its budget with candidates left: no strike toward the pause (the next job
 *  continues the search), never `town_has_none` / `no_fuel`. */
export const SMELT_SEARCH_MORE = 'search_more'
/** ...at most this many in a row (Codex r2 P2: a town larger than the passes cover inside a miss's life could hand every
 *  job new candidates); the next one backs off like a failure. A pass that learned NOTHING is `search_stalled`, a strike. */
export const SMELT_MORE_MAX = 3
export const SMELT_SEARCH_STALLED = 'search_stalled'
/** The coal's own miss (toolkit-03): a town container that showed no coal, for as long as the copper's (2 h), so the coal
 *  pass covers a large town before its misses expire (Codex r2 P2); ended at once by a deposit into it. */
export const COAL_MISS_KEY = '_coal_miss'
export const COAL_MISS_TTL_MS = 2 * 60 * 60 * 1000

/** A town container that showed no raw copper is not looked in again for this long -- unless it has TAKEN items since. */
export const COPPER_MISS_KEY = '_copper_miss'
export const COPPER_MISS_TTL_MS = 2 * 60 * 60 * 1000

export const DRAIN_COOLDOWN_MS = envMs('DRAIN_COOLDOWN_MS', 10 * 60 * 1000)
export const DRAIN_BACKOFF_MS = 20 * 60 * 1000
/** A furnace this bot saw EMPTY is not opened again for this long unless it has been seen LIT since. */
export const DRAIN_EMPTY_TTL_MS = 6 * 60 * 60 * 1000
export const DRAIN_MIN_FREE = 2
/** The drain looks within the town radius of home (composter.mjs TOWN_RADIUS, straight-line). */
export const DRAIN_RADIUS = 48

/**
 * IS THE JOB ON? -> { on, why }. Pure. Off with SMELT_JOB=0|off|false (the kill switch), and off in an ISOLATED pool
 * (owner D2). Default ON in every other scope.
 */
export function smeltJobEnabled (env = {}, scope = null) {
  const v = String(env?.SMELT_JOB ?? '').trim().toLowerCase()
  if (['0', 'off', 'false', 'no'].includes(v)) return { on: false, why: 'switched off (SMELT_JOB)' }
  if (scope === 'isolated') return { on: false, why: 'isolated pool (owner D2: town state is per bot there)' }
  return { on: true, why: null }
}

/** IS A MILESTONE STEP READY? -> true when the chain already chose an order, or the active rung waits only on room. */
export const milestoneHolds = ({ order = null, ready = null } = {}) => !!order || !!ready?.noRoom

const lazy = v => (typeof v === 'function' ? v() : v)

/**
 * THE SMELT ORDER -> { order, state, skip }. Pure; cognitive.mjs supplies the readings.
 *   held        {name: count} of the bag
 *   freeSlots   36 - occupied slots
 *   townMiss    lazy: every reachable town container has shown no raw copper recently (complete coverage)
 *   state       { lastIssuedAt, backoffUntil, pausedUntil, streak: { why, n } }
 * `skip` names why nothing was issued (the read's denominator; never a refusal: a skip leaves the bot every other move).
 */
export function smeltTownOrder ({ now = 0, on = true, atTown = false, holds = false, held = {}, freeSlots = 0, townMiss = false, state = {} } = {}) {
  const s = { ...state }
  if (!on) return { order: null, state: s, skip: 'off' }
  if (holds) return { order: null, state: s, skip: 'milestone' }
  if (!atTown) return { order: null, state: s, skip: 'away' }
  if (now < (s.pausedUntil ?? 0)) return { order: null, state: s, skip: 'paused' }
  if (now - (s.lastIssuedAt ?? -Infinity) < SMELT_JOB_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return { order: null, state: s, skip: 'cooldown' }
  if (freeSlots < SMELT_JOB_MIN_FREE) return { order: null, state: s, skip: 'room' }
  const carried = Number(held?.[SMELT_JOB_INPUT]) || 0
  const ingots = Number(held?.[SMELT_JOB_OUTPUT]) || 0
  // the scan (a town memory read) only after the cheap gates; the cooldown is charged for the LOOK
  s.lastIssuedAt = now
  if (!carried && !ingots && lazy(townMiss)) return { order: null, state: s, skip: 'town_has_none' }
  const n = Math.min(SMELT_JOB_BATCH, carried || SMELT_JOB_BATCH)
  return {
    order: { skill: 'smelt_town', args: {},
             why: carried ? `the bag holds ${carried} raw_copper and nothing turns it into anything: smelt ${n} into copper ingots and bank them (town smelt job)`
               : ingots && lazy(townMiss) ? `the bag holds ${ingots} copper ingots from an earlier job: bank them (town smelt job)`
               : `the town holds raw copper and nothing turns it into anything: smelt ${n} into copper ingots and bank them (town smelt job)` },
    state: s, skip: null,
  }
}

/**
 * AFTER THE ORDER RAN -> new state. success: clears the streak. A skip (no_effect) or an interruption costs only the
 * cooldown, but counts toward the pause when it repeats for the SAME reason (`why`: the skill's stop reason). A failure
 * backs off and counts too. SMELT_JOB_PAUSE_AFTER in a row for one reason -> paused SMELT_JOB_PAUSE_MS (design 3.2).
 */
export function smeltTownOutcome (status, why = null, now = 0, state = {}) {
  const s = { ...state }
  if (status === 'success') { s.streak = null; return s }
  if (status === 'failed') s.backoffUntil = now + SMELT_JOB_BACKOFF_MS
  if (status === 'aborted' || why === 'interrupted') return s           // a reflex took the body: no strike
  // a search cut with candidates left that made progress: no strike (toolkit-03) -- SMELT_MORE_MAX in a row, then a backoff
  if (why === SMELT_SEARCH_MORE) {
    s.moreStreak = (s.moreStreak ?? 0) + 1
    if (s.moreStreak <= SMELT_MORE_MAX) return s
    s.moreStreak = 0; s.backoffUntil = now + SMELT_JOB_BACKOFF_MS
    return s
  }
  s.moreStreak = 0
  const key = why ?? status
  const n = s.streak?.why === key ? (s.streak.n ?? 0) + 1 : 1
  s.streak = { why: key, n }
  if (n >= SMELT_JOB_PAUSE_AFTER) { s.pausedUntil = now + SMELT_JOB_PAUSE_MS; s.streak = null }
  return s
}

// ---- the drain ------------------------------------------------------------------------------------------------------

/**
 * WHICH FURNACE MAY THIS BOT DRAIN -> the candidate or null. Pure.
 *   furnaces   [{ k, dist, lit }] within DRAIN_RADIUS of home (lit: the block state, readable without opening)
 *   leased     k -> true when another session holds it (furnacelease.mjs)
 *   seen       { k: { empty: bool, at, litSince: bool } } this bot's own memory of what it found
 * An UNLIT, UNLEASED furnace not known empty (or seen lit since it was) is a candidate; nearest first.
 * A LIT furnace is never opened: it is cooking (somebody's batch, or a stage-4 load), and an unlit one with input and
 * fuel cannot exist in vanilla for more than a tick (it would light).
 */
export function drainPick ({ furnaces = [], leased = () => false, seen = {}, now = 0 } = {}) {
  const cands = []
  for (const f of furnaces) {
    if (!f?.k || f.lit) continue
    if (!(f.dist <= DRAIN_RADIUS)) continue
    if (leased(f.k)) continue
    const m = seen[f.k]
    if (m?.empty && !m.litSince && now - (m.at ?? 0) < DRAIN_EMPTY_TTL_MS) continue
    cands.push(f)
  }
  cands.sort((a, b) => a.dist - b.dist || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
  return cands[0] ?? null
}

/** This bot's memory after a look -> new `seen`. `lit` updates mark litSince on known-empty furnaces. Pure. */
export function noteFurnaceSeen (seen = {}, k, { empty = false, now = 0 } = {}) {
  return { ...seen, [k]: { empty, at: now, litSince: false } }
}
export function noteFurnacesLit (seen = {}, furnaces = []) {
  const out = { ...seen }
  for (const f of furnaces) if (f?.lit && out[f.k]?.empty) out[f.k] = { ...out[f.k], litSince: true }
  return out
}

/** THE DRAIN ORDER -> { order, state, skip }. Pure. state { lastIssuedAt, backoffUntil, pausedUntil, streak }. */
export function drainOrder ({ now = 0, on = true, atTown = false, holds = false, freeSlots = 0, pick = null, state = {} } = {}) {
  const s = { ...state }
  if (!on) return { order: null, state: s, skip: 'off' }
  if (holds) return { order: null, state: s, skip: 'milestone' }
  if (!atTown) return { order: null, state: s, skip: 'away' }
  if (now < (s.pausedUntil ?? 0)) return { order: null, state: s, skip: 'paused' }
  if (now - (s.lastIssuedAt ?? -Infinity) < DRAIN_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return { order: null, state: s, skip: 'cooldown' }
  if (freeSlots < DRAIN_MIN_FREE) return { order: null, state: s, skip: 'room' }
  s.lastIssuedAt = now
  const p = lazy(pick)
  if (!p) return { order: null, state: s, skip: 'nothing_to_drain' }
  return { order: { skill: 'furnace_drain', args: {},
                    why: `the idle furnace at ${p.k} may hold items a stopped smelt left behind: empty it (furnace drain)` },
           state: s, skip: null }
}
export const drainOutcome = (status, why = null, now = 0, state = {}) => {
  const s = smeltTownOutcome(status, why, now, state)
  if (status === 'failed') s.backoffUntil = now + DRAIN_BACKOFF_MS
  return s
}

// ---- what the job gives back at its exit ------------------------------------------------------------------------------

/**
 * THE JOB'S EXIT -> { releaseRaw, fuel: { name, release, deposit } | null }. Pure.
 * A withdraw holds what it took back from every deposit for a while (bankable.mjs setWithdrawHold). At the job's exit that
 * hold is the job's own and ALL of it goes (Claude rebase review 10-15 P2): every raw copper the job took was either
 * smelted or is about to be banked. Releasing only the leftover left the smelted share of the hold standing, and the
 * hold then covered the leftover -- take 8, smelt 5: the hold fell to 5 and kept all 3 raw out of the job's own deposit
 * (raw_copper is DEPOSIT_ALWAYS: the job fought its own hold, and the copper waited 10 min for a town deposit).
 * The town FUEL it took and did not burn goes back too (the same review, P3: the no-furnace, busy-furnace and no-path
 * exits left it in the bag, and the town deposit never banks coal): the bag must end with no more of that fuel than it
 * began with, so `deposit` = what it holds above its opening count, at most what was taken. The bot's own fuel stays.
 */
export function jobReturns ({ withdrawn = 0, fuelName = null, fuelTaken = 0, fuelBag0 = 0, fuelNow = 0 } = {}) {
  const releaseRaw = Math.max(0, Number(withdrawn) || 0)
  if (!fuelName || !(fuelTaken > 0)) return { releaseRaw, fuel: null }
  const deposit = Math.max(0, Math.min(fuelTaken, (Number(fuelNow) || 0) - (Number(fuelBag0) || 0)))
  return { releaseRaw, fuel: { name: fuelName, release: fuelTaken, deposit } }
}

// ---- the copper balance (the read's defect gate C1, computed in the row and re-derived by the read) --------------------

/**
 * ONE BOUNDARY, copper-family units (raw_copper and copper_ingot, 1:1 by recipe) -> { verdict, inUnits, outUnits, diff }.
 * Pure. Design section 5 (Codex r3/r4): IN = opening bag + withdrawn + prior furnace stock collected; OUT = deposited +
 * closing bag + left in the furnace. Opening and closing contents are counted, so there is no in-flight allowance.
 *   gain explained by `pickedUp` (server auto-pickup of copper on the walk) is not a defect; anything else either way is.
 *   `uncertain` (a window that did not open, a drain that stopped, a close not read) -> 'unreconciled', never 'ok'.
 */
export function copperBalance ({ bag0 = 0, withdrawn = 0, prior = 0, deposited = 0, bag1 = 0, furnaceLeft = 0, pickedUp = 0, uncertain = false } = {}) {
  const inUnits = bag0 + withdrawn + prior + pickedUp
  const outUnits = deposited + bag1 + furnaceLeft
  const diff = outUnits - inUnits
  if (uncertain) return { verdict: 'unreconciled', inUnits, outUnits, diff }
  return { verdict: diff === 0 ? 'ok' : diff < 0 ? 'loss' : 'gain', inUnits, outUnits, diff }
}

/** The skill's row detail, one place, so the read parses ONE format (scripts/host/smeltjobread.py). */
export function smeltTownDetail (f = {}) {
  const v = x => (x == null ? '-' : String(x))
  return [
    `stop=${v(f.stop)}`, `n=${v(f.n)}`, `bag0=${v(f.bag0)}`, `withdrawn=${v(f.withdrawn)}`, `coal=${v(f.coal)}`,
    `smelted=${v(f.smelted)}`, `prior=${v(f.prior)}`, `deposited=${v(f.deposited)}`, `dep_i=${v(f.depI)}`, `dep_r=${v(f.depR)}`, `bag1=${v(f.bag1)}`,
    `left=${v(f.furnaceLeft)}`, `furnace=${v(f.furnace)}`, `lease=${v(f.lease)}`, `verdict=${v(f.verdict)}`,
    `diff=${v(f.diff)}`, `chest=${v(f.chest)}`, `t0=${v(f.t0)}`, `fb=${v(f.fuelBack)}`,
    // toolkit-03: the job's town search -- containers looked in, and which pass was cut with candidates left (cu | coal | -)
    `looked=${v(f.looked)}`, `more=${v(f.more)}`,
  ].join(' ')
}
export function drainDetail (f = {}) {
  const v = x => (x == null ? '-' : String(x))
  return [`stop=${v(f.stop)}`, `furnace=${v(f.furnace)}`, `lease=${v(f.lease)}`, `out=${v(f.out)}`, `in=${v(f.inp)}`,
          `fuel=${v(f.fuel)}`, `taken=${v(f.taken)}`, `left=${v(f.left)}`, `t0=${v(f.t0)}`].join(' ')
}
