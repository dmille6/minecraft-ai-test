// THE TOWN CHEST IS FULL: WHAT A DEPOSIT DOES NEXT.
//
// Measured over 24 h (1,970 deposits): 90 ended blocked on a full chest, and the bot was CARRYING A CHEST in 75 of
// them. The recovery crafted a chest unconditionally after the alternate-chest loop and placed one only if that craft
// succeeded, so a bot with a chest in hand and no planks reported "could not make another chest" (Claude and Codex,
// independently, 10-03). And the transfer loop swallowed mineflayer's `destination full`, which is thrown AFTER the
// source stack is lifted onto the cursor (mineflayer 4.37.1 lib/plugins/inventory.js:301 then :323): the window then
// closed with the stack on the cursor, and vanilla drops a closed window's cursor into the world.
//
// The decisions are pure and live here; skills.mjs does the walking, opening and placing.
//   fullChestNext     place the carried chest, craft one, or refuse -- a carried chest always goes first
//   chestSiteRefusal  why a cell may not take the new chest (reuses the composter's site checks)
//   chestCap          at most one new chest per town per TOWN_CHEST_INTERVAL_MS, at most MAX_TOWN_CONTAINERS
//   bankClosed        after a refusal the bot is told once, and not sent back for the CLOSE_MS that follows
//   returnCursor      a lifted stack goes back into the bag before the window closes -- never dropped

import fs from 'node:fs'
import path from 'node:path'
import { siteRefusal, standableBeside, narrowTop, bodyInCell, createSiteGen, sameWorld, townDistance,
         CLEARANCE_CONTAINER, MIN_CONTAINER_DISTANCE, STORAGE_NEAR } from './composter.mjs'

/** At most one new container per town per this long, across every bot of the pool (the shared claim record). */
export const TOWN_CHEST_INTERVAL_MS = 10 * 60 * 1000
/** No new container once this many container BLOCKS (a double chest is two) stand within STORAGE_NEAR of home. */
export const MAX_TOWN_CONTAINERS = 12
/** The new chest goes this many rings (Chebyshev) around the full chest at most. */
export const SITE_RINGS = 4
/** The sweep of the town's other containers gives up after this long: what it did not reach is UNKNOWN, not full. */
export const TOWN_SWEEP_MS = 90_000
/** After a placement that did not read back, how long a late server ack may take to show the block. */
export const PLACE_READBACK_MS = 2_000
/** At most this many cells are tried for one new chest (each failure is read back before the next). */
export const MAX_SITE_TRIES = 2

/**
 * WHAT THE RECOVERY DOES NEXT -> 'far' | 'defer' | 'refuse_cap' | 'place_carried' | 'craft'. Pure.
 *   nearHome  the bot is within STORAGE_NEAR of home: a new chest is town storage, never a chest in a mine
 *   unknown   containers near home whose room could not be read (an open or travel failure, or the sweep's time ran
 *             out): unknown capacity is not full, so nothing is built -- the deposit defers
 *   cap       chestCap's answer ({ ok })
 *   carried   the bot holds a chest or trapped_chest: it is PLACED; a chest is crafted only when none is carried
 */
export function fullChestNext ({ nearHome = false, unknown = 0, cap = { ok: false }, carried = false } = {}) {
  if (!nearHome) return 'far'
  if (unknown > 0) return 'defer'
  if (!cap?.ok) return 'refuse_cap'
  return carried ? 'place_carried' : 'craft'
}

/** The chest item a bot would place: a chest first, then a trapped chest. Never a barrel or an ender chest. */
export function carriedChest (items = []) {
  const list = Array.isArray(items) ? items : []
  return list.find(i => i?.name === 'chest' && (i.count ?? 1) > 0)?.name ??
         list.find(i => i?.name === 'trapped_chest' && (i.count ?? 1) > 0)?.name ?? null
}

/**
 * THE TOWN'S CAP -> { ok, why, until }. Pure.
 *   containers  container blocks within STORAGE_NEAR of home (each half of a double chest counts)
 *   last        readChestClaims' record ({ gen, at, world, malformed }) -- the newest claim in this town
 *   world       this bot's world id: a claim from another world (a reseed keeps the pool) does not count
 * A malformed record fails CLOSED (an unreadable claim is treated as one made just now).
 */
export function chestCap ({ containers = 0, last = null, now = Date.now(), world = null } = {}) {
  if (!(containers < MAX_TOWN_CONTAINERS)) {
    return { ok: false, why: `the town is at its chest limit (${containers} containers within ${STORAGE_NEAR} of home, the limit is ${MAX_TOWN_CONTAINERS})`, until: null }
  }
  if (last?.malformed) return { ok: false, why: 'the town chest record cannot be read', until: now + TOWN_CHEST_INTERVAL_MS }
  if (last?.gen > 0 && Number.isFinite(last.at) && sameWorld(last.world, world) && now - last.at < TOWN_CHEST_INTERVAL_MS) {
    const until = last.at + TOWN_CHEST_INTERVAL_MS
    return { ok: false, why: `a new town chest was made ${Math.round((now - last.at) / 1000)}s ago (one per ${TOWN_CHEST_INTERVAL_MS / 60000} min)`, until }
  }
  return { ok: true, why: null, until: null }
}

/** The claim record's key: one per town (pool dir + home). */
export const chestClaimKey = home => `town-chest-${home.x}_${home.y}_${home.z}`
const claimRe = key => new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.g(\\d+)\\.json$`)

/** The newest claim -> { gen, at, world, malformed }. gen 0 = no claim yet (an unreadable directory reads as none;
 *  the claim's own write then fails closed). */
export function readChestClaims (dir, key) {
  let gen = 0
  try {
    const re = claimRe(key)
    for (const f of fs.readdirSync(dir)) { const m = re.exec(f); if (m) gen = Math.max(gen, Number(m[1])) }
  } catch { return { gen: 0, at: null, world: null, malformed: false } }
  if (!gen) return { gen: 0, at: null, world: null, malformed: false }
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, `${key}.g${gen}.json`), 'utf8'))
    const at = Date.parse(r?.at)
    if (!Number.isFinite(at)) return { gen, at: null, world: null, malformed: true }
    return { gen, at, world: r.world ?? null, malformed: false }
  } catch { return { gen, at: null, world: null, malformed: true } }
}

/**
 * TAKE THE TOWN'S NEXT CHEST CLAIM -> { ok, gen, why, until }. Write-once, compare-and-swap without a lock: generation
 * N+1 is created with link(), which fails if it exists, so of every bot that read generation N exactly one wins
 * (composter.mjs createSiteGen, the composter site's record). The cap is judged on the record this call read, so a bot
 * that saw a stale "no claim" still loses to the one that claimed first. FAILS CLOSED: nothing written, no chest.
 */
export function claimTownChest ({ dir, key, site, world = null, containers = 0, now = Date.now() } = {}) {
  const last = readChestClaims(dir, key)
  const cap = chestCap({ containers, last, now, world })
  if (!cap.ok) return { ok: false, gen: last.gen, why: cap.why, until: cap.until }
  if (createSiteGen(dir, key, last.gen + 1, site, world)) return { ok: true, gen: last.gen + 1, why: null, until: null }
  const won = readChestClaims(dir, key)
  if (won.gen > last.gen) return { ok: false, gen: won.gen, why: 'another bot claimed the town\'s next chest first', until: now + TOWN_CHEST_INTERVAL_MS }
  return { ok: false, gen: last.gen, why: 'the town chest record could not be written', until: null }
}

// ---- a double chest is one container ---------------------------------------------------------------------------------

// Clockwise / counter-clockwise of a horizontal facing (vanilla Direction.getClockWise), as bank-fix's ledger has it.
const CW = { north: 'east', east: 'south', south: 'west', west: 'north' }
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' }
const STEP = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } }
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

const CHEST = /^(chest|trapped_chest)$/
const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/
const passable = b => !!b && b.boundingBox === 'empty' && !LIQUID.test(b.name ?? '')
const solidAt = b => !!b && b.boundingBox === 'block'

/** Every cardinal neighbour of `c`, at its level, where a bot can stand to open it (standableBeside's rules, all four
 *  sides rather than the first). */
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
 *                  container within MIN_CONTAINER_DISTANCE, so a chest there would invalidate the composter's site.
 *   bodies         { x, y, z, w, h } of every body nearby, the bot's own included
 * THE COMPOSTER'S CHECKS, REUSED rather than copied -- cell, floor (never a container's lid: its FLOOR_NO lists every
 * container), one-wide tops, liquid beside, corridor, doors, the home point, somewhere to stand -- by calling its
 * siteRefusal with containers read as stone everywhere but the floor cell: its container clearance is the one rule a
 * chest among chests must not obey, and masking the NAME keeps every bounding box (so corridor and standing checks see
 * the containers as the solid blocks they are). Then the chest's own rules: inside STORAGE_NEAR of home (the cap counts
 * what is there), the lid free, NO chest beside it (no double-chest merging in this change), >= MIN_CONTAINER_DISTANCE
 * from any composter, never the last standing cell of another container, and no body in the cell.
 */
export function chestSiteRefusal (read, site, { home = null, composterSites = [], bodies = [] } = {}) {
  if (typeof read !== 'function' || !site) return 'no site'
  const { x, y, z } = site
  if (home && townDistance(home, site) > STORAGE_NEAR) return `more than ${STORAGE_NEAR} from home`
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
    if (c && Math.hypot(x - c.x, y - c.y, z - c.z) < MIN_CONTAINER_DISTANCE) return `the composter site within ${MIN_CONTAINER_DISTANCE}`
  }
  // Every container whose standing cells this chest could take -- within 2 horizontally, one level either way (the new
  // chest can be another container's feet cell or head cell) -- must keep one. A composter in range is refused outright.
  const withChest = (qx, qy, qz) => (qx === x && qy === y && qz === z ? { name: 'chest', boundingBox: 'block' } : read(qx, qy, qz))
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (!dx && !dy && !dz) continue
        const b = read(x + dx, y + dy, z + dz)
        if (!b) return 'unknown'
        if (b.name === 'composter' && Math.hypot(dx, dy, dz) < MIN_CONTAINER_DISTANCE) return `a composter within ${MIN_CONTAINER_DISTANCE}`
        if (Math.abs(dy) > 1 || !CLEARANCE_CONTAINER.test(b.name ?? '')) continue
        const c = { x: x + dx, y: y + dy, z: z + dz }
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
 * column is skipped, not fatal: unlike the composter, a chest needs no town-wide agreement on its cell -- the claim
 * record (claimTownChest) is what keeps it to one. `refused` counts the reasons, for the row.
 * `skip` lists cells already tried this call (a placement that did not land).
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

// ---- the bank closes for a while ------------------------------------------------------------------------------------

/** How long each refusal keeps this bot from being sent back to deposit. A rate refusal lasts only until the town may
 *  build again; an unknown (defer) is short -- the next visit may open the chest this one could not. */
export const CLOSE_MS = Object.freeze({
  refuse_cap: 30 * 60 * 1000, no_site: 30 * 60 * 1000, craft_failed: 30 * 60 * 1000,
  place_failed: 10 * 60 * 1000, retry_failed: 10 * 60 * 1000, defer: 10 * 60 * 1000, far: 10 * 60 * 1000,
})
export function closeMsFor (outcome, { until = null, now = Date.now() } = {}) {
  const base = CLOSE_MS[outcome] ?? 10 * 60 * 1000
  return Number.isFinite(until) && until > now ? Math.min(base, until - now) : base
}
/** Closed -> the reason; open -> ''. Per process: a restart reopens it, which costs one deposit attempt. */
export function bankClosed (bot, now = Date.now()) {
  const c = bot?.bankClosed
  return c && now < c.until ? String(c.why || 'the town chests are full') : ''
}
export function closeBank (bot, why, ms, now = Date.now()) {
  if (bot) bot.bankClosed = { until: now + Math.max(0, Number(ms) || 0), why }
}
/** The admission refusal: the action first (the prompt keeps 220 characters of an outcome), doable from anywhere. */
export const bankClosedDetail = why => `keep working and deposit later -- the town chests take nothing now (${why})`

// ---- conservation ---------------------------------------------------------------------------------------------------

/** Items in the bag, summed: the row compares it before and after (moved + placed must equal the drop). */
export const bagTotal = (items = []) => (Array.isArray(items) ? items : []).reduce((n, it) => n + (Number(it?.count) || 0), 0)

/**
 * RETURN THE STACK THE CURSOR IS HOLDING BEFORE THE WINDOW CLOSES -> { returned, slot?, reason? }.
 * mineflayer's transfer lifts the source stack onto the cursor (inventory.js:301) and throws `destination full`
 * (:323) before putting it back; closing a window with a stack on the cursor drops it into the world. The stack goes to
 * an EMPTY slot of the player range (the one it was lifted from is empty now), chosen with firstEmptySlotRange.
 * mineflayer's own put-back net (inventory.js:665) reads bot.inventory.selectedItem while the cursor lives on the open
 * window, so it is inert here. Ported from bank-fix 4f6ba62.
 */
export async function returnCursor (bot, window) {
  try {
    const held = window?.selectedItem ?? bot?.currentWindow?.selectedItem
    if (!held) return { returned: false, reason: 'cursor empty' }
    const dest = window.firstEmptySlotRange?.(window.inventoryStart, window.inventoryEnd)
    if (dest == null) return { returned: false, reason: 'no empty slot to return it to' }
    await bot.clickWindow(dest, 0, 0)
    return { returned: true, slot: dest }
  } catch (e) {
    return { returned: false, reason: String(e?.message ?? e).slice(0, 60) }
  }
}
