// NEVER SPEND THE EXIT.
//
// Two bots are permanently entombed as of 2026-08-23 and cannot be recovered by
// any means available to them. The chain for isolated-a-Alpha, verified end to
// end:
//
//   lost its last pickaxe at y=-4 at 05:03, kept working, ended sealed at y=2
//   carries cobbled_deepslate 24, stick 6, crafting_table 64
//   craft stone_pickaxe  -> "no recipe available; place the crafting_table first"
//   place crafting_table -> "nowhere to place: no solid block with a free space
//                            above it within reach"   (it is sealed; only its own
//                            two-block body space is free)
//   cannot dig that space because it has no pickaxe
//
// Every information fix reached it -- it correctly asks for a stone pickaxe now --
// and it is still dead. Only PREVENTION would ever have worked.
//
// `mine` ALREADY refuses to descend more than two blocks without a pickaxe. That
// precondition PASSED. The capability EXPIRED mid-task when the pickaxe broke,
// and nothing re-checked it. Fleet-wide the same day: 782 lost-last-pickaxe
// transitions, 107 of them below y=50.
//
// THE RULE OF THIRDS, borrowed from cave diving, where it applies to "overhead
// environments such as caves and wrecks, where a direct ascent to the surface is
// impossible and the divers must return the way they came". A mine shaft is
// exactly that. Divers turn on a RESERVE, never on empty.
//
// WHERE THE ANALOGY BREAKS, and it matters: a diver's exit gas is ONE resource.
// Here it is at least four -- scaffold blocks, pickaxe durability, health, and
// placeable workspace. The trapped bot had the ingredients for its own rescue and
// lacked the workspace to use them, which no single-resource model would predict.

export const SEA_LEVEL = 63

// Nominal durability, for the case where an item arrives without metadata.
// Verified against minecraft-data for 1.21.8.
const PICK_DURABILITY = {
  wooden_pickaxe: 59, golden_pickaxe: 33, stone_pickaxe: 131,
  iron_pickaxe: 250, diamond_pickaxe: 1561, netherite_pickaxe: 2031,
}

// What a bot can pillar with. Deliberately narrow: it must be placeable, stack
// well, and not be something the bot needs for anything else.
const SCAFFOLD = /^(dirt|cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|gravel|sand|netherrack|tuff|deepslate)$/

/**
 * Remaining pickaxe swings across EVERY pickaxe carried.
 *
 * A stack of half-broken tools is real capability -- requiring one pickaxe to
 * cover the whole exit would ground a bot that can genuinely get out. Each tool
 * is discounted by one swing because durability metadata can lag by a tick and a
 * tool that breaks one swing early is the entire failure being prevented here.
 */
export function pickaxeUses (items = []) {
  let total = 0
  for (const it of items) {
    if (!it?.name || !/_pickaxe$/.test(it.name)) continue
    const max = it.maxDurability ?? PICK_DURABILITY[it.name]
    if (!max) continue
    const used = it.durabilityUsed ?? 0
    total += Math.max(0, (max - used) - 1) * (it.count ?? 1)
  }
  return total
}

/** Blocks the bot could pillar with. */
export function scaffoldCount (items = []) {
  let n = 0
  for (const it of items) if (it?.name && SCAFFOLD.test(it.name)) n += it.count ?? 0
  return n
}

/**
 * Can this bot go one block deeper and still get back out?
 *
 * `vertical_debt` is how far it would have to climb to reach open sky. Both
 * reserves scale with it AND have a floor, because a shallow bot that loses its
 * tool is annoying and a deep one is dead.
 *
 * Returns { ok } or { ok:false, reason, need } so the caller can both refuse and
 * say what would fix it.
 */
export function canContinueDescent ({ y, health, items = [], seaLevel = SEA_LEVEL }) {
  const debt = Math.max(0, seaLevel - Math.floor(y))
  // THE FLOOR APPLIES TO A CLIMB THAT EXISTS.
  //
  // A bot stranded at y=320 has debt 0 -- not because it is barely below sea
  // level, but because it is 250 blocks ABOVE it, where descending moves it
  // TOWARD safety. The floors still demanded 8 scaffold and 12 pickaxe uses,
  // so the refusal read:
  //
  //     "0 scaffold blocks against a 0-block climb out (need 8 with reserve)"
  //
  // a reserve against a climb this function had itself computed as zero. Three
  // bots sat at the build limit for eight hours, and 164 of their descent
  // attempts in six hours were refused, this being one of the refusals.
  //
  // The floors stay exactly as they were for anything below sea level, which
  // is the case they were written for: a shallow bot that loses its tool is
  // annoying, a deep one is dead.
  // A RESERVE MAY NOT EXCEED THE CLIMB IT INSURES.
  //
  // The floors above were written for a deep bot, where losing the tool is
  // fatal. Applied unchanged to a shallow one they invert into nonsense: at
  // debt 1 the old form demanded NINE scaffold blocks and FIFTEEN pickaxe
  // swings to climb a single block. Measured over 24h, 580 `mine` refusals
  // carried a stated debt, the MEDIAN debt was 1, and 69% were at debt <= 4 --
  // so the floor, not the depth, was doing almost all of the refusing.
  //
  // Clamping the floor to the debt keeps the deep case bit-for-bit identical --
  // at debt 12 and beyond `min(FLOOR, debt)` is just FLOOR, so y=15 still
  // prices out at 60 blocks and 62 uses exactly as before -- while a one-block
  // climb now costs a one-block reserve. The ratio term still governs the deep
  // end, which is the half that was always doing real work.
  const blockReserve = debt > 0 ? Math.max(Math.min(8, debt), Math.ceil(debt / 4)) : 0
  const pickReserve = debt > 0 ? Math.max(Math.min(12, debt), Math.ceil(debt / 4)) : 0
  const needBlocks = debt + blockReserve
  const needUses = debt + 2 + pickReserve

  if (health != null && health < 12) {
    return { ok: false, reason: 'health', debt,
             detail: `health ${health} is too low to spend on a descent; the climb out costs more than the dig down` }
  }
  const blocks = scaffoldCount(items)
  if (blocks < needBlocks) {
    return { ok: false, reason: 'scaffold', debt, have: blocks, want: needBlocks,
             detail: `${blocks} scaffold blocks against a ${debt}-block climb out (need ${needBlocks} with reserve)` }
  }
  const uses = pickaxeUses(items)
  if (uses < needUses) {
    return { ok: false, reason: 'pickaxe', debt, have: uses, want: needUses,
             detail: `${uses} pickaxe swings left against a ${debt}-block climb out (need ${needUses} with reserve)` }
  }
  return { ok: true, debt, blocks, uses }
}
