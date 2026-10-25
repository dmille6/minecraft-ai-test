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
  try { fs.mkdirSync(dir, { recursive: true }); writeSynced(f, JSON.stringify({ holder, pid, conn, at: now })) } catch { return { ok: false, why: 'busy (lost the race)' } }
  let gens = []
  try { gens = gensOf(dir, MUTEX_RE(key)) } catch { /* judged below */ }
  if (gens.at(-1) !== n) { try { fs.writeFileSync(`${f}.released`, String(now)) } catch { /* not the newest: never decides */ } return { ok: false, why: 'busy (a newer generation)' } }
  for (const g of gens) if (g <= n - MUTEX_KEEP) { for (const x of [mutexFile(dir, key, g), `${mutexFile(dir, key, g)}.released`]) { try { fs.unlinkSync(x) } catch { /* gone */ } } }
  return { ok: true, gen: n, ...(['dead', 'superseded', 'torn', 'retired'].includes(st.why) ? { reclaimed: st.rec?.holder ?? 'torn' } : {}) }
}
/** Release the mutex: our own generation only (holder and pid; `gen` omitted: the newest). A marker, never a delete. Never throws. */
export function mutexRelease (dir, key, holder, { pid = process.pid, gen = null } = {}) {
  try {
    const g = gen ?? gensOf(dir, MUTEX_RE(key)).at(-1)
    if (g == null) return
    const f = mutexFile(dir, key, g)
    const rec = readJ(f)
    if (rec && rec.holder === holder && rec.pid === pid) fs.writeFileSync(`${f}.released`, String(Date.now()))
  } catch { /* lapses only with the process */ }
}

// ---- presence (r2: a holder's connection, for the mutex and for retirement) -------------------------------------------------

const presenceFile = (dir, key, holder) => path.join(dir, `${key}.presence.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
/** Write the holder's current connection (at every login): a temp file renamed into place. Never throws. */
export function presenceWrite (dir, key, holder, { conn, pid = process.pid, now = Date.now(), beat = null, sync = true } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const f = presenceFile(dir, key, holder), tmp = `${f}.${pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
    const body = JSON.stringify({ holder, conn, pid, at: now, beat: beat ?? now })   // at: the connection's login; beat: now
    if (sync) writeSynced(tmp, body); else fs.writeFileSync(tmp, body)
    fs.renameSync(tmp, f)
  } catch { /* the other retirement evidence still applies */ }
}
/** The holder's presence -> { holder, conn, pid, at } | null. */
export function presenceRead (dir, key, holder) { return readJ(presenceFile(dir, key, holder)) }

// ---- intents ------------------------------------------------------------------------------------------------------------------

const intentFile = (dir, key, holder) => path.join(dir, `${key}.intents.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`)
const appendSynced = (f, line) => { const fd = fs.openSync(f, 'a'); try { fs.writeSync(fd, line); fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
/** APPEND AN OPEN INTENT and fsync it (step 1, before the mutex) -> its id. Throws on a write failure: no intent, no click. */
export function intentOpen (dir, key, holder, { cell, block, lease, seq, conn = null, now = Date.now() }) {
  const id = `${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  fs.mkdirSync(dir, { recursive: true })
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
