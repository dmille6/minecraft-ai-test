// THE TOWN COBBLE CAP (stonecap-01; OWNER 10-04 "keep 256 per town, bank only when it frees a slot"; the owner delegated the
// cap's design 10-07 to the operator and Codex). Codex's rule, built here:
//   - count cobble across the town's designated storage from RECONCILED chest observations (a bot that opens a town
//     container records what the server's window holds, and records it again after its own transfer), with RESERVATIONS
//     for concurrent deposits -- never a mayor's estimate;
//   - admit only WHOLE stacks that keep the town at or below 256, while the bot keeps its own 64 cobble + deepslate
//     (bankable.mjs COBBLE_RESERVE);
//   - UNKNOWN stock (a town container with no fresh observation) is reconciled before depositing: nothing is admitted
//     until every container in town has one -- "currently below 256" on a partial count permits overshoot;
//   - at the ceiling banking cannot relieve bag pressure: the surplus stays in the bag, or (only where the junk well is
//     part of the build) goes down the well. Never a new chest, never a toss.
//
// "Cobble" here is cobblestone + cobbled_deepslate, as everywhere in the cobble rule.
//
// THE JOURNAL (round 3; Codex r2 P1: a lock with a stale-break can always lose mutual exclusion to a paused holder or to
// two breakers): no lock at all. One APPEND-ONLY file per town in the pool's state dir (<townKey>.cobble.jsonl). Every
// bot appends whole records in one append (O_APPEND: the kernel orders the appends to one file and never interleaves
// them), and every bot reads the SAME order back. The town's state is a FOLD of that order, identical for every reader:
//   obs    a container's cobble as an open window showed it, with its CAPTURE time; per container the latest capture
//          wins, and on equal capture times the LARGER count (Codex r2 P1: an ambiguous order resolves conservatively)
//   claim  "may this whole stack go into container k?" -- decided IN THE FOLD at the claim's own place in the order,
//          against everything before it, earlier claims included. Two bots racing for the last room both append; the one
//          the kernel ordered first is admitted, the other is not, and both read the same answer back. The claim carries
//          the claimant's scan (keys, coverage, gone), so its decision depends on nothing outside the journal.
//   rel    the claimant's release, written in ONE append after its post-transfer count (obs first, then rel): a reader
//          never sees the release without the count that includes the transfer
//   scan   the town's container keys from a covered scan, for the plan's view from away from home
// A CLAIM NEVER RELEASED (a crash) stops being a reservation after RES_TTL_MS and instead makes its container UNKNOWN until
// a count CAPTURED at least RES_TTL_MS after the claim. By then the claim cannot move anything any more: a transfer may only
// START within TRANSFER_WINDOW_MS of its claim (Codex r2 P1: a count taken between a claim and its transfer is not a
// reconciliation). Isolated pools keep one state dir per bot, so their bots do not see each other's claims: the read
// reports it, and the canary never draws an isolated pool.

import fs from 'node:fs'
import path from 'node:path'

export const TOWN_COBBLE_CAP = 256
/** An observation older than this is no longer a count: the container is unknown again. */
export const OBS_TTL_MS = 6 * 60 * 60 * 1000
/** A claim stops being a reservation after this; never released, it forces a recount of its container. */
export const RES_TTL_MS = 3 * 60 * 1000
/** A claim's transfer must START within this of its claim (30 s before RES_TTL_MS: a click in flight lands well inside). */
export const TRANSFER_WINDOW_MS = RES_TTL_MS - 30_000
/** The journal's tail that is read: far more than OBS_TTL_MS of records at any fleet's rate (~100 KB/day per town). */
const TAIL_BYTES = 8 * 1024 * 1024
const COBBLE = new Set(['cobblestone', 'cobbled_deepslate'])
export const isCobbleName = n => COBBLE.has(n)

/** cobble in a list of items (a container window's containerItems(), or a bag). */
export function cobbleIn (items = []) {
  let n = 0
  for (const it of (Array.isArray(items) ? items : [])) if (it?.name && COBBLE.has(it.name)) n += Number(it.count) || 0
  return n
}

/**
 * THE TOWN'S COBBLE, AS FAR AS ANYONE KNOWS -> { lb, complete, unknown, reserved, mine }. Pure, over a folded state
 * ({ obs: { k: { n, at } }, claims: { id: { n, k, at, bot, decision, released } } }).
 *   lb         sum of FRESH counts of containers still in town (a lower bound: an uncounted one adds >= 0)
 *   complete   the scan covered the whole town (`coverage`) AND every container in `keys` has a fresh count
 *   unknown    the keys without one -- including every container with an EXPIRED, NEVER-RELEASED claim and no count
 *              captured at least RES_TTL_MS after that claim (a crash between a transfer and its count forces a recount)
 *   reserved   EVERY live admitted claim not yet released, this bot's own included (a batch's earlier stacks count)
 * `gone`: keys whose block was read and is no longer a container -- their counts no longer count.
 */
export function townCobble (state = {}, keys = [], now = Date.now(), { me = null, coverage = true, gone = [] } = {}) {
  const obs = state?.obs ?? {}
  const claims = state?.claims ?? {}
  const goneSet = new Set(Array.isArray(gone) ? gone : [])
  const dirty = new Set()
  let reserved = 0, mine = 0
  for (const c of Object.values(claims)) {
    if (!c?.k || !Number.isFinite(c.at) || c.released) continue
    if (now - c.at < RES_TTL_MS) {
      if (c.decision === 'bank') { reserved += Number(c.n) || 0; if (me != null && c.bot === me) mine += Number(c.n) || 0 }
    } else if (!(obs[c.k] && obs[c.k].at >= c.at + RES_TTL_MS)) dirty.add(c.k)   // never released, never re-counted after
  }
  const fresh = k => !goneSet.has(k) && !dirty.has(k) && obs[k] && Number.isFinite(obs[k].at) && now - obs[k].at < OBS_TTL_MS
  let lb = 0
  for (const k of Object.keys(obs)) if (fresh(k)) lb += Math.max(0, Number(obs[k].n) || 0)
  const all = [...new Set([...(Array.isArray(keys) ? keys : []), ...dirty])].filter(k => !goneSet.has(k))
  const unknown = all.filter(k => !fresh(k))
  return { lb, complete: !!coverage && all.length > 0 && unknown.length === 0, unknown, reserved, mine }
}

/**
 * MAY THIS WHOLE STACK GO INTO THE TOWN? -> 'bank' | 'at_cap' | 'unknown'. Pure.
 *   at_cap   the town is PROVEN at the cap: what is known plus what others are bringing already reaches it, or this stack
 *            would carry a complete count past it. (A lower bound at or over the cap needs no completeness.)
 *   unknown  a container has no fresh count and the known part is below the cap: reconcile first.
 */
export function cobbleAdmit (view, stack, cap = TOWN_COBBLE_CAP) {
  const base = (Number(view?.lb) || 0) + (Number(view?.reserved) || 0)
  if (base >= cap) return 'at_cap'
  if (!view?.complete) return 'unknown'
  return base + (Number(stack) || 0) <= cap ? 'bank' : 'at_cap'
}

/**
 * THE STACKS THAT GO, IN ORDER -> { bank: [stacks], refused: { at_cap, unknown } }. Pure. `stacks` are counts (already
 * whole stacks above the bot's own reserve, smallest first); each admitted one is charged before the next is judged.
 */
export function admitStacks (view, stacks = [], cap = TOWN_COBBLE_CAP) {
  const v = { ...view }
  const bank = [], refused = { at_cap: 0, unknown: 0 }
  for (const s of stacks) {
    const d = cobbleAdmit(v, s, cap)
    if (d === 'bank') { bank.push(s); v.lb = (Number(v.lb) || 0) + s } else refused[d]++
  }
  return { bank, refused }
}

// ---- the journal -------------------------------------------------------------------------------------------------

const journalFile = (dir, key) => path.join(dir, `${key}.cobble.jsonl`)

/** Append records in ONE write -> true when written. Each carries the world it was written in. */
export function appendJournal (dir, key, world, recs = []) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(journalFile(dir, key), recs.map(r => JSON.stringify({ ...r, w: world ?? null })).join('\n') + '\n')
    return true
  } catch { return false }
}

/** The journal's complete records, in order, for this world (another world's records are not this town's). */
export function readJournal (dir, key, world = null) {
  try {
    const f = journalFile(dir, key)
    const size = fs.statSync(f).size
    const start = Math.max(0, size - TAIL_BYTES)
    const buf = Buffer.alloc(size - start)
    const fd = fs.openSync(f, 'r')
    try { fs.readSync(fd, buf, 0, buf.length, start) } finally { fs.closeSync(fd) }
    const lines = buf.toString('utf8').split('\n')
    if (start > 0) lines.shift()          // the tail began inside a record
    lines.pop()                           // after the last newline: empty, or a record still being written
    const out = []
    for (const line of lines) {
      try { const r = JSON.parse(line); if ((r?.w ?? null) === (world ?? null)) out.push(r) } catch { /* a torn line */ }
    }
    return out
  } catch { return [] }
}

/**
 * THE FOLD -> { state, decision, view }. Pure. With `upto` (a claim id) it stops AT that claim and returns the claim's
 * decision and the view it was judged on; every reader computes the same decision for the same claim.
 */
export function foldJournal (records = [], { upto = null } = {}) {
  const state = { obs: {}, claims: {}, scan: null }
  for (const r of (Array.isArray(records) ? records : [])) {
    if (r?.t === 'obs' && r.k && Number.isFinite(r.cap)) {
      const n = Math.max(0, Number(r.n) || 0)
      const o = state.obs[r.k]
      if (!o || r.cap > o.at || (r.cap === o.at && n > o.n)) state.obs[r.k] = { n, at: r.cap }
    } else if (r?.t === 'claim' && r.id && r.k && Number.isFinite(r.at)) {
      const view = townCobble(state, r.keys, r.at, { me: r.bot ?? null, coverage: !!r.coverage, gone: r.gone ?? [] })
      const decision = cobbleAdmit(view, r.n)
      state.claims[r.id] = { n: Number(r.n) || 0, k: r.k, at: r.at, bot: r.bot ?? null, decision, released: false }
      if (upto != null && r.id === upto) return { state, decision, view }
    } else if (r?.t === 'rel' && Array.isArray(r.ids)) {
      for (const id of r.ids) if (state.claims[id]) state.claims[id].released = true
    } else if (r?.t === 'scan' && Array.isArray(r.keys) && Number.isFinite(r.at)) {
      if (!state.scan || r.at >= state.scan.at) state.scan = { keys: r.keys, at: r.at }
    }
  }
  return { state, decision: null, view: null }
}

/** The town's folded state now. */
export const readTown = (dir, key, world = null) => foldJournal(readJournal(dir, key, world)).state

/**
 * CLAIM ONE WHOLE STACK for container `k` -> { decision, view, at }. Appends the claim, reads the journal back and takes
 * the decision the fold gives the claim at its own place. A refused or unreadable claim is released at once (it never
 * moves anything). No append -> 'unknown'.
 */
export function claimStack (dir, key, world, { id, n, k, bot = null, keys = [], coverage = false, gone = [], at = Date.now() }) {
  if (!appendJournal(dir, key, world, [{ t: 'claim', id, n, k, at, bot, keys, coverage: !!coverage, gone }])) return { decision: 'unknown', view: null, at }
  const r = foldJournal(readJournal(dir, key, world), { upto: id })
  const decision = r.decision ?? 'unknown'
  if (decision !== 'bank') appendJournal(dir, key, world, [{ t: 'rel', ids: [id], at: Date.now() }])
  return { decision, view: r.view, at }
}

/**
 * A COUNT (and any releases) in ONE write: the observation first, then the release -- a reader never sees a release
 * without the count that includes its transfer. `obs` null: releases only (nothing was moved).
 */
export function recordCount (dir, key, world, { obs = null, release = [], scan = null } = {}) {
  const recs = []
  if (obs) recs.push({ t: 'obs', k: obs.k, n: obs.n, cap: obs.cap })
  if (scan) recs.push({ t: 'scan', keys: scan.keys, at: scan.at })
  if (release.length) recs.push({ t: 'rel', ids: release, at: Date.now() })
  return recs.length ? appendJournal(dir, key, world, recs) : true
}
