// PRODSERVE-01: A FINISHED PRODUCTION PROJECT IS SERVED ON ITS OWN SCHEDULE (projectaudit-01's finding, 11-06; design
// docs/reports/prodserve-design-2026-11-06.md on main, Claude + Codex, reconciled).
//
// WHY (LIVE showcase, 15 bots, 11-04 08:00Z..11-06 14:20Z: 832,928 skill rows, 3,305 `_build_visit` rows): a production project that
// COMPLETES stops being offered. Its harvest / clerk is only `due` (an upkeep), and the picker (shop.mjs activeProject) offers an
// upkeep after every repair, every free open project and every sink -- the showcase always has one of those, so the upkeep never
// comes. The cane bed finished 11-04 21:38Z and got 0 visits in 1.7 d while 7 of its 8 cells stood 3 tall (ripe); the crop farm
// finished 11-04 08:29Z and got 0 visits in 2.2 d (all 10 crop cells air, the farmland lost); the storage hall's clerk never ran
// (0 `_storehub_clerk` rows) -- the same failure that left the tree farm unvisited for 4 days.
//
// THE RULE. A SERVICE plot (SERVICE_PLOTS: the farms and the hall's clerk; a managed forest joins by adding its plot here) whose
// record stands complete and whose OWN due test names a service reason for THIS bot (`serve`: the farm's ripe crop or plantable
// cell, the hall's clerk work) is offered AHEAD of every other tier -- repairs, open projects, sinks -- when
//   (1) THE TOWN'S SCHEDULE: no bot has started a service visit there in the plot's gap (`gapMs`, a town file per plot: the stamp,
//       written at the visit's start -- it is also the claim, so 15 bots never pile onto one bed), and
//   (2) THE FAIR SHARE: this bot has not served anything in SERVICE.botGapMs (a bot's service visits are at most one in that time:
//       a visit is 1-3 min, so at most ~15% of a bot's turns; the town's building keeps the rest).
// The most overdue plot goes first. A service visit is the project's own visit (buildCropFarm / buildCaneFarm harvest first; the
// hall's upkeep visit, which now runs even while one of the hall's cells reads damaged -- its repair stays a repair). A visit that
// did not happen (slots full, an abort before it began: shop.mjs IDLE_NOT_A_VISIT) gives its stamp back (`stampRelease`).
// PRODSERVE=off is the rollback: no service tier, the picker exactly as before. On in the showcase pool only (PRODSERVE_POOLS).
//
// A LEAF MODULE: pure, imports nothing. skills.mjs shopActive reads the stamps and the due tests and writes the stamp at the visit.

/** The production plots and their schedules. `reasons`: the due reasons that are a service (null: any truthy reason). */
export const SERVICE_PLOTS = Object.freeze({
  cropfarm: Object.freeze({ gapMs: 45 * 60_000, reasons: Object.freeze(['harvest', 'replant']) }),   // a seed GATHER stays an upkeep (the reservation guard finds no grass: LIVE 65 found, 0 targets)
  canefarm: Object.freeze({ gapMs: 60 * 60_000, reasons: Object.freeze(['harvest', 'replant']) }),   // cane regrows ~1 block / 18 min
  storehub: Object.freeze({ gapMs: 30 * 60_000, reasons: null }),                                     // the clerk's own CLERK_GAP_MS still holds a bot
})
export const SERVICE = Object.freeze({
  botGapMs: 20 * 60_000,   // a bot serves at most once in this time (the fair share against building)
  skewMs: 60_000,          // a stamp more than this in the FUTURE (a bad clock) is read as no stamp
})

/** THE SWITCH -> bool. PRODSERVE=on|off; unset = on only in the pools PRODSERVE_POOLS names (default 'showcase'). Pure. */
export function prodserveOn (env = process.env, pool = '') {
  const v = String(env?.PRODSERVE ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.PRODSERVE_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool ?? ''))
}

/** Is `plot` a service plot? Pure. */
export const isServicePlot = (plot, plots = SERVICE_PLOTS) => Object.prototype.hasOwnProperty.call(plots, String(plot ?? ''))

/** The due reason as a SERVICE reason -> string | null. `due` the plot's own due test's answer (a reason string, true, or null). Pure. */
export function serviceReason (plot, due, plots = SERVICE_PLOTS) {
  if (!isServicePlot(plot, plots) || !due) return null
  const want = plots[plot].reasons
  const r = due === true ? 'due' : String(due)
  if (want == null) return r
  return want.includes(r) ? r : null
}

/** A stamp's start -> ms | null (absent, unreadable or in the future past the skew: none). Pure. */
export function stampAt (stamp, now = Date.now(), skewMs = SERVICE.skewMs) {
  const at = Number(stamp?.at)
  return Number.isFinite(at) && at <= now + skewMs ? at : null
}

/**
 * THE SERVICE PICK -> { plot, reason, overdueMs, lastAt } | null. Pure.
 *   states   [{ plot, exists, complete, serve }] (skills.mjs shopActive's; `serve` the plot's own due reason for this bot)
 *   stamps   { plot: { at, by } } the town's last service start per plot
 *   botLastAt this bot's last service visit start (ms; -Infinity: never)
 * Null when this bot served within S.botGapMs, or no complete service plot names a service reason outside its gap. The most
 * overdue first (a never-served plot first of all); ties in `states` order.
 */
export function servicePick (states = [], { now = Date.now(), stamps = {}, botLastAt = -Infinity, plots = SERVICE_PLOTS, S = SERVICE } = {}) {
  if (Number.isFinite(botLastAt) && botLastAt <= now + S.skewMs && now - botLastAt < S.botGapMs) return null
  let best = null
  for (const s of states ?? []) {
    if (!s || !isServicePlot(s.plot, plots) || !s.exists || !s.complete) continue
    const reason = serviceReason(s.plot, s.serve, plots)
    if (!reason) continue
    const lastAt = stampAt(stamps?.[s.plot], now, S.skewMs)
    const gap = plots[s.plot].gapMs
    if (lastAt != null && now - lastAt < gap) continue
    const overdueMs = lastAt == null ? Infinity : now - lastAt - gap
    if (!best || overdueMs > best.overdueMs) best = { plot: s.plot, reason, overdueMs, lastAt }
  }
  return best
}

/** The stamp a service visit writes at its start -> { at, by, reason, prevAt }. `prev` the stamp it replaces (its start kept so a
 *  visit that did not happen can give the slot back). Pure. */
export const stampNext = (prev, { me, now = Date.now(), reason = null } = {}) => ({ at: now, by: String(me ?? 'bot'), reason: reason ?? null, prevAt: stampAt(prev, now) })

/**
 * A VISIT THAT DID NOT HAPPEN gives the slot back -> the stamp to write | null (leave it). Only this bot's own stamp of this visit
 * (`at` = the visit's start), only for a stop that was no visit (`notAVisit`: shop.mjs IDLE_NOT_A_VISIT). The previous start comes
 * back (none: the stamp is cleared to { at: null }). Pure.
 */
export function stampRelease (cur, { me, at, stop, notAVisit = new Set() } = {}) {
  if (!cur || String(cur.by) !== String(me) || Number(cur.at) !== Number(at)) return null
  if (!notAVisit.has(String(stop ?? ''))) return null
  return { at: Number.isFinite(Number(cur.prevAt)) && cur.prevAt != null ? Number(cur.prevAt) : null, by: cur.by, reason: 'released', prevAt: null }
}

/** The `_service` row's detail (a pick, at the visit's start). Pure. */
export function serviceRowDetail ({ plot, reason, overdueMs = null, lastAt = null, now = Date.now() } = {}) {
  const ago = lastAt == null ? 'never' : String(Math.round((now - lastAt) / 60_000))
  const over = overdueMs == null ? '-' : overdueMs === Infinity ? 'first' : String(Math.round(overdueMs / 60_000))
  return `plot=${plot} reason=${reason} last_min=${ago} overdue_min=${over}`
}
