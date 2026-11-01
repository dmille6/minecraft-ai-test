/**
 * HOW MUCH AIR THIS BOT HAS, DERIVED FROM ITS OWN HEAD.
 *
 * `bot.oxygenLevel` cannot be used. mineflayer writes it from the `air_supply`
 * metadata of ANY entity in range -- a fish swimming past overwrites the bot's
 * own value. That was confirmed, three fixes were attempted, all three failed,
 * and the field was left in place as a diagnostic. Every threshold built on it
 * has been measuring, in part, the local wildlife.
 *
 * The bot's own block occupancy is not corruptible by other entities. Minecraft
 * gives a player 300 ticks (15s) of air, drains it while the head is in a
 * non-breathable block, and refills it quickly on surfacing. That is a clock we
 * can keep ourselves from two facts we already read every tick: what block the
 * head is in, and how long it has been there.
 *
 * This deliberately does NOT decide anything. It reports seconds of air. What
 * counts as an emergency belongs to the caller, so that the threshold and the
 * sensor can never again be tangled together.
 */

export const MAX_AIR_SECONDS = 15      // 300 ticks, vanilla
// Refilling is modelled as instant -- a surfaced bot is topped up in well under
// a second, and every consumer asks "do I have time", so rounding in the bot's
// favour is the unsafe direction. Deliberately NOT a constant: an exported flag
// nothing reads is the `bot.waterMovements` defect, where a correctly
// configured value had no consumer and a test asserted it was set correctly.
// The behaviour lives in makeAirClock() below, where it is actually applied.

const UNDERWATER_PLANT = /^(kelp|kelp_plant|seagrass|tall_seagrass)$/

/**
 * Can the bot breathe in this block?
 *
 * Air is the ABSENCE of water and of a solid, and neither `name === 'air'` nor
 * `boundingBox === 'empty'` is sufficient alone: kelp and seagrass are empty
 * and not named water, and any waterlogged stair or slab is a solid-looking
 * block full of water. Unknown waterlogged blocks count as NOT breathable,
 * deliberately -- the safe error is believing there is less air than there is.
 */
export function breathable (block) {
  if (!block) return false
  if (block.name === 'water' || block.name === 'lava') return false
  if (UNDERWATER_PLANT.test(block.name)) return false
  const wl = block.getProperties?.().waterlogged
  if (wl === true || wl === 'true') return false
  // A bubble column IS water, but an UPWARD one carries the bot to the surface.
  // It is not breathable and must not be counted as such.
  if (block.name === 'bubble_column') return false
  return block.boundingBox === 'empty'
}

export function headBlock (bot) {
  const at = bot?.entity?.position
  if (!at || !bot.blockAt) return null
  return bot.blockAt(at.offset(0, 1, 0))
}

export function headIsBreathable (bot) {
  return breathable(headBlock(bot))
}

/**
 * A running air clock.
 *
 * `update(now)` must be called on the tick the caller already runs; it does not
 * own a timer. Returns seconds of air remaining.
 */
export function makeAirClock ({ maxSeconds = MAX_AIR_SECONDS } = {}) {
  let seconds = maxSeconds
  let lastAt = null
  let submergedSince = null
  return {
    update (bot, now = Date.now()) {
      const dt = lastAt == null ? 0 : Math.max(0, (now - lastAt) / 1000)
      lastAt = now
      if (headIsBreathable(bot)) {
        seconds = maxSeconds
        submergedSince = null
      } else {
        seconds = Math.max(0, seconds - dt)
        if (submergedSince == null) submergedSince = now
      }
      return seconds
    },
    get seconds () { return seconds },
    get fraction () { return maxSeconds > 0 ? seconds / maxSeconds : 0 },
    get submergedMs () { return submergedSince == null ? 0 : Date.now() - submergedSince },
    reset () { seconds = maxSeconds; lastAt = null; submergedSince = null },
  }
}

/**
 * IS THIS AN AIR EMERGENCY? Being wet is not, and never was.
 *
 * The old predicate fired on wet feet, which is how a bot crossing a river on
 * purpose had its journey cancelled, and how "hold the surface" came to be
 * pressed on bots three metres down. An emergency requires all three of:
 *
 *   the head is actually under,
 *   the derived clock is nearly out,
 *   and nothing is fixing it -- either no progress toward air, or damage.
 *
 * A bot that is submerged with eight seconds of air and rising is fine. A bot
 * that is submerged, nearly out, and getting closer to air is ALSO fine: it is
 * already solving the problem, and seizing it would destroy the solution.
 */
export const CRITICAL_SECONDS = 2.5
export const LOW_SECONDS = 5

export function airEmergency ({ headUnder, airSeconds, closingOnAir = false,
                                healthFalling = false } = {}) {
  if (!headUnder) return false
  if (healthFalling && airSeconds <= LOW_SECONDS) return true
  if (airSeconds > CRITICAL_SECONDS) return false
  return !closingOnAir
}
