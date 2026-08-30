// Bot-to-bot communication, over Minecraft chat.
//
// Chat rather than a side channel for three reasons: it already exists, the
// server rate-limits it for us, and it is VISIBLE -- you can stand in the world
// or watch the map and see the agents actually telling each other things. A
// private socket would work and would show you nothing.
//
// Chat is the announcement; world-facts.json is the durable store. The file is
// authoritative for bots sharing a host; chat is what carries a discovery to
// bots on a DIFFERENT host, where the file cannot reach.
//
// TRUST BOUNDARY
//
// Chat is an input from outside this process, and a human player can type
// anything into it. So:
//
//   - Only messages from names matching our own fleet pattern are parsed.
//   - Only NUMBERS are extracted. A peer can tell us "there is a hole at
//     x,y,z"; it can never tell us to go somewhere, run a skill, or change a
//     goal. Nothing arriving over chat reaches the decision layer as an
//     instruction -- it lands in the same advisory hazard list the bot builds
//     from its own experience.
//   - Coordinates are bounds-checked before being believed.
//
// That ordering matters: a compromised or merely buggy peer should be able to
// make its neighbours cautious, never obedient.

import { config } from './config.mjs'
import { log } from './logger.mjs'

const TAG = '[fleet]'
// A LITERAL ROSTER GOES STALE, AND THIS ONE HAS DONE IT TWICE.
//
// The comment that used to sit here said the pattern had been fixed for the
// Hive/Solo rename. It then went stale again at the arm-pool rename, and this
// time it excluded the ENTIRE fleet: Block 2 names are `hive-a-Alpha`,
// `board-d-Comet`, `isolated-a-Bravo` -- lowercase, hyphenated, no two-digit
// suffix -- and every one of them fails
// /^(Scout|Miner|Gather|Builder|Crafter|Hive|Solo)\d{2}$/.
//
// Verified across 4.6 GB of telemetry and every store on disk: the ingestion
// marker "reported over chat" appears ZERO times. `say()` has no name filter,
// so bots announced hazards normally and every listener dropped the line at the
// door. The fleet talked and nothing listened, for the whole block.
//
// So the pattern is no longer a list of names. It is derived from THIS BOT'S
// OWN NAME, because a peer is something shaped like me. Rename the fleet and it
// keeps working; that is the property the two previous versions lacked.
//
// A human could still mimic the shape deliberately. That is a smaller risk than
// a silent total outage of the channel, and it is now stated rather than
// assumed.
function peerPattern (selfName = '') {
  const parts = String(selfName || '').split('-').filter(Boolean)
  // What identifies a peer is the HYPHEN STRUCTURE, not the character classes.
  // My first attempt derived a class per segment from its case, and broke the
  // moment a segment was a digit -- a renamed fleet would have been deaf again,
  // which is the exact property this is supposed to guarantee. Segment content
  // is deliberately permissive; the arity is what a stray player name fails.
  if (parts.length >= 2) {
    return new RegExp(`^${parts.map(() => '[A-Za-z0-9_]+').join('-')}$`)
  }
  // Fall back to the historical roster if our own name is unusable, so a
  // misconfigured bot degrades to the old behaviour rather than trusting nobody
  // -- which would be this same outage arriving by a different door.
  return /^(Scout|Miner|Gather|Builder|Crafter|Hive|Solo)\d{2}$/
}
const NAME_RE = peerPattern(config.bot?.name)
const MIN_GAP_MS = 20_000          // per-bot floor between announcements
const MAX_ABS = 30_000_000         // sanity bound on any coordinate

// EVERY ANNOUNCEMENT NAMES ITS POOL, AND INGESTION IS SCOPED TO IT.
//
// Chat is global: the server delivers every line to every bot regardless of
// experiment arm. Before exp-001 that was the point -- one fleet, one memory.
// Under the experiment it was a leak: a shared-arm bot giving up on a goal
// broadcast that belief, and ISOLATED bots ingested it into their world model
// (tagged 'reported over chat', so block-1 contamination is quantifiable).
// "Unreachable" claims are the exact false-belief object this lab studies, so
// the control arm was receiving a dilute dose of the treatment.
//
// The rule now mirrors the memory design exactly: chat may only carry a fact
// between bots whose MEMORY_POOL matches, and an isolated bot ingests nothing
// from anyone -- that is what isolated means. Announcing stays unrestricted:
// speech is free, belief is scoped.
const POOL = String(config.memory.pool ?? 'hive').replace(/\s+/g, '_').slice(0, 24)

/** `[fleet] hive-b hazard entombed -1 70 5 x6` */
export function announceHazard(bot, kind, pos, count) {
  return say(bot, `${TAG} ${POOL} hazard ${kind} ${Math.round(pos.x)} ${Math.round(pos.y)} ${Math.round(pos.z)} x${count}`)
}

/** `[fleet] hive-b unreachable travel_150_0 -9 70 -21` -- WHERE matters as much as what. */
export function announceUnreachable(bot, id, pos = null) {
  const p = pos ?? bot.entity?.position
  const at = p ? ` ${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}` : ''
  return say(bot, `${TAG} ${POOL} unreachable ${String(id).replace(/\s+/g, '_').slice(0, 40)}${at}`)
}

/** `[fleet] hive-b built pillar 0 77 0 6/6` -- progress worth telling the others about. */
export function announceBuild(bot, plan, pos, done, total) {
  return say(bot, `${TAG} ${POOL} built ${plan} ${pos.x} ${pos.y} ${pos.z} ${done}/${total}`)
}

let lastSaid = 0
function say(bot, text) {
  const now = Date.now()
  if (now - lastSaid < MIN_GAP_MS) return false   // the server kicks for chat spam
  lastSaid = now
  try { bot.chat(text.slice(0, 250)); return true } catch { return false }
}

/**
 * Listen for peers. Returns a detach function.
 *
 * `onFact` receives only validated, structured data -- never raw text.
 */
export function startComms(bot, worldFacts, onFact = null) {
  const handler = (username, message) => {
    if (username === config.bot.name) return          // our own echo
    if (!NAME_RE.test(username)) return               // players are not sources of truth
    if (typeof message !== 'string' || !message.startsWith(TAG)) return

    const parts = message.slice(TAG.length).trim().split(/\s+/)

    // BELIEF IS SCOPED. An isolated bot ingests nothing -- not "less", nothing;
    // any ingestion makes the control arm a dilute treatment arm. Everyone else
    // believes only their own pool. The sender's pool is the first token; a
    // message without one is the pre-scoping format and is not trusted either,
    // because its sender's pool is unknowable.
    if (config.memory.scope === 'isolated') return
    const senderPool = parts.shift()
    if (senderPool !== POOL) return

    const kind = parts[0]

    if (kind === 'hazard' && parts.length >= 5) {
      const what = String(parts[1]).slice(0, 24)
      const x = Number(parts[2]), y = Number(parts[3]), z = Number(parts[4])
      if (![x, y, z].every(Number.isFinite)) return
      if (Math.abs(x) > MAX_ABS || Math.abs(z) > MAX_ABS || y < -256 || y > 512) return
      const n = Math.min(Math.max(parseInt(String(parts[5] ?? 'x1').replace('x', ''), 10) || 1, 1), 999)
      worldFacts.reportHazard(what, { x, y, z }, Math.max(n, 2), username)
      log('info', 'peer reported hazard', { from: username, kind: what, x, y, z, count: n })
      onFact?.({ type: 'hazard', from: username, kind: what, x, y, z, count: n })
      return
    }

    if (kind === 'unreachable' && parts.length >= 2) {
      const id = String(parts[1]).slice(0, 40)
      if (!/^[\w.-]+$/.test(id)) return
      let where = null
      if (parts.length >= 5) {
        const x = Number(parts[2]), y = Number(parts[3]), z = Number(parts[4])
        if ([x, y, z].every(Number.isFinite) &&
            Math.abs(x) <= MAX_ABS && Math.abs(z) <= MAX_ABS && y >= -256 && y <= 512) {
          where = { x, y, z }
        }
      }
      worldFacts.reportUnreachable(id, username, where, 'reported over chat')
      log('info', 'peer gave up on a goal', { from: username, milestone: id })
      onFact?.({ type: 'unreachable', from: username, id })
      return
    }

    if (kind === 'built' && parts.length >= 6) {
      log('info', 'peer reported build progress', { from: username, plan: String(parts[1]).slice(0, 24), progress: String(parts[5]).slice(0, 12) })
      onFact?.({ type: 'built', from: username, plan: String(parts[1]).slice(0, 24) })
    }
  }

  bot.on('chat', handler)
  return () => { try { bot.removeListener('chat', handler) } catch { /* already gone */ } }
}
