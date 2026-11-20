// WELLFIX-01SHOW: TURNS AT THE JUNK WELL -- one thrower at a time, the others in line, nobody refused forever.
//
// LIVE (showcase 11-20 04:40-08:09Z, docs/reports/gather-diag-2026-11-20.md): 186 of 293 well refusals were `player_near`
// ("wait for <bot> to move off the town junk well"), the blockers other bots (Alpha 30, Juno 19, Nova 19, Gale 17). Every
// bot that wanted the well walked to it, found another body within 5 (well.mjs wellAdmission), and turned away; the next
// one came, and the first came back. No order, so no turn: the rule that keeps the opening safe became a dead end.
//
// THE TURN:
//   * THE LEASE: the thrower holds a lease on the cap's cell for its visit (furnacelease.mjs generation files, the same
//     O_EXCL shape the furnace, the drain and the mats draw already share; key = the cap's x_y_z, what = 'well'). TTL =
//     the skill's whole budget (dispose_well maxMs 120 s) + the hard-stop grace: a crashed holder frees it by itself.
//   * THE LINE: a bot that finds the well taken leaves a TICKET (`<dir>/well-queue/<cap>/<bot>.json`: its first ask and its
//     last). A ticket holds others back only while its bot is waiting (refreshed within WELL_PRESENT_MS); its first ask is
//     kept WELL_TICKET_TTL_MS, so a bot that went to do something else and comes back is ahead again. When the lease is
//     free, only the OLDEST waiting ticket may take it (no ticket of its own counts as newest).
//   * THE REMEDY, PERFORMED: the bot WAITS for its turn, polling every WELL_POLL_MS, up to WELL_WAIT_MS -- for the lease,
//     for its place in line, and for the admission's 5 blocks to clear; a waiter standing within those 5 steps off first
//     (skills.mjs wellStepOff), and so does a thrower whose turn ends with a bot in line. Past that it returns `no_effect` (a free
//     skip: well.mjs wellOrderOutcome charges nothing) with its place kept, and the order is asked again at its cooldown
//     (the room trip at ROOM_WELL_NEAR_RETRY_MS). Nothing is printed that the bot must decide to do.
//
// FAIL-OPEN, as the furnace lease: an unreadable directory gives no line and an `unleased` lease -- the well then works
// exactly as on the base. WELLTURN=off: no lease, no line, no wait.
import fs from 'node:fs'
import path from 'node:path'

/** dispose_well's maxMs (skills.mjs) + the hard-stop grace. */
export const WELL_LEASE_TTL_MS = 150_000
/** A ticket's life after its last refresh: a bot that comes back within it keeps its place. */
export const WELL_TICKET_TTL_MS = 180_000
/** The longest a bot waits in one dispose_well for its turn (the walk, 25 s, and the visit, 45 s, still fit in 120 s). */
export const WELL_WAIT_MS = 12_000
/** The wait as configured (WELLTURN_WAIT_MS; a test's short clock), never above WELL_WAIT_MS. */
export const wellWaitMs = (env = process.env) => { const v = Number(env.WELLTURN_WAIT_MS); return Number.isFinite(v) && v >= 0 ? Math.min(v, WELL_WAIT_MS) : WELL_WAIT_MS }
export const WELL_POLL_MS = 1_000
/** A ticket BLOCKS others only while its bot is here waiting (refreshed within this); its place (`at`) is kept WELL_TICKET_TTL_MS. */
export const WELL_PRESENT_MS = 4 * WELL_POLL_MS

export const wellTurnOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env.WELLTURN ?? 'on').toLowerCase())
export const capKey = cap => `${Math.floor(cap.x)}_${Math.floor(cap.y)}_${Math.floor(cap.z)}`

/**
 * WHOSE TURN IS IT? -> { go, why, who, place }. Pure.
 *   lease    { live, holder } (furnacelease.mjs furnaceLeaseState) of the cap
 *   tickets  [{ who, at, seen }] read from the line (any order; stale ones are dropped here)
 *   me       this bot's name
 * go=false why='busy'   another bot holds the lease (`who`);
 * go=false why='queued' the lease is free but an older live ticket is ahead (`who` = the head);
 * go=true               this bot may take the lease. `place` is this bot's 1-based place in line (1 when it may go).
 */
export function wellTurn ({ lease = null, tickets = [], me, now = Date.now(), present = WELL_PRESENT_MS } = {}) {
  // Claude r1 BLOCKER 1: only a bot WAITING NOW holds others back (a ticket left by a bot that went to work elsewhere blocks
  // nobody); a bot that comes back within its ticket's life keeps its first ask, so it is ahead again once it is here
  const live = (Array.isArray(tickets) ? tickets : []).filter(t => t && t.who && Number.isFinite(Number(t.at)) && (t.who === me || now - Number(t.seen ?? t.at) < present))
  // first ask first; a tie by name (deterministic on every bot)
  live.sort((a, b) => Number(a.at) - Number(b.at) || String(a.who).localeCompare(String(b.who)))
  const mine = live.findIndex(t => t.who === me)
  const place = mine >= 0 ? mine + 1 : live.length + 1
  if (lease?.live && lease.holder && lease.holder !== me) return { go: false, why: 'busy', who: lease.holder, place }
  const head = live.find(t => t.who !== me)
  if (head && (mine < 0 || live.indexOf(head) < mine)) return { go: false, why: 'queued', who: head.who, place }
  return { go: true, why: null, who: null, place: 1 }
}

const qdir = (dir, cap) => path.join(dir, 'well-queue', capKey(cap))
const safe = n => String(n).replace(/[^A-Za-z0-9_.-]/g, '_')

/** The line for this cap -> [{ who, at, seen }]. Never throws ([] when unreadable). */
export function readTickets (dir, cap) {
  const out = []
  try {
    for (const f of fs.readdirSync(qdir(dir, cap))) {
      if (!f.endsWith('.json')) continue
      try { const r = JSON.parse(fs.readFileSync(path.join(qdir(dir, cap), f), 'utf8')); if (r && r.who) out.push(r) } catch { /* torn: skipped */ }
    }
  } catch { /* no line */ }
  return out
}
/** Join or refresh this bot's ticket: its first ask is kept while the ticket is live. Never throws. */
export function touchTicket (dir, cap, me, now = Date.now(), ttl = WELL_TICKET_TTL_MS) {
  try {
    fs.mkdirSync(qdir(dir, cap), { recursive: true })
    const f = path.join(qdir(dir, cap), `${safe(me)}.json`)
    let at = now
    try { const r = JSON.parse(fs.readFileSync(f, 'utf8')); if (Number.isFinite(Number(r?.at)) && now - Number(r.seen ?? r.at) < ttl) at = Number(r.at) } catch { /* new */ }
    const tmp = `${f}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ who: me, at, seen: now }))
    fs.renameSync(tmp, f)
  } catch { /* fail open */ }
}
/** Leave the line (after a turn). Never throws. */
export function dropTicket (dir, cap, me) {
  try { fs.unlinkSync(path.join(qdir(dir, cap), `${safe(me)}.json`)) } catch { /* not in line */ }
}

/** The refusal's words: who, where this bot stands in line, and what happens next (no decision left to the bot). */
export function wellTurnDetail ({ why, who, place, waitedMs, near = null }) {
  const s = Math.round((Number(waitedMs) || 0) / 1000)
  const what = why === 'busy' ? `wait for ${who} to finish its turn at the town junk well` : why === 'queued' ? `wait for ${who}, ahead in line for the town junk well`
    : `wait for ${near?.who ?? who} to move off the town junk well (${Number(near?.dist ?? 0).toFixed(1)} blocks): it opens only with nobody within 5`
  return `${what}; waited ${s} s here. This bot keeps place ${place} in line for ${Math.round(WELL_TICKET_TTL_MS / 60000)} min and the order is asked again at its cooldown`
}
