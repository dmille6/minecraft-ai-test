// THE JOB ASSIGNER, host side (B5 of the cooperation tier: docs/reports/cooperation-tier-2026-10-23.md sections 3.2-3.7, 6.2).
// Pure functions over ONE town snapshot: the host eligibility (the owning module's own decision, called on host facts), the
// validator every reply passes through, and the deterministic assigners the Paper arms compare against the frontier model:
//   greedy  eligible bot nearest the project (at town first), then the most free bag room, then affinity, then name
//   random  a seeded uniform choice among the eligible (the placebo)
//   oracle  a scripted writer with FULL information, including each bot's next arrival (the headroom upper bound)
// The frontier arm's reply comes from scripts/overseer/caller.py and goes through the same validator. Nothing here does I/O
// except writeRoles (atomic rename, the file bots/src/roles.mjs reads).
//
// v1 JOBS: BUILD (the town's active shared project, builders_max at once) only. MAKE is not leased in v1 (the Paper scene
// stocks the whole bill, so make_material has nothing to make; its host eligibility needs readings only the bot has).
import fs from 'node:fs'
import path from 'node:path'

export const ASSIGN_V = 1
export const JOBS = Object.freeze(['BUILD'])
export const REASONS = Object.freeze(['build_progress', 'idle_capacity', 'continuity', 'rebalance', 'stall_break', 'nothing_to_do'])
export const ABSTAIN_WHY = Object.freeze(['nothing_to_do', 'no_change', 'safety_hold', 'budget_low'])
export const TTL_MIN = 5, TTL_MAX = 30
export const REFUSAL_HOLD_MS = 30 * 60 * 1000
export const REPLY_MAX_AGE_TICKS = 2

/**
 * HOST ELIGIBILITY for BUILD -> boolean. `buildOrder` is shop.mjs's own exported decision, called with the host's facts and
 * atTown = true (a next-visit lease is judged as if the bot were at town; the bot re-checks everything when it gets there).
 * Facts the host does not have (the bot's own cooldown, its walk probe) stay bot-side: state = {}. A host fact that is
 * unknown fails (a position older than 10 min, an unknown bag, an unreadable record).
 */
export function hostBuildEligible (b, project, { buildOrder, now = 0 } = {}) {
  if (!b || !project || typeof buildOrder !== 'function') return false
  if (!Number.isFinite(b.free_slots) || !Number.isFinite(b.hp) || !(now - (b.seen_at ?? -Infinity) <= 10 * 60 * 1000)) return false
  if ((b.flags ?? []).length) return false
  const r = buildOrder({ on: true, shared: true, atTown: true, holds: false, now, state: {}, record: project.record ?? null,
    complete: !!project.complete, slotsFree: project.slots_free_for?.[b.bot] ?? !!project.slots_free, health: b.hp, freeSlots: b.free_slots,
    planned: !!project.planned, stuckAt: project.stuck_at ?? null })
  return r.order?.skill === 'build_shop'
}

/** The `eligible` list per bot (the validator's filter: the model never sees an ineligible choice). Pure. */
export function eligibleOf (snapshot, opts) {
  const out = {}
  for (const b of snapshot.roster) {
    const refusedAt = snapshot.refused?.[b.bot]?.BUILD
    const held = Number.isFinite(refusedAt) && (opts.now - refusedAt) < REFUSAL_HOLD_MS
    out[b.bot] = !held && hostBuildEligible(b, snapshot.project, opts) ? ['BUILD'] : []
  }
  return out
}

/**
 * THE VALIDATOR -> { leases: [...kept], dropped: [{ lease, why }], abstain, invalid: why | null }. Pure.
 * reply: { gen, abstain, why, leases: [{ bot, job, ttl_min, reason, evidence }], unstaffed }.
 * Rules (3.4): the schema; gen names an acceptable snapshot (at most REPLY_MAX_AGE_TICKS old, no empty generation and no
 * record_gen change since); every bot exists and the job is in that bot's eligible list ON THE NEWEST FACTS; caps; at least
 * one FREE bot; one lease per bot.
 */
export function validate (reply, { snapshot, eligible, caps, nowGen, emptySince = -Infinity, recordGenChangedSince = -Infinity }) {
  const bad = why => ({ leases: [], dropped: [], abstain: false, invalid: why })
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return bad('not_object')
  if (!Number.isInteger(reply.gen)) return bad('gen_missing')
  if (reply.gen > nowGen) return bad('gen_future')
  if (nowGen - reply.gen > REPLY_MAX_AGE_TICKS) return bad('gen_stale')
  if (emptySince >= reply.gen || recordGenChangedSince > reply.gen) return bad('gen_superseded')
  if (reply.abstain === true) return { leases: [], dropped: [], abstain: true, invalid: ABSTAIN_WHY.includes(reply.why) ? null : 'abstain_why' }
  if (!Array.isArray(reply.leases)) return bad('leases_missing')
  const names = new Set(snapshot.roster.map(b => b.bot))
  const kept = [], dropped = []
  const count = { BUILD: 0 }
  for (const l of reply.leases) {
    const drop = why => dropped.push({ lease: l, why })
    if (!l || typeof l !== 'object') { drop('shape'); continue }
    if (!names.has(l.bot)) { drop('unknown_bot'); continue }
    if (!JOBS.includes(l.job)) { drop('unknown_job'); continue }
    if (!Number.isInteger(l.ttl_min) || l.ttl_min < TTL_MIN || l.ttl_min > TTL_MAX) { drop('ttl'); continue }
    if (!REASONS.includes(l.reason)) { drop('reason'); continue }
    if (kept.some(k => k.bot === l.bot)) { drop('second_lease'); continue }
    if (!(eligible[l.bot] ?? []).includes(l.job)) { drop('ineligible'); continue }
    if (count[l.job] >= (caps[l.job] ?? 0)) { drop('cap'); continue }
    if (kept.length >= (caps.leased_max ?? Infinity)) { drop('leased_max'); continue }
    if (kept.length + 1 >= names.size) { drop('no_free_bot'); continue }   // at least one FREE bot per town
    count[l.job]++
    kept.push({ bot: l.bot, job: l.job, ttl_min: l.ttl_min, reason: l.reason })
  }
  return { leases: kept, dropped, abstain: false, invalid: null }
}

// ---- the deterministic assigners (each returns a reply in the frontier's own shape) ------------------------------------------

const byGreedy = (a, b) => (Number(b.at_town) - Number(a.at_town)) || (a.dist - b.dist) || (b.free_slots - a.free_slots) ||
  ((b.affinity?.BUILD ?? 0) - (a.affinity?.BUILD ?? 0)) || a.bot.localeCompare(b.bot)

/** GREEDY: the eligible bots nearest the project, up to the BUILD cap. Pure. */
export function greedyReply (snapshot, eligible, caps) {
  const pool = snapshot.roster.filter(b => (eligible[b.bot] ?? []).includes('BUILD')).sort(byGreedy)
  const n = Math.min(caps.BUILD ?? 0, caps.leased_max ?? Infinity, Math.max(0, snapshot.roster.length - 1))
  return { gen: snapshot.gen, abstain: false, leases: pool.slice(0, n).map(b => ({ bot: b.bot, job: 'BUILD', ttl_min: TTL_MAX, reason: 'build_progress' })), unstaffed: [] }
}

/** A seeded PRNG (mulberry32) -> () => [0, 1). */
export function rng (seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** RANDOM: a uniform choice among the eligible, the same count greedy would lease. Pure given `rand`. */
export function randomReply (snapshot, eligible, caps, rand) {
  const pool = snapshot.roster.filter(b => (eligible[b.bot] ?? []).includes('BUILD')).map(b => b.bot)
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
  const n = Math.min(caps.BUILD ?? 0, caps.leased_max ?? Infinity, Math.max(0, snapshot.roster.length - 1))
  return { gen: snapshot.gen, abstain: false, leases: pool.slice(0, n).map(bot => ({ bot, job: 'BUILD', ttl_min: TTL_MAX, reason: 'build_progress' })), unstaffed: [] }
}

/** ORACLE: full information -- the eligible bots whose next arrival (0 = at town now) is soonest, TTL covering that arrival.
 *  `nextArrivalMs` = { bot: ms from now }. Pure. */
export function oracleReply (snapshot, eligible, caps, nextArrivalMs) {
  const pool = snapshot.roster.filter(b => (eligible[b.bot] ?? []).includes('BUILD'))
    .map(b => ({ b, eta: b.at_town ? 0 : (nextArrivalMs[b.bot] ?? Infinity) })).filter(x => Number.isFinite(x.eta))
    .sort((x, y) => (x.eta - y.eta) || byGreedy(x.b, y.b))
  const n = Math.min(caps.BUILD ?? 0, caps.leased_max ?? Infinity, Math.max(0, snapshot.roster.length - 1))
  return { gen: snapshot.gen, abstain: false,
    leases: pool.slice(0, n).map(({ b, eta }) => ({ bot: b.bot, job: 'BUILD', ttl_min: Math.max(TTL_MIN, Math.min(TTL_MAX, Math.ceil(eta / 60000) + 10)), reason: 'build_progress' })), unstaffed: [] }
}

// ---- the lease file ------------------------------------------------------------------------------------------------------------

/** The lease file body for validated leases -> doc. Each lease carries its binding (3.5) and its expires_at, which a re-issue
 *  keeps (`prior`: { bot: expires_at } of the leases being re-issued). Pure. */
export function rolesDoc ({ leases, gen, now, world, home, arm, project, snapshotGen, prior = {} }) {
  return { v: 1, gen, issued_at: now, world, home, arm,
    leases: leases.map(l => ({ bot: l.bot, job: l.job, expires_at: prior[l.bot] ?? (now + l.ttl_min * 60000), project: project.plot ?? null,
      record_gen: project.record_gen ?? null, segment: null, snapshot_gen: snapshotGen, reason: l.reason })) }
}

/** Write the file atomically (temp + rename) -> path. */
export function writeRoles (dir, home, doc) {
  fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, `roles-${home}.json`)
  const tmp = `${f}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(doc))
  fs.renameSync(tmp, f)
  return f
}

/**
 * THE 5-MINUTE TICK's re-validation (3.2): the newest accepted reply's leases, re-checked on the fresh eligibility; those that
 * still pass keep their ORIGINAL expiry; expired or ineligible ones drop. Pure -> [{ bot, job, ttl_min, reason, expires_at }].
 */
export function revalidate (accepted, { eligible, now }) {
  return (accepted ?? []).filter(l => l.expires_at > now && (eligible[l.bot] ?? []).includes(l.job))
}

/** The frontier's cadence (3.8): a token bucket per town -- one token per 30 min, at most 2 held, at least 10 min between calls,
 *  at most 48 calls per town-day; an event may spend a held token early, never create one. Pure. */
export function bucketStep (b = { tokens: 1, last: -Infinity, refillAt: null, calls: 0, day: null }, { now, event = false, day }) {
  const s = { ...b }
  if (!Number.isFinite(s.refillAt) || s.refillAt <= 0) s.refillAt = now
  if (s.day !== day) { s.day = day; s.calls = 0 }
  while (now >= s.refillAt + 30 * 60000) { s.tokens = Math.min(2, s.tokens + 1); s.refillAt += 30 * 60000 }
  const due = s.tokens > 0 && now - s.last >= 10 * 60000 && s.calls < 48 && (event || now - s.last >= 30 * 60000)
  if (due) { s.tokens--; s.last = now; s.calls++ }
  return { bucket: s, call: due }
}
