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
