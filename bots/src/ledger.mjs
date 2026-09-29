// THE CHEST LEDGER -- OBSERVE ONLY (owner-approved colony step 1, 2026-09-29; design by Claude and Codex independently).
//
// Every time any bot opens a container, record what is in it and where, per world: one JSON snapshot per container in
// the pool's shared directory. NOTHING READS IT YET (step 2, later: craft/withdraw source from it; step 3: a shadow-mode
// mayor). So this module must never change what a skill does: every ledger operation is wrapped, and a failure costs
// the record, never the transfer.
//
// Decisions both designs agreed on:
//   - WHEN: mineflayer fires windowOpen only after window_items filled the slots (inventory.js:679-693), so the moment an
//     open resolves is a server snapshot (phase 'open'). A second snapshot just before close records our own transfers,
//     which mineflayer applied to the window predictively (inventory.js:581) -- phase 'close', optimistic: true.
//   - WHICH WINDOW: only the window that is bot.currentWindow and whose container size matches the block (27/54 chest,
//     27 barrel, 3 furnace). A late or foreign window is not recorded; an abandoned open is not recorded.
//   - IDENTITY: a double chest is ONE container. Key = the lower (x, then z) half of a validated pair: the partner must be
//     a chest of the same facing and the opposite left/right type. An unvalidated neighbour is never paired.
//   - STORAGE: poolStateDir(pool)/chest-ledger/<host_port>/<key>.json. Each write is a complete snapshot, written to a
//     unique temp file and renamed (atomic); a record older than the one on disk is not written. No lock (Claude's
//     design; Codex proposed a pool lock + queue): two bots writing one key within milliseconds both hold true data,
//     so the worst case is a briefly older snapshot winning -- acceptable for a record nothing acts on yet.
//   - TOMBSTONES only for a LOADED block that is no longer a container (an unloaded chunk is unknown, not gone).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { config } from './config.mjs'
import { log, logEvent } from './logger.mjs'
import { poolStateDir } from './worldfacts.mjs'
const { Vec3 } = createRequire(import.meta.url)('vec3')

export const LEDGER_SCHEMA = 1
export const MAX_RECORDS = 512
export const TOMBSTONE_RADIUS = 16
const CONTAINERS = { chest: 27, trapped_chest: 27, barrel: 27, furnace: 3, blast_furnace: 3, smoker: 3 }
const SESSION = crypto.randomUUID()
let seq = 0

// Clockwise/counter-clockwise of a horizontal facing (vanilla Direction.getClockWise).
const CW = { north: 'east', east: 'south', south: 'west', west: 'north' }
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' }
const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }
/** Where the other half of a double chest should be (vanilla ChestBlock.getConnectedDirection), or null for single. */
export function chestPartnerOffset (facing, type) {
  if (type !== 'left' && type !== 'right') return null
  const dir = type === 'left' ? CW[facing] : CCW[facing]
  return dir ? STEP[dir] : null
}
const propsOf = b => { try { return b?.getProperties?.() ?? {} } catch { return {} } }
const posKey = p => `${p.x},${p.y},${p.z}`

/**
 * The container's ledger identity. Pure over `blockAt`. { key, halves: [pos...], name, unresolved } -- `unresolved` when
 * a chest says it is half of a pair but the partner does not validate (recorded as its own key, flagged, never merged).
 */
export function containerKey (block, blockAt, dim = 'overworld') {
  const name = block?.name
  const p = block.position
  const own = { x: p.x, y: p.y, z: p.z }
  if (name === 'chest' || name === 'trapped_chest') {
    const { facing, type } = propsOf(block)
    const off = chestPartnerOffset(facing, type)
    if (off) {
      const q = { x: p.x + off[0], y: p.y, z: p.z + off[1] }
      let partner = null
      try { partner = blockAt(new Vec3(q.x, q.y, q.z)) } catch { partner = null }
      const pp = propsOf(partner)
      const ok = partner?.name === name && pp.facing === facing && ((type === 'left' && pp.type === 'right') || (type === 'right' && pp.type === 'left'))
      if (ok) {
        const halves = [own, q].sort((a, b) => a.x - b.x || a.z - b.z)
        return { key: `${dim}:${posKey(halves[0])}`, halves, name, double: true, unresolved: false }
      }
      return { key: `${dim}:${posKey(own)}`, halves: [own], name, double: false, unresolved: true }
    }
  }
  return { key: `${dim}:${posKey(own)}`, halves: [own], name, double: false, unresolved: false }
}

/** A window's CONTAINER slots (not the player inventory part) as a record. Pure. */
export function snapshotRecord (window, id, { phase, observer, t = Date.now(), pool = null, server = null, code = null } = {}) {
  const n = window?.inventoryStart ?? 0
  const slots = (window?.slots ?? []).slice(0, n)
  const items = {}, tools = []
  let free = 0
  for (const it of slots) {
    if (!it) { free++; continue }
    items[it.name] = (items[it.name] ?? 0) + (it.count ?? 1)
    if (it.maxDurability) tools.push({ name: it.name, used: it.durabilityUsed ?? 0, max: it.maxDurability })
  }
  return {
    schema: LEDGER_SCHEMA, key: id.key, halves: id.halves, double: id.double, unresolved: id.unresolved || undefined,
    type: id.name, slots: n, free, items, tools: tools.length ? tools : undefined,
    phase, optimistic: phase === 'close', provenance: phase === 'open' ? 'initial-server' : 'close-client',
    t, observer, session: SESSION, seq: ++seq, pool, server, code,
  }
}

const fileOf = (dir, key) => path.join(dir, `${key.replace(/[^A-Za-z0-9_.,-]/g, '_')}.json`)
/** Write a record unless the one on disk is newer. Atomic (unique temp + rename). Returns true when written. */
export function writeRecord (dir, rec) {
  fs.mkdirSync(dir, { recursive: true })
  const f = fileOf(dir, rec.key)
  try {
    const cur = JSON.parse(fs.readFileSync(f, 'utf8'))
    if ((cur?.t ?? 0) > rec.t) return false
  } catch { /* none yet, or unreadable: overwrite */ }
  const tmp = `${f}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(rec))
  fs.renameSync(tmp, f)
  return true
}

/** Records within `radius` of `pos` whose block is LOADED and no longer a container: tombstone them. Returns keys. */
export function tombstoneGone (dir, pos, blockAt, { t = Date.now(), observer = null, radius = TOMBSTONE_RADIUS, dim = 'overworld', skipKey = null } = {}) {
  const gone = []
  let files = []
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return gone }
  for (const f of files) {
    // FILTER BY NAME FIRST (Claude review): the file name carries the coordinates, so a far record is never read.
    const m = /_(-?\d+),(-?\d+),(-?\d+)\.json$/.exec(f)
    if (m && (Math.abs(+m[1] - pos.x) > radius || Math.abs(+m[2] - pos.y) > radius || Math.abs(+m[3] - pos.z) > radius)) continue
    let rec
    try { rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
    if (!rec || rec.gone || !Array.isArray(rec.halves) || rec.key === skipKey) continue   // never judge the container in hand
    const h = rec.halves[0]
    if (Math.abs(h.x - pos.x) > radius || Math.abs(h.z - pos.z) > radius || Math.abs(h.y - pos.y) > radius) continue
    let b
    try { b = blockAt(new Vec3(h.x, h.y, h.z)) } catch { continue }
    if (b == null) continue                               // unloaded: unknown, not gone
    let why = null
    if (CONTAINERS[b.name] == null) why = 'gone'
    // SUPERSEDED (Claude review): a single chest that became one half of a double is keyed at the pair's lower half, and
    // a chest replaced by a barrel is a different container -- the old record would otherwise stand forever.
    else if (b.name !== rec.type) why = 'replaced'
    else { try { if (containerKey(b, blockAt, dim).key !== rec.key) why = 'superseded' } catch { /* keep */ } }
    if (!why) continue
    writeRecord(dir, { schema: LEDGER_SCHEMA, key: rec.key, halves: rec.halves, gone: true, why, was: rec.type, t, observer, session: SESSION, seq: ++seq })
    gone.push(rec.key)
  }
  // BOUNDED: evict the oldest beyond MAX_RECORDS.
  if (files.length > MAX_RECORDS) {
    const ages = files.map(f => { try { return [f, fs.statSync(path.join(dir, f)).mtimeMs] } catch { return [f, 0] } }).sort((a, b) => a[1] - b[1])
    const evict = ages.slice(0, files.length - MAX_RECORDS)
    for (const [f] of evict) { try { fs.unlinkSync(path.join(dir, f)) } catch {} }
    // Eviction is by AGE, not existence (Claude review): counted, so step 2 knows how often a live chest was dropped.
    logEvent({ kind: 'ledger_evicted', status: 'success', detail: `${evict.length} oldest record(s) evicted over the ${MAX_RECORDS} cap` })
  }
  return gone
}

export function ledgerDir () {
  const server = `${config.mc?.host ?? 'host'}_${config.mc?.port ?? 0}`.replace(/[^A-Za-z0-9_.-]/g, '_')
  return path.join(poolStateDir(config.memory?.pool ?? 'none'), 'chest-ledger', server)
}

let warnedAt = 0
function record (bot, window, block, phase, dir = ledgerDir()) {
  try {
    const name = block?.name ?? bot.registry?.blocks?.[block?.type]?.name
    const expected = CONTAINERS[name]
    if (expected == null || !window) return false
    const n = window.inventoryStart ?? 0
    if (n !== expected && !(n === 54 && (name === 'chest' || name === 'trapped_chest'))) return false   // not this block's window
    if (bot.currentWindow && bot.currentWindow !== window) return false
    const dim = String(bot.game?.dimension ?? 'overworld').replace(/^minecraft:/, '')
    const id = containerKey(block.name ? block : Object.assign(block, { name }), p => bot.blockAt(p), dim)
    if ((n === 54) !== id.double) id.unresolved = true   // a 54-slot window we could not pair, or a pair with a 27 window
    const rec = snapshotRecord(window, id, { phase, observer: config.bot?.name ?? null, pool: config.memory?.pool ?? null,
                                            server: `${config.mc?.host}:${config.mc?.port}`, code: config.code?.version ?? null })
    // THE SERVER'S CONTENTS SURVIVE THE CLOSE (Claude review): newer-wins made every chest's last record the close --
    // our PREDICTED state. Each record carries `server`: the last open snapshot (the server's), never a prediction.
    if (phase === 'open') rec.server_snapshot = { items: rec.items, free: rec.free, t: rec.t }
    else { try { rec.server_snapshot = JSON.parse(fs.readFileSync(fileOf(dir, rec.key), 'utf8'))?.server_snapshot ?? null } catch { rec.server_snapshot = null } }
    const wrote = writeRecord(dir, rec)
    if (phase === 'open') tombstoneGone(dir, block.position, p => bot.blockAt(p), { observer: rec.observer, dim, skipKey: rec.key })
    const total = Object.values(rec.items).reduce((a, b) => a + b, 0)
    logEvent({ kind: 'ledger', status: 'success',
               detail: `${phase} ${rec.key} ${rec.type}${rec.double ? ' (double)' : ''}: ${total} items, ${rec.slots - rec.free}/${rec.slots} slots${wrote ? '' : ' (older than the record, not written)'}` })
    return wrote
  } catch (e) {
    if (Date.now() - warnedAt > 60_000) { warnedAt = Date.now(); log('warn', 'ledger: record failed (the transfer is unaffected)', { err: String(e?.message ?? e).slice(0, 120) }) }
    return false
  }
}

/**
 * THE ONLY WAY A CONTAINER IS OPENED (a source test enforces it). `open` is the caller's own open call, unchanged;
 * the returned promise is the same one it returns, so timeouts, abandonment and errors behave exactly as before.
 * `abandoned()` is the caller's own flag: an open it gave up on is not recorded.
 */
export function openObserved (bot, block, open, abandoned = () => false) {
  const p = open()
  try { p?.then?.(w => { if (!abandoned()) record(bot, w, block, 'open') }, () => {}) } catch { /* never the caller's problem */ }
  return p
}
/** Record the window as our own transfers left it, then close it -- the close itself is the caller's, unchanged. */
export function closeObserved (bot, window, block) {
  record(bot, window, block, 'close')
  return window.close()
}
export const __testing = { record }
