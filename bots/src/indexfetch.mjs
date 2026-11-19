// INDEXFETCH-01SHOW: A SHORT DRAW FETCHES WHAT THE TOWN INDEX SAYS IS THERE (chests only; bags come later, with the overseer).
//
// OWNER 11-19: "IF we have the material in a chest or bag the bots go get it no time limit.. we know its there, so the time to go
// get it is worth it".
//
// THE CASE (showcase shortage report 11-19 21:06Z, docs/reports/shortage/latest.md on data/shortage): the decor's visit came up
// short 1 bone meal with the town index holding 6, the stepwell's short 7 torches with the index holding 116, the tidy short 23
// cobblestone with 41. A build draw (skills.mjs matsWithdraw) looks in at most 12 containers (+6 since drawshort) INSIDE the
// visit's clock (the runner's 180 s, less the visit's own reserve); a far chest the index names is never reached before the
// clock or the cap ends the search, and the visit stops short of something the town holds.
//
// THE RULE (pure here; skills.mjs wires it, shop.mjs's order asks it):
//   WANT     a build draw inside a build visit that ends short of a plain item name which the READABLE town index shows in
//            some container (an observation not under a mutation, at most FETCH_MAX_AGE_MS old, in town, not shut, not in a
//            zone), and which the draw's own allowance would let it take there, notes a fetch WANT for the visit's plot
//            (fetchWantOf). No index (off, unreadable): no want -- today's behaviour.
//   ORDER    the build order, while the want is fresh (FETCH.wantTtlMs) and the pick is still its plot, issues the fetch trip
//            ahead of its cooldown (a dedicated build_shop run: its OWN runner clock, never the visit's).
//   TRIP     straight to the containers the index names (runFetchTrip), nearest first, re-planned from the index after every
//            open: no 12-container cap; a walk cap per container (FETCH.walkMs), a total trip cap (FETCH.tripMs), and ONE retry
//            of a container the walk or the open could not reach.
//   VERIFY   every open is the truth: a container that shows LESS of a wanted item than its index entry said (or none) is a
//            MISS -- its entry is corrected (the open's own observation; a dirty mark when that could not be written) and the
//            container is never visited again in this trip (the stale entry is not retried).
//   NO LOOP  any item the trip leaves short (a miss, an unreachable chest, the cap, a refused take) backs off for this bot
//            FETCH.backoffMs (fetchBackoff): no want of it until then.
//   THEN     fetched: the order's next build is issued without its cooldown (a new visit, with the material; never resumed in the
//            trip's run -- a visit starts its own clocks, which would run past the runner's: Codex r1).
//   ROW      one `_index_fetch` row a trip: item(s), need, containers tried, found, the miss corrections, trip ms, outcome.
// INDEXFETCH=off is the one-setting rollback (no want, no order, no trip: the draw exactly as before).

import { indexStateOf } from './townindex.mjs'
import { INDEX_FUTURE_SLACK_MS } from './smeltjob.mjs'

const isOff = v => ['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
const num = (v, d, lo, hi) => { const s = String(v ?? '').trim(); const n = Number(s); return s !== '' && Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : d }
/** THE SWITCHES -> { on, tripMs, walkMs, retries, backoffMs, wantTtlMs, tailMs }. Pure. */
export function fetchSettings (env = {}) {
  return Object.freeze({
    on: !isOff(env?.INDEXFETCH),
    tripMs: num(env?.INDEXFETCH_TRIP_S, 120, 10, 170) * 1000,          // the whole trip, every walk and open in it
    walkMs: num(env?.INDEXFETCH_WALK_S, 45, 5, 120) * 1000,            // one container's walk
    retries: 1,                                                          // a container the walk/open could not reach: once more
    backoffMs: num(env?.INDEXFETCH_BACKOFF_MIN, 30, 1, 24 * 60) * 60_000,   // per item, per bot, after a trip left it short
    wantTtlMs: 20 * 60_000,                                              // an unanswered want lapses
    tailMs: 8_000,                                                       // kept free of the runner's clock at the trip's end
  })
}
export const FETCH = fetchSettings(typeof process !== 'undefined' ? process.env : {})
/** An index observation older than this is no evidence for a trip (stockZero's day: a player may have emptied it). */
export const FETCH_MAX_AGE_MS = 24 * 60 * 60 * 1000
const ITEM_NAME_RE = /^[a-z0-9_]+$/

const countOf = (names, name) => Math.max(0, Number(names?.[name]?.[0]) || 0)

/**
 * THE CONTAINERS THE INDEX SAYS HOLD THE SHORT ITEMS -> [{ k, halves, names: { item: n }, d }]. Pure.
 *   entries   the town index's fold ({ lowerHalfKey: entry }; townindex.mjs readIndex .entries); not an object -> []
 *   short     { item: n } still wanted (n > 0, a plain item name)
 *   exclude   container keys (either half) out of this plan: visited, stale, unreachable twice
 *   ok(k)     false -> the container is out (outside town, shut in the town's memory, in a zone, backed off) -- never throws here
 *   dist(k)   the walk's rank (nearest first); missing -> 0
 * An entry counts when its state is `known` or `stale` (an observation with no mutation since: every open and deposit writes it),
 * its observation is not from the future and younger than maxAge, and it holds at least one of a short item.
 */
export function fetchTargets (entries, short = {}, { now = Date.now(), exclude = new Set(), ok = () => true, dist = () => 0, maxAge = FETCH_MAX_AGE_MS } = {}) {
  if (!entries || typeof entries !== 'object') return []
  const want = Object.entries(short ?? {}).filter(([n, c]) => Number(c) > 0 && ITEM_NAME_RE.test(n)).map(([n]) => n)
  if (!want.length) return []
  const out = []
  for (const [k, e] of Object.entries(entries)) {
    const halves = [k, ...(Array.isArray(e?.obs?.h) ? e.obs.h.filter(h => h !== k) : [])]
    if (halves.some(h => exclude?.has?.(h))) continue
    const st = indexStateOf(e, now)
    if (st !== 'known' && st !== 'stale') continue
    const at = Number(e.obs?.at)
    if (!Number.isFinite(at) || at > now + INDEX_FUTURE_SLACK_MS || now - at >= maxAge) continue
    const names = {}
    for (const n of want) { const c = countOf(e.obs.names, n); if (c > 0) names[n] = c }
    if (!Object.keys(names).length) continue
    let good = false
    try { good = !!ok(k) } catch { good = false }
    if (!good) continue
    let d = 0
    try { d = Number(dist(k)); if (!Number.isFinite(d)) d = Infinity } catch { d = Infinity }
    out.push({ k, halves, names, d })
  }
  return out.sort((a, b) => a.d - b.d || Object.values(b.names).reduce((s, c) => s + c, 0) - Object.values(a.names).reduce((s, c) => s + c, 0) || (a.k < b.k ? -1 : 1))
}

/**
 * THE TARGETS THE DRAW'S OWN ALLOWANCE LETS GO -> targets, each naming only the items `allows(item, target)` (> 0) would take there;
 * a target left with none is dropped. Pure (the allowance is the caller's). Rig run 7 (sandbox2 11-19): the trip walked 81 blocks to
 * the hall's two torch chests first (15 and 11, each under the 32 torch reserve: nothing could go) and the cap ended it before the
 * one chest the reserve allowed (50).
 */
export function fetchAllowed (targets = [], allows = () => Infinity) {
  const out = []
  for (const t of targets ?? []) {
    const names = {}
    for (const [n, c] of Object.entries(t?.names ?? {})) { let a = 0; try { a = Number(allows(n, t)) || 0 } catch { a = 0 } if (a > 0) names[n] = c }
    if (Object.keys(names).length) out.push({ ...t, names })
  }
  return out
}
/** Is `item` backed off for this bot now? Pure over the map ({ item: until }). */
export const fetchBackedOff = (backoff, item, now = Date.now()) => { const u = Number(backoff?.get?.(item) ?? backoff?.[item]); return Number.isFinite(u) && u > now }

/**
 * THE WANT OF A SHORT DRAW -> { item: n } (empty: no trip). Pure. `left` what the draw still lacks; `targets` fetchTargets' plan;
 * `allows(item, target)` -> how many the draw's own allowance would take there (the reserve, the decorator's keep: never a trip
 * for stock the draw may not touch); `backoff` this bot's item back-offs. An item counts when it is short, some target holds it, the
 * allowance lets something of it go at one of those targets, and it is not backed off. Each item asks for what is left of it.
 */
export function fetchWantOf (left = {}, targets = [], { allows = () => Infinity, backoff = null, now = Date.now() } = {}) {
  const out = {}
  for (const [n, c0] of Object.entries(left ?? {})) {
    const c = Math.floor(Number(c0) || 0)
    if (!(c > 0) || !ITEM_NAME_RE.test(n) || fetchBackedOff(backoff, n, now)) continue
    const holds = (targets ?? []).filter(t => (t?.names?.[n] ?? 0) > 0)
    let can = false
    for (const t of holds) { let a = 0; try { a = Number(allows(n, t)) || 0 } catch { a = 0 } if (a > 0) { can = true; break } }
    if (can) out[n] = c
  }
  return out
}

/**
 * THE WANT AT THE TRIP'S START -> { item: n }. Pure. Each item less what the bag has GAINED of it since the want was noted (`bag0`, the
 * count then; `held` now): the visit that noted it may still have crafted or drawn it. An item the bag spent meanwhile is still wanted
 * in full (never more). An item with no baseline is kept as it is.
 */
export function fetchStillWanted (items = {}, bag0 = {}, held = {}) {
  const out = {}
  for (const [n, c0] of Object.entries(items ?? {})) {
    const c = Math.floor(Number(c0) || 0)
    const gained = Object.prototype.hasOwnProperty.call(bag0 ?? {}, n) ? Math.max(0, (Number(held?.[n]) || 0) - (Number(bag0[n]) || 0)) : 0
    if (c - gained > 0) out[n] = c - gained
  }
  return out
}

/**
 * WHAT ONE OPEN SAID AGAINST THE INDEX -> { miss: [{ item, idx, saw }] }. Pure. A wanted item the index said the container held
 * (`expected` { item: n }) that it shows FEWER of now (`saw` { item: n }; none at all included) is a miss. More than the index is no
 * miss. `saw` null (nothing seen: the open never happened) -> no verdict ([]).
 */
export function openVerdict (expected = {}, saw = null) {
  if (!saw || typeof saw !== 'object') return { miss: [] }
  const miss = []
  for (const [item, idx] of Object.entries(expected ?? {})) {
    const s = Math.max(0, Number(saw[item]) || 0)
    if (s < (Number(idx) || 0)) miss.push({ item, idx: Number(idx) || 0, saw: s })
  }
  return { miss }
}

/**
 * THE BACK-OFF AFTER A TRIP -> the map, updated in place. Pure but for the map. Every item the trip wanted and did not get all of
 * backs off `ms` for this bot (a miss, an unreachable chest, the cap, a refused take); an item fetched in full clears its back-off.
 */
export function fetchBackoff (backoff, items = {}, found = {}, { now = Date.now(), ms = FETCH.backoffMs } = {}) {
  const m = backoff instanceof Map ? backoff : new Map()
  for (const [n, want] of Object.entries(items ?? {})) {
    if ((Number(found?.[n]) || 0) >= (Number(want) || 0)) m.delete(n)
    else m.set(n, now + ms)
  }
  return m
}

/**
 * THE TRIP -> { found, left, tried, misses, fixed, unreachable, outcome, ms, stop }. The decisions are here; the walking and the
 * opening are `ops`' (skills.mjs: chestWalk + withdrawVisit):
 *   items          { item: n } wanted
 *   plan(exclude)  -> fetchTargets for what is still wanted, re-read from the index (an open's correction is seen at once)
 *   ops.now()      the clock
 *   ops.visit(target, { walkMs, want })  -> { opened: bool, saw: { item: n } | null, took: { item: n }, ix: id | null, fail: class | null, stop: bool }
 *                  `opened` false: the walk or the open could not reach it (the retry's case); `stop` true: the trip must end here
 *                  (an unsettled transfer, a full bag)
 *   ops.correct(k) the dirty mark for a miss whose open wrote no observation -> bool
 *   deadline       the trip's end (the trip cap, inside the runner's clock); walkMs the cap per container; retries per container
 * Never visits a container twice except the one retry of an unreached one; never visits one that showed a miss again.
 */
export async function runFetchTrip ({ items = {}, plan, ops, deadline, walkMs = FETCH.walkMs, retries = FETCH.retries, minMs = 3_000 } = {}) {
  const t0 = ops.now()
  const left = Object.fromEntries(Object.entries(items ?? {}).filter(([, c]) => Number(c) > 0).map(([n, c]) => [n, Math.floor(Number(c))]))
  const found = {}, tried = [], misses = [], unreachable = []
  const visited = new Set(), tries = new Map(), retryQ = []   // `visited`: every container opened or tried -- a stale one included
  let fixed = 0, stop = null, cap = false
  const wanted = () => Object.fromEntries(Object.entries(left).filter(([, c]) => c > 0))
  const exclude = () => new Set(visited)
  const planNow = w => { try { return plan(w, exclude()) ?? [] } catch { return [] } }
  for (let guard = 0; guard < 256; guard++) {
    const w = wanted()
    if (!Object.keys(w).length) break
    let tg = planNow(w)[0] ?? null
    // THE ONE RETRY: a container the walk or the open could not reach comes back once, after every other target
    while (!tg && retryQ.length) {
      const r = retryQ.shift()
      for (const h of r.halves) visited.delete(h)
      tg = planNow(w).find(t => t.k === r.k) ?? null
      if (!tg) for (const h of r.halves) visited.add(h)
    }
    if (!tg) break
    const msLeft = deadline - ops.now()
    if (msLeft < minMs) { cap = true; break }
    const n = (tries.get(tg.k) ?? 0) + 1
    tries.set(tg.k, n)
    const halves = [...new Set([tg.k, ...(tg.halves ?? [])])]
    for (const h of halves) visited.add(h)   // never again in this trip (a miss's stale entry is not retried), but the one retry below
    const want = Object.fromEntries(Object.entries(w).filter(([item]) => (tg.names?.[item] ?? 0) > 0))
    const v = await ops.visit(tg, { walkMs: Math.max(1, Math.min(walkMs, msLeft)), want })
    if (!v?.opened) {
      tried.push(`${tg.k}:${v?.fail ?? 'unreached'}`)
      if (!unreachable.includes(tg.k)) unreachable.push(tg.k)
      if (n <= retries) retryQ.push({ k: tg.k, halves })
      if (v?.stop) { stop = v.fail ?? 'stop'; break }
      continue
    }
    { const i = unreachable.indexOf(tg.k); if (i >= 0) unreachable.splice(i, 1) }   // reached on its retry
    const verdict = openVerdict(tg.names ?? {}, v.saw)
    for (const [item, c] of Object.entries(v.took ?? {})) {
      if (!(Number(c) > 0)) continue
      found[item] = (found[item] ?? 0) + Number(c)
      if (item in left) left[item] = Math.max(0, left[item] - Number(c))
    }
    if (verdict.miss.length) {
      for (const m of verdict.miss) misses.push({ k: tg.k, ...m })
      // THE CORRECTION: the open's own observation (`ix`) already says what is there; with none written, a dirty mark makes the
      // entry unknown (no reader trusts it until the next open)
      let ok = !!v.ix
      if (!ok) { try { ok = !!ops.correct(tg.k) } catch { ok = false } }
      if (ok) fixed++
    }
    tried.push(`${tg.k}:${verdict.miss.length ? 'miss' : Object.values(v.took ?? {}).some(c => Number(c) > 0) ? 'ok' : (v.fail ?? 'none')}`)
    if (v.stop) { stop = v.fail ?? 'stop'; break }
  }
  const ms = ops.now() - t0
  const got = Object.values(found).reduce((s, c) => s + c, 0)
  const short = Object.values(left).some(c => c > 0)
  const outcome = !short ? 'fetched'
    : stop ? (got ? 'partial' : stop)
      : cap ? (got ? 'partial' : 'trip_cap')
        : got ? 'partial'
          : misses.length && !unreachable.length ? 'miss'
            : unreachable.length ? 'unreachable'
              : tried.length ? 'refused' : 'no_target'
  return { found, left: wanted(), tried, misses, fixed, unreachable: [...new Set(unreachable)], outcome, ms, stop, cap }
}

/** The `_index_fetch` row. Pure. Under 300 characters. */
export function indexFetchDetail ({ plot = '-', items = {}, r = null, then = '-', why = null } = {}) {
  const kv = m => Object.entries(m ?? {}).filter(([, c]) => Number(c) > 0).map(([n, c]) => `${n}:${c}`).join(',') || '-'
  const tried = r?.tried ?? []
  const miss = (r?.misses ?? []).map(m => `${m.k}:${m.item}:${m.idx}>${m.saw}`).join(';') || '-'
  return `op=trip plot=${plot ?? '-'} item=${Object.keys(items ?? {}).join('+').slice(0, 30) || '-'} need=${kv(items).slice(0, 40)} tried=${tried.length}:${tried.map(x => String(x).replace(/:chest_unreachable$/, ':unreach')).join(';').slice(0, 110) || '-'} found=${kv(r?.found).slice(0, 40)} miss=${miss.slice(0, 45)} fixed=${r?.fixed ?? 0} ms=${Math.round(Number(r?.ms) || 0)} outcome=${why ?? r?.outcome ?? '-'} then=${then}`
}
/** THE TRIP'S DISTANCES (control 11-19: does the 120 s cap bite in practice?) -> the `_index_fetch op=dist` row, written when a trip
 *  ends refused, unreached or at its cap. Pure. Every container the trip's first plan named, nearest first, with its distance from
 *  where the trip began and what became of it (the tried list's result, else `untried`); `near`/`far` the plan's extremes. Under 300. */
export function indexFetchDistDetail ({ plot = '-', outcome = '-', ms = 0, from = null, targets = [], tried = [] } = {}) {
  const res = new Map()
  for (const t of tried ?? []) { const i = String(t).lastIndexOf(':'); if (i > 0) res.set(String(t).slice(0, i), String(t).slice(i + 1).replace(/^chest_unreachable$/, 'unreach')) }
  const ts = [...(targets ?? [])].sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity))
  const ds = ts.map(t => Number(t.d)).filter(Number.isFinite)
  const f = from ? `${Math.round(from.x)},${Math.round(from.y)},${Math.round(from.z)}` : '-'
  const head = `op=dist plot=${plot ?? '-'} outcome=${outcome} ms=${Math.round(Number(ms) || 0)} from=${f} n=${ts.length} near=${ds.length ? Math.round(Math.min(...ds)) : '-'} far=${ds.length ? Math.round(Math.max(...ds)) : '-'} dist=`
  let body = ''
  for (const t of ts) {
    const e = `${t.k}:${Number.isFinite(Number(t.d)) ? Math.round(t.d) : '?'}:${res.get(t.k) ?? 'untried'}`
    if ((head + body + e).length + 1 > 300) { body += body ? ';+' : '+'; break }
    body += (body ? ';' : '') + e
  }
  return head + (body || '-')
}
/** The `_index_fetch` want row (a draw noted a trip). Pure. */
export const indexWantDetail = ({ plot = '-', items = {}, targets = 0, near = '-' } = {}) =>
  `op=want plot=${plot ?? '-'} need=${Object.entries(items ?? {}).map(([n, c]) => `${n}:${c}`).join(',').slice(0, 80) || '-'} targets=${targets} first=${near}`
/** The `_indexfetch_mode` licence row (once per spawn). */
export const indexFetchModeDetail = (f = FETCH) => `phase=mode index_fetch=${f.on ? 'on' : 'off'} trip_s=${f.tripMs / 1000} walk_s=${f.walkMs / 1000} retries=${f.retries} backoff_min=${f.backoffMs / 60_000} max_age_h=${FETCH_MAX_AGE_MS / 3600000}`
