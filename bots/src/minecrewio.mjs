// MINECREW-01SHOW: THE MINE CREW'S FILES (minecrew.mjs decides; this reads and writes). The crew's leases and the pickaxe census live
// in their OWN small directory under the pool's (`<pool>/minecrew/`), never in the town's directory of thousands of lease
// generations (showdrop-01: one listing of that directory was 38-40% of a stalled decision). The leases are buildproj.mjs's: one
// taker per generation, a TTL in the file, a `.released` marker, RECLAIM_MS after a lapse. Nothing here throws.

import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'
import { poolStateDir } from './worldfacts.mjs'
import { projKey, takeSlot, takeLease, holdsLease, releaseLease, leaseState } from './buildproj.mjs'
import { readIndex, indexHomeKey, TOWNINDEX } from './townindex.mjs'
import { MINE_BUILD_PLOT, LEASE_TTL_MS as DEEP_TTL_MS } from './deepmine.mjs'
import { CREW, crewStock } from './minecrew.mjs'

const homeNow = () => ({ x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ })
/** The town's directory (skills.mjs townDir) and the crew's own under it. */
export const crewTownDir = () => poolStateDir(config.memory.pool)
export const crewDir = () => path.join(crewTownDir(), 'minecrew')
export const crewKey = (home = homeNow()) => projKey(home, CREW.plot)
const slotName = k => `slot${k}`

/**
 * THE CREW NOW -> { ok, mining, run, mine, holders }. mining: slots among slot1..slot<max> another taker would find HELD; run:
 * slot3 is; mine: this bot's own live slot { slot, gen, at } | null; holders: { slotN: holder }. ok false: the directory could
 * not be read -- the caller fails CLOSED (no grant).
 * HELD IS WHAT takeLease WOULD REFUSE (review r1 B1): a slot whose holder stopped renewing stays blocked until its `until` +
 * RECLAIM_MS (buildproj.mjs leaseState `blocksUntil`). Counting it free from `until` on offered every bot a turn that every
 * take then lost for a minute. This bot's own slot is its own while it HOLDS (`holdsUntil`).
 */
export function crewLeasesNow ({ dir = crewDir(), key = crewKey(), me = null, max = 2, now = Date.now() } = {}) {
  const closed = { ok: false, mining: max, run: true, mine: null, holders: {} }
  try {
    try { fs.readdirSync(dir) } catch (e) { if (e?.code !== 'ENOENT') return closed }
    let mining = 0, run = false, mine = null
    const holders = {}
    for (let k = 1; k <= CREW.runSlot; k++) {
      const st = leaseState(dir, key, slotName(k), { ttl: CREW.ttlMs })
      if (!st || st.released) continue
      if (st.gen == null) return closed   // leaseState's own "unreadable": blocked for ever
      const own = me != null && st.rec?.holder === me
      if (!(now < (own ? st.holdsUntil : st.blocksUntil))) continue
      holders[slotName(k)] = st.rec?.holder ?? '?'
      if (k <= max) mining++
      if (k === CREW.runSlot) run = true
      if (own) mine = { slot: k, gen: st.gen, at: Number(st.rec?.at) || null }
    }
    return { ok: true, mining, run, mine, holders }
  } catch { return closed }
}
/** The lease's own record (its `meta`: { since, for, deep }) -> meta | null. */
export function crewMeta (slot, { dir = crewDir(), key = crewKey() } = {}) {
  try { return leaseState(dir, key, slotName(slot), { ttl: CREW.ttlMs })?.rec?.meta ?? null } catch { return null }
}
/** Old generations of one slot are removed (the newest three stay: leaseState reads only the newest). Best effort. */
function prune (dir, key, name, gen) {
  try {
    const pre = `${key}.${name}.lease.g`
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(pre)) continue
      const g = Number(/^(\d+)\.json/.exec(f.slice(pre.length))?.[1])
      if (Number.isInteger(g) && g < gen - 3) { try { fs.unlinkSync(path.join(dir, f)) } catch { /* gone */ } }
    }
  } catch { /* the next take prunes */ }
}
/** TAKE A MINING SLOT (slot1..slot<max>; this bot's own is renewed in place) -> { ok, slot, gen } | { ok: false, why }. */
export function crewTakeMining (me, max, meta = null, { dir = crewDir(), key = crewKey(), now = Date.now() } = {}) {
  try {
    const r = takeSlot(dir, key, me, max, { now, ttl: CREW.ttlMs, meta })
    if (r.ok) prune(dir, key, slotName(r.slot), r.gen)
    return r
  } catch (e) { return { ok: false, why: String(e?.message ?? e).slice(0, 60) } }
}
/** TAKE THE MATERIAL-RUN SLOT (slot3) -> { ok, slot, gen } | { ok: false, why }. */
export function crewTakeRun (me, meta = null, { dir = crewDir(), key = crewKey(), now = Date.now() } = {}) {
  try {
    const r = takeLease(dir, key, slotName(CREW.runSlot), me, { now, ttl: CREW.ttlMs, meta })
    if (r.ok) prune(dir, key, slotName(CREW.runSlot), r.gen)
    return r.ok ? { ok: true, slot: CREW.runSlot, gen: r.gen } : r
  } catch (e) { return { ok: false, why: String(e?.message ?? e).slice(0, 60) } }
}
/** RENEW this bot's slot -> the new generation | null (no longer its own). The meta is carried on. */
export function crewRenew (me, hold, { dir = crewDir(), key = crewKey(), now = Date.now() } = {}) {
  try {
    if (!hold || !Number.isInteger(hold.slot)) return null
    const name = slotName(hold.slot)
    // buildproj.mjs renewLease's two steps, with the lease's meta carried on (renewLease itself writes none)
    if (!holdsLease(dir, key, name, me, hold.gen, now)) return null
    const r = takeLease(dir, key, name, me, { now, ttl: CREW.ttlMs, meta: hold.meta ?? null })
    if (r.ok) prune(dir, key, name, r.gen)
    return r.ok ? r.gen : null
  } catch { return null }
}
/** RELEASE this bot's slot (a marker; never throws). */
export function crewRelease (me, hold, { dir = crewDir(), key = crewKey() } = {}) {
  try { if (hold && Number.isInteger(hold.slot)) releaseLease(dir, key, slotName(hold.slot), me, hold.gen) } catch { /* lapses at its TTL */ }
}

/** THE TOWN'S STOCK of the mined materials (minecrew.mjs crewStock over the town index) -> { ok, containers, have, obsidian }. */
export function crewStockNow (bot, { dir = crewTownDir(), home = homeNow(), now = Date.now() } = {}) {
  try {
    if (!TOWNINDEX.on) return crewStock(null)
    const r = readIndex(dir, indexHomeKey(home), bot?.worldId ?? null)
    return r.ok ? crewStock(r.entries, { now }) : crewStock(null)   // review r3: an observation older than CREW.stockFreshMs is no stock
  } catch { return crewStock(null) }
}

// ---- the census: one small file per bot, in the crew's directory ---------------------------------------------------------------
const censusFile = (dir, holder) => path.join(dir, `census.${String(holder).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)
/** Write THIS bot's line (temp + rename) -> bool. `keep`: what a restart of this bot must not forget (review r1) -- its rest
 *  from the crew (`restUntil`) and the need's hysteresis memory (`was`: mineNeed's stockOpen). */
export function censusWrite (holder, ironPick, { dir = crewDir(), now = Date.now(), keep = null } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const f = censusFile(dir, holder), tmp = `${f}.${process.pid}.tmp`
    const k = keep && typeof keep === 'object' ? { restUntil: Number(keep.restUntil) || 0, was: keep.was && typeof keep.was === 'object' ? keep.was : {} } : {}
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, holder, at: now, ironPick: ironPick ? 1 : 0, ...k }))
    fs.renameSync(tmp, f)
    return true
  } catch { return false }
}
/** THIS bot's own kept state from its line -> { restUntil, was } (nothing kept, no file, a torn file: { restUntil: 0, was: {} }). */
export function censusOwn (holder, { dir = crewDir() } = {}) {
  try {
    const j = JSON.parse(fs.readFileSync(censusFile(dir, holder), 'utf8'))
    const was = {}
    for (const [m, v] of Object.entries(j?.was && typeof j.was === 'object' ? j.was : {})) if (v === true) was[m] = true
    return { restUntil: Number.isFinite(j?.restUntil) && j.restUntil > 0 ? j.restUntil : 0, was }
  } catch { return { restUntil: 0, was: {} } }
}
/** Every bot's line -> [{ holder, at, ironPick }] | null (the directory could not be read; none yet: []). */
export function censusRead ({ dir = crewDir() } = {}) {
  let names
  try { names = fs.readdirSync(dir) } catch (e) { return e?.code === 'ENOENT' ? [] : null }
  const out = []
  for (const n of names) {
    if (!/^census\..+\.json$/.test(n)) continue
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); if (j && typeof j.holder === 'string' && Number.isFinite(j.at)) out.push({ holder: j.holder, at: j.at, ironPick: j.ironPick === 1 ? 1 : 0 }) } catch { /* a torn file is skipped */ }
  }
  return out
}

/** Does ANOTHER bot hold the town mine's build lease now (skills.mjs deepMine: a second builder makes an ore trip instead)?
 *  Unreadable reads as held (the order is then judged as an ore trip: the stricter answer). */
export function crewBuildBusy (me, { dir = crewTownDir(), home = homeNow(), now = Date.now() } = {}) {
  try {
    const s = leaseState(dir, projKey(home, MINE_BUILD_PLOT), 'slot1', { ttl: DEEP_TTL_MS })
    if (!s) return false
    if (s.released) return false
    if (s.rec?.holder === me) return false
    return now < (s.blocksUntil ?? 0)
  } catch { return true }
}
