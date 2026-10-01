// GHOST BLOCKS: a dig the server rejected, which the bot believes happened.
//
// mineflayer 4.37.1 `finishDigging` (lib/plugins/digging.js:143-160) sends STOP and then writes AIR into the bot's
// own world model when its local timer fires. It sends every sequenced packet with `sequence: 0` and has no handler
// for `acknowledge_player_digging`. Since 1.19 the protocol puts the rollback on the CLIENT: the server acks the
// sequence and sends nothing when it refused the break, and the vanilla client restores the state it held before
// predicting (BlockStatePredictionHandler). mineflayer never restores, so every refused dig leaves a hole that exists
// only in the bot's head, permanently: the server has stone, the bot sees air. Measured 2026-09-29 on the sandbox
// (Paper 1.21.11), each proven by RCON `execute if block` against the bot's blockAt:
//   - two ore-tunnel stalls were ghosts: one the next step of the staircase, which the bot walked into forever; one
//     the block under its feet, so onGround stayed false and pathfinder never started its next dig. Global dig
//     instrumentation tied the stall cell to the one dig the server never confirmed.
//   - a dig within ~3 s of joining is DROPPED (START not acked, block not broken) unless the client sent
//     `player_loaded`, which mineflayer never does; a full-length dig 7 blocks away is dropped silently; ABORT
//     only acks, it does not resync (so the NoGhostBlock-mod trick does not work here). mineflayer issue #2600.
// Both engines reviewed a timer rollback and rejected it as the primary mechanism (a timeout is not evidence of a
// rejection). This does what the vanilla client does, with the timer only as a backstop for an ack that never comes.
//
// Pure parts first (the ledger), so the decisions are tested as behaviour; the wiring is `attachDigSync`.

import { createRequire } from 'node:module'
const { Vec3 } = createRequire(import.meta.url)('vec3')

/** The packets that carry `sequence` in 1.19+. ONE counter across all of them (both reviews): acks are "up to N". */
export const SEQUENCED = new Set(['block_dig', 'block_place', 'use_item'])
/** Only STOP (finish digging) is followed by mineflayer's local air write, so only STOP makes a prediction. */
export const STOP_DIGGING = 2
/** An ack that never arrives (a disconnect mid-dig, a dropped packet): restore after this. */
export const BACKSTOP_MS = 5000
/** A restore contradicted by the server's AIR this soon after was a delayed destroy the ack outran, not a refusal. */
export const FALSE_RESTORE_MS = 2000

export const posKey = p => `${p.x},${p.y},${p.z}`

export class PredictionLedger {
  constructor () { this.seq = 0; this.pending = new Map() }
  /**
   * Strictly increasing and never 0 (0 is what mineflayer sends; the server's "nothing to ack" is -1). NO WRAP (Codex
   * review: an old high ack would settle a new low sequence). One bot object is one connection, and ~10k sequenced
   * packets a day would take ~500 years to reach 2^31.
   */
  nextSeq () { return ++this.seq }
  /**
   * The bot is about to write air over `prior` at `pos` for the STOP it sent with `seq`. A newer prediction at the
   * same position replaces an older one, and keeps the OLDER prior: the state before the first unconfirmed write is
   * what the server may still hold.
   */
  predict (pos, seq, prior, t) {
    const key = posKey(pos)
    const old = this.pending.get(key)
    // A REAL Vec3: mineflayer's blockAt and _updateBlockState go through prismarine-world, which calls pos.floored().
    // A plain {x,y,z} threw there, the catch skipped the restore, and on the sandbox the ghost stayed (ack seen, 0 restored).
    this.pending.set(key, { pos: new Vec3(pos.x, pos.y, pos.z), seq, prior: old ? old.prior : prior, server: old ? old.server : null, t })
  }
  /** Any server word about a predicted position is the truth to settle on at the ack (block_change or multi_block_change). */
  serverUpdate (pos, stateId) { const p = this.pending.get(posKey(pos)); if (p) p.server = stateId }
  /** The server processed everything up to `seq`: settle those predictions on what it said, or on what was there. */
  ack (seq, t) { return this.#settle(p => p.seq <= seq, 'ack', t) }
  /** Predictions with no ack for `ms`. */
  stale (t, ms = BACKSTOP_MS) { return this.#settle(p => t - p.t >= ms, 'backstop', t) }
  /** A fresh chunk is authoritative for every block in it; a dropped chunk takes its predictions with it. */
  dropColumn (cx, cz) { for (const [k, p] of this.pending) if (Math.floor(p.pos.x / 16) === cx && Math.floor(p.pos.z / 16) === cz) this.pending.delete(k) }
  clear () { this.pending.clear() }
  get size () { return this.pending.size }
  #settle (match, why, t) {
    const out = []
    for (const [k, p] of this.pending) {
      if (!match(p)) continue
      out.push({ pos: p.pos, target: p.server ?? p.prior, confirmed: p.server != null, why, ms: t - p.t })
      this.pending.delete(k)
    }
    return out
  }
}

/** A multi_block_change record -> { pos, stateId } (1.20+: varlong = stateId << 12 | x << 8 | z << 4 | y). */
export function decodeSectionRecord (chunk, record) {
  const v = BigInt(record)
  return {
    pos: { x: chunk.x * 16 + Number((v >> 8n) & 15n), y: chunk.y * 16 + Number(v & 15n), z: chunk.z * 16 + Number((v >> 4n) & 15n) },
    stateId: Number(v >> 12n),
  }
}

/**
 * Wire the ledger into a mineflayer bot. Must run right after createBot, before any plugin writes a sequenced
 * packet. Returns counters for the caller's rows. `onRollback({ pos, from, to, why, ms, sinceSpawnMs })` is called
 * for every restore that changed the bot's world model.
 */
export function attachDigSync (bot, { onRollback = () => {}, now = () => Date.now(), backstopMs = BACKSTOP_MS, tickMs = 500 } = {}) {
  const ledger = new PredictionLedger()
  const client = bot._client
  const counts = { predicted: 0, confirmed: 0, rolledBack: 0, backstop: 0, falseRestore: 0, repeatMax: 0, predictFailed: 0, spawns: 0, loadedSent: 0 }
  // Restores by position, for two measurements both reviews asked for: a restore the server contradicts with AIR within
  // FALSE_RESTORE_MS (a delayed destroy the ack outran), and the most restores at one position (pathfinder re-digging a
  // block the server keeps refusing: bounded by the callers' own deadlines, measured here, not acted on).
  const restored = new Map()
  // Settlement waiters, for collectManually: resolve when a position leaves the ledger, with whether it was restored.
  const waiters = new Map()
  let spawnedAt = now()
  const write = client.write.bind(client)
  client.write = (name, params, ...rest) => {
    if (SEQUENCED.has(name) && params && typeof params === 'object') {
      const seq = ledger.nextSeq()
      params = { ...params, sequence: seq }
      if (name === 'block_dig' && params.status === STOP_DIGGING && params.location) {
        // Read BEFORE the write returns: finishDigging calls write() and only then _updateBlockState(pos, 0).
        // NEVER THROWS (Codex review): this sits in front of every dig the bot makes; a bookkeeping failure must cost
        // the prediction, not the packet. The position is normalised to a real Vec3 (prismarine-world floors it).
        try {
          const loc = new Vec3(params.location.x, params.location.y, params.location.z)
          const prior = bot.blockAt(loc)?.stateId
          if (prior != null && prior !== 0) { ledger.predict(loc, seq, prior, now()); counts.predicted++ }
        } catch { counts.predictFailed++ }
      }
    }
    return write(name, params, ...rest)
  }
  const apply = settled => {
    for (const s of settled) {
      const key = posKey(s.pos)
      if (s.confirmed) counts.confirmed++
      let cur
      try { cur = bot.blockAt(s.pos)?.stateId } catch { cur = undefined }
      if (cur == null || cur === s.target) continue   // unloaded, or already what the server says
      try { bot._updateBlockState(s.pos, s.target) } catch { continue }
      counts.rolledBack++
      const r = restored.get(posKey(s.pos)) ?? { n: 0, t: 0 }
      r.n++; r.t = now(); restored.set(posKey(s.pos), r)
      if (restored.size > 512) restored.delete(restored.keys().next().value)
      counts.repeatMax = Math.max(counts.repeatMax, r.n)
      if (s.why === 'backstop') counts.backstop++
      try { onRollback({ pos: s.pos, from: cur, to: s.target, why: s.why, ms: s.ms, sinceSpawnMs: now() - spawnedAt, repeat: restored.get(key)?.n ?? 1 }) } catch { /* a logger must not break the bot */ }
    }
    for (const s of settled) notify(posKey(s.pos), s)
  }
  const notify = (key, s) => { const w = waiters.get(key); if (w) { waiters.delete(key); for (const f of w) f(s) } }
  const serverWord = (pos, stateId) => {
    ledger.serverUpdate(pos, stateId)
    const r = restored.get(posKey(pos))
    if (r && stateId === 0 && now() - r.t <= FALSE_RESTORE_MS) { counts.falseRestore++; restored.delete(posKey(pos)) }
  }
  client.on('block_change', pk => { if (pk?.location) serverWord(pk.location, pk.type) })
  client.on('multi_block_change', pk => {
    try { for (const r of pk.records ?? []) { const d = decodeSectionRecord(pk.chunkCoordinates, r); serverWord(d.pos, d.stateId) } } catch { /* malformed: nothing to learn */ }
  })
  client.on('acknowledge_player_digging', pk => apply(ledger.ack(pk.sequenceId, now())))
  client.on('map_chunk', pk => ledger.dropColumn(pk.x, pk.z))
  client.on('unload_chunk', pk => ledger.dropColumn(pk.chunkX, pk.chunkZ))
  // THE LOADED HANDSHAKE (1.21.4+): until the client says `player_loaded`, Paper ignores its digs for 60 ticks after
  // every join and respawn -- which is exactly when the entombment reflex digs. Gated on the protocol having it.
  // Evaluated AT SPAWN, not at attach (both reviews): with an auto-detected version the registry does not exist yet.
  const hasLoaded = () => { try { return !!bot.registry?.version?.['>=']?.('1.21.4') } catch { return false } }
  bot.on('spawn', () => {   // mineflayer emits spawn on the first join AND on every respawn (health.js)
    spawnedAt = now()
    counts.spawns++
    ledger.clear()
    for (const k of [...waiters.keys()]) notify(k, null)
    if (hasLoaded()) { try { write('player_loaded', {}); counts.loadedSent++ } catch { /* not in play state */ } }
  })
  bot.on('death', () => { ledger.clear(); for (const k of [...waiters.keys()]) notify(k, null) })
  const timer = setInterval(() => apply(ledger.stale(now(), backstopMs)), tickMs)
  timer.unref?.()
  bot.once('end', () => clearInterval(timer))
  /**
   * Resolves once the server has settled a dig at `pos` (ack or backstop), with { broken: true|false } -- the server's
   * word, or the prior block when it said nothing -- or { broken: null, pending: true } at `timeoutMs`, or
   * { broken: null, pending: false } at once when nothing is pending there. For callers that must know whether a dig happened (collectManually).
   */
  const waitSettled = (pos, timeoutMs = 1500) => new Promise(resolve => {
    let key
    try { key = posKey(new Vec3(pos.x, pos.y, pos.z).floored()) } catch { return resolve({ broken: null, pending: false }) }
    if (!ledger.pending.has(key)) return resolve({ broken: null, pending: false })
    const done = s => { clearTimeout(timer); resolve({ broken: s ? s.target === 0 : null, pending: false }) }
    const timer = setTimeout(() => { const w = waiters.get(key); if (w) { const i = w.indexOf(done); if (i >= 0) w.splice(i, 1) } resolve({ broken: null, pending: true }) }, timeoutMs)
    waiters.set(key, [...(waiters.get(key) ?? []), done])
  })
  return { ledger, counts, waitSettled }
}
