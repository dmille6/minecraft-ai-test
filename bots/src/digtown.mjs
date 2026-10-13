// THE `_dig_town` INSTRUMENT (townground-2026-10-13.md, section 2.3). TELEMETRY ONLY: nothing in this file, and nothing
// that reads what it writes, decides anything. Removing it must change no behaviour.
//
// WHY. Two instruments measured the town's ground on 10-13 and neither names the breaker: a region diff sees cells
// disappear (about 85 per town-day in the band above home.y - 12), and the `_pickups` rows see which activity was
// COLLECTING (gather 6,783 of 8,438 ground items a day within 15 of home), not who broke the block. The zone (step 3)
// needs a canary metric on the digs it refuses, so the dig itself is recorded here, with its purpose.
//
// HOW (both reviews, r2-r4):
//   CAPTURE BEFORE THE DIG. mineflayer 4.37.1 emits `diggingCompleted` with the block AFTER it is air, clears
//     targetDigBlock first, and drops every completion listener on death (digging.js:196-215). So `bot.dig` -- the one
//     entry the pathfinder, collectblock and the skills all call -- is wrapped: the block's name, position, class and
//     the invocation's PURPOSE are read synchronously, then the ORIGINAL dig is called with the SAME arguments and its
//     OWN promise is returned unchanged (e.aborted, withTimeout cancels and every caller's catch keep working).
//   PURPOSE, in this order (digPurpose): while the pathfinder is mining, the active Movements' `digPurpose` tag (the ore
//     tunnel's profile is tagged target:ore_tunnel -- pathfinder sets digging=true BEFORE it calls bot.dig,
//     mineflayer-pathfinder index.js:485-492) or `transit`; else a reflex holding the body (`survival`); else an explicit
//     `bot.digScope` (goto sets transit around its own direct digs -- float dig, ride-floor-down -- so a goto called from
//     inside mine or gather is not read as their target: Codex code r1 P2); else the running skill: gather and mine are
//     `target`, anything else `other`.
//   OUTCOME (digOutcome): mineflayer resolves when its OWN timer writes air into its world model (a prediction, :150-167)
//     and ALSO when another actor's break reaches it first (:196-208). So a resolved dig is not proof. The server's word
//     is: a block_change / multi_block_change for the cell, read from the raw packets (the bot's own prediction never
//     passes there). `confirmed` = the server named a different block for the cell AFTER this dig settled, within 10 s
//     (digsync2-01, 10-02: 22 of 30 slow breaks got their air within 10 s); `foreign` = the server named a different
//     block BEFORE this dig settled (someone else broke it); `rejected` = the server re-sent the same block;
//     `unconfirmed` = silence for 10 s (Paper sends NOTHING for a refused dig, 09-29 ghost-block proof); `aborted`,
//     `death`, `error` from the promise. Two bots finishing one cell in the same instant can BOTH read `confirmed`: this
//     is dig ATTEMPT attribution, not authoritative actor attribution; the read dedupes (cell, +-2 s) across bots.
//   EXACT COUNTS: every dig anywhere is counted in a one-minute summary (`_dig_town_sum`, structured counts in args),
//     never sampled; every dig of a `ground` cell gets its own `_dig_town` row (about 300 a town-day measured), never
//     rate-limited. Pending digs at shutdown are counted as `pending`.
import { townDigClass, inTownBox, TOWN_MARGIN } from './townground.mjs'
import { attributeTo } from './pickuplog.mjs'

export const CONFIRM_GRACE_MS = 10_000
export const SUMMARY_MS = 60_000
/** Digs awaiting the server's word at once; beyond this a dig is counted `overflow` and not tracked. */
export const MAX_PENDING = 256
export const TARGET_SKILLS = new Set(['gather', 'mine'])
const AIRS = new Set(['air', 'cave_air', 'void_air'])

/**
 * WHY THIS DIG -> { purpose: 'target'|'transit'|'survival'|'other', by }. Pure.
 *   scope             bot.digScope: { purpose, by } set by a caller around its own digs (wins over everything)
 *   pathfinderMining  bot.pathfinder.isMining() at the call
 *   movementsPurpose  the active Movements' digPurpose tag, e.g. 'target:ore_tunnel'
 *   skill, args, holder, reflex   as pickuplog's attributeTo reads them
 */
export function digPurpose ({ scope = null, pathfinderMining = false, movementsPurpose = null, skill = null, args = null, holder = null, reflex = null } = {}) {
  const who = attributeTo({ skill, args, holder, reflex })
  if (pathfinderMining) {
    if (typeof movementsPurpose === 'string' && movementsPurpose.includes(':')) {
      const [p, b] = movementsPurpose.split(':')
      return { purpose: p, by: b }
    }
    return { purpose: 'transit', by: who }
  }
  if (reflex || (holder && holder !== skill)) return { purpose: 'survival', by: who.startsWith('holder:') || who.startsWith('reflex:') ? who : `reflex:${reflex}` }
  if (scope && typeof scope.purpose === 'string') return { purpose: scope.purpose, by: String(scope.by ?? scope.purpose) }
  if (skill && TARGET_SKILLS.has(skill)) return { purpose: 'target', by: who }
  return { purpose: 'other', by: who }
}

/**
 * THE DIG'S OUTCOME -> 'pending'|'confirmed'|'foreign'|'rejected'|'unconfirmed'|'aborted'|'death'|'error'. Pure.
 *   settledAt  when the dig's promise settled (null: still running)
 *   error      its rejection, if any;  died  the bot died between the call and the settle
 *   before     the server named a DIFFERENT block for the cell before the settle (bool)
 *   after      the first server word for the cell after the settle: { t, same } | null
 */
export function digOutcome ({ settledAt = null, error = null, died = false, before = false, after = null, now = Date.now(), graceMs = CONFIRM_GRACE_MS } = {}) {
  if (settledAt == null) return 'pending'
  if (error) return died ? 'death' : /abort/i.test(String(error?.message ?? error)) ? 'aborted' : 'error'
  if (before) return 'foreign'
  if (after && after.t - settledAt <= graceMs) return after.same ? 'rejected' : 'confirmed'
  return now - settledAt >= graceMs ? 'unconfirmed' : 'pending'
}

/**
 * Run fn with bot.digScope set (restored after, nesting-safe). TELEMETRY ONLY: digPurpose is its only reader.
 */
export async function withDigScope (bot, scope, fn) {
  if (!bot) return fn()
  const prev = bot.digScope
  bot.digScope = scope
  try { return await fn() } finally { bot.digScope = prev }
}

/** The cells a multi_block_change names, as mineflayer 4.37.1 decodes them for 1.21.x (single-long records). */
export function multiBlockCells (packet) {
  const out = []
  const c = packet?.chunkCoordinates
  if (!c || !Array.isArray(packet?.records)) return out
  for (const record of packet.records) {
    const r = Number(record)
    if (!Number.isFinite(r)) continue
    out.push({ x: c.x * 16 + ((r >> 8) & 0x0f), y: c.y * 16 + (r & 0x0f), z: c.z * 16 + ((r >> 4) & 0x0f), state: Math.floor(r / 4096) })
  }
  return out
}

/** The one-minute counts as a compact detail (most important first; the structured counts ride in args). Pure. */
export function summaryDetail (sum, windowS) {
  const o = sum.outcomes
  const head = `w=${windowS}s all=${sum.all} conf=${o.confirmed ?? 0} unconf=${o.unconfirmed ?? 0} foreign=${o.foreign ?? 0} rej=${o.rejected ?? 0} abort=${o.aborted ?? 0} death=${o.death ?? 0} err=${o.error ?? 0} pend=${o.pending ?? 0} ovf=${sum.overflow} ierr=${sum.ierr}`
  const zone = Object.entries(sum.zone).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('; ')
  return zone ? `${head} | ${zone}` : head
}

export function emptySummary () { return { all: 0, outcomes: {}, zone: {}, overflow: 0, ierr: 0 } }

/**
 * Install the wrapper on one bot. -> { final, flush, stats } (telemetry: every listener swallows its own errors).
 *   home         { x, y, z } (config.world.homeX/Y/Z); unknown -> every dig is 'free', still counted
 *   context()    { skill, args, holder, reflex } as pickuplog reads it
 *   emitDig({ detail, args }), emitSummary({ detail, args })
 */
export function attachDigTown (bot, { home, context = () => ({}), emitDig, emitSummary, timers = true, now = () => Date.now(), graceMs = CONFIRM_GRACE_MS, summaryMs = SUMMARY_MS } = {}) {
  if (!bot || typeof bot.dig !== 'function' || bot.dig.__digtown) return null
  const orig = bot.dig
  const pending = new Map()            // "x,y,z" -> [rec]
  let npending = 0, sum = emptySummary(), winStart = now(), lastDeath = -Infinity, done = false, closed = false
  const stats = { wrapped: 0, settled: 0 }
  const key = p => `${p.x},${p.y},${p.z}`
  const ierr = () => { sum.ierr++ }
  const stateOf = b => (Number.isFinite(b?.stateId) ? b.stateId : null)

  const finish = (rec) => {
    if (rec.final || closed) return
    const outcome = digOutcome({ settledAt: rec.settledAt, error: rec.error, died: rec.died, before: rec.before, after: rec.after, now: now(), graceMs })
    if (outcome === 'pending' && !done) return
    rec.final = outcome
    if (rec.timer) clearTimeout(rec.timer)
    const list = pending.get(rec.k)
    if (list) { const i = list.indexOf(rec); if (i >= 0) list.splice(i, 1); if (!list.length) pending.delete(rec.k); npending-- }
    sum.outcomes[outcome] = (sum.outcomes[outcome] ?? 0) + 1
    if (rec.zone) { const zk = `${rec.zone}.${rec.cls}.${rec.purpose}.${outcome}`; sum.zone[zk] = (sum.zone[zk] ?? 0) + 1 }
    stats.settled++
    if (rec.cls === 'ground') {
      const dt = rec.after ? Math.round(rec.after.t - rec.settledAt) : null
      const args = { x: rec.p.x, y: rec.p.y, z: rec.p.z, block: rec.name, cls: rec.cls, purpose: rec.purpose, by: rec.by, outcome, dt_ms: dt, t0: rec.t0 }
      try { emitDig({ detail: `pos=${key(rec.p)} block=${rec.name} class=${rec.cls} purpose=${rec.purpose} by=${rec.by} outcome=${outcome}${dt == null ? '' : ` dt=${dt}`}`, args }) } catch { ierr() }
    }
  }

  const word = (x, y, z, state) => {
    const list = pending.get(`${x},${y},${z}`)
    if (!list) return
    const t = now()
    for (const rec of [...list]) {
      const same = state != null && rec.state != null && state === rec.state
      if (rec.settledAt == null) { if (!same) rec.before = true; continue }
      if (!rec.after) { rec.after = { t, same } ; finish(rec) }
    }
  }
  const onBlockChange = (packet) => { try { const l = packet?.location; if (l) word(l.x, l.y, l.z, Number(packet.type)) } catch { ierr() } }
  const onMulti = (packet) => { try { for (const c of multiBlockCells(packet)) word(c.x, c.y, c.z, c.state) } catch { ierr() } }
  const onDeath = () => { lastDeath = now() }
  const client = bot._client
  try {
    if (typeof client?.prependListener === 'function') { client.prependListener('block_change', onBlockChange); client.prependListener('multi_block_change', onMulti) }
    bot.on?.('death', onDeath)
  } catch { ierr() }

  function capture (block) {
    const p = block?.position
    if (!p) return null
    const c = (() => { try { return context() ?? {} } catch { ierr(); return {} } })()
    let mining = false, tag = null
    try { mining = !!bot.pathfinder?.isMining?.(); tag = bot.pathfinder?.movements?.digPurpose ?? null } catch { ierr() }
    const { purpose, by } = digPurpose({ scope: bot.digScope ?? null, pathfinderMining: mining, movementsPurpose: tag, ...c })
    const cell = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }
    const zone = inTownBox(cell, home) ? 'zone' : inTownBox(cell, home, { margin: TOWN_MARGIN }) ? 'margin' : null
    return { p: cell, k: key(cell), name: block.name ?? '?', state: stateOf(block), cls: townDigClass(cell, block.name, home),
             zone, purpose, by, t0: now(), settledAt: null, error: null, died: false, before: false, after: null, final: null }
  }

  const settle = (rec, error) => {
    if (closed) return
    try {
      rec.settledAt = now(); rec.error = error ?? null; rec.died = !!error && lastDeath >= rec.t0
      finish(rec)
      if (!rec.final && timers) { rec.timer = setTimeout(() => { try { finish(rec) } catch { ierr() } }, graceMs + 5); rec.timer.unref?.() }
    } catch { ierr() }
  }

  const wrapped = function (block, ...rest) {
    let rec = null
    try {
      rec = closed ? null : capture(block)
      if (rec) {
        sum.all++; stats.wrapped++
        if (npending >= MAX_PENDING) { sum.overflow++; rec = null } else {
          const list = pending.get(rec.k) ?? []; list.push(rec); pending.set(rec.k, list); npending++
        }
      }
    } catch { ierr(); rec = null }
    const promise = orig.call(this, block, ...rest)
    if (rec) {
      try { promise.then(() => settle(rec, null), e => settle(rec, e ?? new Error('rejected'))) } catch { ierr() }
    }
    return promise
  }
  wrapped.__digtown = true
  wrapped.__orig = orig
  bot.dig = wrapped

  const flush = () => {
    try {
      const t = now()
      for (const list of [...pending.values()]) for (const rec of [...list]) finish(rec)
      if (sum.all || sum.ierr || Object.keys(sum.outcomes).length) {
        const w = Math.max(0, Math.round((t - winStart) / 1000))
        emitSummary({ detail: summaryDetail(sum, w), args: { w_s: w, all: sum.all, overflow: sum.overflow, ierr: sum.ierr, ...Object.fromEntries(Object.entries(sum.outcomes).map(([k, v]) => [`o_${k}`, v])), ...Object.fromEntries(Object.entries(sum.zone).map(([k, v]) => [`z_${k.replace(/\./g, '_')}`, v])) } })
      }
      sum = emptySummary(); winStart = t
    } catch { ierr() }
  }
  const timer = timers ? setInterval(flush, summaryMs) : null
  timer?.unref?.()

  const final = () => {
    if (done) return
    done = true
    if (timer) clearInterval(timer)
    for (const list of [...pending.values()]) for (const rec of [...list]) finish(rec)   // done: pending ones are counted 'pending'
    flush()
    closed = true
    try { client?.removeListener?.('block_change', onBlockChange); client?.removeListener?.('multi_block_change', onMulti); bot.removeListener?.('death', onDeath) } catch { /* telemetry */ }
    // the wrapper stays (a dig in flight still returns its own promise); it records nothing more
  }
  return { final, flush, stats, pending: () => npending }
}
