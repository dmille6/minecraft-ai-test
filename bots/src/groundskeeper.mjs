// GROUNDSKEEPER-01: ONE BOT A TOWN KEEPS THE GROUNDS (owner 11-02, ledger groundskeeper-1102). PURE: the switch, the keeper lease's
// decision, the stage clock and the visit's knobs. skills.mjs (shopActive, buildTidy) reads and writes the lease file.
//
// WHY (11-02 logs, 20 h, 215 tidy visits by 25 bots): tidy-01 is the LAST project any bot picks, so its visits are short and
// scattered -- 92 ended `deadline` (median 129 s, 1-5 blocks cut: the cuts were dug highest first across the whole square, a walk
// across town between two digs) and 89 `attempts_spent` (one open cell whose attempts were spent ended the whole visit). Three
// builders shared one clear lease. The owner wants ONE bot a town that tidies the town first and then works outward.
//
// THE LEASE (the yard clerk's pattern: one holder, a town file): `keeper` on the tidy's record key, GK.leaseTtlMs, renewed by
// every keeper visit. While a bot holds it the tidy is ITS first project (shopActive) and its order comes back every
// GK.cooldownMs instead of SHOP_COOLDOWN_MS (shop.mjs buildOrder). Only the holder works the tidy (TIDY builders 1 while the
// groundskeeper is on). It ROTATES: a holder whose term (GK.termMs since it took it) is over releases it and rests GK.restMs, so a
// town's bots take turns; a keeper that leaves town (an expedition, a death) lets it lapse. It RELEASES as soon as the grounds have
// no work (the last stage complete and nothing due), so it never holds a bot from the other projects for nothing.

import { tidyOn } from './tidy.mjs'

export const GK_LEASE = 'keeper'
export const GK = Object.freeze({ leaseTtlMs: 30 * 60_000, termMs: 4 * 60 * 60_000, restMs: 60 * 60_000, cooldownMs: 2 * 60_000, clearMax: 16, takeEveryMs: 5 * 60_000 })
/** THE SWITCH -> bool. GROUNDSKEEPER=on|off; unset = every NAMED pool the tidy is on in (tidy.mjs tidyOn: every fleet pool, not
 *  the showcase unless TIDY_POOLS names it); an unnamed pool (a test bot, a scratch run) keeps tidy-01's order. Off: tidy-01
 *  exactly as before (the last project, 3 builders, no stages). Pure. */
export function gkOn (env = process.env, pool = '') {
  const v = String(env?.GROUNDSKEEPER ?? '').trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  if (v === 'on' || v === '1' || v === 'true') return true
  if (!String(pool ?? '').trim()) return false
  return tidyOn(env, pool)
}

/**
 * THE KEEPER DECISION -> 'mine' (I hold it: work the grounds) | 'take' (it is free and I may take it) | 'release' (I hold it
 * and must let go: no work, or my term is over) | 'other' (another bot holds it) | 'none' (no keeper and none wanted now). Pure.
 *   lease   buildproj.mjs leaseState: { rec: { holder, at, meta: { term0 } }, holdsUntil, blocksUntil } | null
 *   work    does the town's tidy want a visit now (open, due, or a next stage)?
 *   restUntil  this bot rests from the lease until then (its last term ended)
 */
export function keeperDecision ({ lease = null, me, now = Date.now(), work = true, restUntil = 0, G = GK } = {}) {
  const live = !!lease && now < (lease.holdsUntil ?? 0)
  const holder = live ? lease.rec?.holder ?? null : null
  if (holder === me) {
    const term0 = Number(lease.rec?.meta?.term0 ?? lease.rec?.at)
    if (!work) return 'release'
    if (Number.isFinite(term0) && now - term0 >= G.termMs) return 'release'
    return 'mine'
  }
  // an unreadable lease (rec null with blocksUntil Infinity) reads as held: never two keepers
  if (live || (lease && now < (lease.blocksUntil ?? 0))) return 'other'
  if (!work || now < restUntil) return 'none'
  return 'take'
}
/** The term start a renewal carries on (the lease's own `meta.term0`, else its first `at`), or `now` for a new term. Pure. */
export const termStart = (lease, me, now = Date.now()) => (lease?.rec?.holder === me && now < (lease.holdsUntil ?? 0) ? Number(lease.rec?.meta?.term0 ?? lease.rec?.at ?? now) : now)

/**
 * THE KEEPER'S PROJECT ORDER -> { order, states } (activeProject's inputs). Pure. Nothing changes until the town's WORKSHOP stands
 * (a new town builds its first project with every bot: suite 11-02, a lone bot became keeper and tidied before any workshop). Then
 * for the KEEPER (`d` 'mine') the tidy comes first and a due stage reads open; for any other bot the tidy reads full (`free:
 * false`: the grounds are another's) and the other projects come first.
 */
export function keeperOrderPure (states, list, { d, shopPlot = 'shop', tidyPlot = 'tidy', crew = false, grounds = false } = {}) {
  const ti = states.findIndex(st => st.plot === tidyPlot)
  const tidyP = list.find(p => p.plot === tidyPlot)
  const shop = states.find(st => st.plot === shopPlot)
  // gkforever-01: a workshop that cannot be sited (idlework-01 B's `unsited`) never holds the grounds back (board-c, 11-06)
  const shopReady = !!(shop?.exists && shop?.complete) || (crew && !!shop?.unsited)
  if (ti < 0 || !tidyP || !shopReady) return { order: list, states }
  const out = states.slice()
  // gkforever-01 CREW: a bot on a GROUNDS lap (idlework.mjs) works the tidy first as the keeper does (its slot is the admission)
  if (d === 'mine' || (crew && grounds)) {
    if (out[ti].complete && out[ti].due) out[ti] = { ...out[ti], complete: false }
    return { order: [tidyP, ...list.filter(p => p.plot !== tidyPlot)], states: out }
  }
  // gkforever-01 CREW: any other bot sees the tidy as it is (LAST, its slots), never full for being another's
  if (crew) return { order: list, states: out }
  out[ti] = { ...out[ti], free: false }
  return { order: list, states: out }
}
/** Does the town want a keeper now (the workshop stands, the grounds want work)? Pure. */
export const keeperWanted = (states, { shopPlot = 'shop', tidyPlot = 'tidy', crew = false } = {}) => {
  const shop = states.find(st => st.plot === shopPlot), st = states.find(q => q.plot === tidyPlot)
  return (!!(shop?.exists && shop?.complete) || (crew && !!shop?.unsited)) && !!st && (!st.exists || !st.complete || !!st.damaged || !!st.due)
}

// ================================================================================================================================
// GKLEASE-01: A GROUNDS LEASE IS HELD BY A BOT THAT CAN WORK THE GROUNDS (coordinator 11-06 ~18:30Z; LIVE showcase batch15 17:09Z on:
// showcase-Kite took the keeper lease 18:14:52Z at y 14-17 mining iron, Alpha held it 17:12-18:14Z (two takes, the second after its
// own lapse) -- 0 tidy and 0 forest visits from 16:00Z to 18:20Z while forest-01 waited on its keeper). Over 30 h of the showcase
// (349,376 rows, 15 bots): 38 keeper takes, 11 with no grounds visit before the next take or 30 min, 6 holders below y 55 for most of
// the term; the fleet (3 h, 274,433 rows, 80 bots): 26 keeper takes, 7 with no grounds visit, 8 holders mostly below y 55. The lease
// was TAKEN in the order's read anywhere (in a mine, outside town), renewed only by a grounds visit, and -- a repair being first in
// activeProject -- the keeper's own order sent it to the town's other repairs instead of its grounds.
// THE RULES (pure; skills.mjs keeperOrder wires them):
//   1. FIT: a bot is fit to hold a grounds lease only at the town's surface: within GK_FIT.awayR and not deeper than GK_FIT.surfaceDy
//      under the town's ground. An unknown position is fit (never a release on a missing read).
//   2. A HOLDER that is unfit, or that has done no grounds work (a grounds visit that placed, cleared or gathered) for GK_FIT.idleMs
//      since the later of its term's start, its last grounds work and its spawn, RELEASES the lease and rests GK_FIT.restMs; an unfit
//      bot never TAKES it. A fit bot elsewhere takes it at its next order.
//   3. THE KEEPER'S GROUNDS FIRST: while the keeper's grounds want work, its own order reads the town's other repairs as upkeep (the
//      repair tier is every other bot's) -- else the keeper never reaches its tidy or forest.
// GKLEASE=off is the rollback (as before).
// ================================================================================================================================
export const GK_FIT = Object.freeze({ idleMs: 20 * 60_000, restMs: 30 * 60_000, surfaceDy: 8, awayR: 128 })
/** THE SWITCH -> bool. GKLEASE=on|off; unset = on wherever the groundskeeper is. Pure. */
export function gkleaseOn (env = process.env) {
  const v = String(env?.GKLEASE ?? '').trim().toLowerCase()
  return !['off', '0', 'false', 'no'].includes(v)
}
/** Why this bot cannot work the grounds from where it is -> 'underground' | 'away' | null. Pure.
 *  feet [x, y, z] | null; home { x, y, z } (y: the town's ground); townR the grounds' reach (horizontal; the forest lies outside the walls). */
export function groundsUnfit ({ feet = null, home = null, G = GK_FIT, townR = G.awayR } = {}) {
  if (!Array.isArray(feet) || !home || !feet.every(Number.isFinite) || !Number.isFinite(home.y)) return null
  if (Math.hypot(feet[0] - home.x, feet[2] - home.z) > townR) return 'away'
  if (feet[1] < home.y - G.surfaceDy) return 'underground'
  return null
}
/** Has the holder done no grounds work for G.idleMs? -> bool. Pure. The clock runs from the latest of the term's start, the last
 *  grounds work and the spawn (a restart grants a fresh window); an unknown term start is never idle. */
export function groundsIdle ({ term0 = null, workAt = null, spawnAt = null, now = Date.now(), G = GK_FIT } = {}) {
  const num = v => (v == null || v === '' ? NaN : Number(v))   // Number(null) is 0: the epoch, never a start
  if (!Number.isFinite(num(term0))) return false
  const t0 = Math.max(...[term0, workAt, spawnAt].map(num).filter(Number.isFinite))
  return now - t0 >= G.idleMs
}
/** THE HOLDER'S CHECK -> { release: why | null, take: bool }. Pure. `d` the lease decision (keeperDecision / helperDecision 'mine' |
 *  'take' | ...). A holder ('mine') unfit or idle releases (why: unfit's reason or 'no_work_visit'); a would-be taker ('take') that is
 *  unfit does not take. */
export function groundsLeaseCheck ({ d, unfit = null, idle = false } = {}) {
  if (d === 'mine') return { release: unfit ?? (idle ? 'no_work_visit' : null), take: false }
  if (d === 'take') return { release: null, take: !unfit }
  return { release: null, take: false }
}
/** RULE 3: the keeper's states with every OTHER complete project's damage read as upkeep (`due`), while its grounds want work. Pure. */
export function keeperGroundsFirst (states = [], { grounds = [] } = {}) {
  return states.map(st => (st && st.complete && st.damaged && !grounds.includes(st.plot) ? { ...st, damaged: false, due: true } : st))
}

// GKSTAY-01 (coordinator 11-06 ~00:00Z; LIVE after gklease-01): THE LEASE CHURNED. A keeper took the lease at the surface, the decision
// loop sent it below between grounds visits, and gklease released it at the first read below: showcase 9dfa85b9 22:56-23:57Z, 6 takes
// / 5 `why=underground` in 1.25 h and 1 grounds visit (the dips: `gather dirt` to y 50-54); fleet e447b65b, 1.18 h, 80 bots: 102 takes,
// 91 underground releases (the first skill below: `mine y=16` 9 -- idle_work's iron hint --, deep_mine 3, other mines 5, dirt 3).
// THE PERSISTENCE: a holder is released as unfit only once it has been unfit for GK_FIT.unfitMs without a break (a dirt pit or the
// stepwell's descent is no hand-off); a TAKE still needs the bot fit now.
export const UNFIT_HOLD_MS = 5 * 60_000
/** -> { since, held }: `since` the start of this unfit run (null when fit), `held` unfit for at least `ms`. Pure. */
export function unfitPersist (since, unfit, now = Date.now(), ms = UNFIT_HOLD_MS) {
  if (!unfit) return { since: null, held: false }
  const s = Number.isFinite(Number(since)) && since != null && since <= now ? Number(since) : now
  return { since: s, held: now - s >= ms }
}
