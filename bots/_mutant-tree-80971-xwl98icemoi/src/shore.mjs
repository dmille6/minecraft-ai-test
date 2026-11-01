/**
 * WHERE THE NEAREST STANDABLE GROUND IS.
 *
 * This used to live in reflex.mjs, and living there is most of why it was
 * misused. Reaching land is a NAVIGATION question and an ADMISSION question --
 * "can this bot get out of the water under its own power" -- and it is not a
 * reflex. The reflex owes a drowning bot air, nothing else; treating shore as
 * the goal of a rescue is what produced 281,080 `_drowning_to_shore` ticks
 * against 32,231 escapes, and 144,356 immediate re-entries, because a bot that
 * reaches a beach it never wanted is a bot that walks straight back in.
 *
 * Two callers remain, and both ask a question shore genuinely answers:
 *   - admission.mjs, to veto a LAND-travel skill for a bot that is in water
 *     and has no bank to route from.
 *   - nothing else. Do not import this from reflex.mjs again.
 */
/**
 * The nearest block this bot could STAND on -- which is not the same question
 * as the nearest air, and that difference is the whole bug.
 *
 * `breathableRoute()` answers "where can I breathe" and correctly returns
 * {dir:'up', dist:1} for anything just under a surface; drowning-cave.test.mjs
 * asserts that on purpose, because in a flooded cave air IS the emergency exit.
 * But the rescue is only RELEASED by `ashore()`, which requires standing on
 * ground that is not water. So the escape pursued one place and was graded on
 * another, and a bot that surfaced simply floated until the 20s ownership
 * ceiling expired: 2,113 timeouts, at oxygen 399-400 out of ~400 and health 20.
 * Those bots were not drowning. They were safe, wet, and holding the body of a
 * rescue that could never end -- roughly 11.7 fleet-hours of it, interrupting
 * every travel skill they attempted.
 *
 * Block reads only, no pathfinding: this runs inside a 500ms tick that also
 * owns health, hunger, entombment and stuck detection. It answers one narrow
 * question -- "is there something I could stand on if I swam at it" -- and if
 * the answer is no, open water stays an honest failed rescue.
 *
 * WHY RING-ORDERED, AND WHY THE RADIUS GREW
 *
 * radius 10 was too small to find real shorelines: `_drowning_no_shore` fired
 * 1,572 times in twelve hours, and a `no_shore` verdict is not "there is no
 * shore" -- it is "there is no shore within ten blocks", which on open lakes is
 * almost always wrong. But the old scan swept the whole square (441 columns,
 * ~4,000 blockAt calls at radius 10); the same sweep at radius 24 is 2,401
 * columns and roughly 21,600 reads, far too much for a 500ms tick shared with
 * every other reflex.
 *
 * So the scan is ordered by Chebyshev ring, outward, and stops as soon as no
 * further ring COULD improve on what it already has. That stopping rule is
 * exact rather than approximate: every column in ring k has Euclidean distance
 * >= k, so once k exceeds the best distance found, nothing beyond can be
 * nearer. A bot next to a bank pays a few dozen reads; only genuinely open
 * water pays the full sweep, and that is the case where the answer is stable
 * enough for the caller to cache it. `maxReads` bounds the worst case; a scan
 * that hits it returns `partial: true`, which a caller MUST NOT cache as a
 * settled "no shore" -- a bank one ring past the cutoff would then be invisible
 * for the whole TTL.
 *
 * NOTE ON maxRise: deliberately still 2. A larger rise finds TALLER banks, but
 * a bot swimming at the surface cannot mount a ledge three blocks above its
 * feet -- jumping out of water clears about 1.25 -- so raising it would aim the
 * rescue at shore it can reach only in the log. Distance was the limit worth
 * lifting; height was not.
 */
export function shoreRoute (bot, { radius = 24, maxRise = 2, maxReads = 0 } = {}) {
  const none = { dir: null, target: null, dist: Infinity, scanned: 0, partial: false }
  const at = bot?.entity?.position
  if (!at || !bot.blockAt) return none
  const empty = b => b != null && b.boundingBox === 'empty'
  // Deliberately the same ground test as ashore(). If these two ever disagree,
  // the reflex would swim to a spot that does not release it -- the original
  // defect wearing different coordinates.
  const standable = b => !!b && b.name !== 'water' && b.name !== 'bubble_column' &&
                         !b.name.includes('kelp') && !b.name.includes('seagrass') &&
                         b.boundingBox === 'block'

  let best = { dir: null, target: null, dist: Infinity }
  let scanned = 0

  // One Chebyshev shell at a time. Within a shell the order does not matter,
  // because the shell is finished before the stopping rule is re-tested.
  for (let ring = 1; ring <= radius; ring++) {
    // Exact: nothing in this ring or beyond can beat a closer hit already held.
    if (ring > best.dist) break
    // A READ COUNT, NOT A CLOCK. A wall-clock budget would make this function
    // non-deterministic and it is asserted directly by drowning-shore.test.mjs;
    // a scan that returns different answers under test load is not a scan you
    // can pin. Reads are the actual cost anyway.
    if (maxReads > 0 && scanned >= maxReads) {
      return { ...best, scanned, partial: true }
    }
    for (let dx = -ring; dx <= ring; dx++) {
      const onSide = Math.abs(dx) === ring
      for (let dz = -ring; dz <= ring; dz++) {
        // Interior columns belong to a ring already scanned.
        if (!onSide && Math.abs(dz) !== ring) continue
        const d = Math.hypot(dx, dz)
        if (d > radius || d >= best.dist) continue
        // A bank a little above the waterline is still shore; a cliff is not.
        for (let dy = 0; dy <= maxRise; dy++) {
          const foot = at.offset(dx, dy, dz)
          // Charged as the reads actually happen: the ground test short-circuits
          // the other two on most columns, and a budget that bills for reads it
          // never made would bail out of cheap scans early.
          scanned += 1
          if (!standable(bot.blockAt(foot.offset(0, -1, 0)))) continue
          scanned += 2
          if (!empty(bot.blockAt(foot)) || !empty(bot.blockAt(foot.offset(0, 1, 0)))) continue
          best = { dir: 'shore', target: foot, dist: d, rise: dy }
          break
        }
      }
    }
  }
  if (best.dir === null) return { ...none, scanned }
  return { ...best, scanned, partial: false }
}
