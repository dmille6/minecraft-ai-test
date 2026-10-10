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
//   void   a claim abandoned by a DEAD instance, written by that bot's next instance once it is logged in (the server keeps
//          one connection per username, so the predecessor can no longer click): it stops being a reservation and its
//          container is UNKNOWN until a count appended after the void and captured after it, which then IS the count.
//          AN ADMITTED CLAIM IS NEVER EXPIRED BY TIME (Codex r3 P1: a paused transfer cannot be fenced by a clock): it
//          stays reserved until its own release or a void. A bot removed from the fleet leaves its claims reserved for good
//          (fail closed: at most one stack each; the read reports claims never released).
//   scan   the town's container keys from a covered scan, for the plan's view from away from home
// Isolated pools keep one state dir per bot, so their bots do not see each other's claims: the read reports it, and the
// canary never draws an isolated pool.

// STOCK TARGETS (stocktarget-01, stocktarget.mjs): the same journal counts EVERY targeted group. A count record carries
// `n` (cobble, as before -- stonecap's read folds it) and, from this build, `v: 2` with `m` = { group: count } for every
// group the open window held ("every group was counted; an absent one is 0"). A record without `v` (stonecap's) is a count
// of cobble ONLY: for any other group its container is UNKNOWN until recounted (fail closed across a mixed restart). A
// claim carries its group `g` (absent = cobble) and is decided against that group's target (targetOf; 256 for cobble;
// an unknown group 0 = never admitted).
//
// ROTATION (the stonecap pre-promotion gap): GENERATIONS, no lock on the hot path. Generation 0 is <townKey>.cobble.jsonl;
// generation N >= 1 is <townKey>.cobble.g<N>.jsonl with a SEAL (...g<N>.seal, created exclusively: one rotator wins) and a
// BASE (...g<N>.base.json: the complete fold of generation N-1, per world, published once by link -- every reader folds
// the same base). The current generation is the highest sealed one. A writer appends to it and re-reads it: when it moved,
// the append may have missed the base, so a claim is UNKNOWN (never transferred; released in the new generation) and a
// count, release or void is appended again there (each is idempotent under the fold). A record whose writer re-read the
// old generation was appended before the seal, hence before the rotator's fold. Generations older than N-1 are deleted
// once base N+1 is published: two journals of <= ROTATE_BYTES plus two bases.

import fs from 'node:fs'
import path from 'node:path'
import { targetOf } from './stocktarget.mjs'

export const TOWN_COBBLE_CAP = 256
/** A reader rotates the current generation once its journal passes this. */
export const ROTATE_BYTES = Number(process.env.STOCK_ROTATE_BYTES) > 0 ? Number(process.env.STOCK_ROTATE_BYTES) : 4 * 1024 * 1024
/** An observation older than this is no longer a count: the container is unknown again. */
export const OBS_TTL_MS = 6 * 60 * 60 * 1000
/** A journal larger than this is not replayed: the town is UNKNOWN (fail closed). ~100 KB/day per town at fleet rates. */
export const JOURNAL_MAX_BYTES = 32 * 1024 * 1024
/** This process. Each CONNECTION gets its own instance below it (skills.mjs installCobbleCap: `${INSTANCE}-c<n>`, Codex r6
 *  P1: a reconnect inside one process is a new login, and the old connection's late callbacks must be fenceable). */
export const INSTANCE = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 7)}`
/**
 * WHICH LOGIN IS NEWER -> [process start ms, connection n] for an instance `<ms>-<pid>-<rand>[-c<n>]`. Anything else (an
 * older format, a test's name) is the oldest. A void from an instance OLDER than the bot's current fence is ignored
 * (Codex r7 P1: a superseded connection retrying its void must never void its successor's claims or move the fence back).
 */
export function instOrder (inst) {
  const parts = String(inst ?? '').split('-')
  const ms = Number(parts[0])
  const c = /^c(\d+)$/.exec(parts[parts.length - 1] ?? '')
  return [Number.isFinite(ms) && parts.length >= 3 ? ms : -Infinity, c ? Number(c[1]) : 0]
}
const olderInst = (a, b) => { const x = instOrder(a), y = instOrder(b); return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]) }
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
export function townCobble (state = {}, keys = [], now = Date.now(), opts = {}) {
  return townStock(state, keys, now, { ...opts, group: 'cobble' })
}

/**
 * ONE CONTAINER'S COUNT OF A GROUP -> a number, or null when that observation did not count the group. Pure. Cobble is `n`
 * in every version; any other group only in a v2 record (`m`, an absent group = 0).
 */
export function countOf (o, group = 'cobble') {
  if (!o) return null
  if (group === 'cobble') return Math.max(0, Number(o.n) || 0)
  if ((Number(o.v) || 1) >= 2) return Math.max(0, Number(o.m?.[group]) || 0)
  return null
}

/**
 * THE TOWN'S STOCK OF ONE GROUP, AS FAR AS ANYONE KNOWS -> { lb, complete, unknown, reserved, mine }. townCobble generalised:
 * a container is fresh for `group` only when its latest count counted that group; `reserved` is the live admitted claims OF
 * THAT GROUP; a voided claim of any group makes its container unknown for every group (the recount reads them all).
 */
export function townStock (state = {}, keys = [], now = Date.now(), { me = null, coverage = true, gone = [], group = 'cobble' } = {}) {
  const obs = state?.obs ?? {}
  const claims = state?.claims ?? {}
  const goneSet = new Set(Array.isArray(gone) ? gone : [])
  const dirty = new Set()
  let reserved = 0, mine = 0, taking = 0
  for (const c of Object.values(claims)) {
    if (!c?.k || !ADMITTED.has(c.decision)) continue
    if (c.state === 'live') {
      if ((c.g ?? 'cobble') !== group) continue
      // OUTGOING (a prune's take, a withdraw's draw): what is on its way OUT of the town comes off the floor until the
      // post-transfer count releases it; INCOMING (a bank claim) reserves room under the ceiling
      if (c.decision === 'take' || c.decision === 'draw') taking += Number(c.n) || 0   // valve/bank: incoming
      else { reserved += Number(c.n) || 0; if (me != null && c.bot === me) mine += Number(c.n) || 0 }
    } else if (c.state === 'void' && !(obs[c.k] && obs[c.k].seq > c.voidSeq && obs[c.k].at >= c.voidAt)) dirty.add(c.k)
  }
  const usable = k => !goneSet.has(k) && !dirty.has(k) && obs[k] && Number.isFinite(obs[k].at) && countOf(obs[k], group) != null
  const fresh = k => usable(k) && now - obs[k].at < OBS_TTL_MS
  let lb = 0, floor = 0
  for (const k of Object.keys(obs)) {
    if (!fresh(k)) continue
    lb += countOf(obs[k], group)
    // THE FLOOR (stocktarget, design 3.5): only counts captured within FLOOR_TTL_MS, the SMALLER of two equal captures
    if (now - obs[k].at < FLOOR_TTL_MS) floor += countOf(obs[k].lo ?? obs[k], group) ?? 0
  }
  const all = [...new Set([...(Array.isArray(keys) ? keys : []), ...dirty])].filter(k => !goneSet.has(k))
  const unknown = all.filter(k => !fresh(k))
  // floor: fresh (FLOOR_TTL_MS) counts, the smaller of equal captures; `taking` is NOT subtracted here -- takeAdmit does it once
  return { lb, complete: !!coverage && all.length > 0 && unknown.length === 0, unknown, reserved, mine, taking, floor, avail: Math.max(0, floor - taking), held: Number(state?.hold) || 0 }
}

/** Claim decisions that hold something: a BANK claim reserves room; a TAKE claim (pruning) holds stock it will remove. */
const ADMITTED = new Set(['bank', 'take', 'draw', 'valve', 'nowell'])
/** The floor counts only captures younger than this (stale-high counts cannot authorise a disposal or a prune). */
export const FLOOR_TTL_MS = 60 * 60 * 1000

/**
 * MAY THIS AMOUNT BE TAKEN OUT OF THE TOWN (pruning) -> 'take' | 'at_floor'. Pure. Only while the floor -- fresh counts,
 * the smaller of equal captures, less every live take -- keeps the group at or above its target after it.
 */
export function takeAdmit (view, n, target) {
  if ((Number(view?.held) || 0) > 0) return 'held'                      // the operator's clear handshake holds every prune
  const after = (Number(view?.floor) || 0) - (Number(view?.taking) || 0) - (Number(n) || 0)
  return (Number(n) || 0) > 0 && after >= (Number(target) || 0) ? 'take' : 'at_floor'
}

/** A count map from a record -> { group: n >= 0 } (non-numbers dropped). */
export function cleanCounts (m) {
  const out = {}
  if (m && typeof m === 'object') for (const [g, n] of Object.entries(m)) { const v = Number(n); if (typeof g === 'string' && Number.isFinite(v) && v > 0) out[g] = Math.floor(v) }
  return out
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

// ---- the files: generations (rotation) -----------------------------------------------------------------------------
//
// ROTATION (stocktarget-01; design r3 section 4). Generation 0 is the legacy <key>.cobble.jsonl. Generation N >= 1:
// <key>.cobble.g<N>.jsonl, its SEAL <key>.cobble.g<N>.seal and its BASE <key>.cobble.g<N>.base.json.
//   - The CURRENT generation is the highest sealed one. A seal is created exclusively ('wx'): one rotator per generation.
//   - BASE N = the fold, PER WORLD, of base N-1 + generation N-1 up to its end when the base is computed (after the seal).
//     Published once, by link (EEXIST: the published one IS the base); every reader folds the same base.
//   - A READER of generation N folds base N + generation N ONLY. Anything appended to N-1 after the base's cut is never
//     folded, so the fold is a pure function of a stable order (Claude r2 P1-1: folding a growing tail re-decided an
//     admitted claim and let a town reach 304 of 256).
//   - CONFIRM BEFORE YOU MUTATE (design 3.0): every record whose loss could make the town look fuller than it is -- a bank,
//     take or draw claim, a void -- is appended and the generation RE-READ before the action it covers (claimStack,
//     voidOwnClaims); when it moved, the action does not happen. What a late append can lose is a record written AFTER a
//     mutation (a releasing count, a recount, a dirty mark): a lost release leaves its claim live (conservative) and is
//     re-appended in the new generation by appendJournal when the writer sees the move.
//   - The rotator deletes generations older than N once base N+1 is published: two journals of <= ROTATE_BYTES, two bases.

const fileOf = (dir, key, gen, ext) => path.join(dir, gen ? `${key}.cobble.g${gen}.${ext}` : `${key}.cobble.${ext}`)
const journalFile = (dir, key, gen = 0) => fileOf(dir, key, gen, 'jsonl')
const ckptFile = (dir, key, gen = 0) => fileOf(dir, key, gen, 'ckpt.json')
const sealFile = (dir, key, gen) => path.join(dir, `${key}.cobble.g${gen}.seal`)
const baseFile = (dir, key, gen) => path.join(dir, `${key}.cobble.g${gen}.base.json`)
/** A reader that folded at least this many bytes past the checkpoint writes a new one. */
export const CKPT_EVERY_BYTES = 256 * 1024

const GEN = new Map()   // `${dir}|${key}` -> the highest sealed generation this process has seen (never decreases)
const genOfFile = (key, f) => {
  const pre = `${key}.cobble.g`
  if (!f.startsWith(pre)) return null
  const m = /^(\d+)\./.exec(f.slice(pre.length))
  return m ? Number(m[1]) : null
}
/** THE CURRENT GENERATION: the highest sealed one (0 = the legacy file). A seal cached here but gone from disk (an operator
 *  deleted the journal) re-reads the directory. */
export function currentGen (dir, key) {
  const ck = `${dir}|${key}`
  let g = GEN.get(ck)
  // A CACHED GENERATION THAT IS GONE (deleted by a later rotation: this process fell two behind) re-reads the directory --
  // appending to a deleted generation and folding it would judge a claim on an EMPTY history (the storm test found it)
  if (g == null || !fs.existsSync(g >= 1 ? sealFile(dir, key, g) : journalFile(dir, key, 0))) {
    g = 0
    try { for (const f of fs.readdirSync(dir)) { if (f.endsWith('.seal')) { const n = genOfFile(key, f); if (n != null && n > g) g = n } } } catch { /* no dir yet */ }
  }
  while (fs.existsSync(sealFile(dir, key, g + 1))) g++
  GEN.set(ck, g)
  return g
}

const line = (world, rec) => '\n' + JSON.stringify({ inst: INSTANCE, ...rec, w: world ?? null }) + '\n'
function appendTo (dir, key, world, rec, gen) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(journalFile(dir, key, gen), line(world, rec))
    return true
  } catch { return false }
}

/** Append ONE record as one line in one write, newline FIRST (a dead writer's fragment is closed off), to the CURRENT
 *  generation -> true when written. (A claimant uses claimStack, which also re-reads the generation.) */
export function appendJournal (dir, key, world, rec) {
  let g = currentGen(dir, key)
  if (!appendTo(dir, key, world, rec, g)) return false
  // a record written after a mutation is re-appended where readers now look (a claim is the claimant's: claimStack)
  // ...as its RELEASES plus a DIRTY mark for its container, never as a count with a releasing count's priority (Claude r3
  // P2-3: re-appended after a newer, lower count, it would overwrite it)
  const again = rec?.t === 'cnt' && rec.k != null ? { t: 'cnt', ids: rec.ids ?? [], bot: rec.bot ?? null, ...(rec.inst != null ? { inst: rec.inst } : {}), at: Date.now(), dirty: rec.k } : rec
  for (let i = 0; i < 3 && rec?.t !== 'claim'; i++) {
    const g2 = currentGen(dir, key)
    if (g2 === g) break
    g = g2
    if (!appendTo(dir, key, world, again, g)) return false
  }
  return true
}

/** Complete lines of a buffer read from a record boundary -> { records (this world, or every world with all), used }. */
function parseLines (buf, world, all = false) {
  const last = buf.lastIndexOf(10)                      // the last newline: what follows is a record still being written
  const records = []
  if (last >= 0) {
    for (const ln of buf.subarray(0, last).toString('utf8').split('\n')) {
      if (!ln) continue
      try { const r = JSON.parse(ln); if (all || (r?.w ?? null) === (world ?? null)) records.push(r) } catch { /* a dead writer's fragment */ }
    }
  }
  return { records, used: last + 1 }
}
/** Bytes [from, size) of a file -> { buf, size, ino } | { missing: true } | null (unreadable or too large). */
function readFrom (f, from = 0, maxBytes = Infinity) {
  let st
  try { st = fs.statSync(f) } catch (e) { return e?.code === 'ENOENT' ? { missing: true } : null }
  if (from > st.size) return null
  if (st.size - from > maxBytes) return null
  try {
    const fd = fs.openSync(f, 'r')
    try { const buf = Buffer.alloc(st.size - from); fs.readSync(fd, buf, 0, buf.length, from); return { buf, size: st.size, ino: st.ino } } finally { fs.closeSync(fd) }
  } catch { return null }
}
const wkey = w => JSON.stringify(w ?? null)

/** BASE N, published -> { v, gen, prevEnd, prevIno, worlds: { wkey: { state, seq } } } or null. */
function readBase (dir, key, gen) {
  try {
    const b = JSON.parse(fs.readFileSync(baseFile(dir, key, gen), 'utf8'))
    return b?.v === 1 && b.gen === gen && b.worlds && typeof b.worlds === 'object' && Number.isInteger(b.prevEnd) ? b : null
  } catch { return null }
}
/**
 * PUBLISH BASE `gen` (gen >= 1) -> the published base, or null. Folds what a reader of gen-1 folds -- base gen-1 and
 * generation gen-1, up to its end now -- for EVERY world, and links it into place once (EEXIST: someone else's is the base).
 */
export function publishBase (dir, key, gen, { maxBytes = JOURNAL_MAX_BYTES } = {}) {
  const have = readBase(dir, key, gen)
  if (have) return have
  const prev = gen - 1
  let worlds = {}
  const records = []
  let budget = maxBytes
  if (prev >= 1) {
    const b = readBase(dir, key, prev) ?? publishBase(dir, key, prev, { maxBytes })
    if (!b) return null
    worlds = JSON.parse(JSON.stringify(b.worlds))
  }
  const r = readFrom(journalFile(dir, key, prev), 0, budget)
  if (!r) return null
  let prevEnd = 0, prevIno = null
  if (!r.missing) { const p = parseLines(r.buf, null, true); records.push(...p.records); prevEnd = p.used; prevIno = r.ino }
  const byWorld = new Map()
  for (const k of Object.keys(worlds)) byWorld.set(k, [])
  for (const rec of records) { const k = wkey(rec?.w); if (!byWorld.has(k)) byWorld.set(k, []); byWorld.get(k).push(rec) }
  const out = {}
  for (const [k, recs] of byWorld) {
    const from = worlds[k] ?? null
    const f = foldJournal(recs, { state: from?.state ?? null, seq: from?.seq ?? 0 })
    out[k] = { state: f.state, seq: f.seq }
  }
  const tmp = `${baseFile(dir, key, gen)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, gen, prevEnd, prevIno, worlds: out }))
    try { fs.linkSync(tmp, baseFile(dir, key, gen)) } catch (e) { if (e?.code !== 'EEXIST') return null }
  } catch { return null } finally { try { fs.unlinkSync(tmp) } catch { /* gone */ } }
  return readBase(dir, key, gen)
}

/**
 * ROTATE: seal generation gen+1 (exclusively: one rotator), publish its base, delete generations older than gen.
 * -> the new generation, or null when another rotator holds it or the base could not be published (readers publish it).
 */
export function rotateTown (dir, key, gen, opts = {}) {
  try { fs.closeSync(fs.openSync(sealFile(dir, key, gen + 1), 'wx')) } catch { return null }
  GEN.set(`${dir}|${key}`, Math.max(GEN.get(`${dir}|${key}`) ?? 0, gen + 1))
  if (!publishBase(dir, key, gen + 1, opts)) return null
  // generations older than `gen` are read by nobody: gen+1's base folds gen; gen is kept for a reader that loaded it
  try {
    for (const f of fs.readdirSync(dir)) {
      const n = f.startsWith(`${key}.cobble.`) ? (genOfFile(key, f) ?? (/^cobble\.(jsonl|ckpt\.json)$/.test(f.slice(key.length + 1)) ? 0 : null)) : null
      if (n != null && n < gen) { try { fs.unlinkSync(path.join(dir, f)) } catch { /* gone */ } }
    }
  } catch { /* the next rotation retries */ }
  return gen + 1
}

const emptyState = () => ({ obs: {}, claims: {}, scan: null, fence: {} })

/**
 * THE FOLD -> { state, decision, view, seq }. Pure. Continues from `state`/`seq` (a checkpoint's) when given, without
 * changing them. With `upto` (a claim id) it stops AT that claim and returns the claim's decision and the view it was
 * judged on; every reader computes the same decision for the same claim. Refused claims are not kept; released ones are
 * dropped; a voided one is dropped once its container is recounted after the void.
 */
export function foldJournal (records = [], { upto = null, state: from = null, seq: seq0 = 0 } = {}) {
  const state = from ? JSON.parse(JSON.stringify(from)) : emptyState()
  const release = ids => { for (const id of (Array.isArray(ids) ? ids : [])) if (state.claims[id]?.state === 'live') delete state.claims[id] }
  state.fence ??= {}
  let seq = Number(seq0) || 0
  for (const r of (Array.isArray(records) ? records : [])) {
    seq++
    const t = r?.t
    // FENCED (Codex r5 P1): once a bot's new process has logged in and written its void, every LATER record of that bot
    // from any other process is ignored -- a predecessor whose JavaScript outlived its connection cannot publish a count
    // from a stale window, release, or claim
    if (t !== 'void' && r?.bot != null && state.fence[r.bot] && r.inst !== state.fence[r.bot]) continue
    // a count captured at or before an operator's reset is not a count, whenever it is appended (Claude code r1 P3)
    if ((t === 'obs' || t === 'cnt') && r.k != null && Number.isFinite(r.cap) && !(r.cap <= (Number(state.resetAt) || -Infinity))) {
      const n = Math.max(0, Number(r.n) || 0)
      const o = state.obs[r.k]
      // a count that releases a live claim on this very container was taken AFTER that claim's transfer: it replaces every
      // earlier-appended count whatever the clocks say; otherwise the latest capture wins, a tie the larger count
      const releasing = t === 'cnt' && (r.ids ?? []).some(id => state.claims[id]?.state === 'live' && state.claims[id]?.k === r.k)
      // A VOID IS RESOLVED by a count of its container appended after it and captured at or after it, and that recount IS
      // the container's count from then on (Codex r4 P1: a recount that lost to an older count with a later clock must not
      // clear the unknown while the stale low count stands)
      const resolving = Object.values(state.claims).some(c => c.state === 'void' && c.k === r.k && r.cap >= c.voidAt)
      // a v2 count names every group (stocktarget): its map is kept with it; a legacy count is cobble only
      const m = Number(r.v) >= 2 ? cleanCounts(r.m) : null
      const next = m ? { n, at: r.cap, seq, v: 2, m } : { n, at: r.cap, seq }
      // A RELEASING COUNT OLDER THAN THE STANDING ONE (Codex r4 1, stocktarget): stonecap let it replace whatever the clocks
      // said, so a release was never lost to a clock step -- but an older capture can then undo a later draw's count. Now
      // its claim is released (below) and the container is UNKNOWN until a recount: neither count is trusted.
      // ...and an EQUAL capture too (Codex r5 1: a tie must not let a release bypass the floor's `lo`)
      const stale = releasing && !resolving && o && r.cap <= o.at
      if (stale) state.claims[`dirty-${seq}`] = { n: 0, k: r.k, at: Number(r.at) || 0, bot: r.bot ?? null, inst: r.inst ?? null, decision: 'bank', state: 'void', voidAt: Number(r.at) || 0, voidSeq: seq }
      else if (!o || releasing || resolving || r.cap > o.at) state.obs[r.k] = next
      else if (r.cap === o.at) {
        // AN EQUAL CAPTURE (two bots, one millisecond): the LARGER count stands for admission (a ceiling: stonecap's rule)
        // and the SMALLER is kept as `lo` for the floor (a disposal or a prune may only rest on the smaller -- r1 reviews)
        // the ceiling: COMPONENTWISE MAXIMA of two v2 counts (Codex code r1 P1: choosing by cobble alone kept the other
        // groups' smaller counts); a legacy side makes the merged count legacy (cobble only: other groups unknown)
        const hiOf = (a, b) => (Number(a.v) >= 2 && Number(b.v) >= 2)
          ? { n: Math.max(a.n, b.n), v: 2, m: Object.fromEntries([...new Set([...Object.keys(a.m ?? {}), ...Object.keys(b.m ?? {})])].map(g => [g, Math.max(a.m?.[g] ?? 0, b.m?.[g] ?? 0)])) }
          : { n: Math.max(a.n, b.n) }
        const lowOf = (a, b) => {
          if (Number(a.v) >= 2 && Number(b.v) >= 2) {
            const lm = {}
            for (const g of new Set([...Object.keys(a.m ?? {}), ...Object.keys(b.m ?? {})])) lm[g] = Math.min(a.m?.[g] ?? 0, b.m?.[g] ?? 0)
            return { n: Math.min(a.n, b.n), v: 2, m: lm }
          }
          return { n: Math.min(a.n, b.n) }                  // a legacy side counted cobble only: the floor of other groups is unknown
        }
        const prevLo = o.lo ? { ...o.lo } : o
        state.obs[r.k] = { ...hiOf(o, next), at: r.cap, seq, lo: lowOf(prevLo, next) }
      }
      if (resolving) for (const [id, c] of Object.entries(state.claims)) if (c.state === 'void' && c.k === r.k && r.cap >= c.voidAt) delete state.claims[id]
    }
    if (t === 'cnt' || t === 'rel') {
      release(r.ids)
      // a release WITHOUT a count it can vouch for (the window was no longer the bot's): the container is UNKNOWN until a
      // recount captured after it, exactly as after a void
      if (t === 'cnt' && r.dirty != null) state.claims[`dirty-${seq}`] = { n: 0, k: r.dirty, at: Number(r.at) || 0, bot: r.bot ?? null, inst: r.inst ?? null, decision: 'bank', state: 'void', voidAt: Number(r.at) || 0, voidSeq: seq }
    }
    else if (t === 'claim' && r.id && r.k && Number.isFinite(r.at)) {
      const g = typeof r.g === 'string' ? r.g : 'cobble'
      const view = townStock(state, r.keys, r.at, { me: r.bot ?? null, coverage: !!r.coverage, gone: r.gone ?? [], group: g })
      // a TAKE claim (pruning) is admitted against the floor; every other claim is a BANK claim against the ceiling
      // a DRAW (a withdraw about to take items out) is always admitted: it only lowers the floor until its count releases it
      // a VALVE (one spare tool when nothing else frees a slot, design 3.2) is admitted whatever the target, and gated by the read
      // NOWELL (design 3.2: no usable well, so the cap does not bind) is admitted whatever the target, recorded for the read
      const decision = r.kind === 'take' ? takeAdmit(view, r.n, targetOf(g)) : r.kind === 'draw' ? 'draw' : r.kind === 'valve' ? 'valve' : r.kind === 'nowell' ? 'nowell' : cobbleAdmit(view, r.n, targetOf(g))
      if (ADMITTED.has(decision)) state.claims[r.id] = { n: Number(r.n) || 0, k: r.k, at: r.at, bot: r.bot ?? null, inst: r.inst ?? null, decision, state: 'live', voidAt: null, voidSeq: null, ...(g !== 'cobble' ? { g } : {}) }
      if (upto != null && r.id === upto) return { state, decision, view, seq }
    } else if (t === 'reset' && Number.isFinite(r.at)) {
      // AN OPERATOR'S FENCE (the one-time clear, stockreset.py): every count captured before it is gone (its containers are
      // unknown until recounted), and no prune is admitted until `hold`
      for (const [k, o] of Object.entries(state.obs)) if (!(o.at > r.at)) delete state.obs[k]
      state.resetAt = Math.max(Number(state.resetAt) || 0, r.at)
      if (r.hold != null) state.hold = Number(r.hold) > 0 ? 1 : 0          // the handshake's hold / resume (design 3.1)
    } else if (t === 'void') {
      if (r.bot != null && state.fence[r.bot] && r.inst !== state.fence[r.bot] && olderInst(r.inst, state.fence[r.bot])) continue   // superseded
      if (r.bot != null && r.inst != null) state.fence[r.bot] = r.inst
      for (const id of (r.ids ?? [])) { const c = state.claims[id]; if (c && c.state === 'live') { c.state = 'void'; c.voidAt = Number(r.at) || 0; c.voidSeq = seq } }
    }
    const sc = t === 'scan' ? r : t === 'cnt' ? r.scan : null
    if (Array.isArray(sc?.keys) && Number.isFinite(sc.at) && (!state.scan || sc.at >= state.scan.at)) state.scan = { keys: sc.keys, at: sc.at }
  }
  return { state, decision: null, view: null, seq }
}

/**
 * THE TOWN'S HISTORY TO FOLD -> { base, seq, records, end, ino, from, gen, size } or null (cannot be replayed:
 * the town is UNKNOWN). `base` is the starting state (a checkpoint's, or the generation's base for this world; null: from
 * the start); `records` the complete lines after it, for this world; `end` the byte
 * offset in THIS generation's file after the last complete line. A checkpoint past `maxOffset` is not used (a claimant
 * needs its own claim in the records it folds), nor one of another generation. More than maxBytes to fold -> null.
 * `gen` defaults to the current generation.
 */
export function loadJournal (dir, key, world = null, { maxBytes = JOURNAL_MAX_BYTES, maxOffset = Infinity, checkpoint = true, gen = null } = {}) {
  const g = gen ?? currentGen(dir, key)
  let start = null
  if (g >= 1) {
    const b = readBase(dir, key, g) ?? publishBase(dir, key, g, { maxBytes })
    if (!b) return null
    start = b.worlds[wkey(world)] ?? { state: null, seq: 0 }
  }
  const f = journalFile(dir, key, g)
  let st
  try { st = fs.statSync(f) } catch (e) {
    if (e?.code !== 'ENOENT') return null
    // a generation older than the current one that is gone was deleted by a rotation: not replayable
    if (gen != null && g < currentGen(dir, key)) return null
    return { base: start?.state ?? null, seq: start?.seq ?? 0, records: [], end: 0, ino: null, from: 0, gen: g, size: 0 }
  }
  let ck = null
  if (checkpoint) {
    try {
      const c = JSON.parse(fs.readFileSync(ckptFile(dir, key, g), 'utf8'))
      if (c?.v === 1 && c.ino === st.ino && (c.gen ?? 0) === g && (c.world ?? null) === (world ?? null) && Number.isInteger(c.offset) && c.offset <= st.size && c.offset <= maxOffset) ck = c
    } catch { /* none, or torn: from the base */ }
  }
  const from = ck ? ck.offset : 0
  const r = readFrom(f, from, maxBytes)
  if (!r || r.missing) return null
  const p = parseLines(r.buf, world)
  return { base: ck ? ck.state : (start?.state ?? null), seq: ck ? ck.seq : (start?.seq ?? 0), records: p.records, end: from + p.used, ino: st.ino, from, gen: g, size: r.size }
}

/** The CURRENT generation's complete records for this world, from its start (no checkpoint, no base) -> [records] or null.
 *  Tests and reads. */
export function readJournal (dir, key, world = null, opts = {}) {
  const j = loadJournal(dir, key, world, { ...opts, checkpoint: false })
  return j ? j.records : null
}

/**
 * The town's folded state now, or null when the journal cannot be replayed (the town is then UNKNOWN). Writes a new
 * checkpoint when it folded at least `ckptEvery` bytes past the old one; ROTATES when the current generation's file has
 * passed `rotateBytes`. `stats` (optional) receives what was folded, and `rotated` when this read rotated.
 */
export function readTown (dir, key, world = null, { ckptEvery = CKPT_EVERY_BYTES, rotateBytes = ROTATE_BYTES, stats = null, ...opts } = {}) {
  const j = loadJournal(dir, key, world, opts)
  if (!j) return null
  const r = foldJournal(j.records, { state: j.base, seq: j.seq })
  if (stats) Object.assign(stats, { folded: j.records.length, from: j.from ?? 0, end: j.end, gen: j.gen })
  if (j.ino != null && j.end - (j.from ?? 0) >= ckptEvery) {
    try {
      const tmp = `${ckptFile(dir, key, j.gen)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, gen: j.gen, ino: j.ino, world: world ?? null, offset: j.end, seq: r.seq, state: r.state }))
      fs.renameSync(tmp, ckptFile(dir, key, j.gen))
    } catch { /* the next reader writes it */ }
  }
  if (j.size > rotateBytes) {
    const ng = rotateTown(dir, key, j.gen, opts)
    if (stats && ng != null) stats.rotated = ng
  }
  return r.state
}

/**
 * CLAIM ONE WHOLE STACK (or an amount) of group `g` for container `k` -> { decision, view, at }. Appends the claim to the
 * current generation, RE-READS the generation (moved: the claim is UNKNOWN to its claimant and released in the new one --
 * it was decided against the old generation only), folds (from a checkpoint that ends before the claim) and takes the
 * decision the fold gives the claim at its own place. A refused or unreadable claim is released at once (it never moves
 * anything). No append, or a journal that cannot be replayed -> 'unknown'.
 */
export function claimStack (dir, key, world, { id, n, k, g = 'cobble', kind = 'bank', proof = null, bot = null, keys = [], coverage = false, gone = [], at = Date.now(), inst = INSTANCE }, opts = {}) {
  const g1 = currentGen(dir, key)
  let before = 0
  try { before = fs.statSync(journalFile(dir, key, g1)).size } catch { before = 0 }
  // every kind but a plain bank claim is written (Codex code r1 P1: a draw or valve written as a bank claim is judged
  // against the ceiling); a valve carries its order's proof
  const rec = { t: 'claim', id, n, k, at, bot, inst, keys, coverage: !!coverage, gone, ...(g !== 'cobble' ? { g } : {}), ...(kind !== 'bank' ? { kind } : {}), ...(proof ? { proof } : {}) }
  if (!appendTo(dir, key, world, rec, g1)) return { decision: 'unknown', view: null, at }
  if (currentGen(dir, key) !== g1) {
    appendJournal(dir, key, world, { t: 'rel', ids: [id], at: Date.now(), bot, inst })
    return { decision: 'unknown', view: null, at, moved: true }
  }
  const j = loadJournal(dir, key, world, { ...opts, maxOffset: before, gen: g1 })
  const r = j ? foldJournal(j.records, { upto: id, state: j.base, seq: j.seq }) : { decision: null, view: null }
  const decision = r.decision ?? 'unknown'
  if (!ADMITTED.has(decision)) appendJournal(dir, key, world, { t: 'rel', ids: [id], at: Date.now(), bot, inst })
  return { decision, view: r.view, at }
}

/**
 * A COUNT and its releases in ONE line: the container's cobble (`obs.n`) and -- stocktarget -- every group's count
 * (`obs.m`, written as a v2 record) captured at `obs.cap`, and the claims it includes. `obs` null: releases only.
 * -> true when written.
 */
export function recordCount (dir, key, world, { obs = null, release = [], scan = null, bot = null, dirty = null, inst = INSTANCE } = {}) {
  if (!obs && !release.length && !scan && dirty == null) return true   // a dirty mark alone is a record (Codex code r1 P1)
  const rec = { t: 'cnt', ids: release, bot, inst, at: Date.now() }
  if (dirty != null) rec.dirty = dirty
  if (obs) {
    Object.assign(rec, { k: obs.k, n: obs.n, cap: obs.cap })
    if (obs.m && typeof obs.m === 'object') Object.assign(rec, { v: 2, m: cleanCounts(obs.m) })
  }
  if (scan) rec.scan = { keys: scan.keys, at: scan.at }
  return appendJournal(dir, key, world, rec)
}

/**
 * VOID THIS BOT'S PREDECESSOR'S CLAIMS AND FENCE IT -> how many were voided, or -1 when the void could not be read or
 * written (the caller retries). Live claims by `bot` from ANOTHER process instance are voided, and the record fences every
 * later record of `bot` from any other process (foldJournal). Called only once this
 * process is LOGGED IN as `bot` (skills.mjs, after spawn): the server admits one connection per username and kicks the
 * older one, so no click of the predecessor can reach the server any more (Codex r4 P1). A claim of THIS instance is never
 * voided, however old: a skill the runner abandoned may still be awaiting its transfer, and finishes it, releasing the
 * claim itself; one that never finishes keeps its reservation until the process ends (fail closed). Each voided claim
 * makes its container UNKNOWN until recounted.
 */
export function voidOwnClaims (dir, key, world, { bot, inst = INSTANCE } = {}) {
  if (bot == null) return -1
  const st = readTown(dir, key, world)
  if (!st) return -1                                                    // not replayable: not done (Codex r5 P2: retried)
  const ids = Object.entries(st.claims).filter(([, c]) => c.state === 'live' && c.bot === bot && c.inst !== inst).map(([id]) => id)
  // written even with nothing to void: it is also THE FENCE for every other process of this bot from here on
  if (!appendJournal(dir, key, world, { t: 'void', ids, at: Date.now(), bot, inst })) return -1
  return ids.length
}
