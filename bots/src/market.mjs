// THE MARKET (market-01; docs/reports/market-design-2026-11-06.md). Pure decisions + the merchant window driver.
//
// OWNER 11-06: "what should the bots unlock first?" -> LIVE VILLAGER TRADING: turn the stone / cobble / coal / iron glut into
// emeralds, then buy what the towns lack; bots place job blocks beside unemployed villagers in a market by the village edge
// (never inside a protected village's structures); never break the village, never trap a villager.
//
// MEASURED 11-06 (showcase, 24 h, 765,287 log lines, 15 bots): 2,804 `_merchant_seen` rows = 7 distinct villagers, all
// jobless and PENNED inside village-taiga-6_1's trapdoor rings, plus 3 distinct WANDERING TRADERS near town (64 rows); no other
// villager seen. Town index (27 containers, 24 distinct items): iron_ingot 225, coal 83, glass_pane 48, spruce/oak logs 167,
// stone 2, emerald 0. So the first live counterparty is the wandering trader, and the villager market waits for free villagers.
//
// PROVEN on Paper 1.21.8 / mineflayer 4.37.1 (sandbox4 11-06, sandbox/trading/market-proof.cjs; tables in the design doc):
//  - the 1.21.8 trade TABLES (13 professions x 5 levels x 16 fresh villagers, from the server's own Offers record): CATALOGUE;
//  - the wandering trader BUYS in 1.21.8: hay_block 1 -> 1 emerald, water_bucket 1 -> 2, milk_bucket 1 -> 2, potion (water)
//    1 -> 1, fermented_spider_eye 1 -> 3 (max 2 uses each, 2 of them per trader); a SELL to it server-confirmed (milk ->
//    2 emeralds) through openMerchant below (mineflayer's openVillager asserts the villager entity type; the window is the same);
//  - the client's window offers match the server's record (13 professions, levels 1-2).
import { merchantOf, storedEnchants, offersDetail } from './trade.mjs'
import { unemployedClusters, pickJobCell, JOB_BLOCKS } from './jobsite.mjs'

export const MARKET = Object.freeze({
  radius: 96,                    // a merchant at most this far from home (6 chunks: the simulation distance) -- a town walk
  zonePad: 3,                    // a market cell and a merchant stand at least this far outside every protected zone box
  perBotMs: 40 * 60_000,         // one market run per bot per 40 min
  restMs: 20 * 60_000,           // one run per merchant per 20 min (a Minecraft day; it restocks at most twice a day at work)
  failBackoffMs: 2 * 3600_000,   // a merchant whose run failed (unreachable, no window) rests 2 h
  dayFrom: 1000, dayTo: 11000,   // villagers trade while awake; the run starts in daylight only
  spendPerRun: 8,                // emeralds a run may spend
  emeraldKeep: 0,                // the town keeps none back: emeralds are for spending
  callMs: 165_000,               // one market_run inside the runner's 180 s watchdog (SKILL_TIMEOUT_MS; the contract's maxMs is not read)
  leaseMs: 15 * 60_000,          // one run per town at a time (a pool lease)
  maxGoods: 3,                   // at most three goods drawn for one run
  offersFreshMs: 24 * 3600_000,  // a merchant's last-read offers are trusted this long (a window is the only truth)
  claimWaitMs: 20_000,           // a placed job block's claim is read this long after (sandbox 11-06: 8.7-17.3 s at 16-44 b)
  claimReach: 40,                // a market cell within this of the free cluster (a job site is sought within 48 b; reachable)
  jobsPerDay: 2,                 // job blocks per town per day
  slotSpacing: 3,                // market job blocks this far apart (each keeps its 8 neighbours open)
  freeMoveB: 6,                  // a jobless villager seen this far from where it was is FREE (6_1's ring pens span <= 3 b)
  freeSeenMs: 5 * 60_000,        // ... between sightings at least this far apart
  seenKeepMs: 45 * 60_000,       // sightings older than this are dropped
})
export function marketSwitch (env = process.env) {
  const v = String(env.MARKET ?? '').toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false')
}
export function marketJobsSwitch (env = process.env) {
  const v = String(env.MARKET_JOBS ?? '').toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false')
}
/**
 * THE MARKET YIELDS (the batch19b fold, Codex BLOCKERS 2 + 4) -> why | null. Pure. The ask sits in the build order's IDLE branch,
 * which reads the bot's LAST stop (`no_material` may be stale), so it yields to the work that stop never saw:
 *  - share_held: the bot holds a building share (skills.mjs shopShareHeld): a market craft or sale would spend the project's
 *    materials. The share's own visit (or the bag-room share bank) returns them; the market is asked again after;
 *  - keeper: the bot holds its town's keeper lease (keeperNow): the order's tidy is its work, never a walk out with the lease held;
 *  - service_due: a production service offer stands for it (prodserve.mjs serviceOffer): the order's service visit comes first, so
 *    the offer never lapses (and charges the bot's share) during a market walk.
 * Each falls through to the ordinary build order, which issues that work.
 */
export function marketYield ({ shareHeld = false, keeper = false, serviceLive = false } = {}) {
  if (shareHeld) return 'share_held'
  if (keeper) return 'keeper'
  if (serviceLive) return 'service_due'
  return null
}
export const marketModeDetail = (on, jobs) => `on=${on ? 1 : 0} jobs=${jobs ? 1 : 0} radius=${MARKET.radius} spend=${MARKET.spendPerRun} rest_min=${MARKET.restMs / 60_000} per_bot_min=${MARKET.perBotMs / 60_000} claim_reach=${MARKET.claimReach}`

// ---- the 1.21.8 catalogue (sandbox4 11-06; N=16 villagers per profession and level; the server's own Offers record) ----------
/** Profession -> its job-site block. */
export const PROFESSION_BLOCK = Object.freeze({ armorer: 'blast_furnace', butcher: 'smoker', cartographer: 'cartography_table', cleric: 'brewing_stand',
  farmer: 'composter', fisherman: 'barrel', fletcher: 'fletching_table', leatherworker: 'cauldron', librarian: 'lectern', mason: 'stonecutter',
  shepherd: 'loom', toolsmith: 'smithing_table', weaponsmith: 'grindstone' })
/** Job blocks no bot can make here (peaceful, no Nether): what blocks each. Their professions come only from village job sites. */
export const UNMAKEABLE = Object.freeze({ brewing_stand: 'blaze_rod (no Nether)', lectern: 'bookshelf -> book -> leather (no animals near)', loom: 'string (no spiders in peaceful)' })
/**
 * WHAT EACH PROFESSION BUYS FROM US (goods -> emerald), by level, as the proof saw it: [item, count per emerald, level, share of
 * the 16 sampled villagers that had it]. A level-1 offer is random per villager (2 of the pool): the share says how often.
 */
export const BUYS = Object.freeze({
  armorer: [['coal', 15, 1, 10 / 16], ['iron_ingot', 4, 2, 6 / 16], ['lava_bucket', 1, 3, 9 / 16], ['diamond', 1, 3, 4 / 16]],
  butcher: [['chicken', 14, 1, 12 / 16], ['porkchop', 7, 1, 9 / 16], ['rabbit', 4, 1, 5 / 16], ['coal', 15, 2, 12 / 16], ['beef', 10, 3, 1], ['mutton', 7, 3, 1], ['dried_kelp_block', 10, 4, 1], ['sweet_berries', 10, 5, 1]],
  cartographer: [['paper', 24, 1, 1], ['glass_pane', 11, 2, 11 / 16], ['compass', 1, 3, 12 / 16]],
  cleric: [['rotten_flesh', 32, 1, 1], ['gold_ingot', 3, 2, 1], ['rabbit_foot', 2, 3, 1], ['turtle_scute', 4, 4, 10 / 16], ['glass_bottle', 9, 4, 10 / 16], ['nether_wart', 22, 5, 1]],
  farmer: [['beetroot', 15, 1, 9 / 16], ['potato', 26, 1, 7 / 16], ['wheat', 20, 1, 7 / 16], ['carrot', 22, 1, 5 / 16], ['pumpkin', 6, 2, 14 / 16], ['melon', 4, 3, 1]],
  fisherman: [['coal', 10, 1, 10 / 16], ['string', 20, 1, 7 / 16], ['cod', 15, 2, 13 / 16], ['salmon', 13, 3, 1], ['tropical_fish', 6, 4, 1], ['pufferfish', 4, 5, 1], ['oak_boat', 1, 5, 1]],
  fletcher: [['stick', 32, 1, 12 / 16], ['flint', 26, 2, 1], ['string', 14, 3, 1], ['feather', 24, 4, 1], ['tripwire_hook', 8, 5, 10 / 16]],
  leatherworker: [['leather', 6, 1, 8 / 16], ['flint', 26, 2, 12 / 16], ['rabbit_hide', 9, 3, 1], ['turtle_scute', 4, 4, 1]],
  librarian: [['paper', 24, 1, 11 / 16], ['book', 4, 2, 10 / 16], ['ink_sac', 5, 3, 9 / 16], ['writable_book', 2, 4, 6 / 16]],
  mason: [['clay_ball', 10, 1, 1], ['stone', 20, 2, 1], ['andesite', 16, 3, 5 / 16], ['granite', 16, 3, 5 / 16], ['diorite', 16, 3, 3 / 16], ['quartz', 12, 4, 1 / 16]],
  shepherd: [['white_wool', 18, 1, 6 / 16], ['gray_wool', 18, 1, 10 / 16], ['black_wool', 18, 1, 5 / 16], ['brown_wool', 18, 1, 2 / 16]],
  toolsmith: [['coal', 15, 1, 6 / 16], ['iron_ingot', 4, 2, 1], ['flint', 30, 3, 5 / 16], ['diamond', 1, 4, 12 / 16]],
  weaponsmith: [['coal', 15, 1, 9 / 16], ['iron_ingot', 4, 2, 1], ['flint', 24, 3, 1], ['diamond', 1, 4, 1]],
  wandering_trader: [['hay_block', 1, 1, 4 / 6], ['milk_bucket', 1, 1, 3 / 6], ['fermented_spider_eye', 1, 1, 3 / 6], ['water_bucket', 1, 1, 1 / 6], ['potion', 1, 1, 1 / 6]],
})
/**
 * WHAT WE MAY SELL, and what the town keeps of each. Only renewable or surplus goods; never diamonds, lapis, redstone, books,
 * tools, the bot's own kit. `carry` = at most this many leave town on one run. water_bucket: only an EXTRA bucket the run made
 * (marketRun keeps the kit's bucket), never one a bot needs for lava or water.
 */
export const GOODS = Object.freeze({
  iron_ingot: { keep: 64, carry: 48 }, coal: { keep: 64, carry: 60 }, stone: { keep: 192, carry: 128 },
  stick: { keep: 32, carry: 128 }, paper: { keep: 24, carry: 96 }, glass_pane: { keep: 32, carry: 66 },
  wheat: { keep: 16, carry: 80 }, potato: { keep: 16, carry: 104 }, carrot: { keep: 16, carry: 88 }, beetroot: { keep: 16, carry: 60 },
  pumpkin: { keep: 4, carry: 24 }, melon: { keep: 4, carry: 16 }, flint: { keep: 16, carry: 78 }, clay_ball: { keep: 0, carry: 40 },
  andesite: { keep: 32, carry: 64 }, granite: { keep: 32, carry: 64 }, diorite: { keep: 32, carry: 64 },
  dried_kelp_block: { keep: 8, carry: 40 }, sweet_berries: { keep: 16, carry: 40 }, hay_block: { keep: 0, carry: 4 },
  water_bucket: { keep: 0, carry: 2 },
})
/**
 * THE TOWN'S WANTS (what to buy): item (or /pattern/), the stock the town aims at, the highest price paid per trade (emeralds),
 * and why. The owner's list first (11-06: wool, books, lanterns, redstone, glass, string, lapis -- of these villagers sell wool
 * (shepherd), lanterns + glass + bookshelves (librarian: a bookshelf breaks into 3 books), redstone + lapis (cleric); NO villager
 * sells string or a plain book), then the building blocks a bot-made market can give (mason, cartographer), then decoration from
 * the wandering trader. A want is bought only while the town is short of it (target - town - bag > 0).
 */
export const WANTS = Object.freeze([
  { key: 'wool', item: /^[a-z_]+_wool$/, target: 32, ceiling: 2, why: 'owner' },
  { key: 'lantern', item: 'lantern', target: 16, ceiling: 2, why: 'owner' },
  { key: 'redstone', item: 'redstone', target: 64, ceiling: 2, why: 'owner' },
  { key: 'glass', item: 'glass', target: 64, ceiling: 2, why: 'owner' },
  { key: 'lapis_lazuli', item: 'lapis_lazuli', target: 64, ceiling: 2, why: 'owner' },
  { key: 'bookshelf', item: 'bookshelf', target: 4, ceiling: 10, why: 'owner:books' },
  { key: 'bed', item: /^[a-z_]+_bed$/, target: 4, ceiling: 3, why: 'breeding' },   // market-02 D2: beds at the village edge
  { key: 'brick', item: 'brick', target: 256, ceiling: 1, why: 'build' },
  { key: 'chiseled_stone_bricks', item: 'chiseled_stone_bricks', target: 32, ceiling: 1, why: 'build' },
  { key: 'polished', item: /^polished_(andesite|diorite|granite)$/, target: 64, ceiling: 1, why: 'build' },
  { key: 'dripstone_block', item: 'dripstone_block', target: 16, ceiling: 1, why: 'build' },
  { key: 'terracotta', item: /^[a-z_]+_(glazed_)?terracotta$/, target: 64, ceiling: 1, why: 'build' },
  { key: 'quartz', item: /^quartz_(block|pillar)$/, target: 64, ceiling: 1, why: 'build' },
  { key: 'banner', item: /^[a-z_]+_banner$/, target: 8, ceiling: 3, why: 'decor' },
  { key: 'item_frame', item: 'item_frame', target: 4, ceiling: 7, why: 'decor' },
  { key: 'campfire', item: 'campfire', target: 4, ceiling: 2, why: 'decor' },
  { key: 'bell', item: 'bell', target: 1, ceiling: 36, why: 'decor:town_bell' },
  // the wandering trader: other woods (8 logs an emerald), dyes, flowers, pumpkins
  { key: 'logs', item: /^(cherry|mangrove|pale_oak|acacia|jungle|dark_oak|birch)_log$/, target: 32, ceiling: 1, why: 'palette' },
  { key: 'dye', item: /^[a-z_]+_dye$/, target: 12, ceiling: 1, why: 'palette' },
  { key: 'flower', item: /^(poppy|dandelion|cornflower|blue_orchid|allium|azure_bluet|oxeye_daisy|lily_of_the_valley|[a-z_]+_tulip)$/, target: 4, ceiling: 1, why: 'decor' },
  { key: 'pumpkin', item: 'pumpkin', target: 4, ceiling: 1, why: 'decor' },
])

/** THE TIER of a want (OWNER 11-07 D3: decorative buying YES, ranked LAST, inside the run's 8-emerald cap): owner < build < decor. */
export const tierOf = w => (String(w?.why ?? '').startsWith('owner') || w?.why === 'breeding' ? 0 : w?.why === 'build' ? 1 : 2)
const bare = n => String(n ?? '').replace(/^minecraft:/, '')
const matches = (want, name) => typeof want.item === 'string' ? want.item === name : want.item.test(name)
/** The want an item answers, or null. Pure. */
export const wantOf = name => WANTS.find(w => matches(w, bare(name))) ?? null

/** THE MARKET'S KEEPS (the batch19b fold, Codex BLOCKER 3) -> bool. Pure. A name the town buys is banked by the ordinary deposit
 *  (bankable.mjs setDepositExtra) and is never disposal junk (well.mjs setWellKeep). Beds excepted: a bot's own bed is its kit (the
 *  sleep skill) and a walk-in's beds are drawn for the village -- the bed is never well junk anyway (NEVER_DISPOSE `_bed$`). */
export const marketKeeps = name => { const w = wantOf(name); return !!w && w.key !== 'bed' }
/** Count of every item matching `pred` in a { name: n } map. Pure. */
const countWhere = (stock, pred) => Object.entries(stock ?? {}).reduce((n, [k, v]) => n + (pred(k) ? Math.max(0, Number(v) || 0) : 0), 0)
/**
 * THE TOWN'S WANTS NOW -> [{ key, need, target, have, ceiling, why, rank }] (need > 0 only, the owner's first). Pure.
 * stock: the town index's { name: n } (each container's last observation); bag: the runner's own { name: n }.
 */
export function townWants (stock = {}, bag = {}) {
  const out = []
  for (const [rank, w] of WANTS.entries()) {
    const pred = k => matches(w, k)
    const have = countWhere(stock, pred) + countWhere(bag, pred)
    const need = Math.max(0, w.target - have)
    if (need > 0) out.push({ key: w.key, need, target: w.target, have, ceiling: w.ceiling, why: w.why, rank })
  }
  return out
}
/** Goods the town can spare -> { name: n } (above the keep, at most `carry`). Pure. */
export function spareGoods (stock = {}, bag = {}) {
  const out = {}
  for (const [name, g] of Object.entries(GOODS)) {
    const spare = Math.max(0, (Number(stock[name]) || 0) - g.keep) + Math.max(0, Number(bag[name]) || 0)
    if (spare > 0) out[name] = Math.min(spare, g.carry)
  }
  return out
}

// ---- merchants ----------------------------------------------------------------------------------------------------------------
/** A merchant as the client sees it: a villager (trade.mjs merchantOf) or a wandering trader. Pure. */
export function merchantOfAny (e) {
  if (!e?.position) return null
  if (e.name === 'wandering_trader') return { id: e.id, uuid: e.uuid ?? String(e.id), profession: 'wandering_trader', level: null, baby: false, sleeping: false, x: e.position.x, y: e.position.y, z: e.position.z }
  return merchantOf(e)
}
/** Inside (or within `pad` of) any protected zone box -> the zone id | null. Pure. zones: { id, box:[x0,y0,z0,x1,y1,z1] } or parsed {x0..z1}. */
export function zoneNear (zones, x, z, pad = MARKET.zonePad) {
  for (const q of zones ?? []) {
    const b = Array.isArray(q?.box) ? q.box : (q && Number.isFinite(q.x0) ? [q.x0, q.y0, q.z0, q.x1, q.y1, q.z1] : null)
    if (b && x >= b[0] - pad && x <= b[3] + pad && z >= b[2] - pad && z <= b[5] + pad) return q.id ?? 'unnamed'
  }
  return null
}
/**
 * MERCHANTS A RUN MAY VISIT -> [{ ...merchant, dist }] nearest home first. Pure. An employed adult villager or a wandering
 * trader, awake, within MARKET.radius of home, standing OUTSIDE every protected zone (+ pad): a run never walks into a village.
 */
export function runCandidates (entities, home, zones = [], { radius = MARKET.radius } = {}) {
  const out = []
  for (const e of Object.values(entities ?? {})) {
    const m = merchantOfAny(e)
    if (!m || m.baby || m.sleeping) continue
    if (m.profession !== 'wandering_trader' && ['none', 'nitwit', 'unknown'].includes(m.profession)) continue
    const dist = Math.hypot(m.x - home.x, m.z - home.z)
    if (!(dist <= radius)) continue
    if (zoneNear(zones, Math.floor(m.x), Math.floor(m.z))) continue
    out.push({ ...m, dist })
  }
  return out.sort((a, b) => a.dist - b.dist)
}

// ---- what a merchant is worth a visit for --------------------------------------------------------------------------------------
const nm = it => bare(it?.name)
const usesLeft = t => Math.max(0, (t?.maximumNbTradeUses ?? 0) - (t?.nbTradeUses ?? 0))
const priceOf = t => t?.realPrice ?? t?.inputItem1?.count ?? 0
/**
 * THE GOODS TO CARRY to one merchant -> { name: n } (at most MARKET.maxGoods goods). Pure. From its last-read offers when known
 * (known: [{ in, n, out, out_n, left }] -- the pool's record of its window), else from its profession's catalogue (level-1
 * offers, the likeliest first). Never more than the town can spare, nor more than the offers' uses left can take.
 */
export function goodsFor (merchant, { known = null, spare = {} } = {}) {
  const want = {}
  if (Array.isArray(known) && known.length) {
    for (const o of known) {
      if (o.out !== 'emerald' || o.in2 || !(spare[o.in] > 0) || !(o.left > 0) || !(o.n > 0)) continue
      const can = Math.min(spare[o.in], o.left * o.n)
      const whole = Math.floor(can / o.n) * o.n
      if (whole > 0) want[o.in] = Math.max(want[o.in] ?? 0, whole)
    }
  } else {
    const level = merchant?.level ?? 1
    for (const [item, n, lv] of (BUYS[merchant?.profession] ?? []).filter(b => b[2] <= level).sort((a, b) => b[3] - a[3])) {
      if (!(spare[item] > 0)) continue
      const whole = Math.floor(Math.min(spare[item], GOODS[item]?.carry ?? 0) / n) * n
      if (whole > 0 && !(item in want)) want[item] = whole
    }
  }
  return Object.fromEntries(Object.entries(want).slice(0, MARKET.maxGoods))
}
/** A window's offers as the pool records them. Pure. */
export const offersRecord = trades => (trades ?? []).map(t => ({ in: nm(t?.inputItem1), n: t?.inputItem1?.count ?? 0, price: priceOf(t), in2: t?.hasItem2 ? nm(t?.inputItem2) : null,
  out: nm(t?.outputItem), out_n: t?.outputItem?.count ?? 0, left: t?.tradeDisabled ? 0 : usesLeft(t) }))

/**
 * THE SALE in an open window -> [{ i, times, price, item }]. Pure. Goods -> emerald offers with uses left, no second input,
 * paid from what the bag holds (`have`, already capped by the run's draw), the dearest-per-unit first (fewest goods per emerald).
 * water_bucket: only `extraBuckets` of them (the kit's bucket is never sold).
 */
export function sellOffers (trades, have = {}) {
  const left = { ...have }
  const rows = (trades ?? []).map((t, i) => ({ t, i }))
    .filter(({ t }) => !t?.tradeDisabled && !t?.hasItem2 && nm(t?.outputItem) === 'emerald' && GOODS[nm(t?.inputItem1)] && priceOf(t) > 0)
    .sort((a, b) => (priceOf(a.t) / Math.max(1, a.t.outputItem?.count ?? 1)) - (priceOf(b.t) / Math.max(1, b.t.outputItem?.count ?? 1)))
  const out = []
  for (const { t, i } of rows) {
    const item = nm(t.inputItem1), price = priceOf(t)
    const times = Math.min(usesLeft(t), Math.floor((left[item] ?? 0) / price))
    if (times > 0) { out.push({ i, times, price, item, earn: times * (t.outputItem?.count ?? 1) }); left[item] -= times * price }
  }
  return out
}
/**
 * THE PURCHASE in an open window -> [{ i, times, price, what, want }]. Pure. emerald -> wanted item offers (no second input),
 * price at or under the want's ceiling, at most the want's need (in units), at most `emeralds` spent; the owner's wants first.
 * wants: townWants(). Units bought per trade = the offer's output count.
 */
export function buyOffers (trades, { emeralds = 0, wants = [] } = {}) {
  let em = emeralds
  const need = Object.fromEntries(wants.map(w => [w.key, w.need]))
  const rows = []
  for (const [i, t] of (trades ?? []).entries()) {
    if (t?.tradeDisabled || t?.hasItem2 || nm(t?.inputItem1) !== 'emerald') continue
    const out = nm(t?.outputItem), w = wantOf(out)
    if (!w || !(need[w.key] > 0)) continue
    const price = priceOf(t)
    if (!(price > 0) || price > w.ceiling) continue
    rows.push({ i, t, out, w, price, rank: WANTS.indexOf(w) })
  }
  // the owner's list (and the breeding beds) first, then building blocks, then decoration LAST (OWNER 11-07 D3); within a tier the table order
  rows.sort((a, b) => tierOf(a.w) - tierOf(b.w) || a.rank - b.rank || a.price - b.price)
  const plan = []
  for (const r of rows) {
    const per = Math.max(1, r.t.outputItem?.count ?? 1)
    const times = Math.min(usesLeft(r.t), Math.floor(em / r.price), Math.ceil(need[r.w.key] / per))
    if (times <= 0) continue
    plan.push({ i: r.i, times, price: r.price, what: r.out, want: r.w.key, per })
    em -= times * r.price
    need[r.w.key] -= times * per
  }
  return plan
}

// ---- the run's admission -----------------------------------------------------------------------------------------------------
const isDay = t => t >= MARKET.dayFrom && t <= MARKET.dayTo
/**
 * START A MARKET RUN? -> { ok, why, merchant, goods, spend }. Pure. At town, in daylight, healthy, room in the bag, off its
 * cooldown, the town lease free; a candidate merchant not resting, worth the walk: goods it buys that the town can spare, or
 * (with emeralds to spend) offers known to sell a want; an UNREAD merchant (no offers on record) is worth one look.
 */
export function marketRunAdmit ({ on = true, atTown = false, now = 0, timeOfDay = 0, health = 20, freeSlots = 36, state = {},
  candidates = [], offersOf = () => null, restOf = () => -Infinity, spare = {}, emeralds = 0, wants = [], leased = false } = {}) {
  if (!on) return { ok: false, why: 'off' }
  if (!atTown) return { ok: false, why: 'away' }
  if (now - (state.lastRunAt ?? -Infinity) < MARKET.perBotMs) return { ok: false, why: 'cooldown' }
  if (!isDay(timeOfDay)) return { ok: false, why: 'night' }
  if (health <= 14) return { ok: false, why: 'health' }
  if (freeSlots < MARKET.maxGoods + 2) return { ok: false, why: 'bag' }
  if (!candidates.length) return { ok: false, why: 'no_merchant' }
  let best = null
  for (const m of candidates) {
    if (now < restOf(m.uuid)) continue
    const rec = offersOf(m.uuid)
    const known = rec && now - (rec.at ?? 0) < MARKET.offersFreshMs ? rec.offers : null
    const goods = goodsFor(m, { known, spare })
    const nGoods = Object.keys(goods).length
    const spend = known ? buyOffers(known.map(o => ({ inputItem1: { name: o.in, count: o.n }, realPrice: o.price, hasItem2: !!o.in2, outputItem: { name: o.out, count: o.out_n }, maximumNbTradeUses: o.left, nbTradeUses: 0 })), { emeralds: Math.min(emeralds, MARKET.spendPerRun), wants })
      .reduce((n, b) => n + b.times * b.price, 0) : 0
    const unread = !known
    if (!nGoods && !spend && !unread) continue
    const score = nGoods * 10 + spend + (unread ? 1 : 0)
    if (!best || score > best.score) best = { m, goods, spend, score, unread }
  }
  if (!best) return { ok: false, why: 'nothing_to_trade' }
  if (leased) return { ok: false, why: 'leased' }
  return { ok: true, why: best.unread ? 'look' : 'trade', merchant: best.m, goods: best.goods, spend: best.spend }
}

// ---- the window --------------------------------------------------------------------------------------------------------------
/**
 * OPEN ANY MERCHANT (sandbox4 11-06): mineflayer's openVillager asserts entityType === villager; a wandering trader's window is
 * the same flow (window type minecraft:merchant, which the plugin accepts). A view of the entity with the villager's type id.
 */
export function openMerchant (bot, e) {
  const vt = bot.registry?.entitiesByName?.villager?.id
  const view = e?.entityType === vt || vt == null ? e : Object.assign(Object.create(e), { entityType: vt })
  return bot.openVillager(view)
}
/** Every voxel a segment a -> b crosses, in order (Amanatides-Woo), as {x,y,z} integer cells, the start cell first. Pure. */
export function voxelsOnSegment (a, b, { max = 64 } = {}) {
  const out = []
  let x = Math.floor(a.x), y = Math.floor(a.y), z = Math.floor(a.z)
  const ex = Math.floor(b.x), ey = Math.floor(b.y), ez = Math.floor(b.z)
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz)
  const tD = d => (d === 0 ? Infinity : Math.abs(1 / d))
  const tN = (p, d, s0) => (d === 0 ? Infinity : ((s0 > 0 ? Math.floor(p) + 1 - p : p - Math.floor(p)) / Math.abs(d)))
  let tx = tN(a.x, dx, sx), ty = tN(a.y, dy, sy), tz = tN(a.z, dz, sz)
  const ddx = tD(dx), ddy = tD(dy), ddz = tD(dz)
  out.push({ x, y, z })
  while ((x !== ex || y !== ey || z !== ez) && out.length < max) {
    if (tx <= ty && tx <= tz) { if (tx > 1) break; x += sx; tx += ddx } else if (ty <= tz) { if (ty > 1) break; y += sy; ty += ddy } else { if (tz > 1) break; z += sz; tz += ddz }
    out.push({ x, y, z })
  }
  return out
}
/** Empty slots of the window's PLAYER section (inventoryStart..inventoryEnd), or 36 when the window gives no slots. Never throws. */
export const MIN_FREE = 2
export function freeSlotsIn (v) {
  try {
    if (!Array.isArray(v?.slots) || !Number.isInteger(v.inventoryStart)) return 36
    const end = Number.isInteger(v.inventoryEnd) ? v.inventoryEnd : v.inventoryStart + 36
    let n = 0
    for (let i = v.inventoryStart; i < end; i++) if (!v.slots[i]) n++
    return n
  } catch { return 36 }
}
/** The bag as the OPEN window shows it (bot.inventory is stale inside a window: sandbox4 11-04). Never throws. */
export const winCount = (v, name) => { try { return (v.items?.() ?? []).filter(x => x?.name === name).reduce((n, x) => n + (x.count ?? 0), 0) } catch { return 0 } }
const winCountWhere = (v, pred) => { try { return (v.items?.() ?? []).filter(x => pred(x?.name)).reduce((n, x) => n + (x.count ?? 0), 0) } catch { return 0 } }
/**
 * RUN THE PLANNED TRADES on an open window, each recounted from the window (what the SERVER moved). Each trade awaited whole
 * (never raced: a raced trade kept clicking after the close -- coalsale-01 Codex re-check). The first trade that throws ends the
 * window (`halt`). -> { sold: {item: n}, earned, spent, bought: {item: n}, halt, why }
 */
/** One trade, bounded: v.trade raced against tradeMs (Codex m2 BLOCKER: an unanswered trade must not hold a bot in a village zone
 *  for the tripwire's 15 min). On a timeout the trade's own promise is left to fail when the caller closes the window (its rejection
 *  is caught here) and the window halts. -> null | the error. */
async function tradeOnce (v, i, n, tradeMs) {
  const p = Promise.resolve().then(() => v.trade(i, n))
  if (!tradeMs) { try { await p; return null } catch (e) { return e } }
  let tm = null
  const late = new Promise(resolve => { tm = setTimeout(() => resolve(new Error('trade timed out')), tradeMs) })
  try { return await Promise.race([p.then(() => null, e => e), late]) } finally { clearTimeout(tm); p.catch(() => {}) }
}
export async function runTrades (v, { sells = [], buys = [] } = {}, { sleep = ms => new Promise(r => setTimeout(r, ms)), stackOf = () => 64, tradeMs = 20_000 } = {}) {
  const res = { sold: {}, earned: 0, spent: 0, bought: {}, halt: false, why: null }
  // ROOM FIRST (Codex review r1 BLOCKER 3): mineflayer's trade puts the output and any leftover inputs away with putAway, which
  // DROPS what does not fit -- every trade needs MIN_FREE empty slots in the window's player section, else the window stops
  const roomy = () => freeSlotsIn(v) >= MIN_FREE
  for (const s of sells) {
    if (!roomy()) { res.halt = true; res.why = 'bag_full'; return res }
    const c0 = winCount(v, s.item), e0 = winCount(v, 'emerald')
    const bad = await tradeOnce(v, s.i, s.times, tradeMs)
    await sleep(300)
    const gone = Math.max(0, c0 - winCount(v, s.item))
    if (gone) res.sold[s.item] = (res.sold[s.item] ?? 0) + gone
    res.earned += Math.max(0, winCount(v, 'emerald') - e0)
    if (bad) { res.halt = true; res.why = `sell:${String(bad?.message ?? bad).slice(0, 40)}`; return res }
  }
  for (let b of buys) {
    if (!roomy()) { res.halt = true; res.why = 'bag_full'; return res }
    // a purchase's output may need more than one stack: at most what the free slots hold, past MIN_FREE
    // by the item's OWN stack size (Codex r2 BLOCKER 3: a bed stacks to 1, so 4 beds need 4 slots)
    const per = Math.max(1, b.per ?? 1), fit = Math.floor(((freeSlotsIn(v) - MIN_FREE + 1) * Math.max(1, stackOf(b.what) || 64)) / per)
    if (fit < b.times) b = { ...b, times: Math.max(0, fit) }
    if (b.times <= 0) continue
    const e0 = winCount(v, 'emerald'), n0 = winCount(v, b.what)
    const bad = await tradeOnce(v, b.i, b.times, tradeMs)
    await sleep(300)
    const got = Math.max(0, winCount(v, b.what) - n0)
    res.spent += Math.max(0, e0 - winCount(v, 'emerald'))
    if (got) res.bought[b.what] = (res.bought[b.what] ?? 0) + got
    if (bad) { res.halt = true; res.why = `buy:${String(bad?.message ?? bad).slice(0, 40)}`; return res }
  }
  return res
}
export { winCountWhere, storedEnchants, offersDetail }

// ---- walk-in trips (market-02, OWNER 11-07 D1: "bots may enter protected village 23_-20 (and other villages) to trade with
// existing librarian / cleric / shepherd sites: walking, doors and trapdoors only, never digging or placing inside") ---------------
// The far villages hold the job sites bots cannot make (lectern, loom, brewing stand): the owner's list (books, lanterns, glass,
// redstone, lapis, wool, beds). A trip walks there, ENTERS the zone on foot (protectzone still refuses every dig, place and block
// use inside; the pathfinder never digs or scaffolds there), trades with the employed adults, places beds / a composter on open
// ground OUTSIDE the zone + 3, and walks home. INSIDE a zone at most dwellMs per trip and never still for stillMs: the showcase
// tripwire's Z1 needs >= 15 min still inside a box with a refusal, so a trading visit can never look like a trapped bot.
// ONE RUNNER CALL (Claude m2 BLOCKER 1: the runner aborts EVERY skill at SKILL_TIMEOUT_MS -- 180 s on the showcase -- whatever its
// contract says; expedition.mjs sizes its trip the same way): the whole trip, out + inside + beds + home, fits in callMs. So a walk-in
// reaches villages whose box centre is within radius 200 b (showcase: village-taiga-6_1, its edge 45 b from home). A FAR village
// (23_-20, 502 b) needs a trip cut into calls that a caller re-issues while the bot is away -- cognitive.mjs's trip continuation
// (coalsale-01's trade_trip, tier 3): the showcase gets it when that is kept on the fleet (market-03).
export const WALKIN = Object.freeze({
  radius: 200,                 // a village zone whose box centre is at most this far from home
  minDist: 96,                 // nearer villages are market_run's
  callMs: 170_000,             // the whole trip (< the 180 s watchdog)
  outMs: 45_000,               // the way out at most this long
  dwellMs: 60_000,             // inside a zone at most this long per trip (far under the tripwire Z1's 15 min)
  stillMs: 40_000,             // never stand still inside a zone longer than this
  leaveBy: 80_000,             // no visit starts within 20 s of this: a visit is <= 60 s (goto 15 + open 10 + 2 + 2 trades x 8 s + 3)
  homeBy: 168_000,             // home by this (a late visit ends by ~120 s, the exit ~140 s: the walk home keeps >= 28 s)
  // INSIDE a zone at most dwellMs + one visit (goto <= 15 s, a window <= 6 trades x 8 s) + the walk out: ~3.5 min worst case,
  // so the tripwire's Z1 (>= 15 min still inside with a refusal) cannot fire on a trading visit; an abort at 180 s leaves the bot
  // within ~200 b of home, free to walk (never held)
  perBotMs: 60 * 60_000,       // one trip per bot per hour
  perZoneMs: 30 * 60_000,      // one trip per village per 30 min (6 h when nobody there was employed)
  startFrom: 1000, startTo: 9000, // in the villagers' working hours
  leaveAt: 11500,              // never after dusk (villagers go to bed at 12000)
  leg: 32,                     // walk in legs of this length
  bedsPerDay: 2,               // beds placed per town per day (their own cap; a composter counts as a market job block)
})
export function walkinSwitch (env = process.env) {
  const v = String(env.MARKET_WALKIN ?? '').toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false')
}
const boxOf = q => (Array.isArray(q?.box) ? q.box : (q && Number.isFinite(q.x0) ? [q.x0, q.y0, q.z0, q.x1, q.y1, q.z1] : null))
/** A VILLAGE zone (the zone file's kind is not carried by townPlanZones: the id says it). Pure. */
export const isVillageZone = q => /^village-/.test(String(q?.id ?? '')) || q?.kind === 'village'
/** Villages a trip may go to -> [{ id, box, x, z, dist }] nearest first. Pure. rest: { id: until }. */
export function walkinTargets (zones, home, { now = 0, rest = {} } = {}) {
  const out = []
  for (const q of zones ?? []) {
    const b = boxOf(q)
    if (!b || !isVillageZone(q)) continue
    const x = (b[0] + b[3]) / 2, z = (b[2] + b[5]) / 2, dist = Math.hypot(x - home.x, z - home.z)
    if (dist <= WALKIN.minDist || dist > WALKIN.radius || now < (rest[q.id] ?? -Infinity)) continue
    out.push({ id: q.id, box: b, x: Math.round(x), z: Math.round(z), dist: Math.round(dist) })
  }
  return out.sort((a, b) => a.dist - b.dist)
}
/** START A WALK-IN TRIP? -> { ok, why, target }. Pure. */
export function walkinAdmit ({ on = true, atTown = false, now = 0, timeOfDay = 0, health = 20, freeSlots = 36, state = {}, targets = [], leased = false } = {}) {
  if (!on) return { ok: false, why: 'off' }
  if (!atTown) return { ok: false, why: 'away' }
  if (now - (state.lastTripAt ?? -Infinity) < WALKIN.perBotMs) return { ok: false, why: 'cooldown' }
  if (timeOfDay < WALKIN.startFrom || timeOfDay > WALKIN.startTo) return { ok: false, why: 'not_morning' }
  if (health <= 16) return { ok: false, why: 'health' }
  if (freeSlots < MARKET.maxGoods + 6) return { ok: false, why: 'bag' }
  if (!targets.length) return { ok: false, why: 'no_village' }
  if (leased) return { ok: false, why: 'leased' }
  return { ok: true, why: 'go', target: targets[0] }
}
/** The legs from a point to the target, every `leg` blocks (the last one the target). Pure. */
export function legsTo (from, to, leg = WALKIN.leg) {
  const d = Math.hypot(to.x - from.x, to.z - from.z), n = Math.max(1, Math.ceil(d / leg)), out = []
  for (let i = 1; i <= n; i++) out.push({ x: Math.round(from.x + (to.x - from.x) * i / n), z: Math.round(from.z + (to.z - from.z) * i / n) })
  return out
}
/** The nearest point just OUTSIDE a box (pad b out), from a point. Pure. */
export function edgeOf (box, p, pad = MARKET.zonePad + 2) {
  const x = Math.min(Math.max(p.x, box[0] - pad), box[3] + pad), z = Math.min(Math.max(p.z, box[2] - pad), box[5] + pad)
  if (x > box[0] - pad && x < box[3] + pad && z > box[2] - pad && z < box[5] + pad) {
    const opts = [[box[0] - pad, z], [box[3] + pad, z], [x, box[2] - pad], [x, box[5] + pad]]
    const [ex, ez] = opts.sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.z) - Math.hypot(b[0] - p.x, b[1] - p.z))[0]
    return { x: Math.round(ex), z: Math.round(ez) }
  }
  return { x: Math.round(x), z: Math.round(z) }
}
/** STAY INSIDE? -> null | why to leave. Pure. dwell: ms inside so far; still: ms since the last >= 3 b move inside. */
export function walkinLeave ({ dwell = 0, still = 0, timeOfDay = 0, health = 20, tripLeft = Infinity, freeSlots = 36 } = {}) {  // tripLeft: ms to leaveBy
  if (dwell >= WALKIN.dwellMs) return 'dwell'
  if (still >= WALKIN.stillMs) return 'still'
  if (timeOfDay >= WALKIN.leaveAt) return 'dusk'
  if (health <= 12) return 'health'
  if (freeSlots < 3) return 'bag_full'
  if (tripLeft < 20_000) return 'time'
  return null
}
/** Candidates INSIDE one village zone (a walk-in): employed adults, awake, in that box; nearest first. Pure. */
export function walkinCandidates (entities, at, zone, tried = []) {
  const b = boxOf(zone), out = []
  for (const e of Object.values(entities ?? {})) {
    const m = merchantOfAny(e)
    if (!m || m.baby || m.sleeping || tried.includes(m.uuid) || m.profession === 'wandering_trader') continue
    if (['none', 'nitwit', 'unknown'].includes(m.profession)) continue
    if (!(b && m.x >= b[0] && m.x <= b[3] + 1 && m.z >= b[2] && m.z <= b[5] + 1)) continue
    out.push({ ...m, dist: Math.hypot(m.x - at.x, m.z - at.z) })
  }
  return out.sort((a, b2) => a.dist - b2.dist)
}
/** A STEP PRICE for walking inside a village (Claude m2 BLOCKER 2: a drop onto farmland tramples it -- not a dig, so protectzone cannot
 *  refuse it): a destination that IS farmland or a crop, or stands on farmland, costs 101 (mineflayer-pathfinder drops a move over
 *  100). Pure but for blockAt(pos) -> { name } | null. */
export const FARM_BLOCKS = /^(farmland|wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|attached_melon_stem|attached_pumpkin_stem|torchflower_crop|pitcher_crop)$/
export function farmStep (blockAt) {
  const f = b => {
    const p = b?.position
    if (!p) return 0
    if (FARM_BLOCKS.test(bare(b.name))) return 101
    const below = blockAt({ x: p.x, y: p.y - 1, z: p.z })
    return below && FARM_BLOCKS.test(bare(below.name)) ? 101 : 0
  }
  f.marketFarm = true
  return f
}
/** Run fn with an extra step price on `movements`, IN PLACE (Claude m2 r2: index.mjs builds the ascent / descent fallback profiles with
 *  Object.assign, so they share THIS array object -- a new array would leave the fallbacks unpriced): pushed, and spliced out on every
 *  exit by identity. */
export async function withStepPrice (movements, price, fn) {
  const arr = movements?.exclusionAreasStep
  if (!Array.isArray(arr) || !price) return fn()
  arr.push(price)
  try { return await fn() } finally { const k = arr.indexOf(price); if (k >= 0) arr.splice(k, 1) }
}
/** The goods a walk-in carries: what the village's likely professions buy (the catalogue's level-1/2 offers), at most maxGoods. */
export function walkinGoods (spare = {}) {
  const want = {}
  for (const p of ['weaponsmith', 'toolsmith', 'armorer', 'librarian', 'cartographer', 'fletcher', 'farmer']) {
    for (const [item, n] of Object.entries(goodsFor({ profession: p, level: 2 }, { spare }))) if (!(item in want)) want[item] = n
    if (Object.keys(want).length >= MARKET.maxGoods) break
  }
  delete want.water_bucket
  return Object.fromEntries(Object.entries(want).slice(0, MARKET.maxGoods))
}
/** A permanent block's refusal at (x, z) -> truthy (a reason). No refuser: never. A refuser that throws: refused (fail closed). */
const refusedAt = (refuse, x, z) => { if (typeof refuse !== 'function') return false; try { return !!refuse(Math.floor(x), Math.floor(z)) } catch { return true } }
/**
 * A BED's cells -> { foot, head, stand, dir } | { foot: null, why }. Pure. The foot is a marketCell (open ground outside the zone +
 * pad, the 8 neighbours open); the head the open, floored neighbour in `dir` whose own cell is outside the zone + pad + 1; the bot
 * stands two cells BEHIND the foot (a bed's head goes where the placer faces). existing: beds and job blocks there (spacing).
 */
export function bedCells (blockAt, cluster, { zones = [], existing = [], from = null, refuse = null } = {}) {
  const pick = marketCell(blockAt, cluster, { zones, existing, from, refuse })
  if (!pick.cell) return { foot: null, why: pick.why }
  const f = pick.cell
  const isAir = n => /^(air|cave_air|short_grass|grass|tall_grass|fern|snow)$/.test(bare(n))
  const dirs = []
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const h = { x: f.x + dx, y: f.y, z: f.z + dz }, st = { x: f.x - 2 * dx, y: f.y, z: f.z - 2 * dz }
    if (zoneNear(zones, h.x, h.z, MARKET.zonePad + 1) || zoneNear(zones, st.x, st.z, MARKET.zonePad)) continue
    const hb = blockAt(h.x, h.y, h.z), hu = blockAt(h.x, h.y + 1, h.z), hf = blockAt(h.x, h.y - 1, h.z)
    const sb = blockAt(st.x, st.y, st.z), su = blockAt(st.x, st.y + 1, st.z), sf = blockAt(st.x, st.y - 1, st.z)
    if (!hb || !hu || !hf || !sb || !su || !sf) continue
    if (!isAir(hb.name) || !isAir(hu.name) || isAir(hf.name) || /water|lava/.test(bare(hf.name))) continue
    if (!isAir(sb.name) || !isAir(su.name) || isAir(sf.name) || /water|lava/.test(bare(sf.name))) continue
    dirs.push({ head: h, stand: st, dir: [dx, dz] })
  }
  if (!dirs.length) return { foot: null, why: 'no_head_room' }
  return { foot: f, ...dirs[0], dirs, d: pick.d }
}

// ---- the market's job blocks ---------------------------------------------------------------------------------------------------
/** Job blocks a bot can make from town stock, with what each needs (crafted with a table). Unmakeable ones are absent. */
export const JOB_RECIPES = Object.freeze({
  smithing_table: { iron_ingot: 2, planks: 4 },     // toolsmith: buys iron 4 (L2, 16/16), coal 15 (L1, 6/16)
  barrel: { planks: 6, slab: 2 },                   // fisherman: buys coal 10 (L1, 10/16)
  fletching_table: { flint: 2, planks: 4 },         // fletcher: buys sticks 32 (L1, 12/16) -- the forest's logs
  stonecutter: { iron_ingot: 1, stone: 3 },         // mason: clay 10 (L1), stone 20 (L2); sells bricks, terracotta, quartz
  cartography_table: { paper: 2, planks: 4 },       // cartographer: paper 24 (L1), panes 11 (L2); sells banners, frames
  grindstone: { stick: 2, stone_slab: 1, planks: 2 },   // weaponsmith: coal 15 (L1), iron 4 (L2, 16/16), flint 24 (L3)
  composter: { slab: 7 },                           // farmer (market-02, OWNER 11-07 D2): a farmer harvests and SHARES food -- the village breeds
})
/** Which job block the market wants next, given the professions already THERE (seen at the market or in its ledger) and what
 *  the town holds -> { block, profession } | null. Pure. One of each profession first; the town's best surplus decides the order. */
export function nextJobBlock ({ present = [], stock = {}, placed = [] } = {}) {
  const have = n => Number(stock[n]) || 0
  const planks = Object.entries(stock).filter(([k]) => /_planks$/.test(k)).reduce((n, [, v]) => n + (Number(v) || 0), 0) +
    4 * Object.entries(stock).filter(([k]) => /_log$/.test(k)).reduce((n, [, v]) => n + (Number(v) || 0), 0)
  const can = {
    smithing_table: have('iron_ingot') >= GOODS.iron_ingot.keep + 2 && planks >= 4,
    barrel: planks >= 9,
    fletching_table: have('flint') >= 2 && planks >= 4,
    stonecutter: have('iron_ingot') >= GOODS.iron_ingot.keep + 1 && have('stone') >= 3,
    cartography_table: have('paper') >= 2 && planks >= 4,
    grindstone: have('stick') + planks >= 4 && have('stone') >= 3 && planks >= 2,
    composter: planks >= 6,
  }
  // order: what the town can SELL to the profession it makes (iron 225 / coal / sticks from logs / stone / paper)
  // market-02 (OWNER 11-07 D2): the composter second -- a farmer feeds the village, and fed villagers with free beds breed
  const order = ['smithing_table', 'composter', 'barrel', 'fletching_table', 'stonecutter', 'grindstone', 'cartography_table']
  const prof = Object.fromEntries(Object.entries(PROFESSION_BLOCK).map(([p, b]) => [b, p]))
  for (const block of order) {
    if (!can[block]) continue
    if (present.includes(prof[block]) || placed.includes(block)) continue
    return { block, profession: prof[block] }
  }
  return null
}
/**
 * FREE jobless villagers -> the uuids that MOVED (>= freeMoveB between sightings >= freeSeenMs apart). Pure. seen: { uuid:
 * [{x, z, at}] }. A penned villager (6_1's trapdoor rings: <= 3 b) never qualifies, so no job block is placed for it.
 */
export function freeJobless (seen, now = 0) {
  const out = []
  for (const [uuid, pts] of Object.entries(seen ?? {})) {
    const p = (pts ?? []).filter(q => now - q.at <= MARKET.seenKeepMs)
    let moved = false
    for (let i = 0; i < p.length && !moved; i++) for (let j = i + 1; j < p.length && !moved; j++) {
      if (Math.abs(p[j].at - p[i].at) >= MARKET.freeSeenMs && Math.hypot(p[j].x - p[i].x, p[j].z - p[i].z) >= MARKET.freeMoveB) moved = true
    }
    if (moved) out.push(uuid)
  }
  return out
}
/** Record jobless sightings -> the new { uuid: [{x,z,at}] } (newest 12 per uuid, old ones dropped). Pure. */
export function noteJobless (seen, merchants, now) {
  const out = {}
  for (const [u, pts] of Object.entries(seen ?? {})) { const keep = (pts ?? []).filter(q => now - q.at <= MARKET.seenKeepMs); if (keep.length) out[u] = keep }
  for (const m of merchants ?? []) {
    if (!m?.uuid || m.baby || m.profession !== 'none') continue
    const pts = out[m.uuid] ?? []
    const last = pts[pts.length - 1]
    if (!last || now - last.at >= 60_000) pts.push({ x: Math.round(m.x * 10) / 10, z: Math.round(m.z * 10) / 10, at: now })
    out[m.uuid] = pts.slice(-12)
  }
  return out
}
/**
 * THE MARKET CELL for a job block -> { cell, below, anchor, d } | { cell: null, why }. Pure: blockAt(x, y, z) -> { name } | null.
 * The free cluster's nearest point OUTSIDE the zone box (+ zonePad) is the anchor (when the cluster is in no zone, the cluster
 * itself); jobsite.mjs pickJobCell then picks an open-ground cell within 5 b of it (8 neighbours open, natural floor, no door /
 * bed / chest / job block beside it), with every cell in or within 1 of a zone (+ pad) reading as solid so it is never chosen.
 * The cell must be within claimReach of the cluster centre. existing: job blocks already there (slotSpacing apart).
 */
export function marketCell (blockAt, cluster, { zones = [], existing = [], groundY = null, from = null, refuse = null } = {}) {
  if (!cluster?.members?.length) return { cell: null, why: 'no_cluster' }
  const cx = cluster.x, cz = cluster.z
  const zid = zoneNear(zones, Math.floor(cx), Math.floor(cz), 0)
  if (!zid) return marketCellAt(blockAt, cluster, cx, cz, false, { zones, existing, groundY, refuse })
  const q = zones.find(z => (z.id ?? 'unnamed') === zid)
  const b = Array.isArray(q?.box) ? q.box : [q.x0, q.y0, q.z0, q.x1, q.y1, q.z1]
  const pad = MARKET.zonePad + 2
  // each side of the box, the nearest first: a side with no ground (water, a cliff) or no open cell gives way to the next
  const opts = [[b[0] - pad, cz], [b[3] + pad, cz], [cx, b[2] - pad], [cx, b[5] + pad]]
    .map(([x, z]) => ({ x, z, d: Math.hypot(x - cx, z - cz), w: from ? Math.hypot(x - from.x, z - from.z) : 0 }))
    // the side nearest the bot when it says where it stands (a walk-in at the village's edge: no walk round the village), else the cluster's
    .sort((p, q2) => (p.w - q2.w) || (p.d - q2.d))
  let last = { cell: null, why: 'zone_too_deep' }
  for (const o of opts) {
    if (o.d > MARKET.claimReach - 3) continue
    const r = marketCellAt(blockAt, cluster, o.x, o.z, Math.abs(o.z - cz) > Math.abs(o.x - cx), { zones, existing, groundY, refuse })
    if (r.cell) return r
    last = r
  }
  return last
}
function marketCellAt (blockAt, cluster, ax, az, alongX, { zones = [], existing = [], groundY = null, refuse = null } = {}) {
  const cx = cluster.x, cz = cluster.z
  // the market is a ROW of anchors along the edge (every 4 b, +-8 b): one job block near each, slotSpacing apart
  const isAir = n => /^(air|cave_air|short_grass|grass|tall_grass|fern|snow)$/.test(bare(n))
  const groundAt = (x, z) => {
    const y0 = Math.floor(groundY ?? cluster.y)
    for (let y = y0 + 12; y >= y0 - 16; y--) {
      const f = blockAt(x, y - 1, z), a0 = blockAt(x, y, z), a1 = blockAt(x, y + 1, z)
      if (!f || !a0 || !a1) continue
      if (!isAir(f.name) && !/water|lava/.test(bare(f.name)) && isAir(a0.name) && isAir(a1.name)) return y
    }
    return null
  }
  const anchors = []
  for (const off of [0, 4, -4, 8, -8]) {
    const x = Math.floor(alongX ? ax + off : ax), z = Math.floor(alongX ? az : az + off)
    const y = groundAt(x, z)
    if (y != null) anchors.push({ uuid: `anchor${off}`, x: x + 0.5, y, z: z + 0.5, profession: 'none', baby: false })
  }
  if (!anchors.length) return { cell: null, why: 'no_ground' }
  // the town's reservations (`refuse`: skills.mjs cutterRefusal -- a record's zone, a reserved plot, a marker, a way in, the demolition's
  // hold) read as solid too, so neither the cell nor its 8 open neighbours is ever reserved ground (the batch19b fold, Codex BLOCKER 1)
  const fenced = (x, y, z) => (zoneNear(zones, x, z, MARKET.zonePad + 1) || refusedAt(refuse, x, z) ? { name: 'bedrock' } : blockAt(x, y, z))
  const pick = pickJobCell(fenced, { n: anchors.length, uuids: anchors.map(a => a.uuid), members: anchors, x: ax, y: anchors[0].y, z: az }, { existing, spacing: MARKET.slotSpacing })
  if (!pick.cell) return { cell: null, why: pick.why }
  const d = Math.hypot(pick.cell.x + 0.5 - cx, pick.cell.z + 0.5 - cz)
  if (d > MARKET.claimReach) return { cell: null, why: 'too_far' }
  return { ...pick, anchor: { x: Math.floor(ax), y: anchors[0].y, z: Math.floor(az) }, d: Math.round(d * 10) / 10 }
}
/** The bed direction a bot standing at `p` faces when it clicks the foot (its dominant axis toward the foot), among the valid
 *  ones -> that entry | null. Pure. */
export function bedDirFrom (bc, p) {
  if (!bc?.foot || !p) return null
  const dx = bc.foot.x + 0.5 - p.x, dz = bc.foot.z + 0.5 - p.z
  const want = Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1]
  return (bc.dirs ?? []).find(d => d.dir[0] === want[0] && d.dir[1] === want[1]) ?? null
}
export { unemployedClusters, JOB_BLOCKS }

// ---- rows --------------------------------------------------------------------------------------------------------------------
const kv = o => Object.entries(o ?? {}).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(',') || 'none'
export const runDetail = ({ stop, merchant = null, goods = {}, sold = {}, earned = 0, spent = 0, bought = {}, why = null, ms = null }) =>
  `stop=${stop}${merchant ? ` with=${merchant.profession}${merchant.level ? ` L${merchant.level}` : ''} at=${Math.floor(merchant.x)},${Math.floor(merchant.y)},${Math.floor(merchant.z)}` : ''} ` +
  `goods=${kv(goods)} sold=${kv(sold)} earned=${earned} spent=${spent} bought=${kv(bought)}${why ? ` why=${String(why).replace(/\s+/g, '_').slice(0, 60)}` : ''}${ms != null ? ` ms=${ms}` : ''}`
export const jobDetail = ({ op, block = null, cell = null, cluster = null, why = null, claim = null, d = null }) =>
  `op=${op}${block ? ` block=${block}` : ''}${cell ? ` at=${cell.x},${cell.y},${cell.z}` : ''}${cluster ? ` cluster=${cluster.n}@${Math.floor(cluster.x)},${Math.floor(cluster.z)}` : ''}${d != null ? ` d=${d}` : ''}${why ? ` why=${why}` : ''}${claim ? ` ${claim}` : ''}`
