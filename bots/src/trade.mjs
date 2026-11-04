// VILLAGER TRADE TRIPS (T2 coalsale-01 + T4 buying; trading design docs/reports/trading-design-2026-11-03.md section 9). Pure.
//
// OWNER 11-03/11-04: build the trading skill; no fixed time budget ("why not let the bots roam?"): expedition-style breadcrumbs,
// a reason to turn home, a generous cap only for a stranded bot, roaming legs to look for buyers; town reserves untouched, at
// most 60 coal carried; mason building blocks first; books only once a librarian with a book offer is seen.
// MEASURED 11-03/04: fleet worlds hold employed NOVICE villagers 554-605 blocks from 11 of 16 towns (hive-c / placebo-b ~290;
// four worlds none), all level 1 (never traded); town chests hold 4,619 coal in 461 containers. Showcase expeditions walk a
// median 2.95 blocks/s round trip (p10 2.02), so 600 blocks out and back is ~6.8 min (p10 ~10 min) before any dwell.
// PROVEN sandbox4 11-03 (sandbox/trading/trade-proof.cjs): openVillager parses the 1.21.8 list; trade(i, 1) sell coal 15 ->
// emerald 1 and buy emerald 1 -> tool, server-confirmed; novice offers are random per villager (one toolsmith of three had no
// coal trade): a trade target is an OFFER SEEN IN A LIVE WINDOW, never a profession alone.
import fs from 'node:fs'

export const TRADE = Object.freeze({
  carryMax: 60,                 // at most 60 coal leave town per trip (owner)
  townKeep: 64,                 // the town keeps at least this much coal (> coalrun's COAL_FLOOR 32: the smelt job's own need)
  minSell: 15,                  // one novice coal trade
  radius: 700,                  // a buyer farther than this from home is not a destination
  strandedMs: 45 * 60_000,      // OWNER: a cap only for a stranded / lost bot, never a work budget (~4.4x the p10 600-b round trip)
  lostMs: 60 * 60_000,          // past this the trip is dropped and the bot's ordinary home logic takes over
  roamLegs: 3,                  // legs looking for more buyers when the known one has nothing
  roamStep: 64,
  arriveR: 6,
  crumbEvery: 24,               // a breadcrumb every ~24 blocks walked
  callMs: 150_000,              // one trade_trip call stays inside the runner's 180 s skill timeout
  perBotMs: 2 * 3600_000,       // one trip per bot per 2 h
  failBackoffMs: 6 * 3600_000,  // a trip that found no buyer: 6 h
  emeraldGoal: 4,
  dayFrom: 0, dayTo: 9000,      // start only in the morning (a villager asleep cannot trade; a day is 24000 ticks)
  nightFrom: 12500, nightTo: 23500,
  leaseMs: 90 * 60_000,         // one trip per town at a time
})
export function tradeSwitch (env = process.env) {
  const v = String(env.COALSALE ?? '').toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false')
}
export const tradeModeDetail = (on, census) => `on=${on ? 1 : 0} carry=${TRADE.carryMax} keep=${TRADE.townKeep} radius=${TRADE.radius} stranded_min=${TRADE.strandedMs / 60_000} roam=${TRADE.roamLegs}x${TRADE.roamStep} census=${census}`

// minecraft:villager_profession registry order (1.21; proven against the server census, sandbox4 11-03)
export const PROFESSIONS = ['none', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher',
  'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith']
/** Who may buy coal at novice level (wiki trade tables; fleet census 11-03 saw it on armorer/toolsmith/weaponsmith/fisherman). */
export const COAL_BUYERS = Object.freeze(['armorer', 'toolsmith', 'weaponsmith', 'fisherman'])
/** T4: the building blocks a mason sells (first), and the books worth an emerald (only once a live offer is seen). */
export const BUY_BLOCKS = /^(bricks|brick|chiseled_stone_bricks|[a-z_]*terracotta|[a-z_]*glazed_terracotta|quartz_(block|pillar)|polished_(andesite|diorite|granite)|dripstone_block|smooth_stone)$/
export const BUY_BOOKS = /^minecraft:(mending|efficiency|unbreaking)$/

let censusCache = null
/** The census of employed villagers per pool (merchantcensus.json, a read-only region-copy census 11-04). -> [{p,x,y,z}] */
export function censusOf (pool, { file = new URL('./merchantcensus.json', import.meta.url) } = {}) {
  try { censusCache ??= JSON.parse(fs.readFileSync(file, 'utf8')) } catch { censusCache = {} }
  const l = censusCache?.[pool]
  return Array.isArray(l) ? l : []
}

/** THE DESTINATION: the nearest census coal buyer within radius of home, else the nearest employed villager (roam from it). */
export function pickDestination (list, home, { radius = TRADE.radius, avoid = [] } = {}) {
  const d = v => Math.hypot(v.x - home.x, v.z - home.z)
  const near = (list ?? []).filter(v => Number.isFinite(v?.x) && d(v) <= radius && !avoid.some(a => Math.hypot(a.x - v.x, a.z - v.z) < 32))
  const buyers = near.filter(v => COAL_BUYERS.includes(v.p)).sort((a, b) => d(a) - d(b))
  const any = near.sort((a, b) => d(a) - d(b))
  const v = buyers[0] ?? any[0]
  return v ? { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z), p: v.p, dist: Math.round(d(v)), buyer: !!buyers[0] } : null
}

/** How much coal a trip may take from town -> n (0 = no trip). Pure. Town reserves untouched: only coal above townKeep. */
export function coalForTrip ({ townCoal = 0, held = 0, carryMax = TRADE.carryMax, townKeep = TRADE.townKeep, minSell = TRADE.minSell } = {}) {
  const spare = Math.max(0, townCoal - townKeep)
  const take = Math.min(spare, Math.max(0, carryMax - held))
  // whole trades only: what the bag will hold after the draw, rounded down to a multiple of one trade
  const usable = Math.floor((held + take) / minSell) * minSell
  return usable > 0 ? Math.max(0, usable - held) : 0
}

const isDay = t => t >= TRADE.dayFrom && t <= TRADE.dayTo
export const isNight = t => t >= TRADE.nightFrom && t <= TRADE.nightTo

/** START A TRIP? -> { ok, why }. Pure. */
export function tripAdmit ({ on = true, census = 0, dest = null, now = 0, state = {}, atTown = false, timeOfDay = 0, health = 20,
  freeSlots = 36, take = 0, held = 0, leased = false } = {}) {
  if (!on) return { ok: false, why: 'off' }
  if (!census) return { ok: false, why: 'no_census' }
  if (!dest) return { ok: false, why: 'no_destination' }
  if (!atTown) return { ok: false, why: 'away' }
  if (now - (state.lastTripAt ?? -Infinity) < TRADE.perBotMs) return { ok: false, why: 'cooldown' }
  if (now < (state.backoffUntil ?? -Infinity)) return { ok: false, why: 'backoff' }
  if (!isDay(timeOfDay)) return { ok: false, why: 'not_morning' }
  if (health <= 14) return { ok: false, why: 'health' }
  if (freeSlots < 4) return { ok: false, why: 'bag' }
  if (held + take < TRADE.minSell) return { ok: false, why: 'no_coal' }
  if (leased) return { ok: false, why: 'leased' }
  return { ok: true, why: 'go' }
}

/** A NEW TRIP's state. */
export const newTrip = ({ now, home, dest, take }) => ({ v: 1, phase: take > 0 ? 'stock' : 'out', startedAt: now, home, dest, take,
  crumbs: [{ x: Math.floor(home.x), y: Math.floor(home.y), z: Math.floor(home.z) }], roam: 0, roamCenter: { x: dest.x, y: dest.y, z: dest.z },
  sold: 0, earned: 0, bought: {}, books: 0, seen: [], tried: [], calls: 0, stop: null })

/** WHY TURN HOME NOW -> reason | null. Pure. Never a timer except the stranded cap. */
export function turnHome (trip, { now, timeOfDay = 0, health = 20, freeSlots = 36, coal = 0, emeralds = 0, buyLeft = false } = {}) {
  if (now - trip.startedAt >= TRADE.strandedMs) return 'stranded'
  if (health <= 10) return 'health'
  if (freeSlots <= 0) return 'bag_full'
  if (isNight(timeOfDay)) return 'night'
  if (coal < TRADE.minSell && !(buyLeft && emeralds > 0)) return trip.sold > 0 ? 'sold' : 'no_coal'
  if (trip.earned >= TRADE.emeraldGoal && !(buyLeft && emeralds > 0)) return 'goal'
  return null
}

/** The next roam point: legs around the first destination, a spiral of roamStep. -> {x,y,z} | null when the legs are used. */
export function roamPoint (trip, { legs = TRADE.roamLegs, step = TRADE.roamStep } = {}) {
  if (trip.roam >= legs) return null
  const a = (trip.roam * 137.5) * Math.PI / 180, r = step * (1 + trip.roam * 0.5)
  return { x: Math.round(trip.roamCenter.x + r * Math.cos(a)), y: trip.roamCenter.y, z: Math.round(trip.roamCenter.z + r * Math.sin(a)) }
}

/** Add a breadcrumb when the bot is crumbEvery from the last one. Pure (mutates trip.crumbs). */
export function dropCrumb (trip, p, { every = TRADE.crumbEvery } = {}) {
  const last = trip.crumbs[trip.crumbs.length - 1]
  if (!last || Math.hypot(p.x - last.x, p.z - last.z) >= every) trip.crumbs.push({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) })
  if (trip.crumbs.length > 200) trip.crumbs.splice(1, trip.crumbs.length - 200)
}
/** The crumb to walk to next on the way home: the nearest crumb, then each one before it. Pure. -> crumb | null at home. */
export function nextCrumbHome (trip, p, { arrive = 4 } = {}) {
  if (!trip.crumbs.length) return null
  let i = 0, best = Infinity
  trip.crumbs.forEach((c, k) => { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < best) { best = d; i = k } })
  // standing on (or near) crumb i: walk to i-1; else to i itself
  const k = best <= arrive ? i - 1 : i
  return k >= 0 ? trip.crumbs[k] : null
}

/** A villager as the client sees it (metadata 18 = villager_data, 16 = baby, 6 = pose: 2 sleeping). Pure. */
export function merchantOf (e) {
  if (!e || e.name !== 'villager' || !e.position) return null
  const md = e.metadata ?? []
  const pid = md[18]?.villagerProfession
  return { id: e.id, uuid: e.uuid ?? String(e.id), profession: Number.isInteger(pid) ? (PROFESSIONS[pid] ?? `id${pid}`) : 'unknown',
    level: md[18]?.level ?? null, baby: md[16] === true, sleeping: md[6] === 2 || !!md[14], x: e.position.x, y: e.position.y, z: e.position.z }
}
/** The villagers worth opening near a point, nearest first: adults, awake, not tried this trip; coal buyers (or a mason /
 *  librarian for T4 buying) first. Pure. */
export function tradeCandidates (entities, at, tried = [], { radius = 32, buyBlocks = true } = {}) {
  const out = []
  for (const e of Object.values(entities ?? {})) {
    const m = merchantOf(e)
    if (!m || m.baby || m.sleeping || tried.includes(m.uuid)) continue
    if (!COAL_BUYERS.includes(m.profession) && !(buyBlocks && ['mason', 'librarian'].includes(m.profession))) continue
    const d = Math.hypot(m.x - at.x, m.z - at.z)
    if (d <= radius) out.push({ ...m, dist: d, rank: COAL_BUYERS.includes(m.profession) ? 0 : 1 })
  }
  return out.sort((a, b) => a.rank - b.rank || a.dist - b.dist)
}

const nm = it => String(it?.name ?? '').replace(/^minecraft:/, '')
const left = t => Math.max(0, (t.maximumNbTradeUses ?? 0) - (t.nbTradeUses ?? 0))
/** THE SALE: coal -> emerald offers still open, with how many times each can run on the coal held. Pure. -> [{ i, times, price }] */
export function sellPlan (trades, { coal = 0 } = {}) {
  const out = []
  let have = coal
  for (const [i, t] of (trades ?? []).entries()) {
    if (t?.tradeDisabled || nm(t?.inputItem1) !== 'coal' || nm(t?.outputItem) !== 'emerald' || t?.hasItem2) continue
    const price = t.realPrice ?? t.inputItem1?.count ?? 0
    if (!(price > 0)) continue
    const times = Math.min(left(t), Math.floor(have / price))
    if (times > 0) { out.push({ i, times, price }); have -= times * price }
  }
  return out
}
/** Stored enchantments of an item (1.20.5+ components: { type: 'stored_enchantments', data: { enchantments: [{ id, level }] } },
 *  ids registry numbers on the wire) as 'minecraft:<name>'. Pure; tolerant of shapes. */
export function storedEnchants (item, registry = null) {
  const out = []
  for (const c of item?.components ?? []) {
    if (!/stored_enchantments/.test(String(c?.type ?? ''))) continue
    const list = Array.isArray(c?.data?.enchantments) ? c.data.enchantments : Array.isArray(c?.data) ? c.data : []
    for (const e of list) {
      let id = e?.id ?? e?.enchantment ?? e?.name
      if (Number.isInteger(id)) id = registry?.enchantments?.[id]?.name ?? registry?.enchantmentsArray?.[id]?.name ?? `#${id}`
      if (id != null) out.push(String(id).includes(':') ? String(id) : `minecraft:${id}`)
    }
  }
  return out
}
/** T4 THE PURCHASE: emerald -> wanted block (mason first) and, once seen, one wanted enchanted book. Pure.
 *  -> [{ i, times, price, what }] spending at most `emeralds`, books at most `booksLeft`. */
export function buyPlan (trades, { emeralds = 0, booksLeft = 1, enchName = storedEnchants } = {}) {
  const out = []
  let em = emeralds, books = booksLeft
  const rows = (trades ?? []).map((t, i) => ({ t, i }))
  // books first when one is offered (rare and the reason a librarian is worth a walk), then blocks
  for (const { t, i } of rows) {
    if (t?.tradeDisabled || nm(t?.inputItem1) !== 'emerald' || nm(t?.outputItem) !== 'enchanted_book' || books <= 0) continue
    const price = t.realPrice ?? t.inputItem1?.count ?? 0
    const ids = enchName(t.outputItem)
    if (!ids.some(id => BUY_BOOKS.test(id))) continue
    if (t.hasItem2 && nm(t.inputItem2) !== 'book') continue
    if (price > 0 && price <= em && left(t) > 0) { out.push({ i, times: 1, price, what: `enchanted_book:${ids.join('+')}`, needsBook: !!t.hasItem2 }); em -= price; books-- }
  }
  for (const { t, i } of rows) {
    if (t?.tradeDisabled || nm(t?.inputItem1) !== 'emerald' || t?.hasItem2 || !BUY_BLOCKS.test(nm(t?.outputItem))) continue
    const price = t.realPrice ?? t.inputItem1?.count ?? 0
    if (!(price > 0)) continue
    const times = Math.min(left(t), Math.floor(em / price))
    if (times > 0) { out.push({ i, times, price, what: nm(t.outputItem) }); em -= times * price }
  }
  return out
}
/** The offers a window showed, one short string each (the `_trade_seen` row: what the merchant scout would confirm). Pure. */
export const offersDetail = trades => (trades ?? []).map(t => `${nm(t.inputItem1)}${t.inputItem1?.count ?? ''}${t.hasItem2 ? `+${nm(t.inputItem2)}${t.inputItem2?.count ?? ''}` : ''}>${nm(t.outputItem)}${t.outputItem?.count ?? ''}${t.tradeDisabled ? '(x)' : ''}`).join(' ').slice(0, 240)

export const tripDetail = (trip, extra = '') => `phase=${trip.phase} dest=${trip.dest ? `${trip.dest.x},${trip.dest.z} ${trip.dest.p}` : '?'} ` +
  `crumbs=${trip.crumbs.length} roam=${trip.roam} sold=${trip.sold} earned=${trip.earned} bought=${Object.entries(trip.bought).map(([k, n]) => `${k}:${n}`).join(',') || 'none'} ` +
  `books=${trip.books} min=${Math.round((Date.now() - trip.startedAt) / 60_000)}${trip.stop ? ` stop=${trip.stop}` : ''}${extra ? ` ${extra}` : ''}`
