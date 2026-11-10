// THE BUILD PROJECT'S FILES (shop-01 stage A; design docs/reports/building-tier-2026-10-23.md section 4.1 "fencing and
// concurrency", section 5, cooperation A1/A3). Pure over a directory: no bot, no world. Every bot of a town runs on one host,
// so the town's state directory is the whole protocol: a crash leaves nothing but files that lapse.
//
//   THE RECORD     `project-<home>.<plot>.g<N>.json`: the fitted, frozen instance (buildsite.mjs siteBlueprint's record) and its
//                  transitions, as GENERATIONS: each a full snapshot linked once (link(tmp, gN) fails when N exists), naming its
//                  predecessor and the sha256 of its bytes; the head is a walk over the files (planstore's protocol). A
//                  generation is written only on a TRANSITION (a dependency opening, a fallback, a waiver, a state change),
//                  never per placement or renewal (cooperation A1). Progress is the world, never the record.
//   LEASES         `project-<...>.<name>.lease.g<N>.json`, name = `slot<k>` (k = 1..builders_max: the atomic builder cap) or
//                  `seg-<seg>`: found-01's lease shape -- exclusive create, the newest generation wins, a holder and an
//                  `until`, a `.released` marker. EVERY ACQUISITION AND EVERY RENEWAL LINKS A NEW GENERATION: the fencing token
//                  is the generation the sender holds now. A lapsed lease is another bot's only RECLAIM_MS after its until.
//   THE MUTEX      `project-<...>.mutate.g<N>.json` around every final check and send. D7 (named deviation): the design asks for
//                  a kernel flock through a native binding; none is installed, so it is a chain of EXCLUSIVE-CREATE generations
//                  (r2, Codex r1 P1: a rename-reclaim let two reclaimers hold at once). The newest generation decides: held
//                  until its `.released` marker, unless its holder's process is dead or superseded (the holder's presence names
//                  a newer process). NO AGE RECLAIM: a live holder, even a suspended one, is never displaced. Taken
//                  non-blocking: busy is a free skip of that click.
//   INTENTS        `project-<...>.intents.<holder>.jsonl`, appended and fsynced BEFORE the mutex: open {id, cell, block, lease,
//                  seq, conn}, then settled {id, state} on the server's acknowledgement of that sequence -- however late it
//                  comes (buildack.mjs) -- or cancelled. `conn` names the sender's CONNECTION (pid and connect time).
//   PRESENCE       `project-<...>.presence.<holder>.json`: the holder's current connection and pid, written at every login.
//   THE BARRIER    `project-<...>.barrier.g<N>.json`: a closer cell or a fallback transition takes it under the mutex; from then
//                  no other sender passes the fence; the holder waits for every other holder's open intent to be settled,
//                  cancelled, or its sender RETIRED (intentRetired: the connection is gone), never on a timer, then clicks and
//                  releases it.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const LEASE_TTL_MS = 4 * 60_000
export const RECLAIM_MS = 60_000
export const MUTEX_HOLD_MS = 5_000
export const MUTEX_TORN_MS = 5_000
export const MUTEX_KEEP = 16
export const RETIRE_MS = 1_000
// "not in the tab list" is weaker evidence than a playerLeft event (a first notice can be the tab list lagging a join), so
// it must last this long before it retires anything (Codex r3 P1)
export const OFFLINE_RETIRE_MS = 10_000
// THE HOLDER'S HEARTBEAT (Codex r4 P1): every live connection rewrites its presence `beat` this often; a beat older than
// BEAT_STALE_MS means that connection's process is dead or stopped longer than the server's 30 s keepalive -- its socket is
// closed by the server, so it can send nothing more even if it resumes
export const PRESENCE_BEAT_MS = 10_000
// a sender's own beat must be younger than OWN_BEAT_MAX_MS at its fence (Codex r5 P1: a connection whose heartbeat is not
// being published must not send); peers wait BEAT_STALE_MS >= OWN_BEAT_MAX_MS + the server's 30 s keepalive + margin, so a
// sender suspended right after a passing fence is dropped by the server before any peer may retire it
export const OWN_BEAT_MAX_MS = 15_000
export const BEAT_STALE_MS = 60_000
export const BARRIER_MAX_MS = 10 * 60_000
export const PUBLISH_TRIES = 3

/** The project's file key: `project-<hx>_<hy>_<hz>.<plot>`. */
export const projKey = (home, plot) => `project-${home.x}_${home.y}_${home.z}.${plot}`
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
// ---- SHOWDROP-01: ONE DIRECTORY LISTING A SYNCHRONOUS STRETCH ---------------------------------------------------------------
// LIVE showcase 11-08 (release 0d560d4b): 57 "Timed out" a day. A CPU profile of showcase-Delta / -Gale: 13-17 s busy runs, 55-87%
// in the decision's shopActive, 38-40% of it readdirSync of the town directory (6,777 files): every recordHead / recordGenNow /
// leaseState / stuckAt / openIntents listed the whole directory again, once per project per check. A listing is now kept for the
// rest of the synchronous stretch: dropped at the next turn of the event loop (setImmediate), after LIST_MAX_MS, whenever the
// directory's mtime moved (another process created or removed a file), and after every write this module makes (wfs). Every
// exclusive create ('wx', the lease / barrier / record race) is still decided by the filesystem, never by a listing.
// LISTCACHE=off is the rollback: a fresh readdirSync every call, as before.
export const listCacheOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.LISTCACHE ?? '').trim().toLowerCase())
export const LIST_MAX_MS = 1000
// RACILY CLEAN (git's rule): a directory's mtime has coarse granularity (a jiffy), so a file created in the same tick as the listing
// leaves the mtime unchanged. A listing taken within LIST_RACY_MS of the directory's own mtime is never served again: only a listing
// of a directory that has been still for longer is (a later create then moves the mtime past the listing's).
export const LIST_RACY_MS = 50
const listMem = new Map()        // dir -> { names, at, mtime, matched: Map(re -> names) }
let listDropQueued = false
export const listStats = { reads: 0, hits: 0 }
/** Forget every kept listing (a write, a turn of the event loop). */
export function dropListings () { listMem.clear() }
/** Is a listing of `dir` kept now (the tests' window on the cache)? */
export const listKept = dir => listMem.has(dir)
const dirMtime = dir => { try { return fs.statSync(dir, { bigint: true }).mtimeNs } catch { return null } }
const racy = (mt, now) => mt == null || now - Number(mt / 1_000_000n) < LIST_RACY_MS
/** The directory's names: fs.readdirSync's result (and its throw), kept for the synchronous stretch. Callers never mutate it. */
export function listDir (dir) {
  if (!listCacheOn()) { listStats.reads++; return fs.readdirSync(dir) }
  const now = Date.now()
  const mt = dirMtime(dir)
  const m = listMem.get(dir)
  if (m && !m.racy && mt != null && m.mtime === mt && now - m.at < LIST_MAX_MS) { listStats.hits++; return m.names }
  listStats.reads++
  const names = fs.readdirSync(dir)
  listMem.set(dir, { names, at: now, mtime: mt, racy: racy(mt, now), matched: new Map() })
  if (!listDropQueued) { listDropQueued = true; setImmediate(() => { listDropQueued = false; listMem.clear() }) }
  return names
}
/** The names `re` matches (a regex without the g flag), from the kept listing; the filtered list is kept with it. */
export function listMatch (dir, re) {
  const names = listDir(dir)
  const m = listCacheOn() ? listMem.get(dir) : null
  if (!m || m.names !== names || m.racy) return names.filter(n => re.test(n))
  const k = `${re.source}/${re.flags}`
  let v = m.matched.get(k)
  if (!v) { v = names.filter(n => re.test(n)); m.matched.set(k, v) }
  return v
}
// every mutating fs call of this module drops the kept listings (its own write is seen by its next listing, at once)
const WFS_MUTATORS = new Set(['writeFileSync', 'renameSync', 'unlinkSync', 'linkSync', 'appendFileSync', 'openSync', 'mkdirSync', 'rmSync'])
const wfs = new Proxy(fs, { get: (t, k) => (WFS_MUTATORS.has(k) ? (...a) => { try { return t[k](...a) } finally { dropListings() } } : t[k]) })

function gensOf (dir, re) {
  let names
  try { names = listMatch(dir, re) } catch (e) { if (e?.code === 'ENOENT') return []; throw e }
  return names.map(n => re.exec(n)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b)
}
function writeSynced (f, data, flag = 'wx') {
  const fd = wfs.openSync(f, flag)
  try { fs.writeSync(fd, data); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
function syncDir (dir) { try { const fd = wfs.openSync(dir, 'r'); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } } catch { /* best effort */ } }

// ---- the record --------------------------------------------------------------------------------------------------------------

const recFile = (dir, key, n) => path.join(dir, `${key}.g${n}.json`)
const REC_RE = key => new RegExp(`^${esc(key)}\\.g(\\d+)\\.json$`)

// ---- RECCACHE-01: THE VERIFIED-GENERATION CACHE ------------------------------------------------------------------------------
// LIVE showcase 11-10 (docs/reports/keeperstall-2026-11-10.md, the keeper's CPU profile): recordHead was 35% of a bot's busy CPU and
// one shopActive pass 7-10 s of synchronous record reading -- every call read, parsed and hashed EVERY generation of the record (435
// files, 35 MB in the pool; tidy alone 119 generations, one more an hour). A generation is written once and never rewritten
// (publishRecord: tmp + link), so what the walk needs from a file is kept PER FILE and the walk itself is made again on every call:
//   - a FACT = what one successfully read and parsed generation file says: { recGen, prev, prevSha, sha } and the stat it was read
//     under { ino, size, mtimeNs, ctimeNs }. Keyed by the file's path. Never a verdict, never a head, never the chain's result,
//     never a parsed object, never a failed read or an unparseable file (those are read again on every call).
//   - every call lists the generations and stats EVERY one (no newest-only shortcut); a fact is served only when the stat succeeds
//     and all four fields are the fact's (recFactFresh); anything else is read, parsed and hashed as before.
//   - RACILY CLEAN (the listing's rule above, git's): a file whose mtime or ctime is within REC_RACY_MS of now is read and NOT kept
//     -- an in-place rewrite inside the timestamp's granularity would leave the stat as it was. A fact is kept only when the stat
//     before the read and the stat after it are identical. Once kept, any later change to the file moves its ctime past the fact's.
//   - the head's `rec` is PARSED AFRESH on every call (callers mutate it): from the head generation's raw bytes, kept one Buffer a
//     record and bound to the fact they were read with; when those are not kept (the head moved back to an older generation, or
//     the Buffer was dropped) the head file is read again and must hash to the fact's sha, else the fact is dropped and the walk
//     made again.
// RECCACHE=off|0|false|no is the rollback: recordHeadPlain, the walk as it was. recordChain is untouched (it reads every file).
export const recCacheOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.RECCACHE ?? '').trim().toLowerCase())
export const REC_RACY_MS = 2000
export const REC_FACTS_MAX = 8192
export const REC_HEADS_MAX = 64
export const REC_HEAD_BYTES_MAX = 32 * 1024 * 1024
const REC_WALK_TRIES = 3
/** reads: generation files read by recordHead (either walk); hits: generation files answered from a kept fact. */
export const recStats = { reads: 0, hits: 0 }
const recFacts = new Map()       // path -> { ino, size, mtimeNs, ctimeNs, recGen, prev, prevSha, sha }, least recently used first
// `${dir}\0${key}` -> { fact, buf }: the raw bytes `fact` was read with. Never asked WHICH generation is the head (the walk says):
// only parsed, when the walk's head is this very fact, validated by its stat in this call
const recHeads = new Map()
let recHeadBytes = 0
/** Forget every kept fact and head Buffer, and zero the counters (the tests' reset). */
export function recCacheReset () { recFacts.clear(); recHeads.clear(); recHeadBytes = 0; recStats.reads = 0; recStats.hits = 0 }
/** What is kept now (the tests' window on the bounds). */
export const recCacheSize = () => ({ facts: recFacts.size, heads: recHeads.size, headBytes: recHeadBytes })
const recStat = p => { try { return fs.statSync(p, { bigint: true }) } catch { return null } }
/** May the kept fact `c` answer for a file whose stat is `st` now? Only the same inode, size, mtime and ctime. */
export const recFactFresh = (c, st) => !!c && !!st && c.ino === st.ino && c.size === st.size && c.mtimeNs === st.mtimeNs && c.ctimeNs === st.ctimeNs
/** Racily clean: modified or changed within REC_RACY_MS of `now` (or stamped in the future) -- read, never kept. */
export const recRacy = (st, now) => now - Number((st.mtimeNs > st.ctimeNs ? st.mtimeNs : st.ctimeNs) / 1_000_000n) < REC_RACY_MS
// a value the walk compares with === against a number, a string or null: an object or an array can equal none of them
const recPrim = v => (v !== null && typeof v === 'object' ? undefined : v)
/** Keep `fact` for `p` when the file stood still around its read (the stat before = the stat after) and is not racily clean. */
function recKeep (p, st0, fact, now) {
  const st1 = recStat(p)
  if (!st0 || !recFactFresh(st0, st1) || recRacy(st1, now)) return fact
  const kept = { ino: st1.ino, size: st1.size, mtimeNs: st1.mtimeNs, ctimeNs: st1.ctimeNs, recGen: fact.recGen, prev: fact.prev, prevSha: fact.prevSha, sha: fact.sha }
  recFacts.set(p, kept)
  while (recFacts.size > REC_FACTS_MAX) recFacts.delete(recFacts.keys().next().value)
  fact.kept = kept
  return fact
}
/** One generation file for the walk -> { why } (unreadable | unparseable: never kept) | a kept fact | a fresh read
 *  { recGen, prev, prevSha, sha, rec, buf, kept? } (`rec` parsed in THIS call, never held). */
function recFactOf (p, now) {
  const st0 = recStat(p)
  const c = recFacts.get(p)
  if (c && recFactFresh(c, st0)) { recStats.hits++; recFacts.delete(p); recFacts.set(p, c); return c }
  if (c) recFacts.delete(p)
  recStats.reads++
  let buf
  try { buf = fs.readFileSync(p) } catch { return { why: 'unreadable' } }
  let rec
  try { rec = JSON.parse(buf.toString('utf8')) } catch { return { why: 'unparseable' } }
  return recKeep(p, st0, { recGen: rec ? recPrim(rec.gen) : undefined, prev: rec ? recPrim(rec.prev) : undefined, prevSha: rec ? recPrim(rec.prevSha) : undefined, sha: sha(buf), rec, buf }, now)
}
function recHeadKeep (hk, fact, buf) {
  const old = recHeads.get(hk)
  if (old) { recHeadBytes -= old.buf.length; recHeads.delete(hk) }
  if (buf.length > REC_HEAD_BYTES_MAX) return
  recHeads.set(hk, { fact, buf }); recHeadBytes += buf.length
  while (recHeads.size > REC_HEADS_MAX || recHeadBytes > REC_HEAD_BYTES_MAX) { const [k, v] = recHeads.entries().next().value; recHeads.delete(k); recHeadBytes -= v.buf.length }
}
/** The head's record, parsed for THIS call -> rec | undefined (the head file is no longer the bytes its fact was read from). */
function recHeadRec (dir, key, g, e) {
  const hk = `${dir}\0${key}`
  if (e.buf) { if (e.kept) recHeadKeep(hk, e.kept, e.buf); return e.rec }        // read in this call
  const hb = recHeads.get(hk)
  if (hb && hb.fact === e) return JSON.parse(hb.buf.toString('utf8'))
  const p = recFile(dir, key, g)
  recStats.reads++
  let buf
  try { buf = fs.readFileSync(p) } catch { recFacts.delete(p); return undefined }
  if (sha(buf) !== e.sha) { recFacts.delete(p); return undefined }
  recHeadKeep(hk, e, buf)
  return JSON.parse(buf.toString('utf8'))
}
/** recordHeadPlain's walk over the generations' facts: the same checks in the same order, the same rejections. */
function recWalk (dir, key, gens, now) {
  let head = null
  const rejected = []
  for (const g of gens) {
    const e = recFactOf(recFile(dir, key, g), now)
    if (e.why) { rejected.push({ gen: g, why: e.why }); continue }
    if (e.recGen !== g) { rejected.push({ gen: g, why: 'gen' }); continue }
    if (!head) { if (e.prev !== null) { rejected.push({ gen: g, why: 'no root' }); continue } head = { gen: g, e }; continue }
    if (e.prev !== head.gen || e.prevSha !== head.e.sha) { rejected.push({ gen: g, why: 'chain' }); continue }
    head = { gen: g, e }
  }
  if (!head) return { ok: true, head: null, gens, rejected }
  const rec = recHeadRec(dir, key, head.gen, head.e)
  if (rec === undefined) return null
  return { ok: true, head: { gen: head.gen, sha: head.e.sha, rec }, gens, rejected }
}

/**
 * THE RECORD'S HEAD -> { ok, head: { gen, sha, rec } | null, gens, rejected }. A walk ascending: the root is the lowest file
 * with prev null that parses; each later file is the head only when its prev is the head and its prevSha the head's sha;
 * anything else is rejected (skipped, never deleted). An unreadable directory is ok: false (never "no record").
 * reccache-01: the walk runs over per-file facts (above); `head.rec` is parsed for this call and is the caller's to mutate.
 * `opts.now` is the racy rule's clock, for the tests.
 */
export function recordHead (dir, key, opts) {
  if (!recCacheOn()) return recordHeadPlain(dir, key)
  const now = opts?.now ?? Date.now()            // the racy rule's clock (the tests'; every caller leaves it)
  let gens
  try { gens = gensOf(dir, REC_RE(key)) } catch { return { ok: false, head: null, gens: [], rejected: [] } }
  // a head whose kept bytes are gone and whose file moved between its stat and the read: the fact is dropped and the walk made again
  for (let i = 0; i < REC_WALK_TRIES; i++) { const r = recWalk(dir, key, gens, now); if (r) return r }
  return recordHeadPlain(dir, key)
}
/** The walk as it was before reccache-01 (RECCACHE=off, and the cached walk's last resort): every generation read, parsed, hashed. */
function recordHeadPlain (dir, key) {
  let gens
  try { gens = gensOf(dir, REC_RE(key)) } catch { return { ok: false, head: null, gens: [], rejected: [] } }
  let head = null
  const rejected = []
  for (const g of gens) {
    let buf
    recStats.reads++
    try { buf = fs.readFileSync(recFile(dir, key, g)) } catch { rejected.push({ gen: g, why: 'unreadable' }); continue }
    let rec
    try { rec = JSON.parse(buf.toString('utf8')) } catch { rejected.push({ gen: g, why: 'unparseable' }); continue }
    if (!rec || rec.gen !== g) { rejected.push({ gen: g, why: 'gen' }); continue }
    if (!head) { if (rec.prev !== null) { rejected.push({ gen: g, why: 'no root' }); continue } head = { gen: g, sha: sha(buf), rec }; continue }
    if (rec.prev !== head.gen || rec.prevSha !== head.sha) { rejected.push({ gen: g, why: 'chain' }); continue }
    head = { gen: g, sha: sha(buf), rec }
  }
  return { ok: true, head, gens, rejected }
}
/** gkhelpers-01: THE RECORD'S CHAIN -> [rec] root first, the same walk as recordHead (a rejected file is no link). [] when the
 *  directory cannot be read. Never throws. */
export function recordChain (dir, key) {
  let gens
  try { gens = gensOf(dir, REC_RE(key)) } catch { return [] }
  const out = []
  let head = null
  for (const g of gens) {
    let buf, rec
    try { buf = fs.readFileSync(recFile(dir, key, g)); rec = JSON.parse(buf.toString('utf8')) } catch { continue }
    if (!rec || rec.gen !== g) continue
    if (!head) { if (rec.prev !== null) continue; head = { gen: g, sha: sha(buf) }; out.push(rec); continue }
    if (rec.prev !== head.gen || rec.prevSha !== head.sha) continue
    head = { gen: g, sha: sha(buf) }
    out.push(rec)
  }
  return out
}
/** The record's newest generation NUMBER (a directory listing only; the caller's cache key) -> n | null. Never throws. */
export function recordGenNow (dir, key) { try { return gensOf(dir, REC_RE(key)).at(-1) ?? null } catch { return null } }
/**
 * PUBLISH A TRANSITION -> { result: 'accepted' | 'nothing' | 'lost' | 'error', gen, head }. `mutate(recOrNull)` returns the next
 * body or null; it is re-applied to the new head on a lost race (a rebase). Accepted = in the chain after the link.
 */
export function publishRecord (dir, key, mutate, { now = Date.now(), by = null, tries = PUBLISH_TRIES } = {}) {
  for (let i = 0; i < tries; i++) {
    const h = recordHead(dir, key)
    if (!h.ok) return { result: 'error', gen: null, head: null }
    const base = h.head
    const body = mutate(base ? JSON.parse(JSON.stringify(base.rec)) : null)
    if (!body) return { result: 'nothing', gen: base?.gen ?? null, head: base }
    const n = (h.gens.at(-1) ?? 0) + 1
    const buf = Buffer.from(JSON.stringify({ ...body, gen: n, prev: base ? base.gen : null, prevSha: base ? base.sha : null, at: now, by }))
    const f = recFile(dir, key, n), tmp = `${f}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
    try {
      wfs.mkdirSync(dir, { recursive: true })
      writeSynced(tmp, buf)
      try { wfs.linkSync(tmp, f) } catch (e) { if (e?.code === 'EEXIST') continue; return { result: 'error', gen: null, head: base } }
      syncDir(dir)
    } catch { return { result: 'error', gen: null, head: base } } finally { try { wfs.unlinkSync(tmp) } catch { /* gone */ } }
    const after = recordHead(dir, key)
    if (after.ok && after.head?.gen === n) return { result: 'accepted', gen: n, head: after.head }
  }
  return { result: 'lost', gen: null, head: null }
}

// ---- leases ------------------------------------------------------------------------------------------------------------------

const leaseFile = (dir, key, name, n) => path.join(dir, `${key}.${name}.lease.g${n}.json`)
const LEASE_RE = (key, name) => new RegExp(`^${esc(key)}\\.${esc(name)}\\.lease\\.g(\\d+)\\.json$`)

/**
 * THE LEASE NOW -> { gen, rec, released, holdsUntil, blocksUntil } | null. Never throws: an unreadable directory reads as
 * BLOCKED for ever (never two holders). A torn file (a kill inside the write) blocks until its mtime + ttl + reclaim.
 */
export function leaseState (dir, key, name, { ttl = LEASE_TTL_MS } = {}) {
  try {
    const g = gensOf(dir, LEASE_RE(key, name)).at(-1)
    if (g == null) return null
    const f = leaseFile(dir, key, name, g)
    let mtimeMs = Date.now()
    try { mtimeMs = fs.statSync(f).mtimeMs } catch { /* vanished: as just written */ }
    const rec = readJ(f)
    const released = fs.existsSync(`${f}.released`)
    const until = rec ? Number(rec.until ?? 0) : mtimeMs + ttl
    return { gen: g, rec, released, ...(released ? { releasedAt: releasedAtOf(`${f}.released`) } : {}), holdsUntil: released ? 0 : until, blocksUntil: released ? 0 : until + RECLAIM_MS }
  } catch { return { gen: null, rec: null, released: false, holdsUntil: 0, blocksUntil: Infinity } }
}
/**
 * gkhelpers-01: EVERY LIVE LEASE whose name starts with `prefix` (`seg-`: the record's segment leases) in ONE directory listing ->
 * { name: { holder, at, gen } } held now (unreleased, `until` ahead). The town directory holds thousands of lease generations; one
 * leaseState per segment is one listing each. Never throws: an unreadable directory reads as null (the caller fails closed).
 */
export function liveLeases (dir, key, prefix, now = Date.now()) {
  let names
  try { names = listDir(dir) } catch (e) { return e?.code === 'ENOENT' ? {} : null }
  const re = new RegExp(`^${esc(key)}\\.(${esc(prefix)}[^.]*)\\.lease\\.g(\\d+)\\.json$`)
  const top = new Map()
  for (const n of names) { const m = re.exec(n); if (m && Number(m[2]) > (top.get(m[1]) ?? -1)) top.set(m[1], Number(m[2])) }
  const out = {}
  for (const [name, g] of top) {
    const f = leaseFile(dir, key, name, g)
    if (fs.existsSync(`${f}.released`)) continue
    const rec = readJ(f)
    // a torn generation (unreadable) is held by someone unknown until its reclaim: read as live, holder '?'
    if (!rec) { out[name] = { holder: '?', at: -Infinity, gen: g }; continue }
    if (now < Number(rec.until ?? 0)) out[name] = { holder: rec.holder, at: Number(rec.at), gen: g }
  }
  return out
}
/** A `.released` marker's time: the ms it holds (releaseLease writes Date.now()), else its mtime; null when unreadable. */
function releasedAtOf (f) {
  try { const v = Number(fs.readFileSync(f, 'utf8').trim()); if (Number.isFinite(v) && v > 0) return v } catch { /* the mtime */ }
  try { return fs.statSync(f).mtimeMs } catch { return null }
}
/** Take (or renew) a lease -> { ok, gen } | { ok: false, why }. A NEW GENERATION every time: exactly one taker per number. */
export function takeLease (dir, key, name, holder, { now = Date.now(), ttl = LEASE_TTL_MS, meta = null } = {}) {
  const cur = leaseState(dir, key, name, { ttl })
  if (cur && cur.rec?.holder !== holder && now < cur.blocksUntil) return { ok: false, why: `held by ${cur.rec?.holder ?? 'an unreadable lease'}` }
  const n = (cur?.gen ?? 0) + 1
  // STRICTLY AFTER THE RELEASE (wall-01; showcase tripwire 10-30 H4 lease_overlap, monument slot1 g163 "Iris took it at ...264,
  // Comet held it until ...268", and seg-clear g742, 2 ms): `now` is the caller's clock, read BEFORE this call listed the
  // generations -- in a town directory of 13k files that listing takes milliseconds, and the holder's `.released` marker (its own
  // Date.now()) was written inside them. The take only happens because the marker was SEEN, so it is later than the marker: the
  // new generation is stamped no earlier than the release it follows, and its `until` runs from that stamp.
  const at = Math.max(now, Number(cur?.releasedAt) || -Infinity)
  try {
    wfs.mkdirSync(dir, { recursive: true })
    writeSynced(leaseFile(dir, key, name, n), JSON.stringify({ holder, at, until: at + ttl, ...(meta ? { meta } : {}) }))
  } catch { return { ok: false, why: 'lost the race for the lease' } }
  if (gensOf(dir, LEASE_RE(key, name)).at(-1) !== n) return { ok: false, why: 'a later lease generation exists' }
  return { ok: true, gen: n }
}
/** Do we hold the lease's NEWEST generation, unexpired and unreleased? (`gen` null: any generation of ours.) */
export function holdsLease (dir, key, name, holder, gen = null, now = Date.now()) {
  const cur = leaseState(dir, key, name)
  return !!cur && cur.rec?.holder === holder && (gen == null || cur.gen === gen) && now < cur.holdsUntil
}
/** Renew our lease -> the new generation | null (no longer ours). */
export function renewLease (dir, key, name, holder, gen, { now = Date.now(), ttl = LEASE_TTL_MS } = {}) {
  if (!holdsLease(dir, key, name, holder, gen, now)) return null
  const r = takeLease(dir, key, name, holder, { now, ttl })
  return r.ok ? r.gen : null
}
/** Release (a marker; the generation is never deleted). Ours by name and generation, whatever the clock. Never throws. */
export function releaseLease (dir, key, name, holder, gen) {
  try { const cur = leaseState(dir, key, name); if (cur && cur.gen === gen && cur.rec?.holder === holder) wfs.writeFileSync(`${leaseFile(dir, key, name, gen)}.released`, String(Date.now())) } catch { /* lapses */ }
}
/** AN ADMISSION SLOT (k = 1..max) -> { ok, slot, gen } | { ok: false, why }. Ours already: renewed in place. */
export function takeSlot (dir, key, holder, max, opts = {}) {
  for (let k = 1; k <= max; k++) if (holdsLease(dir, key, `slot${k}`, holder, null, opts.now)) { const r = takeLease(dir, key, `slot${k}`, holder, opts); return r.ok ? { ok: true, slot: k, gen: r.gen } : r }
  for (let k = 1; k <= max; k++) { const r = takeLease(dir, key, `slot${k}`, holder, opts); if (r.ok) return { ok: true, slot: k, gen: r.gen } }
  return { ok: false, why: `all ${max} slots held` }
}

// ---- the mutex (D7) -------------------------------------------------------------------------------------------------------

const mutexFile = (dir, key, n) => path.join(dir, `${key}.mutate.g${n}.json`)
const MUTEX_RE = key => new RegExp(`^${esc(key)}\\.mutate\\.g(\\d+)\\.json$`)
/** Is a pid alive on this host? (EPERM: alive, another user's.) */
export const pidAlive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' } }
/**
 * THE MUTEX NOW -> { gen, rec, held, why }. Throws on an unreadable directory (the taker reads that as busy). The NEWEST
 * generation decides: released (its marker) -> free; torn (a kill inside the write) -> held for MUTEX_TORN_MS from its mtime;
 * its pid dead -> free; its holder's presence written AFTER it names another CONNECTION (the holder restarted -- under a new pid
 * or the very same reused one: Codex r2 P2, a pid is not an incarnation) -> free; its holder RETIRED (`gone(rec)`: offline on the
 * server since AFTER the lock was taken, as the taker has seen it: holderGone -- an offline holder cannot send, and after its
 * reconnect it takes the mutex anew)
 * -> free; otherwise HELD, however old (no age reclaim: Codex r1 P1, a suspended live holder must not be displaced while it may
 * still send).
 */
export function mutexState (dir, key, { now = Date.now(), alive = pidAlive, gone = () => false } = {}) {
  const g = gensOf(dir, MUTEX_RE(key)).at(-1)
  if (g == null) return { gen: 0, rec: null, held: false, why: 'none' }
  const f = mutexFile(dir, key, g)
  const rec = readJ(f)
  if (fs.existsSync(`${f}.released`)) return { gen: g, rec, held: false, why: 'released' }
  if (!rec) { let m = now; try { m = fs.statSync(f).mtimeMs } catch { /* vanished: as just written */ } return { gen: g, rec: null, held: now - m < MUTEX_TORN_MS, why: 'torn' } }
  if (Number.isInteger(rec.pid) && !alive(rec.pid)) return { gen: g, rec, held: false, why: 'dead' }
  const pr = presenceRead(dir, key, rec.holder)
  const other = rec.conn ? !!pr?.conn && pr.conn !== rec.conn : Number.isInteger(pr?.pid) && pr.pid !== rec.pid
  if (pr && other && Number(pr.at) > Number(rec.at)) return { gen: g, rec, held: false, why: 'superseded' }
  try { if (gone(rec)) return { gen: g, rec, held: false, why: 'retired' } } catch { /* unknown: held */ }
  return { gen: g, rec, held: true, why: 'held' }
}
/**
 * TAKE THE MUTEX, NON-BLOCKING -> { ok: true, gen } | { ok: false, why }. A free newest generation N is taken by creating N+1
 * EXCLUSIVELY: of any number of takers that saw N free, exactly one creates N+1, and the others get EEXIST (busy). Nothing is
 * ever renamed or deleted under a holder. The created generation must still be the newest (a taker that read the listing long
 * ago, after the pruning, cannot hold beside a newer generation). Old generations beyond MUTEX_KEEP are pruned.
 */
export function mutexTake (dir, key, holder, { now = Date.now(), pid = process.pid, conn = null, alive = pidAlive, gone = () => false } = {}) {
  let st
  try { st = mutexState(dir, key, { now, alive, gone }) } catch { return { ok: false, why: 'busy (unreadable)' } }
  if (st.held) return { ok: false, why: `busy (${st.rec?.holder ?? 'torn'})` }
  const n = st.gen + 1, f = mutexFile(dir, key, n)
  try { wfs.mkdirSync(dir, { recursive: true }); writeSynced(f, JSON.stringify({ holder, pid, conn, at: now })) } catch { return { ok: false, why: 'busy (lost the race)' } }
  let gens = []
  try { gens = gensOf(dir, MUTEX_RE(key)) } catch { /* judged below */ }
  if (gens.at(-1) !== n) { try { wfs.writeFileSync(`${f}.released`, String(now)) } catch { /* not the newest: never decides */ } return { ok: false, why: 'busy (a newer generation)' } }
  for (const g of gens) if (g <= n - MUTEX_KEEP) { for (const x of [mutexFile(dir, key, g), `${mutexFile(dir, key, g)}.released`]) { try { wfs.unlinkSync(x) } catch { /* gone */ } } }
  return { ok: true, gen: n, ...(['dead', 'superseded', 'torn', 'retired'].includes(st.why) ? { reclaimed: st.rec?.holder ?? 'torn' } : {}) }
}
/** Release the mutex: our own generation only (holder and pid; `gen` omitted: the newest). A marker, never a delete. Never throws. */
export function mutexRelease (dir, key, holder, { pid = process.pid, gen = null } = {}) {
  try {
    const g = gen ?? gensOf(dir, MUTEX_RE(key)).at(-1)
    if (g == null) return
    const f = mutexFile(dir, key, g)
    const rec = readJ(f)
    if (rec && rec.holder === holder && rec.pid === pid) wfs.writeFileSync(`${f}.released`, String(Date.now()))
  } catch { /* lapses only with the process */ }
}

// ---- presence (r2: a holder's connection, for the mutex and for retirement) -------------------------------------------------

const presenceFile = (dir, key, holder) => path.join(dir, `${key}.presence.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
/** Write the holder's current connection (at every login): a temp file renamed into place. Never throws. */
export function presenceWrite (dir, key, holder, { conn, pid = process.pid, now = Date.now(), beat = null, sync = true } = {}) {
  try {
    wfs.mkdirSync(dir, { recursive: true })
    const f = presenceFile(dir, key, holder), tmp = `${f}.${pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
    const body = JSON.stringify({ holder, conn, pid, at: now, beat: beat ?? now })   // at: the connection's login; beat: now
    if (sync) writeSynced(tmp, body); else wfs.writeFileSync(tmp, body)
    wfs.renameSync(tmp, f)
  } catch { /* the other retirement evidence still applies */ }
}
/** The holder's presence -> { holder, conn, pid, at } | null. */
export function presenceRead (dir, key, holder) { return readJ(presenceFile(dir, key, holder)) }

// ---- stuck cells (F4, Paper 10-26 SHOP-TERRAIN hive-c: an ordinary record cell no stand reaches stopped every visit) -------------

// ONE FILE PER HOLDER (Codex r21 P2: one shared map, read-increment-replace, lost a concurrent builder's increments). A holder
// writes only its own file, so no update is lost; a reader SUMS the holders' visits per cell.
const stuckFile = (dir, key, holder) => path.join(dir, `${key}.stuck.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
const stuckNames = (dir, key) => {
  try { const re = new RegExp(`^${esc(key)}\\.stuck\\..+\\.json$`); return listMatch(dir, re) } catch { return [] }
}
const stuckCells = j => {
  const out = {}
  for (const [k, v] of Object.entries(j?.cells ?? {})) if (/^-?\d+,-?\d+,-?\d+$/.test(k) && Number.isFinite(Number(v?.visits)) && Number(v.visits) > 0) out[k] = { visits: Math.floor(Number(v.visits)), firstAt: Number(v.firstAt) || null, lastAt: Number(v.lastAt) || null, by: v.by ?? null }
  return out
}
/** The record cells visits found with NO stand -> { 'x,y,z': { visits, firstAt, lastAt, by } } ({} when none or unreadable).
 *  `holder` given: that holder's own file only. Otherwise every holder's, visits SUMMED per cell (`by` the latest). */
export function stuckRead (dir, key, { holder = null, exclude = null, since = null } = {}) {
  // `since`: each HOLDER's entries older than it are dropped BEFORE the sum (Codex r23 P2: filtered after, one fresh holder's
  // newest lastAt carried every stale holder's visits into the count)
  const keep = c => since == null ? c : Object.fromEntries(Object.entries(c).filter(([, v]) => (v.lastAt ?? 0) >= since))
  if (holder != null) return keep(stuckCells(readJ(stuckFile(dir, key, holder))))
  const out = {}
  const skip = exclude != null ? path.basename(stuckFile(dir, key, exclude)) : null
  for (const n of stuckNames(dir, key).filter(x => x !== skip)) {
    for (const [k, v] of Object.entries(keep(stuckCells(readJ(path.join(dir, n)))))) {
      const o = out[k]
      if (!o) { out[k] = { ...v }; continue }
      out[k] = { visits: o.visits + v.visits, firstAt: Math.min(o.firstAt ?? Infinity, v.firstAt ?? Infinity) === Infinity ? null : Math.min(o.firstAt ?? Infinity, v.firstAt ?? Infinity), lastAt: Math.max(o.lastAt ?? 0, v.lastAt ?? 0) || null, by: (v.lastAt ?? 0) > (o.lastAt ?? 0) ? v.by : o.by }
    }
  }
  return out
}
/** When a visit last reported stuck_on_cell, over every holder's file (or `holder`'s) -> ms | null. The order's back-off reads
 *  this, so it holds for the PROJECT across restarts and across bots (Claude r21 P3-3), not per bot in memory. */
export function stuckAt (dir, key, { holder = null, before = Infinity, stale = null } = {}) {
  // `before`: a stamp later than it (a skewed or bad clock) is dropped BEFORE the latest is taken (Codex r23 P2: one future stamp
  // won the max and the guard then discarded it, masking every holder's valid stamp)
  // `stale(cellKeys)` (zigtidy-02, LIVE showcase 10-30 22:27Z: Bravo's refused voidfill visit stamped two cells a racing visit
  // filled the same minute; the finished ziggurat's next repair would have waited 6 h): true drops that holder's stamp
  let best = null
  for (const n of holder != null ? [path.basename(stuckFile(dir, key, holder))] : stuckNames(dir, key)) {
    const j = readJ(path.join(dir, n))
    const t = Number(j?.stuckAt)
    if (!(Number.isFinite(t) && t > 0 && t <= before && (best == null || t > best))) continue
    if (typeof stale === 'function') { let s = false; try { s = !!stale(Object.keys(stuckCells(j))) } catch { s = false } if (s) continue }
    best = t
  }
  return best
}
/** Replace THIS HOLDER's stuck map (temp + rename, fsynced) -> true | false (never throws; the caller fails closed on false). */
export function stuckWrite (dir, key, holder, cells, { now = Date.now(), stuckAt = null } = {}) {
  try {
    wfs.mkdirSync(dir, { recursive: true })
    const f = stuckFile(dir, key, holder), tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
    writeSynced(tmp, JSON.stringify({ v: 2, holder, at: now, stuckAt: Number.isFinite(stuckAt) ? stuckAt : null, cells: cells ?? {} }))
    wfs.renameSync(tmp, f)
    return true
  } catch { return false }
}

// ---- drawn (Paper 10-25 SHOP-KILL / CHAIN-1: the project's materials in the holder's bag) --------------------------------------

const drawnFile = (dir, key, holder) => path.join(dir, `${key}.drawn.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
const counts = m => Object.fromEntries(Object.entries(m ?? {}).map(([n, c]) => [n, Math.floor(Number(c))]).filter(([, c]) => Number.isFinite(c) && c > 0))
/** What this holder drew from town for the project and has not placed or banked back -> { drawn: { name: n }, bag: { name: n }, at }
 *  (`bag`: the bag's count of each drawn name when it was written -- the baseline a later decrease is measured from). Both {}
 *  when the file is absent or unreadable; only counts (finite, > 0) survive the read. */
export function drawnRead (dir, key, holder) {
  const j = readJ(drawnFile(dir, key, holder))
  return { drawn: counts(j?.drawn), bag: counts(j?.bag), at: Number.isFinite(Number(j?.at)) ? Number(j.at) : null }
}
/** Replace the holder's drawn counts and their bag baseline (a temp file renamed into place, fsynced). -> true | false (never
 *  throws; the caller counts a failure). */
export function drawnWrite (dir, key, holder, drawn, { bag = {}, now = Date.now() } = {}) {
  try {
    wfs.mkdirSync(dir, { recursive: true })
    const f = drawnFile(dir, key, holder), tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
    const d = counts(drawn)
    writeSynced(tmp, JSON.stringify({ v: 1, holder, at: now, drawn: d, bag: Object.fromEntries(Object.keys(d).map(n => [n, Math.max(0, Math.floor(Number(bag?.[n]) || 0))])) }))
    wfs.renameSync(tmp, f)
    return true
  } catch { return false }
}

// ---- gkhelpers-01: the crew's pantry -------------------------------------------------------------------------------------------
// What each grounds-crew bot carries for the park (its park plants), so the keeper's top-up knows what the crew can plant: banking
// them is not open to it (towndeposit.mjs notForChest: saplings, bamboo, poppy, dandelion never go in a chest -- owner 10-04).
const pantryFile = (dir, key, holder) => path.join(dir, `${key}.pantry.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
const PANTRY_RE = key => new RegExp(`^${esc(key)}\\.pantry\\.[A-Za-z0-9_-]+\\.json$`)
/** Replace the holder's pantry (a temp file renamed into place). -> true | false (never throws). */
export function pantryWrite (dir, key, holder, items, { now = Date.now() } = {}) {
  try {
    wfs.mkdirSync(dir, { recursive: true })
    const f = pantryFile(dir, key, holder), tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
    writeSynced(tmp, JSON.stringify({ v: 1, holder, at: now, items: counts(items) }))
    wfs.renameSync(tmp, f)
    return true
  } catch { return false }
}
/** Every crew pantry -> { holder: { at, items } }. {} when none or unreadable (an unread pantry is nothing carried). */
export function pantryRead (dir, key) {
  const out = {}
  let names = []
  try { names = listMatch(dir, PANTRY_RE(key)) } catch { return out }
  for (const n of names) { const r = readJ(path.join(dir, n)); if (r?.holder && r.items && typeof r.items === 'object') out[r.holder] = { at: Number(r.at) || 0, items: r.items } }
  return out
}

// ---- access-02: the climbs ledger ----------------------------------------------------------------------------------------------
const climbFile = (dir, holder) => path.join(dir, `climbs-${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`)
const CLIMB_RE = /^climbs-[A-Za-z0-9_-]+\.jsonl$/
/** Append one climb ({ x, y, z, shape, reason, t }) to this bot's ledger; past `maxLines` the file is rewritten with its newest
 *  `keepLines`. -> true | false. Never throws. */
export function climbAppend (dir, holder, c, { maxLines = 2000, keepLines = 1000 } = {}) {
  try {
    wfs.mkdirSync(dir, { recursive: true })
    const f = climbFile(dir, holder)
    wfs.appendFileSync(f, JSON.stringify({ x: c.x, y: c.y, z: c.z, shape: c.shape, reason: c.reason, t: c.t, by: holder }) + '\n')
    let n = 0
    try { n = fs.statSync(f).size } catch { n = 0 }
    if (n > maxLines * 50) {   // a line is >= 60 bytes: past this the lines are counted, and trimmed past maxLines
      const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
      if (lines.length > maxLines) { const tmp = `${f}.${process.pid}.tmp`; wfs.writeFileSync(tmp, lines.slice(-keepLines).join('\n') + '\n'); wfs.renameSync(tmp, f) }
    }
    return true
  } catch { return false }
}
/**
 * Codex r1 BLOCKER (access-02): the placement observer never waits on the disk -- climbEnqueue only queues (bounded: QMAX, a full queue
 * drops the climb, counted) and an unref'd timer writes the batch with fs.promises off the placement's continuation. Never throws.
 */
const climbQ = []
let climbTimer = null, climbBusy = false
export const climbStats = { queued: 0, dropped: 0, written: 0, failed: 0 }
const CLIMB_QMAX = 64
export function climbEnqueue (dir, holder, c, opts = {}) {
  try {
    if (climbQ.length >= CLIMB_QMAX) { climbStats.dropped++; return false }
    climbQ.push({ dir, holder, c, opts }); climbStats.queued++
    if (!climbTimer) { climbTimer = setTimeout(() => { climbTimer = null; void climbFlush() }, 250); climbTimer.unref?.() }
    return true
  } catch { return false }
}
/** Write the queued climbs (async; one batch at a time). -> the count written. Never throws. */
export async function climbFlush () {
  if (climbBusy || !climbQ.length) return 0
  climbBusy = true
  let n = 0
  try {
    const batch = climbQ.splice(0, climbQ.length)
    const byFile = new Map()
    for (const q of batch) { const f = climbFile(q.dir, q.holder); const e = byFile.get(f) ?? { q, lines: [] }; e.lines.push(JSON.stringify({ x: q.c.x, y: q.c.y, z: q.c.z, shape: q.c.shape, reason: q.c.reason, t: q.c.t, by: q.holder })); byFile.set(f, e) }
    for (const [f, e] of byFile) {
      try {
        await fs.promises.mkdir(e.q.dir, { recursive: true })
        await fs.promises.appendFile(f, e.lines.join('\n') + '\n')
        n += e.lines.length; climbStats.written += e.lines.length
        const { maxLines = 2000, keepLines = 1000 } = e.q.opts ?? {}
        const st = await fs.promises.stat(f)
        if (st.size > maxLines * 50) {
          const lines = (await fs.promises.readFile(f, 'utf8')).split('\n').filter(Boolean)
          if (lines.length > maxLines) { const tmp = `${f}.${process.pid}.tmp`; await fs.promises.writeFile(tmp, lines.slice(-keepLines).join('\n') + '\n'); await fs.promises.rename(tmp, f) }
        }
      } catch { climbStats.failed += e.lines.length }
    }
  } finally { climbBusy = false }
  if (climbQ.length && !climbTimer) { climbTimer = setTimeout(() => { climbTimer = null; void climbFlush() }, 250); climbTimer.unref?.() }
  return n
}
/** Every bot's climbs since `since` -> [{ x, y, z, shape, reason, t, by }]. [] when none or unreadable (an unread ledger is no climb). */
export function climbRead (dir, { since = -Infinity } = {}) {
  const out = []
  let names = []
  try { names = listMatch(dir, CLIMB_RE) } catch { return out }
  for (const n of names) {
    let txt = ''
    try { txt = fs.readFileSync(path.join(dir, n), 'utf8') } catch { continue }
    for (const l of txt.split('\n')) { if (!l) continue; let r; try { r = JSON.parse(l) } catch { continue } if ([r?.x, r?.y, r?.z, r?.t].every(Number.isFinite) && r.t >= since) out.push(r) }
  }
  return out
}

// ---- intents ------------------------------------------------------------------------------------------------------------------

const intentFile = (dir, key, holder) => path.join(dir, `${key}.intents.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`)
const appendSynced = (f, line) => { const fd = wfs.openSync(f, 'a'); try { fs.writeSync(fd, line); fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
/** APPEND AN OPEN INTENT and fsync it (step 1, before the mutex) -> its id. Throws on a write failure: no intent, no click. */
export function intentOpen (dir, key, holder, { cell, block, lease, seq, conn = null, now = Date.now() }) {
  const id = `${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  wfs.mkdirSync(dir, { recursive: true })
  appendSynced(intentFile(dir, key, holder), JSON.stringify({ op: 'open', id, holder, cell, block, lease, seq, conn, at: now }) + '\n')
  return id
}
/** Close an intent: 'settled' (with the state the acknowledgement left in the cell) or 'cancelled'. Never throws. */
export function intentClose (dir, key, holder, id, op, { state = null, now = Date.now() } = {}) {
  try { appendSynced(intentFile(dir, key, holder), JSON.stringify({ op, id, holder, state, at: now }) + '\n') } catch { /* stays open: the barrier waits */ }
}
/** EVERY HOLDER'S OPEN INTENTS -> [{ holder, id, cell, block, lease, seq, at }]. A torn line is skipped (its intent reads open). */
export function openIntents (dir, key) {
  const out = []
  let names = []
  const re = new RegExp(`^${esc(key)}\\.intents\\..+\\.jsonl$`)
  try { names = listMatch(dir, re) } catch { return out }
  for (const n of names) {
    const open = new Map()
    let text = ''
    try { text = fs.readFileSync(path.join(dir, n), 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let r
      try { r = JSON.parse(line) } catch { continue }
      if (r.op === 'open') open.set(r.id, r); else if (r.op === 'settled' || r.op === 'cancelled') open.delete(r.id)
    }
    for (const r of open.values()) out.push({ holder: r.holder, id: r.id, cell: r.cell, block: r.block, lease: r.lease, seq: r.seq, conn: r.conn ?? null, at: r.at })
  }
  return out
}
/**
 * CLOSE THIS HOLDER'S OWN LEFTOVERS at a visit's start (Claude r1 P2-2, Codex r1 P2): an open intent of ANOTHER connection of ours
 * is cancelled (that connection is gone: the server allows one per name, so it can deliver nothing more); one of THIS connection
 * whose sequence the server has already acknowledged (`acked`) is settled. -> { settled, cancelled }. Never throws.
 */
export function closeOwn (dir, key, holder, { conn = null, acked = 0, now = Date.now() } = {}) {
  const r = { settled: 0, cancelled: 0 }
  try {
    for (const i of openIntents(dir, key).filter(x => x.holder === holder)) {
      if (conn && i.conn !== conn) { intentClose(dir, key, holder, i.id, 'cancelled', { now }); r.cancelled++ } else if (Number.isInteger(i.seq) && i.seq <= acked) { intentClose(dir, key, holder, i.id, 'settled', { state: 'ack', now }); r.settled++ }
    }
  } catch { /* the barrier keeps waiting: safe */ }
  return r
}
/**
 * IS AN OPEN INTENT'S SENDER RETIRED? (its connection can deliver nothing more) Pure. Any one of:
 *   - its holder's PRESENCE, written after the intent, names another connection (the holder reconnected);
 *   - holderGone (below) for the intent's own connection and time.
 */
export function intentRetired (i, { presence = null, online = true, offlineSince = null, now = Date.now() } = {}) {
  if (presence?.conn && i?.conn && presence.conn !== i.conn && Number(presence.at) > Number(i.at)) return true
  return holderGone(Number(i?.at), { conn: i?.conn ?? null, presence, online, offlineSince, now })
}
/**
 * HAS THE CONNECTION `conn` THAT DID SOMETHING AT `since` GONE AWAY? Pure. ALL of (Codex r3 P1, r4 P1, r5 P1):
 *   - FAIL CLOSED: the holder's presence is readable, names `conn` and carries a beat -- no presence, an unreadable one, one
 *     naming another connection (the callers' superseded rule) or no `conn` on the lock/intent is NO evidence of anything;
 *   - that beat is BEAT_STALE_MS old or more (the sender fences itself at OWN_BEAT_MAX_MS: a connection that cannot publish its
 *     beat does not send, so a stale beat means a dead process or one stopped past the server's keepalive);
 *   - the tab list has not shown the holder for OFFLINE_RETIRE_MS, first noticed missing AFTER `since`.
 * -> boolean
 */
export function holderGone (since, { conn = null, presence = null, online = true, offlineSince = null, now = Date.now() } = {}) {
  if (!Number.isFinite(since)) return false
  if (!presence?.conn || !conn || presence.conn !== conn || !Number.isFinite(Number(presence.beat))) return false
  if (now - Number(presence.beat) < BEAT_STALE_MS) return false
  return !online && offlineSince != null && offlineSince > since && now - offlineSince >= OFFLINE_RETIRE_MS
}

// ---- SHOWDROP-01: PRUNING SUPERSEDED LEASE AND BARRIER GENERATIONS ---------------------------------------------------------------
// The showcase's town directory held 6,777 files on 11-08, most of them lease and barrier generations no reader ever opens again:
// leaseState, liveLeases, takeLease and barrierState read only a family's NEWEST generation (gensOf(...).at(-1)). A generation is
// pruned (its file and its `.released` marker) only when ALL hold: it is a lease (`<key>.<name>.lease.g<N>.json`) or a barrier
// (`<key>.barrier.g<N>.json`); a NEWER generation of the same family exists (the newest is never touched: the next take numbers
// from it); it is released (a marker) or, a lease, expired (`until`); and its file and marker are older than PRUNE_AGE_MS by mtime.
// NEVER a record generation (`<key>.g<N>.json`: recordHead walks every one from the root), a mutex (its own MUTEX_KEEP), an intent,
// presence, stuck, drawn, pantry or climb file. POOLPRUNE=off: nothing; POOLPRUNE=dry: count only; on: the caller's first pass of a
// process is a dry count (logged), later passes delete at most PRUNE_MAX files each.
export const PRUNE_AGE_MS = 48 * 3600_000
export const PRUNE_MAX = 500
export const poolPruneMode = (env = process.env) => {
  const v = String(env?.POOLPRUNE ?? '').trim().toLowerCase()
  return ['off', '0', 'false', 'no'].includes(v) ? 'off' : v === 'dry' ? 'dry' : 'on'
}
const PRUNE_RE = /^(.+)\.(lease|barrier)\.g(\d+)\.json$/
/** The pruneable generations -> [{ file, marker, fam, gen }] (oldest first). Pure over the listing and the stat/read callbacks. */
export function pruneCandidates (names, { now = Date.now(), age = PRUNE_AGE_MS, mtime, read } = {}) {
  const set = new Set(names)
  const fams = new Map()
  for (const n of names) {
    const m = PRUNE_RE.exec(n)
    if (!m) continue
    // a barrier is `<key>.barrier.g<N>`; a lease is `<key>.<name>.lease.g<N>` -- the family is everything before `.g<N>.json`
    const fam = `${m[1]}.${m[2]}`
    if (!fams.has(fam)) fams.set(fam, [])
    fams.get(fam).push({ gen: Number(m[3]), file: n, kind: m[2] })
  }
  const out = []
  for (const [fam, gens] of fams) {
    const top = Math.max(...gens.map(g => g.gen))
    for (const g of gens) {
      if (g.gen >= top) continue                                   // the newest generation: never
      const marker = `${g.file}.released`
      const released = set.has(marker)
      const t1 = mtime(g.file), t2 = released ? mtime(marker) : null
      if (t1 == null || now - t1 < age || (released && (t2 == null || now - t2 < age))) continue
      if (!released) {
        if (g.kind !== 'lease') continue                           // an unreleased barrier: kept
        const rec = read(g.file)
        if (!rec || !Number.isFinite(Number(rec.until)) || now - Number(rec.until) < age) continue   // unreadable or not long expired: kept
      }
      out.push({ file: g.file, marker: released ? marker : null, fam, gen: g.gen })
    }
  }
  return out.sort((a, b) => a.gen - b.gen)
}
/** One pass over `dir` -> { mode, candidates, deleted, errors }. `dry` (or POOLPRUNE=dry) deletes nothing. Never throws. */
export function prunePool (dir, { now = Date.now(), dry = false, max = PRUNE_MAX, env = process.env } = {}) {
  const mode = poolPruneMode(env)
  if (mode === 'off') return { mode, candidates: 0, deleted: 0, errors: 0 }
  let names
  try { names = fs.readdirSync(dir) } catch { return { mode, candidates: 0, deleted: 0, errors: 1 } }
  const st = f => { try { return fs.statSync(path.join(dir, f)).mtimeMs } catch { return null } }
  const cands = pruneCandidates(names, { now, mtime: st, read: f => readJ(path.join(dir, f)) })
  if (dry || mode === 'dry') return { mode: 'dry', candidates: cands.length, deleted: 0, errors: 0 }
  let deleted = 0, errors = 0
  for (const c of cands.slice(0, max)) {
    // the marker first: a generation whose file is gone but whose marker stays is still nothing any reader opens
    for (const f of [c.marker, c.file]) { if (!f) continue; try { wfs.unlinkSync(path.join(dir, f)); deleted++ } catch (e) { if (e?.code !== 'ENOENT') errors++ } }
  }
  return { mode, candidates: cands.length, deleted, errors }
}

// ---- the barrier ------------------------------------------------------------------------------------------------------------

const barFile = (dir, key, n) => path.join(dir, `${key}.barrier.g${n}.json`)
const BAR_RE = key => new RegExp(`^${esc(key)}\\.barrier\\.g(\\d+)\\.json$`)
/** THE BARRIER NOW -> { gen, rec, active } | null. Active: not released and younger than BARRIER_MAX_MS (a dead holder's lapses). */
export function barrierState (dir, key, now = Date.now()) {
  try {
    const g = gensOf(dir, BAR_RE(key)).at(-1)
    if (g == null) return null
    const rec = readJ(barFile(dir, key, g))
    const released = fs.existsSync(`${barFile(dir, key, g)}.released`)
    return { gen: g, rec, active: !released && (!rec || now - Number(rec.at ?? 0) < BARRIER_MAX_MS) }
  } catch { return { gen: null, rec: null, active: true } }
}
/** TAKE THE BARRIER (the caller holds the mutex) -> { ok, gen } | { ok: false, why }. Another's active barrier refuses. */
export function barrierTake (dir, key, holder, { why = 'closer', cell = null, now = Date.now() } = {}) {
  const cur = barrierState(dir, key, now)
  if (cur?.active && cur.rec?.holder !== holder) return { ok: false, why: `barrier held by ${cur.rec?.holder ?? 'unreadable'}` }
  if (cur?.active && cur.rec?.holder === holder) return { ok: true, gen: cur.gen }
  const n = (cur?.gen ?? 0) + 1
  try { wfs.mkdirSync(dir, { recursive: true }); writeSynced(barFile(dir, key, n), JSON.stringify({ holder, why, cell, at: now })) } catch { return { ok: false, why: 'lost the race for the barrier' } }
  return gensOf(dir, BAR_RE(key)).at(-1) === n ? { ok: true, gen: n } : { ok: false, why: 'a later barrier exists' }
}
/** Release our barrier. Never throws. */
export function barrierRelease (dir, key, holder, gen) {
  try { const cur = barrierState(dir, key); if (cur && cur.gen === gen && cur.rec?.holder === holder) wfs.writeFileSync(`${barFile(dir, key, gen)}.released`, String(Date.now())) } catch { /* lapses */ }
}
/**
 * MAY THE BARRIER'S HOLDER CLICK? -> { clear, waiting: [intent] }. Every OTHER holder's open intent must be settled or cancelled,
 * or its sender RETIRED (`isRetired(intent, now)`: intentRetired over what this bot has seen). Never a timer.
 */
export function barrierClear (dir, key, holder, { isRetired = () => false, now = Date.now() } = {}) {
  const waiting = openIntents(dir, key).filter(i => i.holder !== holder && !isRetired(i, now))
  return { clear: waiting.length === 0, waiting }
}

// ---- the fence (step 3) ---------------------------------------------------------------------------------------------------------

/**
 * MAY THIS SENDER CLICK NOW? -> null | the reason not to. Checked under the mutex, immediately before the send: the slot lease and
 * the segment lease still ours at their newest generations, the record still at the generation the step was planned on, no
 * other holder's active barrier, and (`beatConn`: the sender's connection) OUR OWN HEARTBEAT published for this connection and
 * younger than OWN_BEAT_MAX_MS -- a sender that cannot be seen alive by its peers does not send (Codex r5 P1).
 */
export function fenceRefusal (dir, key, holder, { slot, slotGen, seg, segGen, recordGen, beatConn = null, now = Date.now() }) {
  if (!holdsLease(dir, key, `slot${slot}`, holder, slotGen, now)) return 'slot'
  if (!holdsLease(dir, key, `seg-${seg}`, holder, segGen, now)) return 'segment'
  const h = recordHead(dir, key)
  if (!h.ok || h.head?.gen !== recordGen) return 'record'
  const b = barrierState(dir, key, now)
  if (b?.active && b.rec?.holder !== holder) return 'barrier'
  if (beatConn) { const pr = presenceRead(dir, key, holder); if (!pr || pr.conn !== beatConn || !(now - Number(pr.beat) < OWN_BEAT_MAX_MS)) return 'beat' }
  return null
}
