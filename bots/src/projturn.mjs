// PROJTURN-01: THE TOWN'S PROJECTS TAKE TURNS, AND A VISIT THAT DID NOTHING COSTS ITS PROJECT THE NEXT ONE.
//
// THE CASE (LIVE showcase, 14 bots, three days to 11-15, 1.01M rows): the step well, open and workable, had ZERO build visits in
// 42 hours. shop.mjs activeProject took the FIRST open project that is free for the bot, in PROJECTS order; every project ahead of
// the well was stuck or found no site, and each was asked again at every cooldown. In the last 6 h: 143 build visits placed 41
// blocks -- the finished paths 21 visits (`complete; used 0, laid 620/620`: a destination its extension cannot route reads as
// damage, a repair, FIRST, once per 30 min per bot), cottage2 7 x `no_site` after a 107 s search, pens 6 x `no_site`, country 6 x
// `waterwalk` with nothing done. And one bot's `stuck_on_cell` held THAT BOT off every project for 6 hours (shop.mjs buildOrder).
//
// THE RULES (pure here; shop.mjs activeProject / buildOrder use them, skills.mjs keeps the files and the bot's marks):
//   1. THE HOLD IS THE PROJECT'S. A bot's own `stuck_on_cell` (6 h) or `no_site` (a day) holds it off THAT project only
//      (turnHold -> turnBackoff: the project steps aside for this bot as a stamped one does for all, so the picker offers the next;
//      shop.mjs stuckRetryHolds: the order skips only when it is STILL the pick -- nothing else is open -- and the grounds are then
//      asked, as before). An unknown project (no mark, a restart) holds as before.
//   2. NO PROGRESS BACKS THE PROJECT OFF, FOR THE POOL. Every visit's result is classed (turnOutcome): `progress` (something placed,
//      cleared or planted, an upkeep that worked), `no_progress` (it ran and changed nothing: stuck_on_cell, cell_deferred, no_site,
//      site_wait, complete, blocked, no_material, waterwalk ...), or `none` (no evidence: an abort, a visit that did not happen, a
//      waiting stop that has its own hold, a visit during which the record itself moved). Each consecutive `no_progress` doubles
//      the project's back-off -- 20 min, 40, 80 ... to the cap (6 h; the project's own stuck window where that is shorter: the
//      stair's and the storehouse's 30 min; an hour for a COMPLETE record, the repairs' rhythm: a real repair never waits longer
//      behind an upkeep that found nothing) -- plus a per-bot jitter of up to a quarter, so fourteen bots do not come back in the
//      same minute. One `progress` ends it. A record generation published since (a siting, an extension, a waiver, a planner's
//      next phase) ends it too: what the visits found wanting has changed.
//      ONE PROBE AT A TIME, AND THE CLAIM IS THE SLOT LEASE (review r1, Codex BLOCKER 3: a stamped start is no atomic claim, and
//      a wall-clock hold ends before an 8-minute visit does). A project with a count is "under probe" for everyone else exactly
//      while another bot holds one of its admission slots (buildproj.mjs leases: taken, renewed and released by the visit, lapsing
//      by themselves after a kill) -- `leased`. The bot that goes back to it takes slot 1 at the visit's START (skills.mjs
//      turnBegin; turnClaimNeeded): one taker per lease generation, so two bots that decided from the same reading cannot both
//      start; the loser steps aside with nothing counted and is given its next pick in the same visit.
//      A REPAIR IS NOT HELD BY ANOTHER KIND OF VISIT'S BACK-OFF (review r1, Codex BLOCKER 1): world damage moves no record
//      generation, so a complete building broken AFTER a no-op visit would wait the back-off out. A complete record whose state
//      reads `broken` (skills.mjs: a CELL read not done -- never the paths' extension, which is no cell) is gated by its own
//      count alone: the no-progress visits that began as repairs (`rn` / `rnoAt`). A repair that keeps failing backs off on
//      that; a fresh one is ordered at the next decision. The paths' unroutable extension is not `broken`: it backs off.
//   3. AMONG THE PROJECTS A BOT MAY WORK, THE ONE LONGEST UNVISITED GOES FIRST (turnPick over the states' marks -- `turn`,
//      `visitAt`, `pin`: never visited is oldest; the list's order breaks a tie; the bot's own pick stands while it is a candidate).
//      A visit's START is stamped, an aborted one too: a project whose visits never finish still takes its turn.
//   4. NOTHING AHEAD OF THE OPEN ORDER MOVES: the held projects, the service pick, an unbacked-off repair, the sink turn, the
//      `after` chain, a waiting planner, the slots and the leases are activeProject's as before; the grounds (the tidy, the forest),
//      the upkeep plot and the sinks take no turn and no back-off (their own lanes: the keeper's order, the quota, the idle marks);
//      a complete yard is never backed off (it is a full bag's own remedy); a service visit is never counted (its own schedule)
//      and the plot of this bot's current service offer is never backed off for it -- in the picker AND in the order's gate, which
//      are one function (review r1, Codex BLOCKER 2: the pick passed it and the order then refused it, again and again).
//   5. A STUCK STAMP IS UNTOUCHED: stuckBackoff's shape passes through turnBackoff as it came, and the order names the stamp first.
//   6. THE REFUSAL HAS A REMEDY: where a backed-off (or held) project is STILL the pick -- nothing else is open for the bot -- the
//      order's skip (`no_progress`, or the stop's own name) is one the grounds stand in for (grounds2.mjs NO_ORDER_SKIPS); and a
//      project that is not free lets the upkeep and the sinks stand in, as a stamped one always did (activeProject).
// THE FILES: one per holder for the whole town (`projturn-<home>.<holder>.json`, buildproj.mjs turnRead / turnWrite: the stuck
// map's rule -- a holder writes only its own file, a reader merges). SWITCH: PROJTURN=off|0|false|no -> none of it: the first free
// project in order, the bot-wide stuck hold, no file read or written.

/** THE SWITCH -> bool. On unless PROJTURN says off. Pure. */
export const projTurnOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.PROJTURN ?? '').trim())
/** baseMs: the first back-off; capMs: its cap; capDoneMs: the cap for a complete record; jitter: the per-bot share added on top;
 *  readMs: how long a reading of the pool's files stands; stickMs: how long a bot's pick stands while it is still a candidate (the
 *  order and the visit it issues name one project); asideMax: how many lost probe claims a visit steps aside from before it ends;
 *  skewMs: a stamp further in the future than this is a bad clock's. */
export const TURN = Object.freeze({ baseMs: 20 * 60_000, capMs: 6 * 60 * 60_000, capDoneMs: 60 * 60_000, jitter: 0.25, readMs: 15_000, stickMs: 60_000, asideMax: 3, skewMs: 60_000 })

/**
 * THE STOPS THAT ARE NO EVIDENCE ABOUT THE PROJECT (grounds2.mjs FALL_STOPS' own reasons): the visit did not happen (shop.mjs
 * IDLE_NOT_A_VISIT, kept in step by projturn.test.mjs), a town file it could not read, a plan step the next visit goes on with, a
 * visit that was the grounds', another bot's lease, and the two waiting stops (shop.mjs noteWait holds them per bot already).
 */
export const TURN_NO_EVIDENCE = Object.freeze(['slots_full', 'off', 'zones_unknown', 'no_plan', 'aborted', 'record_unreadable', 'lost_record', 'state_unwritable', 'room', 'underground',
  'lost_lease', 'site_unread', 'replanned', 'replant_wait', 'land_planned', 'land_unplanned', 'grounds_turn', 'grounds_none', 'keeper_held', 'not_decorator', 'leaf_decay', 'zone_closed'])
/**
 * ONE VISIT'S RESULT -> 'progress' | 'no_progress' | 'none'. Pure. `r`: { status, stop, placed?, cleared?, planted? } (the visit's
 * result; skills.mjs adds the generic visit's cleared / planted counts). An abort is an interruption, never evidence; a failed
 * visit (an error) is the runner's to see. `moved`: the record's generation changed while the visit ran (it sited, waived, reopened
 * or closed something: a transition is not "nothing") -- never counted against the project.
 */
export function turnOutcome (r, { moved = false } = {}) {
  if (!r || typeof r !== 'object') return 'none'
  const stop = String(r.stop ?? '')
  if (r.status === 'aborted' || stop === 'aborted') return 'none'
  if (r.status === 'success' || [r.placed, r.cleared, r.planted].some(n => (Number(n) || 0) > 0)) return 'progress'
  if (r.status !== 'no_effect' || moved) return 'none'
  if (TURN_NO_EVIDENCE.includes(stop) || stop.startsWith('fence:')) return 'none'
  return 'no_progress'
}
/** THE BACK-OFF AFTER `n` CONSECUTIVE NO-PROGRESS VISITS -> ms (0: none). Pure. `cap`: the project's own (turnCap). */
export function turnBackoffMs (n, { cap = TURN.capMs, T = TURN } = {}) {
  const k = Math.floor(Number(n) || 0)
  if (k <= 0) return 0
  return Math.min(Math.max(0, Number(cap) || 0), T.baseMs * 2 ** Math.min(k - 1, 30))
}
/** The cap for a project -> ms: `stuckMs` (its stuck window: shop.mjs stuckWindowOf) under T.capMs, T.capDoneMs for a complete record. Pure. */
export const turnCap = ({ complete = false, stuckMs = Infinity, T = TURN } = {}) => Math.min(T.capMs, Number(stuckMs) > 0 ? Number(stuckMs) : Infinity, complete ? T.capDoneMs : Infinity)
/** A bot's share of the jitter for a project's n-th back-off -> [0, 1), the same at every asking (FNV-1a over the three). Pure. */
export function turnJitter (me, plot, n) {
  let h = 0x811c9dc5
  for (const ch of `${me ?? ''}|${plot ?? ''}|${n ?? 0}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h / 0x100000000
}
/** WHEN MAY THIS BOT VISIT THE PROJECT AGAIN -> ms (0: no back-off). Pure. `e`: the pool's entry (turnView). */
export function turnUntil (e, { me = null, plot = null, cap = TURN.capMs, T = TURN } = {}) {
  const n = Math.floor(Number(e?.n) || 0)
  if (n <= 0 || !Number.isFinite(e?.noAt)) return 0
  return e.noAt + Math.round(turnBackoffMs(n, { cap, T }) * (1 + T.jitter * turnJitter(me, plot, n)))
}
const sameGen = (a, b) => (a ?? null) === (b ?? null)
/**
 * THE POOL'S VIEW -> Map plot -> { at, okAt, n, noAt, rn, rnoAt, stop }. Pure. `files`: [{ holder, plots: { plot: { at, n, noAt, rn,
 * rnoAt, okAt, gen, stop } } }] (one per holder). at: the newest visit START by anyone; okAt: the newest progress; n: every
 * holder's no-progress count SINCE that progress, on the record generation that stands now (`genOf(plot)`; no reader: every
 * generation counts); noAt / stop: the newest of them; rn / rnoAt: the same for the visits that began as REPAIRS (their own count).
 * A stamp more than T.skewMs in the future is dropped before anything is taken.
 */
export function turnView (files = [], { now = Date.now(), genOf = null, T = TURN } = {}) {
  const ok = t => Number.isFinite(t) && t > 0 && t <= now + T.skewMs
  const by = new Map()
  for (const f of files ?? []) for (const [plot, e] of Object.entries(f?.plots ?? {})) { if (e && typeof e === 'object') { if (!by.has(plot)) by.set(plot, []); by.get(plot).push(e) } }
  const out = new Map()
  for (const [plot, es] of by) {
    const at = Math.max(-Infinity, ...es.map(e => e.at).filter(ok)), okAt = Math.max(-Infinity, ...es.map(e => e.okAt).filter(ok))
    let gen
    const v = { at: Number.isFinite(at) ? at : null, okAt: Number.isFinite(okAt) ? okAt : null, n: 0, noAt: null, rn: 0, rnoAt: null, stop: null }
    for (const e of es) {
      for (const [nk, tk] of [['n', 'noAt'], ['rn', 'rnoAt']]) {
        const k = Math.floor(Number(e[nk]) || 0)
        if (k <= 0 || !ok(e[tk]) || e[tk] <= okAt) continue
        if (typeof genOf === 'function') { if (gen === undefined) { try { gen = genOf(plot) ?? null } catch { gen = null } } if (!sameGen(e.gen, gen)) continue }
        v[nk] += k
        if (v[tk] == null || e[tk] > v[tk]) { v[tk] = e[tk]; if (nk === 'n') v.stop = e.stop ?? null }
      }
    }
    out.set(plot, v)
  }
  return out
}
/** A VISIT STARTS -> this holder's entry with the start stamped (the counts as they were). Pure. */
export const turnStart = (own, now = Date.now()) => ({ n: 0, noAt: null, rn: 0, rnoAt: null, okAt: null, gen: null, stop: null, ...(own ?? {}), at: now })
/**
 * A VISIT ENDED -> this holder's entry after it. Pure. `own`: its entry before (or null); `pool`: the pool's view of the project
 * (turnView: the newest progress by anyone); `gen`: the record's generation now. `progress`: both counts end. `no_progress`: one
 * more -- on the REPAIRS' count when the visit began as one (`repair`), else on the project's -- on top of its own count only while
 * that count is still live (no progress by anyone since, the same generation). `none`: as it was.
 */
export function turnAfter (own, pool, outcome, { now = Date.now(), stop = null, gen = null, repair = false } = {}) {
  const base = { at: null, n: 0, noAt: null, rn: 0, rnoAt: null, okAt: null, gen: null, stop: null, ...(own ?? {}) }
  if (outcome === 'progress') return { ...base, n: 0, noAt: null, rn: 0, rnoAt: null, okAt: now, gen: gen ?? null, stop: null }
  if (outcome !== 'no_progress') return own ?? null
  const live = (n, t) => (n > 0 && Number.isFinite(t) && t > (pool?.okAt ?? -Infinity) && sameGen(base.gen, gen) ? Math.floor(n) : 0)
  // the count the visit does not add to is kept only while it is live too (the entry carries ONE generation)
  const n = live(base.n, base.noAt), rn = live(base.rn, base.rnoAt)
  return repair
    ? { ...base, n, noAt: n ? base.noAt : null, rn: rn + 1, rnoAt: now, gen: gen ?? null, stop: stop == null ? null : String(stop) }
    : { ...base, n: n + 1, noAt: now, rn, rnoAt: rn ? base.rnoAt : null, gen: gen ?? null, stop: stop == null ? null : String(stop) }
}
/** MUST THIS VISIT CLAIM THE PROBE FIRST? -> bool. Pure. A project with a live count (its own or its repairs'): the bot going back
 *  to it takes the slot lease at the visit's start, or steps aside. No count: an ordinary visit, the slots as before. */
export const turnClaimNeeded = e => (Math.floor(Number(e?.n) || 0) > 0 && Number.isFinite(e?.noAt)) || (Math.floor(Number(e?.rn) || 0) > 0 && Number.isFinite(e?.rnoAt))
/**
 * THIS BOT'S OWN HOLD -> { plot, stop } | null. Pure. `last`: { plot, stop, at } of its last visit to a project of its own
 * (skills.mjs buildShop). `stuck_on_cell` holds that project `stuckMs`, `no_site` holds it `siteMs` (shop.mjs: the order's two
 * back-offs that read the last stop); any other stop, or none known: no hold.
 */
export function turnHold (last, now = Date.now(), { stuckMs = 6 * 60 * 60_000, siteMs = 24 * 60 * 60_000 } = {}) {
  if (!last || last.plot == null || !Number.isFinite(last.at) || last.at > now + TURN.skewMs) return null
  const ms = last.stop === 'stuck_on_cell' ? stuckMs : last.stop === 'no_site' ? siteMs : 0
  return now - last.at < ms ? { plot: last.plot, stop: last.stop } : null
}
/**
 * THE STATES WITH THE TURNS' MARKS -> states (shop.mjs activeProject's). Pure. THE ONE ELIGIBILITY RULE: skills.mjs calls it for the
 * picker's states and, with the pick's own state, for the order's gate. For every project that takes turns (`exempt(plot)` false):
 * `turn` (it does: activeProject ages only among these), `visitAt` (the newest visit start), `pin` (on `pin`'s plot: the pick this
 * bot already has -- the order and the visit it issues name one project); `backoff` while this bot's back-off holds, or while the
 * project has a count and ANOTHER bot holds one of its slots (`leased`: one probe at a time, for as long as that visit lasts) -- an
 * open project is then not `free` (the next one first), a complete one is quiet (no repair, no upkeep: nothing is offered there).
 * The project this bot's own last stop holds steps aside in stuckBackoff's shape (open: not `free`; complete: only `due`; `stuck`)
 * -- a `no_site` only while it is still unsited. Never taken OUT of the list: with nothing else open it is still the pick, and the
 * order skips it by name. A state a stuck stamp or a waiting hold already marked (`stuck`) keeps that shape exactly: the stamp is
 * never shortened or reshaped.
 *   capOf    plot -> the project's stuck window, ms (turnCap's `stuckMs`)
 *   ownNeed  plot -> a COMPLETE record whose work is the asking bot's own need (shop.mjs turnOwnNeed: the yard takes a full bag):
 *            one bot finding nothing there says nothing about the next -- never backed off while complete
 *   service  the plot of this bot's current service offer (prodserve.mjs): never backed off for it -- its schedule is its own
 *   leased   plot -> does another bot hold a live admission slot of the project now? (asked only where a count stands and the
 *            back-off is over; a throw reads as no)
 * A complete record whose state reads `damaged` AND `broken` (a cell read not done) is a REPAIR: gated by the repairs' own count.
 */
export function turnBackoff (states = [], view = null, { me = null, now = Date.now(), exempt = () => false, hold = null, pin = null, capOf = () => Infinity, ownNeed = () => false, service = null, leased = () => false, T = TURN } = {}) {
  return states.map(st => {
    if (!st || exempt(st.plot)) return st
    const e = view?.get?.(st.plot) ?? null
    const seen = { ...st, turn: true, ...(Number.isFinite(e?.at) ? { visitAt: e.at } : {}), ...(pin != null && pin === st.plot ? { pin: true } : {}) }
    if (st.stuck) return seen
    const done = !!(st.exists && st.complete)
    if (hold && hold.plot === st.plot && (hold.stop !== 'no_site' || !st.exists)) return done ? { ...seen, damaged: false, due: true, stuck: true } : { ...seen, free: false, stuck: true }
    if (done && ownNeed(st.plot)) return seen
    if (service != null && service === st.plot) return seen
    const repair = done && st.damaged === true && st.broken === true
    const c = repair ? { n: e?.rn, noAt: e?.rnoAt } : e
    let cap = Infinity
    try { cap = capOf(st.plot) } catch { cap = Infinity }
    let blocked = turnUntil(c, { me, plot: repair ? `${st.plot}#repair` : st.plot, cap: turnCap({ complete: done, stuckMs: cap, T }), T }) > now
    if (!blocked && Math.floor(Number(c?.n) || 0) > 0 && Number.isFinite(c?.noAt)) { try { blocked = leased(st.plot) === true } catch { blocked = false } }
    if (!blocked) return seen
    return done ? { ...seen, damaged: false, due: false, dueFirst: false, backoff: true } : { ...seen, free: false, backoff: true }
  })
}
/**
 * THE AGED CHOICE -> one of `cands` | null. Pure. `prefer` (a plot: the pick this bot was already given) when it is still a
 * candidate; else the candidate whose `ageOf` (its newest visit start, ms) is OLDEST -- never
 * visited (not a number) is oldest of all -- and the first in `cands` order among equals.
 */
export function turnPick (cands = [], ageOf = () => null, prefer = null) {
  if (prefer != null) { const p = cands.find(c => c?.plot === prefer); if (p) return p }
  let best = null, bestAt = Infinity
  for (const c of cands) {
    const a = ageOf(c), t = Number.isFinite(a) ? a : -Infinity
    if (best == null || t < bestAt) { best = c; bestAt = t }
  }
  return best
}
/** `_shop_turn` rows (detail strings only). Pure. */
export const turnPickDetail = ({ project = '-', why = '-', ageMin = null, backedOff = 0, eligible = 0 } = {}) => `op=pick project=${project} why=${why} age_min=${ageMin == null ? 'never' : ageMin} backed_off=${backedOff} eligible=${eligible}`
export const turnBackoffDetail = ({ project = '-', n = 0, untilMin = 0, stop = '-', repair = false } = {}) => `op=backoff project=${project} n=${n} until_min=${untilMin} stop=${String(stop ?? '-').replace(/\s+/g, '_').slice(0, 48)}${repair ? ' repair=1' : ''}`
