// TIDYFLOW-01 (tidyflow-01show; owner 11-16, the town's top complaint: "clean-up has not happened after 4-5 days of work"). PURE:
// nothing here reads a file or a world; skills.mjs (buildTidyVisit, tidyRefresh, the order's idle hook) wires it.
//
// WHY (LIVE showcase, 14 bots, 8 h to 11-16 18:00Z): 47 tidy visits laid 35 blocks and dug 0 cuts; 168 `deferred` rows; 28 visits
// ended `aborted`, 19 `deadline`; cuts left 493 of 2,432, fills left about 900-1,300 of 6,086. Four causes, each read in the code:
//   1. THE DRAW ATE THE CLOCK. A tidy visit has 120 s (the runner's 180 s abort less a 60 s tail) and the yard draw (up to 60 s:
//      Comet 16:43Z, `bill:25`, 4 cobblestone in 48 s) and the chest draw (30 s) ran first on every visit whose bill was not zero --
//      a bill of 25 means the bag already held 7 spare blocks, more than a visit lays (about 2.5 a minute). And once a draw had put
//      earth in the bag a worker's cuts went LAST (groundskeeper.mjs tidyShare), which no visit reached: 0 cuts in 8 h, though a cut
//      is the material.
//   2. THE REFRESH WAITED 13.5 h FOR AN HOURLY CLOCK (00:45Z, 14:19Z). Only the keeper's INSIDE-lane visit past its water walk ran
//      it, and a new keeper's first visit is the country's (its own process's hour, country.mjs groundsLane) and the water walk's.
//   3. THE KEEPER NEVER CAME BACK. That first visit, placing nothing, idle-marked the tidy for the bot an hour (shop.mjs noteIdle),
//      the order answered `idle`, and 20 minutes later the lease went `no_work_visit` (5 takes in 100 min) -- so nothing was waived.
//   4. THE STUCK REFLEX ENDED WORKING VISITS. A deferral costs no walk (the stand is computed), so a visit deferring cell after cell
//      stood still from its start and reflex.mjs stuckDecision aborted it at 35 s.
// WHAT (one switch each, default ON; off|0|false|no restores the visit exactly as it was):
//   TIDYFLOW_DRAW     drawPlan: no draw while the bag holds one visit's work (T.enough) or a cut waits for this bot (cuts first);
//                     stoneSkip: with the draw skipped, a staircase cell the bag has no stone for is passed, never `no_material`.
//   TIDYFLOW_REFRESH  refreshMay / keeperLane: a due refresh is the visit's FIRST act -- the keeper's (its lane the inside) or any
//                     worker's that is not a fall-through's late leg -- under one town lease (`refresh`), whose TTL is the retry
//                     back-off of a survey that keeps failing. The publish's own check stays the guard against a second writer.
//   TIDYFLOW_STILL    stillKeeper: every `_build` / `_build_seg` row declares the bot still for T.stillMs (never past the visit's
//                     deadline), given back when the visit ends however it ends. A visit that stops producing rows is still caught.
//   TIDYFLOW_KEEPER   keeperUnquiet: the keeper's order is not quiet while the inside record is open and the visit that marked it
//                     was a water walk or a country-lane visit.
//   TIDYFLOW_LONG     (owner 11-16: "can we just extend the visit time to like 10 min?") skillBudgetMs: the runner's abort for
//                     `build_shop` ALONE is SHOP_SKILL_MS (600 s) where every skill's is 180 s or more; visitBudgetMs: the TIDY visit
//                     works to it (540 s of work); headway: a visit that lays and digs nothing for T.idleMs, or T.idleRows rows in
//                     a row, ends itself `no_headway` -- an unproductive visit is as long as it was, a productive one goes on.

export const TIDYFLOW = Object.freeze({ enough: 8, stillMs: 20_000, lease: 'refresh', leaseMs: 10 * 60_000, surveyStillMs: 60_000,
  // TIDYFLOW_LONG: the long budget, the least base timeout it applies over (the suite's 300 ms and any short sandbox clock keep
  // their own), and the two bounds of a visit that makes no headway
  longMs: 600_000, longFloorMs: 180_000, idleMs: 120_000, idleRows: 12,
  // TIDYFLOW_ALLHANDS (owner 11-16: every bot on the town's land): the grounds' slots (the last one the keeper's), the country's,
  // and a worker's build-order cooldown after a grounds visit
  allBots: 12, allCountry: 8, allCooldownMs: 3 * 60_000,
  // review r2: the aborted grounds visits in a row that spend a worker's turns, for how long; and the storehouse's share (every
  // Nth visit all hands would take is the bot's own order's while the storehouse's ground is open)
  allAborts: 2, allAbortMs: 10 * 60_000, allShareEvery: 3 })
const isOff = v => /^(off|0|false|no)$/i.test(String(v ?? '').trim())
/** THE SWITCHES -> bool, each on unless its variable says off. Pure. */
export const flowDrawOn = (env = process.env) => !isOff(env?.TIDYFLOW_DRAW)
export const flowRefreshOn = (env = process.env) => !isOff(env?.TIDYFLOW_REFRESH)
export const flowStillOn = (env = process.env) => !isOff(env?.TIDYFLOW_STILL)
export const flowKeeperOn = (env = process.env) => !isOff(env?.TIDYFLOW_KEEPER)
export const flowLongOn = (env = process.env) => !isOff(env?.TIDYFLOW_LONG)
export const flowAllOn = (env = process.env) => !isOff(env?.TIDYFLOW_ALLHANDS)
export const flowShareOn = (env = process.env) => !isOff(env?.TIDYFLOW_ALLHANDS_SHARE)
/** The switches as this process read them at its start (skills.mjs reads these, as it reads TEMPSTAND and TOPDOWN). */
export const TFLOW = Object.freeze({ draw: flowDrawOn(), refresh: flowRefreshOn(), still: flowStillOn(), keeper: flowKeeperOn(), long: flowLongOn(), all: flowAllOn(), share: flowShareOn() })

const num = v => Math.max(0, Number(typeof v === 'function' ? v() : v) || 0)
const yes = v => !!(typeof v === 'function' ? v() : v)

// ---- 1. the draw ----------------------------------------------------------------------------------------------------------------
/**
 * DOES THIS VISIT DRAW ITS BILL? -> { skip, tag }. Pure. tag: null (switched off, or nothing open: the visit as before) |
 * 'skip:bag' | 'skip:cuts' | 'draw'.
 *   open        the visit's open earth fills (the bill's own count: never topsoil, lights, stairs or the park)
 *   openAccess  its open staircase cells (stone only)
 *   earth       what the bag SPARES that an earth fill takes (the bill's own read: the dirt its topsoil leaves, the cobblestone)
 *   stone       what it spares that a staircase takes
 *   cuts        the cuts this bot may dig now (a number, or a function asked only when the bag is short)
 *   clearFree   the one clear lease is free or this bot's (a bool, or a function asked only then)
 *   cutsDry     this bot's last cuts-first visit dug nothing (cutsDryAfter): its cuts are not counted, the draw is the remedy
 * The bag holds one visit's work -> no draw. Short, with a cut to dig -> no draw: the cuts go first and are the material. Short
 * with no cut (or a dry one) -> the draw, as before.
 */
export function drawPlan ({ on = true, open = 0, openAccess = 0, earth = 0, stone = 0, cuts = 0, clearFree = false, cutsDry = false, T = TIDYFLOW } = {}) {
  if (!on) return { skip: false, tag: null }
  const o = num(open), oa = num(openAccess)
  if (!o && !oa) return { skip: false, tag: null }
  const lack = o > 0 ? num(earth) < Math.min(o, T.enough) : num(stone) < Math.min(oa, T.enough)
  if (!lack) return { skip: true, tag: 'skip:bag' }
  if (!cutsDry && num(cuts) > 0 && yes(clearFree)) return { skip: true, tag: 'skip:cuts' }
  return { skip: false, tag: 'draw' }
}
/**
 * THE BILL OF A VISIT THAT DOES NOT DRAW -> the same object, trimmed in place. A WORKER's is emptied (its lights, topsoil and
 * plantings read done without their material: the visit's own skips); the KEEPER's keeps everything but the cobblestone (its
 * replants wait on their saplings: buildrun.mjs B4). Not skipped: untouched.
 */
export function billTrim (need, { skip = false, keeper = false } = {}) {
  if (!skip || !need) return need
  for (const k of Object.keys(need)) if (!keeper || k === 'cobblestone') delete need[k]
  return need
}
/** THE VISIT ROW'S `draw=` -> the plan's tag when skipped; else what the draws gave ('yard', 'chest', 'yard+chest', 'none'); null
 *  when the switch is off or nothing was open (no key on the row). Pure. */
export function drawTag (plan, { yard = 0, chest = 0 } = {}) {
  if (!plan?.tag) return null
  if (plan.skip) return plan.tag
  return [num(yard) > 0 ? 'yard' : null, num(chest) > 0 ? 'chest' : null].filter(Boolean).join('+') || 'none'
}
/** THE CUT/FILL SHARE OF A CUTS-FIRST VISIT -> the share with the cuts before the fills (groundskeeper.mjs tidyShare sends a
 *  worker's cuts last while a fill is ready: with one or two blocks in the bag the visit would lay them, end `no_material` and
 *  never dig). Any other plan: the share as it was. Pure. */
export const cutsFirst = (share, plan) => (plan?.tag === 'skip:cuts' ? { ...share, clearsLast: false } : share)
/**
 * WAS THE CUTS-FIRST VISIT DRY? -> the bot's next `cutsDry`. Pure. A visit that skipped its draw for the cuts and dug none (no
 * stand, water beside them, a body in the hollow) must not skip it again -- else "a cut is listed" and "no cut can be dug" compose
 * into a bot that never holds a block. A visit that dug, or that drew, clears it; any other visit leaves it as it was.
 */
export function cutsDryAfter (prev, plan, cleared = 0) {
  if (plan?.tag === 'skip:cuts') return !(num(cleared) > 0)
  if (plan?.tag === 'draw') return false
  return num(cleared) > 0 ? false : !!prev
}
/** A STAIRCASE CELL THE BAG HAS NO STONE FOR -> passed this visit (read done), as tidy.mjs soilSkip passes a topsoil cell. Pure.
 *  `has(name)`: the placer's own availability; `stone`: the staircase's palette. Asked only by a visit that skipped its draw. */
export function stoneSkip (q, has, stone = []) { return !!q && q.role === 'access' && !stone.some(n => has(n)) }

// ---- 2. the refresh -------------------------------------------------------------------------------------------------------------
/** IS THE TOWN'S REFRESH LEASE FREE? -> bool. Pure over buildproj.mjs leaseState's answer. Held by ANYONE -- this bot too -- it is
 *  not: a survey that failed is asked again when the lease lapses, never at every visit. Released (a refresh that published): free. */
export const refreshLeaseFree = (st, now = Date.now()) => !st || now >= (Number.isFinite(st.blocksUntil) ? st.blocksUntil : Infinity)
/**
 * MAY THIS VISIT RUN THE DUE REFRESH FIRST? -> { run, by: 'keeper' | 'worker' | null, why }. Pure.
 *   due   tidyrefresh.mjs refreshDue of the inside record        site  the visit holds the keeper lease (crewCaps.site)
 *   late  a fall-through's late leg (the skill's clock is half gone: grounds2.mjs groundsMayKeep's reason)
 *   free  refreshLeaseFree
 * why: 'off' | 'not_due' | 'late' | 'lease' | 'due'
 */
export function refreshMay ({ on = true, due = false, site = false, late = false, free = false } = {}) {
  const no = why => ({ run: false, by: null, why })
  if (!on) return no('off')
  if (!due) return no('not_due')
  if (late) return no('late')
  if (!free) return no('lease')
  return { run: true, by: site ? 'keeper' : 'worker', why: 'due' }
}
/** THE KEEPER'S LANE WITH A REFRESH TO RUN -> the inside (`refresh_due`); any other visit: country.mjs groundsLane's answer. Pure. */
export const keeperLane = (gl, { on = true, role = 'keeper', run = false } = {}) => (on && role === 'keeper' && run && gl?.lane === 'country' ? { lane: 'inside', why: 'refresh_due' } : gl)

// ---- 3. the heartbeat -----------------------------------------------------------------------------------------------------------
/** THE DECLARED WINDOW AFTER A ROW -> ms (epoch): `ms` from now, never past the visit's deadline, never shorter than one already
 *  declared. Pure. A deadline that is not a number bounds nothing (the window is `ms` long and lapses by itself). */
export function stillUntil ({ cur = 0, now = Date.now(), deadline = Infinity, ms = TIDYFLOW.stillMs } = {}) {
  const until = Math.min(now + ms, Number.isFinite(deadline) ? deadline : now + ms)
  return Math.max(Number(cur) || 0, until)
}
/**
 * THE VISIT'S HEARTBEAT -> { beat(now?), end() }. `beat` declares the bot still (bot.stationaryUntil: reflex.mjs stuckDecision's
 * declared window) after a row; `end` gives back this visit's own declaration and never another's (a longer one made since
 * stands). Off, or no bot: both do nothing.
 */
export function stillKeeper (bot, { on = true, deadline = Infinity, ms = TIDYFLOW.stillMs } = {}) {
  let mine = null
  return {
    beat (now = Date.now()) {
      if (!on || !bot) return null
      const v = stillUntil({ cur: bot.stationaryUntil, now, deadline, ms })
      if (v !== (Number(bot.stationaryUntil) || 0)) { bot.stationaryUntil = v; mine = v }
      return v
    },
    end () { if (bot && mine != null && bot.stationaryUntil === mine) bot.stationaryUntil = 0; mine = null },
  }
}

// ---- 4. the keeper's order ------------------------------------------------------------------------------------------------------
/**
 * IS THE KEEPER'S IDLE MARK NO REASON TO BE QUIET? -> bool (shop.mjs tidyQuiet's `flow`). Pure.
 *   keeper  this bot holds the keeper lease itself        open  the inside record is open
 *   last    its last tidy visit: { crew, lane, outcome } (skills.mjs buildTidyVisit writes it at every visit's end)
 * True only for the mark a keeper's water walk or country-lane visit left: neither says the INSIDE has no work for it.
 */
export function keeperUnquiet ({ on = true, keeper = false, open = false, last = null } = {}) {
  if (!on || !keeper || !open || !last || last.crew !== 'keeper') return false
  return last.outcome === 'waterwalk' || last.lane === 'country'
}

// ---- 5. the long visit ----------------------------------------------------------------------------------------------------------
/**
 * THE RUNNER'S TIMEOUT FOR A SKILL -> ms (runner.mjs: its abort, and the hard stop after it). Pure. `base` is every skill's
 * (config.skills.defaultTimeoutMs, 180 s on the showcase); `build_shop` alone gets T.longMs, and only where the base is a
 * production clock (>= T.longFloorMs): a short one (the suite's 300 ms) is every skill's, build_shop's too. Never shorter than base.
 */
export function skillBudgetMs (skill, { on = TFLOW.long, base = 0, T = TIDYFLOW } = {}) {
  const b = Number(base)
  if (!on || skill !== 'build_shop' || !(b >= T.longFloorMs)) return b
  return Math.max(b, T.longMs)
}
/**
 * THE TIDY VISIT'S BUDGET -> ms. Pure. `cap`: shop.mjs SHOP_SKILL_MS; `late`: a fall-through's late leg (its clock is what the
 * FIRST project's visit left of the base budget: grounds2.mjs groundsFall counted on 180 s) keeps the base. Off: min(cap, base).
 */
export function visitBudgetMs ({ on = TFLOW.long, base = 0, cap = Infinity, late = false, T = TIDYFLOW } = {}) {
  return Math.min(cap, late ? Number(base) : skillBudgetMs('build_shop', { on, base, T }))
}
/** The `_build` rows that are work done (a block laid, dug or planted): they restart the visit's headway clock. */
const GAIN_OPS = new Set(['place', 'clear', 'replant', 'fell', 'access_done'])
/** A `fell` ROW THAT FELLED NOTHING IS NO WORK (Codex r2 on the review fixes): buildrun.mjs writes one whenever a trunk stands over
 *  the cell, `n: 0` when its first dig did not land -- a blocked tree tried again and again changed no block. Every other work row
 *  is written only after its block read placed or dug. Pure. */
const fellNone = (op, n) => String(op) === 'fell' && !(Number(n) > 0)
/**
 * THE VISIT'S HEADWAY -> { row(op, now?, count?), over(now?), rows() }. `row` after every `_build` row (`count`: the row's `n`); `over` -> has the visit gone
 * T.idleMs, or T.idleRows rows in a row, with nothing laid, dug or planted (buildrun.mjs runVisit asks it at every step: `p.giveUp`
 * -> the visit ends `no_headway`)? Off: never over (the visit as it was). The clock starts at `start`.
 */
export function headway ({ on = true, start = Date.now(), T = TIDYFLOW } = {}) {
  let last = start, n = 0
  return {
    row (op, now = Date.now(), count = undefined) { if (GAIN_OPS.has(String(op)) && !fellNone(op, count)) { last = now; n = 0 } else n++ },
    over (now = Date.now()) { return !!on && (n >= T.idleRows || now - last >= T.idleMs) },
    rows: () => n,
  }
}

// ---- 6. all hands ---------------------------------------------------------------------------------------------------------------
/**
 * IS THIS BUILD VISIT THE GROUNDS' THOUGH THE SHARE SAYS NOT? -> bool. Pure. TIDYFLOW_ALLHANDS (owner 11-16 "lets do that ... make
 * that the current project"): while the tidy record is open EVERY build visit of a bot is a grounds visit first -- except while a
 * finished building stands damaged or a service plot is offered to this bot: then the share as before (grounds2.mjs groundsTurn:
 * every second visit above 500 open cells), so a repair and a service keep their turns. The visit's other links (the keeper, the
 * decorator, the spent turns, a bot underground or away, a slot) are asked after it, as for any grounds visit (groundsOnly).
 */
export const allTurn = ({ on = true, record = 'none', repair = false, service = false } = {}) => !!on && record === 'open' && !repair && !service
/** THE SLOTS UNDER ALL HANDS -> int: `all` (TIDYFLOW.allBots on the grounds, allCountry on the country) in place of the base cap.
 *  Off: the base number itself. Pure. */
export const allCap = (base, all, on = true) => (on ? Math.max(Number(base) || 0, Number(all) || 0) : base)
/** A WORKER'S BUILD-ORDER COOLDOWN AFTER A GROUNDS VISIT -> ms | null (the order's own). Pure. Only when its last build visit was
 *  the grounds' and its turns are not spent (the 10-minute back-off of a visit that fixed nothing stays the order's own rhythm). */
export const allCooldown = ({ on = true, lastGrounds = false, spent = false, T = TIDYFLOW } = {}) => (on && lastGrounds && !spent ? T.allCooldownMs : null)

// ---- 7. review r2 (11-17): three dead ends two correct rules composed into, and the storehouse's share -------------------------
/** The `_build` rows that are a block laid, dug, planted or felled -- and nothing else (`access_done` is a segment's note). */
const WORK_OPS = new Set(['place', 'clear', 'replant', 'fell'])
/** IS THIS ROW WORK THE STAGNATION WATCHDOG MUST SEE? -> bool. Pure. Placing is no progress to it (watchdog.mjs: the bag's count
 *  falls, the bot stands in one segment), so a long fill visit met all three of its tests while laying blocks. `count`: the row's
 *  `n` (a `fell` row counts only the logs it felled: fellNone). */
export const workRow = (op, count = undefined) => WORK_OPS.has(String(op)) && !fellNone(op, count)
/**
 * THE WATCHDOG'S SAMPLES SINCE THE LAST WORK ROW -> the samples at or after `gainAt` (the same array when there is no mark, the
 * mark is not a time, or it lies in the future). Pure. A visit that lays or digs a block starts the watchdog's window again, as a
 * rescue's start does; one that stops gaining is judged a full window after its last block (longer than headway's T.idleMs, so a
 * visit with no headway ends itself first), and the runner's abort stands whatever the rows say.
 */
export function sinceGain (samples = [], gainAt = 0, now = Date.now()) {
  const g = Number(gainAt)
  if (!(g > 0) || g > now) return samples
  return samples.some(s => s.t < g) ? samples.filter(s => s.t >= g) : samples
}
/**
 * A STAIRCASE CELL PASSED FOR WANT OF STONE IS NOT "LEFT" -> the fillDone of the LEFT COUNT alone (gkwork.mjs leftVisit: three
 * visits town-wide that ran out of work with a cell still open waive it for good). Pure. A visit that skipped its draw reads such
 * a cell done inside runVisit (stoneSkip) and can end `complete`; the cell is open work still (the completion's own fillDone never
 * names it), but one empty bag is no evidence nobody can lay it. `passed`: the visit's own stoneSkip.
 */
export const leftDone = (fillDone, passed) => q => !!fillDone(q) || !!passed(q)
/**
 * AFTER A GROUNDS VISIT UNDER ALL HANDS -> { n, emptyUntil }. Pure. An aborted visit is "not evidence" to grounds2.mjs groundsAfter
 * (its counts never came back), so a worker whose grounds visits abort every time never spent its turns and, every off-turn visit
 * being the grounds', never reached its own project. T.allAborts aborted grounds visits IN A ROW spend the turns T.allAbortMs (the
 * order's own project gets them: groundsWork's `spent` link); a grounds visit that ended by itself starts the count again; a visit
 * to another project, the keeper's, and the switch off change nothing.
 */
export function abortsAfter ({ on = true, took = 'other', keeper = false, aborted = false, n = 0, emptyUntil = 0, now = Date.now(), T = TIDYFLOW } = {}) {
  const e = Number(emptyUntil) || 0, c = Math.max(0, Number(n) || 0)
  if (!on || keeper || took !== 'tidy') return { n: c, emptyUntil: e }
  if (!aborted) return { n: 0, emptyUntil: e }
  return c + 1 >= T.allAborts ? { n: 0, emptyUntil: Math.max(e, now + T.allAbortMs) } : { n: c + 1, emptyUntil: e }
}
/**
 * THE STOREHOUSE'S SHARE UNDER ALL HANDS (owner 11-17) -> { own, n }. Pure. While the storehouse's ground is an open project
 * (`open`), every T.allShareEvery-th build visit that all hands would take from a bot's own order is left to that order; `n` is
 * the bot's count of visits taken since (the caller keeps it). Not open, or off: never, and the count starts again.
 */
export function allShare ({ on = true, open = false, n = 0, T = TIDYFLOW } = {}) {
  if (!on || !open) return { own: false, n: 0 }
  const k = Math.max(0, Number(n) || 0) + 1
  return k >= T.allShareEvery ? { own: true, n: 0 } : { own: false, n: k }
}

/** `_tidyflow`: the licence row, once at spawn (each switch 0|1: a rollback is visible too). Pure. */
export const flowModeDetail = (F = TFLOW, T = TIDYFLOW) => `v=1 draw=${F.draw ? 1 : 0} refresh=${F.refresh ? 1 : 0} still=${F.still ? 1 : 0} keeper=${F.keeper ? 1 : 0} long=${F.long ? 1 : 0} all=${F.all ? 1 : 0} enough=${T.enough} still_ms=${T.stillMs} lease_ms=${T.leaseMs} long_ms=${T.longMs} idle_ms=${T.idleMs} idle_rows=${T.idleRows} all_bots=${T.allBots} all_country=${T.allCountry} all_cooldown_ms=${T.allCooldownMs} share=${F.share ? 1 : 0} share_every=${T.allShareEvery} all_aborts=${T.allAborts}`
