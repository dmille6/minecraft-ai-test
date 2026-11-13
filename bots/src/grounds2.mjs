// GROUNDS-01 (owner 11-12: "is there a better approach to grounds keeping ... lets get this working we've been fighting it for
// days"): CLEANUP IS ORDINARY, FUNDED PROJECT WORK. PURE: the switch, the share, the turn, who may work, what a visit found, the
// stairs' place in a visit, the proof row. skills.mjs (buildShop, buildShopVisit, shopActive, keeperOrder, buildTidyVisit) wires them.
//
// WHY (LIVE showcase, 14 bots, 24 h to 11-12 13:39Z, 333,896 rows = 20,160 bot-minutes): the tidy got 218 bot-minutes (1.1%) in 131 of
// 963 build visits and fixed 269 cells, while about 4,000 stray blocks and holes appeared; its backlog (fills left 2,431 of 4,751,
// cuts left 496 of 2,110) GREW by about 380 cells. 49 of the 131 visits ended `helper_idle` (72 min, 0 cells); the 45 that ended
// `deadline` did the work (240 cells, about 2.5 a minute -- the deadline is the skill's own, so a visit cannot be longer: the lever
// is MORE visits by MORE bots). The keeper lease was let go 63 times (32 underground, 31 no_work_visit), helper leases 78 times (73
// idle). Only a lease holder could work the grounds at all, and the lease rules were patched eight times (gkstage, gkclear, gkroom,
// gkleft, gkcrewcut, gklease, gkstay, gkwork, fillshare) without moving those totals. This is not a ninth patch to them.
//
// THE SHAPE.
//   1. NO ROLE GATE FOR THE WORK. Any builder at the town's surface works the tidy record's segments and cuts as a WORKER: no lease
//      of its own, no rest, no release. What keeps two bots apart stays: the project's admission slots (GROUNDS2.maxBots), the
//      segment leases, the one clear lease, the segment gap (groundskeeper.mjs crewSegOk / crewYield). The KEEPER lease stays for what
//      one holder must do -- the survey and its refresh, every publish (waivers, completion, replants, plan additions, site preps),
//      the forest, the water walk, the country's siting -- with its rules as they are. The helper leases are not taken.
//   2. A GUARANTEED SHARE, decided in code: while the tidy has more than GROUNDS2.big open cells every SECOND build_shop visit of a
//      bot is the grounds'; while more than GROUNDS2.small every FOURTH; below that the order as before. Counted per bot, in memory.
//      A grounds visit that placed and cleared nothing spends that bot's turns for GROUNDS2.emptyMs (never a loop of empty visits).
//   3. STAIRS FIRST: a staircase segment (role `access`: tidy.mjs climbSpots / spotStair) open and ready goes before the plain fills
//      and the cuts -- while the bag holds its stone (without it the survey's order stands: stairsFirst).
// THE CHAINS (each tested as a chain, bots/test/grounds2.test.mjs): a turn with no fill material digs the cuts; one that fixed
// nothing spends the turns 10 minutes; a bot underground or away, a record complete, absent or stuck, four bots on the grounds, or
// nothing ready for this bot (groundsNone) all fall back to the ORDER in the same visit -- never a refusal; and a quota visit's stop
// reaches the order as `grounds_turn` (groundsResult), so the order's own back-offs (stuck_on_cell: 6 h) are never tripped by it.
// GROUNDS2=off|0|false|no restores the keeper and its helpers exactly.
// GROUNDS-03 (below, at its own heading): cleanup as the TRUE FALLBACK -- a visit whose own project had nothing for the bot goes on to
// the grounds, and a bot the order has nothing for is offered them. GROUNDSFALL=off restores grounds-01/02 exactly.

import { GK_FIT, groundsUnfit } from './groundskeeper.mjs'
import { pantrySum } from './park.mjs'

export const GROUNDS2 = Object.freeze({ big: 500, small: 100, shareBig: 2, shareSmall: 4, emptyMs: 10 * 60_000, maxBots: 4, workerLiveMs: 45 * 60_000, stuckMin: 6 })
/** THE SWITCH -> bool. On unless GROUNDS2 says off. Pure. */
export const grounds2On = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.GROUNDS2 ?? '').trim().toLowerCase())

/** THE SHARE -> 2 (every second build visit) | 4 (every fourth) | 0 (no turn: the order as before). Pure. `open` the tidy's open
 *  cells (fills left + cuts left: the newest visit's own count); unknown reads 0 -- a count nobody wrote funds nothing. */
export function groundsShare (open, G = GROUNDS2) {
  if (open == null || open === '') return 0
  const n = Number(open)
  if (!Number.isFinite(n)) return 0
  return n > G.big ? G.shareBig : n > G.small ? G.shareSmall : 0
}
/**
 * IS THIS BUILD VISIT THE GROUNDS' TURN? -> { share, due, why }. Pure.
 *   turn        this bot's build_shop visits so far, this one counted (1, 2, 3, ...)
 *   emptyUntil  this bot's turns are spent until then (its last grounds visit fixed nothing)
 * why: 'turn' | 'low' (no share at this backlog) | 'open_unknown' | 'off_turn' | 'spent'
 */
export function groundsTurn ({ turn = 0, open = null, emptyUntil = 0, carrying = false, now = Date.now(), G = GROUNDS2 } = {}) {
  // A CARRIER KEEPS ITS TURN (review r2, Codex BLOCKER): a bot whose bag holds the park's plants comes back every second build
  // visit however small the backlog -- below G.small the share is 0, its quota visits stopped, its pantry (written only by a
  // grounds visit) went stale after G.workerLiveMs, and the keeper closed the stage `no_flowers` while it still carried them.
  // Each of its visits writes the pantry again (well inside the window); one that plants nothing spends the turns G.emptyMs.
  const own = groundsShare(open, G)
  const share = own || (carrying ? G.shareBig : 0)
  if (!share) return { share, due: false, why: open == null || open === '' || !Number.isFinite(Number(open)) ? 'open_unknown' : 'low' }
  const t = Number(turn)
  if (!(Number.isInteger(t) && t > 0 && t % share === 0)) return { share, due: false, why: 'off_turn' }
  if (now < (Number(emptyUntil) || 0)) return { share, due: false, why: 'spent' }
  return { share, due: true, why: own ? 'turn' : 'carry' }
}
/**
 * MAY THIS BOT WORK THE GROUNDS FROM WHERE IT STANDS? -> { ok, why: null | 'underground' | 'away' | 'unknown' }. Pure. The grounds'
 * own fitness test (groundskeeper.mjs groundsUnfit: within GK_FIT.awayR of home, not deeper than GK_FIT.surfaceDy under the town's
 * ground). An unknown position is NOT eligible: nothing is refused and no lease is touched -- the bot's order is simply as before.
 */
export function groundsEligible ({ feet = null, home = null, G = GK_FIT } = {}) {
  if (!Array.isArray(feet) || feet.length < 3 || !feet.every(Number.isFinite) || !home || ![home.x, home.y, home.z].every(Number.isFinite)) return { ok: false, why: 'unknown' }
  const why = groundsUnfit({ feet, home, G })
  return { ok: !why, why }
}
/**
 * THE TIDY RECORD AS THE QUOTA READS IT -> 'open' (work a worker may do) | 'no_workshop' (a new town builds its workshop with every
 * bot first: groundskeeper.mjs keeperOrderPure's rule) | 'unreadable' | 'none' (not surveyed yet: the keeper's) | 'complete'
 * (nothing open; its next survey or stage is the keeper's to site) | 'stuck' (the project's own stuck back-off holds it: every open
 * segment waits on a cell no stand reached -- the give-up rule is the project's, as before). Pure.
 *   shopDone  the workshop's record reads complete      readable  the tidy's chain could be read      rec  its head record | null
 *   stuck     the order's stuck back-off reads live for the tidy (shop.mjs stuckBackoff)
 */
export function groundsRecord ({ shopDone = false, readable = true, rec = null, stuck = false } = {}) {
  if (!shopDone) return 'no_workshop'
  if (!readable) return 'unreadable'
  if (!rec) return 'none'
  if (rec.structure_complete) return 'complete'
  return stuck ? 'stuck' : 'open'
}
/**
 * THE VISIT'S DECISION -> { took: 'tidy' | 'other', why, share, due }. Pure. `took: 'tidy'` only when every link holds; any other
 * answer is the order as before -- never a refusal, never a lease.
 *   on       the switch (and the groundskeeper's)          keeper    this bot holds the keeper lease (its order is its own)
 *   decor    it holds the decorator lease (one role a bot)  record    groundsRecord's answer
 *   slotFree the tidy has an admission slot for this bot now
 * why: 'turn' | 'off' | 'keeper' | 'decor' | 'record_<state>' | groundsTurn's | 'underground' | 'away' | 'unknown' | 'full'
 */
export function groundsDecide ({ on = true, keeper = false, decor = false, record = 'none', open = null, turn = 0, emptyUntil = 0, carrying = false, feet = null, home = null, slotFree = true, now = Date.now(), G = GROUNDS2 } = {}) {
  const other = (why, share = 0) => ({ took: 'other', why, share, due: false })
  if (!on) return other('off')
  if (keeper) return other('keeper')
  if (decor) return other('decor')
  if (record !== 'open') return other(`record_${record}`)
  const t = groundsTurn({ turn, open, emptyUntil, carrying, now, G })
  if (!t.due) return other(t.why, t.share)
  const e = groundsEligible({ feet, home })
  if (!e.ok) return { took: 'other', why: e.why, share: t.share, due: true }
  if (!slotFree) return { took: 'other', why: 'full', share: t.share, due: true }
  return { took: 'tidy', why: t.why, share: t.share, due: true }
}
/** THE ORDER'S READ OF A BOT THAT DOES NOT KEEP THE GROUNDS -> keeperOrderPure's `d`: 'helper' (the tidy in its own place, with a
 *  slot) for a bot that may work them from here, 'none' (the tidy reads full: nothing offered, nothing refused) for any other. Pure. */
export const groundsOrderD = (d, eligible) => (d === 'mine' ? 'mine' : eligible ? 'helper' : 'none')
/** THE VISIT'S ROLE -> 'keeper' (it holds the lease: the plan is its) | 'worker'. Pure. `kept`: the keeper lease was renewed or
 *  taken by this visit. */
export const groundsRole = ({ d, kept = false } = {}) => ((d === 'mine' || d === 'take') && kept ? 'keeper' : 'worker')
/**
 * The tidy's admission slots under grounds-01 -> int: at most GROUNDS2.maxBots bots on the grounds at once, and THE LAST SLOT IS
 * THE KEEPER'S (review r1, Claude BLOCKER: with four slots anyone could take, four workers on their quota turns held them all; the
 * keeper's visit ended `slots_full` before the waivers, the strike close-out, the completion and the plantings only it may do,
 * and after 20 idle minutes it let its lease go -- the cells only it can waive then held every segment open). A WORKER counts one
 * slot fewer, so slot N is never a worker's and the keeper always finds one. Pure.
 */
export const groundsSlots = (n, { worker = false, G = GROUNDS2 } = {}) => workerSlots(Math.max(1, Math.min(Number(n) > 0 ? Number(n) : G.maxBots, G.maxBots)), worker)
/** A lane's slots as a WORKER counts them -> one fewer, never below one; the keeper counts them all. Pure. The country lane's too
 *  (review r2, Codex BLOCKER: its three slots were anyone's, so three workers there locked the keeper out the same way). */
export const workerSlots = (n, worker = false) => { const all = Math.max(1, Number(n) || 1); return worker ? Math.max(1, all - 1) : all }
/**
 * HAS A QUOTA VISIT NOTHING READY FOR THIS BOT NOW? -> bool. Pure. Nothing: no fill segment it may take (every open one held, within
 * the gap of another bot's, or waiting on a layer below) AND no cut it may dig (none listed for it, or the one clear lease is
 * another's). Such a turn goes back to the order before a block is drawn or a step walked.
 */
export const groundsNone = ({ seg = null, cuts = 0, clearFree = true } = {}) => seg == null && !((Number(cuts) || 0) > 0 && !!clearFree)
/** The stops of a grounds visit that never started (turned away before any work): the quota's turn goes on to the order. */
export const GROUNDS_PASS = Object.freeze(['grounds_none', 'slots_full', 'keeper_held', 'record_unreadable'])
/** DID THE QUOTA'S GROUNDS VISIT NOT HAPPEN? -> bool. Pure. */
export const groundsPassed = r => !!r && r.status === 'no_effect' && GROUNDS_PASS.includes(String(r.stop ?? ''))
/**
 * THE QUOTA VISIT'S RESULT AS THE ORDER SEES IT -> the result, its stop `grounds_turn`. Pure. The order's back-offs read the LAST
 * build visit's stop (cognitive.mjs shopState.lastStop -> shop.mjs buildOrder): `stuck_on_cell` holds the bot's whole build order
 * SHOP_STUCK_RETRY_MS (6 h), `no_material` and `keeper_held` read the town as having no use for the bot (an expedition), `no_site`
 * holds an unsited project's retry. Those are remedies for the order's OWN project; a quota visit's stop must never trip them --
 * else two correct rules (the quota, the back-off) compose into a bot that stops building.
 */
export const GROUNDS_STOP = 'grounds_turn'
export const groundsResult = r => (r && typeof r === 'object' ? { ...r, stop: GROUNDS_STOP } : r)
/**
 * AFTER THE VISIT -> { empty, emptyUntil }. Pure. EMPTY: a grounds visit that ran and fixed nothing (0 placed, 0 cleared); it spends
 * this bot's turns for G.emptyMs. An interrupted visit is not evidence (its counts never came back): never empty. A visit to
 * another project, and the keeper's own, change nothing.
 */
export function groundsAfter ({ took = 'other', keeper = false, aborted = false, placed = 0, cleared = 0, emptyUntil = 0, now = Date.now(), G = GROUNDS2 } = {}) {
  const empty = took === 'tidy' && !aborted && !((Number(placed) || 0) > 0) && !((Number(cleared) || 0) > 0)
  return { empty, emptyUntil: empty && !keeper ? now + G.emptyMs : Number(emptyUntil) || 0 }
}

// ================================================================================================================================
// GROUNDS-03 (owner 11-12: "when all projects are complete, bots should be cleaning up and teraforming"; and "yes, lets do both" to
// making cleanup the true fallback): THE GROUNDS ARE WHERE A BUILD VISIT GOES WHEN ITS OWN PROJECT HAS NOTHING FOR THE BOT.
// WHY (LIVE showcase, 14 bots, 24 h to 11-12 17:00Z): 24 of 32 projects complete and the open ones mostly blocked -- the stepwell
// (2,168 cells, 0 placed, its record unchanged 92 h), the pens and a civic building (37 and 25 visits, every one `no_site`), the
// country (49 visits, 0 placed), the wood (64 of 66 visits to the time limit, 6 blocks). Of 1,270 build_shop runs 625 ended
// `no_effect` and 190 `success`: a visit that ended no_site / no_material / stuck_on_cell / complete simply ENDED, beside a tidy
// with about 2,900 open cells that grounds-01 funds only every second visit (3.7% of bot time in its first hour).
// THE SHAPE (skills.mjs buildShop / buildShopVisit / groundsBegin / groundsAsk wire it; shop.mjs buildOrder asks):
//   1. FALL THROUGH, THE SAME VISIT (groundsFall): the order's own project ended with NO WORK DONE on a stop that says "nothing here
//      for this bot now" (FALL_STOPS) and the skill's clock still holds a worker's visit -> the visit goes on to the grounds as a
//      WORKER (grounds-01's path: groundsEligible, the worker's slots, groundsNone's turn-back).
//   2. THE FIRST PROJECT'S STOP STILL REACHES THE ORDER: the visit's result is the first project's (its back-offs are its own:
//      stuck_on_cell 6 h, no_site a day); what the grounds did is the `_grounds_quota` row's (`why=fallback:<stop>`). The opposite
//      of the quota's rule (groundsResult), for the opposite reason.
//   3. NO ORDER -> THE GROUNDS (groundsNoOrder): where the order has nothing for the bot (NO_ORDER_SKIPS: complete, its back-off
//      holding, unsited and waiting, full) an eligible bot is ordered to the grounds at every cooldown, not every second visit.
//      Such a visit's stop is hidden from the order (`grounds_turn`) AND the back-off it ran under is kept (groundsHold): the
//      order's state holds one last stop, so without the hold the first grounds visit would erase a 6-hour back-off in 10 minutes.
//   4. THE EMPTY RULE HOLDS for all three (groundsAfter -> emptyUntil -> groundsWork `spent`): a grounds visit that fixed nothing
//      spends the bot's turns G.emptyMs -- no quota turn, no fall-through, no order for the grounds until then.
// GROUNDSFALL=off|0|false|no: none of it (grounds-01/02 exactly). It acts only where GROUNDS2 is on.
// ================================================================================================================================
/** workMs: the least WORK a fall-through must have left -- one bounded walk to a stand (buildbot.mjs PATH_MS, 25 s) and its click. */
export const GROUNDS3 = Object.freeze({ workMs: 30_000 })
/** THE SWITCH -> bool. On unless GROUNDSFALL says off. Pure. */
export const groundsFallOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.GROUNDSFALL ?? '').trim().toLowerCase())
/**
 * THE STOPS THAT MEAN "THIS PROJECT HAS NOTHING FOR THIS BOT NOW" (an allow-list: a stop not named here never falls through).
 *   unsited, or waiting on its opening:   no_site site_wait paths_no_site copper_wait waiting changed retiring stopped
 *   nothing to place with:                no_material no_tool
 *   no cell this bot can work now:        stuck_on_cell cell_deferred deps_open body_wait felling_one leaf_decay zone_closed
 *   another bot's:                        slots_full keeper_held not_decorator
 *   nothing open:                         complete upkeep
 * NOT here, each for its reason: `deadline` / `time` (the visit used its time); `aborted`, `error` and every failed visit (an
 * interruption is the runner's to see); `record_unreadable`, `lost_record`, `lost_lease`, `state_unwritable`, `site_unread`,
 * `zones_unknown`, `no_plan`, `off`, `fence:*` (a town file or switch the tidy reads too: no evidence the project has no work);
 * `replanned`, `replant_wait`, `land_planned`, `land_unplanned` (a plan step: the next visit goes on with it); the town stair's
 * own stops and the expedition's (the bot may be underground or away, and they are their own visits); `grounds_none`,
 * `grounds_turn` and every stop of the tidy itself (the visit WAS the grounds').
 */
export const FALL_STOPS = Object.freeze(['no_site', 'site_wait', 'paths_no_site', 'copper_wait', 'waiting', 'changed', 'retiring', 'stopped',
  'no_material', 'no_tool', 'stuck_on_cell', 'cell_deferred', 'deps_open', 'body_wait', 'felling_one', 'slots_full', 'keeper_held', 'not_decorator', 'complete', 'upkeep',
  // leaffell-01show r1: the visit's two waiting stops (buildrun.mjs runVisit: every open cell left waits on leaves that decay, or is
  // closed by a protected zone) -- nothing here for this bot now
  'leaf_decay', 'zone_closed'])
export const fallStops = stop => FALL_STOPS.includes(String(stop ?? ''))
/**
 * MAY THIS BOT WORK THE GROUNDS NOW, WHATEVER BROUGHT IT? -> { ok, why }. Pure. groundsDecide's links without the turn: the fall-
 * through and the order's ask have no share to wait for. why: 'off' | 'keeper' (its order is its own) | 'decor' | 'record_<state>'
 * | 'spent' (its last grounds visit fixed nothing: G.emptyMs) | 'underground' | 'away' | 'unknown' | 'full'.
 */
export function groundsWork ({ on = true, keeper = false, decor = false, record = 'none', emptyUntil = 0, feet = null, home = null, slotFree = true, now = Date.now() } = {}) {
  const no = why => ({ ok: false, why })
  if (!on) return no('off')
  if (keeper) return no('keeper')
  if (decor) return no('decor')
  if (record !== 'open') return no(`record_${record}`)
  if (now < (Number(emptyUntil) || 0)) return no('spent')
  const e = groundsEligible({ feet, home })
  if (!e.ok) return no(e.why)
  if (!slotFree) return no('full')
  return { ok: true, why: null }
}
/**
 * DOES THIS VISIT GO ON TO THE GROUNDS? -> { fall, why, asked }. Pure.
 *   status, stop      the first project's result           placed, cleared, planted   what it did (any of them: it worked)
 *   grounds           the visit was the grounds' already (the order's own pick, a quota turn, an order for them)
 *   passed            its quota turn was turned away moments ago (groundsPassed): the grounds have nothing ready, not asked twice
 *   msLeft, tailMs    the skill's clock left, and the tail a tidy visit keeps free of it (skills.mjs ZIG_VISIT_TAIL_MS, 60 s)
 *   ...links          groundsWork's
 * THE TIME: msLeft - tailMs is the work a grounds visit would get (its deadline is the SKILL's end less the tail, not a new 180 s);
 * under G.workMs (30 s: one bounded walk to a stand, 25 s, and its click) it would walk and place nothing, read EMPTY and spend the
 * bot's turns 10 minutes for a visit that never had the time -- so at least 90 s of the 180 must be left.
 * `asked`: the project had nothing for the bot (the row names why the grounds did not follow: `fall=<why>`).
 * why: `fallback:<stop>` | 'off' | 'grounds' | 'worked' | 'stop' | 'passed' | 'short' | groundsWork's
 */
export function groundsFall ({ on = true, status = null, stop = null, placed = 0, cleared = 0, planted = 0, grounds = false, passed = false, msLeft = 0, tailMs = 60_000, G = GROUNDS3, ...links } = {}) {
  const no = (why, asked = false) => ({ fall: false, why, asked })
  if (!on) return no('off')
  if (grounds) return no('grounds')
  if (status !== 'no_effect' || [placed, cleared, planted].some(n => (Number(n) || 0) > 0)) return no('worked')
  if (!fallStops(stop)) return no('stop')
  if (passed) return no('passed', true)
  if (!(Number(msLeft) - Number(tailMs) >= G.workMs)) return no('short', true)
  const w = groundsWork({ ...links, on: true })
  if (!w.ok) return no(w.why, true)
  return { fall: true, why: `fallback:${stop}`, asked: true }
}
/**
 * THE ORDER HAS NOTHING FOR THIS BOT: ARE THE GROUNDS ORDERED? -> { ask, why }. Pure. shop.mjs buildOrder asks where it would answer
 * `{ order: null, skip }` for a skip in NO_ORDER_SKIPS -- the active project complete, the bot's last siting failed (a day), a
 * stuck stop or stamp (6 h), every slot taken. NOT for `idle` (the tidy's own quiet for this bot), `underground` (it is in a
 * mine), `health` or `room` (the bot's own state: asked here too, the order checks them after the skips this ask stands in for).
 *   sinceMs / cooldownMs   since the bot's last build order, and the order's cooldown (`complete` is answered before it)
 * why: `no_order:<skip>` | 'off' | 'skip' | 'cooldown' | 'health' | 'room' | groundsWork's
 */
// leaffell-01show r1: ...and the two waiting holds (shop.mjs noteWait / buildOrder `waitOf`: this bot's last visit to the pick ended
// leaf_decay or zone_closed and its hold is not over)
export const NO_ORDER_SKIPS = Object.freeze(['complete', 'no_site', 'stuck_on_cell', 'slots_full', 'leaf_decay', 'zone_closed'])
export function groundsNoOrder ({ on = true, skip = null, sinceMs = Infinity, cooldownMs = 0, health = 20, healthMin = 10, freeSlots = 36, roomMin = 2, ...links } = {}) {
  const no = why => ({ ask: false, why })
  if (!on) return no('off')
  if (!NO_ORDER_SKIPS.includes(String(skip ?? ''))) return no('skip')
  if (!(Number(sinceMs) >= Number(cooldownMs))) return no('cooldown')
  if (!(Number(health) > Number(healthMin))) return no('health')
  if (!(Number(freeSlots) >= Number(roomMin))) return no('room')
  const w = groundsWork({ ...links, on: true })
  return w.ok ? { ask: true, why: `no_order:${skip}` } : no(w.why)
}
/**
 * THE DECISION OF A VISIT ORDERED FOR THE GROUNDS (groundsDecide's shape) -> { took, why, share: 0, due: true, fall? }. Pure. The
 * links are read again at the visit (a slot taken, a lease moved since the ask): broken, the visit is NOT the grounds' and -- the
 * order having nothing else for this bot -- it ends there (`fall`: the link, for the row), never on the project its back-off holds.
 */
export function groundsOnly ({ why = 'no_order', ...links } = {}) {
  const w = groundsWork(links)
  return w.ok ? { took: 'tidy', why: String(why), share: 0, due: true } : { took: 'other', why: String(why), share: 0, due: true, fall: w.why }
}
/**
 * THE BACK-OFF A GROUNDS VISIT MUST NOT ERASE. The order's state holds ONE last stop and its time (cognitive.mjs shopState), written
 * by every build visit; its back-offs read them (shop.mjs buildOrder: `stuck_on_cell` 6 h, `no_site` a day). A visit ordered for
 * the grounds WHILE one holds answers `grounds_turn` -- which, written over the stop, would end the back-off at once and send the
 * bot back to the stuck project every cooldown; and answering the held stop again would restart its clock at every grounds visit
 * (held for good). So the bot's last stop ON ITS OWN PROJECT is remembered beside the state (skills.mjs buildShop: set by every
 * visit of its own project, cleared by every other build visit, untouched by a visit ordered for the grounds), and the back-offs
 * read the state THROUGH it: the held stop and its own time. No hold: the state itself, exactly as before. Pure.
 */
export const HOLD_STOPS = Object.freeze(['stuck_on_cell', 'no_site'])
export const groundsHoldOf = (stop, now = Date.now()) => (HOLD_STOPS.includes(String(stop ?? '')) ? { stop: String(stop), at: now } : null)
export const groundsHold = (state, hold) => (hold && HOLD_STOPS.includes(hold.stop) && Number.isFinite(hold.at) ? { ...(state ?? {}), lastStop: hold.stop, lastAt: hold.at } : state)

/**
 * MAY THIS GROUNDS VISIT TAKE (OR RENEW) THE KEEPER LEASE? -> bool. Pure. `d`: the keeper's state for this bot (`mine`, or `take`:
 * the lease is free). Never a fall-through's LATE leg (Claude r2 BLOCKER): groundsWork turns away a bot that IS the keeper, but a
 * FREE lease would be taken at the visit, and the keeper's own steps (the land plan, the stage's siting, the refresh, the prep) are
 * not bounded by the visit's budget -- begun with half the skill's clock gone they can run into the runner's abort, which throws
 * away the first project's result; and a keeper's term would begin from a visit that has no time for it. The late leg is a WORKER's.
 */
export const groundsMayKeep = ({ d = null, late = false } = {}) => !late && (d === 'mine' || d === 'take')

/**
 * THE SWEEP'S END IN A VISIT THAT STARTED LATE -> ms (epoch). Pure. The crew's sweep after a grounds visit ends 5 s before the
 * skill's end (skills.mjs buildTidy: `t0 + budget - 5 s`, t0 the grounds visit's start). In a fall-through the grounds visit
 * starts `used` ms into the skill, so the same sum would end the sweep `used` ms PAST it -- a sweep walking into the runner's
 * 180-s abort, which throws away the first project's clean result (Codex r1 BLOCKER). used 0: an ordinary visit's end exactly.
 */
export const lateUntil = (t0, budget, used = 0, tailMs = 5_000) => Number(t0) + Number(budget) - Math.max(0, Number(used) || 0) - tailMs

/**
 * STAIRS FIRST -> the record with every segment that holds an OPEN staircase cell (role `access`: tidy.mjs spotStair's stone steps
 * where the bots keep climbing, and the stands) moved to the front, each behind the layers it waits on (its `deps`, transitively:
 * a visit passes a segment whose layer below is open and does not come back to it). The other segments keep their order after
 * them. Pure. `open(cell)`: not laid and not waived now. `stone`: the bag holds a block a staircase takes -- WITHOUT IT THE RECORD
 * ITSELF (the survey's order): a visit ends `no_material` at the first cell it holds no block for, so a staircase at the head of a
 * bag of dirt would end the visit before a single fill (two correct rules, one dead end). No open staircase: the record itself.
 */
export function stairsFirst (record, open = () => true, stone = true) {
  if (!stone) return record
  const segs = record?.segments ?? []
  const want = new Set()
  for (const c of record?.cells ?? []) if (c && c.role === 'access' && !c.prev && open(c)) want.add(c.seg)
  if (!want.size) return record
  const by = new Map(segs.map(s => [s.seg, s]))
  const add = s => { for (const d of by.get(s)?.deps ?? []) if (!want.has(d)) { want.add(d); add(d) } }
  for (const s of [...want]) add(s)
  return { ...record, segments: [...segs.filter(s => want.has(s.seg)), ...segs.filter(s => !want.has(s.seg))] }
}
/**
 * THE SEGMENTS A VISIT LEAVES FOR LAST -> Set of seg names. Pure. A segment holding an open cell that G.stuckMin or more visits,
 * town-wide, found no stand for (the project's own stuck map: buildproj.mjs stuckRead -> { 'x,y,z': { visits } }).
 * WHY (LIVE showcase 11-12 16:30Z, the first hour of grounds-01; record g150: 1,661 segments, 4,855 cells): the record is worked
 * in the survey's order, and the first seven open segments (112, 119, 140, 144, 159, 186, 190 of 1,661) each begin with a cell no
 * stand reaches -- tried 366, 347, 300, 188 and 101 times. Every visit spent six to ten seconds on each of them in turn, deferred
 * it and ended `stuck_on_cell` with 0 to 2 cells laid in its two minutes, while some 1,470 workable segments waited behind them in
 * the order. The give-up rule cannot reach them: it counts only a visit that RAN OUT OF WORK (gkwork.mjs leftVisit), which a
 * two-minute visit on a backlog of 2,400 never does, and five of the seven are `opener` hollows it never waives.
 */
export function stuckSegs (record, stuck = {}, open = () => true, G = GROUNDS2) {
  const hard = new Set(Object.entries(stuck ?? {}).filter(([, v]) => (Number(v?.visits) || 0) >= G.stuckMin).map(([k]) => k))
  const out = new Set()
  if (!hard.size) return out
  for (const c of record?.cells ?? []) if (c && !c.prev && Array.isArray(c.at) && hard.has(c.at.join(',')) && open(c)) out.add(c.seg)
  return out
}
/**
 * STUCK LAST -> the record with those segments moved to the END of the visit's order, EACH WITH EVERY SEGMENT THAT WAITS ON IT
 * (its dependants, transitively), in the order they had; the others as they were. None: the record itself. Nothing is waived,
 * skipped for good or refused -- when only they are left the visit reaches them, and the project's own stuck rule answers as
 * before. Pure.
 * THE DEPENDANTS GO WITH IT (review r1, both engines): buildrun.mjs runVisit calls a project STALLED only when every open segment
 * is deferred, and a segment joins the deferred ones through a dep ALREADY deferred when the loop reaches it. Left in its place
 * before its stuck dep, the layer above was passed as "deps open", never deferred, so `stalled` could not come true at the
 * record's tail: no `stuck_on_cell`, no 6-hour back-off, and the keeper's stall waiver (gkwork.mjs stallWaive) never fired -- the
 * stage could not close. Moved after it, it inherits the deferral exactly as in the survey's order.
 */
export function stuckLast (record, late) {
  if (!late || !late.size) return record
  const segs = record?.segments ?? []
  if (!segs.some(s => late.has(s.seg))) return record
  const all = new Set(late)
  // the order lists a dep before its dependant (tidy.mjs: a layer after the one below), so one pass in order closes the set; a
  // second pass covers a record that does not
  for (let pass = 0, grew = true; grew && pass < segs.length; pass++) {
    grew = false
    for (const s of segs) if (!all.has(s.seg) && (s.deps ?? []).some(d => all.has(d))) { all.add(s.seg); grew = true }
  }
  return { ...record, segments: [...segs.filter(s => !all.has(s.seg)), ...segs.filter(s => all.has(s.seg))] }
}
/** Is `seg` one of the record's staircase segments (an open `access` cell in it)? Pure. */
export const stairSeg = (record, seg, open = () => true) => seg != null && (record?.cells ?? []).some(c => c && c.seg === seg && c.role === 'access' && !c.prev && open(c))
/** THE VISIT'S CUT/FILL SHARE WITH A STAIRCASE READY -> the share with the cuts LAST (buildrun.mjs runVisit `clearsLast`: the
 *  segments first, the staircase at their head). Ready: the stairs went first (their stone is in the bag) and the visit's first
 *  workable segment is one of them. Not ready: the share as it was. Pure. */
export const stairsShare = (share, ready) => (ready ? { ...share, clearsLast: true, stairs: true } : share)

/**
 * THE CREW'S PANTRY UNDER GROUNDS-01 -> { name: n } (review r1, Codex BLOCKER: a worker holds no crew lease, so the keeper's
 * lease-based liveness test dropped its pantry -- a worker carrying the park's last flowers whose visit ended before it planted
 * them was invisible, the keeper passed those cells `no_flowers`, counted them done and published the stage complete over them).
 * On: every OTHER bot's pantry written within G.workerLiveMs counts, lease or no lease (a worker comes back about every second
 * build order, some 20 minutes; a bot that left with the flowers stops holding the stage open after that window). Off: the crew
 * leases' rule exactly (`leased(holder)`, fresh within `leaseFresh`). Pure.
 */
export function crewPantrySum (pantry, { on = true, now = Date.now(), me = null, leased = () => false, leaseFresh = 12 * 60_000, G = GROUNDS2 } = {}) {
  return on ? pantrySum(pantry, { now, fresh: G.workerLiveMs, live: () => true, me }) : pantrySum(pantry, { now, fresh: leaseFresh, live: leased, me })
}
/** `_grounds_quota`: one row a build visit -- the decision, then what the visit did. Pure. */
/** grounds-03: `why=fallback:<the first project's stop>` (the visit went on to the grounds) and `why=no_order:<skip>` (ordered for
 *  them); `fall=<why>` when the project had nothing for the bot and the grounds still did not follow (short, spent, full, ...). */
export const groundsQuotaDetail = ({ on = true, turn = 0, open = null, share = 0, took = 'other', why = '-', placed = null, cleared = null, empty = false, out = '-', late = null, fall = null } = {}) =>
  `on=${on ? 1 : 0} turn=${turn} open=${open ?? '-'} share=${share} took=${took} why=${why} placed=${placed ?? '-'} cleared=${cleared ?? '-'} empty=${empty ? 1 : 0} out=${out}${late == null ? '' : ` late=${late}`}${fall == null ? '' : ` fall=${fall}`}`
/** `_grounds_mode`: the licence row, once at spawn (on=0 under GROUNDS2=off, fall=0 under GROUNDSFALL=off: a rollback is visible too). Pure. */
export const groundsModeDetail = (on = grounds2On(), G = GROUNDS2, fall = on && groundsFallOn()) => `on=${on ? 1 : 0} v=1 big=${G.big}:${G.shareBig} small=${G.small}:${G.shareSmall} empty_ms=${G.emptyMs} max_bots=${G.maxBots} fall=${fall ? 1 : 0}`
