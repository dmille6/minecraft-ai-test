// PICKUP TELEMETRY. TELEMETRY ONLY: nothing in this file, and nothing that reads what it writes, decides anything.
// No skill, reflex or prompt reads it; removing it must change no behaviour. A logger must not break the bot, so
// every listener here swallows its own errors and counts them (err= on the summary row).
//
// WHY. Bag junk was measured only by inventory deltas: 80 bots gained 1,614 junk items in 3 h (oak_sapling 693,
// bamboo 557, leaf_litter 166, ...). A delta says WHAT arrived, never how: which skill was running, whether the
// bot walked to the drop or the server handed it over as the bot passed, where it stood, what was around it.
// The owner's spec (10-03): "log what actions are taken around when the junk is being picked up, what junk is
// being picked up, and where the bot was when this happened".
//
// TWO ROW KINDS.
//   _junk_pickup  ONE ROW PER PICKUP of a JUNK_ITEMS item (~7 junk items per bot-hour, measured): item, count,
//                 mode, position, dimension, the running skill, the reflex holding the body, the last 3 actions in
//                 the preceding 30 s, and the blocks around the feet. Structured in skill.args (`flattened` in the
//                 mcai-skill mapping), with a most-important-first detail under the logger's 300-char cap.
//   _pickups      everything else, aggregated per (item, source, mode), one row per minute WINDOW in which anything
//                 happened (pickups, junk rows, capped junk, errors) and on shutdown. Every count on it, err=
//                 included, is that window's, and the row names the window's length.
//   Bounded: 64 groups a window (the rest fold into other_groups), 64-char fields, 5 junk rows a second (the
//   excess folds into the summary as junk_capped).
//
// HOW AN ITEM IS RESOLVED. The server sends `collect` (take_item_entity: collected id, collector id,
// pickupItemCount) BEFORE it removes the entity, and mineflayer 4.37.1 turns it into `playerCollect(collector,
// collected)` synchronously in its packet handler, with the entity still in bot.entities and its metadata intact,
// so getDroppedItem() is readable at that moment. pickupItemCount is not passed through playerCollect, so a
// listener PREPENDED on the raw packet records it first; the entity's own stack count is the fallback.
//
// SOUGHT vs PASSIVE. 'sought' when the bot was deliberately walking to THAT entity id: pickupNearbyItems
// registers each drop it walks to (noteSought), and any pathfinder goal that follows an item entity
// (mineflayer-collectblock's GoalFollow) is registered from `goal_updated`. A marker lives only while its pursuit
// does: pickupNearbyItems releases it when the walk fails, aborts or settles, and a replaced or cleared goal
// releases follow markers; a 15 s ttl is the backstop. Everything else is 'passive' -- the server's auto-pickup of
// an item within reach while the bot was doing something else.

import { NEVER_KEEP } from './hygiene.mjs'

/** Every sapling species in 1.21.x, plus the mangrove's propagule (its sapling). */
export const SAPLINGS = Object.freeze([
  'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling',
  'cherry_sapling', 'pale_oak_sapling', 'mangrove_propagule',
])
/** JUNK for this log: hygiene's NEVER_KEEP ballast, every sapling, bamboo and apples (owner, 10-03). */
export const JUNK_ITEMS = new Set([...NEVER_KEEP, ...SAPLINGS, 'bamboo', 'apple'])
export function isJunk (name) {
  return typeof name === 'string' && (JUNK_ITEMS.has(name) || name.endsWith('_sapling'))
}

/** Kinds this file writes, and kinds too frequent to be an "action": never pushed into the action ring. */
const RING_IGNORES = new Set(['_pickups', '_junk_pickup', '_dig_sync'])
const SEEK_TTL_MS = 15_000     // pickupNearbyItems: 6 s goto + 250 ms settle; collectblock re-goals per target

// ---------------------------------------------------------------- attribution -----

/** The skill's main argument: the block/item it is about, else nothing (goto's coordinates are noise here). */
export function mainArg (skill, args) {
  if (!args || typeof args !== 'object') return null
  const v = args.block ?? args.item ?? args.plan ?? args.action ?? (skill === 'mine' && args.y != null ? `y${args.y}` : null)
  return v == null ? null : String(v)
}
export function skillLabel (skill, args) {
  if (!skill) return null
  const a = mainArg(skill, args)
  return a ? `${skill}:${a}` : String(skill)
}

/**
 * Who the pickup belongs to. ctx = { skill, args, holder, reflex } as read at the moment of the pickup.
 *   holder  the arbiter's grant owner: AUTHORITATIVE when present. A holder other than the running skill means a
 *           reflex took the body from it, so the pickup is the holder's.
 *   skill   the running skill with its main arg.
 *   reflex  a reflex arm's own flag: only when nothing above answers. A flag never overrides the holder (Codex).
 * Else 'idle'. The holder and the flag are also written as SEPARATE fields on the junk row.
 */
export function attributeTo (ctx = {}) {
  if (ctx.holder && ctx.holder !== ctx.skill) return `holder:${ctx.holder}`
  const s = skillLabel(ctx.skill, ctx.args)
  if (s) return s
  return ctx.reflex ? `reflex:${ctx.reflex}` : 'idle'
}

/**
 * Which reflex arm is driving the body, from the arms' own flags (reflex.mjs reads its closure flags into this).
 * The body-moving arms first; eating does not move the body, so it names the pickup only when nothing else runs.
 */
export function activeReflexOf ({ rescuing = false, escaping = false, pocketing = false, marooned = false, eating = false } = {}) {
  return rescuing ? 'drown_rescue' : escaping ? 'escape' : pocketing ? 'flooded_pocket' : marooned ? 'marooned'
    : eating ? 'eat' : null
}

/**
 * A bounded copy of a skill's args for the structured row: primitives only (a nested object is not copied), at
 * most maxKeys keys, strings cut to maxStr. A copy, so a later mutation by the skill cannot reach the row.
 */
export function boundArgs (args, { maxKeys = 8, maxStr = 40 } = {}) {
  if (!args || typeof args !== 'object') return null
  const out = {}
  let k = 0
  for (const [key, v] of Object.entries(args)) {
    if (k >= maxKeys) break
    if (v == null || typeof v === 'object' || typeof v === 'function') continue
    out[String(key).slice(0, maxStr)] = typeof v === 'string' ? v.slice(0, maxStr) : v
    k++
  }
  return out
}

/** 'sought' when this id was being walked to within ttl, or is the pathfinder's follow target now. */
export function pickupMode ({ id, seeking, now, ttlMs = SEEK_TTL_MS, goalEntityId = null }) {
  if (goalEntityId != null && goalEntityId === id) return { mode: 'sought', by: 'goal' }
  const s = seeking?.get?.(id)
  if (s && now - s.at <= ttlMs) return { mode: 'sought', by: s.by }
  return { mode: 'passive', by: null }
}

/**
 * The collected item's name and count. getDroppedItem() reads the entity metadata, which is still present at
 * playerCollect time. The server's pickupItemCount wins over the stack count when the raw packet gave one.
 * A non-item entity (an arrow, a trident) is named by its entity name.
 */
export function resolveCollected (entity, packetCount = null) {
  let name = null, count = null
  const it = entity?.getDroppedItem?.()
  if (it) { name = it.name ?? null; count = it.count ?? null }
  if (!name) name = entity?.name && entity.name !== 'item' ? String(entity.name) : '?'
  if (Number.isFinite(packetCount) && packetCount > 0) count = packetCount
  return { name, count: Number.isFinite(count) && count > 0 ? count : 1 }
}

// ---------------------------------------------------------------- action ring -----

/**
 * The last few things the bot did, newest last. Consecutive repeats collapse into one entry, so a mine's twenty
 * `dig:stone` rows do not push everything else out. Each entry keeps the TIMES of its repeats (bounded), so a run
 * that started before the window counts only the repeats inside it (Codex: a refreshed timestamp counted them all).
 */
export class ActionRing {
  constructor (max = 12, maxRepeats = 64) { this.max = max; this.maxRepeats = maxRepeats; this.items = [] }
  push (label, t) {
    if (!label) return
    const last = this.items[this.items.length - 1]
    if (last && last.label === label) {
      last.times.push(t)
      if (last.times.length > this.maxRepeats) last.times.shift()
      return
    }
    this.items.push({ label, times: [t] })
    if (this.items.length > this.max) this.items.shift()
  }
  /** Up to n entries with a repeat in the last windowMs, oldest first, as `label[ xN] -Ss` (N = repeats inside). */
  recent (now, { n = 3, windowMs = 30_000 } = {}) {
    const out = []
    for (const e of this.items) {
      const inside = e.times.filter(t => t <= now && now - t <= windowMs)
      if (inside.length) out.push({ label: e.label, n: inside.length, t: inside[inside.length - 1] })
    }
    return out.slice(-n).map(e => `${e.label}${e.n > 1 ? ` x${e.n}` : ''} -${Math.round((now - e.t) / 1000)}s`)
  }
}

/** A logger record (logSkill/logEvent) as a ring label, or null for the kinds the ring ignores. */
export function ringLabel (rec) {
  const name = rec?.skill?.name
  if (!name || RING_IGNORES.has(name)) return null
  if (name.startsWith('_')) return rec.skill.status && rec.skill.status !== 'success' ? `${name}:${rec.skill.status}` : name
  return `${skillLabel(name, rec.skill.args) ?? name}:${rec.skill.status ?? '?'}`
}

// ---------------------------------------------------------------- local context -----

const LEAVES = /_leaves$/
const BAMBOO = /^bamboo(_sapling)?$/
const GRASS = /^(short_grass|tall_grass|fern|large_fern)$/

/**
 * The blocks around the feet: the block at the feet and directly below, and counts of leaves / bamboo / grass in
 * a (2r+1) x (2r+1) x (dyMax-dyMin+1) box around the feet (default 7x7x3: one layer below to one above). Reads
 * block STATE IDS (no Block objects) where the world exposes them. Columns not loaded are skipped and counted.
 * Returns null when there is nothing to read; never throws.
 */
export function sampleContext (bot, { r = 3, dyMin = -1, dyMax = 1 } = {}) {
  try {
    const p = bot?.entity?.position
    if (!p) return null
    const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z)
    const world = bot.world
    const byState = bot.registry?.blocksByStateId
    const fast = typeof world?.getBlockStateId === 'function' && typeof world?.getColumnAt === 'function' && !!byState
    const q = { x: 0, y: 0, z: 0 }
    const nameAt = (x, y, z) => {
      q.x = x; q.y = y; q.z = z
      if (fast) return byState[world.getBlockStateId(q)]?.name ?? null
      return bot.blockAt?.({ x, y, z }, false)?.name ?? null
    }
    const loaded = (x, z) => {
      if (fast) { q.x = x; q.y = fy; q.z = z; return !!world.getColumnAt(q) }
      return nameAt(x, fy, z) != null
    }
    if (!loaded(fx, fz)) return null
    let leaves = 0, bamboo = 0, grass = 0, unloaded = 0
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (!loaded(fx + dx, fz + dz)) { unloaded++; continue }
        for (let dy = dyMin; dy <= dyMax; dy++) {
          const n = nameAt(fx + dx, fy + dy, fz + dz)
          if (!n) continue
          if (LEAVES.test(n)) leaves++
          else if (BAMBOO.test(n)) bamboo++
          else if (GRASS.test(n)) grass++
        }
      }
    }
    return { feet: nameAt(fx, fy, fz) ?? '?', below: nameAt(fx, fy - 1, fz) ?? '?', leaves, bamboo, grass, unloaded }
  } catch { return null }
}

// ---------------------------------------------------------------- rows -----

/**
 * One _junk_pickup row: { detail, args }. detail is ordered most-important-first and capped at max; args carries
 * every field structured, so nothing the cap cuts is lost. holder (arbiter, authoritative) and reflex (an arm's
 * flag) are separate fields; skill_args is a bounded copy of the running skill's args.
 */
export function junkRow ({ name, count, mode, by = null, pos = null, dim = null, source, skill = null, skillArgs = null,
                          holder = null, reflex = null, recent = [], ctx = null, sampleUs = null }, max = 300) {
  const xyz = pos ? [pos.x, pos.y, pos.z].map(v => Math.round(v)) : null
  const at = xyz ? `${xyz.join(',')}${dim ? ` ${dim}` : ''}` : '?'
  const c = ctx ? `feet=${ctx.feet} below=${ctx.below} leaves=${ctx.leaves} bamboo=${ctx.bamboo} grass=${ctx.grass}` +
                  (ctx.unloaded ? ` unloaded=${ctx.unloaded}` : '') : 'ctx=none'
  const body = [holder ? `holder=${holder}` : null, reflex ? `reflex=${reflex}` : null].filter(Boolean).join(' ')
  const detail = [
    `${name} x${count} ${mode}${by ? `(${by})` : ''} ${source} at ${at}`,
    body || null,
    c,
    `recent: ${recent.length ? recent.join(', ') : 'none'}`,
  ].filter(Boolean).join(' | ').slice(0, max)
  const args = {
    item: name, count, mode, sought_by: by, source, skill, skill_args: skillArgs, holder, reflex,
    x: xyz?.[0] ?? null, y: xyz?.[1] ?? null, z: xyz?.[2] ?? null, dim,
    recent: recent.slice(),
    feet: ctx?.feet ?? null, below: ctx?.below ?? null,
    leaves: ctx?.leaves ?? null, bamboo: ctx?.bamboo ?? null, grass: ctx?.grass ?? null, unloaded: ctx?.unloaded ?? null,
    sample_us: sampleUs,
  }
  return { detail, args }
}

/** Bounds on the minute's aggregate: groups beyond MAX_GROUPS fold into one `other_groups` group (counted). */
export const MAX_GROUPS = 64
const MAX_FIELD = 64
const OVERFLOW = '\u0000overflow'

/** Fold one non-junk pickup into the minute's aggregate (a Map keyed item/source/mode), bounded in groups and bytes. */
export function addPickup (agg, { name, count, source, mode }, { maxGroups = MAX_GROUPS } = {}) {
  name = String(name).slice(0, MAX_FIELD); source = String(source).slice(0, MAX_FIELD); mode = String(mode).slice(0, 16)
  let k = `${name}\t${source}\t${mode}`
  if (!agg.has(k) && agg.size - (agg.has(OVERFLOW) ? 1 : 0) >= maxGroups) {
    k = OVERFLOW; name = 'other_groups'; source = 'capped'; mode = '-'
  }
  const e = agg.get(k) ?? { name, source, mode, count: 0, n: 0 }
  e.count += count; e.n += 1
  agg.set(k, e)
  return agg
}

/**
 * The _pickups detail for ONE window: groups by item count, largest first, then the totals for this window (the
 * denominator), its length, the junk rows written in it, junk over the burst cap, and this window's errors.
 * `cobblestone 30 mine:y-20 passive; oak_log 6 gather:oak_log sought | 36 items in 2 pickups in 60s; junk 3 rows`.
 * When the groups do not fit, the smallest are dropped and the tail says how many groups and items are not shown.
 * Linear: one pass over prefix lengths and suffix sums, and a single join.
 */
export function formatPickups (agg, { max = 300, errors = 0, junk = 0, junkCapped = 0, windowS = null } = {}) {
  const groups = [...agg.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) ||
                                                    a.source.localeCompare(b.source) || a.mode.localeCompare(b.mode))
  const items = groups.reduce((s, g) => s + g.count, 0)
  const n = groups.reduce((s, g) => s + g.n, 0)
  const parts = groups.map(g => `${g.name} ${g.count} ${g.source} ${g.mode}`)
  const base = `${items} items in ${n} pickups` + (windowS != null ? ` in ${windowS}s` : '') +
               (junk ? `; junk ${junk} rows` : '') + (junkCapped ? `; junk_capped ${junkCapped}` : '') +
               (errors ? `; err=${errors}` : '')
  // hiddenItems[k] = items in groups k..end; prefixLen[k] = length of parts[0..k) joined with '; '.
  const hiddenItems = new Array(groups.length + 1).fill(0)
  for (let k = groups.length - 1; k >= 0; k--) hiddenItems[k] = hiddenItems[k + 1] + groups[k].count
  const tailFor = k => base + (k < groups.length ? `; +${groups.length - k} groups (${hiddenItems[k]} items) not shown` : '')
  let best = 0, prefixLen = 0
  for (let k = 1; k <= parts.length; k++) {
    prefixLen += parts[k - 1].length + (k > 1 ? 2 : 0)
    if (prefixLen + 3 + tailFor(k).length <= max) best = k
    else if (prefixLen > max) break
  }
  const s = (best ? parts.slice(0, best).join('; ') + ' | ' : '') + tailFor(best)
  return s.length <= max ? s : base.slice(0, max)
}

// ---------------------------------------------------------------- wiring -----

const seekingByBot = new WeakMap()
function seekingOf (bot) {
  let m = seekingByBot.get(bot)
  if (!m) { m = new Map(); seekingByBot.set(bot, m) }
  return m
}

/**
 * pickupNearbyItems (or any code path) is about to walk to this item entity. Returns a release() the caller runs
 * when that pursuit ends -- arrived, failed, timed out or aborted -- so a drop it gave up on and later collects in
 * passing reads 'passive' (Codex). The ttl in pickupMode is only the backstop. Telemetry only; never throws.
 */
export function noteSought (bot, id, by = 'pickup', now = Date.now()) {
  try {
    if (!bot || id == null) return () => {}
    const m = seekingOf(bot)
    const mark = { at: now, by }
    m.set(id, mark)
    return () => { try { if (m.get(id) === mark) m.delete(id) } catch { /* telemetry */ } }
  } catch { return () => {} }
}

/**
 * Attach the pickup log to a bot. Returns { final, flush, ring, stats }.
 *   context()   -> { skill, args, holder, reflex }  read at each pickup (runner.current, arbiter holder, reflex flag)
 *   emitSummary(detail)             writes the _pickups row
 *   emitJunk({ detail, args })      writes one _junk_pickup row
 *   tap(fn) -> unsubscribe          feeds every logger record to fn (logger.tapRecords)
 *   resolve(entity, packetCount)    injectable for tests; defaults to resolveCollected
 *   junkPerSec                      at most this many _junk_pickup rows a second; the excess is folded into the
 *                                   summary aggregate and counted as junk_capped
 */
export function attachPickupLog (bot, { context = () => ({}), emitSummary = () => {}, emitJunk = () => {},
  tap = null, resolve = resolveCollected, sample = sampleContext, now = () => Date.now(),
  flushMs = 60_000, seekTtlMs = SEEK_TTL_MS, junkPerSec = 5, timers = true } = {}) {
  const agg = new Map()
  const ring = new ActionRing()
  const packetCounts = new Map()
  const seeking = seekingOf(bot)
  const stats = { errors: 0, junk: 0, other: 0, capped: 0 }
  // THIS WINDOW's counters (Claude): every number on a summary row covers exactly the window it names.
  let win = { start: now(), junk: 0, capped: 0, errors: 0 }
  let burst = { sec: -1, n: 0 }
  let done = false
  const err = () => { stats.errors++; win.errors++ }

  // The raw packet carries pickupItemCount, which playerCollect drops. PREPENDED so it runs before mineflayer's
  // own handler, which emits playerCollect synchronously.
  const onPacket = pk => {
    try {
      if (pk && pk.collectorEntityId === bot.entity?.id) {
        packetCounts.set(pk.collectedEntityId, pk.pickupItemCount)
        if (packetCounts.size > 256) packetCounts.clear()          // bounded: playerCollect consumes each entry
      }
    } catch { err() }
  }
  // A follow goal on an item marks it sought; ANY goal change (replaced, or setGoal(null)) ends the earlier
  // follow pursuits (Codex: a cancelled pursuit left a 15 s 'sought' marker behind).
  const onGoal = goal => {
    try {
      const e = goal?.entity
      for (const [id, s] of seeking) if (s.by === 'follow' && id !== e?.id) seeking.delete(id)
      if (e && e.name === 'item' && e.id != null) noteSought(bot, e.id, 'follow', now())
    } catch { err() }
  }
  const onDig = block => { try { ring.push(`dig:${block?.name ?? '?'}`, now()) } catch { err() } }

  const onCollect = (collector, collected) => {
    if (done) return
    try {
      const me = bot.entity
      if (!collector || !me || !collected || (collector !== me && collector.id !== me.id)) return
      if (collected.name === 'experience_orb') return
      const t = now()
      const pc = packetCounts.get(collected.id); packetCounts.delete(collected.id)
      const { name, count } = resolve(collected, pc)
      let goalEntityId = null
      try { goalEntityId = bot.pathfinder?.goal?.entity?.id ?? null } catch { /* no pathfinder */ }
      const { mode, by } = pickupMode({ id: collected.id, seeking, now: t, ttlMs: seekTtlMs, goalEntityId })
      seeking.delete(collected.id)
      let c = {}
      try { c = context() ?? {} } catch { err() }
      const source = attributeTo(c)
      if (isJunk(name)) {
        const sec = Math.floor(t / 1000)
        if (burst.sec !== sec) burst = { sec, n: 0 }
        if (burst.n >= junkPerSec) {
          // Over the burst cap: counted and folded into the summary, not written as a row.
          stats.capped++; win.capped++
          addPickup(agg, { name, count, source, mode })
          return
        }
        burst.n++
        stats.junk++; win.junk++
        const t0 = process.hrtime.bigint()
        const ctx = sample(bot)
        const sampleUs = Number((process.hrtime.bigint() - t0) / 1000n)
        const p = me.position
        emitJunk(junkRow({
          name, count, mode, by, source,
          pos: p ? { x: p.x, y: p.y, z: p.z } : null,
          dim: String(bot.game?.dimension ?? '').replace('minecraft:', '') || null,
          skill: skillLabel(c.skill, c.args), skillArgs: boundArgs(c.args),
          holder: c.holder ?? null, reflex: c.reflex ?? null,
          recent: ring.recent(t), ctx, sampleUs,
        }))
      } else {
        stats.other++
        addPickup(agg, { name, count, source, mode })
      }
    } catch { err() }
  }

  /** Write this window's summary when ANYTHING happened in it (pickups, junk rows, capped junk or errors). */
  const flush = () => {
    if (done) return
    try {
      const t = now()
      for (const [id, s] of seeking) if (t - s.at > seekTtlMs) seeking.delete(id)
      packetCounts.clear()
      const w = win
      win = { start: t, junk: 0, capped: 0, errors: 0 }
      if (!agg.size && !w.junk && !w.capped && !w.errors) return
      const detail = formatPickups(agg, { errors: w.errors, junk: w.junk, junkCapped: w.capped,
                                         windowS: Math.max(0, Math.round((t - w.start) / 1000)) })
      agg.clear()
      emitSummary(detail)
    } catch { stats.errors++ }
  }

  const client = bot._client
  if (client) {
    if (typeof client.prependListener === 'function') client.prependListener('collect', onPacket)
    else client.on?.('collect', onPacket)
  }
  bot.on('playerCollect', onCollect)
  bot.on('goal_updated', onGoal)
  bot.on('diggingCompleted', onDig)
  const untap = typeof tap === 'function'
    ? tap(rec => { try { ring.push(ringLabel(rec), now()) } catch { err() } })
    : null
  const timer = timers ? setInterval(flush, flushMs) : null
  timer?.unref?.()

  /**
   * Flush this window (junk-only and error-only windows included), then DETACH everything, so nothing can write a
   * row after the logs close (Codex). Idempotent; the signal handler calls it before closeLogs().
   */
  const final = () => {
    if (done) return
    if (timer) clearInterval(timer)
    flush()
    done = true
    try { untap?.() } catch { /* telemetry */ }
    try { bot.off?.('playerCollect', onCollect); bot.off?.('goal_updated', onGoal); bot.off?.('diggingCompleted', onDig) } catch { /* telemetry */ }
    try { client?.off?.('collect', onPacket) } catch { /* telemetry */ }
  }
  return { final, flush, ring, stats }
}
