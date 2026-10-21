// Shared world knowledge -- the ONE thing every agent is allowed to know
// without having suffered it personally.
//
// Measured motivation, not a hunch. Across one night on five bots:
//
//   Scout02   entombed@-1,5  x6      \
//   Gather02  entombed@-1,5  x16      >  ~27 entombments, one hole, learned
//   Miner01   entombed@1,4   x5      /   three separate times
//
//   Scout01   gave up on travel_150_0 and travel_0_150 after 25 attempts each
//   Scout02   gave up on travel_150_0 and travel_0_150 after 25 attempts each
//
// Up to a hundred failed attempts spent discovering two facts about terrain
// that do not vary by who is standing on it.
//
// WHAT LIVES HERE, AND WHY NOTHING ELSE DOES
//
// Only facts about the WORLD. Hazard locations and goals proven unreachable.
//
// Deliberately NOT the avoid/worked policy in lessons-*.json. That is keyed on
// skill AND args -- goto{x:147,y:78,z:0} -- and whether it fails depends
// entirely on where the bot stood when it tried. Checking the fleet for
// actions avoided by more than one bot at fails>=3 found ZERO overlap. Not
// one. Sharing that would be transmitting noise, and each agent keeps learning
// its own policy from its own experience, which is what makes five bots five
// samples instead of one.
//
// CONCURRENCY
//
// Five processes on one host share this file. Every write is read-merge-write
// with an atomic rename, so a bot cannot clobber a peer's discovery the way
// reconnects were clobbering lessons earlier tonight.
//
// TRUST
//
// A shared store multiplies bad data as fast as good. Tonight a broken reflex
// wrote `drowning@-10,11 x466` into memory for places with no water anywhere
// near them -- under sharing, one bot's bug becomes the whole fleet's belief.
// So: nothing is published until the reporting bot has hit it CONFIRM_AT
// times itself, entries decay, and every fact records who reported it so a
// misbehaving agent can be traced rather than merely suspected.

import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'
import { log } from './logger.mjs'
import { DEATH_KIND_PREFIX, isDeathSite, effectiveCount, DEATH_SITE_RADIUS, DEATH_SITE_DY } from './deathsites.mjs'

const SCHEMA = 1
const FILE = 'world-facts.json'
const MAX_SITES = 120
const DECAY_MS = 12 * 60 * 60 * 1000   // longer than lessons: terrain outlives inventory
const MERGE_RADIUS = 8
const CONFIRM_AT = 2                   // personal hits before a fact is worth publishing
const DEATH_WEIGHT = 4                 // a death site starts at 4: three 12-h halvings (4 -> 2 -> 1 -> 0) before it is forgotten
const RESOURCE_MERGE = 24              // sightings within this many blocks are one deposit
const MAX_RESOURCES = 200
// keepout-01: the pool lock's budgets (#withLock)
export const WF_LOCK_ROUTINE_MS = 200
export const WF_LOCK_CRITICAL_MS = 12_000
export const WF_LOCK_STALE_MS = 10_000
const WF_LOCK_BUSY = Symbol('world-facts lock busy')
const WF_LOCK_LOST = Symbol('world-facts lock lost at the commit')
let lockSeq = 0
/** A lock (or break-lock) with no parseable token after this long is dead (nothing this code writes is token-less). */
export const WF_LOCK_EMPTY_MS = WF_LOCK_STALE_MS
/**
 * THE PROCESS'S IDENTITY: pid + start time in clock ticks since boot (/proc/<pid>/stat field 22), the kernel's own answer
 * to "is this the same process" (Codex r6 P1: the /proc inode's ctime is when the inode was instantiated, not when the
 * process started). Off Linux the start is unknown ('na') and only the pid is checked.
 */
export function parseStartTicks (stat) {
  const s = String(stat ?? '')
  const close = s.lastIndexOf(')')                  // comm may hold spaces and ')': the fields resume after the LAST ')'
  if (close < 0) return null
  const f = s.slice(close + 2).split(' ')           // f[0] is field 3 (state); field 22 is f[19]
  return /^\d+$/.test(f[19] ?? '') ? f[19] : null
}
export function pidStartTicks (pid) { try { return parseStartTicks(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')) } catch { return null } }
const SELF_START = pidStartTicks(process.pid) ?? 'na'
const newToken = now => `${process.pid}.${SELF_START}.${++lockSeq}.${now}`
/** A fresh token for THIS process (tests build live holders with it). */
export const selfToken = (now = Date.now()) => newToken(now)
/** Is this pid alive on this host? (EPERM: alive, another user's.) */
export function pidAlive (pid) { try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' } }
/**
 * IS THE HOLDER OF THIS TOKEN DEAD? Pure over the probes. Every bot of a pool runs on ONE host as the same user's systemd
 * units with no PID namespace of their own (comms design 1; mcbot@.service) -- if that ever changes, this test calls live
 * holders dead (Claude r5 P3-3). Dead = no such pid, or that pid is now a DIFFERENT process (its start ticks differ from the
 * token's: reuse). An unparseable token (none is written by this code: tokens are published atomically, tryLock) is dead
 * after WF_LOCK_EMPTY_MS. NEVER BY AGE ALONE: a live holder paused for any length keeps its lock (Codex r5 P2). The fleet is
 * Linux; on a host without /proc a reused pid would read as alive and the pool's writes would wait or be skipped until that
 * process ends (Claude r6 P3-2) -- the safe direction.
 */
export function holderDead (token, lockMtimeMs, now = Date.now(), { alive = pidAlive, startTicks = pidStartTicks } = {}) {
  const [p, start] = String(token ?? '').split('.')
  const pid = Number(p)
  if (!Number.isInteger(pid) || pid <= 0 || start == null) return now - lockMtimeMs > WF_LOCK_EMPTY_MS
  if (!alive(pid)) return true
  if (start === 'na') return false
  const nowStart = startTicks(pid)
  return nowStart != null && nowStart !== start
}
const readToken = f => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
/**
 * PUBLISH A LOCK ATOMICALLY WITH ITS TOKEN (Codex r6 P2): the token is written to a private file first and hard-linked into
 * place -- link() fails if the name exists, and the lock never exists without its token, so no live holder is ever
 * "token-less". -> true (ours) | 'EEXIST' | an error code.
 */
function publish (lock, token) {
  const tmp = `${lock}.${token}.tmp`
  try { fs.writeFileSync(tmp, token, { flag: 'wx' }) } catch (e) { return e.code ?? 'error' }
  try { fs.linkSync(tmp, lock); return true } catch (e) { return e.code ?? 'error' } finally { try { fs.unlinkSync(tmp) } catch { /* gone */ } }
}
/**
 * ONE TRY AT THE POOL LOCK -> a token (ours), or null (held: wait), or { enoent } / { error } (cannot be created).
 * A DEAD holder's lock is removed under a BREAK-LOCK (Codex r5 P1): one breaker at a time takes `<lock>.break` (published the
 * same atomic way), RE-READS the lock and unlinks it only if it still holds the very token judged dead. While the break-lock
 * is held nobody else can remove the lock, and nobody can create one while the dead one exists, so the unlink removes exactly
 * the dead holder's lock. A breaker that lost the break-lock race waits. A break-lock whose own holder is dead (killed inside
 * its microsecond section) is removed the same way, with no age wait (Codex r6 P3: a 60 s wait outlived a death's budget);
 * two cleaners racing on such an abandoned break-lock is the residual window (it needs a breaker to die in that section).
 */
export function tryLock (lock, now = Date.now(), probes = {}) {
  const token = newToken(now)
  const r = publish(lock, token)
  if (r === true) return token
  if (r === 'ENOENT') return { enoent: true }
  if (r !== 'EEXIST') return { error: r }
  try {
    const held = readToken(lock)
    const st = fs.statSync(lock)
    if (held != null && holderDead(held, st.mtimeMs, now, probes)) breakDead(lock, held, now, probes)
  } catch { /* the holder released it meanwhile */ }
  return null
}
/** Remove `lock` iff it still holds `dead`, under the break-lock. Exported for the race tests. */
export function breakDead (lock, dead, now = Date.now(), probes = {}) {
  const brk = `${lock}.break`, mine = newToken(now)
  const r = publish(brk, mine)
  if (r !== true) {
    if (r === 'EEXIST') {
      try { const bt = readToken(brk), bs = fs.statSync(brk); if (bt != null && holderDead(bt, bs.mtimeMs, now, probes) && readToken(brk) === bt) fs.unlinkSync(brk) } catch { /* gone */ }
    }
    return false
  }
  try {
    if (readToken(lock) === dead) { fs.unlinkSync(lock); return true }
    return false
  } finally { if (readToken(brk) === mine) { try { fs.unlinkSync(brk) } catch { /* gone */ } } }
}
/** Is the lock still ours? */
export function lockOwned (lock, token) { try { return fs.readFileSync(lock, 'utf8') === token } catch { return false } }
/** Release the lock only if it is still ours (a broken-and-retaken lock belongs to someone else now). */
export function unlockIfOwned (lock, token) { if (lockOwned(lock, token)) { try { fs.unlinkSync(lock) } catch { /* gone */ } } }

// THE PROMPT SHOWS ONLY KNOWN HAZARD KINDS (chatgate-01, comms design 5.3). A hazard's `kind` reached the model's prompt
// verbatim, and until chatgate-01 a peer's `[fleet]` line could write any 24 characters of it. Every kind this code writes
// is listed here: the reflexes' `entombed` and the air reflex's `drowning` / `suffocating` (reflex.mjs), and a death
// site's `death:<class>` for every class index.mjs deathClass returns. Anything else on file is never displayed.
export const PROMPT_HAZARD_KINDS = new Set(['entombed', 'drowning', 'suffocating'])
export const PROMPT_DEATH_CLASSES = new Set(['fall', 'suffocation', 'drowning', 'fire', 'mob', 'starvation', 'unknown', 'other'])
/** May this hazard kind be shown in a prompt line? Pure. */
export function promptHazardKind (kind) {
  if (typeof kind !== 'string') return false
  if (kind.startsWith(DEATH_KIND_PREFIX)) return PROMPT_DEATH_CLASSES.has(kind.slice(DEATH_KIND_PREFIX.length))
  return PROMPT_HAZARD_KINDS.has(kind)
}

export class WorldFacts {
  constructor(file) {
    this.file = file
    this.cache = { schema: SCHEMA, sites: [], unreachable: {}, resources: [] }
    this.lastRead = 0
    this.read()
  }

  /** Cheap re-read so a bot picks up what peers found while it was working. */
  read(maxAgeMs = 20_000) {
    if (Date.now() - this.lastRead < maxAgeMs) return this.cache
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (raw.schema === SCHEMA) this.cache = raw
    } catch { /* first bot to start creates it */ }
    this.lastRead = Date.now()
    return this.cache
  }

  /**
   * Read-merge-write under an atomic rename.
   *
   * The merge step is the point: a plain overwrite would drop whatever a peer
   * wrote between our read and our write, which is exactly how reconnects were
   * deleting recorded successes from lessons-*.json earlier tonight.
   */
  #update(mutate, { critical = false } = {}) {
    const r = this.#withLock(owned => this.#updateLocked(mutate, owned), critical ? WF_LOCK_CRITICAL_MS : WF_LOCK_ROUTINE_MS)
    if (r === WF_LOCK_BUSY) log(critical ? 'error' : 'warn', 'world facts: write skipped, the pool lock is busy', { critical, file: path.basename(this.file) })
    return r
  }

  /**
   * ONE WRITER AT A TIME (keepout-01, Codex r1/r2 P1-5). The rename is atomic, but a read-merge-write without a lock loses an
   * update when two processes interleave (measured: 40 of 80 concurrent deaths kept). lessons.mjs's O_EXCL lockfile, with
   * one difference that matters (Codex r2 P1): contention is NEVER permission to write unlocked. A ROUTINE write (a sighting,
   * a hazard, a give-up, a dispute -- each repeats or is safe to lose) waits WF_LOCK_ROUTINE_MS and is then SKIPPED. A
   * CRITICAL write (a death: one event, never repeated) waits up to WF_LOCK_CRITICAL_MS; the critical section itself is a few
   * ms, and a dead holder's lock is removed at once (tryLock / breakDead: by its pid, never its age -- Codex r4/r5). A lock that cannot be created
   * for a reason other than contention (the pool directory missing) gets the directory made and is tried again; one that
   * cannot be created at all (permissions) SKIPS the write, loudly (Codex r3 P1: never unlocked).
   * OWNERSHIP (Codex r3 P1): the lock holds a token; it is released only by its owner (unlockIfOwned), and the write's rename
   * happens only while the token is still ours (a holder paused past the stale break lost the lock and writes nothing).
   */
  #withLock (fn, budgetMs) {
    const lock = `${this.file}.lock`
    const until = Date.now() + budgetMs
    let made = false
    for (;;) {
      const t = tryLock(lock)
      if (typeof t === 'string') {
        let r
        try { r = fn(() => lockOwned(lock, t)) } finally { unlockIfOwned(lock, t) }
        // LOST AT THE COMMIT (only possible after a dead/abandoned-holder takeover race): read, merge and write again
        if (r !== WF_LOCK_LOST) return r
        if (Date.now() >= until) return WF_LOCK_BUSY
        continue
      }
      if (t?.enoent && !made) { made = true; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }) } catch { /* next try says */ } continue }
      if (t?.error || t?.enoent) return WF_LOCK_BUSY
      if (Date.now() >= until) return WF_LOCK_BUSY
      const spin = Date.now() + 4
      while (Date.now() < spin) { /* spin: the holder's critical section is a few ms */ }
    }
  }

  #updateLocked(mutate, owned = null) {
    let current = { schema: SCHEMA, sites: [], unreachable: {}, resources: [] }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (raw.schema === SCHEMA) current = raw
    } catch { /* not created yet */ }

    mutate(current)
    this.#prune(current)

    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(current, null, 1))
      if (owned && !owned()) { try { fs.unlinkSync(tmp) } catch { /* gone */ } return WF_LOCK_LOST }   // the lock was lost: write nothing, retry
      fs.renameSync(tmp, this.file)      // atomic: readers never see a half file
      this.cache = current
      this.lastRead = Date.now()
    } catch (e) {
      log('warn', 'world facts: write failed', { err: e.message })
    }
  }

  #prune(d) {
    const now = Date.now()
    // HALVE ONCE PER DECAY PERIOD, NOT ONCE PER WRITE. `last` is the last HIT, and this file is written every few
    // seconds (resource sightings), so a site 12 h past its last hit used to halve on every write until it was gone
    // within a minute -- "decays by half every 12 h" was never what it did (Codex, 16 Sep). `decayedAt` records the
    // halving; the next one waits another period.
    // ...and EVERY elapsed period counts, not just one: after 48 quiet hours a weight of 4 is 0, not 2 (Codex pass 2).
    // `decayedAt` advances by whole periods so a partial period is not lost.
    const decay = s => {
      const ref = Math.max(s.last ?? 0, s.decayedAt ?? 0); const periods = ref > 0 ? Math.floor((now - ref) / DECAY_MS) : 0
      if (periods > 0) { s.count = Math.floor(s.count / 2 ** periods); s.decayedAt = ref + periods * DECAY_MS }
    }
    for (const s of d.sites) decay(s)
    d.sites = d.sites.filter(s => s.count >= 1).slice(-MAX_SITES)
    // Resources decay too -- a chopped forest is not a forest.
    for (const r of (d.resources ?? [])) decay(r)
    d.resources = (d.resources ?? []).filter(r => r.count >= 1).slice(-MAX_RESOURCES)
    for (const [k, v] of Object.entries(d.unreachable)) {
      if (now - (v.last ?? 0) > DECAY_MS * 2) delete d.unreachable[k]
    }
  }

  // ------------------------------------------------------------ publishing --

  /**
   * Publish a hazard. `personalCount` is how many times THIS bot has hit it --
   * one bad reading never becomes fleet doctrine.
   */
  reportHazard(kind, pos, personalCount, by = config.bot.name) {
    if (!pos || personalCount < CONFIRM_AT) return false
    let added = false
    this.#update(d => {
      const near = d.sites.find(s =>
        s.kind === kind &&
        Math.hypot(s.x - pos.x, s.z - pos.z) < MERGE_RADIUS &&
        Math.abs(s.y - pos.y) < 8)
      if (near) {
        near.count++
        near.last = Date.now()
        if (!near.by.includes(by)) { near.by.push(by); added = true }
      } else {
        d.sites.push({
          kind,
          x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z),
          count: 1, last: Date.now(), by: [by],
        })
        added = true
      }
    })
    return added
  }

  /**
   * Publish a goal this bot proved it could not reach, AND WHERE IT STOOD.
   *
   * The location is not decoration. "gather_oak_log_8 is unreachable" is a
   * statement about a place, not about the world: a bot underground or in a
   * clearing genuinely cannot get oak logs, while a bot in a forest trivially
   * can. Published without coordinates the fact is simply false for most of the
   * map, and it would talk a bot standing in a forest out of chopping a tree.
   *
   * Recorded per reporter, because two bots can fail the same goal in two
   * different places and both are telling the truth.
   */
  reportUnreachable(id, by = config.bot.name, pos = null, detail = '') {
    let added = false
    const where = pos
      ? { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) }
      : null
    this.#update(d => {
      const e = d.unreachable[id]
      if (e) {
        e.last = Date.now()
        if (!e.by.includes(by)) { e.by.push(by); added = true }
        e.where ??= {}
        if (where) e.where[by] = where
      } else {
        d.unreachable[id] = { by: [by], last: Date.now(), detail, where: where ? { [by]: where } : {} }
        added = true
      }
    })
    return added
  }

  /**
   * Record where a useful block was SEEN.
   *
   * The fleet's memory was entirely negative: hazard sites and failed actions,
   * both with coordinates, and nothing at all about where anything good is. A
   * bot could walk past a forest, die, and have learned nothing about the
   * forest. Meanwhile every abandoned goal was correctly location-tagged, so
   * the agents accumulated a precise map of where things DON'T work and no map
   * of where they do.
   *
   * Shared for the same reason hazards are: "there is oak here" is a fact about
   * the world, not a policy about one bot. It decays, because a forest that has
   * been chopped down is no longer a forest.
   */
  reportResource(kind, pos, by = config.bot.name) {
    if (!pos || !kind) return false
    let added = false
    this.#update(d => {
      d.resources ??= []
      const near = d.resources.find(r =>
        r.kind === kind && Math.hypot(r.x - pos.x, r.z - pos.z) < RESOURCE_MERGE)
      if (near) {
        near.count++
        near.last = Date.now()
        if (!near.by.includes(by)) near.by.push(by)
      } else {
        d.resources.push({
          kind, x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z),
          count: 1, last: Date.now(), by: [by],
        })
        added = true
      }
    })
    return added
  }

  /** Known sightings of a block, nearest first. */
  resourcesNear(kind, pos, radius = 400) {
    if (!pos) return []
    return (this.read().resources ?? [])
      .filter(r => r.kind === kind && Math.hypot(r.x - pos.x, r.z - pos.z) <= radius)
      .sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z))
  }

  // -------------------------------------------------------------- consuming --

  /**
   * Has a peer proven this goal unreachable FROM SOMEWHERE NEAR ME?
   *
   * Proximity is the whole test. A peer that failed to find oak logs 400
   * blocks away tells me nothing about the forest I am standing in, and acting
   * on it would be worse than knowing nothing. Without a position on either
   * side we decline to apply the report at all -- an unlocated claim is not
   * evidence.
   */
  unreachableBy(id, me = config.bot.name, pos = null, radius = 64) {
    const e = this.read().unreachable[id]
    if (!e || !pos) return null
    const others = e.by.filter(n => n !== me)
    if (!others.length) return null
    const near = others.filter(n => {
      const w = e.where?.[n]
      if (!w) return false                       // unlocated report: not usable
      return Math.hypot(w.x - pos.x, w.z - pos.z) <= radius
    })
    return near.length ? near : null
  }

  /**
   * A DEATH IS NOT A READING. reportHazard needs two personal hits before a place becomes a fact, which is right for
   * a sensor that once wrote 466 phantom drownings; a death message from the server is not a sensor. One death is a
   * site, weighted DEATH_WEIGHT so it outlives three 12-h decay periods, merged with an earlier death of the same
   * class within MERGE_RADIUS. Consumed deterministically by the pathfinder and by explore (deathsites.mjs), never
   * only as a prompt line.
   */
  reportDeath(cls, pos, by = config.bot.name) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return null
    const kind = `${DEATH_KIND_PREFIX}${String(cls || 'unknown').slice(0, 24)}`
    let site = null
    const wrote = this.#update((d) => {
      // MERGE ONLY WHEN THE KEPT CENTRE STILL PRICES THE NEW DEATH: a death 7 blocks from a site would have merged
      // into a centre whose 6-block disc does not cover it (Codex pass 2), so the merge radius is half the disc.
      const near = d.sites.find(s =>
        s.kind === kind &&
        Math.hypot(s.x - pos.x, s.z - pos.z) <= DEATH_SITE_RADIUS / 2 &&
        Math.abs(s.y - pos.y) <= DEATH_SITE_DY / 2)
      if (near) {
        near.count += DEATH_WEIGHT; near.deaths = (near.deaths ?? 1) + 1; near.last = Date.now()
        if (!near.by.includes(by)) near.by.push(by)
        // THE NEXT DEATH CLEARS A DISPUTE (keepout-01, design 4.2): a lava read that found the disc clear is outranked by a
        // fire death there -- the site keeps bots out again
        delete near.disputed
        site = near
      } else {
        site = { kind, x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z), count: DEATH_WEIGHT, deaths: 1, last: Date.now(), by: [by] }
        d.sites.push(site)
      }
    }, { critical: true })
    if (wrote === WF_LOCK_BUSY) return null   // not on file: never reported as recorded
    return site
  }

  /**
   * A LAVA READ FOUND THIS FIRE SITE'S DISC CLEAR (keepout-01, design 4.2 `fire_site` disproof): every cell of the disc,
   * loaded, and no lava. The site is KEPT (its price on paths and its prompt line are unchanged) and marked `disputed`, so
   * keepout-01 stops keeping bots out of its column; the next fire death there clears the mark (reportDeath). -> the
   * stored site, or null when no live fire site sits at that centre.
   */
  disputeFireSite(at, seen = null, by = config.bot.name) {
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y) || !Number.isFinite(at.z)) return null
    let hit = null
    const wrote = this.#update(d => {
      const s = d.sites.find(q => q.kind === `${DEATH_KIND_PREFIX}fire` && q.x === at.x && q.y === at.y && q.z === at.z)
      // VERSION-CHECKED (Codex r1 P1-5): the read judged the site as it was (`seen`: its death count and last death); a peer's
      // newer fire death there since then outranks the read, so the dispute is not written
      if (seen && s && ((s.deaths ?? 1) !== (seen.deaths ?? 1) || (s.last ?? 0) !== (seen.last ?? 0))) return
      if (s && !s.disputed) { s.disputed = { at: Date.now(), by }; hit = s }
    })
    return wrote === WF_LOCK_BUSY ? null : hit
  }

  /** Every death site on file (the cache; re-read every 20 s). Cheap enough for the pathfinder's per-node price. */
  deathSites(now = Date.now()) {
    return this.read().sites.filter(s => isDeathSite(s) && effectiveCount(s, now, DECAY_MS) >= 1)   // reads never prune; the decay is applied on the way out
  }

  hazardsNear(pos, radius = 50) {
    if (!pos) return []
    return this.read().sites
      .filter(s => Math.hypot(s.x - pos.x, s.z - pos.z) <= radius)
      .sort((a, b) => b.count - a.count)
  }

  /**
   * Prompt lines, attributed. "Gather02 got stuck here 16 times" carries more
   * weight for a model than a bare coordinate, and it keeps the agent honest
   * about which knowledge is first-hand and which is hearsay.
   */
  promptLines(pos, limit = 4) {
    const out = []
    // Where things ARE, not just where they are not. Distance included so the
    // model can judge whether it is worth the trip.
    const seen = new Map()
    for (const r of (this.read().resources ?? [])) {
      if (!pos) break
      const d = Math.round(Math.hypot(r.x - pos.x, r.z - pos.z))
      if (d > 300) continue
      const prev = seen.get(r.kind)
      if (!prev || d < prev.d) seen.set(r.kind, { r, d })
    }
    for (const { r, d } of [...seen.values()].sort((a, b) => a.d - b.d).slice(0, 4)) {
      // LABEL EVERY AXIS. This line used to read `seen at ${r.x},${r.z}` -- two
      // numbers -- and `goto` takes three. The model filled the slots left to
      // right, so the z it was given became the y it emitted: `goto {"x":33,
      // "y":-176,...}`, 34 times, every one rejected as an impossible elevation.
      // x=33 and y=-176 stayed fixed across those because they were a real
      // stored (x,z) pair; only the invented z moved.
      //
      // It was never the model ignoring `REACHABLE Y RANGE`. It never had a y.
      // Hazards on the next loop already print three numbers, so the prompt was
      // showing two coordinate conventions in one list.
      out.push(`${r.kind} seen at x=${r.x} y=${r.y ?? Math.round(pos.y)} z=${r.z} ` +
               `(${d} blocks away, reported by ${r.by.join(' and ')})`)
    }
    for (const s of this.hazardsNear(pos, 60).filter(s => promptHazardKind(s.kind)).slice(0, limit)) {
      const who = s.by.filter(n => n !== config.bot.name)
      if (!who.length) continue                     // already in my own lessons
      out.push(`${who.join(' and ')} hit ${s.kind} ${s.count}x near ${s.x},${s.y},${s.z} — avoid it`)
    }
    return out
  }

  get stats() {
    const d = this.read()
    return { sites: d.sites.length, unreachable: Object.keys(d.unreachable).length }
  }
}

export function openWorldFacts() {
  // MEMORY_SCOPE=isolated gives each bot its own world model, so nothing at all
  // is learned from a peer -- the true independent-agents control arm. private
  // and shared both keep the single shared file, which is what every run to
  // date has used: a deposit one bot finds is already visible to all, recorded
  // with a `by: [Scout01, Scout02]` array.
  // ...and `private` and `shared` now share it WITHIN A POOL rather than
  // globally. The old single world-facts.json was read by every non-isolated
  // bot in the fleet, so a deposit found by a hive bot was already visible to
  // the private arm: two arms that were never independent, and no amount of
  // careful lesson-scoping could have made them so. See config.memory.
  // ...and the DIRECTORY has to be pool-scoped too, which it was not.
  //
  // Same defect as lessons.mjs and found the same day: a pool-NAMED file placed
  // in a per-bot STATE_DIR is a private file with a shared name. On the fleet,
  // six copies of world-facts-hive-a.json with distinct inodes and sizes
  // 32095/32350/3537/32734/30448/31791. So the pooled WORLD MODEL -- every
  // resource sighting and hazard one bot found for another -- was never shared
  // either, on top of the belief store.
  const pooled = config.memory.scope !== 'isolated'
  const file = pooled
    ? FILE.replace(/\.json$/, `-${config.memory.pool}.json`)
    : FILE.replace(/\.json$/, `-${config.bot.name}.json`)
  const dir = pooled ? poolStateDir(config.memory.pool) : config.log.stateDir
  return new WorldFacts(path.join(dir, file))
}

/** Where a pool's shared state lives. One definition, used by both stores. */
export function poolStateDir (pool, stateDir = config.log.stateDir) {
  return process.env.POOL_STATE_DIR ||
         path.join(path.dirname(stateDir), `_pool-${pool}`)
}
