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
//   THE MUTEX      `project-<...>.mutate.lock` around every final check and send. D7 (named deviation): the design asks for a
//                  kernel flock through a native binding; none is installed, so it is an EXCLUSIVE-CREATE lockfile carrying the
//                  holder's pid, reclaimed only when that process is dead or the hold is past MUTEX_STALE_MS (a sender
//                  releases at settlement or after MUTEX_HOLD_MS). Taken non-blocking: busy is a free skip of that click.
//   INTENTS        `project-<...>.intents.<holder>.jsonl`, appended and fsynced BEFORE the mutex: open {id, cell, block, lease,
//                  seq}, then settled {id, state} on the server's acknowledgement of that sequence, or cancelled.
//   THE BARRIER    `project-<...>.barrier.g<N>.json`: a closer cell or a fallback transition takes it under the mutex; from then
//                  no other sender passes the fence; the holder waits for every other holder's open intent to be settled,
//                  cancelled, or its sender RETIRED (playerLeft + RETIRE_MS), never on a timer, then clicks and releases it.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const LEASE_TTL_MS = 4 * 60_000
export const RECLAIM_MS = 60_000
export const MUTEX_HOLD_MS = 5_000
export const MUTEX_STALE_MS = 15_000
export const RETIRE_MS = 1_000
export const BARRIER_MAX_MS = 10 * 60_000
export const PUBLISH_TRIES = 3

/** The project's file key: `project-<hx>_<hy>_<hz>.<plot>`. */
export const projKey = (home, plot) => `project-${home.x}_${home.y}_${home.z}.${plot}`
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
function gensOf (dir, re) {
  let names
  try { names = fs.readdirSync(dir) } catch (e) { if (e?.code === 'ENOENT') return []; throw e }
  return names.map(n => re.exec(n)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b)
}
function writeSynced (f, data, flag = 'wx') {
  const fd = fs.openSync(f, flag)
  try { fs.writeSync(fd, data); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
function syncDir (dir) { try { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } } catch { /* best effort */ } }

// ---- the record --------------------------------------------------------------------------------------------------------------

const recFile = (dir, key, n) => path.join(dir, `${key}.g${n}.json`)
const REC_RE = key => new RegExp(`^${esc(key)}\\.g(\\d+)\\.json$`)

/**
 * THE RECORD'S HEAD -> { ok, head: { gen, sha, rec } | null, gens, rejected }. A walk ascending: the root is the lowest file
 * with prev null that parses; each later file is the head only when its prev is the head and its prevSha the head's sha;
 * anything else is rejected (skipped, never deleted). An unreadable directory is ok: false (never "no record").
 */
export function recordHead (dir, key) {
  let gens
  try { gens = gensOf(dir, REC_RE(key)) } catch { return { ok: false, head: null, gens: [], rejected: [] } }
  let head = null
  const rejected = []
  for (const g of gens) {
    let buf
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
      fs.mkdirSync(dir, { recursive: true })
      writeSynced(tmp, buf)
      try { fs.linkSync(tmp, f) } catch (e) { if (e?.code === 'EEXIST') continue; return { result: 'error', gen: null, head: base } }
      syncDir(dir)
    } catch { return { result: 'error', gen: null, head: base } } finally { try { fs.unlinkSync(tmp) } catch { /* gone */ } }
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
    return { gen: g, rec, released, holdsUntil: released ? 0 : until, blocksUntil: released ? 0 : until + RECLAIM_MS }
  } catch { return { gen: null, rec: null, released: false, holdsUntil: 0, blocksUntil: Infinity } }
}
/** Take (or renew) a lease -> { ok, gen } | { ok: false, why }. A NEW GENERATION every time: exactly one taker per number. */
export function takeLease (dir, key, name, holder, { now = Date.now(), ttl = LEASE_TTL_MS, meta = null } = {}) {
  const cur = leaseState(dir, key, name, { ttl })
  if (cur && cur.rec?.holder !== holder && now < cur.blocksUntil) return { ok: false, why: `held by ${cur.rec?.holder ?? 'an unreadable lease'}` }
  const n = (cur?.gen ?? 0) + 1
  try {
    fs.mkdirSync(dir, { recursive: true })
    writeSynced(leaseFile(dir, key, name, n), JSON.stringify({ holder, at: now, until: now + ttl, ...(meta ? { meta } : {}) }))
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
  try { const cur = leaseState(dir, key, name); if (cur && cur.gen === gen && cur.rec?.holder === holder) fs.writeFileSync(`${leaseFile(dir, key, name, gen)}.released`, String(Date.now())) } catch { /* lapses */ }
}
/** AN ADMISSION SLOT (k = 1..max) -> { ok, slot, gen } | { ok: false, why }. Ours already: renewed in place. */
export function takeSlot (dir, key, holder, max, opts = {}) {
  for (let k = 1; k <= max; k++) if (holdsLease(dir, key, `slot${k}`, holder, null, opts.now)) { const r = takeLease(dir, key, `slot${k}`, holder, opts); return r.ok ? { ok: true, slot: k, gen: r.gen } : r }
  for (let k = 1; k <= max; k++) { const r = takeLease(dir, key, `slot${k}`, holder, opts); if (r.ok) return { ok: true, slot: k, gen: r.gen } }
  return { ok: false, why: `all ${max} slots held` }
}

// ---- the mutex (D7) -------------------------------------------------------------------------------------------------------

const lockFile = (dir, key) => path.join(dir, `${key}.mutate.lock`)
/** Is a pid alive on this host? (EPERM: alive, another user's.) */
export const pidAlive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' } }
/**
 * TAKE THE MUTEX, NON-BLOCKING -> { ok: true } | { ok: false, why }. An existing lock is reclaimed only when its holder's process
 * is dead or it is older than MUTEX_STALE_MS: renamed aside (one renamer wins), then one more exclusive create.
 */
export function mutexTake (dir, key, holder, { now = Date.now(), pid = process.pid, alive = pidAlive } = {}) {
  const f = lockFile(dir, key)
  const create = () => { try { fs.mkdirSync(dir, { recursive: true }); writeSynced(f, JSON.stringify({ holder, pid, at: now })); return true } catch { return false } }
  if (create()) return { ok: true }
  const rec = readJ(f)
  let mtimeMs = now
  try { mtimeMs = fs.statSync(f).mtimeMs } catch { return create() ? { ok: true } : { ok: false, why: 'busy' } }
  const at = Number(rec?.at ?? mtimeMs)
  const stale = (rec && Number.isInteger(rec.pid) && !alive(rec.pid)) || now - at > MUTEX_STALE_MS
  if (!stale) return { ok: false, why: `busy (${rec?.holder ?? 'unreadable'})` }
  try { fs.renameSync(f, `${f}.stale.${crypto.randomBytes(4).toString('hex')}`) } catch { return { ok: false, why: 'busy (reclaimed by another)' } }
  return create() ? { ok: true, reclaimed: rec?.holder ?? 'unreadable' } : { ok: false, why: 'busy' }
}
/** Release the mutex: only our own lock (holder and pid). Never throws. */
export function mutexRelease (dir, key, holder, { pid = process.pid } = {}) {
  try { const f = lockFile(dir, key); const rec = readJ(f); if (rec && rec.holder === holder && rec.pid === pid) fs.unlinkSync(f) } catch { /* gone */ }
}

// ---- intents ------------------------------------------------------------------------------------------------------------------

const intentFile = (dir, key, holder) => path.join(dir, `${key}.intents.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`)
const appendSynced = (f, line) => { const fd = fs.openSync(f, 'a'); try { fs.writeSync(fd, line); fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
/** APPEND AN OPEN INTENT and fsync it (step 1, before the mutex) -> its id. Throws on a write failure: no intent, no click. */
export function intentOpen (dir, key, holder, { cell, block, lease, seq, now = Date.now() }) {
  const id = `${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  fs.mkdirSync(dir, { recursive: true })
  appendSynced(intentFile(dir, key, holder), JSON.stringify({ op: 'open', id, holder, cell, block, lease, seq, at: now }) + '\n')
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
  try { names = fs.readdirSync(dir) } catch { return out }
  const re = new RegExp(`^${esc(key)}\\.intents\\..+\\.jsonl$`)
  for (const n of names.filter(x => re.test(x))) {
    const open = new Map()
    let text = ''
    try { text = fs.readFileSync(path.join(dir, n), 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let r
      try { r = JSON.parse(line) } catch { continue }
      if (r.op === 'open') open.set(r.id, r); else if (r.op === 'settled' || r.op === 'cancelled') open.delete(r.id)
    }
    for (const r of open.values()) out.push({ holder: r.holder, id: r.id, cell: r.cell, block: r.block, lease: r.lease, seq: r.seq, at: r.at })
  }
  return out
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
  try { fs.mkdirSync(dir, { recursive: true }); writeSynced(barFile(dir, key, n), JSON.stringify({ holder, why, cell, at: now })) } catch { return { ok: false, why: 'lost the race for the barrier' } }
  return gensOf(dir, BAR_RE(key)).at(-1) === n ? { ok: true, gen: n } : { ok: false, why: 'a later barrier exists' }
}
/** Release our barrier. Never throws. */
export function barrierRelease (dir, key, holder, gen) {
  try { const cur = barrierState(dir, key); if (cur && cur.gen === gen && cur.rec?.holder === holder) fs.writeFileSync(`${barFile(dir, key, gen)}.released`, String(Date.now())) } catch { /* lapses */ }
}
/**
 * MAY THE BARRIER'S HOLDER CLICK? -> { clear, waiting: [intent] }. Every OTHER holder's open intent must be settled or cancelled,
 * or its sender RETIRED (`retired`: holder -> the time its playerLeft was seen; retired RETIRE_MS ago or more). Never a timer.
 */
export function barrierClear (dir, key, holder, { retired = new Map(), now = Date.now() } = {}) {
  const waiting = openIntents(dir, key).filter(i => i.holder !== holder && !(retired.has(i.holder) && now - retired.get(i.holder) >= RETIRE_MS))
  return { clear: waiting.length === 0, waiting }
}

// ---- the fence (step 3) ---------------------------------------------------------------------------------------------------------

/**
 * MAY THIS SENDER CLICK NOW? -> null | the reason not to. Checked under the mutex, immediately before the send: the slot lease and
 * the segment lease still ours at their newest generations, the record still at the generation the step was planned on, and no
 * other holder's active barrier.
 */
export function fenceRefusal (dir, key, holder, { slot, slotGen, seg, segGen, recordGen, now = Date.now() }) {
  if (!holdsLease(dir, key, `slot${slot}`, holder, slotGen, now)) return 'slot'
  if (!holdsLease(dir, key, `seg-${seg}`, holder, segGen, now)) return 'segment'
  const h = recordHead(dir, key)
  if (!h.ok || h.head?.gen !== recordGen) return 'record'
  const b = barrierState(dir, key, now)
  if (b?.active && b.rec?.holder !== holder) return 'barrier'
  return null
}
