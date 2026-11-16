// GKSWEEP-01: THE GROUNDSKEEPER'S SWEEP (owner 11-04, groundskeeper piece 6: "if the bot drops dirt it can pick it up"; "i want the
// area inside the town walls to look organized ... clean, like a normal town"). After its visit to the grounds the keeper (or a
// helper) walks to the items lying on the ground INSIDE THE WALLS and picks them up -- only what its bag can take with room to spare,
// never the fleet's junk (hygiene.mjs NEVER_KEEP: the owner's "stop collecting junk"), never at a well (the junk well is where the
// bots throw what they shed: a missed throw is the thrower's own). What it picks up goes where the bag's other things go (the town
// visit's deposit, the junk well, the tidy's own fills for dirt and cobblestone).
//
// PURE: the switch, the knobs and the choice of drops. skills.mjs gkSweep walks to them and counts what the bag gained.

/** The knobs. max: drops walked to a sweep; freeMin: free bag slots kept after a pickup that needs a new slot (hygiene.mjs sheds from
 *  TRIGGER_SLOTS = 34 used, so 6 free keeps the sweep 4 slots clear of it); walkMs: one walk's bound; dy: how far above or below home
 *  a drop may lie (a drop in a mine under the town is not the grounds'); wellR: no drop within this of a well's cap column; budgetMs:
 *  the whole sweep's bound (and never past the visit's own budget); stack: a stack's size when the item does not say. */
export const GKSWEEP = Object.freeze({ max: 6, freeMin: 6, walkMs: 6000, dy: 12, wellR: 2, budgetMs: 30_000, stack: 64 })

/** THE SWITCH: GKSWEEP=off|0|false|no -> no sweep; on by default. Pure. */
export const gkSweepOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.GKSWEEP ?? '').trim())

const inBox = (b, x, z) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]

/**
 * THE DROPS TO WALK TO -> { picks: [drop], skipped: { why: n }, seen }. Pure.
 *   drops   [{ id, name, count, pos: { x, y, z } }] -- the item entities the bot sees (name: the dropped item's)
 *   boxes   [[x0, z0, x1, z1]] -- inside the walls (tidy.mjs inwallBoxes)
 *   home    { x, y, z }; caps [[x, y, z]] -- the wells' caps; from { x, y, z } -- the bot's feet (nearest first)
 *   stacks  [{ name, count, stackSize }] -- the bag's stacks; free -- its free slots now; never Set -- names never chased
 *   over    (name) -> bool: the bag already holds its allowance of this name (bagallowance.mjs: a second crafting table is shed
 *           again at the next town visit -- never picked up)
 * A drop is taken in order while it fits: first into the room left in the bag's own stacks of that name (and the room a pick's
 * new stack leaves), else into a new slot only while more than `freeMin` slots stay free after it.
 */
export function sweepPick (drops = [], { boxes = [], home, caps = [], from = null, stacks = [], free = 0, never = new Set(), over = () => false, T = GKSWEEP } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  if (!home || !boxes.length) return { picks: [], skipped: { no_boxes: drops.length }, seen: drops.length }
  const room = new Map()
  for (const s of stacks ?? []) { if (!s?.name) continue; const sz = Number(s.stackSize) || T.stack; room.set(s.name, (room.get(s.name) ?? 0) + Math.max(0, sz - (Number(s.count) || 0))) }
  const o = from ?? home
  const d2 = p => (p.x - o.x) ** 2 + (p.y - o.y) ** 2 + (p.z - o.z) ** 2
  const cand = (drops ?? []).filter(dp => dp && dp.pos && [dp.pos.x, dp.pos.y, dp.pos.z].every(Number.isFinite)).sort((a, b) => d2(a.pos) - d2(b.pos) || String(a.id).localeCompare(String(b.id)))
  const picks = []
  let slots = Number(free) || 0
  for (const dp of cand) {
    const x = Math.floor(dp.pos.x), z = Math.floor(dp.pos.z)
    if (!boxes.some(b => inBox(b, x, z))) { skip('outside'); continue }
    if (Math.abs(dp.pos.y - home.y) > T.dy) { skip('depth'); continue }
    if ((caps ?? []).some(c => Array.isArray(c) && Math.max(Math.abs(c[0] - x), Math.abs(c[2] - z)) <= T.wellR)) { skip('well'); continue }
    if (!dp.name || never.has(dp.name)) { skip('junk'); continue }
    if (over(dp.name)) { skip('allowance'); continue }
    if (picks.length >= T.max) { skip('max'); continue }
    const n = Math.max(1, Number(dp.count) || 1), r = room.get(dp.name) ?? 0
    if (n <= r) { room.set(dp.name, r - n); picks.push(dp); continue }
    // a new slot: only while more than freeMin stay free after it
    if (slots - 1 < T.freeMin) { skip('bag_full'); continue }
    slots--
    room.set(dp.name, r + T.stack - n)
    picks.push(dp)
  }
  return { picks, skipped, seen: cand.length }
}

/** The visit outcomes after which the crew bot sweeps: it holds the keeper or a helper lease and the visit did not fail. Pure. */
export function sweepAfter (role, res) {
  if (role !== 'keeper' && role !== 'helper') return false
  if (!res || res.status === 'failed') return false
  return !['keeper_held', 'keeper_term', 'keeper_rest', 'off', 'zones_unknown', 'no_plan', 'record_unreadable', 'lost_record'].includes(String(res.stop ?? ''))
}
/** Codex r1 BLOCKER: the visit may have let its lease go (a stuck crew bot releases it) -- the sweep runs only while this bot HOLDS
 *  the grounds NOW, read from the lease files (skills.mjs crewState: 'keeper' -- the keeper lease is this bot's; 'mine' -- one of
 *  the helper leases is). Pure. */
export const holdsGrounds = d => d === 'keeper' || d === 'mine'
