// keeperstall-01: THE KEEPER'S MEMORY FOR THE PROCESS, NOT THE CONNECTION.
//
// index.mjs connect() makes a NEW `bot` object after every disconnect, in the same process. A clock or a give-up count kept ON the
// bot therefore starts again exactly when a stall has thrown the bot off the server (LIVE showcase 11-10: the water visit that timed
// the keeper out was due again the moment it was back, and every give-up count was 0 again -- one stall became a loop, the loop an
// out-of-memory kill). What lives here is ONE PLAIN OBJECT PER BOT NAME for the life of the process; skills.mjs keeps exactly these
// fields on it:
//
//   bw3At             ms of the keeper's last water visit (boardwalk-03: every BW3.everyMs)
//   bw3Given          Map cut key -> visits it still stood (tidy.mjs tidyNoteCuts / tidyGivenUp)
//   forestIdleUntil   ms until which the forest rests for this bot
//   forestSkip        Map tree key -> ms until which a failed tree is passed
//   forestFails       Map tree key -> failures (forest.mjs keepDue)
//   gkCountryAt       ms of the keeper's last country visit (country.mjs groundsLane)
//
// NEVER HERE (both design reviews, BLOCKER): anything that describes the OLD connection's world or body -- the unknown cells
// (`shopUnknown`), the acknowledgement tracker (`shopAcks`), the stand memories and their pending walks (`bw3Stands`, `forestStands`,
// `tidyStands`). A new connection must ask the server again; those stay on the bot.
//
// PROCMEM=off|0|false|no: the object is kept on the bot itself (per connection, as before this module).

export const procMemOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.PROCMEM ?? '').trim())
const ON = procMemOn()
const STORE = new Map()

/**
 * THE MEMORY OBJECT FOR `bot` -> a plain object, the same one for every bot object carrying the same `username` in `store` (Map name
 * -> object). Kept on the bot itself (`bot.procMemOwn`: per connection) when `on` is false, or when the bot has no name yet (two
 * nameless bots never share). No bot at all: a throwaway object. Never holds the bot. Pure over `store`.
 */
export function procMemOf (store, bot, on = true) {
  if (!bot || typeof bot !== 'object') return {}
  const name = typeof bot.username === 'string' && bot.username ? bot.username : null
  if (!on || !name || !store) return (bot.procMemOwn ??= {})
  let m = store.get(name)
  if (!m) { m = {}; store.set(name, m) }
  return m
}
/** This process's memory for `bot` (the PROCMEM switch read once at load). */
export const procMem = bot => procMemOf(STORE, bot, ON)
