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
export const GK = Object.freeze({ leaseTtlMs: 30 * 60_000, termMs: 4 * 60 * 60_000, restMs: 60 * 60_000, cooldownMs: 2 * 60_000, clearMax: 16, takeEveryMs: 5 * 60_000,
  // gkhelpers-01 (owner 11-03 A): at most `helpersMax` HELPER bots a town on the keeper's grounds, each on its own lease (helper1,
  // helper2), `helperTtlMs` (longer than one visit's budget), renewed at every helper visit; a helper whose visit found nothing to do
  // lets it go and rests `helperRestMs`. Two bots' fill segments never come within `segGap` columns of each other.
  helpersMax: 2, helperTtlMs: 12 * 60_000, helperRestMs: 10 * 60_000, segGap: 2,
  // gkhelpers-01 (owner 11-03 B): THE PARK GATHER -- at most `gatherMax` plant blocks a visit, within `gatherR` of home; the keeper
  // gathers at most every `gatherEveryMs` (its plan work comes first)
  // (96: the LIVE showcase's nearest free sugar cane stands 65-96 from home; its flowers are all inside the protected village)
  gatherMax: 12, gatherR: 96, gatherEveryMs: 20 * 60_000 })
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
export function keeperOrderPure (states, list, { d, shopPlot = 'shop', tidyPlot = 'tidy', forestPlot = null } = {}) {
  const ti = states.findIndex(st => st.plot === tidyPlot)
  const tidyP = list.find(p => p.plot === tidyPlot)
  const shop = states.find(st => st.plot === shopPlot)
  if (ti < 0 || !tidyP || !(shop?.exists && shop?.complete)) return { order: list, states }
  // gkhelpers-01: a HELPER (a helper lease is mine or free) sees the tidy as any project -- free while it has a slot, in its own
  // place in the order (last): only a bot with nothing else to build helps
  // FOREST-01: every bot but the keeper never sees the forest -- an unsited one reads WAITING, a sited one STANDING with nothing due
  // (activeProject would otherwise offer an open forest as any bot's `open[0]` fallback, a visit the keeper check turns away)
  const hideForest = sts => (forestPlot ? sts.map(st => (st?.plot === forestPlot ? (st.exists ? { ...st, complete: true, damaged: false, due: false, dueFirst: false, free: false } : { ...st, waiting: true, free: false }) : st)) : sts)
  if (d === 'helper') return { order: list, states: hideForest(states) }
  const out = states.slice()
  // FOREST-01: the managed forest is the keeper's too (owner 11-06: part of groundskeeping's outward work) -- FIRST while it wants work
  // (unsited and not waiting, open, damaged, or due: a ripe strip, a plot to replant, leaves, drops), its due read as open so the
  // keeper's order takes it before every other project; every other bot never sees it (free: false). Not wanted: the tidy first.
  const fi = forestPlot ? out.findIndex(st => st.plot === forestPlot) : -1
  const forestP = fi >= 0 ? list.find(p => p.plot === forestPlot) : null
  if (d === 'mine') {
    if (out[ti].complete && out[ti].due) out[ti] = { ...out[ti], complete: false }
    if (forestP && forestWants(out[fi])) {
      if (out[fi].complete && (out[fi].due || out[fi].damaged)) out[fi] = { ...out[fi], complete: false, damaged: false }
      return { order: [forestP, tidyP, ...list.filter(p => p.plot !== tidyPlot && p.plot !== forestPlot)], states: out }
    }
    return { order: [tidyP, ...list.filter(p => p.plot !== tidyPlot)], states: out }
  }
  out[ti] = { ...out[ti], free: false }
  return { order: list, states: hideForest(out) }
}
/** FOREST-01: does the forest want its keeper now? (unsited and not waiting on a failed siting, open, damaged, or due.) Pure. */
export const forestWants = st => !!st && !st.stuck && st.idle !== true && (st.exists ? (!st.complete || !!st.damaged || !!st.due) : st.waiting !== true)
/** Does the town want a keeper now (the workshop stands, the grounds want work)? Pure. */
export const keeperWanted = (states, { shopPlot = 'shop', tidyPlot = 'tidy', forestPlot = null } = {}) => {
  const shop = states.find(st => st.plot === shopPlot), st = states.find(q => q.plot === tidyPlot)
  // forest-01: a forest that wants work keeps the town's keeper too (the lease is not released while the forest is due)
  const fw = forestPlot ? forestWants(states.find(q => q.plot === forestPlot)) : false
  return !!(shop?.exists && shop?.complete) && !!st && (!st.exists || !st.complete || !!st.damaged || !!st.due || fw)
}

// ================================================================================================================================
// GKHELPERS-01: THE GROUNDS CREW (owner 11-03 "do it": the groundskeeper takes 1-2 HELPER bots on its segments). PURE.
//
// WHY (LIVE showcase 11-03, 6 h before 15:40Z): 67 of 176 build_shop calls (9 bots) were turned away `keeper_held` -- the grounds
// were the only open project and they were showcase-Bravo's -- while Bravo's own tidy visits ended `deadline` 26 times on a
// 637-cell terrace stage. The work was there and the bots were idle.
//
// THE SHAPE. The keeper keeps the PLAN: it sites every stage and the land plan, publishes the waivers, the park top-ups and the
// completion, and does every dig the plan names (the clears, the trees and their replants, the cuts: one `seg-clear` lease). A
// HELPER only fills: it takes one of the town's `helper1`/`helper2` leases (never while no keeper holds the grounds, never two, never
// the keeper's own bot), an admission slot like any builder, and the record's FILL segments under their own `seg-<id>` leases. A
// segment is taken only when no other bot's live segment comes within GK.segGap columns of it (crewSegOk), and a bot that finds it
// raced into one after its own take yields it at once (crewYield): no two bots ever work overlapping or adjacent cells. A helper with nothing to fill
// gathers the park's plants (park.mjs gatherTargets); with nothing to gather either it lets its lease go and rests.
// ================================================================================================================================
export const HELPER_LEASES = Object.freeze(['helper1', 'helper2'])
/** Is a lease state live for someone (held now)? Pure. */
const liveOf = (st, now) => !!st && now < (st.holdsUntil ?? 0) && !!st.rec?.holder
/**
 * THE HELPER DECISION -> { d, name }. Pure.
 *   d 'keeper'    I hold the keeper lease (a keeper is never its own helper)
 *     'mine'      I hold helper lease `name` (renew it and help)
 *     'no_keeper' nobody keeps the grounds: no helper without a keeper (the keeper's own take path stands)
 *     'none'      the grounds want no work, or I rest from helping
 *     'take'      helper lease `name` is free and I may take it
 *     'full'      every helper lease is someone else's (or unreadable: read as held, never three helpers)
 *   keeper   leaseState of the keeper lease | null; helpers { helper1: leaseState | null, ... }
 */
export function helperDecision ({ keeper = null, helpers = {}, me, now = Date.now(), work = true, restUntil = 0, G = GK } = {}) {
  if (liveOf(keeper, now) && keeper.rec.holder === me) return { d: 'keeper', name: null }
  const names = HELPER_LEASES.slice(0, G.helpersMax)
  const mine = names.find(n => liveOf(helpers[n], now) && helpers[n].rec.holder === me)
  if (mine) return { d: 'mine', name: mine }
  if (!liveOf(keeper, now)) return { d: 'no_keeper', name: null }
  if (!work || now < restUntil) return { d: 'none', name: null }
  // free: none yet, lapsed past its reclaim, or a lapsed one of mine (takeLease lets its own holder in); an unreadable lease
  // (rec null, blocksUntil Infinity) is never free
  const free = names.find(n => { const st = helpers[n]; return !st || now >= (st.blocksUntil ?? 0) || (!!st.rec && st.rec.holder === me) })
  return free ? { d: 'take', name: free } : { d: 'full', name: null }
}
/** The fill segments' columns -> Map seg -> [[x, z]] (each column once). PREV cells (a stage before's, never worked) are no
 *  segment's. Pure. */
export function segColumns (record) {
  const out = new Map()
  for (const c of record?.cells ?? []) {
    if (!c || c.prev || !Array.isArray(c.at)) continue
    const m = out.get(c.seg) ?? new Map()
    m.set(`${c.at[0]},${c.at[2]}`, [c.at[0], c.at[2]])
    out.set(c.seg, m)
  }
  return new Map([...out].map(([s, m]) => [s, [...m.values()]]))
}
/** Do two segments come within `gap` columns of each other (Chebyshev over x, z: a shared column, a neighbour's, its stand's)? Pure. */
export function segsConflict (cols, a, b, gap = GK.segGap) {
  if (a === b) return true
  const A = cols.get(a) ?? [], B = cols.get(b) ?? []
  for (const [x, z] of A) for (const [u, v] of B) if (Math.max(Math.abs(x - u), Math.abs(z - v)) <= gap) return true
  return false
}
/**
 * MAY THIS BOT TAKE `seg` NOW? -> bool. Pure. `live` { seg: { holder, at } }: the record's segment leases held now. No other bot's
 * live segment within GK.segGap columns (segsConflict); the bot's own and a lapsed lease never stop it.
 */
export function crewSegOk ({ cols, seg, me, live = {}, gap = GK.segGap } = {}) {
  for (const [s, l] of Object.entries(live)) { if (!l || l.holder === me || s === seg) continue; if (segsConflict(cols, seg, s, gap)) return false }
  return true
}
/**
 * AFTER THE TAKE (two bots checked at once and took neighbours): must this bot give `seg` back? -> bool. Pure. Yes when ANY other
 * bot's live segment conflicts with it now, whoever took first (Codex r1 BLOCKER: a lease's `at` is its taker's clock read BEFORE the
 * write, so it cannot order two writes; by timestamp, the earlier-stamped but later-written take saw the other's lease, kept its
 * own, and both bots worked neighbours). Each bot checks only AFTER its own lease is on disk, so of two racers the one that checks
 * second always sees the other and yields: never both proceed (both may yield: each tries the next segment).
 */
export function crewYield ({ cols, seg, me, live = {}, gap = GK.segGap } = {}) {
  for (const [s, l] of Object.entries(live)) if (l && l.holder !== me && s !== seg && segsConflict(cols, seg, s, gap)) return true
  return false
}
/** A helper's view of the record: the plan's digs are the keeper's (no clears, no replants; the cuts are not passed), and the
 *  stage's PREV cells are no one's. Pure. */
export const helperRecord = rec => ({ ...rec, clear: [], replant: [], cells: (rec?.cells ?? []).filter(c => !c.prev) })

/**
 * THE STOREHOUSE'S FLOOR FIRST (owner 11-03, the LIVE showcase incident: at 13:00Z a bot's escape reflex dug up through the
 * storehouse floor -- -10,67..70,4 / -10,68..70,3 / -10,69..70,2 -- and the chests' standing cells had no floor). -> { cells,
 * segments } of the holes to fill, bottom layer first. Pure over `read`.
 *   store  the storehouse record (storehouse.mjs: `floor` y, `baseY`, `inside` [[x, y, z]] the interior stands, `door` [x, y, z],
 *          `frontOpen` [[x, z]] the approach columns)
 * The floor cells are the cells at `floor` under every stand at baseY, the door and the approach columns; a floor cell that does
 * not read solid is a hole, and so is every cell under it down to `depth` until one reads solid (a hole dug from below is filled
 * from its bottom). Never a stand or its head room (they stay air), never an unread column (left for a later visit). Segment
 * T-F<k> is the k-th height from the lowest hole up; each layer waits on the one below it, so the floor goes in last.
 */
export const FLOOR_DEPTH = 4
export function storeFloorHoles (store, read, { depth = FLOOR_DEPTH } = {}) {
  const floor = Number(store?.floor), baseY = Number(store?.baseY)
  if (!store || !Number.isFinite(floor) || !Number.isFinite(baseY)) return { cells: [], segments: [] }
  const cols = new Map()
  const add = (x, z) => { if (Number.isFinite(x) && Number.isFinite(z)) cols.set(`${x},${z}`, [x, z]) }
  for (const s of store.inside ?? []) if (Array.isArray(s) && s[1] === baseY) add(s[0], s[2])
  if (Array.isArray(store.door)) add(store.door[0], store.door[2])
  for (const f of store.frontOpen ?? []) if (Array.isArray(f)) add(f[0], f[1])
  const solid = b => !!b && b.boundingBox === 'block' && !/^(water|lava|bubble_column)$/.test(String(b.name ?? '').replace(/\[.*\]$/, ''))
  const holes = []
  for (const [x, z] of cols.values()) {
    const top = read(x, floor, z)
    if (!top || solid(top)) continue
    const col = [floor]
    for (let y = floor - 1; y >= floor - depth; y--) { const b = read(x, y, z); if (!b) { col.length = 0; break } if (solid(b)) break; col.push(y) }
    for (const y of col) holes.push([x, y, z])
  }
  if (!holes.length) return { cells: [], segments: [] }
  const ys = [...new Set(holes.map(h => h[1]))].sort((a, b) => a - b)
  const segments = ys.map((y, i) => ({ seg: `T-F${i}`, deps: i > 0 ? [`T-F${i - 1}`] : [] }))
  const cells = holes.sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2]).map(at => ({ at, role: 'earth', seg: `T-F${ys.indexOf(at[1])}`, floorFix: true }))
  return { cells, segments }
}
/**
 * THE FLOOR CELLS ON THE RECORD -> the record with the holes not yet on it added (their segments FIRST: runVisit works segments in
 * order) | null (every hole is on it already). Pure. A hole already a cell of the record (any role) is not added twice.
 */
export function withFloorFix (rec, holes, now = Date.now()) {
  if (!rec || !holes?.cells?.length) return null
  const have = new Set((rec.cells ?? []).map(c => c.at.join(',')))
  const add = holes.cells.filter(c => !have.has(c.at.join(',')))
  if (!add.length) return null
  const segIds = new Set((rec.segments ?? []).map(s => s.seg))
  // a later repair's layers are numbered on from the record's own (a T-F0 already worked keeps its id)
  let n = 0
  while (segIds.has(`T-F${n}`)) n++
  const ren = new Map(holes.segments.map((s, i) => [s.seg, `T-F${n + i}`]))
  const cells = add.map(c => ({ ...c, seg: ren.get(c.seg) }))
  const used = new Set(cells.map(c => c.seg))
  const segs = holes.segments.filter(s => used.has(ren.get(s.seg))).map(s => ({ seg: ren.get(s.seg), deps: s.deps.map(d => ren.get(d)).filter(d => used.has(d)) }))
  return { ...rec, cells: [...cells, ...(rec.cells ?? [])], segments: [...segs, ...(rec.segments ?? [])], structure_complete: false, state: 'open', floorFixAt: now }
}
/** The record's open floor repairs -> the cells (floorFix, not done by `done(cell)`). Pure. `done` must count a WAIVED cell done
 *  (crewVisitRecord): a waived hole is no open hole. */
export const floorOpen = (rec, done = () => false) => (rec?.cells ?? []).filter(c => c.floorFix && !c.prev && !done(c))
/**
 * GKSTAGE-01: THE FLOOR VIEW -> { visitRec, floorNow, floorOnly }. Pure. While a storehouse floor hole is OPEN the visit works the floor
 * alone (the chests' standing cells first). `done(cell)`: the block laid OR WAIVED on the record (siteprep's one open-work predicate:
 * the world and the persisted waivers).
 * WHY (LIVE showcase 11-03 21:25Z -> 11-04 12:40Z, tidy gen 20): the floor's lowest hole -10,68,3 (buried under the filled -10,69,3)
 * was waived after two deferring visits; the open test read only the block, so the hole stayed "open" and every visit of the keeper
 * and both helpers was a floor-only visit whose one cell read waived to runVisit -- 326 visits, 0 placed, `complete` with 104 of the
 * roads stage's fills left, and the stage never completed, so the land plan never moved on.
 */
export function floorView (rec, done = () => false) {
  const floorNow = floorOpen(rec, done)
  const floorOnly = floorNow.length > 0
  const visitRec = floorOnly ? { ...rec, cells: (rec.cells ?? []).filter(q => q.floorFix && !q.prev), segments: (rec.segments ?? []).filter(sg => /^T-F\d+$/.test(sg.seg)), clear: [], replant: [] } : rec
  return { visitRec, floorNow, floorOnly }
}
/**
 * WHAT A CREW ROLE MAY DO IN A VISIT -> caps. Pure. The keeper owns the plan; a helper fills (and gathers).
 *   site     site a stage, the land plan, the park's first publish          complete  publish the record's completion
 *   waive    publish a waiver                                               digs      the record's clears, trees, replants, cuts
 *   topup    add park elements, the storehouse floor                         donate   bank its own bag's spare park plants
 */
export function crewCaps (role) {
  const k = role === 'keeper'
  return Object.freeze({ site: k, complete: k, waive: k, digs: k, topup: k, donate: !k, gather: true })
}
/**
 * GKHANDOVER-01: IS MY LEASE LET GO, AS THE DISK SAYS -> bool. Pure over buildproj leaseState's answer READ AGAIN after the release.
 * LIVE showcase 11-04 15:12Z (batch 3, the tripwire's H4): showcase-Frost logged its helper2 release (why=keeper) at :40.806 but no
 * `.released` file was written; it took the keeper lease at :40.874 and held both 3.5 s. A release is confirmed only when the newest
 * generation is released, lapsed, or not mine (another's later take); an unreadable state (leaseState's catch: gen null, blocks for
 * ever) is NOT confirmed. Unconfirmed -> the keeper lease is not taken this tick.
 */
export function releaseConfirmed (state, me, now = Date.now()) {
  if (!state) return true
  if (state.gen == null && !state.rec) return false
  if (state.released) return true
  if (!state.rec || state.rec.holder !== me) return !!state.rec
  return now >= (state.holdsUntil ?? 0)
}
