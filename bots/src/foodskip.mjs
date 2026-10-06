// FOOD IS NOT CHASED IN A PEACEFUL WORLD -- AND ONLY THERE, UNLESS SOMEONE SAYS OTHERWISE.
//
// Measured 10-05 (docs/reports/bag-creep-analysis-2026-10-05.md, 80 bots, 24-36 h): food holds ~2.1 slots of every
// bag (apples 1.09 slots, 73 bots, median 45 apples), and NOTHING takes it out again: hunger read 20 in every one of
// 778,498 snapshots, because every fleet world runs difficulty=peaceful (scripts/provision-block2.sh), where hunger
// never drops. The bank refuses food (bankable.mjs: not a standing target) and the composter refuses it
// (composter.mjs NEVER_COMPOST). Apples arrive mostly from leaf drops while chopping (+2.6 of +3.1 a bot-day).
//
// OWNER, 10-05 ~18:30Z: "lets just not pickup [food] for now, but have the option to turn that off if we turn the
// world to a not peaceful world".
//
// WHAT THIS GOVERNS, AND WHAT IT CANNOT. pickupNearbyItems (skills.mjs) no longer WALKS to a food drop while the skip
// is active -- the same door hygiene.mjs's NEVER_KEEP uses for ballast. It cannot stop ARRIVAL: the server hands any
// item within ~1 block of a player's box to that player once the pickup delay ends, and mineflayer cannot refuse it
// (owner-stop-collecting-junk, 09-29). A bot that chops a tree standing under the canopy still receives the apples
// that land at its feet. So this removes the chasing share of the inflow, not all of it; the canary measures how
// much that is.
//
// THE SWITCH. FOOD_SKIP = auto | on | off (env, read once per process like PLANT_ENABLED).
//   auto (default)  skip food only while the server says the world is PEACEFUL (mineflayer bot.game.difficulty, set
//                   from the server's `difficulty` packet). Any other difficulty, or no packet yet, picks food up as
//                   before -- a world with hunger needs food, and "unknown" must never starve a bot.
//   on              always skip food (a test, or a world the owner knows is peaceful).
//   off             never skip food: the old behaviour, whatever the difficulty.
// An unreadable value is `auto` (and says so in the row below), never a silent `on`.

/** The modes, in the order the doc above gives them. */
export const FOOD_SKIP_MODES = Object.freeze(['auto', 'on', 'off'])

/** FOOD_SKIP from the environment -> { mode, raw, valid }. Pure. Empty/absent is the default `auto`. */
export function foodSkipMode (env = {}) {
  const raw = env?.FOOD_SKIP
  if (raw === undefined || raw === null || String(raw).trim() === '') return { mode: 'auto', raw: null, valid: true }
  const v = String(raw).trim().toLowerCase()
  if (FOOD_SKIP_MODES.includes(v)) return { mode: v, raw: String(raw), valid: true }
  return { mode: 'auto', raw: String(raw), valid: false }
}

/**
 * THE SERVER'S DIFFICULTY, READ OURSELVES -- because mineflayer's own reading is always undefined on 1.21.8.
 *
 * Found on the Paper sandbox (10-05, foodskip-ab.cjs): every candidate row said `difficulty=unknown active=0` in a
 * peaceful world. minecraft-data 1.21.8 declares the `difficulty` packet's field as a MAPPER (varint -> 'peaceful' |
 * 'easy' | 'normal' | 'hard'), so node-minecraft-protocol already hands over the NAME, and mineflayer 4.37.1 then
 * indexes its own name table with it (game.js: `difficultyNames[packet.difficulty]`) -> undefined. The login packet
 * no longer carries a difficulty. So auto would never have switched on: the unit tests set bot.game.difficulty by
 * hand and could not see it.
 *
 * normalizeDifficulty accepts either shape (a name, or the older numeric 0..3) and anything else is null (unknown).
 */
const DIFFICULTY_NAMES = ['peaceful', 'easy', 'normal', 'hard']
export function normalizeDifficulty (v) {
  if (typeof v === 'string') return DIFFICULTY_NAMES.includes(v.toLowerCase()) ? v.toLowerCase() : null
  if (Number.isInteger(v) && v >= 0 && v < DIFFICULTY_NAMES.length) return DIFFICULTY_NAMES[v]
  return null
}
/** Record the server's difficulty from the raw packet onto bot.serverDifficulty. Call once, right after createBot. */
export function attachDifficulty (bot) {
  try {
    bot?._client?.on?.('difficulty', p => { const d = normalizeDifficulty(p?.difficulty); if (d) bot.serverDifficulty = d })
  } catch { /* a test double without a client */ }
}
/** The difficulty this bot is in: our own reading of the packet first, mineflayer's (if it ever works) second; else null. */
export function difficultyOf (bot) {
  return normalizeDifficulty(bot?.serverDifficulty) ?? normalizeDifficulty(bot?.game?.difficulty)
}

/**
 * IS THE SKIP ACTIVE? Pure. `difficulty` is mineflayer's bot.game.difficulty: 'peaceful' | 'easy' | 'normal' |
 * 'hard', or undefined before the server's difficulty packet. Only `auto` reads it, and only 'peaceful' skips.
 */
export function foodSkipActive (mode, difficulty) {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return difficulty === 'peaceful'
}

/**
 * IS THIS ITEM FOOD? Pure over a name and a foods table (minecraft-data's foodsByName, which mineflayer exposes as
 * bot.registry.foodsByName): every edible item -- apples, golden apples, raw and cooked meat, bread, berries, kelp,
 * melon, carrots, potatoes. Nothing on the tech ladder is in it (no stick, plank, log, coal, ore or tool).
 */
export function isFoodName (name, foodsByName) {
  return typeof name === 'string' && !!foodsByName && Object.hasOwn(foodsByName, name)
}

/**
 * Should pickupNearbyItems leave this item entity on the floor because it is food and the skip is active? Pure over
 * the entity (prismarine-entity getDroppedItem) and the two readings. An unreadable entity is chased as before.
 */
export function skipFoodDrop (entity, { active = false, foodsByName = null } = {}) {
  if (!active) return false
  try { return isFoodName(entity?.getDroppedItem?.()?.name, foodsByName) } catch { return false }
}

/**
 * THE POLICY'S LAST DECISION IN THIS PROCESS (one bot per process): foodSkipNow (skills.mjs) records it, so the runner's
 * outcome classifier -- which has no bot -- can count an apple lost in a compost visit as the composter's own effect only
 * while apples are composted at all. False until the first decision.
 */
let peaceful = false
export function setPeacefulFood (active) { peaceful = !!active }
export function peacefulFoodActive () { return peaceful }

/** The row's detail: mode, what the env said, the difficulty read, and the decision. No digits beyond the flag. */
export function foodSkipDetail ({ mode, raw = null, valid = true, difficulty = null, active = false } = {}) {
  return `food skip ${active ? 'ON' : 'off'}: mode=${mode}${valid ? '' : ` (FOOD_SKIP=${String(raw).slice(0, 20)} unreadable, using auto)`} difficulty=${difficulty ?? 'unknown'} active=${active ? 1 : 0}`
}
