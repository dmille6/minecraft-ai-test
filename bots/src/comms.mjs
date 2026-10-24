// Bot-to-bot communication, over Minecraft chat.
//
// Chat rather than a side channel for three reasons: it already exists, the
// server rate-limits it for us, and it is VISIBLE -- you can stand in the world
// or watch the map and see the agents actually telling each other things. A
// private socket would work and would show you nothing.
//
// Chat is the announcement; world-facts.json is the durable store, and since chatgate-01 (2026-10-22) the ONLY one: every
// town's bots share one host and one file, so nothing is read back from chat (see the end of this file).

import { config } from './config.mjs'

const TAG = '[fleet]'
const MIN_GAP_MS = 20_000          // per-bot floor between announcements

// EVERY ANNOUNCEMENT NAMES ITS POOL. Chat is global: the server delivers every line to every bot regardless of town. When
// peers' lines were still ingested (until chatgate-01) belief was scoped to the sender's pool, and an isolated bot ingested
// nothing; nothing is ingested now, and the pool stays in the line so a human reading chat can tell the towns apart.
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

// THERE IS NO LISTENER ANY MORE (chatgate-01, comms design 5.3 / owner C7, 2026-10-22). `startComms` ingested peers'
// `[fleet]` hazard and unreachable lines into world facts. Measured 10-21: hive-a's server carried 17 such lines from
// hive-a-Alpha's four townmates in 24 h and its journal logged 0 ingestions; the other 11 towns showed 0 too. It was
// dead, it was redundant (every town's bots share one host and one world-facts file), and it was forgeable: it believed
// any name with the fleet's hyphen count, and free hazard text it ingested reached prompt lines. The announcements
// above stay: they are visible lines, and nothing reads them back. test/chatgate.test.mjs pins that nothing in src/
// attaches a `chat` listener but commands.mjs.
