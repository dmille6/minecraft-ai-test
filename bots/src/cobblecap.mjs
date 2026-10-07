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
// THE JOURNAL (Codex r2 P1: a lock with a stale-break can always lose mutual exclusion): no lock. One APPEND-ONLY file per
// town in the pool's state dir (<townKey>.cobble.jsonl). Every record is ONE line, written by one append that begins with a
// newline (Codex r3 P1: a fragment left by a writer that died mid-line is closed off and never swallows the next record), and
// every bot folds the WHOLE history -- from a checkpoint of the fold's own state, never a moving tail (Codex r3 P1: a tail
// could drop the count an earlier decision rested on); more than JOURNAL_MAX_BYTES to fold fails CLOSED (nothing is
// admitted). The town's state is a FOLD of that order, identical for every reader:
//   claim  "may this whole stack go into container k?" -- decided IN THE FOLD at the claim's own place in the order,
//          against everything before it. Two bots racing for the last room both append; the one the kernel ordered first
//          is admitted, the other is not, and both read the same answer back. The claim carries the claimant's scan (keys,
//          coverage, gone) and its process instance.
//   cnt    a container's cobble as an open window showed it, with its CAPTURE time, and -- in the SAME line -- the releases
//          of the claims this count includes (the post-transfer count). Per container the latest capture wins, a tie takes
//          the larger count; a count that RELEASES a claim on that container always replaces every count appended before
//          it, whatever the clocks say (Codex r3 P1: a release must be represented by its own count, even after a clock step).
//   rel    a release with nothing moved (a refused claim, released at once)
//   void   a claim abandoned by a DEAD instance, written by that bot's next instance (or a claim of this instance left over
//          from an earlier skill run): it stops being a reservation and its container is UNKNOWN until a count appended
//          after the void and captured after it. AN ADMITTED CLAIM IS NEVER EXPIRED BY TIME (Codex r3 P1: a paused transfer
//          cannot be fenced by a clock): it stays reserved until its own release or a void; only the bot's own next instance
//          can void it, and by then the instance that could still transfer is gone.
//   scan   the town's container keys from a covered scan, for the plan's view from away from home
// Isolated pools keep one state dir per bot, so their bots do not see each other's claims: the read reports it, and the
// canary never draws an isolated pool.

import fs from 'node:fs'
import path from 'node:path'

export const TOWN_COBBLE_CAP = 256
/** An observation older than this is no longer a count: the container is unknown again. */
export const OBS_TTL_MS = 6 * 60 * 60 * 1000
/** A journal larger than this is not replayed: the town is UNKNOWN (fail closed). ~100 KB/day per town at fleet rates. */
export const JOURNAL_MAX_BYTES = 32 * 1024 * 1024
/** This process: a claim records it, so the bot's NEXT process can tell its predecessor's claims from its own. */
export const INSTANCE = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
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
 * ({ obs: { k: { n, at, seq } }, claims: { id: { n, k, at, bot, decision, state, voidAt, voidSeq } } }).
 *   lb         sum of FRESH counts of containers still in town (a lower bound: an uncounted one adds >= 0)
 *   complete   the scan covered the whole town (`coverage`) AND every container in `keys` has a fresh count
 *   unknown    the keys without one -- including every container of a VOIDED admitted claim with no count appended and
 *              captured after the void (the abandoned transfer may or may not have landed: recount)
 *   reserved   EVERY admitted claim still live (neither released nor voided), this bot's own included, however old
 * `gone`: keys whose block was read and is no longer a container -- their counts no longer count.
 */
export function townCobble (state = {}, keys = [], now = Date.now(), { me = null, coverage = true, gone = [] } = {}) {
  const obs = state?.obs ?? {}
  const claims = state?.claims ?? {}
  const goneSet = new Set(Array.isArray(gone) ? gone : [])
  const dirty = new Set()
  let reserved = 0, mine = 0
  for (const c of Object.values(claims)) {
    if (!c?.k || c.decision !== 'bank') continue
    if (c.state === 'live') { reserved += Number(c.n) || 0; if (me != null && c.bot === me) mine += Number(c.n) || 0 }
    else if (c.state === 'void' && !(obs[c.k] && obs[c.k].seq > c.voidSeq && obs[c.k].at >= c.voidAt)) dirty.add(c.k)
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
//
// THE COST IS BOUNDED (Claude r3 P2: a fold over every claim ever written, replayed in full on every read, grew to 2.8 s
// per read at 8 MB). The fold keeps only what can still matter -- the latest count per container, the admitted claims
// still live, the voided ones not yet recounted, the last scan -- so each record costs O(containers + live claims). And a
// CHECKPOINT (<townKey>.cobble.ckpt.json) holds the fold's state at a record boundary of the journal: a reader folds only
// the bytes after it. The state at an offset is a pure function of the journal's prefix, so any reader may write it (an
// atomic rename; the last writer wins and every version is correct). A checkpoint for another file (inode), another world,
// or past the file's end is ignored.

const journalFile = (dir, key) => path.join(dir, `${key}.cobble.jsonl`)
const ckptFile = (dir, key) => path.join(dir, `${key}.cobble.ckpt.json`)
/** A reader that folded at least this many bytes past the checkpoint writes a new one. */
export const CKPT_EVERY_BYTES = 256 * 1024

/** Append ONE record as one line in one write, newline FIRST (a dead writer's fragment is closed off) -> true when written. */
export function appendJournal (dir, key, world, rec) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(journalFile(dir, key), '\n' + JSON.stringify({ ...rec, w: world ?? null }) + '\n')
    return true
  } catch { return false }
}

const emptyState = () => ({ obs: {}, claims: {}, scan: null })

/**
 * THE FOLD -> { state, decision, view, seq }. Pure. Continues from `state`/`seq` (a checkpoint's) when given, without
 * changing them. With `upto` (a claim id) it stops AT that claim and returns the claim's decision and the view it was
 * judged on; every reader computes the same decision for the same claim. Refused claims are not kept; released ones are
 * dropped; a voided one is dropped once its container is recounted after the void.
 */
export function foldJournal (records = [], { upto = null, state: from = null, seq: seq0 = 0 } = {}) {
  const state = from ? JSON.parse(JSON.stringify(from)) : emptyState()
  const release = ids => { for (const id of (Array.isArray(ids) ? ids : [])) if (state.claims[id]?.state === 'live') delete state.claims[id] }
  let seq = Number(seq0) || 0
  for (const r of (Array.isArray(records) ? records : [])) {
    seq++
    const t = r?.t
    if ((t === 'obs' || t === 'cnt') && r.k != null && Number.isFinite(r.cap)) {
      const n = Math.max(0, Number(r.n) || 0)
      const o = state.obs[r.k]
      // a count that releases a live claim on this very container was taken AFTER that claim's transfer: it replaces every
      // earlier-appended count whatever the clocks say; otherwise the latest capture wins, a tie the larger count
      const releasing = t === 'cnt' && (r.ids ?? []).some(id => state.claims[id]?.state === 'live' && state.claims[id]?.k === r.k)
      if (!o || releasing || r.cap > o.at || (r.cap === o.at && n > o.n)) {
        state.obs[r.k] = { n, at: r.cap, seq }
        for (const [id, c] of Object.entries(state.claims)) if (c.state === 'void' && c.k === r.k && r.cap >= c.voidAt) delete state.claims[id]   // recounted
      }
    }
    if (t === 'cnt' || t === 'rel') release(r.ids)
    else if (t === 'claim' && r.id && r.k && Number.isFinite(r.at)) {
      const view = townCobble(state, r.keys, r.at, { me: r.bot ?? null, coverage: !!r.coverage, gone: r.gone ?? [] })
      const decision = cobbleAdmit(view, r.n)
      if (decision === 'bank') state.claims[r.id] = { n: Number(r.n) || 0, k: r.k, at: r.at, bot: r.bot ?? null, inst: r.inst ?? null, decision, state: 'live', voidAt: null, voidSeq: null }
      if (upto != null && r.id === upto) return { state, decision, view, seq }
    } else if (t === 'void') {
      for (const id of (r.ids ?? [])) { const c = state.claims[id]; if (c && c.state === 'live') { c.state = 'void'; c.voidAt = Number(r.at) || 0; c.voidSeq = seq } }
    }
    const sc = t === 'scan' ? r : t === 'cnt' ? r.scan : null
    if (Array.isArray(sc?.keys) && Number.isFinite(sc.at) && (!state.scan || sc.at >= state.scan.at)) state.scan = { keys: sc.keys, at: sc.at }
  }
  return { state, decision: null, view: null, seq }
}

/**
 * THE TOWN'S HISTORY TO FOLD -> { base, seq, records, end, ino } or null (cannot be replayed: the town is UNKNOWN). `base`
 * is a checkpoint's state (null: from the start); `records` the complete lines after it, for this world; `end` the byte
 * offset after the last complete line. A checkpoint past `maxOffset` is not used (a claimant needs its own claim in the
 * records it folds). More than maxBytes to fold -> null (fail closed).
 */
export function loadJournal (dir, key, world = null, { maxBytes = JOURNAL_MAX_BYTES, maxOffset = Infinity, checkpoint = true } = {}) {
  const f = journalFile(dir, key)
  let st
  try { st = fs.statSync(f) } catch (e) { return e?.code === 'ENOENT' ? { base: null, seq: 0, records: [], end: 0, ino: null } : null }
  let base = null
  if (checkpoint) {
    try {
      const c = JSON.parse(fs.readFileSync(ckptFile(dir, key), 'utf8'))
      if (c?.v === 1 && c.ino === st.ino && (c.world ?? null) === (world ?? null) && Number.isInteger(c.offset) && c.offset <= st.size && c.offset <= maxOffset) base = c
    } catch { /* none, or torn: from the start */ }
  }
  const from = base ? base.offset : 0
  if (st.size - from > maxBytes) return null
  let buf
  try {
    const fd = fs.openSync(f, 'r')
    try { buf = Buffer.alloc(st.size - from); fs.readSync(fd, buf, 0, buf.length, from) } finally { fs.closeSync(fd) }
  } catch { return null }
  const last = buf.lastIndexOf(10)                      // the last newline: what follows is a record still being written
  const records = []
  if (last >= 0) {
    for (const line of buf.subarray(0, last).toString('utf8').split('\n')) {
      if (!line) continue
      try { const r = JSON.parse(line); if ((r?.w ?? null) === (world ?? null)) records.push(r) } catch { /* a dead writer's fragment */ }
    }
  }
  return { base: base?.state ?? null, seq: base?.seq ?? 0, records, end: from + last + 1, ino: st.ino, from }
}

/** The journal's complete records for this world, from the start (no checkpoint) -> [records] or null. Tests and reads. */
export function readJournal (dir, key, world = null, opts = {}) {
  const j = loadJournal(dir, key, world, { ...opts, checkpoint: false })
  return j ? j.records : null
}

/**
 * The town's folded state now, or null when the journal cannot be replayed (the town is then UNKNOWN). Writes a new
 * checkpoint when it folded at least `ckptEvery` bytes past the old one. `stats` (optional) receives what was folded.
 */
export function readTown (dir, key, world = null, { ckptEvery = CKPT_EVERY_BYTES, stats = null, ...opts } = {}) {
  const j = loadJournal(dir, key, world, opts)
  if (!j) return null
  const r = foldJournal(j.records, { state: j.base, seq: j.seq })
  if (stats) Object.assign(stats, { folded: j.records.length, from: j.from ?? 0, end: j.end })
  if (j.ino != null && j.end - (j.from ?? 0) >= ckptEvery) {
    try {
      const tmp = `${ckptFile(dir, key)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, ino: j.ino, world: world ?? null, offset: j.end, seq: r.seq, state: r.state }))
      fs.renameSync(tmp, ckptFile(dir, key))
    } catch { /* the next reader writes it */ }
  }
  return r.state
}

/**
 * CLAIM ONE WHOLE STACK for container `k` -> { decision, view, at }. Appends the claim, folds the journal (from a checkpoint
 * that ends before the claim) and takes the decision the fold gives the claim at its own place. A refused or unreadable
 * claim is released at once (it never moves anything). No append, or a journal that cannot be replayed -> 'unknown'.
 */
export function claimStack (dir, key, world, { id, n, k, bot = null, keys = [], coverage = false, gone = [], at = Date.now() }, opts = {}) {
  let before = 0
  try { before = fs.statSync(journalFile(dir, key)).size } catch { before = 0 }
  if (!appendJournal(dir, key, world, { t: 'claim', id, n, k, at, bot, inst: INSTANCE, keys, coverage: !!coverage, gone })) return { decision: 'unknown', view: null, at }
  const j = loadJournal(dir, key, world, { ...opts, maxOffset: before })
  const r = j ? foldJournal(j.records, { upto: id, state: j.base, seq: j.seq }) : { decision: null, view: null }
  const decision = r.decision ?? 'unknown'
  if (decision !== 'bank') appendJournal(dir, key, world, { t: 'rel', ids: [id], at: Date.now() })
  return { decision, view: r.view, at }
}

/**
 * A COUNT and its releases in ONE line: the container's cobble captured at `obs.cap`, and the claims it includes. `obs`
 * null: releases only. -> true when written.
 */
export function recordCount (dir, key, world, { obs = null, release = [], scan = null } = {}) {
  if (!obs && !release.length && !scan) return true
  const rec = { t: 'cnt', ids: release }
  if (obs) Object.assign(rec, { k: obs.k, n: obs.n, cap: obs.cap })
  if (scan) rec.scan = { keys: scan.keys, at: scan.at }
  return appendJournal(dir, key, world, rec)
}

/**
 * VOID THIS BOT'S ABANDONED CLAIMS -> how many: live claims by `bot` from another (dead: one process per bot) instance, or
 * from this instance before `before` (an earlier skill run's leftover; one skill runs at a time). Each one makes its
 * container UNKNOWN until recounted.
 */
export function voidOwnClaims (dir, key, world, { bot, before = Date.now() } = {}) {
  if (bot == null) return 0
  const st = readTown(dir, key, world)
  if (!st) return 0
  const ids = Object.entries(st.claims).filter(([, c]) => c.state === 'live' && c.bot === bot && (c.inst !== INSTANCE || c.at < before)).map(([id]) => id)
  if (ids.length && !appendJournal(dir, key, world, { t: 'void', ids, at: Date.now(), bot, inst: INSTANCE })) return 0
  return ids.length
}
