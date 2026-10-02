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
// v2 (digsync2, docs/reports/digsync2-design.md): on this server the ack often OUTRUNS the block update, so an ack with
// no server word opens a GRACE_MS grace instead of restoring at once; the server's word during the grace settles it,
// silence restores the prior at expiry. 67% of v1's restores were contradicted by the server's AIR within 2 s.
//
// Pure parts first (the ledger), so the decisions are tested as behaviour; the wiring is `attachDigSync`.

import { createRequire } from 'node:module'
const { Vec3 } = createRequire(import.meta.url)('vec3')

/** The packets that carry `sequence` in 1.19+. ONE counter across all of them (both reviews): acks are "up to N". */
export const SEQUENCED = new Set(['block_dig', 'block_place', 'use_item'])
/** Only STOP (finish digging) is followed by mineflayer's local air write, so only STOP makes a prediction. */
export const STOP_DIGGING = 2
/** An ack that never arrives (a disconnect mid-dig, a dropped packet): restore after this. Governs only predictions
 * still AWAITING their ack; an acked prediction is governed by the grace below and the backstop never pre-empts it. */
export const BACKSTOP_MS = 5000
/**
 * THE ACK OUTRUNS THE DESTROY (digsync-v2). Measured on the fixes-02 canary (10 bots, 3 h, Paper 1.21.x): 138
 * restores, 92 of them (67%) contradicted by the server's AIR within 2 s -- the server acked the STOP before it sent
 * the block update (a delayed destroy: STOP arrives with progress < 1 and the block breaks a few ticks later). So an
 * ack with NO server word does not restore at once: the prediction stays pending for GRACE_MS after the ack. Any
 * server word for the position during the grace settles it on that word; silence until expiry restores the prior.
 */
export const GRACE_MS = 3000
/** What waitSettled allows for the ack itself on top of the grace and one tick (the ack normally takes a tick or two). */
export const ACK_WAIT_MS = 1000
/** A restore contradicted by the server's AIR this soon after is counted as false. 10 s so the tail beyond the grace
 * is visible (v1 used 2 s, which was the whole question). */
export const FALSE_RESTORE_MS = 10_000
/** Delay from the ack to the server's word during the grace, fixed buckets (upper edges, ms). */
export const GRACE_EDGES = [250, 500, 1000, 2000, 3000]
/** Delay from a restore to a contradicting AIR, fixed buckets (upper edges, ms). */
export const LATE_AIR_EDGES = [2000, 5000, 10_000]
const graceKey = ms => { for (const e of GRACE_EDGES) if (ms < e) return `graceLt${e}`; return `graceGe${GRACE_EDGES.at(-1)}` }
const lateAirKey = ms => { for (const e of LATE_AIR_EDGES) if (ms < e) return `lateAirLt${e / 1000}s`; return null }

export const posKey = p => `${p.x},${p.y},${p.z}`

export class PredictionLedger {
  /** graceMs <= 0 is v1: an ack with no server word restores at once. */
  constructor ({ graceMs = GRACE_MS } = {}) { this.seq = 0; this.pending = new Map(); this.graceMs = graceMs }
  /**
   * Strictly increasing and never 0 (0 is what mineflayer sends; the server's "nothing to ack" is -1). NO WRAP (Codex
   * review: an old high ack would settle a new low sequence). One bot object is one connection, and ~10k sequenced
   * packets a day would take ~500 years to reach 2^31.
   */
  nextSeq () { return ++this.seq }
  /**
   * The bot is about to write air over `prior` at `pos` for the STOP it sent with `seq`. A newer prediction at the
   * same position replaces an older one, and keeps the OLDER prior: the state before the first unconfirmed write is
   * what the server may still hold. Replacing one that was in its grace cancels that grace: returns { superseded }.
   */
  predict (pos, seq, prior, t) {
    const key = posKey(pos)
    const old = this.pending.get(key)
    // A REAL Vec3: mineflayer's blockAt and _updateBlockState go through prismarine-world, which calls pos.floored().
    // A plain {x,y,z} threw there, the catch skipped the restore, and on the sandbox the ghost stayed (ack seen, 0 restored).
    this.pending.set(key, { pos: new Vec3(pos.x, pos.y, pos.z), seq, prior: old ? old.prior : prior, server: old ? old.server : null, t, phase: 'awaiting-ack', ackT: null })
    return { superseded: old?.phase === 'grace' }
  }
  /**
   * Any server word about a predicted position (block_change or multi_block_change). Before the ack it is held, to
   * settle on at the ack. DURING THE GRACE it is the answer the grace was waiting for: settled at once, returned.
   */
  serverUpdate (pos, stateId, t) {
    const key = posKey(pos)
    const p = this.pending.get(key)
    if (!p) return null
    if (p.phase !== 'grace') { p.server = stateId; return null }
    this.pending.delete(key)
    return { pos: p.pos, target: stateId, confirmed: true, why: 'grace', ms: t - p.t, afterAckMs: t - p.ackT }
  }
  /**
   * The server processed everything up to `seq`. A prediction it already spoke about settles on that word now; one
   * it has said nothing about enters its grace (or, with graceMs <= 0, restores now). -> { settled, graced }
   */
  ack (seq, t) {
    const settled = []
    let graced = 0
    for (const [k, p] of this.pending) {
      if (p.phase !== 'awaiting-ack' || p.seq > seq) continue
      if (p.server != null || !(this.graceMs > 0)) { settled.push(this.#out(p, 'ack', t)); this.pending.delete(k) }
      else { p.phase = 'grace'; p.ackT = t; graced++ }
    }
    return { settled, graced }
  }
  /** Awaiting an ack for `ms` (the backstop); or in a grace that expired with no word (restore the prior). */
  stale (t, ms = BACKSTOP_MS) {
    const out = []
    for (const [k, p] of this.pending) {
      if (p.phase === 'awaiting-ack' && t - p.t >= ms) out.push(this.#out(p, 'backstop', t))
      else if (p.phase === 'grace' && t - p.ackT >= this.graceMs) out.push(this.#out(p, 'grace-expired', t))
      else continue
      this.pending.delete(k)
    }
    return out
  }
  /** A fresh chunk is authoritative for every block in it; a dropped chunk takes its predictions with it. -> graces dropped */
  dropColumn (cx, cz) {
    let graces = 0
    for (const [k, p] of this.pending) {
      if (Math.floor(p.pos.x / 16) === cx && Math.floor(p.pos.z / 16) === cz) { if (p.phase === 'grace') graces++; this.pending.delete(k) }
    }
    return graces
  }
  /** -> graces dropped */
  clear () { let graces = 0; for (const p of this.pending.values()) if (p.phase === 'grace') graces++; this.pending.clear(); return graces }
  get size () { return this.pending.size }
  #out (p, why, t) { return { pos: p.pos, target: p.server ?? p.prior, confirmed: p.server != null, why, ms: t - p.t } }
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
 * for every restore digsync made on its OWN authority (no server word: a grace that expired, or the backstop).
 * A settlement on the server's word is not a rollback: mineflayer applies that word to the world itself.
 */
export function attachDigSync (bot, { onRollback = () => {}, now = () => Date.now(), backstopMs = BACKSTOP_MS, graceMs = GRACE_MS, tickMs = 500 } = {}) {
  const ledger = new PredictionLedger({ graceMs })
  const client = bot._client
  const counts = {
    predicted: 0, confirmed: 0, rolledBack: 0, backstop: 0, falseRestore: 0, repeatMax: 0, predictFailed: 0, spawns: 0, loadedSent: 0,
    // The grace's books balance: graceStarted = graceAir + graceOther + graceExpired + graceDropped (+ still pending).
    graceStarted: 0, graceAir: 0, graceOther: 0, graceExpired: 0, graceDropped: 0,
    ...Object.fromEntries([...GRACE_EDGES.map(e => `graceLt${e}`), `graceGe${GRACE_EDGES.at(-1)}`].map(k => [k, 0])),
    ...Object.fromEntries(LATE_AIR_EDGES.map(e => [`lateAirLt${e / 1000}s`, 0])),
  }
  // Restores by position, for two measurements both reviews asked for: a restore the server contradicts with AIR within
  // FALSE_RESTORE_MS (a delayed destroy that outran even the grace), and the most restores at one position (pathfinder
  // re-digging a block the server keeps refusing: bounded by the callers' own deadlines, measured here, not acted on).
  // `redug`: the bot dug the position again after the restore, so a later AIR is its own new dig, not a contradiction.
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
          if (prior != null && prior !== 0) {
            if (ledger.predict(loc, seq, prior, now()).superseded) counts.graceDropped++
            counts.predicted++
            const r = restored.get(posKey(loc)); if (r) r.redug = true
          }
        } catch { counts.predictFailed++ }
      }
    }
    return write(name, params, ...rest)
  }
  const apply = settled => {
    for (const s of settled) {
      const key = posKey(s.pos)
      if (s.confirmed) counts.confirmed++
      if (s.why === 'grace') { counts[s.target === 0 ? 'graceAir' : 'graceOther']++; counts[graceKey(s.afterAckMs)]++ }
      if (s.why === 'grace-expired') counts.graceExpired++
      let cur
      try { cur = bot.blockAt(s.pos)?.stateId } catch { cur = undefined }
      if (cur == null || cur === s.target) continue   // unloaded, or already what the server says
      if (s.confirmed) { try { bot._updateBlockState(s.pos, s.target) } catch { /* mineflayer applies the word anyway */ } continue }
      try { bot._updateBlockState(s.pos, s.target) } catch { continue }
      counts.rolledBack++
      const r = restored.get(key) ?? { n: 0, t: 0 }
      r.n++; r.t = now(); r.redug = false; restored.set(key, r)
      if (restored.size > 512) restored.delete(restored.keys().next().value)
      counts.repeatMax = Math.max(counts.repeatMax, r.n)
      if (s.why === 'backstop') counts.backstop++
      try { onRollback({ pos: s.pos, from: cur, to: s.target, why: s.why, ms: s.ms, sinceSpawnMs: now() - spawnedAt, repeat: r.n }) } catch { /* a logger must not break the bot */ }
    }
    for (const s of settled) notify(posKey(s.pos), s)
  }
  const notify = (key, s) => { const w = waiters.get(key); if (w) { waiters.delete(key); for (const f of w) f(s) } }
  const notifyAll = () => { for (const k of [...waiters.keys()]) notify(k, null) }
  // NEVER THROWS: this runs inside the client's packet handlers.
  const serverWord = (pos, stateId) => {
    try {
      const t = now()
      const key = posKey(pos)
      const r = restored.get(key)
      if (r && !r.redug && stateId === 0 && t - r.t <= FALSE_RESTORE_MS) {
        counts.falseRestore++
        const b = lateAirKey(t - r.t); if (b) counts[b]++
        restored.delete(key)
      }
      const s = ledger.serverUpdate(pos, stateId, t)
      if (s) apply([s])
    } catch { /* a bookkeeping failure must not break the packet path */ }
  }
  client.on('block_change', pk => { if (pk?.location) serverWord(pk.location, pk.type) })
  client.on('multi_block_change', pk => {
    try { for (const r of pk.records ?? []) { const d = decodeSectionRecord(pk.chunkCoordinates, r); serverWord(d.pos, d.stateId) } } catch { /* malformed: nothing to learn */ }
  })
  client.on('acknowledge_player_digging', pk => {
    try { const { settled, graced } = ledger.ack(pk.sequenceId, now()); counts.graceStarted += graced; apply(settled) } catch { /* never the packet path's problem */ }
  })
  // A dropped prediction's waiter is told nothing is known (null), not left to time out.
  const dropColumn = (cx, cz) => {
    try {
      const before = new Set(ledger.pending.keys())
      counts.graceDropped += ledger.dropColumn(cx, cz)
      for (const k of before) if (!ledger.pending.has(k)) notify(k, null)
    } catch { /* never the packet path's problem */ }
  }
  client.on('map_chunk', pk => dropColumn(pk.x, pk.z))
  client.on('unload_chunk', pk => dropColumn(pk.chunkX, pk.chunkZ))
  // THE LOADED HANDSHAKE (1.21.4+): until the client says `player_loaded`, Paper ignores its digs for 60 ticks after
  // every join and respawn -- which is exactly when the entombment reflex digs. Gated on the protocol having it.
  // Evaluated AT SPAWN, not at attach (both reviews): with an auto-detected version the registry does not exist yet.
  const hasLoaded = () => { try { return !!bot.registry?.version?.['>=']?.('1.21.4') } catch { return false } }
  const reset = () => { counts.graceDropped += ledger.clear(); notifyAll() }
  bot.on('spawn', () => {   // mineflayer emits spawn on the first join AND on every respawn (health.js)
    spawnedAt = now()
    counts.spawns++
    reset()
    if (hasLoaded()) { try { write('player_loaded', {}); counts.loadedSent++ } catch { /* not in play state */ } }
  })
  bot.on('death', reset)
  const timer = setInterval(() => { try { apply(ledger.stale(now(), backstopMs)) } catch { /* next tick */ } }, tickMs)
  timer.unref?.()
  bot.once('end', () => { clearInterval(timer); reset() })
  /**
   * THE CONTRACT (v2): resolves as soon as the dig's outcome is KNOWN, with { broken: true|false, pending: false }:
   *   - at the ack, when the server already spoke about the position (the common, confirmed case: no extra wait);
   *   - during the grace, the moment the server speaks (AIR -> broken, any other state -> not broken);
   *   - at grace expiry with no word (restored -> not broken), or at the backstop when no ack ever came.
   * { broken: null, pending: false } at once when nothing is pending there, or when the prediction was dropped
   * (respawn, death, disconnect, a fresh or unloaded chunk). { broken: null, pending: true } at `timeoutMs` or on
   * `signal` abort. The default timeout covers the ack + the grace + one tick, so a refused dig gets its truthful
   * `broken: false` rather than `pending` -- callers should not pass a shorter one unless they mean to give up early.
   */
  const settleWaitMs = Math.max(0, graceMs) + tickMs + ACK_WAIT_MS
  const waitSettled = (pos, timeoutMs = settleWaitMs, signal = null) => new Promise(resolve => {
    let key
    try { key = posKey(new Vec3(pos.x, pos.y, pos.z).floored()) } catch { return resolve({ broken: null, pending: false }) }
    if (!ledger.pending.has(key)) return resolve({ broken: null, pending: false })
    if (signal?.aborted) return resolve({ broken: null, pending: true })
    let timer = null
    const unhook = () => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      const w = waiters.get(key); if (w) { const i = w.indexOf(done); if (i >= 0) w.splice(i, 1); if (!w.length) waiters.delete(key) }
    }
    const done = s => { unhook(); resolve({ broken: s ? s.target === 0 : null, pending: false }) }
    const onAbort = () => { unhook(); resolve({ broken: null, pending: true }) }
    timer = setTimeout(onAbort, timeoutMs)
    signal?.addEventListener?.('abort', onAbort, { once: true })
    waiters.set(key, [...(waiters.get(key) ?? []), done])
  })
  return { ledger, counts, waitSettled, settleWaitMs }
}
