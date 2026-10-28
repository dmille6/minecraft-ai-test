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

import { indexStateOf, TOWNINDEX, OP_TTL_MS } from './townindex.mjs'   // ironsmelt-01: the index rule-out (townindex.mjs imports nothing of ours)

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
export const SMELT_COAL_VISITS = 16   // Paper 10-19: 8 left the far coal of a 10-chest town to the next job
/** The passes' clocks, as reserves at the END of the skill's (180 s): the copper pass starts no visit inside the last 125 s,
 *  the coal pass none inside the last 115 s -- the smelt (8 items: 80 s at the furnace) and the bank keep the rest, so the
 *  smelt starts with >= SMELT_MIN_SMELT_MS by construction. (The base's three visits could already spend ~114 s.) */
export const SMELT_COPPER_RESERVE_MS = 125_000
export const SMELT_COAL_RESERVE_MS = 115_000
/** The smelt starts only with this much of the job's clock left after the bank's reserve (Codex r3 P2: smelt's furnace walk,
 *  open and transfers are bounded by their own caps, not the caller's deadline) -- else the copper and coal go back and the
 *  stop is search_more (the coal is found; the next job smelts). The backstop of the reserves above. */
export const SMELT_MIN_SMELT_MS = 95_000
/** The job's stop reason when a pass was cut by its budget with candidates left: no strike toward the pause (the next job
 *  continues the search), never `town_has_none` / `no_fuel`. */
export const SMELT_SEARCH_MORE = 'search_more'
/** The job's stop when the search found copper and coal but left the smelt too little of the clock (SMELT_MIN_SMELT_MS):
 *  accounted exactly as search_more (the cap, the dry-job bound), its own name so a read can tell a slow server or slow walks
 *  from a large town (Claude r4 P3). */
export const SMELT_LATE = 'smelt_late'
/** ...at most this many in a row (Codex r2 P2: a town larger than the passes cover inside a miss's life could hand every
 *  job new candidates); the next one backs off like a failure. A pass that learned NOTHING is `search_stalled`, a strike. */
export const SMELT_MORE_MAX = 3
/** ...and DRY JOBS have an end state, whatever their mix of reasons (Claude r3 P1, Codex r4 P2): other bots' deposits can end
 *  the misses a job just wrote, so its "progress" is local, not net, and alternating reasons (search_more x3, no_fuel, ...)
 *  reset both the cap and the per-reason streak. Every job that ends search_more | search_stalled | no_fuel | smelt_late
 *  counts; this many since the last success pause the job SMELT_JOB_PAUSE_MS. Bounded: at most SMELT_DRY_MAX copper-taking dry
 *  jobs. Deliberately CONSERVATIVE: only a success resets the count -- a pause by the per-reason streak (6 no_fuel) leaves it,
 *  so the next pause can come sooner than 12 (Claude r5 P3). Like every smelt-job state it lives on the decision loop, which
 *  a reconnect rebuilds (as the 6 h pause always did). */
export const SMELT_DRY_MAX = 12
export const SMELT_DRY_REASONS = Object.freeze(new Set(['search_more', 'search_stalled', 'no_fuel', 'smelt_late']))
export const SMELT_SEARCH_STALLED = 'search_stalled'
/** The coal's own miss (toolkit-03): a town container that showed no coal, for as long as the copper's (2 h), so the coal
 *  pass covers a large town before its misses expire (Codex r2 P2); ended at once by a deposit into it. */
export const COAL_MISS_KEY = '_coal_miss'
export const COAL_MISS_TTL_MS = 2 * 60 * 60 * 1000

/** A town container that showed no raw copper is not looked in again for this long -- unless it has TAKEN items since. */
export const COPPER_MISS_KEY = '_copper_miss'
export const COPPER_MISS_TTL_MS = 2 * 60 * 60 * 1000

// ---- IRONSMELT-01: RAW IRON IS A JOB INPUT, AND COMES FIRST (docs/reports/ironsmelt-01-design-2026-10-23.md) ---------------
// OWNER 2026-10-23 ~12:40Z "yes build now". MEASURED 10-23 (ES 24 h, the town index, the 00:15Z RCON census): 1,359 of 1,661
// jobs ended town_has_none ("no raw copper"); of the 1,574 opens those jobs made that the index can see, 1,322 were of a
// container the index already KNEW held no raw copper, and 466 of 570 such jobs opened a container holding raw iron -- while the
// shared towns held 739 raw iron unsmelted and the toolkit turned ~450 iron ingots a day into pickaxes.
//
//   inputs     raw_iron, then raw_copper (jobInputs). Iron ingots feed the toolkit's pickaxes (the production chain); copper
//              ingots have no consumer (12,019 in the chests). One input per job (one furnace batch), at most SMELT_JOB_BATCH.
//   ownership  only the TOWN'S iron is the job's: the bag's own raw_iron and iron_ingot are the bot's iron ladder -- never fed
//              to the furnace (ironSmeltCount), never banked (ironBankPlan), never deposited to make room. Copper: the base rule.
//   rule-out   a town container the index KNOWS (opened since its last mutation mark, younger than the input's own miss life)
//              held none of an input is out of that input's search and gate (indexRuledOut): the same evidence a "looked, none"
//              miss is, written by ANY bot's open, with the miss's own 2 h bound -- so a mark that failed to write costs at most
//              what a miss whose deposit mark failed costs (Codex design r1 P1). Never for fuel.
// IRONSMELT=off is the one-setting rollback (copper the only input, no index rule-out, no iron miss): the base exactly.

/** IRONSMELT=on|off, default on; anything else reads as on (said in the mode row). Pure. */
export function ironsmeltMode (env = {}) {
  const raw = env?.IRONSMELT
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: 'IRONSMELT unset' }
  const v = String(raw).trim().toLowerCase()
  if (['off', '0', 'false', 'no'].includes(v)) return { on: false, mode: 'off', note: null }
  if (['on', '1', 'true', 'yes'].includes(v)) return { on: true, mode: 'on', note: null }
  return { on: true, mode: 'on', note: `IRONSMELT=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const IRONSMELT = Object.freeze(ironsmeltMode(typeof process !== 'undefined' ? process.env : {}))
/** SMELT_RULEOUT=off: the index rule-out alone off (Claude design r1 P2-3: two mechanisms, two switches, so a read can split
 *  them). The rule-out runs only with IRONSMELT on (off restores the base exactly) and with the town index on (TOWNINDEX=off
 *  reads nothing, so the mode row must not claim a rule-out: Claude code r1 P3-4). -> { on, why }. Pure. */
export const ruleoutMode = (env = {}, iron = IRONSMELT, index = TOWNINDEX) => {
  if (!iron?.on) return { on: false, why: 'off' }
  if (['off', '0', 'false', 'no'].includes(String(env?.SMELT_RULEOUT ?? '').trim().toLowerCase())) return { on: false, why: 'off' }
  if (!index?.on) return { on: false, why: 'off_noindex' }
  return { on: true, why: null }
}
export const SMELT_RULEOUT = Object.freeze(ruleoutMode(typeof process !== 'undefined' ? process.env : {}))
export const SMELT_IRON_INPUT = 'raw_iron'
export const SMELT_IRON_OUTPUT = 'iron_ingot'
/** What each input makes (smelting.mjs SMELTS). */
export const SMELT_OUTPUT_OF = Object.freeze({ raw_iron: SMELT_IRON_OUTPUT, raw_copper: 'copper_ingot' })
/** The job's inputs, in priority order. Pure. */
export const jobInputs = (on = IRONSMELT.on) => Object.freeze(on ? [SMELT_IRON_INPUT, SMELT_JOB_INPUT] : [SMELT_JOB_INPUT])
/** The iron's own miss (as the copper's): a town container that showed no raw iron, 2 h, ended at once by a deposit into it. */
export const IRON_MISS_KEY = '_iron_miss'
export const IRON_MISS_TTL_MS = 2 * 60 * 60 * 1000
/** An index observation stamped later than this past the reader's clock is no evidence (indexsearch-01's FUTURE_SLACK rule). */
export const INDEX_FUTURE_SLACK_MS = 60_000
/** A deposit recorded into a container (town memory `o=took`, written apart from the index) ends its rule-out too -- unless it
 *  came within this long after the observation: town_deposit's verifying re-open is captured ~1 ms BEFORE its took mark. */
export const RULE_OUT_TOOK_SLACK_MS = 5_000

/**
 * THE INDEX RULE-OUT FOR ONE INPUT -> { keys: Set<half key>, n }. Pure. `entries` the town index's fold ({ k: entry }), `need` the
 * input's item name, `tookAt` { half key: ms } the town memory's last deposit into each half. A container is ruled out when its
 * entry is KNOWN (townindex.mjs indexStateOf: an observation newer than every mutation mark, no mutation open across it), that
 * observation is younger than `ttl` (the input's own miss life), not stamped more than INDEX_FUTURE_SLACK_MS in the future,
 * holds NONE of `need`, and no deposit was recorded into either half after it (beyond RULE_OUT_TOOK_SLACK_MS). Both halves of
 * a double chest are named (the search's `tried` is per half). Recomputed at every search view (Codex design r1 P2).
 */
export function indexRuledOut (entries = {}, need = null, now = Date.now(), { ttl = IRON_MISS_TTL_MS, tookAt = {} } = {}) {
  const keys = new Set()
  let n = 0
  if (!need) return { keys, n }
  for (const [k, e] of Object.entries(entries ?? {})) {
    if (indexStateOf(e, now) !== 'known') continue
    const at = Number(e?.obs?.at)
    if (!Number.isFinite(at) || at > now + INDEX_FUTURE_SLACK_MS || now - at >= ttl) continue
    if ((Number(e.obs.names?.[need]?.[0]) || 0) > 0) continue
    const halves = [...new Set([k, ...(Array.isArray(e.obs.h) ? e.obs.h : [])])]
    if (halves.some(h => Number.isFinite(tookAt?.[h]) && tookAt[h] > at + RULE_OUT_TOOK_SLACK_MS)) continue
    for (const h of halves) keys.add(h)
    n++
  }
  return { keys, n }
}

// ---- SMELTGATE-01: NO ORDER WHEN THE TOWN INDEX SHOWS NO INPUT ANYWHERE ---------------------------------------------------
// MEASURED 10-28 (ES 24 h to 22:30Z, 80 bots; the 16 live towns' index files, replayed at each job's start): 777 of 1,068
// smelt_town jobs ended town_has_none (median 3.3 s, looked=1 in 577), and the towns held NO raw ore -- 0 raw_copper and 3
// raw_iron in the latest observations of 312 containers, beside 16,000+ copper_ingot (the copper is already smelted). The
// gate's rule-out covers only containers known (opened, no mutation since) within 2 h, so each job opened the 1-3 dirty or
// older ones and found nothing. At the START of every one of the 99 jobs that took town ore (84 copper, 15 iron), some
// container's latest observation held that ore or a move of it into a container came after its last observation; at the
// start of 592 of the 777 town_has_none jobs, none did.
// SMELT_GATE=off is the one-setting rollback (the gate exactly as before).
export const SMELT_GATE = Object.freeze({ on: !['off', '0', 'false', 'no'].includes(String((typeof process !== 'undefined' ? process.env?.SMELT_GATE : '') ?? '').trim().toLowerCase()) })
/**
 * DOES THE TOWN INDEX SHOW NONE OF `need` ANYWHERE? -> bool. Pure. True only when the index has at least one entry, every
 * container in `keys` (the town scan's) has one that is not `unknown`, no entry's latest observation -- any state, any age --
 * holds `need`, and no move of `need` into any container (`xin` { k: { name: at } }, townindex.mjs foldIndex) came after that
 * container's latest observation (or into one with none). Anything the index cannot vouch for is false and the base's search
 * decides: no entry, a never-opened container, an unreadable index, a mutation still OPEN (a pre mark with no post, younger
 * than OP_TTL_MS: its moves may not be on disk yet), or a deposit the TOWN MEMORY recorded (`tookAt` { half key: ms }, o=took)
 * after the container's latest observation (beyond RULE_OUT_TOOK_SLACK_MS: the rule-out's own rule).
 * A CLOSED mutation with no ore move recorded is no evidence: the deposit verbs record every move they put in (xfer); a
 * withdraw visit's room-making deposit does not, and is seen at the container's next open (every live town's containers were
 * opened within 2 h, 10-28).
 */
export function indexInputAbsent (entries = null, need = null, keys = null, now = Date.now(), xin = {}, { tookAt = {} } = {}) {
  if (!need || !entries || typeof entries !== 'object') return false
  const list = Object.values(entries)
  if (!list.length) return false
  for (const k of (Array.isArray(keys) ? keys : [])) if (indexStateOf(entries[k], now) === 'unknown') return false
  for (const e of list) {
    if ((Number(e?.obs?.names?.[need]?.[0]) || 0) > 0) return false
    for (const o of Object.values(e?.ops ?? {})) {
      const start = Math.max(Number.isFinite(o?.pre) ? o.pre : -Infinity, Number.isFinite(o?.held) ? o.held : -Infinity)
      if (o?.post == null && now - start < OP_TTL_MS) return false
    }
    const at = Number(e?.obs?.at)
    const halves = [...new Set([...(Array.isArray(e?.obs?.h) ? e.obs.h : [])])]
    if (halves.some(h => Number.isFinite(tookAt?.[h]) && !(tookAt[h] <= (Number.isFinite(at) ? at : -Infinity) + RULE_OUT_TOOK_SLACK_MS))) return false
  }
  for (const [k, m] of Object.entries(xin ?? {})) {
    const x = Number(m?.[need])
    if (Number.isFinite(x) && !(x <= (Number(entries[k]?.obs?.at) || -Infinity))) return false
  }
  return true
}

/**
 * HOW MANY RAW IRON THE IRON JOB SMELTS -> n. Pure. Never more than the batch, never more than the verified town take, and never
 * more than the bag holds ABOVE its opening count -- the bag's own raw iron is never fed to the furnace (Codex design r1 P2).
 */
export const ironSmeltCount = ({ withdrawn = 0, raw0 = 0, rawNow = 0 } = {}) =>
  Math.max(0, Math.min(SMELT_JOB_BATCH, Number(withdrawn) || 0, (Number(rawNow) || 0) - (Number(raw0) || 0)))

/**
 * WHAT THE IRON JOB BANKS -> { iron_ingot: { deposit, own }, raw_iron: { deposit, own } }. Pure. Exactly what the bag holds ABOVE
 * its opening count of each name -- ingots: what the furnace made (its prior output included); raw: what was taken and not
 * smelted, at most the take plus the furnace's prior raw input -- and `own`, the count held back for that one deposit call
 * (bankable.mjs swapWithdrawHold), so the bag's own iron never leaves. Per name, never a family total (Codex design r1 P2).
 */
export function ironBankPlan ({ raw0 = 0, ingot0 = 0, rawNow = 0, ingotNow = 0, withdrawn = 0, priorRaw = 0 } = {}) {
  const c = v => Math.max(0, Number(v) || 0)
  const ingot = Math.max(0, c(ingotNow) - c(ingot0))
  const raw = Math.max(0, Math.min(c(withdrawn) + c(priorRaw), c(rawNow) - c(raw0)))
  return { iron_ingot: { deposit: ingot, own: c(ingotNow) - ingot }, raw_iron: { deposit: raw, own: c(rawNow) - raw } }
}

/** The `_ironsmelt_mode` licence row (once per spawn): a kind the base cannot write. */
export const ironsmeltModeDetail = (m = IRONSMELT, ro = SMELT_RULEOUT) =>
  `phase=mode on=${m.on ? 1 : 0} mode=${m.mode} inputs=${jobInputs(m.on).join(',')} miss_h=${IRON_MISS_TTL_MS / 3600000} rule_out=${ro.on ? 'index_known_none' : (ro.why ?? 'off')}${m.note ? ` note=${m.note.replace(/\s+/g, '_')}` : ''}`

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
 *   ironMiss    lazy (ironsmelt-01): the same for raw iron -- read only with `iron` on; the town smelts iron FIRST
 *   state       { lastIssuedAt, backoffUntil, pausedUntil, streak: { why, n } }
 * `skip` names why nothing was issued (the read's denominator; never a refusal: a skip leaves the bot every other move).
 * THE GATE (ironsmelt-01): town_has_none only when the bag holds no copper AND neither input's search has a candidate left.
 */
export function smeltTownOrder ({ now = 0, on = true, atTown = false, holds = false, held = {}, freeSlots = 0, townMiss = false, ironMiss = true, iron = IRONSMELT.on, state = {} } = {}) {
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
  // the town's iron first (ironsmelt-01): a town with raw iron left to look at is a job whatever the bag carries
  const townIron = !!iron && !lazy(ironMiss)
  if (!townIron && !carried && !ingots && lazy(townMiss)) return { order: null, state: s, skip: 'town_has_none' }
  const n = Math.min(SMELT_JOB_BATCH, carried || SMELT_JOB_BATCH)
  return {
    order: { skill: 'smelt_town', args: {},
             why: townIron ? `the town has raw iron left to look for, and nothing turns it into anything: smelt up to ${SMELT_JOB_BATCH} into iron ingots for the toolkit and bank them (town smelt job)`
               : carried ? `the bag holds ${carried} raw_copper and nothing turns it into anything: smelt ${n} into copper ingots and bank them (town smelt job)`
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
  if (status === 'success') { s.streak = null; s.moreStreak = 0; s.dry = 0; return s }   // the `more` cap counts CONSECUTIVE ones (Codex r3 P3)
  if (status === 'failed') s.backoffUntil = now + SMELT_JOB_BACKOFF_MS
  if (status === 'aborted' || why === 'interrupted') return s           // a reflex took the body: no strike
  // THE DRY-JOB BOUND (toolkit-03): counted before any other rule, across reasons, reset only by a success
  if (SMELT_DRY_REASONS.has(why)) {
    s.dry = (s.dry ?? 0) + 1
    if (s.dry >= SMELT_DRY_MAX) { s.pausedUntil = now + SMELT_JOB_PAUSE_MS; s.dry = 0; s.moreStreak = 0; s.streak = null; return s }
  }
  // a search cut with candidates left that made progress: no strike (toolkit-03) -- SMELT_MORE_MAX in a row, then a backoff
  if (why === SMELT_SEARCH_MORE || why === SMELT_LATE) {
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
    // ironsmelt-01: the job's input (fe | cu | -; the balance fields below are in ITS family), the bag's own iron per name,
    // opening>closing, raw iron the bag fed the furnace (a bag delta), and the index rule-outs the job started with -- FIRST
    // after the stop, so the logger's 300-char cap (logger.mjs) can only ever cut the search tallies at the end (Codex code r1 P3)
    `stop=${v(f.stop)}`, `in=${v(f.in)}`, `fe=${v(f.fe)}`, `fed=${v(f.fed)}`, `ru=${v(f.ru)}`, `n=${v(f.n)}`, `bag0=${v(f.bag0)}`, `withdrawn=${v(f.withdrawn)}`, `coal=${v(f.coal)}`,
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
          `fuel=${v(f.fuel)}`, `taken=${v(f.taken)}`, `left=${v(f.left)}`, `t0=${v(f.t0)}`]
    // ledger-01: the station record of this drain's open (its id joins the record to this row for the L1 gate)
    .concat(f.ledger != null ? [`ledger=${v(f.ledger)}`] : []).join(' ')
}
