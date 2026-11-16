// VILLAGEFEED-01 (villager economy, OWNER 11-09 "i want all of those things done"; design docs/reports/villagecon-2026-11-09/design.md,
// ledger villagecon-1109). PURE decisions: who to feed, how much bread, the town's caps, the births. The run is skills.mjs
// villageFeed; the ask is marketAsk's (idle branch, after the market run and the job block, before the walk-in trip).
//
// WHY. MEASURED 11-09 (showcase world copy 12:40Z): 63 villagers, every one with an EMPTY inventory; village 6_1 (7 adults, 5 beds,
// 3 POI tickets free) has had 0 births in 3 days of mobGriefing. Vanilla breeding needs both adults "willing": food worth >= 12
// points in the villager's OWN inventory (bread 4, carrot / potato / beetroot 1) and an unclaimed bed it can path to. A jobless
// villager never makes food; only a farmer does. So the bots bring the bread: the town holds 195 wheat (65 loaves).
//
// PROVEN (Paper 1.21.8 / mineflayer 4.37.1, sandbox7 11-09, sandbox/econ/feed-proof.cjs): ONE loaf tossed by the bot (bot.toss,
// looking at the villager's feet) from 1.5 / 5 / 7 b is picked up by the villager, and the client sees it: a `playerCollect` whose
// collector is the villager entity -- the server-backed signal this module credits. Over an OPEN-trapdoor ring (the 6_1 pen's
// shape) from 3 b outside: picked up too. A loaf can be taken by the NEIGHBOUR (the breed run: one villager collected 4 of 5), so
// a loaf counts for whoever collected it. The market proof's 11-06 "tossed bread never picked up" was a sandbox artefact: a villager
// SUMMONED with NBT skips finalizeSpawn and has CanPickUpLoot 0b; all 63 real villagers on the showcase carry CanPickUpLoot 1b.
//
// FOOD STAYS. A villager keeps what it picked up until it breeds (each parent eats 12 points) or shares a surplus (> 24 points). So an
// adult is fed ONCE (3 loaves = 12 points) and fed again only after a baby is seen beside it -- never on a timer. That bounds the
// bread: at most 3 loaves per adult plus 6 per birth, under a town cap per day.
export const FEED = Object.freeze({
  loaves: 3,                 // per adult: 12 food points (bread = 4), the breeding threshold
  townPerDay: 24,            // loaves tossed per town per day (24 h window)
  carryMax: 12,              // loaves made / carried for one run
  wheatKeep: 48,             // the town keeps this much wheat after a draw (hay plan above 32 + 16 for animal breeding)
  radius: 160,               // a cluster's centre at most this far from home
  clusterR: 16,              // adults within this of each other are one cluster
  minAdults: 2,              // a lone adult cannot breed: never fed alone
  freshMs: 45 * 60_000,      // a sighting is used for planning this long
  perBotMs: 45 * 60_000,     // one run per bot per 45 min
  startFrom: 1000, startTo: 10500, // daytime: a sleeping villager picks nothing up
  callMs: 165_000,           // the whole run (< the runner's 180 s watchdog)
  reach: 2,                  // toss from within this of the target (proven at 1.5 b; a miss at 3 b in one run)
  collectMs: 5_000,          // wait this long for the pickup packet after a toss
  missMax: 4,                // tosses the TARGET did not take (nobody did, or a neighbour) before it is given up this run
  clearR: 2.5,               // a target this far from every other villager is tossed to at once; closer, the run waits up to clearWaitMs
  clearWaitMs: 6_000,
  birthR: 24,                // a baby first seen within this of a fed adult counts as a birth of the feed
  refeedR: 12,               // ... and the fed adults within this of it may be fed again (they ate 12 points each)
  babyAgeMs: 25 * 60_000,    // a baby uuid is forgotten after this (it grows up in 20 min)
  seenMax: 400,              // sightings kept in the town file
  bedR: 48,                  // vanilla: a breeding villager takes a VACANT bed within 48 b it can path to (VillagerMakeLove)
  roomTtlMs: 6 * 3600_000,   // a cluster counted with no bed room is not fed (nor walked to) for this long
  roomR: 24,                 // a room count stands for a cluster whose centre is within this of it
  bedsPerRun: 2,             // beds a run brings (crafted from the town's wool) for a cluster with no room
})
export function feedSwitch (env = process.env) {
  const v = String(env.VILLAGEFEED ?? '').toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false')
}
export const feedModeDetail = on => `on=${on ? 1 : 0} loaves=${FEED.loaves} town_per_day=${FEED.townPerDay} wheat_keep=${FEED.wheatKeep} radius=${FEED.radius} reach=${FEED.reach}`

/** A villager entity -> { uuid, id, x, y, z, baby, sleeping, profession } | null. Pure (trade.mjs merchantOf's metadata reading:
 *  index 16 the baby flag, 18 villager_data; no index 18 = the default none). Nitwits breed too: every adult counts. */
export function villagerOf (e) {
  if (!e || e.name !== 'villager' || !e.position) return null
  const md = e.metadata ?? []
  return { id: e.id, uuid: e.uuid ?? String(e.id), x: e.position.x, y: e.position.y, z: e.position.z, baby: md[16] === true,
    sleeping: md[6] === 2 || !!md[14], profession: md[18] ? md[18].villagerProfession : 0 }
}

/** THE TOWN FILE, read defensively -> { seen, fed, babies, tosses }. Pure. */
export function feedState (raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  return { seen: obj(o.seen), fed: obj(o.fed), babies: obj(o.babies), tosses: Array.isArray(o.tosses) ? o.tosses.filter(t => Number.isFinite(t?.at)) : [], rooms: obj(o.rooms) }
}

/**
 * NOTE WHAT THE BOT SEES (every ask): villagers into `seen`; a baby uuid seen for the first time is a BIRTH when it stands within
 * birthR of an adult the town fed (and was not yet known), and the fed adults within refeedR of it are cleared to be fed again.
 * -> { state, births: [{ uuid, x, z, fed: bool, near }] }. Pure (returns a new state).
 */
export function noteVillagers (state0, villagers, now, { birthR = FEED.birthR, refeedR = FEED.refeedR, babyAgeMs = FEED.babyAgeMs, seenMax = FEED.seenMax } = {}) {
  const s = feedState(state0)
  const seen = { ...s.seen }, fed = { ...s.fed }, babies = {}
  for (const [u, at] of Object.entries(s.babies)) if (now - at < babyAgeMs) babies[u] = at
  const births = []
  for (const v of villagers ?? []) {
    if (!v?.uuid) continue
    seen[v.uuid] = { x: Math.round(v.x * 10) / 10, y: Math.floor(v.y), z: Math.round(v.z * 10) / 10, at: now, baby: !!v.baby }
    if (!v.baby || babies[v.uuid] != null || s.babies[v.uuid] != null) continue
    babies[v.uuid] = now
    // the fed adults beside it (their LAST sighting)
    const near = Object.entries(fed).filter(([u, f]) => (f?.n ?? 0) > 0 && seen[u] && !seen[u].baby && Math.hypot(seen[u].x - v.x, seen[u].z - v.z) <= birthR)
    births.push({ uuid: v.uuid, x: Math.round(v.x), z: Math.round(v.z), fed: near.length > 0, near: near.length })
    for (const [u] of near) if (Math.hypot(seen[u].x - v.x, seen[u].z - v.z) <= refeedR) fed[u] = { ...fed[u], n: 0, ate: now }
  }
  // keep the newest seenMax sightings
  const keep = Object.entries(seen).sort((a, b) => b[1].at - a[1].at).slice(0, seenMax)
  return { state: { ...s, seen: Object.fromEntries(keep), fed, babies }, births }
}

/** Loaves tossed by the town in the last 24 h. Pure. */
export const tossedToday = (state, now) => feedState(state).tosses.filter(t => now - t.at < 24 * 3600_000).reduce((a, t) => a + (t.n ?? 1), 0)

/**
 * THE CLUSTERS WORTH A RUN -> [{ x, z, y, uuids, hungry, loaves, dist }] best first. Pure. Adults seen within freshMs, awake when
 * seen, within radius of home; single-link clusters of clusterR; a cluster needs >= minAdults adults and at least one HUNGRY one
 * (fed.n < loaves); its loaves = what its hungry adults still need. The cluster with the most loaves owed first, then the nearest.
 */
export function feedClusters (state, home, now, { radius = FEED.radius, clusterR = FEED.clusterR, minAdults = FEED.minAdults, freshMs = FEED.freshMs, loaves = FEED.loaves } = {}) {
  const s = feedState(state)
  const adults = Object.entries(s.seen).filter(([, v]) => v && !v.baby && now - (v.at ?? 0) < freshMs && Math.hypot(v.x - home.x, v.z - home.z) <= radius)
    .map(([uuid, v]) => ({ uuid, ...v }))
  const groups = []
  for (const a of adults) {
    const hits = groups.filter(g => g.some(o => Math.hypot(o.x - a.x, o.z - a.z) <= clusterR))
    const merged = [a, ...hits.flat()]
    for (const h of hits) groups.splice(groups.indexOf(h), 1)
    groups.push(merged)
  }
  const out = []
  for (const g of groups) {
    if (g.length < minAdults) continue
    const owed = g.map(a => Math.max(0, loaves - (s.fed[a.uuid]?.n ?? 0)))
    const need = owed.reduce((x, y) => x + y, 0)
    if (!need) continue
    const x = g.reduce((t, a) => t + a.x, 0) / g.length, z = g.reduce((t, a) => t + a.z, 0) / g.length
    out.push({ x: Math.round(x), z: Math.round(z), y: Math.min(...g.map(a => a.y)), uuids: g.map(a => a.uuid), hungry: owed.filter(Boolean).length, loaves: need, dist: Math.round(Math.hypot(x - home.x, z - home.z)) })
  }
  return out.sort((a, b) => b.loaves - a.loaves || a.dist - b.dist)
}

/**
 * START A FEED RUN? -> { ok, why, cluster, make }. Pure. make = loaves to craft (bag bread first, then the town's wheat above
 * wheatKeep, 3 a loaf), bounded by the cluster's need, carryMax and the town's day cap.
 */
export function feedAdmit ({ on = true, atTown = true, now = 0, timeOfDay = 0, health = 20, freeSlots = 36, lastRunAt = -Infinity, clusters = [], bagBread = 0, bagWheat = 0, townWheat = 0, tossed = 0, leased = false, state = null, wool = null } = {}) {
  if (!on) return { ok: false, why: 'off' }
  if (!atTown) return { ok: false, why: 'away' }
  if (now - lastRunAt < FEED.perBotMs) return { ok: false, why: 'cooldown' }
  if (timeOfDay < FEED.startFrom || timeOfDay > FEED.startTo) return { ok: false, why: 'night' }
  if (health <= 16) return { ok: false, why: 'health' }
  if (freeSlots < 4) return { ok: false, why: 'bag' }
  if (!clusters.length) return { ok: false, why: 'no_hungry' }
  const room = FEED.townPerDay - tossed
  if (room <= 0) return { ok: false, why: 'day_cap' }
  // THE BED ROOM (bedRoom): a cluster counted with no room within roomTtl is skipped -- unless the town has wool for beds (the run then
  // brings FEED.bedsPerRun of them, and feeds once they stand)
  const pick = clusters.map(c => ({ c, r: state ? roomOf(state, c, now) : null })).find(({ r }) => !r || r.room > 0 || wool)
  if (!pick) return { ok: false, why: 'no_bed_room' }
  const cluster = pick.c
  const beds = pick.r && pick.r.room <= 0 ? Math.min(FEED.bedsPerRun, 1 - pick.r.room) : 0
  const want = Math.min(cluster.loaves, FEED.carryMax, room)
  const fromWheat = Math.floor((Math.max(0, townWheat - FEED.wheatKeep) + bagWheat) / 3)
  const make = Math.max(0, Math.min(want - bagBread, fromWheat))
  if (bagBread + make < Math.min(want, FEED.loaves)) return { ok: false, why: 'no_wheat' }
  if (leased) return { ok: false, why: 'leased' }
  return { ok: true, why: 'go', cluster, want, make, beds, wool: beds ? wool : null }
}

/** How far the nearest OTHER villager stands from v (Infinity: none). Pure. */
export const isolation = (v, villagers) => Math.min(Infinity, ...(villagers ?? []).filter(o => o && o.uuid !== v.uuid).map(o => Math.hypot(o.x - v.x, o.z - v.z)))
/** THE NEXT TARGET at the cluster -> villager | null. Pure. An awake adult of the run whose fed.n < loaves and whose misses are below
 *  missMax; the one standing CLEAR of the others first (isolation >= clearR: the nearest villager takes a loaf -- sandbox7 11-09, two
 *  jobless adults 4 b apart: one took 4-5 of 6 in three of five runs, and a jobless villager never shares food on: share-proof.cjs, 8
 *  bread held 160 s beside an empty neighbour), then the nearest to the bot. villagers: villagerOf rows the bot sees now. */
export function nextTarget (villagers, state, from, { uuids = null, misses = {}, loaves = FEED.loaves, missMax = FEED.missMax, clearR = FEED.clearR } = {}) {
  const s = feedState(state)
  const set = uuids ? new Set(uuids) : null
  const d = v => Math.hypot(v.x - from.x, v.z - from.z)
  return (villagers ?? []).filter(v => v && !v.baby && !v.sleeping && (!set || set.has(v.uuid)) && (s.fed[v.uuid]?.n ?? 0) < loaves && (misses[v.uuid] ?? 0) < missMax)
    .map(v => ({ v, clear: isolation(v, villagers) >= clearR }))
    .sort((a, b) => (b.clear - a.clear) || d(a.v) - d(b.v))[0]?.v ?? null
}

/**
 * WHERE TO TOSS FROM -> { x, z } (a point, the bot's goal with range 1). Pure. On the far side of the target from the nearest OTHER
 * villager, `back` blocks out: the loaf lands between the bot and the target, the target nearest it. (sandbox7 11-09, the e2e run 3:
 * tossed from where the walk ended, the neighbour 1.5 b behind the target took 3 of 3 -- a villager walks to a wanted item and the
 * nearest one wins.) No other villager within `near`: straight back along the bot's approach.
 */
export function tossStand (target, others, from, { back = 1.6, near = 8 } = {}) {
  const o = (others ?? []).filter(v => v && v.uuid !== target.uuid && Math.hypot(v.x - target.x, v.z - target.z) <= near)
    .sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z))[0]
  let dx, dz
  if (o) { dx = target.x - o.x; dz = target.z - o.z } else { dx = (from?.x ?? target.x - 1) - target.x; dz = (from?.z ?? target.z) - target.z }
  const d = Math.hypot(dx, dz)
  if (!(d > 1e-6)) { dx = 1; dz = 0 } else { dx /= d; dz /= d }
  return { x: target.x + dx * back, z: target.z + dz * back }
}

/**
 * BED ROOM. MEASURED (sandbox7 11-09, feed-proof B run 2): two adults each fed 3 loaves, with 2 beds for the 2 of them, ate their bread
 * and made NO baby (vanilla VillagerMakeLove digests both parents' food first, then looks for a vacant bed; none -> angry particles);
 * with 3 beds (run 3) a baby in ~100 s. Every adult claims a bed of its own, so a cluster has room for a baby only while its beds
 * outnumber its villagers. -> beds - villagers (adults + babies within bedR). Pure.
 * (Approximate: a bed another village's adult claimed, or one a villager cannot reach, still counts. It never feeds where the count
 * says no room -- 6_1 on 11-09: 5 beds, 7 villagers.)
 */
export const bedRoom = ({ beds = 0, villagers = 0 } = {}) => (Number(beds) || 0) - (Number(villagers) || 0)
/** Record a cluster's bed count. Pure -> new state. */
export function noteRoom (state, at, { beds, villagers }, now) {
  const s = feedState(state)
  const rooms = Object.fromEntries(Object.entries(s.rooms).filter(([, r]) => now - (r?.at ?? 0) < 2 * FEED.roomTtlMs))
  rooms[`${Math.round(at.x)},${Math.round(at.z)}`] = { x: Math.round(at.x), z: Math.round(at.z), beds, villagers, at: now }
  return { ...s, rooms }
}
/** The latest fresh room count for a cluster centre -> { beds, villagers, at, room } | null. Pure. */
export function roomOf (state, at, now, { ttl = FEED.roomTtlMs, r = FEED.roomR } = {}) {
  const hit = Object.values(feedState(state).rooms).filter(q => q && now - (q.at ?? 0) < ttl && Math.hypot(q.x - at.x, q.z - at.z) <= r).sort((a, b) => b.at - a.at)[0]
  return hit ? { ...hit, room: bedRoom(hit) } : null
}
/** A bed's colour the town can make -> the wool name with >= 3, the most plentiful | null. Pure. stock: { name: n }. */
export function bedWool (stock = {}) {
  const w = Object.entries(stock ?? {}).filter(([k, v]) => /_wool$/.test(k) && (Number(v) || 0) >= 3).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]
  return w ? w[0] : null
}

/** CREDIT A PICKUP: the loaf counts for the villager whose `playerCollect` took it (whoever it was). Pure -> new state. */
export function creditLoaf (state, uuid, now) {
  const s = feedState(state)
  if (!uuid) return s
  const f = s.fed[uuid] ?? { n: 0 }
  return { ...s, fed: { ...s.fed, [uuid]: { ...f, n: (f.n ?? 0) + 1, at: now } } }
}
/** Record a run's tosses for the day cap. Pure. */
export function noteTosses (state, n, now) {
  const s = feedState(state)
  if (!(n > 0)) return s
  return { ...s, tosses: [...s.tosses.filter(t => now - t.at < 48 * 3600_000), { at: now, n }] }
}

/** The run's row detail (one format for the read). */
export const feedDetail = o => [`op=${o.op}`, o.why ? `why=${o.why}` : null, o.cluster ? `at=${o.cluster.x},${o.cluster.z} adults=${o.cluster.uuids?.length ?? 0} owed=${o.cluster.loaves}` : null,
  o.made != null ? `made=${o.made}` : null, o.tossed != null ? `tossed=${o.tossed}` : null, o.collected != null ? `collected=${o.collected}` : null,
  o.by ? `by=${o.by}` : null, o.uuid ? `uuid=${o.uuid}` : null, o.fed != null ? `fed=${o.fed ? 1 : 0}` : null, o.near != null ? `near=${o.near}` : null,
  o.room != null ? `room=${o.room}` : null, o.bedsMade ? `beds_made=${o.bedsMade}` : null, o.bedsPlaced ? `beds_placed=${o.bedsPlaced}` : null,
  o.stop ? `stop=${o.stop}` : null].filter(Boolean).join(' ')
