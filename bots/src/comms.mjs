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
const NAME_RE = /^(Scout|Miner|Gather|Builder|Crafter)\d{2}$/
const MIN_GAP_MS = 20_000          // per-bot floor between announcements
const MAX_ABS = 30_000_000         // sanity bound on any coordinate

/** `[fleet] hazard entombed -1 70 5 x6` */
export function announceHazard(bot, kind, pos, count) {
  return say(bot, `${TAG} hazard ${kind} ${Math.round(pos.x)} ${Math.round(pos.y)} ${Math.round(pos.z)} x${count}`)
}

/** `[fleet] unreachable travel_150_0 -9 70 -21` -- WHERE matters as much as what. */
export function announceUnreachable(bot, id, pos = null) {
  const p = pos ?? bot.entity?.position
  const at = p ? ` ${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}` : ''
  return say(bot, `${TAG} unreachable ${String(id).replace(/\s+/g, '_').slice(0, 40)}${at}`)
}

/** `[fleet] built pillar 0 77 0 6/6` -- progress worth telling the others about. */
export function announceBuild(bot, plan, pos, done, total) {
  return say(bot, `${TAG} built ${plan} ${pos.x} ${pos.y} ${pos.z} ${done}/${total}`)
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
