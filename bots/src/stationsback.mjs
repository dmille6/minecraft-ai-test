// STATIONSBACK-01: THE STATION A RETAKE DUG MUST REACH THE BAG (status report 11-09: "46 made, 138 left behind (6 h)").
//
// MEASURED 11-09 on bcdba35f (stations-01 is live), telemetry.py, 80 bots:
//   6 h, 563,569 rows: the flowledger rule counts 155 stations left -- 30 of them crafting tables BURNED AS FUEL by
//   stations-01 SURPLUS (not left; the read is fixed on main), 88 smelt furnaces (82 below y=50), 26 craft tables.
//   12 h retake rows: smelt/tidy retakeStation 149 back, 66 "dug but it did not arrive", 40 "dig: Digging aborted";
//   craft's table retake 97 back, 50 "its drop is not in sight", 8 "after walking into its pickup box", 8 Digging aborted.
//   Of the 121 "did not arrive" rows, 49 saw the same station picked up passively by the same bot within 120 s:
//   the drop WAS there, the retake gave up on it too early or never walked to it.
// THE TWO GAPS:
//   1. stations-01's retakeStation (smelt's furnace, the sweep) never chases its drop: it reads the bag for 1.5 s and
//      gives up. Craft's table retake has walked into the drop's pickup box since bagdiet-01; the furnace never did.
//      And both look for the drop ONCE: a drop not yet in sight is "not in sight" forever.
//   2. "Digging aborted" is mineflayer's stopDigging (digging.js 4.37.1: a new dig, the pathfinder, the dig watchdog),
//      never a server refusal and never our signal: a concurrent reflex (marooned pillar_out, water float) moving the
//      bot mid-dig. Traced: board-a-Alpha 11:42:15Z, `_scaffold_pick pillar_out` 47 ms before the abort, held dirt.
//      The station is still standing (the cancel packet went out) -- one retry once the bot is still is cheap.
// THE FIX (STATIONSBACK=off is the base exactly):
//   waitStationDrop  look for the station's own drop for up to SB.lookMs (100 ms apart), not once
//   chaseStationDrop walk into its pickup box (pickupbox.mjs, the server's own rule), then read the bag
//   digWithRetry     a dig cancelled by stopDigging (not our signal) is retried ONCE after the bot stands still,
//                    on a fresh ownership re-check
// Pure or dependency-injected throughout, so the tests run it against fakes.

const OFF = v => v != null && /^(0|off|false|no)$/i.test(String(v).trim())
/** STATIONSBACK=0|off turns every part off (the base). Pure. */
export function sbOn (env = (typeof process !== 'undefined' ? process.env : {})) { return !OFF(env?.STATIONSBACK) }

export const SB = Object.freeze({
  dropR: 6,          // the drop is looked for this far from the cell's centre (craft's TABLE_DROP_R)
  lookMs: 1500,      // ...for this long
  stepMs: 100,
  walkMs: 8000,      // the walk into its pickup box (craft's)
  arriveLooks: 12,   // bag reads after the walk, stepMs apart (craft's)
  settleMs: 3000,    // a cancelled dig waits at most this long for the bot to stand still
  retries: 1,
})

/** Is this dig error mineflayer's stopDigging cancel, and may the retake dig once more? Pure. */
export function digAbortedRetry ({ err = null, aborted = false, tried = 0, on = sbOn() } = {}) {
  if (!on || aborted || err?.aborted) return false
  if (tried >= SB.retries) return false
  return /Digging aborted/.test(String(err?.message ?? err ?? ''))
}

/** The item entity's dropped item name, or null. Never throws. */
export function dropName (e) {
  try { return e?.getDroppedItem?.()?.name ?? null } catch { return null }
}

/** THE STATION'S OWN DROP NEAR ITS CELL -> the entity nearest the cell's centre, or null. Pure over the bot's entities. */
export function stationDrop (bot, at, name, R = SB.dropR) {
  const c = { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 }
  const d = e => Math.hypot(e.position.x - c.x, e.position.y - c.y, e.position.z - c.z)
  let best = null; let bd = Infinity
  for (const e of Object.values(bot?.entities ?? {})) {
    if (e?.name !== 'item' || !e.position || dropName(e) !== name) continue
    const k = d(e)
    if (k < R && k < bd) { best = e; bd = k }
  }
  return best
}

/** LOOK FOR THE DROP FOR UP TO lookMs -> the entity or null. Stops early when the bag already holds more than `before`. */
export async function waitStationDrop (bot, { at, name, before, count, sleep, signal, lookMs = SB.lookMs, stepMs = SB.stepMs }) {
  for (let t = 0; ; t += stepMs) {
    if (count() > before) return null
    const e = stationDrop(bot, at, name)
    if (e) return e
    if (t >= lookMs) return null
    await sleep(stepMs, signal)
  }
}

/**
 * CHASE THE STATION'S DROP -> { back, how }. Looks for it (waitStationDrop), walks into its pickup box unless already in it,
 * then reads the bag arriveLooks times. Every dependency is passed in: { goals, Goal, inPickupBox, withTimeout, sleep, count }.
 * A walk error that is an abort rethrows; any other walk error is said in `how` and the bag is still read.
 */
export async function chaseStationDrop (bot, { at, name, before, signal, Goal, inPickupBox, withTimeout, sleep, count }) {
  const arrived = () => count() > before
  if (arrived()) return { back: true, how: '' }
  const drop = await waitStationDrop(bot, { at, name, before, count, sleep, signal })
  if (arrived()) return { back: true, how: ' (arrived while it looked for the drop)' }
  if (!drop) return { back: false, how: ' (its drop is not in sight)' }
  if (!Goal) return { back: false, how: ' (no pickup goal available)' }
  let how = ' after walking into its pickup box'
  if (!inPickupBox(bot.entity?.position, drop.position)) {
    try { await withTimeout(bot.pathfinder.goto(new Goal(drop.position)), SB.walkMs, bot) } catch (e) {
      if (e?.aborted || signal?.aborted) throw e
      how = ` (walk to its drop: ${String(e?.failClass ?? e?.message ?? e).slice(0, 40)})`
    }
  }
  for (let i = 0; i < SB.arriveLooks && !arrived(); i++) await sleep(SB.stepMs, signal)
  return { back: arrived(), how }
}

/** Is the bot standing still (no path, no dig)? Never throws (unknown: still). */
export function botStill (bot) {
  try { return !(bot?.pathfinder?.isMoving?.()) && !bot?.targetDigBlock } catch { return true }
}

/**
 * DIG, AND RETRY ONCE A DIG A CONCURRENT REFLEX CANCELLED -> { retried }. `dig(again)` runs the dig (again = null on the first
 * try, the re-checked block on the retry); `recheck()` -> the block when it is still the station and still ours, else null
 * (it arms the fresh ownership watch the retry digs under). The first error is rethrown when no retry is allowed, when the
 * bot does not stand still within settleMs, or when the re-check fails.
 */
export async function digWithRetry ({ dig, recheck, bot, sleep, signal, on = sbOn(), settleMs = SB.settleMs, stepMs = SB.stepMs }) {
  try { await dig(null); return { retried: false } } catch (e) {
    if (!digAbortedRetry({ err: e, aborted: !!signal?.aborted, tried: 0, on })) throw e
    let waited = 0
    while (!botStill(bot) && waited < settleMs) { await sleep(stepMs, signal); waited += stepMs }
    if (!botStill(bot)) throw e
    const again = recheck()
    if (!again) throw e
    await dig(again)
    return { retried: true }
  }
}
