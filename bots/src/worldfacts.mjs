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

const SCHEMA = 1
const FILE = 'world-facts.json'
const MAX_SITES = 120
const DECAY_MS = 12 * 60 * 60 * 1000   // longer than lessons: terrain outlives inventory
const MERGE_RADIUS = 8
const CONFIRM_AT = 2                   // personal hits before a fact is worth publishing
const RESOURCE_MERGE = 24              // sightings within this many blocks are one deposit
const MAX_RESOURCES = 200

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
  #update(mutate) {
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
      fs.renameSync(tmp, this.file)      // atomic: readers never see a half file
      this.cache = current
      this.lastRead = Date.now()
    } catch (e) {
      log('warn', 'world facts: write failed', { err: e.message })
    }
  }

  #prune(d) {
    const now = Date.now()
    for (const s of d.sites) {
      if (now - (s.last ?? 0) > DECAY_MS) s.count = Math.floor(s.count / 2)
    }
    d.sites = d.sites.filter(s => s.count >= 1).slice(-MAX_SITES)
    // Resources decay too -- a chopped forest is not a forest.
    for (const r of (d.resources ?? [])) {
      if (now - (r.last ?? 0) > DECAY_MS) r.count = Math.floor(r.count / 2)
    }
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
      out.push(`${r.kind} seen at ${r.x},${r.z} (${d} blocks away, reported by ${r.by.join(' and ')})`)
    }
    for (const s of this.hazardsNear(pos, 60).slice(0, limit)) {
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
  return new WorldFacts(path.join(config.log.stateDir, FILE))
}
