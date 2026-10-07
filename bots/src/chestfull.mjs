// THE TOWN CHEST IS FULL: WHAT A DEPOSIT DOES NEXT.
//
// Measured over 24 h (1,970 deposits): 90 ended blocked on a full chest, and the bot was CARRYING A CHEST in 75 of
// them. The recovery crafted a chest unconditionally after the alternate-chest loop and placed one only if that craft
// succeeded (Claude and Codex, independently, 10-03). The transfer loop also swallowed mineflayer's `destination full`,
// thrown AFTER the source stack is lifted onto the cursor (mineflayer 4.37.1 inventory.js:301, then :323), and closed
// the window with the stack still there. What the SERVER does with it then: vanilla 1.21 (Paper 1.21.8
// AbstractContainerMenu.removed -> dropOrPlaceInInventory) puts a carried stack back into the player's inventory and
// drops it only when there is no room -- so on these servers the usual cost is a client that disagrees with the server
// about where the stack is, and a drop only when the bag is full. Either way the stack is put back before the close.
//
// The decisions are pure and live here; skills.mjs does the walking, opening and placing.
//   fullChestNext      defer, refuse (budget) -- or place the CARRIED chest, crafting one only when none is carried
//   chestBudget        a budget on NEW chests: 10 min apart, 4 per rolling 24 h, 12 standing (pre-existing ones are
//                      not counted); a persisted, reconciled claim ledger (claimNewChest / reconcileClaims)
//   containerStatus    per-town memory of each container's last outcome: full / unavailable / unknown / unusable
//   chestSiteRefusal   why a cell may not take the new chest (reuses the composter's site checks)
//   bankClosed         after a refusal, deposits pause for this bot -- reopened early when the reason goes away
//   returnCursor       a lifted stack goes back into the bag, VERIFIED, before the window closes

import fs from 'node:fs'
import path from 'node:path'
import { siteRefusal, standableBeside, narrowTop, bodyInCell, tableCellFor, sameWorld,
         CLEARANCE_CONTAINER, MIN_CONTAINER_DISTANCE, STORAGE_NEAR } from './composter.mjs'

// ---- the budget on NEW chests ---------------------------------------------------------------------------------------

/** At least this long between two new chests in one town (every bot of the pool). */
export const NEW_CHEST_INTERVAL_MS = 10 * 60 * 1000
/** At most this many new chests in one town in any rolling 24 h. */
export const NEW_CHESTS_PER_DAY = 4
export const DAY_MS = 24 * 60 * 60 * 1000
/** At most this many RECOVERY-MADE chests standing in one town (containers that were already there do not count). */
export const MAX_RECOVERY_CHESTS = 12
/** A claim whose cell still holds no chest this long after it was made is reconciled as not placed. */
export const RECONCILE_AFTER_MS = 2 * 60 * 1000
/** The new chest goes this many rings (Chebyshev) around the full chest at most. */
export const SITE_RINGS = 4
/** ONE placement submission per claim (both reviews): a second cell after a miss could become a second chest. */
export const MAX_SITE_TRIES = 1
/** After a placement that did not read back, how long a late server ack may take to show the block. */
export const PLACE_READBACK_MS = 2_000

/** The town's key (pool dir + home). */
export const townKey = home => `town-chest-${home.x}_${home.y}_${home.z}`

// ---- the town's boundary, and what is never a deposit target (chestfull-02) -----------------------------------------

/** A container more than this far above or below home is DEEP: the chest census's 'deep' band (|dy| > 12), which mixes
 *  natural loot chests in caves and mineshafts with mine stashes. Never a deposit target, never town storage. */
export const TOWN_DY = 12
/** findBlocks around home must reach every cell inTown accepts: the corner of the cylinder is hypot(16, 12) = 20 away. */
export const TOWN_SCAN_RADIUS = Math.ceil(Math.hypot(STORAGE_NEAR, TOWN_DY))
const homeLevel = home => Math.floor(Number(home?.y))
/**
 * THE ONE TOWN BOUNDARY -> true when `q` (a container, a site, or where a walk began) is in town: within STORAGE_NEAR
 * of home HORIZONTALLY and within TOWN_DY of home's level. Pure. chestfull-01 judged "town" two ways -- horizontally for
 * the town's memory read, the walk's start and the recovery's nearHome, in 3-D (townDistance) for the memory write --
 * so a chest far below home was town storage to the recovery and not to its own backoff (Codex, 10-05). Every town
 * decision in the deposit asks this one.
 */
export function inTown (home, q) {
  if (!home || !q || ![q.x, q.y, q.z].every(Number.isFinite)) return false
  return Math.hypot(q.x - home.x, q.z - home.z) <= STORAGE_NEAR && Math.abs(Math.floor(q.y) - homeLevel(home)) <= TOWN_DY
}
/**
 * MAY A DEPOSIT USE THE CONTAINER AT `q`? -> false only for a DEEP one (|dy| > TOWN_DY from home). Pure. A null
 * position is true: mineflayer's findBlock asks matchers about palette blocks with no position first.
 * Measured 10-05: board-a-Comet's deposits targeted a chest at 365,15,184 (58 below home) 18 times in 3.5 h, every one
 * "No path to the goal!" -- on 1918bb5 and 56db2cd as well as on the canary. The same predicate gates the deposit's
 * search, admission's "storage in reach", the prompt's CARRYING line and deposit_surplus.done(), so none of them can
 * send a bot to a chest the deposit will not use.
 */
export function depositTargetOk (home, q) {
  if (!q || !Number.isFinite(Number(q.y)) || !home || !Number.isFinite(homeLevel(home))) return true
  return Math.abs(Math.floor(q.y) - homeLevel(home)) <= TOWN_DY
}

/**
 * WHY A WALK TO A CHEST FAILED -> 'interrupted' | 'no_path' | 'timeout' | 'other'. Pure over the error.
 *   interrupted  someone else took the pathfinder (a reflex's goal, a stop): says nothing about the chest
 *   no_path      the pathfinder found no route (or the route needs a block nothing held can break)
 *   timeout      our own budget ran out, unclamped (the walk had its full time)
 */
export function walkFailure (e) {
  const m = String(e?.message ?? e ?? '')
  if (e?.aborted || /goal was changed|was stopped|interrupted/i.test(m)) return 'interrupted'
  if (e?.failClass === 'no_path' || e?.failClass === 'undiggable_en_route' || /no path/i.test(m)) return 'no_path'
  if (e?.budgetExceeded || /exceeded \d+ms|took to long/i.test(m)) return 'timeout'
  return 'other'
}
/** A failed walk to a chest OUTSIDE town backs that chest off for this bot (deposit's skipContainers) this long. */
export const TARGET_BACKOFF_MS = 10 * 60 * 1000
/** Does a failed walk back its target off? Only a real travel failure, and only for a chest outside town (a town chest
 *  is struck in the town's memory instead -- never hidden from one bot's next walk home). Pure. */
export const backsOffTarget = ({ kind, targetInTown }) => !targetInTown && (kind === 'no_path' || kind === 'timeout')

/**
 * WHEN OUR CLOCK ENDS A WALK TO A CHEST -> 'halt' | 'leave'. Pure. Halt (clear the goal) only while the pathfinder's goal
 * is still the one this walk set; a reflex that has taken the pathfinder since (an escape, a rescue) keeps it. The walk
 * itself never watches digs (chestfull-02): a travel dig wants the HOLE, and watchDigging's stop() + stopDigging() on a
 * block the held tool cannot HARVEST interrupted traversal and any escape dig in flight.
 */
export const travelTimeoutAction = ({ ours, current }) => (ours != null && current === ours ? 'halt' : 'leave')
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * THE CLAIM LEDGER -> [{ n, x, y, z, at, world, state, stateAt }], oldest first. One IMMUTABLE file per claim
 * (`<key>.c<n>.json`, created with link(), so exactly one bot gets each n) plus OBSERVATIONS of it, one file each
 * (`<key>.c<n>.o<ms>-<state>-<rand>`: placed | not_placed | gone). Nothing about a claim is ever overwritten: its state
 * is its NEWEST observation (Codex round 2: a rewritten state file let an older observation replace a newer `placed`,
 * releasing standing capacity), and at equal times `placed` wins, the side that keeps capacity held. Claims are never
 * pruned: unlike the composter's site generations (composter.mjs pruneSiteGens keeps three), the budget needs every
 * claim of the last 24 h and every standing chest. A claim with no observation is UNRESOLVED and counts as standing.
 * An unreadable claim fails closed: it is counted, as made now.
 */
const OBS_RANK = { placed: 3, gone: 2, not_placed: 1 }
/** THE ONE ORDER of a claim's observations, used both to choose its state and to prune (Codex round 3: pruning by time
 *  alone deleted a `placed` that won its tie): newest first, and at equal times placed > gone > not_placed. */
export const obsOrder = (a, b) => (b.at - a.at) || (OBS_RANK[b.state] - OBS_RANK[a.state])
export function readClaims (dir, key, now = Date.now()) {
  const out = []
  let files = []
  try { files = fs.readdirSync(dir) } catch { return out }
  const re = new RegExp(`^${esc(key)}\\.c(\\d+)\\.json$`)
  const obsRe = new RegExp(`^${esc(key)}\\.c(\\d+)\\.o(\\d+)-(placed|not_placed|gone)-`)
  const newest = new Map()   // n -> { at, state }
  for (const f of files) {
    const o = obsRe.exec(f)
    if (!o) continue
    const n = Number(o[1]), at = Number(o[2]), state = o[3]
    const cur = newest.get(n)
    if (!cur || obsOrder({ at, state }, cur) < 0) newest.set(n, { at, state })
  }
  for (const f of files) {
    const m = re.exec(f)
    if (!m) continue
    const n = Number(m[1])
    let rec = null
    try { rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { rec = null }
    const at = Date.parse(rec?.at)
    const c = Number.isFinite(at) && [rec.x, rec.y, rec.z].every(Number.isInteger)
      ? { n, x: rec.x, y: rec.y, z: rec.z, at, world: rec.world ?? null, state: 'unresolved', stateAt: null }
      : { n, x: null, y: null, z: null, at: now, world: null, state: 'unresolved', stateAt: null, malformed: true }
    const ob = newest.get(n)
    if (ob) { c.state = ob.state; c.stateAt = ob.at }
    out.push(c)
  }
  return out.sort((a, b) => a.n - b.n)
}

/** Observations kept per claim; the rest are removed, oldest (in obsOrder) first. */
export const KEEP_OBSERVATIONS = 4
/** Record an OBSERVATION of a claim, stamped with when the cell was read (a new file, never a rewrite; the newest
 *  wins in readClaims). Older observations of the claim beyond the newest few are removed. Best effort -> true if written. */
export function writeClaimState (dir, key, n, state, now = Date.now()) {
  const name = `${key}.c${n}.o${Math.floor(now)}-${state}-${process.pid}${Math.random().toString(36).slice(2, 8)}`
  try { fs.writeFileSync(path.join(dir, name), '', { flag: 'wx' }) } catch { return false }
  try {
    // Pruned in readClaims' own order (obsOrder), so the first entry -- the current winner -- is never deleted.
    const re = new RegExp(`^${esc(key)}\\.c${n}\\.o(\\d+)-(placed|not_placed|gone)-`)
    const mine = fs.readdirSync(dir).map(f => ({ f, m: re.exec(f) })).filter(e => e.m)
      .map(e => ({ f: e.f, at: Number(e.m[1]), state: e.m[2] })).sort(obsOrder)
    for (const { f } of mine.slice(KEEP_OBSERVATIONS)) { try { fs.unlinkSync(path.join(dir, f)) } catch { /* another bot pruned it */ } }
  } catch { /* pruning is housekeeping */ }
  return true
}

/**
 * THE BUDGET -> { ok, why, until, standing, today }. Pure over the ledger. Claims from another world (a reseed keeps
 * the pool) are not counted. Interval and day count EVERY claim (a submission that never landed was still spent --
 * an abort after submission is never refunded); the standing limit counts placed and unresolved claims.
 */
export function chestBudget ({ claims = [], now = Date.now(), world = null } = {}) {
  const mine = claims.filter(c => c.malformed || sameWorld(c.world, world))
  const standing = mine.filter(c => c.state === 'placed' || c.state === 'unresolved').length
  const day = mine.filter(c => now - c.at < DAY_MS)
  const last = mine.reduce((m, c) => Math.max(m, c.at), -Infinity)
  const base = { standing, today: day.length }
  const mins = ms => `${Math.max(1, Math.ceil(ms / 60000))} min`
  if (now - last < NEW_CHEST_INTERVAL_MS) {
    const until = last + NEW_CHEST_INTERVAL_MS
    return { ok: false, ...base, until, why: `the town made a new chest ${mins(now - last)} ago; the next may be made in ${mins(until - now)}` }
  }
  if (day.length >= NEW_CHESTS_PER_DAY) {
    const until = Math.min(...day.map(c => c.at)) + DAY_MS
    return { ok: false, ...base, until, why: `the town has used its new-chest budget (${day.length} in 24 h); the next may be made in ${mins(until - now)}` }
  }
  if (standing >= MAX_RECOVERY_CHESTS) {
    return { ok: false, ...base, until: null, why: `the town has ${standing} chests made for overflow standing, its limit` }
  }
  return { ok: true, ...base, until: null, why: null }
}

/**
 * CLAIM THE TOWN'S NEXT NEW CHEST -> { ok, n, why, until }. The budget is judged on the ledger this call read, then
 * claim n = highest + 1 is created with link(), which fails if another bot created it first (that bot wins; this one
 * refuses). FAILS CLOSED: nothing written, no chest.
 */
export function claimNewChest ({ dir, key, site, world = null, now = Date.now() } = {}) {
  const claims = readClaims(dir, key, now)
  const b = chestBudget({ claims, now, world })
  if (!b.ok) return { ok: false, n: null, why: b.why, until: b.until }
  const n = claims.reduce((m, c) => Math.max(m, c.n), 0) + 1
  const file = path.join(dir, `${key}.c${n}.json`)
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify({ x: site.x, y: site.y, z: site.z, world: world || null, at: new Date(now).toISOString() }))
    fs.linkSync(tmp, file)
    return { ok: true, n, why: null, until: null }
  } catch (e) {
    if (e?.code === 'EEXIST') return { ok: false, n: null, why: 'another bot claimed the town\'s next new chest first', until: now + NEW_CHEST_INTERVAL_MS }
    return { ok: false, n: null, why: 'the town chest ledger could not be written', until: null }
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* never written */ }
  }
}

/**
 * RECONCILE THE LEDGER AGAINST THE WORLD -> the claims whose state changed ([{ n, state }]). Pure but for the writes.
 *   read(x,y,z) -> block name | null (unloaded: left as it is)
 * EVERY claim of this world is read again, dismissed ones too (Codex round 2: a claim dismissed as not_placed or gone
 * was never looked at again, so a chest that was there all along stopped counting). A chest at the claim's cell:
 * placed, whatever it was. No chest: a placed or gone claim is gone (only on this fresh read); an unresolved or
 * not_placed one older than RECONCILE_AFTER_MS is not_placed (it stops counting as standing; it stays in the interval
 * and the day). EVERY CONCLUSIVE READ IS WRITTEN, also when it only confirms the state (Codex round 3: a confirming
 * read wrote nothing, so a delayed older observation could still win) -- the newest real read always decides.
 */
export function reconcileClaims ({ dir, key, claims = [], read, world = null, now = Date.now() } = {}) {
  const changed = []
  for (const c of claims) {
    if (c.malformed || !sameWorld(c.world, world)) continue
    let name = null
    try { name = read(c.x, c.y, c.z) } catch { name = null }
    if (name == null) continue
    const chest = /^(chest|trapped_chest)$/.test(name)
    const next = chest ? 'placed' : (c.state === 'placed' || c.state === 'gone') ? 'gone' : now - c.at > RECONCILE_AFTER_MS ? 'not_placed' : null
    if (!next || !writeClaimState(dir, key, c.n, next, now)) continue
    if (next !== c.state) changed.push({ n: c.n, state: next })
    c.state = next; c.stateAt = now
  }
  return changed
}

// ---- the town's memory of its containers ----------------------------------------------------------------------------

/** A container found full is not visited again for this long (by any bot of the town). */
export const FULL_TTL_MS = 30 * 60 * 1000
/** A verified blocked lid (unsafe to clear, or would not break) makes a container unavailable for this long. */
export const UNAVAILABLE_TTL_MS = 30 * 60 * 1000
/** After an open or travel failure, the container is not visited again for this long -- and it still counts as unknown. */
export const UNKNOWN_BACKOFF_MS = 10 * 60 * 1000
/** Two unknowns at least UNKNOWN_BACKOFF_MS apart make a container unusable for this long: no longer waited for. */
export const UNUSABLE_TTL_MS = 6 * 60 * 60 * 1000

/**
 * WHAT TO DO ABOUT ONE CONTAINER -> 'visit' | 'full' | 'unavailable' | 'unusable' | 'backoff'. Pure.
 *   entry  { o: 'full'|'took'|'unavailable'|'unknown', at, strikes: [ms...] } | undefined
 * full, unavailable and unusable are KNOWN (they do not hold expansion back); backoff is UNKNOWN (not visited, and
 * the deposit defers). Anything stale is visited again.
 */
export function containerStatus (entry, now = Date.now()) {
  if (!entry) return 'visit'
  if (Number.isFinite(entry.unusableUntil) && now < entry.unusableUntil) return 'unusable'
  if (entry.o === 'full' && now - entry.at < FULL_TTL_MS) return 'full'
  if (entry.o === 'unavailable' && now - entry.at < UNAVAILABLE_TTL_MS) return 'unavailable'
  if (entry.o === 'unknown' && now - entry.at < UNKNOWN_BACKOFF_MS) return 'backoff'
  return 'visit'
}
/**
 * The entry after an outcome. Pure. An unknown adds a strike; when any earlier strike is at least UNKNOWN_BACKOFF_MS
 * older, the container is UNUSABLE until an explicit `unusableUntil` -- which later failures never shorten (Codex
 * round 2: keeping only the last two strikes let failures at 0, 600001 and 600002 ms turn unusable back into a
 * backoff). A container that opened (full or took) clears the strikes and the mark; a blocked lid keeps them.
 */
export function recordOutcome (entry, outcome, now = Date.now()) {
  if (outcome === 'unknown') {
    const prior = (entry?.strikes ?? []).filter(t => now - t < UNUSABLE_TTL_MS)
    const qualifies = prior.some(t => now - t >= UNKNOWN_BACKOFF_MS)
    const unusableUntil = Math.max(entry?.unusableUntil ?? -Infinity, qualifies ? now + UNUSABLE_TTL_MS : -Infinity)
    return { o: 'unknown', at: now, strikes: [...prior, now].slice(-8), ...(Number.isFinite(unusableUntil) ? { unusableUntil } : {}) }
  }
  if (outcome === 'unavailable') {
    return { o: outcome, at: now, strikes: entry?.strikes ?? [], ...(Number.isFinite(entry?.unusableUntil) ? { unusableUntil: entry.unusableUntil } : {}) }
  }
  return { o: outcome, at: now, strikes: [] }
}

const memFile = (dir, key) => path.join(dir, `${key}.containers.json`)
/** The town's memory -> { 'x,y,z': entry }. Another world's memory reads as empty. */
export function readTownMemory (dir, key, world = null) {
  try {
    const r = JSON.parse(fs.readFileSync(memFile(dir, key), 'utf8'))
    if (!sameWorld(r?.world, world)) return {}
    return r?.entries && typeof r.entries === 'object' ? r.entries : {}
  } catch { return {} }
}
/** Read-modify-write (tmp + rename). Advisory: two bots racing lose one outcome, which costs one extra visit. */
export function updateTownMemory (dir, key, world, mutate) {
  const entries = readTownMemory(dir, key, world)
  mutate(entries)
  const file = memFile(dir, key)
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify({ world: world || null, entries }))
    fs.renameSync(tmp, file)
    return true
  } catch { try { fs.unlinkSync(tmp) } catch { /* never written */ } return false }
}
/**
 * NO USABLE PICKAXE IN THIS CONTAINER, recently (withdrawpick.mjs; both reviews: per container, not town-wide): a
 * withdraw that looked and found none writes the container's key and time, and no bot looks there again for
 * PICK_MISS_TTL_MS -- unless the container has TAKEN items since (a deposit may have brought a pickaxe). Kept in the
 * town's memory file under a key no container can have: { 'x,y,z': at }.
 */
export const PICK_MISS_KEY = '_pick_miss'
export const PICK_MISS_TTL_MS = 15 * 60 * 1000
export function containerPickMiss (entries = {}, k, now = Date.now()) {
  const at = entries?.[PICK_MISS_KEY]?.[k]
  if (!Number.isFinite(at) || now - at >= PICK_MISS_TTL_MS) return false
  const e = entries?.[k]
  return !(e?.o === 'took' && e.at > at)
}
export function notePickMisses (entries, keys = [], now = Date.now()) {
  const m = { ...(entries[PICK_MISS_KEY] ?? {}) }
  for (const k of keys) m[k] = now
  for (const [k, at] of Object.entries(m)) if (!(now - at < PICK_MISS_TTL_MS)) delete m[k]
  entries[PICK_MISS_KEY] = m
}
/** A town-wide miss only with COMPLETE coverage: every container listed has a valid miss of its own. */
export const townPickMissComplete = (entries = {}, keys = [], now = Date.now()) => keys.length > 0 && keys.every(k => containerPickMiss(entries, k, now))

/** The last time any container of the town TOOK items (or a new chest went down): the "a town chest gained room" signal. */
export function townRoomAt (entries = {}) {
  let t = -Infinity
  for (const e of Object.values(entries)) if (e?.o === 'took' && e.at > t) t = e.at
  return t
}

// ---- what next ------------------------------------------------------------------------------------------------------

/**
 * WHAT THE RECOVERY DOES NEXT -> 'far' | 'defer' | 'refuse_cap' | 'place_carried' | 'craft'. Pure.
 *   nearHome  within STORAGE_NEAR of home: a new chest is town storage, never a chest in a mine
 *   unknown   containers near home whose room is UNKNOWN (an open/travel failure in backoff, or not reached in time).
 *             Full, unavailable (a blocked lid) and unusable containers are known and do not hold expansion back.
 *   budget    chestBudget's answer ({ ok }) -- judged before anything is placed, so even a carried chest waits for it
 *   carried   a chest or trapped_chest is in the bag: it is PLACED; a chest is crafted only when none is carried
 */
export function fullChestNext ({ nearHome = false, unknown = 0, budget = { ok: false }, carried = false } = {}) {
  if (!nearHome) return 'far'
  if (unknown > 0) return 'defer'
  if (!budget?.ok) return 'refuse_cap'
  return carried ? 'place_carried' : 'craft'
}

/** The chest item a bot would place: a chest first, then a trapped chest. Never a barrel or an ender chest. */
export function carriedChest (items = []) {
  const list = Array.isArray(items) ? items : []
  return list.find(i => i?.name === 'chest' && (i.count ?? 1) > 0)?.name ??
         list.find(i => i?.name === 'trapped_chest' && (i.count ?? 1) > 0)?.name ?? null
}

/**
 * THE TIME LEFT FOR THIS SKILL -> ms. The runner's WATCHDOG aborts every skill at config.skills.defaultTimeoutMs
 * (180 s; runner.mjs) -- not at deposit's 240 s contract -- so that is the budget every walk, open and claim is
 * clamped to. Pure.
 */
export function timeLeft ({ startedAt, timeoutMs, now = Date.now() } = {}) {
  return Math.max(0, startedAt + timeoutMs - now)
}
/** The recovery's sweep stops this long before the watchdog: what follows (site, walk, claim, place, retry) needs it. */
export const AFTER_SWEEP_MS = 60_000
/** A claim is taken only with at least this long left: the placement, its read-back and the retry into the new chest. */
export const CLAIM_BUDGET_MS = 25_000
/** The sweep's own cap, whatever the watchdog leaves. */
export const TOWN_SWEEP_MS = 90_000

// ---- a double chest is one container ---------------------------------------------------------------------------------

// Clockwise / counter-clockwise of a horizontal facing (vanilla Direction.getClockWise), as bank-fix's ledger has it.
const CW = { north: 'east', east: 'south', south: 'west', west: 'north' }
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' }
const STEP = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } }
const CHEST = /^(chest|trapped_chest)$/
/** Where the other half of a double chest is (vanilla ChestBlock.getConnectedDirection: a LEFT half connects clockwise
 *  of its facing, a RIGHT half counter-clockwise), or null for a single chest or no state. Pure. */
export function chestPartnerOffset ({ facing, type } = {}) {
  if (type !== 'left' && type !== 'right') return null
  const dir = type === 'left' ? CW[facing] : CCW[facing]
  return dir ? { ...STEP[dir] } : null
}
/** Is `b` (name, props) the validated partner of `a`? Same block, same facing, opposite half. Pure. */
export function isChestPartner (a, b) {
  return !!a && !!b && a.name === b.name && CHEST.test(a.name ?? '') && a.props?.facing === b.props?.facing &&
         ((a.props?.type === 'left' && b.props?.type === 'right') || (a.props?.type === 'right' && b.props?.type === 'left'))
}

// ---- where the new chest goes ----------------------------------------------------------------------------------------

const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/
const passable = b => !!b && b.boundingBox === 'empty' && !LIQUID.test(b.name ?? '')
const solidAt = b => !!b && b.boundingBox === 'block'
/** Blocks a bot must be able to walk up to and use. Containers keep at least one standing cell; a crafting table's
 *  standing cells are never taken (Codex: protect its access). */
const TABLE = /^crafting_table$/

/** Every cardinal neighbour of `c`, at its level, where a bot can stand to use it (standableBeside's rules, all four). */
export function standingCells (read, c) {
  const out = []
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = c.x + dx, z = c.z + dz, y = c.y
    if (!passable(read(x, y, z)) || !passable(read(x, y + 1, z)) || !solidAt(read(x, y - 1, z))) continue
    if (narrowTop(read, x, y - 1, z) !== false) continue
    out.push({ x, y, z })
  }
  return out
}

/**
 * WHY THIS CELL CANNOT TAKE THE NEW CHEST -> a reason, or null. Pure.
 *   read           (x,y,z) -> { name, boundingBox } | null (null = unknown: never placed on a guess)
 *   home           the town's home point
 *   composterSites the recorded composter site and any composter found. The composter's own siteRefusal refuses a
 *                  container within MIN_CONTAINER_DISTANCE, so a chest there would invalidate the composter's site;
 *                  and the cell its builder would put a crafting table in (tableCellFor) is reserved.
 *   bodies         { x, y, z, w, h } of every body nearby, the bot's own included
 * THE COMPOSTER'S CHECKS, REUSED rather than copied -- cell, floor (never a container's lid: its FLOOR_NO lists every
 * container), one-wide tops, liquid beside, corridor, doors, the home point, somewhere to stand -- by calling its
 * siteRefusal with containers read as stone everywhere but the floor cell: its container clearance is the one rule a
 * chest among chests must not obey, and masking the NAME keeps every bounding box. Then the chest's own rules: inside
 * STORAGE_NEAR of home, the lid free, NO chest beside it (no double-chest merging), >= MIN_CONTAINER_DISTANCE from any
 * composter and off its reserved table cell, never the last standing cell of another container, never a standing cell
 * of a crafting table, and no body in the cell.
 */
export function chestSiteRefusal (read, site, { home = null, composterSites = [], bodies = [] } = {}) {
  if (typeof read !== 'function' || !site) return 'no site'
  const { x, y, z } = site
  if (home && !inTown(home, site)) return `outside town (more than ${STORAGE_NEAR} from home, or ${TOWN_DY} above or below it)`
  const masked = (qx, qy, qz) => {
    const b = read(qx, qy, qz)
    if (!b || (qx === x && qy === y - 1 && qz === z)) return b
    return CLEARANCE_CONTAINER.test(b.name ?? '') ? { ...b, name: 'stone' } : b
  }
  const base = siteRefusal(masked, site, home)
  if (base) return base
  const above = read(x, y + 1, z)
  if (!above) return 'unknown'
  if (solidAt(above)) return `lid blocked by ${above.name}`
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const b = read(x + dx, y, z + dz)
    if (!b) return 'unknown'
    if (CHEST.test(b.name ?? '')) return `${b.name} beside it (they would join into a double chest)`
  }
  for (const c of composterSites ?? []) {
    if (!c) continue
    if (Math.hypot(x - c.x, y - c.y, z - c.z) < MIN_CONTAINER_DISTANCE) return `the composter site within ${MIN_CONTAINER_DISTANCE}`
    const stand = standableBeside(read, c)
    const cell = stand ? tableCellFor({ site: c, stand, read }) : null
    if (cell && cell.x === x && cell.y === y && cell.z === z) return 'the composter builder\'s crafting-table cell'
  }
  // Every container or crafting table whose standing cells this chest could take -- within 2 horizontally, one level
  // either way (the chest can be another block's feet cell or head cell).
  const withChest = (qx, qy, qz) => (qx === x && qy === y && qz === z ? { name: 'chest', boundingBox: 'block' } : read(qx, qy, qz))
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (!dx && !dy && !dz) continue
        const b = read(x + dx, y + dy, z + dz)
        if (!b) return 'unknown'
        if (b.name === 'composter' && Math.hypot(dx, dy, dz) < MIN_CONTAINER_DISTANCE) return `a composter within ${MIN_CONTAINER_DISTANCE}`
        if (Math.abs(dy) > 1) continue
        const c = { x: x + dx, y: y + dy, z: z + dz }
        if (TABLE.test(b.name ?? '')) {
          if (standingCells(read, c).length > standingCells(withChest, c).length) return `a standing cell of the ${b.name} at ${c.x},${c.y},${c.z}`
          continue
        }
        if (!CLEARANCE_CONTAINER.test(b.name ?? '')) continue
        if (standingCells(read, c).length > 0 && standingCells(withChest, c).length === 0) {
          return `the only standing cell of the ${b.name} at ${c.x},${c.y},${c.z}`
        }
      }
    }
  }
  if ((bodies ?? []).some(b => bodyInCell(b, site))) return 'someone is standing in it'
  return null
}

/** The rings around the full chest, nearest first, each in angle order from east (deterministic). */
export function chestSiteColumns (anchor, rings = SITE_RINGS) {
  const out = []
  for (let r = 1; r <= rings; r++) {
    const ring = []
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push([dx, dz])
    ring.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]) || a[0] - b[0] || a[1] - b[1])
    for (const [dx, dz] of ring) out.push({ x: anchor.x + dx, z: anchor.z + dz })
  }
  return out
}

/**
 * THE NEW CHEST'S CELL -> { site, stand, why, refused }. Pure. The first column of chestSiteColumns whose surface cell
 * (the highest replaceable cell on a solid floor within 2 of the anchor's level) passes chestSiteRefusal. An unknown
 * column is skipped, not fatal: a chest needs no town-wide agreement on its cell -- the claim ledger keeps the count.
 * `skip` lists cells already refused this call.
 */
export function pickChestSite ({ read, anchor, home = null, composterSites = [], bodies = [], rings = SITE_RINGS, skip = [] } = {}) {
  const refused = {}
  const bump = k => { refused[k] = (refused[k] ?? 0) + 1 }
  if (typeof read !== 'function' || !anchor) return { site: null, stand: null, why: 'no anchor', refused }
  for (const { x, z } of chestSiteColumns(anchor, rings)) {
    let surface = null
    for (let y = anchor.y + 2; y >= anchor.y - 2; y--) {
      const cell = read(x, y, z), floor = read(x, y - 1, z)
      if (!cell || !floor) break
      if (cell.boundingBox === 'empty' && floor.boundingBox === 'block') { surface = { x, y, z }; break }
    }
    if (!surface) { bump('no surface'); continue }
    if ((skip ?? []).some(q => q.x === surface.x && q.y === surface.y && q.z === surface.z)) { bump('tried'); continue }
    const why = chestSiteRefusal(read, surface, { home, composterSites, bodies })
    if (!why) return { site: surface, stand: standableBeside(read, surface), why: null, refused }
    bump(why.replace(/ at -?\d+,-?\d+,-?\d+$/, ''))
  }
  const top = Object.entries(refused).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} x${n}`).join(', ')
  return { site: null, stand: null, why: `no cell within ${rings} of the full chest can take one (${top || 'nothing readable'})`, refused }
}

// ---- the bank pauses for a while ------------------------------------------------------------------------------------

/** How long each refusal pauses this bot's deposits at most. A budget refusal lasts only until the budget allows. */
export const CLOSE_MS = Object.freeze({
  refuse_cap: 30 * 60 * 1000, no_site: 30 * 60 * 1000, craft_failed: 30 * 60 * 1000,
  place_failed: 10 * 60 * 1000, retry_failed: 10 * 60 * 1000,
})
/**
 * DOES THIS REFUSAL CLOSE THE BANK? -> true only when the bank is TRULY closed: every town container it could judge is
 * known full (or unavailable/unusable) AND no new chest can go in now (the budget, no cell, no chest to place, a
 * placement that missed, a new chest that took nothing). Pure. A 'defer' -- some container's room is UNKNOWN: an open
 * or walk failure, a scan that threw, too little of the clock left -- closes nothing (chestfull-02): the failed
 * container is backed off in the town's memory and the bot's banking reminders and next deposit stay as they were.
 */
export const closesBank = outcome => Object.prototype.hasOwnProperty.call(CLOSE_MS, outcome)
/** An early reopen waits at least this long after the closure: the cooldown stays a retry throttle. */
export const REOPEN_THROTTLE_MS = 2 * 60 * 1000
export function closeMsFor (outcome, { until = null, now = Date.now() } = {}) {
  const base = CLOSE_MS[outcome] ?? 10 * 60 * 1000
  return Number.isFinite(until) && until > now ? Math.min(base, until - now) : base
}
/** Records the closure: the reason, the kind (what reopens it early), and when. Per process: a restart reopens it. */
export function closeBank (bot, why, ms, now = Date.now(), kind = 'other') {
  if (bot) bot.bankClosed = { until: now + Math.max(0, Number(ms) || 0), why, kind, at: now }
}
// The town's "gained room" signal, read through a reader skills.mjs registers (it knows the pool dir and home).
let roomReader = () => -Infinity
export function setTownRoomReader (fn) { roomReader = typeof fn === 'function' ? fn : () => -Infinity }
/**
 * Closed -> the reason; open -> ''. REOPENED EARLY (Codex) once REOPEN_THROTTLE_MS has passed, when what closed it has
 * changed: a closure for want of a chest ends when the bot carries one; any closure ends when a town container has
 * taken items since (another bot found room, or a new chest went down).
 */
export function bankClosed (bot, now = Date.now()) {
  const c = bot?.bankClosed
  if (!c || now >= c.until) return ''
  if (now - (c.at ?? now) >= REOPEN_THROTTLE_MS) {
    let items = []
    try { items = bot.inventory?.items?.() ?? [] } catch { items = [] }
    if (c.kind === 'craft_failed' && carriedChest(items)) { bot.bankClosed = null; return '' }
    let room = -Infinity
    try { room = roomReader() } catch { room = -Infinity }
    if (room > c.at) { bot.bankClosed = null; return '' }
  }
  return String(c.why || 'the town chests are full')
}
/** The admission refusal: the action first (the prompt keeps 220 characters of an outcome), doable from anywhere. */
export const bankClosedDetail = why => `keep working and deposit later -- the town chests take nothing now (${String(why).slice(0, 100)})`
/** Craft's room refusal while the bank is closed (Claude): no deposit is named, because none can be made. */
export const closedRoomText = why => `keep working and craft later -- the town chests take nothing now (${String(why).slice(0, 60)}); nothing in the bag can be freed from where you stand`

// ---- conservation ---------------------------------------------------------------------------------------------------

/** Items in the bag, summed: the row compares it before and after (moved + placed must equal the drop). */
export const bagTotal = (items = []) => (Array.isArray(items) ? items : []).reduce((n, it) => n + (Number(it?.count) || 0), 0)

/**
 * RETURN THE STACK THE CURSOR IS HOLDING BEFORE THE WINDOW CLOSES -> { returned, slot?, reason? }, VERIFIED.
 * The stack goes where mineflayer's own putSelectedItemRange would put it: onto a compatible stack in the player range
 * that is not full, else into an empty slot (the one it was lifted from is empty now); a merge that leaves a remainder
 * goes round again. `returned` is true only when the window's cursor READS EMPTY afterwards (Codex: a click that
 * resolves but changes nothing returned true before). Ported from bank-fix 4f6ba62.
 */
export const RETURN_CLICKS = 4
export async function returnCursor (bot, window) {
  try {
    const w = window ?? bot?.currentWindow
    if (!w?.selectedItem) return { returned: false, reason: 'cursor empty' }
    let slot = null
    for (let i = 0; i < RETURN_CLICKS && w.selectedItem; i++) {
      const held = w.selectedItem
      const partial = w.findItemRange?.(w.inventoryStart, w.inventoryEnd, held.type, held.metadata ?? null, true, held.nbt ?? null)
      const dest = partial && partial.count < (partial.stackSize ?? 64) ? partial.slot : w.firstEmptySlotRange?.(w.inventoryStart, w.inventoryEnd)
      if (dest == null) return { returned: false, reason: 'no slot in the bag to return it to' }
      await bot.clickWindow(dest, 0, 0)
      slot = dest
    }
    if (w.selectedItem) return { returned: false, reason: `the cursor still holds ${w.selectedItem.count ?? '?'}x ${w.selectedItem.name ?? '?'}` }
    return { returned: true, slot }
  } catch (e) {
    return { returned: false, reason: String(e?.message ?? e).slice(0, 60) }
  }
}
